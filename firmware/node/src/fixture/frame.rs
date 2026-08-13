use embassy_futures::join::join;
use embassy_rp::Peripherals;
use embassy_rp::peripherals::PIO1;
use embassy_rp::pio::Pio;
use embassy_rp::pio_programs::ws2812::{Grb, PioWs2812, PioWs2812Program};
use embassy_time::Timer;
use smart_leds::RGB8;

use crate::board::Board;
use crate::irq::Irqs;

pub const KIND: &str = "ws2815";

/// Where the fixture is cut between the two data lines.
///
/// One line is 30 us per LED, so 720 pixels on one is 21.6 ms and the room caps near 46 fps. Two
/// lines written together fit inside a 16.7 ms frame with room to spare. The cut falls on a strip
/// boundary and is contiguous in this buffer - `Frame N + Frame E`, then `Frame S + Frame W +
/// Beam` - so the host sends one 720-pixel stream and the board slices it.
const LINE_A: usize = 300;
const LINE_B: usize = 420;

/// WS2815 wants 280 us of idle to latch and embassy's driver waits a private 55, which satisfies
/// the original WS2812B datasheet and nothing since. Below it, back-to-back frames merge and
/// colour walks down the strip. 1.7% of a frame, so the fix is free.
const LATCH_TOP_UP_US: u64 = 225;

/// The Frame: 3 x 2 m of WS2815 at 60 LED/m, every run facing the floor.
pub struct Fixture {
	a: PioWs2812<'static, PIO1, 0, LINE_A, Grb>,
	b: PioWs2812<'static, PIO1, 1, LINE_B, Grb>,
	buf_a: [RGB8; LINE_A],
	buf_b: [RGB8; LINE_B],
}

impl Fixture {
	pub const KIND: &'static str = KIND;
	pub const HOSTNAME: &'static str = "room-frame";
	pub const PIXELS: usize = LINE_A + LINE_B;
	pub const BYTES: usize = Self::PIXELS * 3;

	/// GP2 and GP3 for data, through a level shifter: the Pico drives 3.3 V and WS2815 wants its
	/// logic high referenced to 5 V. Without one the strip usually works, which is worse than
	/// failing - it fails later, intermittently, and looks like a network fault.
	pub fn claim(p: Peripherals) -> (Self, Board) {
		let mut pio = Pio::new(p.PIO1, Irqs);
		let program = PioWs2812Program::new(&mut pio.common);

		let fixture = Self {
			a: PioWs2812::new(&mut pio.common, pio.sm0, p.DMA_CH2, Irqs, p.PIN_2, &program),
			b: PioWs2812::new(&mut pio.common, pio.sm1, p.DMA_CH3, Irqs, p.PIN_3, &program),
			buf_a: [RGB8::default(); LINE_A],
			buf_b: [RGB8::default(); LINE_B],
		};

		let board = Board {
			usb: p.USB,
			pio: p.PIO0,
			dma: p.DMA_CH0,
			pwr: p.PIN_23,
			cs: p.PIN_25,
			dio: p.PIN_24,
			clk: p.PIN_29,
		};
		(fixture, board)
	}

	/// Which physical run is which, before the radio: line A red, line B green, then one pixel
	/// travelling each so a break shows where it stops. The firmware cannot answer either
	/// question and a wrong answer looks exactly like a wrong show.
	pub async fn selftest(&mut self) {
		for (r, g) in [(80u8, 0u8), (0, 80)] {
			self.buf_a.fill(RGB8 { r, g, b: 0 });
			self.buf_b.fill(RGB8 { r: g, g: r, b: 0 });
			self.write().await;
			Timer::after_millis(500).await;
		}

		let steps = 24;
		for step in 0..=steps {
			self.buf_a.fill(RGB8::default());
			self.buf_b.fill(RGB8::default());
			self.buf_a[step * (LINE_A - 1) / steps] = RGB8 { r: 90, g: 90, b: 90 };
			self.buf_b[step * (LINE_B - 1) / steps] = RGB8 { r: 90, g: 90, b: 90 };
			self.write().await;
			Timer::after_millis(30).await;
		}
		self.blank().await;
	}

	/// Bytes straight from the wire. The host owns gamma, so nothing here rescales them.
	pub async fn present(&mut self, pixels: &[u8]) {
		unpack(&pixels[..pixels.len().min(LINE_A * 3)], &mut self.buf_a);
		unpack(pixels.get(LINE_A * 3..).unwrap_or_default(), &mut self.buf_b);
		self.write().await;
	}

	/// A second with no frame in it. Without this the strips hold the last frame of a stopped show
	/// for as long as the board has power, which looks exactly like one still running.
	pub async fn blank(&mut self) {
		self.buf_a.fill(RGB8::default());
		self.buf_b.fill(RGB8::default());
		self.write().await;
	}

	/// Both lines together. Awaiting them one after the other costs the sum however many state
	/// machines are involved, which is 25 fps at this length.
	async fn write(&mut self) {
		join(self.a.write(&self.buf_a), self.b.write(&self.buf_b)).await;
		Timer::after_micros(LATCH_TOP_UP_US).await;
	}
}

/// RGB triples into the driver's colour type, zeroing whatever the frame did not cover.
fn unpack<const N: usize>(bytes: &[u8], out: &mut [RGB8; N]) {
	let lit = bytes.len() / 3;
	for (i, px) in out.iter_mut().enumerate() {
		*px = if i < lit {
			RGB8 { r: bytes[i * 3], g: bytes[i * 3 + 1], b: bytes[i * 3 + 2] }
		} else {
			RGB8::default()
		};
	}
}
