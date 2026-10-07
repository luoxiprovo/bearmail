//! Big-endian length-prefixed frames. A bad header is rejected before the
//! payload is buffered.

use std::fmt;
use std::net::Ipv4Addr;

use crate::meter::QuotaState;

pub const MAX_FRAME_PAYLOAD: u32 = 65536;
pub const MAX_DATA_PAYLOAD: usize = 16384;

pub const HELLO_PAIRS: [(u16, u16); 5] = [
    (25, 2525),
    (465, 2465),
    (993, 2993),
    (80, 8088),
    (443, 8448),
];

const TY_HELLO: u8 = 1;
const TY_HELLO_OK: u8 = 2;
const TY_PING: u8 = 3;
const TY_PONG: u8 = 4;
const TY_OPEN: u8 = 5;
const TY_OPEN_OK: u8 = 6;
const TY_OPEN_FAIL: u8 = 7;
const TY_DATA: u8 = 8;
const TY_CLOSE: u8 = 9;
const TY_QUOTA: u8 = 10;

const HEADER: usize = 5;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenFailReason {
    DialRefused = 1,
    BadPort = 2,
    Cap = 3,
}

impl OpenFailReason {
    fn from_u8(v: u8) -> Result<Self, ProtocolError> {
        match v {
            1 => Ok(Self::DialRefused),
            2 => Ok(Self::BadPort),
            3 => Ok(Self::Cap),
            _ => Err(ProtocolError::BadReason),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseReason {
    Eof = 1,
    Reset = 2,
    LocalClose = 3,
}

impl CloseReason {
    fn from_u8(v: u8) -> Result<Self, ProtocolError> {
        match v {
            1 => Ok(Self::Eof),
            2 => Ok(Self::Reset),
            3 => Ok(Self::LocalClose),
            _ => Err(ProtocolError::BadReason),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Frame {
    Hello,
    HelloOk {
        tx_bytes: u64,
        state: QuotaState,
        year: u16,
        month: u8,
    },
    Ping {
        unix_ms: u64,
    },
    Pong {
        unix_ms: u64,
    },
    Open {
        conn_id: u64,
        public_port: u16,
        src_port: u16,
        addr: Ipv4Addr,
    },
    OpenOk {
        conn_id: u64,
    },
    OpenFail {
        conn_id: u64,
        reason: OpenFailReason,
    },
    Data {
        conn_id: u64,
        payload: Vec<u8>,
    },
    Close {
        conn_id: u64,
        reason: CloseReason,
    },
    Quota {
        tx_bytes: u64,
        state: QuotaState,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    TooLong,
    DataTooLong,
    Truncated,
    UnknownType,
    BadLength,
    BadHello,
    BadState,
    BadMonth,
    BadAddress,
    BadReason,
    BadConn,
    SecondHello,
    Cap,
    ConnExhausted,
    Proxy,
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TooLong => write!(f, "frame longer than 65536"),
            Self::DataTooLong => write!(f, "DATA payload longer than 16384"),
            Self::Truncated => write!(f, "truncated frame"),
            Self::UnknownType => write!(f, "unknown frame type"),
            Self::BadLength => write!(f, "frame length does not match type"),
            Self::BadHello => write!(f, "HELLO is not version 1 with the five pairs"),
            Self::BadState => write!(f, "quota state is not 0, 1, or 2"),
            Self::BadMonth => write!(f, "month is not 1-12"),
            Self::BadAddress => write!(f, "OPEN address is not IPv4-mapped IPv6"),
            Self::BadReason => write!(f, "unknown close or open-fail reason"),
            Self::BadConn => write!(f, "unknown or reused conn id"),
            Self::SecondHello => write!(f, "second HELLO on one control connection"),
            Self::Cap => write!(f, "64 connection cap"),
            Self::ConnExhausted => write!(f, "conn id space exhausted"),
            Self::Proxy => write!(f, "PROXY v2 encode failed"),
        }
    }
}

impl std::error::Error for ProtocolError {}

pub fn hello_payload() -> [u8; 24] {
    let mut payload = [0u8; 24];
    payload[0..2].copy_from_slice(&1u16.to_be_bytes());
    payload[2..4].copy_from_slice(&5u16.to_be_bytes());
    for (i, (public, loopback)) in HELLO_PAIRS.iter().enumerate() {
        let at = 4 + i * 4;
        payload[at..at + 2].copy_from_slice(&public.to_be_bytes());
        payload[at + 2..at + 4].copy_from_slice(&loopback.to_be_bytes());
    }
    payload
}

fn validate_header(ty: u8, len: u32) -> Result<(), ProtocolError> {
    if len > MAX_FRAME_PAYLOAD {
        return Err(ProtocolError::TooLong);
    }
    let matches = match ty {
        TY_HELLO => len == 24,
        TY_HELLO_OK => len == 12,
        TY_PING | TY_PONG | TY_OPEN_OK => len == 8,
        TY_OPEN => len == 28,
        TY_OPEN_FAIL | TY_CLOSE | TY_QUOTA => len == 9,
        TY_DATA => len >= 8 && (len as usize - 8) <= MAX_DATA_PAYLOAD,
        _ => return Err(ProtocolError::UnknownType),
    };
    if matches {
        Ok(())
    } else if ty == TY_DATA && len >= 8 {
        Err(ProtocolError::DataTooLong)
    } else {
        Err(ProtocolError::BadLength)
    }
}

fn encode_mapped(addr: Ipv4Addr) -> [u8; 16] {
    let oct = addr.octets();
    let mut out = [0u8; 16];
    out[10] = 0xff;
    out[11] = 0xff;
    out[12..].copy_from_slice(&oct);
    out
}

fn decode_mapped(bytes: &[u8]) -> Result<Ipv4Addr, ProtocolError> {
    if bytes.len() != 16 || bytes[..10] != [0; 10] || bytes[10] != 0xff || bytes[11] != 0xff {
        return Err(ProtocolError::BadAddress);
    }
    Ok(Ipv4Addr::new(bytes[12], bytes[13], bytes[14], bytes[15]))
}

fn read_u16(buf: &[u8], at: usize) -> Result<u16, ProtocolError> {
    let end = at + 2;
    let slice = buf.get(at..end).ok_or(ProtocolError::Truncated)?;
    let arr: [u8; 2] = slice.try_into().map_err(|_| ProtocolError::Truncated)?;
    Ok(u16::from_be_bytes(arr))
}

fn read_u64(buf: &[u8], at: usize) -> Result<u64, ProtocolError> {
    let end = at + 8;
    let slice = buf.get(at..end).ok_or(ProtocolError::Truncated)?;
    let arr: [u8; 8] = slice.try_into().map_err(|_| ProtocolError::Truncated)?;
    Ok(u64::from_be_bytes(arr))
}

impl Frame {
    pub fn encode(&self) -> Result<Vec<u8>, ProtocolError> {
        let mut payload = Vec::new();
        let ty = match self {
            Self::Hello => {
                payload.extend_from_slice(&hello_payload());
                TY_HELLO
            }
            Self::HelloOk {
                tx_bytes,
                state,
                year,
                month,
            } => {
                if !(1..=12).contains(month) {
                    return Err(ProtocolError::BadMonth);
                }
                payload.extend_from_slice(&tx_bytes.to_be_bytes());
                payload.push((*state) as u8);
                payload.extend_from_slice(&year.to_be_bytes());
                payload.push(*month);
                TY_HELLO_OK
            }
            Self::Ping { unix_ms } => {
                payload.extend_from_slice(&unix_ms.to_be_bytes());
                TY_PING
            }
            Self::Pong { unix_ms } => {
                payload.extend_from_slice(&unix_ms.to_be_bytes());
                TY_PONG
            }
            Self::Open {
                conn_id,
                public_port,
                src_port,
                addr,
            } => {
                payload.extend_from_slice(&conn_id.to_be_bytes());
                payload.extend_from_slice(&public_port.to_be_bytes());
                payload.extend_from_slice(&src_port.to_be_bytes());
                payload.extend_from_slice(&encode_mapped(*addr));
                TY_OPEN
            }
            Self::OpenOk { conn_id } => {
                payload.extend_from_slice(&conn_id.to_be_bytes());
                TY_OPEN_OK
            }
            Self::OpenFail { conn_id, reason } => {
                payload.extend_from_slice(&conn_id.to_be_bytes());
                payload.push(*reason as u8);
                TY_OPEN_FAIL
            }
            Self::Data {
                conn_id,
                payload: body,
            } => {
                if body.len() > MAX_DATA_PAYLOAD {
                    return Err(ProtocolError::DataTooLong);
                }
                payload.extend_from_slice(&conn_id.to_be_bytes());
                payload.extend_from_slice(body);
                TY_DATA
            }
            Self::Close { conn_id, reason } => {
                payload.extend_from_slice(&conn_id.to_be_bytes());
                payload.push(*reason as u8);
                TY_CLOSE
            }
            Self::Quota { tx_bytes, state } => {
                payload.extend_from_slice(&tx_bytes.to_be_bytes());
                payload.push((*state) as u8);
                TY_QUOTA
            }
        };
        let mut out = Vec::with_capacity(HEADER + payload.len());
        out.push(ty);
        out.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        out.extend_from_slice(&payload);
        Ok(out)
    }
}

fn decode_payload(ty: u8, payload: &[u8]) -> Result<Frame, ProtocolError> {
    match ty {
        TY_HELLO => {
            if payload != hello_payload() {
                return Err(ProtocolError::BadHello);
            }
            Ok(Frame::Hello)
        }
        TY_HELLO_OK => {
            let month = payload[11];
            if !(1..=12).contains(&month) {
                return Err(ProtocolError::BadMonth);
            }
            Ok(Frame::HelloOk {
                tx_bytes: read_u64(payload, 0)?,
                state: QuotaState::from_u8(payload[8])?,
                year: read_u16(payload, 9)?,
                month,
            })
        }
        TY_PING => Ok(Frame::Ping {
            unix_ms: read_u64(payload, 0)?,
        }),
        TY_PONG => Ok(Frame::Pong {
            unix_ms: read_u64(payload, 0)?,
        }),
        TY_OPEN => Ok(Frame::Open {
            conn_id: read_u64(payload, 0)?,
            public_port: read_u16(payload, 8)?,
            src_port: read_u16(payload, 10)?,
            addr: decode_mapped(&payload[12..28])?,
        }),
        TY_OPEN_OK => Ok(Frame::OpenOk {
            conn_id: read_u64(payload, 0)?,
        }),
        TY_OPEN_FAIL => Ok(Frame::OpenFail {
            conn_id: read_u64(payload, 0)?,
            reason: OpenFailReason::from_u8(payload[8])?,
        }),
        TY_DATA => Ok(Frame::Data {
            conn_id: read_u64(payload, 0)?,
            payload: payload[8..].to_vec(),
        }),
        TY_CLOSE => Ok(Frame::Close {
            conn_id: read_u64(payload, 0)?,
            reason: CloseReason::from_u8(payload[8])?,
        }),
        TY_QUOTA => Ok(Frame::Quota {
            tx_bytes: read_u64(payload, 0)?,
            state: QuotaState::from_u8(payload[8])?,
        }),
        _ => Err(ProtocolError::UnknownType),
    }
}

/// Incremental decoder. On `Err`, drop it; the control connection closes.
#[derive(Debug, Default)]
pub struct Decoder {
    buf: Vec<u8>,
}

impl Decoder {
    pub fn new() -> Self {
        Self { buf: Vec::new() }
    }

    pub fn push(&mut self, mut input: &[u8]) -> Result<Vec<Frame>, ProtocolError> {
        let mut out = Vec::new();
        loop {
            if self.buf.len() < HEADER {
                let need = HEADER - self.buf.len();
                if input.len() < need {
                    self.buf.extend_from_slice(input);
                    return Ok(out);
                }
                self.buf.extend_from_slice(&input[..need]);
                input = &input[need..];
            }
            let len = u32::from_be_bytes(
                self.buf[1..5]
                    .try_into()
                    .map_err(|_| ProtocolError::Truncated)?,
            );
            validate_header(self.buf[0], len)?;
            let total = HEADER + len as usize;
            if self.buf.len() < total {
                let need = total - self.buf.len();
                if input.len() < need {
                    self.buf.extend_from_slice(input);
                    return Ok(out);
                }
                self.buf.extend_from_slice(&input[..need]);
                input = &input[need..];
            }
            let ty = self.buf[0];
            let frame = decode_payload(ty, &self.buf[HEADER..total])?;
            self.buf.drain(..total);
            out.push(frame);
            if self.buf.is_empty() && input.is_empty() {
                break;
            }
        }
        Ok(out)
    }

    /// The peer closed the socket. A leftover partial frame is fatal.
    pub fn finish(&self) -> Result<(), ProtocolError> {
        if self.buf.is_empty() {
            Ok(())
        } else {
            Err(ProtocolError::Truncated)
        }
    }
}

#[cfg(test)]
fn raw_frame(ty: u8, len: u32, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    out.push(ty);
    out.extend_from_slice(&len.to_be_bytes());
    out.extend_from_slice(payload);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one(bytes: &[u8]) -> Frame {
        let mut dec = Decoder::new();
        let frames = dec.push(bytes).unwrap();
        assert_eq!(frames.len(), 1);
        assert!(dec.finish().is_ok());
        frames.into_iter().next().unwrap()
    }

    #[test]
    fn hello_is_24_bytes_and_the_five_pairs_in_order() {
        let payload = hello_payload();
        assert_eq!(payload.len(), 24);
        assert_eq!(
            payload,
            [
                0x00, 0x01, 0x00, 0x05, 0x00, 0x19, 0x09, 0xdd, 0x01, 0xd1, 0x09, 0xa1, 0x03, 0xe1,
                0x0b, 0xb1, 0x00, 0x50, 0x1f, 0x98, 0x01, 0xbb, 0x21, 0x00,
            ]
        );
        let encoded = Frame::Hello.encode().unwrap();
        assert_eq!(encoded.len(), 5 + 24);
        assert_eq!(one(&encoded), Frame::Hello);
    }

    #[test]
    fn hello_rejects_a_different_map() {
        let mut payload = hello_payload();
        payload[4] = 0x02;
        payload[5] = 0x4b; // 587
        let frame = raw_frame(TY_HELLO, 24, &payload);
        let err = Decoder::new().push(&frame).unwrap_err();
        assert_eq!(err, ProtocolError::BadHello);
    }

    #[test]
    fn hello_rejects_wrong_length_before_the_body() {
        let header = raw_frame(TY_HELLO, 23, &[]);
        assert_eq!(
            Decoder::new().push(&header).unwrap_err(),
            ProtocolError::BadLength
        );
    }

    #[test]
    fn oversize_length_does_not_wait_for_a_body() {
        let header = raw_frame(99, 65537, &[]);
        assert_eq!(
            Decoder::new().push(&header).unwrap_err(),
            ProtocolError::TooLong
        );
        let data = raw_frame(TY_DATA, 65536, &[]);
        assert_eq!(
            Decoder::new().push(&data).unwrap_err(),
            ProtocolError::DataTooLong
        );
        let data = raw_frame(TY_DATA, 7, &[]);
        assert_eq!(
            Decoder::new().push(&data).unwrap_err(),
            ProtocolError::BadLength
        );
    }

    #[test]
    fn data_accepts_16384_and_rejects_16385() {
        let body = vec![7u8; MAX_DATA_PAYLOAD];
        let frame = Frame::Data {
            conn_id: 1,
            payload: body.clone(),
        }
        .encode()
        .unwrap();
        assert_eq!(
            one(&frame),
            Frame::Data {
                conn_id: 1,
                payload: body,
            }
        );
        assert_eq!(
            Frame::Data {
                conn_id: 1,
                payload: vec![0; MAX_DATA_PAYLOAD + 1],
            }
            .encode()
            .unwrap_err(),
            ProtocolError::DataTooLong
        );
        let mut declared = Vec::new();
        declared.push(TY_DATA);
        declared.extend_from_slice(&((8 + MAX_DATA_PAYLOAD as u32) + 1).to_be_bytes());
        assert_eq!(
            Decoder::new().push(&declared).unwrap_err(),
            ProtocolError::DataTooLong
        );
    }

    #[test]
    fn truncated_frame_waits_then_finish_fails() {
        let full = Frame::Hello.encode().unwrap();
        let mut dec = Decoder::new();
        assert!(dec.push(&full[..10]).unwrap().is_empty());
        assert_eq!(dec.finish().unwrap_err(), ProtocolError::Truncated);
        let rest = dec.push(&full[10..]).unwrap();
        assert_eq!(rest, vec![Frame::Hello]);
        assert!(dec.finish().is_ok());
    }

    #[test]
    fn two_frames_in_one_buffer() {
        let mut buf = Frame::Ping { unix_ms: 9 }.encode().unwrap();
        buf.extend(Frame::Pong { unix_ms: 9 }.encode().unwrap());
        let mut dec = Decoder::new();
        assert_eq!(
            dec.push(&buf).unwrap(),
            vec![Frame::Ping { unix_ms: 9 }, Frame::Pong { unix_ms: 9 }]
        );
    }

    #[test]
    fn open_roundtrip_requires_ipv4_mapped() {
        let frame = Frame::Open {
            conn_id: 1,
            public_port: 25,
            src_port: 40000,
            addr: Ipv4Addr::new(203, 0, 113, 9),
        };
        let encoded = frame.encode().unwrap();
        assert_eq!(one(&encoded), frame);
        let mut payload = encoded[5..].to_vec();
        payload[12] = 0x20; // not the mapped prefix
        let bad = raw_frame(TY_OPEN, 28, &payload);
        assert_eq!(
            Decoder::new().push(&bad).unwrap_err(),
            ProtocolError::BadAddress
        );
    }

    #[test]
    fn quota_states_and_bad_month() {
        for state in [
            QuotaState::Open,
            QuotaState::PausedQuota,
            QuotaState::Override,
        ] {
            let frame = Frame::Quota {
                tx_bytes: 10,
                state,
            };
            assert_eq!(one(&frame.encode().unwrap()), frame);
        }
        let mut payload = [0u8; 9];
        payload[8] = 3;
        assert_eq!(
            Decoder::new()
                .push(&raw_frame(TY_QUOTA, 9, &payload))
                .unwrap_err(),
            ProtocolError::BadState
        );
        let mut hello_ok = [0u8; 12];
        hello_ok[11] = 0;
        assert_eq!(
            Decoder::new()
                .push(&raw_frame(TY_HELLO_OK, 12, &hello_ok))
                .unwrap_err(),
            ProtocolError::BadMonth
        );
    }

    #[test]
    fn unknown_type_and_bad_reason() {
        assert_eq!(
            Decoder::new().push(&raw_frame(11, 0, &[])).unwrap_err(),
            ProtocolError::UnknownType
        );
        let mut payload = [0u8; 9];
        payload[8] = 9;
        assert_eq!(
            Decoder::new()
                .push(&raw_frame(TY_CLOSE, 9, &payload))
                .unwrap_err(),
            ProtocolError::BadReason
        );
    }

    #[test]
    fn decoder_does_not_panic_on_random_bytes() {
        let mut state = 0x1234_5678_9abc_u64;
        let mut dec = Decoder::new();
        for _ in 0..400 {
            let mut chunk = [0u8; 48];
            for byte in &mut chunk {
                state = state.wrapping_mul(6364136223846793005).wrapping_add(1);
                *byte = (state >> 33) as u8;
            }
            if dec.push(&chunk).is_err() {
                dec = Decoder::new();
            }
        }
        let _ = dec.finish();
    }
}
