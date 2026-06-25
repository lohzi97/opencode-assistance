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
#    - required for computer-control mcp and forked Python MCP dependencies
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

# 10. Install google_workspace_mcp and forked computer-control-mcp Python MCP dependencies
# 11. Install qmd (new)
# 12. Install agent-tui (TUI automation for AI agents)
#    - required for antigravity-websearch skill
# 13. Install Antigravity CLI (agy)
#    - required for antigravity-websearch skill
# 14. Install rclone + sqlite3
#    - required for Google Drive backup and qmd SQLite snapshots
# 15. Install camofox-browser and VNC dependencies
#    - required for camofox-browser skill and ChatGPT research via noVNC login


set -euo pipefail

# Idempotent installer for Linux Mint / Ubuntu / WSL2 (apt-based) and macOS (Homebrew)
# - Installs bun, opencode (global), qmd (global), uv/uvx, nvm + Node LTS, Google Chrome, Docker engine
# - Installs rclone and sqlite3 for Google Drive backups
# - Creates sudoers entry to allow running opencode with NOPASSWD (Linux only)
# Usage:
#   ./install.sh

INFO() { printf "==> %s\n" "$*"; }
WARN() { printf "!! %s\n" "$*" >&2; }
ERR() { printf "ERROR: %s\n" "$*" >&2; exit 1; }

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/platform.sh
source "${PROJECT_ROOT}/lib/platform.sh"

INSTALL_WARNINGS=()
record_warning() {
  local message="$1"
  local existing
  for existing in "${INSTALL_WARNINGS[@]}"; do
    if [ "$existing" = "$message" ]; then
      return
    fi
  done
  INSTALL_WARNINGS+=("$message")
  WARN "$message"
}

print_warning_summary() {
  local message
  if [ "${#INSTALL_WARNINGS[@]}" -eq 0 ]; then
    return
  fi
  WARN "Installer completed with ${#INSTALL_WARNINGS[@]} warning(s):"
  for message in "${INSTALL_WARNINGS[@]}"; do
    WARN "- ${message}"
  done
}

if [ "$(os_family)" = "unknown" ]; then
  ERR "Unsupported platform: $(uname -s). Supported: Linux (Ubuntu/Mint), WSL2, macOS."
fi

case "$(os_family)" in
  linux|wsl)
    if ! command -v apt-get >/dev/null 2>&1; then
      ERR "apt-get not found. This script requires a Debian/Ubuntu based Linux (including WSL2)."
    fi
    ;;
  mac)
    : # macOS is supported; Homebrew is installed below if missing
    ;;
esac

USER_NAME="${SUDO_USER:-$(whoami)}"
if [ -n "${SUDO_USER:-}" ]; then
  HOME_DIR="$(user_home_dir "$SUDO_USER")"
else
  HOME_DIR="${HOME:-}"
fi
HOME_DIR="${HOME_DIR:-$(default_home_prefix "$USER_NAME")}"
USER_GROUP="$(id -gn "$USER_NAME")"

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
APT_LAST_UPDATE_PARTIAL=0
apt_update_if_needed() {
  local log_file
  if [ "$APT_UPDATED" -eq 0 ]; then
    INFO "Running apt-get update"
    log_file="$(mktemp)"
    if sudo apt-get update -y 2>&1 | tee "$log_file"; then
      :
    else
      rm -f "$log_file"
      ERR "apt-get update failed. Fix repository connectivity and rerun the installer."
    fi
    APT_LAST_UPDATE_PARTIAL=0
    if grep -Eq 'Failed to fetch|Some index files failed to download' "$log_file"; then
      APT_LAST_UPDATE_PARTIAL=1
      record_warning "apt-get update completed with repository fetch warnings. Some package metadata may be stale until mirror or network issues are fixed."
    fi
    rm -f "$log_file"
    APT_UPDATED=1
  fi
}
apt_mark_stale() {
  APT_UPDATED=0
}
apt_install() {
  apt_update_if_needed
  INFO "Installing: $*"
  if sudo apt-get install -y "$@"; then
    return
  fi
  if [ "$APT_LAST_UPDATE_PARTIAL" -eq 1 ]; then
    ERR "apt-get install failed after a partial apt-get update. Fix the repository connectivity issues above and rerun the installer."
  fi
  ERR "apt-get install failed while installing: $*"
}

ensure_sudo() {
  if ! sudo -v >/dev/null 2>&1; then
    ERR "This installer requires sudo privileges. Please re-run as a user with sudo access."
  fi
}

