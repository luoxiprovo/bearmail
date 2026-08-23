# BearMail

BearMail is a **one-shot install** mail and calendar stack for startups in the
AI-agent era: your company domain, a real inbox, and APIs that agents can use
without handing mail to a consumer Gmail account.

One Linux server, one interactive `install.sh`. When it finishes you have:

- mail on `mail.example.com` (SMTP, IMAP, JMAP, admin);
- webmail and calendar on `https://webmail.example.com`;
- HTTPS via Caddy;
- outbound delivery through Brevo (Mailjet is also available) so it works
  when the cloud provider blocks port 25;
- DNS published through name.com.

The mail engine is [Stalwart](https://stalw.art). BearMail is the product
wrapper: artifacts, two systemd services, Caddy, an SMTP relay, and name.com
in one flow.

## Prepare these first

Do this **before** you run the installer. The script will ask for the values;
it does not create the vendor accounts for you.

### 1. name.com domain and account

1. Buy or transfer a domain at [name.com](https://www.name.com/).
2. Keep the domain on **name.com nameservers**.
3. Sign in and open **Account Settings → API Tokens**.
4. Create a **production** API token. Two-step verification must allow API
   access.
5. Keep the **account username** and the **token** ready. The installer types
   the token with echo off and does not save it in `installer-state.json`.

You will also choose two hostnames in that zone, typically:

| Hostname | Role |
| --- | --- |
| `mail.example.com` | Mail server, admin, MX, IMAP/SMTP |
| `webmail.example.com` | BearMail web app |

They may share one public IP. They cannot be the same name.

### 2. SMTP relay account (Brevo recommended)

Cloud VMs (including Google Cloud) usually **block outbound TCP 25**. The
installer asks which relay to use. **Brevo is the default.** Mailjet remains
available.

#### Brevo (default)

1. Create an account at [app.brevo.com](https://app.brevo.com/).
2. **Settings → Senders, domains & dedicated IPs** → add your mail domain
   (the part after `@`, such as `example.com`).
3. Publish Brevo’s domain-ownership TXT (Brevo code) and DKIM as shown there.
   The installer can merge `include:spf.brevo.com` into SPF when it publishes
   DNS through name.com. Add Brevo’s DKIM selector from the dashboard yourself.
4. **Settings → SMTP & API → SMTP**
   ([SMTP page](https://app.brevo.com/settings/keys/smtp)).
5. Copy the **SMTP login** (username, often `xxx@smtp-brevo.com`) and the
   **SMTP key** (password). These are not your Brevo website password, and
   not a REST API key.

Host is `smtp-relay.brevo.com`. Port `587` (STARTTLS) is the default; `465`
is implicit TLS. See [Brevo SMTP relay](docs/BREVO_SMTP_RELAY.md).

#### Mailjet (alternative)

1. Create an account at [app.mailjet.com](https://app.mailjet.com/).
2. **Account settings → Senders & Domains** → add your mail domain.
3. Publish Mailjet’s domain-ownership TXT and DKIM. The installer can merge
   `include:spf.mailjet.com` into SPF when it publishes DNS through name.com.
4. **Account settings → SMTP and SEND API settings**
   ([relay page](https://app.mailjet.com/account/relay)).
5. Copy the **API key** (SMTP username) and **secret key** (SMTP password).

Host is `in-v3.mailjet.com`. See [Mailjet SMTP relay](docs/MAILJET_SMTP_RELAY.md).

### 3. A Linux server

- Linux with systemd, root (`sudo`), and an interactive terminal (SSH is
  fine).
- A public IPv4 address (IPv6 optional).
- Inbound TCP **80** and **443** open if you use automatic Caddy (recommended).
- The three install artifacts in one directory (see below).

## Install artifacts

Put these next to each other on the server:

```text
install.sh
stalwart
stalwart-webui.tar.gz
```

Build them from this repository (community edition, no enterprise feature
gates):

```sh
cargo build --release --package stalwart --locked --no-default-features \
  --features "sqlite postgres mysql rocks s3 redis azure nats"
cp target/release/stalwart ./stalwart
chmod +x ./stalwart

cd webui
npm ci
npm test
npm run build
tar -czf ../stalwart-webui.tar.gz \
  install.sh server.mjs stalwart-webui.service dist
cd ..
```

Copy the three files to the server and run:

```sh
sudo sh ./install.sh
```

There are no setup flags. `install.sh -h` only prints help. Every answer is
typed in the terminal so secrets never land in shell history.

Full paths, reinstall, uninstall, and troubleshooting:
[How to install BearMail](docs/INSTALL.md).

## What `install.sh` asks, in order

Press Enter to accept a value in `[brackets]`. Invalid answers are explained
and asked again; they do not abort the install.

### Before any files change

**Installation layout**

- `1) Standard system paths (recommended)` — binary in `/usr/local/bin`,
  config in `/etc/stalwart`, data in `/var/lib/stalwart`.
- `2) Custom self-contained prefix` — then it asks for an absolute prefix
  such as `/opt/stalwart`. Use this only if you must keep everything under
  one directory.

**Path to the compiled Stalwart binary**  
Default: `./stalwart` beside the script. Must be executable and built from
this source (it has to support quick setup).

**Path to the prebuilt WebUI tar archive**  
Default: `./stalwart-webui.tar.gz`.

**WebUI installation prefix**  
Default: `/opt/stalwart-webui`. Must not overlap the mail data, config, or
Node.js paths.

**WebUI local service port**  
Default: `8081`. Bound to `127.0.0.1` only. `8080` is reserved for the mail
engine.

**Public WebUI origin**  
Exact HTTPS URL with no path, for example `https://webmail.example.com`.
This is the URL people and agents open. After you later set the mail domain,
a leftover `webmail.example.com` example is replaced with
`https://webmail.<your-domain>`.

**HTTPS publishing**

- `1) Configure Caddy automatically (recommended)` — installs Caddy, puts
  mail and webmail on ports 80/443, obtains Let’s Encrypt certificates, and
  copies the mail-host cert into the engine for IMAPS/SMTPS. Requires
  origin on standard port 443. Will not overwrite an operator-owned
  Caddyfile.
- `2) Use an existing operator-managed reverse proxy` — you route
  `https://webmail…` to `127.0.0.1:8081` yourself.

**Installation summary** then **Install both services and run interactive
server setup**  
Default is `no`. Type `yes` to change the system.

### Server identity (quick setup)

On a fresh machine the engine then asks:

**Public mail hostname** — example `mail.example.com`. Not the cloud
hostname (nothing ending in `.internal` or `.local`). Used for MX, TLS, and
the URL the web app calls.

**Primary mail domain** — example `example.com`. The part after `@`.

Press Enter at **Quick setup** unless you need external Postgres, LDAP,
OIDC, or another store. Advanced setup exposes every bootstrap field;
empty input keeps the displayed default.

On a first internal-directory install, the **administrator username and
password are printed once**. Save them before continuing.

### After services are up

**Stalwart administrator username / password**  
Only if this is a reinstall or an external directory. Needed to set CORS
for the web origin. Password input is hidden.

**Outbound SMTP relay**  
Default **Brevo**. Choose Mailjet or skip if you can send on TCP 25.

| Prompt (Brevo) | What to enter |
| --- | --- |
| Brevo SMTP host | `smtp-relay.brevo.com` |
| Brevo SMTP port | `587` or `465` |
| Brevo SMTP login | SMTP username |
| Brevo SMTP key | SMTP password (hidden) |

Local addresses still deliver on the server. Remote recipients go through
the selected relay.

**Have you already published the printed forward-DNS records**  
Default **no**. If you answer no, BearMail can publish the table through
name.com:

| Prompt | What to enter |
| --- | --- |
| name.com domain (DNS zone) | Usually the mail domain, `example.com` |
| name.com API username | name.com account username |
| name.com API token | Production token (hidden) |

If existing records conflict (old A/MX/SPF), the installer lists them and
asks **Replace the conflicting name.com records** (default yes). Site
verification TXT and NS records are left alone. Reverse DNS (PTR) is **not**
in this table; set it at the VPS provider if you send without a relay.

Wait for DNS to resolve, then open:

- Admin: `https://mail.example.com/admin/`
- BearMail: `https://webmail.example.com/`

Create a user in admin, then sign in to BearMail with that address and
password. User guide: [How to sign in and send email](docs/WEBUI_USER_GUIDE.md).

Finish the selected relay’s domain authentication (Brevo code/DKIM, or
Mailjet’s ownership TXT and DKIM) in that vendor’s dashboard if it is still
pending.

## What agents get

A BearMail domain is a normal mail system: SMTP to send, IMAP or JMAP to
read, CalDAV/JMAP calendars for invites. Point an agent at your hostnames
and a mailbox you created—not at a shared consumer inbox.

## License

The mail engine in this repository is dual-licensed **AGPL-3.0** and the
[Stalwart Enterprise License](./LICENSES/LicenseRef-SEL.txt). See
[LICENSES](./LICENSES/). Copyright (C) 2020, Stalwart Labs LLC.
