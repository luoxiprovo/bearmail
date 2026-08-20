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

NODE_BIN="$(command -v node)"
STATE_FILE="${TEST_TMP_DIR}/installer-state.json"
OUTPUT_FILE="${TEST_TMP_DIR}/dns-output"

printf '%s\n' '{
  "serverHostname": "mail.example.test",
  "defaultDomain": "example.test",
  "publicIpv4": "192.0.2.4",
  "publicIpv6": null,
  "dnsRecords": [
    {
      "recordType": "A",
      "host": "mail.example.test",
      "answer": "192.0.2.4",
      "ttl": 3600,
      "priority": null
    },
    {
      "recordType": "PTR",
      "host": "4.2.0.192.in-addr.arpa",
      "answer": "mail.example.test",
      "ttl": 3600,
      "priority": null
    },
    {
      "recordType": "MX",
      "host": "example.test",
      "answer": "mail.example.test",
      "ttl": 3600,
      "priority": 10
    }
  ]
}' > "$STATE_FILE"

print_combined_dns_table "$STATE_FILE" "webmail.example.test" > "$OUTPUT_FILE"

grep -q '^A .*mail\.example\.test.*192\.0\.2\.4' "$OUTPUT_FILE" ||
    fail "mail A record is missing from the domain DNS table"
grep -q '^A .*webmail\.example\.test.*192\.0\.2\.4' "$OUTPUT_FILE" ||
    fail "WebUI A record is missing from the domain DNS table"
grep -q '^MX .*example\.test.*mail\.example\.test.*10' "$OUTPUT_FILE" ||
    fail "MX record is missing from the domain DNS table"

if grep -q '^PTR ' "$OUTPUT_FILE"; then
    fail "PTR was presented as a record to add to the domain DNS zone"
fi
if grep -q 'in-addr\.arpa' "$OUTPUT_FILE"; then
    fail "reverse-zone owner leaked into the domain DNS table"
fi

grep -q '^Reverse DNS guidance' "$OUTPUT_FILE" ||
    fail "reverse DNS guidance section is missing"
grep -q '192\.0\.2\.4 -> mail\.example\.test' "$OUTPUT_FILE" ||
    fail "reverse DNS guidance does not map the public IP to the mail hostname"
grep -q 'not required to open the Stalwart admin or WebUI URLs' "$OUTPUT_FILE" ||
    fail "reverse DNS guidance does not distinguish access from deliverability"
grep -qi 'automatic DNS management' "$OUTPUT_FILE" ||
    fail "automatic DNS guidance is missing"

SETUP_FILE="${TEST_TMP_DIR}/setup-result.json"
cp "$STATE_FILE" "$SETUP_FILE"
PERSISTED_STATE="${TEST_TMP_DIR}/persisted-state.json"
write_installer_state \
    "$SETUP_FILE" "$PERSISTED_STATE" "mail.example.test" "example.test" \
    "192.0.2.4" "" "https://webmail.example.test" "webmail.example.test" "caddy"
grep -q '"webuiHostname": "webmail.example.test"' "$PERSISTED_STATE" ||
    fail "installer state did not store the WebUI hostname"
grep -q '"host": "webmail.example.test"' "$PERSISTED_STATE" ||
    fail "installer state did not persist the WebUI A record"
grep -q '"answer": "192.0.2.4"' "$PERSISTED_STATE" ||
    fail "installer state did not persist the public IPv4 on DNS rows"

printf 'PASS: installer separates forward-zone records from reverse DNS guidance\n'
