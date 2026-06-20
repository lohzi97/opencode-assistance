# Camofox Browser Reference

## Repository Facts

- Local checkout path: `../camofox-browser`
- Package entry: `server.js`
- Node requirement from `package.json`: `>=22`
- Default port: `9377`
- OpenAPI docs: `http://localhost:9377/docs`
- OpenAPI JSON: `http://localhost:9377/openapi.json`

## Recommended Local Defaults

Use these defaults unless the task requires otherwise:

- `CAMOFOX_CRASH_REPORT_ENABLED=false`
- no `CAMOFOX_ACCESS_KEY` for localhost-only use
- no `CAMOFOX_API_KEY` unless cookie import or protected storage export is needed
- `ENABLE_VNC=1` only for login or CAPTCHA tasks
- always use the same `CAMOFOX_PROFILE_DIR`, normally `/home/linux-mint/.camofox/profiles` on this machine
- always use exactly `userId=general` for reusable login state; never invent, randomize, ask for, or silently switch `userId`
- always call `DELETE /sessions/general` before stopping Camofox so cookies/storage are checkpointed

## Local VNC Prerequisite On This Host

Local VNC system packages required on this host:

```bash
sudo apt-get update && sudo apt-get install -y xvfb x11vnc novnc python3-websockify net-tools procps
```

The current VNC plugin writes logs to `/var/log/novnc.log` and `/var/log/x11vnc.log`.
When running locally as a normal user, pre-create only those files once:

```bash
sudo install -o "$USER" -g "$USER" -m 600 /dev/null /var/log/novnc.log
sudo install -o "$USER" -g "$USER" -m 600 /dev/null /var/log/x11vnc.log
```

This is the minimum safe local fix. Do not make `/var/log` globally writable and do not run the browser as root.

## Important Environment Variables

Core:

- `CAMOFOX_PORT`: API port, default `9377`
- `SESSION_TIMEOUT_MS`: session inactivity timeout
- `TAB_INACTIVITY_MS`: tab inactivity timeout, default `300000`; use a large positive value for VNC sessions
- `BROWSER_IDLE_TIMEOUT_MS`: browser shutdown after idle
- `MAX_SESSIONS`: concurrent session cap
- `MAX_TABS_PER_SESSION`: tab cap per session
- `MAX_OLD_SPACE_SIZE`: Node heap limit in MB

Security and auth:

- `CAMOFOX_ACCESS_KEY`: bearer auth for almost all routes
- `CAMOFOX_API_KEY`: enables cookie import and protects some session export flows
- `CAMOFOX_ADMIN_KEY`: needed for `POST /stop`

Persistence:

- `CAMOFOX_COOKIES_DIR`: default `~/.camofox/cookies`
- `CAMOFOX_PROFILE_DIR`: default `~/.camofox/profiles`; on this machine persistent work should explicitly preserve `/home/linux-mint/.camofox/profiles`
- `CAMOFOX_TRACES_DIR`: default `~/.camofox/traces`

VNC:

- `ENABLE_VNC=1`
- `VNC_BIND`: noVNC/websockify bind address; use `172.17.0.1` for nginx-proxy access on this host
- `VNC_PASSWORD`
- `NOVNC_PORT`, default `6080`

Public route on this host:

- `vnc.lohzi.com` proxies through nginx to `host.docker.internal:6080`.
- Start through `lohzi-apps start vnc` when possible.
- Manual one-hour VNC defaults are `ENABLE_VNC=1`, `VNC_BIND=172.17.0.1`, `TAB_INACTIVITY_MS=3600000`, `SESSION_TIMEOUT_MS=3600000`, and `BROWSER_IDLE_TIMEOUT_MS=3600000`.
- Public noVNC URL: `https://vnc.lohzi.com/vnc.html?autoconnect=1&host=vnc.lohzi.com&port=443&encrypt=1&path=websockify`.

Privacy:

- `CAMOFOX_CRASH_REPORT_ENABLED=false` disables upstream telemetry
- `CAMOFOX_CRASH_REPORT_URL` overrides the telemetry endpoint if telemetry is deliberately retained

