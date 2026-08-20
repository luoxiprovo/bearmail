# Stalwart and WebUI Interactive Installer Specification

## Goal

A user places `install.sh`, a compatible compiled `stalwart` binary, and a
prebuilt `stalwart-webui.tar.gz` in one directory on a new Linux server. Running
`sudo sh ./install.sh` installs Stalwart and the mail/calendar WebUI with one
interactive flow while keeping two systemd services and two public hostnames.

The webpage is not part of first-run Stalwart bootstrap. All bootstrap fields
available on the webpage remain available in the terminal wizard.

## Installer contract

`install.sh` accepts only `-h` and `--help`. A prefix, hostname, domain, origin,
port, store, secret, and every other answer are rejected as command-line
arguments. All questions read from `/dev/tty`; an unavailable terminal stops the
installer before changes.

The target requires Linux and systemd. The installer asks for:

1. standard FHS paths or a custom Stalwart prefix;
2. the local Stalwart binary path (default `./stalwart` beside the script);
3. the prebuilt WebUI archive path (default `./stalwart-webui.tar.gz`);
4. the WebUI installation prefix and localhost port;
5. the exact public WebUI HTTPS origin, with an optional nonstandard port and no path;
6. automatic Caddy publishing (default) or an operator-managed proxy; and
7. confirmation before system changes.

An invalid editable answer does not terminate the installer. The installer
explains the accepted form and repeats that question until the answer is valid
or interactive input ends. Cancellation, missing prerequisites, invalid
artifact contents, and installation command failures remain fatal.

The installer never downloads or builds either application. It validates that:

- the Stalwart artifact is an executable regular file compiled with the CLI
  setup, quick setup, DNS table, and secure installer-result handoff;
- the WebUI artifact is a safe gzip tar without absolute paths, parent traversal,
  or symbolic links;
- the archive root contains `install.sh`, `server.mjs`,
  `stalwart-webui.service`, `dist/index.html`, and `dist/config.json`;
- the public WebUI value is an exact HTTPS DNS origin;
- the local WebUI port is valid and does not collide with Stalwart port 8080;
- the WebUI prefix does not contain or sit inside a Stalwart binary,
  configuration, data, log, private Node.js runtime, or selected Node.js
  executable path.

After artifact validation, the installer reuses an absolute system Node.js
22.12-or-later executable when available outside a user home. Otherwise it:

1. maps the Linux architecture to an official Node.js binary target;
2. downloads the current Node.js 22 `SHASUMS256.txt` and immutable release
   archive over HTTPS;
3. verifies the archive's SHA-256 checksum;
4. installs only the `node` executable under
   `/opt/stalwart-node/<version>/bin/node`; and
5. passes that exact absolute path to the WebUI installer and systemd unit.

The private runtime does not replace a distro-managed or user-installed
`node`. Supported official Linux targets are x64, arm64, armv7l, ppc64le, and
s390x. If neither curl nor wget exists, the installer bootstraps curl through a
recognized package manager. It similarly installs coreutils when no SHA-256
tool exists. Download, checksum, architecture, or runtime execution failure
stops installation before service accounts or application files are created.

## Stalwart bootstrap

After installing the binary but before creating or starting its service, a fresh
installation invokes:

```text
stalwart --config=<selected config path> --setup
```

Setup answers are not command arguments. Installer-derived data/log paths,
best-effort detected public IPv4/IPv6 addresses, and a root-only temporary result
path are passed as environment values. Advanced setup may edit the address
defaults. The result file is created with mode 0600 inside the installer's
temporary directory and is deleted at completion.

The CLI offers:

- quick setup (default), which asks only for the Stalwart hostname and primary
  mail domain and retains every other bootstrap default;
- advanced setup, which prompts every reachable field in the embedded webpage
  schema.

Advanced setup covers server identity and TLS/DKIM; main, blob, search, and
in-memory stores; internal, LDAP, SQL, and OpenID Connect directories; every
logging destination; and every manual or automatic DNS provider with its nested
settings and secret sources. Unavailable compile-time variants remain visible
but cannot be selected.

The fully constructed `Bootstrap` object uses the same registry validation as
webpage setup. Existing non-empty regular `config.json` files are preserved.
Empty/non-regular config paths fail. A fresh install cannot create services
unless setup produces a non-empty config and its private result file.

## Two services and two hostnames

The installer creates and starts:

- `stalwart.service`, using the configured server hostname such as
  `mail.example.com`;
- `stalwart-webui.service`, bound to `127.0.0.1:8081` by default and configured
  to connect to `https://mail.example.com`.

The WebUI has a different public origin such as `https://webmail.example.com`.
The two hostnames may resolve to the same public IP. The installer asks for the
WebUI origin before Stalwart setup; `https://webmail.example.com` is only an
example. After the mail hostname and domain are known, leftover example origins
(`webmail.example.com`, `.org`, `.net`, `.test`) are re-prompted with the default
`https://webmail.<mail-domain>`. The WebUI hostname cannot equal the mail
hostname or a Caddy protocol-discovery name. Automatic mode installs a
packaged Caddy service, writes separate Stalwart and WebUI routes, and replaces
only its marked Caddyfile or a checksum-verified pristine package sample. It binds
Stalwart HTTP/HTTPS to `127.0.0.1:8080` and `127.0.0.1:8443`, enables forwarded
HTTP metadata, pins Stalwart's public URL, and publishes Caddy on ports 80/443.
Operator-managed mode leaves proxy and listener policy untouched.

Because SMTP/IMAP TLS still terminates in Stalwart, automatic mode provisions a
file-backed Certificate object, changes the primary Domain to manual
certificate management, and selects that certificate as Stalwart's default. A
systemd timer verifies the hostname and public/private key pair from Caddy's
ACME storage, copies changed files with Stalwart-readable permissions, and
restarts Stalwart. The initial placeholder is replaced after DNS permits Caddy
to issue the public certificate. Neither mode exposes the WebUI over public
plain HTTP.

