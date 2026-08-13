use embassy_rp::Peri;
use embassy_rp::peripherals::{DMA_CH0, PIN_23, PIN_24, PIN_25, PIN_29, PIO0, USB};

/// Everything the radio and the console need, which is everything the fixture did not take.
///
/// The split is fixed by cyw43 taking the first of everything: PIO0 SM0, DMA_CH0 and GPIO 23, 24,
/// 25 and 29, and no PWM at all. Handing these back from `fixture::claim` is what makes the pin
/// budget a compile error rather than a comment.
pub struct Board {
	pub usb: Peri<'static, USB>,
	pub pio: Peri<'static, PIO0>,
	pub dma: Peri<'static, DMA_CH0>,
	pub pwr: Peri<'static, PIN_23>,
	pub cs: Peri<'static, PIN_25>,
	pub dio: Peri<'static, PIN_24>,
	pub clk: Peri<'static, PIN_29>,
}
