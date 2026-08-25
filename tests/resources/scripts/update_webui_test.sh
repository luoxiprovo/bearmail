#!/usr/bin/env sh

set -eu

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd "${SCRIPT_DIR}/../../.." && pwd)"
UPDATE_SH="${REPO_ROOT}/update.sh"
TEST_TMP_DIR="$(mktemp -d)"

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

cleanup_test() {
    if [ -n "${TEST_TMP_DIR:-}" ] && [ -d "$TEST_TMP_DIR" ]; then
        rm -rf "$TEST_TMP_DIR"
    fi
}
trap cleanup_test 0 HUP INT TERM

[ -f "$UPDATE_SH" ] || fail "update.sh is missing"
sh -n "$UPDATE_SH" || fail "update.sh is not valid POSIX sh"

help_out="$(sh "$UPDATE_SH" --help)"
printf '%s\n' "$help_out" | grep -q 'stalwart-webui.tar.gz' || \
    fail "help does not mention the WebUI archive"
printf '%s\n' "$help_out" | grep -q 'Stalwart, Caddy, DNS' || \
    fail "help does not say Stalwart and Caddy are left unchanged"
printf '%s\n' "$help_out" | grep -q -- '--dry-run' || \
    fail "help does not document --dry-run"

if sh "$UPDATE_SH" --archive "${TEST_TMP_DIR}/missing.tar.gz" >/dev/null 2>&1; then
    fail "missing archive should fail"
fi

prefix="${TEST_TMP_DIR}/opt/stalwart-webui"
mkdir -p "${prefix}/dist"
printf '%s\n' '{"appName":"BearMail","defaultServerUrl":"https://email.example.test","allowCustomServers":false,"allowBasicAuth":true,"allowOAuth":true,"pollIntervalSeconds":30}' \
    > "${prefix}/dist/config.json"
printf '%s\n' 'existing-server' > "${prefix}/server.mjs"

node_bin="$(command -v node || true)"
[ -n "$node_bin" ] || fail "node is required for the updater test"

unit_file="${TEST_TMP_DIR}/stalwart-webui.service"
cat > "$unit_file" <<EOF
[Service]
User=stalwart-webui
WorkingDirectory=${prefix}
Environment=WEBUI_ROOT=${prefix}/dist
Environment=WEBUI_HOST=127.0.0.1
Environment=WEBUI_PORT=8081
ExecStart=${node_bin} ${prefix}/server.mjs
EOF

stage="${TEST_TMP_DIR}/archive-src"
mkdir -p "${stage}/dist"
printf '%s\n' 'STALWART_WEBUI_ARCHIVE_VERSION=2' > "${stage}/install.sh"
printf '%s\n' 'new-server' > "${stage}/server.mjs"
printf '%s\n' '[Service]' > "${stage}/stalwart-webui.service"
printf '%s\n' '<html></html>' > "${stage}/dist/index.html"
printf '%s\n' '{"appName":"BearMail","defaultServerUrl":""}' > "${stage}/dist/config.json"
archive="${TEST_TMP_DIR}/stalwart-webui.tar.gz"
tar -czf "$archive" -C "$stage" install.sh server.mjs stalwart-webui.service dist

dry_out="$(
    BEARMAIL_WEBUI_UNIT_FILE="$unit_file" \
    BEARMAIL_WEBUI_UNIT="stalwart-webui.service" \
    sh "$UPDATE_SH" --archive "$archive" --dry-run
)"
printf '%s\n' "$dry_out" | grep -Fq "${prefix}" || fail "dry-run does not print the installed prefix"
printf '%s\n' "$dry_out" | grep -Fq '127.0.0.1:8081' || fail "dry-run does not print the live port"
printf '%s\n' "$dry_out" | grep -Fq 'https://email.example.test' || fail "dry-run does not preserve the mail-server URL"
printf '%s\n' "$dry_out" | grep -Fq 'Leaves unchanged' || fail "dry-run does not say Stalwart is left unchanged"
printf '%s\n' "$dry_out" | grep -Fq 'archive is valid' || fail "dry-run does not validate the archive"
[ "$(cat "${prefix}/server.mjs")" = "existing-server" ] || fail "dry-run changed installed files"

printf 'ok\n'
