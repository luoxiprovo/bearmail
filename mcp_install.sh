#!/usr/bin/env sh
# shellcheck shell=dash

# Add AI-agent MCP support to an already-installed BearMail host.
# Does not replace Stalwart, Caddy, DNS, or stored mail.
#
# Intended for:
#   curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/mcp_install.sh | sudo bash

set -eu

BEARMAIL_REPO="${BEARMAIL_REPO:-luoxiprovo/bearmail}"
BEARMAIL_REF="${BEARMAIL_REF:-main}"
BEARMAIL_ARCHIVE_URL="${BEARMAIL_ARCHIVE_URL:-https://github.com/${BEARMAIL_REPO}/archive/refs/heads/${BEARMAIL_REF}.tar.gz}"
WORK_DIR="${BEARMAIL_WORK_DIR:-/var/tmp/bearmail-mcp-install}"
INSTALLER_STATE="${BEARMAIL_INSTALLER_STATE:-/etc/stalwart/installer-state.json}"
WEBUI_UNIT="${BEARMAIL_WEBUI_UNIT:-stalwart-webui.service}"
WEBUI_UNIT_FILE="${BEARMAIL_WEBUI_UNIT_FILE:-/etc/systemd/system/stalwart-webui.service}"
PREFIX="${BEARMAIL_MCP_PREFIX:-/opt/bearmail-mcp}"
PORT="${BEARMAIL_MCP_PORT:-8082}"

dry_run="false"
install_service="true"
server_url="${BEARMAIL_SERVER:-}"
node_bin="${BEARMAIL_NODE_BIN:-}"
local_mcp=""
tmp=""

say() {
    printf '%s\n' "$1" >&2
}

err() {
    printf 'ERROR: %s\n' "$1" >&2
    exit 1
}

usage() {
    cat <<'EOF'
Usage: curl -fsSL <mcp_install.sh URL> | sudo bash

Installs the BearMail MCP sidecar on a host that already has BearMail.
Does not change Stalwart, Caddy, DNS, or stored mail. Does not accept
mailbox passwords or tokens as flags.

One-liner:

  curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/mcp_install.sh | sudo bash

Preview:

  curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/mcp_install.sh | sh -s -- --dry-run

After it finishes, create a dedicated mailbox in admin, issue an app
password, and point Cursor or Claude at /opt/bearmail-mcp/dist/stdio.js.
See docs/AGENT_GUIDE.md.

Options:
  --server-url URL  Mail HTTPS origin (default: detect from this host)
  --dry-run         Print the plan without changing the system
  --no-systemd      Install files only; do not enable bearmail-mcp.service
  -h, --help        Show this help

Environment (optional):
  BEARMAIL_SERVER         Same as --server-url
  BEARMAIL_NODE_BIN       Absolute path to Node.js 22.12 or later
  BEARMAIL_ARCHIVE_URL    GitHub source tarball (default: this repo, main)
  BEARMAIL_WORK_DIR       Staging directory
EOF
}

cleanup() {
    if [ -n "$tmp" ] && [ -d "$tmp" ]; then
        rm -rf "$tmp"
    fi
}

trap cleanup EXIT INT HUP TERM

node_at_least_22_12() {
    _node_version=$("$1" --version 2>/dev/null) || return 1
    case "$_node_version" in v*) _node_numbers=${_node_version#v} ;; *) return 1 ;; esac
    case "$_node_numbers" in ''|.*|*.|*..*|*[!0-9.]*) return 1 ;; esac
    _node_major=${_node_numbers%%.*}
    _node_rest=${_node_numbers#*.}
    [ "$_node_rest" != "$_node_numbers" ] || return 1
    _node_minor=${_node_rest%%.*}
    [ "$_node_major" -gt 22 ] 2>/dev/null || \
        { [ "$_node_major" -eq 22 ] 2>/dev/null && [ "$_node_minor" -ge 12 ] 2>/dev/null; }
}

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

download_file() {
    _url="$1"
    _destination="$2"
    _label="$3"
    say "Downloading ${_label}..."
    if command -v curl >/dev/null 2>&1; then
        curl --proto '=https' --tlsv1.2 --fail --location --progress-bar \
            --connect-timeout 15 --retry 3 \
            --output "$_destination" "$_url" \
            || err "Could not download ${_url}."
    elif command -v wget >/dev/null 2>&1; then
        wget --https-only --timeout=30 --tries=3 --output-document="$_destination" "$_url" \
            || err "Could not download ${_url}."
    else
        err "curl or wget is required to download ${_url}."
    fi
    [ -s "$_destination" ] || err "Download was empty: ${_url}"
}

