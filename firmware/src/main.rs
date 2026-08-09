#![no_std]
#![no_main]

mod config;
mod ddp;
mod frame;
mod hello;
mod leds;
mod stats;

use cyw43::{JoinOptions, PowerManagementMode, aligned_bytes};
use cyw43_pio::{DEFAULT_CLOCK_DIVIDER, PioSpi};
use embassy_executor::Spawner;
use embassy_futures::select::{Either, select};
use embassy_net::udp::{PacketMetadata, UdpSocket};
use embassy_net::{Config, DhcpConfig, IpEndpoint, StackResources};
use embassy_rp::clocks::RoscRng;
use embassy_rp::gpio::{Level, Output};
use embassy_rp::peripherals::{DMA_CH0, PIO0, USB};
use embassy_rp::pio::{InterruptHandler as PioIrq, Pio};
use embassy_rp::usb::{Driver, InterruptHandler as UsbIrq};
use embassy_rp::{bind_interrupts, dma};
use embassy_time::{Duration, Instant, Timer};
use heapless::String;
use static_cell::StaticCell;

use crate::config::{DDP_PORT, HOSTNAME, STATS_PORT, WIFI_PASSWORD, WIFI_SSID};
use crate::frame::Frame;
use crate::leds::LedOutput;
use crate::stats::Stats;

// A panic reboots and reprints the banner, which is what tells it apart from a WiFi drop. cyw43
// has open panics on a bad password and on rejoining while already associated.
use panic_reset as _;

bind_interrupts!(struct Irqs {
	PIO0_IRQ_0 => PioIrq<PIO0>;
	DMA_IRQ_0 => dma::InterruptHandler<DMA_CH0>;
	USBCTRL_IRQ => UsbIrq<USB>;
});

#[embassy_executor::task]
async fn logger_task(driver: Driver<'static, USB>) {
	embassy_usb_logger::run!(1024, log::LevelFilter::Info, driver);
}

#[embassy_executor::task]
async fn cyw43_task(
	runner: cyw43::Runner<'static, cyw43::SpiBus<Output<'static>, PioSpi<'static, PIO0, 0>>>,
) -> ! {
	runner.run().await
}

#[embassy_executor::task]
async fn net_task(mut runner: embassy_net::Runner<'static, cyw43::NetDriver<'static>>) -> ! {
	runner.run().await
}

/// The only status this board can show without a serial console attached: lit solid means it is
/// still trying to reach the network, blinking means it is up.
#[embassy_executor::task]
async fn heartbeat_task(mut control: cyw43::Control<'static>) {
	loop {
		control.gpio_set(0, true).await;
		Timer::after_millis(60).await;
		control.gpio_set(0, false).await;
		Timer::after_millis(940).await;
	}
}

