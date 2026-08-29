#!/usr/bin/env sh
# shellcheck shell=dash

#
# SPDX-FileCopyrightText: 2020 Stalwart Labs LLC <hello@stalw.art>
#
# SPDX-License-Identifier: AGPL-3.0-only OR LicenseRef-SEL
#

# BearMail install script (Stalwart engine + WebUI) -- based on the rustup installation script.

set -e
set -u

NODE_BIN=""
NODE_VERSION=""
NODE_INSTALL_ROOT="/opt/stalwart-node"
VALIDATION_ERROR=""
CADDY_CONFIG_FILE="/etc/caddy/Caddyfile"
CADDY_MANAGED_MARKER="# STALWART_INSTALLER_MANAGED_CADDYFILE=1"
CADDY_CERT_ROOT="/var/lib/caddy/.local/share/caddy/certificates"
CADDY_CERT_SYNC_SCRIPT="/usr/local/libexec/stalwart-caddy-cert-sync"
CADDY_CERT_SYNC_SERVICE="/etc/systemd/system/stalwart-caddy-cert-sync.service"
CADDY_CERT_SYNC_TIMER="/etc/systemd/system/stalwart-caddy-cert-sync.timer"
cleanup_restart_caddy=""

main() {
    # Installation and setup answers are deliberately not accepted as command
    # line arguments. This keeps invocation simple and prevents
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
    need_cmd cp
    need_cmd dirname
    need_cmd env
    need_cmd find
    need_cmd grep
    need_cmd hostname
    need_cmd id
    need_cmd install
    need_cmd mkdir
    need_cmd mv
    need_cmd rm
    need_cmd sed
    need_cmd systemctl
    need_cmd stty
    need_cmd tar
    need_cmd tr
    need_cmd useradd

    # Require root
    if [ "$(id -u)" -ne 0 ]; then
        err "❌ Install failed: This program needs to run as root."
    fi

    if [ "$(uname)" != "Linux" ]; then
        err "❌ Install failed: The BearMail installer currently requires Linux with systemd."
    fi
    if ! systemctl --version >/dev/null 2>&1; then
        err "❌ Install failed: systemd is required for the two-service installation."
    fi
    local _account="stalwart" _script_dir
    _script_dir="$(CDPATH= cd "$(dirname "$0")" 2>/dev/null && pwd)"

    say ""
    say "┌─────────────────────────────────────────────────────────┐"
    say "│          BearMail — one-shot mail installer             │"
    say "└─────────────────────────────────────────────────────────┘"
    say ""
    say "Prepare before the later prompts (the installer does not create these"
    say "vendor accounts for you):"
    say "  • name.com domain on name.com nameservers, plus a production API token"
    say "  • SMTP relay account (Brevo recommended, Mailjet also supported):"
    say "    sender domain plus SMTP login and SMTP key"
    say "You can still install without them, then add DNS and the relay later."
    say ""

    # Select the filesystem layout interactively.
    local _prefix=""
    prompt_menu "Installation layout" 1 \
        "Standard system paths (recommended)" \
        "Custom self-contained prefix"
    if [ "$RETVAL" -eq 2 ]; then
        prompt_absolute_prefix "Absolute installation prefix" "/opt/stalwart" \
            "custom installation prefix"
        _prefix="$RETVAL"
    fi

    # Derive install paths — FHS by default, self-contained under a custom prefix
    local _bin_dir _bin_file _conf_dir _log_dir _data_dir _env_file _config_file
    if [ -z "$_prefix" ]; then
        _bin_dir="/usr/local/bin"
        _log_dir="/var/log/stalwart"
        _conf_dir="/etc/stalwart"
        _data_dir="/var/lib/stalwart"
    else
        _bin_dir="${_prefix}/bin"
        _conf_dir="${_prefix}/etc"
        _log_dir="${_prefix}/logs"
        _data_dir="${_prefix}/data"
    fi
    _bin_file="${_bin_dir}/stalwart"
    _config_file="${_conf_dir}/config.json"
    _env_file="${_conf_dir}/stalwart.env"

    local _source_binary _webui_archive _webui_prefix _webui_port _webui_origin
    local _webui_hostname _webui_stage _setup_result_file _installer_state
    local _proxy_mode
    prompt_executable_file "Path to the compiled Stalwart binary" "${_script_dir}/stalwart" \
        "The Stalwart artifact must be an executable regular file."
    _source_binary="$RETVAL"
    prompt_regular_file "Path to the prebuilt WebUI tar archive" "${_script_dir}/stalwart-webui.tar.gz" \
        "The WebUI artifact must be a regular file."
    _webui_archive="$RETVAL"
    prompt_webui_prefix "WebUI installation prefix" "/opt/stalwart-webui" \
        "$_bin_dir" "$_conf_dir" "$_log_dir" "$_data_dir" "$NODE_INSTALL_ROOT"
    _webui_prefix="$RETVAL"
    prompt_webui_port "WebUI local service port" "8081"
    _webui_port="$RETVAL"
    prompt_https_origin "Public WebUI origin (exact HTTPS URL, no path)" \
        "https://bearmail.example.com"
    _webui_origin="$RETVAL"
    origin_hostname "$_webui_origin"
    _webui_hostname="$RETVAL"
    prompt_menu "HTTPS publishing" 1 \
        "Configure Caddy automatically (recommended)" \
        "Use an existing operator-managed reverse proxy"
    if [ "$RETVAL" -eq 1 ]; then
        _proxy_mode="caddy"
        while [ "$_webui_origin" != "https://${_webui_hostname}" ]; do
            printf '  Automatic Caddy publishing uses standard HTTPS port 443.\n' >&3
            prompt_https_origin "Public WebUI origin (exact HTTPS URL, no path or custom port)" \
                "https://${_webui_hostname}"
            _webui_origin="$RETVAL"
            origin_hostname "$_webui_origin"
            _webui_hostname="$RETVAL"
        done
        validate_caddy_config_ownership
    else
        _proxy_mode="operator"
    fi

    say ""
    say "Installation summary"
    say "  Mail engine artifact: ${_source_binary}"
    say "  Mail engine binary:   ${_bin_file}"
    say "  Configuration:     ${_config_file}"
    say "  Data:              ${_data_dir}"
    say "  Logs:              ${_log_dir}"
    say "  WebUI archive:     ${_webui_archive}"
    say "  WebUI files:       ${_webui_prefix}"
    say "  WebUI service:     127.0.0.1:${_webui_port}"
    say "  WebUI public URL:  ${_webui_origin}"
    if [ "$_proxy_mode" = "caddy" ]; then
        say "  HTTPS publishing:  installer-managed Caddy on ports 80 and 443"
        say ""
        say "Caddy will route the two public hostnames by Host header. The mail"
        say "HTTP listeners and BearMail will be restricted to localhost."
    else
        say "  HTTPS publishing:  operator-managed reverse proxy"
        say ""
        say "The WebUI stays on localhost. Your HTTPS reverse proxy must route"
        say "${_webui_origin} to 127.0.0.1:${_webui_port}."
    fi
    say ""
    if ! prompt_yes_no "Install both services and run interactive server setup" "no"; then
        err "Installation cancelled; no system files were changed."
    fi

    # Validate and stage both local artifacts before changing the system.
    local _tmp="" _setup_help=""
    _tmp="$(mktemp -d)"
    cleanup_dir="$_tmp"
    trap cleanup 0
    trap 'cleanup; exit 1' HUP INT TERM
    if ! _setup_help="$("$_source_binary" --setup --help 2>/dev/null)"; then
        err "❌ Install failed: The selected binary is not compatible with this installer's command-line setup."
    fi
    case "$_setup_help" in
        *"Quick setup asks only"*) ;;
        *) err "❌ Install failed: The selected binary predates this installer's quick setup and DNS table. Rebuild it from this source revision." ;;
    esac
    case "$_setup_help" in
        *"STALWART_SETUP_RESULT_PATH"*) ;;
        *) err "❌ Install failed: The selected binary predates the secure combined-installer handoff. Rebuild it from this source revision." ;;
    esac

    _webui_stage="${_tmp}/webui"
    ensure mkdir -p "$_webui_stage"
    if ! tar -tzf "$_webui_archive" > "${_tmp}/archive-files"; then
        err "❌ Install failed: The WebUI artifact is not a readable gzip tar archive."
    fi
    if grep -Eq '(^/|(^|/)\.\.(/|$))' "${_tmp}/archive-files"; then
        err "❌ Install failed: The WebUI archive contains an unsafe path."
    fi
    ensure tar --no-same-owner --no-same-permissions -xzf "$_webui_archive" -C "$_webui_stage"
    if find "$_webui_stage" -type l -print -quit | grep -q .; then
        err "❌ Install failed: Symbolic links are not allowed in the WebUI archive."
    fi
    for _required in install.sh server.mjs stalwart-webui.service dist/index.html dist/config.json; do
        if [ ! -f "${_webui_stage}/${_required}" ]; then
            err "❌ Install failed: The WebUI archive is missing ${_required}."
        fi
    done
    if ! grep -q 'STALWART_WEBUI_ARCHIVE_VERSION=2' "${_webui_stage}/install.sh"; then
        err "❌ Install failed: The WebUI archive is not compatible with this combined installer."
    fi

    prepare_node_runtime "$_tmp"
    if paths_overlap "$_webui_prefix" "$NODE_BIN"; then
        printf '  The WebUI prefix must not contain or be contained by the selected Node.js executable (%s).\n' \
            "$NODE_BIN" >&3
        prompt_webui_prefix "WebUI installation prefix" "$_webui_prefix" \
            "$_bin_dir" "$_conf_dir" "$_log_dir" "$_data_dir" \
            "$NODE_INSTALL_ROOT" "$NODE_BIN"
        _webui_prefix="$RETVAL"
    fi

    if [ "$_proxy_mode" = "caddy" ]; then
        say "📦 Preparing Caddy and TLS tools..."
        ensure_caddy_available
        ensure_openssl_available
        need_cmd cmp
        # The packaged Caddy service may have started with its default file.
        # Keep 443 free until Stalwart's listeners have been moved to loopback.
        if systemctl is-active --quiet caddy.service; then
            cleanup_restart_caddy="true"
        fi
        ensure systemctl stop caddy.service
    fi

    # Create service account
    create_account "$_account"

    # Create directories
    ensure mkdir -p "$_bin_dir" "$_conf_dir" "$_log_dir" "$_data_dir"

    # Install the selected binary.
    say "📦 Installing Stalwart at ${_bin_file}..."
    if [ "$_source_binary" != "$_bin_file" ]; then
        install_executable_atomically "$_source_binary" "$_bin_file"
    fi
    ensure chmod 0755 "$_bin_file"
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
    local _public_ipv4="" _public_ipv6="" _fresh_setup="false"
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

    _setup_result_file="${_tmp}/setup-result.json"
    _installer_state="${_conf_dir}/installer-state.json"
    if [ ! -e "$_config_file" ]; then
        _fresh_setup="true"
        say "🧭 Starting interactive command-line setup..."
        print_server_identity_help
        if ! env \
            STALWART_SETUP_DATA_PATH="$_data_dir" \
            STALWART_SETUP_LOG_PATH="$_log_dir" \
            STALWART_SETUP_PUBLIC_IPV4="$_public_ipv4" \
            STALWART_SETUP_PUBLIC_IPV6="$_public_ipv6" \
            STALWART_SETUP_RESULT_PATH="$_setup_result_file" \
            "$_bin_file" --config="$_config_file" --setup <&3
        then
            err "❌ Command-line setup failed. Correct the error, then rerun the installer. The service was not installed or started."
        fi
        if [ ! -f "$_config_file" ] || [ ! -s "$_config_file" ]; then
            err "❌ Command-line setup returned without creating a non-empty ${_config_file}. The service was not installed or started."
        fi
        if [ ! -s "$_setup_result_file" ]; then
            err "❌ Command-line setup did not create its secure installer result. The services were not started."
        fi
    else
        say "ℹ️  Preserving existing configuration at ${_config_file}; hostname and mail-domain setup skipped."
        if [ -s "$_installer_state" ]; then
            json_field "$_installer_state" "serverHostname"
            if [ -n "$RETVAL" ]; then
                say "   Current hostname:    ${RETVAL}"
            fi
            json_field "$_installer_state" "defaultDomain"
            if [ -n "$RETVAL" ]; then
                say "   Current mail domain: ${RETVAL}"
            fi
        fi
        say "   Moving this file aside is not enough: the data store is already initialized."
        say "   To choose hostname and domain again, stop Stalwart, move ${_config_file},"
        say "   installer-state.json, and the data directory aside, then rerun the installer."
        say "   From this checkout: sudo sh ./test_install.sh --reset-setup --skip-build"
    fi

    # Ownership and permissions
    say "🔐 Setting permissions..."
    ensure chown -R "${_account}:${_account}" "$_conf_dir" "$_log_dir" "$_data_dir"
    ensure chmod 0750 "$_conf_dir" "$_log_dir" "$_data_dir"
    ensure chown "root:${_account}" "$_env_file"
    ensure chmod 0640 "$_env_file"
    if [ -f "$_installer_state" ]; then
        ensure chown root:root "$_installer_state"
        ensure chmod 0600 "$_installer_state"
    fi

    say "🚀 Starting Stalwart service..."
    create_service_linux_systemd "$_bin_file" "$_config_file" "$_env_file" "$_account"
    wait_for_http "http://127.0.0.1:8080/healthz/ready" "Stalwart"

    local _mail_hostname="" _mail_domain="" _admin_username="" _admin_secret=""
    local _mail_identity_prompted="false"
    if [ "$_fresh_setup" = "true" ]; then
        json_field "$_setup_result_file" "serverHostname"
        _mail_hostname="$RETVAL"
        json_field "$_setup_result_file" "defaultDomain"
        _mail_domain="$RETVAL"
        json_field "$_setup_result_file" "administrator.username"
        _admin_username="$RETVAL"
        json_field "$_setup_result_file" "administrator.secret"
        _admin_secret="$RETVAL"
    elif [ -s "$_installer_state" ]; then
        json_field "$_installer_state" "serverHostname"
        _mail_hostname="$RETVAL"
        json_field "$_installer_state" "defaultDomain"
        _mail_domain="$RETVAL"
    else
        print_server_identity_help
        suggested_public_mail_hostname
        prompt_dns_name "Public mail hostname: eg, mail.example.com" "$RETVAL"
        _mail_hostname="$RETVAL"
        suggested_primary_mail_domain "$_mail_hostname"
        prompt_dns_name "Primary mail domain: eg, if you want admin@example.com as email address, input example.com here" "$RETVAL"
        _mail_domain="$RETVAL"
        _mail_identity_prompted="true"
    fi
    if [ "$_mail_identity_prompted" = "false" ]; then
        if ! normalize_dns_name "$_mail_hostname"; then
            err "❌ Install failed: ${VALIDATION_ERROR}"
        fi
        _mail_hostname="$RETVAL"
        if ! normalize_dns_name "$_mail_domain"; then
            err "❌ Install failed: ${VALIDATION_ERROR}"
        fi
        _mail_domain="$RETVAL"
    fi
    confirm_dedicated_webui_origin "$_proxy_mode" "$_mail_hostname" "$_mail_domain"

    # Persist only non-secret setup output before the WebUI/CORS stages so a
    # failed late stage can be retried without losing the complete DNS rows.
    write_installer_state \
        "$_setup_result_file" "$_installer_state" "$_mail_hostname" "$_mail_domain" \
        "$_public_ipv4" "$_public_ipv6" "$_webui_origin" "$_webui_hostname" "$_proxy_mode"
    ensure chown root:root "$_installer_state"
    ensure chmod 0600 "$_installer_state"

    say "📦 Installing the WebUI service..."
    ensure sh "${_webui_stage}/install.sh" \
        --server-url "https://${_mail_hostname}" \
        --prefix "$_webui_prefix" \
        --port "$_webui_port" \
        --node-bin "$NODE_BIN" \
        --systemd \
        --no-build
    wait_for_http "http://127.0.0.1:${_webui_port}/healthz/ready" "WebUI"

    if [ -z "$_admin_username" ] || [ -z "$_admin_secret" ]; then
        prompt_admin_credentials "admin"
        _admin_username="$ADMIN_USERNAME_RETVAL"
        _admin_secret="$ADMIN_SECRET_RETVAL"
    fi
    say "🔐 Adding the exact WebUI CORS origin to Stalwart..."
    local _cors_status
    while true; do
        _cors_status=0
        configure_stalwart_cors "$_webui_origin" "$_admin_username" "$_admin_secret" || _cors_status=$?
        if [ "$_cors_status" -eq 0 ]; then
            break
        fi
        if [ "$_cors_status" -eq 2 ]; then
            printf '  Stalwart rejected those administrator credentials. Enter them again.\n' >&3
            prompt_admin_credentials "$_admin_username"
            _admin_username="$ADMIN_USERNAME_RETVAL"
            _admin_secret="$ADMIN_SECRET_RETVAL"
            continue
        fi
        err "❌ Install failed: Stalwart CORS could not be configured or verified."
    done

    if [ "$_proxy_mode" = "caddy" ]; then
        local _proxy_cert_dir _proxy_cert _proxy_key _proxy_status
        _proxy_cert_dir="${_conf_dir}/proxy-certs"
        _proxy_cert="${_proxy_cert_dir}/caddy-mail.pem"
        _proxy_key="${_proxy_cert_dir}/caddy-mail.key"

        say "🔐 Preparing Stalwart to use Caddy's renewed mail certificate..."
        create_placeholder_certificate \
            "$_proxy_cert_dir" "$_proxy_cert" "$_proxy_key" "$_mail_hostname" "$_account"
        while true; do
            _proxy_status=0
            configure_stalwart_caddy_proxy \
                "$_mail_domain" "$_proxy_cert" "$_proxy_key" \
                "$_admin_username" "$_admin_secret" || _proxy_status=$?
            if [ "$_proxy_status" -eq 0 ]; then
                break
            fi
            if [ "$_proxy_status" -eq 2 ]; then
                printf '  Stalwart rejected those administrator credentials. Enter them again.\n' >&3
                prompt_admin_credentials "$_admin_username"
                _admin_username="$ADMIN_USERNAME_RETVAL"
                _admin_secret="$ADMIN_SECRET_RETVAL"
                continue
            fi
            err "❌ Install failed: Stalwart could not be prepared for the Caddy reverse proxy."
        done
        install_stalwart_public_url_dropin \
            "/etc/systemd/system/stalwart.service.d/10-public-url.conf" "$_mail_hostname"

        say "🔒 Restricting Stalwart HTTP listeners to localhost..."
        ensure systemctl daemon-reload
        ensure systemctl restart stalwart.service
        wait_for_http "http://127.0.0.1:8080/healthz/ready" "Stalwart"

        say "🌐 Installing the two-hostname Caddy configuration..."
        install_caddy_configuration \
            "$_tmp" "$_mail_hostname" "$_mail_domain" "$_webui_hostname" "$_webui_port"
        install_caddy_certificate_sync \
            "$_mail_hostname" "$_proxy_cert" "$_proxy_key" "$_account"
        ensure systemctl daemon-reload
        ensure systemctl enable --now caddy.service
        ensure systemctl restart caddy.service
        if ! systemctl is-active --quiet caddy.service; then
            err "❌ Install failed: Caddy did not remain active. Inspect: journalctl -u caddy.service"
        fi
        cleanup_restart_caddy=""
        ensure systemctl enable --now stalwart-caddy-cert-sync.timer
        # If DNS is already live, this imports Caddy's first certificate now.
        # Otherwise the timer retries without failing the installation.
        systemctl start stalwart-caddy-cert-sync.service >/dev/null 2>&1 || true
    fi

    say ""
    say "Forward DNS records for BearMail"
    say "------------------------------------------------"
    print_combined_dns_table "$_installer_state" "$_webui_hostname"

    local _smtp_relay="" _dns_published="false"
    configure_optional_smtp_relay \
        "$_admin_username" "$_admin_secret" "$_mail_domain"
    _smtp_relay="$RETVAL"
    publish_optional_namecom_dns \
        "$_installer_state" "$_webui_hostname" "$_mail_domain" "$_smtp_relay"
    if [ "$RETVAL" = "true" ]; then
        _dns_published="true"
    fi

    say ""
    say "🎉 Installation complete!"
    say ""
    say "  BearMail admin: https://${_mail_hostname}/admin/"
    say "  BearMail web:   ${_webui_origin}/"
    say "  WebUI upstream: http://127.0.0.1:${_webui_port}"
    say "  Agent discovery: https://${_mail_hostname}/.well-known/mcp.json"
    say ""
    say "AI agents (MCP stdio). Create a normal mailbox, issue an app password,"
    say "then point the host at that mailbox. Never use a human primary password."
    say "  BEARMAIL_SERVER=https://${_mail_hostname}"
    say "  BEARMAIL_USERNAME=<agent-or-user@${_mail_domain}>"
    say "  BEARMAIL_TOKEN=<app-password-or-oauth-token>"
    say "  BEARMAIL_SEND_MODE=draft-only"
    say "  command: node /path/to/bearmail-mcp/dist/stdio.js"
    say "  Example: mcp/mcp.json.example  Guide: docs/AGENT_GUIDE.md"
    say ""
    if [ -n "$_admin_username" ] && [ -n "$_admin_secret" ]; then
        say "Permanent administrator credential"
        say "  Username: ${_admin_username}"
        say "  Password: ${_admin_secret}"
        say "Use this to sign in at https://${_mail_hostname}/admin/ and add other"
        say "accounts. This password is shown once here and is not saved in"
        say "installer-state.json. Store it somewhere safe."
        say ""
    fi
    _admin_secret=""
    unset _admin_secret
    if [ "$_proxy_mode" = "caddy" ]; then
        say "Caddy now routes ${_mail_hostname} to the mail engine and ${_webui_hostname}"
        say "to BearMail. Caddy obtains HTTPS certificates once the mail and webmail"
        say "hostnames resolve here. The installed timer synchronizes its mail-host"
        say "certificate into the engine for IMAPS/SMTPS."
    else
        say "Configure your HTTPS reverse proxy to send ${_webui_origin} to the WebUI"
        say "upstream above, and keep the WebUI port private."
    fi
    if [ "$_dns_published" = "true" ]; then
        say "Name.com now has the forward-DNS rows for ${_mail_domain}. Wait for"
        say "propagation before testing the public URLs."
    elif [ -z "$_smtp_relay" ]; then
        say "If the printed forward-DNS rows are not yet in the authoritative zone,"
        say "add them before public login."
    fi
    if [ "$_smtp_relay" = "brevo" ]; then
        say "Outbound mail uses the Brevo SMTP relay. After DNS resolves, create a"
        say "user in the BearMail admin panel and send from the web app with that"
        say "account. Finish Brevo domain authentication (Brevo code and DKIM) in"
        say "the Brevo dashboard if those are still pending."
    elif [ "$_smtp_relay" = "mailjet" ]; then
        say "Outbound mail uses the Mailjet SMTP relay. After DNS resolves, create a"
        say "user in the BearMail admin panel and send from the web app with that"
        say "account. Finish Mailjet domain verification and Mailjet's DKIM record"
        say "in the Mailjet dashboard if those are still pending."
    else
        say "Then create an account in the BearMail admin panel. The user can sign in to"
        say "the web app with the full email address (or account name) and its password."
        say "Direct MX delivery needs outbound TCP 25, which Google Cloud blocks."
    fi
    say ""
    say "Firewall: allow inbound TCP so BearMail fully works:"
    say "  80    HTTPS certificates (Let's Encrypt)"
    say "  443   Webmail, admin, and JMAP"
    say "  25    Incoming mail from other servers (MX)"
    say "  465   Phones and mail apps sending (SMTPS)"
    say "  993   Phones and mail apps reading (IMAPS)"
    say "Leave 8080, 8081, and 8443 closed; they are localhost only."
    say "Outbound: 443, DNS 53, and 587 or 465 to the SMTP relay."
    say "Cloud VMs usually block outbound 25; the relay does not need it."
    say ""

    cleanup
    trap - 0 HUP INT TERM

    return 0
}