## Session Model

- One browser instance can host many user sessions.
- Durable login identity is `CAMOFOX_PROFILE_DIR + userId`.
- Each `userId` maps to an isolated browser context with its own cookies and local storage under the configured profile directory.
- Each `sessionKey` groups related tabs within that user session; it is not the persistent login identity.
- Profiles persist under `CAMOFOX_PROFILE_DIR`, so repeated use of `userId=general` can preserve login state.
- Always use exactly `userId=general`. Do not ask Master for a `userId`, do not make one up, and do not use any alternative.
- Reusing the same `userId` is not enough if `CAMOFOX_PROFILE_DIR` changes; both values must remain stable.
- A different `userId` means a different isolated profile/state, even on the same Camofox server.

## Endpoints To Prefer

Lifecycle:

- `POST /tabs`
- `GET /tabs?userId=...`
- `DELETE /tabs/:tabId`
- `DELETE /sessions/general`

Interaction:

- `GET /tabs/:tabId/snapshot?userId=...`
- `POST /tabs/:tabId/click`
- `POST /tabs/:tabId/type`
- `POST /tabs/:tabId/press`
- `POST /tabs/:tabId/scroll`
- `POST /tabs/:tabId/wait`
- `POST /tabs/:tabId/navigate`
- `GET /tabs/:tabId/screenshot`

Data extraction:

- `GET /tabs/:tabId/links`
- `GET /tabs/:tabId/images`
- `GET /tabs/:tabId/downloads`
- `POST /tabs/:tabId/extract`

Server:

- `GET /health`
- `POST /start`
- `POST /stop`

## Snapshot Behavior

- Snapshots are accessibility-oriented text with element refs such as `e1`, `e2`, `e3`.
- Query `includeScreenshot=true` adds a base64 PNG when visual confirmation is needed.
- Large snapshots are paginated by character offset.
- The response exposes `truncated`, `totalChars`, `hasMore`, and `nextOffset`.
- When `hasMore` is true, call the same endpoint again with `offset=nextOffset`.

## Ref Handling

- Refs can become stale after navigation, reloads, or DOM-heavy updates.
- On stale or missing refs, get a fresh snapshot before retrying.
- Do not assume `e7` from one snapshot remains valid after a click or streamed page update.

## Search Macros

Useful macros include:

- `@google_search`
- `@youtube_search`
- `@amazon_search`
- `@reddit_search`
- `@reddit_subreddit`
- `@wikipedia_search`
- `@linkedin_search`

## Cleanup Guidance

- Close tabs you no longer need.
- Always checkpoint the `general` profile with `DELETE /sessions/general` before stopping or restarting Camofox.
- Confirm the delete call returns success before killing the PTY when login/session changes matter.
- Prefer session checkpoint first, then PTY cleanup, then kill any leftover helpers only if they remain.
- Unless Master explicitly wants the server left running, also ensure `Xvfb`, `x11vnc`, and `websockify` are gone and ports `9377`, `6080`, and `5900` are closed.

## VNC Preflight On Reuse Or Restart

- If VNC will be required, check for unexpected existing listeners on `5900` and `6080` before starting or restarting.
- If `9377` is already in use but not by the intended reusable Camofox PTY, suspect a stale server rather than safe reuse.
- Clean up stale helpers or stale server processes before assuming the next start will attach to the correct display.
- If using the public route, verify websockify listens on `172.17.0.1:6080`, not only `127.0.0.1:6080`.

## VNC Health Versus Browser Health

- A healthy `GET /health` response only confirms the main browser server is up.
- It does not guarantee that VNC helper processes started correctly.
- If VNC is required, verify noVNC reachability on `6080`, verify `5900` when `x11vnc` should be attached, and inspect helper startup if the screen is blank or the watcher exited.
- Public WebSocket verification through nginx should return `HTTP/1.1 101 Switching Protocols` and include `RFB 003.008`; a `101` followed by "Failed to connect to downstream server" means websockify is alive but x11vnc on `5900` is not.
