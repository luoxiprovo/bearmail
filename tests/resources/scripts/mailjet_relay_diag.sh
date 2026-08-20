#!/usr/bin/env sh
# Diagnose outbound Mailjet relay: GCP port 25, Mailjet 587/465, Stalwart
# routes, outbound strategy, and queued delivery errors.
#
# Usage:
#   sudo sh tests/resources/scripts/mailjet_relay_diag.sh
#
# Prompts for the Stalwart administrator password. Does not print secrets.

set -eu

JMAP_URL="${STALWART_JMAP_URL:-http://127.0.0.1:8080/jmap/}"
ADMIN_USER="${STALWART_ADMIN_USERNAME:-admin}"
NODE_BIN="${NODE_BIN:-}"
if [ -z "$NODE_BIN" ]; then
    if [ -x /opt/stalwart-node/bin/node ]; then
        NODE_BIN=/opt/stalwart-node/bin/node
    else
        _latest=""
        for _candidate in /opt/stalwart-node/*/bin/node; do
            if [ -x "$_candidate" ]; then
                _latest="$_candidate"
            fi
        done
        if [ -n "$_latest" ]; then
            NODE_BIN="$_latest"
        elif command -v node >/dev/null 2>&1; then
            NODE_BIN="$(command -v node)"
        else
            NODE_BIN=""
        fi
    fi
fi

if [ ! -x "$NODE_BIN" ]; then
    printf 'Need Node.js to query Stalwart JMAP.\n' >&2
    exit 1
fi

if ! (exec 3<> /dev/tty) 2>/dev/null; then
    printf 'An interactive terminal is required for the administrator password.\n' >&2
    exit 1
fi
exec 3<> /dev/tty

say() { printf '%s\n' "$1"; }

say "Mailjet outbound relay diagnostics"
say "----------------------------------"
say ""

say "1. Network"
"$NODE_BIN" -e '
  const net = require("node:net");
  const tls = require("node:tls");
  function tryConnect(host, port, wrapTls) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      const done = (ok, detail) => resolve({ host, port, ok, ms: Date.now() - t0, detail });
      const onSocket = (socket) => {
        socket.setTimeout(8000);
        socket.once("data", (buf) => { socket.destroy(); done(true, buf.toString("utf8").split("\r\n")[0]); });
        socket.once("timeout", () => { socket.destroy(); done(false, "timeout"); });
        socket.once("error", (err) => done(false, err.message));
      };
      if (wrapTls) {
        const socket = tls.connect({ host, port, servername: host, timeout: 8000 }, () => {});
        onSocket(socket);
      } else {
        const socket = net.connect({ host, port }, () => {});
        onSocket(socket);
      }
    });
  }
  (async () => {
    const gmail = await tryConnect("gmail-smtp-in.l.google.com", 25, false);
    const starttls = await tryConnect("in-v3.mailjet.com", 587, false);
    const smtps = await tryConnect("in-v3.mailjet.com", 465, true);
    const row = (r, expectOk) => {
      const mark = r.ok === expectOk ? "OK" : "UNEXPECTED";
      console.log(`  [${mark}] ${r.host}:${r.port} ${r.ok ? "open" : "failed"} (${r.ms}ms) ${r.detail}`);
    };
    row(gmail, false);
    row(starttls, true);
    row(smtps, true);
    if (gmail.ok) console.log("  Direct MX on port 25 works; Mailjet is optional.");
    if (!gmail.ok && starttls.ok) console.log("  GCP-style port 25 block confirmed. Outbound mail must use Mailjet 587/465.");
    if (!starttls.ok && !smtps.ok) console.log("  Cannot reach Mailjet. Check egress firewall for TCP 587 and 465.");
  })().catch((err) => { console.error(err.message); process.exit(1); });
'

say ""
say "2. Stalwart route and queue (administrator login)"
printf 'Stalwart administrator username [%s]: ' "$ADMIN_USER" >&3
IFS= read -r _user <&3 || exit 1
if [ -n "$_user" ]; then ADMIN_USER="$_user"; fi
printf 'Stalwart administrator password: ' >&3
_saved="$(stty -g <&3)"
stty -echo <&3
IFS= read -r _pass <&3 || { stty "$_saved" <&3; printf '\n' >&3; exit 1; }
stty "$_saved" <&3
printf '\n' >&3
if [ -z "$_pass" ]; then
    printf 'A password is required.\n' >&2
    exit 1
fi

printf '%s' "$_pass" | STALWART_JMAP_URL="$JMAP_URL" STALWART_ADMIN_USERNAME="$ADMIN_USER" \
    "$NODE_BIN" -e '
      const fs = require("node:fs");
      const url = process.env.STALWART_JMAP_URL;
      const username = process.env.STALWART_ADMIN_USERNAME;
      const password = fs.readFileSync(0, "utf8");
      const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
      const using = ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"];

      async function jmap(methodCalls) {
        const response = await fetch(url, {
          method: "POST",
          headers: { Authorization: authorization, "Content-Type": "application/json" },
          body: JSON.stringify({ using, methodCalls }),
          signal: AbortSignal.timeout(20000),
        });
        const text = await response.text();
        let body;
        try { body = JSON.parse(text); } catch {
          throw new Error(`Stalwart returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
        }
        if (response.status === 401 || response.status === 403) {
          throw new Error("Stalwart rejected the administrator credentials.");
        }
        if (!response.ok) throw new Error(`JMAP HTTP ${response.status}: ${text.slice(0, 500)}`);
        for (const method of body.methodResponses ?? []) {
          if (method[0] === "error") throw new Error(`JMAP error: ${JSON.stringify(method[1])}`);
        }
        return Object.fromEntries((body.methodResponses ?? []).map((m) => [m[2], m[1]]));
      }

      const quote = (value) => JSON.stringify(value ?? null);

      (async () => {
        const listed = await jmap([
          ["x:MtaRoute/get", { properties: ["id", "name", "@type", "address", "port", "protocol", "authUsername", "implicitTls"] }, "routes"],
        ]);
        const routes = Array.isArray(listed.routes?.list) ? listed.routes.list : [];
        console.log("  MTA routes:");
        if (!routes.length) console.log("    (none)");
        for (const route of routes) {
          const bits = [
            route.name || "(unnamed)",
            route["@type"] || "?",
          ];
          if (route.address) bits.push(`${route.address}:${route.port ?? "?"}`);
          if (route.protocol) bits.push(route.protocol);
          if (route.implicitTls) bits.push("implicit-tls");
          if (route.authUsername) bits.push("auth-user-set");
          console.log("    - " + bits.join("  "));
        }
        const hasMailjet = routes.some((route) => route.name === "mailjet" && route["@type"] === "Relay");
        if (!hasMailjet) {
          console.log("  PROBLEM: no Relay route named mailjet. Remote mail still uses MX/port 25.");
        }

        const strategy = await jmap([
          ["x:MtaOutboundStrategy/get", { ids: ["singleton"], properties: ["route"] }, "strategy"],
        ]);
        const route = strategy.strategy?.list?.[0]?.route ?? {};
        console.log("  Outbound strategy route:");
        console.log("    else = " + quote(route.else));
        for (const [index, match] of Object.entries(route.match ?? {})) {
          console.log(`    match[${index}] if ${quote(match.if)} then ${quote(match.then)}`);
        }
        if (route.else !== "'mailjet'") {
          console.log("  PROBLEM: route/else is not 'mailjet'. Gmail still goes out on port 25 and will time out on GCP.");
        }

        const queued = await jmap([
          ["x:QueuedMessage/get", { properties: ["returnPath", "createdAt", "nextRetry", "recipients", "size"] }, "queue"],
        ]);
        const messages = Array.isArray(queued.queue?.list) ? queued.queue.list : [];
        console.log(`  Queue: ${messages.length} message(s)`);
        if (!messages.length) {
          console.log("    Empty. Send one WebUI message to Gmail, wait 20s, then rerun this script.");
        }
        for (const message of messages.slice(0, 10)) {
          console.log(`    from ${message.returnPath || "(none)"} size=${message.size} created=${message.createdAt} nextRetry=${message.nextRetry ?? "-"}`);
          for (const [rcpt, row] of Object.entries(message.recipients ?? {})) {
            const status = row.status ?? {};
            const type = status["@type"] || "unknown";
            const fail = status.TemporaryFailure || status.PermanentFailure || status;
            const detail = [
              fail.errorType,
              fail.responseCode,
              fail.responseEnhanced,
              fail.responseHostname,
              fail.responseMessage,
              fail.errorMessage,
            ].filter(Boolean).join(" | ");
            console.log(`      ${rcpt}  queue=${row.queueName || "-"}  retries=${row.retryCount ?? 0}  ${type}${detail ? "  " + detail : ""}`);
          }
        }
      })().catch((error) => { console.error("  " + error.message); process.exit(1); });
    '

say ""
say "3. What the results mean"
say "  - Timeout to Gmail:25 + open Mailjet:587 is expected on GCP."
say "  - Missing mailjet Relay, or route/else not 'mailjet': Stalwart is not using the relay."
say "  - Queue errors with ConnectionTimeout / port 25: still trying MX, not Mailjet."
say "  - 4.7.8 / authentication failed: wrong Mailjet API key or secret key."
say "  - 5.7.1 / sender rejected: From domain is not verified in Mailjet."
say "  - Queue empty and Gmail still has nothing: Mailjet accepted SMTP; check Mailjet"
say "    Statistics and Senders & Domains SPF/DKIM, then Gmail spam."
say ""
say "After a WebUI send, also inspect:"
say "  sudo journalctl -u stalwart.service -n 200 --no-pager"
say "  sudo journalctl -u stalwart-source-test.service -n 200 --no-pager"
say "Mailjet dashboard: https://app.mailjet.com/account/relay"
