---
name: manage-public-apps
description: Start, stop, restart, or check existing lohzi.com public apps using lohzi-apps. Use when the user asks to turn on/off code.lohzi.com, finance.lohzi.com, property-invest.lohzi.com, public apps, exposed apps, or hosted local web apps.
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
- `gateway`: shared `nginx-proxy` Docker reverse proxy.
- `all`: shorthand for `code`, `finance`, and `property-invest`.

Keep `gateway` running by default. It is lightweight and shared by all app routes. Only stop `gateway` if the user explicitly asks to stop the shared gateway/nginx proxy itself.

## Commands

Status:

```bash
lohzi-apps status all
lohzi-apps status code
lohzi-apps status finance
lohzi-apps status property-invest
```

Start:

```bash
lohzi-apps start code
lohzi-apps start finance
lohzi-apps start property-invest
lohzi-apps start all
```

Stop:

```bash
lohzi-apps stop code
lohzi-apps stop finance
lohzi-apps stop property-invest
lohzi-apps stop all
```

Restart:

```bash
lohzi-apps restart code
lohzi-apps restart finance
lohzi-apps restart property-invest
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
```

Expected local route results:

- `code`: usually `302` because code-server redirects to login.
- `finance`: usually `302` if Fava redirects, or `200` depending on its current behavior.
- `property-invest`: usually `200`.

After stopping an app, the route should be disabled and `lohzi-apps status` should show `route=disabled`.

## Safety Notes

- Do not reveal code-server passwords or other secrets in the final response.
- Do not edit nginx configs manually for routine start/stop requests; use `lohzi-apps`.
- Do not start all apps unless the user asks for all apps or the request clearly implies it.
- Do not stop `sebastian.lohzi.com` or the OpenCode assistant stack unless explicitly requested; this skill is for optional public apps only.
