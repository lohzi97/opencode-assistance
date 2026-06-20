#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
config_env="$root/.opencode/config.env"

BACKUP_RCLONE_REMOTE="gdrive"
BACKUP_RCLONE_PATH="opencode-assistance-backup"
DRY_RUN=0

INFO() { printf "==> %s\n" "$*"; }
WARN() { printf "!! %s\n" "$*" >&2; }
ERR() { printf "ERROR: %s\n" "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: .opencode/scripts/restore-backup.sh [--dry-run] [timestamp]

Restores notes, memory, journals, qmd provider config, and the qmd SQLite DB
from a timestamped Google Drive backup directory.

Options:
  --dry-run  Validate remote snapshot and print planned restore without downloading or overwriting.
  -h, --help Show this help text.
EOF
}

parse_args() {
  SNAPSHOT_ARG=""

  while (($#)); do
    case "$1" in
      --dry-run)
        DRY_RUN=1
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        if [[ -n "$SNAPSHOT_ARG" ]]; then
          ERR "Only one snapshot timestamp may be provided."
        fi
        SNAPSHOT_ARG="$1"
        ;;
    esac
    shift
  done
}

load_backup_config() {
  local line

  if [[ ! -f "$config_env" ]]; then
    ERR "Missing config: $config_env. Run ./config.sh first."
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      ""|\#*)
        continue
        ;;
      BACKUP_RCLONE_REMOTE=*)
        BACKUP_RCLONE_REMOTE="${line#BACKUP_RCLONE_REMOTE=}"
        BACKUP_RCLONE_REMOTE="${BACKUP_RCLONE_REMOTE%$'\r'}"
        ;;
      BACKUP_RCLONE_PATH=*)
        BACKUP_RCLONE_PATH="${line#BACKUP_RCLONE_PATH=}"
        BACKUP_RCLONE_PATH="${BACKUP_RCLONE_PATH%$'\r'}"
        ;;
    esac
  done < "$config_env"
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || ERR "Required command '$1' is not available. Run ./install.sh first."
}

remote_root() {
  local base_path="${BACKUP_RCLONE_PATH%/}"

  if [[ -z "$base_path" ]]; then
    printf '%s:' "$BACKUP_RCLONE_REMOTE"
  else
    printf '%s:%s' "$BACKUP_RCLONE_REMOTE" "$base_path"
  fi
}

remote_snapshot() {
  local timestamp="$1"
  local base_path="${BACKUP_RCLONE_PATH%/}"

  if [[ -z "$base_path" ]]; then
    printf '%s:%s' "$BACKUP_RCLONE_REMOTE" "$timestamp"
  else
    printf '%s:%s/%s' "$BACKUP_RCLONE_REMOTE" "$base_path" "$timestamp"
  fi
}

