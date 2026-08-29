# BearMail AI Agent MCP Specification

Status: Draft v0.1
Date: 2026-08-28
Audience: Product, backend, security, installer, and QA
Depends on: Stalwart JMAP (Mail, Submission, Calendars), existing OAuth and API-key (Bearer) auth, WebUI as the human client of the same data

## 1. Product summary

BearMail is a self-hosted mail and calendar stack. Humans already use the WebUI over JMAP. This spec adds an **MCP (Model Context Protocol) server** so AI agents can use the same mailboxes and calendars through typed tools, not IMAP, SMTP, or the WebUI.

The MCP server is a client of Stalwart, not a second mail store. It discovers the JMAP session and performs mail, submission, calendar, identity, attachment, and (when advertised) push operations over HTTPS. Outbound delivery and meeting invites to other domains remain SMTP and iMIP. Agents on other mail systems, and people on Gmail or Outlook, stay reachable without running BearMail.

A BearMail domain gives each agent a real address on the company domain (`scheduler@startup.com`) instead of a shared consumer inbox.

This spec does not add a CLI. A command-line client may wrap the same JMAP library later; it is out of scope here.

## 2. Terminology

| Term | Meaning |
| --- | --- |
| **Agent** | A non-human client that calls MCP tools (Cursor, Claude Desktop, a custom MCP host, or a long-running worker). |
| **Agent mailbox** | A Stalwart account with an email address used by an agent. Same data model as a human account. |
| **MCP server** | The BearMail process that exposes mail and calendar tools over MCP. Working name: `bearmail-mcp`. |
| **Host** | The MCP client process (for example Cursor) that connects to `bearmail-mcp` and presents tools to the model. |
| **Human client** | The BearMail WebUI, or any other JMAP/CalDAV client. |
| **Federation** | Mail and invites leaving this server over SMTP/iMIP. |

"AI-agent friendly" means: named tools, machine authentication, push or webhooks instead of IMAP polling, scoped tokens, and a mailbox per agent. It does not mean a new global messaging network.

## 3. Goals

### 3.1 Primary goals

1. Let an MCP-aware agent list mail, read a thread, send or draft mail, inspect availability, create events, and RSVP, using the authenticated JMAP account.
2. Keep Stalwart as the only mailbox and calendar database. WebUI, MCP, IMAP, and CalDAV must see the same state.
3. Give each agent its own mailbox and scoped credentials. Do not put agent traffic in a human inbox by default.
4. Use email and iMIP as the path to people and to agents on other domains.
5. Ship discovery and installer output so a startup can connect an agent after install without reading JMAP RFCs.
6. Prefer draft-then-approve for untrusted or high-impact send, with an explicit send-now mode for trusted agent mailboxes.

### 3.2 Success measures

After a standard BearMail install, an administrator can create an agent mailbox, issue a Stalwart API key, and point an MCP host at the server. Without writing JMAP by hand, an agent can:

1. Authenticate and report `whoami` (address, identities, advertised capabilities).
2. List unread inbox messages and read one thread.
3. Create a draft or send a message to a human address.
4. Check free/busy, create a timed event, and invite a Gmail (or other external) attendee so a normal iMIP invitation is delivered.
5. Appear as the actor in an audit log the administrator can inspect.

A meeting created through MCP is visible in the WebUI calendar without a manual refresh once JMAP state has updated. An RSVP performed in the WebUI is visible to the agent on the next `list_events` or push notification.

## 4. Non-goals for v1

- A BearMail CLI, REST/OpenAPI gateway, or IMAP/SMTP wrapper for agents. JMAP remains the integration protocol; MCP is the only new agent facade.
- A proprietary agent-to-agent bus, ActivityPub, or a requirement that the remote party run BearMail.
- Replacing SMTP, DKIM, spam filtering, or calendar scheduling inside Stalwart.
- Contacts UI, chat, video meetings, or embedding the WebUI in the agent.
- Letting an agent use a human’s primary password, or an `app_…` application password as `BEARMAIL_TOKEN`.
- Anonymous public MCP. Every tool call is authenticated as one Stalwart account.
- Multi-mailbox unified inbox in one MCP session. One server instance, one account.
- Full offline mutation. The server is the source of truth.
- Changing Stalwart’s JMAP method surface or the WebUI’s protocol.

## 5. Product principles

