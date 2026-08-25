# How to install BearMail

BearMail is a one-shot install of mail, calendar, and webmail on one Linux
server. When you finish, two systemd services and two HTTPS hostnames are
live: the mail engine (Stalwart) on `mail.example.com`, and BearMail on
`https://webmail.example.com`.

Create the **name.com** domain/account and an **SMTP relay** account (**Brevo**
recommended, Mailjet also supported) **before** you run `install.sh`. The
installer will ask for those credentials; it does not register the vendors
for you. Details and every prompt are in the
[BearMail README](../README.md).

The combined installer is interactive. It does not download or build either
application. Prepare the Stalwart binary and WebUI archive first, then copy
them to the target server with `install.sh`. The installer handles its Node.js
runtime automatically.

## Before you begin

### Accounts to create first

| Prepare | Why the installer needs it |
| --- | --- |
| name.com domain on name.com nameservers | Zone for `mail.` and `webmail.` plus the printed MX/SPF/DKIM rows |
| name.com production API token | Optional auto-publish of that DNS table |
| Brevo account (default), SMTP login and SMTP key; or Mailjet API key and secret | Outbound mail when the VPS blocks TCP 25 |

### Server

Use a build machine to create the artifacts and a target server to run them.
The build machine and target server may be the same machine.

The target server needs:

- Linux with systemd;
- root access through `sudo` or a root shell;
- an interactive terminal, including an SSH terminal;
- outbound HTTPS access during installation;
- a public IPv4 address, and optionally IPv6;
- two different fully qualified hostnames, such as `mail.example.com` and
  `webmail.example.com`;
- permission to install Caddy, or an existing HTTPS reverse proxy you manage;
  and
- a Stalwart binary built for the target operating system, CPU architecture,
  and runtime libraries.

You do not need to install Node.js first. If the server has a system Node.js
22.12 or later, the installer uses it. Otherwise, it downloads the latest
official Node.js 22 Linux archive, verifies its SHA-256 checksum, and installs
a private copy under `/opt/stalwart-node/`. It does not replace the server's
existing `node` command. Official binaries are supported on x86-64, ARM64,
ARMv7, ppc64le, and s390x Linux servers.

The download uses `curl` or `wget`. If neither exists, the installer can add
`curl` with apt, dnf, microdnf, yum, zypper, or pacman. It can likewise add
`coreutils` when the server has no SHA-256 utility.

The build machine needs:

- a current stable Rust toolchain that supports Rust edition 2024;
- the native compiler and library dependencies required to build Stalwart;
- Node.js 22.12 or later with npm; and
- a checkout of this repository.

Choose these hostnames before starting. They must live in the name.com zone:

| Value | Example | Requirement |
| --- | --- | --- |
| Mail hostname | `mail.example.com` | Fully qualified DNS name |
| Primary mail domain | `example.com` | Domain used for email addresses |
| Public WebUI origin | `https://webmail.example.com` | Exact HTTPS origin with no path |
| WebUI local port | `8081` | Unused port from 1 through 65535; not `8080` |
| HTTPS publishing | Automatic Caddy | Choose operator-managed when a proxy already exists |
| Installation layout | Standard system paths | Use a custom prefix only when needed |
| Setup mode | Quick | Use Advanced for external stores, directories, logging, or managed DNS |

The two public hostnames may point to the same IP address, but they cannot be
the same hostname.

## 1. Build the Stalwart artifact

From the repository root on the build machine, build the community edition:

```sh
cargo build --release --package stalwart --locked --no-default-features \
  --features "sqlite postgres mysql rocks s3 redis azure nats"
cp target/release/stalwart ./stalwart
chmod +x ./stalwart
```

This build enables the community storage and coordination backends used by the
interactive setup. FoundationDB requires the `foundationdb` feature and its
matching client library. Enterprise-only choices remain visible in Advanced
setup but cannot be selected in a community build.

Confirm that the binary contains the installer-compatible setup command:

```sh
./stalwart --setup --help
```

The output must mention quick setup and `STALWART_SETUP_RESULT_PATH`. If either
is missing, rebuild the binary from the same source revision as `install.sh`.

## 2. Build the WebUI artifact

From the repository root, build and test the WebUI:

```sh
cd webui
npm ci
npm test
npm run build
tar -czf ../stalwart-webui.tar.gz \
  install.sh server.mjs stalwart-webui.service dist
cd ..
```

