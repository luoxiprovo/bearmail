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

CADDY_FILE="${TEST_TMP_DIR}/Caddyfile"
SYNC_SCRIPT="${TEST_TMP_DIR}/stalwart-caddy-cert-sync"
DROPIN="${TEST_TMP_DIR}/stalwart.service.d/10-public-url.conf"
RUNNING_BINARY="${TEST_TMP_DIR}/stalwart"

write_caddy_configuration_file \
    "$CADDY_FILE" "mail.example.test" "example.test" "webmail.example.test" "8081"
grep -F -q "$CADDY_MANAGED_MARKER" "$CADDY_FILE" ||
    fail "generated Caddyfile is not marked as installer-managed"
grep -q '^mail\.example\.test,.*autoconfig\.example\.test' "$CADDY_FILE" ||
    fail "Stalwart and protocol-discovery hostnames are not routed"
grep -q 'reverse_proxy 127\.0\.0\.1:8080' "$CADDY_FILE" ||
    fail "Stalwart is not routed to its localhost HTTP listener"
grep -q '^webmail\.example\.test {' "$CADDY_FILE" ||
    fail "WebUI hostname has no separate Caddy site"
grep -q 'reverse_proxy 127\.0\.0\.1:8081' "$CADDY_FILE" ||
    fail "WebUI is not routed to its localhost service"

write_caddy_certificate_sync_script \
    "$SYNC_SCRIPT" "mail.example.test" \
    "/etc/stalwart/proxy-certs/caddy-mail.pem" \
    "/etc/stalwart/proxy-certs/caddy-mail.key" "stalwart"
dash -n "$SYNC_SCRIPT" || fail "generated certificate synchronization script is invalid"
grep -q 'openssl x509.*-checkhost' "$SYNC_SCRIPT" ||
    fail "certificate synchronization does not verify the mail hostname"
grep -q 'systemctl restart stalwart\.service' "$SYNC_SCRIPT" ||
    fail "certificate synchronization does not reload Stalwart"

install_stalwart_public_url_dropin "$DROPIN" "mail.example.test"
grep -q 'STALWART_PUBLIC_URL=https://mail\.example\.test' "$DROPIN" ||
    fail "Stalwart public URL is not pinned to the proxied hostname"

webui_hostname_conflicts "caddy" "mail.example.test" "example.test" \
    "autodiscover.example.test" || fail "Caddy hostname collision was not detected"
if webui_hostname_conflicts "caddy" "mail.example.test" "example.test" \
    "webmail.example.test"
then
    fail "dedicated WebUI hostname was rejected"
fi

CADDY_CONFIG_FILE="${TEST_TMP_DIR}/existing-Caddyfile"
printf '%s\n' 'example.test { respond "existing" }' > "$CADDY_CONFIG_FILE"
if (validate_caddy_config_ownership >/dev/null 2>&1); then
    fail "an operator-owned Caddyfile would be overwritten"
fi

FAKE_BIN="${TEST_TMP_DIR}/fake-bin"
mkdir "$FAKE_BIN"
cat > "${FAKE_BIN}/dpkg-query" <<'EOF'
#!/usr/bin/env sh
printf ' /etc/caddy/Caddyfile %s\n' "$FAKE_CADDY_MD5"
EOF
chmod +x "${FAKE_BIN}/dpkg-query"
FAKE_CADDY_MD5="$(md5sum "$CADDY_CONFIG_FILE" | sed 's/[[:space:]].*$//')"
if ! PATH="${FAKE_BIN}:${PATH}" FAKE_CADDY_MD5="$FAKE_CADDY_MD5" \
    is_pristine_packaged_caddyfile "$CADDY_CONFIG_FILE"
then
    fail "a checksum-verified package Caddyfile was not accepted for interrupted-install recovery"
fi
printf '%s\n' '# operator edit' >> "$CADDY_CONFIG_FILE"
if PATH="${FAKE_BIN}:${PATH}" FAKE_CADDY_MD5="$FAKE_CADDY_MD5" \
    is_pristine_packaged_caddyfile "$CADDY_CONFIG_FILE"
then
    fail "an edited package Caddyfile was treated as pristine"
fi

printf '%s\n' "$CADDY_MANAGED_MARKER" > "$CADDY_CONFIG_FILE"
validate_caddy_config_ownership

grep -q '"127.0.0.1:8080": true' "${REPO_ROOT}/install.sh" ||
    fail "automatic mode does not restrict Stalwart HTTP to loopback"
grep -q '"127.0.0.1:8443": true' "${REPO_ROOT}/install.sh" ||
    fail "automatic mode does not move Stalwart HTTPS off public port 443"
grep -q 'useXForwarded: true' "${REPO_ROOT}/install.sh" ||
    fail "automatic mode does not enable forwarded-header handling"

# A reinstall replaces a currently running native executable. Copying directly
# would fail with ETXTBSY on Linux; staging plus rename must keep the old process
# alive while making the new executable available for the next restart.
cp "$(command -v sleep)" "$RUNNING_BINARY"
"$RUNNING_BINARY" 1 &
RUNNING_PID=$!
TRUE_BINARY="/bin/true"
[ -x "$TRUE_BINARY" ] || TRUE_BINARY="/usr/bin/true"
install_executable_atomically "$TRUE_BINARY" "$RUNNING_BINARY"
"$RUNNING_BINARY" || fail "atomically installed executable is unusable"
wait "$RUNNING_PID" || fail "running executable was disrupted during replacement"

printf 'PASS: installer renders isolated Caddy routes and certificate synchronization\n'
