//! Localhost splice for the thin `vm` and `mac` mains.
//!
//! TLS stays outside this crate. Bytes already written may cross the pause
//! line; the next DATA frame is not forwarded and the public listener closes.

use std::collections::HashMap;
use std::io::{self, Read, Write};
use std::net::{Ipv4Addr, Shutdown, SocketAddr, TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use crate::frame::{CloseReason, Decoder, Frame, OpenFailReason, ProtocolError};
use crate::meter::{Meter, utc_year_month};
use crate::proxy::{encode_proxy_v2, loopback_for, wants_proxy};
use crate::session::{Admit, HelloOnce, IdWindow, SessionGate, ping_interval, tunnel_dead};

impl From<ProtocolError> for io::Error {
    fn from(err: ProtocolError) -> Self {
        io::Error::new(io::ErrorKind::InvalidData, err)
    }
}

pub struct VmOpts {
    pub control: SocketAddr,
    pub public: SocketAddr,
    pub advertise_port: u16,
    pub tx_bytes: u64,
    pub quota_override: bool,
}

struct LiveSock {
    sock: TcpStream,
    closed: Arc<AtomicBool>,
}

#[derive(Clone)]
struct Ctrl {
    writer: Arc<Mutex<TcpStream>>,
}

impl Ctrl {
    fn new(sock: TcpStream) -> io::Result<Self> {
        sock.set_nodelay(true)?;
        Ok(Self {
            writer: Arc::new(Mutex::new(sock)),
        })
    }

    fn send(&self, frame: &Frame) -> io::Result<()> {
        let bytes = frame.encode()?;
        let mut guard = lock(&self.writer);
        guard.write_all(&bytes)?;
        guard.flush()
    }

    fn shutdown(&self) {
        let _ = lock(&self.writer).shutdown(Shutdown::Both);
    }
}

struct Shared {
    ids: Mutex<IdWindow>,
    waiting: Mutex<HashMap<u64, TcpStream>>,
    writers: Mutex<HashMap<u64, LiveSock>>,
    meter: Mutex<Meter>,
    stop: Arc<AtomicBool>,
    last_pong: Arc<AtomicU64>,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|err| err.into_inner())
}

fn status(line: &str) {
    let mut out = io::stdout();
    let _ = writeln!(out, "{line}");
    let _ = out.flush();
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}

fn unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

fn spawn_ping(ctrl: Ctrl, stop: Arc<AtomicBool>, last_pong: Arc<AtomicU64>) {
    thread::spawn(move || {
        loop {
            let jitter = Duration::from_millis(now_ms() % 2000);
            thread::sleep(ping_interval(jitter));
            if stop.load(Ordering::SeqCst) {
                break;
            }
            let idle = now_ms().saturating_sub(last_pong.load(Ordering::SeqCst));
            if tunnel_dead(Duration::from_millis(idle)) {
                stop.store(true, Ordering::SeqCst);
                ctrl.shutdown();
                break;
            }
            if ctrl.send(&Frame::Ping { unix_ms: now_ms() }).is_err() {
                break;
            }
        }
    });
}

pub fn serve_vm(opts: VmOpts) -> io::Result<()> {
    if loopback_for(opts.advertise_port).is_none() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "advertise-port is not one of 25, 465, 993, 80, 443",
        ));
    }
    let listener = TcpListener::bind(opts.control)?;
    status(&format!("ready control={}", listener.local_addr()?));
    let opts = Arc::new(opts);
    let gate = Arc::new(Mutex::new(SessionGate::new()));
    let mut previous: Option<Ctrl> = None;
    for conn in listener.incoming() {
        let sock = conn?;
        let generation = lock(&gate).admit().0;
        if let Some(prev) = previous.take() {
            prev.shutdown();
        }
        previous = Some(Ctrl::new(sock.try_clone()?)?);
        let opts = Arc::clone(&opts);
        let gate = Arc::clone(&gate);
        thread::spawn(move || {
            if let Err(err) = vm_session(sock, opts, generation, gate) {
                eprintln!("bearmail-edge vm: {err}");
            }
        });
    }
    Ok(())
}