The archive is architecture-independent. The target server does not need npm;
the combined installer provides a suitable Node.js runtime when necessary.

Check the archive before copying it:

```sh
tar -tzf stalwart-webui.tar.gz
```

Its root must contain `install.sh`, `server.mjs`,
`stalwart-webui.service`, `dist/index.html`, and `dist/config.json`.

## 3. Copy the installer bundle to the server

Put these three files in one directory on the target server:

```text
install.sh
stalwart
stalwart-webui.tar.gz
```

For example, copy them to a remote staging directory with `scp`:

```sh
ssh operator@SERVER_IP 'mkdir -p ~/stalwart-install'
scp install.sh stalwart stalwart-webui.tar.gz \
  operator@SERVER_IP:~/stalwart-install/
```

Replace the SSH account and host with values for your server. The installer
uses the directory containing `install.sh` as the default artifact location.

## 4. Check the target server

Open an interactive terminal on the target server and enter the staging
directory:

```sh
cd ~/stalwart-install
chmod +x stalwart
systemctl --version
sudo sh ./install.sh --help
```

The help output lists the standard and custom installation paths without
changing the server. It does not install Node.js or make other changes.

Do not pass setup answers as command-line arguments. The installer accepts only
`-h` and `--help`; it reads every answer from the terminal.

## 5. Run the installer

Start the combined install:

```sh
sudo sh ./install.sh
```

The installer asks for the following information before changing the system:

1. Select **Standard system paths** or a custom, absolute installation prefix.
2. Accept or change the path to the compiled `stalwart` binary.
3. Accept or change the path to `stalwart-webui.tar.gz`.
4. Accept or change the WebUI installation prefix. The default is
   `/opt/stalwart-webui`.
5. Accept or change the WebUI localhost port. The default is `8081`; port
   `8080` is reserved for Stalwart.
6. Enter the exact public WebUI HTTPS origin, such as
   `https://webmail.example.com`. Do not include a path, query, fragment,
   credentials, or IP address. After you choose the mail domain, the installer
   replaces that example with `https://webmail.<your-domain>` unless you already
   entered a real hostname.
7. Choose **Configure Caddy automatically** or **Use an existing
   operator-managed reverse proxy**. Automatic mode requires standard HTTPS
   port 443.
8. Review the summary, then answer `yes` to begin system changes.

The installer validates both artifacts before creating accounts, directories,
or services. It then selects a compatible system Node.js or installs and
verifies a private runtime. It also detects the server's public IPv4 and IPv6
addresses when outbound HTTPS is available.

### Choose a setup mode

For most new single-server installations, press Enter to choose **Quick
setup**. Enter:

- the Stalwart hostname, such as `mail.example.com`; and
- the primary mail domain, such as `example.com`.

Quick setup keeps the remaining bootstrap defaults. Review the summary and
accept it to initialize Stalwart.

Choose **Advanced setup** when you need to configure storage backends, an LDAP,
SQL, or OpenID Connect directory, logging, TLS/DKIM behavior, public IP values,
or automatic DNS management. Empty input accepts a displayed default. Enter
`-` only where an optional prompt supports clearing a value.

On a fresh internal-directory install, setup prints the permanent administrator
username and password once. Save them in a password manager before continuing.

The installer then:

1. writes and validates Stalwart's configuration;
2. starts `stalwart.service` and waits for its local readiness endpoint;
3. installs and starts `stalwart-webui.service` on `127.0.0.1:8081` by default;
4. adds the exact WebUI origin to Stalwart's CORS settings and verifies it;
5. in automatic mode, installs Caddy, moves Stalwart's HTTP/HTTPS listeners to
   `127.0.0.1:8080` and `127.0.0.1:8443`, publishes both hostnames on 80/443,
   and installs a certificate synchronization timer;
6. prints the URLs and combined DNS table;
7. asks which outbound SMTP relay to use (Brevo by default, Mailjet, or skip); and
8. if the printed DNS rows are not already in the zone, can publish them
   through the name.com DNS API.

If setup uses an external directory, or if this is a reinstall, the installer
prompts for a Stalwart administrator username and password or app password. The
password input is hidden.

## 6. Publish the forward DNS records

The installer prints a `TYPE`, `HOST`, `ANSWER`, `TTL`, and `PRIO` table, then
asks whether those rows are already in the authoritative zone.

