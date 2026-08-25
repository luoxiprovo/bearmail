#!/usr/bin/env sh
# shellcheck shell=dash

# Replace the installed BearMail WebUI with a new stalwart-webui.tar.gz.
# Reuses the live systemd unit and config.json. Does not change Stalwart,
# Caddy, DNS, mail data, or CORS.

set -eu

WEBUI_UNIT="${BEARMAIL_WEBUI_UNIT:-stalwart-webui.service}"
WEBUI_UNIT_FILE="${BEARMAIL_WEBUI_UNIT_FILE:-/etc/systemd/system/stalwart-webui.service}"
INSTALLER_STATE="${BEARMAIL_INSTALLER_STATE:-/etc/stalwart/installer-state.json}"

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
archive=""
prefix=""
port=""
node_bin=""
server_url=""
dry_run="false"
tmp=""

say() {
    printf '%s\n' "$1"
}

err() {
    printf 'ERROR: %s\n' "$1" >&2
    exit 1
}

usage() {
    cat <<'EOF'
Usage: sudo sh ./update.sh [--archive PATH] [--dry-run]

Updates only the BearMail WebUI on an already-installed server.

Copy this script and a new stalwart-webui.tar.gz into the same directory, then:

  sudo sh ./update.sh

The script reads the live stalwart-webui.service unit and the installed
config.json, then installs the archive over that prefix, port, Node.js
binary, and default mail-server URL. Stalwart, Caddy, DNS, and stored mail
are left unchanged.

Options:
  --archive PATH   WebUI tar archive (default: ./stalwart-webui.tar.gz
                   beside this script)
  --dry-run        Detect and print the plan without changing the system
  -h, --help       Show this help
EOF
}

cleanup() {
    if [ -n "$tmp" ] && [ -d "$tmp" ]; then
        rm -rf "$tmp"
    fi
}

trap cleanup EXIT INT HUP TERM

json_string_field() {
    _file="$1"
    _key="$2"
    [ -f "$_file" ] || return 0
    if command -v python3 >/dev/null 2>&1; then
        python3 -c 'import json,sys
try:
    value=json.load(open(sys.argv[1])).get(sys.argv[2])
except Exception:
    value=""
print("" if value is None else value)' "$_file" "$_key"
        return 0
    fi
    if [ -n "$node_bin" ] && [ -x "$node_bin" ]; then
        JSON_FILE="$_file" JSON_KEY="$_key" "$node_bin" -e '
          const fs = require("node:fs");
          try {
            const value = JSON.parse(fs.readFileSync(process.env.JSON_FILE, "utf8"))[process.env.JSON_KEY];
            process.stdout.write(value == null ? "" : String(value));
          } catch {
            process.stdout.write("");
          }
        '
        return 0
    fi
    sed -n "s/.*\"${_key}\"[[:space:]]*:[[:space:]]*\"\\([^\"]*\\)\".*/\\1/p" "$_file" | sed -n '1p'
}

unit_value() {
    sed -n "s/^${2}=//p" "$1" 2>/dev/null | sed -n '$p'
}

