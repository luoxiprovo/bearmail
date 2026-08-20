#!/usr/bin/env sh
# shellcheck shell=dash

# Uninstall services created by this repository's combined Linux installer.

set -eu

STALWART_UNIT_FILE="/etc/systemd/system/stalwart.service"
WEBUI_UNIT_FILE="/etc/systemd/system/stalwart-webui.service"
CADDY_CONFIG_FILE="/etc/caddy/Caddyfile"
CADDY_MANAGED_MARKER="# STALWART_INSTALLER_MANAGED_CADDYFILE=1"
CADDY_CERT_SYNC_SCRIPT="/usr/local/libexec/stalwart-caddy-cert-sync"
CADDY_CERT_SYNC_SERVICE="/etc/systemd/system/stalwart-caddy-cert-sync.service"
CADDY_CERT_SYNC_TIMER="/etc/systemd/system/stalwart-caddy-cert-sync.timer"

purge="false"
assume_yes="false"
dry_run="false"
remove_private_node="false"
stalwart_prefix_override=""
webui_prefix_override=""

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
Usage: sudo sh ./uninstall.sh [OPTIONS]

Uninstalls Stalwart and the Mail/Calendar WebUI services installed by the
repository's combined installer.

Options:
  --purge                 Also delete Stalwart configuration, mail data, logs,
                          installer state, and the service accounts.
  --remove-private-node   Delete the installer-managed private Node.js version
                          if no other systemd unit references it.
  --stalwart-prefix PATH  Override a custom Stalwart installation prefix when
                          the installed unit is missing or cannot be inspected.
  --webui-prefix PATH     Override the WebUI installation prefix.
  --yes                   Do not ask for confirmation.
  --dry-run               Print the detected targets without changing anything.
  -h, --help              Show this help.

Without --purge, configuration, mail data, logs, and service accounts are kept
so the server can be reinstalled without losing mail.
EOF
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --purge)
            purge="true"
            shift
            ;;
        --remove-private-node)
            remove_private_node="true"
            shift
            ;;
        --stalwart-prefix)
            [ "$#" -ge 2 ] || err "Missing path after --stalwart-prefix."
            stalwart_prefix_override="$2"
            shift 2
            ;;
        --webui-prefix)
            [ "$#" -ge 2 ] || err "Missing path after --webui-prefix."
            webui_prefix_override="$2"
            shift 2
            ;;
        --yes)
            assume_yes="true"
            shift
            ;;
        --dry-run)
            dry_run="true"
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            err "Unknown option: $1"
            ;;
    esac
done

if [ "$dry_run" = "false" ] && [ "$(id -u)" -ne 0 ]; then
    err "Run this script as root, for example: sudo sh ./uninstall.sh"
fi

command -v sed >/dev/null 2>&1 || err "Required command not found: sed"
command -v find >/dev/null 2>&1 || err "Required command not found: find"
command -v grep >/dev/null 2>&1 || err "Required command not found: grep"

unit_value() {
    _unit_path="$1"
    _unit_key="$2"
    sed -n "s/^${_unit_key}=//p" "$_unit_path" 2>/dev/null | sed -n '$p'
}

trim_trailing_slashes() {
    _trimmed_path="$1"
    while [ "$_trimmed_path" != "/" ] && [ "${_trimmed_path%/}" != "$_trimmed_path" ]; do
        _trimmed_path="${_trimmed_path%/}"
    done
    printf '%s\n' "$_trimmed_path"
}

# Standard-layout defaults are replaced with values recovered from the units.
stalwart_binary="/usr/local/bin/stalwart"
stalwart_config="/etc/stalwart/config.json"
stalwart_env="/etc/stalwart/stalwart.env"
stalwart_conf_dir="/etc/stalwart"
stalwart_data_dir="/var/lib/stalwart"
stalwart_log_dir="/var/log/stalwart"
stalwart_user="stalwart"
stalwart_prefix=""

