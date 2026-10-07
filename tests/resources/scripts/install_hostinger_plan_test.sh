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
EXISTING_FILE="${TEST_TMP_DIR}/existing.json"
CHANGES_FILE="${TEST_TMP_DIR}/changes.json"

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

build_namecom_dns_plan "$STATE_FILE" "webmail.example.test" "example.test" "brevo" > "$PLAN_FILE"

printf '%s\n' '[
  {"name": "@", "type": "NS", "ttl": 14400, "records": [{"content": "ns1.dns-parking.com.", "is_disabled": false}]},
  {"name": "@", "type": "SOA", "ttl": 14400, "records": [{"content": "ns1.dns-parking.com. hostinger. 1", "is_disabled": false}]},
  {"name": "@", "type": "MX", "ttl": 14400, "records": [
    {"content": "5 mx1.hostinger.com.", "is_disabled": false},
    {"content": "10 mx2.hostinger.com.", "is_disabled": false}
  ]},
  {"name": "@", "type": "TXT", "ttl": 14400, "records": [
    {"content": "\"v=spf1 include:_spf.mail.hostinger.com ~all\"", "is_disabled": false},
    {"content": "google-site-verification=abc", "is_disabled": false}
  ]},
  {"name": "mail", "type": "A", "ttl": 14400, "records": [
    {"content": "198.51.100.10", "is_disabled": false},
    {"content": "198.51.100.11", "is_disabled": false}
  ]},
  {"name": "mail", "type": "CNAME", "ttl": 14400, "records": [
    {"content": "parking.example.net.", "is_disabled": false}
  ]},
  {"name": "webmail", "type": "ALIAS", "ttl": 14400, "records": [
    {"content": "parking.example.net.", "is_disabled": false}
  ]},
  {"name": "www", "type": "A", "ttl": 14400, "records": [
    {"content": "198.51.100.20", "is_disabled": false}
  ]}
]' > "$EXISTING_FILE"

build_hostinger_changes "$EXISTING_FILE" "$PLAN_FILE" > "$CHANGES_FILE"

CHANGES_FILE="$CHANGES_FILE" "$NODE_BIN" -e '
  const fs = require("node:fs");
  const changes = JSON.parse(fs.readFileSync(process.env.CHANGES_FILE, "utf8"));
  const fail = (message) => { console.error(`FAIL: ${message}`); process.exit(1); };
  const put = (type, name) => (changes.puts || []).find((row) => row.type === type && row.name === name);
  const contents = (row) => (row?.records || []).map((item) => item.content);
  const deleted = (type, name) => (changes.deletes || []).some((row) => row.type === type && row.name === name);
  const hasConflict = (needle) => (changes.conflicts || []).some((row) =>
    `${row.action} ${row.existing} ${row.wanted} ${row.reason}`.includes(needle));

  if (!hasConflict("CNAME mail")) fail("CNAME conflict was not reported");
  if (!hasConflict("ALIAS webmail")) fail("ALIAS conflict was not reported");
  if (!deleted("CNAME", "mail")) fail("conflicting CNAME was not queued for deletion");
  if (!deleted("ALIAS", "webmail")) fail("conflicting ALIAS was not queued for deletion");
  if ((changes.deletes || []).some((row) => row.type === "NS" || row.type === "SOA" || row.type === "A" || row.type === "MX" || row.type === "TXT")) {
    fail("delete removed a set that should be overwritten or left alone: " + JSON.stringify(changes.deletes));
  }

  const mailA = put("A", "mail");
  if (!mailA || contents(mailA).join(",") !== "192.0.2.4") fail("mail A was not replaced with one address");
  const mx = put("MX", "@");
  if (!mx || contents(mx).join(",") !== "10 mail.example.test") fail(`apex MX was not encoded: ${contents(mx)}`);
  const txt = put("TXT", "@");
  const txtValues = contents(txt);
  if (!txtValues.includes("v=spf1 mx include:spf.brevo.com -all")) fail(`Brevo SPF was not published: ${txtValues}`);
  if (!txtValues.includes("google-site-verification=abc")) fail("unrelated verification TXT was dropped");
  if (txtValues.some((value) => /hostinger/.test(value))) fail("old Hostinger SPF was kept");
  const hostTxt = put("TXT", "mail");
  if (!hostTxt || contents(hostTxt).join(",") !== "v=spf1 a include:spf.brevo.com -all") {
    fail(`mail host SPF was not published: ${contents(hostTxt)}`);
  }
  const webA = put("A", "webmail");
  if (!webA || contents(webA).join(",") !== "192.0.2.4") fail("WebUI A record was not created");
  const webAAAA = put("AAAA", "webmail");
  if (!webAAAA || contents(webAAAA).join(",") !== "2001:db8::4") fail("WebUI AAAA record was not created");
  const srv = put("SRV", "_imaps._tcp");
  if (!srv || contents(srv).join(",") !== "0 0 993 mail.example.test") {
    fail(`SRV was not encoded as priority weight port target: ${contents(srv)}`);
  }
  if ((changes.puts || []).some((row) => row.type === "NS" || row.type === "SOA" || row.type === "PTR" || row.type === "CAA" || row.name === "www")) {
    fail("untouched or unsupported records were published");
  }
  if (!(changes.skipped || []).some((row) => /CAA /.test(row))) fail("CAA skip was not reported");
  if (mailA.ttl !== 3600 || mx.ttl !== 3600) fail("published TTL did not follow the Stalwart table");
'

printf 'PASS: Hostinger DNS changes replace conflicts, keep unrelated TXT/NS, and encode MX/SRV\n'

# A zone that already matches the plan produces no writes.
PLAN_FILE="$PLAN_FILE" "$NODE_BIN" -e '
  const fs = require("node:fs");
  const plan = JSON.parse(fs.readFileSync(process.env.PLAN_FILE, "utf8"));
  const byKey = new Map();
  const host = (name) => name === "" ? "@" : name;
  const content = (row) => {
    if (row.type === "MX") return `${row.priority} ${row.answer}`;
    if (row.type === "SRV") return `${row.priority} ${row.answer}`;
    return row.answer;
  };
  for (const row of plan.plan) {
    const key = `${row.type}|${host(row.host)}`;
    if (!byKey.has(key)) byKey.set(key, { name: host(row.host), type: row.type, ttl: row.ttl, records: [] });
    byKey.get(key).records.push({ content: content(row), is_disabled: false });
  }
  byKey.get("TXT|@").records.push({ content: "google-site-verification=abc", is_disabled: false });
  byKey.set("NS|@", { name: "@", type: "NS", ttl: 14400, records: [{ content: "ns1.dns-parking.com." }] });
  byKey.set("A|www", { name: "www", type: "A", ttl: 14400, records: [{ content: "198.51.100.20" }] });
  process.stdout.write(JSON.stringify([...byKey.values()]));
' > "$EXISTING_FILE"

build_hostinger_changes "$EXISTING_FILE" "$PLAN_FILE" > "$CHANGES_FILE"
CHANGES_FILE="$CHANGES_FILE" "$NODE_BIN" -e '
  const fs = require("node:fs");
  const changes = JSON.parse(fs.readFileSync(process.env.CHANGES_FILE, "utf8"));
  const fail = (message) => { console.error(`FAIL: ${message}`); process.exit(1); };
  if ((changes.puts || []).length || (changes.deletes || []).length) {
    fail("matching zone still produced writes: " + JSON.stringify({ puts: changes.puts, deletes: changes.deletes }));
  }
  if ((changes.conflicts || []).length) fail("matching zone reported conflicts");
'

printf 'PASS: Hostinger DNS changes are empty when the zone already matches\n'
