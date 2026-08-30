# BearMail 10-minute path to first value

This is the activation path for a **14-day agent-mailbox pilot**: one domain, one dedicated agent mailbox, draft-only. It is not a Gmail replacement and not a one-click cloud marketplace install.

Full prompts and troubleshooting: [INSTALL.md](./INSTALL.md). Agent skill: [AGENT_GUIDE.md](./AGENT_GUIDE.md). Limits: [SECURITY_AND_LIMITS.md](./SECURITY_AND_LIMITS.md).

## Prerequisites

Have these before you SSH in:

- A **name.com** domain on name.com nameservers, plus a production API token.
- A **Brevo** SMTP login and SMTP key (Mailjet works; Brevo is the default). Cloud VMs usually block outbound TCP 25.
- A Linux **x86-64** VM with systemd, a public IPv4, and inbound **80/443**.

There is no Docker, Kubernetes, ARM, or generic-registrar path in this release.

## 1. Preview, then install

```sh
curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/release_install.sh | sh -s -- --dry-run
curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/release_install.sh | sudo bash
```

Save the printed administrator username and password. Open:

- Admin: `https://mail.example.com/admin/`
- Webmail: `https://webmail.example.com/`

Create a **human** user and sign in once so you can approve drafts. Guide: [WEBUI_USER_GUIDE.md](./WEBUI_USER_GUIDE.md).

## 2. Agent mailbox and API key

In admin, create a **dedicated** mailbox such as `scheduler@example.com`. Do not use `admin` or a founder’s inbox.

Issue a Stalwart **API key** for that mailbox (`API_…`). Do not use the human login password or an `app_…` application password.

## 3. MCP sidecar

On the mail host:

```sh
curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/mcp_install.sh | sudo bash
```

If Hermes or Cursor runs on another machine, copy `mcp/`, run `npm ci --legacy-peer-deps && npm run build`, and point the host at that `dist/stdio.js`.

## 4. Copy/paste host config

Draft-only is the default. Leave it that way for the pilot.

```json
{
  "mcpServers": {
    "bearmail": {
      "command": "node",
      "args": ["/opt/bearmail-mcp/dist/stdio.js"],
      "env": {
        "BEARMAIL_SERVER": "https://mail.example.com",
        "BEARMAIL_USERNAME": "scheduler@example.com",
        "BEARMAIL_TOKEN": "API_<stalwart-api-key>",
        "BEARMAIL_SEND_MODE": "draft-only"
      }
    }
  }
}
```

Example in-repo: [`mcp/mcp.json.example`](../mcp/mcp.json.example).

## 5. First-value checks

1. Call **`whoami`**. Confirm the agent address, `sendMode: draft-only`, and calendar tools if you enabled calendars.
2. **`save_draft`** or `send_email` in draft-only mode. Open WebUI and confirm the draft.
3. Optional: `create_event` with a test attendee you control. Success means JMAP accepted it, not that Gmail opened it.

If `whoami` fails, the origin or API key is wrong. Re-issue the key; do not put `app_…` in `BEARMAIL_TOKEN`.

## Pilot success (stop here)

A design-partner week is complete when the operator can recover the install and the agent mailbox has done at least one permitted action: a draft, an approved send, or a calendar write. Weekly repeat of that job is the early north-star, not seat count.
