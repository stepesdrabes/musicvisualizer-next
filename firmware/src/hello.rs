use core::fmt::Write;

use heapless::String;

use crate::config::{DDP_PORT, HOSTNAME, MAX_PIXELS, STATS_PORT};
use crate::lamp;

/// A leading `?` cannot be mistaken for DDP. Version 1 puts `0b01` in the top two bits of the
/// first byte and `?` is `0x3f`, so the parser and this can never both claim a datagram.
const QUERY: &[u8] = b"?room-node";

pub const LINE_CAP: usize = 128;

pub fn is_query(buf: &[u8]) -> bool {
	buf.starts_with(QUERY)
}

/// Identity and capability, answered on the asker's own port.
///
/// The once-a-second stats stream only goes to whoever is already sending DDP, so without this
/// a host has no way to tell a wrong address from an unplugged board until it starts streaming
/// at the room. Each kind is read from its own output module rather than written here, so the
/// day the strips are actually driven the answer changes with them. The host reads `leds` as a
/// `+`-separated list and asks whether any kind in it emits, so a build with a second output
/// joins them rather than picking one.
pub fn line(uptime_s: u64) -> String<LINE_CAP> {
	let mut s = String::new();
	let _ = write!(
		s,
		"room-node host {} fw {} up {}s px {} ddp {} stats {} leds {}",
		HOSTNAME,
		env!("CARGO_PKG_VERSION"),
		uptime_s,
		MAX_PIXELS,
		DDP_PORT,
		STATS_PORT,
		lamp::KIND
	);
	s
}
