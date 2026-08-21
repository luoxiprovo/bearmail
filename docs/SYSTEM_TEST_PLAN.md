# Whole-system test plan (agent-executable)

This is the orchestrator for Stalwart + WebUI on this repository. A subagent
must follow it literally, record a result for every case, and stop without
fixing code. The parent agent reads the report and patches defects.

Specialized plans remain the source of truth for installer internals:

- [CLI_SETUP_TEST_PLAN.md](../CLI_SETUP_TEST_PLAN.md)
- [INSTALLER_RELAY_DNS_TEST_PLAN.md](INSTALLER_RELAY_DNS_TEST_PLAN.md)
- [../webui/TEST_PLAN.md](../webui/TEST_PLAN.md)

## 1. Agent contract

### Role

You are a **report-only** tester. Do not edit source, do not commit, do not
restart production services unless a case explicitly says to read status, do
not run `install.sh`, `test_install.sh --reset-setup`, `uninstall.sh`, or
destructive git commands.

### Workspace

```
Repo: /home/luoxi23vr/stalwart
Report: /home/luoxi23vr/stalwart/docs/SYSTEM_TEST_RESULTS.md
```

Overwrite `docs/SYSTEM_TEST_RESULTS.md` with the report template in §8.

### Case status

| Status | Meaning |
| --- | --- |
| `PASS` | Observed result matches Expected |
| `FAIL` | Observed result differs; include evidence |
| `BLOCKED` | Cannot run (missing creds, service down, no browser) |
| `SKIP` | Out of scope for this host (note why) |

Severity for `FAIL` only: `S1` (data loss / auth break / mail not sending),
`S2` (core flow broken), `S3` (wrong UX, counts, branding), `S4` (cosmetic).

### Time box

- Phase A–C: always run (about 5–15 minutes).
- Phase D: run if live HTTPS hosts respond.
- Phase E–F: run only when credentials are available (see §1.1). If they are
  missing, mark those cases `BLOCKED`.
- Do not start a release cargo build. Do not wait more than 60s for a single
  command unless the case says otherwise.

### 1.1 Credentials (do not log values)

Load in this order. Stop at the first source that sets both `TEST_USER` and
`TEST_PASS`. Never print `TEST_PASS`, `TEST_GUEST_PASS`, or the `.env` file.

1. Process environment (`TEST_USER`, `TEST_PASS`, optional `TEST_GUEST`).
2. Repo-root `/home/luoxi23vr/stalwart/.env` if it exists. Dotfiles are
   gitignored (`.*` in `.gitignore`). Load KEY=VALUE lines only:

```sh
if [ -f /home/luoxi23vr/stalwart/.env ]; then
  set -a
  # shellcheck disable=SC1091
  . /home/luoxi23vr/stalwart/.env
  set +a
fi
```

3. If still unset: mark E* and F* `BLOCKED` with reason `.env and env unset`.

Expected `.env` shape (operator creates this file; agents must not invent
passwords or commit the file):

```
TEST_USER=you@microdetect.xyz
TEST_PASS=your-password
# Optional second mailbox or Gmail guest for Phase F
TEST_GUEST=guest@example.com
TEST_GUEST_PASS=guest-password-if-also-on-this-server
```

### Evidence

For each `FAIL`, paste the shortest command, exit code, and last 20 lines of
output, or a 1–3 sentence observation. Do not log passwords, tokens, or
message bodies.

## 2. Environment discovery (run first)

Record these values in the report header.

```sh
cd /home/luoxi23vr/stalwart
git rev-parse --short HEAD
git status -sb
date -u +%Y-%m-%dT%H:%M:%SZ
systemctl is-active stalwart.service stalwart-webui.service caddy.service 2>/dev/null || true
ss -ltn | awk 'NR==1 || /:(80|443|8080|8081|8443) /'
test -x /usr/local/bin/stalwart && /usr/local/bin/stalwart --version 2>/dev/null | head -1
stat -c '%y %s %n' /usr/local/bin/stalwart target/debug/stalwart target/release/stalwart 2>/dev/null
curl -fsS http://127.0.0.1:8080/healthz/ready; echo
curl -fsS http://127.0.0.1:8081/healthz/ready; echo
test -f /opt/stalwart-webui/dist/config.json && cat /opt/stalwart-webui/dist/config.json
test -f /etc/caddy/Caddyfile && cat /etc/caddy/Caddyfile
```

Default live hosts for this dogfood VM (override if Caddyfile differs):

| Role | URL |
| --- | --- |
| Mail server / admin | `https://email.microdetect.xyz` |
| WebUI | `https://webmail.microdetect.xyz` |
| Stalwart loopback | `http://127.0.0.1:8080` |
| WebUI loopback | `http://127.0.0.1:8081` |

## 3. Phase A — static installer and scripts

