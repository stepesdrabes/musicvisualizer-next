//! What the board hears and what it says back.
//!
//! Nothing here knows which board it is on, or that Embassy exists: it is functions over bytes.
//! That is what lets `cargo test` run it on the host, which matters because two of these modules
//! emit strings that `apps/web/src/lib/hardware.ts` parses from the other end of the wire.

#![no_std]

pub mod ddp;
pub mod frame;
pub mod hello;
pub mod stats;
