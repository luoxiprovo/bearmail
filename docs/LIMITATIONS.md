# Limitations and prerequisites

Read this before you install. BearMail is an opinionated Linux mail stack plus an MCP sidecar. It is not a Gmail replacement, not a managed suite, and not a one-click cloud marketplace product.

Engine vulnerability reporting for Stalwart remains in [SECURITY.md](../SECURITY.md).

## Prerequisites

You need all of these before the installer can finish:

| Requirement | Why |
| --- | --- |
| Linux **x86-64** VM with systemd | Only published binary. No ARM, no Docker, no Kubernetes in this release. |
| Public IPv4 and inbound **80/443** | Caddy issues certificates and serves `mail.` / `webmail.` |
| SSH access and `sudo` | The installer writes systemd units and `/opt`. |
| A **name.com** domain on name.com nameservers, plus a production API token | Automated DNS. Other registrars are a manual zone. |
| **Brevo** SMTP login + SMTP key (Mailjet works) | Cloud VMs usually block outbound TCP 25. |
| One dedicated agent mailbox | Do not point MCP at `admin` or a founder inbox. |

Have the name.com token and relay credentials in front of you. The wizard asks for them.

## What this release does not include

- Managed hosting, high availability, or an SLA
- Google Workspace / Microsoft 365 suite parity
- Docker, Kubernetes, ARM, or a generic-registrar one-click path
- Compliance certifications or a “secure by default” guarantee
- Autonomous send from day one (default is **draft-only**)
- A private agent messaging network (the rest of the world is SMTP / iMIP)
- Gmail calendar-invite pixel parity (Stalwart writes the `.ics`; missing `VTIMEZONE` can still confuse some clients)

## What we tell operators

- You operate DNS, the relay, backups, and OS updates.
- Agents authenticate with a Stalwart **API key** (`API_…`) in `BEARMAIL_TOKEN`. Revoke it in admin to cut access on the next request.
- Humans use the WebUI password or an `app_…` app password. Do not put `app_…` in `BEARMAIL_TOKEN`.
- Do not put tokens in command-line arguments or in the server URL.

## What MCP enforces

| Control | Default | Notes |
| --- | --- | --- |
| Send mode | `draft-only` | `send_email` / `reply` write a draft; a human sends in the WebUI. |
| Scopes | read, draft, calendar; no `mail.send` unless send-allowed | Missing scope fails closed. |
| Daily send cap | 50 messages per UTC day | Applies when send is allowed. |
| HTTP MCP bind | `127.0.0.1:8082` | Non-loopback HTTP requires TLS. Remote agents spawn stdio locally. |
| Attachments | 1 MiB download cap | No execution of attachments. |
| HTML | stripped to plain text | `untrusted_content` on bodies. |
| Audit | tool name, actor, ids — no bodies or tokens | Optional file via `BEARMAIL_AUDIT_LOG`. |

## Credentials

| Secret | Use |
| --- | --- |
| Human WebUI / IMAP password or `app_…` app password | People and mail clients. |
| Stalwart API key `API_…` | MCP / agents (`BEARMAIL_TOKEN`, Bearer). |
| name.com / Brevo / Mailjet keys | Installer and outbound relay only. Not mailbox login. |

## Reporting

Do not file public issues for exploitable bugs. Follow [SECURITY.md](../SECURITY.md) for the Stalwart engine. For BearMail packaging and MCP sidecar issues that are not engine CVEs, use a private GitHub security advisory on this repository.
