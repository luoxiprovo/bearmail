#!/usr/bin/env sh
# shellcheck shell=dash

# Replace the Stalwart binary, WebUI, and MCP sidecar on an already-installed
# BearMail host. Does not change config, Caddy, DNS, CORS, SMTP relay, or mail.
#
# Intended for:
#   curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/upgrade.sh | sudo bash

set -eu

BEARMAIL_REPO="${BEARMAIL_REPO:-luoxiprovo/bearmail}"
BEARMAIL_REF="${BEARMAIL_REF:-main}"
BEARMAIL_DOWNLOAD_BASE="${BEARMAIL_DOWNLOAD_BASE:-https://raw.githubusercontent.com/${BEARMAIL_REPO}/${BEARMAIL_REF}}"
WORK_DIR="${BEARMAIL_WORK_DIR:-/var/tmp/bearmail-upgrade}"
STALWART_UNIT="${BEARMAIL_STALWART_UNIT:-stalwart.service}"
STALWART_UNIT_FILE="${BEARMAIL_STALWART_UNIT_FILE:-/etc/systemd/system/stalwart.service}"
WEBUI_UNIT="${BEARMAIL_WEBUI_UNIT:-stalwart-webui.service}"
WEBUI_UNIT_FILE="${BEARMAIL_WEBUI_UNIT_FILE:-/etc/systemd/system/stalwart-webui.service}"

dry_run="false"
use_local="false"
stalwart_binary=""
stalwart_config=""
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
Usage: curl -fsSL <upgrade.sh URL> | sudo bash

Upgrades an already-installed BearMail host to the published Stalwart binary,
WebUI, and MCP sidecar. Non-interactive. Does not change configuration,
Caddy, DNS, CORS, SMTP relay, installer-state, or stored mail. Does not
accept hostnames, passwords, or API tokens as flags.

One-liner:

  curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/upgrade.sh | sudo bash

Preview:

  curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/upgrade.sh | sh -s -- --dry-run

Do not use install.sh for this: that wizard re-asks CORS, relay, and DNS.

Options:
  --dry-run    Print the plan without changing the system
  --local      Use stalwart and stalwart-webui.tar.gz beside this script
  -h, --help   Show this help

Environment (optional):
  BEARMAIL_DOWNLOAD_BASE  Artifact base URL (default: GitHub raw main)
  BEARMAIL_WORK_DIR       Staging directory (default: /var/tmp/bearmail-upgrade)

The currently published Stalwart binary is Linux x86-64.
EOF
}

cleanup() {
    if [ -n "$tmp" ] && [ -d "$tmp" ]; then
        rm -rf "$tmp"
    fi
}

trap cleanup EXIT INT HUP TERM

unit_value() {
    sed -n "s/^${2}=//p" "$1" 2>/dev/null | sed -n '$p'
}

resolve_script_dir() {
    _this="$0"
    case "$_this" in
        bash|sh|-bash|-sh|dash|-dash) return 0 ;;
        -*) return 0 ;;
    esac
    [ -f "$_this" ] || return 0
    CDPATH= cd -- "$(dirname -- "$_this")" && pwd
}

