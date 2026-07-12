### Install opencode-assistant

Supported platforms: Linux Mint / Ubuntu (apt-based), WSL2 Ubuntu, and macOS (Homebrew).

```bash
./install.sh
```

**macOS notes:**
- The installer bootstraps Homebrew for you if it is missing (uses `NONINTERACTIVE=1`).
- Google Chrome and Docker Desktop are installed via `brew install --cask` if not already present. Launch Docker Desktop once to accept its license before using `docker`.
- Camofox VNC packages (`xvfb`, `x11vnc`, `novnc`) are skipped on macOS. Use the built-in Screen Sharing service for remote access instead.
- A sudoers drop-in is created at `/etc/sudoers.d/opencode-assistant`. On macOS the installer also ensures `/etc/sudoers` contains `@includedir /etc/sudoers.d`, since not all macOS versions ship with that line.

**WSL2 notes:**
- Install `wslu` (`sudo apt install wslu`) so `start.sh` can open the web UI in your Windows browser via `wslview`. Without it, the URL is printed for manual opening.
- If you use Docker Desktop's WSL2 integration, skip the apt-installed Docker engine by leaving Docker Desktop running before running `./install.sh`; the installer detects existing `docker` and skips reinstall.

### Configure opencode-assistant

```bash
./config.sh
```

### Get Google Workspace MCP OAuth Credentials

Before running `./config.sh`, create and download a Google OAuth desktop client JSON for the Google Workspace MCP (`taylorwilsdon/google_workspace_mcp`).

1. Create a Google Cloud project in <https://console.cloud.google.com>.
2. Enable the Google APIs that match the services configured in `opencode.json` (currently `--tools drive calendar`):
   - `Google Drive API` (required)
   - `Google Calendar API` (required)
   - Optionally enable `Gmail API`, `Google Docs API`, `Google Sheets API`, `Google Slides API`, `Google Tasks API`, `Google Forms API`, `People API` (Contacts), or `Google Chat API` if you plan to expand the `--tools` list later. Enabling an API costs nothing.
3. Configure the OAuth consent screen. Use `External` unless this is a Google Workspace-only deployment, add your own Google account as a test user. The MCP requests scopes dynamically at OAuth time based on the `--tools` flag, so you do not need to pre-grant specific scopes on the consent screen, but adding them avoids warnings during the flow. Recommended scopes for the current `drive calendar` configuration:

```text
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/drive.file
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/calendar.readonly
https://www.googleapis.com/auth/calendar.events
```

4. Go to `APIs & Services > Credentials > Create Credentials > OAuth client ID`.
5. Set `Application type` to `Desktop app`.
6. Download the JSON file and rename it to `gcp-oauth.keys.json`.
7. Run `./config.sh` and provide the path to that file when prompted. The script copies it into `.opencode/gcp-oauth.keys.json`, so `opencode.json` never needs a manual path edit.

On first Google Workspace MCP use, the browser-based Google consent flow opens automatically on this machine and stores tokens at `~/.google_workspace_mcp/credentials/`.

Re-run `./config.sh` any time you need to update:
- Brave Search API key
- Google Workspace OAuth credentials file
- OpenCode web UI password
- Telegram Ping bot token or chat ID
- OpenCode provider login

### Connect an IMAP Email Account (e.g. Yahoo Mail)

The IMAP MCP server lets Sebastian read, send, and manage email. Accounts are configured through a browser-based wizard.

1. Run `./config.sh` and answer **yes** to the IMAP setup wizard prompt, or run it directly:

```bash
cd ~/imap-mcp-server && npx tsx src/setup.ts --skip-claude --port 9998
```

2. The wizard opens at <http://localhost:9998>. Choose your provider (e.g. Yahoo Mail) and sign in with an **app-specific password** -- not your regular account password.

3. For Yahoo Mail, generate an app password at <https://login.yahoo.com/account/security> under "App passwords".

4. After adding your account, press `Ctrl+C` to stop the wizard. Account credentials are stored encrypted at `~/.imap-mcp/`.

### Start opencode-assistant

```bash
./start.sh
```

This starts the backend and project worker, then opens the OpenCode web UI in your browser.

### Attach OpenCode TUI

```bash
./tui.sh
```

You can run `./tui.sh` multiple times to attach additional TUI clients to the same backend.

### Start chrome in debug mode

```bash
google-chrome-stable --remote-debugging-port=9222 --user-data-dir=/home/lohzi/Documents/chrome-temp/personal-chrome-1
```
