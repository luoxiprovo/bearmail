# Design-partner pilot brief

**One line:** BearMail gives a small technical company a **self-hosted company mailbox and calendar**, plus **typed MCP tools** so each AI agent gets a real, scoped address on the company domain—not a shared founder Gmail.

This is a 14-day, 1–5 seat **sandbox**, not a production migration and not “cheaper Workspace.”

## What works today

- One Linux **x86-64** / systemd VM; interactive installer; Caddy HTTPS; Stalwart mail + calendar; WebUI.
- Outbound through **Brevo** (default) or Mailjet; DNS automation for a **name.com** zone.
- MCP sidecar: `whoami`, mail list/draft/send (send is opt-in), calendar create/RSVP. Same JMAP data as the WebUI. External people stay on SMTP/iMIP.
- Agent auth: Stalwart **API key**. Default **draft-only**, scoped tools, daily send cap.

Architecture: [ARCHITECTURE.md](./ARCHITECTURE.md). First-value path: [QUICKSTART.md](./QUICKSTART.md). Limits: [SECURITY_AND_LIMITS.md](./SECURITY_AND_LIMITS.md).

## Beta limitations (say these out loud)

- Not Docker/Kubernetes, not ARM, not a generic one-click catalogue app.
- Not managed hosting, not suite parity, not an SLA or compliance pack.
- DNS helper is name.com-specific. Other registrars are manual.
- MCP spec is **Draft v0.1**. Calendar invites to Gmail work best as a single VEVENT + `RDATE` (`occurrences` on `create_event`), not a homemade weekly `RRULE`.
- You operate the VM, backups, and relay reputation.

## Who this is for

Technical founder, eng lead, or operator who: controls a domain, can SSH to a Linux box, has a **concrete agent job** (scheduling, inbound → draft, approved notifications), and will stay **draft-only** for the first two weeks.

Disqualify: “replace Gmail for the company,” free consumer mail, enterprise SSO/compliance as a day-one gate, bulk outbound, or no one who can run a server.

## The ask

- Weekly 20-minute feedback (what blocked install, what the agent could not do).
- Permission for an **anonymized** case study: job, time-to-first-value range, constraints—no mail bodies, no deliverability or security claims we did not measure.
- One dedicated agent mailbox. Never the founder’s primary inbox.

## Success criterion (14 days)

1. Company domain mail + webmail up.
2. MCP `whoami` as `scheduler@yourdomain`.
3. One real workflow: draft for human send, **or** a test calendar invite to an address you control, **or** an approved notification after you opt into send.

## How to start

Follow [QUICKSTART.md](./QUICKSTART.md). Open a GitHub issue titled `pilot: <company or handle>` if you want a concierge install. Utah / remote design partners are the same product path.

**Opener we use in person:** “I’m looking for 3–5 design partners who need control, automation, or a customer-deployable email stack—not people merely looking for cheaper inboxes.”
