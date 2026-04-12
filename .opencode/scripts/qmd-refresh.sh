#!/usr/bin/env bash
# qmd-refresh.sh — Refresh the sebastian index and log results.
#
# Usage:
#   bash .opencode/scripts/qmd-refresh.sh

set -euo pipefail

INDEX="sebastian"
BASE_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
LOG_DIR="$BASE_DIR/.opencode/server/state"
LOG_FILE="$LOG_DIR/qmd.log"

mkdir -p "$LOG_DIR"

ts() {
  while IFS= read -r line; do
    echo "[$(date '+%Y%m%d%H%M%S')] $line"
  done
}

log() {
  echo "[$(date '+%Y%m%d%H%M%S')] $*" >> "$LOG_FILE"
}

cd "$BASE_DIR"

log "=== qmd refresh start ==="

if ! command -v qmd &>/dev/null; then
  log "ERROR: qmd not found on PATH"
  exit 1
fi

# update
log "--- update ---"
if qmd --index "$INDEX" update 2>&1 | ts >> "$LOG_FILE"; then
  log "update: ok"
else
  log "update: failed (exit $?)"
fi

# embed
log "--- embed ---"
if qmd --index "$INDEX" embed 2>&1 | ts >> "$LOG_FILE"; then
  log "embed: ok"
else
  log "embed: failed (exit $?)"
fi

log "=== qmd refresh end ==="
