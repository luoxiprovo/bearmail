# BearMail MCP test plan

Status: v1
Date: 2026-08-28
Target: `mcp/` (bearmail-mcp) against [AGENT_MCP_SPEC.md](./AGENT_MCP_SPEC.md) Phase 1
How to run: `cd mcp && npm test`

This plan is for a reviewer or test agent. Do not log credentials. Prefer the mock JMAP server in `mcp/test/mock-jmap.ts` unless a live Stalwart is explicitly available.

## Setup

```sh
cd mcp
npm install
npm test
npx tsc -p tsconfig.json --noEmit
```

## A. Automated coverage (must PASS)

| ID | Spec item | How to verify | Expected |
| --- | --- | --- | --- |
| A1 | Mail + Submission + Calendars session advertises mail and calendar tools | `whoami` / in-memory `listTools` | `send_email`, `create_event`, `list_inbox` present |
| A2 | `send_email` + `create_event` with attendees | account tests | `EmailSubmission/set` with Drafts→Sent; `sendSchedulingMessages: true`; sequence ≥ 1 |
| A3 | Mail-only session | calendars disabled in mock | `create_event` absent or `capabilityMissing` |
| A4 | Draft-only token | `BEARMAIL_SEND_MODE=draft-only` | `send_email` status `draft`; no `EmailSubmission/set` |
| A5 | Missing `mail.send` | scopes without `mail.send` | tool omitted / `missingScope`; fail closed |
| A6 | `get_thread` does not return raw active HTML | HTML + script fixture | plain text, `untrusted_content`, no `<script` |
| A7 | Same calendar state after MCP create | `create_event` then `list_events` | created id present |
| A8 | HTTP MCP requires Authorization | POST `/mcp` without header | 401 |
| A9 | Discovery has no secrets | `/.well-known/mcp.json` | no app password or token values |
| A10 | Typecheck | `tsc --noEmit` | clean |

## B. Security and policy (must PASS)

| ID | Check | Expected |
| --- | --- | --- |
| B1 | Server URL with embedded credentials rejected | `loadConfig` throws |
| B2 | Default send mode is draft-only | `mail.send` not granted by default |
| B3 | Send quota | second send with cap 1 throws |
| B4 | Attachment download is size-capped base64 | mock `file-1` round-trips; no execution |
| B5 | No admin / raw JMAP tools | `listTools` has no admin or passthrough |
| B6 | Audit lines on stderr do not include bodies or tokens | whoami audit JSON only |

## C. Protocol and packaging (must PASS or note BLOCKED)

| ID | Check | Expected |
| --- | --- | --- |
| C1 | Stdio entry exists | `mcp/src/stdio.ts` loads config from env, uses StdioServerTransport |
| C2 | HTTP entry binds loopback by default | `BEARMAIL_MCP_HOST=127.0.0.1`, path `/mcp` |
| C3 | Stalwart serves `GET /.well-known/mcp.json` | handler in `crates/http/src/request.rs`; CORS unrestricted; no secrets |
| C4 | Installer prints agent snippet | `install.sh` completion names discovery URL and env vars; no tokens as arguments |
| C5 | Example Cursor config | `mcp/mcp.json.example` uses env, not a primary password |

## D. Live Stalwart (optional)

If a local Stalwart with Mail + Submission + Calendars is running, repeat A2/A4/A7 against it. Otherwise mark **BLOCKED** with reason `no live Stalwart`. Do not fail the plan for D.

## Verdict

- **PASS** if A and B all pass and C is present in tree.
- **FAIL** if any A/B automated check fails or a tool returns unsanitized HTML, sends in draft-only mode, or exposes secrets.
- Record file, test name, and a one-line fix suggestion for each FAIL.
