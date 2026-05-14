#!/usr/bin/env bash

set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
helper_args=()
detached=0
log_dir="/tmp/opencode"

usage() {
  cat <<'EOF'
Usage: ./restart.sh [options]

Options:
  --detached         Launch the restart helper in the background and return immediately.
  --session-id <id>  Session to notify after detached restart. Required with `--detached`.
  --reason <text>    Short reason included in detached restart follow-up.
  -h, --help  Show this help text.
EOF
}

while (($#)); do
  case "$1" in
    --detached)
      detached=1
      ;;
    --session-id)
      if (($# < 2)); then
        printf 'Missing value for %s\n' "$1" >&2
        exit 1
      fi
      helper_args+=("$1" "$2")
      shift
      ;;
    --reason)
      if (($# < 2)); then
        printf 'Missing value for %s\n' "$1" >&2
        exit 1
      fi
      helper_args+=("$1" "$2")
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 1
      ;;
  esac
  shift
done

if (( detached == 1 )); then
  mkdir -p "$log_dir"

  has_session_id=0
  for ((i = 0; i < ${#helper_args[@]}; i += 1)); do
    if [[ "${helper_args[i]}" == "--session-id" ]]; then
      has_session_id=1
      break
    fi
  done

  if (( has_session_id == 0 )); then
    printf '%s\n' 'Detached restart requires --session-id <id>' >&2
    exit 1
  fi

  if ! command -v bun >/dev/null 2>&1; then
    printf 'bun is required but was not found in PATH\n' >&2
    exit 1
  fi

  timestamp="$(date +%Y%m%d%H%M%S)"
  log_file="$log_dir/restart-opencode-$timestamp.log"
  OPENCODE_RESTART_LOG_PATH="$log_file" nohup bun "$root/.opencode/scripts/restart-opencode.ts" "${helper_args[@]}" \
    >"$log_file" 2>&1 </dev/null &
  printf 'Detached restart helper launched. Log: %s\n' "$log_file"
  exit 0
fi

"$root/stop.sh"
exec "$root/start.sh"
