---
name: manage-public-apps
description: Start, stop, restart, or check existing lohzi.com public apps using lohzi-apps. Use when the user asks to turn on/off code.lohzi.com, finance.lohzi.com, property-invest.lohzi.com, vnc.lohzi.com, public apps, exposed apps, or hosted local web apps.
---

# Manage Public Apps

## When To Use

Use this skill when the user wants to manage existing `*.lohzi.com` apps that are already configured behind Cloudflare Tunnel and nginx.

Trigger examples:

- "start code.lohzi.com"
- "turn off finance"
- "is the property investing app running?"
- "stop all public apps"
- "bring up my browser code editor"
- "start vnc.lohzi.com"
- "turn on noVNC for camofox login"
- "shut down exposed apps"
- "check what lohzi apps are running"

Do not use this skill to expose a brand-new app. For new public routes, use `make-app-public` instead.

## Source Of Truth

Read operational context from:

- `notes/environment/cloudflare-tunnel-setup.md`
- `notes/projects/opencode-assistance.md`

The control command is:

```bash
lohzi-apps
```

It manages optional app services and their nginx routes.

## Managed Apps

- `code`: `code.lohzi.com`, code-server browser editor.
- `finance`: `finance.lohzi.com`, Fava finance dashboard.
- `property-invest`: `property-invest.lohzi.com`, static property investing app route.
- `vnc`: `vnc.lohzi.com`, camofox noVNC for temporary human login/CAPTCHA/OAuth work.
- `gateway`: shared `nginx-proxy` Docker reverse proxy.
- `all`: for `start`/`restart`, shorthand for `code`, `finance`, and `property-invest`; it intentionally does not start `vnc`. For `status`/`stop`, it includes `vnc` so passwordless noVNC is not overlooked or left running.

Keep `gateway` running by default. It is lightweight and shared by all app routes. Only stop `gateway` if the user explicitly asks to stop the shared gateway/nginx proxy itself.

## Commands

Status:

```bash
lohzi-apps status all
lohzi-apps status code
lohzi-apps status finance
lohzi-apps status property-invest
lohzi-apps status vnc
```

Start:

```bash
lohzi-apps start code
lohzi-apps start finance
lohzi-apps start property-invest
lohzi-apps start vnc
lohzi-apps start all
```

Stop:

```bash
lohzi-apps stop code
lohzi-apps stop finance
lohzi-apps stop property-invest
lohzi-apps stop vnc
lohzi-apps stop all
```

Restart:

```bash
lohzi-apps restart code
lohzi-apps restart finance
lohzi-apps restart property-invest
lohzi-apps restart vnc
lohzi-apps restart all
```

## Workflow

1. Map the user's natural-language request to an app name and action.
2. If the app or action is ambiguous, ask one concise clarification question.
3. Run the appropriate `lohzi-apps` command.
4. Run `lohzi-apps status <app-or-all>` afterward to verify the final state.
5. Report the result briefly, including the public URL when starting an app.

## Verification Expectations

For status-only requests, `lohzi-apps status ...` is sufficient.

After starting an app, optionally verify the local route if useful:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: code.lohzi.com" http://127.0.0.1:80/
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: finance.lohzi.com" http://127.0.0.1:80/
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: property-invest.lohzi.com" http://127.0.0.1:80/
curl -s -o /dev/null -w "%{http_code}\n" -H "Host: vnc.lohzi.com" http://127.0.0.1:80/vnc.html
```

Expected local route results:

- `code`: usually `302` because code-server redirects to login.
- `finance`: usually `302` if Fava redirects, or `200` depending on its current behavior.
- `property-invest`: usually `200`.
- `vnc`: `200` for `/vnc.html`; `lohzi-apps status vnc` should report `api=up novnc=up vnc=up`; WebSocket verification should return `101` plus the `RFB 003.008` downstream VNC banner.

After stopping an app, the route should be disabled and `lohzi-apps status` should show `route=disabled`.

## Safety Notes

- Do not reveal code-server passwords or other secrets in the final response.
- Do not start `vnc` via `all`; start it only when explicitly requested because the noVNC endpoint is passwordless behind Cloudflare Access. `status all` and `stop all` may include `vnc` for safety.
- Do not edit nginx configs manually for routine start/stop requests; use `lohzi-apps`.
- Do not start all apps unless the user asks for all apps or the request clearly implies it.
- Do not stop `sebastian.lohzi.com` or the OpenCode assistant stack unless explicitly requested; this skill is for optional public apps only.
