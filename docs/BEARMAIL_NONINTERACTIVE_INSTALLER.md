# BearMail noninteractive installer

Status: requirement for the BearMail project · Consumer: BearPortal · Written: 2026-11-01

This document is the contract BearPortal will call. An agent building the installer in the BearMail repository should implement this behavior. BearPortal does not contain the BearMail source tree and does not implement this installer.

The BearMail release that first ships this installer is the release BearPortal will pin. Until that release exists, BearPortal has no installer version to pin.

## 1. Role

BearPortal runs on a Linux control-plane server. For each customer it has already reserved a separate mail server. When the customer submits “install BearMail”, that submission authorizes installation and authorizes replacing the domain’s mail DNS, including MX. There is no later cutover approval.

BearPortal then asks the enrolled host supervisor on the mail server to run:

```text
bearmail-install --input <input.json> --result <result.json>
```

The installer is a BearMail program. It installs the pinned BearMail release on that server and publishes every mail DNS record for the deployment. BearPortal does not write DNS itself.

A second flag prints the plan and changes nothing:

```text
bearmail-install --dry-run --input <input.json> --result <result.json>
```

## 2. What BearPortal has already done

The installer can assume the following, and it must still fail closed if the input violates the schema:

- The customer is a verified BearPortal user and has submitted installation. BearPortal sets `mxCutoverAuthorized` to `true` only for that submission.
- One mail server is assigned to that user. `publicIpv4` is that server’s registered address.
- An operator added a Brevo account in the BearPortal admin inventory. The account includes a Brevo REST API key, the SMTP login, and the SMTP key. Brevo’s documented API can create and authenticate a domain. It does not document an API that generates an SMTP key, so the operator supplies the SMTP key when adding the account. BearPortal stores it and passes it to this installer.
- BearPortal assigned that Brevo account to this user and called `POST https://api.brevo.com/v3/senders/domains` with the customer domain. The response `dns_records` are copied into `brevoDnsRecords`. BearPortal does not invent SPF, DKIM, or Brevo-code values.
- BearPortal saved the SMTP relay settings for this user: host `smtp-relay.brevo.com`, port `587`, STARTTLS required, the account’s SMTP login, and the SMTP key.
- BearPortal does not create or mount `/var/lib/stalwart`. An applying run creates that directory if it is missing.

Brevo will not mark the domain authenticated until the Brevo DNS records are visible. Those records are part of the set this installer publishes. BearPortal calls `PUT /v3/senders/domains/{domainName}/authenticate` only after this installer reports that the provider accepted the DNS writes. That follow-up call is BearPortal’s work. The installer does not call the Brevo API and does not receive the Brevo REST API key.

## 3. Command behavior

- The process has no terminal prompts. Missing input, an empty answer, or a closed stdin is an error. Do not read `/dev/tty`.
- Run as root on Linux x86-64 with systemd.
- `--input` and `--result` are required filesystem paths. Credentials are not accepted as command-line arguments or environment variables.
- Create the result file on every exit, including failure, unless the input cannot be parsed far enough to know the output path. On that early failure, write a one-line error to stderr and exit `2`.
- Exit `0` only when the mail software is installed and the DNS provider has accepted every required record write.
- Exit `10` when the same input can be retried safely because of provider rate limiting, a transient provider error, or TLS issuance still waiting on DNS propagation. The result file then contains the checkpoint.
- Exit `1` for a permanent failure.
- Exit `2` for invalid input.
- `--dry-run` validates credentials against the DNS provider, reads the zone, and writes the planned record changes. It does not install software, reload services, write DNS, or create `/var/lib/stalwart`. A successful dry run exits `0`.

Re-running the same `operationId` with the same desired configuration continues from the last checkpoint. It returns the same logical result when the work is already complete. It does not create a second copy of the services, a second DKIM key, or duplicate DNS records.

The same `operationId` with a different domain, hostname, IP, DNS provider, zone, Brevo record set, or relay host is `IDEMPOTENCY_CONFLICT`. The installer changes nothing and exits `1`.

A new desired configuration uses a new `operationId`. A new operation must not delete existing mailboxes or regenerate a DKIM key that is already published for this domain.

## 4. Files and permissions

BearPortal creates a temporary directory on the mail server, mode `0700`, owned by root. The installer reads these files and does not copy them into the mail store, package logs, or the result file:

| Path | Content |
|---|---|
| input JSON | Non-secret installation parameters. Credential fields are paths, not secret values. |
| DNS credential file | Provider token material named by `dns.credentialFile`. |
| Relay credential file | `{"smtpKey":"..."}` named by `relay.credentialFile`. |
| Admin credential file | `{"username":"...","password":"..."}` named by `adminCredentialFile`. BearPortal generates this password. |

