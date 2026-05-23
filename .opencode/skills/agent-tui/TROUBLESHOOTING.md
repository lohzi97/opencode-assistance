# agent-tui Troubleshooting

## Environment Variables

### General

| Variable | Default | Description |
|---|---|---|
| `AGENT_TUI_NO_INPUT` | (unset) | Disable prompts; require explicit flags |
| `AGENT_TUI_TRANSPORT` | `unix` | IPC transport (`unix` or `ws`) |
| `AGENT_TUI_SESSION_STORE` | `~/.agent-tui/sessions.jsonl` | Session metadata log |
| `AGENT_TUI_LOG` | (unset) | Log file path (optional) |
| `AGENT_TUI_LOG_FORMAT` | `text` | Log format (`text` or `json`) |
| `AGENT_TUI_LOG_STREAM` | `stderr` | Log output stream (`stderr` or `stdout`) |
| `AGENT_TUI_DETACH_KEYS` | `Ctrl-P Ctrl-B` | Detach key sequence for `sessions attach` |

### WebSocket / Remote

| Variable | Default | Description |
|---|---|---|
| `AGENT_TUI_WS_ADDR` | (unset) | Remote WS-RPC target when transport is `ws` (e.g. `ws://host:port/ws`) |
| `AGENT_TUI_WS_LISTEN` | `127.0.0.1:0` | Daemon WS bind address |
| `AGENT_TUI_WS_ALLOW_REMOTE` | `false` | Allow non-loopback WS bind |
| `AGENT_TUI_WS_STATE` | `~/.agent-tui/api.json` | Daemon WS state file path |
| `AGENT_TUI_WS_DISABLED` | `false` | Disable daemon WS server |
| `AGENT_TUI_WS_MAX_CONNECTIONS` | `32` | Max WebSocket connections |
| `AGENT_TUI_WS_QUEUE` | `128` | WS outbound queue size |

### UI (Live Preview)

| Variable | Default | Description |
|---|---|---|
| `AGENT_TUI_UI_URL` | (unset) | Same-origin UI URL or path override for live preview |
| `AGENT_TUI_UI_MODE` | (unset) | UI mode override |
| `AGENT_TUI_UI_PORT` | (unset) | UI port override |
| `AGENT_TUI_UI_ROOT` | (unset) | UI root path override |
| `AGENT_TUI_UI_STATE` | (unset) | UI state file path |

## Common Problems

| Problem | Solution |
|---|---|
| "daemon not running" | `agent-tui daemon start` |
| "session already exists" | `agent-tui kill --yes`, or `agent-tui sessions cleanup --all --yes` |
| Screenshot empty/garbled | TUI may still be loading. Use `agent-tui wait --stable` |
| Output truncated | Resize: `agent-tui resize --cols 150 --rows 500` |
| Key press not registering | Add `sleep 1` between press commands |
| Cannot scroll content | TUI blocks arrow keys. Use resize trick instead |
| Session stuck/unresponsive | `agent-tui kill --yes` then `agent-tui sessions cleanup --yes` |
| Need diagnostics | `agent-tui env` shows all active config |
| CLI/daemon version mismatch | `agent-tui version` then `agent-tui daemon restart --yes` |
