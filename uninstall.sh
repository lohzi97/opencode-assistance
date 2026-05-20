#!/usr/bin/env bash
set -euo pipefail

# Idempotent uninstaller for components installed by install.sh
# - Stops and removes brave-search-mcp container + image
# - Stops and removes the repo-managed Steel Browser container and official Steel CLI install
# - Removes opencode and qmd (installed by bun), bun runtime, and uv/uvx
# - Removes Docker engine packages and related apt sources
# - Removes tmux and sudoers entry created for opencode
# Usage:
#   ./uninstall.sh            # interactive
#   ./uninstall.sh -y         # non-interactive (assume yes)
#   FORCE=yes ./uninstall.sh  # same as -y

INFO() { printf "==> %s\n" "$*"; }
WARN() { printf "!! %s\n" "$*" >&2; }
ERR() { printf "ERROR: %s\n" "$*" >&2; exit 1; }

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
  HOME_DIR="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
else
  HOME_DIR="${HOME:-/home/${USER_NAME}}"
fi
HOME_DIR="${HOME_DIR:-/home/${USER_NAME}}"
STEEL_DIR="${HOME_DIR}/.steel"
STEEL_BIN="${STEEL_DIR}/bin/steel"

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

INFO "This script will attempt to undo changes made by install.sh for user '$USER_NAME' (home: $HOME_DIR)."
cat <<EOF
Planned actions:
- Stop & remove 'brave-search-mcp' docker container (if present) and remove its image
- Stop & remove repo-managed 'opencode-assistant-steel-browser' docker container (if present)
- Remove the official Steel CLI install under ~/.steel and related shell integration
- Remove opencode (bun package) and related sudoers file /etc/sudoers.d/opencode-assistant
- Remove qmd (bun package) and qmd cache/config data under ~/.cache/qmd and ~/.config/qmd
- Remove per-user bun (~/.bun) and uv directories and their shell boot lines
- Leave nvm and Node untouched
- Purge Docker Engine packages and remove Docker apt source + keyring (will NOT remove /var/lib/docker by default)
- Purge tmux

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

# 1b) Repo-managed Steel Browser container
if command -v docker >/dev/null 2>&1; then
  if sudo docker ps -a --format '{{.Names}}' | grep -wq opencode-assistant-steel-browser; then
    INFO "Stopping opencode-assistant-steel-browser container (if running)"
    sudo docker stop opencode-assistant-steel-browser >/dev/null 2>&1 || true
    INFO "Removing opencode-assistant-steel-browser container"
    sudo docker rm opencode-assistant-steel-browser >/dev/null 2>&1 || true
  else
    INFO "No opencode-assistant-steel-browser container found"
  fi
else
  INFO "Docker not found; skipping repo-managed Steel Browser container removal"
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

# 4) Remove qmd (bun global) and qmd binary if it's inside $HOME_DIR
if user_has_command bun || [ -x "${HOME_DIR}/.bun/bin/bun" ]; then
  INFO "Attempting to remove qmd via bun"
  run_as_user env HOME="$HOME_DIR" PATH="$HOME_DIR/.bun/bin:$PATH" bash -lc 'bun remove -g @tobilu/qmd >/dev/null 2>&1 || true'
else
  INFO "bun not available; looking for qmd binary"
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

# Helper: safely remove a directory only if it exists and is owned by the target user
safe_remove_user_dir() {
  local dir="$1"
  if [ -d "$dir" ]; then
    # Determine owner (GNU stat)
    local owner
    owner=$(stat -c %U "$dir" 2>/dev/null || true)
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
  if [ -f "$file" ]; then
    local owner
    owner=$(stat -c %U "$file" 2>/dev/null || true)
    if [ "$owner" = "$USER_NAME" ] || [ -z "$owner" ]; then
      INFO "Removing $file"
      if [ -n "${SUDO_USER:-}" ] && command -v sudo >/dev/null 2>&1; then
        sudo -u "$USER_NAME" rm -f "$file" || true
      else
        rm -f "$file" || true
      fi
    else
      WARN "File $file is owned by '$owner' not '$USER_NAME'; skipping to avoid removing other user's data"
    fi
  else
    INFO "File $file not present; skipping"
  fi
}

# 5) Remove qmd cache and config
safe_remove_user_dir "$HOME_DIR/.cache/qmd"
safe_remove_user_dir "$HOME_DIR/.config/qmd"

# 6) Remove official Steel CLI install and related shell integration
if [ -x "$STEEL_BIN" ]; then
  INFO "Removing official Steel CLI install at $STEEL_DIR"
else
  INFO "Official Steel CLI install not found at $STEEL_DIR; removing any remaining repo-managed Steel shell integration"
fi
safe_remove_user_dir "$STEEL_DIR"
safe_remove_user_file "$HOME_DIR/.local/share/bash-completion/completions/steel"
safe_remove_user_file "$HOME_DIR/.zsh/completions/_steel"
safe_remove_user_file "$HOME_DIR/.config/fish/completions/steel.fish"
safe_remove_user_file "$HOME_DIR/.config/fish/conf.d/steel.fish"

# 7) Remove bun runtime (~/.bun)
safe_remove_user_dir "$HOME_DIR/.bun"

# 8) Remove uv executables and data
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

# 9) Remove installer lines from common shell files (leave backups *.bak)
SHELL_FILES=("$HOME_DIR/.profile" "$HOME_DIR/.bashrc" "$HOME_DIR/.bash_profile" "$HOME_DIR/.zshrc")
SED_SCRIPT=( -e '/BUN_INSTALL/d' -e '/\\.bun/d' -e '/\\.steel\/bin/d' -e '/# >>> steel completions >>>/,/# <<< steel completions <<</d' -e '/\\.local\/bin\/env/d' -e '/\\.local\/bin\/env\.fish/d' -e '/uv\.env\.fish/d' -e '/uv generate-shell-completion/d' -e '/uvx --generate-shell-completion/d' )
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

# 10) Remove Docker Engine packages and apt sources/keyring
if command -v docker >/dev/null 2>&1 || dpkg -s docker-ce >/dev/null 2>&1 || dpkg -s docker.io >/dev/null 2>&1; then
  INFO "Stopping Docker service (if running)"
  sudo systemctl stop docker >/dev/null 2>&1 || true
  INFO "Removing Docker Engine packages"
  sudo apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin docker-ce-rootless-extras docker-engine docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc || true
  sudo apt-get autoremove -y || true
  sudo apt-get autoclean -y || true
else
  INFO "Docker packages not present (by name); attempting to clean Docker apt source/keyring"
fi

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

# 11) Remove tmux
if command -v tmux >/dev/null 2>&1 || dpkg -s tmux >/dev/null 2>&1; then
  INFO "Purging tmux"
  sudo apt-get purge -y tmux || true
  sudo apt-get autoremove -y || true
else
  INFO "tmux not installed; skipping"
fi

INFO "Final apt-get autoremove/autoclean to tidy packages"
sudo apt-get autoremove -y || true
sudo apt-get autoclean -y || true

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
