---
name: make-app-public
description: Expose a local web app to the public internet via Cloudflare Tunnel and nginx reverse proxy at *.lohzi.com. Use when the user asks to make an app publicly accessible, expose a local service, or host a web app on a lohzi.com subdomain.
---

# Make App Public

## When to use me

Use this skill when the user wants to expose a local web app to the public internet on a `*.lohzi.com` subdomain. This covers static sites, single-page apps, and backend services running on the host machine.

## Architecture Reference

The full architecture and setup details live in a single reference file. Read it first before executing any workflow:

**[cloudflare-tunnel-setup.md](../../../../notes/environment/cloudflare-tunnel-setup.md)**

Key facts from that document:

- cloudflared tunnel is **remotely managed** (token-based). Ingress rules are configured in the Cloudflare Zero Trust dashboard.
- nginx-proxy runs as a Docker container (`nginx:alpine`) bound to `127.0.0.1:80`.
- Tunnel wildcard ingress `*.lohzi.com` routes to `nginx-proxy`, which uses `server_name` virtual host routing.
- A catch-all `000-default.conf` returns 444 for unrecognized hostnames.
- Zero Trust policy protects all `*.lohzi.com` with email OTP.
- Optional apps should usually be managed on demand with `lohzi-apps` instead of left running 24/7.

## Rules

- Always confirm the subdomain name with the user before proceeding.
- Always add new server block configs to `~/nginx-proxy/conf.d/`.
- Add new volume mounts to `~/nginx-proxy/docker-compose.yml` only for static-file apps that need nginx container filesystem access.
- Always test nginx config (`docker exec nginx-proxy nginx -t`) before reloading.
- Never modify the catch-all `000-default.conf` unless the user requests it.
- If the nginx-proxy container is not running, start it with `docker compose up -d` from `~/nginx-proxy/`.
- For backend services running on the host, proxy to `http://host.docker.internal:<port>`, not `http://localhost:<port>`, because nginx runs inside Docker.
- For WebSocket services, include `proxy_http_version 1.1` plus `Upgrade` and `Connection` headers, and verify an actual WebSocket upgrade when possible.
- Ask whether the app should be always-on or on-demand. Prefer on-demand unless the user explicitly wants 24/7 availability.
- For on-demand apps, add lifecycle support to `~/.local/bin/lohzi-apps` after creating the nginx route and service/static route.
- For noVNC/camofox-style services, prefer a managed lifecycle entry rather than leaving a passwordless browser-control service running; on this host `vnc.lohzi.com` is already managed by `lohzi-apps vnc`.

## Workflow

### Step 1 -- Gather info

Ask the user (if not already provided):

- Subdomain name (e.g. `myapp` for `myapp.lohzi.com`).
- App type: static files (directory path) or backend service (host-local port).
- Lifecycle preference: on-demand (recommended) or always-on.
- For backend services: exact start/stop commands, working directory, required environment variables, and intended bind host/port.

### Step 2 -- Create nginx server block

Create `~/nginx-proxy/conf.d/<subdomain>.conf`.

**For static files** (app directory on this machine):

```nginx
server {
    listen 80;
    server_name <subdomain>.lohzi.com;

    root /var/www/<subdomain>;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

**For a backend service** (running on a local port):

```nginx
server {
    listen 80;
    server_name <subdomain>.lohzi.com;

    location / {
        proxy_pass http://host.docker.internal:<port>;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

For host backend services that should only be reachable by nginx-proxy, prefer binding them to the Docker bridge gateway (commonly `172.17.0.1`) instead of `0.0.0.0`.

For noVNC/websockify specifically, bind the websockify/noVNC port to the Docker bridge gateway (for example `VNC_BIND=172.17.0.1`) so `nginx-proxy` can reach it through `host.docker.internal` without exposing the noVNC port on normal LAN interfaces.

### Step 3 -- Mount the app directory (static files only)

Edit `~/nginx-proxy/docker-compose.yml`. Add under `volumes`:

```yaml
- /home/linux-mint/<app-dir>:/var/www/<subdomain>:ro
```

Skip this step for backend service proxy.

### Step 4 -- Add lifecycle controls

For static apps, add `<subdomain>` to `~/.local/bin/lohzi-apps` so `start` enables the nginx config and `stop` moves it to `~/nginx-proxy/conf.disabled/`.

For backend apps, create a user systemd service under `~/.config/systemd/user/<app>.service` when there is no existing supervisor. Then add `lohzi-apps` handlers so:

- `lohzi-apps start <app>` enables the nginx route and starts the service.
- `lohzi-apps stop <app>` stops the service and disables the nginx route.
- `lohzi-apps status <app>` reports service and route state.

Do not enable user-service autostart unless the user asked for an always-on app.

### Step 5 -- Apply changes

```bash
# If docker-compose.yml changed (new volume mount):
docker compose up -d --force-recreate

# If only conf changed:
docker exec nginx-proxy nginx -t && docker exec nginx-proxy nginx -s reload
```

For on-demand apps, verify the lifecycle command too:

```bash
lohzi-apps start <app>
lohzi-apps status <app>
lohzi-apps stop <app>
```

### Step 6 -- Verify locally

```bash
curl -s -o /dev/null -w "%{http_code}" -H "Host: <subdomain>.lohzi.com" http://localhost:80
# Should return 200
```

For routes that redirect to login or auth, `302` can also be a valid local result.

For WebSocket routes, also verify the upgrade path. Example:

```bash
curl -si --max-time 3 -H "Host: <subdomain>.lohzi.com" http://localhost:80/websockify \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=="
```

For noVNC routes, `HTTP/1.1 101 Switching Protocols` confirms nginx/WebSocket handling; `RFB 003.008` confirms the downstream VNC backend is alive.

### Step 7 -- Confirm Cloudflare dashboard

If the wildcard `*.lohzi.com` tunnel ingress rule is already in place, no dashboard action is needed. Confirm with the user.

If not, instruct the user to add a public hostname in the Cloudflare Zero Trust dashboard (see reference doc for details).

### Step 8 -- Verify end-to-end

Ask the user to visit `https://<subdomain>.lohzi.com/` from a browser and confirm it loads.

### Step 9 -- Document

Update the relevant project note and `notes/environment/cloudflare-tunnel-setup.md` with the subdomain, route target, service/lifecycle behavior, and `lohzi-apps` command if applicable. Update `notes/README.md` only when the note summary changes.
