//! What this board drives, which is the one thing the two builds differ by.
//!
//! Both variants expose the same surface - `KIND`, `HOSTNAME`, `PIXELS`, `claim`, `selftest`,
//! `present`, `blank` - so nothing above this module branches on which one was linked in.
//! `claim` takes the whole `Peripherals` and hands back what it did not want as a [`Board`],
//! which is what makes the pin budget a compile error rather than a comment.
//!
//! [`Board`]: crate::board::Board

#[cfg(all(feature = "frame", feature = "bounce"))]
compile_error!("one fixture per binary: build with --features frame or --features bounce");
#[cfg(not(any(feature = "frame", feature = "bounce")))]
compile_error!("no fixture selected: build with --features frame or --features bounce");

#[cfg(feature = "bounce")]
mod bounce;
#[cfg(feature = "frame")]
mod frame;

#[cfg(feature = "bounce")]
pub use bounce::Fixture;
#[cfg(feature = "frame")]
pub use frame::Fixture;
