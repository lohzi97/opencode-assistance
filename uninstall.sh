#!/usr/bin/env bash
set -euo pipefail

# Idempotent uninstaller for components installed by install.sh
# - Stops and removes brave-search-mcp container + image
# - Removes opencode, qmd, agent-tui (installed by bun), bun runtime, uv/uvx, nvm, Node (nvm-managed)
# - Removes Google Chrome, Docker engine packages and related apt sources
# - Removes tmux, rclone, sqlite3, and sudoers entry created for opencode
# - Removes Antigravity CLI (agy) binary and config directories
# - Removes camofox-browser checkout, Camofox profile/cache data, VNC log files, and VNC packages
# Usage:
#   ./uninstall.sh            # interactive
#   ./uninstall.sh -y         # non-interactive (assume yes)
#   FORCE=yes ./uninstall.sh  # same as -y

INFO() { printf "==> %s\n" "$*"; }
WARN() { printf "!! %s\n" "$*" >&2; }
ERR() { printf "ERROR: %s\n" "$*" >&2; exit 1; }

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/platform.sh
source "${PROJECT_ROOT}/lib/platform.sh"

AUTO_YES=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    -y|--yes) AUTO_YES=1; shift ;;
    -f|--force) AUTO_YES=1; shift ;;
    *) shift ;;
  esac
done
if [ "${FORCE:-}" = "yes" ] 2>/dev/null; then AUTO_YES=1; fi

# Determine the real user and their home directory. If run under sudo, act on SUDO_USER.
USER_NAME="${SUDO_USER:-$(whoami)}"
if [ -n "${SUDO_USER:-}" ]; then
  HOME_DIR="$(user_home_dir "$SUDO_USER")"
else
  HOME_DIR="${HOME:-}"
fi
HOME_DIR="${HOME_DIR:-$(default_home_prefix "$USER_NAME")}"

