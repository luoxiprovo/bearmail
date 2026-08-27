#!/usr/bin/env sh
# shellcheck shell=dash

#
# Two modes:
#   default         Build customer artifacts from this checkout and run install.sh
#                   (setup, Caddy, CORS, DNS table, SMTP relay, name.com).
#   --webui-only    Iterate the WebUI from webui/; no tarball, no Stalwart rebuild,
#                   no installer wizard.
#
# Enterprise features stay off.
#

set -eu

COMMUNITY_FEATURES="sqlite postgres mysql rocks s3 redis azure nats"
LAB_UNIT="stalwart-source-test.service"
WEBUI_UNIT="stalwart-webui.service"
DEFAULT_WEBUI_PREFIX="/opt/stalwart-webui"
DEFAULT_WEBUI_PORT="8081"
DEFAULT_NODE_BIN="/usr/bin/node"
DEFAULT_SERVER_URL="http://127.0.0.1:8080"

profile="release"
skip_build="false"
rebuild="false"
dry_run="false"
webui_only="false"
reset_setup="false"
assume_yes="false"
cargo_jobs=""
WEBUI_PREFIX="$DEFAULT_WEBUI_PREFIX"
WEBUI_PORT="$DEFAULT_WEBUI_PORT"
NODE_BIN="$DEFAULT_NODE_BIN"
SERVER_URL="$DEFAULT_SERVER_URL"

print_usage() {
    cat <<'EOF'
Usage: sudo sh ./test_install.sh [OPTIONS]

Modes

  First-time / customer-like setup (default):
    Builds a community Stalwart binary (no enterprise features), packs webui/ into stalwart-webui.tar.gz
    because install.sh requires that archive, then runs install.sh. That is the
    only path that asks for Caddy, DNS, Brevo/Mailjet SMTP relay, and name.com.
    Quick setup asks for a public mail hostname (example: mail.example.com) and
    primary mail domain (example: example.com). Do not accept this VM's cloud
    hostname, such as a name ending in .internal.

  WebUI iterate:
    sudo sh ./test_install.sh --webui-only

    Uses the webui/ folder directly. Runs npm run build, then webui/install.sh.
    Does not pack a tarball, does not rebuild Stalwart, and does not open the
    setup wizard.

The tarball exists only as the customer-installer artifact. Day-to-day WebUI
changes should use --webui-only.

Options:
  --webui-only    Apply WebUI changes from webui/; skip Stalwart and install.sh.
  --release       Build the production Stalwart binary (default; full setup only).
  --dev           Build a debug Stalwart binary instead (full setup only).
  --rebuild       Compile Stalwart even if a binary already exists (full setup).
  --skip-build    Do not compile. Full setup reuses ./stalwart and the tarball.
                  --webui-only reuses webui/dist.
  --reset-setup   Move existing config, installer-state, and mail data aside so
                  install.sh asks for hostname and mail domain again.
  --yes           Do not ask for confirmation with --reset-setup.
  --dry-run       Print the plan without changing the system.
  -h, --help      Show this help.

Examples:
  sudo sh ./test_install.sh
  sudo sh ./test_install.sh --webui-only
  sudo sh ./test_install.sh --reset-setup --skip-build
EOF
}

say() {
    printf '%s\n' "$1"
}

err() {
    printf '%s\n' "$1" >&2
    exit 1
}

run_as_builder() {
    if [ "$(id -un)" = "$BUILDER" ]; then
        env HOME="$BUILDER_HOME" CARGO_HOME="$CARGO_HOME" PATH="$BUILDER_PATH" "$@"
        return
    fi
    if [ "$(id -u)" -ne 0 ]; then
        err "❌ Run as ${BUILDER} or root: sudo sh ./test_install.sh"
    fi
    sudo -H -u "$BUILDER" env \
        HOME="$BUILDER_HOME" \
        CARGO_HOME="$CARGO_HOME" \
        PATH="$BUILDER_PATH" \
        "$@"
}

