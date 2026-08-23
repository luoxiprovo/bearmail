# Stalwart and WebUI Combined Installer Test Plan

## Scope

Verify `CLI_SETUP_SPEC.md`: local-artifact installation, argument-free
interaction, webpage-schema parity, safe bootstrap persistence, two systemd
services, exact CORS automation, automatic Caddy publishing, certificate
synchronization, combined DNS output, optional Brevo or Mailjet SMTP relay,
and optional name.com DNS publishing.

SMTP relay, name.com publishing, and conflicting old DNS records have a
focused plan in [docs/INSTALLER_RELAY_DNS_TEST_PLAN.md](docs/INSTALLER_RELAY_DNS_TEST_PLAN.md).

## Automated Rust tests

### CLI parsing and prompts

- `--setup` requires a config path and rejects hostname/domain/store arguments;
- quick setup is the default and retains every non-identity `Bootstrap` default;
- advanced prompt primitives validate required/optional values, numbers,
  booleans, JSON containers, IP families, unavailable variants, and EOF;
- every selected nested form comes from the embedded webpage schema;
- a serialized result deserializes to `Bootstrap` and passes registry validation.

### Bootstrap, private handoff, and DNS

- installer data/log/IP values are editable defaults;
- manual DNS is the default and all schema DNS providers remain selectable;
- generated rows contain the applicable MX, SPF, DKIM, DMARC, SRV, MTA-STS,
  TLS reporting, CAA, autoconfig, and autodiscover records;
- detected/supplied addresses produce A, AAAA, and correct PTR rows;
- missing IPv4 produces the explicit placeholder and missing IPv6 omits AAAA;
- the table keeps aligned `TYPE`, `HOST`, `ANSWER`, `TTL`, `PRIO` columns while
  wrapping long values;
- `STALWART_SETUP_RESULT_PATH` is documented in setup help;
- the result JSON uses camel-case keys, contains all DNS rows and, when created,
  the internal administrator credential; it uses mode 0600 and refuses to
  overwrite an existing file;
- a second config aimed at an initialized data store is rejected without
  mutating registry object counts.

## Installer static tests

- `sh -n install.sh` and `sh -n webui/install.sh` pass;
- `shellcheck -s dash` passes when ShellCheck is installed;
- only `-h` and `--help` are accepted by the public installer;
- every public answer is read from `/dev/tty`;
- no source build, release download, artifact URL, or answer-bearing public CLI
  flag exists;
- defaults point to `stalwart` and `stalwart-webui.tar.gz` beside `install.sh`;
- Linux/systemd are checked before system changes;
- an absolute system Node.js >=22.12 outside user homes is reused unchanged;
- a missing, old, or user-home Node.js selects the correct official x64,
  arm64, armv7l, ppc64le, or s390x archive, verifies the immutable release
  checksum, and installs a private versioned executable;
- curl and coreutils bootstrap through supported package managers only when a
  download client or SHA-256 implementation is missing;
- checksum mismatch, unsupported architecture, failed download, and an
  unusable extracted runtime stop before service accounts or application paths;
- the Stalwart help markers and WebUI archive marker/shape are checked before
  account, filesystem, or service changes;
- archive traversal, absolute paths, and symbolic links are rejected;
- the WebUI origin requires exact HTTPS with a DNS hostname and no path/query;
- invalid editable paths, reserved/invalid ports, DNS names, and WebUI origins
  explain the accepted form and re-prompt instead of exiting;
- the WebUI prefix may not contain or sit inside a Stalwart system directory or
  the private Node.js runtime root or selected Node.js executable;
- fresh setup and its non-empty config/result checks precede service creation;
- existing non-empty config skips bootstrap; empty/non-regular config fails;
- the WebUI binds to `127.0.0.1`, uses a distinct service account, receives
  Stalwart's public HTTPS URL in `dist/config.json`, and starts with the exact
  selected Node.js executable rather than a PATH lookup;
- the standalone WebUI installer rejects a systemd Node.js path below a user
  home or per-user runtime directory;
- automatic publishing refuses an unmarked existing Caddyfile, validates its
  generated Caddyfile, routes the mail/discovery hosts to `127.0.0.1:8080`, and
  routes only the WebUI hostname to its selected localhost port;
- automatic publishing moves Stalwart HTTP/HTTPS to loopback, enables
  forwarded-header processing, sets the public URL, replaces automatic Domain
  certificate management with a file-backed Certificate, and installs a timer
  that validates and synchronizes Caddy's mail-host key pair;
- the CORS updater runs after WebUI readiness, sets `usePermissiveCors=false`,
  updates all four exact headers, reloads settings, and verifies OPTIONS;
- administrator password bytes reach Node only through stdin;
- persistent `installer-state.json` explicitly removes `administrator`;
- the final forward-DNS table adds WebUI A/AAAA rows, excludes PTR rows, and
  completion text names both URLs and the selected HTTPS publishing mode;
- reverse DNS is shown separately as public-IP-to-mail-host guidance, marked as
  outside the domain DNS zone and unnecessary for opening either public URL;
- manual and automatic DNS-management guidance identifies which forward records
  the operator must add or verify;
- relay SMTP port 25 is rejected and 587/465 are accepted;
- the name.com DNS plan uses zone-relative hosts, adds WebUI A/AAAA rows,
  skips PTR/CAA, and merges `include:spf.brevo.com` or `include:spf.mailjet.com`
  into SPF for the selected relay;
- name.com reconciliation replaces differing A/MX/SPF rows, deletes extra
  records and CNAME clashes at the same host, and preserves unrelated TXT and
  NS records.

## Local non-root verification

Run:

```sh
sh -n install.sh
sh -n webui/install.sh
sh tests/resources/scripts/install_prompt_retry_test.sh
sh tests/resources/scripts/install_dns_output_test.sh
sh tests/resources/scripts/install_proxy_config_test.sh
sh tests/resources/scripts/install_namecom_plan_test.sh
cargo fmt --all -- --check
npm --prefix webui test
npm --prefix webui run build
git diff --check
```

Package the WebUI and inspect its root:

```sh
cd webui
tar -czf ../stalwart-webui.tar.gz \
  install.sh server.mjs stalwart-webui.service dist
cd ..
tar -tzf stalwart-webui.tar.gz
```

Expected root entries include the five required files/trees and no link or
parent-traversal entry.

## Disposable clean-server integration

Prepare a Linux VM with systemd, public IPv4 (and IPv6 when available), outbound
HTTPS, and a pseudo-terminal. Do not preinstall Node.js for the first run. Put
these files in one directory:

```text
install.sh
stalwart
stalwart-webui.tar.gz
```

The Stalwart binary must be rebuilt after changes to `setup.rs`.

### Fresh quick setup

1. Run `sudo sh ./install.sh` with standard paths and artifact defaults.
2. Choose a WebUI origin such as `https://webmail.example.test` and automatic
   Caddy publishing.
3. In Stalwart setup, select quick mode and enter `mail.example.test` plus
   `example.test`; accept final review. If the WebUI origin is still the
   installer example, accept the suggested `https://webmail.example.test`.
4. Verify setup asks no storage/directory/logging/DNS questions.
5. Verify `config.json` and root-only non-secret `installer-state.json` exist.
6. Verify `stalwart.service`, `stalwart-webui.service`, and `caddy.service` are
   active and enabled, and the certificate synchronization timer is enabled.
7. Verify local readiness on ports 8080 and 8081, both bound only to loopback;
   verify Caddy owns public ports 80/443 and Stalwart HTTPS moved to 8443 on
   loopback.
8. Verify an OPTIONS request with the exact WebUI origin returns all configured
   CORS headers and no wildcard allow-origin.
9. Verify the final forward-DNS table contains `mail.example.test` and
   `webmail.example.test` A/AAAA rows with the VM's actual public addresses,
   plus the complete mail-domain zone, contains no PTR row, and is followed by
   separate public-IP-to-mail-host reverse-DNS guidance.
10. Verify no administrator secret exists in `installer-state.json`, service
    files, process arguments, or shell history.
11. Verify the installer downloaded Node.js from `nodejs.org`, matched the
    official SHA-256 value, installed it below `/opt/stalwart-node/<version>`,
    and wrote that exact path to `stalwart-webui.service` without creating or
    replacing `/usr/bin/node` or `/usr/local/bin/node`.
12. After publishing DNS, verify Caddy has a trusted certificate for both
    public hosts, run the synchronization service, and confirm Stalwart serves
    the same mail-host certificate on IMAPS and SMTPS.

### Fresh advanced setup

Repeat on a new VM. Exercise at least local RocksDB/internal directory/file log,
then representative nested PostgreSQL, S3, Redis Cluster, LDAP, SQL directory,
OpenTelemetry HTTP, and automatic DNS-provider forms. External backends may stop
before apply unless disposable dependencies are provided. Verify prompt labels,
defaults, nested variants, validation, and serialized objects against
`resources/schema/schema.json.gz`.

### Browser acceptance

Publish both hostnames and allow inbound ports 80/443 so automatic Caddy can
obtain trusted certificates. Repeat browser acceptance once with
operator-managed mode and an existing proxy.

1. Sign in to `https://mail.example.test/admin/` with the generated admin.
2. Create a normal user with an email address and password.
3. Open `https://webmail.example.test/` in a clean browser profile.
4. Sign in with the full email address and password.
5. Verify JMAP session discovery, mailbox listing, read/send mail, calendar
   listing, event create/edit/delete, and invite response.
6. Confirm browser network requests use the configured Stalwart HTTPS hostname,
   CORS responses use the exact WebUI origin, and credentials are absent from
   persistent browser storage.

### Reinstall and failure paths

- rerun the installer, confirm config/account/domain data are unchanged, supply
  an administrator credential at the hidden prompt, and verify CORS again;
- rerun with a compatible system Node.js and verify no runtime download occurs;
- place an unmarked `/etc/caddy/Caddyfile`, choose automatic mode, and verify it
  fails without changing that file; then choose operator-managed mode and
  verify the existing proxy remains untouched;
- use fixture downloads to cover every architecture mapping, checksum mismatch,
  missing checksum entry, malformed archive, and extracted-version failure;
- use a wrong administrator secret and verify CORS, Caddy proxy, and SMTP relay
  configuration re-prompt instead of exiting; a non-auth JMAP failure still
  returns non-zero for CORS/Caddy;
- enter the same Stalwart/WebUI hostname, port 8080, non-HTTPS/path origins,
  invalid prefixes, and missing artifact paths; verify each prompt remains
  active, then enter a valid replacement and continue;
- test an old Stalwart binary, malformed archive contents, archive
  traversal/link, empty config, setup cancellation, result-file omission, and
  failed readiness as fatal errors;
- for every preflight failure, verify no system file/service was changed;
- for post-install failures, verify the installer reports the exact incomplete
  stage and never prints a false success message.

## Exit criteria

All feasible automated/static/non-root checks pass. Clean-server browser
acceptance passes with both public HTTPS hostnames. Any unavailable public DNS,
TLS proxy, IP family, external backend, ACME provider, or FoundationDB test is
listed explicitly with its reason; it is not reported as passed.