sha256_hex() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | tr -d ' ' | cut -c1-64
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | tr -d ' ' | cut -c1-64
    elif command -v openssl >/dev/null 2>&1; then
        openssl dgst -sha256 "$1" | awk '{print tolower($NF)}'
    else
        err "A SHA-256 utility (sha256sum, shasum, or openssl) is required to verify Node.js."
    fi
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

find_local_mcp() {
    _dir="$1"
    if [ -n "$_dir" ] && [ -f "${_dir}/mcp/install.sh" ]; then
        grep -q 'BEARMAIL_MCP_ARCHIVE_VERSION=' "${_dir}/mcp/install.sh" || return 1
        printf '%s\n' "${_dir}/mcp"
        return 0
    fi
    if [ -f "./mcp/install.sh" ]; then
        grep -q 'BEARMAIL_MCP_ARCHIVE_VERSION=' "./mcp/install.sh" || return 1
        CDPATH= cd -- "./mcp" && pwd
        return 0
    fi
    return 1
}

pick_node() {
    _candidate="$1"
    case "$_candidate" in /*) ;; *) return 1 ;; esac
    [ -x "$_candidate" ] || return 1
    node_at_least_22_12 "$_candidate" || return 1
    node_bin="$_candidate"
}

detect_node() {
    if [ -n "$node_bin" ]; then
        pick_node "$node_bin" || err "BEARMAIL_NODE_BIN is not a usable Node.js 22.12+ binary: ${node_bin}"
        return 0
    fi
    if [ -f "$WEBUI_UNIT_FILE" ]; then
        _exec="$(unit_value "$WEBUI_UNIT_FILE" "ExecStart")"
        _node="$(printf '%s\n' "$_exec" | sed -n 's/^\([^[:space:]]*\).*/\1/p')"
        pick_node "$_node" && return 0
    fi
    if command -v systemctl >/dev/null 2>&1 && systemctl cat "$WEBUI_UNIT" >/dev/null 2>&1; then
        _exec="$(systemctl show -p ExecStart --value "$WEBUI_UNIT" 2>/dev/null || true)"
        _node="${_exec#*path=}"
        _node="${_node%% ;*}"
        pick_node "$_node" && return 0
    fi
    for _cand in /opt/stalwart-node/*/bin/node; do
        pick_node "$_cand" && return 0
    done
    if command -v node >/dev/null 2>&1; then
        _path="$(command -v node)"
        case "$_path" in /*) pick_node "$_path" && return 0 ;; esac
    fi
    return 1
}

detect_server_url() {
    if [ -n "$server_url" ]; then
        return 0
    fi
    _host="$(json_string_field "$INSTALLER_STATE" serverHostname)"
    if [ -n "$_host" ]; then
        server_url="https://${_host}"
        return 0
    fi
    _wd=""
    if [ -f "$WEBUI_UNIT_FILE" ]; then
        _wd="$(unit_value "$WEBUI_UNIT_FILE" "WorkingDirectory")"
    fi
    if [ -z "$_wd" ] && command -v systemctl >/dev/null 2>&1; then
        _wd="$(systemctl show -p WorkingDirectory --value "$WEBUI_UNIT" 2>/dev/null || true)"
    fi
    case "$_wd" in /*)
        _url="$(json_string_field "${_wd}/dist/config.json" defaultServerUrl)"
        if [ -n "$_url" ]; then
            server_url="$_url"
            return 0
        fi
        ;;
    esac
    return 1
}

normalize_server_url() {
    _raw="$1"
    case "$_raw" in
        https://*|http://127.0.0.1*|http://localhost*|http://[::1]*)
            printf '%s\n' "$_raw" | sed 's|/*$||'
            ;;
        http://*)
            err "Use HTTPS for the mail origin (got ${_raw})."
            ;;
        *)
            printf 'https://%s\n' "$_raw" | sed 's|/*$||'
            ;;
    esac
}

ensure_build_npm() {
    if command -v npm >/dev/null 2>&1; then
        return 0
    fi
    if [ -n "$node_bin" ]; then
        _npm="$(dirname "$node_bin")/npm"
        if [ -x "$_npm" ]; then
            PATH="$(dirname "$node_bin"):$PATH"
            export PATH
            return 0
        fi
    fi

    case "$(uname -m)" in
        x86_64|amd64) _arch="x64" ;;
        aarch64|arm64) _arch="arm64" ;;
        armv7l) _arch="armv7l" ;;
        ppc64le) _arch="ppc64le" ;;
        s390x) _arch="s390x" ;;
        *) err "No official Node.js 22 Linux binary for $(uname -m). Install Node.js 22.12+ with npm and rerun." ;;
    esac

    _sums="${tmp}/node-SHASUMS256.txt"
    download_file "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt" "$_sums" "Node.js 22 checksum index"
    _archive_name="$(sed -n "s/^.*  \(node-v[^ ]*-linux-${_arch}\.tar\.gz\)$/\1/p" "$_sums" | sed -n '1p')"
    [ -n "$_archive_name" ] || err "The Node.js release index has no Linux ${_arch} archive."
    _version="$(printf '%s\n' "$_archive_name" | sed 's/^node-\(v[^-]*\)-.*/\1/')"
    case "$_version" in
        v22.*) ;;
        *) err "Unexpected Node.js version from the release index: ${_version}" ;;
    esac
    _archive="${tmp}/${_archive_name}"
    _release_sums="${tmp}/node-${_version}-SHASUMS256.txt"
    download_file "https://nodejs.org/dist/${_version}/SHASUMS256.txt" "$_release_sums" "Node.js ${_version} checksums"
    download_file "https://nodejs.org/dist/${_version}/${_archive_name}" "$_archive" "Node.js ${_version} (npm, for the MCP build)"
    _expected="$(sed -n "s/^\([0-9a-fA-F][0-9a-fA-F]*\)  ${_archive_name}$/\1/p" "$_release_sums" | sed -n '1p')"
    [ "${#_expected}" -eq 64 ] || err "Could not read the official SHA-256 for ${_archive_name}."
    _actual="$(sha256_hex "$_archive")"
    [ "$_actual" = "$_expected" ] || err "The Node.js archive checksum did not match."
    _stage="${tmp}/node-runtime"
    mkdir -p "$_stage"
    tar --no-same-owner --no-same-permissions -xzf "$_archive" -C "$_stage" --strip-components=1
    [ -x "${_stage}/bin/npm" ] && [ -x "${_stage}/bin/node" ] || err "The Node.js archive did not contain npm."
    PATH="${_stage}/bin:$PATH"
    export PATH
    if [ -z "$node_bin" ]; then
        node_bin="${_stage}/bin/node"
    fi
}

