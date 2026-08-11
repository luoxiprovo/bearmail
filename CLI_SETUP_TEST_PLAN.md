# Stalwart Interactive Installer and CLI Setup Test Plan

## Scope

Verify `CLI_SETUP_SPEC.md`: argument-free installer choices, source/binary acquisition, `/dev/tty` behavior, complete webpage-schema field parity, interactive validation, persistence safety, and service ordering.

## Automated Rust tests

### CLI operation parsing

- `--help` documents `--setup` as interactive initial setup.
- `--setup` works with both `--config PATH` and `--config=PATH`.
- missing setup/config selectors and unknown setup arguments fail clearly.
- no hostname, domain, store, directory, tracer, DNS provider, or secret can be supplied as a setup command-line option.

### Prompt primitives

- yes/no accepts blank defaults and case-insensitive short/long answers;
- required strings retry on blank input;
- optional strings retain, set, and clear values as documented;
- numeric menus reject non-numeric, out-of-range, and unavailable choices;
- scalar JSON prompts reject the wrong JSON type;
- collection prompts reject malformed/non-collection JSON;
- EOF produces an error instead of silently accepting later defaults;
- IPv4/IPv6 prompts reject the wrong family and accept an omitted optional value.
- setup mode defaults to quick and accepts the advanced selection.

### Embedded webpage schema

- the embedded gzip resource parses successfully;
- the top-level Bootstrap form contains identity, four stores, directory, tracer, and DNS fields;
- CLI setup uses the schema's variants for DataStore, BlobStore, SearchStore, InMemoryStore, DirectoryBootstrap, Tracer, and DnsServerBootstrap;
- changing a variant loads its schema defaults and prompts every form field that is not server-set;
- nested multiple-variant fields recurse into their selected form;
- list/map/set editors accept JSON values of the correct container shape;
- compiled-feature filtering marks unavailable backends and prevents selection;
- the serialized interactive result deserializes to `Bootstrap` and passes its registry validation for the default path.
- quick setup prompts only for server hostname and mail domain and retains the remaining serialized `Bootstrap` defaults.

### Bootstrap and DNS

- installer-provided data/log directories are visible defaults, not fixed answers;
- manual DNS is the default and every automatic provider in `DnsServerBootstrap` is listed;
- selecting an automatic provider prompts its nested credentials and settings;
- TLS and DKIM answers map to their Bootstrap booleans;
- installer-detected IPv4/IPv6 values become the quick-setup A/AAAA and PTR rows;
- supplied IPv4/IPv6 produce correctly reversed PTR hostnames;
- omitted IPv4 produces an explicit detection-failure placeholder and omitted IPv6 does not publish an AAAA row;
- generated output contains MX, SPF, DMARC, and DKIM when enabled;
- generated output is an aligned `TYPE`, `HOST`, `ANSWER`, `TTL`, `PRIO` table whose long DKIM values wrap without shifting columns;
- completion output distinguishes manual DNS from the selected automatic provider.

## Installer static tests

- `sh -n install.sh` passes;
- `shellcheck install.sh` passes when ShellCheck is installed;
- only `-h` and `--help` are accepted; `--fdb`, a positional prefix, and unknown flags fail;
- every prompt reads from `/dev/tty`, including when standard input is a pipe;
- no `stalwartlabs/stalwart/releases` URL or upstream artifact downloader is used;
- the default Git repository is `valuerouterDev/stalwart`;
- source and local-binary choices are interactive;
- install prefix and FoundationDB build-profile choices are interactive;
- the standard community build enables SQLite, PostgreSQL, MySQL, RocksDB, S3, Redis, Azure, and the normal supporting features, but does not enable `enterprise`;
- setup runs before all service creation/start functions on a fresh install;
- no user-entered setup answer is included in the Stalwart command line or environment; only installer-derived data/log paths and detected public IP defaults are passed internally;
- existing config skips setup;
- empty and non-regular config paths fail instead of being treated as initialized;
- setup returning without a non-empty regular config prevents service creation/start;
- the selected binary's CLI setup compatibility is checked before system changes;
- public IPv4/IPv6 detection is bounded, best-effort, and passed only as internal wizard defaults;
- source, build, and setup failures are explicitly guarded before service creation;
- old `/admin` completion instructions are absent.

