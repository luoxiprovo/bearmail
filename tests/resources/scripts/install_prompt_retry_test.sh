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

exec 3>"${TEST_TMP_DIR}/prompt-output"

PROMPT_ATTEMPTS=0
prompt_text() {
    PROMPT_ATTEMPTS=$((PROMPT_ATTEMPTS + 1))
    if [ "$PROMPT_ATTEMPTS" -eq 1 ]; then
        RETVAL="webmail.valuerouter.com"
    else
        RETVAL="https://webmail.valuerouter.com"
    fi
}

prompt_https_origin \
    "Public WebUI origin (exact HTTPS URL, no path)" \
    "https://webmail.example.com"

[ "$PROMPT_ATTEMPTS" -eq 2 ] || fail "invalid WebUI origin was not re-prompted"
[ "$RETVAL" = "https://webmail.valuerouter.com" ] || fail "valid WebUI origin was not returned"
grep -q "must use HTTPS" "${TEST_TMP_DIR}/prompt-output" || \
    fail "the retry did not explain the required HTTPS format"

PREFIX_ATTEMPTS=0
prompt_text() {
    PREFIX_ATTEMPTS=$((PREFIX_ATTEMPTS + 1))
    if [ "$PREFIX_ATTEMPTS" -eq 1 ]; then
        RETVAL="relative/webui"
    else
        RETVAL="/srv/stalwart-webui/"
    fi
}

prompt_absolute_prefix \
    "WebUI installation prefix" \
    "/opt/stalwart-webui" \
    "WebUI installation prefix"

[ "$PREFIX_ATTEMPTS" -eq 2 ] || fail "invalid installation prefix was not re-prompted"
[ "$RETVAL" = "/srv/stalwart-webui" ] || fail "valid installation prefix was not normalized"
grep -q "must be an absolute path" "${TEST_TMP_DIR}/prompt-output" || \
    fail "the prefix retry did not explain the required absolute path"

PORT_ATTEMPTS=0
prompt_port() {
    PORT_ATTEMPTS=$((PORT_ATTEMPTS + 1))
    if [ "$PORT_ATTEMPTS" -eq 1 ]; then
        RETVAL="8080"
    else
        RETVAL="8081"
    fi
}

prompt_webui_port "WebUI local service port" "8081"

[ "$PORT_ATTEMPTS" -eq 2 ] || fail "reserved WebUI port was not re-prompted"
[ "$RETVAL" = "8081" ] || fail "valid WebUI port was not returned"
grep -q "Port 8080 is reserved" "${TEST_TMP_DIR}/prompt-output" || \
    fail "the port retry did not explain the reserved port"

MAILJET_PORT_ATTEMPTS=0
prompt_port() {
    MAILJET_PORT_ATTEMPTS=$((MAILJET_PORT_ATTEMPTS + 1))
    if [ "$MAILJET_PORT_ATTEMPTS" -eq 1 ]; then
        RETVAL="25"
    else
        RETVAL="587"
    fi
}

prompt_mailjet_port "Mailjet SMTP port" "587"

[ "$MAILJET_PORT_ATTEMPTS" -eq 2 ] || fail "blocked Mailjet port 25 was not re-prompted"
[ "$RETVAL" = "587" ] || fail "valid Mailjet port was not returned"
grep -q "Enter 587" "${TEST_TMP_DIR}/prompt-output" || \
    fail "the Mailjet port retry did not explain the accepted ports"

FAKE_NODE="${TEST_TMP_DIR}/fake-node"
printf '#!/bin/sh\nexit "${FAKE_NODE_STATUS:-0}"\n' > "$FAKE_NODE"
chmod +x "$FAKE_NODE"
NODE_BIN="$FAKE_NODE"

FAKE_NODE_STATUS=2
export FAKE_NODE_STATUS
status=0
configure_stalwart_cors "https://webmail.example.com" "admin" "wrong" || status=$?
[ "$status" -eq 2 ] || fail "CORS authentication failure did not return 2"

status=0
configure_stalwart_caddy_proxy "example.com" "/tmp/cert" "/tmp/key" "admin" "wrong" || status=$?
[ "$status" -eq 2 ] || fail "Caddy proxy authentication failure did not return 2"

status=0
configure_stalwart_mailjet_relay "admin" "wrong" "key" "secret" "in-v3.mailjet.com" "587" || status=$?
[ "$status" -eq 2 ] || fail "Mailjet JMAP authentication failure did not return 2"

FAKE_NODE_STATUS=1
status=0
configure_stalwart_cors "https://webmail.example.com" "admin" "secret" || status=$?
[ "$status" -eq 1 ] || fail "non-auth CORS failure did not return 1"

