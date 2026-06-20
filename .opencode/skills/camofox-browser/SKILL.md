---
name: camofox-browser
description: Drive the local `../camofox-browser` checkout through its REST API for stealthy, semantic browser automation with accessibility snapshots and stable element refs. Use when browsing dynamic or anti-bot-sensitive sites, when GUI-driven browsing is too fragile, or when the user explicitly mentions Camofox or Camoufox.
---

# Camofox Browser

## When To Use

Use this skill when browser work should go through the local `camofox-browser` server instead of a GUI-driven browser workflow.

Typical triggers:

- The user mentions `camofox-browser`, `camoufox`, or a stealth browser.
- The task needs semantic snapshots and stable element refs instead of screenshots and pixel clicks.
- The current GUI-driven browser flow is too fragile or too slow.
- The site is dynamic or mildly anti-bot-sensitive and Playwright-style browser automation is acceptable.

Do not use this skill for ordinary desktop browsing. That remains `browser-interact`.

## Local Contract

- Source checkout: `../camofox-browser`
- Default API URL: `http://localhost:9377`
- Default noVNC URL when enabled: `http://localhost:6080/vnc.html`
- Public noVNC route when managed by `lohzi-apps`: `https://vnc.lohzi.com/vnc.html?autoconnect=1&host=vnc.lohzi.com&port=443&encrypt=1&path=websockify`
- Preferred runtime: local source checkout started by `pty_spawn`

## Rules

1. Prefer semantic control through `snapshot`, `click`, `type`, `press`, `scroll`, and `wait` endpoints rather than screenshots.
2. Disable upstream telemetry for local runs unless the user explicitly wants it: `CAMOFOX_CRASH_REPORT_ENABLED=false`.
3. Reuse an already-running local server when health checks pass.
4. Use stable `userId` values so the same persistent browser profile is reused across runs. Do not randomize `userId` when persistent login matters. Prefer a generic persistent profile such as `general` unless the task explicitly needs site- or persona-specific isolation or stronger privacy separation.
5. Use stable `sessionKey` values within the same task so tabs and page state remain coherent.
6. When a snapshot is truncated, continue with `nextOffset` until `hasMore` is false.
7. If refs go stale after navigation or DOM mutation, refresh the snapshot before retrying.
8. If login, MFA, or CAPTCHA blocks progress, enable VNC and ask Master to complete the visual step rather than falling back silently.
9. On this host, the VNC plugin expects `/var/log/novnc.log` and `/var/log/x11vnc.log` to already exist and be writable by the current user. Do not patch upstream code just to change those paths; use the local prerequisite documented below instead.
10. If VNC is needed and the running server was started without `ENABLE_VNC=1`, stop it and restart cleanly with VNC enabled.
11. Do not assume a healthy `GET /health` response means VNC is healthy. If the task requires VNC, separately verify that noVNC is reachable and that helper startup did not fail.
12. If VNC is required, do a stale-process and stale-port preflight before startup or restart. Unexpected listeners on `5900` or `6080` usually mean leftover helpers; unexpected ownership of `9377` usually means a stale Camofox server. Clean those up before assuming reuse is safe.
13. For public human login/CAPTCHA/OAuth work, prefer the managed lifecycle: `lohzi-apps start vnc`, create the target tab, direct Master to the public noVNC URL, then `lohzi-apps stop vnc` when done.
14. For public VNC, websockify must bind to the Docker bridge gateway with `VNC_BIND=172.17.0.1`; default `127.0.0.1` only works locally and cannot be reached by nginx-proxy.
15. For VNC sessions that need human time, set `TAB_INACTIVITY_MS`, `SESSION_TIMEOUT_MS`, and `BROWSER_IDLE_TIMEOUT_MS` to a large positive value such as `3600000` (one hour). `TAB_INACTIVITY_MS=0` falls back to the 5-minute default in the current config parser.
16. Unless Master explicitly asks to keep the browser warm, always clean up the Camofox PTY first, then any leftover `Xvfb`, `x11vnc`, and `websockify` processes, and verify ports `9377`, `6080`, and `5900` are closed.
17. When the server fails to start or the API contract does not behave as documented, report it and pause instead of guessing.

## Startup Workflow

1. Check that the checkout exists at `../camofox-browser`.
2. Verify whether the server is already healthy:

```bash
curl -sf http://localhost:9377/health
```

