# BearMail 5-minute quickstart

One domain, one dedicated agent mailbox, draft-only. Prerequisites and hard
limits: [LIMITATIONS.md](./LIMITATIONS.md). Every installer prompt:
[INSTALL.md](./INSTALL.md).

## 1. Install

On a Linux **x86-64** VM with systemd, from an SSH session. Have a
name.com, Hostinger, or GoDaddy API token and a Brevo SMTP key ready.

```sh
curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/easy_install.sh | sh -s -- --dry-run
curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/easy_install.sh | sudo bash
```

The installer prints the portal URL and the permanent administrator username
and password again at the end. Save both. After DNS resolves:

- BearOS admin: `https://mail.example.com/admin/`
- BearMail: `https://bearmail.example.com/`

## 2. Create the agent mailbox

Sign in to the BearOS admin UI and create a mailbox such as
`scheduler@example.com`. Leave `admin` and founder inboxes for people.

Sign in to BearMail as that mailbox. Open **Settings**, enter a name, and
select **Generate API key**. Copy the `API_…` secret. It is shown once.

Also sign in once as a person who can approve drafts.
Guide: [WEBUI_USER_GUIDE.md](./WEBUI_USER_GUIDE.md).
The MCP JSON block is in the [README](../README.md#give-an-agent-a-mailbox).

## 3. Hand the rest to your AI agent

Copy this prompt and send it to Hermes, Cursor, or Claude:

```
Follow https://github.com/luoxiprovo/bearmail/blob/main/docs/AGENT_GUIDE.md as your BearMail skill. Ask me for anything that guide says you must not guess, then connect and call whoami.
```

The agent will ask for the mail origin (`https://mail.example.com`), the
dedicated mailbox, the API key, draft versus send, and the timezone. Give it
the `API_…` key from Settings. Leave `admin`, a founder inbox, and `app_…`
app passwords out of that config.

Skill it follows: [AGENT_GUIDE.md](./AGENT_GUIDE.md).