All four files are mode `0600`. The installer does not print their contents. After it has stored the admin and SMTP credentials in the engine’s root-protected configuration, it does not leave extra copies beside the input file. BearPortal deletes the temporary directory after it has read the result.

The result JSON contains no credential, token, password, or SMTP key. It may contain DNS record values, because those values are published in the public DNS.

## 5. Input schema

`schemaVersion` is `1`. Unknown fields are rejected. The input is UTF-8 JSON.

```json
{
  "schemaVersion": 1,
  "operationId": "8d0b6b6e-1c0a-4e0a-9c1a-6c0e5b7a1111",
  "deploymentId": "2f4c1a40-7b1e-4d3a-8f0a-91a0c0d0e222",
  "generation": 1,
  "mxCutoverAuthorized": true,
  "domain": "example.com",
  "mailHostname": "mail.example.com",
  "webmailHostname": "webmail.example.com",
  "publicIpv4": "203.0.113.10",
  "publicIpv6": null,
  "dataPath": "/var/lib/stalwart",
  "dns": {
    "provider": "namecom",
    "zone": "example.com",
    "credentialFile": "/run/bearportal/dns.json"
  },
  "brevoDnsRecords": [
    {
      "purpose": "brevo_code",
      "type": "TXT",
      "host": "@",
      "value": "brevo-code:4bc1566441c4131069853d135c5905ab"
    },
    {
      "purpose": "dkim",
      "type": "TXT",
      "host": "mail._domainkey",
      "value": "k=rsa;p=REPLACE_WITH_THE_BREVO_VALUE"
    },
    {
      "purpose": "dmarc",
      "type": "TXT",
      "host": "_dmarc",
      "value": "v=DMARC1; p=none; rua=mailto:dmarc@example.com"
    }
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
    "id": "recorded-when-this-installer-is-published",
    "artifactDir": "/var/lib/bearportal/releases/recorded-when-this-installer-is-published",
    "checksumFile": "/var/lib/bearportal/releases/recorded-when-this-installer-is-published/SHA256SUMS"
  }
}
```

### 5.1 Field rules

| Field | Rule |
|---|---|
| `operationId`, `deploymentId` | UUID. |
| `generation` | Integer greater than or equal to 1. Record it in the result. The installer does not interpret BearPortal’s generation policy beyond idempotency. |
| `mxCutoverAuthorized` | JSON `true` is required for an applying run. Any other value returns `MX_NOT_AUTHORIZED` and changes nothing. `--dry-run` may proceed without it and must still show the MX replacement in the plan. |
| `domain` | The customer’s mail domain, the part after `@`. Accept a registrable domain or a customer-controlled subdomain. Normalize with IDNA to ASCII, lowercase, and remove one trailing dot. Reject IP literals, URL paths, empty labels, public-suffix-only names, `localhost`, and `.local` names. |
| `mailHostname`, `webmailHostname` | Same name rules. Both must be inside `domain` or equal to it. They must differ from each other. BearPortal sends `mail.<domain>` and `webmail.<domain>` for the beta. |
| `publicIpv4` | Public unicast IPv4 of this mail server. Reject loopback, private, link-local, multicast, and unspecified addresses. |
| `publicIpv6` | `null`, or a public unicast IPv6 address. `null` means the installer must not publish AAAA for the mail hostnames. |
| `dataPath` | Must be `/var/lib/stalwart`. An applying run creates that directory if it is missing. The installer stores mail data, engine configuration state, DKIM keys, and certificate state here. It does not partition or format a disk. |
| `dns.provider` | `namecom`, `hostinger`, or `godaddy`. Any other value is `DNS_PROVIDER_UNSUPPORTED`. |
| `dns.zone` | The DNS zone that contains the mail domain. It may be the mail domain or an ancestor. The installer uses this zone for API calls. |
| `dns.credentialFile` | See §5.2. |
| `brevoDnsRecords` | One record each for `brevo_code`, `dkim`, and `dmarc`, copied from the Brevo domain response. `type` is `TXT`. `host` is the hostname Brevo returned, relative to the zone, with `@` meaning the zone apex. `value` is the exact TXT value. The installer publishes these values and does not rewrite them. |
| `relay.host` | `smtp-relay.brevo.com` for this beta. |
| `relay.port` | `587`. |
| `relay.tls` | `starttls-required`. Cleartext SMTP and optional STARTTLS are rejected. |
| `relay.login` | Brevo SMTP login. |
| `mailboxQuotaBytes` | Positive integer. The engine default quota for a customer mailbox. |
| `release.artifactDir` | Directory containing the release artifacts listed in §6. |
| `release.checksumFile` | SHA-256 sums for those artifacts. The installer verifies every artifact before it executes or copies it. A mismatch is `ARTIFACT_CHECKSUM_MISMATCH` and changes nothing. |

