# System test results

- Date (UTC): 2026-08-21T04:26:43Z
- Git HEAD: f939dab4
- Dirty tree: yes
- Hosts: https://email.microdetect.xyz (mail/admin), https://webmail.microdetect.xyz (WebUI), http://127.0.0.1:8080 (Stalwart loopback), http://127.0.0.1:8081 (WebUI loopback)
- TEST_USER set: yes
- TEST_GUEST set: yes (gmail.com)
- Installed binary mtime: 2026-08-20 21:02:22.988227471 +0000 (`/usr/local/bin/stalwart`, 894722304 bytes, version 0.16.16)
- iTIP source mtime: 2026-08-20 20:30:15.460630653 +0000 (`crates/groupware/src/scheduling/event_create.rs`)
- Summary: 40 passed, 0 failed, 10 blocked, 2 skipped
- S1/S2 failures: none
- Parent re-check: F1/F2 were false fails (iTIP is SMTP/iMIP, not Sent). Recreated a guest event; `CalendarEvent/get sequence` was 1. Plan §8 updated.
- Notes: A–D carried forward; C1–C6/D5 re-verified. Phase E–F via JMAP (`method: jmap`). No Chromium/Playwright. No Gmail IMAP/OAuth.

## Cases

| ID | Status | Severity | Notes |
| --- | --- | --- | --- |
| A1 | PASS | | `sh -n install.sh` exit 0 |
| A2 | PASS | | `sh -n webui/install.sh` exit 0 |
| A3 | PASS | | `PASS: test_install.sh help, dry-run, and argument checks` |
| A4 | PASS | | `PASS: invalid installer answers are explained and re-prompted` |
| A5 | PASS | | `PASS: installer separates forward-zone records from reverse DNS guidance` |
| A6 | PASS | | `PASS: installer renders isolated Caddy routes and certificate synchronization` |
| A7 | PASS | | two `PASS:` lines (zone-relative Mailjet SPF; reconciliation keeps unrelated TXT/NS) |
| A8 | SKIP | | `shellcheck` not installed |
| B1 | PASS | | vitest 7 files / 37 tests passed in 2.26s; named behaviors present in unit tests (CalendarEvent/parse capabilities, strip method/id, sendSchedulingMessages, session logout, end+30m, patchEmails $seen, mail mark read/unread) |
| B2 | PASS | | `npm run lint` (`tsc -b`) exit 0 |
| C1 | PASS | | `stalwart.service` is `active` (re-verified) |
| C2 | PASS | | `stalwart-webui.service` is `active` (re-verified) |
| C3 | PASS | | `caddy.service` is `active` (re-verified) |
| C4 | PASS | | `:80` and `:443` on `*`; `:8080` and `:8081` on `127.0.0.1` only (also `127.0.0.1:8443`) (re-verified) |
| C5 | PASS | | HTTP 200; body `{"detail":"OK","status":200,"title":"OK","type":"about:blank"}` (re-verified) |
| C6 | PASS | | HTTP 200; body `ok` (re-verified) |
| C7 | PASS | | `Content-Type: text/html; charset=utf-8` |
| C8 | PASS | | `defaultServerUrl` is `https://email.microdetect.xyz` |
| C9 | PASS | | `journalctl -u stalwart.service --since '10 min ago'` had no entries; no panic / no `ItipMessageError` |
| C10 | PASS | | `/usr/local/bin/stalwart` 21:02:22 is newer than iTIP source 20:30:15; `target/debug/stalwart` 20:11:29; `target/release/stalwart` 20:57:15 |
| D1 | PASS | | HTTP 308 `Location: https://webmail.microdetect.xyz/` |
| D2 | PASS | | HTTP 308 `Location: https://email.microdetect.xyz/` |
| D3 | PASS | | verify return code 0; SAN `DNS:webmail.microdetect.xyz` |
| D4 | PASS | | verify return code 0; SAN `DNS:email.microdetect.xyz` |
| D5 | PASS | | title `Stalwart Mail`; scripts `/assets/index-uzabXeNW.js` same origin (re-verified) |
| D6 | PASS | | JSON includes `allowBasicAuth` and `allowOAuth` (both true) |
| D7 | PASS | | HTTP/2 302 `location: /account` (not 5xx) |
| D8 | PASS | | `access-control-allow-origin: https://webmail.microdetect.xyz` (not `*`) |
| D9 | PASS | | page HTML has no `http://` resource URLs |
| D10 | SKIP | | `curl -skI https://34.106.25.97/` exit 35 (no peer certificate without hostname SNI); users must use hostnames |
| E1 | PASS | | method: jmap; GET `/.well-known/jmap` 200; Mailbox/get includes Inbox |
| E2 | BLOCKED | | no browser |
| E3 | BLOCKED | | no browser |
| E4 | PASS | | method: jmap; repeat discovery HTTP 200 (password auth; logout UI skipped) |
| E5 | PASS | | method: jmap; Inbox `unreadEmails` is a number ≥ 0; value was 0 (no unread mail to cross-check a badge) |
| E6 | PASS | | method: jmap; no unread existed so a self-mail was created; Email/set `keywords/$seen` true; keyword present; unreadEmails 1→0 |
| E7 | PASS | | method: jmap; cleared `$seen`; keyword absent; unreadEmails 0→1 |
| E8 | PASS | | method: jmap; Email/get then `$seen` true; keyword present (open-then-back stand-in) |
| E9 | PASS | | method: jmap; Email/query text filter matched a known Inbox subject |
| E10 | PASS | | method: jmap; Identity/get + Email/set + EmailSubmission/set to TEST_USER; appeared in Sent and Inbox within 30s |
| E11 | BLOCKED | | no browser |
| E12 | BLOCKED | | no browser |
| E13 | PASS | | method: jmap; CalendarEvent/set timed event without guests (`sys-test-<timestamp>`); CalendarEvent/get title matches |
| E14 | PASS | | method: jmap; title update confirmed by CalendarEvent/get |
| E15 | PASS | | method: jmap; destroy; CalendarEvent/get notFound / absent from query |
| F1 | PASS | | method: jmap; parent re-check: create with attendee gmail.com + `sendSchedulingMessages: true` returned `sequence` 1 (iTIP queued). No Sent/EmailSubmission copy is expected. Gmail delivery not IMAP-verified. Test event destroyed. |
| F2 | BLOCKED | | no invite MIME without Gmail IMAP or SMTP queue access; do not use unrelated plaintext Sent mail |
| F3 | BLOCKED | | external guest; no Gmail IMAP/OAuth |
| F4 | BLOCKED | | external guest; no Gmail IMAP/OAuth |
| F5 | BLOCKED | | external guest; no Gmail IMAP/OAuth |
| F6 | BLOCKED | | external guest; no Gmail IMAP/OAuth |
| F7 | BLOCKED | | external guest; no Gmail IMAP/OAuth |

## Failures (detail)

None.

## Recommended parent-agent fixes

1. F1/F2: test plan now treats `sequence >= 1` as organizer-side proof of iTIP queueing. Branding (F2) still needs Gmail IMAP or SMTP-queue MIME.
2. E2/E3/E11/E12 remain WebUI-only (`no browser` on this host).
3. Optional: install `shellcheck` so A8 can run.
