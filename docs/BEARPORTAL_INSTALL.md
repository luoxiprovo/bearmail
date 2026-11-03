# Using bearmail-install

BearPortal runs this program on the customer's mail server. It installs one pinned BearMail release and publishes that server's mail DNS. BearPortal does not write DNS itself, and this program does not call the Brevo REST API.

The program does not ask questions. It does not read stdin or `/dev/tty`. Put every value in the input file or in the credential files named by that input. BearPortal calls only `bearmail-install`. It does not run `install.sh` and it does not answer installer prompts.

## Command

Run as root on the mail server (Linux x86-64, systemd):

```text
bearmail-install --input <input.json> --result <result.json>
```

Check the plan without installing software and without writing DNS:

```text
bearmail-install --dry-run --input <input.json> --result <result.json>
```

`--input` and `--result` are filesystem paths. Do not put tokens, the SMTP key, or the admin password on the command line or in the environment.

Exit codes:

| Exit | Meaning |
|---|---|
| 0 | Installed, and the DNS provider accepted every required record. A successful dry run also exits 0. |
| 10 | Safe to retry the same input. The result file is the checkpoint. |
| 1 | Permanent failure. Read `errorCode` in the result. |
| 2 | The input is invalid. |

The result file is written on every exit when `--result` is present. It is pretty-printed UTF-8 JSON, mode `0600`. It does not contain the DNS token, the SMTP key, or the admin password. DNS values in the result are public.

## What to place on the server first

Create a root-owned directory, mode `0700`, for this attempt. Put the input and credential files there, mode `0600`. Delete the directory after you have read the result.

### Release directory

Copy these four files from the BearMail revision you are pinning. Do not rename them. The installer does not download a floating "latest" during an apply.

| File | What it is |
|---|---|
| `install.sh` | Existing BearMail installer |
| `stalwart` | Mail engine binary for Linux x86-64 |
| `bearmail-webui.tar.gz` | BearMail website archive |
| `mcp_install.sh` | MCP sidecar installer |

The BearOS admin UI is inside the engine. There is no separate BearOS archive to copy. The result reports `adminUi` as `bundled-with-engine`.

The directory's basename must equal `release.id`. Example: release id `2026-11-01.1` lives in `/var/lib/bearportal/releases/2026-11-01.1/`.

Write `SHA256SUMS` in that directory with `sha256sum` after the four files are in place:

```text
cd /var/lib/bearportal/releases/2026-11-01.1
sha256sum install.sh stalwart bearmail-webui.tar.gz mcp_install.sh > SHA256SUMS
```

`release.checksumFile` is the absolute path of that `SHA256SUMS` file. A missing file or a mismatched hash stops the run before it changes the server or DNS.

### Mail disk

This release stores mail, engine state, and DKIM material at `/var/lib/stalwart`. Set `dataPath` to exactly `/var/lib/stalwart`.

An applying run creates that directory if it is missing. The program does not partition or format a disk. A dry run does not create the directory. If the directory already holds an unrelated mail store, the result is `NONEMPTY_DATA_REFUSED` and nothing is changed.

### Credential files

DNS credential, selected by `dns.provider`:

| Provider | JSON |
|---|---|
| `namecom` | `{"username":"<name.com account username>","token":"<production API token>"}` |
| `hostinger` | `{"token":"<hPanel API token>"}` |
| `godaddy` | `{"apiKey":"<key>","apiSecret":"<secret>"}` |

Relay credential, named by `relay.credentialFile`:

```json
{"smtpKey":"<the Brevo SMTP key>"}
```

Admin credential, named by `adminCredentialFile`. BearPortal generates this password. Use `admin@<domain>` as the username. The engine creates that administrator, and this program sets its password to the one in the file.

```json
{"username":"admin@customer.com","password":"<generated password>"}
```

The relay login in the input is the Brevo SMTP login (often `something@smtp-brevo.com`). It is not a secret file. The Brevo REST API key is not an input and is not used.

### DNS APIs this release calls