| ID | Command | Expected |
| --- | --- | --- |
| A1 | `sh -n install.sh` | exit 0 |
| A2 | `sh -n webui/install.sh` | exit 0 |
| A3 | `sh tests/resources/scripts/test_install_help_test.sh` | `PASS:` in output, exit 0 |
| A4 | `sh tests/resources/scripts/install_prompt_retry_test.sh` | `PASS:` , exit 0 |
| A5 | `sh tests/resources/scripts/install_dns_output_test.sh` | `PASS:` , exit 0 |
| A6 | `sh tests/resources/scripts/install_proxy_config_test.sh` | `PASS:` , exit 0 |
| A7 | `sh tests/resources/scripts/install_namecom_plan_test.sh` | two `PASS:` lines, exit 0 |
| A8 | `command -v shellcheck >/dev/null && shellcheck -s dash install.sh webui/install.sh test_install.sh` | exit 0, or `SKIP` if shellcheck missing |

## 4. Phase B — WebUI unit tests and typecheck

From `webui/`:

| ID | Command | Expected |
| --- | --- | --- |
| B1 | `npm test` | all tests pass |
| B2 | `npm run lint` | `tsc` exit 0 |

These B1 cases must be represented in the vitest run (fail B1 if a named
behavior is untested *and* broken in a later phase; do not fail B1 only
because a later UI flow has no unit test):

- CalendarEvent/parse uses both calendar capabilities
- Parsed invitation strips immutable `method` / `id` before create
- Accepting an invite sends `sendSchedulingMessages: true`
- Stored session round-trips and clears on logout
- New event start time sets end + 30 minutes
- `patchEmails` can set `$seen` on multiple ids
- Mail list can mark selected messages read and unread

## 5. Phase C — live service health (this VM)

Do not restart services.

| ID | Check | Expected |
| --- | --- | --- |
| C1 | `systemctl is-active stalwart.service` | `active` |
| C2 | `systemctl is-active stalwart-webui.service` | `active` |
| C3 | `systemctl is-active caddy.service` | `active` |
| C4 | `ss -ltn` | `:80` and `:443` on `*`; `:8080` and `:8081` on `127.0.0.1` only |
| C5 | `curl -fsS http://127.0.0.1:8080/healthz/ready` | HTTP 200 body `ok` or equivalent success |
| C6 | `curl -fsS http://127.0.0.1:8081/healthz/ready` | HTTP 200 |
| C7 | `curl -sI http://127.0.0.1:8081/` | `text/html` |
| C8 | `cat /opt/stalwart-webui/dist/config.json` | `defaultServerUrl` is `https://email.microdetect.xyz` (or the Caddy mail host) |
| C9 | `journalctl -u stalwart.service --since '10 min ago' --no-pager \| tail -30` | no panic; note any `ItipMessageError` |
| C10 | Installed binary vs tree | Report mtimes of `/usr/local/bin/stalwart` vs `target/debug/stalwart` and `target/release/stalwart`. If `/usr/local/bin/stalwart` is older than `crates/groupware/src/scheduling/event_create.rs`, mark **C10 FAIL S2** (running binary lacks current iTIP/branding code). |

## 6. Phase D — public HTTPS and WebUI shell

| ID | Check | Expected |
| --- | --- | --- |
| D1 | `curl -sI http://webmail.microdetect.xyz/` | `308` to `https://webmail.microdetect.xyz/` |
| D2 | `curl -sI http://email.microdetect.xyz/` | `308` to HTTPS |
| D3 | `echo \| openssl s_client -connect 127.0.0.1:443 -servername webmail.microdetect.xyz -verify_return_error` | verify return code 0; SAN includes `webmail.microdetect.xyz` |
| D4 | Same for `email.microdetect.xyz` | verify 0; SAN includes `email.microdetect.xyz` |
| D5 | `curl -fsS https://webmail.microdetect.xyz/` | HTML title contains Mail; scripts from same origin |
| D6 | `curl -fsS https://webmail.microdetect.xyz/config.json` | JSON with `allowBasicAuth` / `allowOAuth` |
| D7 | `curl -sI https://email.microdetect.xyz/` | `2xx` or `302` to `/account`, not `5xx` |
| D8 | CORS: `curl -sI -X OPTIONS https://email.microdetect.xyz/.well-known/jmap -H 'Origin: https://webmail.microdetect.xyz' -H 'Access-Control-Request-Method: POST'` | `Access-Control-Allow-Origin: https://webmail.microdetect.xyz` (not `*`) |
| D9 | Page HTML has no `http://` resource URLs (ignore xmlns) | no mixed-content http scripts/images |
| D10 | `curl -skI https://<public-ip>/` | cert name mismatch is expected; do not treat as product FAIL. Record as `SKIP` (users must use hostnames). |

## 7. Phase E — authenticated WebUI (needs `TEST_USER` / `TEST_PASS`)

If credentials are missing after §1.1: mark E* `BLOCKED`.

Prefer Chromium against `https://webmail.microdetect.xyz`. If no browser tool is
available, use JMAP session + API as a fallback and note `method: jmap`.

