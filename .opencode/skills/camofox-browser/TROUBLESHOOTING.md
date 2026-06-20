# Camofox Browser Troubleshooting

## Health Check Fails

1. Confirm the checkout exists at `../camofox-browser`.
2. Ensure dependencies were installed with `npm install`.
3. Start the server from that directory with telemetry disabled:

```bash
CAMOFOX_CRASH_REPORT_ENABLED=false npm start
```

4. Re-check:

```bash
curl -sf http://localhost:9377/health
```

If the server still does not become healthy, report the failure and pause.

## VNC Log Permission Denied

If startup logs mention permission errors writing `/var/log/novnc.log` or `/var/log/x11vnc.log`, the safe local fix is:

```bash
sudo install -o "$USER" -g "$USER" -m 600 /dev/null /var/log/novnc.log
sudo install -o "$USER" -g "$USER" -m 600 /dev/null /var/log/x11vnc.log
```

Do not make `/var/log` writable to everyone and do not run Camofox as root just to satisfy logging.

## Install Or Startup Fails During Browser Download

- The Camoufox bundle is downloaded during install or first use.
- The first install may download several hundred MBs and in practice can exceed roughly `700MB`, plus additional data files such as GeoIP depending on version and platform.
- If the environment intentionally blocks downloads, use an external bundle via `CAMOUFOX_EXECUTABLE`.
- Do not guess alternative binary paths.

## 403 Errors

Likely causes:

- `CAMOFOX_ACCESS_KEY` is set and the request lacks `Authorization: Bearer ...`
- `CAMOFOX_API_KEY` is required for cookie import or protected storage export

If auth is enabled, include the correct bearer token or ask Master for the intended secret-handling path.

## Stale Or Missing Refs

- Refs are snapshot-local.
- Any major DOM change can invalidate them.
- Fetch a fresh snapshot, then retry the action with the new ref IDs.

## Snapshot Truncation

- This is expected on large pages.
- Continue reading with `offset=nextOffset` until `hasMore` is false.
- Do not assume the first snapshot contains the full page.

## Login, CAPTCHA, MFA, Or Human Checks

- Prefer `lohzi-apps start vnc` if Master needs public access through `vnc.lohzi.com`.
- Restart with `ENABLE_VNC=1` if visual access is needed and the managed app is not appropriate.
- Direct Master to `https://vnc.lohzi.com/vnc.html?autoconnect=1&host=vnc.lohzi.com&port=443&encrypt=1&path=websockify` for public access, or `http://localhost:6080/vnc.html` for local-only access.
- Resume API-driven browsing after the human step completes.
- Do not silently fall back to another browser workflow.
- Do not assume VNC is available just because `GET /health` is green; verify the helper ports and page reachability separately.

## VNC Watcher Exited But Camofox Is Still Healthy

- The main browser server can remain healthy even when VNC helper startup fails.
- If VNC is required, treat this as a VNC failure, not a success.
- Verify whether `6080` and `5900` are actually listening.
- Prefer full restart and helper cleanup over trying to continue blindly with a half-broken visual path.

## noVNC Opens But The Screen Is Black

Likely causes:

- tab was reaped by `TAB_INACTIVITY_MS` while noVNC/websockify stayed alive
- `x11vnc` attached to an old `Xvfb` display
- stale `Xvfb`, `x11vnc`, or `websockify` processes from an earlier failed run
- VNC helper processes survived while the main browser session changed displays

Recommended recovery:

1. Stop the Camofox PTY session.
2. Kill stale helper processes:

```bash
pkill -x x11vnc || true
pkill -f websockify || true
pkill -x Xvfb || true
```

These commands are broad. They are acceptable on a dedicated local development machine, but on a shared host prefer targeted PID cleanup.

3. Restart cleanly with `lohzi-apps restart vnc`, or manually with `ENABLE_VNC=1`, `VNC_BIND=172.17.0.1`, `TAB_INACTIVITY_MS=3600000`, `SESSION_TIMEOUT_MS=3600000`, and `BROWSER_IDLE_TIMEOUT_MS=3600000` for public access. For local-only access, omit `VNC_BIND` so noVNC binds to `127.0.0.1:6080`.
4. Recreate the target tab and ask Master to refresh noVNC.

Prefer a clean restart over ad-hoc manual reattachment unless you are already mid-recovery and need to salvage the current run.

## Port In Use Errors

If startup fails with `port in use` on `9377`, an old Camofox server is still running.
Kill the stale process and restart cleanly.

If `x11vnc` reports it could not obtain port `5900`, stale VNC helpers are still running. Kill `x11vnc` and `websockify`, then restart.

Broad `pkill` cleanup is acceptable on a dedicated local development machine, but on a shared host prefer targeted PID cleanup.

## Public noVNC Connect Fails

If `vnc.lohzi.com` loads but clicking Connect fails:

1. Verify nginx can reach the WebSocket path:

```bash
curl -si --max-time 3 -H "Host: vnc.lohzi.com" http://localhost:80/websockify \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=="
```

2. If the response is not `101`, inspect nginx and Cloudflare routing.
3. If the response is `101` followed by `Failed to connect to downstream server`, websockify is alive but x11vnc on `5900` is down; restart VNC.
4. If the response includes `RFB 003.008`, the backend path is healthy; ask Master to hard refresh the noVNC page.

Use the parameterized public URL so noVNC selects the correct public WebSocket endpoint:

```text
https://vnc.lohzi.com/vnc.html?autoconnect=1&host=vnc.lohzi.com&port=443&encrypt=1&path=websockify
```

## Login Did Not Persist Across Runs

- Reuse `userId=general`; that is part of the durable browser-profile identity.
- Keep the same `CAMOFOX_PROFILE_DIR`, normally `/home/linux-mint/.camofox/profiles` on this machine.
- Remember that durable login identity is `CAMOFOX_PROFILE_DIR + userId`; both values must match the previous run.
- Before stopping or restarting Camofox, call `DELETE /sessions/general` so the persistence plugin checkpoints storage.
- Verify login state after recreating a session; do not assume persistence restored successfully.
- Never invent, randomize, ask for, or switch `userId`; always use `general` unless Master explicitly changes this skill.

## Session Or Tab Disappeared After Login

- Some login flows may replace the current page, destroy the tab, or leave the original session empty.
- Recreate the tab or session with the same durable `userId` and then verify login state again.
- Do not switch to a fresh `userId`, or you will use a different persisted login/profile.
- After recovering from login, call `DELETE /sessions/general` before restart or cleanup to checkpoint the recovered state.

## Privacy Concerns

Upstream telemetry is enabled by default. For local use, start with:

```bash
CAMOFOX_CRASH_REPORT_ENABLED=false npm start
```

If the task explicitly requires telemetry, state that clearly in the report.

## When To Stop

Stop and report when:

- the server will not start
- health remains down
- auth requirements are unclear
- VNC is required but not reachable
- the API behavior materially differs from the documented contract