fn vm_session(
    sock: TcpStream,
    opts: Arc<VmOpts>,
    generation: u64,
    gate: Arc<Mutex<SessionGate>>,
) -> io::Result<()> {
    let mut reader = sock.try_clone()?;
    let ctrl = Ctrl::new(sock)?;
    let shared = Arc::new(Shared {
        ids: Mutex::new(IdWindow::new()),
        waiting: Mutex::new(HashMap::new()),
        writers: Mutex::new(HashMap::new()),
        meter: Mutex::new(Meter::new(opts.tx_bytes, opts.quota_override)),
        stop: Arc::new(AtomicBool::new(false)),
        last_pong: Arc::new(AtomicU64::new(now_ms())),
    });
    spawn_ping(
        ctrl.clone(),
        Arc::clone(&shared.stop),
        Arc::clone(&shared.last_pong),
    );

    let mut hello = HelloOnce::new();
    let mut forwarding = false;
    let mut decoder = Decoder::new();
    let mut buf = [0u8; 8192];
    loop {
        if !lock(&gate).is_current(generation) || shared.stop.load(Ordering::SeqCst) {
            shared.stop.store(true, Ordering::SeqCst);
            break;
        }
        let n = match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(err) => return Err(err),
        };
        for frame in decoder.push(&buf[..n])? {
            if !lock(&gate).is_current(generation) {
                shared.stop.store(true, Ordering::SeqCst);
                return Ok(());
            }
            match frame {
                Frame::Hello if !forwarding => {
                    hello.observe()?;
                    forwarding = answer_hello(&shared, &ctrl, &opts)?;
                }
                other => on_vm_frame(&shared, &ctrl, &mut hello, other)?,
            }
        }
    }
    shared.stop.store(true, Ordering::SeqCst);
    Ok(())
}

fn answer_hello(shared: &Arc<Shared>, ctrl: &Ctrl, opts: &VmOpts) -> io::Result<bool> {
    let (tx_bytes, state) = {
        let meter = lock(&shared.meter);
        (meter.tx_bytes(), meter.state())
    };
    let (year, month) = utc_year_month(unix_secs());
    ctrl.send(&Frame::HelloOk {
        tx_bytes,
        state,
        year,
        month,
    })?;
    if !lock(&shared.meter).data_allowed() {
        status("paused");
        ctrl.send(&Frame::Quota { tx_bytes, state })?;
        return Ok(false);
    }
    let listener = TcpListener::bind(opts.public)?;
    listener.set_nonblocking(true)?;
    status(&format!("forwarding public={}", listener.local_addr()?));
    let shared = Arc::clone(shared);
    let ctrl = ctrl.clone();
    let advertise_port = opts.advertise_port;
    thread::spawn(move || accept_loop(listener, shared, ctrl, advertise_port));
    Ok(true)
}

fn accept_loop(listener: TcpListener, shared: Arc<Shared>, ctrl: Ctrl, advertise_port: u16) {
    while !shared.stop.load(Ordering::SeqCst) && lock(&shared.meter).data_allowed() {
        match listener.accept() {
            Ok((stream, _)) => {
                // The listener is nonblocking so this loop can observe `stop`.
                // An accepted socket inherits that flag; a WouldBlock on the
                // splice is not a reset, so the data path reads in blocking mode.
                if stream.set_nodelay(true).is_err() || stream.set_nonblocking(false).is_err() {
                    continue;
                }
                let Ok(SocketAddr::V4(peer)) = stream.peer_addr() else {
                    continue;
                };
                let id = match lock(&shared.ids).alloc() {
                    Ok(id) => id,
                    Err(ProtocolError::Cap) => continue,
                    Err(_) => break,
                };
                lock(&shared.waiting).insert(id, stream);
                let opened = ctrl.send(&Frame::Open {
                    conn_id: id,
                    public_port: advertise_port,
                    src_port: peer.port(),
                    addr: *peer.ip(),
                });
                if opened.is_err() {
                    break;
                }
            }
            Err(err) if err.kind() == io::ErrorKind::WouldBlock => {
                thread::sleep(Duration::from_millis(20));
            }
            Err(_) => break,
        }
    }
}

fn on_vm_frame(
    shared: &Arc<Shared>,
    ctrl: &Ctrl,
    hello: &mut HelloOnce,
    frame: Frame,
) -> io::Result<()> {
    match frame {
        Frame::Hello => hello.observe()?,
        Frame::Ping { unix_ms } => ctrl.send(&Frame::Pong { unix_ms })?,
        Frame::Pong { .. } => {
            shared.last_pong.store(now_ms(), Ordering::SeqCst);
        }
        Frame::OpenOk { conn_id } => {
            lock(&shared.ids).require_open(conn_id)?;
            let Some(stream) = lock(&shared.waiting).remove(&conn_id) else {
                return Err(ProtocolError::BadConn.into());
            };
            start_uplink(shared, ctrl, conn_id, stream);
        }
        Frame::OpenFail { conn_id, .. } => {
            lock(&shared.ids).close(conn_id)?;
            lock(&shared.waiting).remove(&conn_id);
        }
        Frame::Data { conn_id, payload } => {
            if !lock(&shared.meter).data_allowed() {
                pause(shared, ctrl);
                return Ok(());
            }
            lock(&shared.ids).require_open(conn_id)?;
            {
                let mut writers = lock(&shared.writers);
                let Some(live) = writers.get_mut(&conn_id) else {
                    return Err(ProtocolError::BadConn.into());
                };
                live.sock.write_all(&payload)?;
            }
            if lock(&shared.meter).note_tx(payload.len() as u64) {
                pause(shared, ctrl);
            }
        }
        Frame::Close { conn_id, .. } => retire(shared, ctrl, conn_id, false)?,
        Frame::HelloOk { .. } | Frame::Open { .. } | Frame::Quota { .. } => {
            return Err(ProtocolError::UnknownType.into());
        }
    }
    Ok(())
}

