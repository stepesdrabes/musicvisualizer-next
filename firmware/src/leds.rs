use embassy_rp::Peri;
use embassy_rp::peripherals::{
	PIN_18, PIN_19, PIN_20, PIN_26, PIN_27, PIN_28, PWM_SLICE1, PWM_SLICE2, PWM_SLICE5, PWM_SLICE6,
};
use embassy_rp::pwm::{Config as PwmConfig, Pwm};
use embassy_time::Timer;
use embedded_hal::pwm::SetDutyCycle;

/// What this build actually does with a frame, reported in the discovery answer so a host can
/// say so rather than implying the room is lit. Becomes `ws2815` when the strips are driven.
pub const LED_KIND: &str = "monitor";

/// Which pixel of the room stands for how bright it looks: the 90th percentile of
/// `max(r,g,b)`, so a tenth of the fixture is above it.
///
/// A room is not as bright as its average. Half the fixture lit at full reads as a bright room
/// and an average over the dark half calls it half lit, which is the error a single LED cannot
/// afford to make when it is standing in for all 1320. Measured on an engine show, this puts a
/// drop at 0.90 of perceived brightness, a groove at 0.66, an intro at 0.28 and a void at 0.00.
const BRIGHT_PERCENTILE: u32 = 90;

/// Duty a full-scale room gets, out of 65535.
///
/// The room and this LED are not the same instrument. A wall of 1320 diffused pixels seen
/// across a room is a wash; a 5 mm die seen from a desk is a point source, and past a few
/// milliamps it stops reading as a colour and starts reading as glare - white, whatever it is
/// emitting, because the cones under that small an angle saturate. That takes the top of the
/// range away and flattens everything below it into the same bright smear.
///
/// So the ceiling is a property of the fixture, not of the show, and it is the one place a
/// constant belongs. Raise it if the LED is dim, lower it if bright sections stop being
/// distinguishable from each other. A diffuser over the dome buys more of it than any value
/// here does, because it is the angular size that causes the glare.
const MAX_DUTY: u32 = 16384;

/// Per-channel scale for the wiring, 256 being unity.
///
/// Red drops 1.3 V across its series resistor where green and blue have barely 0.2 V to give,
/// so equal duty is never equal light on a bare RGB LED run from 3.3 V. Trim against a full
/// white frame by pulling whichever colour dominates down, not by pushing the others up: the
/// two weak channels have no headroom left to find.
const TRIM: [u32; 3] = [256, 256, 256];

