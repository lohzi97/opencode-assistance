#!/usr/bin/env bash

set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
opencode_dir="$root/.opencode"
config_env="$opencode_dir/config.env"
config_template="$opencode_dir/config.env.example"
google_drive_oauth_credentials="$opencode_dir/gcp-oauth.keys.json"
telegram_config="$opencode_dir/telegram-ping.jsonc"
telegram_template="$opencode_dir/telegram-ping-example.jsonc"
brave_container="brave-search-mcp"

EXISTING_BRAVE_API_KEY=""
EXISTING_GOOGLE_DRIVE_OAUTH_CREDENTIALS=""
EXISTING_OPENCODE_SERVER_PASSWORD=""
EXISTING_TELEGRAM_BOT_TOKEN=""
EXISTING_TELEGRAM_CHAT_ID=""

INFO() { printf "==> %s\n" "$*"; }
WARN() { printf "!! %s\n" "$*" >&2; }
ERR() { printf "ERROR: %s\n" "$*" >&2; exit 1; }

require_command() {
  command -v "$1" >/dev/null 2>&1 || ERR "Required command '$1' is not available. Run ./install.sh first."
}

require_file() {
  [[ -f "$1" ]] || ERR "Required file '$1' was not found."
}

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
  else
    sudo docker "$@"
  fi
}

escape_sed_replacement() {
  printf '%s' "$1" | sed 's/[&|]/\\&/g'
}

load_existing_config_values() {
  local line

  if [[ ! -f "$config_env" ]]; then
    return 0
  fi

  while IFS= read -r line || [[ -n "$line" ]]; do
    case "$line" in
      ""|\#*)
        continue
        ;;
      BRAVE_API_KEY=*)
        EXISTING_BRAVE_API_KEY="${line#BRAVE_API_KEY=}"
        EXISTING_BRAVE_API_KEY="${EXISTING_BRAVE_API_KEY%$'\r'}"
        ;;
      OPENCODE_SERVER_PASSWORD=*)
        EXISTING_OPENCODE_SERVER_PASSWORD="${line#OPENCODE_SERVER_PASSWORD=}"
        EXISTING_OPENCODE_SERVER_PASSWORD="${EXISTING_OPENCODE_SERVER_PASSWORD%$'\r'}"
        ;;
    esac
  done < "$config_env"
}

load_existing_telegram_values() {
  EXISTING_TELEGRAM_BOT_TOKEN=""
  EXISTING_TELEGRAM_CHAT_ID=""

  if [[ ! -f "$telegram_config" ]]; then
    return 0
  fi

  EXISTING_TELEGRAM_BOT_TOKEN="$(sed -n '/"botToken"/{s/.*"botToken"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p;q;}' "$telegram_config")"
  EXISTING_TELEGRAM_CHAT_ID="$(sed -n '/"chatId"/{s/.*"chatId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p;q;}' "$telegram_config")"
}

prompt_value() {
  local prompt="$1"
  local default_value="${2:-}"
  local value

  while true; do
    if [[ -n "$default_value" ]]; then
      printf "%s [%s]: " "$prompt" "$default_value" >&2
    else
      printf "%s: " "$prompt" >&2
    fi

    IFS= read -r value
    if [[ -z "$value" ]]; then
      value="$default_value"
    fi

    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return
    fi

    WARN "$prompt cannot be empty."
  done
}

prompt_file_path() {
  local prompt="$1"
  local default_value="${2:-}"
  local value

  while true; do
    if [[ -n "$default_value" ]]; then
      printf "%s [%s]: " "$prompt" "$default_value" >&2
    else
      printf "%s: " "$prompt" >&2
    fi

    IFS= read -r value
    if [[ -z "$value" ]]; then
      value="$default_value"
    fi

    if [[ -z "$value" ]]; then
      WARN "$prompt cannot be empty."
      continue
    fi

    if [[ -f "$value" ]]; then
      printf '%s' "$value"
      return
    fi

    WARN "File '$value' was not found."
  done
}

