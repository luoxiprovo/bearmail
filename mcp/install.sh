#!/usr/bin/env sh
set -eu

# Compatibility marker consumed by the repository's combined installer.
BEARMAIL_MCP_ARCHIVE_VERSION=1

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
prefix="/opt/bearmail-mcp"
port="8082"
node_bin=""
install_service="false"
build="true"
server_url=""

usage() {
  printf '%s\n' "Usage: ./install.sh [--server-url URL] [--prefix PATH] [--port PORT] [--node-bin PATH] [--systemd] [--no-build]"
  printf '%s\n' "Installs the BearMail MCP server. It does not change Stalwart or accept account credentials."
}

node_at_least_22_12() {
  _node_version=$("$1" --version 2>/dev/null) || return 1
  case "$_node_version" in v*) _node_numbers=${_node_version#v} ;; *) return 1 ;; esac
  case "$_node_numbers" in ''|.*|*.|*..*|*[!0-9.]*) return 1 ;; esac
  _node_major=${_node_numbers%%.*}
  _node_rest=${_node_numbers#*.}
  [ "$_node_rest" != "$_node_numbers" ] || return 1
  _node_minor=${_node_rest%%.*}
  _node_patch=${_node_rest#*.}
  [ "$_node_patch" != "$_node_rest" ] || return 1
  case "$_node_major:$_node_minor:$_node_patch" in *[!0-9:]*) return 1 ;; esac
  [ "$_node_major" -gt 22 ] 2>/dev/null || \
    { [ "$_node_major" -eq 22 ] 2>/dev/null && [ "$_node_minor" -ge 12 ] 2>/dev/null; }
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --server-url) server_url=${2:?Missing URL after --server-url}; shift 2 ;;
    --prefix) prefix=${2:?Missing path after --prefix}; shift 2 ;;
    --port) port=${2:?Missing port after --port}; shift 2 ;;
    --node-bin) node_bin=${2:?Missing path after --node-bin}; shift 2 ;;
    --systemd) install_service="true"; shift ;;
    --no-build) build="false"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$port" in *[!0-9]*|'') printf 'Port must be a number.\n' >&2; exit 2 ;; esac
case "$prefix" in /*) ;; *) printf 'Prefix must be an absolute path.\n' >&2; exit 2 ;; esac
if [ -z "$node_bin" ]; then
  command -v node >/dev/null 2>&1 || { printf 'Node.js 22.12 or later is required.\n' >&2; exit 1; }
  node_bin=$(command -v node)
fi
case "$node_bin" in /*) ;; *) printf 'Node binary path must be absolute.\n' >&2; exit 2 ;; esac
[ -x "$node_bin" ] || { printf 'Node binary is not executable: %s\n' "$node_bin" >&2; exit 1; }
node_at_least_22_12 "$node_bin" || { printf 'Node.js 22.12 or later is required.\n' >&2; exit 1; }

if [ "$build" = "true" ]; then
  command -v npm >/dev/null 2>&1 || { printf 'npm is required.\n' >&2; exit 1; }
  (cd "$script_dir" && npm ci && npm run build)
fi
[ -f "${script_dir}/dist/http.js" ] || { printf 'MCP dist/http.js is missing. Build first or unpack a prebuilt archive.\n' >&2; exit 1; }

install -d -m 0755 "$prefix"
cp -a "${script_dir}/dist" "${script_dir}/package.json" "$prefix/"
if [ -d "${script_dir}/node_modules" ]; then
  cp -a "${script_dir}/node_modules" "$prefix/"
fi
if [ -n "$server_url" ]; then
  printf '%s\n' "$server_url" > "${prefix}/server-url"
fi

if [ "$install_service" = "true" ]; then
  unit=/etc/systemd/system/bearmail-mcp.service
  sed -e "s|@@PREFIX@@|${prefix}|g" -e "s|@@PORT@@|${port}|g" -e "s|@@NODE_BIN@@|${node_bin}|g" \
    -e "s|@@SERVER@@|${server_url}|g" \
    "${script_dir}/bearmail-mcp.service" > "$unit"
  systemctl daemon-reload
  systemctl enable --now bearmail-mcp.service
fi

printf 'BearMail MCP installed at %s (HTTP 127.0.0.1:%s).\n' "$prefix" "$port"
printf 'Set BEARMAIL_USERNAME and BEARMAIL_TOKEN in the unit or MCP host. Stdio: node %s/dist/stdio.js\n' "$prefix"
printf 'Do not pass tokens as command-line arguments. See docs/AGENT_GUIDE.md\n'
