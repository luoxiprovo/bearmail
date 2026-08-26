#!/usr/bin/env sh
# shellcheck shell=dash

# Shrink BearMail's memory use on small VMs (about 1 GB RAM, such as GCP
# e2-micro). Run after a successful install. Does not change Caddy, DNS,
# IMAP/SMTP ports, mail data, or Stalwart caches.
#
# Intended for:
#   curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/small-memory-optimize.sh | sudo bash

set -eu

BUFFER_SIZE="${BEARMAIL_ROCKSDB_BUFFER_SIZE:-16777216}"
# Size in MiB so POSIX $(( )) never overflows a 32-bit signed long (2 GiB).
SWAP_MIB="${BEARMAIL_SWAP_MIB:-2048}"
SWAP_LABEL="/swapfile"
dry_run="false"
skip_services="false"

say() {
    printf '%s\n' "$1"
}

warn() {
    printf 'WARNING: %s\n' "$1" >&2
}

err() {
    printf 'ERROR: %s\n' "$1" >&2
    exit 1
}

usage() {
    cat <<'EOF'
Usage: sudo sh ./small-memory-optimize.sh [--dry-run]

Tune an installed BearMail host for a ~1 GB VM (for example GCP e2-micro):

  • RocksDB write buffer 16 MB (restart Stalwart only if the value changes)
  • 2 GB swap file if this host does not already have enough swap
  • journald 50 MB cap; Stalwart MemoryHigh/MemoryMax; WebUI Node heap cap
  • disable Google Cloud Ops Agent when present
  • disable snapd when no user snaps are installed

Does not change Caddy, DNS, ports, stored mail, or Stalwart cache sizes.
Safe to run more than once.

One-liner after install:

  curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/small-memory-optimize.sh | sudo bash

Preview:

  curl -fsSL https://raw.githubusercontent.com/luoxiprovo/bearmail/main/small-memory-optimize.sh | sudo bash -s -- --dry-run

Options:
  --dry-run    Print the plan without changing the system
  -h, --help   Show this help

Environment (optional, for tests or custom prefixes):
  BEARMAIL_OPTIMIZE_ROOT       Pretend this directory is the filesystem root
  BEARMAIL_STALWART_CONFIG     Path to Stalwart config.json
  BEARMAIL_SWAP_MIB            Swap file size in MiB (default: 2048)
  BEARMAIL_SNAP_BIN            snap executable used to detect user packages
  BEARMAIL_SKIP_SERVICE_CONTROL=1   Do not call systemctl, swapon, or sysctl
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --dry-run)
            dry_run="true"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        --)
            shift
            break
            ;;
        -*)
            err "Unknown option: $1. This script only accepts --help and --dry-run."
            ;;
        *)
            err "Unexpected argument: $1"
            ;;
    esac
done

root="${BEARMAIL_OPTIMIZE_ROOT:-}"
case "$root" in
    */) root="${root%/}" ;;
esac

if [ -n "${BEARMAIL_SKIP_SERVICE_CONTROL:-}" ]; then
    skip_services="true"
fi

prefixed() {
    if [ -n "$root" ]; then
        printf '%s%s' "$root" "$1"
    else
        printf '%s' "$1"
    fi
}

unit_file="$(prefixed /etc/systemd/system/stalwart.service)"
webui_unit_file="$(prefixed /etc/systemd/system/stalwart-webui.service)"
config_file="${BEARMAIL_STALWART_CONFIG:-}"
swapfile="$(prefixed "$SWAP_LABEL")"
fstab="$(prefixed /etc/fstab)"
sysctl_file="$(prefixed /etc/sysctl.d/99-bearmail-swappiness.conf)"
journald_file="$(prefixed /etc/systemd/journald.conf.d/bearmail-size.conf)"
stalwart_dropin="$(prefixed /etc/systemd/system/stalwart.service.d/bearmail-memory.conf)"
webui_dropin="$(prefixed /etc/systemd/system/stalwart-webui.service.d/bearmail-memory.conf)"
ops_unit="$(prefixed /etc/systemd/system/google-cloud-ops-agent.service)"
ops_lib_unit="$(prefixed /lib/systemd/system/google-cloud-ops-agent.service)"
snapd_unit="$(prefixed /etc/systemd/system/snapd.service)"
snapd_lib_unit="$(prefixed /lib/systemd/system/snapd.service)"