cache_bust_url() {
    _url="$1"
    case "$_url" in
        *githubusercontent.com*|*github.com/*)
            printf '%s\n' "${_url}?t=$(date +%s)"
            ;;
        *)
            printf '%s\n' "$_url"
            ;;
    esac
}

download_file() {
    _url="$(cache_bust_url "$1")"
    _destination="$2"
    _label="$3"
    say "Downloading ${_label}..."
    if command -v curl >/dev/null 2>&1; then
        curl --proto '=https' --tlsv1.2 --fail --location --progress-bar \
            --connect-timeout 15 --retry 3 \
            --header 'Cache-Control: no-cache' --header 'Pragma: no-cache' \
            --output "$_destination" "$_url" \
            || err "Could not download ${_url}."
    elif command -v wget >/dev/null 2>&1; then
        wget --https-only --timeout=30 --tries=3 --no-cache \
            --output-document="$_destination" "$_url" \
            || err "Could not download ${_url}."
    else
        err "curl or wget is required to download ${_url}."
    fi
    [ -s "$_destination" ] || err "Download was empty: ${_url}"
}

require_min_size() {
    _path="$1"
    _min="$2"
    _label="$3"
    _size=$(wc -c < "$_path" | tr -d ' ')
    case "$_size" in ''|*[!0-9]*) err "Could not measure ${_label}." ;; esac
    if [ "$_size" -lt "$_min" ]; then
        err "${_label} is too small (${_size} bytes). The download is incomplete or not the expected artifact."
    fi
}

assert_elf_x86_64() {
    _path="$1"
    if command -v od >/dev/null 2>&1; then
        _magic=$(od -An -t x1 -N 4 "$_path" | tr -d ' \n')
        [ "$_magic" = "7f454c46" ] || err "The Stalwart download is not an ELF binary."
        _machine=$(od -An -t x1 -j 18 -N 2 "$_path" | tr -d ' \n')
        [ "$_machine" = "3e00" ] || err "The Stalwart download is not an x86-64 binary (ELF machine ${_machine})."
        return 0
    fi
    if command -v file >/dev/null 2>&1; then
        file "$_path" | grep -q 'ELF 64-bit.*x86-64' \
            || err "The Stalwart download is not an x86-64 ELF binary."
    fi
}

install_executable_atomically() {
    _source="$1"
    _destination="$2"
    _staged="${_destination}.new.$$"
    if ! install -m 0755 "$_source" "$_staged"; then
        rm -f "$_staged"
        err "Could not stage the Stalwart binary at ${_staged}."
    fi
    if ! mv -f "$_staged" "$_destination"; then
        rm -f "$_staged"
        err "Could not atomically replace ${_destination}."
    fi
}

wait_ready() {
    _url="$1"
    _label="$2"
    _n=0
    while [ "$_n" -lt 60 ]; do
        if command -v curl >/dev/null 2>&1; then
            if curl -fsS --max-time 2 "$_url" >/dev/null 2>&1; then
                return 0
            fi
        elif command -v wget >/dev/null 2>&1; then
            if wget -q -O /dev/null --timeout=2 "$_url" >/dev/null 2>&1; then
                return 0
            fi
        else
            err "curl or wget is required to check ${_label}."
        fi
        sleep 1
        _n=$((_n + 1))
    done
    err "${_label} did not become ready at ${_url}."
}

detect_stalwart() {
    if [ -f "$STALWART_UNIT_FILE" ]; then
        _exec="$(unit_value "$STALWART_UNIT_FILE" "ExecStart")"
        stalwart_binary="$(printf '%s\n' "$_exec" | sed -n 's/^\([^[:space:]]*\).*/\1/p')"
        stalwart_config="$(printf '%s\n' "$_exec" | sed -n 's/^.*[[:space:]]--config=\([^[:space:]]*\).*$/\1/p')"
    fi
    if command -v systemctl >/dev/null 2>&1 && \
        [ "$STALWART_UNIT_FILE" = "/etc/systemd/system/stalwart.service" ] && \
        systemctl cat "$STALWART_UNIT" >/dev/null 2>&1; then
        _exec="$(systemctl show -p ExecStart --value "$STALWART_UNIT" 2>/dev/null || true)"
        _path="${_exec#*path=}"
        _path="${_path%% ;*}"
        case "$_path" in /*) stalwart_binary="$_path" ;; esac
        _cfg="$(printf '%s\n' "$_exec" | sed -n 's/^.*[[:space:]]--config=\([^[:space:];]*\).*$/\1/p')"
        [ -n "$_cfg" ] && stalwart_config="$_cfg"
    fi
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        --dry-run)
            dry_run="true"
            shift
            ;;
        --local)
            use_local="true"
            shift
            ;;
        --)
            shift
            break
            ;;
        -*)
            err "Unknown option: $1. This script accepts --help, --dry-run, and --local."
            ;;
        *)
            err "Unexpected argument: $1"
            ;;
    esac
done

script_dir="$(resolve_script_dir || true)"
detect_stalwart

say "BearMail in-place upgrade"
say "  Artifacts: ${BEARMAIL_DOWNLOAD_BASE}"
say "  Staging:   ${WORK_DIR}"
if [ -n "$stalwart_binary" ]; then
    say "  Binary:    ${stalwart_binary}"
fi
if [ -n "$stalwart_config" ]; then
    say "  Config:    ${stalwart_config} (unchanged)"
fi
say "  Leaves unchanged: config, Caddy, DNS, CORS, SMTP relay, mailboxes"
say ""

if [ "$dry_run" = "true" ]; then
    say "Dry run: would replace the Stalwart binary, WebUI, and MCP sidecar."
    if [ "$use_local" = "true" ] && [ -n "$script_dir" ]; then
        say "  Local ${script_dir}/stalwart"
        say "  Local ${script_dir}/stalwart-webui.tar.gz"
    else
        say "  Download ${BEARMAIL_DOWNLOAD_BASE}/stalwart"
        say "  Download ${BEARMAIL_DOWNLOAD_BASE}/stalwart-webui.tar.gz"
    fi
    if [ -n "$script_dir" ] && [ -f "${script_dir}/update.sh" ]; then
        say "  Use local ${script_dir}/update.sh"
    else
        say "  Download ${BEARMAIL_DOWNLOAD_BASE}/update.sh"
    fi
    if [ -n "$script_dir" ] && [ -f "${script_dir}/mcp_install.sh" ]; then
        say "  Use local ${script_dir}/mcp_install.sh"
    else
        say "  Download ${BEARMAIL_DOWNLOAD_BASE}/mcp_install.sh"
    fi
    if [ -n "$stalwart_binary" ]; then
        say "  Then restart ${STALWART_UNIT} with the new binary at ${stalwart_binary}"
    else
        say "  Then detect the live stalwart.service binary path and restart it"
    fi
    say "Does not run install.sh and does not change configuration or DNS."
    exit 0
fi

if [ "$(uname -s)" != "Linux" ]; then
    err "This upgrade currently requires Linux with systemd."
fi
case "$(uname -m)" in
    x86_64|amd64) ;;
    *)
        err "The published Stalwart binary is Linux x86-64. This machine is $(uname -m)."
        ;;
esac
if [ "$(id -u)" -ne 0 ]; then
    err "This upgrade must run as root. Use:
  curl -fsSL ${BEARMAIL_DOWNLOAD_BASE}/upgrade.sh | sudo bash"
fi
command -v tar >/dev/null 2>&1 || err "tar is required."
command -v systemctl >/dev/null 2>&1 || err "systemctl is required."
if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    err "curl or wget is required."
fi
if ! systemctl cat "$STALWART_UNIT" >/dev/null 2>&1; then
    err "stalwart.service was not found. Install BearMail first, then rerun this upgrade."
fi
if ! systemctl cat "$WEBUI_UNIT" >/dev/null 2>&1; then
    err "stalwart-webui.service was not found. Install BearMail first, then rerun this upgrade."
fi

detect_stalwart
case "$stalwart_binary" in /*) ;; *)
    err "Could not read the installed Stalwart binary path from ${STALWART_UNIT}."
    ;;
esac
case "$stalwart_config" in /*) ;; *)
    err "Could not read --config from ${STALWART_UNIT}."
    ;;
esac
[ -f "$stalwart_config" ] && [ -s "$stalwart_config" ] || \
    err "Existing Stalwart config is missing or empty: ${stalwart_config}
This upgrade will not initialize a new server. Fix the config, then rerun."
[ -x "$stalwart_binary" ] || [ -f "$stalwart_binary" ] || \
    err "Installed Stalwart binary not found: ${stalwart_binary}"

mkdir -p "$WORK_DIR"
chmod 0700 "$WORK_DIR"
tmp="$(mktemp -d "${WORK_DIR}/stage.XXXXXX")"

new_binary="${tmp}/stalwart"
webui_archive="${tmp}/stalwart-webui.tar.gz"
update_sh=""
mcp_sh=""

if [ "$use_local" = "true" ]; then
    [ -n "$script_dir" ] || err "--local requires running a file, not a curl pipe."
    [ -f "${script_dir}/stalwart" ] || err "Local binary not found: ${script_dir}/stalwart"
    [ -f "${script_dir}/stalwart-webui.tar.gz" ] || err "Local archive not found: ${script_dir}/stalwart-webui.tar.gz"
    cp -a "${script_dir}/stalwart" "$new_binary"
    cp -a "${script_dir}/stalwart-webui.tar.gz" "$webui_archive"
else
    download_file "${BEARMAIL_DOWNLOAD_BASE}/stalwart" "$new_binary" "stalwart (this is large; wait for it)"
    download_file "${BEARMAIL_DOWNLOAD_BASE}/stalwart-webui.tar.gz" "$webui_archive" "stalwart-webui.tar.gz"
fi

if [ -n "$script_dir" ] && [ -f "${script_dir}/update.sh" ]; then
    update_sh="${script_dir}/update.sh"
else
    update_sh="${tmp}/update.sh"
    download_file "${BEARMAIL_DOWNLOAD_BASE}/update.sh" "$update_sh" "update.sh"
fi
if [ -n "$script_dir" ] && [ -f "${script_dir}/mcp_install.sh" ]; then
    mcp_sh="${script_dir}/mcp_install.sh"
else
    mcp_sh="${tmp}/mcp_install.sh"
    download_file "${BEARMAIL_DOWNLOAD_BASE}/mcp_install.sh" "$mcp_sh" "mcp_install.sh"
fi

chmod 0755 "$new_binary"
require_min_size "$new_binary" 1000000 "stalwart"
require_min_size "$webui_archive" 10000 "stalwart-webui.tar.gz"
require_min_size "$update_sh" 1000 "update.sh"
require_min_size "$mcp_sh" 1000 "mcp_install.sh"
assert_elf_x86_64 "$new_binary"
tar -tzf "$webui_archive" >/dev/null || err "The WebUI archive is not a readable gzip tar."
grep -q 'Leaves unchanged' "$update_sh" || err "update.sh does not look like the BearMail WebUI updater."
grep -q 'bearmail-mcp' "$mcp_sh" || err "mcp_install.sh does not look like the BearMail MCP installer."
if grep -q 'mcp_src="$(fetch_mcp_sources)"' "$mcp_sh"; then
    err "Downloaded mcp_install.sh is stale (captures download logs as the MCP path). Re-run in a minute, or: sudo sh ./mcp_install.sh"
fi
grep -q 'mcp_src="$RETVAL"' "$mcp_sh" || \
    err "Downloaded mcp_install.sh is too old. Update GitHub main, or run: sudo sh ./mcp_install.sh"

say "Replacing Stalwart binary at ${stalwart_binary}..."
install_executable_atomically "$new_binary" "$stalwart_binary"
chmod 0755 "$stalwart_binary"
systemctl restart "$STALWART_UNIT"
wait_ready "http://127.0.0.1:8080/healthz/ready" "Stalwart"

say "Updating the WebUI (preserving dist/config.json)..."
sh "$update_sh" --archive "$webui_archive"

say "Installing or updating the MCP sidecar..."
BEARMAIL_WORK_DIR="${tmp}/mcp" sh "$mcp_sh"

say ""
say "Upgrade complete."
say "  Stalwart binary: ${stalwart_binary}"
say "  Config unchanged: ${stalwart_config}"
say "  WebUI: hard-refresh the browser so it loads the new assets."
say "  MCP: node /opt/bearmail-mcp/dist/stdio.js   Guide: docs/AGENT_GUIDE.md"
