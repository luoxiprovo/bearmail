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
  {"recordId": "rec_ns", "type": "NS", "name": "@", "data": "ns1.domaincontrol.com", "ttl": 3600},
  {"recordId": "rec_soa", "type": "SOA", "name": "@", "data": "ns1.domaincontrol.com", "ttl": 3600},
  {"recordId": "rec_mx1", "type": "MX", "name": "@", "data": "mx1.godaddy.com.", "priority": 5, "ttl": 3600},
  {"recordId": "rec_mx2", "type": "MX", "name": "@", "data": "mx2.godaddy.com.", "priority": 10, "ttl": 3600},
  {"recordId": "rec_spf", "type": "TXT", "name": "@", "data": "\"v=spf1 include:_spf.godaddy.com ~all\"", "ttl": 3600},
  {"recordId": "rec_ver", "type": "TXT", "name": "@", "data": "google-site-verification=abc", "ttl": 3600},
  {"recordId": "rec_a1", "type": "A", "name": "mail", "data": "198.51.100.10", "ttl": 3600},
  {"recordId": "rec_a2", "type": "A", "name": "mail", "data": "198.51.100.11", "ttl": 3600},
  {"recordId": "rec_cn", "type": "CNAME", "name": "mail", "data": "parking.example.net.", "ttl": 3600},
  {"recordId": "rec_wcn", "type": "CNAME", "name": "webmail", "data": "parking.example.net.", "ttl": 3600},
  {"recordId": "rec_www", "type": "A", "name": "www", "data": "198.51.100.20", "ttl": 3600},
  {"recordId": "rec_srv", "type": "SRV", "name": "@", "service": "_imaps", "protocol": "_tcp", "priority": 0, "weight": 1, "port": 993, "data": "old.example.net.", "ttl": 3600}
]' > "$EXISTING_FILE"

build_godaddy_changes "$EXISTING_FILE" "$PLAN_FILE" > "$CHANGES_FILE"

