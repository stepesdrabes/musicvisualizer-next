use embassy_rp::peripherals::{DMA_CH0, PIO0, USB};
use embassy_rp::pio::InterruptHandler as PioIrq;
use embassy_rp::usb::InterruptHandler as UsbIrq;
use embassy_rp::{bind_interrupts, dma};

#[cfg(feature = "frame")]
use embassy_rp::peripherals::{DMA_CH2, DMA_CH3, PIO1};

// Every DMA channel on the RP2040 raises DMA_IRQ_0, so the strips' two channels are extra
// handlers on the same vector rather than vectors of their own.
bind_interrupts!(pub struct Irqs {
	PIO0_IRQ_0 => PioIrq<PIO0>;
	#[cfg(feature = "frame")]
	PIO1_IRQ_0 => PioIrq<PIO1>;
	DMA_IRQ_0 => dma::InterruptHandler<DMA_CH0>,
		#[cfg(feature = "frame")] dma::InterruptHandler<DMA_CH2>,
		#[cfg(feature = "frame")] dma::InterruptHandler<DMA_CH3>;
	USBCTRL_IRQ => UsbIrq<USB>;
});