print_usage() {
    cat <<'EOF'
Usage: install.sh

Interactively install BearMail: a local Stalwart mail engine binary and a
prebuilt webmail/calendar UI, then configure CORS and start two services.

Prepare a name.com domain (nameservers at name.com) and an SMTP relay account
(Brevo recommended, Mailjet also supported) before you run this. The installer
asks for the name.com API token and the relay SMTP login later. No installation
or setup answer is accepted as a command-line parameter.

The installer asks for paths and public values. Quick setup asks only for the
public mail hostname (example: mail.example.com) and primary mail domain
(example: example.com). Do not use this computer's cloud hostname, such as a
name ending in .internal. Quick setup keeps all other defaults and uses
best-effort detected public IPs.
Advanced setup exposes the complete bootstrap form in the terminal,
including nested storage, directory, logging, and DNS-provider settings.

Place these artifacts beside this script (or choose another path when asked):
  ./stalwart                   executable compiled from this source revision
  ./stalwart-webui.tar.gz      prebuilt WebUI archive

The WebUI archive must contain install.sh, server.mjs,
stalwart-webui.service, dist/index.html, and dist/config.json at its root.
Linux with systemd is required. If Node.js 22.12 or later is unavailable, the
installer downloads the latest official Node.js 22 Linux binary, verifies its
SHA-256 checksum, and installs a private runtime under /opt/stalwart-node/.

After setup, combined DNS records are printed in aligned TYPE, HOST, ANSWER,
TTL, and PRIO columns. The installer then asks which outbound SMTP relay to
use (Brevo by default, Mailjet, or skip), and whether the printed DNS rows
are already in the zone. If they are not, it can publish them through the
name.com DNS API.
The recommended publishing mode installs Caddy, routes the mail and BearMail
hostnames to separate localhost upstreams, obtains HTTPS certificates, and
synchronizes the mail-host certificate into the engine. An explicit
operator-managed mode leaves reverse-proxy configuration untouched.

Options:
  -h, --help  Show this help.

The interactive standard-layout choice uses these FHS paths:
  binary   /usr/local/bin/stalwart
  config   /etc/stalwart/config.json
  env      /etc/stalwart/stalwart.env
  logs     /var/log/stalwart/
  data     /var/lib/stalwart/

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

normalize_absolute_prefix() {
    local _input="$1" _description="$2"
    case "$_input" in
        /*) ;;
        *)
            VALIDATION_ERROR="The ${_description} must be an absolute path."
            return 1
            ;;
    esac
    case "$_input" in
        *[!A-Za-z0-9_./-]*)
            VALIDATION_ERROR="The ${_description} contains unsupported characters."
            return 1
            ;;
    esac
    case "$_input" in
        *//*|*/./*|*/.|*/../*|*/..)
            VALIDATION_ERROR="The ${_description} must be a normalized absolute path."
            return 1
            ;;
    esac
    while [ "${_input%/}" != "$_input" ]; do
        _input="${_input%/}"
    done
    if [ -z "$_input" ]; then
        VALIDATION_ERROR="'/' cannot be used as the ${_description}."
        return 1
    fi
    RETVAL="$_input"
}

