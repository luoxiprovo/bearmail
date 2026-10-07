//! Egress pause line. The forwarder stops before the next DATA frame once
//! transmitted bytes reach 0.90 GiB. One already-read frame may cross the line.

use crate::frame::ProtocolError;

/// `0.90 × 2^30`, truncated. 966,367,641 bytes.
pub const PAUSE_AT: u64 = (9 * (1_u64 << 30)) / 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum QuotaState {
    Open = 0,
    PausedQuota = 1,
    Override = 2,
}

impl QuotaState {
    pub fn from_u8(v: u8) -> Result<Self, ProtocolError> {
        match v {
            0 => Ok(Self::Open),
            1 => Ok(Self::PausedQuota),
            2 => Ok(Self::Override),
            _ => Err(ProtocolError::BadState),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Meter {
    tx_bytes: u64,
    override_on: bool,
}

impl Meter {
    pub fn new(tx_bytes: u64, override_on: bool) -> Self {
        Self {
            tx_bytes,
            override_on,
        }
    }

    pub fn tx_bytes(&self) -> u64 {
        self.tx_bytes
    }

    pub fn state(&self) -> QuotaState {
        if self.override_on {
            QuotaState::Override
        } else if self.tx_bytes >= PAUSE_AT {
            QuotaState::PausedQuota
        } else {
            QuotaState::Open
        }
    }

    /// False once the pause line has been reached, unless the operator
    /// override is on. Callers stop before reading another DATA frame.
    pub fn data_allowed(&self) -> bool {
        self.override_on || self.tx_bytes < PAUSE_AT
    }

    /// Count bytes already written toward the public internet.
    /// `true` means this write reached the pause line.
    pub fn note_tx(&mut self, n: u64) -> bool {
        self.tx_bytes = self.tx_bytes.saturating_add(n);
        !self.data_allowed()
    }

    pub fn roll_month(&mut self) {
        self.tx_bytes = 0;
    }
}

/// NIC `tx_bytes` sample. A drop in the raw counter is a reboot:
/// `cumulative += raw` when `raw < last_raw`. `last_raw` stays the baseline
/// across a month roll so the next sample counts only the new delta.
#[derive(Debug, Clone)]
pub struct NicCounter {
    pub cumulative: u64,
    pub last_raw: u64,
}

impl NicCounter {
    pub fn new() -> Self {
        Self {
            cumulative: 0,
            last_raw: 0,
        }
    }

    pub fn sample(&mut self, raw: u64) -> u64 {
        if raw < self.last_raw {
            self.cumulative = self.cumulative.saturating_add(raw);
        } else {
            self.cumulative = self.cumulative.saturating_add(raw - self.last_raw);
        }
        self.last_raw = raw;
        self.cumulative
    }

    pub fn roll_month(&mut self) {
        self.cumulative = 0;
    }
}

impl Default for NicCounter {
    fn default() -> Self {
        Self::new()
    }
}

/// UTC year and month from a Unix timestamp. Days follow the civil calendar
/// (Howard Hinnant), so the quota month does not depend on the process timezone.
pub fn utc_year_month(unix_secs: u64) -> (u16, u8) {
    let z = (unix_secs / 86_400) as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    (year as u16, month as u8)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pause_line_is_zero_point_nine_gib() {
        assert_eq!(PAUSE_AT, 966_367_641);
        assert_eq!(PAUSE_AT, (9 * (1_u64 << 30)) / 10);
    }

    #[test]
    fn one_data_frame_may_cross_then_the_next_is_refused() {
        let mut meter = Meter::new(PAUSE_AT - 10, false);
        assert!(meter.data_allowed());
        assert!(meter.note_tx(16_384));
        assert!(!meter.data_allowed());
        assert_eq!(meter.tx_bytes(), PAUSE_AT - 10 + 16_384);
        assert_eq!(meter.state(), QuotaState::PausedQuota);
        assert!(meter.note_tx(1));
        assert!(!meter.data_allowed());
    }

    #[test]
    fn exact_pause_line_stops_before_the_next_data_frame() {
        let mut meter = Meter::new(PAUSE_AT - 1, false);
        assert!(meter.note_tx(1));
        assert!(!meter.data_allowed());
        assert_eq!(meter.state(), QuotaState::PausedQuota);
    }

    #[test]
    fn override_keeps_forwarding_and_month_roll_clears_the_counter() {
        let mut meter = Meter::new(PAUSE_AT + 50, true);
        assert!(meter.data_allowed());
        assert_eq!(meter.state(), QuotaState::Override);
        assert!(!meter.note_tx(10));
        meter.roll_month();
        assert_eq!(meter.tx_bytes(), 0);
        assert_eq!(meter.state(), QuotaState::Override);
        let mut paused = Meter::new(PAUSE_AT, false);
        paused.roll_month();
        assert_eq!(paused.state(), QuotaState::Open);
        assert!(paused.data_allowed());
    }

    #[test]
    fn nic_reboot_adds_the_new_raw_and_month_roll_keeps_the_baseline() {
        let mut nic = NicCounter::new();
        assert_eq!(nic.sample(100), 100);
        assert_eq!(nic.sample(150), 150);
        assert_eq!(nic.sample(10), 160);
        assert_eq!(nic.last_raw, 10);
        nic.roll_month();
        assert_eq!(nic.cumulative, 0);
        assert_eq!(nic.last_raw, 10);
        assert_eq!(nic.sample(25), 15);
    }

    #[test]
    fn utc_month_for_a_known_instant() {
        // 2026-09-30 00:00:00 UTC.
        assert_eq!(utc_year_month(1_790_726_400), (2026, 9));
        assert_eq!(utc_year_month(1_767_225_600), (2026, 1));
    }
}
