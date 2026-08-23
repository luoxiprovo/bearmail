# How to set up a Mailjet SMTP relay for Stalwart

Google Cloud blocks outbound TCP port 25, so Stalwart cannot deliver mail
directly to other MX hosts from a GCP VM. Use Mailjet as an authenticated
SMTP relay on port 587 or 465.

Mailjet's [Send API v3.1](https://dev.mailjet.com/email/guides/send-api-v31/#send-a-basic-email)
is an HTTP JSON API (`POST /v3.1/send`). Stalwart is an MTA and cannot call
that API. Configure **SMTP relay** instead (`in-v3.mailjet.com`). The same
Mailjet account, API key, secret key, and sender-domain rules apply to both.

Complete the Mailjet account work first, then point Stalwart at SMTP. The
combined `install.sh` can collect these SMTP values at the end of installation
and apply the relay route for you. Use this guide when you configure Mailjet
yourself or when the installer prints the same steps.

## 1. Create the Mailjet account

1. Sign up at [mailjet.com](https://www.mailjet.com/) and confirm the account
   email.
2. Complete the onboarding questions. They affect sending limits and review.
3. Open the app at [app.mailjet.com](https://app.mailjet.com/).

## 2. Add the Stalwart mail domain as a sender

Mailjet rejects mail unless `From` is a verified address or belongs to a
verified domain. For a mail server, verify the whole domain, not one mailbox.

1. Go to **Account settings → Senders & Domains**.
2. Choose **Add a domain or sender address → Add domain**.
3. Enter the mail domain from Stalwart setup, for example `example.com`.
4. Add the TXT ownership record Mailjet shows to DNS.
5. Wait until Mailjet marks the domain verified. This can take minutes to
   hours.

Every address users send from (`alice@example.com`, `bob@example.com`) is then
allowed. Adding only `admin@example.com` is not enough for a real mail server.

## 3. Publish Mailjet SPF and DKIM

In **Senders & Domains → SPF/DKIM authentication**, open the gear next to the
domain and copy Mailjet's records. Merge them with the DNS table Stalwart
setup already printed. Do not replace Stalwart's MX, A, AAAA, or DKIM records.

**SPF (TXT on `@`):** merge Mailjet into the existing SPF. Keep any `ip4:`,
`ip6:`, `a`, or `mx` terms from Stalwart:

```text
v=spf1 ip4:<your-gcp-public-ipv4> include:spf.mailjet.com ~all
```

Mailjet's docs often show `v=spf1 include:spf.mailjet.com ~all` alone. That
would drop the Stalwart server from SPF.

**DKIM:** add Mailjet's selector in addition to Stalwart's DKIM. They use
different names. Mailjet's typical host is:

```text
mailjet._domainkey.example.com
```

Use the exact host and value Mailjet displays.

Wait until Mailjet shows SPF and DKIM as **OK**.

## 4. Copy SMTP credentials

Use the API key and secret key. Do not use the Mailjet website login.

1. Go to **Account settings → SMTP and SEND API settings**. Direct link:
   [app.mailjet.com/account/relay](https://app.mailjet.com/account/relay).
2. Note these values:

   | Stalwart field | Mailjet value |
   | --- | --- |
   | Host | `in-v3.mailjet.com` |
   | Port | `587` (STARTTLS). Preferred on GCP. |
   | Username | **API Key** |
   | Password | **Secret Key** |

3. Save the Secret Key when Mailjet shows it. It is displayed once. If you
   lose it, reset it from API Key Management and update Stalwart.

The Send API v3.1 example uses the same API Key and Secret Key as HTTP Basic
Auth. SMTP uses them as username and password instead.

Port `465` is implicit TLS if you prefer that. Skip port `25` on GCP. Wrong
credentials produce `4.7.8 authentication failed` or relay denied.

## 5. Point Stalwart at Mailjet

The combined installer asks which outbound SMTP relay to use after it prints
the DNS table. If you choose Mailjet, it prompts for the host, port, API key,
and secret key, then creates the `mailjet` route and reloads settings. If
those credentials are rejected, it asks again instead of ending the install.

To apply the same change later, run this script on the GCP host with the two
keys. It talks to Stalwart's local JMAP management API (the same path
`install.sh` uses for CORS). It:

1. Creates or updates an `MtaRoute` named `mailjet`.
2. Patches the singleton `MtaOutboundStrategy` so local domains stay `'local'`
   and everything else uses `'mailjet'` instead of `'mx'`.
3. Reloads settings so the queue picks up the change without a process
   restart.

Save the script as `configure-mailjet-relay.sh` on the mail VM. The secret is
read from stdin, not from command arguments.

```sh
#!/bin/sh
# Usage:
#   MAILJET_API_KEY='...' MAILJET_SECRET_KEY='...' \
#     sudo -E sh ./configure-mailjet-relay.sh
#
# Optional:
#   STALWART_ADMIN_USERNAME  (default: admin)
#   STALWART_JMAP_URL        (default: http://127.0.0.1:8080/jmap/)
#   MAILJET_HOST             (default: in-v3.mailjet.com)
#   MAILJET_PORT             (default: 587)
#   NODE_BIN                 (default: node)

set -eu

JMAP_URL="${STALWART_JMAP_URL:-http://127.0.0.1:8080/jmap/}"
ADMIN_USER="${STALWART_ADMIN_USERNAME:-admin}"
NODE_BIN="${NODE_BIN:-node}"
MAILJET_HOST="${MAILJET_HOST:-in-v3.mailjet.com}"
MAILJET_PORT="${MAILJET_PORT:-587}"
API_KEY="${MAILJET_API_KEY:?set MAILJET_API_KEY}"
SECRET_KEY="${MAILJET_SECRET_KEY:?set MAILJET_SECRET_KEY}"

case "$MAILJET_PORT" in
  465) IMPLICIT_TLS=true ;;
  587|588|2525) IMPLICIT_TLS=false ;;
  *) echo "Unsupported MAILJET_PORT=$MAILJET_PORT (use 587 or 465)" >&2; exit 1 ;;
esac

printf '%s' "$SECRET_KEY" | \
STALWART_JMAP_URL="$JMAP_URL" \
STALWART_ADMIN_USERNAME="$ADMIN_USER" \
MAILJET_API_KEY="$API_KEY" \
MAILJET_HOST="$MAILJET_HOST" \
MAILJET_PORT="$MAILJET_PORT" \
MAILJET_IMPLICIT_TLS="$IMPLICIT_TLS" \
"$NODE_BIN" -e '
  const fs = require("node:fs");
  const url = process.env.STALWART_JMAP_URL;
  const username = process.env.STALWART_ADMIN_USERNAME;
  const password = fs.readFileSync(0, "utf8");
  const apiKey = process.env.MAILJET_API_KEY;
  const host = process.env.MAILJET_HOST;
  const port = Number(process.env.MAILJET_PORT);
  const implicitTls = process.env.MAILJET_IMPLICIT_TLS === "true";
  const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  const using = ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"];

  async function jmap(methodCalls) {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      body: JSON.stringify({ using, methodCalls }),
      signal: AbortSignal.timeout(15000),
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch {
      throw new Error(`Stalwart returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
    }
    if (!response.ok) throw new Error(`JMAP HTTP ${response.status}: ${text.slice(0, 500)}`);
    for (const method of body.methodResponses ?? []) {
      if (method[0] === "error") throw new Error(`JMAP error: ${JSON.stringify(method[1])}`);
    }
    return Object.fromEntries((body.methodResponses ?? []).map((m) => [m[2], m[1]]));
  }

  function assertSet(result, kind) {
    const failed = Object.keys(result?.notCreated ?? {}).length
      || Object.keys(result?.notUpdated ?? {}).length
      || Object.keys(result?.notDestroyed ?? {}).length;
    if (failed) throw new Error(`${kind} failed: ${JSON.stringify(result)}`);
  }

  const relay = {
    "@type": "Relay",
    name: "mailjet",
    description: "Mailjet SMTP relay",
    address: host,
    port,
    protocol: "smtp",
    authUsername: apiKey,
    authSecret: { "@type": "Value", secret: password },
    implicitTls,
    allowInvalidCerts: false,
  };

  (async () => {
    const listed = await jmap([
      ["x:MtaRoute/get", { properties: ["id", "name", "@type"] }, "list"],
    ]);
    const existing = (listed.list?.list ?? []).find((row) => row.name === "mailjet");
    const routeCall = existing
      ? ["x:MtaRoute/set", { update: { [existing.id]: {
          address: relay.address,
          port: relay.port,
          protocol: relay.protocol,
          authUsername: relay.authUsername,
          authSecret: relay.authSecret,
          implicitTls: relay.implicitTls,
          allowInvalidCerts: relay.allowInvalidCerts,
          description: relay.description,
        } } }, "route"]
      : ["x:MtaRoute/set", { create: { mailjet: relay } }, "route"];

    const result = await jmap([
      routeCall,
      ["x:MtaOutboundStrategy/set", { update: { singleton: {
        "route/else": String.fromCharCode(39) + "mailjet" + String.fromCharCode(39),
        "route/match/0/if": "is_local_domain(rcpt_domain)",
        "route/match/0/then": String.fromCharCode(39) + "local" + String.fromCharCode(39),
      } } }, "strategy"],
      ["x:Action/set", { create: { reload: { "@type": "ReloadSettings" } } }, "reload"],
    ]);
    assertSet(result.route, "MtaRoute");
    assertSet(result.strategy, "MtaOutboundStrategy");
    if (!result.reload?.created?.reload) {
      throw new Error(`ReloadSettings failed: ${JSON.stringify(result.reload)}`);
    }
    console.log(existing
      ? "Updated Mailjet relay route and reloaded settings."
      : "Created Mailjet relay route and reloaded settings.");
  })().catch((error) => { console.error(error.message); process.exit(1); });
