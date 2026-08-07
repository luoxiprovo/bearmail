#!/bin/sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
prefix="/opt/stalwart-webui"
server_url=""
port="8080"
install_service="false"
build="true"

usage() {
  printf '%s\n' "Usage: ./install.sh [--server-url URL] [--prefix PATH] [--port PORT] [--systemd] [--no-build]"
  printf '%s\n' "Installs only the web UI. It does not change Stalwart or accept account credentials."
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --server-url) server_url=${2:?Missing URL after --server-url}; shift 2 ;;
    --prefix) prefix=${2:?Missing path after --prefix}; shift 2 ;;
    --port) port=${2:?Missing port after --port}; shift 2 ;;
    --systemd) install_service="true"; shift ;;
    --no-build) build="false"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$port" in *[!0-9]*|'') printf 'Port must be a number.\n' >&2; exit 2 ;; esac
case "$prefix" in /*) ;; *) printf 'Prefix must be an absolute path.\n' >&2; exit 2 ;; esac
command -v node >/dev/null 2>&1 || { printf 'Node.js 22 or later is required.\n' >&2; exit 1; }
if [ -n "$server_url" ]; then
  SERVER_URL="$server_url" node -e '
    const url = new URL(process.env.SERVER_URL);
    const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) throw new Error("The default server URL must use HTTPS (except localhost).");
    if (url.username || url.password) throw new Error("The server URL must not contain credentials.");
  '
fi
printf 'Installing architecture-independent web assets for %s.\n' "$(uname -m)"
if [ "$build" = "true" ]; then
  command -v npm >/dev/null 2>&1 || { printf 'npm is required.\n' >&2; exit 1; }
  (cd "$script_dir" && npm ci && npm run build)
fi
[ -f "$script_dir/dist/index.html" ] || { printf 'dist/index.html not found; run without --no-build.\n' >&2; exit 1; }

install -d "$prefix/dist"
cp -R "$script_dir/dist/." "$prefix/dist/"
install -m 0644 "$script_dir/server.mjs" "$prefix/server.mjs"
SERVER_URL="$server_url" CONFIG_PATH="$prefix/dist/config.json" node -e '
  const fs = require("node:fs");
  const path = process.env.CONFIG_PATH;
  const config = JSON.parse(fs.readFileSync(path, "utf8"));
  config.defaultServerUrl = process.env.SERVER_URL;
  fs.writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o644 });
'

if [ "$install_service" = "true" ]; then
  [ "$(id -u)" -eq 0 ] || { printf '%s\n' "--systemd requires root." >&2; exit 1; }
  command -v systemctl >/dev/null 2>&1 || { printf '%s\n' "systemd was not found." >&2; exit 1; }
  if ! id stalwart-webui >/dev/null 2>&1; then useradd --system --home-dir "$prefix" --shell /usr/sbin/nologin stalwart-webui; fi
  chown -R stalwart-webui:stalwart-webui "$prefix"
  sed -e "s|@@PREFIX@@|$prefix|g" -e "s|@@PORT@@|$port|g" "$script_dir/stalwart-webui.service" > /etc/systemd/system/stalwart-webui.service
  systemctl daemon-reload
  systemctl enable --now stalwart-webui.service
  WEBUI_HEALTH_URL="http://127.0.0.1:$port/healthz/ready" node -e '
    fetch(process.env.WEBUI_HEALTH_URL).then((response) => {
      if (!response.ok) throw new Error(`Health check failed (${response.status}).`);
    }).catch((error) => { console.error(error.message); process.exit(1); });
  '
  printf 'Installed and started stalwart-webui.service on 127.0.0.1:%s\n' "$port"
else
  printf 'Installed to %s. Start with:\n' "$prefix"
  printf '  WEBUI_ROOT=%s/dist WEBUI_PORT=%s node %s/server.mjs\n' "$prefix" "$port" "$prefix"
fi
