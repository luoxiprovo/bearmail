# Security and limits (product)

This page is what BearMail **claims and enforces in product policy**. It is not a SOC2 report, an SLA, or a “secure by default” guarantee. Engine vulnerability reporting for Stalwart remains in [SECURITY.md](../SECURITY.md).

## What we tell operators

- Self-hosted on **your** Linux VM. You operate DNS, the relay, backups, and OS updates.
- One dedicated mailbox per agent. Do not point MCP at a founder inbox or `admin`.
- **Draft-only** is the default. Direct send is an explicit `BEARMAIL_SEND_MODE=send-allowed` opt-in.
- Agents authenticate with a Stalwart **API key** (`API_…`). Revoke it in admin to cut access on the next request.
- Do not put tokens in command-line arguments or in the server URL.

## What MCP enforces

| Control | Default | Notes |
| --- | --- | --- |
| Send mode | `draft-only` | `send_email` / `reply` write a draft; a human sends in the WebUI. |
| Scopes | read, draft, calendar; no `mail.send` unless send-allowed | Missing scope fails closed. |
| Daily send cap | 50 messages per UTC day | Applies when send is allowed. |
| HTTP MCP bind | `127.0.0.1:8082` | Non-loopback HTTP requires TLS. |
| Attachments | 1 MiB download cap | No execution of attachments. |
| HTML | stripped to plain text | `untrusted_content` on bodies. |
| Audit | tool name, actor, ids — no bodies or tokens | Optional file via `BEARMAIL_AUDIT_LOG`. |

## What we do not promise

Managed hosting, suite parity with Google Workspace or Microsoft 365, generic DNS/registrar automation (the opinionated path is **name.com**), Docker/Kubernetes, high availability, an SLA, compliance certifications, autonomous send from day one, or a global agent messaging network.

## Credentials

| Secret | Use |
| --- | --- |
| Human WebUI / IMAP password or `app_…` app password | People and mail clients. |
| Stalwart API key `API_…` | MCP / agents (`BEARMAIL_TOKEN`, Bearer). |
| name.com / Brevo / Mailjet keys | Installer and outbound relay only. Not mailbox login. |

## Reporting

Do not file public issues for exploitable bugs. Follow [SECURITY.md](../SECURITY.md) for the Stalwart engine. For BearMail packaging and MCP sidecar issues that are not engine CVEs, use a private GitHub security advisory on this repository.