prompt_secret() {
  local prompt="$1"
  local default_value="${2:-}"
  local value

  while true; do
    if [[ -n "$default_value" ]]; then
      printf "%s [press Enter to keep current]: " "$prompt" >&2
    else
      printf "%s: " "$prompt" >&2
    fi

    IFS= read -rs value
    printf "\n" >&2

    if [[ -z "$value" ]]; then
      value="$default_value"
    fi

    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return
    fi

    WARN "$prompt cannot be empty."
  done
}

prompt_optional_secret() {
  local prompt="$1"
  local default_value="${2:-}"
  local value

  while true; do
    if [[ -n "$default_value" ]]; then
      printf "%s [press Enter to keep current, type - to clear]: " "$prompt" >&2
    else
      printf "%s [leave blank to skip]: " "$prompt" >&2
    fi

    IFS= read -rs value
    printf "\n" >&2

    if [[ -z "$value" ]]; then
      printf '%s' "$default_value"
      return
    fi

    if [[ "$value" == "-" ]]; then
      printf ''
      return
    fi

    printf '%s' "$value"
    return
  done
}

prompt_yes_no() {
  local prompt="$1"
  local default_answer="${2:-N}"
  local value

  while true; do
    if [[ "$default_answer" == "Y" ]]; then
      printf "%s [Y/n]: " "$prompt" >&2
    else
      printf "%s [y/N]: " "$prompt" >&2
    fi

    IFS= read -r value
    if [[ -z "$value" ]]; then
      value="$default_answer"
    fi

    case "$value" in
      Y|y|yes|YES)
        return 0
        ;;
      N|n|no|NO)
        return 1
        ;;
      *)
        WARN "Please answer yes or no."
        ;;
    esac
  done
}

write_config_env() {
  local brave_api_key="$1"
  local opencode_server_password="$2"
  local escaped_key
  local escaped_password
  local tmp_file

  escaped_key="$(escape_sed_replacement "$brave_api_key")"
  escaped_password="$(escape_sed_replacement "$opencode_server_password")"
  tmp_file="$(mktemp)"
  sed \
    -e "s|__BRAVE_API_KEY__|$escaped_key|g" \
    -e "s|__OPENCODE_SERVER_PASSWORD__|$escaped_password|g" \
    "$config_template" > "$tmp_file"
  mv "$tmp_file" "$config_env"
  chmod 600 "$config_env"
}

write_telegram_config() {
  local bot_token="$1"
  local chat_id="$2"
  local escaped_bot_token
  local escaped_chat_id
  local tmp_file

  escaped_bot_token="$(escape_sed_replacement "$bot_token")"
  escaped_chat_id="$(escape_sed_replacement "$chat_id")"
  tmp_file="$(mktemp)"
  sed \
    -e "s|__BOT_TOKEN__|$escaped_bot_token|g" \
    -e "s|__CHAT_ID__|$escaped_chat_id|g" \
    "$telegram_template" > "$tmp_file"
  mv "$tmp_file" "$telegram_config"
  chmod 600 "$telegram_config"
}

stage_google_drive_oauth_credentials() {
  local source_path="$1"

  if [[ -f "$google_drive_oauth_credentials" && "$source_path" -ef "$google_drive_oauth_credentials" ]]; then
    chmod 600 "$google_drive_oauth_credentials"
    return
  fi

  install -m 600 "$source_path" "$google_drive_oauth_credentials"
}

configure_brave_container() {
  local brave_api_key="$1"

  if docker_cmd ps -a --format '{{.Names}}' | grep -wq "$brave_container"; then
    INFO "Removing existing $brave_container container"
    docker_cmd rm -f "$brave_container" >/dev/null
  fi

  INFO "Creating $brave_container"
  docker_cmd run -d \
    --name "$brave_container" \
    --restart unless-stopped \
    -p 9999:8080 \
    -e BRAVE_API_KEY="$brave_api_key" \
    -e BRAVE_MCP_TRANSPORT="http" \
    -e BRAVE_MCP_ENABLED_TOOLS="brave_web_search" \
    -e BRAVE_MCP_LOG_LEVEL="debug" \
    mcp/brave-search:latest >/dev/null
}

