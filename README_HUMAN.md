### Install opencode-assistant

```bash
./install.sh
```

### Configure opencode-assistant

```bash
./config.sh
```

Re-run `./config.sh` any time you need to update:
- Brave Search API key
- OpenCode web UI password
- Telegram Ping bot token or chat ID
- OpenCode provider login

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