If they are not, it asks for a name.com API username and token and the DNS
zone (default: the mail domain). It creates, updates, or replaces A, AAAA, MX,
TXT, CNAME, and SRV records through `https://api.name.com/v4`. If the zone
already has records that conflict with the Stalwart table—an old A/AAAA
address, extra MX hosts, a previous SPF/DKIM/DMARC TXT, or a CNAME/ANAME on a
name that now needs an address record—the installer lists them and asks
whether to replace them (default yes). It deletes extras at that host after
confirmation. Site-verification TXT records and NS records are left in place.
CAA, TLSA, NS, and PTR rows from the printed table are skipped. The token is
typed with echo disabled and is not saved in `installer-state.json`.

If you already published the table by hand, answer yes and skip name.com.

When Stalwart automatic DNS management is enabled, still verify the mail and
WebUI A/AAAA rows; those hostnames must resolve to this server.

- Replace `<PUBLIC_IPV4_NOT_DETECTED>` with the server's public IPv4 address
  before expecting name.com to publish an A record.
- When a long HOST or ANSWER wraps onto another terminal line, join the parts
  without spaces before publishing it by hand.

PTR is not included in the forward-DNS table. The separate reverse-DNS section
maps each detected public IP to the Stalwart hostname for operators who send
mail directly from this server. Configure that recommended mapping in the server
or VPS provider's reverse-DNS control when available; do not add it to the
domain's authoritative zone. Reverse DNS is not required to open the Stalwart
admin or WebUI URLs.

Wait for public DNS resolution before testing the public URLs.

## 7. Optional SMTP relay

Google Cloud blocks outbound TCP 25. After the DNS table, the installer asks
which outbound SMTP relay to use. **Brevo is the default.** Mailjet remains
available. Skip only if this host can deliver on TCP 25.

### Brevo (default)

| Prompt | Brevo value |
| --- | --- |
| SMTP host | `smtp-relay.brevo.com` |
| SMTP port | `587` (STARTTLS) or `465` (implicit TLS) |
| SMTP login | SMTP username (often `xxx@smtp-brevo.com`) |
| SMTP key | SMTP password (echo disabled). Not the REST API key. |

The installer then creates or updates a Stalwart `MtaRoute` named `brevo` and
points remote outbound routing at it while keeping local-domain delivery local.
Secrets are not command-line arguments. See
[How to set up a Brevo SMTP relay](BREVO_SMTP_RELAY.md).

If you also publish DNS through name.com after choosing Brevo, the installer
merges `include:spf.brevo.com` into existing SPF TXT rows. Add Brevo's DKIM
selector from the Brevo dashboard separately.

### Mailjet

| Prompt | Mailjet value |
| --- | --- |
| SMTP host | `in-v3.mailjet.com` |
| SMTP port | `587` (STARTTLS) or `465` (implicit TLS) |
| API key | SMTP username |
| Secret key | SMTP password (echo disabled) |

The installer creates or updates an `MtaRoute` named `mailjet` and points
remote outbound routing at it. See
[How to set up a Mailjet SMTP relay](MAILJET_SMTP_RELAY.md).
Name.com publishing merges `include:spf.mailjet.com` into SPF.

After DNS resolves and you create a user in the Stalwart admin panel, that user
can sign in to the WebUI and send mail.

## 8. Verify or configure HTTPS publishing

### Automatic Caddy mode

The recommended mode writes an installer-marked `/etc/caddy/Caddyfile` with
separate routes:

| Public hostname | Local upstream |
| --- | --- |
| Stalwart hostname and its protocol-discovery names | `http://127.0.0.1:8080` |
| WebUI hostname | `http://127.0.0.1:8081` or the selected port |

Caddy obtains and renews the public HTTPS certificates. A root-only systemd
timer validates Caddy's certificate and matching key for the Stalwart hostname,
copies them to the Stalwart certificate directory, and restarts Stalwart only
when they change. This lets the same trusted certificate serve IMAPS and SMTPS
while Caddy owns public ports 80 and 443.

Allow inbound TCP 80 and 443 and ensure both A/AAAA records resolve to this
server. Initial certificate issuance cannot finish until DNS is correct. The
installer accepts its own marked Caddyfile or an unchanged Debian/Ubuntu
package sample verified against the package checksum. Any edited, unmarked
`/etc/caddy/Caddyfile` makes automatic mode stop, so an operator configuration
is never overwritten.

### Operator-managed mode

Configure your existing HTTPS reverse proxy with these values:

