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

### Start opencode-assistant

```bash
./start.sh
```

This starts the backend and project worker, then opens the OpenCode web UI in your browser.

`./start.sh` also attempts to start the repo-managed local Steel Browser container at `http://localhost:3000/v1` when Docker is available and port `3000` is free. Steel is optional: assistant startup still succeeds if Steel cannot be started.

### Optional Steel browser smoke test

Check the CLI first:

```bash
steel --version
```

If Steel started successfully, these quick checks are useful:

```bash
curl http://localhost:3000/v1/health
```

The local Steel UI is also available at `http://localhost:3000/ui` when the container is running.

Simple interactive smoke test:

```bash
SESSION="smoke-$(date +%Y%m%d%H%M%S)"
steel browser start --session "$SESSION" --api-url http://localhost:3000/v1
steel browser open https://example.com --session "$SESSION" --api-url http://localhost:3000/v1
steel browser snapshot -i -c -d 3 --session "$SESSION" --api-url http://localhost:3000/v1
steel browser stop --session "$SESSION" --api-url http://localhost:3000/v1
```

### Attach OpenCode TUI

```bash
./tui.sh
```

You can run `./tui.sh` multiple times to attach additional TUI clients to the same backend.