if [ -f "$STALWART_UNIT_FILE" ]; then
    stalwart_exec_line="$(unit_value "$STALWART_UNIT_FILE" "ExecStart")"
    detected_binary="$(printf '%s\n' "$stalwart_exec_line" | sed -n 's/^\([^[:space:]]*\).*/\1/p')"
    detected_config="$(printf '%s\n' "$stalwart_exec_line" | sed -n 's/^.*[[:space:]]--config=\([^[:space:]]*\).*$/\1/p')"
    detected_env="$(unit_value "$STALWART_UNIT_FILE" "EnvironmentFile")"
    detected_env="${detected_env#-}"
    detected_user="$(unit_value "$STALWART_UNIT_FILE" "User")"
    [ -n "$detected_binary" ] && stalwart_binary="$detected_binary"
    [ -n "$detected_config" ] && stalwart_config="$detected_config"
    [ -n "$detected_env" ] && stalwart_env="$detected_env"
    [ -n "$detected_user" ] && stalwart_user="$detected_user"

    case "$stalwart_binary" in
        */bin/stalwart)
            detected_prefix="${stalwart_binary%/bin/stalwart}"
            if [ "$detected_prefix" != "/usr/local" ] || [ "$stalwart_config" != "/etc/stalwart/config.json" ]; then
                stalwart_prefix="$detected_prefix"
                stalwart_conf_dir="${stalwart_config%/config.json}"
                stalwart_data_dir="${stalwart_prefix}/data"
                stalwart_log_dir="${stalwart_prefix}/logs"
            fi
            ;;
    esac
fi

if [ -n "$stalwart_prefix_override" ]; then
    stalwart_prefix="$(trim_trailing_slashes "$stalwart_prefix_override")"
    stalwart_binary="${stalwart_prefix}/bin/stalwart"
    stalwart_conf_dir="${stalwart_prefix}/etc"
    stalwart_config="${stalwart_conf_dir}/config.json"
    stalwart_env="${stalwart_conf_dir}/stalwart.env"
    stalwart_data_dir="${stalwart_prefix}/data"
    stalwart_log_dir="${stalwart_prefix}/logs"
fi

webui_prefix="/opt/stalwart-webui"
webui_node=""
webui_user="stalwart-webui"

if [ -f "$WEBUI_UNIT_FILE" ]; then
    detected_webui_prefix="$(unit_value "$WEBUI_UNIT_FILE" "WorkingDirectory")"
    webui_exec_line="$(unit_value "$WEBUI_UNIT_FILE" "ExecStart")"
    detected_node="$(printf '%s\n' "$webui_exec_line" | sed -n 's/^\([^[:space:]]*\).*/\1/p')"
    detected_webui_user="$(unit_value "$WEBUI_UNIT_FILE" "User")"
    [ -n "$detected_webui_prefix" ] && webui_prefix="$detected_webui_prefix"
    [ -n "$detected_node" ] && webui_node="$detected_node"
    [ -n "$detected_webui_user" ] && webui_user="$detected_webui_user"
fi

if [ -n "$webui_prefix_override" ]; then
    webui_prefix="$(trim_trailing_slashes "$webui_prefix_override")"
fi

private_node_dir=""
case "$webui_node" in
    /opt/stalwart-node/*/bin/node)
        private_node_dir="${webui_node%/bin/node}"
        ;;
esac

managed_caddy="false"
if [ -f "$CADDY_CONFIG_FILE" ] && [ ! -L "$CADDY_CONFIG_FILE" ] && \
    grep -F -q "$CADDY_MANAGED_MARKER" "$CADDY_CONFIG_FILE"
then
    managed_caddy="true"
fi

validate_path() {
    _path="$1"
    _label="$2"
    case "$_path" in
        /*) ;;
        *) err "Refusing non-absolute ${_label}: ${_path}" ;;
    esac
    case "$_path" in
        *[!A-Za-z0-9_./-]*) err "Refusing ${_label} with unsupported characters: ${_path}" ;;
    esac
    case "$_path" in
        *//*|*/./*|*/.|*/../*|*/..) err "Refusing non-normalized ${_label}: ${_path}" ;;
    esac
}

validate_tree_target() {
    _path="$1"
    _label="$2"
    validate_path "$_path" "$_label"
    case "$_path" in
        /|/bin|/boot|/dev|/etc|/home|/lib|/lib64|/opt|/proc|/root|/run|/sbin|/srv|/sys|/tmp|/usr|/usr/local|/var|/var/lib|/var/log)
            err "Refusing unsafe directory target for ${_label}: ${_path}"
            ;;
    esac
    if [ -L "$_path" ]; then
        err "Refusing symbolic-link directory target for ${_label}: ${_path}"
    fi
}