| Provider | API |
|---|---|
| `namecom` | Name.com DNS API v4, `https://api.name.com/v4` |
| `hostinger` | Hostinger DNS API v1, `https://developers.hostinger.com/api/dns/v1` |
| `godaddy` | GoDaddy Domains API v1, `https://api.godaddy.com/v1/domains/{zone}/records`, header `sso-key {apiKey}:{apiSecret}` |

TTL is 300 seconds for Name.com and Hostinger. GoDaddy's minimum is 600 seconds. The result field `dns.minimumTtl` is the value used.

## Input

`schemaVersion` is `1`. Unknown fields are rejected. Names are lowercased. `mailHostname` and `webmailHostname` must both be inside `domain` and must differ. Send the customer's real webmail hostname. `webmail.example.com` and `bearmail.example.com` are installer examples and an applying run rejects them.

`mxCutoverAuthorized` must be `true` for an applying run. That is the customer's permission to replace MX. A dry run still shows the MX change when the flag is false.

`publicIpv6` is `null` when the server has no public IPv6 address. The installer then removes a stale AAAA record on the mail and webmail names.

`brevoDnsRecords` is the `dns_records` array from Brevo's create-domain response: one TXT each for `brevo_code`, `dkim`, and `dmarc`. Copy the host and value. Do not invent them.

`relay.host` is `smtp-relay.brevo.com`, `relay.port` is `587`, and `relay.tls` is `starttls-required`.

`mailboxQuotaBytes` is the disk quota for a mailbox, in bytes. This release stores that number on each account as `quotas.maxDiskQuota`. The installer sets it on the administrator account. It does not create customer mailboxes. When BearPortal creates a mailbox later, set `quotas.maxDiskQuota` to the same number.

```json
{
  "schemaVersion": 1,
  "operationId": "8d0b6b6e-1c0a-4e0a-9c1a-6c0e5b7a1111",
  "deploymentId": "2f4c1a40-7b1e-4d3a-8f0a-91a0c0d0e222",
  "generation": 1,
  "mxCutoverAuthorized": true,
  "domain": "customer.com",
  "mailHostname": "mail.customer.com",
  "webmailHostname": "webmail.customer.com",
  "publicIpv4": "203.0.113.10",
  "publicIpv6": null,
  "dataPath": "/var/lib/stalwart",
  "dns": {
    "provider": "namecom",
    "zone": "customer.com",
    "credentialFile": "/run/bearportal/dns.json"
  },
  "brevoDnsRecords": [
    {"purpose": "brevo_code", "type": "TXT", "host": "@", "value": "brevo-code:REPLACE"},
    {"purpose": "dkim", "type": "TXT", "host": "mail._domainkey", "value": "k=rsa;p=REPLACE"},
    {"purpose": "dmarc", "type": "TXT", "host": "_dmarc", "value": "v=DMARC1; p=none; rua=mailto:dmarc@customer.com"}
  ],
  "relay": {
    "host": "smtp-relay.brevo.com",
    "port": 587,
    "tls": "starttls-required",
    "login": "7xxx001@smtp-brevo.com",
    "credentialFile": "/run/bearportal/relay.json"
  },
  "adminCredentialFile": "/run/bearportal/admin.json",
  "mailboxQuotaBytes": 1073741824,
  "release": {
    "id": "2026-11-01.1",
    "artifactDir": "/var/lib/bearportal/releases/2026-11-01.1",
    "checksumFile": "/var/lib/bearportal/releases/2026-11-01.1/SHA256SUMS"
  }
}
```

`dns.zone` is the zone that contains the mail domain. It may be the domain itself or a parent zone.

## Result

`status` is one of:

| Status | Exit | What BearPortal should do |
|---|---|---|
| `dry_run` | 0 | Nothing was changed. `dns.published[].state` is `planned`. |
| `succeeded` | 0 | Services are up and every required DNS write was accepted. TLS is `issued` or `existing`. |
| `tls_pending` | 10 | DNS was accepted and the services are installed. Certificate issuance is waiting. Retry the same input later. |
| `dns_partial` | 10 or 1 | At least one required DNS write was not accepted. Retry when `retryable` is true. |
| `failed` | 1 | Stopped. The checkpoint describes what was left in place. |

