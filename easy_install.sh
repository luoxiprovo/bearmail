#!/usr/bin/env sh
# shellcheck shell=dash

# Download the published BearMail artifacts and run the short installer.
# Fixed choices use the recommended defaults. mcp_install.sh remains a
# standalone script for a host that already has BearMail and only needs MCP.
# Intended for:
#   curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/easy_install.sh | sudo bash
# Artifacts still come from GitHub unless BEARMAIL_DOWNLOAD_BASE is set.

set -eu

BEARMAIL_REPO="${BEARMAIL_REPO:-luoxiprovo/bearmail}"
BEARMAIL_REF="${BEARMAIL_REF:-main}"
BEARMAIL_DOWNLOAD_BASE="${BEARMAIL_DOWNLOAD_BASE:-https://raw.githubusercontent.com/${BEARMAIL_REPO}/${BEARMAIL_REF}}"
WORK_DIR="${BEARMAIL_WORK_DIR:-/var/tmp/bearmail-install}"

dry_run="false"

say() {
    printf '%s\n' "$1"
}

err() {
    printf 'ERROR: %s\n' "$1" >&2
    exit 1
}

show_finish_reminder() {
    if [ "${_reminder_shown:-false}" = "true" ]; then
        return 0
    fi
    _reminder_shown="true"
    if [ -z "${BEARMAIL_REMINDER_FILE:-}" ] || [ ! -f "$BEARMAIL_REMINDER_FILE" ] || [ -L "$BEARMAIL_REMINDER_FILE" ]; then
        if [ -n "${BEARMAIL_REMINDER_FILE:-}" ]; then
            rm -f "$BEARMAIL_REMINDER_FILE"
        fi
        return 0
    fi
    _reminder_user=""
    _reminder_pass=""
    _reminder_portal=""
    _reminder_admin_url=""
    _reminder_line=0
    while IFS= read -r _reminder_text || [ -n "${_reminder_text:-}" ]; do
        _reminder_line=$((_reminder_line + 1))
        case "$_reminder_line" in
            1) _reminder_user="$_reminder_text" ;;
            2) _reminder_pass="$_reminder_text" ;;
            3) _reminder_portal="$_reminder_text" ;;
            4) _reminder_admin_url="$_reminder_text" ;;
        esac
    done < "$BEARMAIL_REMINDER_FILE"
    rm -f "$BEARMAIL_REMINDER_FILE"
    if [ -z "$_reminder_portal" ] && { [ -z "$_reminder_user" ] || [ -z "$_reminder_pass" ]; }; then
        return 0
    fi
    say ""
    if [ -n "$_reminder_portal" ]; then
        case "$_reminder_portal" in
            */) ;;
            *) _reminder_portal="${_reminder_portal}/" ;;
        esac
        say "BearMail portal for normal users: ${_reminder_portal}"
    fi
    if [ -n "$_reminder_user" ] && [ -n "$_reminder_pass" ]; then
        say ""
        say "Permanent administrator credential"
        say "  Username: ${_reminder_user}"
        say "  Password: ${_reminder_pass}"
        if [ -n "$_reminder_admin_url" ]; then
            say "Use this to sign in at ${_reminder_admin_url} and add other accounts."
        fi
        say "This password is not saved in installer-state.json. Store it somewhere safe."
    fi
}

usage() {
    cat <<'EOF'
Usage: curl -fsSL <easy_install.sh URL> | sudo bash

Downloads the published Stalwart binary, BearMail web archive, install.sh,
and mcp_install.sh. It then runs the short installer and the MCP sidecar.

The short installer keeps the recommended defaults and asks only for the
BearMail portal URL, the public mail hostname, the primary mail domain,
confirmation of the server setup, the Brevo SMTP login and API key, the DNS
provider, and that provider's zone and token.

Hosts that already have BearMail can still run mcp_install.sh alone.
The full interactive installer remains release_install.sh.

This wrapper does not accept mail hostnames, passwords, or API tokens as
flags. Those questions are asked from your terminal.

Options:
  --dry-run    Print the download plan without writing files
  -h, --help   Show this help

Environment (optional):
  BEARMAIL_DOWNLOAD_BASE  Artifact base URL (default: GitHub raw main)
  BEARMAIL_WORK_DIR       Staging directory (default: /var/tmp/bearmail-install)

The currently published Stalwart binary is Linux x86-64.
EOF
}

need_cmd() {
    command -v "$1" >/dev/null 2>&1 || err "Missing required command: $1"
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
        # Read raw bytes (not a host-endian u16). GNU od -t x2 prints 003e on
        # little-endian hosts; x86-64 ELF stores e_machine as 3e 00.
        _machine=$(od -An -t x1 -j 18 -N 2 "$_path" | tr -d ' \n')
        [ "$_machine" = "3e00" ] || err "The Stalwart download is not an x86-64 binary (ELF machine ${_machine})."
        return 0
    fi
    if command -v file >/dev/null 2>&1; then
        file "$_path" | grep -q 'ELF 64-bit.*x86-64' \
            || err "The Stalwart download is not an x86-64 ELF binary."
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
        *)
            err "Unknown argument: $1. This script only accepts --help and --dry-run."
            ;;
    esac
done

