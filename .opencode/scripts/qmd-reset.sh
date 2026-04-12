#!/usr/bin/env bash
# qmd-reset.sh — Remove all qmd state for this project (nuclear).
# Deletes the config YAML, SQLite index, and cached models.
#
# Usage:
#   bash .opencode/scripts/qmd-reset.sh
#
# After running, re-initialise with:
#   bash .opencode/scripts/qmd-setup.sh

set -euo pipefail

QMD_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/qmd"
QMD_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/qmd"
INDEX="sebastian"

removed=0

echo "==> This will remove:"
echo "    - Config:  $QMD_CONFIG/ (all index configs)"
echo "    - Cache:   $QMD_CACHE/ (indexes, models, ~2 GB)"
read -rp "    Continue? [y/N] " confirm
if [[ "$confirm" != [yY] ]]; then
  echo "Aborted."
  exit 1
fi

if [[ -d "$QMD_CONFIG" ]]; then
  rm -rf "$QMD_CONFIG"
  echo "==> Removed $QMD_CONFIG"
  removed=1
fi

if [[ -d "$QMD_CACHE" ]]; then
  rm -rf "$QMD_CACHE"
  echo "==> Removed $QMD_CACHE"
  removed=1
fi

if [[ "$removed" -eq 0 ]]; then
  echo "Nothing to remove — no qmd state found."
else
  echo ""
  echo "Reset complete. Re-run qmd-setup.sh to initialise a fresh index."
fi
