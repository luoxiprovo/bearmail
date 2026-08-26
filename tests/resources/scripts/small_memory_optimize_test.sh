#!/usr/bin/env sh

set -eu

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd "${SCRIPT_DIR}/../../.." && pwd)"
OPTIMIZE_SH="${REPO_ROOT}/small-memory-optimize.sh"
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

[ -f "$OPTIMIZE_SH" ] || fail "small-memory-optimize.sh is missing"
sh -n "$OPTIMIZE_SH" || fail "small-memory-optimize.sh is not valid POSIX sh"

help_out="$(sh "$OPTIMIZE_SH" --help)"
printf '%s\n' "$help_out" | grep -q -- '--dry-run' || fail "help does not document --dry-run"
printf '%s\n' "$help_out" | grep -q '16 MB' || fail "help does not mention the RocksDB 16 MB buffer"
printf '%s\n' "$help_out" | grep -q '2 GB swap' || fail "help does not mention 2 GB swap"
printf '%s\n' "$help_out" | grep -q 'raw.githubusercontent.com/luoxiprovo/bearmail/main/small-memory-optimize.sh' || \
    fail "help does not show the curl one-liner"

if sh "$OPTIMIZE_SH" --nope >/dev/null 2>&1; then
    fail "unknown arguments should fail"
fi

root="${TEST_TMP_DIR}/fs"
mkdir -p "${root}/etc/stalwart" \
    "${root}/etc/systemd/system" \
    "${root}/etc/systemd/journald.conf.d" \
    "${root}/etc/sysctl.d"
printf '%s\n' '{"@type":"RocksDb","path":"/var/lib/stalwart/","blobSize":16834,"bufferSize":134217728,"poolWorkers":null}' \
    > "${root}/etc/stalwart/config.json"
printf '%s\n' '[Service]' 'ExecStart=/usr/local/bin/stalwart --config=/etc/stalwart/config.json' \
    > "${root}/etc/systemd/system/stalwart.service"
printf '%s\n' '[Service]' 'ExecStart=/usr/bin/node /opt/stalwart-webui/server.mjs' \
    > "${root}/etc/systemd/system/stalwart-webui.service"
printf '%s\n' '[Unit]' 'Description=Google Cloud Ops Agent' \
    > "${root}/etc/systemd/system/google-cloud-ops-agent.service"
printf '%s\n' '[Unit]' 'Description=snapd' \
    > "${root}/etc/systemd/system/snapd.service"
printf '%s\n' '# existing fstab' > "${root}/etc/fstab"

run_opt() {
    BEARMAIL_OPTIMIZE_ROOT="$root" \
    BEARMAIL_SKIP_SERVICE_CONTROL=1 \
    BEARMAIL_SWAP_MIB=1 \
    sh "$OPTIMIZE_SH" "$@"
}

dry_out="$(run_opt --dry-run)"
printf '%s\n' "$dry_out" | grep -q '134217728 -> 16777216' || fail "dry-run does not plan the RocksDB buffer cut"
printf '%s\n' "$dry_out" | grep -q 'create 1 MiB' || fail "dry-run does not plan swap"
printf '%s\n' "$dry_out" | grep -q 'disable google-cloud-ops-agent.service' || \
    fail "dry-run does not plan disabling Ops Agent"
printf '%s\n' "$dry_out" | grep -q 'disable snapd (no user snaps)' || fail "dry-run does not plan disabling snapd"
printf '%s\n' "$dry_out" | grep -q 'Leaves unchanged: Caddy, DNS' || fail "dry-run does not say mail/DNS stay unchanged"
grep -q '"bufferSize":134217728' "${root}/etc/stalwart/config.json" || fail "dry-run changed config.json"
[ ! -f "${root}/etc/systemd/system/stalwart.service.d/bearmail-memory.conf" ] || \
    fail "dry-run wrote a systemd drop-in"
[ ! -e "${root}/swapfile" ] || fail "dry-run created a swap file"

apply_out="$(run_opt)"
printf '%s\n' "$apply_out" | grep -q 'Set RocksDB bufferSize to 16777216' || fail "apply did not set bufferSize"
grep -q '"bufferSize":16777216' "${root}/etc/stalwart/config.json" || fail "config.json bufferSize was not 16 MB"
grep -q '"path":"/var/lib/stalwart/"' "${root}/etc/stalwart/config.json" || fail "apply rewrote unrelated store fields"
grep -q 'MemoryMax=400M' "${root}/etc/systemd/system/stalwart.service.d/bearmail-memory.conf" || \
    fail "Stalwart memory drop-in missing"
grep -q 'max-old-space-size=48' "${root}/etc/systemd/system/stalwart-webui.service.d/bearmail-memory.conf" || \
    fail "WebUI Node heap cap missing"
grep -q 'SystemMaxUse=50M' "${root}/etc/systemd/journald.conf.d/bearmail-size.conf" || \
    fail "journald cap missing"
grep -q 'vm.swappiness=10' "${root}/etc/sysctl.d/99-bearmail-swappiness.conf" || fail "swappiness sysctl missing"
grep -Eq '^'"${root}/swapfile"' none swap sw 0 0$' "${root}/etc/fstab" || fail "fstab was not updated"
[ -f "${root}/swapfile" ] || fail "swap file was not created"
printf '%s\n' "$apply_out" | grep -q 'Disabled Google Cloud Ops Agent' || fail "apply did not disable Ops Agent"
printf '%s\n' "$apply_out" | grep -q 'Disabled snapd' || fail "apply did not disable snapd"

again_out="$(run_opt)"
printf '%s\n' "$again_out" | grep -q 'already 16777216' || fail "second run is not idempotent for RocksDB"
printf '%s\n' "$again_out" | grep -q 'already listed in fstab' || fail "second run is not idempotent for swap"
grep -c '"bufferSize":16777216' "${root}/etc/stalwart/config.json" | grep -qx 1 || \
    fail "second run duplicated bufferSize"

mkdir -p "${TEST_TMP_DIR}/bin"
cat > "${TEST_TMP_DIR}/bin/snap" <<'EOF'
#!/bin/sh
echo "Name    Version"
echo "firefox 1.0"
EOF
chmod +x "${TEST_TMP_DIR}/bin/snap"
snap_out="$(
    BEARMAIL_OPTIMIZE_ROOT="$root" \
    BEARMAIL_SKIP_SERVICE_CONTROL=1 \
    BEARMAIL_SWAP_MIB=1 \
    BEARMAIL_SNAP_BIN="${TEST_TMP_DIR}/bin/snap" \
    sh "$OPTIMIZE_SH" --dry-run
)"
printf '%s\n' "$snap_out" | grep -q 'snapd has user packages' || \
    fail "snapd with user packages should be left enabled"

printf 'ok\n'
