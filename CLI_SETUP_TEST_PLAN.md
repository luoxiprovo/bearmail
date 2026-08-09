# Stalwart CLI Setup Test Plan

## Scope

Verify the native `--setup` command, installer integration, manual-only DNS behavior, generated DNS checklist, error handling, and reinstall compatibility described in `CLI_SETUP_SPEC.md`.

## Automated tests

### CLI parsing and prompt helpers

- `--help` lists `--setup` and describes it as interactive initial setup.
- `--setup` is recognized with `--config=<path>` and does not enter normal server mode.
- yes/no input accepts empty input as the documented default and accepts case-insensitive `y`, `yes`, `n`, and `no`.
- required prompts retry on an empty value when no default exists.
- IPv4 and IPv6 prompts accept the correct family, reject the wrong family, and accept an empty optional value.
- EOF and input errors produce setup errors rather than silently selecting values.

### Bootstrap construction

- RocksDB setup uses `STALWART_SETUP_DATA_PATH`, file logging uses `STALWART_SETUP_LOG_PATH`, the internal directory is selected, and DNS is `Manual`.
- FoundationDB setup selects `DataStore::FoundationDb` and preserves an optional cluster-file path.
- TLS and DKIM answers map to `requestTlsCertificate` and `generateDkimKeys`.
- setup-scoped paths are normalized with a trailing path separator where required.

### DNS checklist

- supplied IPv4 produces an A and PTR entry.
- supplied IPv6 produces an AAAA and PTR entry.
- omitted addresses produce clearly marked placeholders, not invented IP addresses.
- the generated zone contains MX and SPF records.
- DKIM-enabled setup contains a DKIM TXT record.
- no output offers or attempts automatic DNS updates.

### Installer static behavior

- `sh -n install.sh` and, when available, `shellcheck install.sh` pass.
- the installer invokes `--setup` before every service-creation function on a fresh install.
- `STALWART_SETUP_STORE=foundationdb` is selected with `--fdb`; otherwise `rocksdb` is selected.
- an existing config file bypasses setup.
- setup failure is explicitly guarded, so the installer exits with rerun guidance and service creation is not reached.
- the old bootstrap-log and `/admin` completion instructions are absent.

## Integration tests

Run the built binary against isolated temporary config, data, and log directories.

### Happy path, bundled store

Input:

- hostname `mail.example.test`;
- domain `example.test`;
- IPv4 `192.0.2.10`;
- no IPv6;
- TLS `no` (avoids an external ACME dependency in the test);
- DKIM `yes`;
- confirm `yes`.

Verify:

- exit status is zero;
- `config.json` exists and selects RocksDB under the temporary data directory;
- a permanent `admin@example.test` credential is printed;
- output includes the A record, IPv6 placeholder, PTR guidance, MX, SPF, and DKIM;
- reopening the generated configuration succeeds.

### Happy path without DKIM

Choose DKIM `no`. Verify setup succeeds, DNS output is still present, and no DKIM record is claimed.

### Declined confirmation

Answer `no` at confirmation. Verify non-zero/cancelled status as documented, no `config.json`, and no persistent registry initialization.

### Existing configuration

Run setup a second time against the happy-path configuration. Verify it refuses to overwrite the initialized deployment and leaves files unchanged.

### Existing store through another config path

Before the first normal server startup, run setup with a different nonexistent config path but the same data-store path as the happy-path setup. Verify it reports that the selected store is already initialized, creates no second config, and leaves registry object counts unchanged.

### Invalid input recovery

Provide an invalid hostname/domain and wrong-family IP values before valid values. Verify the wizard gives actionable feedback, retries, and succeeds after correction.

### FoundationDB selection

Where a FoundationDB client and test cluster are available, select the FoundationDB store and verify the saved `config.json` plus registry bootstrap. Otherwise, verify construction and installer selection through unit/static tests and record the environment limitation.

## Platform installer checks

In disposable Linux systemd, Linux init.d, macOS, and FreeBSD environments:

- run a fresh install through a TTY (including `curl ... | sh`, where the wizard must read `/dev/tty`);
- verify service-account ownership of config, data, logs, and generated DKIM material;
- verify the service starts after setup and does not enter bootstrap mode;
- verify a reinstall skips setup and retains administrator/domain data;
- verify a setup error prevents service installation/startup.

At minimum, the development environment must execute the applicable local platform checks and the remaining platform cases must receive static review.

## Three-agent review iterations

After implementation and local checks, perform three independent test-agent iterations. In each iteration the agent must:

1. Read `CLI_SETUP_SPEC.md` and this test plan.
2. Inspect the complete working-tree diff.
3. Run all feasible automated and integration checks.
4. Report findings by severity with exact reproduction steps and identify unexecuted cases.

After each report, fix valid findings, rerun affected checks, and give the same agent the updated implementation for the next iteration. The third iteration must include a full regression pass and an explicit acceptance-criteria verdict.
