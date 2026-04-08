#!/usr/bin/env bash
set -euo pipefail

# Idempotent installer for Linux Mint / Ubuntu (apt-based)
# - Installs bun, opencode (global), nvm + Node LTS, Google Chrome, Docker engine
# - Runs brave-search MCP Docker container (if BRAVE_API_KEY provided)
# - Creates sudoers entry to allow running opencode with NOPASSWD
# Usage:
#   BRAVE_API_KEY=your_key ./install.sh
#   or run interactively and you'll be prompted for missing values

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
HOME_DIR="${HOME:-/home/${USER_NAME}}"

APT_UPDATED=0
apt_update_if_needed() {
  if [ "$APT_UPDATED" -eq 0 ]; then
    INFO "Running apt-get update"
    sudo apt-get update -y
    APT_UPDATED=1
  fi
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
  apt_install curl wget ca-certificates gnupg lsb-release software-properties-common
}

install_bun() {
  if command -v bun >/dev/null 2>&1; then
    INFO "bun already in PATH: $(command -v bun)"
    return
  fi
  if [ -x "${HOME_DIR}/.bun/bin/bun" ]; then
    INFO "Found bun at ${HOME_DIR}/.bun/bin/bun; adding to PATH for this run"
    export PATH="${HOME_DIR}/.bun/bin:${PATH}"
    return
  fi
  INFO "Installing bun for current user"
  # bun installer installs to $HOME/.bun by default
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${HOME_DIR}/.bun"
  export PATH="${BUN_INSTALL}/bin:${PATH}"
  INFO "bun installed to ${BUN_INSTALL}"
}

install_opencode() {
  if command -v opencode >/dev/null 2>&1; then
    INFO "opencode already installed at $(command -v opencode)"
    return
  fi
  if ! command -v bun >/dev/null 2>&1; then
    ERR "bun is required to install opencode. Run the script again after bun is installed."
  fi
  INFO "Installing opencode (global) with bun"
  bun add -g opencode-ai
  if command -v opencode >/dev/null 2>&1; then
    INFO "opencode installed at $(command -v opencode)"
  else
    WARN "opencode installation finished but binary not found in PATH. It may be at ${HOME_DIR}/.bun/bin/opencode"
  fi
}

setup_sudoers_for_opencode() {
  SUDOERS_FILE="/etc/sudoers.d/opencode-assistant"
  if [ -f "$SUDOERS_FILE" ]; then
    INFO "Sudoers file $SUDOERS_FILE already exists, skipping"
    return
  fi
  OPENCODE_PATH="$(command -v opencode || true)"
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
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.6/install.sh | bash
  fi
  export NVM_DIR="${HOME_DIR}/.nvm"
  # shellcheck source=/dev/null
  [ -s "${NVM_DIR}/nvm.sh" ] && . "${NVM_DIR}/nvm.sh"
  if ! command -v nvm >/dev/null 2>&1; then
    WARN "nvm not available in this shell; you may need to restart the shell to use nvm"
  else
    if nvm ls --no-colors | grep -q "lts/"; then
      INFO "Node LTS already installed under nvm"
    else
      INFO "Installing latest Node LTS with nvm"
      nvm install --lts
      nvm alias default lts/*
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
    sudo apt-get remove -y docker docker-engine docker.io containerd runc || true
    apt_install ca-certificates curl gnupg lsb-release
    sudo install -m0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmour -o /etc/apt/keyrings/docker.gpg
    ARCH="$(dpkg --print-architecture)"
    UBUNTU_CODENAME="$(. /etc/os-release && echo "${UBUNTU_CODENAME}")"
    echo "deb [arch=${ARCH} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${UBUNTU_CODENAME} stable" | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
    apt_update_if_needed
    sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
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

run_brave_search_mcp_container() {
  if ! command -v docker >/dev/null 2>&1; then
    WARN "docker not found; skipping brave-search-mcp container"
    return
  fi
  if docker ps -a --format '{{.Names}}' | grep -wq brave-search-mcp; then
    if docker ps --format '{{.Names}}' | grep -wq brave-search-mcp; then
      INFO "brave-search-mcp container already running"
      return
    else
      INFO "Starting existing brave-search-mcp container"
      sudo docker start brave-search-mcp
      return
    fi
  fi
  # Get API key from env or prompt
  if [ -z "${BRAVE_API_KEY:-}" ]; then
    read -r -p "Brave Search API key (leave empty to skip container creation): " BRAVE_API_KEY
  fi
  if [ -z "${BRAVE_API_KEY:-}" ]; then
    INFO "No BRAVE_API_KEY provided; not creating brave-search-mcp container"
    return
  fi
  INFO "Running brave-search-mcp Docker container (image: mcp/brave-search:latest)"
  sudo docker run -d \
    --name brave-search-mcp \
    --restart unless-stopped \
    -p 9999:8080 \
    -e BRAVE_API_KEY="${BRAVE_API_KEY}" \
    -e BRAVE_MCP_TRANSPORT="http" \
    -e BRAVE_MCP_ENABLED_TOOLS="brave_web_search" \
    -e BRAVE_MCP_LOG_LEVEL="debug" \
    mcp/brave-search:latest
  INFO "brave-search-mcp container started (port 9999)"
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
  install_nvm_and_node
  install_google_chrome
  install_docker_engine
  run_brave_search_mcp_container
  install_tmux
  INFO "All done. Some changes (docker group) may require you to re-login."
}

main "$@"