1. **Server state is canonical.** MCP caches (session, mailbox ids, push state) never become an independent store.
2. **Tools, not protocols.** The model sees `send_email` and `create_event`, not `EmailSubmission/set`.
3. **Email is federation.** MCP is local control. Cross-company talk is SMTP and iMIP.
4. **Least privilege.** Default agent tokens cannot administer the server. Send, read, and calendar write are separate scopes.
5. **Humans can always read it.** Agent-originated mail has a usable plain-text body. Calendar invites are ordinary iMIP.
6. **No invisible send.** Destructive or externally visible actions have explicit tools (`send_email` vs `save_draft`, `cancel_event` vs `update_event`).
7. **Progressive capability use.** If the JMAP session lacks Submission or Calendars, the MCP server omits or errors those tools with a clear, non-secret reason.

## 6. Architecture

```text
  MCP host (Cursor, Claude Desktop, worker)
              │  MCP (stdio or Streamable HTTP)
              ▼
         bearmail-mcp
              │  JMAP over HTTPS
              ▼
           Stalwart
         mail + calendar
              │  SMTP / iMIP
              ▼
     people, Gmail/Outlook, other agents
```

`bearmail-mcp` is distributed with BearMail, not compiled into the Stalwart binary. It may run:

- on the mail host, next to Stalwart, as a systemd service (Streamable HTTP, for always-on agents);
- on a developer machine as a stdio process (typical Cursor `mcp.json`), talking to the public JMAP HTTPS URL.

Both transports expose the same tool schema. Both authenticate as one mailbox. The WebUI origin and the MCP origin may differ; CORS for the browser UI does not apply to MCP stdio. HTTP MCP must require TLS on non-loopback addresses, matching WebUI policy for JMAP.

The MCP server must not open IMAP, SMTP, or CalDAV to Stalwart. Blob upload/download uses JMAP blob endpoints.

## 7. Users and key journeys

### 7.1 Startup administrator

Installs BearMail, creates `scheduler@startup.com`, issues a Stalwart API key, copies the MCP URL or stdio snippet into the team’s agent config, and sets a daily send cap.

### 7.2 Interactive agent (Cursor / Claude)

A person runs an MCP host with the BearMail server configured. The model lists mail, drafts a reply, proposes a meeting, and either saves a draft for the person to send in the WebUI or sends directly if the token allows it.

### 7.3 Always-on agent

A worker stays connected over HTTP MCP (or reconnects on a schedule). It is notified of new mail, classifies it, and replies or files an event. It uses its own mailbox, not the founder’s inbox.

### 7.4 Human counterpart

Receives ordinary email and calendar invites. Replies in WebUI or any mail client. Does not need MCP.

### 7.5 Remote agent or person on another domain

Is a recipient on SMTP. If they RSVP, iTIP updates the organizer calendar. BearMail does not require them to speak MCP.

## 8. MCP surface

### 8.1 Session tools

| Tool | Purpose |
| --- | --- |
| `whoami` | Account address, display name, identities, timezone, advertised JMAP capabilities, token scopes. |
| `list_identities` | Sending identities permitted for this account. |

### 8.2 Mail tools

| Tool | Purpose |
| --- | --- |
| `list_mailboxes` | Hierarchy and roles (Inbox, Drafts, Sent, Junk, Trash). |
| `list_inbox` | Paginated message list; default Inbox; unread filter; attachments and invitation flags. |
| `search_mail` | Subset of JMAP `Email/query` filters: from, to, subject, text, mailbox, after/before, hasAttachment, unread. |
| `get_thread` | One conversation: senders, recipients, date, safe text body, attachment metadata, invitation summary. HTML is converted or omitted; do not return unsanitized HTML to the model by default. |
| `download_attachment` | Fetch a blob to a host-accessible path or return a short-lived download reference. Size-capped. |
| `save_draft` | Create or replace a draft via JMAP; does not submit. |
| `send_email` | Submit through `EmailSubmission/set` with `onSuccessUpdateEmail` so the message moves Drafts → Sent. Never SMTP from the MCP process. |
| `reply` | Reply or reply-all to a message id, preserving threading headers. |
| `set_mail_state` | Mark read/unread, flag, move to mailbox, or trash. Permanent delete is a separate explicit tool or a flagged argument defaulting to false. |

Default list/search pages are small (for example 20 threads) so tool results fit in a model context. Bodies in list views are snippets only.

### 8.3 Calendar tools

| Tool | Purpose |
| --- | --- |
| `list_calendars` | Calendars the account may see or write. |
| `list_events` | Events in a time range; include participation status. |
| `get_event` | Full event: title, times, timezone, recurrence summary, location, attendees, description, conference link if present. |
| `get_availability` | Free/busy for this account (and, when JMAP allows, for other local attendees) in a window. |
| `create_event` | Create a `CalendarEvent`. If attendees are present and the server supports it, send scheduling messages (`sendSchedulingMessages`). |
| `update_event` | Patch title, time, attendees, or description; send updates when attendees exist. |
| `rsvp` | Accept, tentative, or decline; send the scheduling response when the server supports it. |
| `cancel_event` | Cancel and notify attendees when this account is the organizer. |

