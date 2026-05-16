#!/usr/bin/env bash

set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cfg="$root/.opencode/server.jsonc"
config_env="$root/.opencode/config.env"
dir="$root/.opencode/server"
state="$dir/state"
port="${OPENCODE_ASSISTANT_PORT:-4096}"
host="${OPENCODE_ASSISTANT_HOST:-127.0.0.1}"
backend="opencode-assistant-backend"
worker="opencode-assistant-worker"
brave_container="brave-search-mcp"
BRAVE_API_KEY=""
OPENCODE_SERVER_PASSWORD=""
open_webui=1

INFO() { printf "==> %s\n" "$*"; }
WARN() { printf "!! %s\n" "$*" >&2; }

shell_quote() {
  local value="$1"
  value="${value//\'/\'\\\'\'}"
  printf "'%s'" "$value"
}

usage() {
  cat <<'EOF'
Usage: ./start.sh [options]

Options:
  --no-webui  Start or verify services without opening the web UI.
  -h, --help  Show this help text.
EOF
}

while (($#)); do
  case "$1" in
    --no-webui)
      open_webui=0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      WARN "Unknown argument: $1"
      usage >&2
      exit 1
      ;;
  esac
  shift
done

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
  else
    sudo docker "$@"
  fi
}

load_config_env() {
  local line

  if [[ ! -f "$config_env" ]]; then
    return
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      ""|\#*)
        continue
        ;;
      BRAVE_API_KEY=*)
        BRAVE_API_KEY="${line#BRAVE_API_KEY=}"
        BRAVE_API_KEY="${BRAVE_API_KEY%$'\r'}"
        ;;
      OPENCODE_SERVER_PASSWORD=*)
        OPENCODE_SERVER_PASSWORD="${line#OPENCODE_SERVER_PASSWORD=}"
        OPENCODE_SERVER_PASSWORD="${OPENCODE_SERVER_PASSWORD%$'\r'}"
        ;;
    esac
  done < "$config_env"
}

curl_health_check() {
  if [[ -n "$OPENCODE_SERVER_PASSWORD" ]]; then
    curl -sf -u "opencode:$OPENCODE_SERVER_PASSWORD" "$url"
    return
  fi

  curl -sf "$url"
}

mkdir -p "$dir" "$state"

load_config_env

if [[ -z "$OPENCODE_SERVER_PASSWORD" ]]; then
  WARN "OPENCODE_SERVER_PASSWORD is not configured in $config_env; the OpenCode server will run unsecured."
fi

root_q="$(shell_quote "$root")"
dir_index_q="$(shell_quote "$dir/index.ts")"
port_q="$(shell_quote "$port")"
host_q="$(shell_quote "$host")"
password_q="$(shell_quote "$OPENCODE_SERVER_PASSWORD")"

if [[ ! -f "$cfg" ]]; then
  cat <<'EOF'
Missing config: .opencode/server.jsonc
EOF
  exit 1
fi

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is required but was not found in PATH"
  exit 1
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "bun is required but was not found in PATH"
  exit 1
fi

if ! command -v opencode >/dev/null 2>&1; then
  echo "opencode is required but was not found in PATH"
  exit 1
fi

start_brave_search_mcp() {
  if ! command -v docker >/dev/null 2>&1; then
    WARN "docker is not available; brave-search MCP will remain unavailable"
    return
  fi

  if docker_cmd ps -a --format '{{.Names}}' | grep -wq "$brave_container"; then
    if docker_cmd ps --format '{{.Names}}' | grep -wq "$brave_container"; then
      INFO "$brave_container is already running"
      return
    fi
    INFO "Starting $brave_container"
    docker_cmd start "$brave_container" >/dev/null
    return
  fi

  if [[ -z "$BRAVE_API_KEY" ]]; then
    WARN "$brave_container container not found and BRAVE_API_KEY is not configured in $config_env"
    WARN "Run ./config.sh to configure Brave Search MCP."
    return
  fi

  INFO "Creating $brave_container"
  docker_cmd run -d \
    --name "$brave_container" \
    --restart unless-stopped \
    -p 9999:8080 \
    -e BRAVE_API_KEY="$BRAVE_API_KEY" \
    -e BRAVE_MCP_TRANSPORT="http" \
    -e BRAVE_MCP_ENABLED_TOOLS="brave_web_search" \
    -e BRAVE_MCP_LOG_LEVEL="debug" \
    mcp/brave-search:latest >/dev/null
}

start_brave_search_mcp

if ! tmux has-session -t "$backend" 2>/dev/null; then
  tmux new-session -d -s "$backend" "cd $root_q && OPENCODE_ASSISTANT_PORT=$port_q OPENCODE_ASSISTANT_HOST=$host_q OPENCODE_SERVER_PASSWORD=$password_q opencode serve --port $port_q --hostname $host_q"
fi

if ! tmux has-session -t "$worker" 2>/dev/null; then
  tmux new-session -d -s "$worker" "cd $root_q && OPENCODE_ASSISTANT_PORT=$port_q OPENCODE_ASSISTANT_HOST=$host_q OPENCODE_SERVER_PASSWORD=$password_q bun $dir_index_q"
fi

url="http://$host:$port"
INFO "Waiting for server at $url ..."
elapsed=0
while ! curl_health_check >/dev/null 2>&1; do
  if (( elapsed >= 30 )); then
    WARN "Server did not become ready within 30s"
    exit 1
  fi
  sleep 1
  ((++elapsed))
done
INFO "Server ready (${elapsed}s)"
INFO "Web UI: $url"

if (( open_webui == 0 )); then
  exit 0
fi

if command -v xdg-open >/dev/null 2>&1; then
  if xdg-open "$url" >/dev/null 2>&1; then
    INFO "Opened web UI in default browser"
  else
    WARN "Failed to open browser automatically; open $url manually"
  fi
else
  WARN "xdg-open not found; open $url manually"
fi