| Proxy setting | Value |
| --- | --- |
| Public listener | The exact WebUI origin, such as `https://webmail.example.com` |
| TLS certificate | A certificate trusted for the WebUI hostname |
| Upstream | `http://127.0.0.1:8081` or the port selected during install |
| Public path | `/` |

Keep the WebUI port private. Do not expose it directly to the internet over
plain HTTP. The WebUI sends JMAP requests to the Stalwart HTTPS hostname that
you entered during setup.

## 9. Create a user and sign in

1. Open `https://mail.example.com/admin/`, using your Stalwart hostname.
2. Sign in with the administrator credential.
3. Create a normal account and assign an email address and password.
4. Open the WebUI origin, such as `https://webmail.example.com/`.
5. Sign in with the user's full email address or account name and its password
   or app password.

Give account holders the end-user guide: [How to sign in to the WebUI and send
email](WEBUI_USER_GUIDE.md).

## Verify the installation

Check both systemd units:

```sh
sudo systemctl is-active stalwart.service
sudo systemctl is-active stalwart-webui.service
sudo systemctl is-enabled stalwart.service
sudo systemctl is-enabled stalwart-webui.service
```

For automatic Caddy mode, also check:

```sh
sudo systemctl is-active caddy.service
sudo systemctl is-enabled stalwart-caddy-cert-sync.timer
sudo systemctl status --no-pager stalwart-caddy-cert-sync.timer
```

Each command should print `active` or `enabled`. If `curl` is installed, check
the local readiness endpoints:

```sh
curl --fail --silent --show-error http://127.0.0.1:8080/healthz/ready
curl --fail --silent --show-error http://127.0.0.1:8081/healthz/ready
```

Replace `8081` if you selected another WebUI port. Finally, open both public
HTTPS URLs and confirm that a normal account can sign in to the WebUI.

## Installation paths

The standard layout uses:

| Purpose | Path |
| --- | --- |
| Stalwart binary | `/usr/local/bin/stalwart` |
| Configuration | `/etc/stalwart/config.json` |
| Environment overrides | `/etc/stalwart/stalwart.env` |
| Installer state without credentials | `/etc/stalwart/installer-state.json` |
| Data | `/var/lib/stalwart/` |
| Logs | `/var/log/stalwart/` |
| Private Node.js, when needed | `/opt/stalwart-node/<version>/bin/node` |
| WebUI | `/opt/stalwart-webui/` |
| Stalwart unit | `/etc/systemd/system/stalwart.service` |
| WebUI unit | `/etc/systemd/system/stalwart-webui.service` |

A custom Stalwart prefix uses `$PREFIX/bin`, `$PREFIX/etc`, `$PREFIX/data`, and
`$PREFIX/logs`. The WebUI prefix must not contain, or be contained by, any
Stalwart binary, configuration, data, or log directory or by the private
Node.js root at `/opt/stalwart-node`. It also must not contain the selected
system Node.js executable.

## Update the WebUI only

To replace the web app without touching Stalwart, Caddy, DNS, or mail data,
build a new archive and copy it to the server with `update.sh`:

```sh
cd webui
npm ci
npm test
npm run build
tar -czf ../stalwart-webui.tar.gz \
  install.sh server.mjs stalwart-webui.service dist
cd ..
```

On the installed Ubuntu server, put `update.sh` and `stalwart-webui.tar.gz` in
the same directory, then run:

```sh
sudo sh ./update.sh
```

The updater reads the live `stalwart-webui.service` unit and the installed
`config.json`, then installs over that prefix, port, Node.js binary, and
default mail-server URL. Preview with `sudo sh ./update.sh --dry-run`. After
it finishes, hard-refresh the webmail URL so the browser loads the new assets.

## Reinstall or update everything

Build a matching Stalwart binary and WebUI archive, replace the three staging
files, and run the same command:

```sh
sudo sh ./install.sh
```

The installer preserves an existing non-empty `config.json` and skips initial
Stalwart setup. It asks for an administrator credential so it can apply and
verify the selected WebUI origin. It never stores that credential in
`installer-state.json`.

Back up the configuration and data before an update. Do not remove or truncate
`config.json`: an empty configuration file is treated as an incomplete install
and stops the installer.

## Uninstall

Preview the paths and services that the uninstaller detects:

```sh
sudo sh ./uninstall.sh --dry-run
```

Remove both services and their installed application files while preserving
Stalwart configuration, stored mail, logs, and service accounts:

```sh
sudo sh ./uninstall.sh --yes
```