/// Two RGB LEDs standing in for the whole fixture, so the DDP path can be judged before there
/// are any strips to judge it with.
///
/// Both show the same colour, which is the point rather than a simplification. Brightness is
/// total flux and glare is flux per unit of solid angle, so two emitters at the same current
/// are twice the light with none of the whitening that comes from driving one of them harder.
/// Spread them apart, or put them behind one diffuser, and the gain is real.
///
/// Common cathode to GND, one series resistor per colour:
///
/// ```text
///   LED 1   R GP18   G GP19   B GP20     physical 24, 25, 26, ground at 23
///   LED 2   R GP26   G GP27   B GP28     physical 31, 32, 34
/// ```
///
/// Each LED takes one slice for red and green on channels A and B, plus channel A of a second
/// slice for blue. None of that is contended: cyw43 holds PIO0 SM0, DMA_CH0 and GPIO 23, 24,
/// 25 and 29, and wants no PWM at all. A second LED that is not fitted costs nothing but two
/// idle slices, so this drives six channels whether or not both are there.
pub struct LedOutput {
	/// Red on channel A, green on channel B, one slice per LED.
	rg: [Pwm<'static>; 2],
	/// Blue, which needs a slice of its own because the pair above is spoken for.
	blue: [Pwm<'static>; 2],
	last: (u16, u16, u16),
}

impl LedOutput {
	#[allow(clippy::too_many_arguments)]
	pub fn new(
		slice_rg1: Peri<'static, PWM_SLICE1>,
		r1: Peri<'static, PIN_18>,
		g1: Peri<'static, PIN_19>,
		slice_b1: Peri<'static, PWM_SLICE2>,
		b1: Peri<'static, PIN_20>,
		slice_rg2: Peri<'static, PWM_SLICE5>,
		r2: Peri<'static, PIN_26>,
		g2: Peri<'static, PIN_27>,
		slice_b2: Peri<'static, PWM_SLICE6>,
		b2: Peri<'static, PIN_28>,
	) -> Self {
		// Default top and divider are 16 bits at 125 MHz / 65536, about 1.9 kHz. Far enough
		// above the eye not to flicker and nowhere near 60 Hz, so it cannot beat with the
		// frame rate and invent a throb that is not in the show.
		let cfg = PwmConfig::default();
		Self {
			rg: [
				Pwm::new_output_ab(slice_rg1, r1, g1, cfg.clone()),
				Pwm::new_output_ab(slice_rg2, r2, g2, cfg.clone()),
			],
			blue: [
				Pwm::new_output_a(slice_b1, b1, cfg.clone()),
				Pwm::new_output_a(slice_b2, b2, cfg),
			],
			// Matches the zero compare the config above starts at, so the first real write is
			// never skipped as a no-op.
			last: (0, 0, 0),
		}
	}

	/// Summarise the frame that is about to be presented, and show it.
	///
	/// Colour is the room's mean, already weighted by brightness because a dark pixel adds
	/// nothing to a sum. Brightness is [`BRIGHT_PERCENTILE`] of `max(r,g,b)`, straight through
	/// with no gain of its own.
	///
	/// Nothing rescales that here on purpose. The mixer auto-exposes at track scale, holds a
	/// house floor under every cue and compresses its own highlights, so the level arriving on
	/// the wire is already the level the room is meant to sit at. A second gain on the board
	/// can only measure the show against itself, and normalising against the loudest frame of
	/// the last half minute leaves every other frame below it by construction - which is a
	/// room that reads bright on screen and dim on the LED.
	///
	/// Async because the real implementation waits on DMA, and keeping the signature now means
	/// the receive loop does not change when it lands.
	pub async fn present(&mut self, rgb: &[u8]) {
		let n = (rgb.len() / 3) as u32;
		if n == 0 {
			self.write(0, 0, 0);
			return;
		}

		let mut sum = [0u32; 3];
		// One pass and 512 bytes, where a percentile would otherwise want a sort. The room is
		// at most 1320 pixels, so a bin cannot overflow u16.
		let mut hist = [0u16; 256];
		for px in rgb.chunks_exact(3) {
			sum[0] += px[0] as u32;
			sum[1] += px[1] as u32;
			sum[2] += px[2] as u32;
			hist[px[0].max(px[1]).max(px[2]) as usize] += 1;
		}

		// How many pixels sit at or above the percentile, rounded up so a mostly dark room
		// cannot satisfy it with nothing.
		let want = (n * (100 - BRIGHT_PERCENTILE)).div_ceil(100).max(1);
		let mut seen = 0u32;
		let mut level = 0u32;
		for v in (1..256).rev() {
			seen += hist[v] as u32;
			if seen >= want {
				level = v as u32;
				break;
			}
		}

		let top = sum[0].max(sum[1]).max(sum[2]);
		if top == 0 || level == 0 {
			self.write(0, 0, 0);
			return;
		}

		// Duty proportional to the light the strips would emit, which is what puts the LED's
		// perceived brightness on the same curve as the room's, under the fixture's own ceiling.
		let duty = level * MAX_DUTY / 255;

		let mut out = [0u16; 3];
		for c in 0..3 {
			// Dividing the mean by its own largest channel leaves the ratios between them
			// exactly as they arrived, so hue and saturation survive and only the level moves.
			let v = sum[c] as u64 * duty as u64 / top as u64;
			out[c] = ((v * TRIM[c] as u64) >> 8).min(u16::MAX as u64) as u16;
		}
		self.write(out[0], out[1], out[2]);
	}

	/// Red, then green, then blue, half a second each, before the radio is even up.
	///
	/// Which leg of an RGB LED is which is not something the firmware can discover, and a
	/// swapped pair is indistinguishable from the show being wrong: both look like the right
	/// light at the wrong time in the wrong colour. This separates them. If the order that
	/// lights is not red, green, blue, the fault is in the wiring and nothing further up is
	/// worth reading. It runs before the join so a board stuck retrying still shows it.
	pub async fn selftest(&mut self) {
		for (r, g, b) in [(u16::MAX, 0, 0), (0, u16::MAX, 0), (0, 0, u16::MAX)] {
			self.write(r, g, b);
			Timer::after_millis(500).await;
		}
		self.write(0, 0, 0);
	}

	/// A second with no frame in it. Without this the LED holds the last frame of a stopped
	/// show for as long as the board has power, which looks exactly like one still running.
	pub fn blank(&mut self) {
		self.write(0, 0, 0);
	}

	/// Compare registers only.
	///
	/// `set_config` would have done, and it rewrote the divider, the wrap and the control
	/// register on both slices sixty times a second to deliver three numbers that mostly had
	/// not changed. Touching only the compare leaves the running counter alone, which is the
	/// one thing that must not be disturbed mid-period for the output to stay clean.
	fn write(&mut self, r: u16, g: u16, b: u16) {
		if (r, g, b) == self.last {
			return;
		}
		self.last = (r, g, b);

		for pair in &mut self.rg {
			let (chan_r, chan_g) = pair.split_by_ref();
			if let Some(mut c) = chan_r {
				let _ = c.set_duty_cycle(r);
			}
			if let Some(mut c) = chan_g {
				let _ = c.set_duty_cycle(g);
			}
		}
		for single in &mut self.blue {
			if let Some(mut c) = single.split_by_ref().0 {
				let _ = c.set_duty_cycle(b);
			}
		}
	}
}
