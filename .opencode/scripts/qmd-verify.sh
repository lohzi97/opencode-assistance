#!/usr/bin/env bash
# qmd-verify.sh — Verify the forked qmd runtime is active.
#
# Can be sourced (provides verify_qmd function) or run directly.
#
# Usage:
#   bash .opencode/scripts/qmd-verify.sh          # standalone check
#   source .opencode/scripts/qmd-verify.sh         # source for verify_qmd()

QMD_FORK_REPO="git@github.com:lohzi97/qmd.git"
QMD_FORK_LOCAL="/home/lohzi/Projects/qmd"

verify_qmd() {
  if ! command -v qmd &>/dev/null; then
    echo "ERROR: qmd is not installed or not on PATH." >&2
    echo "Remediation: install from the fork:" >&2
    echo "  cd $QMD_FORK_LOCAL && npm install -g ." >&2
    return 1
  fi

  local version
  version="$(qmd --version 2>/dev/null)" || true

  # The upstream @tobilu/qmd is at 2.1.x; the fork is 2.5.x+.
  # Check that the version string contains a commit hash in parens,
  # which indicates a source install rather than a published package.
  if [[ "$version" =~ ^qmd\ [0-9]+\.[0-9]+\.[0-9]+\ \([a-f0-9]+\) ]]; then
    echo "qmd verified: $version"
    return 0
  fi

  echo "ERROR: qmd runtime does not appear to be the forked build." >&2
  echo "  Current: $version" >&2
  echo "  Expected: forked build from $QMD_FORK_REPO (version 2.5.x+ with commit hash)" >&2
  echo "Remediation:" >&2
  echo "  cd $QMD_FORK_LOCAL && npm install -g ." >&2
  return 1
}

# When run directly, perform verification
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  verify_qmd
fi
