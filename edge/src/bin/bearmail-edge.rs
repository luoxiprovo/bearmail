//! Thin localhost mains. `vm` accepts one control connection and splices a
//! public TCP port. `mac` dials it and writes PROXY v2 on ports 25, 465, and 993.

use std::env;
use std::io::{self, ErrorKind};
use std::net::{Ipv4Addr, SocketAddr};
use std::process::ExitCode;
use std::str::FromStr;

use bearmail_edge::{VmOpts, serve_mac, serve_vm};

const USAGE: &str = "\
usage: bearmail-edge vm --control ADDR --public ADDR --advertise-port PORT [--tx-bytes N] [--quota-override]
       bearmail-edge mac --control ADDR [--public-ipv4 ADDR]";

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("bearmail-edge: {err}");
            ExitCode::from(1)
        }
    }
}

fn run() -> io::Result<()> {
    let mut args = env::args().skip(1);
    match args.next().as_deref() {
        Some("vm") => serve_vm(parse_vm(&mut args)?),
        Some("mac") => {
            let (control, public_ipv4) = parse_mac(&mut args)?;
            serve_mac(control, public_ipv4)
        }
        _ => Err(io::Error::new(ErrorKind::InvalidInput, USAGE)),
    }
}

fn parse_vm(args: &mut impl Iterator<Item = String>) -> io::Result<VmOpts> {
    let mut control = None;
    let mut public = None;
    let mut advertise_port = None;
    let mut tx_bytes = 0;
    let mut quota_override = false;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--control" => control = Some(parse_addr(&need(args, "--control")?)?),
            "--public" => public = Some(parse_addr(&need(args, "--public")?)?),
            "--advertise-port" => {
                advertise_port = Some(parse_u16(&need(args, "--advertise-port")?)?);
            }
            "--tx-bytes" => tx_bytes = parse_u64(&need(args, "--tx-bytes")?)?,
            "--quota-override" => quota_override = true,
            other => {
                return Err(io::Error::new(
                    ErrorKind::InvalidInput,
                    format!("unknown argument {other}\n{USAGE}"),
                ));
            }
        }
    }
    Ok(VmOpts {
        control: control.ok_or_else(|| missing("--control"))?,
        public: public.ok_or_else(|| missing("--public"))?,
        advertise_port: advertise_port.ok_or_else(|| missing("--advertise-port"))?,
        tx_bytes,
        quota_override,
    })
}

fn parse_mac(args: &mut impl Iterator<Item = String>) -> io::Result<(SocketAddr, Ipv4Addr)> {
    let mut control = None;
    let mut public_ipv4 = Ipv4Addr::LOCALHOST;
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--control" => control = Some(parse_addr(&need(args, "--control")?)?),
            "--public-ipv4" => public_ipv4 = parse_v4(&need(args, "--public-ipv4")?)?,
            other => {
                return Err(io::Error::new(
                    ErrorKind::InvalidInput,
                    format!("unknown argument {other}\n{USAGE}"),
                ));
            }
        }
    }
    Ok((control.ok_or_else(|| missing("--control"))?, public_ipv4))
}

fn need(args: &mut impl Iterator<Item = String>, flag: &str) -> io::Result<String> {
    args.next()
        .ok_or_else(|| io::Error::new(ErrorKind::InvalidInput, format!("missing value for {flag}")))
}

fn missing(flag: &str) -> io::Error {
    io::Error::new(ErrorKind::InvalidInput, format!("missing {flag}\n{USAGE}"))
}

fn parse_addr(text: &str) -> io::Result<SocketAddr> {
    SocketAddr::from_str(text)
        .map_err(|_| io::Error::new(ErrorKind::InvalidInput, format!("bad address {text}")))
}

fn parse_v4(text: &str) -> io::Result<Ipv4Addr> {
    Ipv4Addr::from_str(text)
        .map_err(|_| io::Error::new(ErrorKind::InvalidInput, format!("bad IPv4 address {text}")))
}

fn parse_u16(text: &str) -> io::Result<u16> {
    text.parse()
        .map_err(|_| io::Error::new(ErrorKind::InvalidInput, format!("bad port {text}")))
}

fn parse_u64(text: &str) -> io::Result<u64> {
    text.parse()
        .map_err(|_| io::Error::new(ErrorKind::InvalidInput, format!("bad byte count {text}")))
}
