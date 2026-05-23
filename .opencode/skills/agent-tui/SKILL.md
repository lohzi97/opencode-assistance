---
name: agent-tui
description: Drive any TUI application programmatically via the agent-tui CLI. Use when interacting with terminal-based apps that cannot be controlled via plain PTY — agy, htop, vim, nano, lazygit, dialog-based installers, or any curses/bubbletea TUI program.
---

# agent-tui — TUI Automation

## When to Use

Use when you need to interact with a TUI application that renders a full-screen terminal UI, uses alternate screen buffers, or requires precise key input and visual state capture rather than stream output.

## Prerequisites

- `agent-tui` installed globally (`bun add -g agent-tui`)
- Target TUI application installed and in PATH
- Daemon running (`agent-tui daemon start`)
- Unix-like system (Linux, macOS); Windows is not supported

## Rules

1. Always start the daemon before use. `daemon start` is idempotent.
2. Only one active session by default. Kill existing sessions before starting new ones.
3. Always kill the session when done. Never leave dangling sessions.
4. Preferably, `wait` after input before taking a screenshot whenever you know the expected result.
5. If scroll keys are blocked by the TUI (e.g., agy), use `resize` to expand the viewport instead.
6. Use `--strip-ansi` on screenshots when parsing text programmatically.
7. Use `--no-input` in non-interactive scripts to avoid prompts.

## Core Workflow

```
daemon start -> run <app> -> [type/press/scroll] -> wait -> screenshot -> kill
```

### 1. Start daemon and session

```bash
agent-tui daemon start 2>&1
agent-tui run <command> [args...] 2>&1          # optional: --cols N --rows N, --cwd DIR, --env K=V
```

### 2. Interact

```bash
agent-tui type "<text>" 2>&1                    # type text character by character
agent-tui type - 2>&1                           # read text from stdin pipe
agent-tui press Enter 2>&1                      # single key
agent-tui press ArrowDown ArrowDown Enter 2>&1  # key sequence
agent-tui press Ctrl+C 2>&1                     # modified key
agent-tui press Ctrl --hold 2>&1                # hold modifier down
agent-tui press c 2>&1                          # press key while modifier held
agent-tui press Ctrl --release 2>&1             # release modifier
agent-tui scroll down 5 2>&1                    # directional scroll (up/down/left/right)
```

### 3. Wait for condition

```bash
agent-tui wait "Ready" 2>&1                     # wait for text to appear (30s default)
agent-tui wait "Loading" --gone 2>&1            # wait for text to disappear
agent-tui wait --stable 2>&1                    # wait for screenshot to stop changing
agent-tui wait -t 10000 "Done" 2>&1             # custom timeout (ms)
agent-tui wait --assert -t 10000 "Ready" 2>&1   # exit 0 if met, 75 on timeout
```

### 4. Capture state

```bash
agent-tui screenshot --strip-ansi 2>&1          # plain text screenshot
agent-tui resize --cols 150 --rows 300 2>&1     # expand viewport for long output
agent-tui screenshot --strip-ansi 2>&1          # re-capture after resize
```

### 5. Clean up

```bash
agent-tui kill --yes 2>&1
```

## Multi-Session

All commands accept `-s <session-id>` to target a specific session. Use `sessions list`, `sessions show <id>`, `sessions switch <id>`, `sessions attach [-T]`, and `sessions cleanup` for management.

```bash
agent-tui -s abc123 screenshot --strip-ansi 2>&1
agent-tui -s abc123 type "hello" 2>&1
agent-tui -s abc123 kill --yes 2>&1
```

## Advanced

- `restart` -- Restart the current session with the same command in a new PTY (`agent-tui restart --yes`).
- `live` -- Show WebSocket live-preview endpoints for external frontends (`agent-tui live start`).
- `--format json` / `--json` -- Machine-readable JSON output on any command.
- `version`, `env`, `completions` -- Diagnostics and shell setup.

Full command reference and automation patterns: see [REFERENCE.md](REFERENCE.md)
Environment variables and troubleshooting: see [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
