#!/usr/bin/env sh

set -eu

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd "${SCRIPT_DIR}/../../.." && pwd)"
TEST_TMP_DIR="$(mktemp -d)"

cleanup_test() {
    if [ -n "${TEST_TMP_DIR:-}" ] && [ -d "$TEST_TMP_DIR" ]; then
        find "$TEST_TMP_DIR" -depth -delete
    fi
}
trap cleanup_test 0 HUP INT TERM

# Load the installer's functions without starting its interactive main flow.
sed '/^main "\$@"$/d' "${REPO_ROOT}/install.sh" > "${TEST_TMP_DIR}/install-functions.sh"
# shellcheck disable=SC1090
. "${TEST_TMP_DIR}/install-functions.sh"

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

unset BEARMAIL_NONINTERACTIVE_FILE || true
if noninteractive_active; then
    fail "noninteractive mode is active without an answer file"
fi
refuse_interactive_prompt

ANSWERS="${TEST_TMP_DIR}/answers.json"
umask 077
cat > "$ANSWERS" <<'EOF'
{"portal":"webmail.customer.com","mailHostname":"mail.customer.com","domain":"customer.com","smtpLogin":"login@smtp-brevo.com","smtpKey":"smtp-secret-$value"}
EOF
chmod 600 "$ANSWERS"
BEARMAIL_NONINTERACTIVE_FILE="$ANSWERS"
load_noninteractive_answers
[ "$NONINTERACTIVE_PORTAL" = "webmail.customer.com" ] || fail "portal was not loaded"
[ "$NONINTERACTIVE_MAIL_HOSTNAME" = "mail.customer.com" ] || fail "mail hostname was not loaded"
[ "$NONINTERACTIVE_DOMAIN" = "customer.com" ] || fail "domain was not loaded"
[ "$NONINTERACTIVE_SMTP_LOGIN" = "login@smtp-brevo.com" ] || fail "SMTP login was not loaded"
[ "$NONINTERACTIVE_SMTP_KEY" = 'smtp-secret-$value' ] || fail "SMTP key was not loaded verbatim"

expect_reject() {
    _label="$1"
    shift
    if "$@" >"${TEST_TMP_DIR}/out" 2>"${TEST_TMP_DIR}/err"; then
        fail "${_label} was accepted"
    fi
}

ln -s "$ANSWERS" "${TEST_TMP_DIR}/link.json"
expect_reject "symbolic link" \
    env BEARMAIL_NONINTERACTIVE_FILE="${TEST_TMP_DIR}/link.json" \
    sh -c '. "$1"; load_noninteractive_answers' sh "${TEST_TMP_DIR}/install-functions.sh"
grep -q "symbolic link" "${TEST_TMP_DIR}/err" || fail "symbolic link was not explained"

LOOSE="${TEST_TMP_DIR}/loose.json"
cp "$ANSWERS" "$LOOSE"
chmod 644 "$LOOSE"
expect_reject "mode 0644" \
    env BEARMAIL_NONINTERACTIVE_FILE="$LOOSE" \
    sh -c '. "$1"; load_noninteractive_answers' sh "${TEST_TMP_DIR}/install-functions.sh"
grep -q "mode 0600" "${TEST_TMP_DIR}/err" || fail "loose mode was not explained"

UNKNOWN="${TEST_TMP_DIR}/unknown.json"
umask 077
cat > "$UNKNOWN" <<'EOF'
{"portal":"webmail.customer.com","mailHostname":"mail.customer.com","domain":"customer.com","smtpLogin":"login@smtp-brevo.com","smtpKey":"smtp-secret","extra":"no"}
EOF
chmod 600 "$UNKNOWN"
expect_reject "unknown field" \
    env BEARMAIL_NONINTERACTIVE_FILE="$UNKNOWN" \
    sh -c '. "$1"; load_noninteractive_answers' sh "${TEST_TMP_DIR}/install-functions.sh"
grep -q "unexpected field set" "${TEST_TMP_DIR}/err" || fail "unknown field was not explained"

NEWLINE="${TEST_TMP_DIR}/newline.json"
umask 077
cat > "$NEWLINE" <<'EOF'
{"portal":"webmail.customer.com\n","mailHostname":"mail.customer.com","domain":"customer.com","smtpLogin":"login@smtp-brevo.com","smtpKey":"smtp-secret"}
EOF
chmod 600 "$NEWLINE"
expect_reject "newline" \
    env BEARMAIL_NONINTERACTIVE_FILE="$NEWLINE" \
    sh -c '. "$1"; load_noninteractive_answers' sh "${TEST_TMP_DIR}/install-functions.sh"
grep -q "invalid" "${TEST_TMP_DIR}/err" || fail "newline was not explained"

expect_reject "relative path" \
    env BEARMAIL_NONINTERACTIVE_FILE="answers.json" \
    sh -c '. "$1"; load_noninteractive_answers' sh "${TEST_TMP_DIR}/install-functions.sh"
grep -q "absolute path" "${TEST_TMP_DIR}/err" || fail "relative path was not explained"

prompt_menu() {
    printf 'MENU\n' >&2
    exit 9
}
if ! BEARMAIL_NONINTERACTIVE_FILE="$ANSWERS" publish_optional_dns a b c d \
    >"${TEST_TMP_DIR}/pub" 2>"${TEST_TMP_DIR}/puberr"
then
    fail "noninteractive DNS handoff failed"
fi
if grep -q MENU "${TEST_TMP_DIR}/puberr"; then
    fail "noninteractive DNS called the provider menu"
fi
grep -q "left for bearmail-install" "${TEST_TMP_DIR}/pub" || fail "DNS handoff was not announced"
[ "$RETVAL" = "false" ] || fail "noninteractive DNS did not leave publication to bearmail-install"

unset BEARMAIL_NONINTERACTIVE_FILE || true
_easy_mode=true
MENU_CALLED=0
prompt_menu() {
    MENU_CALLED=$((MENU_CALLED + 1))
    RETVAL=4
}
prompt_yes_no() {
    fail "easy mode asked whether DNS was already published"
}
publish_optional_dns a b c d >/dev/null
[ "$MENU_CALLED" -eq 1 ] || fail "interactive easy mode skipped the DNS menu"
[ "$RETVAL" = "false" ] || fail "publishing by hand did not leave DNS unchanged"

if env BEARMAIL_NONINTERACTIVE_FILE="$ANSWERS" sh -c '
. "$1"
_webui_hostname="webmail.example.com"
_webui_origin="https://webmail.example.com"
_easy_mode=true
prompt_https_origin() {
    printf "PROMPTED\n" >&2
    exit 7
}
confirm_dedicated_webui_origin caddy mail.example.com example.com
' sh "${TEST_TMP_DIR}/install-functions.sh" \
    >"${TEST_TMP_DIR}/example-out" 2>"${TEST_TMP_DIR}/example-err"
then
    fail "an example webmail hostname was accepted"
fi
if grep -q PROMPTED "${TEST_TMP_DIR}/example-err"; then
    fail "an example webmail hostname was re-prompted"
fi
grep -q "installer example" "${TEST_TMP_DIR}/example-err" || fail "the example hostname was not rejected"

printf 'PASS: noninteractive install answers come from the file\n'
