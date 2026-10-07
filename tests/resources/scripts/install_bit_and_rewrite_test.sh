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

sed '/^main "\$@"$/d' "${REPO_ROOT}/install.sh" > "${TEST_TMP_DIR}/install-functions.sh"
# shellcheck disable=SC1090
. "${TEST_TMP_DIR}/install-functions.sh"

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

NODE_BIN="$(command -v node)"

SURBL_TAG="${TEST_TMP_DIR}/surbl.json"
cat > "$SURBL_TAG" <<'EOF'
{
  "else": "false",
  "match": {
    "0": { "if": "octets[0] != 127", "then": "false" },
    "1": { "if": "octets[3] == 1", "then": "'SURBL_BLOCKED'" },
    "2": { "if": "bit_and(octets[3], 16) != 0", "then": "'MW_SURBL_MULTI'" },
    "3": { "if": "bit_and(octets[3], 8) != 0", "then": "'PH_SURBL_MULTI'" },
    "4": { "if": "bit_and(octets[3], 128) != 0", "then": "'CRACKED_SURBL'" },
    "5": { "if": "bit_and(octets[3], 64) != 0", "then": "'ABUSE_SURBL'" },
    "6": { "if": "bit_and(octets[3], 32) != 0", "then": "'CT_SURBL'" },
    "7": { "if": "bit_and(octets[3], 4) != 0", "then": "'DM_SURBL'" }
  }
}
EOF

PATCHES="${TEST_TMP_DIR}/patches.json"
rewrite_bit_and_tag_patches < "$SURBL_TAG" > "$PATCHES"

node -e '
const fs = require("node:fs");
const patches = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const keys = Object.keys(patches).sort();
const expected = [
  "tag/match/2/if",
  "tag/match/3/if",
  "tag/match/4/if",
  "tag/match/5/if",
  "tag/match/6/if",
  "tag/match/7/if",
];
if (keys.join("\n") !== expected.join("\n")) {
  console.error(keys);
  process.exit(1);
}
if (JSON.stringify(patches).includes("bit_and(")) process.exit(1);
function matches(expr, octet) {
  const clauses = expr.slice(1, -1).split(" || ");
  return clauses.some((clause) => {
    const found = clause.match(/^\(octets\[3\] >= (\d+) && octets\[3\] <= (\d+)\)$/);
    if (!found) throw new Error("unexpected clause " + clause);
    const start = Number(found[1]);
    const end = Number(found[2]);
    return octet >= start && octet <= end;
  });
}
const masks = { 2: 16, 3: 8, 4: 128, 5: 64, 6: 32, 7: 4 };
for (const [index, mask] of Object.entries(masks)) {
  const expr = patches["tag/match/" + index + "/if"];
  for (let octet = 0; octet < 256; octet++) {
    const want = (octet & mask) !== 0;
    if (matches(expr, octet) !== want) {
      console.error("mask " + mask + " octet " + octet);
      process.exit(1);
    }
  }
}
' "$PATCHES" || fail "SURBL bit_and tests did not become equivalent octet ranges"

printf '%s\n' '{"else":"false","match":{"0":{"if":"octets[3] == 1","then":"false"}}}' \
    | rewrite_bit_and_tag_patches > "${TEST_TMP_DIR}/unchanged.json"
[ "$(cat "${TEST_TMP_DIR}/unchanged.json")" = "{}" ] || fail "an ordinary octet test was rewritten"

status=0
printf '%s\n' '{"else":"false","match":{"0":{"if":"bit_and(octets[3], 3) != 0","then":"false"}}}' \
    | rewrite_bit_and_tag_patches > "${TEST_TMP_DIR}/unsupported.json" 2>"${TEST_TMP_DIR}/unsupported.err" || status=$?
[ "$status" -eq 3 ] || fail "a non-power-of-two bit_and was not rejected"
grep -q "Unsupported bit_and" "${TEST_TMP_DIR}/unsupported.err" || \
    fail "the unsupported bit_and error did not name the expression"

SHOW_NODE="${TEST_TMP_DIR}/show-node"
cat > "$SHOW_NODE" <<'EOF'
#!/bin/sh
previous=""
for argument in "$@"; do
    if [ "$previous" = "-e" ]; then
        printf '%s' "$argument"
        exit 0
    fi
    previous="$argument"
done
exit 1
EOF
chmod +x "$SHOW_NODE"
NODE_BIN="$SHOW_NODE"
STALWART_ADMIN_USERNAME="admin-should-stay-out-of-the-script" \
    node_with_bit_and_rewrite "$(bit_and_repair_js)" > "${TEST_TMP_DIR}/repair.js"
grep -q 'process.env.STALWART_ADMIN_USERNAME' "${TEST_TMP_DIR}/repair.js" || \
    fail "the repair script no longer reads the admin username from the environment"
grep -q 'spamFilterRulesUrl: null' "${TEST_TMP_DIR}/repair.js" || \
    fail "the repair script does not clear the spam-filter rules URL"
if grep -q 'admin-should-stay-out-of-the-script' "${TEST_TMP_DIR}/repair.js"; then
    fail "the admin username was interpolated into the repair script"
fi
node --check "${TEST_TMP_DIR}/repair.js" || fail "the DNSBL repair script does not parse"

printf 'PASS: DNSBL bit_and tags rewrite to octet ranges\n'
