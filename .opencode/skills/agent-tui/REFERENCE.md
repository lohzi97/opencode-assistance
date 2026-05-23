# agent-tui Reference

## Daemon Management

```bash
agent-tui daemon start                           # Start daemon in background (idempotent)
agent-tui daemon run                             # Run daemon in foreground (for debugging/supervisors)
agent-tui daemon status                          # Exit 0 = running, 3 = not running
agent-tui daemon restart --yes                   # Restart (kills all sessions)
agent-tui daemon restart --dry-run               # Preview restart without acting
agent-tui daemon stop --yes                      # Graceful stop
agent-tui daemon stop --dry-run                  # Preview stop without acting
agent-tui daemon stop --force --yes              # Force kill (SIGKILL)
```

## Session Lifecycle

```bash
agent-tui run <command> [args...]                # Start session (returns session ID)
agent-tui run --cols 120 --rows 40 <command>     # Custom terminal size
agent-tui run --cwd /path --env FOO=bar <cmd>    # Working dir and env vars
agent-tui run -- vim -n file.txt                 # Use -- before args starting with -
agent-tui kill --yes                             # Kill session
agent-tui kill --dry-run                         # Preview kill without acting
agent-tui restart --yes                          # Restart (same command, new PTY)
agent-tui restart --dry-run                      # Preview restart without acting
```

## Screenshots

```bash
agent-tui screenshot                             # With ANSI colors (default)
agent-tui screenshot --retain-ansi               # Explicitly preserve colors/styles
agent-tui screenshot --strip-ansi                # Plain text (recommended for parsing)
agent-tui screenshot --include-cursor            # Include cursor position
agent-tui screenshot --json                      # JSON output
```

Screenshots return the full terminal buffer as text. This is the primary way to read TUI state.

## Keyboard Input

### Press keys

```bash
agent-tui press Enter                            # Single key
agent-tui press Escape                           # Escape key
agent-tui press Tab                              # Tab key
agent-tui press ArrowDown ArrowDown Enter        # Key sequence
agent-tui press Ctrl+C                           # Modified key (Ctrl+C)
agent-tui press Ctrl+M                           # Equivalent to Enter in many TUIs
agent-tui press F10                              # Function key
```

### Modifier hold/release

```bash
agent-tui press Ctrl --hold                      # Hold Ctrl down
agent-tui press c                                # Press c while Ctrl held
agent-tui press Ctrl --release                   # Release Ctrl
```

Same pattern for `Shift`, `Alt`, `Meta`.

### Supported key names

`Enter`, `Escape`, `Tab`, `Backspace`, `Delete`, `Insert`, `Home`, `End`, `PageUp`, `PageDown`, `Space`, `ArrowUp`, `ArrowDown`, `ArrowLeft`, `ArrowRight`, `F1`-`F12`, `Ctrl+A` through `Ctrl+Z`.

## Text Input

```bash
agent-tui type "hello world"                     # Type text character by character
agent-tui type "user@example.com"                # Email, paths, etc.
printf 'text' | agent-tui type -                 # Pipe from stdin
```

## Scrolling

```bash
agent-tui scroll down                            # 1 step down
agent-tui scroll up 5                            # 5 steps up
agent-tui scroll left 3                          # 3 columns left
agent-tui scroll right 2                         # 2 columns right
```

Scroll sends repeated arrow keypresses. It does NOT use terminal scrollback. Some TUI apps (like agy) block arrow navigation — use `resize` instead for those.

## Waiting

```bash
agent-tui wait "Continue"                        # Wait for text (default 30s)
agent-tui wait "Loading" --gone                  # Wait for text to disappear
agent-tui wait --stable                          # Wait for screenshot stability
agent-tui wait -t 5000 "Done"                    # Custom timeout (ms)
agent-tui wait --assert -t 10000 "Ready"         # Exit 0 if met, 75 on timeout
```

## Resizing

```bash
agent-tui resize --cols 80 --rows 24             # Classic terminal
agent-tui resize --cols 120 --rows 40            # Default size
agent-tui resize --cols 150 --rows 300           # Capture long output
agent-tui resize --cols 150 --rows 500           # Very long output
```

## Multi-Session Management