CHANGES_FILE="$CHANGES_FILE" "$NODE_BIN" -e '
  const fs = require("node:fs");
  const changes = JSON.parse(fs.readFileSync(process.env.CHANGES_FILE, "utf8"));
  const fail = (message) => { console.error(`FAIL: ${message}`); process.exit(1); };
  const put = (id) => (changes.puts || []).find((row) => row.recordId === id);
  const post = (type, name) => (changes.posts || []).find((row) => row.type === type && row.name === name);
  const deleted = new Set(changes.deletes || []);
  const hasConflict = (needle) => (changes.conflicts || []).some((row) =>
    `${row.action} ${row.existing} ${row.wanted} ${row.reason}`.includes(needle));
  const ttlOk = (row) => row && row.ttl >= 600 && row.ttl <= 86400;

  if (!hasConflict("CNAME mail")) fail("CNAME conflict was not reported");
  if (!hasConflict("CNAME webmail")) fail("webmail CNAME conflict was not reported");
  for (const id of ["rec_cn", "rec_wcn", "rec_a2", "rec_mx2"]) {
    if (!deleted.has(id)) fail("expected delete missing: " + id);
  }
  for (const id of ["rec_ns", "rec_soa", "rec_ver", "rec_www", "rec_a1", "rec_mx1", "rec_spf", "rec_srv"]) {
    if (deleted.has(id)) fail("delete included a record that should stay or be updated: " + id);
  }

  const mailA = put("rec_a1");
  if (!mailA || mailA.record.data !== "192.0.2.4" || mailA.record.name !== "mail" || mailA.record.type !== "A") {
    fail("mail A was not replaced with one address: " + JSON.stringify(mailA));
  }
  if (Object.prototype.hasOwnProperty.call(mailA.record, "priority")) fail("A record included a priority");
  const mx = put("rec_mx1");
  if (!mx || mx.record.name !== "@" || mx.record.data !== "mail.example.test" || mx.record.priority !== 10) {
    fail("apex MX was not encoded: " + JSON.stringify(mx));
  }
  const txt = put("rec_spf");
  if (!txt || txt.record.data !== "v=spf1 mx include:spf.brevo.com -all" || txt.record.name !== "@") {
    fail("Brevo SPF was not published: " + JSON.stringify(txt));
  }
  if ((changes.posts || []).some((row) => row.data === "google-site-verification=abc")) {
    fail("unrelated verification TXT was republished");
  }
  if ((changes.puts || []).some((row) => /godaddy/.test(row.record.data || ""))) fail("old GoDaddy SPF was kept");
  const hostTxt = post("TXT", "mail");
  if (!hostTxt || hostTxt.data !== "v=spf1 a include:spf.brevo.com -all") {
    fail("mail host SPF was not published: " + JSON.stringify(hostTxt));
  }
  const webA = post("A", "webmail");
  if (!webA || webA.data !== "192.0.2.4") fail("WebUI A record was not created");
  if (Object.keys(webA).sort().join(",") !== "data,name,ttl,type") fail("WebUI A record has extra fields");
  const webAAAA = post("AAAA", "webmail");
  if (!webAAAA || webAAAA.data !== "2001:db8::4") fail("WebUI AAAA record was not created");
  const srv = put("rec_srv");
  if (!srv || srv.record.name !== "@" || srv.record.service !== "_imaps" || srv.record.protocol !== "_tcp") {
    fail("SRV owner was not split into service and protocol: " + JSON.stringify(srv));
  }
  if (srv.record.priority !== 0 || srv.record.weight !== 0 || srv.record.port !== 993 || srv.record.data !== "mail.example.test") {
    fail("SRV target was not encoded: " + JSON.stringify(srv.record));
  }
  const bodies = (changes.posts || []).concat((changes.puts || []).map((row) => row.record));
  if (bodies.some((row) => row.type === "NS" || row.type === "SOA" || row.type === "PTR" || row.type === "CAA" || row.name === "www")) {
    fail("untouched or unsupported records were published");
  }
  if (bodies.some((row) => !ttlOk(row))) fail("a published TTL was outside 600..86400");
  if (mailA.record.ttl !== 3600 || mx.record.ttl !== 3600) fail("published TTL did not follow the Stalwart table");
  if (!(changes.skipped || []).some((row) => /CAA /.test(row))) fail("CAA skip was not reported");
'

printf 'PASS: GoDaddy DNS changes replace conflicts, keep unrelated TXT/NS, and encode MX/SRV\n'

# A zone that already matches the plan produces no writes. Quoted TXT values
# and trailing dots are the same records the publisher would write.
PLAN_FILE="$PLAN_FILE" "$NODE_BIN" -e '
  const fs = require("node:fs");
  const plan = JSON.parse(fs.readFileSync(process.env.PLAN_FILE, "utf8"));
  const name = (host) => host === "" ? "@" : host;
  const records = plan.plan.map((row, index) => {
    const base = { recordId: `rec_${index}_${row.type}_${name(row.host)}`, type: row.type, ttl: row.ttl };
    if (row.type === "MX") {
      return Object.assign(base, { name: name(row.host), data: row.answer + ".", priority: row.priority });
    }
    if (row.type === "SRV") {
      const host = String(row.host).match(/^(_[^.]+)\.(_[^.]+)(?:\.(.*))?$/);
      const answer = String(row.answer).match(/^(\d+)\s+(\d+)\s+(\S+)$/);
      if (!host || !answer) throw new Error("fixture SRV could not be encoded");
      return Object.assign(base, {
        name: host[3] || "@",
        service: host[1],
        protocol: host[2],
        priority: row.priority,
        weight: Number(answer[1]),
        port: Number(answer[2]),
        data: answer[3] + ".",
      });
    }
    if (row.type === "TXT") return Object.assign(base, { name: name(row.host), data: `"${row.answer}"` });
    return Object.assign(base, { name: name(row.host), data: row.answer });
  });
  records.push({ recordId: "rec_ns", type: "NS", name: "@", data: "ns1.domaincontrol.com", ttl: 3600 });
  records.push({ recordId: "rec_ver", type: "TXT", name: "@", data: "google-site-verification=abc", ttl: 3600 });
  records.push({ recordId: "rec_www", type: "A", name: "www", data: "198.51.100.20", ttl: 3600 });
  process.stdout.write(JSON.stringify(records));
