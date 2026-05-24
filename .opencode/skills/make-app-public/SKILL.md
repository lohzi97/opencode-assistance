---
name: make-app-public
description: Expose a local web app to the public internet via Cloudflare Tunnel and nginx reverse proxy at *.lohzi.com. Use when the user asks to make an app publicly accessible, expose a local service, or host a web app on a lohzi.com subdomain.
---

# Make App Public

## When to use me

Use this skill when the user wants to expose a local web app to the public internet on a `*.lohzi.com` subdomain. This covers static sites, single-page apps, and backend services running on localhost.

## Architecture Reference

The full architecture and setup details live in a single reference file. Read it first before executing any workflow:

**[cloudflare-tunnel-setup.md](../../../../notes/environment/cloudflare-tunnel-setup.md)**

Key facts from that document:

- cloudflared tunnel is **remotely managed** (token-based). Ingress rules are configured in the Cloudflare Zero Trust dashboard.
- nginx-proxy runs as a Docker container (`nginx:alpine`) bound to `127.0.0.1:80`.
- Tunnel wildcard ingress `*.lohzi.com` routes to `nginx-proxy`, which uses `server_name` virtual host routing.
- A catch-all `000-default.conf` returns 444 for unrecognized hostnames.
- Zero Trust policy protects all `*.lohzi.com` with email OTP.

## Rules

- Always confirm the subdomain name with the user before proceeding.
- Always add new server block configs to `~/nginx-proxy/conf.d/`.
- Always add new volume mounts to `~/nginx-proxy/docker-compose.yml`.
- Always test nginx config (`docker exec nginx-proxy nginx -t`) before reloading.
- Never modify the catch-all `000-default.conf` unless the user requests it.
- If the nginx-proxy container is not running, start it with `docker compose up -d` from `~/nginx-proxy/`.

## Workflow

### Step 1 -- Gather info

Ask the user (if not already provided):

- Subdomain name (e.g. `myapp` for `myapp.lohzi.com`).
- App type: static files (directory path) or backend service (localhost port).

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
        proxy_pass http://localhost:<port>;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### Step 3 -- Mount the app directory (static files only)

Edit `~/nginx-proxy/docker-compose.yml`. Add under `volumes`:

```yaml
- /home/linux-mint/<app-dir>:/var/www/<subdomain>:ro
```

Skip this step for backend service proxy.

### Step 4 -- Apply changes

```bash
# If docker-compose.yml changed (new volume mount):
docker compose up -d --force-recreate

# If only conf changed:
docker exec nginx-proxy nginx -t && docker exec nginx-proxy nginx -s reload
```

### Step 5 -- Verify locally

```bash
curl -s -o /dev/null -w "%{http_code}" -H "Host: <subdomain>.lohzi.com" http://localhost:80
# Should return 200
```

### Step 6 -- Confirm Cloudflare dashboard

If the wildcard `*.lohzi.com` tunnel ingress rule is already in place, no dashboard action is needed. Confirm with the user.

If not, instruct the user to add a public hostname in the Cloudflare Zero Trust dashboard (see reference doc for details).

### Step 7 -- Verify end-to-end

Ask the user to visit `https://<subdomain>.lohzi.com/` from a browser and confirm it loads.
