#!/usr/bin/env bash
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
config_env="$root/.opencode/config.env"

BACKUP_ENABLED="false"
BACKUP_RCLONE_REMOTE="gdrive"
BACKUP_RCLONE_PATH="opencode-assistance-backup"

INFO() { printf "==> %s\n" "$*"; }
WARN() { printf "!! %s\n" "$*" >&2; }

load_backup_config() {
  local line

  if [[ ! -f "$config_env" ]]; then
    WARN "Missing config: $config_env. Run ./config.sh first."
    return 1
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

remote_root() {
  local base_path="${BACKUP_RCLONE_PATH%/}"

  if [[ -z "$base_path" ]]; then
    printf '%s:' "$BACKUP_RCLONE_REMOTE"
  else
    printf '%s:%s' "$BACKUP_RCLONE_REMOTE" "$base_path"
  fi
}

main() {
  local qmd_db="$HOME/.cache/qmd/sebastian.sqlite"
  local qmd_env="$HOME/.config/qmd/.env"
  local remote

  load_backup_config || true

  INFO "Backup enabled: $BACKUP_ENABLED"
  INFO "rclone remote: $BACKUP_RCLONE_REMOTE"
  INFO "Google Drive backup path: $BACKUP_RCLONE_PATH"

  if command -v sqlite3 >/dev/null 2>&1; then
    INFO "sqlite3: $(command -v sqlite3)"
  else
    WARN "sqlite3 is not installed"
  fi

  if command -v rclone >/dev/null 2>&1; then
    INFO "rclone: $(command -v rclone)"
    if rclone listremotes 2>/dev/null | grep -Fxq "${BACKUP_RCLONE_REMOTE}:"; then
      INFO "rclone remote '$BACKUP_RCLONE_REMOTE' exists"
      remote="$(remote_root)"
      INFO "Latest remote backup directories under $remote:"
      if ! rclone lsf "$remote" --dirs-only 2>/dev/null | sort | tail -n 10; then
        WARN "Unable to list remote backup directories"
      fi
    else
      WARN "rclone remote '$BACKUP_RCLONE_REMOTE' does not exist"
    fi
  else
    WARN "rclone is not installed"
  fi

  if [[ -f "$qmd_db" ]]; then
    INFO "qmd DB: $qmd_db ($(du -h "$qmd_db" | cut -f1))"
  else
    WARN "qmd DB missing: $qmd_db"
  fi

  if [[ -f "$qmd_env" ]]; then
    INFO "qmd env: $qmd_env"
  else
    WARN "qmd env missing: $qmd_env"
  fi
}

main "$@"
