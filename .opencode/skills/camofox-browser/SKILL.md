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
- Persistent profile root: always use the same `CAMOFOX_PROFILE_DIR`, normally `/home/linux-mint/.camofox/profiles` on this machine.
- Persistent profile identity: always use exactly `userId=general`. Never invent, randomize, ask for, or silently switch `userId`.

## Rules

1. Prefer semantic control through `snapshot`, `click`, `type`, `press`, `scroll`, and `wait` endpoints rather than screenshots.
2. Disable upstream telemetry for local runs unless the user explicitly wants it: `CAMOFOX_CRASH_REPORT_ENABLED=false`.
3. Reuse an already-running local server when health checks pass.
4. Treat `CAMOFOX_PROFILE_DIR + userId` as the durable browser profile identity. For reusable login state, both values MUST stay the same every time.
5. Always use exactly `userId=general` for every Camofox task. Do not ask Master for a `userId`, do not make one up, and do not use any alternative.
6. Always set or preserve the same `CAMOFOX_PROFILE_DIR` for persistent work. On this machine, use `/home/linux-mint/.camofox/profiles`.
7. Always call `DELETE /sessions/general` before stopping Camofox, killing the PTY, or cleaning helper processes. This checkpoints cookies/storage; hard-killing first can lose newly acquired login state.
8. Use stable `sessionKey` values within the same task so tabs and page state remain coherent. `sessionKey` is not the durable login identity; `userId` is.
9. When a snapshot is truncated, continue with `nextOffset` until `hasMore` is false.
10. If refs go stale after navigation or DOM mutation, refresh the snapshot before retrying.
11. If login, MFA, or CAPTCHA blocks progress, enable VNC and ask Master to complete the visual step rather than falling back silently.
12. On this host, the VNC plugin expects `/var/log/novnc.log` and `/var/log/x11vnc.log` to already exist and be writable by the current user. Do not patch upstream code just to change those paths; use the local prerequisite documented below instead.
13. If VNC is needed and the running server was started without `ENABLE_VNC=1`, first checkpoint the active session with `DELETE /sessions/general`, then stop it and restart cleanly with VNC enabled.
14. Do not assume a healthy `GET /health` response means VNC is healthy. If the task requires VNC, separately verify that noVNC is reachable and that helper startup did not fail.
15. If VNC is required, do a stale-process and stale-port preflight before startup or restart. Unexpected listeners on `5900` or `6080` usually mean leftover helpers; unexpected ownership of `9377` usually means a stale Camofox server. Clean those up before assuming reuse is safe.
16. For public human login/CAPTCHA/OAuth work, prefer the managed lifecycle: `lohzi-apps start vnc`, create the target tab with `userId=general`, direct Master to the public noVNC URL, then checkpoint with `DELETE /sessions/general` and stop VNC when done.
17. For public VNC, websockify must bind to the Docker bridge gateway with `VNC_BIND=172.17.0.1`; default `127.0.0.1` only works locally and cannot be reached by nginx-proxy.
18. For VNC sessions that need human time, set `TAB_INACTIVITY_MS`, `SESSION_TIMEOUT_MS`, and `BROWSER_IDLE_TIMEOUT_MS` to a large positive value such as `3600000` (one hour). `TAB_INACTIVITY_MS=0` falls back to the 5-minute default in the current config parser.
19. Unless Master explicitly asks to keep the browser warm, checkpoint with `DELETE /sessions/general`, then clean up the Camofox PTY, then any leftover `Xvfb`, `x11vnc`, and `websockify` processes, and verify ports `9377`, `6080`, and `5900` are closed.
20. When the server fails to start or the API contract does not behave as documented, report it and pause instead of guessing.

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
  CAMOFOX_PROFILE_DIR: "/home/linux-mint/.camofox/profiles"
  ENABLE_VNC: "1"   # only when a human login/CAPTCHA step is expected
  TAB_INACTIVITY_MS: "3600000"   # recommended for VNC login sessions
  SESSION_TIMEOUT_MS: "3600000"
  BROWSER_IDLE_TIMEOUT_MS: "3600000"
title: "Camofox Browser"
description: "Local camofox browser server"
```

8. Re-check health before using the API.
9. If VNC will be required, also verify that port `6080` is actually listening after startup; if helper startup failed, treat that as a VNC failure even if `/health` is green.
10. Before creating tabs, set `userId=general`. There is no per-task `userId` selection.
11. If reusing prior login state matters, use the same `CAMOFOX_PROFILE_DIR` and `userId=general` as previous runs.

## Operating Workflow

1. Use `userId=general` before creating any tab. Do not use placeholders, random strings, convenience values, or account-specific values.
2. Create a tab with `POST /tabs` using `userId=general` and a task-appropriate `sessionKey`.
3. Read the page with `GET /tabs/:tabId/snapshot?userId=...`.
4. Interact using refs returned inside the snapshot, usually with:
   - `POST /tabs/:tabId/click`
   - `POST /tabs/:tabId/type`
   - `POST /tabs/:tabId/press`
   - `POST /tabs/:tabId/scroll`
   - `POST /tabs/:tabId/wait`
5. After any action that may change the DOM, refresh the snapshot.
6. For long pages, keep reading paginated snapshots until complete.
7. When finished with a profile, call `DELETE /sessions/general` and verify the response before stopping Camofox.
8. When login persistence is desired for future runs, reuse the same `CAMOFOX_PROFILE_DIR` and `userId=general`, then verify login state rather than assuming it restored successfully.
9. Even after a successful human login in the current run, explicitly verify login state again after recreating sessions or starting a later run. Do not treat prior human success as proof that persistence restored.

## VNC Workflow

Use VNC only when a human-visible step is required.

1. For public access, start the managed app with `lohzi-apps start vnc`; for local-only access, start the server with `ENABLE_VNC=1` and do not set `VNC_BIND`.
2. Create or reuse the target session with `userId=general`.
3. Verify that noVNC is actually reachable before asking Master to use it. For public access, check the local nginx route with `Host: vnc.lohzi.com` and confirm websockify listens on `172.17.0.1:6080`. For local-only access, check `http://localhost:6080/vnc.html`.
4. If Master is outside the Linux Mint machine, direct Master to `https://vnc.lohzi.com/vnc.html?autoconnect=1&host=vnc.lohzi.com&port=443&encrypt=1&path=websockify`; otherwise direct Master to `http://localhost:6080/vnc.html`.
5. Resume API-driven browsing after the human step is complete.
6. After login or CAPTCHA completion, verify the login state and call `DELETE /sessions/general` before stopping or restarting Camofox so the new cookies/storage are checkpointed.
7. If noVNC loads but shows a black screen, suspect stale `Xvfb` / `x11vnc` / `websockify` processes or attachment to the wrong display. Restart cleanly instead of editing upstream code.
8. If the VNC watcher dies but the main browser stays healthy, treat that as a VNC failure. Clean up helper processes and restart rather than assuming the visual path still works.
9. If you had to start manual VNC helper processes as a recovery step, terminate them during cleanup as well.
10. For public VNC verification, the WebSocket probe through nginx should return `HTTP/1.1 101 Switching Protocols` followed by `RFB 003.008`.

## Files

- See [REFERENCE.md](REFERENCE.md) for endpoint and environment details.
- See [EXAMPLES.md](EXAMPLES.md) for common command sequences.
- See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for failure handling.
