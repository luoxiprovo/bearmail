# Stalwart CLI Setup Specification

## Summary

Replace the fresh-install web bootstrap handoff with an interactive command-line setup. After `install.sh` downloads the Stalwart binary, it must run the native setup wizard before the service is installed and started. A successful install must leave Stalwart fully bootstrapped and must finish by printing the DNS records the operator needs to publish manually.

## Goals

- Complete a new Stalwart installation from the terminal without opening `/admin`.
- Reuse the same validated bootstrap path as the existing JMAP bootstrap API so CLI and API setup produce equivalent registry data.
- Keep the initial CLI flow suitable for the bundled local store and for the FoundationDB build selected by `install.sh --fdb`.
- Configure DNS management as manual in every CLI setup; never request DNS-provider credentials or attempt DNS changes.
- Generate initial DKIM keys before the wizard exits so the final DNS output includes DKIM records.
- Preserve the current reinstall behavior: an existing `config.json` and registry are not overwritten or bootstrapped again.

## Non-goals

- Remove the bootstrap JMAP API or the administrative web application.
- Expose every advanced storage, directory, tracing, clustering, or DNS-provider setting in the initial wizard.
- Discover or modify authoritative DNS automatically.
- Verify DNS propagation during installation.

## User flow

For a new install, `install.sh` performs these operations in order:

1. Detect the platform and create the service account and installation directories.
2. Download and install the selected Stalwart binary.
3. Create the service environment file when it does not exist.
4. Run `stalwart --config=<path> --setup` in the terminal, passing the selected data/log paths and store kind through setup-scoped environment variables.
5. Apply ownership and permissions to all setup-created data.
6. Install and start the platform service.
7. Print the normal installation-success message. The setup wizard's immediately preceding output contains the permanent administrator credential and the manual DNS checklist.

If `config.json` already exists, step 4 is skipped and the installer reports that the existing configuration was preserved.

The native wizard asks for:

- server hostname, with the detected FQDN as the default;
- primary mail domain, with the registrable part of the hostname as the default;
- public IPv4 address (optional, used only in the DNS checklist);
- public IPv6 address (optional, used only in the DNS checklist);
- whether to request a TLS certificate;
- whether to generate DKIM keys;
- for the FoundationDB build, an optional cluster-file path;
- final confirmation before applying irreversible bootstrap writes.

The bundled build uses RocksDB at the installer's data path. The FoundationDB build uses FoundationDB and the supplied cluster file, or the FoundationDB system default when left blank. The internal directory, default blob/search/in-memory stores, and file logging at the installer's log path are used in both cases.

## CLI contract

`stalwart --config=<path> --setup` is an interactive one-shot command.

- `--config` is required, as it is for normal server startup.
- Setup is allowed only when the configuration file does not exist and the registry is in bootstrap mode.
- The selected persistent store must contain neither a schema marker nor any registry objects. A different missing config path must not permit re-bootstrap of a store initialized by an earlier CLI setup, including before the first normal server startup.
- The command does not bind network listeners or start the mail services.
- `STALWART_SETUP_DATA_PATH` selects the RocksDB data path.
- `STALWART_SETUP_LOG_PATH` selects the log path.
- `STALWART_SETUP_STORE` accepts `rocksdb` (default) or `foundationdb`.
- EOF, an invalid required value, failed confirmation, validation failure, or storage initialization failure returns a non-zero exit code without starting the service.
- Hostnames/domains are trimmed and normalized through the existing bootstrap validator. IP input must parse as the corresponding IP family.

The setup command returns success only after:

- the persistent data store and registry are initialized;
- the default domain and permanent administrator account exist;
- manual DNS management is recorded for the domain;
- requested DKIM keys have been generated;
- the final DNS checklist has been generated.

## DNS behavior and output

The CLI setup always uses `DnsServerBootstrap::Manual`. There is no automatic-DNS choice and no provider prompt.

At the end, the wizard prints:

- an `A` record for the server hostname when IPv4 was provided, otherwise an explicit IPv4 placeholder;
- an `AAAA` record when IPv6 was provided, otherwise an optional IPv6 placeholder;
- `PTR` guidance for each supplied public IP, noting that reverse DNS is normally configured with the IP provider;
- the generated BIND-style zone records for the primary domain, including applicable MX, SPF, DKIM, DMARC, SRV, MTA-STS, TLS reporting, CAA, autoconfig, and autodiscover records;
- a reminder that all records must be added manually and that placeholders must be replaced before publishing.

No DNS updater object or DNS-management task may be created by CLI setup.

## Security and failure handling

- The existing bootstrap implementation continues to generate the permanent administrator password. The wizard displays it once and labels it accordingly.
- No temporary recovery password is written to the environment file or passed through a web request.
- Setup-created registry, key, and log files are owned by the service account before startup.
- Secrets are not included in DNS output, logs, command arguments, or the environment.
- If setup fails, `install.sh` exits before installing/starting the service and prints how to rerun the installer.
- A declined final confirmation exits cleanly without creating `config.json`.
- The persistent-store emptiness check runs before any registry object is written, so retries against an already initialized or partially initialized store cannot add duplicate configuration objects.

## Compatibility

- Linux systemd/init.d, macOS launchd, and FreeBSD rc.d service creation remain unchanged except for happening after CLI bootstrap.
- Custom installation prefixes continue to use `<prefix>/data`, `<prefix>/logs`, and `<prefix>/etc/config.json`.
- `install.sh --fdb` selects the FoundationDB bootstrap store.
- `install.sh --help` documents the interactive setup and reinstall skip behavior.

## Acceptance criteria

1. A fresh interactive `install.sh` run never instructs the operator to visit `/admin` to finish setup.
2. The service starts from a persistent, bootstrapped registry after the wizard succeeds.
3. The permanent administrator username and one-time password are printed.
4. The domain is configured for manual DNS management, with no configured DNS provider.
5. When DKIM generation is selected, the final DNS output contains at least one DKIM TXT record.
6. The final output includes A/AAAA/PTR guidance and the complete generated domain zone records.
7. Existing configurations are preserved and do not trigger the wizard.
8. The normal and FoundationDB installer variants select supported data stores.
9. Setup failure prevents service startup and returns a non-zero status.
