# Stalwart Mail & Calendar Web UI

A standalone browser client for Stalwart. It uses the authenticated JMAP session as its source of truth and does not add a second mail or calendar database.

## What works

- OAuth 2.0 Authorization Code with PKCE and session-only app-password login
- Mailbox navigation, incremental inbox/search queries, safe HTML reading, remote-image blocking, attachments, message actions, drafts, attachments, and JMAP submission
- Day, week, month, and agenda calendar views; calendar visibility; event creation, editing, deletion, and guest invitations
- `text/calendar` invite previews in mail, one-click Accept/Maybe/Decline, and import when the event has not yet been auto-added by Stalwart
- Invitation state in every calendar view: pending events use about half emphasis and a dashed edge; tentative events use reduced emphasis; declined events are faint, hatched, and struck through
- Responsive navigation, keyboard focus, dark theme, diagnostics, app-shell service worker, configured polling, and manual refresh

The source specification is [../WEB_UI_SPEC.md](../WEB_UI_SPEC.md).

The executable source-build, installation, and acceptance runbook is [TEST_PLAN.md](TEST_PLAN.md).

## Run for development

Requires Node.js 22 or newer.

```sh
npm install
npm run dev
```

Open `http://localhost:4173`, enter the Stalwart HTTPS URL, then use OAuth or an app password. No password is persisted.

## Standalone install

This installer is separate from Stalwart's installer and never changes the mail server:

```sh
sudo ./install.sh \
  --server-url https://mail.example.com \
  --port 8080 \
  --systemd
```

Put a TLS reverse proxy in front of `127.0.0.1:8080`. Without `--systemd`, the script installs the built application and prints the command needed to start it. Use `--prefix` for an unprivileged local installation.

## Container

```sh
docker build -t stalwart-webui .
docker run --rm -p 8080:8080 \
  -e STALWART_URL=https://mail.example.com \
  stalwart-webui
```

Runtime environment variables are `STALWART_URL`, `ALLOW_CUSTOM_SERVERS`, `ALLOW_BASIC_AUTH`, `ALLOW_OAUTH`, `POLL_INTERVAL_SECONDS`, `WEBUI_HOST`, and `WEBUI_PORT`. They override `public/config.json` without rebuilding the image.

## Stalwart prerequisites

The authenticated account should advertise JMAP Core, Mail, Submission, and Calendars. Calendar attachment parsing enables invitation previews. OAuth requires PKCE `S256`; anonymous public-client registration must be enabled, or the deployment must provide an administrator-registered public client in a future static-client configuration.

If the UI and Stalwart use different origins, allow the exact UI origin and the `Authorization` and `Content-Type` headers in Stalwart or at its reverse proxy. Stalwart also has a permissive CORS mode, but an exact-origin reverse-proxy policy is safer. A same-origin deployment avoids cross-origin setup entirely.

The OAuth redirect URI is exactly:

```text
https://WEB-UI-ORIGIN/login
```

The application needs history fallback routing to `index.html`; the included Node server provides it.

## Verification

```sh
npm test
npm run build
npm audit --omit=dev
```

`/healthz` returns `200 ok` from the included production server. The diagnostics screen intentionally excludes credentials, tokens, mail content, and calendar content.

## License

This directory uses the repository's `AGPL-3.0-only OR LicenseRef-SEL` licensing terms.
