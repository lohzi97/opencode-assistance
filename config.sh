#!/usr/bin/env bash

set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
opencode_dir="$root/.opencode"
config_env="$opencode_dir/config.env"
config_template="$opencode_dir/config.env.example"
telegram_config="$opencode_dir/telegram-ping.jsonc"
telegram_template="$opencode_dir/telegram-ping-example.jsonc"
brave_container="brave-search-mcp"

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

load_existing_brave_api_key() {
  local line

  EXISTING_BRAVE_API_KEY=""
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
        return
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
  local escaped_key
  local tmp_file

  escaped_key="$(escape_sed_replacement "$brave_api_key")"
  tmp_file="$(mktemp)"
  sed "s|__BRAVE_API_KEY__|$escaped_key|g" "$config_template" > "$tmp_file"
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
  local telegram_bot_token
  local telegram_chat_id

  require_command docker
  require_command opencode
  require_file "$config_template"
  require_file "$telegram_template"
  mkdir -p "$opencode_dir"

  load_existing_brave_api_key
  load_existing_telegram_values

  INFO "Updating opencode-assistant configuration"
  brave_api_key="$(prompt_secret "Brave Search API key" "$EXISTING_BRAVE_API_KEY")"
  telegram_bot_token="$(prompt_secret "Telegram bot token" "$EXISTING_TELEGRAM_BOT_TOKEN")"
  telegram_chat_id="$(prompt_value "Telegram chat ID" "$EXISTING_TELEGRAM_CHAT_ID")"

  write_config_env "$brave_api_key"
  INFO "Wrote $config_env"

  write_telegram_config "$telegram_bot_token" "$telegram_chat_id"
  INFO "Wrote $telegram_config"

  configure_brave_container "$brave_api_key"
  INFO "$brave_container is configured and running"

  INFO "Current OpenCode provider status"
  opencode providers list

  if prompt_yes_no "Run OpenCode provider login now?" "N"; then
    opencode providers login
  fi

  if prompt_yes_no "Run ./start.sh --no-tui to verify the setup now?" "Y"; then
    "$root/start.sh" --no-tui
  fi

  INFO "Configuration updated. Re-run ./config.sh any time you need to change these settings."
}

main "$@"