#[embassy_executor::main]
async fn main(spawner: Spawner) {
	let p = embassy_rp::init(Default::default());

	spawner.spawn(logger_task(Driver::new(p.USB, Irqs)).unwrap());

	// Before the radio, so the wiring check is the first thing the board does and a join that
	// never lands cannot hide it.
	let mut leds = LedOutput::new(p.PWM_SLICE1, p.PIN_18, p.PIN_19, p.PWM_SLICE2, p.PIN_20);
	leds.selftest().await;

	let fw = aligned_bytes!("../cyw43-firmware/43439A0.bin");
	let clm = aligned_bytes!("../cyw43-firmware/43439A0_clm.bin");
	let nvram = aligned_bytes!("../cyw43-firmware/nvram_rp2040.bin");

	let pwr = Output::new(p.PIN_23, Level::Low);
	let cs = Output::new(p.PIN_25, Level::High);
	let mut pio = Pio::new(p.PIO0, Irqs);
	let spi = PioSpi::new(
		&mut pio.common,
		pio.sm0,
		DEFAULT_CLOCK_DIVIDER,
		pio.irq0,
		cs,
		p.PIN_24,
		p.PIN_29,
		dma::Channel::new(p.DMA_CH0, Irqs),
	);

	static STATE: StaticCell<cyw43::State> = StaticCell::new();
	let (net_device, mut control, cyw43_runner) =
		cyw43::new(STATE.init(cyw43::State::new()), pwr, spi, fw, nvram).await;
	spawner.spawn(cyw43_task(cyw43_runner).unwrap());

	control.init(clm).await;

	// Measured as a no-op on this hardware with cyw43 0.7.0: PowerSave and None give an
	// identical idle-ping distribution, 64% of replies under 5 ms with no cluster at the DTIM
	// interval, whether the call is made here or after the join. The chip stays awake either
	// way, so the setting is kept only for the day the driver honours it.
	control.set_power_management(PowerManagementMode::None).await;

	let mut dhcp = DhcpConfig::default();
	dhcp.hostname = Some(String::try_from(HOSTNAME).unwrap());

	static RESOURCES: StaticCell<StackResources<3>> = StaticCell::new();
	let mut rng = RoscRng;
	let (stack, net_runner) = embassy_net::new(
		net_device,
		Config::dhcpv4(dhcp),
		RESOURCES.init(StackResources::new()),
		rng.next_u64(),
	);
	spawner.spawn(net_task(net_runner).unwrap());

	control.gpio_set(0, true).await;
	while let Err(err) = control.join(WIFI_SSID, JoinOptions::new(WIFI_PASSWORD.as_bytes())).await {
		log::warn!("join failed: {:?}, retrying", err);
	}
	stack.wait_link_up().await;
	stack.wait_config_up().await;

	let addr = stack.config_v4().unwrap().address.address();
	log::info!("room-node on {addr}, DDP :{DDP_PORT}, stats -> :{STATS_PORT}");
	spawner.spawn(heartbeat_task(control).unwrap());

	// A 1320 pixel frame is three back-to-back datagrams and cyw43 only holds four, so the
	// socket is sized to absorb a burst the driver could not.
	let mut rx_meta = [PacketMetadata::EMPTY; 16];
	let mut rx_buffer = [0; 8192];
	let mut tx_meta = [PacketMetadata::EMPTY; 4];
	let mut tx_buffer = [0; 512];
	let mut pkt = [0; 1500];

	let mut socket =
		UdpSocket::new(stack, &mut rx_meta, &mut rx_buffer, &mut tx_meta, &mut tx_buffer);
	socket.bind(DDP_PORT).unwrap();

	let mut frame = Frame::new();
	let mut stats = Stats::new();

	let boot = Instant::now();
	let mut reported = boot;
	let mut report_at = boot + Duration::from_secs(1);
	let mut last_seq = 0u8;
	let mut last_push: Option<Instant> = None;
	let mut frame_start: Option<Instant> = None;
	let mut peer: Option<IpEndpoint> = None;

	loop {
		let event = select(socket.recv_from(&mut pkt), Timer::at(report_at)).await;

		match event {
			Either::First(Ok((n, meta))) => {
				let now = Instant::now();

				// Answered before the parse and on the asker's own port, so discovery needs no
				// listener on the stats port and never counts against `bad`.
				if hello::is_query(&pkt[..n]) {
					let line = hello::line((now - boot).as_secs());
					let _ = socket.send_to(line.as_bytes(), meta.endpoint).await;
					continue;
				}

				let Some(p) = ddp::parse(&pkt[..n]) else {
					stats.bad += 1;
					continue;
				};

				stats.packets += 1;
				stats.bytes += n as u32;

				// Only a loss signal while this board is the sole DDP target: the host's
				// counter spans every target, so a split fixture strides rather than steps.
				if last_seq != 0 && p.seq != ddp::next_seq(last_seq) {
					stats.seq_gaps += 1;
				}
				last_seq = p.seq;

				if frame_start.is_none() {
					frame_start = Some(now);
				}
				peer = Some(IpEndpoint::new(meta.endpoint.addr, STATS_PORT));

				if !frame.apply(&p) {
					stats.out_of_range += 1;
				}

				if p.push {
					let presented = Instant::now();
					leds.present(frame.pixels()).await;
					let led = (Instant::now() - presented).as_micros() as u32;
					if !frame.close() {
						stats.torn += 1;
					}

					// All three spans are measured from `now`, the moment PUSH arrived, so
					// what the LED costs cannot leak into the two numbers about the network.
					let gap = last_push.map_or(0, |t| (now - t).as_micros() as u32);
					let assembled = frame_start.map_or(0, |t| (now - t).as_micros() as u32);
					stats.on_frame(gap, assembled, led);
					last_push = Some(now);
					frame_start = None;
				}
			}
			Either::First(Err(_)) => stats.bad += 1,
			Either::Second(_) => {
				let now = Instant::now();
				if stats.frames == 0 {
					leds.blank();
				}
				let line = stats.drain(
					(now - boot).as_secs(),
					(now - reported).as_millis(),
					frame.last_extent() / 3,
				);
				log::info!("{line}");
				if let Some(ep) = peer {
					let _ = socket.send_to(line.as_bytes(), ep).await;
				}
				reported = now;
				report_at = now + Duration::from_secs(1);
			}
		}
	}
}
