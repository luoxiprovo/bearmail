#!/usr/bin/env sh

set -eu

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd "${SCRIPT_DIR}/../../.." && pwd)"

fail() {
    printf 'FAIL: %s\n' "$1" >&2
    exit 1
}

for script in install.sh upgrade.sh uninstall.sh; do
    sh -n "${REPO_ROOT}/${script}" || fail "${script} is not valid POSIX sh"
done

grep -q 'suppress_distro_mtas' "${REPO_ROOT}/install.sh" || \
    fail "install.sh must mask distro mail agents"
grep -q 'systemctl mask' "${REPO_ROOT}/install.sh" || \
    fail "install.sh must mask exim4, postfix, and sendmail"
grep -q 'stalwart-mta-guard.timer' "${REPO_ROOT}/install.sh" || \
    fail "install.sh must install the Stalwart guard timer"
grep -q 'suppress_distro_mtas' "${REPO_ROOT}/upgrade.sh" || \
    fail "upgrade.sh must mask distro mail agents on existing hosts"
grep -q 'stalwart-mta-guard.timer' "${REPO_ROOT}/upgrade.sh" || \
    fail "upgrade.sh must enable the Stalwart guard timer"
grep -q 'systemctl unmask' "${REPO_ROOT}/uninstall.sh" || \
    fail "uninstall.sh must unmask distro mail agents"
grep -q 'stalwart-mta-guard.timer' "${REPO_ROOT}/docs/INSTALL.md" || \
    fail "INSTALL.md must document the guard timer"

dry_out="$(sh "${REPO_ROOT}/upgrade.sh" --dry-run)"
printf '%s\n' "$dry_out" | grep -q 'Mask exim4.service, postfix.service, and sendmail.service' || \
    fail "upgrade dry-run must say it masks distro mail agents"
printf '%s\n' "$dry_out" | grep -q 'does not change configuration' || \
    fail "upgrade dry-run must still say configuration is unchanged"

printf 'ok\n'
