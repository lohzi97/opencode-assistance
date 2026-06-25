#!/usr/bin/env bash
# Shared platform detection and dispatch helpers.
# Sourced by install.sh, start.sh, stop.sh, uninstall.sh, config.sh, restart.sh.
# Defines only functions and guards; no side effects on source.

# Detect the host platform family.
# Echoes one of: "linux", "wsl", "mac", "unknown"
os_family() {
  case "$(uname -s)" in
    Linux)
      if grep -qi microsoft /proc/version 2>/dev/null; then
        echo "wsl"
      else
        echo "linux"
      fi
      ;;
    Darwin)
      echo "mac"
      ;;
    *)
      echo "unknown"
      ;;
  esac
}

is_wsl() {
  [ "$(os_family)" = "wsl" ]
}

is_mac() {
  [ "$(os_family)" = "mac" ]
}

# True for Linux and WSL (apt-based, GNU userland).
is_linux_like() {
  case "$(os_family)" in
    linux|wsl) return 0 ;;
    *) return 1 ;;
  esac
}

# Open a URL in the user's default browser across platforms.
# Returns non-zero if no browser opener is available.
open_browser() {
  local url="$1"
  case "$(os_family)" in
    mac)
      if command -v open >/dev/null 2>&1; then
        open "$url"
      else
        return 1
      fi
      ;;
    wsl)
      # Prefer wslview (wslu), then xdg-open, then PowerShell fallback.
      if command -v wslview >/dev/null 2>&1; then
        wslview "$url" >/dev/null 2>&1
      elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url" >/dev/null 2>&1
      elif command -v powershell.exe >/dev/null 2>&1; then
        powershell.exe -NoProfile -c "start '$url'" >/dev/null 2>&1
      else
        return 1
      fi
      ;;
    linux|*)
      if command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url" >/dev/null 2>&1
      else
        return 1
      fi
      ;;
  esac
}

# Return the file owner across GNU/BSD stat variants.
stat_owner() {
  local path="$1"
  if is_mac; then
    stat -f '%Su' "$path" 2>/dev/null || true
  else
    stat -c '%U' "$path" 2>/dev/null || true
  fi
}

# Resolve a user's home directory across platforms.
# Arg 1: username. Echoes the home directory path.
user_home_dir() {
  local user="$1"
  if is_mac; then
    dscl . -read "/Users/$user" NFSHomeDirectory 2>/dev/null | awk '{print $2}'
  else
    getent passwd "$user" 2>/dev/null | cut -d: -f6
  fi
}

# Default home directory prefix for a username when other lookups fail.
default_home_prefix() {
  if is_mac; then
    echo "/Users/$1"
  else
    echo "/home/$1"
  fi
}

# Return the available native package manager: "apt", "brew", or empty.
pkg_manager() {
  if is_mac; then
    if command -v brew >/dev/null 2>&1; then
      echo "brew"
    else
      echo ""
    fi
  else
    if command -v apt-get >/dev/null 2>&1; then
      echo "apt"
    else
      echo ""
    fi
  fi
}

# Return the Google Chrome binary path on the current platform, or empty if not installed.
chrome_binary_path() {
  local mac_app="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if is_mac; then
    if [ -x "$mac_app" ]; then
      echo "$mac_app"
      return
    fi
    if command -v google-chrome >/dev/null 2>&1; then
      command -v google-chrome
      return
    fi
    echo ""
    return
  fi
  if command -v google-chrome >/dev/null 2>&1; then
    command -v google-chrome
    return
  fi
  echo ""
}

# Boolean: is Google Chrome installed on this platform?
chrome_is_installed() {
  [ -n "$(chrome_binary_path)" ]
}

# Boolean: does the given user (default: current) belong to the docker group?
# On macOS, Docker Desktop does not use a docker group; always returns false.
docker_group_member() {
  local user="${1:-$(id -un)}"
  if is_mac; then
    return 1
  fi
  groups "$user" 2>/dev/null | grep -qw docker
}

# Boolean: is Docker installed (any platform)?
docker_installed() {
  command -v docker >/dev/null 2>&1
}

# Stop the Docker daemon/service across platforms (best-effort).
stop_docker_service() {
  if is_mac; then
    # Docker Desktop on Mac is a GUI app; try to quit it gracefully.
    osascript -e 'quit app "Docker"' 2>/dev/null || true
    return
  fi
  sudo systemctl stop docker 2>/dev/null || true
}