validate_path "$stalwart_binary" "Stalwart binary"
validate_tree_target "$webui_prefix" "WebUI prefix"
validate_tree_target "${WEBUI_UNIT_FILE}.d" "WebUI systemd drop-ins"
validate_tree_target "${STALWART_UNIT_FILE}.d" "Stalwart systemd drop-ins"
if [ "$purge" = "true" ]; then
    validate_tree_target "$stalwart_conf_dir" "Stalwart configuration"
    validate_tree_target "$stalwart_data_dir" "Stalwart mail data"
    validate_tree_target "$stalwart_log_dir" "Stalwart logs"
fi
if [ "$remove_private_node" = "true" ] && [ -n "$private_node_dir" ]; then
    validate_tree_target "$private_node_dir" "private Node.js runtime"
fi

say ""
say "Stalwart + WebUI uninstall plan"
say "  Stalwart unit:    ${STALWART_UNIT_FILE}"
say "  WebUI unit:       ${WEBUI_UNIT_FILE}"
say "  Stalwart binary:  ${stalwart_binary}"
say "  WebUI files:      ${webui_prefix}"
if [ "$purge" = "true" ]; then
    say "  Configuration:    DELETE ${stalwart_conf_dir}"
    say "  Mail data:        DELETE ${stalwart_data_dir}"
    say "  Logs:             DELETE ${stalwart_log_dir}"
    say "  Service accounts: DELETE ${stalwart_user}, ${webui_user}"
else
    say "  Configuration:    KEEP ${stalwart_conf_dir}"
    say "  Mail data:        KEEP ${stalwart_data_dir}"
    say "  Logs:             KEEP ${stalwart_log_dir}"
    say "  Service accounts: KEEP"
fi
if [ "$remove_private_node" = "true" ]; then
    if [ -n "$private_node_dir" ]; then
        say "  Private Node.js:  DELETE ${private_node_dir} if unused"
    else
        say "  Private Node.js:  no installer-managed runtime detected"
    fi
else
    say "  Private Node.js:  KEEP"
fi
if [ "$managed_caddy" = "true" ]; then
    say "  Caddy routes:     REMOVE installer-managed Caddyfile and sync units"
    say "  Caddy package:    KEEP"
else
    say "  Caddy routes:     KEEP (no installer-managed Caddyfile detected)"
fi
say ""

if [ "$dry_run" = "true" ]; then
    say "Dry run complete. No files, services, or accounts were changed."
    exit 0
fi

if [ "$assume_yes" = "false" ]; then
    if ! (exec 3<> /dev/tty) 2>/dev/null; then
        err "An interactive terminal is required unless --yes is used."
    fi
    exec 3<> /dev/tty
    if [ "$purge" = "true" ]; then
        confirmation_word="PURGE"
        say "PURGE permanently deletes configuration and all stored mail."
    else
        confirmation_word="UNINSTALL"
        say "Mail data and configuration will be preserved."
    fi
    printf 'Type %s to continue: ' "$confirmation_word" >&3
    IFS= read -r confirmation <&3 || err "Confirmation input ended."
    [ "$confirmation" = "$confirmation_word" ] || err "Uninstall cancelled."
fi

stop_and_disable() {
    _unit="$1"
    if systemctl list-unit-files "$_unit" >/dev/null 2>&1 || systemctl status "$_unit" >/dev/null 2>&1; then
        say "Stopping and disabling ${_unit}..."
        systemctl disable --now "$_unit" >/dev/null 2>&1 || {
            systemctl stop "$_unit" >/dev/null 2>&1 || warn "Could not stop ${_unit}."
            systemctl disable "$_unit" >/dev/null 2>&1 || warn "Could not disable ${_unit}."
        }
    fi
}

remove_file() {
    _path="$1"
    _label="$2"
    if [ -e "$_path" ] || [ -L "$_path" ]; then
        say "Removing ${_label}: ${_path}"
        rm -f "$_path"
    fi
}

remove_tree() {
    _path="$1"
    _label="$2"
    if [ -e "$_path" ]; then
        say "Removing ${_label}: ${_path}"
        find "$_path" -depth -delete
    fi
}