if [ -z "$config_file" ] && [ -f "$unit_file" ]; then
    _cfg="$(sed -n 's/.*--config=\([^[:space:]]*\).*/\1/p' "$unit_file" | sed -n '$p')"
    case "$_cfg" in
        /*) config_file="$_cfg" ;;
    esac
    if [ -n "$root" ] && [ -n "$config_file" ]; then
        case "$config_file" in
            "$root"/*) ;;
            /*) config_file="${root}${config_file}" ;;
        esac
    fi
fi
if [ -z "$config_file" ]; then
    config_file="$(prefixed /etc/stalwart/config.json)"
fi

need_root() {
    if [ -n "$root" ] || [ "$dry_run" = "true" ]; then
        return 0
    fi
    if [ "$(id -u)" -ne 0 ]; then
        err "This program needs to run as root. Re-run with sudo, or preview with --dry-run."
    fi
}

service_ctl() {
    if [ "$skip_services" = "true" ] || [ -n "$root" ]; then
        say "  skip systemctl: $*"
        return 0
    fi
    systemctl "$@"
}

file_same() {
    _path="$1"
    _body="$2"
    [ -f "$_path" ] || return 1
    [ "$(cat "$_path")" = "$_body" ]
}

write_file() {
    _path="$1"
    _body="$2"
    _mode="${3:-0644}"
    if [ "$dry_run" = "true" ]; then
        return 0
    fi
    mkdir -p "$(dirname "$_path")"
    _dir="$(dirname "$_path")"
    _tmp="${_dir}/.bearmail-optimize.$$"
    printf '%s\n' "$_body" > "$_tmp"
    chmod "$_mode" "$_tmp"
    mv -f "$_tmp" "$_path"
}

detect_config_type() {
    config_type=""
    current_buffer=""
    [ -f "$config_file" ] || return 0
    if command -v python3 >/dev/null 2>&1; then
        _parsed="$(python3 -c 'import json,sys
try:
    cfg=json.load(open(sys.argv[1]))
except Exception:
    sys.exit(0)
print(cfg.get("@type") or "")
print(cfg.get("bufferSize") if cfg.get("bufferSize") is not None else "")
' "$config_file" 2>/dev/null || true)"
        config_type="$(printf '%s\n' "$_parsed" | sed -n '1p')"
        current_buffer="$(printf '%s\n' "$_parsed" | sed -n '2p')"
        return 0
    fi
    config_type="$(sed -n 's/.*"@type"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$config_file" | sed -n '1p')"
    current_buffer="$(sed -n 's/.*"bufferSize"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$config_file" | sed -n '1p')"
}

set_rocksdb_buffer() {
    if [ "$dry_run" = "true" ]; then
        return 0
    fi
    if command -v python3 >/dev/null 2>&1; then
        python3 -c '
import json, os, sys, tempfile
path, size = sys.argv[1], int(sys.argv[2])
with open(path) as fh:
    cfg = json.load(fh)
if cfg.get("@type") != "RocksDb":
    sys.exit(2)
if cfg.get("bufferSize") == size:
    sys.exit(3)
cfg["bufferSize"] = size
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path) or ".", prefix=".bearmail-config.")
try:
    with os.fdopen(fd, "w") as out:
        json.dump(cfg, out, separators=(",", ":"))
        out.write("\n")
    os.chmod(tmp, 0o644)
    os.replace(tmp, path)
except Exception:
    try:
        os.unlink(tmp)
    except OSError:
        pass
    raise
' "$config_file" "$BUFFER_SIZE"
        return $?
    fi
    if [ "$config_type" != "RocksDb" ]; then
        return 2
    fi
    if [ "$current_buffer" = "$BUFFER_SIZE" ]; then
        return 3
    fi
    _tmp="${config_file}.bearmail-new.$$"
    sed "s/\"bufferSize\"[[:space:]]*:[[:space:]]*[0-9][0-9]*/\"bufferSize\":${BUFFER_SIZE}/" \
        "$config_file" > "$_tmp"
    chmod 0644 "$_tmp"
    mv -f "$_tmp" "$config_file"
    return 0
}

host_has_enough_swap() {
    _need_kb=$((SWAP_MIB * 1024))
    if [ -n "$root" ]; then
        return 1
    fi
    if [ -r /proc/meminfo ]; then
        _kb="$(awk '/^SwapTotal:/ { print $2; exit }' /proc/meminfo 2>/dev/null || true)"
        case "$_kb" in
            ''|*[!0-9]*) ;;
            *)
                if [ "$_kb" -ge "$_need_kb" ] 2>/dev/null; then
                    return 0
                fi
                ;;
        esac
    fi
    return 1
}

fstab_has_swapfile() {
    [ -f "$fstab" ] || return 1
    grep -Eq "^[^#]*$(printf '%s' "$swapfile" | sed 's/[.[\*^$()+?{|]/\\&/g')[[:space:]]" "$fstab"
}

