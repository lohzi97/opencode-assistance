#!/usr/bin/env bash

set -euo pipefail

backend="opencode-assistant-backend"
worker="opencode-assistant-cron"

if command -v tmux >/dev/null 2>&1; then
  tmux kill-session -t "$worker" 2>/dev/null || true
  tmux kill-session -t "$backend" 2>/dev/null || true
fi