node_used_elsewhere() {
    _node="$1"
    grep -R -l -F "$_node" \
        /etc/systemd/system /run/systemd/system /usr/lib/systemd/system /lib/systemd/system \
        2>/dev/null | grep -v '/stalwart-webui.service$' | grep -q .
}

delete_account() {
    _account="$1"
    if id "$_account" >/dev/null 2>&1; then
        if command -v getent >/dev/null 2>&1; then
            _account_entry="$(getent passwd "$_account" 2>/dev/null || true)"
            _account_shell="${_account_entry##*:}"
            case "$_account_shell" in
                /usr/sbin/nologin|/sbin/nologin|/bin/false) ;;
                *)
                    warn "Keeping account ${_account}; it does not use a system nologin shell."
                    return 0
                    ;;
            esac
        fi
        say "Removing service account: ${_account}"
        userdel "$_account" >/dev/null 2>&1 || warn "Could not remove service account ${_account}."
    fi
    if command -v getent >/dev/null 2>&1 && getent group "$_account" >/dev/null 2>&1; then
        groupdel "$_account" >/dev/null 2>&1 || warn "Could not remove service group ${_account}."
    fi
}

command -v systemctl >/dev/null 2>&1 || err "systemd is required to remove these services."
stop_and_disable "stalwart-caddy-cert-sync.timer"
stop_and_disable "stalwart-caddy-cert-sync.service"
stop_and_disable "stalwart-webui.service"
stop_and_disable "stalwart.service"
if [ "$managed_caddy" = "true" ]; then
    stop_and_disable "caddy.service"
fi

remove_file "$WEBUI_UNIT_FILE" "WebUI systemd unit"
remove_file "$STALWART_UNIT_FILE" "Stalwart systemd unit"
remove_file "$CADDY_CERT_SYNC_TIMER" "Caddy certificate synchronization timer"
remove_file "$CADDY_CERT_SYNC_SERVICE" "Caddy certificate synchronization service"
remove_file "$CADDY_CERT_SYNC_SCRIPT" "Caddy certificate synchronization script"
if [ "$managed_caddy" = "true" ]; then
    remove_file "$CADDY_CONFIG_FILE" "installer-managed Caddy configuration"
fi
remove_tree "${WEBUI_UNIT_FILE}.d" "WebUI systemd drop-ins"
remove_tree "${STALWART_UNIT_FILE}.d" "Stalwart systemd drop-ins"
systemctl daemon-reload
systemctl reset-failed stalwart.service stalwart-webui.service \
    stalwart-caddy-cert-sync.service caddy.service >/dev/null 2>&1 || true

remove_tree "$webui_prefix" "WebUI files"
remove_file "$stalwart_binary" "Stalwart binary"

if [ -n "$stalwart_prefix" ]; then
    rmdir "${stalwart_prefix}/bin" >/dev/null 2>&1 || true
fi

if [ "$purge" = "true" ]; then
    remove_tree "$stalwart_conf_dir" "Stalwart configuration and installer state"
    remove_tree "$stalwart_data_dir" "Stalwart mail data"
    remove_tree "$stalwart_log_dir" "Stalwart logs"
    if [ -n "$stalwart_prefix" ]; then
        rmdir "$stalwart_prefix" >/dev/null 2>&1 || true
    fi
    delete_account "$webui_user"
    if [ "$stalwart_user" != "$webui_user" ]; then
        delete_account "$stalwart_user"
    fi
fi

if [ "$remove_private_node" = "true" ] && [ -n "$private_node_dir" ]; then
    if node_used_elsewhere "$webui_node"; then
        warn "Keeping ${private_node_dir}; another systemd unit references ${webui_node}."
    else
        remove_tree "$private_node_dir" "private Node.js runtime"
        rmdir "/opt/stalwart-node" >/dev/null 2>&1 || true
    fi
fi

say ""
say "Uninstall complete."
if [ "$purge" = "false" ]; then
    say "Configuration and mail data were preserved. Reinstalling can reuse them."
fi
say "DNS records, firewall rules, backups, source checkouts, and the original"
say "installation artifacts were not removed. The Caddy package and certificate"
say "storage were kept; an installer-managed Caddyfile was removed when detected."
