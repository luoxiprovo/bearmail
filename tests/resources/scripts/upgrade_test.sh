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
printf '%s\n' "$help_out" | grep -q 'BearOS admin UI' || \
    fail "help must name the BearOS admin UI"
printf '%s\n' "$help_out" | grep -q 'BearMail web UI' || \
    fail "help must name the BearMail web UI"
printf '%s\n' "$help_out" | grep -q 'MCP sidecar' || fail "help must name the MCP sidecar"
printf '%s\n' "$help_out" | grep -q 'one-shot' || \
    fail "help must say the BearOS admin credential is one-shot"

if sh "$UPGRADE_SH" --nope >/dev/null 2>&1; then
    fail "unknown arguments should fail"
fi

dry_out="$(sh "$UPGRADE_SH" --dry-run)"
printf '%s\n' "$dry_out" | grep -q 'raw.githubusercontent.com/luoxiprovo/bearmail/main/stalwart$' || \
    fail "dry-run does not print the stalwart URL"
printf '%s\n' "$dry_out" | grep -q 'bearmail-webui.tar.gz' || \
    fail "dry-run does not print the WebUI archive URL"
printf '%s\n' "$dry_out" | grep -q "${REPO_ROOT}/update.sh" || \
    fail "dry-run from a checkout should use local update.sh"
printf '%s\n' "$dry_out" | grep -q "${REPO_ROOT}/mcp_install.sh" || \
    fail "dry-run from a checkout should use local mcp_install.sh"
printf '%s\n' "$dry_out" | grep -q 'Does not run install.sh' || \
    fail "dry-run must say it does not run install.sh"
printf '%s\n' "$dry_out" | grep -q 'config' || fail "dry-run must mention config is unchanged"
printf '%s\n' "$dry_out" | grep -q 'bearos-webui/webui.zip' || \
    fail "dry-run must refetch the BearOS admin UI"
printf '%s\n' "$dry_out" | grep -q 'temporary admin' || \
    fail "dry-run must say the temporary admin is removed"

override_out="$(BEARMAIL_DOWNLOAD_BASE=https://example.test/bearmail BEARMAIL_WORK_DIR=/tmp/bm-up \
    sh "$UPGRADE_SH" --dry-run)"
printf '%s\n' "$override_out" | grep -q 'https://example.test/bearmail/stalwart$' || \
    fail "BEARMAIL_DOWNLOAD_BASE is not honored"
printf '%s\n' "$override_out" | grep -q '/tmp/bm-up' || fail "BEARMAIL_WORK_DIR is not honored"

local_out="$(sh "$UPGRADE_SH" --dry-run --local)"
printf '%s\n' "$local_out" | grep -q "${REPO_ROOT}/stalwart$" || \
    fail "--local dry-run should use the checkout stalwart binary"
printf '%s\n' "$local_out" | grep -q "${REPO_ROOT}/bearmail-webui.tar.gz" || \
    fail "--local dry-run should use the checkout WebUI archive"

grep -q 'od -An -t x1 -j 18 -N 2' "$UPGRADE_SH" || \
    fail "x86-64 ELF check must read raw bytes (od -t x1), not host-endian x2"
grep -q 'UpdateApps' "$UPGRADE_SH" || \
    fail "upgrade.sh must ask Stalwart to refetch BearOS with UpdateApps"
grep -q 'bearmail-upgrade-admin.conf' "$UPGRADE_SH" || \
    fail "upgrade.sh must install the one-shot admin in a drop-in"
grep -q 'STALWART_RECOVERY_ADMIN=' "$UPGRADE_SH" || \
    fail "upgrade.sh must set STALWART_RECOVERY_ADMIN for the BearOS refresh"
if grep -q 'STALWART_RECOVERY_MODE=' "$UPGRADE_SH"; then
    fail "upgrade.sh must not put Stalwart into recovery mode"
fi
grep -q 'remove_refresh_admin_file' "$UPGRADE_SH" || \
    fail "upgrade.sh must remove the temporary admin drop-in"
grep -q 'BearOS admin UI' "${REPO_ROOT}/README.md" || \
    fail "README.md must document the BearOS refresh"
grep -q 'upgrade.sh' "${REPO_ROOT}/README.md" || \
    fail "README.md must document the in-place upgrade one-liner"

printf 'ok\n'
