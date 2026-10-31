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
grep -q 'Permanent administrator credential' "$EASY_SH" || \
    fail "easy install does not repeat the administrator credential"
grep -q 'BearMail portal for normal users' "$EASY_SH" || \
    fail "easy install does not repeat the portal URL"
grep -q 'BEARMAIL_REMINDER_FILE' "$EASY_SH" || \
    fail "easy install does not pass a reminder file to install.sh"
printf '%s\n' "$dry_out" | grep -q 'permanent administrator credential again' || \
    fail "dry-run does not say the administrator credential is printed again"

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

reminder="${TEST_TMP_DIR}/.bearmail-reminder"
BEARMAIL_REMINDER_FILE="$reminder" \
    write_finish_reminder "admin" "secret with spaces" "https://bearmail.example.com" "https://mail.example.com/admin/"
[ "$(sed -n '1p' "$reminder")" = "admin" ] || fail "reminder username was not saved"
[ "$(sed -n '2p' "$reminder")" = "secret with spaces" ] || fail "reminder password was not saved"
[ "$(sed -n '3p' "$reminder")" = "https://bearmail.example.com" ] || fail "reminder portal was not saved"
[ "$(sed -n '4p' "$reminder")" = "https://mail.example.com/admin/" ] || fail "reminder admin URL was not saved"
[ "$(stat -c '%a' "$reminder")" = "600" ] || fail "reminder file is not mode 600"
rm -f "$reminder"
write_finish_reminder "admin" "secret" "https://bearmail.example.com" "https://mail.example.com/admin/"
[ ! -e "$reminder" ] || fail "reminder file was written without BEARMAIL_REMINDER_FILE"
ln -s "${TEST_TMP_DIR}/elsewhere" "$reminder"
printf '%s\n' 'keep' > "${TEST_TMP_DIR}/elsewhere"
BEARMAIL_REMINDER_FILE="$reminder" \
    write_finish_reminder "admin" "secret" "https://bearmail.example.com" "https://mail.example.com/admin/"
[ "$(cat "${TEST_TMP_DIR}/elsewhere")" = "keep" ] || fail "reminder write followed a symbolic link"
rm -f "$reminder"

BEARMAIL_REMINDER_FILE="$reminder" \
    write_finish_reminder "admin" "secret" "https://bearmail.example.com" "https://mail.example.com/admin/"
printer="${TEST_TMP_DIR}/printer.sh"
{
    printf '%s\n' 'say() { printf "%s\n" "$1"; }'
    awk '/^show_finish_reminder\(\)/ { capture=1 } capture { print } capture && /^}$/ { exit }' "$EASY_SH"
    printf '%s\n' 'BEARMAIL_REMINDER_FILE=$1; _reminder_shown=false; show_finish_reminder'
} > "$printer"
reminder_out="$(sh "$printer" "$reminder")"
printf '%s\n' "$reminder_out" | grep -q 'BearMail portal for normal users: https://bearmail.example.com/' || \
    fail "finish reminder did not print the portal URL"
printf '%s\n' "$reminder_out" | grep -q 'Permanent administrator credential' || \
    fail "finish reminder did not print the administrator heading"
printf '%s\n' "$reminder_out" | grep -q 'Username: admin' || fail "finish reminder did not print the username"
printf '%s\n' "$reminder_out" | grep -q 'Password: secret' || fail "finish reminder did not print the password"
printf '%s\n' "$reminder_out" | grep -q 'https://mail.example.com/admin/' || \
    fail "finish reminder did not print the admin sign-in URL"
[ ! -e "$reminder" ] || fail "finish reminder left the credential file in place"
sh "$printer" "$reminder" >/dev/null
[ -z "$(sh "$printer" "$reminder")" ] || fail "a second reminder printed credentials without a file"

printf 'ok\n'
