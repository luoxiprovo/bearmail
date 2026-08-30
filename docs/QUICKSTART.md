# BearMail 5-minute quickstart

One domain, one dedicated agent mailbox, draft-only. Prerequisites and hard limits: [LIMITATIONS.md](./LIMITATIONS.md). Full installer notes: [INSTALL.md](./INSTALL.md). Agent skill: [AGENT_GUIDE.md](./AGENT_GUIDE.md).

## 1. Install the mail host (~2 min of typing; DNS can take longer)

On a Linux **x86-64** VM with systemd:

```sh
curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/release_install.sh | sh -s -- --dry-run
curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/release_install.sh | sudo bash
```

Save the printed administrator username and password. After DNS resolves:

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

If Hermes, Cursor, or Claude Desktop runs on another machine, copy `mcp/`, run `npm ci --legacy-peer-deps && npm run build`, and point the host at that `dist/stdio.js`. Remote hosts cannot use `127.0.0.1:8082` on the mail VM.

## 4. Copy/paste MCP config

Draft-only is the default. Leave it that way until a human has approved a few drafts.

Replace the three placeholders. The JSON is the same for Cursor, Claude Desktop, and Hermes — only the file path changes.

| Host | File |
| --- | --- |
| Cursor | `~/.cursor/mcp.json` or the project `.cursor/mcp.json` |
| Claude Desktop | `claude_desktop_config.json` (see Anthropic’s MCP docs for the OS path) |
| Hermes | that product’s MCP server list (stdio command + env) |

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

On a laptop sidecar, change `args` to the absolute path of your local `dist/stdio.js`.

In-repo copies:

- [`mcp/mcp.json.example`](../mcp/mcp.json.example) — Cursor / generic
- [`mcp/claude_desktop.json.example`](../mcp/claude_desktop.json.example) — Claude Desktop
- [`mcp/hermes.json.example`](../mcp/hermes.json.example) — Hermes

## 5. First-value checks

1. Call **`whoami`**. Confirm the agent address, `sendMode: draft-only`, and calendar tools if you enabled calendars.
2. **`save_draft`** or `send_email` in draft-only mode. Open WebUI and confirm the draft.
3. Optional: `create_event` with a test attendee you control. Success means JMAP accepted it, not that Gmail opened it.

If `whoami` fails, the origin or API key is wrong. Re-issue the key; do not put `app_…` in `BEARMAIL_TOKEN`.
