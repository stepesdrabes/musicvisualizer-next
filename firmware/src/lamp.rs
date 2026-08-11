use embassy_rp::Peri;
use embassy_rp::peripherals::{PIN_6, PIN_7, PIN_8, PIN_9, PWM_SLICE3, PWM_SLICE4};
use embassy_rp::pwm::{Config as PwmConfig, Pwm};
use embassy_time::Timer;
use embedded_hal::pwm::SetDutyCycle;

use crate::summary::{Summary, scale};

/// What this output does with a frame, reported in the discovery answer beside every other
/// output the build has.
pub const KIND: &str = "lamp";

/// Duty a full-scale room gets, out of 65535.
///
/// Full scale, because nothing about this fixture argues for less. A small emitter seen from a
/// desk has to be held well under its maximum, since past a few milliamps it stops reading as a
/// colour and starts reading as glare; a diffused strip seen across a room is a wash, and its
/// ceiling is simply its own maximum.
///
/// Pull it down if the strip is uncomfortable outside the housing it came from, or if the
/// supply cannot hold 12 V through a white frame.
const MAX_DUTY: u32 = 65535;

/// Per-channel scale for the fixture, 256 being unity.
///
/// White is the channel that needs it, and this strip is a bad case: two phosphor emitters to
/// every RGB package and each of them brighter than a single die, so the white channel outruns
/// the other three several times over and equal duty is nowhere near equal light. Left at unity
/// it swamps every desaturated colour and the lamp reads as a warm bulb rather than as the room,
/// which the warm phosphor against an RGB white point near 6000 K only makes worse.
///
/// A quarter is a starting point, not a measurement. The last two steps of [`Lamp::selftest`]
/// are the measurement: full R+G+B, then full W, at raw duty with no trim applied, so what is
/// being compared is exactly the hardware imbalance this cancels. Set this near the ratio
/// between them and **err low** - too little white costs a washed out frame some punch, where
/// too much destroys the hue of every pastel in the show.
///
/// It is also where the current limit lives. Additive white lights all four channels at once,
/// which is the most this strip can draw; measure it on a full white frame before leaving the
/// lamp running unattended. Pull white down rather than the other three, which carry the
/// show's colour where this one only carries how washed out it is.
const TRIM: [u32; 4] = [256, 256, 256, 64];

/// An analog RGBW strip on four MOSFET gates, which is the whole room reduced to one colour.
///
/// Every LED on the strip shows the same thing, so this is a one-pixel fixture: it carries
/// colour, level and timing, and nothing a show says by moving light across a room. Hence the
/// [`Summary`] rather than the frame.
///
/// Common anode at 12 V, one low-side switch per channel:
///
/// ```text
///   R GP6   G GP7   B GP8   W GP9     physical 9, 10, 11, 12, ground at 13
/// ```
///
/// Slices 3 and 4, which nothing else wants: cyw43 holds PIO0 SM0, DMA_CH0 and GPIO 23, 24, 25
/// and 29, and wants no PWM at all.
pub struct Lamp {
	/// Red on channel A, green on channel B.
	rg: Pwm<'static>,
	/// Blue on channel A, white on channel B.
	bw: Pwm<'static>,
	last: (u16, u16, u16, u16),
}

impl Lamp {
	pub fn new(
		slice_rg: Peri<'static, PWM_SLICE3>,
		r: Peri<'static, PIN_6>,
		g: Peri<'static, PIN_7>,
		slice_bw: Peri<'static, PWM_SLICE4>,
		b: Peri<'static, PIN_8>,
		w: Peri<'static, PIN_9>,
	) -> Self {
		// Default top and divider are 16 bits at 125 MHz / 65536, about 1.9 kHz. Far enough above
		// the eye not to flicker and nowhere near 60 Hz, so it cannot beat with the frame rate
		// and invent a throb that is not in the show. If low duty cycles read non-linear or the
		// lamp will not go fully dark, suspect the RC slew limiter on each gate and lower this
		// rather than reaching for TRIM.
		let cfg = PwmConfig::default();
		Self {
			rg: Pwm::new_output_ab(slice_rg, r, g, cfg.clone()),
			bw: Pwm::new_output_ab(slice_bw, b, w, cfg),
			// Matches the zero compare the config above starts at, so the first real write is
			// never skipped as a no-op.
			last: (0, 0, 0, 0),
		}
	}

	/// Show a summarised frame.
	///
	/// White is the frame's achromatic part added to the colour rather than subtracted from it.
	/// Subtracting is the textbook conversion and more efficient, but it only holds when the
	/// white emitter shares a white point with the RGB mix, and a warm phosphor against a 6000 K
	/// mix does not: every mid-saturation colour would shift toward the white LED's own tint.
	/// Adding cannot shift a hue, because a saturated frame has no achromatic part to add.
	pub fn present(&mut self, s: &Summary) {
		let duty = s.level as u32 * MAX_DUTY / u16::MAX as u32;
		self.write(
			scale(s.rgb[0], duty, TRIM[0]),
			scale(s.rgb[1], duty, TRIM[1]),
			scale(s.rgb[2], duty, TRIM[2]),
			scale(s.achroma(), duty, TRIM[3]),
		);
	}

	/// Red, green, blue, then both whites, half a second each, before the radio is even up.
	///
	/// The first three answer a question the firmware cannot: which gate is which channel. A
	/// swapped pair is indistinguishable from the show being wrong, because both look like the
	/// right light at the wrong time in the wrong colour, and if the order that lights is not
	/// red, green, blue then the fault is in the four wires and nothing further up is worth
	/// reading. It runs before the join so a board stuck retrying still shows it.
	///
	/// The last two are the [`TRIM`] measurement, and they are adjacent so the eye can compare
	/// them: **R+G+B together, then W alone**, the white the colour dies make against the white
	/// the phosphor emitters make. Raw duty with no trim applied, because trim is what the
	/// difference between them is for, and because a badly wrong trim must not be able to hide a
	/// wiring fault.
	pub async fn selftest(&mut self) {
		const ON: u16 = u16::MAX;
		for (r, g, b, w) in
			[(ON, 0, 0, 0), (0, ON, 0, 0), (0, 0, ON, 0), (ON, ON, ON, 0), (0, 0, 0, ON)]
		{
			self.write(r, g, b, w);
			Timer::after_millis(500).await;
		}
		self.write(0, 0, 0, 0);
	}

	/// A second with no frame in it. Without this the lamp holds the last frame of a stopped
	/// show for as long as the board has power, which looks exactly like one still running.
	pub fn blank(&mut self) {
		self.write(0, 0, 0, 0);
	}

	/// Compare registers only, leaving the running counter alone so the output stays clean
	/// across a mid-period change.
	fn write(&mut self, r: u16, g: u16, b: u16, w: u16) {
		if (r, g, b, w) == self.last {
			return;
		}
		self.last = (r, g, b, w);

		let (chan_r, chan_g) = self.rg.split_by_ref();
		if let Some(mut c) = chan_r {
			let _ = c.set_duty_cycle(r);
		}
		if let Some(mut c) = chan_g {
			let _ = c.set_duty_cycle(g);
		}

		let (chan_b, chan_w) = self.bw.split_by_ref();
		if let Some(mut c) = chan_b {
			let _ = c.set_duty_cycle(b);
		}
		if let Some(mut c) = chan_w {
			let _ = c.set_duty_cycle(w);
		}
	}
}
