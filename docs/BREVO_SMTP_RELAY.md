# How to set up a Brevo SMTP relay for BearMail

Google Cloud blocks outbound TCP port 25, so the mail engine cannot deliver
mail directly to other MX hosts from a GCP VM. Use Brevo as an authenticated
SMTP relay on port 587 or 465.

Brevo's [transactional HTTP API](https://developers.brevo.com/docs/send-a-transactional-email)
is a REST JSON API. The mail engine is an MTA and cannot call that API.
Configure **SMTP relay** instead (`smtp-relay.brevo.com`). See
[SMTP relay integration](https://developers.brevo.com/docs/smtp-integration).

The combined `install.sh` offers Brevo as the default outbound relay. It
collects the SMTP login and SMTP key, then creates a Stalwart `MtaRoute`
named `brevo` and points remote outbound routing at it. Use this guide when
you configure Brevo yourself or when the installer prints the same steps.

## 1. Create the Brevo account

1. Sign up at [app.brevo.com](https://app.brevo.com/) and confirm the account
   email.
2. Open **Settings → SMTP & API**. Direct link:
   [app.brevo.com/settings/keys/smtp](https://app.brevo.com/settings/keys/smtp).

## 2. Add the mail domain as a sender

Brevo rejects mail unless `From` belongs to an authenticated domain.

1. Open **Settings → Senders, domains & dedicated IPs**.
2. Add the mail domain from setup, for example `example.com`.
3. Publish the **Brevo code** TXT ownership record Brevo shows.
4. Publish Brevo's DKIM records. Keep the mail engine's own DKIM selector;
   add Brevo's separately.
5. Wait until Brevo marks the domain authenticated.

Every address users send from (`alice@example.com`, `bob@example.com`) is then
allowed. Adding only one mailbox is not enough for a real mail server.

## 3. Publish SPF

When the installer publishes DNS through name.com after you choose Brevo, it
merges `include:spf.brevo.com` into existing SPF TXT rows. If you publish DNS
by hand, merge Brevo into the existing SPF. Keep any `ip4:`, `ip6:`, `a`, or
`mx` terms from the mail engine:

```text
v=spf1 ip4:<your-gcp-public-ipv4> include:spf.brevo.com ~all
```

On Brevo's shared infrastructure, DKIM plus the Brevo-code TXT carry most of
the authentication. The SPF include still documents that Brevo may send for
the domain.

## 4. Copy SMTP credentials

Use the SMTP login and SMTP key. Do not use the Brevo website password, and
do not use a REST API key.

1. Go to **Settings → SMTP & API → SMTP**. Direct link:
   [app.brevo.com/settings/keys/smtp](https://app.brevo.com/settings/keys/smtp).
2. Note these values:

   | Stalwart field | Brevo value |
   | --- | --- |
   | Host | `smtp-relay.brevo.com` |
   | Port | `587` (STARTTLS). Preferred on GCP. `465` is implicit TLS. `2525` is a fallback. |
   | Username | **SMTP login** (often `xxx@smtp-brevo.com`) |
   | Password | **SMTP key** |

The SMTP login is a technical identifier. Do not put it in the `From` field.

## 5. Point the mail engine at Brevo

The combined installer asks which outbound SMTP relay to use after it prints
the DNS table. Brevo is the default. If you choose it, it prompts for the
host, port, SMTP login, and SMTP key, then creates the `brevo` route and
reloads settings. If those credentials are rejected, it asks again instead of
ending the install.

Local addresses still deliver on the server. Remote recipients go through
Brevo (`route/else` is `'brevo'`).
