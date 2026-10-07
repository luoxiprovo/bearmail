//! Frame layer of the BearMail edge tunnel.
//!
//! The bytes that follow the mutual-TLS handshake. This crate does not
//! terminate TLS, store mail, or link `store`. Port 9443 and the VM listener
//! lifecycle land with the VM binary.

#![forbid(unsafe_code)]

mod frame;
mod meter;
mod proxy;
mod relay;
mod session;

pub use frame::{Decoder, Frame, HELLO_PAIRS, MAX_DATA_PAYLOAD, MAX_FRAME_PAYLOAD, ProtocolError};
pub use meter::{Meter, NicCounter, PAUSE_AT, QuotaState, utc_year_month};
pub use proxy::{encode_proxy_v2, loopback_for, wants_proxy};
pub use relay::{VmOpts, serve_mac, serve_vm};
pub use session::{
    Admit, HelloOnce, IdWindow, MAX_CONNS, PING_INTERVAL, PONG_TIMEOUT, SessionGate, ping_interval,
    reconnect_delay, tunnel_dead,
};