json_string_field() {
    _file="$1"
    _key="$2"
    [ -f "$_file" ] || return 0
    if command -v python3 >/dev/null 2>&1; then
        python3 -c 'import json,sys
try:
    value=json.load(open(sys.argv[1])).get(sys.argv[2]) or ""
except Exception:
    value=""
print(value)' "$_file" "$_key"
        return 0
    fi
    if [ -x "$NODE_BIN" ]; then
        JSON_FILE="$_file" JSON_KEY="$_key" "$NODE_BIN" -e '
          const fs = require("node:fs");
          try {
            const value = JSON.parse(fs.readFileSync(process.env.JSON_FILE, "utf8"))[process.env.JSON_KEY];
            process.stdout.write(value == null ? "" : String(value));
          } catch {
            process.stdout.write("");
          }
        '
    fi
}

detect_live_webui() {
    if ! command -v systemctl >/dev/null 2>&1; then
        return 0
    fi
    if ! systemctl cat "$WEBUI_UNIT" >/dev/null 2>&1; then
        return 0
    fi
    _wd="$(systemctl show -p WorkingDirectory --value "$WEBUI_UNIT" 2>/dev/null || true)"
    case "$_wd" in /*) WEBUI_PREFIX="$_wd" ;; esac
    _env="$(systemctl show -p Environment --value "$WEBUI_UNIT" 2>/dev/null || true)"
    for _item in $_env; do
        case "$_item" in
            WEBUI_PORT=*)
                WEBUI_PORT="${_item#WEBUI_PORT=}"
                ;;
        esac
    done
    _exec="$(systemctl show -p ExecStart --value "$WEBUI_UNIT" 2>/dev/null || true)"
    _exec_node="${_exec#*path=}"
    _exec_node="${_exec_node%% ;*}"
    case "$_exec_node" in /*)
        if [ -x "$_exec_node" ]; then
            NODE_BIN="$_exec_node"
        fi
        ;;
    esac
    _existing="$(json_string_field "${WEBUI_PREFIX}/dist/config.json" defaultServerUrl)"
    if [ -n "$_existing" ]; then
        SERVER_URL="$_existing"
        return 0
    fi
    _host="$(json_string_field /etc/stalwart/installer-state.json serverHostname)"
    if [ -n "$_host" ]; then
        SERVER_URL="https://${_host}"
    fi
}

stop_lab_service() {
    if ! command -v systemctl >/dev/null 2>&1; then
        return 0
    fi
    if systemctl list-unit-files --type=service --no-legend 2>/dev/null | \
        grep -q "^${LAB_UNIT}"
    then
        say "🛑 Stopping ${LAB_UNIT} so install.sh can bind ports 8080 and 443..."
        systemctl stop "$LAB_UNIT" >/dev/null 2>&1 || true
        systemctl disable "$LAB_UNIT" >/dev/null 2>&1 || true
    fi
}

reset_existing_setup() {
    _config="/etc/stalwart/config.json"
    _state="/etc/stalwart/installer-state.json"
    _data="/var/lib/stalwart"
    if [ ! -e "$_config" ] && [ ! -e "$_state" ]; then
        say "ℹ️  No existing ${_config}; setup will run without a reset."
        return 0
    fi
    if [ "$assume_yes" != "true" ]; then
        printf 'Move existing Stalwart config and mail data aside so setup asks for hostname again? [y/N]: '
        if ! IFS= read -r _answer; then
            err "❌ Confirmation input ended."
        fi
        case "$_answer" in
            y|Y|yes|Yes|YES) ;;
            *) err "❌ Reset cancelled. Existing hostname/domain were kept." ;;
        esac
    fi
    _stamp="$(date -u +%Y%m%dT%H%M%SZ)"
    _backup="/var/backups/stalwart-setup-${_stamp}"
    say "🛑 Stopping stalwart.service so the previous data store can be moved..."
    systemctl stop stalwart.service >/dev/null 2>&1 || true
    mkdir -p "$_backup"
    if [ -e "$_config" ]; then
        mv "$_config" "${_backup}/config.json"
    fi
    if [ -e "$_state" ]; then
        mv "$_state" "${_backup}/installer-state.json"
    fi
    if [ -d "$_data" ]; then
        mv "$_data" "${_backup}/data"
        mkdir -p "$_data"
        if id stalwart >/dev/null 2>&1; then
            chown stalwart:stalwart "$_data"
            chmod 0750 "$_data"
        fi
    fi
    say "📦 Previous setup moved to ${_backup}"
    say "   Next, install.sh will ask for public mail hostname and mail domain."
}

pack_webui_archive() {
    _archive="$1"
    _webui="$2"
    [ -f "${_webui}/dist/index.html" ] || \
        err "❌ ${_webui}/dist/index.html is missing after the WebUI build."
    [ -f "${_webui}/install.sh" ] || err "❌ ${_webui}/install.sh is missing."
    tar -czf "$_archive" -C "$_webui" \
        install.sh server.mjs stalwart-webui.service dist
    tar -tzf "$_archive" | grep -qx 'dist/index.html' || \
        err "❌ ${_archive} does not contain dist/index.html."
    tar -tzf "$_archive" | grep -qx 'dist/config.json' || \
        err "❌ ${_archive} does not contain dist/config.json."
}

build_webui_dist() {
    if ! run_as_builder sh -c 'command -v npm >/dev/null'; then
        err "❌ npm was not found for ${BUILDER}."
    fi
    say "📦 Building WebUI from ${WEBUI_DIR}..."
    if [ ! -d "${WEBUI_DIR}/node_modules" ]; then
        run_as_builder sh -c "cd \"${WEBUI_DIR}\" && npm ci"
    fi
    run_as_builder sh -c "cd \"${WEBUI_DIR}\" && npm run build"
    [ -f "${WEBUI_DIR}/dist/index.html" ] || \
        err "❌ ${WEBUI_DIR}/dist/index.html is missing after the WebUI build."
}

install_webui_from_folder() {
    say "📦 Installing WebUI from ${WEBUI_DIR} -> ${WEBUI_PREFIX} (no tarball)..."
    sh "${WEBUI_DIR}/install.sh" \
        --server-url "$SERVER_URL" \
        --prefix "$WEBUI_PREFIX" \
        --port "$WEBUI_PORT" \
        --node-bin "$NODE_BIN" \
        --systemd \
        --no-build
}

while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help)
            print_usage
            exit 0
            ;;
        --webui-only)
            webui_only="true"
            shift
            ;;
        --release)
            profile="release"
            shift
            ;;
        --dev)
            profile="dev"
            shift
            ;;
        --rebuild)
            rebuild="true"
            shift
            ;;
        --skip-build)
            skip_build="true"
            shift
            ;;
        --reset-setup)
            reset_setup="true"
            shift
            ;;
        --yes)
            assume_yes="true"
            shift
            ;;
        --jobs)
            [ $# -ge 2 ] || err "❌ Missing value after --jobs."
            cargo_jobs="$2"
            shift 2
            ;;
        --dry-run)
            dry_run="true"
            shift
            ;;
        *)
            err "❌ Unknown argument: $1. Run ./test_install.sh --help"
            ;;
    esac
done

SCRIPT_DIR="$(CDPATH= cd "$(dirname "$0")" && pwd)"
INSTALL_SH="${SCRIPT_DIR}/install.sh"
ARTIFACT_BIN="${SCRIPT_DIR}/stalwart"
ARTIFACT_WEBUI="${SCRIPT_DIR}/stalwart-webui.tar.gz"
WEBUI_DIR="${SCRIPT_DIR}/webui"

[ -f "$INSTALL_SH" ] || err "❌ ${INSTALL_SH} is missing."
[ -f "${WEBUI_DIR}/install.sh" ] || err "❌ ${WEBUI_DIR}/install.sh is missing."

if [ -z "$cargo_jobs" ]; then
    cargo_jobs="$(nproc 2>/dev/null || printf '8\n')"
fi

BUILDER="${SUDO_USER:-}"
if [ -z "$BUILDER" ] || [ "$BUILDER" = "root" ]; then
    BUILDER="$(stat -c %U "$SCRIPT_DIR" 2>/dev/null || printf 'root\n')"
fi
BUILDER_HOME="$(getent passwd "$BUILDER" | cut -d: -f6)"
[ -n "$BUILDER_HOME" ] || BUILDER_HOME="/home/${BUILDER}"
CARGO_HOME="${BUILDER_HOME}/.cargo"
BUILDER_PATH="${CARGO_HOME}/bin:${BUILDER_HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin"

if [ "$profile" = "release" ]; then
    SOURCE_BIN="${SCRIPT_DIR}/target/release/stalwart"
    CARGO_PROFILE_ARGS="--release --locked"
else
    SOURCE_BIN="${SCRIPT_DIR}/target/debug/stalwart"
    CARGO_PROFILE_ARGS=""
fi

detect_live_webui

say ""
if [ "$webui_only" = "true" ]; then
    say "┌─────────────────────────────────────────────────────────┐"
    say "│   WebUI iterate (from webui/, no tarball, no wizard)    │"
    say "└─────────────────────────────────────────────────────────┘"
    say ""
    say "  Source:           ${WEBUI_DIR}"
    say "  Install prefix:   ${WEBUI_PREFIX}"
    say "  Service port:     ${WEBUI_PORT}"
    say "  Node:             ${NODE_BIN}"
    say "  Stalwart URL:     ${SERVER_URL}"
    say "  Builder:          ${BUILDER}"
    say ""
else
    say "┌─────────────────────────────────────────────────────────┐"
    say "│   Test install (same as customer install.sh, no EE)     │"
    say "└─────────────────────────────────────────────────────────┘"
    say ""
    say "  Profile:          ${profile}"
    say "  Features:         ${COMMUNITY_FEATURES}"
    say "  Cargo jobs:       ${cargo_jobs}"
    say "  Builder:          ${BUILDER}"
    say "  Stalwart artifact: ${ARTIFACT_BIN}"
    say "  WebUI artifact:    ${ARTIFACT_WEBUI}"
    say "  Then runs:        ${INSTALL_SH}"
    say ""
    say "  After the build, install.sh will ask for:"
    say "    - installation layout and artifact paths"
    say "    - public WebUI HTTPS origin and Caddy vs existing proxy"
    say "    - quick setup: public mail hostname (mail.example.com) and domain (example.com)"
    say "      Do not accept a cloud hostname ending in .internal"
    say "    - SMTP relay (Brevo default, Mailjet optional; recommended on GCP; port 25 is blocked)"
    say "    - whether to publish the printed DNS table through name.com"
    say ""
    say "  For WebUI-only changes, use: sudo sh ./test_install.sh --webui-only"
    say ""
fi

if [ "$dry_run" = "true" ]; then
    if [ "$webui_only" = "true" ]; then
        if [ "$skip_build" != "true" ]; then
            say "Dry run: (cd webui && npm ci && npm run build)"
        else
            say "Dry run: reuse ${WEBUI_DIR}/dist"
        fi
        say "Dry run: sh ${WEBUI_DIR}/install.sh --server-url ${SERVER_URL} --prefix ${WEBUI_PREFIX} --port ${WEBUI_PORT} --node-bin ${NODE_BIN} --systemd --no-build"
        exit 0
    fi
    if [ "$skip_build" != "true" ]; then
        # shellcheck disable=SC2086
        say "Dry run: cargo build -j ${cargo_jobs} -p stalwart --no-default-features --features \"${COMMUNITY_FEATURES}\" ${CARGO_PROFILE_ARGS}"
        say "Dry run: copy ${SOURCE_BIN} -> ${ARTIFACT_BIN}"
        say "Dry run: (cd webui && npm ci && npm run build)"
        say "Dry run: tar -czf ${ARTIFACT_WEBUI} install.sh server.mjs stalwart-webui.service dist"
    else
        say "Dry run: reuse ${ARTIFACT_BIN} and ${ARTIFACT_WEBUI}"
    fi
    say "Dry run: stop ${LAB_UNIT} if present"
    if [ "$reset_setup" = "true" ]; then
        say "Dry run: move /etc/stalwart/config.json, installer-state.json, and /var/lib/stalwart aside"
    fi
    say "Dry run: print public hostname examples (mail.example.com / example.com)"
    say "Dry run: exec sh ${INSTALL_SH}"
    say "Dry run: install.sh handles Caddy, CORS, Brevo/Mailjet SMTP relay, and name.com DNS"
    exit 0
fi

if [ "$webui_only" = "true" ]; then
    if [ "$skip_build" != "true" ]; then
        build_webui_dist
    fi
    [ -f "${WEBUI_DIR}/dist/index.html" ] || \
        err "❌ Missing ${WEBUI_DIR}/dist/index.html. Run without --skip-build."
    if [ "$(id -u)" -ne 0 ]; then
        say "🔐 WebUI systemd install must run as root. Re-running with sudo..."
        exec sudo sh "$SCRIPT_DIR/test_install.sh" --webui-only --skip-build
    fi
    [ -x "$NODE_BIN" ] || err "❌ Node binary is not executable: ${NODE_BIN}."
    install_webui_from_folder
    say ""
    say "✅ WebUI applied from ${WEBUI_DIR}."
    say "  Mail/Calendar:  http://127.0.0.1:${WEBUI_PORT}/"
    say ""
    exit 0
fi

if [ "$skip_build" != "true" ]; then
    if [ "$rebuild" = "true" ] || [ ! -x "$SOURCE_BIN" ]; then
        if ! run_as_builder sh -c 'command -v cargo >/dev/null'; then
            err "❌ cargo was not found for ${BUILDER}."
        fi
        if [ "$profile" = "release" ]; then
            say "⚠️  Release builds use fat LTO and can sit on stalwart(bin) for 30–45 minutes."
        fi
        say "📦 Building community Stalwart (${profile}, no enterprise)..."
        # shellcheck disable=SC2086
        run_as_builder cargo build -j "$cargo_jobs" -p stalwart \
            --manifest-path "${SCRIPT_DIR}/Cargo.toml" \
            --no-default-features --features "$COMMUNITY_FEATURES" \
            $CARGO_PROFILE_ARGS
    else
        say "ℹ️  Using existing ${SOURCE_BIN} (pass --rebuild to compile again)."
    fi
    [ -x "$SOURCE_BIN" ] || err "❌ Missing ${SOURCE_BIN}."
    say "📦 Staging ${ARTIFACT_BIN}..."
    install -m 0755 "$SOURCE_BIN" "$ARTIFACT_BIN"

    build_webui_dist
    say "📦 Staging ${ARTIFACT_WEBUI} for install.sh (customer installer requires a tarball)..."
    pack_webui_archive "$ARTIFACT_WEBUI" "$WEBUI_DIR"
fi

[ -x "$ARTIFACT_BIN" ] || \
    err "❌ Missing ${ARTIFACT_BIN}. Run without --skip-build, or copy the binary there."
[ -f "$ARTIFACT_WEBUI" ] || \
    err "❌ Missing ${ARTIFACT_WEBUI}. Run without --skip-build, or copy the archive there."

if [ "$(id -u)" -ne 0 ]; then
    say "🔐 install.sh must run as root. Re-running with sudo..."
    extra=""
    [ "$profile" = "dev" ] && extra="${extra} --dev"
    [ "$reset_setup" = "true" ] && extra="${extra} --reset-setup --yes"
    # shellcheck disable=SC2086
    exec sudo sh "$SCRIPT_DIR/test_install.sh" --skip-build $extra
fi

stop_lab_service
if [ "$reset_setup" = "true" ]; then
    reset_existing_setup
fi

say "🚀 Starting install.sh (same customer installer: setup, Caddy, DNS, Mailjet)..."
say ""
say "Public mail hostname and mail domain"
say "------------------------------------"
say "When setup asks for the server hostname, enter a public DNS name you control."
say "  Public mail hostname: eg, mail.example.com"
say "    SMTP, TLS certificates, MX/A records, and the WebUI server URL."
say "  Primary mail domain: eg, if you want admin@example.com as email address,"
say "    input example.com here."
say "Do not accept this VM's cloud name (anything ending in .internal or .local)."
say ""
exec sh "$INSTALL_SH"