ensure_homebrew() {
  if ! is_mac; then
    return
  fi
  if command -v brew >/dev/null 2>&1; then
    return
  fi
  INFO "Installing Homebrew for current user (NONINTERACTIVE)"
  run_as_user env HOME="$HOME_DIR" bash -lc \
    'NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'

  # The Homebrew installer may not add the shellenv to user profiles on Apple Silicon.
  # Ensure at least one profile file sources brew shellenv so subsequent `run_as_user` shells see it.
  local brew_sh
  if [ -x /opt/homebrew/bin/brew ]; then
    brew_sh='eval "$(/opt/homebrew/bin/brew shellenv)"'
  elif [ -x /usr/local/bin/brew ]; then
    brew_sh='eval "$(/usr/local/bin/brew shellenv)"'
  else
    brew_sh=""
  fi

  if [ -n "$brew_sh" ]; then
    # Make brew visible to the current script process for any immediate checks
    eval "$brew_sh"
    local profile_file
    for profile_file in "$HOME_DIR/.zprofile" "$HOME_DIR/.profile"; do
      if [ -f "$profile_file" ] && grep -Fq '/bin/brew shellenv' "$profile_file"; then
        break
      fi
      INFO "Adding 'brew shellenv' to $profile_file"
      # Pass values via positional args to avoid quoting headaches with $brew_sh containing double quotes.
      run_as_user bash -c 'printf "\n%s\n" "$1" >> "$2"' _ "$brew_sh" "$profile_file"
    done
  fi

  if ! command -v brew >/dev/null 2>&1; then
    ERR "Homebrew installation did not add 'brew' to PATH. Open a new terminal (or follow https://brew.sh) and rerun ./install.sh."
  fi
}

brew_install() {
  if ! command -v brew >/dev/null 2>&1; then
    ERR "Homebrew is required but was not found. Install it from https://brew.sh and rerun."
  fi
  INFO "Installing via brew: $*"
  run_as_user brew install "$@"
}

install_prereqs() {
  if is_mac; then
    ensure_homebrew
    # macOS ships curl/unzip/gnupg; we only install the missing pieces.
    brew_install wget rclone sqlite3 gnupg ca-certificates
    return
  fi
  apt_install git curl wget unzip ca-certificates gnupg lsb-release software-properties-common python3-tk python3-dev rclone sqlite3
}

