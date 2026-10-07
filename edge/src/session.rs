//! Conn ids, the single control session, and the liveness timers.
//!
//! Ids start at 1, increase by one, and are not reused for the life of the
//! control session. A new HELLO is a new session, which starts again at 1.

use std::collections::HashSet;
use std::time::Duration;

use crate::frame::ProtocolError;

pub const MAX_CONNS: usize = 64;
pub const PING_INTERVAL: Duration = Duration::from_secs(15);
pub const PONG_TIMEOUT: Duration = Duration::from_secs(45);

#[derive(Debug)]
pub struct IdWindow {
    next: u64,
    open: HashSet<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Admit {
    Opened,
    /// The id was consumed and left closed. The public socket is dropped.
    Cap,
}

impl IdWindow {
    pub fn new() -> Self {
        Self {
            next: 1,
            open: HashSet::new(),
        }
    }

    pub fn open_count(&self) -> usize {
        self.open.len()
    }

    pub fn alloc(&mut self) -> Result<u64, ProtocolError> {
        if self.open.len() >= MAX_CONNS {
            return Err(ProtocolError::Cap);
        }
        let id = self.next;
        self.next = self
            .next
            .checked_add(1)
            .ok_or(ProtocolError::ConnExhausted)?;
        self.open.insert(id);
        Ok(id)
    }

    /// Mac side. The VM already chose `id`. It must be the next monotonic id.
    /// At the cap the id is still consumed so a later id cannot collide with it.
    pub fn admit(&mut self, id: u64) -> Result<Admit, ProtocolError> {
        if id != self.next {
            return Err(ProtocolError::BadConn);
        }
        self.next = self
            .next
            .checked_add(1)
            .ok_or(ProtocolError::ConnExhausted)?;
        if self.open.len() >= MAX_CONNS {
            return Ok(Admit::Cap);
        }
        self.open.insert(id);
        Ok(Admit::Opened)
    }

    pub fn require_open(&self, id: u64) -> Result<(), ProtocolError> {
        if self.open.contains(&id) {
            Ok(())
        } else {
            Err(ProtocolError::BadConn)
        }
    }

    pub fn close(&mut self, id: u64) -> Result<(), ProtocolError> {
        if self.open.remove(&id) {
            Ok(())
        } else {
            Err(ProtocolError::BadConn)
        }
    }
}

impl Default for IdWindow {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Default)]
pub struct HelloOnce {
    seen: bool,
}

impl HelloOnce {
    pub fn new() -> Self {
        Self { seen: false }
    }

    pub fn observe(&mut self) -> Result<(), ProtocolError> {
        if self.seen {
            return Err(ProtocolError::SecondHello);
        }
        self.seen = true;
        Ok(())
    }
}

/// One live control connection. Admitting another returns the generation to close.
#[derive(Debug, Default)]
pub struct SessionGate {
    current: u64,
}

impl SessionGate {
    pub fn new() -> Self {
        Self { current: 0 }
    }

    pub fn admit(&mut self) -> (u64, Option<u64>) {
        let prev = (self.current != 0).then_some(self.current);
        self.current += 1;
        (self.current, prev)
    }

    pub fn is_current(&self, generation: u64) -> bool {
        self.current == generation
    }
}

/// 1, 2, 4, 8, 16, then 30 seconds, plus up to 1 second of jitter.
pub fn reconnect_delay(attempt: u32, jitter: Duration) -> Duration {
    let base = match attempt {
        0 => 1,
        1 => 2,
        2 => 4,
        3 => 8,
        4 => 16,
        _ => 30,
    };
    Duration::from_secs(base) + jitter.min(Duration::from_secs(1))
}

/// 15 seconds plus up to 2 seconds of jitter.
pub fn ping_interval(jitter: Duration) -> Duration {
    PING_INTERVAL + jitter.min(Duration::from_secs(2))
}

pub fn tunnel_dead(since_pong: Duration) -> bool {
    since_pong >= PONG_TIMEOUT
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_start_at_one_and_a_closed_id_is_not_reused() {
        let mut ids = IdWindow::new();
        assert_eq!(ids.alloc().unwrap(), 1);
        assert_eq!(ids.alloc().unwrap(), 2);
        ids.close(1).unwrap();
        assert!(ids.require_open(1).is_err());
        assert!(ids.close(1).is_err());
        assert_eq!(ids.alloc().unwrap(), 3);
        assert!(ids.require_open(2).is_ok());
    }

    #[test]
    fn cap_is_64_and_the_next_id_stays_monotonic() {
        let mut ids = IdWindow::new();
        for expected in 1..=64 {
            assert_eq!(ids.alloc().unwrap(), expected);
        }
        assert_eq!(ids.alloc().unwrap_err(), ProtocolError::Cap);
        ids.close(1).unwrap();
        assert_eq!(ids.alloc().unwrap(), 65);
    }

    #[test]
    fn mac_rejects_a_skipped_or_reused_id_and_consumes_a_capped_id() {
        let mut ids = IdWindow::new();
        assert_eq!(ids.admit(2).unwrap_err(), ProtocolError::BadConn);
        assert_eq!(ids.admit(1).unwrap(), Admit::Opened);
        ids.close(1).unwrap();
        assert_eq!(ids.admit(1).unwrap_err(), ProtocolError::BadConn);
        for id in 2..=65 {
            assert_eq!(ids.admit(id).unwrap(), Admit::Opened);
        }
        assert_eq!(ids.open_count(), 64);
        assert_eq!(ids.admit(66).unwrap(), Admit::Cap);
        assert!(ids.require_open(66).is_err());
        assert_eq!(ids.admit(67).unwrap(), Admit::Cap);
    }

    #[test]
    fn second_hello_and_session_replacement() {
        let mut hello = HelloOnce::new();
        hello.observe().unwrap();
        assert_eq!(hello.observe().unwrap_err(), ProtocolError::SecondHello);

        let mut gate = SessionGate::new();
        let (first, prev) = gate.admit();
        assert_eq!((first, prev), (1, None));
        let (second, prev) = gate.admit();
        assert_eq!((second, prev), (2, Some(1)));
        assert!(!gate.is_current(1));
        assert!(gate.is_current(2));
    }

    #[test]
    fn backoff_and_ping_deadline() {
        assert_eq!(reconnect_delay(0, Duration::ZERO), Duration::from_secs(1));
        assert_eq!(reconnect_delay(1, Duration::ZERO), Duration::from_secs(2));
        assert_eq!(reconnect_delay(4, Duration::ZERO), Duration::from_secs(16));
        assert_eq!(reconnect_delay(5, Duration::ZERO), Duration::from_secs(30));
        assert_eq!(
            reconnect_delay(9, Duration::from_millis(1500)),
            Duration::from_secs(31)
        );
        assert_eq!(
            ping_interval(Duration::from_secs(5)),
            Duration::from_secs(17)
        );
        assert!(!tunnel_dead(Duration::from_secs(44)));
        assert!(tunnel_dead(Duration::from_secs(45)));
    }
}