say "BearMail easy installer"
say "  Artifacts: ${BEARMAIL_DOWNLOAD_BASE}"
say "  Staging:   ${WORK_DIR}"
say "  Files:     install.sh, stalwart, bearmail-webui.tar.gz, mcp_install.sh"
say ""

if [ "$dry_run" = "true" ]; then
    say "Dry run: would download:"
    say "  ${BEARMAIL_DOWNLOAD_BASE}/install.sh"
    say "  ${BEARMAIL_DOWNLOAD_BASE}/stalwart"
    say "  ${BEARMAIL_DOWNLOAD_BASE}/bearmail-webui.tar.gz"
    say "    and save it as ${WORK_DIR}/bearmail-webui.tar.gz"
    say "  ${BEARMAIL_DOWNLOAD_BASE}/mcp_install.sh"
    say "then run: BEARMAIL_EASY=1 sh ${WORK_DIR}/install.sh"
    say "then run: sh ${WORK_DIR}/mcp_install.sh"
    say "then print the BearMail portal URL and the permanent administrator credential again"
    exit 0
fi

if [ "$(uname -s)" != "Linux" ]; then
    err "The published installer currently requires Linux with systemd."
fi
case "$(uname -m)" in
    x86_64|amd64) ;;
    *)
        err "The published Stalwart binary is Linux x86-64. This machine is $(uname -m)."
        ;;
esac

if [ "$(id -u)" -ne 0 ]; then
    err "This installer must run as root. Use:
  curl -fsSL ${BEARMAIL_DOWNLOAD_BASE}/easy_install.sh | sudo bash"
fi

if ! (exec 3<> /dev/tty) 2>/dev/null; then
    err "An interactive terminal is required. Open an SSH session and run the curl command from that terminal, not from cron or a pipe without a TTY."
fi

need_cmd mkdir
need_cmd chmod
need_cmd tar
need_cmd wc
if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
    err "curl or wget is required."
fi

mkdir -p "$WORK_DIR"
chmod 0700 "$WORK_DIR"

download_file "${BEARMAIL_DOWNLOAD_BASE}/install.sh" "${WORK_DIR}/install.sh" "install.sh"
download_file "${BEARMAIL_DOWNLOAD_BASE}/stalwart" "${WORK_DIR}/stalwart" "stalwart (this is large; wait for it)"
download_file "${BEARMAIL_DOWNLOAD_BASE}/bearmail-webui.tar.gz" "${WORK_DIR}/bearmail-webui.tar.gz" "bearmail-webui.tar.gz"
download_file "${BEARMAIL_DOWNLOAD_BASE}/mcp_install.sh" "${WORK_DIR}/mcp_install.sh" "mcp_install.sh"

require_min_size "${WORK_DIR}/install.sh" 10000 "install.sh"
require_min_size "${WORK_DIR}/stalwart" 1000000 "stalwart"
require_min_size "${WORK_DIR}/bearmail-webui.tar.gz" 10000 "bearmail-webui.tar.gz"
require_min_size "${WORK_DIR}/mcp_install.sh" 1000 "mcp_install.sh"
grep -q 'BEARMAIL_EASY' "${WORK_DIR}/install.sh" || err "The downloaded install.sh does not support the easy installer."
grep -q 'bearmail-mcp' "${WORK_DIR}/mcp_install.sh" || err "The downloaded mcp_install.sh does not look like the BearMail MCP installer."
if grep -q 'mcp_src="$(fetch_mcp_sources)"' "${WORK_DIR}/mcp_install.sh"; then
    err "Downloaded mcp_install.sh is stale (captures download logs as the MCP path). Re-run in a minute, or: sudo sh ./mcp_install.sh"
fi
grep -q 'mcp_src="$RETVAL"' "${WORK_DIR}/mcp_install.sh" || \
    err "Downloaded mcp_install.sh is too old. Update GitHub main, or run: sudo sh ./mcp_install.sh"
assert_elf_x86_64 "${WORK_DIR}/stalwart"
tar -tzf "${WORK_DIR}/bearmail-webui.tar.gz" >/dev/null \
    || err "The downloaded WebUI archive is not a readable gzip tar."
chmod 0755 "${WORK_DIR}/install.sh" "${WORK_DIR}/stalwart" "${WORK_DIR}/mcp_install.sh"

say ""
say "Artifacts are ready in ${WORK_DIR}."
say "Starting the short setup. Recommended paths, Caddy, quick setup, and"
say "Brevo are already selected. The MCP sidecar is installed after setup."
say ""

cd "$WORK_DIR"
BEARMAIL_REMINDER_FILE="${WORK_DIR}/.bearmail-reminder"
_reminder_shown="false"
trap 'status=$?; show_finish_reminder; exit "$status"' EXIT
BEARMAIL_EASY=1 BEARMAIL_REMINDER_FILE="$BEARMAIL_REMINDER_FILE" sh ./install.sh

say ""
say "BearMail is installed. Adding the MCP sidecar for AI agents..."
say ""
if ! BEARMAIL_WORK_DIR="${WORK_DIR}/mcp" sh ./mcp_install.sh; then
    printf 'ERROR: BearMail is installed, but the MCP sidecar failed. Re-run: sudo sh %s/mcp_install.sh\n' \
        "$WORK_DIR" >&2
    show_finish_reminder
    exit 1
fi
show_finish_reminder
