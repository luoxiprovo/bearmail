#!/usr/bin/env sh
# shellcheck shell=dash

# Download the published BearMail artifacts and run the interactive installer.
# Intended for:
#   curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/release_install.sh | sudo bash
# The same file can be served from a Vercel (or other) static site; artifacts
# still come from GitHub unless BEARMAIL_DOWNLOAD_BASE is set.

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

usage() {
    cat <<'EOF'
Usage: curl -fsSL <release_install.sh URL> | sudo bash

Downloads the published Stalwart binary, WebUI archive, and install.sh, then
runs the same interactive installer as a local copy of those three files.

This wrapper is safe to host on Vercel or GitHub. It does not accept mail
hostnames, passwords, or API tokens as flags; those questions are asked by
install.sh from your terminal.

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
        _machine=$(od -An -t x2 -j 18 -N 2 "$_path" | tr -d ' \n')
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

say "BearMail release installer"
say "  Artifacts: ${BEARMAIL_DOWNLOAD_BASE}"
say "  Staging:   ${WORK_DIR}"
say "  Files:     install.sh, stalwart, stalwart-webui.tar.gz"
say ""

if [ "$dry_run" = "true" ]; then
    say "Dry run: would download:"
    say "  ${BEARMAIL_DOWNLOAD_BASE}/install.sh"
    say "  ${BEARMAIL_DOWNLOAD_BASE}/stalwart"
    say "  ${BEARMAIL_DOWNLOAD_BASE}/stalwart-webui.tar.gz"
    say "then run: sh ${WORK_DIR}/install.sh"
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
  curl -fsSL ${BEARMAIL_DOWNLOAD_BASE}/release_install.sh | sudo bash"
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
download_file "${BEARMAIL_DOWNLOAD_BASE}/stalwart-webui.tar.gz" "${WORK_DIR}/stalwart-webui.tar.gz" "stalwart-webui.tar.gz"

require_min_size "${WORK_DIR}/install.sh" 10000 "install.sh"
require_min_size "${WORK_DIR}/stalwart" 1000000 "stalwart"
require_min_size "${WORK_DIR}/stalwart-webui.tar.gz" 10000 "stalwart-webui.tar.gz"
grep -q 'BearMail' "${WORK_DIR}/install.sh" || err "The downloaded install.sh does not look like the BearMail installer."
assert_elf_x86_64 "${WORK_DIR}/stalwart"
tar -tzf "${WORK_DIR}/stalwart-webui.tar.gz" >/dev/null \
    || err "The downloaded WebUI archive is not a readable gzip tar."
chmod 0755 "${WORK_DIR}/install.sh" "${WORK_DIR}/stalwart"

say ""
say "Artifacts are ready in ${WORK_DIR}."
say "Starting interactive setup. Accept the default Stalwart binary and WebUI"
say "archive paths unless you have a reason to change them."
say ""

cd "$WORK_DIR"
exec sh ./install.sh
