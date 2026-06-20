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
CAMOFOX_CRASH_REPORT_ENABLED=false npm start
```

For PTY usage, spawn `npm start` in that directory and verify health again.

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

Run from `../camofox-browser`:

```bash
ENABLE_VNC=1 CAMOFOX_CRASH_REPORT_ENABLED=false npm start
```

If `5900`, `6080`, or `9377` is unexpectedly already in use before startup, clean up stale helpers or stale server state first rather than assuming safe reuse.

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

## 9. Close The Session

```bash
curl -X DELETE http://localhost:9377/sessions/general
```

## 10. Full Cleanup After Browser Work

Preferred order:

1. Kill the Camofox PTY session first.
2. Only if helpers remain, clean them up.
3. Verify ports are closed.

```bash
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