fn start_uplink(shared: &Arc<Shared>, ctrl: &Ctrl, conn_id: u64, stream: TcpStream) {
    let _ = stream.set_nodelay(true);
    let closed = Arc::new(AtomicBool::new(false));
    let Ok(writer) = stream.try_clone() else {
        return;
    };
    lock(&shared.writers).insert(
        conn_id,
        LiveSock {
            sock: writer,
            closed: Arc::clone(&closed),
        },
    );
    let shared = Arc::clone(shared);
    let ctrl = ctrl.clone();
    thread::spawn(move || uplink(stream, ctrl, shared, closed, conn_id));
}

fn uplink(
    mut stream: TcpStream,
    ctrl: Ctrl,
    shared: Arc<Shared>,
    closed: Arc<AtomicBool>,
    conn_id: u64,
) {
    let mut buf = [0u8; 16384];
    loop {
        if shared.stop.load(Ordering::SeqCst) || closed.load(Ordering::SeqCst) {
            break;
        }
        if !lock(&shared.meter).data_allowed() {
            break;
        }
        match stream.read(&mut buf) {
            Ok(0) => {
                if !closed.swap(true, Ordering::SeqCst) {
                    let _ = lock(&shared.ids).close(conn_id);
                    let _ = ctrl.send(&Frame::Close {
                        conn_id,
                        reason: CloseReason::Eof,
                    });
                }
                break;
            }
            Ok(n) => {
                if ctrl
                    .send(&Frame::Data {
                        conn_id,
                        payload: buf[..n].to_vec(),
                    })
                    .is_err()
                {
                    break;
                }
                if lock(&shared.meter).note_tx(n as u64) {
                    pause(&shared, &ctrl);
                    break;
                }
            }
            Err(_) => {
                if !closed.swap(true, Ordering::SeqCst) {
                    let _ = lock(&shared.ids).close(conn_id);
                    let _ = ctrl.send(&Frame::Close {
                        conn_id,
                        reason: CloseReason::Reset,
                    });
                }
                break;
            }
        }
    }
}

fn retire(shared: &Shared, ctrl: &Ctrl, conn_id: u64, send_close: bool) -> io::Result<()> {
    lock(&shared.ids).close(conn_id)?;
    if let Some(live) = lock(&shared.writers).remove(&conn_id) {
        let first = !live.closed.swap(true, Ordering::SeqCst);
        let _ = live.sock.shutdown(Shutdown::Both);
        if send_close && first {
            ctrl.send(&Frame::Close {
                conn_id,
                reason: CloseReason::LocalClose,
            })?;
        }
    }
    lock(&shared.waiting).remove(&conn_id);
    Ok(())
}

fn pause(shared: &Shared, ctrl: &Ctrl) {
    if shared.stop.swap(true, Ordering::SeqCst) {
        return;
    }
    let ids: Vec<u64> = lock(&shared.writers).keys().copied().collect();
    for id in ids {
        let _ = retire(shared, ctrl, id, true);
    }
    let (tx_bytes, state) = {
        let meter = lock(&shared.meter);
        (meter.tx_bytes(), meter.state())
    };
    let _ = ctrl.send(&Frame::Quota { tx_bytes, state });
    status("paused");
}