### 5.2 DNS credential file

The file is a JSON object. The required members depend on `dns.provider`:

| Provider | Credential file |
|---|---|
| `namecom` | `{"username":"<name.com account username>","token":"<production API token>"}` |
| `hostinger` | `{"token":"<hPanel API token>"}` |
| `godaddy` | `{"token":"<personal access token from developer.godaddy.com>"}` |

Use the provider’s current documented DNS API. Record the API version in the installer release notes. The required capabilities are: authenticate, confirm the zone exists and is editable, list the relevant records, and create or replace the records in §7 without dropping unrelated records at the same name.

A failed login or a token that cannot edit the zone is `DNS_AUTH_FAILED`. A missing zone is `DNS_ZONE_NOT_FOUND`. Both leave the server unchanged.

## 6. Release artifacts

`release.artifactDir` contains the BearMail release that this installer knows how to install:

- the mail-engine binary
- the Bearmail-webui archive
- the BearOS admin UI archive
- the MCP sidecar payload used by the existing BearMail release
- `SHA256SUMS` referenced by `release.checksumFile`

The installer does not download a floating “latest” release during an apply. BearPortal places the directory on the server before the call. Which BearMail version this installer belongs to is decided when the installer is published.

Verify checksums before installation. Refuse a directory that does not match `release.id`.

## 7. DNS updates

The installer is the only program that updates DNS for this deployment. One applying run publishes the complete set below. It does not leave MX for a later call, and it does not offer a mode that installs mail while preserving the old MX.

### 7.1 Records to publish

| Record | Name | Value |
|---|---|---|
| A | `mailHostname` | `publicIpv4` |
| A | `webmailHostname` | `publicIpv4` |
| AAAA | `mailHostname` and `webmailHostname` | `publicIpv6`, only when it is non-null |
| MX | `domain` | priority `10`, target `mailHostname` |
| TXT | host and value of the `brevo_code` input | exact Brevo value |
| TXT | host and value of the Brevo `dkim` input | exact Brevo value |
| TXT | engine DKIM name | the selector and key generated or already stored for this installation |
| TXT | `domain` SPF | one SPF policy that authorizes Brevo and this server, as specified in §7.3 |
| TXT | DMARC | as specified in §7.4 |

Remove an existing AAAA at `mailHostname` or `webmailHostname` when `publicIpv6` is null. A stale AAAA sends clients to an address this deployment does not use.

Default TTL is 300 seconds where the provider allows it. Where the provider enforces a higher minimum, use that minimum and record it in the result.

### 7.2 Records to leave in place

Read the zone before writing. Preserve records that are not part of §7.1:

- NS records
- the zone apex A and AAAA, and `www`, when those names are not `mailHostname` or `webmailHostname`
- unrelated TXT and CNAME records, including site-verification TXT and DKIM selectors that belong to someone else
- CAA records, unless a CAA record would block the certificate issuance this installer performs; in that case fail with `DNS_RECORD_CONFLICT` and change nothing

At a name this installer does manage, preserve TXT values that are not the SPF record, the Brevo code, the Brevo DKIM value, the engine DKIM value, or the DMARC value. Provider APIs that replace a whole RRset must be implemented as read, modify this installer’s values, and write the merged set.

Replace the previous MX at `domain`. Do not leave the old MX beside the new one. Copy the previous MX into the result before replacing it.

### 7.3 SPF

Publish exactly one SPF TXT record at `domain`.

- Start from the existing SPF record when one exists. Add `include:spf.brevo.com` when it is absent. Keep existing mechanisms that still fit.
- When no SPF record exists, publish `v=spf1 include:spf.brevo.com mx ~all`.
- When more than one SPF record exists, merge them into one valid record when that merge is unambiguous. When it is ambiguous, fail with `DNS_RECORD_CONFLICT` and change nothing.
- The published policy must stay within the SPF 10-DNS-lookup limit. When the merge would exceed it, fail with `DNS_RECORD_CONFLICT`.

### 7.4 DMARC

- When `_dmarc.<domain>` has no TXT record, publish the `dmarc` value from `brevoDnsRecords`.
- When a DMARC record already exists, leave it in place and set `dmarcAction` to `preserved` in the result. Do not replace a stricter policy with Brevo’s `p=none` example.
- When the existing record is not valid DMARC, fail with `DNS_RECORD_CONFLICT`.