A create/update that invites an external address must produce a normal iMIP message. Success is JMAP success plus, for local attendees, a visible event; it is not “the recipient opened it.”

### 8.4 Tools the model must not see in v1

- Server admin, user provisioning, DNS, relay credentials, or raw JMAP method passthrough.
- Arbitrary Sieve programming.
- Bulk export of the whole mailbox in one call.

### 8.5 Resources and notifications

When the JMAP session advertises WebSocket or EventSource, the MCP server should subscribe and expose:

- resource `mail://inbox` (or equivalent) for unread summary;
- notifications to the host on new mail and on calendar event changes.

If push is unavailable, the server may poll JMAP `*/changes` with backoff. Document the mode in `whoami`.

Optional later: an inbound HTTP webhook with a signed summary payload, for workers that are not MCP hosts. Not required for v1 if push via MCP works.

### 8.6 Result shape

Every tool returns JSON. Errors are structured: `code`, human-readable `message` without secrets, and optional `jmapMethod` for operators. Do not dump raw JMAP method responses into the model unless a debug flag is on (off by default).

## 9. Authentication and identity

### 9.1 Account model

An agent is a Stalwart user with an email address. Provisioning in v1 may be the existing admin UI plus a documented procedure. A dedicated “Create agent mailbox” flow is Phase 2.

Do not share one mailbox across several agents. Do not default to the administrator account.

### 9.2 Credentials

Preferred: a **Stalwart API key** (`API_…`) issued for that mailbox. MCP sends it as HTTP Bearer in `BEARMAIL_TOKEN` (stdio) or `Authorization: Bearer API_…` (HTTP).

Supported fallbacks:

- OAuth access token as Bearer (same `BEARMAIL_TOKEN` path).
- Username + app password (`app_…`) as HTTP Basic via `BEARMAIL_PASSWORD`. This is for mail clients and the WebUI, not the agent default. Putting `app_…` in `BEARMAIL_TOKEN` is rejected.

Supported OAuth patterns:

- Pre-registered confidential client or bearer token in MCP config (HTTP and stdio).
- Device-code grant when a human must approve the agent once.

Not permitted:

- OAuth Authorization Code + PKCE as the only agent path (browser-oriented; WebUI keeps it).
- The human’s primary account password in MCP config.
- An application password (`app_…`) in `BEARMAIL_TOKEN`.
- Token in tool arguments.

Stdio config holds the Stalwart HTTPS origin, mailbox address, and API key (environment variable preferred over plaintext in `mcp.json`). HTTP MCP authenticates each connection (Bearer). Tokens are not logged.

### 9.3 Scopes

Map onto Stalwart/OAuth capabilities already used by the WebUI (`mail`, `calendars`) and refine in product policy:

| Scope | Tools |
| --- | --- |
| `mail.read` | list/search/get/download, not send |
| `mail.send` | `send_email`, `reply` |
| `mail.draft` | `save_draft` only |
| `calendar.read` | list/get/availability |
| `calendar.write` | create/update/rsvp/cancel |

A send-capable token without `mail.read` is allowed (outbound notifier). Missing scope returns a tool error, not a JMAP probe the model cannot interpret.

### 9.4 Draft-then-approve

Configuration per mailbox or per token:

- **draft-only:** `send_email` writes a draft and returns “waiting for human send in WebUI”;
- **send-allowed:** submit immediately.

v1 default for newly created agent tokens should be **draft-only** unless the administrator opts into send. Always-on notifiers explicitly opt in.

### 9.5 Quotas and audit

Enforce a daily (and optionally hourly) send cap per agent mailbox. Log actor, tool name, message-id or calendar UID, recipients, and timestamp. Do not log bodies or tokens. WebUI or admin should be able to filter mail sent by that mailbox.

## 10. Discovery and installer

After install, the operator sees three kinds of URL, not two:

- Admin: `https://mail.example.com/admin/`
- WebUI: `https://webmail.example.com/`
- Agent: MCP HTTP URL and/or a stdio snippet

Publish a discovery document on the mail origin, for example:

`https://mail.example.com/.well-known/mcp.json`

It must include (non-secret): MCP transports, JMAP well-known URL, OAuth metadata URL, mail domain, and a pointer to this spec or a short agent skill. It must not include tokens.

