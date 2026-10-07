# Test plan: SMTP relay and DNS publishing in the combined installer

This plan verifies the end-of-install Brevo (default) or Mailjet SMTP relay
and name.com or Hostinger DNS publishing added to `install.sh`. Automated
checks run without root, a relay account, or a DNS provider. Live account
steps need a disposable Linux VM.

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
sh tests/resources/scripts/install_hostinger_plan_test.sh
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
| `install_namecom_plan_test.sh` | three PASS lines: zone-relative Brevo SPF merge, Mailjet SPF merge, and conflict reconciliation |
| `install_hostinger_plan_test.sh` | two PASS lines: conflict replacement with MX/SRV encoding, and no writes when the zone already matches |

### Coverage those scripts must prove

1. Relay SMTP port `25` is rejected; `587` is accepted after a retry.
2. Combined DNS table includes mail and WebUI A rows, excludes PTR.
3. The shared DNS plan uses zone-relative hosts (`mail`, `webmail`, apex as `""`).
   Hostinger publishes that apex as `@`.
4. Choosing Brevo merges `include:spf.brevo.com` into SPF TXT rows; choosing
   Mailjet merges `include:spf.mailjet.com`.
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

- Relay secrets and DNS tokens are not passed as command-line arguments.
- `installer-state.json` writing still deletes `administrator` and does not
  store the name.com or Hostinger token.
- Completion asks which SMTP relay to use (Brevo default) after the DNS table,
  then asks whether DNS is already published (default no).
- If it is not, the provider menu is name.com (default), Hostinger, or publish
  by hand.
- Conflicting records print a replace/delete list and prompt
  `Replace the conflicting name.com records with the Stalwart DNS table` or
  `Replace the conflicting Hostinger records with the Stalwart DNS table`.
- Declining that prompt skips publishing without treating it as a credential
  failure.

## C. Live Brevo + name.com (disposable VM)

Requires: systemd Linux VM, public IPv4, interactive TTY, `install.sh`,
`stalwart`, `stalwart-webui.tar.gz`, a name.com domain on name.com nameservers,
and a Brevo account.

### C1. Happy path

1. Run `sudo sh ./install.sh` (quick setup, automatic Caddy).
2. After the DNS table, accept **Brevo** as the outbound SMTP relay.
3. Enter `smtp-relay.brevo.com`, port `587`, SMTP login, SMTP key.
4. Answer **no** to already-published DNS.
5. Choose **name.com**. Enter the zone, username, and token.
6. If conflicts are listed, answer **yes** to replace them.
7. Create a user in Stalwart admin. After DNS/TLS, send mail from the WebUI to
   an external inbox. Confirm the message in Brevo activity.

Pass: services healthy, `brevo` MTA route present, remote outbound uses that
route, name.com has Stalwart A/MX/SPF (with Brevo include) and WebUI A,
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
Stalwart hostname, SPF includes Brevo and not only Google, verification TXT
and NS still present, WebUI A created.

### C3. Decline replacement

Same preload as C2. At the replace prompt, answer **no**.

Pass: installer completes without name.com mutations, tells the operator to
publish by hand, does not re-ask name.com credentials as if auth failed.

### C4. Skip relay, skip name.com

Choose **Skip** for the SMTP relay, then **yes** to already-published DNS.

Pass: no `brevo` or `mailjet` route, no name.com API calls, completion still
prints URLs and warns that outbound TCP 25 may be blocked.

### C5. Failure paths

- Wrong administrator secret at CORS or the relay: installer re-prompts
  instead of exiting.
- Wrong Brevo SMTP key or Mailjet secret: installer re-prompts the SMTP login
  and key.
- Wrong name.com token: questions repeat; a correct retry publishes.
- Relay port `25`: re-prompt; `587` or `465` continues.

## D. Live Brevo + Hostinger (disposable VM)

Same as section C, with a Hostinger domain on Hostinger nameservers and an
API token from hPanel → API. At the provider menu choose **Hostinger**. The
prompts are the zone and the token; there is no username.

Pass: Hostinger shows the same A, AAAA, MX, SPF, and SRV rows. MX content is
`10 mail.example.com` (priority, then host). SRV content is
`priority weight port target`. Apex names are `@`. NS records and an unrelated
TXT stay. A conflicting CNAME or ALIAS at `mail` or `webmail` is removed.
Declining the replace prompt does not call the update API. A wrong token
repeats the token question.

## Exit criteria

Section A must pass on this tree. Section B must match `install.sh`.
Sections C and D are required before calling the feature done on a live
domain; if a Brevo, name.com, or Hostinger account is unavailable, list that
gap explicitly and do not mark that section as passed.
