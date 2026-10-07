//! PROXY v2 for the three mail ports. Encode only.
//! `ProxiedStream::create_from_tokio` parses; this module does not call it.

use std::net::SocketAddr;

use proxy_header::{ProxiedAddress, ProxyHeader};

use crate::frame::{HELLO_PAIRS, ProtocolError};

pub fn loopback_for(public_port: u16) -> Option<u16> {
    HELLO_PAIRS
        .iter()
        .find(|(public, _)| *public == public_port)
        .map(|(_, loopback)| *loopback)
}

/// Mail ports get a PROXY header. 80 and 443 are a raw splice in v1.
pub fn wants_proxy(public_port: u16) -> bool {
    matches!(public_port, 25 | 465 | 993)
}

pub fn encode_proxy_v2(
    source: SocketAddr,
    destination: SocketAddr,
) -> Result<Vec<u8>, ProtocolError> {
    let header = ProxyHeader::with_address(ProxiedAddress::stream(source, destination));
    let mut buf = [0u8; 256];
    let n = header
        .encode_to_slice_v2(&mut buf)
        .map_err(|_| ProtocolError::Proxy)?;
    Ok(buf[..n].to_vec())
}

#[cfg(test)]
mod tests {
    use super::*;
    use proxy_header::{ParseConfig, ProxyHeader};
    use std::net::{Ipv4Addr, SocketAddrV4};

    #[test]
    fn fixed_map_and_proxy_only_on_mail_ports() {
        assert_eq!(loopback_for(25), Some(2525));
        assert_eq!(loopback_for(465), Some(2465));
        assert_eq!(loopback_for(993), Some(2993));
        assert_eq!(loopback_for(80), Some(8088));
        assert_eq!(loopback_for(443), Some(8448));
        assert_eq!(loopback_for(587), None);
        assert!(wants_proxy(25) && wants_proxy(465) && wants_proxy(993));
        assert!(!wants_proxy(80) && !wants_proxy(443) && !wants_proxy(587));
    }

    #[test]
    fn encoded_header_roundtrips_the_original_source() {
        let source = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::new(203, 0, 113, 9), 40000));
        let destination = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::new(192, 0, 2, 10), 25));
        let bytes = encode_proxy_v2(source, destination).unwrap();
        let (header, len) = ProxyHeader::parse(&bytes, ParseConfig::default()).unwrap();
        assert_eq!(len, bytes.len());
        let addr = header.proxied_address().unwrap();
        assert_eq!(addr.source, source);
        assert_eq!(addr.destination, destination);
    }
}