confirm() {
  local prompt="${1:-Proceed?}"
  if [ "$AUTO_YES" -eq 1 ]; then
    INFO "AUTO: $prompt"
    return 0
  fi
  read -r -p "$prompt [y/N] " ans
  case "$ans" in
    [yY]|[yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

run_as_user() {
  # Run command as the original non-root user if available. Usage: run_as_user cmd args...
  if [ -n "${SUDO_USER:-}" ] && command -v sudo >/dev/null 2>&1; then
    sudo -H -u "$USER_NAME" "$@"
  else
    "$@"
  fi
}

user_has_command() {
  run_as_user bash -lc "command -v \"$1\" >/dev/null 2>&1"
}

user_command_path() {
  run_as_user bash -lc "command -v \"$1\" 2>/dev/null || true"
}

# Helper: safely remove a directory only if it exists and is owned by the target user
safe_remove_user_dir() {
  local dir="$1"
  if [ -d "$dir" ]; then
    # Determine owner (GNU stat on Linux, BSD stat on macOS)
    local owner
    owner=$(stat_owner "$dir")
    if [ "$owner" = "$USER_NAME" ] || [ -z "$owner" ]; then
      INFO "Removing $dir"
      if [ -n "${SUDO_USER:-}" ] && command -v sudo >/dev/null 2>&1; then
        sudo -u "$USER_NAME" rm -rf "$dir" || true
      else
        rm -rf "$dir" || true
      fi
    else
      WARN "Directory $dir is owned by '$owner' not '$USER_NAME'; skipping to avoid removing other user's data"
    fi
  else
    INFO "Directory $dir not present; skipping"
  fi
}

safe_remove_user_file() {
  local file="$1"
  if [ -e "$file" ]; then
    local owner
    owner=$(stat_owner "$file")
    if [ "$owner" = "$USER_NAME" ] || [ -z "$owner" ]; then
      INFO "Removing $file"
      sudo rm -f "$file" || true
    else
      WARN "File $file is owned by '$owner' not '$USER_NAME'; skipping to avoid removing other user's data"
    fi
  else
    INFO "File $file not present; skipping"
  fi
}

INFO "This script will attempt to undo changes made by install.sh for user '$USER_NAME' (home: $HOME_DIR) on $(os_family)."
cat <<EOF
Planned actions:
- Stop & remove 'brave-search-mcp' docker container (if present) and remove its image
- Remove opencode (bun package) and related sudoers file /etc/sudoers.d/opencode-assistant
- Remove qmd (npm/bun global install) and qmd cache/config data under ~/.cache/qmd and ~/.config/qmd
- Remove qmd fork repo at ~/qmd
- Remove computer-control-mcp fork repo at ../computer-control-mcp
- Remove agent-tui (bun package) and agent-tui state data under ~/.agent-tui
- Remove Antigravity CLI binary (~/.local/bin/agy) and config/data under ~/.antigravitycli
- Remove OpenChamber (bun package or binary) and config/data under ~/.config/openchamber
- Remove per-user bun (~/.bun), uv, and nvm (~/.nvm) directories and their shell boot lines
- Remove camofox-browser repo at ../camofox-browser, ~/.camofox profile data, ~/.cache/camoufox browser cache, and local VNC log files
- Linux only: purge Camofox VNC packages (xvfb, x11vnc, novnc, python3-websockify, net-tools)
- Remove Google Chrome (Linux: apt purge; macOS: brew cask uninstall or remove app bundle)
- Remove Docker (Linux: apt purge + source/keyring cleanup + docker group; macOS: brew cask or manual)
- Remove tmux (Linux: apt purge; macOS: brew uninstall)
- Remove rclone and sqlite3 backup dependencies (Linux: apt purge; macOS: brew uninstall)
- Remove imap-mcp-server repo at ~/imap-mcp-server and its config at ~/.imap-mcp
- Remove vision-mcp fork repo at ~/vision-mcp

You can skip confirmations by running with '-y' or setting FORCE=yes in the environment.
EOF

if ! confirm "Continue with uninstall?"; then
  INFO "Aborted by user. No changes made."
  exit 0
fi

# 1) Brave search MCP container
if command -v docker >/dev/null 2>&1; then
  if sudo docker ps -a --format '{{.Names}}' | grep -wq brave-search-mcp; then
    INFO "Stopping brave-search-mcp container (if running)"
    sudo docker stop brave-search-mcp >/dev/null 2>&1 || true
    INFO "Removing brave-search-mcp container"
    sudo docker rm brave-search-mcp >/dev/null 2>&1 || true
  else
    INFO "No brave-search-mcp container found"
  fi

  # Remove image if present
  IMG_ID="$(sudo docker images -q mcp/brave-search:latest 2>/dev/null || true)"
  if [ -n "$IMG_ID" ]; then
    INFO "Removing Docker image mcp/brave-search:latest"
    sudo docker rmi -f "$IMG_ID" >/dev/null 2>&1 || true
  else
    INFO "No mcp/brave-search:latest image found"
  fi
else
  INFO "Docker not found; skipping brave-search-mcp removal"
fi

# 2) Remove opencode (bun global) and opencode binary if it's inside $HOME_DIR
if user_has_command bun || [ -x "${HOME_DIR}/.bun/bin/bun" ]; then
  INFO "Attempting to remove opencode via bun"
  run_as_user env HOME="$HOME_DIR" PATH="$HOME_DIR/.bun/bin:$PATH" bash -lc 'bun remove -g opencode-ai >/dev/null 2>&1 || true'
else
  INFO "bun not available; looking for opencode binary"
fi

OPENCODE_BIN="$(user_command_path opencode)"
if [ -z "$OPENCODE_BIN" ] && [ -x "${HOME_DIR}/.bun/bin/opencode" ]; then
  OPENCODE_BIN="${HOME_DIR}/.bun/bin/opencode"
fi
if [ -n "$OPENCODE_BIN" ]; then
  if echo "$OPENCODE_BIN" | grep -q "$HOME_DIR"; then
    INFO "Removing opencode binary at $OPENCODE_BIN"
    sudo rm -f "$OPENCODE_BIN" || true
  else
    WARN "Found opencode at $OPENCODE_BIN which is outside $HOME_DIR; leaving it untouched."
    INFO "If you want it removed, run: sudo rm -f $OPENCODE_BIN"
  fi
else
  INFO "No opencode binary found in PATH"
fi

# 3) Remove sudoers entry created for opencode
SUDOERS_FILE="/etc/sudoers.d/opencode-assistant"
if [ -f "$SUDOERS_FILE" ]; then
  INFO "Removing sudoers file $SUDOERS_FILE"
  sudo rm -f "$SUDOERS_FILE" || true
else
  INFO "Sudoers entry not present; skipping"
fi

# 4) Remove qmd global install, cloned fork repo, and qmd binary
if command -v npm >/dev/null 2>&1; then
  INFO "Attempting to remove qmd via npm"
  run_as_user npm uninstall -g qmd >/dev/null 2>&1 || true
elif user_has_command bun || [ -x "${HOME_DIR}/.bun/bin/bun" ]; then
  INFO "Attempting to remove qmd via bun"
  run_as_user env HOME="$HOME_DIR" PATH="$HOME_DIR/.bun/bin:$PATH" bash -lc 'bun remove -g qmd >/dev/null 2>&1 || true'
else
  INFO "Neither npm nor bun available; looking for qmd binary"
fi

QMD_BIN="$(user_command_path qmd)"
if [ -z "$QMD_BIN" ] && [ -x "${HOME_DIR}/.bun/bin/qmd" ]; then
  QMD_BIN="${HOME_DIR}/.bun/bin/qmd"
fi
if [ -n "$QMD_BIN" ]; then
  if echo "$QMD_BIN" | grep -q "$HOME_DIR"; then
    INFO "Removing qmd binary at $QMD_BIN"
    sudo rm -f "$QMD_BIN" || true
  else
    WARN "Found qmd at $QMD_BIN which is outside $HOME_DIR; leaving it untouched."
    INFO "If you want it removed, run: sudo rm -f $QMD_BIN"
  fi
else
  INFO "No qmd binary found in PATH"
fi

QMD_FORK_DIR="${HOME_DIR}/qmd"
safe_remove_user_dir "$QMD_FORK_DIR"

# 5) Remove qmd cache and config
safe_remove_user_dir "$HOME_DIR/.cache/qmd"
safe_remove_user_dir "$HOME_DIR/.config/qmd"

# 5b) Remove agent-tui (bun global) and state data
if user_has_command bun || [ -x "${HOME_DIR}/.bun/bin/bun" ]; then
  INFO "Attempting to remove agent-tui via bun"
  run_as_user env HOME="$HOME_DIR" PATH="$HOME_DIR/.bun/bin:$PATH" bash -lc 'bun remove -g agent-tui >/dev/null 2>&1 || true'
else
  INFO "bun not available; looking for agent-tui binary"
fi

AGENT_TUI_BIN="$(user_command_path agent-tui)"
if [ -z "$AGENT_TUI_BIN" ] && [ -x "${HOME_DIR}/.bun/bin/agent-tui" ]; then
  AGENT_TUI_BIN="${HOME_DIR}/.bun/bin/agent-tui"
fi
if [ -n "$AGENT_TUI_BIN" ]; then
  if echo "$AGENT_TUI_BIN" | grep -q "$HOME_DIR"; then
    INFO "Removing agent-tui binary at $AGENT_TUI_BIN"
    sudo rm -f "$AGENT_TUI_BIN" || true
  else
    WARN "Found agent-tui at $AGENT_TUI_BIN which is outside $HOME_DIR; leaving it untouched."
    INFO "If you want it removed, run: sudo rm -f $AGENT_TUI_BIN"
  fi
else
  INFO "No agent-tui binary found in PATH"
fi

safe_remove_user_dir "$HOME_DIR/.agent-tui"

# 5c) Remove Antigravity CLI (agy) binary and config
AGY_BIN="${HOME_DIR}/.local/bin/agy"
if [ -x "$AGY_BIN" ]; then
  INFO "Removing Antigravity CLI binary at $AGY_BIN"
  if [ -n "${SUDO_USER:-}" ] && command -v sudo >/dev/null 2>&1; then
    sudo -u "$USER_NAME" rm -f "$AGY_BIN" || true
  else
    rm -f "$AGY_BIN" || true
  fi
else
  INFO "Antigravity CLI binary not found at $AGY_BIN"
fi

safe_remove_user_dir "$HOME_DIR/.antigravitycli"

# 5d) Remove OpenChamber (bun global) and config
if user_has_command bun || [ -x "${HOME_DIR}/.bun/bin/bun" ]; then
  INFO "Attempting to remove OpenChamber via bun"
  run_as_user env HOME="$HOME_DIR" PATH="$HOME_DIR/.bun/bin:$PATH" bash -lc 'bun remove -g @openchamber/web >/dev/null 2>&1 || true'
else
  INFO "bun not available; looking for OpenChamber binary"
fi

OPENCHAMBER_BIN="$(user_command_path openchamber)"
if [ -z "$OPENCHAMBER_BIN" ] && [ -x "${HOME_DIR}/.bun/bin/openchamber" ]; then
  OPENCHAMBER_BIN="${HOME_DIR}/.bun/bin/openchamber"
fi
if [ -n "$OPENCHAMBER_BIN" ]; then
  if echo "$OPENCHAMBER_BIN" | grep -q "$HOME_DIR"; then
    INFO "Removing OpenChamber binary at $OPENCHAMBER_BIN"
    sudo rm -f "$OPENCHAMBER_BIN" || true
  else
    WARN "Found OpenChamber at $OPENCHAMBER_BIN which is outside $HOME_DIR; leaving it untouched."
    INFO "If you want it removed, run: sudo rm -f $OPENCHAMBER_BIN"
  fi
else
  INFO "No OpenChamber binary found in PATH"
fi

safe_remove_user_dir "$HOME_DIR/.config/openchamber"

# 6) Remove bun runtime (~/.bun)
safe_remove_user_dir "$HOME_DIR/.bun"

# 7) Remove uv executables and data
UV_BIN_DIR="${XDG_BIN_HOME:-${HOME_DIR}/.local/bin}"
for uv_bin in "$UV_BIN_DIR/uv" "$UV_BIN_DIR/uvx" "$UV_BIN_DIR/uvw"; do
  if [ -e "$uv_bin" ]; then
    INFO "Removing $uv_bin"
    if [ -n "${SUDO_USER:-}" ] && command -v sudo >/dev/null 2>&1; then
      sudo -u "$USER_NAME" rm -f "$uv_bin" || true
    else
      rm -f "$uv_bin" || true
    fi
  fi
done
safe_remove_user_dir "$HOME_DIR/.cache/uv"
safe_remove_user_dir "$HOME_DIR/.local/share/uv"
safe_remove_user_dir "$HOME_DIR/.config/uv"

# 8) Remove nvm (~/.nvm)
safe_remove_user_dir "$HOME_DIR/.nvm"

# 9) Remove installer lines from common shell files (leave backups *.bak)
SHELL_FILES=("$HOME_DIR/.profile" "$HOME_DIR/.bashrc" "$HOME_DIR/.bash_profile" "$HOME_DIR/.zshrc")
SED_SCRIPT=( -e '/BUN_INSTALL/d' -e '/\\.bun/d' -e '/NVM_DIR/d' -e '/nvm.sh/d' -e '/nvm/d' -e '/\\.local\/bin\/env/d' -e '/\\.local\/bin\/env\.fish/d' -e '/uv\.env\.fish/d' -e '/uv generate-shell-completion/d' -e '/uvx --generate-shell-completion/d' )
for f in "${SHELL_FILES[@]}"; do
  if [ -f "$f" ]; then
    INFO "Cleaning installer lines from $f (backup -> ${f}.bak)"
    if [ -n "${SUDO_USER:-}" ] && command -v sudo >/dev/null 2>&1; then
      sudo -u "$USER_NAME" sed -i.bak "${SED_SCRIPT[@]}" "$f" || true
    else
      sed -i.bak "${SED_SCRIPT[@]}" "$f" || true
    fi
  fi
done

# 10) Remove Google Chrome
if is_mac; then
  if chrome_is_installed; then
    INFO "Removing Google Chrome (macOS app + brew cask if applicable)"
    # If installed via Homebrew cask, uninstall it cleanly; otherwise remove the app bundle.
    if command -v brew >/dev/null 2>&1 && brew list --cask google-chrome >/dev/null 2>&1; then
      run_as_user brew uninstall --cask google-chrome || true
    else
      sudo rm -rf "/Applications/Google Chrome.app" || true
    fi
  else
    INFO "Google Chrome not found on macOS; skipping"
  fi
elif dpkg -s google-chrome-stable >/dev/null 2>&1; then
  INFO "Purging google-chrome-stable"
  sudo apt-get purge -y google-chrome-stable || true
  sudo apt-get autoremove -y || true
  sudo apt-get autoclean -y || true
else
  INFO "Google Chrome not installed via apt; skipping"
fi

# 11) Remove Docker
if is_mac; then
  if docker_installed; then
    INFO "Stopping Docker Desktop (if running)"
    stop_docker_service
    if command -v brew >/dev/null 2>&1 && brew list --cask docker >/dev/null 2>&1; then
      INFO "Uninstalling Docker Desktop via brew cask"
      run_as_user brew uninstall --cask docker || true
    else
      WARN "Docker found at $(command -v docker); if installed outside Homebrew, remove Docker.app manually from /Applications"
    fi
  else
    INFO "Docker not found on macOS; skipping"
  fi
  INFO "Note: Docker Desktop data lives under ~/Library/Containers/com.docker.docker and is NOT removed by this script."
elif command -v docker >/dev/null 2>&1 || dpkg -s docker-ce >/dev/null 2>&1 || dpkg -s docker.io >/dev/null 2>&1; then
  INFO "Stopping Docker service (if running)"
  sudo systemctl stop docker >/dev/null 2>&1 || true
  INFO "Removing Docker Engine packages"
  sudo apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras docker-engine docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc || true
  sudo apt-get autoremove -y || true
  sudo apt-get autoclean -y || true
else
  INFO "Docker packages not present (by name); attempting to clean Docker apt source/keyring"
fi

if ! is_mac; then
  if [ -f /etc/apt/keyrings/docker.asc ]; then
    INFO "Removing /etc/apt/keyrings/docker.asc"
    sudo rm -f /etc/apt/keyrings/docker.asc || true
  fi
  if [ -f /etc/apt/keyrings/docker.gpg ]; then
    INFO "Removing legacy /etc/apt/keyrings/docker.gpg"
    sudo rm -f /etc/apt/keyrings/docker.gpg || true
  fi
  if [ -f /etc/apt/sources.list.d/docker.sources ]; then
    INFO "Removing /etc/apt/sources.list.d/docker.sources"
    sudo rm -f /etc/apt/sources.list.d/docker.sources || true
  fi
  if [ -f /etc/apt/sources.list.d/docker.list ]; then
    INFO "Removing legacy /etc/apt/sources.list.d/docker.list"
    sudo rm -f /etc/apt/sources.list.d/docker.list || true
  fi

  # Remove user from docker group and delete the group if empty
  if getent group docker >/dev/null 2>&1; then
    INFO "Removing user $USER_NAME from docker group (if present)"
    sudo gpasswd -d "$USER_NAME" docker >/dev/null 2>&1 || true
    # Check group members
    members=$(getent group docker | cut -d: -f4 || true)
    if [ -z "$members" ]; then
      INFO "Docker group is now empty; removing group"
      sudo groupdel docker >/dev/null 2>&1 || true
    else
      INFO "Docker group still has members: $members; not deleting group"
    fi
  else
    INFO "Docker group not present; skipping"
  fi

  INFO "Note: this script does NOT remove Docker data directories (eg. /var/lib/docker). If you want to delete Docker data, run: sudo rm -rf /var/lib/docker /var/lib/containerd"
fi

# 12) Remove tmux
if is_mac; then
  if command -v tmux >/dev/null 2>&1 && command -v brew >/dev/null 2>&1 && brew list tmux >/dev/null 2>&1; then
    INFO "Uninstalling tmux via brew"
    run_as_user brew uninstall tmux || true
  else
    INFO "tmux not installed via brew on macOS (or brew unavailable); skipping"
  fi
elif command -v tmux >/dev/null 2>&1 || dpkg -s tmux >/dev/null 2>&1; then
  INFO "Purging tmux"
  sudo apt-get purge -y tmux || true
  sudo apt-get autoremove -y || true
else
  INFO "tmux not installed; skipping"
fi

# 12b) Remove backup dependencies installed by install.sh
if is_mac; then
  if command -v brew >/dev/null 2>&1; then
    for pkg in rclone sqlite3; do
      if brew list "$pkg" >/dev/null 2>&1; then
        INFO "Uninstalling $pkg via brew"
        run_as_user brew uninstall "$pkg" || true
      else
        INFO "$pkg not installed via brew; skipping"
      fi
    done
  else
    INFO "brew not available on macOS; cannot uninstall rclone/sqlite3"
  fi
else
  if command -v rclone >/dev/null 2>&1 || dpkg -s rclone >/dev/null 2>&1; then
    INFO "Purging rclone"
    sudo apt-get purge -y rclone || true
  else
    INFO "rclone not installed via apt or PATH; skipping"
  fi

  if command -v sqlite3 >/dev/null 2>&1 || dpkg -s sqlite3 >/dev/null 2>&1; then
    INFO "Purging sqlite3"
    sudo apt-get purge -y sqlite3 || true
  else
    INFO "sqlite3 not installed via apt or PATH; skipping"
  fi
fi

# 13) Remove imap-mcp-server repo and config
IMAP_MCP_DIR="${HOME_DIR}/imap-mcp-server"
safe_remove_user_dir "$IMAP_MCP_DIR"
safe_remove_user_dir "${HOME_DIR}/.imap-mcp"

# 13b) Remove vision-mcp fork repo
VISION_MCP_DIR="${HOME_DIR}/vision-mcp"
safe_remove_user_dir "$VISION_MCP_DIR"

# 13b) Remove computer-control-mcp fork repo
COMPUTER_CONTROL_MCP_DIR="${PROJECT_ROOT}/../computer-control-mcp"
safe_remove_user_dir "$COMPUTER_CONTROL_MCP_DIR"

# 13c) Remove camofox-browser checkout, profile/cache data, and local VNC log files
CAMOFOX_BROWSER_DIR="${PROJECT_ROOT}/../camofox-browser"
safe_remove_user_dir "$CAMOFOX_BROWSER_DIR"
safe_remove_user_dir "$HOME_DIR/.camofox"
safe_remove_user_dir "$HOME_DIR/.cache/camoufox"
safe_remove_user_dir "$HOME_DIR/.cache/camofox"
safe_remove_user_file /var/log/novnc.log
safe_remove_user_file /var/log/x11vnc.log

# 13d) Remove Camofox VNC packages installed by install.sh. Linux only; macOS does not install them.
if is_mac; then
  INFO "Skipping Camofox VNC package purge on macOS (packages were not installed)"
else
  INFO "Purging Camofox VNC packages"
  sudo apt-get purge -y xvfb x11vnc novnc python3-websockify net-tools || true

  INFO "Final apt-get autoremove/autoclean to tidy packages"
  sudo apt-get autoremove -y || true
  sudo apt-get autoclean -y || true
fi

if is_mac; then
  INFO "Running brew autoremove to tidy unneeded formulae"
  if command -v brew >/dev/null 2>&1; then
    run_as_user brew autoremove 2>/dev/null || true
  fi
fi

INFO "Uninstall complete."
INFO "Recommended manual follow-ups (if desired):"
cat <<EOF
- If you removed Docker but want to free disk space, consider removing /var/lib/docker and /var/lib/containerd (destructive):
  sudo rm -rf /var/lib/docker /var/lib/containerd
- Review shell startup files (${SHELL_FILES[*]}) for any remaining customizations and remove backups (*.bak) when satisfied.
- If an opencode or qmd binary remained outside your home directory, you may remove it manually (shown in the warnings above).
- Log out and back in if you changed group membership (docker) to apply changes.
EOF

exit 0
