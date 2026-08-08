use crate::config::FRAME_BYTES;
use crate::ddp::Packet;

pub struct Frame {
	buf: [u8; FRAME_BYTES],
	covered: usize,
	extent: usize,
	last_extent: usize,
}

impl Frame {
	pub const fn new() -> Self {
		Self { buf: [0; FRAME_BYTES], covered: 0, extent: 0, last_extent: 0 }
	}

	/// False when the packet addresses past the end of the buffer, which means the host is
	/// driving more pixels than this build holds.
	pub fn apply(&mut self, p: &Packet<'_>) -> bool {
		let end = p.offset + p.data.len();
		if end > FRAME_BYTES {
			return false;
		}

		self.buf[p.offset..end].copy_from_slice(p.data);
		self.covered += p.data.len();
		if end > self.extent {
			self.extent = end;
		}
		true
	}

	/// Gamma-corrected PWM bytes in strip order. The host owns gamma, so these reach the strips
	/// untouched. Only meaningful before the frame is closed.
	pub fn pixels(&self) -> &[u8] {
		&self.buf[..self.extent]
	}

	/// Closes the frame on PUSH. False means bytes below the frame's own extent never arrived,
	/// which is a dropped middle packet. Both counters are per frame rather than high-water
	/// marks, so changing how the host splits the fixture does not leave every later frame
	/// looking torn.
	pub fn close(&mut self) -> bool {
		let whole = self.covered == self.extent;
		self.last_extent = self.extent;
		self.covered = 0;
		self.extent = 0;
		whole
	}

	pub fn last_extent(&self) -> usize {
		self.last_extent
	}
}