fetch_mcp_sources() {
    RETVAL=""
    if [ -n "$local_mcp" ]; then
        RETVAL="$local_mcp"
        return 0
    fi
    _archive="${tmp}/bearmail-src.tar.gz"
    download_file "$BEARMAIL_ARCHIVE_URL" "$_archive" "BearMail MCP sources"
    _extract="${tmp}/src"
    mkdir -p "$_extract"
    tar --no-same-owner --no-same-permissions -xzf "$_archive" -C "$_extract"
    _mcp=""
    for _cand in "$_extract"/mcp "$_extract"/*/mcp; do
        if [ -f "${_cand}/install.sh" ] && grep -q 'BEARMAIL_MCP_ARCHIVE_VERSION=' "${_cand}/install.sh"; then
            _mcp="$_cand"
            break
        fi
    done
    [ -n "$_mcp" ] || err "The source archive does not contain mcp/install.sh. Push the MCP tree to ${BEARMAIL_REPO}@${BEARMAIL_REF} or run this script from a checkout."
    RETVAL="$_mcp"
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
        --no-systemd)
            install_service="false"
            shift
            ;;
        --server-url)
            server_url=${2:?Missing URL after --server-url}
            shift 2
            ;;
        --)
            shift
            break
            ;;
        -*)
            err "Unknown option: $1. This script accepts --help, --dry-run, --no-systemd, and --server-url."
            ;;
        *)
            err "Unexpected argument: $1"
            ;;
    esac
done

script_dir="$(resolve_script_dir || true)"
local_mcp="$(find_local_mcp "$script_dir" || true)"

say "BearMail MCP installer"
if [ -n "$local_mcp" ]; then
    say "  Sources:  ${local_mcp} (local checkout)"
else
    say "  Sources:  ${BEARMAIL_ARCHIVE_URL}"
fi
say "  Prefix:   ${PREFIX}"
say "  Staging:  ${WORK_DIR}"
say ""

if [ "$dry_run" = "true" ]; then
    say "Dry run: would install the MCP sidecar (bearmail-mcp)."
    if [ -n "$local_mcp" ]; then
        say "  Use local ${local_mcp}"
    else
        say "  Download ${BEARMAIL_ARCHIVE_URL}"
    fi
    say "  Copy into ${PREFIX}"
    if [ "$install_service" = "true" ]; then
        say "  Enable bearmail-mcp.service on 127.0.0.1:${PORT}"
    else
        say "  Skip systemd (--no-systemd)"
    fi
    say "Does not change Stalwart, Caddy, DNS, or mail data."
    say "Does not accept mailbox tokens. After install, create a mailbox and an app password."
    exit 0
fi

if [ "$(uname -s)" != "Linux" ]; then
    err "This installer requires Linux with systemd."
fi
if [ "$(id -u)" -ne 0 ]; then
    err "This installer must run as root. Use:
  curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/mcp_install.sh | sudo bash"
fi
command -v tar >/dev/null 2>&1 || err "tar is required."
if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    err "curl or wget is required."
fi
if [ "$install_service" = "true" ]; then
    command -v systemctl >/dev/null 2>&1 || err "systemctl is required unless you pass --no-systemd."
    if ! { getent passwd stalwart-webui >/dev/null 2>&1 || id stalwart-webui >/dev/null 2>&1; }; then
        err "User stalwart-webui was not found. Install BearMail first, then rerun this script."
    fi
    if ! systemctl cat stalwart.service >/dev/null 2>&1; then
        err "stalwart.service was not found. Install BearMail first, then rerun this script."
    fi
fi

detect_node || true
detect_server_url || true
if [ -n "$server_url" ]; then
    server_url="$(normalize_server_url "$server_url")"
fi
if [ "$install_service" = "true" ] && [ -z "$server_url" ]; then
    err "Could not detect the mail origin. Re-run with:
  curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/mcp_install.sh | sudo bash -s -- --server-url https://mail.example.com"
fi

mkdir -p "$WORK_DIR"
chmod 0700 "$WORK_DIR"
tmp="$(mktemp -d "${WORK_DIR}/stage.XXXXXX")"

use_prebuilt="false"
if [ -n "$local_mcp" ] && [ -f "${local_mcp}/dist/http.js" ] && [ -d "${local_mcp}/node_modules" ]; then
    use_prebuilt="true"
fi
if [ "$use_prebuilt" != "true" ]; then
    ensure_build_npm
fi
[ -n "$node_bin" ] && [ -x "$node_bin" ] || err "Node.js 22.12 or later is required."
node_at_least_22_12 "$node_bin" || err "Node.js 22.12 or later is required (${node_bin})."
if [ "$use_prebuilt" != "true" ]; then
    command -v npm >/dev/null 2>&1 || err "npm is required to build bearmail-mcp."
fi

fetch_mcp_sources
mcp_src="$RETVAL"
case "$mcp_src" in
    /*) ;;
    *) err "MCP source path is invalid: ${mcp_src}" ;;
esac
[ -f "${mcp_src}/install.sh" ] || err "MCP install.sh is missing at ${mcp_src}/install.sh"
say "Installing MCP from ${mcp_src}..."
set -- --prefix "$PREFIX" --port "$PORT" --node-bin "$node_bin"
if [ -n "$server_url" ]; then
    set -- "$@" --server-url "$server_url"
fi
if [ "$install_service" = "true" ]; then
    set -- "$@" --systemd
fi
if [ "$use_prebuilt" = "true" ]; then
    set -- "$@" --no-build
fi
sh "${mcp_src}/install.sh" "$@"

say ""
say "Next: create a dedicated mailbox in admin, issue an app password, then"
say "point the MCP host at stdio (never a human primary password):"
say "  command: ${node_bin} ${PREFIX}/dist/stdio.js"
if [ -n "$server_url" ]; then
    say "  BEARMAIL_SERVER=${server_url}"
fi
say "  BEARMAIL_USERNAME=<agent@your-domain>"
say "  BEARMAIL_TOKEN=<app-password-or-oauth-token>"
say "  BEARMAIL_SEND_MODE=draft-only"
say "Example: mcp/mcp.json.example   Guide: docs/AGENT_GUIDE.md"
