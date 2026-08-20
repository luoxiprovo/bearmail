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
PLAN_FILE="${TEST_TMP_DIR}/plan.json"

printf '%s\n' '{
  "serverHostname": "mail.example.test",
  "defaultDomain": "example.test",
  "publicIpv4": "192.0.2.4",
  "publicIpv6": "2001:db8::4",
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
    },
    {
      "recordType": "TXT",
      "host": "example.test",
      "answer": "v=spf1 mx -all",
      "ttl": 3600,
      "priority": null
    },
    {
      "recordType": "TXT",
      "host": "mail.example.test",
      "answer": "v=spf1 a -all",
      "ttl": 3600,
      "priority": null
    },
    {
      "recordType": "A",
      "host": "mail.other.test",
      "answer": "192.0.2.9",
      "ttl": 3600,
      "priority": null
    },
    {
      "recordType": "CAA",
      "host": "example.test",
      "answer": "0 issue letsencrypt.org",
      "ttl": 3600,
      "priority": null
    },
    {
      "recordType": "SRV",
      "host": "_imaps._tcp.example.test",
      "answer": "0 993 mail.example.test",
      "ttl": 3600,
      "priority": 0
    }
  ]
}' > "$STATE_FILE"

build_namecom_dns_plan "$STATE_FILE" "webmail.example.test" "example.test" "true" > "$PLAN_FILE"

PLAN_FILE="$PLAN_FILE" "$NODE_BIN" -e '
  const fs = require("node:fs");
  const plan = JSON.parse(fs.readFileSync(process.env.PLAN_FILE, "utf8"));
  const fail = (message) => { console.error(`FAIL: ${message}`); process.exit(1); };
  const find = (type, host) => plan.plan.find((row) => row.type === type && row.host === host);
  if (plan.zone !== "example.test") fail("zone was not normalized");
  if (!find("A", "mail")) fail("mail A host was not relative to the zone");
  if (!find("A", "webmail")) fail("WebUI A record was not added");
  if (!find("AAAA", "webmail")) fail("WebUI AAAA record was not added");
  const mx = find("MX", "");
  if (!mx || mx.answer !== "mail.example.test" || mx.priority !== 10) fail("apex MX was not planned");
  const spf = find("TXT", "");
  if (!spf || spf.answer !== "v=spf1 mx include:spf.mailjet.com -all") {
    fail(`Mailjet SPF was not merged: ${spf?.answer}`);
  }
  const hostSpf = find("TXT", "mail");
  if (!hostSpf || hostSpf.answer !== "v=spf1 a include:spf.mailjet.com -all") {
    fail(`mail host SPF was not merged: ${hostSpf?.answer}`);
  }
  const srv = find("SRV", "_imaps._tcp");
  if (!srv || srv.answer !== "0 993 mail.example.test") fail("SRV host was not relative");
  if (plan.plan.some((row) => row.type === "PTR" || row.type === "CAA")) {
    fail("unsupported record types were planned");
  }
  if (!plan.skipped.some((row) => /CAA /.test(row))) fail("CAA skip was not reported");
  if (!plan.skipped.some((row) => /mail\.other\.test is outside zone/.test(row))) {
    fail("out-of-zone skip was not reported");
  }
'

printf 'PASS: name.com DNS plan is zone-relative and merges Mailjet SPF\n'

EXISTING_FILE="${TEST_TMP_DIR}/existing.json"
ACTIONS_FILE="${TEST_TMP_DIR}/actions.json"

printf '%s\n' '[
  {"id": 1, "host": "mail", "type": "A", "answer": "198.51.100.10", "ttl": 300},
  {"id": 2, "host": "mail", "type": "A", "answer": "198.51.100.11", "ttl": 300},
  {"id": 3, "host": "mail", "type": "CNAME", "answer": "parking.example.net", "ttl": 300},
  {"id": 4, "host": "", "type": "MX", "answer": "aspmx.l.google.com", "ttl": 300, "priority": 1},
  {"id": 5, "host": "", "type": "MX", "answer": "alt1.aspmx.l.google.com", "ttl": 300, "priority": 5},
  {"id": 6, "host": "", "type": "TXT", "answer": "v=spf1 include:_spf.google.com ~all", "ttl": 300},
  {"id": 7, "host": "", "type": "TXT", "answer": "google-site-verification=abc", "ttl": 300},
  {"id": 8, "host": "", "type": "NS", "answer": "ns1.name.com", "ttl": 300}
]' > "$EXISTING_FILE"

printf '%s\n' '{
  "zone": "example.test",
  "skipped": [],
  "plan": [
    {"host": "mail", "type": "A", "answer": "192.0.2.4", "ttl": 3600},
    {"host": "", "type": "MX", "answer": "mail.example.test", "ttl": 3600, "priority": 10},
    {"host": "", "type": "TXT", "answer": "v=spf1 mx include:spf.mailjet.com -all", "ttl": 3600},
    {"host": "webmail", "type": "A", "answer": "192.0.2.4", "ttl": 3600}
  ]
}' > "$PLAN_FILE"

reconcile_namecom_actions "$EXISTING_FILE" "$PLAN_FILE" > "$ACTIONS_FILE"

ACTIONS_FILE="$ACTIONS_FILE" "$NODE_BIN" -e '
  const fs = require("node:fs");
  const actions = JSON.parse(fs.readFileSync(process.env.ACTIONS_FILE, "utf8"));
  const fail = (message) => { console.error(`FAIL: ${message}`); process.exit(1); };
  const hasConflict = (needle) => (actions.conflicts || []).some((row) =>
    `${row.action} ${row.existing} ${row.wanted} ${row.reason}`.includes(needle));
  if (!hasConflict("CNAME mail")) fail("CNAME conflict was not reported");
  if (!hasConflict("replace")) fail("differing A/MX/SPF replacements were not reported");
  if (!actions.update.some((row) => row.id === 1 && row.record.answer === "192.0.2.4")) {
    fail("old mail A record was not reused for the new address");
  }
  if (!actions.destroy.some((row) => row.id === 2)) fail("extra mail A record was not queued for deletion");
  if (!actions.destroy.some((row) => row.id === 3)) fail("conflicting CNAME was not queued for deletion");
  if (!actions.destroy.some((row) => row.id === 5)) fail("extra Google MX was not queued for deletion");
  if (!actions.update.some((row) => row.id === 4 && row.record.answer === "mail.example.test")) {
    fail("primary MX was not replaced");
  }
  if (!actions.update.some((row) => row.id === 6 && /spf.mailjet.com/.test(row.record.answer))) {
    fail("old SPF was not replaced");
  }
  if (actions.destroy.some((row) => row.id === 7)) fail("unrelated verification TXT was deleted");
  if (actions.destroy.some((row) => row.id === 8)) fail("NS record was deleted");
  if (!actions.create.some((row) => row.host === "webmail" && row.answer === "192.0.2.4")) {
    fail("missing WebUI A record was not created");
  }
'

printf 'PASS: name.com reconciliation replaces conflicting records and keeps unrelated TXT/NS\n'
