# Stalwart Mail & Calendar Web UI

A standalone browser client for Stalwart. It uses the authenticated JMAP session as its source of truth and does not add a second mail or calendar database.

## What works

- OAuth 2.0 Authorization Code with PKCE and password or app-password login that stays signed in on this device until you sign out
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

Open `http://localhost:4173`, enter the Stalwart HTTPS URL, then use OAuth, an account password, or an app password. The session is kept on this device until you sign out.

## Combined install (recommended)

The repository root `install.sh` installs Stalwart and this WebUI as two
services and configures exact-origin CORS automatically. Build the distributable
archive with:

```sh
npm ci
npm test
npm run build
tar -czf ../stalwart-webui.tar.gz \
  install.sh server.mjs stalwart-webui.service dist
```

Put `stalwart-webui.tar.gz`, the compatible `stalwart` binary, and the root
`install.sh` in one directory on the new server, then run `sudo sh ./install.sh`.
The root installer reuses a compatible system Node.js or downloads, verifies,
and installs a private Node.js 22 runtime when needed. The WebUI archive is
architecture-independent and does not require npm on the target.

## Standalone install

The WebUI's internal installer remains available for standalone deployments and
never changes the mail server:

```sh
sudo ./install.sh \
  --server-url https://mail.example.com \
  --port 8080 \
  --systemd
```

Put a TLS reverse proxy in front of `127.0.0.1:8080`. The standalone WebUI package deliberately does not install a proxy or own public certificates. The repository-root combined installer offers an automatic Caddy mode because it can coordinate the distinct Stalwart and WebUI hostnames safely. Without `--systemd`, this script installs the built application and prints the command needed to start it. Use `--prefix` for an unprivileged local installation.

The standalone installer still requires Node.js 22.12 or later. Use the
repository root installer when you want prerequisites provisioned
automatically. Advanced callers may select an absolute runtime path with
`--node-bin`; a systemd runtime path must not be inside a user home or runtime
directory because the service deliberately blocks access to those locations.

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
