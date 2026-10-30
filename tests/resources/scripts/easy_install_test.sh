#!/usr/bin/env sh

set -eu

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd "${SCRIPT_DIR}/../../.." && pwd)"
EASY_SH="${REPO_ROOT}/easy_install.sh"
INSTALL_SH="${REPO_ROOT}/install.sh"

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

[ -f "$EASY_SH" ] || fail "easy_install.sh is missing"
sh -n "$EASY_SH" || fail "easy_install.sh is not valid POSIX sh"
sh -n "$INSTALL_SH" || fail "install.sh is not valid POSIX sh"

help_out="$(sh "$EASY_SH" --help)"
printf '%s\n' "$help_out" | grep -q 'sudo bash' || fail "help does not show the curl | sudo bash invocation"
printf '%s\n' "$help_out" | grep -q 'mcp_install.sh' || fail "help does not keep the standalone MCP installer"
printf '%s\n' "$help_out" | grep -q 'release_install.sh' || fail "help does not keep the full installer"

dry_out="$(sh "$EASY_SH" --dry-run)"
printf '%s\n' "$dry_out" | grep -q 'raw.githubusercontent.com/luoxiprovo/bearmail/main/install.sh' || \
    fail "dry-run does not print the install.sh URL"
printf '%s\n' "$dry_out" | grep -q '/stalwart$' || fail "dry-run does not print the stalwart URL"
printf '%s\n' "$dry_out" | grep -q 'bearmail-webui.tar.gz' || \
    fail "dry-run does not download the published WebUI archive"
printf '%s\n' "$dry_out" | grep -q '/var/tmp/bearmail-install/bearmail-webui.tar.gz' || \
    fail "dry-run does not save the archive as bearmail-webui.tar.gz"
printf '%s\n' "$dry_out" | grep -q 'BEARMAIL_EASY=1 sh /var/tmp/bearmail-install/install.sh' || \
    fail "dry-run does not run install.sh in easy mode"
printf '%s\n' "$dry_out" | grep -q '/var/tmp/bearmail-install/mcp_install.sh' || \
    fail "dry-run does not run mcp_install.sh"

override_out="$(BEARMAIL_DOWNLOAD_BASE=https://example.test/bearmail BEARMAIL_WORK_DIR=/tmp/bm sh "$EASY_SH" --dry-run)"
printf '%s\n' "$override_out" | grep -q 'https://example.test/bearmail/bearmail-webui.tar.gz' || \
    fail "BEARMAIL_DOWNLOAD_BASE is not honored"
printf '%s\n' "$override_out" | grep -q '/tmp/bm/bearmail-webui.tar.gz' || \
    fail "BEARMAIL_WORK_DIR is not applied to the renamed archive"

if sh "$EASY_SH" --nope >/dev/null 2>&1; then
    fail "unknown arguments should fail"
fi

grep -q 'Brevo SMTP API key' "$INSTALL_SH" || fail "easy install does not rename the Brevo secret prompt"
grep -q '/opt/bearmail-webui' "$INSTALL_SH" || fail "easy install does not use the BearMail WebUI prefix"
grep -q 'Public mail hostname (This will be your admin portal)' "$INSTALL_SH" || \
    fail "easy install does not rename the mail hostname prompt"

TEST_TMP_DIR="$(mktemp -d)"
cleanup_test() {
    if [ -n "${TEST_TMP_DIR:-}" ] && [ -d "$TEST_TMP_DIR" ]; then
        find "$TEST_TMP_DIR" -depth -delete
    fi
}
trap cleanup_test 0 HUP INT TERM
sed '/^main "\$@"$/d' "$INSTALL_SH" > "${TEST_TMP_DIR}/install-functions.sh"
# shellcheck disable=SC1090
. "${TEST_TMP_DIR}/install-functions.sh"

normalize_easy_portal "bearmail.example.com"
[ "$RETVAL" = "https://bearmail.example.com" ] || fail "bare portal domain was ${RETVAL}"
normalize_easy_portal "http://Bearmail.Example.com/"
[ "$RETVAL" = "https://bearmail.example.com" ] || fail "http portal was ${RETVAL}"
normalize_easy_portal "https://bearmail.example.com"
[ "$RETVAL" = "https://bearmail.example.com" ] || fail "https portal was ${RETVAL}"

_easy_mode="true"
easy_dns_zone_default "bearos.si" "users.bearos.si"
[ "$RETVAL" = "bearos.si" ] || fail "portal parent zone was ${RETVAL}"
easy_dns_zone_default "bearmail.example.com" "example.com"
[ "$RETVAL" = "example.com" ] || fail "bearmail portal zone was ${RETVAL}"
easy_dns_zone_default "mail.example.com" "example.com"
[ "$RETVAL" = "example.com" ] || fail "mail portal zone was ${RETVAL}"
_easy_mode="false"
easy_dns_zone_default "bearos.si" "users.bearos.si"
[ "$RETVAL" = "users.bearos.si" ] || fail "full installer zone default changed to ${RETVAL}"

printf 'ok\n'
