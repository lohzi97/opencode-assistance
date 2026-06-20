#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
config_env="$root/.opencode/config.env"

BACKUP_ENABLED="false"
BACKUP_RCLONE_REMOTE="gdrive"
BACKUP_RCLONE_PATH="opencode-assistance-backup"
DRY_RUN=0

INFO() { printf "==> %s\n" "$*"; }
WARN() { printf "!! %s\n" "$*" >&2; }
ERR() { printf "ERROR: %s\n" "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
Usage: .opencode/scripts/backup.sh [--dry-run]

Creates a timestamped Google Drive backup of notes, memory, journals, qmd
provider config, and the qmd SQLite DB.

Options:
  --dry-run  Validate config and print planned backup without staging or uploading.
  -h, --help Show this help text.
EOF
}

parse_args() {
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
        ERR "Unknown argument: $1"
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
      BACKUP_ENABLED=*)
        BACKUP_ENABLED="${line#BACKUP_ENABLED=}"
        BACKUP_ENABLED="${BACKUP_ENABLED%$'\r'}"
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

require_path() {
  [[ -e "$1" ]] || ERR "Required backup source '$1' was not found."
}

count_files() {
  if [[ -d "$1" ]]; then
    find "$1" -type f | wc -l | tr -d '[:space:]'
  else
    printf '0'
  fi
}

json_escape() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/}"
  printf '%s' "$value"
}

write_manifest() {
  local manifest_path="$1"
  local timestamp="$2"
  local hostname_value
  local qmd_db="$HOME/.cache/qmd/sebastian.sqlite"

  hostname_value="$(hostname 2>/dev/null || printf 'unknown')"

  cat > "$manifest_path" <<EOF
{
  "createdAt": "$timestamp",
  "host": "$(json_escape "$hostname_value")",
  "projectRoot": "$(json_escape "$root")",
  "backupSources": {
    "notes": "$(json_escape "$root/notes")",
    "memory": "$(json_escape "$root/memory")",
    "journals": "$(json_escape "$root/journals")",
    "qmdEnv": "$(json_escape "$HOME/.config/qmd/.env")",
    "qmdDb": "$(json_escape "$qmd_db")"
  },
  "fileCounts": {
    "notes": $(count_files "$root/notes"),
    "memory": $(count_files "$root/memory"),
    "journals": $(count_files "$root/journals")
  }
}
EOF
}

remote_target() {
  local base_path="${BACKUP_RCLONE_PATH%/}"
  local timestamp="$1"

  if [[ -z "$base_path" ]]; then
    printf '%s:%s' "$BACKUP_RCLONE_REMOTE" "$timestamp"
  else
    printf '%s:%s/%s' "$BACKUP_RCLONE_REMOTE" "$base_path" "$timestamp"
  fi
}

main() {
  local timestamp
  local tmp_dir
  local qmd_env="$HOME/.config/qmd/.env"
  local qmd_db="$HOME/.cache/qmd/sebastian.sqlite"
  local qmd_stage
  local target

  parse_args "$@"
  load_backup_config

  if [[ "$BACKUP_ENABLED" != "true" ]]; then
    ERR "Backup is disabled in $config_env. Run ./config.sh to enable it."
  fi

  require_command rclone
  require_command sqlite3

  require_path "$root/notes"
  require_path "$root/memory"
  require_path "$root/journals"
  require_path "$qmd_env"
  require_path "$qmd_db"

  timestamp="$(date '+%Y%m%d%H%M%S')"
  target="$(remote_target "$timestamp")"

  if (( DRY_RUN == 1 )); then
    INFO "Dry run: no files will be staged or uploaded"
    INFO "Would create backup timestamp: $timestamp"
    INFO "Would upload to: $target"
    INFO "Would include: $root/notes ($(count_files "$root/notes") files)"
    INFO "Would include: $root/memory ($(count_files "$root/memory") files)"
    INFO "Would include: $root/journals ($(count_files "$root/journals") files)"
    INFO "Would include: $qmd_env"
    INFO "Would snapshot SQLite DB: $qmd_db"
    if rclone listremotes 2>/dev/null | grep -Fxq "${BACKUP_RCLONE_REMOTE}:"; then
      INFO "rclone remote '$BACKUP_RCLONE_REMOTE' exists"
    else
      WARN "rclone remote '$BACKUP_RCLONE_REMOTE' does not exist"
    fi
    exit 0
  fi

  tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/opencode-assistance-backup.${timestamp}.XXXXXX")"
  trap "rm -rf -- '$tmp_dir'" EXIT

  INFO "Staging backup in $tmp_dir"
  mkdir -p "$tmp_dir/qmd"
  cp -a "$root/notes" "$tmp_dir/notes"
  cp -a "$root/memory" "$tmp_dir/memory"
  cp -a "$root/journals" "$tmp_dir/journals"
  install -m 600 "$qmd_env" "$tmp_dir/qmd/env"

  qmd_stage="$tmp_dir/qmd/sebastian.sqlite"
  INFO "Creating SQLite-safe qmd snapshot"
  sqlite3 "$qmd_db" "PRAGMA wal_checkpoint(FULL);" >/dev/null
  sqlite3 "$qmd_db" ".backup '$qmd_stage'"
  chmod 600 "$qmd_stage"

  write_manifest "$tmp_dir/manifest.json" "$timestamp"

  INFO "Uploading backup to $target"
  rclone copy "$tmp_dir" "$target" --create-empty-src-dirs --progress --stats 10s

  INFO "Backup complete: $target"
}

main "$@"