## Exact CORS automation

Only after both local services pass readiness checks, the installer posts an
authenticated registry update to Stalwart's local JMAP endpoint. It sets:

| Header | Value |
| --- | --- |
| `Access-Control-Allow-Origin` | exact normalized WebUI origin |
| `Access-Control-Allow-Headers` | `Authorization, Content-Type, Accept, X-Requested-With` |
| `Access-Control-Allow-Methods` | `POST, GET, PATCH, PUT, DELETE, HEAD, OPTIONS` |
| `Vary` | `Origin` |

It also sets `usePermissiveCors=false`, requests `ReloadSettings`, and verifies
an OPTIONS response locally. For fresh internal-directory setup, the private
result supplies the one-time administrator credential. External-directory fresh
setups and reinstalls prompt for an administrator password or app password with
terminal echo disabled. If Stalwart rejects those credentials (HTTP 401/403),
the installer explains the failure and asks again instead of exiting. The
secret is streamed to the updater on standard input and is never a command
argument or environment value.

## Completion and DNS

The setup result includes Stalwart's hostname/domain, public IPs, and complete
provider-neutral DNS rows. The installer removes the administrator credential
and saves mode-0600 non-secret installer state beside `config.json` for safe
reinstalls.

At the end, one aligned forward-DNS table contains `TYPE`, `HOST`, `ANSWER`,
`TTL`, and `PRIO` columns with:

- Stalwart A/AAAA rows;
- primary-domain MX, SPF, DKIM, DMARC, SRV, MTA-STS, TLS reporting, CAA,
  autoconfig, and autodiscover rows where applicable;
- WebUI A and optional AAAA rows using the same detected/supplied public IP;
- an explicit placeholder when public IPv4 could not be detected.

PTR rows from the Stalwart setup result are excluded from that table. A separate
reverse-DNS section maps each detected public IP to the Stalwart hostname,
explains that the mapping is configured outside the domain's authoritative
zone, and distinguishes direct-outbound deliverability guidance from
the DNS required to open the Stalwart and WebUI URLs. The installer also
distinguishes records added manually from records handled by Stalwart automatic
DNS management; the mail and WebUI address records must resolve in either mode.

After printing the table, the installer asks:

- whether to send outbound mail through a Mailjet SMTP relay (default yes).
  Choosing yes prints the Mailjet account steps, then asks for the SMTP host
  (default `in-v3.mailjet.com`), port (default 587), API key, and secret key.
  It creates or updates a named `mailjet` MTA relay route over the local JMAP
  management API, keeps local-domain delivery local, and reloads settings. If
  Stalwart rejects the administrator credentials, or the Mailjet keys cannot be
  applied, the installer asks for those values again instead of exiting. The
  administrator and Mailjet secrets are streamed on standard input to the
  updater; they are never command arguments or persistent installer state.
- whether the printed forward-DNS rows are already in the authoritative zone.
  If they are not, it asks for a name.com API username, token, and DNS zone
  (default: the mail domain) and creates, updates, or replaces supported
  records through `https://api.name.com/v4`. Conflicting records at the same
  host (old A/AAAA addresses, extra MX targets, SPF/DKIM/DMARC TXT, and
  CNAME/ANAME that cannot coexist with an address record) are listed and,
  after confirmation (default yes), deleted or updated. Unrelated verification
  TXT records and NS records are left unchanged. When a Mailjet relay was just
  configured, SPF TXT answers gain `include:spf.mailjet.com`. CAA, TLSA, NS,
  and PTR are not published. Invalid name.com credentials are explained and
  the questions repeat.

The completion message shows the Stalwart admin URL, WebUI public URL, localhost
WebUI upstream, HTTPS publishing status, and the account flow: create a user
in the Stalwart admin panel, then sign in to the WebUI with the full email
address/account name and password or app password. When Mailjet and DNS are in
place, that user can send mail from the WebUI after public DNS resolves.

## Acceptance criteria

1. Any setup/install answer passed as an argument is rejected.
2. All questions remain interactive through `/dev/tty`.
3. The two application artifacts remain local and are never downloaded or
   built; a missing runtime is obtained only from the official Node.js release
   host and checksum-verified.
4. Quick setup asks only for Stalwart hostname and mail domain.
5. Advanced setup retains webpage bootstrap field parity.
6. Fresh setup finishes before either service starts.
7. Both systemd services pass local readiness checks.
8. Stalwart stores and returns the exact WebUI CORS origin and required headers.
9. No administrator secret appears in arguments, environment, DNS, or persistent installer state.
10. The final forward-DNS table contains both public hostnames and actual
    detected/supplied IPs without presenting PTR as a domain-zone record.
11. Existing Stalwart configuration is preserved on reinstall.
12. After DNS, HTTPS proxy, and TLS are configured, an admin-created account can
    log in to the WebUI and use advertised JMAP Mail, Submission, and Calendar capabilities.
13. Invalid interactive paths, ports, DNS names, WebUI origins, and
    authentication answers show a correction and re-prompt instead of
    terminating the installer.
14. Automatic mode never overwrites an operator-owned Caddyfile, keeps ports
    8080/8081 private, and installs an active certificate synchronization timer.
15. Choosing Mailjet SMTP relay creates or updates a named `mailjet` route and
    remote outbound strategy without placing Mailjet secrets in arguments or
    installer state.
16. When forward DNS is not already published, name.com credentials are accepted
    interactively and only supported record types are created or updated.
    Conflicting records at the same host are listed and replaced only after
    confirmation; NS and unrelated verification TXT records are preserved.