3. If the task may require VNC, do a quick stale-port preflight before startup or restart. If `5900` or `6080` is already listening unexpectedly, or `9377` is occupied by an unintended prior run, treat that as stale state and clean up before proceeding.

4. If the task may require VNC on this host, ensure the required system packages are installed once:

```bash
sudo apt-get update && sudo apt-get install -y xvfb x11vnc novnc python3-websockify net-tools procps
```

5. Also ensure the local VNC log-file prerequisite exists once:

```bash
sudo install -o "$USER" -g "$USER" -m 600 /dev/null /var/log/novnc.log
sudo install -o "$USER" -g "$USER" -m 600 /dev/null /var/log/x11vnc.log
```

Do not loosen `/var/log` permissions and do not run Camofox as root.

6. If health fails, install dependencies from the checkout if needed:

```bash
npm install
```

7. Start the server with `pty_spawn` from `../camofox-browser`.
Use a local-only default such as:

```text
command: "npm"
args: ["start"]
workdir: "/home/<user>/camofox-browser"
env:
  CAMOFOX_CRASH_REPORT_ENABLED: "false"
  ENABLE_VNC: "1"   # only when a human login/CAPTCHA step is expected
  TAB_INACTIVITY_MS: "3600000"   # recommended for VNC login sessions
  SESSION_TIMEOUT_MS: "3600000"
  BROWSER_IDLE_TIMEOUT_MS: "3600000"
title: "Camofox Browser"
description: "Local camofox browser server"
```

8. Re-check health before using the API.
9. If VNC will be required, also verify that port `6080` is actually listening after startup; if helper startup failed, treat that as a VNC failure even if `/health` is green.
10. If reusing prior login state matters, keep the default persistent profile directory and reuse the same `userId` as previous runs.

## Operating Workflow

1. Create a tab with `POST /tabs` using a stable `userId` and `sessionKey`.
2. Read the page with `GET /tabs/:tabId/snapshot?userId=...`.
3. Interact using refs returned inside the snapshot, usually with:
   - `POST /tabs/:tabId/click`
   - `POST /tabs/:tabId/type`
   - `POST /tabs/:tabId/press`
   - `POST /tabs/:tabId/scroll`
   - `POST /tabs/:tabId/wait`
4. After any action that may change the DOM, refresh the snapshot.
5. For long pages, keep reading paginated snapshots until complete.
6. Close tabs or whole sessions when finished.
7. When login persistence is desired for future runs, prefer reusing the same `userId` first, then verify login state rather than assuming it restored successfully. Reusing the same `userId` improves the chance of restoring login state, but does not guarantee it.
8. Even after a successful human login in the current run, explicitly verify login state again after recreating sessions or starting a later run. Do not treat prior human success as proof that persistence restored.

## VNC Workflow

Use VNC only when a human-visible step is required.

1. For public access, start the managed app with `lohzi-apps start vnc`; for local-only access, start the server with `ENABLE_VNC=1` and do not set `VNC_BIND`.
2. Create or reuse the target session with the same persistent `userId` you intend to keep using later.
3. Verify that noVNC is actually reachable before asking Master to use it. For public access, check the local nginx route with `Host: vnc.lohzi.com` and confirm websockify listens on `172.17.0.1:6080`. For local-only access, check `http://localhost:6080/vnc.html`.
4. If Master is outside the Linux Mint machine, direct Master to `https://vnc.lohzi.com/vnc.html?autoconnect=1&host=vnc.lohzi.com&port=443&encrypt=1&path=websockify`; otherwise direct Master to `http://localhost:6080/vnc.html`.
5. Resume API-driven browsing after the human step is complete.
6. If noVNC loads but shows a black screen, suspect stale `Xvfb` / `x11vnc` / `websockify` processes or attachment to the wrong display. Restart cleanly instead of editing upstream code.
7. If the VNC watcher dies but the main browser stays healthy, treat that as a VNC failure. Clean up helper processes and restart rather than assuming the visual path still works.
8. If you had to start manual VNC helper processes as a recovery step, terminate them during cleanup as well.
9. For public VNC verification, the WebSocket probe through nginx should return `HTTP/1.1 101 Switching Protocols` followed by `RFB 003.008`.

## Files

- See [REFERENCE.md](REFERENCE.md) for endpoint and environment details.
- See [EXAMPLES.md](EXAMPLES.md) for common command sequences.
- See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for failure handling.