## Local CLI integration tests

Build a test binary with all feasible standard features, then use isolated temporary config, data, and log directories.

### Default single-node path

Select advanced setup, then:

- valid hostname/domain;
- IPv4 and no IPv6;
- TLS off (avoids external ACME dependency in the test);
- DKIM on;
- RocksDB, default blob/search/cache stores;
- internal directory;
- file logging;
- apply.

Verify zero exit, valid `config.json`, initialized RocksDB, permanent administrator credential, manual DNS notice, A/AAAA placeholder/PTR guidance, MX/SPF/DMARC/DKIM records, and successful reopen of the saved config.

### Quick setup path

Select quick setup, enter only a valid hostname and mail domain, and accept the final review. Verify all remaining values equal `Bootstrap::default()` plus installer data/log path defaults, detected IPs appear in the DNS table, and setup creates a valid config without presenting storage, directory, logging, TLS/DKIM, or DNS-provider questions.

### Web-form parity variants

For each top-level variant, drive the wizard far enough to select it and inspect its questions. Compare prompt names/defaults against `resources/schema/schema.json.gz`. For variants whose services are available (SQLite and local filesystem at minimum), complete setup and verify the stored object. For external databases/services, stop before apply or use disposable containers and record the limitation.

### Nested settings

Exercise at least:

- PostgreSQL with username/secret source and TLS options;
- S3 with region and credential-source choices;
- Redis Cluster with URL set;
- LDAP with bind-secret choice and attribute sets;
- SQL directory with a nested SQL store;
- OpenTelemetry HTTP with nested HTTP authentication/headers.
- Cloudflare or another disposable DNS provider configuration with a nested secret source.

Verify values survive JSON-to-`Bootstrap` conversion and registry validation.

### Input and state failures

- invalid hostname/domain and wrong-family IP recover after valid input;
- malformed JSON collection recovers at the same field;
- unavailable FoundationDB selection is rejected by a non-FoundationDB build;
- invalid external-backend configuration produces validation/build feedback and no service startup;
- declining apply and then cancelling leaves config/store absent;
- a second setup against an existing config refuses overwrite;
- another config path pointed at an initialized data store is rejected without changing object counts.

### FoundationDB

Where the FoundationDB client and test cluster exist, build the FoundationDB profile, select it interactively for the main store, and complete/reopen setup. Otherwise verify feature annotation, build command construction, schema questions, and document the missing external prerequisite.

## Installer interaction tests

Use a disposable Linux VM/container with a real pseudo-terminal:

1. Run `sh install.sh` from this checkout and complete the current-checkout source build path.
2. Pipe the script into `sudo sh`; verify every installer and Rust question still reads from `/dev/tty`.
3. Run the existing-binary path with the newly built compatible binary.
4. Exercise standard and custom prefix layouts.
5. Verify ownership/permissions, service start after setup, and no bootstrap web mode.
6. Rerun with an existing config and verify its registry/account/domain data are unchanged.
7. Inject a build failure and a setup cancellation; verify no service creation/start occurs.
8. Stub public-IP responses for IPv4 and IPv6 and verify the exact addresses appear in A/AAAA rows and generate PTR rows.
9. Make setup return success without writing a config and verify installation fails before creating a service.
10. Place an empty config at the selected path and verify installation gives a repair instruction instead of reporting success.

macOS launchd, Linux init.d, and FreeBSD rc.d cases receive disposable-host execution where available and otherwise static review of unchanged service code.

## Documentation checks

- README starts with the exact install command for this repository's script;
- it explains source-build and compatible-local-binary paths selected by the installer;
- it does not direct users to official release binaries or the webpage setup;
- it describes every wizard stage, automatic/manual DNS choices, and PTR follow-up;
- examples contain no obsolete `--fdb`, positional-prefix, or `STALWART_SETUP_STORE` instructions.

## Exit criteria

All feasible automated/static/local integration checks pass. Any unavailable platform, external database, DNS, ACME, or FoundationDB test is explicitly listed with the reason. No service is started in a failure-path test, and the working-tree diff contains no upstream-download or webpage-setup instruction.