confirm() {
  local prompt="$1"
  local ans

  read -r -p "$prompt [y/N] " ans
  case "$ans" in
    [yY]|[yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

choose_snapshot() {
  local remote="$1"
  local snapshot

  INFO "Available backup directories under $remote:"
  rclone lsf "$remote" --dirs-only | sort
  printf "Snapshot timestamp to restore: " >&2
  IFS= read -r snapshot
  snapshot="${snapshot%/}"

  if [[ -z "$snapshot" ]]; then
    ERR "No snapshot timestamp provided."
  fi

  printf '%s' "$snapshot"
}

validate_snapshot() {
  local dir="$1"
  local required

  for required in \
    "$dir/manifest.json" \
    "$dir/notes" \
    "$dir/memory" \
    "$dir/journals" \
    "$dir/qmd/env" \
    "$dir/qmd/sebastian.sqlite"; do
    [[ -e "$required" ]] || ERR "Downloaded backup is incomplete; missing $required"
  done
}

validate_remote_snapshot() {
  local source="$1"
  local required
  local listing_file

  listing_file="$(mktemp "${TMPDIR:-/tmp}/opencode-assistance-restore-lsf.XXXXXX")"
  trap 'rm -f "$listing_file"' RETURN

  rclone lsf "$source" --recursive > "$listing_file"

  for required in \
    "manifest.json" \
    "notes/" \
    "memory/" \
    "journals/" \
    "qmd/env" \
    "qmd/sebastian.sqlite"; do
    if ! grep -Fxq "$required" "$listing_file"; then
      ERR "Remote backup is incomplete; missing $source/$required"
    fi
  done
}

restore_dir() {
  local source_dir="$1"
  local target_dir="$2"

  rm -rf "$target_dir"
  mkdir -p "$(dirname "$target_dir")"
  cp -a "$source_dir" "$target_dir"
}

main() {
  local snapshot=""
  local remote
  local source
  local tmp_dir
  local qmd_config_dir="$HOME/.config/qmd"
  local qmd_cache_dir="$HOME/.cache/qmd"

  parse_args "$@"
  snapshot="$SNAPSHOT_ARG"

  load_backup_config
  require_command rclone

  if ! rclone listremotes 2>/dev/null | grep -Fxq "${BACKUP_RCLONE_REMOTE}:"; then
    ERR "rclone remote '$BACKUP_RCLONE_REMOTE' does not exist. Run ./config.sh or 'rclone config'."
  fi

  remote="$(remote_root)"
  if [[ -z "$snapshot" ]]; then
    snapshot="$(choose_snapshot "$remote")"
  fi
  snapshot="${snapshot%/}"
  source="$(remote_snapshot "$snapshot")"

  if (( DRY_RUN == 1 )); then
    INFO "Dry run: no files will be downloaded or overwritten"
    INFO "Would restore from: $source"
    validate_remote_snapshot "$source"
    INFO "Remote snapshot structure looks complete"
    INFO "Would overwrite: $root/notes"
    INFO "Would overwrite: $root/memory"
    INFO "Would overwrite: $root/journals"
    INFO "Would restore: $HOME/.config/qmd/.env"
    INFO "Would restore: $HOME/.cache/qmd/sebastian.sqlite"
    exit 0
  fi

  WARN "This will overwrite local notes, memory, journals, ~/.config/qmd/.env, and ~/.cache/qmd/sebastian.sqlite."
  WARN "Stop opencode-assistance first if any session may be using qmd."
  if ! confirm "Restore from $source?"; then
    INFO "Restore aborted."
    exit 0
  fi

  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/opencode-assistance-restore.${snapshot}.XXXXXX")"
  trap "rm -rf -- '$tmp_dir'" EXIT

  INFO "Downloading backup from $source"
  rclone copy "$source" "$tmp_dir"
  validate_snapshot "$tmp_dir"

  INFO "Restoring notes, memory, and journals"
  restore_dir "$tmp_dir/notes" "$root/notes"
  restore_dir "$tmp_dir/memory" "$root/memory"
  restore_dir "$tmp_dir/journals" "$root/journals"

  INFO "Restoring qmd provider config and SQLite DB"
  mkdir -p "$qmd_config_dir" "$qmd_cache_dir"
  install -m 600 "$tmp_dir/qmd/env" "$qmd_config_dir/.env"
  rm -f "$qmd_cache_dir/sebastian.sqlite" "$qmd_cache_dir/sebastian.sqlite-wal" "$qmd_cache_dir/sebastian.sqlite-shm"
  install -m 600 "$tmp_dir/qmd/sebastian.sqlite" "$qmd_cache_dir/sebastian.sqlite"

  if command -v qmd >/dev/null 2>&1; then
    INFO "Verifying restored qmd index"
    qmd --index sebastian status || WARN "qmd status failed; the restored files are in place, but qmd needs attention."
  else
    WARN "qmd is not installed; skipping qmd status verification."
  fi

  INFO "Restore complete from $source"
}

main "$@"
