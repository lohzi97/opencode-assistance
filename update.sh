#!/usr/bin/env bash

# Update opencode-assistance dependencies (companion to install.sh).
#
# install.sh creates the environment; update.sh refreshes it:
#   - system packages (apt/brew upgrade, incl. Docker, Chrome, tmux)
#   - self-updating tools (bun, uv, Node LTS via nvm, Antigravity CLI)
#   - bun global packages (opencode-ai, agent-tui, @openchamber/web)
#   - git-cloned repos (MCP servers, camofox-browser, qmd fork)
#
# Usage:
#   ./update.sh --status              Read-only report: current vs latest.
#   ./update.sh                       Update everything.
#   ./update.sh --skip-apt            Skip system package upgrade.
#   ./update.sh --skip-tools          Skip bun/uv/node/agy self-updaters.
#   ./update.sh --skip-globals        Skip bun global packages.
#   ./update.sh --skip-repos          Skip git repository updates.
#   ./update.sh --skip-openchamber    Skip @openchamber/web only.
#   ./update.sh --openchamber 1.12.0  Pin @openchamber/web to a version.
#
# Notes:
#   - Never restarts the running stack; opencode/MCP changes take effect on
#     the next ./restart.sh (running processes keep their old binaries).
#   - --status reads cached apt metadata (no sudo). Update mode runs
#     apt-get update first, so candidates are refreshed there.
#   - --status exit codes: 0 = everything current, 10 = updates available.

set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/platform.sh
source "${PROJECT_ROOT}/lib/platform.sh"

INFO() { printf "==> %s\n" "$*"; }
WARN() { printf "!! %s\n" "$*" >&2; }
ERR() { printf "ERROR: %s\n" "$*" >&2; exit 1; }

MODE="update"
SKIP_APT=0
SKIP_TOOLS=0
SKIP_GLOBALS=0
SKIP_REPOS=0
SKIP_OPENCHAMBER=0
OPENCHAMBER_VERSION=""

usage() {
  sed -n '3,27p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --status) MODE="status" ;;
    --skip-apt) SKIP_APT=1 ;;
    --skip-tools) SKIP_TOOLS=1 ;;
    --skip-globals) SKIP_GLOBALS=1 ;;
    --skip-repos) SKIP_REPOS=1 ;;
    --skip-openchamber) SKIP_OPENCHAMBER=1 ;;
    --openchamber)
      [ "$#" -ge 2 ] || ERR "--openchamber requires a version argument"
      OPENCHAMBER_VERSION="$2"
      shift
      ;;
    -h|--help) usage; exit 0 ;;
    *) ERR "Unknown option: $1 (see --help)" ;;
  esac
  shift
done

[ "$(os_family)" = "unknown" ] && ERR "Unsupported platform: $(uname -s)"

if [ "$(id -u)" -eq 0 ]; then
  ERR "Run as your normal user; sudo is invoked internally for apt/brew."
fi

HOME_DIR="${HOME:?Cannot determine HOME directory}"
export PATH="${HOME_DIR}/.bun/bin:${HOME_DIR}/.local/bin:${PATH}"

