const HEADER: usize = 10;
const VERSION_MASK: u8 = 0xc0;
const VERSION_1: u8 = 0x40;
const FLAG_PUSH: u8 = 0x01;
const TYPE_RGB24: u8 = 0x0b;

pub struct Packet<'a> {
	/// End of a frame. The sequence number never marks one: it counts packets, not frames.
	pub push: bool,
	/// 1..15, wrapping 15 -> 1. Zero means the sender is not tracking sequence.
	pub seq: u8,
	/// Byte offset into this device's own buffer, not into the host's global one.
	pub offset: usize,
	pub data: &'a [u8],
}

/// None for anything this firmware does not speak. The host only ever emits version-1 RGB24
/// with a 10 byte header, so a longer TIMECODE header is a reject rather than a parse.
pub fn parse(buf: &[u8]) -> Option<Packet<'_>> {
	if buf.len() < HEADER || buf[0] & VERSION_MASK != VERSION_1 || buf[2] != TYPE_RGB24 {
		return None;
	}

	let len = u16::from_be_bytes([buf[8], buf[9]]) as usize;
	if buf.len() < HEADER + len {
		return None;
	}

	Some(Packet {
		push: buf[0] & FLAG_PUSH != 0,
		seq: buf[1] & 0x0f,
		offset: u32::from_be_bytes([buf[4], buf[5], buf[6], buf[7]]) as usize,
		data: &buf[HEADER..HEADER + len],
	})
}

/// The sender wraps 15 -> 1 and never emits 0.
pub fn next_seq(seq: u8) -> u8 {
	if seq >= 15 { 1 } else { seq + 1 }
}
