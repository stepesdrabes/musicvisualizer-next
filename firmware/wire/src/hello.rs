use core::fmt::Write;

use heapless::String;

/// A leading `?` cannot be mistaken for DDP. Version 1 puts `0b01` in the top two bits of the
/// first byte and `?` is `0x3f`, so the parser and this can never both claim a datagram.
const QUERY: &[u8] = b"?room-node";

pub const LINE_CAP: usize = 128;

/// What a board says it is. Every field comes from the binary rather than from here, so this
/// crate stays ignorant of which board it was linked into.
pub struct Identity<'a> {
	pub hostname: &'a str,
	pub firmware: &'a str,
	pub pixels: usize,
	pub ddp_port: u16,
	pub stats_port: u16,
	/// What each output does with a frame, `+`-separated. The host reads it as a list and asks
	/// whether any kind in it emits, so a build with a second output joins them rather than
	/// picking one.
	pub leds: &'a str,
}

pub fn is_query(buf: &[u8]) -> bool {
	buf.starts_with(QUERY)
}

/// Identity and capability, answered on the asker's own port.
///
/// The once-a-second stats stream only goes to whoever is already sending DDP, so without this a
/// host has no way to tell a wrong address from an unplugged board until it starts streaming at
/// the room. `room-node` leads the line as the magic that says the answer is ours.
pub fn line(id: &Identity<'_>, uptime_s: u64) -> String<LINE_CAP> {
	let mut s = String::new();
	let _ = write!(
		s,
		"room-node host {} fw {} up {}s px {} ddp {} stats {} leds {}",
		id.hostname, id.firmware, uptime_s, id.pixels, id.ddp_port, id.stats_port, id.leds
	);
	s
}

#[cfg(test)]
mod tests {
	use super::*;

	const FRAME: Identity<'static> = Identity {
		hostname: "room-frame",
		firmware: "0.1.0",
		pixels: 720,
		ddp_port: 4048,
		stats_port: 4049,
		leds: "ws2815",
	};

	/// Pinned to the exact string `parseIdentity` in apps/web reads, which is tested there against
	/// the same text. The two sides of this contract are each other's spec.
	#[test]
	fn formats_the_line_the_app_parses() {
		assert_eq!(
			line(&FRAME, 42).as_str(),
			"room-node host room-frame fw 0.1.0 up 42s px 720 ddp 4048 stats 4049 leds ws2815"
		);
	}

	#[test]
	fn joins_several_outputs_rather_than_naming_one() {
		let both = Identity { leds: "monitor+lamp", ..FRAME };
		assert!(line(&both, 0).as_str().ends_with("leds monitor+lamp"));
	}

	#[test]
	fn answers_only_its_own_query() {
		assert!(is_query(b"?room-node"));
		assert!(is_query(b"?room-node\n"));
		assert!(!is_query(b"?something-else"));
		// A DDP version-1 header, which must never be mistaken for a query.
		assert!(!is_query(&[0x41, 1, 0x0b, 1, 0, 0, 0, 0, 0, 3]));
	}
}
