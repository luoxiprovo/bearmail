#!/usr/bin/env sh

set -eu

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd "${SCRIPT_DIR}/../../.." && pwd)"
RELEASE_SH="${REPO_ROOT}/release_install.sh"

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

[ -f "$RELEASE_SH" ] || fail "release_install.sh is missing"
sh -n "$RELEASE_SH" || fail "release_install.sh is not valid POSIX sh"

help_out="$(sh "$RELEASE_SH" --help)"
printf '%s\n' "$help_out" | grep -q 'sudo bash' || fail "help does not show the curl | sudo bash invocation"
printf '%s\n' "$help_out" | grep -q 'install.sh' || fail "help does not say it runs install.sh"
printf '%s\n' "$help_out" | grep -q 'x86-64' || fail "help does not mention the published binary architecture"

if sh "$RELEASE_SH" --nope >/dev/null 2>&1; then
    fail "unknown arguments should fail"
fi

dry_out="$(sh "$RELEASE_SH" --dry-run)"
printf '%s\n' "$dry_out" | grep -q 'raw.githubusercontent.com/luoxiprovo/bearmail/main/install.sh' || \
    fail "dry-run does not print the install.sh URL"
printf '%s\n' "$dry_out" | grep -q '/stalwart$' || fail "dry-run does not print the stalwart URL"
printf '%s\n' "$dry_out" | grep -q 'stalwart-webui.tar.gz' || fail "dry-run does not print the WebUI archive URL"
printf '%s\n' "$dry_out" | grep -q '/var/tmp/bearmail-install/install.sh' || \
    fail "dry-run does not say it will exec the downloaded installer"

override_out="$(BEARMAIL_DOWNLOAD_BASE=https://example.test/bearmail BEARMAIL_WORK_DIR=/tmp/bm sh "$RELEASE_SH" --dry-run)"
printf '%s\n' "$override_out" | grep -q 'https://example.test/bearmail/install.sh' || \
    fail "BEARMAIL_DOWNLOAD_BASE is not honored"
printf '%s\n' "$override_out" | grep -q '/tmp/bm/install.sh' || \
    fail "BEARMAIL_WORK_DIR is not honored"

grep -q 'od -An -t x1 -j 18 -N 2' "$RELEASE_SH" || \
    fail "x86-64 ELF check must read raw bytes (od -t x1), not host-endian x2"

if command -v od >/dev/null 2>&1; then
    elf_hdr="${TMPDIR:-/tmp}/bearmail-elf-hdr.$$"
    trap 'rm -f "$elf_hdr"' EXIT
    # Minimal ELF64 little-endian header: magic + e_machine 0x3E at offset 18.
    python3 -c 'import sys; p=sys.argv[1]; b=bytearray(64); b[0:4]=b"\x7fELF"; b[18]=0x3e; b[19]=0x00; open(p,"wb").write(b)' "$elf_hdr"
    magic=$(od -An -t x1 -N 4 "$elf_hdr" | tr -d ' \n')
    machine=$(od -An -t x1 -j 18 -N 2 "$elf_hdr" | tr -d ' \n')
    [ "$magic" = "7f454c46" ] || fail "fixture ELF magic is ${magic}"
    [ "$machine" = "3e00" ] || fail "fixture e_machine via od -t x1 is ${machine}, expected 3e00"
    rm -f "$elf_hdr"
    trap - EXIT
fi

printf 'ok\n'
