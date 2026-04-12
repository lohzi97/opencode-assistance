#!/usr/bin/env bash

set -euo pipefail

backend="opencode-assistant-backend"
worker="opencode-assistant-cron"
brave_container="brave-search-mcp"

docker_cmd() {
  if docker info >/dev/null 2>&1; then
    docker "$@"
  else
    sudo docker "$@"
  fi
}

if command -v tmux >/dev/null 2>&1; then
  tmux kill-session -t "$worker" 2>/dev/null || true
  tmux kill-session -t "$backend" 2>/dev/null || true
fi

if command -v docker >/dev/null 2>&1; then
  docker_cmd stop "$brave_container" >/dev/null 2>&1 || true
fi