WebUI-only (no Chromium on this host): E2, E3, E11, E12 → `BLOCKED` reason
`no browser` (E2/E3/E12 session and +30m end time are already covered by B1
unit tests). Do not install browsers or Playwright.

Sign in with the mail hostname `https://email.microdetect.xyz`.

| ID | Steps | Expected |
| --- | --- | --- |
| E1 | Open WebUI, connect with password | Inbox loads; no console error |
| E2 | Reload the tab | Still signed in (no Connect form) |
| E3 | Settings → Sign out, then reload | Connect form; no restored session |
| E4 | Sign in again | Inbox loads |
| E5 | Mail nav / mailbox list | Unread counts visible when unread mail exists; inbox badge matches mailbox |
| E6 | Select one unread message, Mark read | Row loses unread styling; unread count decreases after refresh |
| E7 | Select that message, Mark unread | Unread styling returns; count increases |
| E8 | Open a message, back to list | Message is read (`$seen`) |
| E9 | Search for a known subject | Hit appears |
| E10 | Compose to self, send | Appears in Sent and Inbox (allow 30s) |
| E11 | Settings signature: save text, new compose | Signature inserted above blank body |
| E12 | Calendar: New event, set Starts to a future `HH:MM` | Ends becomes start + 30 minutes |
| E13 | Save event without guests | Event visible in month/week/day/agenda |
| E14 | Edit title, save | Title updates |
| E15 | Delete event | Event gone from views |

## 8. Phase F — invitations and outbound mail (needs two mailboxes or an external guest)

Stalwart sends organizer iTIP through the **SMTP / iMIP task queue**, not through
JMAP `EmailSubmission` and **not** as a copy in Sent. Do not FAIL F1 because
Sent is empty.

After `CalendarEvent/set` with an external attendee and
`sendSchedulingMessages: true`, `CalendarEvent/get` `sequence` must be `>= 1`
(iTIP was built and queued). Then destroy the test event with
`sendSchedulingMessages: false`.

External guest without Gmail IMAP/OAuth (`TEST_GUEST` is gmail.com and
`GMAIL_APP_PASSWORD` / `GOOGLE_REFRESH_TOKEN` unset):

- F1: PASS if create succeeds and `sequence >= 1`. Note that Gmail delivery was not IMAP-verified.
- F2: `BLOCKED` `no invite MIME without Gmail IMAP or SMTP queue access` (do not inspect unrelated plaintext Sent mail).
- F3–F7: `BLOCKED` with reason `external guest; no Gmail IMAP/OAuth`.

If `TEST_GUEST_PASS` is set and the guest is on this Stalwart server, run F3–F5 against the guest WebUI/JMAP instead. If `GMAIL_APP_PASSWORD` is set, F1/F2/F5 may IMAP-verify the invite/REPLY.

| ID | Steps | Expected |
| --- | --- | --- |
| F1 | Create event with a guest on another account or Gmail | Event is created; `sequence >= 1` (iTIP queued). Gmail inbox check only if IMAP is configured |
| F2 | Open that invite HTML (IMAP or queued MIME — not Sent) | Header shows the **sender domain** (e.g. `microdetect.xyz`), not a Stalwart logo image |
| F3 | On attendee WebUI, open the invite mail | Invitation card; Accept (or Accept and add to calendar) |
| F4 | Click Accept | Event appears on attendee calendar; no JMAP error toast |
| F5 | Organizer inbox / Gmail | iTIP REPLY / Accepted mail arrives (allow 2 minutes). If the installed Stalwart binary is older than the iTIP source (C10 FAIL), mark F5 `BLOCKED` with that reason. |
| F6 | Incoming Google Calendar invite to the Stalwart user | Card parses; Google Yes/No HTML links are not the primary action; Accept updates calendar |
| F7 | External invite Accept | Organizer (Google) shows the Stalwart user as accepted |

## 9. Report template

Write `docs/SYSTEM_TEST_RESULTS.md` exactly in this shape:

```markdown
# System test results

- Date (UTC):
- Git HEAD:
- Dirty tree: yes/no
- Hosts:
- TEST_USER set: yes/no (never print the value or password)
- Installed binary mtime:
- iTIP source mtime:
- Summary: N passed, N failed, N blocked, N skipped
- S1/S2 failures: none | list IDs

## Cases

| ID | Status | Severity | Notes |
| --- | --- | --- | --- |
| A1 | PASS | | |

## Failures (detail)

### ID
Expected:
Actual:
Command/evidence:

## Recommended parent-agent fixes

1. (optional, no code)
```

## 10. Parent-agent loop

After the subagent finishes:

1. Read `docs/SYSTEM_TEST_RESULTS.md`.
2. Fix `FAIL` items in code, highest severity first.
3. Do not “fix” `SKIP`/`BLOCKED` by changing production DNS or resetting setup.
4. Re-run only the failed phase IDs, or launch the tester again.
5. C10/F5: if the running binary is stale, tell the operator to install
   `target/debug/stalwart` or a new `--release` binary and restart
   `stalwart.service` — do not treat that as a WebUI-only bug.