detect_live_webui() {
    if [ -f "$WEBUI_UNIT_FILE" ]; then
        _wd="$(unit_value "$WEBUI_UNIT_FILE" "WorkingDirectory")"
        case "$_wd" in /*) prefix="$_wd" ;; esac
        _exec="$(unit_value "$WEBUI_UNIT_FILE" "ExecStart")"
        _node="$(printf '%s\n' "$_exec" | sed -n 's/^\([^[:space:]]*\).*/\1/p')"
        case "$_node" in /*) node_bin="$_node" ;; esac
        _port="$(sed -n 's/^Environment=WEBUI_PORT=//p' "$WEBUI_UNIT_FILE" | sed -n '$p')"
        case "$_port" in ''|*[!0-9]*) ;; *) port="$_port" ;; esac
    fi
    if command -v systemctl >/dev/null 2>&1 && \
        [ "$WEBUI_UNIT_FILE" = "/etc/systemd/system/stalwart-webui.service" ] && \
        systemctl cat "$WEBUI_UNIT" >/dev/null 2>&1; then
        _wd="$(systemctl show -p WorkingDirectory --value "$WEBUI_UNIT" 2>/dev/null || true)"
        case "$_wd" in /*) prefix="$_wd" ;; esac
        _env="$(systemctl show -p Environment --value "$WEBUI_UNIT" 2>/dev/null || true)"
        for _item in $_env; do
            case "$_item" in
                WEBUI_PORT=*)
                    _port="${_item#WEBUI_PORT=}"
                    case "$_port" in ''|*[!0-9]*) ;; *) port="$_port" ;; esac
                    ;;
                STALWART_URL=*)
                    _url="${_item#STALWART_URL=}"
                    [ -n "$_url" ] && server_url="$_url"
                    ;;
            esac
        done
        _exec="$(systemctl show -p ExecStart --value "$WEBUI_UNIT" 2>/dev/null || true)"
        _node="${_exec#*path=}"
        _node="${_node%% ;*}"
        case "$_node" in /*)
            [ -x "$_node" ] && node_bin="$_node"
            ;;
        esac
    fi
    _existing="$(json_string_field "${prefix}/dist/config.json" defaultServerUrl)"
    if [ -n "$_existing" ]; then
        server_url="$_existing"
        return 0
    fi
    _host="$(json_string_field "$INSTALLER_STATE" serverHostname)"
    if [ -n "$_host" ] && [ -z "$server_url" ]; then
        server_url="https://${_host}"
    fi
}

validate_archive() {
    _stage="$1"
    if ! tar -tzf "$archive" > "${tmp}/archive-files"; then
        err "The WebUI artifact is not a readable gzip tar archive."
    fi
    if grep -Eq '(^/|(^|/)\.\.(/|$))' "${tmp}/archive-files"; then
        err "The WebUI archive contains an unsafe path."
    fi
    tar --no-same-owner --no-same-permissions -xzf "$archive" -C "$_stage"
    if find "$_stage" -type l -print -quit | grep -q .; then
        err "Symbolic links are not allowed in the WebUI archive."
    fi
    for _required in install.sh server.mjs stalwart-webui.service dist/index.html dist/config.json; do
        [ -f "${_stage}/${_required}" ] || err "The WebUI archive is missing ${_required}."
    done
    grep -q 'STALWART_WEBUI_ARCHIVE_VERSION=2' "${_stage}/install.sh" || \
        err "The WebUI archive is not compatible with this updater."
}

merge_preserved_config() {
    _backup="$1"
    _target="$2"
    [ -f "$_backup" ] || return 0
    EXISTING_CONFIG="$_backup" CONFIG_PATH="$_target" SERVER_URL="$server_url" "$node_bin" -e '
      const fs = require("node:fs");
      const existing = JSON.parse(fs.readFileSync(process.env.EXISTING_CONFIG, "utf8"));
      const next = JSON.parse(fs.readFileSync(process.env.CONFIG_PATH, "utf8"));
      for (const key of ["defaultServerUrl", "allowCustomServers", "allowBasicAuth", "allowOAuth", "pollIntervalSeconds"]) {
        if (existing[key] !== undefined && existing[key] !== "") next[key] = existing[key];
      }
      if (process.env.SERVER_URL) next.defaultServerUrl = process.env.SERVER_URL;
      fs.writeFileSync(process.env.CONFIG_PATH, JSON.stringify(next, null, 2) + "\n", { mode: 0o644 });
    '
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --archive)
            [ "$#" -ge 2 ] || err "Missing path after --archive."
            archive="$2"
            shift 2
            ;;
        --dry-run)
            dry_run="true"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        --)
            shift
            break
            ;;
        -*)
            err "Unknown option: $1"
            ;;
        *)
            [ -z "$archive" ] || err "Unexpected argument: $1"
            archive="$1"
            shift
            ;;
    esac
done

if [ -z "$archive" ]; then
    archive="${script_dir}/stalwart-webui.tar.gz"
fi
case "$archive" in
    /*) ;;
    *) archive="${script_dir}/${archive}" ;;
esac
[ -f "$archive" ] || err "WebUI archive not found: ${archive}
Copy stalwart-webui.tar.gz next to update.sh, or pass --archive PATH."

detect_live_webui

[ -n "$prefix" ] || err "No installed WebUI was found. Expected ${WEBUI_UNIT_FILE}."
[ -n "$port" ] || err "Could not read WEBUI_PORT from ${WEBUI_UNIT}."
[ -n "$node_bin" ] || err "Could not read the Node.js binary from ${WEBUI_UNIT}."
[ -x "$node_bin" ] || err "Node.js binary is not executable: ${node_bin}"
[ -f "${prefix}/dist/config.json" ] || err "Installed WebUI config not found: ${prefix}/dist/config.json"
[ -f "${prefix}/server.mjs" ] || err "Installed WebUI server not found: ${prefix}/server.mjs"
[ -n "$server_url" ] || err "Could not read the mail-server URL from ${prefix}/dist/config.json."

say "BearMail WebUI update"
say "  Archive:          ${archive}"
say "  WebUI files:      ${prefix}"
say "  WebUI service:    127.0.0.1:${port}"
say "  Node.js:          ${node_bin}"
say "  Mail server URL:  ${server_url}"
say "  Leaves unchanged: Stalwart, Caddy, DNS, mailboxes"

if [ "$dry_run" = "true" ]; then
    tmp=$(mktemp -d)
    validate_archive "$tmp"
    say "Dry run: archive is valid. No files were changed."
    exit 0
fi

[ "$(id -u)" -eq 0 ] || err "Run this updater as root: sudo sh ./update.sh"
command -v systemctl >/dev/null 2>&1 || err "systemd was not found."

tmp=$(mktemp -d)
stage="${tmp}/webui"
mkdir -p "$stage"
validate_archive "$stage"

config_backup="${tmp}/config.json"
cp -a "${prefix}/dist/config.json" "$config_backup"

say "Installing the new WebUI over ${prefix}..."
sh "${stage}/install.sh" \
    --server-url "$server_url" \
    --prefix "$prefix" \
    --port "$port" \
    --node-bin "$node_bin" \
    --systemd \
    --no-build

merge_preserved_config "$config_backup" "${prefix}/dist/config.json"
if id stalwart-webui >/dev/null 2>&1; then
    chown stalwart-webui:stalwart-webui "${prefix}/dist/config.json"
fi

say "WebUI update complete."
say "Hard-refresh the browser on the webmail URL so it loads the new assets."
