#!/usr/bin/env sh
# shellcheck shell=dash

#
# SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
#
# SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
#

# Stalwart install script -- based on the rustup installation script.

set -e
set -u

readonly DEFAULT_REPOSITORY="https://github.com/valuerouterDev/stalwart.git"
readonly STANDARD_FEATURES="sqlite postgres mysql rocks s3 redis azure nats"
readonly FOUNDATIONDB_FEATURES="foundationdb s3 redis azure nats"

main() {
    # Installation and setup answers are deliberately not accepted as command
    # line arguments. This keeps the curl-pipe invocation simple and prevents
    # secrets from appearing in shell history or process listings.
    while [ $# -gt 0 ]; do
        case "$1" in
            -h|--help)
                print_usage
                return 0
                ;;
            *)
                err "❌ Unknown argument: $1. Run install.sh without arguments for interactive setup."
                ;;
        esac
    done

    if ! (exec 3<> /dev/tty) 2>/dev/null; then
        err "❌ Install failed: An interactive terminal is required. Open a terminal and run the installer again."
    fi
    exec 3<> /dev/tty

    need_cmd uname
    need_cmd mktemp
    need_cmd chmod
    need_cmd chown
    need_cmd mkdir
    need_cmd rm
    need_cmd cp
    need_cmd env
    need_cmd hostname
    need_cmd id
    need_cmd dirname

    # Require root
    if [ "$(id -u)" -ne 0 ]; then
        err "❌ Install failed: This program needs to run as root."
    fi

    # Detect OS
    local _os _uname _account
    _uname="$(uname)"
    case "$_uname" in
        Linux)   _os="linux"; _account="stalwart" ;;
        Darwin)  _os="macos"; _account="_stalwart" ;;
        FreeBSD) _os="freebsd"; _account="stalwart" ;;
        *)       err "❌ Install failed: Unsupported OS: $_uname" ;;
    esac

    say ""
    say "┌─────────────────────────────────────────────────────────┐"
    say "│              Stalwart Server Installer                  │"
    say "└─────────────────────────────────────────────────────────┘"
    say ""

    # Select the filesystem layout interactively.
    local _prefix=""
    prompt_menu "Installation layout" 1 \
        "Standard system paths (recommended)" \
        "Custom self-contained prefix"
    if [ "$RETVAL" -eq 2 ]; then
        prompt_text "Absolute installation prefix" "/opt/stalwart"
        _prefix="$RETVAL"
        case "$_prefix" in
            /*) ;;
            *) err "❌ Install failed: The installation prefix must be an absolute path." ;;
        esac
        while [ "${_prefix%/}" != "$_prefix" ]; do
            _prefix="${_prefix%/}"
        done
        if [ -z "$_prefix" ]; then
            err "❌ Install failed: '/' cannot be used as a custom installation prefix."
        fi
    fi

    # Derive install paths — FHS by default, self-contained under a custom prefix
    local _bin_dir _bin_file _conf_dir _log_dir _data_dir _env_file _config_file
    if [ -z "$_prefix" ]; then
        _bin_dir="/usr/local/bin"
        _log_dir="/var/log/stalwart"
        if [ "$_os" = "freebsd" ]; then
            # hier(7): third-party config lives under /usr/local/etc,
            # variable data under /var/db
            _conf_dir="/usr/local/etc/stalwart"
            _data_dir="/var/db/stalwart"
        else
            _conf_dir="/etc/stalwart"
            _data_dir="/var/lib/stalwart"
        fi
    else
        _bin_dir="${_prefix}/bin"
        _conf_dir="${_prefix}/etc"
        _log_dir="${_prefix}/logs"
        _data_dir="${_prefix}/data"
    fi
    _bin_file="${_bin_dir}/stalwart"
    _config_file="${_conf_dir}/config.json"
    _env_file="${_conf_dir}/stalwart.env"

    # Select how to obtain a binary. Building this revision is the default so
    # the installed executable always contains this interactive setup wizard.
    local _source_mode _source_ref _build_profile="standard" _existing_binary=""
    local _cargo_bin="" _build_user=""
    local _script_dir=""
    prompt_menu "Binary source" 1 \
        "Build this Stalwart revision from source" \
        "Use an existing compatible Stalwart binary"
    _source_mode="$RETVAL"
    if [ "$_source_mode" -eq 1 ]; then
        if [ -n "${SUDO_USER:-}" ] && [ "$SUDO_USER" != "root" ] && check_cmd sudo; then
            _cargo_bin="$(sudo -H -u "$SUDO_USER" sh -lc 'command -v cargo' 2>/dev/null || true)"
            if [ -n "$_cargo_bin" ] && [ -x "$_cargo_bin" ]; then
                _build_user="$SUDO_USER"
            fi
        fi
        if [ -z "$_cargo_bin" ] && check_cmd cargo; then
            _cargo_bin="$(command -v cargo)"
        fi
        if [ -z "$_cargo_bin" ] || [ ! -x "$_cargo_bin" ]; then
            err "need 'cargo' (install Rust for root or for the user invoking sudo)"
        fi
        local _source_default="$DEFAULT_REPOSITORY"
        _script_dir="$(CDPATH= cd "$(dirname "$0")" 2>/dev/null && pwd || true)"
        if [ -n "$_script_dir" ] && [ -f "${_script_dir}/Cargo.toml" ] && [ -f "${_script_dir}/crates/main/Cargo.toml" ]; then
            _source_default="$_script_dir"
        fi
        prompt_text "Source checkout path or Git repository" "$_source_default"
        _source_ref="$RETVAL"
        if [ ! -d "$_source_ref" ]; then
            need_cmd git
        elif [ ! -f "${_source_ref}/Cargo.toml" ] || [ ! -f "${_source_ref}/crates/main/Cargo.toml" ]; then
            err "❌ Install failed: ${_source_ref} is not a Stalwart source checkout."
        fi
        prompt_menu "Build profile" 1 \
            "Standard (all regular bootstrap backends)" \
            "FoundationDB-enabled (requires FoundationDB client libraries)"
        if [ "$RETVAL" -eq 2 ]; then
            _build_profile="foundationdb"
        fi
    else
        prompt_text "Path to the compatible Stalwart binary" ""
        _existing_binary="$RETVAL"
        if [ ! -f "$_existing_binary" ] || [ ! -x "$_existing_binary" ]; then
            err "❌ Install failed: The supplied binary must be an executable regular file."
        fi
    fi

    say ""
    say "Installation summary"
    say "  Binary:       ${_bin_file}"
    say "  Configuration:${_config_file}"
    say "  Data:         ${_data_dir}"
    say "  Logs:         ${_log_dir}"
    if [ "$_source_mode" -eq 1 ]; then
        say "  Source:       ${_source_ref}"
        say "  Build profile:${_build_profile}"
    else
        say "  Source binary:${_existing_binary}"
    fi
    say ""
    if ! prompt_yes_no "Build/install the binary and start interactive server setup" "no"; then
        err "Installation cancelled; no system files were changed."
    fi

    # Acquire/build the binary before changing accounts, install paths, or
    # service definitions. Build failures therefore leave the system untouched.
    local _tmp="" _source_dir="" _source_binary="" _features=""
    _tmp="$(mktemp -d)"
    cleanup_dir="$_tmp"
    trap cleanup 0 HUP INT TERM
    if [ "$_source_mode" -eq 1 ]; then
        if [ -d "$_source_ref" ]; then
            _source_dir="$(CDPATH= cd "$_source_ref" && pwd)"
        else
            say "⏳ Cloning ${_source_ref}..."
            ensure git clone --depth 1 "$_source_ref" "${_tmp}/source"
            _source_dir="${_tmp}/source"
            if [ ! -f "${_source_dir}/Cargo.toml" ] || [ ! -f "${_source_dir}/crates/main/Cargo.toml" ]; then
                err "❌ Install failed: The cloned repository is not a Stalwart source checkout."
            fi
        fi
        if [ "$_build_profile" = "foundationdb" ]; then
            _features="$FOUNDATIONDB_FEATURES"
        else
            _features="$STANDARD_FEATURES"
        fi
        say "⏳ Building Stalwart (${_build_profile} profile)..."
        if [ -n "$_build_user" ]; then
            ensure chown -R "$_build_user" "$_tmp"
            ensure sudo -H -u "$_build_user" env CARGO_TARGET_DIR="${_tmp}/target" \
                "$_cargo_bin" build \
                --manifest-path "${_source_dir}/Cargo.toml" \
                --release \
                --package stalwart \
                --locked \
                --no-default-features \
                --features "$_features"
        else
            ensure env CARGO_TARGET_DIR="${_tmp}/target" "$_cargo_bin" build \
                --manifest-path "${_source_dir}/Cargo.toml" \
                --release \
                --package stalwart \
                --locked \
                --no-default-features \
                --features "$_features"
        fi
        _source_binary="${_tmp}/target/release/stalwart"
        if [ ! -x "$_source_binary" ]; then
            err "❌ Install failed: Cargo completed without producing ${_source_binary}."
        fi
    else
        _source_binary="$_existing_binary"
    fi

    # Fail before changing the server if the selected binary does not contain
    # the command-line setup implementation required by this installer.
    local _setup_help=""
    if ! _setup_help="$("$_source_binary" --setup --help 2>/dev/null)"; then
        err "❌ Install failed: The selected binary is not compatible with this installer's command-line setup."
    fi
    case "$_setup_help" in
        *"Quick setup asks only"*) ;;
        *) err "❌ Install failed: The selected binary predates this installer's quick setup and DNS table. Rebuild it from this source revision." ;;
    esac

    # Create service account
    create_account "$_os" "$_account"

    # Create directories
    ensure mkdir -p "$_bin_dir" "$_conf_dir" "$_log_dir" "$_data_dir"

    # Install the selected binary.
    say "📦 Installing Stalwart at ${_bin_file}..."
    if [ "$_source_binary" != "$_bin_file" ]; then
        ensure cp "$_source_binary" "$_bin_file"
    fi
    ensure chmod 0755 "$_bin_file"
    cleanup
    trap - 0 HUP INT TERM

    # Create env file if absent (preserve user edits on reinstall)
    if [ ! -e "$_env_file" ]; then
        say "📝 Writing env file at ${_env_file}..."
        write_env_file "$_env_file"
    fi

    # Complete initial setup before installing or starting the service. Never
    # treat an empty or non-regular config path as an initialized server.
    if [ -e "$_config_file" ] && [ ! -f "$_config_file" ]; then
        err "❌ Install failed: ${_config_file} exists but is not a regular file. Move it aside, then rerun the installer."
    fi
    if [ -f "$_config_file" ] && [ ! -s "$_config_file" ]; then
        err "❌ Install failed: ${_config_file} is empty. Move it aside, then rerun the installer so initialization can complete."
    fi
    if [ ! -e "$_config_file" ]; then
        local _public_ipv4="" _public_ipv6=""
        say "🌐 Detecting this server's public IP addresses..."
        detect_public_ip 4
        _public_ipv4="$RETVAL"
        detect_public_ip 6
        _public_ipv6="$RETVAL"
        if [ -n "$_public_ipv4" ]; then
            say "   Public IPv4: ${_public_ipv4}"
        else
            say "   Public IPv4: not detected (advanced setup can enter it manually)"
        fi
        if [ -n "$_public_ipv6" ]; then
            say "   Public IPv6: ${_public_ipv6}"
        else
            say "   Public IPv6: not detected (optional)"
        fi
        say "🧭 Starting interactive command-line setup..."
        if ! env \
            STALWART_SETUP_DATA_PATH="$_data_dir" \
            STALWART_SETUP_LOG_PATH="$_log_dir" \
            STALWART_SETUP_PUBLIC_IPV4="$_public_ipv4" \
            STALWART_SETUP_PUBLIC_IPV6="$_public_ipv6" \
            "$_bin_file" --config="$_config_file" --setup <&3
        then
            err "❌ Command-line setup failed. Correct the error, then rerun the installer. The service was not installed or started."
        fi
        if [ ! -f "$_config_file" ] || [ ! -s "$_config_file" ]; then
            err "❌ Command-line setup returned without creating a non-empty ${_config_file}. The service was not installed or started."
        fi
    else
        say "ℹ️  Preserving existing configuration at ${_config_file}; setup skipped."
    fi

    # Ownership and permissions
    say "🔐 Setting permissions..."
    ensure chown -R "${_account}:${_account}" "$_conf_dir" "$_log_dir" "$_data_dir"
    ensure chmod 0750 "$_conf_dir" "$_log_dir" "$_data_dir"
    ensure chown "root:${_account}" "$_env_file"
    ensure chmod 0640 "$_env_file"

    # Install and start the service
    say "🚀 Starting service..."
    case "$_os" in
        linux)
            if check_cmd systemctl; then
                create_service_linux_systemd "$_bin_file" "$_config_file" "$_env_file" "$_account"
            else
                create_service_linux_initd "$_bin_file" "$_config_file" "$_env_file" "$_account"
            fi
            ;;
        macos)
            create_service_macos "$_bin_file" "$_config_file" "$_env_file" "$_account"
            ;;
        freebsd)
            create_service_freebsd "$_bin_file" "$_config_file" "$_env_file" "$_account" "$_log_dir"
            ;;
    esac

    # Completion message
    local _host
    _host="$(hostname -f 2>/dev/null || hostname)"
    say ""
    say "🎉 Installation complete!"
    say ""
    say "Stalwart is configured and running on ${_host}."
    say "For the internal directory, use the administrator credential printed by the setup wizard."
    say "Review the DNS checklist printed by the wizard and verify DNS after startup."
    say ""

    return 0
}

print_usage() {
    cat <<'EOF'
Usage: install.sh

Interactively build and install Stalwart, configure its initial bootstrap
settings, and start the platform service.

No installation or setup answer is accepted as a command-line parameter. The
installer asks for the filesystem layout, binary source, optional FoundationDB
build, and confirmation. Quick setup asks only for the server hostname and mail
domain, keeps all other defaults, and uses best-effort detected public IPs.
Advanced setup exposes the complete WebUI bootstrap form in the terminal,
including nested storage, directory, logging, and DNS-provider settings.

After setup, DNS records are printed in aligned TYPE, HOST, ANSWER, TTL, and
PRIO columns. A fresh install cannot start the service unless setup creates a
non-empty configuration file.

Options:
  -h, --help  Show this help.

The interactive standard-layout choice uses these FHS paths:
  binary   /usr/local/bin/stalwart
  config   /etc/stalwart/config.json      (/usr/local/etc/stalwart/config.json on FreeBSD)
  env      /etc/stalwart/stalwart.env     (/usr/local/etc/stalwart/stalwart.env on FreeBSD)
  logs     /var/log/stalwart/
  data     /var/lib/stalwart/             (/var/db/stalwart on FreeBSD)

The interactive custom-prefix choice uses a self-contained layout:
  binary   $PREFIX/bin/stalwart
  config   $PREFIX/etc/config.json
  env      $PREFIX/etc/stalwart.env
  logs     $PREFIX/logs/
  data     $PREFIX/data/
EOF
}

prompt_menu() {
    local _label="$1" _default="$2" _count _index _answer _choice
    shift 2
    _count=$#
    while true; do
        printf '%s:\n' "$_label" >&3
        _index=1
        for _choice in "$@"; do
            if [ "$_index" -eq "$_default" ]; then
                printf '  %s) %s (default)\n' "$_index" "$_choice" >&3
            else
                printf '  %s) %s\n' "$_index" "$_choice" >&3
            fi
            _index=$((_index + 1))
        done
        printf 'Select %s [%s]: ' "$_label" "$_default" >&3
        if ! IFS= read -r _answer <&3; then
            err "❌ Install failed: Interactive input ended before setup completed."
        fi
        if [ -z "$_answer" ]; then
            _answer="$_default"
        fi
        case "$_answer" in
            *[!0-9]*|'') ;;
            *)
                if [ "$_answer" -ge 1 ] 2>/dev/null && [ "$_answer" -le "$_count" ] 2>/dev/null; then
                    RETVAL="$_answer"
                    return 0
                fi
                ;;
        esac
        printf '  Choose a number from 1 to %s.\n' "$_count" >&3
    done
}

prompt_text() {
    local _label="$1" _default="$2" _answer
    while true; do
        if [ -n "$_default" ]; then
            printf '%s [%s]: ' "$_label" "$_default" >&3
        else
            printf '%s: ' "$_label" >&3
        fi
        if ! IFS= read -r _answer <&3; then
            err "❌ Install failed: Interactive input ended before setup completed."
        fi
        if [ -z "$_answer" ]; then
            _answer="$_default"
        fi
        if [ -n "$_answer" ]; then
            RETVAL="$_answer"
            return 0
        fi
        printf '  A value is required.\n' >&3
    done
}

prompt_yes_no() {
    local _label="$1" _default="$2" _answer _suffix
    if [ "$_default" = "yes" ]; then
        _suffix="Y/n"
    else
        _suffix="y/N"
    fi
    while true; do
        printf '%s [%s]: ' "$_label" "$_suffix" >&3
        if ! IFS= read -r _answer <&3; then
            err "❌ Install failed: Interactive input ended before setup completed."
        fi
        case "$_answer" in
            '') [ "$_default" = "yes" ] && return 0 || return 1 ;;
            y|Y|yes|Yes|YES) return 0 ;;
            n|N|no|No|NO) return 1 ;;
            *) printf '  Answer yes or no.\n' >&3 ;;
        esac
    done
}

# Detect the public address observed by an external HTTPS service. Detection is
# best-effort: the Rust wizard validates the result and advanced setup permits
# manual correction when outbound HTTPS or an address family is unavailable.
detect_public_ip() {
    local _family="$1" _url _ip=""
    if [ "$_family" -eq 4 ]; then
        _url="https://api.ipify.org"
    else
        _url="https://api6.ipify.org"
    fi

    if check_cmd curl; then
        _ip="$(curl \
            --proto '=https' \
            --tlsv1.2 \
            --silent \
            --show-error \
            --fail \
            --location \
            --connect-timeout 5 \
            --max-time 8 \
            "-${_family}" \
            "$_url" 2>/dev/null || true)"
    elif check_cmd wget; then
        _ip="$(wget \
            --quiet \
            --output-document=- \
            --timeout=8 \
            --tries=1 \
            "-${_family}" \
            "$_url" 2>/dev/null || true)"
    fi

    case "$_family:$_ip" in
        4:*[!0-9.]*|4:|6:*[!0-9a-fA-F:.]*|6:) RETVAL="" ;;
        *) RETVAL="$_ip" ;;
    esac
}

cleanup() {
    if [ -n "${cleanup_dir:-}" ] && [ -d "$cleanup_dir" ]; then
        rm -rf "$cleanup_dir"
    fi
    cleanup_dir=""
}

write_env_file() {
    cat > "$1" <<'EOF'
# Environment variables for the Stalwart service.
# Uncomment and edit an entry to override its default.

# Override the hostname used in HTTP responses
#STALWART_HOSTNAME=mail.example.com

# Override the public base URL published in OAuth, OIDC, and JMAP discovery
# documents. Accepts scheme, host, optional port, and optional path prefix.
#STALWART_PUBLIC_URL=https://mail.example.com

# Enable bootstrap / recovery mode on startup. Accepted: 1, true. Default: false.
#STALWART_RECOVERY_MODE=true

# Log level while in recovery mode. Default: info.
#STALWART_RECOVERY_MODE_LOG_LEVEL=debug

# HTTP port used in recovery mode. Default: 8080.
#STALWART_RECOVERY_MODE_PORT=9090

# Fixed administrator credentials — format: username:password
# Default: a temporary random password is generated and printed to the logs.
#STALWART_RECOVERY_ADMIN=admin:changeme

# Cluster role assigned to this node. Must match a role name defined in the
# cluster registry. Leave unset for a standalone (non-clustered) deployment.
#STALWART_ROLE=primary

# Push-notification shard this node is responsible for, when running in a
# cluster.
#STALWART_PUSH_SHARD=1
EOF
}

create_account() {
    local _os="$1"
    local _account="$2"
    if id -u "$_account" > /dev/null 2>&1; then
        return 0
    fi
    say "🖥️  Creating '${_account}' account..."
    if [ "$_os" = "macos" ]; then
        local _last_uid _last_gid _uid _gid
        _last_uid="$(dscacheutil -q user | grep uid | awk '{print $2}' | sort -n | tail -n 1)"
        _last_gid="$(dscacheutil -q group | grep gid | awk '{print $2}' | sort -n | tail -n 1)"
        _uid="$((_last_uid+1))"
        _gid="$((_last_gid+1))"

        ensure dscl /Local/Default -create Groups/_stalwart
        ensure dscl /Local/Default -create Groups/_stalwart Password \*
        ensure dscl /Local/Default -create Groups/_stalwart PrimaryGroupID $_gid
        ensure dscl /Local/Default -create Groups/_stalwart RealName "Stalwart service"
        ensure dscl /Local/Default -create Groups/_stalwart RecordName _stalwart stalwart

        ensure dscl /Local/Default -create Users/_stalwart
        ensure dscl /Local/Default -create Users/_stalwart NFSHomeDirectory /var/empty
        ensure dscl /Local/Default -create Users/_stalwart Password \*
        ensure dscl /Local/Default -create Users/_stalwart PrimaryGroupID $_gid
        ensure dscl /Local/Default -create Users/_stalwart RealName "Stalwart service"
        ensure dscl /Local/Default -create Users/_stalwart RecordName _stalwart stalwart
        ensure dscl /Local/Default -create Users/_stalwart UniqueID $_uid
        ensure dscl /Local/Default -create Users/_stalwart UserShell /usr/bin/false

        ensure dscl /Local/Default -delete /Users/_stalwart AuthenticationAuthority
        ensure dscl /Local/Default -delete /Users/_stalwart PasswordPolicyOptions
    elif [ "$_os" = "freebsd" ]; then
        ensure pw useradd -n "$_account" -c "Stalwart service" -d /nonexistent -s /usr/sbin/nologin -w no
    else
        ensure useradd "$_account" -s /usr/sbin/nologin -M -r -U
    fi
}

create_service_linux_systemd() {
    local _bin="$1" _config="$2" _env="$3" _user="$4"
    cat > /etc/systemd/system/stalwart.service <<EOF
[Unit]
Description=Stalwart
Conflicts=postfix.service sendmail.service exim4.service
After=network-online.target

[Service]
Type=simple
LimitNOFILE=65536
KillMode=process
KillSignal=SIGINT
Restart=on-failure
RestartSec=5
EnvironmentFile=-${_env}
ExecStart=${_bin} --config=${_config}
SyslogIdentifier=stalwart
User=${_user}
Group=${_user}
AmbientCapabilities=CAP_NET_BIND_SERVICE

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable stalwart.service
    systemctl restart stalwart.service
}

create_service_linux_initd() {
    local _bin="$1" _config="$2" _env="$3" _user="$4"
    cat > /etc/init.d/stalwart <<EOF
#!/bin/sh
### BEGIN INIT INFO
# Provides:          stalwart
# Required-Start:    \$network
# Required-Stop:     \$network
# Default-Start:     2 3 4 5
# Default-Stop:      0 1 6
# Short-Description: Stalwart Server
# Description:       Starts and stops the Stalwart Server
# Conflicts:         postfix sendmail
### END INIT INFO

PATH=/sbin:/usr/sbin:/bin:/usr/bin

. /lib/init/vars.sh
. /lib/lsb/init-functions

DAEMON=${_bin}
DAEMON_ARGS="--config=${_config}"
ENV_FILE=${_env}
PIDFILE=/var/run/stalwart.pid
ULIMIT_NOFILE=65536

[ -x "\$DAEMON" ] || exit 0

if [ -r "\$ENV_FILE" ]; then
    set -a
    . "\$ENV_FILE"
    set +a
fi

ulimit -n \$ULIMIT_NOFILE

do_start()
{
    start-stop-daemon --start --quiet --pidfile \$PIDFILE --exec \$DAEMON --test > /dev/null \\
        || return 1
    start-stop-daemon --start --quiet --pidfile \$PIDFILE --exec \$DAEMON \\
        --background --make-pidfile --chuid ${_user}:${_user} \\
        -- \$DAEMON_ARGS \\
        || return 2
}

do_stop()
{
    start-stop-daemon --stop --quiet --retry=INT/30/KILL/5 --pidfile \$PIDFILE --name stalwart
    RETVAL="\$?"
    [ "\$RETVAL" = 2 ] && return 2
    start-stop-daemon --stop --quiet --oknodo --retry=0/30/KILL/5 --exec \$DAEMON
    [ "\$?" = 2 ] && return 2
    rm -f \$PIDFILE
    return "\$RETVAL"
}

case "\$1" in
  start)
    [ "\$VERBOSE" != no ] && log_daemon_msg "Starting Stalwart Server" "stalwart"
    do_start
    case "\$?" in
        0|1) [ "\$VERBOSE" != no ] && log_end_msg 0 ;;
        2)   [ "\$VERBOSE" != no ] && log_end_msg 1 ;;
    esac
    ;;
  stop)
    [ "\$VERBOSE" != no ] && log_daemon_msg "Stopping Stalwart Server" "stalwart"
    do_stop
    case "\$?" in
        0|1) [ "\$VERBOSE" != no ] && log_end_msg 0 ;;
        2)   [ "\$VERBOSE" != no ] && log_end_msg 1 ;;
    esac
    ;;
  status)
    status_of_proc "\$DAEMON" "stalwart" && exit 0 || exit \$?
    ;;
  restart)
    log_daemon_msg "Restarting Stalwart Server" "stalwart"
    do_stop
    case "\$?" in
      0|1)
        do_start
        case "\$?" in
            0) log_end_msg 0 ;;
            *) log_end_msg 1 ;;
        esac
        ;;
      *)
        log_end_msg 1
        ;;
    esac
    ;;
  *)
    echo "Usage: /etc/init.d/stalwart {start|stop|status|restart}" >&2
    exit 3
    ;;
esac

exit 0
EOF
    chmod +x /etc/init.d/stalwart
    update-rc.d stalwart defaults
    service stalwart start
}

create_service_macos() {
    local _bin="$1" _config="$2" _env="$3" _user="$4"
    local _plist="/Library/LaunchDaemons/stalwart.plist"

    # Remove any legacy LaunchDaemons from a prior install
    if [ -f "$_plist" ]; then
        launchctl bootout system/ "$_plist" 2>/dev/null || true
        rm -f "$_plist"
    fi

    # launchd has no EnvironmentFile equivalent — wrap with sh to source the env file
    cat > "$_plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN"
    "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
    <dict>
        <key>Label</key>
        <string>stalwart</string>
        <key>ServiceDescription</key>
        <string>Stalwart</string>
        <key>UserName</key>
        <string>${_user}</string>
        <key>GroupName</key>
        <string>${_user}</string>
        <key>ProgramArguments</key>
        <array>
            <string>/bin/sh</string>
            <string>-c</string>
            <string>set -a; if [ -r "${_env}" ]; then . "${_env}"; fi; set +a; exec "${_bin}" --config="${_config}"</string>
        </array>
        <key>RunAtLoad</key>
        <true/>
        <key>KeepAlive</key>
        <true/>
    </dict>
</plist>
EOF
    chmod 0644 "$_plist"
    chown root:wheel "$_plist"
    launchctl bootout system/ "$_plist" 2>/dev/null || true
    launchctl bootstrap system/ "$_plist"
}

create_service_freebsd() {
    local _bin="$1" _config="$2" _env="$3" _user="$4" _log_dir="$5"
    ensure mkdir -p /usr/local/etc/rc.d
    cat > /usr/local/etc/rc.d/stalwart <<EOF
#!/bin/sh

# PROVIDE: stalwart
# REQUIRE: NETWORKING LOGIN
# KEYWORD: shutdown

. /etc/rc.subr

name="stalwart"
rcvar="stalwart_enable"
desc="Stalwart Server"

load_rc_config \$name

: \${stalwart_enable:="NO"}
: \${stalwart_runas_user:="${_user}"}
: \${stalwart_runas_group:="${_user}"}
: \${stalwart_config:="${_config}"}
: \${stalwart_envfile:="${_env}"}
: \${stalwart_logfile:="${_log_dir}/stalwart.log"}
: \${stalwart_fdlimit:="65536"}

pidfile="/var/run/stalwart.pid"
procname="${_bin}"
command="/usr/sbin/daemon"
command_args="-f -o \${stalwart_logfile} -p \${pidfile} ${_bin} --config=\${stalwart_config}"
sig_stop="INT"
start_precmd="stalwart_precmd"

stalwart_precmd()
{
    # daemon(8) passes its environment through to the service
    if [ -r "\${stalwart_envfile}" ]; then
        set -a
        . "\${stalwart_envfile}"
        set +a
    fi

    # Stalwart binds its listeners as root, then setuid()s to this account
    export RUN_AS_USER="\${stalwart_runas_user}"
    export RUN_AS_GROUP="\${stalwart_runas_group}"

    ulimit -n "\${stalwart_fdlimit}"
}

run_rc_command "\$1"
EOF
    chmod +x /usr/local/etc/rc.d/stalwart
    sysrc stalwart_enable=YES
    service stalwart stop > /dev/null 2>&1 || true
    service stalwart start
}


get_architecture() {
    local _ostype _cputype _bitness _arch _clibtype
    _ostype="$(uname -s)"
    _cputype="$(uname -m)"
    _clibtype="gnu"

    if [ "$_ostype" = Linux ]; then
        if [ "$(uname -o)" = Android ]; then
            _ostype=Android
        fi
        if ldd --version 2>&1 | grep -q 'musl'; then
            _clibtype="musl"
        fi
    fi

    if [ "$_ostype" = Darwin ] && [ "$_cputype" = i386 ]; then
        # Darwin `uname -m` lies
        if sysctl hw.optional.x86_64 | grep -q ': 1'; then
            _cputype=x86_64
        fi
    fi

    if [ "$_ostype" = SunOS ]; then
        # Both Solaris and illumos presently announce as "SunOS" in "uname -s"
        # so use "uname -o" to disambiguate.  We use the full path to the
        # system uname in case the user has coreutils uname first in PATH,
        # which has historically sometimes printed the wrong value here.
        if [ "$(/usr/bin/uname -o)" = illumos ]; then
            _ostype=illumos
        fi

        # illumos systems have multi-arch userlands, and "uname -m" reports the
        # machine hardware name; e.g., "i86pc" on both 32- and 64-bit x86
        # systems.  Check for the native (widest) instruction set on the
        # running kernel:
        if [ "$_cputype" = i86pc ]; then
            _cputype="$(isainfo -n)"
        fi
    fi

    case "$_ostype" in

        Android)
            _ostype=linux-android
            ;;

        Linux)
            check_proc
            _ostype=unknown-linux-$_clibtype
            _bitness=$(get_bitness)
            ;;

        FreeBSD)
            _ostype=unknown-freebsd
            ;;

        NetBSD)
            _ostype=unknown-netbsd
            ;;

        DragonFly)
            _ostype=unknown-dragonfly
            ;;

        Darwin)
            _ostype=apple-darwin
            ;;

        illumos)
            _ostype=unknown-illumos
            ;;

        MINGW* | MSYS* | CYGWIN* | Windows_NT)
            _ostype=pc-windows-gnu
            ;;

        *)
            err "unrecognized OS type: $_ostype"
            ;;

    esac

    case "$_cputype" in

        i386 | i486 | i686 | i786 | x86)
            _cputype=i686
            ;;

        xscale | arm)
            _cputype=arm
            if [ "$_ostype" = "linux-android" ]; then
                _ostype=linux-androideabi
            fi
            ;;

        armv6l)
            _cputype=arm
            if [ "$_ostype" = "linux-android" ]; then
                _ostype=linux-androideabi
            else
                _ostype="${_ostype}eabihf"
            fi
            ;;

        armv7l | armv8l)
            _cputype=armv7
            if [ "$_ostype" = "linux-android" ]; then
                _ostype=linux-androideabi
            else
                _ostype="${_ostype}eabihf"
            fi
            ;;

        aarch64 | arm64)
            _cputype=aarch64
            ;;

        x86_64 | x86-64 | x64 | amd64)
            _cputype=x86_64
            ;;

        mips)
            _cputype=$(get_endianness mips '' el)
            ;;

        mips64)
            if [ "$_bitness" -eq 64 ]; then
                # only n64 ABI is supported for now
                _ostype="${_ostype}abi64"
                _cputype=$(get_endianness mips64 '' el)
            fi
            ;;

        ppc)
            _cputype=powerpc
            ;;

        ppc64)
            _cputype=powerpc64
            ;;

        ppc64le)
            _cputype=powerpc64le
            ;;

        s390x)
            _cputype=s390x
            ;;
        riscv64)
            _cputype=riscv64gc
            ;;
        *)
            err "unknown CPU type: $_cputype"

    esac

    # Detect 64-bit linux with 32-bit userland
    if [ "${_ostype}" = unknown-linux-gnu ] && [ "${_bitness}" -eq 32 ]; then
        case $_cputype in
            x86_64)
                if [ -n "${RUSTUP_CPUTYPE:-}" ]; then
                    _cputype="$RUSTUP_CPUTYPE"
                else {
                    # 32-bit executable for amd64 = x32
                    if is_host_amd64_elf; then {
                         echo "This host is running an x32 userland; as it stands, x32 support is poor," 1>&2
                         echo "and there isn't a native toolchain -- you will have to install" 1>&2
                         echo "multiarch compatibility with i686 and/or amd64, then select one" 1>&2
                         echo "by re-running this script with the RUSTUP_CPUTYPE environment variable" 1>&2
                         echo "set to i686 or x86_64, respectively." 1>&2
                         echo 1>&2
                         echo "You will be able to add an x32 target after installation by running" 1>&2
                         echo "  rustup target add x86_64-unknown-linux-gnux32" 1>&2
                         exit 1
                    }; else
                        _cputype=i686
                    fi
                }; fi
                ;;
            mips64)
                _cputype=$(get_endianness mips '' el)
                ;;
            powerpc64)
                _cputype=powerpc
                ;;
            aarch64)
                _cputype=armv7
                if [ "$_ostype" = "linux-android" ]; then
                    _ostype=linux-androideabi
                else
                    _ostype="${_ostype}eabihf"
                fi
                ;;
            riscv64gc)
                err "riscv64 with 32-bit userland unsupported"
                ;;
        esac
    fi

    # Detect armv7 but without the CPU features Rust needs in that build,
    # and fall back to arm.
    # See https://github.com/rust-lang/rustup.rs/issues/587.
    if [ "$_ostype" = "unknown-linux-gnueabihf" ] && [ "$_cputype" = armv7 ]; then
        if ensure grep '^Features' /proc/cpuinfo | grep -q -v neon; then
            # At least one processor does not have NEON.
            _cputype=arm
        fi
    fi

    _arch="${_cputype}-${_ostype}"

    RETVAL="$_arch"
}

check_proc() {
    # Check for /proc by looking for the /proc/self/exe link
    # This is only run on Linux
    if ! test -L /proc/self/exe ; then
        err "fatal: Unable to find /proc/self/exe.  Is /proc mounted?  Installation cannot proceed without /proc."
    fi
}

get_bitness() {
    need_cmd head
    # Architecture detection without dependencies beyond coreutils.
    # ELF files start out "\x7fELF", and the following byte is
    #   0x01 for 32-bit and
    #   0x02 for 64-bit.
    # The printf builtin on some shells like dash only supports octal
    # escape sequences, so we use those.
    local _current_exe_head
    _current_exe_head=$(head -c 5 /proc/self/exe )
    if [ "$_current_exe_head" = "$(printf '\177ELF\001')" ]; then
        echo 32
    elif [ "$_current_exe_head" = "$(printf '\177ELF\002')" ]; then
        echo 64
    else
        err "unknown platform bitness"
    fi
}

is_host_amd64_elf() {
    need_cmd head
    need_cmd tail
    # ELF e_machine detection without dependencies beyond coreutils.
    # Two-byte field at offset 0x12 indicates the CPU,
    # but we're interested in it being 0x3E to indicate amd64, or not that.
    local _current_exe_machine
    _current_exe_machine=$(head -c 19 /proc/self/exe | tail -c 1)
    [ "$_current_exe_machine" = "$(printf '\076')" ]
}

get_endianness() {
    local cputype=$1
    local suffix_eb=$2
    local suffix_el=$3

    # detect endianness without od/hexdump, like get_bitness() does.
    need_cmd head
    need_cmd tail

    local _current_exe_endianness
    _current_exe_endianness="$(head -c 6 /proc/self/exe | tail -c 1)"
    if [ "$_current_exe_endianness" = "$(printf '\001')" ]; then
        echo "${cputype}${suffix_el}"
    elif [ "$_current_exe_endianness" = "$(printf '\002')" ]; then
        echo "${cputype}${suffix_eb}"
    else
        err "unknown platform endianness"
    fi
}

say() {
    printf '%s\n' "$1"
}

err() {
    say "$1" >&2
    exit 1
}

need_cmd() {
    if ! check_cmd "$1"; then
        err "need '$1' (command not found)"
    fi
}

check_cmd() {
    command -v "$1" > /dev/null 2>&1
}

assert_nz() {
    if [ -z "$1" ]; then err "assert_nz $2"; fi
}

# Run a command that should never fail. If the command fails execution
# will immediately terminate with an error showing the failing
# command.
ensure() {
    if ! "$@"; then err "command failed: $*"; fi
}

# This wraps curl or wget. Try curl first, if not installed,
# use wget instead.
downloader() {
    local _dld
    local _ciphersuites
    local _err
    local _status
    local _retry
    if check_cmd curl; then
        _dld=curl
    elif check_cmd wget; then
        _dld=wget
    else
        _dld='curl or wget' # to be used in error message of need_cmd
    fi

    if [ "$1" = --check ]; then
        need_cmd "$_dld"
    elif [ "$_dld" = curl ]; then
        check_curl_for_retry_support
        _retry="$RETVAL"
        get_ciphersuites_for_curl
        _ciphersuites="$RETVAL"
        if [ -n "$_ciphersuites" ]; then
            _err=$(curl $_retry --proto '=https' --tlsv1.2 --ciphers "$_ciphersuites" --silent --show-error --fail --location "$1" --output "$2" 2>&1)
            _status=$?
        else
            echo "Warning: Not enforcing strong cipher suites for TLS, this is potentially less secure"
            if ! check_help_for "$3" curl --proto --tlsv1.2; then
                echo "Warning: Not enforcing TLS v1.2, this is potentially less secure"
                _err=$(curl $_retry --silent --show-error --fail --location "$1" --output "$2" 2>&1)
                _status=$?
            else
                _err=$(curl $_retry --proto '=https' --tlsv1.2 --silent --show-error --fail --location "$1" --output "$2" 2>&1)
                _status=$?
            fi
        fi
        if [ -n "$_err" ]; then
            if echo "$_err" | grep -q 404; then
                err "❌  Binary for platform '$3' not found, this platform may be unsupported."
            else
                echo "$_err" >&2
            fi
        fi
        return $_status
    elif [ "$_dld" = wget ]; then
        if [ "$(wget -V 2>&1|head -2|tail -1|cut -f1 -d" ")" = "BusyBox" ]; then
            echo "Warning: using the BusyBox version of wget.  Not enforcing strong cipher suites for TLS or TLS v1.2, this is potentially less secure"
            _err=$(wget "$1" -O "$2" 2>&1)
            _status=$?
        else
            get_ciphersuites_for_wget
            _ciphersuites="$RETVAL"
            if [ -n "$_ciphersuites" ]; then
                _err=$(wget --https-only --secure-protocol=TLSv1_2 --ciphers "$_ciphersuites" "$1" -O "$2" 2>&1)
                _status=$?
            else
                echo "Warning: Not enforcing strong cipher suites for TLS, this is potentially less secure"
                if ! check_help_for "$3" wget --https-only --secure-protocol; then
                    echo "Warning: Not enforcing TLS v1.2, this is potentially less secure"
                    _err=$(wget "$1" -O "$2" 2>&1)
                    _status=$?
                else
                    _err=$(wget --https-only --secure-protocol=TLSv1_2 "$1" -O "$2" 2>&1)
                    _status=$?
                fi
            fi
        fi
        if [ -n "$_err" ]; then
            if echo "$_err" | grep -q ' 404 Not Found'; then
                err "❌  Binary for platform '$3' not found, this platform may be unsupported."
            else
                echo "$_err" >&2
            fi
        fi
        return $_status
    else
        err "Unknown downloader"   # should not reach here
    fi
}

# Check if curl supports the --retry flag, then pass it to the curl invocation.
check_curl_for_retry_support() {
  local _retry_supported=""
  # "unspecified" is for arch, allows for possibility old OS using macports, homebrew, etc.
  if check_help_for "notspecified" "curl" "--retry"; then
    _retry_supported="--retry 3"
  fi

  RETVAL="$_retry_supported"

}

check_help_for() {
    local _arch
    local _cmd
    local _arg
    _arch="$1"
    shift
    _cmd="$1"
    shift

    local _category
    if "$_cmd" --help | grep -q 'For all options use the manual or "--help all".'; then
      _category="all"
    else
      _category=""
    fi

    case "$_arch" in

        *darwin*)
        if check_cmd sw_vers; then
            case $(sw_vers -productVersion) in
                10.*)
                    # If we're running on macOS, older than 10.13, then we always
                    # fail to find these options to force fallback
                    if [ "$(sw_vers -productVersion | cut -d. -f2)" -lt 13 ]; then
                        # Older than 10.13
                        echo "Warning: Detected macOS platform older than 10.13"
                        return 1
                    fi
                    ;;
                11.*)
                    # We assume Big Sur will be OK for now
                    ;;
                *)
                    # Unknown product version, warn and continue
                    echo "Warning: Detected unknown macOS major version: $(sw_vers -productVersion)"
                    echo "Warning TLS capabilities detection may fail"
                    ;;
            esac
        fi
        ;;

    esac

    for _arg in "$@"; do
        if ! "$_cmd" --help $_category | grep -q -- "$_arg"; then
            return 1
        fi
    done

    true # not strictly needed
}

# Return cipher suite string specified by user, otherwise return strong TLS 1.2-1.3 cipher suites
# if support by local tools is detected. Detection currently supports these curl backends:
# GnuTLS and OpenSSL (possibly also LibreSSL and BoringSSL). Return value can be empty.
get_ciphersuites_for_curl() {
    if [ -n "${RUSTUP_TLS_CIPHERSUITES-}" ]; then
        # user specified custom cipher suites, assume they know what they're doing
        RETVAL="$RUSTUP_TLS_CIPHERSUITES"
        return
    fi

    local _openssl_syntax="no"
    local _gnutls_syntax="no"
    local _backend_supported="yes"
    if curl -V | grep -q ' OpenSSL/'; then
        _openssl_syntax="yes"
    elif curl -V | grep -iq ' LibreSSL/'; then
        _openssl_syntax="yes"
    elif curl -V | grep -iq ' BoringSSL/'; then
        _openssl_syntax="yes"
    elif curl -V | grep -iq ' GnuTLS/'; then
        _gnutls_syntax="yes"
    else
        _backend_supported="no"
    fi

    local _args_supported="no"
    if [ "$_backend_supported" = "yes" ]; then
        # "unspecified" is for arch, allows for possibility old OS using macports, homebrew, etc.
        if check_help_for "notspecified" "curl" "--tlsv1.2" "--ciphers" "--proto"; then
            _args_supported="yes"
        fi
    fi

    local _cs=""
    if [ "$_args_supported" = "yes" ]; then
        if [ "$_openssl_syntax" = "yes" ]; then
            _cs=$(get_strong_ciphersuites_for "openssl")
        elif [ "$_gnutls_syntax" = "yes" ]; then
            _cs=$(get_strong_ciphersuites_for "gnutls")
        fi
    fi

    RETVAL="$_cs"
}

# Return cipher suite string specified by user, otherwise return strong TLS 1.2-1.3 cipher suites
# if support by local tools is detected. Detection currently supports these wget backends:
# GnuTLS and OpenSSL (possibly also LibreSSL and BoringSSL). Return value can be empty.
get_ciphersuites_for_wget() {
    if [ -n "${RUSTUP_TLS_CIPHERSUITES-}" ]; then
        # user specified custom cipher suites, assume they know what they're doing
        RETVAL="$RUSTUP_TLS_CIPHERSUITES"
        return
    fi

    local _cs=""
    if wget -V | grep -q '\-DHAVE_LIBSSL'; then
        # "unspecified" is for arch, allows for possibility old OS using macports, homebrew, etc.
        if check_help_for "notspecified" "wget" "TLSv1_2" "--ciphers" "--https-only" "--secure-protocol"; then
            _cs=$(get_strong_ciphersuites_for "openssl")
        fi
    elif wget -V | grep -q '\-DHAVE_LIBGNUTLS'; then
        # "unspecified" is for arch, allows for possibility old OS using macports, homebrew, etc.
        if check_help_for "notspecified" "wget" "TLSv1_2" "--ciphers" "--https-only" "--secure-protocol"; then
            _cs=$(get_strong_ciphersuites_for "gnutls")
        fi
    fi

    RETVAL="$_cs"
}

# Return strong TLS 1.2-1.3 cipher suites in OpenSSL or GnuTLS syntax. TLS 1.2
# excludes non-ECDHE and non-AEAD cipher suites. DHE is excluded due to bad
# DH params often found on servers (see RFC 7919). Sequence matches or is
# similar to Firefox 68 ESR with weak cipher suites disabled via about:config.
# $1 must be openssl or gnutls.
get_strong_ciphersuites_for() {
    if [ "$1" = "openssl" ]; then
        # OpenSSL is forgiving of unknown values, no problems with TLS 1.3 values on versions that don't support it yet.
        echo "TLS_AES_128_GCM_SHA256:TLS_CHACHA20_POLY1305_SHA256:TLS_AES_256_GCM_SHA384:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384"
    elif [ "$1" = "gnutls" ]; then
        # GnuTLS isn't forgiving of unknown values, so this may require a GnuTLS version that supports TLS 1.3 even if wget doesn't.
        # Begin with SECURE128 (and higher) then remove/add to build cipher suites. Produces same 9 cipher suites as OpenSSL but in slightly different order.
        echo "SECURE128:-VERS-SSL3.0:-VERS-TLS1.0:-VERS-TLS1.1:-VERS-DTLS-ALL:-CIPHER-ALL:-MAC-ALL:-KX-ALL:+AEAD:+ECDHE-ECDSA:+ECDHE-RSA:+AES-128-GCM:+CHACHA20-POLY1305:+AES-256-GCM"
    fi
}

# This is just for indicating that commands' results are being
# intentionally ignored. Usually, because it's being executed
# as part of error handling.
ignore() {
    "$@"
}

main "$@" || exit 1