prompt_absolute_prefix() {
    local _label="$1" _default="$2" _description="$3"
    while true; do
        prompt_text "$_label" "$_default"
        if normalize_absolute_prefix "$RETVAL" "$_description"; then
            return 0
        fi
        printf '  %s\n' "$VALIDATION_ERROR" >&3
    done
}

prompt_executable_file() {
    local _label="$1" _default="$2" _message="$3"
    while true; do
        prompt_text "$_label" "$_default"
        if [ -f "$RETVAL" ] && [ -x "$RETVAL" ]; then
            return 0
        fi
        printf '  %s\n' "$_message" >&3
    done
}

prompt_regular_file() {
    local _label="$1" _default="$2" _message="$3"
    while true; do
        prompt_text "$_label" "$_default"
        if [ -f "$RETVAL" ]; then
            return 0
        fi
        printf '  %s\n' "$_message" >&3
    done
}

prompt_webui_prefix() {
    local _label="$1" _default="$2" _protected_path _overlap
    shift 2
    while true; do
        prompt_absolute_prefix "$_label" "$_default" "WebUI installation prefix"
        _overlap=""
        for _protected_path in "$@"; do
            if paths_overlap "$RETVAL" "$_protected_path"; then
                _overlap="$_protected_path"
                break
            fi
        done
        if [ -z "$_overlap" ]; then
            return 0
        fi
        printf '  The WebUI prefix must not contain or be contained by the protected path (%s).\n' \
            "$_overlap" >&3
    done
}

prompt_port() {
    local _label="$1" _default="$2" _answer
    while true; do
        prompt_text "$_label" "$_default"
        _answer="$RETVAL"
        case "$_answer" in
            *[!0-9]*|'') ;;
            *)
                if [ "$_answer" -ge 1 ] 2>/dev/null && [ "$_answer" -le 65535 ] 2>/dev/null; then
                    RETVAL="$_answer"
                    return 0
                fi
                ;;
        esac
        printf '  Enter a port from 1 through 65535.\n' >&3
    done
}

prompt_webui_port() {
    local _label="$1" _default="$2"
    while true; do
        prompt_port "$_label" "$_default"
        if [ "$RETVAL" -ne 8080 ]; then
            return 0
        fi
        printf '  Port 8080 is reserved for Stalwart; enter a different port.\n' >&3
    done
}

prompt_https_origin() {
    local _label="$1" _default="$2"
    while true; do
        prompt_text "$_label" "$_default"
        if normalize_https_origin "$RETVAL"; then
            return 0
        fi
        printf '  %s\n' "$VALIDATION_ERROR" >&3
    done
}

prompt_dns_name() {
    local _label="$1" _default="$2"
    while true; do
        prompt_text "$_label" "$_default"
        if normalize_dns_name "$RETVAL"; then
            return 0
        fi
        printf '  %s\n' "$VALIDATION_ERROR" >&3
    done
}

looks_like_public_mail_hostname() {
    local _name
    _name="$(printf '%s' "$1" | tr 'A-Z' 'a-z')"
    _name="${_name%.}"
    case "$_name" in
        *.*) ;;
        *) return 1 ;;
    esac
    case "$_name" in
        *.internal|*.local|*.localhost|*.lan|*.home|*.corp|*.localdomain)
            return 1
            ;;
    esac
    return 0
}

suggested_public_mail_hostname() {
    local _candidate
    _candidate="$(hostname -f 2>/dev/null || hostname)"
    if looks_like_public_mail_hostname "$_candidate"; then
        RETVAL="$_candidate"
    else
        RETVAL=""
    fi
}

suggested_primary_mail_domain() {
    local _hostname="$1" _domain
    _domain="${_hostname#*.}"
    if looks_like_public_mail_hostname "$_domain"; then
        RETVAL="$_domain"
    else
        RETVAL=""
    fi
}

suggested_webui_origin() {
    RETVAL="https://bearmail.${1}"
}

is_example_webui_placeholder() {
    case "$1" in
        bearmail.example.com|bearmail.example.org|bearmail.example.net|bearmail.example.test|\
        webmail.example.com|webmail.example.org|webmail.example.net|webmail.example.test)
            return 0
            ;;
    esac
    return 1
}

confirm_dedicated_webui_origin() {
    local _mode="$1" _mail_hostname="$2" _mail_domain="$3" _suggested
    suggested_webui_origin "$_mail_domain"
    _suggested="$RETVAL"
    if is_example_webui_placeholder "$_webui_hostname"; then
        printf '  The WebUI origin is still the installer example (%s).\n' "$_webui_origin" >&3
        printf '  Use a dedicated hostname in your mail domain, typically %s\n' "$_suggested" >&3
        prompt_https_origin "Public WebUI origin (exact HTTPS URL, no path)" "$_suggested"
        _webui_origin="$RETVAL"
        origin_hostname "$_webui_origin"
        _webui_hostname="$RETVAL"
    fi
    if webui_hostname_conflicts "$_mode" "$_mail_hostname" "$_mail_domain" "$_webui_hostname" || \
        { [ "$_mode" = "caddy" ] && [ "$_webui_origin" != "https://${_webui_hostname}" ]; }
    then
        printf '  The WebUI hostname conflicts with a Stalwart public hostname.\n' >&3
        while webui_hostname_conflicts "$_mode" "$_mail_hostname" "$_mail_domain" "$_webui_hostname" || \
            { [ "$_mode" = "caddy" ] && [ "$_webui_origin" != "https://${_webui_hostname}" ]; }
        do
            prompt_https_origin "Public WebUI origin (exact HTTPS URL, no path)" \
                "$_suggested"
            _webui_origin="$RETVAL"
            origin_hostname "$_webui_origin"
            _webui_hostname="$RETVAL"
            if [ "$_mode" = "caddy" ] && [ "$_webui_origin" != "https://${_webui_hostname}" ]; then
                printf '  Automatic Caddy publishing requires standard HTTPS port 443.\n' >&3
            elif webui_hostname_conflicts "$_mode" "$_mail_hostname" "$_mail_domain" "$_webui_hostname"; then
                printf '  Enter a dedicated WebUI hostname such as bearmail.%s.\n' "$_mail_domain" >&3
            fi
        done
    fi
}

print_server_identity_help() {
    say ""
    say "Public mail hostname and mail domain"
    say "------------------------------------"
    say "Enter DNS names you will publish for this mail server, not this VM's"
    say "cloud or OS hostname (do not use a name ending in .internal or .local)."
    say "  Public mail hostname: eg, mail.example.com"
    say "    SMTP greeting, TLS certificate, MX/A records, and the WebUI server URL."
    say "  Primary mail domain: eg, if you want admin@example.com as email address,"
    say "    input example.com here."
    say "  WebUI hostname        typically bearmail.example.com, not mail.example.com."
    say "    If you left the earlier example, it becomes https://bearmail.<domain>."
    say "Press Enter only if the value in [brackets] is already that public DNS name."
    say ""
}

prompt_relay_port() {
    local _label="$1" _default="$2"
    while true; do
        prompt_port "$_label" "$_default"
        case "$RETVAL" in
            465|587|588|2525) return 0 ;;
        esac
        printf '  Enter 587 (STARTTLS) or 465 (implicit TLS). 588 and 2525 are also accepted.\n' >&3
    done
}

prompt_mailjet_port() {
    prompt_relay_port "$@"
}

prompt_admin_credentials() {
    local _default="${1:-admin}"
    prompt_text "Stalwart administrator username" "$_default"
    ADMIN_USERNAME_RETVAL="$RETVAL"
    prompt_secret "Stalwart administrator password or app password"
    ADMIN_SECRET_RETVAL="$RETVAL"
}

prompt_secret() {
    local _label="$1" _answer _saved_tty
    while true; do
        printf '%s: ' "$_label" >&3
        _saved_tty="$(stty -g <&3)"
        cleanup_tty_state="$_saved_tty"
        stty -echo <&3
        if ! IFS= read -r _answer <&3; then
            stty "$_saved_tty" <&3
            cleanup_tty_state=""
            printf '\n' >&3
            err "❌ Install failed: Interactive input ended before setup completed."
        fi
        stty "$_saved_tty" <&3
        cleanup_tty_state=""
        printf '\n' >&3
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

node_at_least_22_12() {
    local _version _numbers _major _rest _minor _patch
    _version="$("$1" --version 2>/dev/null)" || return 1
    case "$_version" in
        v*) _numbers="${_version#v}" ;;
        *) return 1 ;;
    esac
    case "$_numbers" in
        ''|.*|*.|*..*|*[!0-9.]*) return 1 ;;
    esac
    _major="${_numbers%%.*}"
    _rest="${_numbers#*.}"
    [ "$_rest" != "$_numbers" ] || return 1
    _minor="${_rest%%.*}"
    _patch="${_rest#*.}"
    [ "$_patch" != "$_rest" ] || return 1
    case "$_major:$_minor:$_patch" in
        *[!0-9:]*) return 1 ;;
    esac
    [ "$_major" -gt 22 ] 2>/dev/null || \
        { [ "$_major" -eq 22 ] 2>/dev/null && [ "$_minor" -ge 12 ] 2>/dev/null; }
}

prepare_node_runtime() {
    local _tmp="$1" _candidate="" _arch="" _latest_sums _release_sums
    local _archive_name="" _archive="" _archive_root="" _version=""
    local _expected="" _actual="" _stage="" _destination="" _new_destination=""

    if check_cmd node; then
        _candidate="$(command -v node)"
        case "$_candidate" in
            /home/*|/root/*|/run/user/*) _candidate="" ;;
            /*) ;;
            *) _candidate="" ;;
        esac
    fi
    if [ -n "$_candidate" ] && node_at_least_22_12 "$_candidate"; then
        NODE_BIN="$_candidate"
        NODE_VERSION="$("$NODE_BIN" --version)"
        say "✅ Using Node.js ${NODE_VERSION} at ${NODE_BIN}."
        return 0
    fi

    case "$(uname -m)" in
        x86_64|amd64) _arch="x64" ;;
        aarch64|arm64) _arch="arm64" ;;
        armv7l) _arch="armv7l" ;;
        ppc64le) _arch="ppc64le" ;;
        s390x) _arch="s390x" ;;
        *) err "❌ Install failed: No official Node.js 22 Linux binary is available for architecture $(uname -m). Install Node.js 22.12 or later and rerun the installer." ;;
    esac

    ensure_download_client
    _latest_sums="${_tmp}/node-latest-SHASUMS256.txt"
    say "📥 Node.js 22.12 or later was not found; downloading the official runtime..."
    download_file "https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt" "$_latest_sums"
    _archive_name="$(sed -n "s/^.*  \(node-v[^ ]*-linux-${_arch}\.tar\.gz\)$/\1/p" "$_latest_sums" | sed -n '1p')"
    if [ -z "$_archive_name" ]; then
        err "❌ Install failed: The Node.js release index has no Linux ${_arch} archive."
    fi
    case "$_archive_name" in
        *[!A-Za-z0-9._-]*) err "❌ Install failed: The Node.js release index returned an unsafe archive name." ;;
    esac
    _version="$(printf '%s\n' "$_archive_name" | sed 's/^node-\(v[^-]*\)-.*/\1/')"
    case "$_version" in
        v22.*)
            case "${_version#v}" in
                .*|*.|*..*|*[!0-9.]*) err "❌ Install failed: The Node.js release index returned an invalid version (${_version})." ;;
            esac
            ;;
        *) err "❌ Install failed: The Node.js release index returned an unexpected version (${_version})." ;;
    esac

    _release_sums="${_tmp}/node-${_version}-SHASUMS256.txt"
    _archive="${_tmp}/${_archive_name}"
    download_file "https://nodejs.org/dist/${_version}/SHASUMS256.txt" "$_release_sums"
    download_file "https://nodejs.org/dist/${_version}/${_archive_name}" "$_archive"
    _expected="$(sed -n "s/^\([0-9a-fA-F][0-9a-fA-F]*\)  ${_archive_name}$/\1/p" "$_release_sums" | sed -n '1p')"
    if [ -z "$_expected" ]; then
        err "❌ Install failed: The official checksum file does not contain ${_archive_name}."
    fi
    if [ "${#_expected}" -ne 64 ]; then
        err "❌ Install failed: The official Node.js SHA-256 value has an invalid length."
    fi
    ensure_checksum_client
    sha256_file "$_archive"
    _actual="$RETVAL"
    if [ "$_actual" != "$_expected" ]; then
        err "❌ Install failed: The Node.js archive checksum did not match the official SHA-256 value."
    fi

    _archive_root="${_archive_name%.tar.gz}"
    _stage="${_tmp}/node-runtime"
    ensure mkdir -p "$_stage"
    ensure tar --no-same-owner --no-same-permissions -xzf "$_archive" \
        -C "$_stage" --strip-components=1 "${_archive_root}/bin/node"
    if [ ! -x "${_stage}/bin/node" ] || ! node_at_least_22_12 "${_stage}/bin/node"; then
        err "❌ Install failed: The downloaded Node.js runtime is missing, unusable, or older than 22.12."
    fi
    NODE_VERSION="$("${_stage}/bin/node" --version)"
    if [ "$NODE_VERSION" != "$_version" ]; then
        err "❌ Install failed: The downloaded Node.js runtime reports ${NODE_VERSION}, expected ${_version}."
    fi

    _destination="${NODE_INSTALL_ROOT}/${_version}/bin/node"
    _new_destination="${_destination}.new.$$"
    ensure install -d "${NODE_INSTALL_ROOT}/${_version}/bin"
    ensure install -m 0755 "${_stage}/bin/node" "$_new_destination"
    ensure mv -f "$_new_destination" "$_destination"
    NODE_BIN="$_destination"
    say "✅ Installed private Node.js ${NODE_VERSION} at ${NODE_BIN}."
}

