# Test plan: Mailjet relay and name.com DNS in the combined installer

This plan verifies the end-of-install Mailjet SMTP relay and name.com DNS
publishing added to `install.sh`. Automated checks run without root, Mailjet,
or name.com. Live account steps need a disposable Linux VM.

Related: [CLI_SETUP_TEST_PLAN.md](../CLI_SETUP_TEST_PLAN.md),
[CLI_SETUP_SPEC.md](../CLI_SETUP_SPEC.md),
[MAILJET_SMTP_RELAY.md](MAILJET_SMTP_RELAY.md),
[INSTALL.md](INSTALL.md).

## A. Automated (no root, no live APIs)

From the repository root:

```sh
sh -n install.sh
sh -n webui/install.sh
sh tests/resources/scripts/install_prompt_retry_test.sh
sh tests/resources/scripts/install_dns_output_test.sh
sh tests/resources/scripts/install_proxy_config_test.sh
sh tests/resources/scripts/install_namecom_plan_test.sh
```

If ShellCheck is installed:

```sh
shellcheck -s dash install.sh
```

Optional surrounding checks (longer):

```sh
cargo fmt --all -- --check
npm --prefix webui test
git diff --check
```

### Expected results

| Command | Expected |
| --- | --- |
| `sh -n install.sh` | exit 0, no output |
| `sh -n webui/install.sh` | exit 0, no output |
| `install_prompt_retry_test.sh` | `PASS: invalid installer answers are explained and re-prompted` |
| `install_dns_output_test.sh` | `PASS: installer separates forward-zone records from reverse DNS guidance` |
| `install_proxy_config_test.sh` | `PASS: installer renders isolated Caddy routes and certificate synchronization` |
| `install_namecom_plan_test.sh` | two PASS lines: zone-relative Mailjet SPF merge, and conflict reconciliation |

### Coverage those scripts must prove

1. Mailjet SMTP port `25` is rejected; `587` is accepted after a retry.
2. Combined DNS table includes mail and WebUI A rows, excludes PTR.
3. name.com plan uses zone-relative hosts (`mail`, `webmail`, `@` as `""`).
4. Choosing Mailjet merges `include:spf.mailjet.com` into SPF TXT rows.
5. CAA and out-of-zone hosts are skipped, not published.
6. Conflicting live records are reconciled as:
   - old mail `A` reused/updated to the new address;
   - extra `A` at the same host deleted;
   - `CNAME` on a name that needs `A` deleted;
   - extra Google `MX` deleted, primary `MX` replaced;
   - old SPF replaced, Google site-verification TXT kept;
   - `NS` not deleted;
   - missing WebUI `A` created.

## B. Static installer contract

Inspect `install.sh` (no execution as root):

- Mailjet secret and name.com token are not passed as command-line arguments.
- `installer-state.json` writing still deletes `administrator`.
- Completion asks Mailjet relay (default yes) after the DNS table, then asks
  whether DNS is already published (default no).
- Conflicting name.com records print a replace/delete list and prompt
  `Replace the conflicting name.com records with the Stalwart DNS table`.
- Declining that prompt skips publishing without treating it as a credential
  failure.

## C. Live Mailjet + name.com (disposable VM)

Requires: systemd Linux VM, public IPv4, interactive TTY, `install.sh`,
`stalwart`, `stalwart-webui.tar.gz`, a name.com domain on name.com nameservers,
and a Mailjet account.

### C1. Happy path

1. Run `sudo sh ./install.sh` (quick setup, automatic Caddy).
2. After the DNS table, answer **yes** to Mailjet relay.
3. Enter `in-v3.mailjet.com`, port `587`, API key, secret key.
4. Answer **no** to already-published DNS.
5. Enter name.com zone, username, and token.
6. If conflicts are listed, answer **yes** to replace them.
7. Create a user in Stalwart admin. After DNS/TLS, send mail from the WebUI to
   an external inbox. Confirm the message in Mailjet activity.

Pass: services healthy, `mailjet` MTA route present, remote outbound uses that
route, name.com has Stalwart A/MX/SPF (with Mailjet include) and WebUI A,
WebUI can send.

### C2. Conflicting old DNS

Preload the name.com zone with:

- `mail` A to a parking IP, plus a second `mail` A;
- `mail` CNAME to a parking host (if the UI allows; otherwise ANAME);
- apex MX to Google (`aspmx.l.google.com` and `alt1.aspmx.l.google.com`);
- apex TXT `v=spf1 include:_spf.google.com ~all`;
- apex TXT `google-site-verification=test`;
- leave name.com NS records unchanged.

Rerun C1 through the name.com prompt. Confirm the conflict list shows replace
and delete rows, then accept replacement.

Pass: parking A/CNAME gone, one `mail` A to this server, one MX to the
Stalwart hostname, SPF includes Mailjet and not only Google, verification TXT
and NS still present, WebUI A created.

### C3. Decline replacement

Same preload as C2. At the replace prompt, answer **no**.

Pass: installer completes without name.com mutations, tells the operator to
publish by hand, does not re-ask name.com credentials as if auth failed.

### C4. Skip Mailjet, skip name.com

Answer **no** to Mailjet, **yes** to already-published DNS.

Pass: no Mailjet route, no name.com API calls, completion still prints URLs
and warns that outbound TCP 25 may be blocked.

### C5. Failure paths

- Wrong administrator secret at CORS or Mailjet: installer re-prompts instead
  of exiting.
- Wrong Mailjet secret: installer re-prompts the API key and secret key.
- Wrong name.com token: questions repeat; a correct retry publishes.
- Mailjet port `25`: re-prompt; `587` or `465` continues.

## Exit criteria

Section A must pass on this tree. Section B must match `install.sh`.
Sections C1–C5 are required before calling the feature done on GCP; if a live
Mailjet or name.com account is unavailable, list that gap explicitly and do
not mark C as passed.
