#!/usr/bin/env bash

set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cfg="$root/.opencode/server.jsonc"
dir="$root/.opencode/server"
state="$dir/state"
port="${OPENCODE_ASSISTANT_PORT:-4096}"
host="${OPENCODE_ASSISTANT_HOST:-127.0.0.1}"
backend="opencode-assistant-backend"
worker="opencode-assistant-cron"
brave_container="brave-search-mcp"

INFO() { printf "==> %s\n" "$*"; }
WARN() { printf "!! %s\n" "$*" >&2; }

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
  else
    sudo docker "$@"
  fi
}

mkdir -p "$dir" "$state"

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

  WARN "$brave_container container not found. Create it once with:"
  cat <<'EOF' >&2
docker run -d \
  --name brave-search-mcp \
  --restart unless-stopped \
  -p 9999:8080 \
  -e BRAVE_API_KEY="api-key" \
  -e BRAVE_MCP_TRANSPORT="http" \
  -e BRAVE_MCP_ENABLED_TOOLS="brave_web_search" \
  -e BRAVE_MCP_LOG_LEVEL="debug" \
  mcp/brave-search:latest
EOF
}

start_brave_search_mcp

if ! tmux has-session -t "$backend" 2>/dev/null; then
  tmux new-session -d -s "$backend" "cd '$root' && OPENCODE_ASSISTANT_PORT='$port' OPENCODE_ASSISTANT_HOST='$host' opencode serve --port '$port' --hostname '$host'"
fi

if ! tmux has-session -t "$worker" 2>/dev/null; then
  tmux new-session -d -s "$worker" "cd '$root' && OPENCODE_ASSISTANT_PORT='$port' OPENCODE_ASSISTANT_HOST='$host' bun '$dir/index.ts'"
fi

exec opencode attach "http://$host:$port"