ensure_download_client() {
    if check_cmd curl || check_cmd wget; then
        return 0
    fi

    say "📦 Installing curl so the official Node.js runtime can be downloaded..."
    if check_cmd apt-get; then
        ensure env DEBIAN_FRONTEND=noninteractive apt-get update
        ensure env DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl
    elif check_cmd dnf; then
        ensure dnf install -y ca-certificates curl
    elif check_cmd microdnf; then
        ensure microdnf install -y ca-certificates curl
    elif check_cmd yum; then
        ensure yum install -y ca-certificates curl
    elif check_cmd zypper; then
        ensure zypper --non-interactive install ca-certificates curl
    elif check_cmd pacman; then
        ensure pacman -S --needed --noconfirm ca-certificates curl
    else
        err "❌ Install failed: curl or wget is required to download Node.js, and no supported package manager was found. Install curl and rerun the installer."
    fi

    if ! check_cmd curl && ! check_cmd wget; then
        err "❌ Install failed: A download client could not be installed."
    fi
}

ensure_checksum_client() {
    if check_cmd sha256sum || check_cmd shasum || check_cmd openssl; then
        return 0
    fi

    say "📦 Installing coreutils so the Node.js download can be verified..."
    if check_cmd apt-get; then
        ensure env DEBIAN_FRONTEND=noninteractive apt-get update
        ensure env DEBIAN_FRONTEND=noninteractive apt-get install -y coreutils
    elif check_cmd dnf; then
        ensure dnf install -y coreutils
    elif check_cmd microdnf; then
        ensure microdnf install -y coreutils
    elif check_cmd yum; then
        ensure yum install -y coreutils
    elif check_cmd zypper; then
        ensure zypper --non-interactive install coreutils
    elif check_cmd pacman; then
        ensure pacman -S --needed --noconfirm coreutils
    else
        err "❌ Install failed: A SHA-256 utility is required to verify Node.js, and no supported package manager was found. Install coreutils and rerun the installer."
    fi

    if ! check_cmd sha256sum && ! check_cmd shasum && ! check_cmd openssl; then
        err "❌ Install failed: A SHA-256 utility could not be installed."
    fi
}

ensure_caddy_available() {
    if check_cmd caddy && systemctl cat caddy.service >/dev/null 2>&1; then
        return 0
    fi

    say "📦 Installing the distribution Caddy package..."
    if check_cmd apt-get; then
        ensure env DEBIAN_FRONTEND=noninteractive apt-get update
        ensure env DEBIAN_FRONTEND=noninteractive apt-get install -y caddy
    elif check_cmd dnf; then
        ensure dnf install -y caddy
    elif check_cmd microdnf; then
        ensure microdnf install -y caddy
    elif check_cmd yum; then
        ensure yum install -y caddy
    elif check_cmd zypper; then
        ensure zypper --non-interactive install caddy
    elif check_cmd pacman; then
        ensure pacman -S --needed --noconfirm caddy
    else
        err "❌ Install failed: Automatic HTTPS publishing needs Caddy and no supported package manager was found. Install the Caddy systemd package or choose operator-managed proxy mode."
    fi

    if ! check_cmd caddy || ! systemctl cat caddy.service >/dev/null 2>&1; then
        err "❌ Install failed: Caddy and caddy.service are required for automatic HTTPS publishing. Install the distribution package or choose operator-managed proxy mode."
    fi
}

ensure_openssl_available() {
    if check_cmd openssl; then
        return 0
    fi

    say "📦 Installing OpenSSL for certificate validation and synchronization..."
    if check_cmd apt-get; then
        ensure env DEBIAN_FRONTEND=noninteractive apt-get update
        ensure env DEBIAN_FRONTEND=noninteractive apt-get install -y openssl
    elif check_cmd dnf; then
        ensure dnf install -y openssl
    elif check_cmd microdnf; then
        ensure microdnf install -y openssl
    elif check_cmd yum; then
        ensure yum install -y openssl
    elif check_cmd zypper; then
        ensure zypper --non-interactive install openssl
    elif check_cmd pacman; then
        ensure pacman -S --needed --noconfirm openssl
    else
        err "❌ Install failed: OpenSSL is required to synchronize Caddy certificates into Stalwart."
    fi
    need_cmd openssl
}

download_file() {
    local _url="$1" _destination="$2"
    if check_cmd curl; then
        if ! curl --proto '=https' --tlsv1.2 --silent --show-error --fail \
            --location --connect-timeout 10 --retry 3 --output "$_destination" "$_url"; then
            err "❌ Install failed: Could not download ${_url}."
        fi
    elif check_cmd wget; then
        if ! wget --https-only --quiet --timeout=30 --tries=3 \
            --output-document="$_destination" "$_url"; then
            err "❌ Install failed: Could not download ${_url}."
        fi
    else
        err "❌ Install failed: curl or wget is required to download ${_url}."
    fi
}

sha256_file() {
    local _path="$1" _digest=""
    if check_cmd sha256sum; then
        _digest="$(sha256sum "$_path" | sed 's/[[:space:]].*$//')"
    elif check_cmd shasum; then
        _digest="$(shasum -a 256 "$_path" | sed 's/[[:space:]].*$//')"
    elif check_cmd openssl; then
        _digest="$(openssl dgst -sha256 "$_path" | sed 's/^.*= *//')"
    else
        err "❌ Install failed: sha256sum, shasum, or openssl is required to verify the Node.js download."
    fi
    case "$_digest" in
        *[!0-9a-fA-F]*|'') err "❌ Install failed: Could not calculate the Node.js archive checksum." ;;
    esac
    RETVAL="$_digest"
}

normalize_https_origin() {
    local _input="$1" _authority _hostname _port="" _label _remaining
    case "$_input" in
        https://*) _authority="${_input#https://}" ;;
        *)
            VALIDATION_ERROR="The public WebUI origin must use HTTPS, for example https://bearmail.example.com."
            return 1
            ;;
    esac
    case "$_authority" in
        ''|*/*|*\?*|*\#*|*@*|*:*:*)
            VALIDATION_ERROR="The WebUI origin must be an exact HTTPS DNS origin without credentials, a path, a query, or a fragment."
            return 1
            ;;
    esac
    case "$_authority" in
        *:*)
            _hostname="${_authority%%:*}"
            _port="${_authority#*:}"
            case "$_port" in
                *[!0-9]*|'')
                    VALIDATION_ERROR="The WebUI origin contains an invalid port."
                    return 1
                    ;;
            esac
            _port="$(printf '%s\n' "$_port" | sed 's/^0*//')"
            [ -n "$_port" ] || _port="0"
            if [ "$_port" -lt 1 ] 2>/dev/null || [ "$_port" -gt 65535 ] 2>/dev/null; then
                VALIDATION_ERROR="The WebUI origin port must be from 1 through 65535."
                return 1
            fi
            ;;
        *) _hostname="$_authority" ;;
    esac
    _hostname="$(printf '%s' "$_hostname" | tr '[:upper:]' '[:lower:]')"
    case "$_hostname" in
        .*|*.|*..*|*[!a-z0-9.-]*)
            VALIDATION_ERROR="The public WebUI origin contains an invalid DNS hostname."
            return 1
            ;;
        *[!0-9.]*) ;;
        *)
            VALIDATION_ERROR="The public WebUI origin must use a DNS hostname, not an IP address."
            return 1
            ;;
    esac
    case "$_hostname" in
        *.*) ;;
        *)
            VALIDATION_ERROR="The public WebUI origin must contain a fully qualified DNS hostname."
            return 1
            ;;
    esac
    if [ "${#_hostname}" -gt 253 ]; then
        VALIDATION_ERROR="The WebUI hostname is longer than 253 characters."
        return 1
    fi
    _remaining="$_hostname"
    while true; do
        _label="${_remaining%%.*}"
        case "$_label" in
            ''|-*|*-|*[!a-z0-9-]*)
                VALIDATION_ERROR="The WebUI origin contains an invalid DNS hostname."
                return 1
                ;;
        esac
        if [ "${#_label}" -gt 63 ]; then
            VALIDATION_ERROR="A WebUI hostname label is longer than 63 characters."
            return 1
        fi
        case "$_remaining" in
            *.*) _remaining="${_remaining#*.}" ;;
            *) break ;;
        esac
    done
    if [ -n "$_port" ] && [ "$_port" != "443" ]; then
        RETVAL="https://${_hostname}:${_port}"
    else
        RETVAL="https://${_hostname}"
    fi
}

origin_hostname() {
    local _authority
    _authority="${1#https://}"
    RETVAL="${_authority%%:*}"
}

validate_caddy_config_ownership() {
    if [ -L "$CADDY_CONFIG_FILE" ]; then
        err "❌ Install failed: ${CADDY_CONFIG_FILE} is a symbolic link. Choose the operator-managed proxy mode."
    fi
    if [ -e "$CADDY_CONFIG_FILE" ] && [ ! -f "$CADDY_CONFIG_FILE" ]; then
        err "❌ Install failed: ${CADDY_CONFIG_FILE} is not a regular file. Choose the operator-managed proxy mode."
    fi
    if [ -f "$CADDY_CONFIG_FILE" ] && \
        ! grep -F -q "$CADDY_MANAGED_MARKER" "$CADDY_CONFIG_FILE" && \
        ! is_pristine_packaged_caddyfile "$CADDY_CONFIG_FILE"
    then
        err "❌ Install failed: ${CADDY_CONFIG_FILE} is not owned by this installer. Preserve it and rerun using the operator-managed proxy mode."
    fi
    # A packaged Caddy with no Caddyfile is safe to claim. The installer writes
    # its managed file later. Only refuse when an unmarked file already exists.
}

is_pristine_packaged_caddyfile() {
    local _path="$1" _expected="" _actual=""
    if check_cmd dpkg-query && check_cmd md5sum; then
        _expected="$(dpkg-query -W -f='${Conffiles}\n' caddy 2>/dev/null | \
            sed -n 's|^[[:space:]]*/etc/caddy/Caddyfile[[:space:]]\([0-9a-fA-F][0-9a-fA-F]*\).*$|\1|p' | \
            sed -n '1p')"
        if [ -n "$_expected" ]; then
            _actual="$(md5sum "$_path" 2>/dev/null | sed 's/[[:space:]].*$//' || true)"
            [ "$_actual" = "$_expected" ] && return 0
        fi
    fi
    return 1
}

webui_hostname_conflicts() {
    local _mode="$1" _mail_hostname="$2" _mail_domain="$3" _webui_hostname="$4"
    if [ "$_webui_hostname" = "$_mail_hostname" ]; then
        return 0
    fi
    if [ "$_mode" = "caddy" ]; then
        case "$_webui_hostname" in
            "mta-sts.${_mail_domain}"|"ua-auto-config.${_mail_domain}"|\
            "autoconfig.${_mail_domain}"|"autodiscover.${_mail_domain}") return 0 ;;
        esac
    fi
    return 1
}

normalize_dns_name() {
    local _input="$1" _normalized
    if ! _normalized="$(DNS_NAME="$_input" "$NODE_BIN" -e '
      const name = process.env.DNS_NAME.trim().toLowerCase().replace(/\.$/, "");
      const labels = name.split(".");
      if (name.length > 253 || labels.length < 2 || labels.some((label) =>
        label.length < 1 || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
        throw new Error("expected a fully qualified DNS name");
      }
      console.log(name);
    ' 2>&1)"; then
        VALIDATION_ERROR="Invalid DNS name '${_input}': ${_normalized}"
        return 1
    fi
    RETVAL="$_normalized"
}

paths_overlap() {
    local _left="${1%/}" _right="${2%/}"
    case "${_left}/" in "${_right}/"*) return 0 ;; esac
    case "${_right}/" in "${_left}/"*) return 0 ;; esac
    return 1
}

json_field() {
    local _path="$1" _field="$2" _value
    if ! _value="$(JSON_PATH="$_path" JSON_FIELD="$_field" "$NODE_BIN" -e '
      const fs = require("node:fs");
      let value = JSON.parse(fs.readFileSync(process.env.JSON_PATH, "utf8"));
      for (const part of process.env.JSON_FIELD.split(".")) value = value?.[part];
      if (value != null) process.stdout.write(String(value));
    ')"; then
        err "❌ Install failed: Could not read ${_field} from ${_path}."
    fi
    RETVAL="$_value"
}

wait_for_http() {
    local _url="$1" _label="$2"
    if ! HEALTH_URL="$_url" HEALTH_LABEL="$_label" "$NODE_BIN" -e '
      const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      (async () => {
        let last = "no response";
        for (let attempt = 0; attempt < 60; attempt++) {
          try {
            const response = await fetch(process.env.HEALTH_URL, { signal: AbortSignal.timeout(2000) });
            if (response.ok) return;
            last = `HTTP ${response.status}`;
          } catch (error) { last = error.message; }
          await delay(1000);
        }
        throw new Error(`${process.env.HEALTH_LABEL} did not become ready: ${last}`);
      })().catch((error) => { console.error(error.message); process.exit(1); });
    '; then
        err "❌ Install failed: ${_label} did not pass its local readiness check."
    fi
}