```bash
agent-tui sessions list [--json]                 # List sessions
agent-tui sessions show <id>                     # Session details
agent-tui sessions switch <id>                   # Set active session
agent-tui sessions attach                        # Attach with TTY (default)
agent-tui sessions attach -T                      # Stream output only (no TTY)
agent-tui sessions attach --detach-keys 'ctrl-]' # Custom detach sequence
agent-tui --no-input sessions attach              # --no-input implies -T
agent-tui sessions cleanup --yes                 # Remove dead sessions
agent-tui sessions cleanup --all --yes           # Remove all sessions
agent-tui sessions cleanup --all --dry-run       # Preview removing all sessions
```

Target a specific session with `-s`:

```bash
agent-tui -s abc123 screenshot 2>&1
agent-tui -s abc123 type "hello" 2>&1
agent-tui -s abc123 kill --yes 2>&1
```

## Automation Patterns

### One-shot interaction

```bash
agent-tui daemon start 2>&1
agent-tui run nano 2>&1
agent-tui type "Hello, World!" 2>&1
agent-tui press Ctrl+X 2>&1
agent-tui press y 2>&1
agent-tui type "test.txt" 2>&1
agent-tui press Enter 2>&1
agent-tui kill --yes 2>&1
```

### Wait-driven installer

```bash
agent-tui daemon start 2>&1
agent-tui run "some-installer" 2>&1
agent-tui wait "license agreement" -t 10000 2>&1
agent-tui press Enter 2>&1
agent-tui wait "install path" -t 10000 2>&1
agent-tui type "/opt/custom" 2>&1
agent-tui press Enter 2>&1
agent-tui wait --stable -t 30000 2>&1
agent-tui screenshot --strip-ansi 2>&1
agent-tui kill --yes 2>&1
```

### Capture full output (resize trick)

```bash
agent-tui daemon start 2>&1
agent-tui run agy 2>&1
agent-tui wait ">" -t 5000 2>&1
agent-tui type "search query here" 2>&1
agent-tui press Enter 2>&1
agent-tui wait --stable -t 30000 2>&1
agent-tui resize --cols 150 --rows 300 2>&1
agent-tui screenshot --strip-ansi 2>&1
agent-tui kill --yes 2>&1
```

### Menu navigation

```bash
agent-tui daemon start 2>&1
agent-tui run htop 2>&1
agent-tui press F10 2>&1
agent-tui wait "Setup" -t 5000 2>&1
agent-tui press ArrowDown ArrowDown ArrowRight Enter 2>&1
agent-tui screenshot 2>&1
agent-tui press F10 2>&1
agent-tui kill --yes 2>&1
```

## Global Options

All commands accept these options:

```bash
-s, --session <ID>       # Target a specific session (defaults to most recent)
-f, --format <FORMAT>    # Output format: text (default) or json
    --json               # Shorthand for --format json
    --no-color           # Disable colored output (also respects NO_COLOR env)
    --no-input           # Disable prompts; require explicit flags
```

## Live Preview

```bash
agent-tui live start                        # Show WS/UI endpoints
agent-tui live start --open                 # Open preview in browser
agent-tui live start --open --browser firefox  # Override $BROWSER
agent-tui live status                       # Check live preview status
agent-tui live stop                         # Stop managed UI server
```

The daemon serves a built-in web UI at `/ui` and JSON-RPC over WebSocket at `/ws`. Use `live` to print URLs for external frontends.

## Diagnostic Commands

```bash
agent-tui version                          # Show CLI and daemon version
agent-tui env                              # Show all environment config
agent-tui completions                      # Interactive shell completion setup
agent-tui completions bash --print         # Print bash completion script
agent-tui completions --install fish       # Install fish completions
```

### Shell completion installation

```bash
# Bash - add to ~/.bashrc
source <(agent-tui completions bash --print)

# Zsh - add to ~/.zshrc
source <(agent-tui completions zsh --print)

# Fish - run once
agent-tui completions fish --print > ~/.config/fish/completions/agent-tui.fish

# Elvish - run once
agent-tui completions elvish --print > ~/.elvish/lib/agent-tui.elv
```

## Environment Variables and Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for the full environment variable reference and common problem solutions.