'
```

Run it as root on the mail VM. After the combined installer, Stalwart's JMAP
listener is `http://127.0.0.1:8080/jmap/`. Node.js is already present from
that installer.

```sh
chmod +x configure-mailjet-relay.sh
MAILJET_API_KEY='your-api-key' MAILJET_SECRET_KEY='your-secret-key' \
  sudo -E sh ./configure-mailjet-relay.sh
```

Set `MAILJET_PORT=465` for implicit TLS. Set `STALWART_ADMIN_USERNAME` if the
administrator is not `admin`. The script is idempotent: run it again to rotate
the secret key.

Do not put the Secret Key in systemd unit files, process arguments, or
installer state.

## 6. Send a test and confirm in both places

1. From the Stalwart WebUI, send from a mailbox on the verified domain to a
   Gmail or Outlook address.
2. In Stalwart, the message should leave the queue without a port-25 timeout.
3. In Mailjet, open **Statistics** or **Transactional** and confirm the
   message was accepted.
4. At the recipient, check headers: you should see Mailjet hop(s) and passing
   SPF/DKIM for the authenticated domain.

If Mailjet accepts the SMTP session but does not deliver, the usual causes are
an unverified `From` domain, SPF/DKIM still pending, or the account still in a
restricted onboarding or review state.

## What not to do

- Do not implement Mailjet's [Send a basic email](https://dev.mailjet.com/email/guides/send-api-v31/#send-a-basic-email)
  (`Messages`, `From.Email`, `To`, `HTMLPart`) against Stalwart. That is an
  application HTTP API, not an MTA interface.
- Do not replace Stalwart's MX, A, or AAAA records. Mailjet is only for
  outbound. Inbound mail still comes to the GCP box on port 25.
- Do not listen on a custom local port and expect remote MX hosts to use it.
  Remote servers still expect destination port 25; only a relay you control
  can accept 587 or 465.

## Related

- [How to install Stalwart and the Mail/Calendar WebUI](INSTALL.md)
- [How to sign in to the WebUI and send email](WEBUI_USER_GUIDE.md)
- [Mailjet SMTP relay configuration](https://dev.mailjet.com/smtp-relay/configuration/)
- [Mailjet SMTP and SEND API settings](https://app.mailjet.com/account/relay)