`retryable` is true only for exit 10.

Use `dns.published` to see each record. Call Brevo's domain authenticate API only after the Brevo TXT records are `published`. Do that from BearPortal. This program will not call Brevo.

`dns.previousMx` is the MX that was in the zone before this run replaced it. `dns.spf` is the single SPF policy that was published or planned. `dns.dmarcAction` is `published` when a DMARC record was added, or `preserved` when a valid DMARC record was already present and left alone. `dns.engineDkimHost` and `dns.engineDkimValue` are the mail engine's public DKIM record. Store them with the installation. They are not a substitute for Brevo's DKIM record. Both are required.

`generation` is copied from the input so you can match the result to the attempt that submitted it.

## Retry and idempotency

Retry a failed or waiting attempt by running the same command with the same `operationId` and the same desired configuration. Do not allocate a new `operationId` for a retry. A finished attempt returns the same result and does not create a second service, a second DKIM key, or a duplicate DNS record.

The same `operationId` with a different domain, mail hostname, webmail hostname, IP address, DNS provider, zone, Brevo record set, or relay host is `IDEMPOTENCY_CONFLICT`. Nothing is changed. A new configuration needs a new `operationId`. A new operation does not delete existing mailboxes or rotate a DKIM key that is already published for the domain.

`generation` may increase on a retry. It is recorded and is not part of the conflict check.

## Error codes

| Code | Meaning |
|---|---|
| `INVALID_INPUT` | Schema, hostname, address, or path check failed. |
| `MX_NOT_AUTHORIZED` | Applying run without `mxCutoverAuthorized: true`. |
| `IDEMPOTENCY_CONFLICT` | Same `operationId`, different desired configuration. |
| `DNS_PROVIDER_UNSUPPORTED` | Provider is not `namecom`, `hostinger`, or `godaddy`. |
| `DNS_AUTH_FAILED` | Provider rejected the credential. |
| `DNS_ZONE_NOT_FOUND` | The zone is not in the account. |
| `DNS_RECORD_CONFLICT` | SPF, DMARC, or CAA could not be merged safely. Nothing was written. |
| `DNS_PUBLISH_FAILED` | A DNS write failed. |
| `DNS_RATE_LIMITED` | Provider rate limit. Exit 10. |
| `ARTIFACT_MISSING` | A required release file is absent. |
| `ARTIFACT_CHECKSUM_MISMATCH` | A file does not match `SHA256SUMS`. |
| `NONEMPTY_DATA_REFUSED` | `/var/lib/stalwart` already holds an unrelated mail store. |
| `RELAY_AUTH_FAILED` | Brevo rejected the SMTP login. MX is not published unless a previous attempt of this `operationId` already published it. |
| `TLS_PENDING` | Retry certificate issuance. Exit 10. |
| `SERVICE_FAILED` | A required service did not come up. |

`errorMessage` is one sentence and contains no secret.

## Ports

BearPortal does not open ports. This program does not open them either. The operator opens inbound TCP 25, 80, 443, 465, and 993.

| Port | Use |
|---|---|
| 25 | Incoming mail |
| 80 | Certificate issuance |
| 443 | Webmail, admin, and JMAP |
| 465 | Inbound mail submission |
| 993 | IMAPS |

Inbound submission in this release is 465. Port 587 is the outbound Brevo relay at `smtp-relay.brevo.com`. It is not an inbound port.

Ports 8080, 8081, and 8082 stay on localhost. The MCP sidecar listens on loopback only.

## Out of scope

This program does not create the server, open ports, or format a disk. BearPortal does not open ports either. The operator opens inbound TCP 25, 80, 443, 465, and 993. This program does not create the Brevo domain, call Brevo authenticate, or see the Brevo REST key. It does not choose the customer or the server. It does not publish DNS for any provider other than Name.com, Hostinger, and GoDaddy.