pub fn serve_mac(control: SocketAddr, public_ipv4: Ipv4Addr) -> io::Result<()> {
    let sock = TcpStream::connect(control)?;
    let mut reader = sock.try_clone()?;
    let ctrl = Ctrl::new(sock)?;
    ctrl.send(&Frame::Hello)?;
    let stop = Arc::new(AtomicBool::new(false));
    let last_pong = Arc::new(AtomicU64::new(now_ms()));
    spawn_ping(ctrl.clone(), Arc::clone(&stop), Arc::clone(&last_pong));

    let mut ids = IdWindow::new();
    let writers = Arc::new(Mutex::new(HashMap::<u64, LiveSock>::new()));
    let mut decoder = Decoder::new();
    let mut buf = [0u8; 8192];
    loop {
        if stop.load(Ordering::SeqCst) {
            break;
        }
        let n = match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => n,
            Err(err) => return Err(err),
        };
        for frame in decoder.push(&buf[..n])? {
            match frame {
                Frame::HelloOk { .. } => status("hello-ok"),
                Frame::Ping { unix_ms } => ctrl.send(&Frame::Pong { unix_ms })?,
                Frame::Pong { .. } => {
                    last_pong.store(now_ms(), Ordering::SeqCst);
                }
                Frame::Quota { .. } => {}
                Frame::Open {
                    conn_id,
                    public_port,
                    src_port,
                    addr,
                } => open_on_mac(
                    &ctrl,
                    &mut ids,
                    &writers,
                    conn_id,
                    public_port,
                    src_port,
                    addr,
                    public_ipv4,
                )?,
                Frame::Data { conn_id, payload } => {
                    ids.require_open(conn_id)?;
                    let mut map = lock(&writers);
                    let Some(live) = map.get_mut(&conn_id) else {
                        return Err(ProtocolError::BadConn.into());
                    };
                    live.sock.write_all(&payload)?;
                }
                Frame::Close { conn_id, .. } => {
                    ids.close(conn_id)?;
                    if let Some(live) = lock(&writers).remove(&conn_id) {
                        live.closed.store(true, Ordering::SeqCst);
                        let _ = live.sock.shutdown(Shutdown::Both);
                    }
                }
                Frame::Hello | Frame::OpenOk { .. } | Frame::OpenFail { .. } => {
                    return Err(ProtocolError::UnknownType.into());
                }
            }
        }
    }
    Ok(())
}

fn open_on_mac(
    ctrl: &Ctrl,
    ids: &mut IdWindow,
    writers: &Arc<Mutex<HashMap<u64, LiveSock>>>,
    conn_id: u64,
    public_port: u16,
    src_port: u16,
    addr: Ipv4Addr,
    public_ipv4: Ipv4Addr,
) -> io::Result<()> {
    match ids.admit(conn_id)? {
        Admit::Cap => {
            return ctrl.send(&Frame::OpenFail {
                conn_id,
                reason: OpenFailReason::Cap,
            });
        }
        Admit::Opened => {}
    }
    let Some(loopback) = loopback_for(public_port) else {
        ids.close(conn_id)?;
        return ctrl.send(&Frame::OpenFail {
            conn_id,
            reason: OpenFailReason::BadPort,
        });
    };
    let mut dial = match TcpStream::connect(SocketAddr::from((Ipv4Addr::LOCALHOST, loopback))) {
        Ok(sock) => sock,
        Err(_) => {
            ids.close(conn_id)?;
            return ctrl.send(&Frame::OpenFail {
                conn_id,
                reason: OpenFailReason::DialRefused,
            });
        }
    };
    dial.set_nodelay(true)?;
    if wants_proxy(public_port) {
        let header = encode_proxy_v2(
            SocketAddr::from((addr, src_port)),
            SocketAddr::from((public_ipv4, public_port)),
        )?;
        dial.write_all(&header)?;
    }
    ctrl.send(&Frame::OpenOk { conn_id })?;
    let closed = Arc::new(AtomicBool::new(false));
    let reader = dial.try_clone()?;
    lock(writers).insert(
        conn_id,
        LiveSock {
            sock: dial,
            closed: Arc::clone(&closed),
        },
    );
    let ctrl = ctrl.clone();
    thread::spawn(move || mac_uplink(reader, ctrl, closed, conn_id));
    Ok(())
}

fn mac_uplink(mut reader: TcpStream, ctrl: Ctrl, closed: Arc<AtomicBool>, conn_id: u64) {
    let mut buf = [0u8; 16384];
    loop {
        if closed.load(Ordering::SeqCst) {
            break;
        }
        match reader.read(&mut buf) {
            Ok(0) => {
                if !closed.swap(true, Ordering::SeqCst) {
                    let _ = ctrl.send(&Frame::Close {
                        conn_id,
                        reason: CloseReason::Eof,
                    });
                }
                break;
            }
            Ok(n) => {
                if ctrl
                    .send(&Frame::Data {
                        conn_id,
                        payload: buf[..n].to_vec(),
                    })
                    .is_err()
                {
                    break;
                }
            }
            Err(_) => {
                if !closed.swap(true, Ordering::SeqCst) {
                    let _ = ctrl.send(&Frame::Close {
                        conn_id,
                        reason: CloseReason::Reset,
                    });
                }
                break;
            }
        }
    }
}
