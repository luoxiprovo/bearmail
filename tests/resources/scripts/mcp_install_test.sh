#!/usr/bin/env sh

set -eu

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd "${SCRIPT_DIR}/../../.." && pwd)"
MCP_INSTALL_SH="${REPO_ROOT}/mcp_install.sh"

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

[ -f "$MCP_INSTALL_SH" ] || fail "mcp_install.sh is missing"
sh -n "$MCP_INSTALL_SH" || fail "mcp_install.sh is not valid POSIX sh"

help_out="$(sh "$MCP_INSTALL_SH" --help)"
printf '%s\n' "$help_out" | grep -q 'sudo bash' || fail "help does not show the curl | sudo bash invocation"
printf '%s\n' "$help_out" | grep -q 'raw.githubusercontent.com/luoxiprovo/bearmail/main/mcp_install.sh' || \
    fail "help does not show the curl one-liner"
printf '%s\n' "$help_out" | grep -q -- '--dry-run' || fail "help does not document --dry-run"
printf '%s\n' "$help_out" | grep -q 'mailbox passwords' || \
    fail "help must say it does not accept mailbox credentials"

if sh "$MCP_INSTALL_SH" --nope >/dev/null 2>&1; then
    fail "unknown arguments should fail"
fi

if grep -q 'mcp_src="$(fetch_mcp_sources)"' "$MCP_INSTALL_SH"; then
    fail "fetch_mcp_sources must not be captured from stdout (progress text would become the path)"
fi
grep -q 'mcp_src="$RETVAL"' "$MCP_INSTALL_SH" || fail "MCP source path must come from RETVAL"

dry_out="$(sh "$MCP_INSTALL_SH" --dry-run 2>&1)"
printf '%s\n' "$dry_out" | grep -q 'mcp/install.sh\|bearmail-mcp' || \
    fail "dry-run does not mention the MCP sidecar"
printf '%s\n' "$dry_out" | grep -q '/opt/bearmail-mcp' || fail "dry-run does not print the install prefix"
printf '%s\n' "$dry_out" | grep -q 'Does not change Stalwart' || \
    fail "dry-run must say it does not change Stalwart"
printf '%s\n' "$dry_out" | grep -q "${REPO_ROOT}/mcp" || \
    fail "dry-run from a checkout should use local mcp/"

nosys_out="$(sh "$MCP_INSTALL_SH" --dry-run --no-systemd 2>&1)"
printf '%s\n' "$nosys_out" | grep -q 'Skip systemd' || fail "--no-systemd dry-run should skip the unit"

override_out="$(BEARMAIL_ARCHIVE_URL=https://example.test/bearmail.tgz BEARMAIL_WORK_DIR=/tmp/bm-mcp \
    sh "$MCP_INSTALL_SH" --dry-run 2>&1)"
# Local checkout still wins over the archive URL.
printf '%s\n' "$override_out" | grep -q "${REPO_ROOT}/mcp" || \
    fail "local mcp/ should be preferred over BEARMAIL_ARCHIVE_URL in a checkout"

grep -q 'legacy-peer-deps=true' "${REPO_ROOT}/mcp/install.sh" || \
    fail "mcp/install.sh must pass --legacy-peer-deps so npm ci matches the published lockfile"
grep -q 'legacy-peer-deps=true' "$MCP_INSTALL_SH" || \
    fail "mcp_install.sh must inject .npmrc for GitHub tarballs that omit it"
grep -q 'mcp_install.sh' "${REPO_ROOT}/README.md" || \
    fail "README.md must document the MCP upgrade one-liner"

printf 'ok\n'
