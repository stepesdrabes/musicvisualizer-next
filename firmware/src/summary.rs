//! The whole room reduced to one colour and one brightness.
//!
//! Any output that is not the strips themselves shows exactly this, so the reduction lives
//! apart from whatever is being lit with it: what a frame looked like is one question, and how
//! a particular fixture says so is another.

/// Which pixel of the room stands for how bright it looks: the 90th percentile of `max(r,g,b)`,
/// so a tenth of the fixture is above it.
///
/// A room is not as bright as its average. Half the fixture lit at full reads as a bright room
/// and an average over the dark half calls it half lit, which is the error a single emitter
/// cannot afford to make when it is standing in for all 1320. Measured on an engine show, this
/// puts a drop at 0.90 of perceived brightness, a groove at 0.66, an intro at 0.28 and a void
/// at 0.00.
const BRIGHT_PERCENTILE: u32 = 90;

pub struct Summary {
	/// Channel ratios with the largest pinned at full scale, so hue and saturation are exactly
	/// as they arrived on the wire and only [`Summary::level`] moves.
	pub rgb: [u16; 3],
	/// Perceived brightness, full scale being a room at 255. Zero does not mean the room is
	/// dark: see [`Summary::lit`].
	pub level: u16,
}

impl Summary {
	pub const DARK: Self = Self { rgb: [0; 3], level: 0 };

	/// Whether the frame carried any light at all, which is not the same question as whether
	/// [`Summary::level`] is above zero.
	///
	/// The percentile needs a tenth of the pixels lit before it can report anything, so an
	/// effect covering less of the room than that reads as a level of zero while the room is
	/// plainly still lit. A fixture that blacked out on those frames would be blinking at a
	/// threshold rather than at the show, so the two cases have to be told apart. Ratios are
	/// pinned with the largest channel at full scale, so this is zero only for a black frame.
	pub fn lit(&self) -> bool {
		self.rgb[0].max(self.rgb[1]).max(self.rgb[2]) > 0
	}
}

/// How white a set of ratios is: the smallest channel, which with the largest pinned at full
/// scale is `1 - saturation`. Full scale means no hue at all.
///
/// A free function rather than a method on [`Summary`] because an output following the colour
/// over time asks this of what it is showing rather than of what just arrived, and the answer
/// only means anything under the pinning convention this module defines.
pub fn achroma(rgb: &[u16; 3]) -> u16 {
	rgb[0].min(rgb[1]).min(rgb[2])
}

/// Summarise the frame that is about to be presented.
///
/// Colour is the room's mean, already weighted by brightness because a dark pixel adds nothing
/// to a sum. Brightness is [`BRIGHT_PERCENTILE`] of `max(r,g,b)`, straight through with no gain
/// of its own.
///
/// Nothing rescales that here on purpose. The mixer auto-exposes at track scale, holds a house
/// floor under every cue and compresses its own highlights, so the level arriving on the wire is
/// already the level the room is meant to sit at. A second gain on the board can only measure
/// the show against itself, and normalising against the loudest frame of the last half minute
/// leaves every other frame below it by construction - which is a room that reads bright on
/// screen and dim on the wall.
pub fn of(rgb: &[u8]) -> Summary {
	let n = (rgb.len() / 3) as u32;
	if n == 0 {
		return Summary::DARK;
	}

	let mut sum = [0u32; 3];
	// One pass and 512 bytes, where a percentile would otherwise want a sort. The room is at
	// most 1320 pixels, so a bin cannot overflow u16.
	let mut hist = [0u16; 256];
	for px in rgb.chunks_exact(3) {
		sum[0] += px[0] as u32;
		sum[1] += px[1] as u32;
		sum[2] += px[2] as u32;
		hist[px[0].max(px[1]).max(px[2]) as usize] += 1;
	}

	// How many pixels sit at or above the percentile, rounded up so a mostly dark room cannot
	// satisfy it with nothing.
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

	// Only a frame with no light anywhere is dark. A frame the percentile could not reach still
	// has a colour, and reporting it with a level of zero is what lets a fixture hold its floor
	// through a sparse effect instead of blacking out at a threshold.
	let top = sum[0].max(sum[1]).max(sum[2]);
	if top == 0 {
		return Summary::DARK;
	}

	let mut ratio = [0u16; 3];
	for (c, r) in ratio.iter_mut().enumerate() {
		// Dividing the mean by its own largest channel leaves the ratios between them exactly
		// as they arrived, so hue and saturation survive and only the level moves.
		*r = (sum[c] as u64 * u16::MAX as u64 / top as u64) as u16;
	}

	// 255 * 257 is exactly full scale, so a saturated room reaches the top of the range.
	Summary { rgb: ratio, level: (level * 257) as u16 }
}

/// A ratio from a [`Summary`] taken to a PWM compare value under an output's own ceiling.
///
/// `trim` is per-channel wiring correction with 256 for unity, applied last so it can only pull
/// a channel down out of a value that already carries the show's own level.
pub fn scale(ratio: u16, duty: u32, trim: u32) -> u16 {
	let v = ratio as u64 * duty as u64 / u16::MAX as u64;
	((v * trim as u64) >> 8).min(u16::MAX as u64) as u16
}
