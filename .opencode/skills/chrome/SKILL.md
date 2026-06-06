---
name: chrome
description: Start a Chrome instance in remote debugging mode on port 9222 with a project-local user data directory, enabling chrome-devtools MCP and web browsing capabilities.
---

# Chrome

## When To Use

Use this skill when user asks to start or launch Chrome, when you need the chrome-devtools MCP to be available, or when a task requires web browsing or interaction with a web page.

Typical requests:

- "Start Chrome."
- "Open Chrome."
- "Launch Chrome in debug mode."
- "I need the browser."
- "Open this URL."
- "Check this website."

## Starting Chrome

Use `pty_spawn` to start Chrome so it persists independently of any terminal:

```
command: "google-chrome-stable"
args: ["--remote-debugging-port=9222", "--user-data-dir=.chrome/"]
title: "Chrome Debug"
description: "Chrome remote debugging instance on port 9222"
```

- Port: `9222` (fixed, matches chrome-devtools MCP default)
- User data directory: `.chrome/` (project-local, gitignored). Create it if not exist. Add it into gitignore if it haven't do so.
- PTY-backed so Chrome survives terminal closures

### Startup Procedure

1. Check whether a debug Chrome is already running on port 9222:
   ```bash
   curl -s http://localhost:9222/json/version > /dev/null 2>&1 && echo "RUNNING" || echo "NOT_RUNNING"
   ```
2. If already running, skip the launch.
3. If not running, ensure the `.chrome/` directory exists:
   ```bash
   mkdir -p .chrome/
   ```
4. Use `pty_spawn` with the canonical command and args above.
5. Wait a moment for Chrome to start, then verify with the same curl check.
6. Report success or failure to user.

### Stopping Chrome

Use `pty_kill` with the Chrome PTY session id (from `pty_list`, titled "Chrome Debug").

## Interacting with Chrome

Two MCPs are available for interacting with the Chrome instance. Use the correct one for the task:

**chrome-devtools MCP** - for development purposes:
- Testing a locally developed webapp
- Inspecting page structure, DOM, network requests
- Automated form filling and UI testing
- Taking structured snapshots (a11y tree) for precise element interaction

**computer-control MCP** - for human-like browsing:
- Web scraping
- General web navigation and research
- Any task where appearing as a regular human user matters
- Avoids bot detection because it controls the GUI at the OS level (mouse movements, clicks, screenshots) rather than through the DevTools protocol

### Missing MCP

If the required MCP (chrome-devtools or computer-control) is not available for the task at hand, report it to user immediately. Do not attempt to substitute with the other MCP or any alternative method. Each MCP serves a distinct purpose and substituting one for the other defeats the bot-detection safeguard.

## Notes

- The `.chrome/` directory is gitignored. The skill creates it at runtime if missing. Profile data, cache, and cookies remain local.
- On first launch with a fresh `.chrome/`, Chrome may show a "Choose your person" dialog. After the first run it will not appear again.
- Closing all Chrome windows does not stop the debug process. To fully stop it, use `pty_kill`.
