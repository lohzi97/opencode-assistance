#!/usr/bin/env bash


# Requirement information from user:
# - mcps:
#   - brave-search: brave-search API key
# - plugins:
#   - telegram-ping: telegram bot token + chat id 

# Setup to run this opencode assistance in ubuntu
# 1. Intall bun 
#    - required to install opencode and file-check plugin
# 2. Install opencode with `bun add -g opencode-ai`
# 3. Grant opencode root level permission so that it can access the whole machine
# 4. Install uv / uvx
#    - required for computer-control mcp
# 5. Install node version manager (nvm)
# 6. Install latest node LTS version with nvm
#    - required for chrome-devtools mcp
# 7. Install google chrome
#    - required for chrome-devtools mcp
# 8. Install docker engine 
#    - https://docs.docker.com/engine/install/ubuntu/
#    - required for brave-search mcp
# 9. install tmux
#    - required for ./start.sh and ./stop.sh script

# 10. Install qmd (new)


set -euo pipefail

# Idempotent installer for Linux Mint / Ubuntu (apt-based)
# - Installs bun, opencode (global), qmd (global), uv/uvx, nvm + Node LTS, Google Chrome, Docker engine
# - Creates sudoers entry to allow running opencode with NOPASSWD
# Usage:
#   ./install.sh

INFO() { printf "==> %s\n" "$*"; }
WARN() { printf "!! %s\n" "$*" >&2; }
ERR() { printf "ERROR: %s\n" "$*" >&2; exit 1; }

if [ "$(uname -s)" != "Linux" ]; then
  ERR "This script targets Debian/Ubuntu based Linux (Linux Mint). Aborting."
fi

if ! command -v apt-get >/dev/null 2>&1; then
  ERR "apt-get not found. This script requires a Debian/Ubuntu based system."
fi

USER_NAME="${SUDO_USER:-$(whoami)}"
if [ -n "${SUDO_USER:-}" ]; then
  HOME_DIR="$(getent passwd "$SUDO_USER" | cut -d: -f6)"
else
  HOME_DIR="${HOME:-/home/${USER_NAME}}"
fi
HOME_DIR="${HOME_DIR:-/home/${USER_NAME}}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