ops_agent_present() {
    [ -f "$ops_unit" ] || [ -f "$ops_lib_unit" ] || \
        [ -f "$(prefixed /usr/lib/systemd/system/google-cloud-ops-agent.service)" ]
}

snapd_present() {
    [ -f "$snapd_unit" ] || [ -f "$snapd_lib_unit" ] || \
        [ -f "$(prefixed /usr/lib/systemd/system/snapd.service)" ] || \
        { [ -z "$root" ] && command -v snap >/dev/null 2>&1; }
}

snap_has_user_packages() {
    _snap="${BEARMAIL_SNAP_BIN:-}"
    if [ -z "$_snap" ]; then
        if [ -n "$root" ]; then
            return 1
        fi
        command -v snap >/dev/null 2>&1 || return 1
        _snap="snap"
    fi
    "$_snap" list 2>/dev/null | awk '
        NR > 1 && $1 !~ /^(bare|core|core[0-9]+|snapd)$/ { found = 1 }
        END { exit found ? 0 : 1 }
    '
}

disk_has_swap_space() {
    _target="$(dirname "$swapfile")"
    _avail="$(df -Pk "$_target" 2>/dev/null | awk 'NR==2 { print $4; exit }')"
    case "$_avail" in
        ''|*[!0-9]*) return 0 ;;
    esac
    # Require the swap size plus 256 MiB free.
    _need_kb=$((SWAP_MIB * 1024 + 262144))
    [ "$_avail" -ge "$_need_kb" ]
}

need_root

if [ "$(uname)" != "Linux" ] && [ -z "$root" ]; then
    err "This script currently requires Linux."
fi

detect_config_type

rocks_action="skip (no config.json at ${config_file})"
rocks_restart="false"
if [ -f "$config_file" ]; then
    if [ "$config_type" != "RocksDb" ]; then
        rocks_action="skip (store type is '${config_type:-unknown}', not RocksDb)"
    elif [ "$current_buffer" = "$BUFFER_SIZE" ]; then
        rocks_action="unchanged (${BUFFER_SIZE} bytes)"
    else
        rocks_action="set bufferSize ${current_buffer:-unset} -> ${BUFFER_SIZE}"
        rocks_restart="true"
    fi
fi

swap_action="create ${SWAP_MIB} MiB at ${swapfile}"
if [ -e "$swapfile" ] && fstab_has_swapfile; then
    swap_action="unchanged (${swapfile} already listed in fstab)"
elif host_has_enough_swap; then
    swap_action="skip (host already has at least 2 GB swap)"
elif ! disk_has_swap_space; then
    swap_action="ERROR: not enough free disk for a 2 GB swap file"
fi

journald_body=$(printf '%s\n' '[Journal]' 'SystemMaxUse=50M' 'MaxRetentionSec=3day')
stalwart_mem_body=$(printf '%s\n' '[Service]' 'MemoryHigh=300M' 'MemoryMax=400M')
webui_mem_body=$(printf '%s\n' '[Service]' 'Environment=NODE_OPTIONS=--max-old-space-size=48' 'MemoryMax=80M')
sysctl_body='vm.swappiness=10'

ops_action="skip (google-cloud-ops-agent not installed)"
if ops_agent_present; then
    ops_action="disable google-cloud-ops-agent.service"
fi

snap_action="skip (snapd not installed)"
if snapd_present; then
    if snap_has_user_packages; then
        snap_action="skip (snapd has user packages; not disabling)"
    else
        snap_action="disable snapd (no user snaps)"
    fi
fi

say ""
say "BearMail small-memory plan"
say "  RocksDB:     ${rocks_action}"
say "  config:      ${config_file}"
say "  Swap:        ${swap_action}"
say "  journald:    ${journald_file}"
say "  Stalwart:    ${stalwart_dropin}"
say "  WebUI:       ${webui_dropin}"
say "  swappiness:  ${sysctl_file}"
say "  Ops Agent:   ${ops_action}"
say "  snapd:       ${snap_action}"
say "  Leaves unchanged: Caddy, DNS, ports, mail data, Stalwart caches"
say ""

if [ "$dry_run" = "true" ]; then
    say "Dry run complete. No files or services were changed."
    exit 0
fi

case "$swap_action" in
    ERROR:*) err "${swap_action#ERROR: }" ;;
esac

