#!/usr/bin/env bash
# journal-cleanup.sh — Delete journal files older than per-folder retention windows.
#
# Age is derived from the YYYYMMDD prefix embedded in each filename (not mtime),
# because session/ and session-summary/ intentionally re-export the same session
# across multiple days and we want each daily snapshot to age independently.
#
# Default retention:
#   journals/session/          30 days
#   journals/session-summary/  90 days
#   journals/daily/           365 days
#
# Usage:
#   bash .opencode/scripts/journal-cleanup.sh                     # dry-run with defaults
#   bash .opencode/scripts/journal-cleanup.sh --apply             # delete with defaults
#   bash .opencode/scripts/journal-cleanup.sh --session 7 --apply # override one window
#   bash .opencode/scripts/journal-cleanup.sh --root /tmp/mock    # point at a sandbox
#
# Options:
#   --session DAYS    Retention for journals/session/          (default: 30)
#   --summary DAYS    Retention for journals/session-summary/  (default: 90)
#   --daily DAYS      Retention for journals/daily/            (default: 365)
#   --root PATH       Journal root (default: repo root)
#   --apply           Actually delete files (default: dry-run)
#   --dry-run         Force dry-run (default behaviour, explicit flag)
#   -h, --help        Show this help

set -euo pipefail

# --- defaults ---------------------------------------------------------------
SESSION_DAYS=30
SUMMARY_DAYS=90
DAILY_DAYS=365
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
MODE="dry-run"

# --- arg parsing ------------------------------------------------------------
usage() { sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'; exit 0; }

while [[ $# -gt 0 ]]; do
  case "$1" in
    --session)  SESSION_DAYS="$2"; shift 2;;
    --summary)  SUMMARY_DAYS="$2"; shift 2;;
    --daily)    DAILY_DAYS="$2";   shift 2;;
    --root)     ROOT_DIR="$2";     shift 2;;
    --apply)    MODE="apply";      shift;;
    --dry-run)  MODE="dry-run";    shift;;
    -h|--help)  usage;;
    *) echo "Unknown option: $1" >&2; exit 2;;
  esac
done

# Validate retention args are non-negative integers.
for kv in "session:$SESSION_DAYS" "summary:$SUMMARY_DAYS" "daily:$DAILY_DAYS"; do
  name="${kv%%:*}"; val="${kv##*:}"
  if ! [[ "$val" =~ ^[0-9]+$ ]]; then
    echo "ERROR: --$name must be a non-negative integer, got '$val'" >&2
    exit 2
  fi
done

TODAY="$(date '+%Y%m%d')"

# cutoff YYYYMMDD for a given day count (files dated strictly before this survive-check are deleted).
cutoff() {
  local days="$1"
  date -d "$TODAY - $days days" '+%Y%m%d'
}

SESSION_CUTOFF="$(cutoff "$SESSION_DAYS")"
SUMMARY_CUTOFF="$(cutoff "$SUMMARY_DAYS")"
DAILY_CUTOFF="$(cutoff "$DAILY_DAYS")"

# --- header -----------------------------------------------------------------
echo "journal-cleanup ($MODE)"
echo "  root:              $ROOT_DIR"
echo "  today:             $TODAY"
echo "  session/    >= $SESSION_DAYS days  (delete on/before $SESSION_CUTOFF)"
echo "  session-summary/ >= $SUMMARY_DAYS days  (delete on/before $SUMMARY_CUTOFF)"
echo "  daily/      >= $DAILY_DAYS days  (delete on/before $DAILY_CUTOFF)"
echo

# --- per-folder sweep -------------------------------------------------------
# Args: folder_name retention_days cutoff_yyyymmdd
sweep() {
  local name="$1" days="$2" cutoff="$3"
  local dir="$ROOT_DIR/journals/$name"

  echo "--- $name (retention ${days}d, cutoff $cutoff) ---"

  if [[ ! -d "$dir" ]]; then
    echo "  (folder missing, skipping)"
    echo
    return 0
  fi

  local total=0 deleted=0 kept=0 skipped=0
  local deleted_bytes=0
  local f basename dateprefix size

  # Sort for deterministic output; null-delimit to survive odd filenames.
  while IFS= read -r f; do
    [[ -z "$f" ]] && continue
    total=$((total + 1))
    basename="$(basename "$f")"

    # Only consider .md files whose name starts with YYYYMMDD.
    if ! [[ "$basename" =~ ^([0-9]{8}).*\.md$ ]]; then
      skipped=$((skipped + 1))
      continue
    fi

    dateprefix="${BASH_REMATCH[1]}"
    size="$(stat -c '%s' "$f")"

    # Lexical compare works because both are YYYYMMDD zero-padded.
    if [[ "$dateprefix" > "$cutoff" ]]; then
      kept=$((kept + 1))
    else
      deleted=$((deleted + 1))
      deleted_bytes=$((deleted_bytes + size))
      if [[ "$MODE" == "apply" ]]; then
        rm -f -- "$f"
        echo "  DELETE  $basename"
      else
        echo "  would-delete  $basename"
      fi
    fi
  done < <(find "$dir" -maxdepth 1 -type f -name '*.md' -printf '%p\n' | sort)

  local human_bytes
  if   (( deleted_bytes >= 1048576 )); then
    human_bytes="$(awk -v b="$deleted_bytes" 'BEGIN{printf "%.1f MB", b/1048576}')"
  elif (( deleted_bytes >= 1024 )); then
    human_bytes="$(awk -v b="$deleted_bytes" 'BEGIN{printf "%.1f KB", b/1024}')"
  else
    human_bytes="$deleted_bytes B"
  fi

  echo "  summary: total=$total kept=$kept ${MODE//run/run}-deleted=$deleted skipped=$skipped reclaimed=$human_bytes"
  echo
}

sweep "session"         "$SESSION_DAYS" "$SESSION_CUTOFF"
sweep "session-summary" "$SUMMARY_DAYS" "$SUMMARY_CUTOFF"
sweep "daily"           "$DAILY_DAYS"   "$DAILY_CUTOFF"

if [[ "$MODE" == "dry-run" ]]; then
  echo "Dry-run only. Re-run with --apply to actually delete."
else
  echo "Applied."
fi