# Make nvm-managed node/npm visible to non-login shells.
NVM_DIR="${HOME_DIR}/.nvm"
if [ -s "${NVM_DIR}/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "${NVM_DIR}/nvm.sh" >/dev/null 2>&1 || true
fi

ensure_sudo() {
  if ! sudo -v >/dev/null 2>&1; then
    ERR "This mode requires sudo privileges for system package updates."
  fi
}

# ---------------------------------------------------------------------------
# Component registry
# ---------------------------------------------------------------------------

GLOBAL_PKGS=(opencode-ai agent-tui)
OPENCHAMBER_PKG="@openchamber/web"

REPO_NAMES=(qmd computer-control-mcp vision-mcp google-workspace-mcp camofox-browser imap-mcp-server)
REPO_DIRS=(
  "${HOME_DIR}/qmd"
  "${PROJECT_ROOT}/../computer-control-mcp"
  "${HOME_DIR}/vision-mcp"
  "${PROJECT_ROOT}/../google_workspace_mcp"
  "${PROJECT_ROOT}/../camofox-browser"
  "${HOME_DIR}/imap-mcp-server"
)

APT_PKGS=(tmux docker-ce google-chrome-stable rclone)

# Generated lockfiles that installers rewrite; safe to restore before a pull.
GENERATED_LOCKFILES=(uv.lock package-lock.json bun.lock bun.lockb)

# ---------------------------------------------------------------------------
# Version helpers
# ---------------------------------------------------------------------------

# Latest version of an npm package from the registry ("?" on failure).
registry_latest() {
  npm view "$1" version 2>/dev/null || echo "?"
}

# Installed version of a bun global package ("" when absent).
global_installed() {
  local pkg="$1"
  bun pm ls -g 2>/dev/null | grep -F -- "${pkg}@" | sed 's/.*@//' | head -n 1
}

# Short human-readable identifier for a git repo's HEAD.
repo_head_label() {
  git -C "$1" describe --tags --always 2>/dev/null \
    || git -C "$1" rev-parse --short HEAD 2>/dev/null \
    || echo "?"
}

repo_fetch() {
  git -C "$1" fetch --quiet >/dev/null 2>&1 || \
    WARN "Failed to fetch $1 (network?); showing stale data"
}

# Commits HEAD is behind/upstream of its tracking branch ("?" when no upstream).
repo_behind() {
  git -C "$1" rev-list --count "HEAD..@{u}" 2>/dev/null || echo "?"
}

repo_ahead() {
  git -C "$1" rev-list --count "@{u}..HEAD" 2>/dev/null || echo "?"
}

repo_dirty_count() {
  git -C "$1" status --porcelain 2>/dev/null | wc -l | tr -d ' '
}

# Best-effort latest release tag for bun from GitHub ("?" on failure).
bun_latest() {
  curl -fsS --max-time 10 https://api.github.com/repos/oven-sh/bun/releases/latest 2>/dev/null \
    | grep -o '"tag_name": *"[^"]*"' | head -n 1 | sed 's/.*"tag_name": *"//; s/"$//; s/^bun-v//' \
    || echo "?"
}

# Best-effort latest version for uv from PyPI ("?" on failure).
uv_latest() {
  curl -fsS --max-time 10 https://pypi.org/pypi/uv/json 2>/dev/null \
    | grep -o '"version":"[^"]*"' | head -n 1 | sed 's/"version":"//; s/"//' \
    || echo "?"
}

apt_installed() {
  dpkg-query -W -f '${Version}' "$1" 2>/dev/null || echo ""
}

apt_candidate() {
  apt-cache policy "$1" 2>/dev/null | awk '/^  Candidate:/ {print $2}' | head -n 1
}

# ---------------------------------------------------------------------------
# Status mode
# ---------------------------------------------------------------------------

UPDATES_AVAILABLE=0
mark_update() {
  UPDATES_AVAILABLE=$((UPDATES_AVAILABLE + 1))
}

print_status() {
  local idx name dir cur latest behind ahead dirty upstream_label
  local inst cand pkg_ver

  printf "opencode-assistance dependency status (%s)\n" "$(date +%Y%m%d%H%M%S)"
  printf '%s\n' "============================================================"

  printf '\nBun global packages (npm registry)\n'
  for pkg_ver in "${GLOBAL_PKGS[@]}" "${OPENCHAMBER_PKG}"; do
    cur="$(global_installed "$pkg_ver")"
    [ -n "$cur" ] || cur="not installed"
    latest="$(registry_latest "$pkg_ver")"
    if [ "$latest" != "?" ] && [ "$cur" != "$latest" ]; then
      printf '  %-22s %-16s -> %-14s [UPDATE]\n' "$pkg_ver" "$cur" "$latest"
      mark_update
    else
      printf '  %-22s %-16s\n' "$pkg_ver" "$cur"
    fi
  done
  # qmd fork is installed from a local path, not the registry.
  cur="$(global_installed "@tobilu/qmd")"
  printf '  %-22s %-16s (local fork %s)\n' "@tobilu/qmd" "${cur:-not installed}" "$(repo_head_label "${REPO_DIRS[0]}")"

  printf '\nGit repositories (vs upstream)\n'
  for idx in "${!REPO_NAMES[@]}"; do
    name="${REPO_NAMES[$idx]}"
    dir="${REPO_DIRS[$idx]}"
    if [ ! -d "${dir}/.git" ]; then
      printf '  %-22s not cloned (run ./install.sh)\n' "$name"
      continue
    fi
    repo_fetch "$dir"
    cur="$(repo_head_label "$dir")"
    behind="$(repo_behind "$dir")"
    ahead="$(repo_ahead "$dir")"
    dirty="$(repo_dirty_count "$dir")"
    if [ "$behind" = "?" ]; then
      printf '  %-22s %-16s (no upstream tracking branch)\n' "$name" "$cur"
      continue
    fi
    if [ "$behind" -gt 0 ]; then
      upstream_label="$(git -C "$dir" describe --tags --always "$(git -C "$dir" rev-parse "@{u}" 2>/dev/null)" 2>/dev/null || echo "@{u}")"
      printf '  %-22s %-16s behind %-4s -> %s [UPDATE]\n' "$name" "$cur" "$behind" "$upstream_label"
      mark_update
    else
      printf '  %-22s %-16s\n' "$name" "$cur"
    fi
    [ "$ahead" -gt 0 ] && printf '  %-22s   !! %s local commit(s) ahead of upstream; ff-only update will be skipped\n' "" "$ahead"
    [ "$dirty" -gt 0 ] && printf '  %-22s   !! %s uncommitted change(s) in worktree\n' "" "$dirty"
  done

  printf '\nSelf-updating tools\n'
  cur="$(bun --version 2>/dev/null || echo '?')"
  latest="$(bun_latest)"
  if [ "$latest" != "?" ] && [ "$cur" != "$latest" ]; then
    printf '  %-22s %-16s -> %-14s [UPDATE via bun upgrade]\n' "bun" "$cur" "$latest"
    mark_update
  else
    printf '  %-22s %-16s\n' "bun" "$cur"
  fi
  cur="$(uv --version 2>/dev/null | awk '{print $2}' || echo '?')"
  latest="$(uv_latest)"
  if [ "$latest" != "?" ] && [ "$cur" != "$latest" ]; then
    printf '  %-22s %-16s -> %-14s [UPDATE via uv self update]\n' "uv" "$cur" "$latest"
    mark_update
  else
    printf '  %-22s %-16s\n' "uv" "$cur"
  fi
  printf '  %-22s %-16s (nvm install --lts on update)\n' "node" "$(node --version 2>/dev/null || echo '?')"
  printf '  %-22s %-16s (agy update on update)\n' "agy" "$(agy --version 2>/dev/null || echo '?')"

  printf '\nSystem packages (apt, cached indexes - refresh happens on update)\n'
  for pkg_ver in "${APT_PKGS[@]}"; do
    inst="$(apt_installed "$pkg_ver")"
    if [ -z "$inst" ]; then
      printf '  %-22s not installed\n' "$pkg_ver"
      continue
    fi
    cand="$(apt_candidate "$pkg_ver")"
    if [ -n "$cand" ] && [ "$cand" != "(none)" ] && [ "$inst" != "$cand" ]; then
      printf '  %-22s %-16s -> %-14s [UPDATE]\n' "$pkg_ver" "$inst" "$cand"
      mark_update
    else
      printf '  %-22s %-16s\n' "$pkg_ver" "$inst"
    fi
  done

  printf '\nRuntime-fetched (always latest; nothing to update)\n'
  printf '  chrome-devtools-mcp (npx chrome-devtools-mcp@latest per session)\n'

  printf '\nSUMMARY: %s component(s) have updates available\n' "$UPDATES_AVAILABLE"
}

# ---------------------------------------------------------------------------
# Update mode
# ---------------------------------------------------------------------------

FAILED_STEPS=()
record_failure() {
  FAILED_STEPS+=("$1")
  WARN "Step failed: $1 (continuing with remaining updates)"
}

restore_generated_lockfiles() {
  # Restore generated lockfiles when they are the ONLY local changes, so a
  # fast-forward pull is not blocked. Returns 1 if other changes exist.
  local dir="$1" line file other=0
  while IFS= read -r line; do
    [ -z "$line" ] && continue
    file="$(printf '%s' "$line" | cut -c4-)"
    case "$file" in
      uv.lock|package-lock.json|bun.lock|bun.lockb) ;;
      *) other=1 ;;
    esac
  done < <(git -C "$dir" status --porcelain 2>/dev/null)
  [ "$other" -eq 0 ] || return 1
  local lock
  for lock in "${GENERATED_LOCKFILES[@]}"; do
    git -C "$dir" checkout -- "$lock" >/dev/null 2>&1 || true
  done
}