if [ -f "$config_file" ] && [ "$config_type" = "RocksDb" ]; then
    set +e
    set_rocksdb_buffer
    _st=$?
    set -e
    case "$_st" in
        0)
            say "Set RocksDB bufferSize to ${BUFFER_SIZE}."
            if [ -n "$root" ]; then
                :
            else
                _owner="$(ls -ld "$config_file" | awk '{ print $3":"$4 }')"
                case "$_owner" in
                    *:*) chown "$_owner" "$config_file" 2>/dev/null || true ;;
                esac
            fi
            ;;
        2) warn "config.json is not a RocksDB store; left it unchanged." ;;
        3) say "RocksDB bufferSize is already ${BUFFER_SIZE}." ;;
        *) err "Could not update ${config_file}." ;;
    esac
elif [ ! -f "$config_file" ]; then
    warn "Stalwart config.json was not found; skipped the RocksDB buffer change."
fi

if ! file_same "$journald_file" "$journald_body"; then
    write_file "$journald_file" "$journald_body" 0644
    say "Wrote ${journald_file}."
    service_ctl restart systemd-journald.service || true
    if [ "$skip_services" = "false" ] && [ -z "$root" ]; then
        journalctl --vacuum-size=50M >/dev/null 2>&1 || true
    fi
else
    say "journald cap already in place."
fi

if ! file_same "$stalwart_dropin" "$stalwart_mem_body"; then
    write_file "$stalwart_dropin" "$stalwart_mem_body" 0644
    say "Wrote ${stalwart_dropin}."
    service_ctl daemon-reload
    if [ "$rocks_restart" = "true" ]; then
        service_ctl restart stalwart.service
    else
        service_ctl try-restart stalwart.service || service_ctl restart stalwart.service
    fi
else
    say "Stalwart memory drop-in already in place."
    if [ "$rocks_restart" = "true" ]; then
        service_ctl daemon-reload
        service_ctl restart stalwart.service
    fi
fi

if ! file_same "$webui_dropin" "$webui_mem_body"; then
    write_file "$webui_dropin" "$webui_mem_body" 0644
    say "Wrote ${webui_dropin}."
    service_ctl daemon-reload
    service_ctl try-restart stalwart-webui.service || service_ctl restart stalwart-webui.service
else
    say "WebUI memory drop-in already in place."
fi

if ! file_same "$sysctl_file" "$sysctl_body"; then
    write_file "$sysctl_file" "$sysctl_body" 0644
    say "Wrote ${sysctl_file}."
fi
if [ "$skip_services" = "false" ] && [ -z "$root" ] && [ -w /proc/sys/vm/swappiness ]; then
    printf '10\n' > /proc/sys/vm/swappiness 2>/dev/null || \
        sysctl -w vm.swappiness=10 >/dev/null 2>&1 || true
fi

case "$swap_action" in
    create*)
        mkdir -p "$(dirname "$swapfile")"
        if [ ! -e "$swapfile" ]; then
            _swap_count=$((SWAP_MIB * 1024))
            if [ "$skip_services" = "true" ] || [ -n "$root" ]; then
                dd if=/dev/zero of="$swapfile" bs=1024 count="$_swap_count" status=none 2>/dev/null || \
                    dd if=/dev/zero of="$swapfile" bs=1024 count="$_swap_count" 2>/dev/null
            elif command -v fallocate >/dev/null 2>&1; then
                fallocate -l "${SWAP_MIB}M" "$swapfile" || \
                    dd if=/dev/zero of="$swapfile" bs=1024 count="$_swap_count" status=none
            else
                dd if=/dev/zero of="$swapfile" bs=1024 count="$_swap_count" status=none
            fi
            chmod 0600 "$swapfile"
            say "Created ${swapfile}."
        fi
        if [ "$skip_services" = "false" ] && [ -z "$root" ]; then
            mkswap "$swapfile" >/dev/null
            swapon "$swapfile"
        fi
        if [ ! -f "$fstab" ]; then
            : > "$fstab"
        fi
        if ! fstab_has_swapfile; then
            printf '%s none swap sw 0 0\n' "$swapfile" >> "$fstab"
            say "Added ${swapfile} to ${fstab}."
        fi
        ;;
    *)
        say "Swap: ${swap_action}."
        ;;
esac

if [ "$ops_action" = "disable google-cloud-ops-agent.service" ]; then
    service_ctl disable --now google-cloud-ops-agent.service || true
    say "Disabled Google Cloud Ops Agent."
fi

if [ "$snap_action" = "disable snapd (no user snaps)" ]; then
    service_ctl disable --now snapd.socket snapd.service snapd.seeded.socket 2>/dev/null || \
        service_ctl disable --now snapd.service || true
    say "Disabled snapd."
fi

say ""
say "Small-memory optimize complete."
say "Check: free -h; systemctl show stalwart.service -p MemoryCurrent"