main() {
  local brave_api_key
  local google_drive_oauth_credentials_source
  local opencode_server_password
  local telegram_bot_token
  local telegram_chat_id

  require_command docker
  require_command opencode
  require_file "$config_template"
  require_file "$telegram_template"
  mkdir -p "$opencode_dir"

  load_existing_config_values
  load_existing_telegram_values
  if [[ -f "$google_drive_oauth_credentials" ]]; then
    EXISTING_GOOGLE_DRIVE_OAUTH_CREDENTIALS="$google_drive_oauth_credentials"
  fi

  INFO "Updating opencode-assistant configuration"
  brave_api_key="$(prompt_secret "Brave Search API key" "$EXISTING_BRAVE_API_KEY")"
  opencode_server_password="$(prompt_optional_secret "OpenCode server password" "$EXISTING_OPENCODE_SERVER_PASSWORD")"
  google_drive_oauth_credentials_source="$(prompt_file_path "Google Drive OAuth credentials JSON path" "$EXISTING_GOOGLE_DRIVE_OAUTH_CREDENTIALS")"
  telegram_bot_token="$(prompt_secret "Telegram bot token" "$EXISTING_TELEGRAM_BOT_TOKEN")"
  telegram_chat_id="$(prompt_value "Telegram chat ID" "$EXISTING_TELEGRAM_CHAT_ID")"

  write_config_env "$brave_api_key" "$opencode_server_password"
  INFO "Wrote $config_env"

  stage_google_drive_oauth_credentials "$google_drive_oauth_credentials_source"
  INFO "Staged Google Drive OAuth credentials at $google_drive_oauth_credentials"

  write_telegram_config "$telegram_bot_token" "$telegram_chat_id"
  INFO "Wrote $telegram_config"

  configure_brave_container "$brave_api_key"
  INFO "$brave_container is configured and running"

  IMAP_MCP_DIR="${HOME_DIR}/imap-mcp-server"
  if [[ -d "$IMAP_MCP_DIR" ]] && [[ -f "$IMAP_MCP_DIR/dist/index.js" ]]; then
    if prompt_yes_no "Launch IMAP email account setup wizard? (port 9998)" "N"; then
      INFO "Starting IMAP setup wizard at http://localhost:9998"
      INFO "Press Ctrl+C in the wizard terminal when done adding accounts."
      (cd "$IMAP_MCP_DIR" && npx tsx src/setup.ts --skip-claude --port 9998)
    fi
  else
    WARN "imap-mcp-server not found at $IMAP_MCP_DIR. Run ./install.sh first."
  fi

  INFO "Current OpenCode provider status"
  opencode providers list

  if prompt_yes_no "Run OpenCode provider login now?" "N"; then
    opencode providers login
  fi

  # Antigravity CLI (agy) Google OAuth setup
  if command -v agy >/dev/null 2>&1 || [ -x "${HOME:-~}/.local/bin/agy" ]; then
    if prompt_yes_no "Run Antigravity CLI (agy) Google OAuth sign-in? (opens browser)" "N"; then
      INFO "Launching Antigravity CLI for Google OAuth sign-in"
      INFO "Complete the sign-in in the browser, then press Ctrl+C in the agy TUI to exit."
      INFO "Alternatively, you can sign in manually later by running: agy"
      agy || true
      INFO "Antigravity CLI sign-in completed (or skipped)."
    fi
  else
    WARN "Antigravity CLI (agy) not found. Run ./install.sh first to install it."
  fi

  verify_script="$root/start.sh"
  if command -v tmux >/dev/null 2>&1 && tmux has-session -t "opencode-assistant-backend" 2>/dev/null; then
    WARN "OpenCode backend is already running. Restart is required for server password changes to take effect."
    verify_script="$root/restart.sh"
  fi

  if prompt_yes_no "Run ./$(basename "$verify_script") to apply and verify the setup now?" "Y"; then
    "$verify_script"
  fi

  if [[ -n "$opencode_server_password" ]]; then
    INFO "If OpenCode server password is configured, the web UI login username is 'opencode'."
  fi

  INFO "Configuration updated. Re-run ./config.sh any time you need to change these settings."
}

main "$@"
