### Install opencode-assistant

```bash
./install.sh
```

### Configure opencode-assistant

```bash
./config.sh
```

### Get Google Drive MCP OAuth Credentials

Before running `./config.sh`, create and download a Google OAuth desktop client JSON for the Google Drive MCP.

1. Create a Google Cloud project in <https://console.cloud.google.com>.
2. Enable `Google Drive API`, `Google Docs API`, `Google Sheets API`, `Google Slides API`, and `Google Calendar API`.
3. Configure the OAuth consent screen. Use `External` unless this is a Google Workspace-only deployment, add your own Google account as a test user, and grant these recommended scopes:

```text
https://www.googleapis.com/auth/drive.file
https://www.googleapis.com/auth/documents
https://www.googleapis.com/auth/spreadsheets
https://www.googleapis.com/auth/presentations
https://www.googleapis.com/auth/drive
https://www.googleapis.com/auth/drive.readonly
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/calendar.events
```

4. Go to `APIs & Services > Credentials > Create Credentials > OAuth client ID`.
5. Set `Application type` to `Desktop app`.
6. Download the JSON file and rename it to `gcp-oauth.keys.json`.
7. Run `./config.sh` and provide the path to that file when prompted. The script copies it into `.opencode/gcp-oauth.keys.json`, so `opencode.json` never needs a manual path edit.

On first Google Drive MCP use, the browser-based Google consent flow should open automatically and store tokens at `~/.config/google-drive-mcp/tokens.json`.

Re-run `./config.sh` any time you need to update:
- Brave Search API key
- Google Drive OAuth credentials file
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
