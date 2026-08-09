use core::fmt::{Display, Formatter, Result, Write};

use heapless::String;

pub const LINE_CAP: usize = 192;

/// Counters for one report interval. Everything is integer arithmetic so the binary carries no
/// soft-float, and the receive loop never formats.
pub struct Stats {
	pub packets: u32,
	pub bytes: u32,
	pub frames: u32,
	pub seq_gaps: u32,
	pub bad: u32,
	pub out_of_range: u32,
	pub torn: u32,
	gap_min_us: u32,
	gap_max_us: u32,
	asm_max_us: u32,
	led_max_us: u32,
	late: [u32; 3],
}

impl Stats {
	pub const fn new() -> Self {
		Self {
			packets: 0,
			bytes: 0,
			frames: 0,
			seq_gaps: 0,
			bad: 0,
			out_of_range: 0,
			torn: 0,
			gap_min_us: u32::MAX,
			gap_max_us: 0,
			asm_max_us: 0,
			led_max_us: 0,
			late: [0; 3],
		}
	}

	/// `gap_us` is PUSH to PUSH, `asm_us` is first packet of the frame to its PUSH, `led_us` is
	/// how long presenting it took. The last is here because everything else on this line is a
	/// measurement of the network, and it is the only part of the budget the board itself
	/// spends: if it ever approaches the 16.7 ms frame, the numbers beside it stop being about
	/// the radio.
	pub fn on_frame(&mut self, gap_us: u32, asm_us: u32, led_us: u32) {
		self.frames += 1;
		self.gap_min_us = self.gap_min_us.min(gap_us);
		self.gap_max_us = self.gap_max_us.max(gap_us);
		self.asm_max_us = self.asm_max_us.max(asm_us);
		self.led_max_us = self.led_max_us.max(led_us);

		// A max on its own cannot tell one stumble apart from constant stutter, and 16.7 ms is
		// the frame budget these are placed around.
		match gap_us {
			g if g > 100_000 => self.late[2] += 1,
			g if g > 50_000 => self.late[1] += 1,
			g if g > 20_000 => self.late[0] += 1,
			_ => {}
		}
	}

	/// One line for both the console and the stats datagram, resetting the interval counters.
	pub fn drain(&mut self, uptime_s: u64, elapsed_ms: u64, pixels: usize) -> String<LINE_CAP> {
		let ms = elapsed_ms.max(1);
		let gap_min = if self.frames == 0 { 0 } else { self.gap_min_us };

		let mut line = String::new();
		let _ = write!(
			line,
			"up {}s  {} px  {} pkt/s  {} KB/s  {} fps  gap {}/{} ms  late {}/{}/{}  asm {} ms  \
			 led {} us  seqgap {}  bad {}  oob {}  torn {}",
			uptime_s,
			pixels,
			self.packets as u64 * 1000 / ms,
			tenths(self.bytes as u64 * 1000 / 1024, ms),
			tenths(self.frames as u64 * 1000, ms),
			Tenths(gap_min / 100),
			Tenths(self.gap_max_us / 100),
			self.late[0],
			self.late[1],
			self.late[2],
			Tenths(self.asm_max_us / 100),
			self.led_max_us,
			self.seq_gaps,
			self.bad,
			self.out_of_range,
			self.torn
		);

		*self = Self::new();
		line
	}
}

struct Tenths(u32);

impl Display for Tenths {
	fn fmt(&self, f: &mut Formatter<'_>) -> Result {
		write!(f, "{}.{}", self.0 / 10, self.0 % 10)
	}
}

fn tenths(n: u64, d: u64) -> Tenths {
	Tenths((n * 10 / d) as u32)
}
