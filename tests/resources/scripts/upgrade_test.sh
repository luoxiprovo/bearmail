#!/usr/bin/env sh

set -eu

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd "${SCRIPT_DIR}/../../.." && pwd)"
UPGRADE_SH="${REPO_ROOT}/upgrade.sh"

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

[ -f "$UPGRADE_SH" ] || fail "upgrade.sh is missing"
sh -n "$UPGRADE_SH" || fail "upgrade.sh is not valid POSIX sh"

help_out="$(sh "$UPGRADE_SH" --help)"
printf '%s\n' "$help_out" | grep -q 'sudo bash' || fail "help does not show the curl | sudo bash invocation"
printf '%s\n' "$help_out" | grep -q 'raw.githubusercontent.com/luoxiprovo/bearmail/main/upgrade.sh' || \
    fail "help does not show the curl one-liner"
printf '%s\n' "$help_out" | grep -q -- '--dry-run' || fail "help does not document --dry-run"
printf '%s\n' "$help_out" | grep -q 'Does not change configuration' || \
    fail "help must say configuration is left unchanged"
printf '%s\n' "$help_out" | grep -q 'install.sh' || fail "help should warn against using install.sh"

if sh "$UPGRADE_SH" --nope >/dev/null 2>&1; then
    fail "unknown arguments should fail"
fi

dry_out="$(sh "$UPGRADE_SH" --dry-run)"
printf '%s\n' "$dry_out" | grep -q 'raw.githubusercontent.com/luoxiprovo/bearmail/main/stalwart$' || \
    fail "dry-run does not print the stalwart URL"
printf '%s\n' "$dry_out" | grep -q 'stalwart-webui.tar.gz' || \
    fail "dry-run does not print the WebUI archive URL"
printf '%s\n' "$dry_out" | grep -q "${REPO_ROOT}/update.sh" || \
    fail "dry-run from a checkout should use local update.sh"
printf '%s\n' "$dry_out" | grep -q "${REPO_ROOT}/mcp_install.sh" || \
    fail "dry-run from a checkout should use local mcp_install.sh"
printf '%s\n' "$dry_out" | grep -q 'Does not run install.sh' || \
    fail "dry-run must say it does not run install.sh"
printf '%s\n' "$dry_out" | grep -q 'config' || fail "dry-run must mention config is unchanged"

override_out="$(BEARMAIL_DOWNLOAD_BASE=https://example.test/bearmail BEARMAIL_WORK_DIR=/tmp/bm-up \
    sh "$UPGRADE_SH" --dry-run)"
printf '%s\n' "$override_out" | grep -q 'https://example.test/bearmail/stalwart$' || \
    fail "BEARMAIL_DOWNLOAD_BASE is not honored"
printf '%s\n' "$override_out" | grep -q '/tmp/bm-up' || fail "BEARMAIL_WORK_DIR is not honored"

local_out="$(sh "$UPGRADE_SH" --dry-run --local)"
printf '%s\n' "$local_out" | grep -q "${REPO_ROOT}/stalwart$" || \
    fail "--local dry-run should use the checkout stalwart binary"
printf '%s\n' "$local_out" | grep -q "${REPO_ROOT}/stalwart-webui.tar.gz" || \
    fail "--local dry-run should use the checkout WebUI archive"

grep -q 'od -An -t x1 -j 18 -N 2' "$UPGRADE_SH" || \
    fail "x86-64 ELF check must read raw bytes (od -t x1), not host-endian x2"
grep -q 'upgrade.sh' "${REPO_ROOT}/README.md" || \
    fail "README.md must document the in-place upgrade one-liner"

printf 'ok\n'