repo_install_deps() {
  local name="$1" dir="$2"
  case "$name" in
    qmd)
      INFO "Reinstalling qmd global from updated fork"
      bun add -g "$dir"
      ;;
    computer-control-mcp|google-workspace-mcp)
      INFO "Syncing $name dependencies (uv sync)"
      (cd "$dir" && uv sync)
      ;;
    camofox-browser)
      INFO "Installing $name dependencies (npm install)"
      (cd "$dir" && npm install)
      ;;
    imap-mcp-server|vision-mcp)
      INFO "Installing $name dependencies (npm install && npm run build)"
      (cd "$dir" && npm install && npm run build)
      ;;
    *)
      WARN "No dependency step defined for $name"
      ;;
  esac
}

update_system() {
  if is_mac; then
    INFO "Updating Homebrew packages"
    brew update && brew upgrade || record_failure "brew upgrade"
    return
  fi
  ensure_sudo
  INFO "Refreshing apt indexes"
  sudo apt-get update -y || { record_failure "apt-get update"; return; }
  INFO "Upgrading system packages (a Docker upgrade may restart containers)"
  sudo apt-get upgrade -y || record_failure "apt-get upgrade"
}

update_tools() {
  INFO "Upgrading bun"
  bun upgrade || record_failure "bun upgrade"
  INFO "Upgrading uv"
  uv self update || record_failure "uv self update"
  INFO "Upgrading Node LTS via nvm"
  (cd "$HOME_DIR" && bash -c '
    export NVM_DIR="$HOME/.nvm"
    [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
    nvm install --lts && nvm alias default lts/*
  ') || record_failure "nvm node LTS"
  INFO "Upgrading Antigravity CLI"
  agy update || record_failure "agy update"
}

update_globals() {
  local pkg latest cur to_install=()
  for pkg in "${GLOBAL_PKGS[@]}"; do
    cur="$(global_installed "$pkg")"
    latest="$(registry_latest "$pkg")"
    if [ "$latest" != "?" ] && [ "$cur" = "$latest" ]; then
      INFO "$pkg already at latest ($cur)"
      continue
    fi
    to_install+=("${pkg}@latest")
  done
  if [ "${#to_install[@]}" -gt 0 ]; then
    INFO "Updating bun globals: ${to_install[*]}"
    bun add -g "${to_install[@]}" || record_failure "bun add -g ${to_install[*]}"
  fi

  if [ "$SKIP_OPENCHAMBER" -eq 1 ]; then
    INFO "Skipping @openchamber/web (--skip-openchamber)"
    return
  fi
  cur="$(global_installed "$OPENCHAMBER_PKG")"
  if [ -n "$OPENCHAMBER_VERSION" ]; then
    INFO "Pinning @openchamber/web to $OPENCHAMBER_VERSION"
    bun add -g "${OPENCHAMBER_PKG}@${OPENCHAMBER_VERSION}" || record_failure "openchamber pin"
    return
  fi
  latest="$(registry_latest "$OPENCHAMBER_PKG")"
  if [ "$latest" != "?" ] && [ "$cur" = "$latest" ]; then
    INFO "@openchamber/web already at latest ($cur)"
    return
  fi
  INFO "Updating @openchamber/web: ${cur:-not installed} -> $latest"
  bun add -g "${OPENCHAMBER_PKG}@latest" || record_failure "openchamber update"
}

update_repos() {
  local idx name dir behind ahead
  for idx in "${!REPO_NAMES[@]}"; do
    name="${REPO_NAMES[$idx]}"
    dir="${REPO_DIRS[$idx]}"
    if [ ! -d "${dir}/.git" ]; then
      WARN "$name not cloned at $dir; skipping (run ./install.sh)"
      continue
    fi
    repo_fetch "$dir"
    behind="$(repo_behind "$dir")"
    if [ "$behind" = "?" ]; then
      WARN "$name has no upstream tracking branch; skipping"
      continue
    fi
    if [ "$behind" -eq 0 ]; then
      INFO "$name already current ($(repo_head_label "$dir"))"
      continue
    fi
    ahead="$(repo_ahead "$dir")"
    if [ "$ahead" -gt 0 ]; then
      WARN "$name is $ahead commit(s) ahead of upstream; skipping (needs manual merge)"
      continue
    fi
    if ! restore_generated_lockfiles "$dir"; then
      WARN "$name has non-generated local changes; skipping to avoid conflicts"
      continue
    fi
    INFO "Updating $name ($behind commit(s) behind)"
    if git -C "$dir" pull --ff-only; then
      repo_install_deps "$name" "$dir" || record_failure "$name dependencies"
    else
      record_failure "$name git pull"
    fi
  done
}

print_update_summary() {
  printf '\n============================================================\n'
  if [ "${#FAILED_STEPS[@]}" -eq 0 ]; then
    INFO "Update complete. Verify with ./update.sh --status"
  else
    WARN "Update finished with ${#FAILED_STEPS[@]} failed step(s):"
    local step
    for step in "${FAILED_STEPS[@]}"; do
      WARN "- $step"
    done
  fi
  INFO "Running stack keeps old binaries; run ./restart.sh for opencode/MCP/openchamber changes to take effect."
}

main() {
  if [ "$MODE" = "status" ]; then
    print_status
    [ "$UPDATES_AVAILABLE" -eq 0 ] && exit 0
    exit 10
  fi

  if [ "$SKIP_APT" -eq 0 ]; then
    INFO "Phase 1/4: system packages"
    update_system
  else
    INFO "Phase 1/4: system packages (skipped)"
  fi
  if [ "$SKIP_TOOLS" -eq 0 ]; then
    INFO "Phase 2/4: self-updating tools"
    update_tools
  else
    INFO "Phase 2/4: self-updating tools (skipped)"
  fi
  if [ "$SKIP_GLOBALS" -eq 0 ]; then
    INFO "Phase 3/4: bun global packages"
    update_globals
  else
    INFO "Phase 3/4: bun global packages (skipped)"
  fi
  if [ "$SKIP_REPOS" -eq 0 ]; then
    INFO "Phase 4/4: git repositories"
    update_repos
  else
    INFO "Phase 4/4: git repositories (skipped)"
  fi
  print_update_summary
}

main