A Cursor-oriented skill or `llms.txt` may live in the repo and in the installed docs: how to configure the host, which tools exist, and that Gmail users are valid attendees.

The installer does not accept tokens as command-line arguments (same rule as WebUI credentials).

## 11. Agent-to-agent communication

v1 agents communicate with other agents the same way they communicate with people: **send mail and calendar invites**.

Threading (`Message-ID`, `In-Reply-To`, `References`) is the conversation. Meeting state is the calendar, updated by iTIP.

### 11.1 v1 message rules

- Always include `text/plain` a human can read.
- Use a permitted identity as `From`.
- Do not require a custom header for delivery to succeed.

### 11.2 Later convention (not v1 blocking)

Optional parallel `application/json` part and headers such as `X-BearMail-Agent` and a schema URL, plus WebFinger or `/.well-known/agent.json` so another platform can see that an address is an agent. Fallback remains ordinary email.

Google A2A or similar may be offered **in addition to** SMTP later. It must not replace federation.

## 12. Security

- TLS for JMAP and for non-loopback HTTP MCP.
- HTML bodies sanitized or stripped before they enter the model context. Remote images are not fetched by default.
- Attachment download size limits; no implicit execution of attachments.
- SSRF: the MCP server connects only to the configured Stalwart origin, not to URLs from mail headers or tool args (except JMAP blob URLs returned by that session).
- Rate-limit tool calls and outbound submission.
- New mail from the public internet is untrusted input. Tool descriptions must tell the model not to follow instructions inside email bodies as system commands (prompt injection). Optional: a `untrusted_content` wrapper in `get_thread` results.
- Revocation: deleting the API key (or fallback token) disables MCP immediately on the next request.

## 13. Relationship to the WebUI

| Concern | WebUI | MCP |
| --- | --- | --- |
| Protocol to Stalwart | JMAP | JMAP |
| User | Person in a browser | Agent via MCP host |
| Auth | OAuth PKCE or app password | Stalwart API key (Bearer); OAuth token or app-password Basic as fallback |
| Send | Composer → `EmailSubmission/set` | `send_email` → same |
| Calendar | Views + RSVP | Tools + same `CalendarEvent` objects |

Capability gaps follow the WebUI rules: no Submission means no send tools; no Calendars means mail-only. Invitation semantics match [WEB_UI_SPEC.md](../WEB_UI_SPEC.md) section 2: the server only knows about events that exist as `CalendarEvent` or as parseable invitation parts the agent imports via RSVP/add.

## 14. Phased delivery

### Phase 1 — Agent-usable MCP (this spec’s v1)

- `bearmail-mcp` with stdio and Streamable HTTP.
- Session, mail, and calendar tools in section 8.
- API-key Bearer auth (app-password Basic as fallback); capability-based tool list.
- Discovery document and installer snippet.
- Draft-only default; optional send.
- Push when advertised, otherwise poll.
- Docs and a Cursor MCP example.

### Phase 2 — Agent as an account type

- Admin: create agent mailbox, issue API key, send cap, revoke.
- Audit view.
- Human-in-the-loop send from WebUI for draft-only agents.
- Optional signed inbound webhook.

### Phase 3 — Richer agent-to-agent

- Structured JSON MIME part and documented schema.
- Agent discovery (WebFinger / agent card).
- Optional A2A alongside SMTP, never instead of it.

## 15. Testing

Minimum automated coverage:

- JMAP session with Mail + Submission + Calendars: all tools advertised; send and `create_event` with a local attendee update both calendars.
- Mail-only session: calendar tools absent or clearly errored.
- Draft-only token: `send_email` does not submit.
- External attendee: `CalendarEvent/set` with `sendSchedulingMessages` produces iMIP (same expectation as WebUI system tests: sequence increment, not a copy in Sent).
- Token missing `mail.send`: send tools fail closed.
- `get_thread` does not return raw active HTML.
- WebUI and MCP see the same event after MCP `create_event`.

Do not log credentials in fixtures.

## 16. Open questions

1. Language and packaging of `bearmail-mcp` (Rust next to Stalwart vs a small Node/Go sidecar). Decision can follow whoever owns JMAP client code in-tree.
2. Exact MCP protocol version and HTTP path (`/mcp` on the mail host vs a dedicated port behind Caddy).
3. Whether Phase 1 HTTP MCP is loopback-only (Caddy reverse-proxy) or publicly reachable with Bearer tokens.
4. Default HTML policy: strip always vs sanitized markdown conversion.
5. Whether `download_attachment` returns bytes to the host or a time-limited URL.

Resolve these in implementation notes; they do not change the product shape in sections 3–8.