create_placeholder_certificate() {
    local _directory="$1" _certificate="$2" _private_key="$3"
    local _hostname="$4" _account="$5" _cert_public="" _key_public=""
    local _new_certificate="${_certificate}.new.$$" _new_private_key="${_private_key}.new.$$"

    ensure install -d -m 0750 -o root -g "$_account" "$_directory"
    if [ -f "$_certificate" ] && [ -f "$_private_key" ]; then
        _cert_public="$(openssl x509 -in "$_certificate" -pubkey -noout 2>/dev/null | \
            openssl pkey -pubin -outform DER 2>/dev/null | openssl dgst -sha256 2>/dev/null || true)"
        _key_public="$(openssl pkey -in "$_private_key" -pubout -outform DER 2>/dev/null | \
            openssl dgst -sha256 2>/dev/null || true)"
        if [ -n "$_cert_public" ] && [ "$_cert_public" = "$_key_public" ] && \
            openssl x509 -in "$_certificate" -noout -checkhost "$_hostname" >/dev/null 2>&1
        then
            ensure chown "root:${_account}" "$_certificate" "$_private_key"
            ensure chmod 0640 "$_certificate" "$_private_key"
            return 0
        fi
    fi

    if ! openssl req -x509 -newkey rsa:2048 -nodes -sha256 -days 30 \
        -subj "/CN=${_hostname}" -addext "subjectAltName=DNS:${_hostname}" \
        -keyout "$_new_private_key" -out "$_new_certificate" >/dev/null 2>&1
    then
        rm -f "$_new_certificate" "$_new_private_key"
        err "❌ Install failed: Could not create the temporary certificate used before Caddy finishes ACME issuance."
    fi
    ensure chown "root:${_account}" "$_new_certificate" "$_new_private_key"
    ensure chmod 0640 "$_new_certificate" "$_new_private_key"
    ensure mv -f "$_new_private_key" "$_private_key"
    ensure mv -f "$_new_certificate" "$_certificate"
}

configure_stalwart_caddy_proxy() {
    local _domain="$1" _certificate="$2" _private_key="$3"
    local _username="$4" _secret="$5"
    printf '%s' "$_secret" | \
        STALWART_MAIL_DOMAIN="$_domain" STALWART_CERTIFICATE_PATH="$_certificate" \
        STALWART_PRIVATE_KEY_PATH="$_private_key" STALWART_ADMIN_USERNAME="$_username" \
        "$NODE_BIN" -e '
          const fs = require("node:fs");
          const username = process.env.STALWART_ADMIN_USERNAME;
          const password = fs.readFileSync(0, "utf8");
          const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

          async function call(method, args, tag) {
            const response = await fetch("http://127.0.0.1:8080/jmap/", {
              method: "POST",
              headers: { Authorization: authorization, "Content-Type": "application/json" },
              body: JSON.stringify({
                using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],
                methodCalls: [[method, args, tag]],
              }),
              signal: AbortSignal.timeout(15000),
            });
            const text = await response.text();
            let body;
            try { body = JSON.parse(text); } catch {
              throw new Error(`${method} returned non-JSON (${response.status}): ${text.slice(0, 300)}`);
            }
            if (!response.ok) {
              const err = new Error(`${method} was rejected (${response.status}): ${text.slice(0, 500)}`);
              if (response.status === 401 || response.status === 403) err.authFailed = true;
              throw err;
            }
            const result = (body.methodResponses ?? []).find((entry) => entry[2] === tag);
            if (!result) throw new Error(`${method} returned no tagged response: ${text.slice(0, 500)}`);
            if (result[0] === "error") {
              const err = new Error(`${method} failed: ${JSON.stringify(result[1])}`);
              if (/forbidden|unauthorized|authentication/i.test(String(result[1]?.type ?? ""))) err.authFailed = true;
              throw err;
            }
            return result[1];
          }

          function assertSet(result, label) {
            for (const field of ["notCreated", "notUpdated", "notDestroyed"]) {
              if (Object.keys(result?.[field] ?? {}).length) {
                throw new Error(`${label} failed: ${JSON.stringify(result[field])}`);
              }
            }
          }

          (async () => {
            const listeners = await call("x:NetworkListener/get", {
              properties: ["id", "name", "protocol", "bind", "tlsImplicit"],
            }, "listeners");
            const http = (listeners.list ?? []).find((listener) => listener.name === "http");
            const https = (listeners.list ?? []).find((listener) => listener.name === "https");
            if (!http || !https) {
              throw new Error("The default Stalwart HTTP listeners named http and https were not found.");
            }

            const certificates = await call("x:Certificate/get", {
              properties: ["id", "certificate"],
            }, "certificates");
            const certificatePath = process.env.STALWART_CERTIFICATE_PATH;
            let certificateId = (certificates.list ?? []).find((certificate) =>
              certificate.certificate?.["@type"] === "File" &&
              certificate.certificate?.filePath === certificatePath)?.id;
            if (!certificateId) {
              const created = await call("x:Certificate/set", { create: { caddyMail: {
                certificate: { "@type": "File", filePath: certificatePath },
                privateKey: { "@type": "File", filePath: process.env.STALWART_PRIVATE_KEY_PATH },
              } } }, "createCertificate");
              assertSet(created, "Caddy-backed certificate creation");
              certificateId = created.created?.caddyMail?.id;
              if (!certificateId) throw new Error(`Certificate creation returned no id: ${JSON.stringify(created)}`);
            } else {
              const updated = await call("x:Certificate/set", { update: {
                [certificateId]: {
                  certificate: { "@type": "File", filePath: certificatePath },
                  privateKey: { "@type": "File", filePath: process.env.STALWART_PRIVATE_KEY_PATH },
                },
              } }, "updateCertificate");
              assertSet(updated, "Caddy-backed certificate update");
            }

            const domains = await call("x:Domain/query", {
              filter: { name: process.env.STALWART_MAIL_DOMAIN },
            }, "domainQuery");
            if ((domains.ids ?? []).length !== 1) {
              throw new Error(`Expected one primary mail domain, found ${(domains.ids ?? []).length}.`);
            }
            const domainId = domains.ids[0];

            const domainUpdate = await call("x:Domain/set", { update: {
              [domainId]: { certificateManagement: { "@type": "Manual" } },
            } }, "domainUpdate");
            assertSet(domainUpdate, "Domain certificate management update");

            const listenerUpdate = await call("x:NetworkListener/set", { update: {
              [http.id]: { bind: { "127.0.0.1:8080": true } },
              [https.id]: { bind: { "127.0.0.1:8443": true } },
            } }, "listenerUpdate");
            assertSet(listenerUpdate, "HTTP listener update");

            const systemUpdate = await call("x:SystemSettings/set", { update: {
              singleton: { defaultCertificateId: certificateId },
            } }, "systemUpdate");
            assertSet(systemUpdate, "Default certificate update");

            const httpUpdate = await call("x:Http/set", { update: {
              singleton: { useXForwarded: true },
            } }, "httpUpdate");
            assertSet(httpUpdate, "Forwarded-header update");
          })().catch((error) => {
            console.error(error.message);
            process.exit(error.authFailed ? 2 : 1);
          });
        ' || return $?
}

install_stalwart_public_url_dropin() {
    local _path="$1" _hostname="$2" _directory
    _directory="$(dirname "$_path")"
    ensure install -d -m 0755 "$_directory"
    cat > "$_path" <<EOF
# Managed by the Stalwart combined installer.
[Service]
Environment="STALWART_HOSTNAME=${_hostname}"
Environment="STALWART_PUBLIC_URL=https://${_hostname}"
EOF
    ensure chmod 0644 "$_path"
}

write_caddy_configuration_file() {
    local _path="$1" _mail_hostname="$2" _mail_domain="$3"
    local _webui_hostname="$4" _webui_port="$5" _hosts _candidate
    _hosts="$_mail_hostname"
    for _candidate in \
        "mta-sts.${_mail_domain}" \
        "ua-auto-config.${_mail_domain}" \
        "autoconfig.${_mail_domain}" \
        "autodiscover.${_mail_domain}"
    do
        case ",${_hosts}," in
            *",${_candidate},"*) ;;
            *) _hosts="${_hosts},${_candidate}" ;;
        esac
    done
    _hosts="$(printf '%s' "$_hosts" | sed 's/,/, /g')"

    cat > "$_path" <<EOF
${CADDY_MANAGED_MARKER}
# Public HTTPS routing for Stalwart protocol discovery and administration.
${_hosts} {
    reverse_proxy 127.0.0.1:8080
}

# Mail and Calendar WebUI. This is intentionally a separate upstream.
${_webui_hostname} {
    reverse_proxy 127.0.0.1:${_webui_port}
}
EOF
}

install_caddy_configuration() {
    local _tmp="$1" _mail_hostname="$2" _mail_domain="$3"
    local _webui_hostname="$4" _webui_port="$5" _stage
    _stage="${_tmp}/Caddyfile.stalwart"
    write_caddy_configuration_file \
        "$_stage" "$_mail_hostname" "$_mail_domain" "$_webui_hostname" "$_webui_port"
    if ! caddy fmt --overwrite "$_stage"; then
        err "❌ Install failed: Caddy could not format the generated reverse-proxy configuration."
    fi
    if ! caddy validate --config "$_stage" --adapter caddyfile; then
        err "❌ Install failed: Caddy rejected the generated reverse-proxy configuration."
    fi
    ensure install -d -m 0755 "$(dirname "$CADDY_CONFIG_FILE")"
    ensure install -m 0644 "$_stage" "$CADDY_CONFIG_FILE"
}

