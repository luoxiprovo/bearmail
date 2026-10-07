//! Two processes on localhost: a public client, `bearmail-edge vm`,
//! `bearmail-edge mac`, and a stub that stands in for Stalwart or Caddy.
//! The stub must observe the client's address, not the Mac's dial address.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream};
use std::process::{Child, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread;
use std::time::{Duration, Instant};

use proxy_header::{ParseConfig, ProxyHeader};

use bearmail_edge::loopback_for;

const PAYLOAD: &[u8] = b"bearmail-origin-check\n";

struct ChildGuard(Child);

impl Drop for ChildGuard {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

#[test]
fn stub_sees_the_original_mail_source() {
    splice(25, true);
}

#[test]
fn http_splice_does_not_write_a_proxy_header() {
    splice(80, false);
}

fn splice(advertise_port: u16, expect_proxy: bool) {
    let loopback = loopback_for(advertise_port).unwrap();
    let stub = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, loopback)))
        .unwrap_or_else(|err| panic!("bind 127.0.0.1:{loopback}: {err}"));

    let mut vm = spawn(&[
        "vm",
        "--control",
        "127.0.0.1:0",
        "--public",
        "127.0.0.1:0",
        "--advertise-port",
        &advertise_port.to_string(),
    ]);
    let vm_lines = lines(&mut vm);
    let ready = wait_line(&vm_lines, "ready control=");
    let control = ready.trim_start_matches("ready control=").to_string();

    let mut mac = spawn(&["mac", "--control", &control, "--public-ipv4", "127.0.0.1"]);
    let mac_lines = lines(&mut mac);
    wait_line(&mac_lines, "hello-ok");
    let forwarding = wait_line(&vm_lines, "forwarding public=");
    let public_addr: SocketAddr = forwarding
        .trim_start_matches("forwarding public=")
        .parse()
        .unwrap();

    let mut client = TcpStream::connect(public_addr).unwrap();
    client.set_nodelay(true).unwrap();
    let origin = client.local_addr().unwrap();
    client.write_all(PAYLOAD).unwrap();
    client.flush().unwrap();

    let (mut accepted, mac_dial) = accept_within(&stub, Duration::from_secs(10));
    accepted
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut buf = Vec::new();
    let mut tmp = [0u8; 512];
    let deadline = Instant::now() + Duration::from_secs(5);
    while Instant::now() < deadline && !buf.windows(PAYLOAD.len()).any(|w| w == PAYLOAD) {
        match accepted.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => buf.extend_from_slice(&tmp[..n]),
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(20));
            }
            Err(err) if err.kind() == std::io::ErrorKind::TimedOut => break,
            Err(err) => panic!("{err}"),
        }
    }

    if expect_proxy {
        let (header, len) = ProxyHeader::parse(&buf, ParseConfig::default())
            .unwrap_or_else(|err| panic!("stub did not see PROXY v2 ({err}), bytes {buf:?}"));
        let proxied = header.proxied_address().expect("proxied address");
        assert_eq!(proxied.source, origin);
        assert_eq!(
            proxied.destination,
            SocketAddr::from((Ipv4Addr::LOCALHOST, advertise_port))
        );
        assert_ne!(proxied.source, mac_dial);
        assert_eq!(&buf[len..len + PAYLOAD.len()], PAYLOAD);
    } else {
        assert!(
            buf.starts_with(PAYLOAD),
            "raw splice started with {buf:?}, not the client payload"
        );
        assert_ne!(
            &buf[..12.min(buf.len())],
            &proxy_signature()[..12.min(buf.len())]
        );
    }
    let _ = client.shutdown(Shutdown::Both);
}

fn proxy_signature() -> [u8; 12] {
    *b"\r\n\r\n\0\r\nQUIT\n"
}

fn spawn(args: &[&str]) -> ChildGuard {
    let child = Command::new(env!("CARGO_BIN_EXE_bearmail-edge"))
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    ChildGuard(child)
}

fn lines(child: &mut ChildGuard) -> Receiver<String> {
    let out = child.0.stdout.take().unwrap();
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let reader = std::io::BufReader::new(out);
        for line in std::io::BufRead::lines(reader) {
            match line {
                Ok(text) => {
                    if tx.send(text).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    rx
}

fn wait_line(rx: &Receiver<String>, prefix: &str) -> String {
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            panic!("timed out waiting for {prefix}");
        }
        match rx.recv_timeout(left) {
            Ok(line) if line.starts_with(prefix) => return line,
            Ok(_) => continue,
            Err(_) => panic!("timed out waiting for {prefix}"),
        }
    }
}

fn accept_within(listener: &TcpListener, budget: Duration) -> (TcpStream, SocketAddr) {
    listener.set_nonblocking(true).unwrap();
    let deadline = Instant::now() + budget;
    loop {
        match listener.accept() {
            Ok((sock, peer)) => return (sock, peer),
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    panic!("stub accept timed out");
                }
                thread::sleep(Duration::from_millis(20));
            }
            Err(err) => panic!("{err}"),
        }
    }
}