To permanently delete all Stalwart configuration and stored mail as well, use:

```sh
sudo sh ./uninstall.sh --purge --remove-private-node --yes
```

The purge command is irreversible. Back up the Stalwart configuration and data
before running it. The script detects custom prefixes from the installed
systemd units; use `--stalwart-prefix` or `--webui-prefix` only when those units
are missing. It does not remove DNS records, reverse-proxy or TLS configuration,
firewall rules, backups, source files, or the original installation artifacts.

## Troubleshooting

### The installer says an interactive terminal is required

Run it from a local terminal or an SSH session that allocates a terminal. Do
not invoke it from a background job or a non-interactive automation runner.

### The Stalwart binary is incompatible

Rebuild `stalwart` from the same source revision as `install.sh`. Run
`./stalwart --setup --help` and confirm that the output mentions quick setup
and `STALWART_SETUP_RESULT_PATH`. Also confirm that the binary is executable and
matches the target platform.

### The WebUI archive is rejected

Rebuild the archive with the exact command in step 2. Do not wrap its contents
in another directory. The installer rejects absolute paths, parent-directory
paths, symbolic links, missing files, and old archives without the compatibility
marker.

### Node.js cannot be installed

Confirm that the server can reach `https://nodejs.org` and that its clock and
CA certificates are valid. The installer supports official Node.js Linux
binaries on x86-64, ARM64, ARMv7, ppc64le, and s390x. On another architecture,
install Node.js 22.12 or later from a trusted source and rerun the installer.

The installer refuses to use a download whose SHA-256 checksum differs from
Node.js's official `SHASUMS256.txt` value.

### A service does not become ready

Check its status and recent logs:

```sh
sudo systemctl status --no-pager stalwart.service
sudo systemctl status --no-pager stalwart-webui.service
sudo journalctl -u stalwart.service -n 100 --no-pager
sudo journalctl -u stalwart-webui.service -n 100 --no-pager
```

Check that ports `8080` and the selected WebUI port are not already used. Fix
the reported configuration or port problem, then rerun the installer.

### CORS configuration fails

On a reinstall or external-directory setup, enter a working Stalwart
administrator password or app password when asked. If the credentials are
rejected, the installer asks again instead of exiting. Confirm that Stalwart
is healthy on `127.0.0.1:8080` if the prompt keeps repeating after a correct
password.

### SMTP relay configuration fails

For Brevo, confirm the values are the SMTP login and SMTP key from
[SMTP & API](https://app.brevo.com/settings/keys/smtp), not the Brevo website
password and not a REST API key. For Mailjet, confirm the SMTP API key and
secret key from
[SMTP and SEND API settings](https://app.mailjet.com/account/relay), not the
Mailjet website login. Port 25 is rejected. If Stalwart rejects the
administrator credentials, or the relay update fails, the installer asks for
those values again instead of exiting. After a successful configuration,
create a user and send from the WebUI only after the domain is authenticated
in the selected relay.

### name.com DNS publishing fails

Confirm the API username and production token, that the zone is in that
name.com account, and that two-step verification allows API access. The
installer repeats those questions after an API error. If old records conflict,
it lists replacements and deletions and asks before changing them. CAA and
reverse-DNS rows are never sent to name.com. NS records and unrelated
verification TXT records are not deleted.

### The WebUI works locally but not publicly

Confirm that the WebUI hostname resolves to the server, the reverse proxy has a
trusted TLS certificate, and the proxy routes the exact hostname to the
displayed localhost upstream. Do not add a path to the public WebUI origin.

With automatic Caddy mode, also confirm that inbound TCP 80 and 443 are open
and inspect `journalctl -u caddy.service`. Certificate synchronization status is
available with `journalctl -u stalwart-caddy-cert-sync.service`; if DNS became
valid after installation, trigger an immediate retry with:

```sh
sudo systemctl start stalwart-caddy-cert-sync.service
```

## Related documentation

- [BearMail overview and installer options](../README.md)
- [Installer behavior specification](../CLI_SETUP_SPEC.md)
- [Installer test plan](../CLI_SETUP_TEST_PLAN.md)
- [Brevo SMTP relay](BREVO_SMTP_RELAY.md)
- [Mailjet SMTP relay](MAILJET_SMTP_RELAY.md)
- [SMTP relay and name.com DNS test plan](INSTALLER_RELAY_DNS_TEST_PLAN.md)
- [WebUI documentation](../webui/README.md)
