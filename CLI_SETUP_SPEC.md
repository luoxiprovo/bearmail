# Stalwart Interactive Installer and CLI Setup Specification

## Goal

A user runs `install.sh` without supplying installation or setup answers as command-line parameters. The installer obtains this repository's source (or accepts a locally built binary), installs it, and immediately starts a native terminal wizard. The wizard exposes the same identity, storage, directory, logging, and DNS-management fields as the webpage bootstrap form.

The webpage is no longer part of first-run setup.

## Installer interaction

`install.sh` accepts only `-h` and `--help`. A prefix, `--fdb`, store choice, hostname, domain, and all other installation/setup answers must not be accepted as command-line arguments.

The installer uses `/dev/tty` for its questions and for the Rust setup wizard. This makes the normal download-and-pipe form work:

```sh
curl --proto '=https' --tlsv1.2 -sSfL \
  https://raw.githubusercontent.com/valuerouterDev/stalwart/main/install.sh | sudo sh
```

When `/dev/tty` cannot be opened, installation stops before making changes and explains that an interactive terminal is required.

The installer asks for:

1. standard FHS paths or a custom installation prefix;
2. whether to build this revision from source or install an existing compatible binary;
3. for a source build, the source checkout/repository and build profile (all standard bootstrap backends, or FoundationDB-enabled);
4. confirmation before installing the binary and running setup.

The default source repository is `https://github.com/valuerouterDev/stalwart.git`, not the upstream Stalwart release download. A checkout containing the current `install.sh` is preferred when available. The standard source build enables every community, non-FoundationDB backend reachable from the webpage bootstrap form and omits the `enterprise` Cargo feature. FoundationDB support is a separate community build choice because its client library is an external prerequisite.

The installer verifies that the selected binary supports CLI setup, creates the service account and filesystem layout, installs the binary, detects the server's public IPv4/IPv6 addresses over HTTPS, then invokes:

```text
stalwart --config=<selected config path> --setup
```

The config path and `--setup` select the operation; setup answers are never encoded in command arguments. Data, log, and detected public-IP values may be supplied internally as defaults, but advanced setup lets the user review and change them. IP detection is best-effort and never substitutes a private interface address for a public address.

## Wizard stages and field parity

The canonical webpage schema embedded in `resources/schema/schema.json.gz` drives nested CLI questions. This prevents a second handwritten list of backend fields from drifting away from the webpage.

The CLI first offers two modes:

- quick setup (default) asks only for the server hostname and default email domain, retains every other WebUI bootstrap default, uses detected public IPs, and proceeds directly to final review;
- advanced setup presents all stages below.

The advanced CLI presents the following stages in order.

### 1. Server identity

- server hostname;
- default email domain;
- public IPv4 address (optional, used only for the DNS checklist);
- public IPv6 address (optional, used only for the DNS checklist);
- automatically obtain a TLS certificate;
- generate DKIM signing keys.

Hostname and domain answers are normalized and validated before continuing. IP inputs must match their requested address family.

### 2. Storage

The user independently selects and configures every storage role offered by the webpage:

- main data storage: RocksDB, SQLite, FoundationDB, PostgreSQL, or MySQL;
- attachment/file storage: data store, sharded, S3-compatible, Azure, filesystem, FoundationDB, PostgreSQL, or MySQL;
- full-text search: data store, Elasticsearch, Meilisearch, FoundationDB, PostgreSQL, or MySQL;
- cache/temporary storage: data store, sharded, Redis/Valkey, Redis Cluster, or Redis Sentinel.

After a variant is selected, every field in that variant's webpage form is prompted with the same default from the embedded schema, except server-generated output fields. Nested choices such as secret sources, SQL stores, authentication modes, and regions are also interactive. Collection values use JSON syntax where the webpage uses a list, map, or set editor.

A variant that is present in the webpage schema but not compiled into the installed binary remains visible with an unavailable annotation. Selecting it gives an actionable build-feature message and does not advance.

### 3. Account directory

- internal directory;
- LDAP;
- SQL;
- OpenID Connect.

