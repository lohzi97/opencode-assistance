#!/usr/bin/env bash
# qmd-setup.sh — Idempotent setup for the opencode-assistant qmd index.
# Safe to re-run after a fresh clone or on an existing index.
#
# Usage:
#   bash .opencode/scripts/qmd-setup.sh

set -euo pipefail

INDEX="sebastian"
BASE_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$BASE_DIR"

# --- Helpers ---

has_collection() {
  qmd --index "$INDEX" collection list 2>/dev/null | grep -q "^${1} ("
}

has_context() {
  # context list prints collection names on their own line; check if the
  # collection header for a non-root context appears, or "  /" for root.
  if [[ "$1" == "/" ]]; then
    # root context sits under the "*" pseudo-collection
    qmd --index "$INDEX" context list 2>/dev/null | grep -q "^\*" || \
    qmd --index "$INDEX" context list 2>/dev/null | grep -q "^  / "
  else
    # extract collection name from qmd:// prefix, e.g. qmd://notes/ -> notes
    local coll="${1#qmd://}"
    coll="${coll%/}"
    qmd --index "$INDEX" context list 2>/dev/null | grep -q "^${coll}$"
  fi
}

# --- Preflight ---

if ! command -v qmd &>/dev/null; then
  echo "ERROR: qmd is not installed or not on PATH." >&2
  exit 1
fi

echo "==> qmd found: $(qmd --version)"

# --- Collections (sequential — parallel writes corrupt SQLite) ---

echo "==> Creating collections..."

if has_collection journals-daily; then
  echo "    journals-daily — already exists, skipping"
else
  qmd --index "$INDEX" collection add journals/daily --name journals-daily
  echo "    journals-daily — created"
fi

if has_collection journals-session; then
  echo "    journals-session — already exists, skipping"
else
  qmd --index "$INDEX" collection add journals/session --name journals-session
  echo "    journals-session — created"
fi

if has_collection notes; then
  echo "    notes — already exists, skipping"
else
  qmd --index "$INDEX" collection add notes --name notes
  echo "    notes — created"
fi

# --- Retrieval contexts ---

echo "==> Adding retrieval contexts..."

GLOBAL_CTX="Index for the opencode-assistant workspace. Prefer notes for durable guidance and remembered decisions, journals-daily for concise historical summaries, and journals-session for raw chronology, debugging trails, and exact prior exchanges."

if has_context "/"; then
  echo "    / — already exists, skipping"
else
  qmd --index "$INDEX" context add / "$GLOBAL_CTX"
  echo "    / — created"
fi

if has_context "qmd://journals-daily/"; then
  echo "    journals-daily context — already exists, skipping"
else
  qmd --index "$INDEX" context add qmd://journals-daily/ "Curated daily summaries of important work, decisions, and outcomes. Prefer this collection for concise project history."
  echo "    journals-daily context — created"
fi

if has_context "qmd://journals-session/"; then
  echo "    journals-session context — already exists, skipping"
else
  qmd --index "$INDEX" context add qmd://journals-session/ "Raw session transcripts and working logs. Use when tracing chronology, exact wording, or implementation details that may have been summarized later."
  echo "    journals-session context — created"
fi

if has_context "qmd://notes/"; then
  echo "    notes context — already exists, skipping"
else
  qmd --index "$INDEX" context add qmd://notes/ "Persistent notes, instructions, and durable project knowledge. Prefer for stable guidance and remembered facts."
  echo "    notes context — created"
fi

# --- Exclude session logs from default queries ---

echo "==> Excluding journals-session from default queries..."
qmd --index "$INDEX" collection exclude journals-session 2>/dev/null || true

# --- Embeddings ---

echo "==> Building embeddings (this may take several minutes on first run)..."
qmd --index "$INDEX" embed

# --- Verify ---

echo "==> Verifying final state..."
qmd --index "$INDEX" status

echo ""
echo "Setup complete."