install_camofox_system_deps() {
  if is_mac; then
    INFO "Skipping apt-only Camofox VNC packages on macOS (use built-in Screen Sharing for remote access)"
    return
  fi
  apt_install xvfb x11vnc novnc python3-websockify net-tools procps
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

QMD_FORK_REPO="git@github.com:lohzi97/qmd.git"
QMD_FORK_DIR="${HOME_DIR}/qmd"

install_qmd() {
  # Verify the current global qmd is the forked build.
  if [ -x "${HOME_DIR}/.bun/bin/qmd" ]; then
    local version
    version="$("${HOME_DIR}/.bun/bin/qmd" --version 2>/dev/null)" || true
    if [[ "$version" =~ ^qmd\ [0-9]+\.[0-9]+\.[0-9]+\ \([a-f0-9]+\) ]]; then
      INFO "Forked qmd already installed: $version"
      return
    fi
    WARN "Existing qmd is not the forked build ($version); reinstalling from fork."
  fi

  if ! user_has_command bun && [ ! -x "${HOME_DIR}/.bun/bin/bun" ]; then
    ERR "bun is required to install qmd. Run the script again after bun is installed."
  fi

  # Clone or update the fork
  if [ ! -d "$QMD_FORK_DIR/.git" ]; then
    INFO "Cloning qmd fork into $QMD_FORK_DIR"
    run_as_user git clone "$QMD_FORK_REPO" "$QMD_FORK_DIR"
  else
    INFO "qmd fork already cloned at $QMD_FORK_DIR; pulling latest"
    run_as_user git -C "$QMD_FORK_DIR" pull --ff-only || \
      WARN "Failed to pull latest qmd fork. Continuing with existing version."
  fi

  INFO "Installing qmd globally from fork via bun"
  run_as_user env HOME="$HOME_DIR" PATH="${HOME_DIR}/.bun/bin:${PATH}" bash -lc "bun add -g '$QMD_FORK_DIR'"
  if [ -x "${HOME_DIR}/.bun/bin/qmd" ]; then
    INFO "qmd installed at ${HOME_DIR}/.bun/bin/qmd ($("${HOME_DIR}/.bun/bin/qmd" --version 2>/dev/null))"
  else
    WARN "qmd installation finished but binary not found at ${HOME_DIR}/.bun/bin/qmd"
  fi
}

setup_qmd() {
  local setup_script="${PROJECT_ROOT}/.opencode/scripts/qmd-setup.sh"
  local log_file

  if [ ! -f "$setup_script" ]; then
    ERR "Expected qmd setup script at '$setup_script' but it was not found."
  fi

  INFO "Configuring qmd index for this repository"
  log_file="$(mktemp)"
  if run_as_user env HOME="$HOME_DIR" PATH="${HOME_DIR}/.bun/bin:${PATH}" bash "$setup_script" 2>&1 | tee "$log_file"; then
    :
  else
    rm -f "$log_file"
    ERR "qmd setup failed. Review the output above and rerun once the issue is fixed."
  fi
  if grep -Eq 'QMD Warning: no GPU acceleration|falling back to no GPU|Failed to build llama.cpp with Vulkan support' "$log_file"; then
    record_warning "qmd setup completed without GPU acceleration. This is non-fatal; qmd will run on CPU and may be slower."
  fi
  rm -f "$log_file"
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

  # macOS does not always include /etc/sudoers.d/ in /etc/sudoers by default.
  # Ensure the @includedir directive exists so our drop-in file is honored.
  if is_mac; then
    if ! sudo grep -Eiq '^[#@]includedir\s+/etc/sudoers.d' /etc/sudoers 2>/dev/null; then
      INFO "Adding '@includedir /etc/sudoers.d' to /etc/sudoers (macOS default omits it)"
      echo '@includedir /etc/sudoers.d' | sudo tee -a /etc/sudoers >/dev/null
      sudo chmod 0440 /etc/sudoers
    fi
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

CAMOFOX_BROWSER_REPO="https://github.com/jo-inc/camofox-browser.git"
CAMOFOX_BROWSER_DIR="${PROJECT_ROOT}/../camofox-browser"

ensure_camofox_vnc_log_file() {
  local log_file="$1"

  if [ -e "$log_file" ]; then
    INFO "Ensuring $log_file is writable by $USER_NAME"
    sudo chown "$USER_NAME:$USER_GROUP" "$log_file"
    sudo chmod 600 "$log_file"
    return
  fi

  INFO "Creating $log_file for local Camofox VNC logging"
  sudo install -o "$USER_NAME" -g "$USER_GROUP" -m 600 /dev/null "$log_file"
}

run_camofox_npm_install() {
  WARN "The first camofox-browser install may download several hundred MBs and can exceed 700MB depending on version/platform."
  run_as_user env HOME="$HOME_DIR" CAMOFOX_CRASH_REPORT_ENABLED=false bash -lc "
    set -euo pipefail
    export NVM_DIR=\"\$HOME/.nvm\"
    if [ -s \"\$NVM_DIR/nvm.sh\" ]; then
      . \"\$NVM_DIR/nvm.sh\"
      nvm use --lts >/dev/null || nvm use default >/dev/null || true
    fi
    if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
      echo 'node and npm are required for camofox-browser; run install_nvm_and_node first.' >&2
      exit 1
    fi
    node_major=\$(node -p 'Number(process.versions.node.split(\".\")[0])')
    if [ \"\$node_major\" -lt 22 ] && command -v nvm >/dev/null 2>&1; then
      echo \"Current Node \$(node --version) is too old for camofox-browser; installing latest LTS with nvm.\" >&2
      nvm install --lts >/dev/null
      nvm use --lts >/dev/null
      node_major=\$(node -p 'Number(process.versions.node.split(\".\")[0])')
    fi
    if [ \"\$node_major\" -lt 22 ]; then
      echo \"camofox-browser requires Node >=22; found \$(node --version).\" >&2
      exit 1
    fi
    cd '$CAMOFOX_BROWSER_DIR'
    npm install
  "
}

install_camofox_browser() {
  if [ ! -d "$CAMOFOX_BROWSER_DIR/.git" ]; then
    INFO "Cloning camofox-browser into $CAMOFOX_BROWSER_DIR"
    run_as_user git clone "$CAMOFOX_BROWSER_REPO" "$CAMOFOX_BROWSER_DIR"
  else
    INFO "camofox-browser already cloned at $CAMOFOX_BROWSER_DIR; pulling latest"
    run_as_user git -C "$CAMOFOX_BROWSER_DIR" pull --ff-only || \
      WARN "Failed to pull latest camofox-browser. Continuing with existing version."
  fi

  if ! is_mac; then
    INFO "Preparing local Camofox VNC log files"
    ensure_camofox_vnc_log_file /var/log/novnc.log
    ensure_camofox_vnc_log_file /var/log/x11vnc.log
  else
    INFO "Skipping Camofox VNC log setup on macOS (Screen Sharing provides VNC access)"
  fi

  INFO "Installing camofox-browser npm dependencies"
  run_camofox_npm_install
}

install_google_chrome() {
  if is_mac; then
    if chrome_is_installed; then
      INFO "Google Chrome already installed at $(chrome_binary_path)"
      return
    fi
    if ! command -v brew >/dev/null 2>&1; then
      WARN "Homebrew not available; install Google Chrome manually from https://www.google.com/chrome/"
      return
    fi
    INFO "Installing Google Chrome via brew cask"
    run_as_user brew install --cask google-chrome
    if chrome_is_installed; then
      INFO "Google Chrome installed at $(chrome_binary_path)"
    else
      WARN "Google Chrome cask install finished but app not found at /Applications/Google Chrome.app"
    fi
    return
  fi

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
  if is_mac; then
    if docker_installed; then
      INFO "Docker already installed, skipping"
      return
    fi
    if ! command -v brew >/dev/null 2>&1; then
      WARN "Homebrew not available; install Docker Desktop manually from https://www.docker.com/products/docker-desktop"
      return
    fi
    INFO "Installing Docker Desktop via brew cask"
    run_as_user brew install --cask docker
    WARN "Docker Desktop was installed. Launch it from /Applications/Docker.app to complete setup and accept the license."
    WARN "The docker CLI will not be usable until Docker Desktop has been launched at least once."
    return
  fi

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
  # Ensure the user is in the docker group (Linux only; Docker Desktop on Mac does not use a group)
  if docker_group_member "$USER_NAME"; then
    INFO "User $USER_NAME is already in the docker group"
  else
    INFO "Adding $USER_NAME to docker group"
    if ! getent group docker >/dev/null 2>&1; then
      sudo groupadd docker
    fi
    sudo usermod -aG docker "$USER_NAME"
    WARN "User $USER_NAME was added to the docker group. Log out and log back in for the change to take effect."
  fi
}

install_tmux() {
  if command -v tmux >/dev/null 2>&1; then
    INFO "tmux already installed"
    return
  fi
  if is_mac; then
    brew_install tmux
  else
    apt_install tmux
  fi
}

WORKSPACE_MCP_REPO="https://github.com/taylorwilsdon/google_workspace_mcp.git"
WORKSPACE_MCP_DIR="${PROJECT_ROOT}/../google_workspace_mcp"

COMPUTER_CONTROL_MCP_REPO="git@github.com:lohzi97/computer-control-mcp.git"
COMPUTER_CONTROL_MCP_DIR="${PROJECT_ROOT}/../computer-control-mcp"

IMAP_MCP_REPO="https://github.com/nikolausm/imap-mcp-server.git"
IMAP_MCP_DIR="${HOME_DIR}/imap-mcp-server"

install_workspace_mcp() {
  if [ ! -d "$WORKSPACE_MCP_DIR/.git" ]; then
    INFO "Cloning google_workspace_mcp into $WORKSPACE_MCP_DIR"
    git clone "$WORKSPACE_MCP_REPO" "$WORKSPACE_MCP_DIR"
  else
    INFO "google_workspace_mcp already cloned at $WORKSPACE_MCP_DIR; pulling latest"
    git -C "$WORKSPACE_MCP_DIR" pull --ff-only || \
      WARN "Failed to pull latest google_workspace_mcp. Continuing with existing version."
  fi

  INFO "Installing google_workspace_mcp dependencies"
  run_as_user env HOME="$HOME_DIR" PATH="${HOME_DIR}/.local/bin:${PATH}" bash -lc \
    "cd '$WORKSPACE_MCP_DIR' && uv sync"
}

install_computer_control_mcp() {
  if [ ! -d "$COMPUTER_CONTROL_MCP_DIR/.git" ]; then
    INFO "Cloning computer-control-mcp fork into $COMPUTER_CONTROL_MCP_DIR"
    run_as_user git clone "$COMPUTER_CONTROL_MCP_REPO" "$COMPUTER_CONTROL_MCP_DIR"
  else
    INFO "computer-control-mcp fork already cloned at $COMPUTER_CONTROL_MCP_DIR; pulling latest"
    run_as_user git -C "$COMPUTER_CONTROL_MCP_DIR" pull --ff-only || \
      WARN "Failed to pull latest computer-control-mcp fork. Continuing with existing version."
  fi

  INFO "Installing computer-control-mcp dependencies"
  run_as_user env HOME="$HOME_DIR" PATH="${HOME_DIR}/.local/bin:${PATH}" bash -lc \
    "cd '$COMPUTER_CONTROL_MCP_DIR' && uv sync"
}

install_imap_mcp() {
  if [ ! -d "$IMAP_MCP_DIR/.git" ]; then
    INFO "Cloning imap-mcp-server into $IMAP_MCP_DIR"
    git clone "$IMAP_MCP_REPO" "$IMAP_MCP_DIR"
  else
    INFO "imap-mcp-server already cloned at $IMAP_MCP_DIR; pulling latest"
    git -C "$IMAP_MCP_DIR" pull --ff-only || \
      WARN "Failed to pull latest imap-mcp-server. Continuing with existing version."
  fi

  INFO "Installing imap-mcp-server dependencies and building"
  run_as_user env HOME="$HOME_DIR" PATH="${HOME_DIR}/.bun/bin:${PATH}" bash -lc \
    "cd '$IMAP_MCP_DIR' && npm install && npm run build"
}

install_agent_tui() {
  if [ -x "${HOME_DIR}/.bun/bin/agent-tui" ]; then
    INFO "agent-tui already installed via bun at ${HOME_DIR}/.bun/bin/agent-tui"
    return
  fi
  if ! user_has_command bun && [ ! -x "${HOME_DIR}/.bun/bin/bun" ]; then
    ERR "bun is required to install agent-tui. Run the script again after bun is installed."
  fi
  if user_has_command agent-tui; then
    WARN "agent-tui already exists at $(user_command_path agent-tui); installing a bun-managed copy as well."
  fi
  INFO "Installing agent-tui (global) with bun"
  run_as_user env HOME="$HOME_DIR" PATH="${HOME_DIR}/.bun/bin:${PATH}" bash -lc 'bun add -g agent-tui'
  if [ -x "${HOME_DIR}/.bun/bin/agent-tui" ]; then
    INFO "agent-tui installed at ${HOME_DIR}/.bun/bin/agent-tui"
  else
    WARN "agent-tui installation finished but bun-managed binary not found at ${HOME_DIR}/.bun/bin/agent-tui"
  fi
}

install_antigravity_cli() {
  if [ -x "${HOME_DIR}/.local/bin/agy" ]; then
    INFO "Antigravity CLI (agy) already installed at ${HOME_DIR}/.local/bin/agy"
    return
  fi
  if user_has_command agy; then
    INFO "Antigravity CLI (agy) already in PATH: $(user_command_path agy)"
    return
  fi
  INFO "Installing Antigravity CLI (agy)"
  run_as_user env HOME="$HOME_DIR" bash -lc 'curl -fsSL https://antigravity.google/cli/install.sh | bash'
  if [ -x "${HOME_DIR}/.local/bin/agy" ]; then
    INFO "Antigravity CLI installed at ${HOME_DIR}/.local/bin/agy"
  else
    WARN "Antigravity CLI installation finished but binary not found at ${HOME_DIR}/.local/bin/agy"
  fi
}

install_openchamber() {
  if user_has_command openchamber; then
    INFO "OpenChamber already installed at $(user_command_path openchamber)"
    return
  fi
  if ! user_has_command bun && [ ! -x "${HOME_DIR}/.bun/bin/bun" ]; then
    ERR "bun is required to install OpenChamber. Run the script again after bun is installed."
  fi
  INFO "Installing OpenChamber (global) with bun"
  run_as_user env HOME="$HOME_DIR" PATH="${HOME_DIR}/.bun/bin:${PATH}" bash -lc 'bun add -g @openchamber/web'
  if user_has_command openchamber; then
    INFO "OpenChamber installed at $(user_command_path openchamber)"
  else
    WARN "OpenChamber installation finished but binary not found in PATH. It may be at ${HOME_DIR}/.bun/bin/openchamber"
  fi
}

main() {
  ensure_sudo
  install_prereqs
  install_bun
  install_opencode
  setup_sudoers_for_opencode
  install_uv
  install_nvm_and_node
  install_camofox_system_deps
  install_camofox_browser
  install_google_chrome
  install_docker_engine
  install_tmux
  install_workspace_mcp
  install_computer_control_mcp
  install_imap_mcp
  install_qmd
  setup_qmd
  install_agent_tui
  install_antigravity_cli
  install_openchamber
  print_warning_summary
INFO "All done. Please log out and log back in before using Docker without sudo, then run ./config.sh."
}

main "$@"
