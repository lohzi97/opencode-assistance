# Camofox Browser Examples

## 1. Start The Local Server

If VNC may be needed on this host, run this one-time prerequisite first:

```bash
sudo install -o "$USER" -g "$USER" -m 600 /dev/null /var/log/novnc.log
sudo install -o "$USER" -g "$USER" -m 600 /dev/null /var/log/x11vnc.log
```

Health check first:

```bash
curl -sf http://localhost:9377/health
```

If not healthy, run from `../camofox-browser`:

```bash
npm install
CAMOFOX_CRASH_REPORT_ENABLED=false CAMOFOX_PROFILE_DIR=/home/linux-mint/.camofox/profiles npm start
```

For PTY usage, spawn `npm start` in that directory and verify health again.

For persistent login work, always use the single durable identity `userId=general` in examples below. Do not ask for, invent, randomize, or substitute another `userId`. Keep `CAMOFOX_PROFILE_DIR` fixed at `/home/linux-mint/.camofox/profiles`.

```bash
export CAMOFOX_PROFILE_DIR=/home/linux-mint/.camofox/profiles
```

## 2. Open A Page

```bash
curl -X POST http://localhost:9377/tabs \
  -H 'Content-Type: application/json' \
  -d '{"userId":"general","sessionKey":"research","url":"https://example.com"}'
```

Response shape:

```json
{"tabId":"tab_123","url":"https://example.com/"}
```

## 3. Read A Snapshot

```bash
curl "http://localhost:9377/tabs/tab_123/snapshot?userId=general"
```

Typical result fields:

```json
{
  "url": "https://example.com/",
  "snapshot": "... [link e1] More information ...",
  "refsCount": 12,
  "truncated": false,
  "hasMore": false
}
```

## 4. Type And Submit

```bash
curl -X POST http://localhost:9377/tabs/tab_123/type \
  -H 'Content-Type: application/json' \
  -d '{"userId":"general","ref":"e1","text":"Research the tradeoffs of semantic browser automation for AI agents.","pressEnter":true}'
```

After typing or clicking, fetch a fresh snapshot.

## 5. Click A Ref

```bash
curl -X POST http://localhost:9377/tabs/tab_123/click \
  -H 'Content-Type: application/json' \
  -d '{"userId":"general","ref":"e2"}'
```

## 6. Read A Long Response

First page:

```bash
curl "http://localhost:9377/tabs/tab_123/snapshot?userId=general"
```

If the response includes `"hasMore": true` and `"nextOffset": 12000`, continue:

```bash
curl "http://localhost:9377/tabs/tab_123/snapshot?userId=general&offset=12000"
```

Repeat until `hasMore` becomes false.

## 7. Wait For A Selector Or Delay

```bash
curl -X POST http://localhost:9377/tabs/tab_123/wait \
  -H 'Content-Type: application/json' \
  -d '{"userId":"general","timeoutMs":2000}'
```

Use selector-based waits only when the expected selector is known.

## 8. Start With VNC For Human Login

Preferred on this host for public noVNC access:

```bash
lohzi-apps start vnc
lohzi-apps status vnc
```

Then direct Master to:

```text
https://vnc.lohzi.com/vnc.html?autoconnect=1&host=vnc.lohzi.com&port=443&encrypt=1&path=websockify
```

When finished, checkpoint the `general` profile before stopping VNC:

```bash
curl -X DELETE http://localhost:9377/sessions/general
lohzi-apps stop vnc
```

Manual public/server start (nginx-proxy can reach this because websockify binds to the Docker bridge gateway):

Run from `../camofox-browser`:

```bash
ENABLE_VNC=1 \
CAMOFOX_CRASH_REPORT_ENABLED=false \
CAMOFOX_PROFILE_DIR=/home/linux-mint/.camofox/profiles \
VNC_BIND=172.17.0.1 \
TAB_INACTIVITY_MS=3600000 \
SESSION_TIMEOUT_MS=3600000 \
BROWSER_IDLE_TIMEOUT_MS=3600000 \
npm start
```

If `5900`, `6080`, or `9377` is unexpectedly already in use before startup, clean up stale helpers or stale server state first rather than assuming safe reuse.

Then direct Master to:

```text
https://vnc.lohzi.com/vnc.html?autoconnect=1&host=vnc.lohzi.com&port=443&encrypt=1&path=websockify
```

Manual local-only start (localhost access, not public nginx access):

```bash
ENABLE_VNC=1 \
CAMOFOX_CRASH_REPORT_ENABLED=false \
CAMOFOX_PROFILE_DIR=/home/linux-mint/.camofox/profiles \
TAB_INACTIVITY_MS=3600000 \
SESSION_TIMEOUT_MS=3600000 \
BROWSER_IDLE_TIMEOUT_MS=3600000 \
npm start
```

Then direct Master to:

```text
http://localhost:6080/vnc.html
```

Create the login session before asking Master to use VNC:

```bash
curl -X POST http://localhost:9377/tabs \
  -H 'Content-Type: application/json' \
  -d '{"userId":"general","sessionKey":"login","url":"https://target-site.example/login"}'
```

If noVNC shows a black screen, stop stale helpers and restart cleanly instead of patching code:

```bash
pkill -x x11vnc || true
pkill -f websockify || true
pkill -x Xvfb || true
```

These `pkill` commands are broad. They are acceptable on a dedicated local development machine, but on a shared host prefer targeted PID cleanup.

Verify public WebSocket path through nginx:

```bash
curl -si --max-time 3 -H "Host: vnc.lohzi.com" http://localhost:80/websockify \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=="
```

Expected output starts with `HTTP/1.1 101 Switching Protocols` and includes `RFB 003.008`.

## 9. Close The Session

Always close the session through the API before stopping Camofox. This checkpoints cookies and storage for `userId=general`.

```bash
curl -X DELETE http://localhost:9377/sessions/general
```

## 10. Full Cleanup After Browser Work

Preferred order:

1. Call `DELETE /sessions/general` and verify success.
2. Kill the Camofox PTY session.
3. Only if helpers remain, clean them up.
4. Verify ports are closed.

```bash
curl -X DELETE http://localhost:9377/sessions/general || true
pkill -f "node server.js" || true
pkill -x x11vnc || true
pkill -f websockify || true
pkill -x Xvfb || true
python3 - <<'PY'
import socket
for port in (9377, 6080, 5900):
    s = socket.socket()
    s.settimeout(0.5)
    try:
        s.connect(('127.0.0.1', port))
        print(f'{port}: open')
    except Exception:
        print(f'{port}: closed')
    finally:
        s.close()
PY
```

These cleanup commands are broad. They are acceptable on a dedicated local development machine, but on a shared host prefer targeted PID cleanup.