write_caddy_certificate_sync_script() {
    local _path="$1" _hostname="$2" _certificate="$3" _private_key="$4" _account="$5"
    cat > "$_path" <<EOF
#!/usr/bin/env sh
set -eu

mail_hostname='${_hostname}'
caddy_cert_root='${CADDY_CERT_ROOT}'
stalwart_certificate='${_certificate}'
stalwart_private_key='${_private_key}'
stalwart_group='${_account}'

selected_certificate=''
selected_private_key=''
for candidate in "\${caddy_cert_root}"/*/"\${mail_hostname}"/"\${mail_hostname}.crt"; do
    [ -f "\${candidate}" ] || continue
    candidate_key="\${candidate%.crt}.key"
    [ -f "\${candidate_key}" ] || continue
    openssl x509 -in "\${candidate}" -noout -checkhost "\${mail_hostname}" >/dev/null 2>&1 || continue
    certificate_public_key="\$(openssl x509 -in "\${candidate}" -pubkey -noout 2>/dev/null | \
        openssl pkey -pubin -outform DER 2>/dev/null | openssl dgst -sha256 2>/dev/null)" || continue
    private_public_key="\$(openssl pkey -in "\${candidate_key}" -pubout -outform DER 2>/dev/null | \
        openssl dgst -sha256 2>/dev/null)" || continue
    [ -n "\${certificate_public_key}" ] && [ "\${certificate_public_key}" = "\${private_public_key}" ] || continue
    if [ -z "\${selected_certificate}" ] || [ "\${candidate}" -nt "\${selected_certificate}" ]; then
        selected_certificate="\${candidate}"
        selected_private_key="\${candidate_key}"
    fi
done

if [ -z "\${selected_certificate}" ]; then
    printf '%s\n' "Caddy certificate for \${mail_hostname} is not available yet; retrying on the next timer run." >&2
    exit 0
fi
if cmp -s "\${selected_certificate}" "\${stalwart_certificate}" && \
    cmp -s "\${selected_private_key}" "\${stalwart_private_key}"
then
    exit 0
fi

certificate_new="\${stalwart_certificate}.new.\$$"
private_key_new="\${stalwart_private_key}.new.\$$"
trap 'rm -f "\${certificate_new}" "\${private_key_new}"' EXIT HUP INT TERM
install -m 0640 -o root -g "\${stalwart_group}" "\${selected_certificate}" "\${certificate_new}"
install -m 0640 -o root -g "\${stalwart_group}" "\${selected_private_key}" "\${private_key_new}"
mv -f "\${private_key_new}" "\${stalwart_private_key}"
mv -f "\${certificate_new}" "\${stalwart_certificate}"
trap - EXIT HUP INT TERM
systemctl restart stalwart.service
printf '%s\n' "Imported Caddy certificate for \${mail_hostname} and restarted Stalwart."
EOF
}

install_caddy_certificate_sync() {
    local _hostname="$1" _certificate="$2" _private_key="$3" _account="$4"
    local _new_script="${CADDY_CERT_SYNC_SCRIPT}.new.$$"
    ensure install -d -m 0755 "$(dirname "$CADDY_CERT_SYNC_SCRIPT")"
    write_caddy_certificate_sync_script \
        "$_new_script" "$_hostname" "$_certificate" "$_private_key" "$_account"
    ensure chmod 0755 "$_new_script"
    ensure mv -f "$_new_script" "$CADDY_CERT_SYNC_SCRIPT"

    cat > "$CADDY_CERT_SYNC_SERVICE" <<EOF
[Unit]
Description=Synchronize Caddy's mail certificate into Stalwart
After=caddy.service

[Service]
Type=oneshot
ExecStart=${CADDY_CERT_SYNC_SCRIPT}
EOF
    cat > "$CADDY_CERT_SYNC_TIMER" <<'EOF'
[Unit]
Description=Periodically synchronize Caddy's mail certificate into Stalwart

[Timer]
OnBootSec=2min
OnUnitActiveSec=15min
Persistent=true
Unit=stalwart-caddy-cert-sync.service

[Install]
WantedBy=timers.target
EOF
    ensure chmod 0644 "$CADDY_CERT_SYNC_SERVICE" "$CADDY_CERT_SYNC_TIMER"
}

configure_stalwart_cors() {
    local _origin="$1" _username="$2" _secret="$3"
    printf '%s' "$_secret" | \
        STALWART_WEBUI_ORIGIN="$_origin" STALWART_ADMIN_USERNAME="$_username" \
        "$NODE_BIN" -e '
          const fs = require("node:fs");
          const origin = process.env.STALWART_WEBUI_ORIGIN;
          const username = process.env.STALWART_ADMIN_USERNAME;
          const password = fs.readFileSync(0, "utf8");
          const authorization = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
          const headers = {
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Headers": "Authorization, Content-Type, Accept, X-Requested-With",
            "Access-Control-Allow-Methods": "POST, GET, PATCH, PUT, DELETE, HEAD, OPTIONS",
            "Vary": "Origin",
          };
          const payload = {
            using: ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"],
            methodCalls: [
              ["x:Http/set", { update: { singleton: {
                usePermissiveCors: false,
                "responseHeaders/Access-Control-Allow-Origin": headers["Access-Control-Allow-Origin"],
                "responseHeaders/Access-Control-Allow-Headers": headers["Access-Control-Allow-Headers"],
                "responseHeaders/Access-Control-Allow-Methods": headers["Access-Control-Allow-Methods"],
                "responseHeaders/Vary": headers.Vary,
              } } }, "cors"],
              ["x:Action/set", { create: { reload: { "@type": "ReloadSettings" } } }, "reload"],
            ],
          };
          const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
          (async () => {
            const response = await fetch("http://127.0.0.1:8080/jmap/", {
              method: "POST",
              headers: { Authorization: authorization, "Content-Type": "application/json" },
              body: JSON.stringify(payload),
              signal: AbortSignal.timeout(10000),
            });
            const text = await response.text();
            let body;
            try { body = JSON.parse(text); } catch { throw new Error(`Stalwart returned non-JSON (${response.status}): ${text.slice(0, 200)}`); }
            if (!response.ok) {
              const err = new Error(`Stalwart rejected the CORS update (${response.status}): ${text.slice(0, 500)}`);
              if (response.status === 401 || response.status === 403) err.authFailed = true;
              throw err;
            }
            for (const method of body.methodResponses ?? []) {
              if (method[0] === "error") {
                const err = new Error(`Stalwart CORS update failed: ${JSON.stringify(method[1])}`);
                if (/forbidden|unauthorized|authentication/i.test(String(method[1]?.type ?? ""))) err.authFailed = true;
                throw err;
              }
            }
            const http = (body.methodResponses ?? []).find((method) => method[2] === "cors")?.[1];
            const reload = (body.methodResponses ?? []).find((method) => method[2] === "reload")?.[1];
            if (!http?.updated || !("singleton" in http.updated) || Object.keys(http.notUpdated ?? {}).length) {
              throw new Error(`HTTP settings were not updated: ${JSON.stringify(http)}`);
            }
            if (!reload?.created?.reload || Object.keys(reload.notCreated ?? {}).length) {
              throw new Error(`Stalwart settings were not reloaded: ${JSON.stringify(reload)}`);
            }
            let last = "no response";
            for (let attempt = 0; attempt < 30; attempt++) {
              try {
                const check = await fetch("http://127.0.0.1:8080/jmap/", {
                  method: "OPTIONS",
                  headers: {
                    Origin: origin,
                    "Access-Control-Request-Method": "POST",
                    "Access-Control-Request-Headers": "authorization,content-type",
                  },
                  signal: AbortSignal.timeout(2000),
                });
                const mismatch = Object.entries(headers).find(([name, value]) => check.headers.get(name) !== value);
                if (check.ok && !mismatch) return;
                last = mismatch ? `${mismatch[0]} was ${check.headers.get(mismatch[0])}` : `HTTP ${check.status}`;
              } catch (error) { last = error.message; }
              await delay(500);
            }
            throw new Error(`CORS verification failed: ${last}`);
          })().catch((error) => {
            console.error(error.message);
            process.exit(error.authFailed ? 2 : 1);
          });
        ' || return $?
}

configure_optional_smtp_relay() {
    local _username="$1" _admin_secret="$2" _mail_domain="$3"
    local _provider="" _host _port _smtp_user _smtp_secret _status _errfile
    local _user_label _secret_label
    RETVAL=""
    say ""
    say "Outbound SMTP relay"
    say "-------------------"
    say "Google Cloud blocks outbound TCP port 25, so this server cannot deliver"
    say "mail directly to other MX hosts. An authenticated SMTP relay on port 587"
    say "or 465 avoids that block. BearMail uses SMTP, not the vendor HTTP Send API."
    say "Brevo is the default. Mailjet remains available. Have the SMTP login and"
    say "SMTP key ready (not the website password)."
    say ""
    prompt_menu "Outbound SMTP relay" 1 \
        "Brevo (recommended)" \
        "Mailjet" \
        "Skip (direct MX; needs outbound TCP 25)"
    case "$RETVAL" in
        1) _provider="brevo" ;;
        2) _provider="mailjet" ;;
        *) RETVAL=""; return 0 ;;
    esac
    say ""
    if [ "$_provider" = "brevo" ]; then
        say "In the Brevo app, complete these steps, then return here with the SMTP"
        say "login and SMTP key (not the Brevo website password, and not the REST API"
        say "key):"
        say "  1. Create an account at https://app.brevo.com/"
        say "  2. Settings → Senders, domains & dedicated IPs → add domain ${_mail_domain}"
        say "  3. Publish Brevo's domain-ownership TXT (Brevo code) and DKIM as shown"
        say "  4. Settings → SMTP & API → SMTP tab"
        say "     https://app.brevo.com/settings/keys/smtp"
        say "  Host is smtp-relay.brevo.com. Username is the SMTP login"
        say "  (often xxx@smtp-brevo.com). Password is the SMTP key."
        say "  Merge include:spf.brevo.com into the existing SPF record; keep the"
        say "  mail engine's DKIM selector and add Brevo's separately."
        say "  See https://developers.brevo.com/docs/smtp-integration and"
        say "  docs/BREVO_SMTP_RELAY.md for the full walkthrough."
        say ""
        prompt_dns_name "Brevo SMTP host" "smtp-relay.brevo.com"
        _host="$RETVAL"
        prompt_relay_port "Brevo SMTP port" "587"
        _port="$RETVAL"
        _user_label="Brevo SMTP login (username)"
        _secret_label="Brevo SMTP key (password)"
    else
        say "In the Mailjet app, complete these steps, then return here with the SMTP"
        say "API key and secret key (not the Mailjet website login):"
        say "  1. Create an account at https://app.mailjet.com/"
        say "  2. Account settings → Senders & Domains → add domain ${_mail_domain}"
        say "  3. Publish Mailjet's domain-ownership TXT, then SPF/DKIM as shown there"
        say "  4. Account settings → SMTP and SEND API settings"
        say "     https://app.mailjet.com/account/relay"
        say "  Host is in-v3.mailjet.com. Username is the API key. Password is the"
        say "  secret key (shown once). Merge include:spf.mailjet.com into the existing"
        say "  SPF record; keep Stalwart's DKIM selector and add Mailjet's separately."
        say "  See docs/MAILJET_SMTP_RELAY.md for the full walkthrough."
        say ""
        prompt_dns_name "Mailjet SMTP host" "in-v3.mailjet.com"
        _host="$RETVAL"
        prompt_relay_port "Mailjet SMTP port" "587"
        _port="$RETVAL"
        _user_label="Mailjet API key (SMTP username)"
        _secret_label="Mailjet secret key (SMTP password)"
    fi
    prompt_text "$_user_label" ""
    _smtp_user="$RETVAL"
    prompt_secret "$_secret_label"
    _smtp_secret="$RETVAL"
    say "🔐 Configuring Stalwart to relay outbound mail through ${_provider}..."
    _errfile="$(mktemp)"
    while true; do
        _status=0
        configure_stalwart_smtp_relay \
            "$_username" "$_admin_secret" "$_smtp_user" "$_smtp_secret" \
            "$_host" "$_port" "$_provider" \
            2>"$_errfile" || _status=$?
        if [ -s "$_errfile" ]; then
            sed 's/^/  /' "$_errfile" >&3
        fi
        if [ "$_status" -eq 0 ]; then
            rm -f "$_errfile"
            RETVAL="$_provider"
            return 0
        fi
        if [ "$_status" -eq 2 ]; then
            printf '  Stalwart rejected those administrator credentials. Enter them again.\n' >&3
            prompt_admin_credentials "$_username"
            _username="$ADMIN_USERNAME_RETVAL"
            _admin_secret="$ADMIN_SECRET_RETVAL"
            continue
        fi
        printf '  Stalwart could not apply the %s SMTP relay. Enter the SMTP login and key again.\n' "$_provider" >&3
        prompt_text "$_user_label" ""
        _smtp_user="$RETVAL"
        prompt_secret "$_secret_label"
        _smtp_secret="$RETVAL"
    done
}

configure_stalwart_mailjet_relay() {
    configure_stalwart_smtp_relay "$1" "$2" "$3" "$4" "$5" "$6" "mailjet"
}

configure_stalwart_smtp_relay() {
    local _username="$1" _admin_secret="$2" _smtp_user="$3" _smtp_secret="$4"
    local _host="$5" _port="$6" _route_name="$7" _implicit_tls="false"
    case "$_port" in
        465) _implicit_tls="true" ;;
    esac
    printf '%s\n%s' "$_admin_secret" "$_smtp_secret" | \
        STALWART_ADMIN_USERNAME="$_username" \
        RELAY_USERNAME="$_smtp_user" \
        RELAY_HOST="$_host" \
        RELAY_PORT="$_port" \
        RELAY_IMPLICIT_TLS="$_implicit_tls" \
        RELAY_NAME="$_route_name" \
        "$NODE_BIN" -e '
          const fs = require("node:fs");
          const raw = fs.readFileSync(0, "utf8");
          const nl = raw.indexOf("\n");
          const adminPassword = nl === -1 ? raw : raw.slice(0, nl);
          const relaySecret = nl === -1 ? "" : raw.slice(nl + 1).replace(/^\n/, "").replace(/\n$/, "");
          const username = process.env.STALWART_ADMIN_USERNAME;
          const smtpUser = process.env.RELAY_USERNAME;
          const host = process.env.RELAY_HOST;
          const port = Number(process.env.RELAY_PORT);
          const implicitTls = process.env.RELAY_IMPLICIT_TLS === "true";
          const routeName = process.env.RELAY_NAME;
          const authorization = `Basic ${Buffer.from(`${username}:${adminPassword}`).toString("base64")}`;
          const using = ["urn:ietf:params:jmap:core", "urn:stalwart:jmap"];

          async function jmap(methodCalls) {
            const response = await fetch("http://127.0.0.1:8080/jmap/", {
              method: "POST",
              headers: { Authorization: authorization, "Content-Type": "application/json" },
              body: JSON.stringify({ using, methodCalls }),
              signal: AbortSignal.timeout(15000),
            });
            const text = await response.text();
            let body;
            try { body = JSON.parse(text); } catch {
              throw new Error(`Stalwart returned non-JSON (${response.status}): ${text.slice(0, 200)}`);
            }
            if (!response.ok) {
              const err = new Error(`JMAP HTTP ${response.status}: ${text.slice(0, 500)}`);
              if (response.status === 401 || response.status === 403) err.authFailed = true;
              throw err;
            }
            for (const method of body.methodResponses ?? []) {
              if (method[0] === "error") {
                const err = new Error(`JMAP error: ${JSON.stringify(method[1])}`);
                if (/forbidden|unauthorized|authentication/i.test(String(method[1]?.type ?? ""))) err.authFailed = true;
                throw err;
              }
            }
            return Object.fromEntries((body.methodResponses ?? []).map((m) => [m[2], m[1]]));
          }

          function assertSet(result, kind) {
            const failed = Object.keys(result?.notCreated ?? {}).length
              || Object.keys(result?.notUpdated ?? {}).length
              || Object.keys(result?.notDestroyed ?? {}).length;
            if (failed) throw new Error(`${kind} failed: ${JSON.stringify(result)}`);
          }

          const relayFields = {
            address: host,
            port,
            protocol: "smtp",
            authUsername: smtpUser,
            authSecret: { "@type": "Value", secret: relaySecret },
            implicitTls,
            allowInvalidCerts: false,
            description: routeName === "brevo" ? "Brevo SMTP relay" : "Mailjet SMTP relay",
          };

          async function listRoutes() {
            const listed = await jmap([
              ["x:MtaRoute/get", { properties: ["id", "name", "@type"] }, "routes"],
            ]);
            const rows = listed.routes?.list;
            return Array.isArray(rows) ? rows : [];
          }

          (async () => {
            let existing = (await listRoutes()).find((row) => row.name === routeName);
            if (existing?.id) {
              const updated = await jmap([
                ["x:MtaRoute/set", { update: { [existing.id]: relayFields } }, "route"],
              ]);
              assertSet(updated.route, "MtaRoute");
            } else {
              const created = await jmap([
                ["x:MtaRoute/set", { create: { [routeName]: { "@type": "Relay", name: routeName, ...relayFields } } }, "route"],
              ]);
              const conflict = created.route?.notCreated?.[routeName];
              if (conflict) {
                existing = (await listRoutes()).find((row) => row.name === routeName);
                if (!existing?.id) throw new Error(`MtaRoute failed: ${JSON.stringify(created.route)}`);
                const updated = await jmap([
                  ["x:MtaRoute/set", { update: { [existing.id]: relayFields } }, "route"],
                ]);
                assertSet(updated.route, "MtaRoute");
              } else {
                assertSet(created.route, "MtaRoute");
              }
            }

            const strategy = await jmap([
              ["x:MtaOutboundStrategy/set", { update: { singleton: {
                "route/else": String.fromCharCode(39) + routeName + String.fromCharCode(39),
                "route/match/0/if": "is_local_domain(rcpt_domain)",
                "route/match/0/then": String.fromCharCode(39) + "local" + String.fromCharCode(39),
              } } }, "strategy"],
            ]);
            assertSet(strategy.strategy, "MtaOutboundStrategy");

            const reload = await jmap([
              ["x:Action/set", { create: { reload: { "@type": "ReloadSettings" } } }, "reload"],
            ]);
            if (!reload.reload?.created?.reload) {
              throw new Error(`ReloadSettings failed: ${JSON.stringify(reload.reload)}`);
            }
          })().catch((error) => {
            console.error(error.message);
            process.exit(error.authFailed ? 2 : 1);
          });
        ' || return $?
}

publish_optional_namecom_dns() {
    local _state="$1" _webui_hostname="$2" _mail_domain="$3" _smtp_relay="$4"
    local _zone _username _token
    RETVAL="false"
    say ""
    say "Authoritative DNS"
    say "-----------------"
    say "BearMail and public HTTPS certificates need the printed A/AAAA (and mail)"
    say "records to resolve to this server. Prepare a name.com API username and"
    say "production token if the rows are not already in the zone. If they are"
    say "already published, skip the name.com API."
    say ""
    if prompt_yes_no "Have you already published the printed forward-DNS records" "no"; then
        return 0
    fi
    say ""
    say "Create a production API token at name.com: Account Settings → API Tokens."
    say "Use the account username and token. Two-step verification must allow API"
    say "access. The domain's nameservers must be name.com's. If old records"
    say "conflict with the Stalwart table, they are listed and replaced only after"
    say "confirmation. The installer never stores the token in installer-state.json."
    say ""
    prompt_dns_name "name.com domain (DNS zone)" "$_mail_domain"
    _zone="$RETVAL"
    prompt_text "name.com API username" ""
    _username="$RETVAL"
    prompt_secret "name.com API token"
    _token="$RETVAL"
    say "🌐 Publishing forward-DNS records through the name.com API..."
    while true; do
        if printf '%s' "$_token" | \
            publish_dns_via_namecom "$_state" "$_webui_hostname" "$_zone" "$_smtp_relay" "$_username"
        then
            if [ "$RETVAL" = "true" ]; then
                return 0
            fi
            say "Name.com publishing was skipped. Add or replace the printed DNS rows by hand."
            RETVAL="false"
            return 0
        fi
        printf '  name.com rejected that request. Enter the username and token again, or\n' >&3
        printf '  confirm the domain is in this name.com account.\n' >&3
        prompt_dns_name "name.com domain (DNS zone)" "$_zone"
        _zone="$RETVAL"
        prompt_text "name.com API username" "$_username"
        _username="$RETVAL"
        prompt_secret "name.com API token"
        _token="$RETVAL"
    done
}

combined_forward_dns_records_js() {
    cat <<'EOF'
      const fs = require("node:fs");
      const state = JSON.parse(fs.readFileSync(process.env.INSTALLER_STATE_PATH, "utf8"));
      const records = (state.dnsRecords ?? []).filter((record) =>
        String(record.recordType).toUpperCase() !== "PTR");
      const webHost = process.env.WEBUI_HOSTNAME;
      records.push({ recordType: "A", host: webHost, answer: state.publicIpv4 || "<PUBLIC_IPV4_NOT_DETECTED>", ttl: 3600, priority: null });
      if (state.publicIpv6) records.push({ recordType: "AAAA", host: webHost, answer: state.publicIpv6, ttl: 3600, priority: null });
      const unique = records.filter((record, index, all) => index === all.findIndex((other) =>
        other.recordType === record.recordType && other.host === record.host && other.answer === record.answer));
EOF
}

build_namecom_dns_plan() {
    local _state="$1" _webui_hostname="$2" _zone="$3" _smtp_relay="$4"
    INSTALLER_STATE_PATH="$_state" WEBUI_HOSTNAME="$_webui_hostname" \
        NAMECOM_ZONE="$_zone" RELAY_PROVIDER="$_smtp_relay" \
        "$NODE_BIN" -e "
$(combined_forward_dns_records_js)
          const zone = process.env.NAMECOM_ZONE.replace(/\\.\$/, '').toLowerCase();
          const spfIncludes = { brevo: 'include:spf.brevo.com', mailjet: 'include:spf.mailjet.com' };
          const spfInclude = spfIncludes[process.env.RELAY_PROVIDER] || '';
          const supported = new Set(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV']);
          const relativeHost = (fqdn) => {
            const name = String(fqdn || '').replace(/\\.\$/, '').toLowerCase();
            if (!name || name === '<public_ipv4_not_detected>') return null;
            if (name === zone) return '';
            if (name.endsWith('.' + zone)) return name.slice(0, -(zone.length + 1));
            return null;
          };
          const mergeRelaySpf = (answer) => {
            if (!spfInclude || !/^v=spf1(?:\\s|\$)/i.test(answer)) return answer;
            if (answer.toLowerCase().includes(spfInclude.toLowerCase())) return answer;
            if (/\\s(?:-|~|\\?|\\+)?all\\s*\$/i.test(answer)) {
              return answer.replace(/\\s((?:-|~|\\?|\\+)?all)\\s*\$/i, ' ' + spfInclude + ' \$1');
            }
            return \`\${answer} \${spfInclude}\`;
          };
          const plan = [];
          const skipped = [];
          for (const record of unique) {
            const type = String(record.recordType).toUpperCase();
            const host = relativeHost(record.host);
            const answer = String(record.answer ?? '').replace(/\\.\$/, '');
            if (host === null) {
              skipped.push(\`\${type} \${record.host} is outside zone \${zone}\`);
              continue;
            }
            if (!supported.has(type)) {
              skipped.push(\`\${type} \${record.host} is not published by the name.com v4 API\`);
              continue;
            }
            if (!answer || answer === '<PUBLIC_IPV4_NOT_DETECTED>') {
              skipped.push(\`\${type} \${record.host} has no publishable answer\`);
              continue;
            }
            plan.push({
              host,
              type,
              answer: type === 'TXT' ? mergeRelaySpf(answer) : answer,
              ttl: Math.max(300, Number(record.ttl) || 3600),
              priority: record.priority == null ? undefined : Number(record.priority),
            });
          }
          process.stdout.write(JSON.stringify({ zone, plan, skipped }));
        "
}

namecom_reconcile_js() {
    cat <<'EOF'
      const fs = require("node:fs");
      const normHost = (value) => String(value ?? "").replace(/\.$/, "").replace(/^@$/, "").toLowerCase();
      const normAnswer = (value) => String(value ?? "").replace(/\.$/, "").replace(/\s+/g, " ").trim();
      const recType = (row) => String(row.type || row.recordType || "").toUpperCase();
      const txtClass = (answer) => {
        const text = String(answer || "").trim();
        if (/^v=spf1(?:\s|$)/i.test(text)) return "spf";
        if (/^v=dmarc1(?:\s|;|$)/i.test(text)) return "dmarc";
        if (/^v=stsv1(?:\s|;|$)/i.test(text)) return "sts";
        if (/^v=tlsrptv1(?:\s|;|$)/i.test(text)) return "tlsrpt";
        if (/^v=dkim1(?:\s|;|$)/i.test(text)) return "dkim";
        return "other";
      };
      const describe = (row) => {
        const host = normHost(row.host) || "@";
        const priority = row.priority == null || row.priority === "" ? "" : ` prio=${row.priority}`;
        return `${recType(row)} ${host} -> ${row.answer}${priority}`;
      };
      const exclusiveKey = (row) => {
        const type = recType(row);
        const host = normHost(row.host);
        if (["A", "AAAA", "CNAME", "ANAME", "MX", "SRV"].includes(type)) return `${type}|${host}`;
        if (type === "TXT") {
          const cls = txtClass(row.answer);
          if (cls !== "other") return `TXT|${host}|${cls}`;
        }
        return null;
      };
      const answersEqual = (left, right) => {
        if (normAnswer(left.answer) !== normAnswer(right.answer)) return false;
        if (right.priority == null || right.priority === "") return true;
        return Number(left.priority) === Number(right.priority);
      };
      const payloadOf = (row) => {
        const payload = { host: row.host, type: recType(row), answer: row.answer, ttl: row.ttl };
        if (row.priority != null && row.priority !== "") payload.priority = Number(row.priority);
        return payload;
      };

      function reconcileNamecomActions(existing, wanted) {
        const destroyIds = new Set();
        const conflicts = [];
        const create = [];
        const update = [];
        const unchanged = [];
        const live = (existing || []).filter((row) => recType(row) !== "NS");

        const markDestroy = (row, reason, wantedRow) => {
          if (row.id == null || destroyIds.has(row.id) || recType(row) === "NS") return;
          destroyIds.add(row.id);
          conflicts.push({
            action: "delete",
            reason,
            existing: describe(row),
            wanted: wantedRow ? describe(wantedRow) : "",
          });
        };

        for (const wantedRow of wanted) {
          const host = normHost(wantedRow.host);
          if (wantedRow.type === "CNAME") {
            for (const row of live) {
              if (normHost(row.host) !== host || recType(row) === "CNAME" || recType(row) === "NS") continue;
              markDestroy(row, "CNAME cannot coexist with other records at this host", wantedRow);
            }
          } else {
            for (const row of live) {
              if (normHost(row.host) !== host) continue;
              if (recType(row) === "CNAME" || recType(row) === "ANAME") {
                markDestroy(row, `${wantedRow.type} conflicts with existing ${recType(row)}`, wantedRow);
              }
            }
          }
        }

        const wantedGroups = new Map();
        for (const wantedRow of wanted) {
          const key = exclusiveKey(wantedRow)
            || `TXT|${normHost(wantedRow.host)}|other|${normAnswer(wantedRow.answer)}`;
          if (!wantedGroups.has(key)) wantedGroups.set(key, []);
          wantedGroups.get(key).push(wantedRow);
        }
        const existingByKey = new Map();
        for (const row of live) {
          if (destroyIds.has(row.id)) continue;
          const key = exclusiveKey(row);
          if (!key) continue;
          if (!existingByKey.has(key)) existingByKey.set(key, []);
          existingByKey.get(key).push(row);
        }

        for (const [key, wantedRows] of wantedGroups) {
          const otherTxt = key.startsWith("TXT|") && key.split("|")[2] === "other";
          if (otherTxt) {
            const wantedRow = wantedRows[0];
            const match = live.find((row) => recType(row) === "TXT"
              && !destroyIds.has(row.id)
              && normHost(row.host) === normHost(wantedRow.host)
              && normAnswer(row.answer) === normAnswer(wantedRow.answer));
            if (!match) create.push(payloadOf(wantedRow));
            else if (Number(match.ttl) !== Number(wantedRow.ttl)) {
              update.push({ id: match.id, record: payloadOf(wantedRow), existing: describe(match) });
            } else unchanged.push(describe(wantedRow));
            continue;
          }

          const remaining = (existingByKey.get(key) || []).filter((row) => !destroyIds.has(row.id));
          for (const wantedRow of wantedRows) {
            const matchIndex = remaining.findIndex((row) => answersEqual(row, wantedRow));
            if (matchIndex >= 0) {
              const match = remaining.splice(matchIndex, 1)[0];
              if (Number(match.ttl) !== Number(wantedRow.ttl)) {
                update.push({ id: match.id, record: payloadOf(wantedRow), existing: describe(match) });
              } else unchanged.push(describe(wantedRow));
            } else if (remaining.length) {
              const match = remaining.shift();
              conflicts.push({
                action: "replace",
                reason: "existing record differs from the Stalwart DNS table",
                existing: describe(match),
                wanted: describe(wantedRow),
              });
              update.push({ id: match.id, record: payloadOf(wantedRow), existing: describe(match) });
            } else {
              create.push(payloadOf(wantedRow));
            }
          }
          for (const extra of remaining) {
            markDestroy(extra, "extra record at this host is not in the Stalwart DNS table", wantedRows[0]);
          }
        }

        return {
          conflicts,
          create,
          update,
          unchanged,
          destroy: live.filter((row) => destroyIds.has(row.id)).map((row) => ({
            id: row.id,
            existing: describe(row),
          })),
        };
      }
EOF
}

reconcile_namecom_actions() {
    local _existing="$1" _plan="$2"
    NAMECOM_EXISTING_PATH="$_existing" NAMECOM_PLAN_PATH="$_plan" "$NODE_BIN" -e "
$(namecom_reconcile_js)
      const existing = JSON.parse(fs.readFileSync(process.env.NAMECOM_EXISTING_PATH, 'utf8'));
      const parsed = JSON.parse(fs.readFileSync(process.env.NAMECOM_PLAN_PATH, 'utf8'));
      const actions = reconcileNamecomActions(existing, parsed.plan || []);
      actions.zone = parsed.zone;
      actions.skipped = parsed.skipped || [];
      process.stdout.write(JSON.stringify(actions));
    "
}

print_namecom_conflicts() {
    local _actions="$1"
    NAMECOM_ACTIONS_PATH="$_actions" "$NODE_BIN" -e '
      const fs = require("node:fs");
      const actions = JSON.parse(fs.readFileSync(process.env.NAMECOM_ACTIONS_PATH, "utf8"));
      if (!(actions.conflicts || []).length) process.exit(0);
      console.log("Existing name.com records conflict with the Stalwart DNS table:");
      for (const conflict of actions.conflicts) {
        if (conflict.action === "replace") {
          console.log(`  replace: ${conflict.existing}`);
          console.log(`      with: ${conflict.wanted}`);
        } else {
          console.log(`  delete:  ${conflict.existing}`);
          if (conflict.reason) console.log(`      (${conflict.reason})`);
        }
      }
    '
}

namecom_request_js() {
    cat <<'EOF'
      const fs = require("node:fs");
      async function namecomRequest(method, url, body) {
        const response = await fetch(url, {
          method,
          headers: {
            Authorization: process.env.NAMECOM_AUTH,
            "Content-Type": "application/json",
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(20000),
        });
        const text = await response.text();
        let json = {};
        try { json = text ? JSON.parse(text) : {}; } catch { json = { message: text.slice(0, 200) }; }
        if (!response.ok) {
          const detail = json.details || json.message || text.slice(0, 300);
          throw new Error(`name.com ${method} ${url} failed (${response.status}): ${detail}`);
        }
        return json;
      }
EOF
}

publish_dns_via_namecom() {
    local _state="$1" _webui_hostname="$2" _zone="$3" _smtp_relay="$4" _username="$5"
    local _plan _token _plan_file _existing_file _actions_file _auth
    RETVAL="false"
    _token="$(cat)"
    if ! _plan="$(build_namecom_dns_plan "$_state" "$_webui_hostname" "$_zone" "$_smtp_relay")"; then
        return 1
    fi
    _plan_file="$(mktemp)"
    _existing_file="$(mktemp)"
    _actions_file="$(mktemp)"
    printf '%s' "$_plan" > "$_plan_file"
    chmod 0600 "$_plan_file" "$_existing_file" "$_actions_file"
    _auth="$(printf '%s:%s' "$_username" "$_token" | "$NODE_BIN" -e 'process.stdout.write("Basic " + Buffer.from(require("fs").readFileSync(0)).toString("base64"));')"
    if ! NAMECOM_AUTH="$_auth" NAMECOM_ZONE="$_zone" NAMECOM_EXISTING_PATH="$_existing_file" \
        "$NODE_BIN" -e "
$(namecom_request_js)
          const zone = process.env.NAMECOM_ZONE;
          const base = 'https://api.name.com/v4/domains/' + encodeURIComponent(zone);
          (async () => {
            await namecomRequest('GET', base);
            const existing = [];
            let page = 1;
            while (true) {
              const listed = await namecomRequest('GET', \`\${base}/records?perPage=1000&page=\${page}\`);
              existing.push(...(listed.records || []));
              if (!listed.nextPage) break;
              page = listed.nextPage;
            }
            fs.writeFileSync(process.env.NAMECOM_EXISTING_PATH, JSON.stringify(existing));
          })().catch((error) => { console.error(error.message); process.exit(1); });
        "
    then
        rm -f "$_plan_file" "$_existing_file" "$_actions_file"
        return 1
    fi
    if ! reconcile_namecom_actions "$_existing_file" "$_plan_file" > "$_actions_file"; then
        rm -f "$_plan_file" "$_existing_file" "$_actions_file"
        return 1
    fi
    NAMECOM_ACTIONS_PATH="$_actions_file" "$NODE_BIN" -e '
      const fs = require("node:fs");
      const actions = JSON.parse(fs.readFileSync(process.env.NAMECOM_ACTIONS_PATH, "utf8"));
      for (const warning of actions.skipped || []) console.log(`  skipped: ${warning}`);
      if (!(actions.create || []).length && !(actions.update || []).length && !(actions.destroy || []).length) {
        console.log("  name.com DNS: all published records already match.");
      }
    '
    if NAMECOM_ACTIONS_PATH="$_actions_file" "$NODE_BIN" -e '
      const fs = require("node:fs");
      const actions = JSON.parse(fs.readFileSync(process.env.NAMECOM_ACTIONS_PATH, "utf8"));
      process.exit((actions.conflicts || []).length ? 0 : 1);
    '
    then
        print_namecom_conflicts "$_actions_file"
        if ! prompt_yes_no "Replace the conflicting name.com records with the Stalwart DNS table" "yes"; then
            rm -f "$_plan_file" "$_existing_file" "$_actions_file"
            RETVAL="false"
            return 0
        fi
    fi
    if ! NAMECOM_AUTH="$_auth" NAMECOM_ZONE="$_zone" NAMECOM_ACTIONS_PATH="$_actions_file" \
        "$NODE_BIN" -e "
$(namecom_request_js)
          const actions = JSON.parse(fs.readFileSync(process.env.NAMECOM_ACTIONS_PATH, 'utf8'));
          const zone = process.env.NAMECOM_ZONE;
          const base = 'https://api.name.com/v4/domains/' + encodeURIComponent(zone);
          (async () => {
            let created = 0;
            let updated = 0;
            let destroyed = 0;
            for (const row of actions.destroy || []) {
              await namecomRequest('DELETE', \`\${base}/records/\${row.id}\`);
              destroyed += 1;
            }
            for (const row of actions.update || []) {
              await namecomRequest('PUT', \`\${base}/records/\${row.id}\`, row.record);
              updated += 1;
            }
            for (const row of actions.create || []) {
              await namecomRequest('POST', \`\${base}/records\`, row);
              created += 1;
            }
            console.log(\`  name.com DNS: \${created} created, \${updated} updated, \${destroyed} replaced/removed, \${(actions.unchanged || []).length} unchanged.\`);
          })().catch((error) => { console.error(error.message); process.exit(1); });
        "
    then
        rm -f "$_plan_file" "$_existing_file" "$_actions_file"
        return 1
    fi
    rm -f "$_plan_file" "$_existing_file" "$_actions_file"
    RETVAL="true"
    return 0
}

write_installer_state() {
    local _setup_result="$1" _state="$2" _hostname="$3" _domain="$4"
    local _ipv4="$5" _ipv6="$6" _origin="$7" _webui_hostname="$8"
    local _proxy_mode="$9"
    SETUP_RESULT_PATH="$_setup_result" INSTALLER_STATE_PATH="$_state" \
        MAIL_HOSTNAME="$_hostname" MAIL_DOMAIN="$_domain" PUBLIC_IPV4="$_ipv4" \
        PUBLIC_IPV6="$_ipv6" WEBUI_ORIGIN="$_origin" WEBUI_HOSTNAME="$_webui_hostname" \
        PROXY_MODE="$_proxy_mode" \
        "$NODE_BIN" -e '
          const fs = require("node:fs");
          const setupPath = process.env.SETUP_RESULT_PATH;
          const statePath = process.env.INSTALLER_STATE_PATH;
          let state = {};
          const isFresh = fs.existsSync(setupPath);
          const source = isFresh ? setupPath : (fs.existsSync(statePath) ? statePath : null);
          if (source) state = JSON.parse(fs.readFileSync(source, "utf8"));
          delete state.administrator;
          state.version = 1;
          state.serverHostname = process.env.MAIL_HOSTNAME;
          state.defaultDomain = process.env.MAIL_DOMAIN;
          state.publicIpv4 = isFresh
            ? (state.publicIpv4 || process.env.PUBLIC_IPV4 || null)
            : (process.env.PUBLIC_IPV4 || state.publicIpv4 || null);
          state.publicIpv6 = isFresh
            ? (state.publicIpv6 || process.env.PUBLIC_IPV6 || null)
            : (process.env.PUBLIC_IPV6 || state.publicIpv6 || null);
          state.dnsRecords ||= [];
          state.webuiOrigin = process.env.WEBUI_ORIGIN;
          state.webuiHostname = process.env.WEBUI_HOSTNAME;
          state.proxyMode = process.env.PROXY_MODE;
          const webHost = process.env.WEBUI_HOSTNAME;
          const ipv4 = state.publicIpv4;
          const ipv6 = state.publicIpv6;
          const hasRecord = (type, host, answer) => state.dnsRecords.some((record) =>
            String(record.recordType).toUpperCase() === type &&
            record.host === host &&
            record.answer === answer);
          if (webHost && ipv4 && ipv4 !== "<PUBLIC_IPV4_NOT_DETECTED>" && !hasRecord("A", webHost, ipv4)) {
            state.dnsRecords.push({ recordType: "A", host: webHost, answer: ipv4, ttl: 3600, priority: null });
          }
          if (webHost && ipv6 && !hasRecord("AAAA", webHost, ipv6)) {
            state.dnsRecords.push({ recordType: "AAAA", host: webHost, answer: ipv6, ttl: 3600, priority: null });
          }
          fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
        '
}

print_combined_dns_table() {
    local _state="$1" _webui_hostname="$2"
    INSTALLER_STATE_PATH="$_state" WEBUI_HOSTNAME="$_webui_hostname" "$NODE_BIN" -e '
      const fs = require("node:fs");
      const state = JSON.parse(fs.readFileSync(process.env.INSTALLER_STATE_PATH, "utf8"));
      const records = (state.dnsRecords ?? []).filter((record) =>
        String(record.recordType).toUpperCase() !== "PTR");
      const webHost = process.env.WEBUI_HOSTNAME;
      records.push({ recordType: "A", host: webHost, answer: state.publicIpv4 || "<PUBLIC_IPV4_NOT_DETECTED>", ttl: 3600, priority: null });
      if (state.publicIpv6) records.push({ recordType: "AAAA", host: webHost, answer: state.publicIpv6, ttl: 3600, priority: null });
      const unique = records.filter((record, index, all) => index === all.findIndex((other) =>
        other.recordType === record.recordType && other.host === record.host && other.answer === record.answer));
      const width = (values, minimum, maximum) => Math.min(maximum, Math.max(minimum, ...values.map((value) => String(value ?? "").length)));
      const widths = {
        type: width(unique.map((r) => r.recordType), 4, 8),
        host: width(unique.map((r) => r.host), 4, 38),
        answer: width(unique.map((r) => r.answer), 6, 56),
        ttl: width(unique.map((r) => r.ttl), 3, 10),
        prio: width(unique.map((r) => r.priority ?? "-"), 4, 8),
      };
      const pad = (value, size, right = false) => right ? String(value).padStart(size) : String(value).padEnd(size);
      const row = (type, host, answer, ttl, prio) =>
        `${pad(type, widths.type)} | ${pad(host, widths.host)} | ${pad(answer, widths.answer)} | ${pad(ttl, widths.ttl, true)} | ${pad(prio, widths.prio, true)}`;
      console.log(row("TYPE", "HOST", "ANSWER", "TTL", "PRIO"));
      console.log(`${"-".repeat(widths.type)}-+-${"-".repeat(widths.host)}-+-${"-".repeat(widths.answer)}-+-${"-".repeat(widths.ttl)}-+-${"-".repeat(widths.prio)}`);
      const chunks = (value, size) => String(value).match(new RegExp(`.{1,${size}}`, "g")) || [""];
      for (const record of unique) {
        const hosts = chunks(record.host, widths.host);
        const answers = chunks(record.answer, widths.answer);
        for (let line = 0; line < Math.max(hosts.length, answers.length); line++) {
          console.log(row(
            line ? "" : record.recordType,
            hosts[line] ?? "",
            answers[line] ?? "",
            line ? "" : record.ttl,
            line ? "" : (record.priority ?? "-"),
          ));
        }
      }
      console.log("\nTTL values are seconds. PRIO is used by MX and SRV records.");

      console.log("\nForward DNS guidance");
      console.log("  Manual DNS: add every row above in the authoritative zone for your domain.");
      console.log("  Automatic DNS management: verify the Stalwart DNS task. Stalwart manages");
      console.log("  supported mail-domain records, but the mail and WebUI A/AAAA rows shown");
      console.log("  above must still resolve to this server.");

      console.log("\nReverse DNS guidance (not part of your domain DNS zone)");
      const reverseAddresses = [state.publicIpv4, state.publicIpv6].filter(Boolean);
      if (reverseAddresses.length) {
        console.log("  Recommended for reliable direct outbound-mail delivery:");
        for (const address of reverseAddresses) {
          console.log(`  ${address} -> ${state.serverHostname}`);
        }
        console.log("  If your server or VPS provider offers a reverse-DNS setting, configure");
        console.log("  the mapping there. Do not add a PTR row to your domain DNS zone.");
      } else {
        console.log("  No public address was detected, so no reverse-DNS mapping is shown.");
      }
      console.log("  Reverse DNS is not required to open the Stalwart admin or WebUI URLs.");
      if (!(state.dnsRecords ?? []).length) {
        console.log("Warning: Stalwart DNS rows were unavailable because this was an existing installation without installer state.");
      }
    '
}

cleanup() {
    if [ -n "${cleanup_tty_state:-}" ]; then
        stty "$cleanup_tty_state" <&3 2>/dev/null || true
        cleanup_tty_state=""
    fi
    if [ "${cleanup_restart_caddy:-}" = "true" ]; then
        systemctl start caddy.service >/dev/null 2>&1 || true
        cleanup_restart_caddy=""
    fi
    if [ -n "${cleanup_dir:-}" ] && [ -d "$cleanup_dir" ]; then
        case "$cleanup_dir" in
            /|/home|/root|/usr|/var|/opt) err "Refusing to clean unsafe temporary path: ${cleanup_dir}" ;;
            *) rm -rf -- "$cleanup_dir" ;;
        esac
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
    local _account="$1"
    if id -u "$_account" > /dev/null 2>&1; then
        return 0
    fi
    say "🖥️  Creating '${_account}' account..."
    ensure useradd "$_account" -s /usr/sbin/nologin -M -r -U
}

install_executable_atomically() {
    local _source="$1" _destination="$2" _staged="${2}.new.$$"
    if ! install -m 0755 "$_source" "$_staged"; then
        rm -f "$_staged"
        err "❌ Install failed: Could not stage the Stalwart binary at ${_staged}."
    fi
    if ! mv -f "$_staged" "$_destination"; then
        rm -f "$_staged"
        err "❌ Install failed: Could not atomically replace ${_destination}."
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

# Run a command that should never fail. If the command fails execution
# will immediately terminate with an error showing the failing
# command.
ensure() {
    if ! "$@"; then err "command failed: $*"; fi
}

main "$@"