### 7.5 Write order inside one run

1. Validate input, checksums, and DNS credentials. An applying run creates `/var/lib/stalwart` if it is missing. A dry run does not.
2. Read the current zone and build the record plan.
3. Install and start the mail services so the engine DKIM key exists. Do this before any DNS write.
4. Publish the full §7.1 set, including MX.
5. Issue or reuse certificates for `mailHostname` and `webmailHostname`.
6. Write the result.

A crash after step 4 is retried with the same `operationId`. The retry observes the published records and does not duplicate them. A crash during step 3 retries installation without formatting `dataPath` and without rotating the DKIM key.

If the DNS provider accepts only part of the set, the result status is `dns_partial`, the exit code is `10` when a retry can continue the same plan, and the result lists each record as `published` or `failed`. The installer does not hide a missing MX behind a success status.

## 8. Installation behavior

Install the verified artifacts onto the server using BearMail’s normal service layout for a systemd host:

- mail engine, listening for inbound SMTP, submission, IMAPS, and JMAP
- Bearmail-webui on the webmail hostname
- BearOS admin UI bound so that server-wide administration is not an anonymous public endpoint
- Caddy, or the release’s existing HTTPS component, for ports 80 and 443 and for the host certificates
- MCP sidecar in the same way the release’s own install places it, listening on loopback only

Configure the engine with:

- primary domain `domain`
- public mail hostname `mailHostname`
- webmail origin `https://<webmailHostname>`
- outbound relay from the `relay` object, using the SMTP key inside the credential file
- admin username and password from the admin credential file
- mailbox quota `mailboxQuotaBytes`
- data stored under `dataPath`

The first installation creates no customer mailbox password that BearPortal can display as a shared default. System mailboxes required by the engine may be created. Customer mailbox passwords are set later by BearPortal through the engine management API, not by this installer.

Before writing data:

- `dataPath` is `/var/lib/stalwart`. An applying run creates it with the equivalent of `mkdir -p` if it is missing. A dry run does not create it.
- Do not partition, format, or resize a disk.
- If `dataPath` already contains a mail store from the same `operationId` or the same domain and engine identity, resume it.
- If `dataPath` contains an unrelated nonempty mail store, return `NONEMPTY_DATA_REFUSED` and change nothing.

Check that the relay accepts an authenticated session to `relay.host` on `relay.port` with STARTTLS. A rejected login is `RELAY_AUTH_FAILED`. Do not publish MX if this authentication check fails and no earlier attempt of this `operationId` has already published MX. If a previous attempt already published MX, leave the DNS in place, report `RELAY_AUTH_FAILED`, and exit `1`.

Open listening sockets only for the mail, web, and certificate-challenge ports the release actually uses. Do not open a public installer control port.

## 9. Result schema

Write pretty-printed UTF-8 JSON, mode `0600`. `schemaVersion` is `1`.

```json
{
  "schemaVersion": 1,
  "operationId": "8d0b6b6e-1c0a-4e0a-9c1a-6c0e5b7a1111",
  "status": "succeeded",
  "installedVersions": {
    "installer": "0.0.0",
    "engine": "0.0.0",
    "webui": "0.0.0",
    "adminUi": "0.0.0",
    "mcp": "0.0.0"
  },
  "serviceChecks": {
    "engine": "running",
    "webui": "running",
    "https": "running",
    "mcp": "loopback"
  },
  "dns": {
    "provider": "namecom",
    "zone": "example.com",
    "previousMx": [{"priority": 10, "target": "old-mx.example.net"}],
    "published": [
      {"type": "A", "host": "mail.example.com", "value": "203.0.113.10", "state": "published"},
      {"type": "MX", "host": "example.com", "value": "10 mail.example.com", "state": "published"}
    ],
    "preserved": ["NS", "apex A", "www A"],
    "spf": "v=spf1 include:spf.brevo.com mx ~all",
    "dmarcAction": "published",
    "engineDkimHost": "default._domainkey.example.com",
    "engineDkimValue": "v=DKIM1; k=rsa; p=PUBLIC_KEY"
  },
  "tls": {
    "mail": {"status": "issued", "notAfter": "2027-01-30T00:00:00Z"},
    "webmail": {"status": "issued", "notAfter": "2027-01-30T00:00:00Z"}
  },
  "errorCode": null,
  "errorMessage": null,
  "retryable": false
}
```

`status` is one of:

| Status | Meaning | Exit |
|---|---|---|
| `dry_run` | Plan only. `published` entries use state `planned`. | `0` |
| `succeeded` | Services installed and every required DNS write accepted. TLS is `issued` or `existing`. | `0` |
| `tls_pending` | DNS writes accepted and services installed; certificate issuance is waiting on propagation. | `10` |
| `dns_partial` | At least one required DNS write is not accepted. | `10` or `1` |
| `failed` | Permanent failure. Services and DNS are left as the checkpoint describes. | `1` |

`engineDkimHost` and `engineDkimValue` are the public DKIM record. BearPortal stores them as the installation evidence. They are not a substitute for the Brevo DKIM record; both must be present when both were required.

`retryable` is `true` only for exit `10`.

## 10. Error codes

Use these stable `errorCode` values. `errorMessage` is one short sentence with no secret material.

| Code | When |
|---|---|
| `INVALID_INPUT` | Schema, hostname, address, or range check failed. |
| `MX_NOT_AUTHORIZED` | Applying run without `mxCutoverAuthorized: true`. |
| `IDEMPOTENCY_CONFLICT` | Same `operationId`, different desired configuration. |
| `DNS_PROVIDER_UNSUPPORTED` | Provider is not `namecom`, `hostinger`, or `godaddy`. |
| `DNS_AUTH_FAILED` | Provider rejected the credential or denied zone edits. |
| `DNS_ZONE_NOT_FOUND` | The named zone is not in the account. |
| `DNS_RECORD_CONFLICT` | Unambiguous SPF, DMARC, or CAA merge is impossible. |
| `DNS_PUBLISH_FAILED` | Provider write failed for a reason other than rate limiting. |
| `DNS_RATE_LIMITED` | Provider asked the client to slow down. Exit `10`. |
| `ARTIFACT_MISSING` | A required release file is absent. |
| `ARTIFACT_CHECKSUM_MISMATCH` | A file does not match `SHA256SUMS`. |
| `NONEMPTY_DATA_REFUSED` | Unrelated mail data is already at `/var/lib/stalwart`. |
| `RELAY_AUTH_FAILED` | Brevo SMTP login was rejected. |
| `TLS_PENDING` | Retry certificate issuance. Exit `10`. |
| `SERVICE_FAILED` | A required service did not reach the reported check. |

## 11. Tests the installer must include

These tests use a disposable Linux VM and recorded DNS-provider fixtures. A live provider test is additional evidence, not a replacement for the fixture tests.

1. No TTY and no stdin are required. An empty stdin still completes a valid input.
2. `--dry-run` reports the MX change from the fixture’s old MX to `mail.<domain>` and does not call a DNS write method.
3. An applying run publishes A, MX, Brevo TXT records, engine DKIM, and one SPF record. The fixture’s apex website A, `www` A, NS, and an unrelated TXT remain.
4. A second run with the same input does not duplicate those records and does not change the engine DKIM key.
5. The same `operationId` with a different domain returns `IDEMPOTENCY_CONFLICT` and writes no DNS.
6. `mxCutoverAuthorized: false` returns `MX_NOT_AUTHORIZED` and writes no DNS.
7. Existing stricter DMARC is preserved. Absent DMARC is created from the Brevo value.
8. Two existing SPF records that cannot be merged return `DNS_RECORD_CONFLICT` before any write.
9. A bad checksum and a missing artifact change neither the server nor DNS.
10. An applying run creates a missing `/var/lib/stalwart`. A dry run does not create it. The installer does not partition or format a disk.
11. A fixture that fails after the MX write, then a retry, ends with one MX and one engine DKIM key.
12. Provider tests for `namecom`, `hostinger`, and `godaddy` each reject a bad token with `DNS_AUTH_FAILED`.
13. The result file and the process output do not contain the fixture’s DNS token, SMTP key, or admin password.
14. Relay authentication uses the SMTP key. The Brevo REST API key is not present in the input and is not required by the process.

## 12. Out of scope for this installer

- Creating a Google Cloud server, opening ports, or formatting a disk. BearPortal does not open ports. The operator opens inbound TCP 25, 80, 443, 465, and 993. Inbound submission in this release is 465. Port 587 is the outbound Brevo relay.
- Calling the Brevo REST API, creating a Brevo domain, or generating a Brevo SMTP key.
- Deciding which customer or which server to install. BearPortal makes that decision and passes the parameters.
- A second user approval for MX. The boolean in the input is that authorization.
- Publishing DNS for a provider other than Name.com, Hostinger, and GoDaddy. BearPortal rejects an unsupported provider before calling the installer.
- Pinning a BearMail release inside BearPortal. BearPortal records `release.id` and the checksums of the first BearMail release that passes §11.
