## Context

The opencode-assistance project runs OpenCode as a headless server (`opencode serve`) in a tmux session, with a worker process in a second tmux session. Users access the OpenCode web UI through a Cloudflare tunnel pointing `sebastian.lohzi.com` to `localhost:4096`. The raw web UI works but has poor mobile UX.

OpenChamber is a community-built web/PWA frontend for OpenCode that connects to the OpenCode server API over localhost. It does not replace the OpenCode backend -- it wraps it with a richer UI layer.

The project lifecycle is managed by four shell scripts: `install.sh`, `config.sh`, `start.sh` / `stop.sh`, and `uninstall.sh`. Configuration is stored in `.opencode/config.env` (templated from `.opencode/config.env.example`).

## Goals / Non-Goals

**Goals:**
- Install OpenChamber CLI as an additional component via `./install.sh`
- Run OpenChamber as a background daemon in `./start.sh`, connecting to the existing OpenCode backend
- Add OpenChamber-specific config (UI password, port, host) to `config.sh` / `config.env`
- Clean teardown via `./stop.sh` and `./uninstall.sh`
- Keep the existing OpenCode backend completely unchanged

**Non-Goals:**
- Replacing or modifying the OpenCode server itself
- Managing Cloudflare tunnel configuration programmatically (user updates the dashboard manually, one-time)
- OpenChamber tunnel management (not needed; existing tunnel handles it)
- Desktop or VS Code integration of OpenChamber

## Decisions

### 1. Install method: bun global package

**Choice**: Install via `bun add -g @openchamber/web`.

**Alternatives considered**:
- Official install script (`curl -fsSL ... install.sh | bash`) -- The script wraps Node.js detection and then installs via pnpm/bun/yarn/npm. Since bun is already a core dependency of this project, we cut out the middleman and install directly.
- `npm add -g @openchamber/web` -- bun is already the project standard; using npm would introduce an unnecessary secondary package manager.
- Docker -- OpenChamber supports Docker, but adding a second container alongside the existing brave-search container adds operational complexity for no real benefit in a single-user local setup.

**Rationale**: bun is already installed and used throughout the project. Installing OpenChamber as a bun global package keeps the dependency management consistent with opencode, qmd, and agent-tui (all installed via `bun add -g`). The install function follows the same idempotent pattern as `install_opencode()`.

### 2. Connection model: External OpenCode server

**Choice**: Run OpenChamber with `OPENCODE_HOST=http://127.0.0.1:<port> OPENCODE_SERVER_PASSWORD=<password> OPENCODE_SKIP_START=true openchamber --port <chamber_port> --host <chamber_host>`.

**Alternatives considered**:
- Let OpenChamber start its own OpenCode instance -- would duplicate the backend and conflict with the existing tmux session.

**Rationale**: OpenChamber connects to the already-running OpenCode backend. The `OPENCODE_SKIP_START=true` flag prevents OpenChamber from launching its own OpenCode process. `OPENCODE_SERVER_PASSWORD` is passed so OpenChamber can authenticate with the backend. This is the recommended pattern in the OpenChamber docs for connecting to an external server.

### 3. Config storage: Extend config.env with new variables

**Choice**: Add `OPENCHAMBER_PORT`, `OPENCHAMBER_HOST`, and `OPENCHAMBER_UI_PASSWORD` to `.opencode/config.env`.

**Alternatives considered**:
- Separate config file -- adds another file to manage; the existing pattern is a single `config.env`.
- OpenChamber config directory (`~/.config/openchamber/`) -- not needed since all config is passed via CLI flags and env vars.

**Rationale**: Consistent with the existing pattern. `config.sh` already manages secrets and config values in `config.env`. Adding three more variables is minimal.

### 4. Default port: 3000

**Choice**: Default OpenChamber to port 3000 (the OpenChamber default).

**Rationale**: Port 4096 is already used by OpenCode. Port 3000 is the OpenChamber convention and does not conflict with any existing service (brave-search is on 9999).

### 5. Auth: Reuse OpenCode server password as default for OpenChamber UI password

**Choice**: In `config.sh`, prompt for `OPENCHAMBER_UI_PASSWORD` with the existing `OPENCODE_SERVER_PASSWORD` as the suggested default.

**Rationale**: Users likely want the same password for both layers. Making it configurable separately allows for different passwords if desired, but the default suggestion reduces friction.

### 6. Stop mechanism: `openchamber stop`

**Choice**: Use the built-in `openchamber stop` command in `stop.sh`.

**Alternatives considered**:
- `tmux kill-session` -- not applicable since OpenChamber is not managed in a tmux session.

**Rationale**: OpenChamber daemonizes itself; `openchamber stop` is its built-in graceful shutdown command.

### 7. No tmux session for OpenChamber

**Choice**: Run `openchamber` directly (not in a tmux session). OpenChamber daemonizes itself.

**Rationale**: OpenChamber manages its own background process. Wrapping it in a tmux session is unnecessary. The backend and worker continue to use tmux as before.

### 8. Browser open: prefer OpenChamber URL

**Choice**: When `openchamber` is available, `start.sh` opens the OpenChamber URL in the browser instead of the raw OpenCode web UI.

**Rationale**: The whole point of integrating OpenChamber is to use it as the primary frontend. Opening the raw UI defeats that purpose.

## Risks / Trade-offs

- **OpenChamber is a third-party project** (not affiliated with OpenCode team) -> It is MIT-licensed, 4.8k stars, actively maintained (v1.11.7 as of May 2026). If it becomes unmaintained, the raw OpenCode web UI remains available as a fallback by simply pointing the tunnel back to port 4096.
- **OpenChamber is installed via bun global package** -> Managed consistently with opencode, qmd, and agent-tui. If the npm registry package is removed, the raw OpenCode web UI remains available.
- **OpenChamber runs as its own daemon** -> No tmux session needed; managed via `openchamber stop` for graceful shutdown.

## Migration Plan

1. User pulls the updated scripts.
2. Runs `./install.sh` (idempotent -- adds OpenChamber without touching existing components).
3. Runs `./config.sh` (prompts for the new `OPENCHAMBER_UI_PASSWORD`, port, host).
4. Runs `./start.sh` (starts OpenChamber daemon alongside the two existing tmux sessions).
5. Updates the Cloudflare dashboard ingress rule for `sebastian.lohzi.com` from `http://localhost:4096` to `http://localhost:3000` (manual, one-time).
6. Opens `sebastian.lohzi.com` in Chrome on Android and uses "Add to Home Screen" for PWA.

**Rollback**: Change the Cloudflare dashboard ingress rule back to `http://localhost:4096`. OpenChamber can be removed via `./uninstall.sh`.