FAKE_NODE_STATUS=0
configure_stalwart_cors "https://webmail.example.com" "admin" "secret" || \
    fail "successful CORS configuration returned non-zero"
configure_stalwart_mailjet_relay "admin" "secret" "key" "secret" "in-v3.mailjet.com" "587" || \
    fail "successful Mailjet configuration returned non-zero"

MAILJET_RELAY_ATTEMPTS=0
configure_stalwart_mailjet_relay() {
    MAILJET_RELAY_ATTEMPTS=$((MAILJET_RELAY_ATTEMPTS + 1))
    if [ "$MAILJET_RELAY_ATTEMPTS" -eq 1 ]; then
        return 2
    fi
    return 0
}
prompt_yes_no() { return 0; }
prompt_dns_name() { RETVAL="in-v3.mailjet.com"; }
prompt_mailjet_port() { RETVAL="587"; }
prompt_text() { RETVAL="apikey"; }
prompt_secret() { RETVAL="secret"; }
prompt_admin_credentials() {
    ADMIN_USERNAME_RETVAL="admin"
    ADMIN_SECRET_RETVAL="correct-password"
}

configure_optional_mailjet_relay "admin" "wrong-password" "example.com"
[ "$MAILJET_RELAY_ATTEMPTS" -eq 2 ] || fail "Mailjet auth failure did not retry after new administrator credentials"
[ "$RETVAL" = "true" ] || fail "Mailjet relay was not marked configured after a successful retry"
grep -q "rejected those administrator credentials" "${TEST_TMP_DIR}/prompt-output" || \
    fail "Mailjet auth retry did not explain the rejected credentials"

looks_like_public_mail_hostname "mail.example.com" || \
    fail "mail.example.com was not accepted as a public mail hostname"
if looks_like_public_mail_hostname "hermes.us-west3-b.c.valuerouter-439417.internal"
then
    fail "a GCP internal hostname was accepted as a public mail hostname"
fi
if looks_like_public_mail_hostname "localhost"
then
    fail "localhost was accepted as a public mail hostname"
fi
identity_help="$(print_server_identity_help)"
printf '%s\n' "$identity_help" | grep -q 'mail.example.com' || \
    fail "identity help does not give a public hostname example"
printf '%s\n' "$identity_help" | grep -q 'example.com' || \
    fail "identity help does not give a mail domain example"
printf '%s\n' "$identity_help" | grep -q '.internal' || \
    fail "identity help does not warn against .internal hostnames"
printf '%s\n' "$identity_help" | grep -q 'webmail.example.com' || \
    fail "identity help does not mention the typical WebUI hostname"

is_example_webui_placeholder "webmail.example.com" || \
    fail "webmail.example.com was not treated as an installer placeholder"
if is_example_webui_placeholder "webmail.microdetect.xyz"
then
    fail "a real WebUI hostname was treated as an installer placeholder"
fi
suggested_webui_origin "microdetect.xyz"
[ "$RETVAL" = "https://webmail.microdetect.xyz" ] || \
    fail "suggested WebUI origin was not derived from the mail domain"

_webui_origin="https://webmail.example.com"
_webui_hostname="webmail.example.com"
WEBUI_CONFIRM_PROMPTS=0
prompt_https_origin() {
    WEBUI_CONFIRM_PROMPTS=$((WEBUI_CONFIRM_PROMPTS + 1))
    RETVAL="$2"
}
confirm_dedicated_webui_origin "caddy" "email.microdetect.xyz" "microdetect.xyz"
[ "$WEBUI_CONFIRM_PROMPTS" -eq 1 ] || fail "placeholder WebUI origin was not re-prompted after mail domain"
[ "$_webui_origin" = "https://webmail.microdetect.xyz" ] || \
    fail "placeholder WebUI origin was not replaced with webmail.<mail-domain>"
[ "$_webui_hostname" = "webmail.microdetect.xyz" ] || \
    fail "placeholder WebUI hostname was not replaced with webmail.<mail-domain>"
grep -q "installer example" "${TEST_TMP_DIR}/prompt-output" || \
    fail "placeholder WebUI retry did not explain that the origin is still an example"

_webui_origin="https://webmail.microdetect.xyz"
_webui_hostname="webmail.microdetect.xyz"
WEBUI_CONFIRM_PROMPTS=0
confirm_dedicated_webui_origin "caddy" "email.microdetect.xyz" "microdetect.xyz"
[ "$WEBUI_CONFIRM_PROMPTS" -eq 0 ] || fail "a dedicated WebUI origin was re-prompted unnecessarily"

printf 'PASS: invalid installer answers are explained and re-prompted\n'
