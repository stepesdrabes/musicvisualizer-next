/// What this build actually does with a frame, reported in the discovery answer so a host can
/// say so rather than implying the room is lit. Becomes `ws2812` when the strips are driven.
pub const LED_KIND: &str = "stub";

/// Stub until the strips are wired.
///
/// The real path drives WS2812 from PIO1 SM0..SM3 with DMA_CH2..CH5: cyw43 already holds PIO0
/// SM0 and DMA_CH0, and one 800 kHz line costs 30 us per LED, so 60 fps caps a single line at
/// about 555 pixels and the 1320 of the room need at least three lines awaited together.
pub struct LedOutput;

impl LedOutput {
	pub const fn new() -> Self {
		Self
	}

	/// Async because the real implementation waits on DMA, and keeping the signature now means
	/// the receive loop does not change when it lands.
	pub async fn present(&mut self, _rgb: &[u8]) {}
}
