# BearMail 5-minute quickstart

One domain, one dedicated agent mailbox, draft-only. Prerequisites and hard limits: [LIMITATIONS.md](./LIMITATIONS.md). Full installer notes: [INSTALL.md](./INSTALL.md).

## 1. Install the mail host

On a Linux **x86-64** VM with systemd:

```sh
curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/release_install.sh | sh -s -- --dry-run
curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/release_install.sh | sudo bash
```

Save the printed administrator username and password. After DNS resolves:

- Admin: `https://mail.example.com/admin/`
- Webmail: `https://webmail.example.com/`

Create a **human** user and sign in once so you can approve drafts. Guide: [WEBUI_USER_GUIDE.md](./WEBUI_USER_GUIDE.md).

## 2. Hand the rest to your AI agent

Copy this prompt and send it to Hermes, Cursor, or Claude:

```
Follow https://github.com/luoxiprovo/bearmail/blob/main/docs/AGENT_GUIDE.md as your BearMail skill. Ask me for anything that guide says you must not guess, then connect and call whoami.
```

The agent will ask you for the mail origin, a dedicated agent mailbox, a Stalwart API key (`API_…`), draft vs send, and timezone. Do not use `admin`, a founder inbox, or an `app_…` password.

Skill it follows: [AGENT_GUIDE.md](./AGENT_GUIDE.md).