run_as_user() {
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

APT_UPDATED=0
apt_update_if_needed() {
  if [ "$APT_UPDATED" -eq 0 ]; then
    INFO "Running apt-get update"
    sudo apt-get update -y
    APT_UPDATED=1
  fi
}
apt_mark_stale() {
  APT_UPDATED=0
}
apt_install() {
  apt_update_if_needed
  INFO "Installing: $*"
  sudo apt-get install -y "$@"
}

ensure_sudo() {
  if ! sudo -v >/dev/null 2>&1; then
    ERR "This installer requires sudo privileges. Please re-run as a user with sudo access."
  fi
}

install_prereqs() {
  apt_install curl wget unzip ca-certificates gnupg lsb-release software-properties-common
}

install_bun() {
  if user_has_command bun; then
    INFO "bun already in PATH: $(user_command_path bun)"
    return
  fi
  if [ -x "${HOME_DIR}/.bun/bin/bun" ]; then
    INFO "Found bun at ${HOME_DIR}/.bun/bin/bun; adding to PATH for this run"
    export PATH="${HOME_DIR}/.bun/bin:${PATH}"
    return
  fi
  INFO "Installing bun for current user"
  # bun installer installs to $HOME/.bun by default
  run_as_user env HOME="$HOME_DIR" bash -lc 'curl -fsSL https://bun.sh/install | bash'
  export BUN_INSTALL="${HOME_DIR}/.bun"
  export PATH="${BUN_INSTALL}/bin:${PATH}"
  INFO "bun installed to ${BUN_INSTALL}"
}

install_opencode() {
  if user_has_command opencode; then
    INFO "opencode already installed at $(user_command_path opencode)"
    return
  fi
  if ! user_has_command bun && [ ! -x "${HOME_DIR}/.bun/bin/bun" ]; then
    ERR "bun is required to install opencode. Run the script again after bun is installed."
  fi
  INFO "Installing opencode (global) with bun"
  run_as_user env HOME="$HOME_DIR" PATH="${HOME_DIR}/.bun/bin:${PATH}" bash -lc 'bun add -g opencode-ai'
  if user_has_command opencode; then
    INFO "opencode installed at $(user_command_path opencode)"
  else
    WARN "opencode installation finished but binary not found in PATH. It may be at ${HOME_DIR}/.bun/bin/opencode"
  fi
}

install_qmd() {
  if [ -x "${HOME_DIR}/.bun/bin/qmd" ]; then
    INFO "qmd already installed via bun at ${HOME_DIR}/.bun/bin/qmd"
    return
  fi
  if ! user_has_command bun && [ ! -x "${HOME_DIR}/.bun/bin/bun" ]; then
    ERR "bun is required to install qmd. Run the script again after bun is installed."
  fi
  if user_has_command qmd; then
    WARN "qmd already exists at $(user_command_path qmd); installing a bun-managed copy as well."
  fi
  INFO "Installing qmd (global) with bun"
  run_as_user env HOME="$HOME_DIR" PATH="${HOME_DIR}/.bun/bin:${PATH}" bash -lc 'bun add -g @tobilu/qmd'
  if [ -x "${HOME_DIR}/.bun/bin/qmd" ]; then
    INFO "qmd installed at ${HOME_DIR}/.bun/bin/qmd"
  else
    WARN "qmd installation finished but bun-managed binary not found at ${HOME_DIR}/.bun/bin/qmd"
  fi
}

setup_qmd() {
  local setup_script="${PROJECT_ROOT}/.opencode/scripts/qmd-setup.sh"

  if [ ! -f "$setup_script" ]; then
    ERR "Expected qmd setup script at '$setup_script' but it was not found."
  fi

  INFO "Configuring qmd index for this repository"
  run_as_user env HOME="$HOME_DIR" PATH="${HOME_DIR}/.bun/bin:${PATH}" bash "$setup_script"
}

install_uv() {
  if user_has_command uv && user_has_command uvx; then
    INFO "uv already in PATH: $(user_command_path uv)"
    INFO "uvx already in PATH: $(user_command_path uvx)"
    return
  fi
  if [ -x "${HOME_DIR}/.local/bin/uv" ] && [ -x "${HOME_DIR}/.local/bin/uvx" ]; then
    INFO "Found uv and uvx in ${HOME_DIR}/.local/bin; adding to PATH for this run"
    export PATH="${HOME_DIR}/.local/bin:${PATH}"
    return
  fi
  INFO "Installing uv for current user"
  run_as_user env HOME="$HOME_DIR" bash -lc 'curl -LsSf https://astral.sh/uv/install.sh | sh'
  export PATH="${HOME_DIR}/.local/bin:${PATH}"
  if user_has_command uv && user_has_command uvx; then
    INFO "uv installed at $(user_command_path uv)"
    INFO "uvx installed at $(user_command_path uvx)"
  else
    WARN "uv installation finished but uv/uvx were not found in PATH. They may be at ${HOME_DIR}/.local/bin/uv and ${HOME_DIR}/.local/bin/uvx"
  fi
}

setup_sudoers_for_opencode() {
  SUDOERS_FILE="/etc/sudoers.d/opencode-assistant"
  if [ -f "$SUDOERS_FILE" ]; then
    INFO "Sudoers file $SUDOERS_FILE already exists, skipping"
    return
  fi
  OPENCODE_PATH="$(user_command_path opencode)"
  if [ -z "$OPENCODE_PATH" ]; then
    OPENCODE_PATH="${HOME_DIR}/.bun/bin/opencode"
  fi
  if [ ! -x "$OPENCODE_PATH" ]; then
    WARN "opencode binary not found at '$OPENCODE_PATH'; skipping sudoers creation."
    return
  fi
  INFO "Creating sudoers file to allow '$USER_NAME' to run opencode without a password"
  echo "$USER_NAME ALL=(ALL) NOPASSWD: $OPENCODE_PATH" | sudo tee "$SUDOERS_FILE" >/dev/null
  sudo chmod 0440 "$SUDOERS_FILE"
  INFO "Created $SUDOERS_FILE"
}

install_nvm_and_node() {
  if [ -s "${HOME_DIR}/.nvm/nvm.sh" ]; then
    INFO "nvm already installed"
  else
    INFO "Installing nvm"
    run_as_user env HOME="$HOME_DIR" bash -lc 'curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash'
  fi
  if ! run_as_user env HOME="$HOME_DIR" bash -lc 'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; command -v nvm >/dev/null 2>&1'; then
    WARN "nvm not available in this shell; you may need to restart the shell to use nvm"
  else
    if run_as_user env HOME="$HOME_DIR" bash -lc 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm ls --no-colors | grep -q "lts/"'; then
      INFO "Node LTS already installed under nvm"
    else
      INFO "Installing latest Node LTS with nvm"
      run_as_user env HOME="$HOME_DIR" bash -lc 'export NVM_DIR="$HOME/.nvm"; . "$NVM_DIR/nvm.sh"; nvm install --lts && nvm alias default lts/*'
    fi
  fi
}

install_google_chrome() {
  if command -v google-chrome >/dev/null 2>&1 || dpkg -s google-chrome-stable >/dev/null 2>&1; then
    INFO "Google Chrome already installed, skipping"
    return
  fi
  INFO "Installing Google Chrome"
  TMP_DEB="/tmp/google-chrome-stable_current_amd64.deb"
  wget -q -O "$TMP_DEB" "https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb"
  # Try apt-get install local deb; fallback to dpkg + fix deps
  if ! sudo apt-get install -y "$TMP_DEB"; then
    sudo dpkg -i "$TMP_DEB" || true
    apt_update_if_needed
    sudo apt-get install -f -y
  fi
  rm -f "$TMP_DEB"
  INFO "Google Chrome installation (attempted)"
}

install_docker_engine() {
  if command -v docker >/dev/null 2>&1; then
    INFO "Docker already installed, skipping"
  else
    INFO "Installing Docker Engine"
    sudo apt-get remove -y docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc || true
    apt_install ca-certificates curl gnupg lsb-release
    sudo install -m 0755 -d /etc/apt/keyrings
    sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    sudo chmod a+r /etc/apt/keyrings/docker.asc
    ARCH="$(dpkg --print-architecture)"
    UBUNTU_CODENAME="$(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")"
    cat <<EOF | sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${UBUNTU_CODENAME}
Components: stable
Architectures: ${ARCH}
Signed-By: /etc/apt/keyrings/docker.asc
EOF
    apt_mark_stale
    apt_update_if_needed
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  fi
  # Ensure the user is in the docker group
  if groups "$USER_NAME" | grep -qw docker; then
    INFO "User $USER_NAME is already in the docker group"
  else
    INFO "Adding $USER_NAME to docker group"
    sudo groupadd docker || true
    sudo usermod -aG docker "$USER_NAME"
    WARN "User $USER_NAME was added to the docker group. Log out and log back in for the change to take effect."
  fi
}

install_tmux() {
  if command -v tmux >/dev/null 2>&1; then
    INFO "tmux already installed"
    return
  fi
  apt_install tmux
}

main() {
  ensure_sudo
  install_prereqs
  install_bun
  install_opencode
  setup_sudoers_for_opencode
  install_uv
  install_nvm_and_node
  install_google_chrome
  install_docker_engine
  install_tmux
  install_qmd
  setup_qmd
  INFO "All done. Please log out and log back in before using Docker without sudo."
}

main "$@"
