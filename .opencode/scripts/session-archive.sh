#!/usr/bin/env bash
# session-archive.sh - Manage OpenCode session archive state.
#
# OpenCode has no UI for unarchiving. Archiving sets the `time_archived`
# column (epoch ms) on the `session` row in opencode.db; unarchiving clears
# it back to NULL. This script wraps both directions plus listing/status.
#
# Usage:
#   session-archive.sh list                  List all archived sessions
#   session-archive.sh list-all              List all sessions with archive flag
#   session-archive.sh archive <id>          Archive a session
#   session-archive.sh unarchive <id>        Unarchive a session
#   session-archive.sh status <id>           Show archive status of a session
#
# Notes:
#   - `opencode db "<query>"` opens the DB read-only (safe for SELECTs).
#   - Writes (UPDATE) go through raw sqlite3 on the path from `opencode db path`.
#   - Ensure the opencode server/TUI is not holding a write lock when writing.

set -euo pipefail

DB_PATH="$(opencode db path)"

# Verify opencode db is reachable.
if [ -z "$DB_PATH" ] || [ ! -f "$DB_PATH" ]; then
  echo "ERROR: could not locate opencode.db at '$DB_PATH'" >&2
  exit 1
fi

usage() {
  cat <<'EOF'
Usage: session-archive.sh <command> [args]

Commands:
  list                  List all archived sessions (id, title, archived-time)
  list-all              List all sessions with archive status
  archive <id>          Archive a session by ID
  unarchive <id>        Unarchive a session by ID
  status <id>           Show archive status of a specific session
EOF
}

# Convert epoch-ms to human-readable. Falls back to raw value on failure.
fmt_date() {
  local ms="$1"
  if [ -z "$ms" ] || [ "$ms" = "NULL" ]; then
    echo "NULL"
    return
  fi
  local sec=$(( ms / 1000 ))
  date -d "@${sec}" "+%Y-%m-%d %H:%M:%S %Z" 2>/dev/null || echo "$ms"
}

cmd_list() {
  echo "Archived sessions:"
  echo ""
  opencode db "SELECT id, title, time_archived FROM session WHERE time_archived IS NOT NULL ORDER BY time_archived DESC" --format json
}

cmd_list_all() {
  opencode db "SELECT id, title, time_archived FROM session ORDER BY time_updated DESC" --format json
}

cmd_status() {
  local id="$1"
  opencode db "SELECT id, title, time_archived FROM session WHERE id = '${id}'" --format json
}

cmd_archive() {
  local id="$1"
  # Verify the session exists first.
  local exists
  exists=$(opencode db "SELECT COUNT(*) as cnt FROM session WHERE id = '${id}'" --format json)
  if ! echo "$exists" | grep -q '"cnt": 1\|"cnt":1'; then
    echo "ERROR: session '${id}' not found." >&2
    exit 1
  fi
  sqlite3 "$DB_PATH" "UPDATE session SET time_archived = $(date +%s%3N) WHERE id = '${id}'"
  echo "Archived: ${id}"
  cmd_status "$id"
}

cmd_unarchive() {
  local id="$1"
  # Verify the session exists first.
  local exists
  exists=$(opencode db "SELECT COUNT(*) as cnt FROM session WHERE id = '${id}'" --format json)
  if ! echo "$exists" | grep -q '"cnt": 1\|"cnt":1'; then
    echo "ERROR: session '${id}' not found." >&2
    exit 1
  fi
  sqlite3 "$DB_PATH" "UPDATE session SET time_archived = NULL WHERE id = '${id}'"
  echo "Unarchived: ${id}"
  cmd_status "$id"
}

# --- Main ---

if [ $# -lt 1 ]; then
  usage
  exit 1
fi

command="$1"
shift

case "$command" in
  list)
    cmd_list
    ;;
  list-all)
    cmd_list_all
    ;;
  status)
    [ $# -ge 1 ] || { echo "ERROR: status requires a session ID." >&2; usage; exit 1; }
    cmd_status "$1"
    ;;
  archive)
    [ $# -ge 1 ] || { echo "ERROR: archive requires a session ID." >&2; usage; exit 1; }
    cmd_archive "$1"
    ;;
  unarchive)
    [ $# -ge 1 ] || { echo "ERROR: unarchive requires a session ID." >&2; usage; exit 1; }
    cmd_unarchive "$1"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "ERROR: unknown command '${command}'" >&2
    usage
    exit 1
    ;;
esac
