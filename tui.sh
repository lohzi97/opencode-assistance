#!/usr/bin/env bash

set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
port="${OPENCODE_ASSISTANT_PORT:-4096}"
host="${OPENCODE_ASSISTANT_HOST:-127.0.0.1}"
backend="opencode-assistant-backend"
worker="opencode-assistant-cron"
url="http://$host:$port"
config_env="$root/.opencode/config.env"
OPENCODE_SERVER_PASSWORD=""

INFO() { printf "==> %s\n" "$*"; }
WARN() { printf "!! %s\n" "$*" >&2; }

usage() {
  cat <<'EOF'
Usage: ./tui.sh [attach-options]

Attach to the running opencode backend started by ./start.sh.
Any extra arguments are passed through to `opencode attach`.

Examples:
  ./tui.sh
  ./tui.sh --continue
  ./tui.sh --session <id>

Options:
  -h, --help  Show this help text.
EOF
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
      OPENCODE_SERVER_PASSWORD=*)
        OPENCODE_SERVER_PASSWORD="${line#OPENCODE_SERVER_PASSWORD=}"
        OPENCODE_SERVER_PASSWORD="${OPENCODE_SERVER_PASSWORD%$'\r'}"
        return
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

if (($#)) && [[ "$1" == "-h" || "$1" == "--help" ]]; then
  usage
  exit 0
fi

if ! command -v tmux >/dev/null 2>&1; then
  printf 'tmux is required but was not found in PATH\n' >&2
  exit 1
fi

if ! command -v opencode >/dev/null 2>&1; then
  printf 'opencode is required but was not found in PATH\n' >&2
  exit 1
fi

load_config_env

if ! tmux has-session -t "$backend" 2>/dev/null; then
  WARN "Backend session '$backend' is not running. Start services with ./start.sh first."
  exit 1
fi

if ! curl_health_check >/dev/null 2>&1; then
  WARN "Backend is not reachable at $url. Start services with ./start.sh first."
  exit 1
fi

if ! tmux has-session -t "$worker" 2>/dev/null; then
  WARN "Worker session '$worker' is not running. Continuing with TUI attach anyway."
fi

INFO "Attaching TUI to $url"
if [[ -n "$OPENCODE_SERVER_PASSWORD" ]]; then
  exec opencode attach --password "$OPENCODE_SERVER_PASSWORD" "$@" "$url"
fi

exec opencode attach "$@" "$url"