Every field reachable in the chosen webpage directory form is prompted. The completion screen only prints a newly generated administrator credential when bootstrap created one; external directories follow the existing promotion behavior.

### 4. Logging

- rotating log file;
- console/stdout;
- systemd journal;
- OpenTelemetry over HTTP;
- OpenTelemetry over gRPC.

Every field reachable in the chosen webpage tracer form is prompted.

### 5. DNS management

The CLI lists every DNS-management variant in `x:DnsServerBootstrap`, including manual DNS, RFC 2136/TSIG, Cloudflare, Route53, and the other providers offered by the webpage. Selecting a provider prompts every nested setting and secret-source choice from that provider's webpage form. Manual mode remains the default.

## Validation, review, and persistence

- Empty input accepts the displayed default.
- Boolean input accepts case-insensitive `y`, `yes`, `n`, and `no`.
- Menus accept only enabled numeric choices.
- Scalar values are type checked; list/map/set values are parsed as JSON.
- The fully constructed `Bootstrap` object is validated with the same registry validator used by webpage setup.
- Validation failures are printed and the operator can revisit the questionnaire.
- A final summary shows identity plus the selected stores, directory, tracer, TLS, DKIM, and DNS mode.
- Declining final application may return to editing or cancel without creating `config.json` or initializing the persistent store.
- Existing `config.json` files are preserved and skip setup during reinstall.
- Empty or non-regular config paths are not considered initialized and produce an actionable error.
- A fresh install cannot proceed to service creation unless setup returned successfully and produced a non-empty regular `config.json`.
- The persistent-store emptiness check occurs before any registry write, preventing a second config file from partially reinitializing an existing store.

## Completion output

After successful bootstrap the CLI prints:

- the permanent administrator username and one-time password when the internal directory created them;
- one aligned table with `TYPE`, `HOST`, `ANSWER`, `TTL`, and `PRIO` columns;
- an `A` row containing the detected or supplied IPv4 address, or an explicit detection-failure placeholder;
- an `AAAA` row when public IPv6 is available;
- a `PTR` row for each public IP, plus a note that reverse DNS belongs at the IP provider;
- the complete primary-domain records, including applicable MX, SPF, DKIM, DMARC, SRV, MTA-STS, TLS reporting, CAA, autoconfig, and autodiscover rows;
- for manual DNS, a reminder that Stalwart did not contact a provider;
- for automatic DNS, the selected provider and a reminder to verify its first update after startup.

## Failure and security behavior

- Secrets are never placed in command arguments, DNS output, or installer environment variables.
- Secret values already present while revisiting a form are masked in prompt defaults.
- Setup failure prevents service installation/startup and returns a non-zero status.
- Source-build prerequisites are checked before filesystem/service changes.
- A locally supplied binary must be an executable regular file; the README explains platform and revision compatibility.
- Service files and platform behavior for systemd, init.d, launchd, and FreeBSD rc.d remain unchanged after successful setup.

## Acceptance criteria

1. `install.sh --fdb`, `install.sh /prefix`, and any other setup/install answer passed as an argument are rejected; the same choices exist interactively.
2. `curl ... | sudo sh` reads questions from `/dev/tty` and never consumes the script stream as answers.
3. The default install builds or uses this repository's revised binary and never downloads an upstream release artifact.
4. All five top-level webpage bootstrap sections are represented; every form field reachable from a selected variant is prompted from the embedded schema.
5. Every DNS-management provider and nested setting offered by the webpage is offered by the CLI; manual DNS remains the default.
6. A fresh successful install starts only after bootstrap persisted a valid registry and config file.
7. The permanent administrator credential, when created, is shown once.
8. The final DNS checklist includes address/PTR guidance and the complete generated zone.
9. Existing deployments are preserved during reinstall.
10. Any source acquisition, build, setup, or validation error prevents service startup and returns non-zero.
11. Quick setup asks only for hostname and domain before final review and preserves every other Bootstrap default.
12. Public-IP detection populates the A/AAAA/PTR table rows when the clean server has the corresponding public address family.