' > "$EXISTING_FILE"

build_godaddy_changes "$EXISTING_FILE" "$PLAN_FILE" > "$CHANGES_FILE"
CHANGES_FILE="$CHANGES_FILE" "$NODE_BIN" -e '
  const fs = require("node:fs");
  const changes = JSON.parse(fs.readFileSync(process.env.CHANGES_FILE, "utf8"));
  const fail = (message) => { console.error(`FAIL: ${message}`); process.exit(1); };
  if ((changes.posts || []).length || (changes.puts || []).length || (changes.deletes || []).length) {
    fail("matching zone still produced writes: " + JSON.stringify({
      posts: changes.posts, puts: changes.puts, deletes: changes.deletes,
    }));
  }
  if ((changes.conflicts || []).length) fail("matching zone reported conflicts");
'

printf 'PASS: GoDaddy DNS changes are empty when the zone already matches\n'

# GoDaddy rejects TTL below 600 and above 86400. A short table value is raised.
# A value already at the ceiling is left alone.
PLAN_FILE="$PLAN_FILE" EXISTING_FILE="$EXISTING_FILE" "$NODE_BIN" -e '
  const fs = require("node:fs");
  const plan = JSON.parse(fs.readFileSync(process.env.PLAN_FILE, "utf8"));
  const existing = JSON.parse(fs.readFileSync(process.env.EXISTING_FILE, "utf8"));
  let sawA = false;
  let sawAAAA = false;
  for (const row of plan.plan) {
    if (row.type === "A" && row.host === "mail") { row.ttl = 200; sawA = true; }
    if (row.type === "AAAA" && row.host === "webmail") { row.ttl = 90000; sawAAAA = true; }
  }
  for (const row of existing) {
    if (row.type === "A" && row.name === "mail") row.ttl = 200;
    if (row.type === "AAAA" && row.name === "webmail") row.ttl = 86400;
  }
  if (!sawA || !sawAAAA) throw new Error("plan is missing the TTL fixtures");
  fs.writeFileSync(process.env.PLAN_FILE, JSON.stringify(plan));
  fs.writeFileSync(process.env.EXISTING_FILE, JSON.stringify(existing));
'

build_godaddy_changes "$EXISTING_FILE" "$PLAN_FILE" > "$CHANGES_FILE"
CHANGES_FILE="$CHANGES_FILE" "$NODE_BIN" -e '
  const fs = require("node:fs");
  const changes = JSON.parse(fs.readFileSync(process.env.CHANGES_FILE, "utf8"));
  const fail = (message) => { console.error(`FAIL: ${message}`); process.exit(1); };
  if ((changes.posts || []).length || (changes.deletes || []).length) {
    fail("TTL clamp created or deleted records: " + JSON.stringify(changes));
  }
  if ((changes.conflicts || []).length) fail("TTL clamp reported a conflict");
  if ((changes.puts || []).length !== 1) fail("TTL clamp did not update only the short record: " + JSON.stringify(changes.puts));
  const put = changes.puts[0];
  if (put.record.type !== "A" || put.record.name !== "mail" || put.record.ttl !== 600) {
    fail("short TTL was not raised to 600: " + JSON.stringify(put));
  }
  if ((changes.puts || []).some((row) => row.record.type === "AAAA")) fail("ceiling TTL was rewritten");
'

printf 'PASS: GoDaddy DNS TTL is clamped to 600..86400\n'
