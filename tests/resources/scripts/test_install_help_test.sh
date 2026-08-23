#!/usr/bin/env sh

set -eu

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd "${SCRIPT_DIR}/../../.." && pwd)"
TEST_INSTALL="${REPO_ROOT}/test_install.sh"

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

[ -f "$TEST_INSTALL" ] || fail "test_install.sh is missing"
sh -n "$TEST_INSTALL" || fail "test_install.sh is not valid POSIX sh"

help_out="$(sh "$TEST_INSTALL" --help)"
printf '%s\n' "$help_out" | grep -q 'no enterprise features' || \
    fail "help does not say enterprise is excluded"
printf '%s\n' "$help_out" | grep -q 'SMTP relay' || \
    fail "help does not mention SMTP relay"
printf '%s\n' "$help_out" | grep -q 'name.com' || \
    fail "help does not mention name.com DNS publish"
printf '%s\n' "$help_out" | grep -q 'install.sh' || \
    fail "help does not say it runs install.sh"

printf '%s\n' "$help_out" | grep -q 'mail.example.com' || \
    fail "help does not give a public mail hostname example"
printf '%s\n' "$help_out" | grep -q '.internal' || \
    fail "help does not warn against cloud .internal hostnames"

dry_out="$(sh "$TEST_INSTALL" --dry-run)"
printf '%s\n' "$dry_out" | grep -q -- '--no-default-features' || \
    fail "dry-run does not disable default features"
printf '%s\n' "$dry_out" | grep -q 'sqlite postgres mysql rocks' || \
    fail "dry-run does not use the community backend set"
printf '%s\n' "$dry_out" | grep -q -- '--release --locked' || \
    fail "default dry-run is not a release customer-style build"
printf '%s\n' "$dry_out" | grep -q 'exec sh .*/install.sh' || \
    fail "dry-run does not exec install.sh"
printf '%s\n' "$dry_out" | grep -q 'SMTP relay' || \
    fail "dry-run does not mention SMTP relay"
printf '%s\n' "$dry_out" | grep -q 'name.com DNS' || \
    fail "dry-run does not mention name.com DNS"

printf '%s\n' "$help_out" | grep -q -- '--webui-only' || \
    fail "help does not document --webui-only"
printf '%s\n' "$help_out" | grep -q 'webui/' || \
    fail "help does not say WebUI iterate uses the webui folder"

webui_dry="$(sh "$TEST_INSTALL" --dry-run --webui-only)"
printf '%s\n' "$webui_dry" | grep -q "${REPO_ROOT}/webui/install.sh" || \
    fail "webui-only dry-run does not call webui/install.sh"
printf '%s\n' "$webui_dry" | grep -q -- '--no-build' || \
    fail "webui-only dry-run does not pass --no-build to the folder installer"
if printf '%s\n' "$webui_dry" | grep -q cargo; then
    fail "webui-only dry-run should not compile Stalwart"
fi
if printf '%s\n' "$webui_dry" | grep -q 'tar -czf'; then
    fail "webui-only dry-run should not pack a tarball"
fi
if printf '%s\n' "$webui_dry" | grep -q 'exec sh .*/install.sh'; then
    fail "webui-only dry-run should not start the customer install.sh"
fi

dev_out="$(sh "$TEST_INSTALL" --dry-run --dev --skip-build)"
printf '%s\n' "$dev_out" | grep -q "reuse ${REPO_ROOT}/stalwart" || \
    fail "skip-build dry-run does not reuse staged artifacts"

printf '%s\n' "$dry_out" | grep -q 'mail.example.com' || \
    fail "dry-run does not give a public mail hostname example"

printf '%s\n' "$help_out" | grep -q -- '--reset-setup' || \
    fail "help does not document --reset-setup"

reset_dry="$(sh "$TEST_INSTALL" --dry-run --reset-setup --skip-build)"
printf '%s\n' "$reset_dry" | grep -q 'config.json' || \
    fail "reset-setup dry-run does not move the existing config"

if sh "$TEST_INSTALL" --not-a-flag >/tmp/test-install-bad-arg.out 2>/tmp/test-install-bad-arg.err; then
    fail "unknown arguments should fail"
fi

printf 'PASS: test_install.sh help, dry-run, and argument checks\n'
