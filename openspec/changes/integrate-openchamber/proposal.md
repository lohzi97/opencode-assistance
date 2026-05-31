## Why

The raw OpenCode web UI provides a functional but bare-bones browser interface with poor mobile UX. OpenChamber is a purpose-built web/PWA frontend for OpenCode (4.8k stars, actively maintained) that offers a mobile-first responsive design, visual diff viewer, branchable chat timeline, voice mode, and installable PWA. Replacing the raw OpenCode web UI with OpenChamber significantly improves the day-to-day interaction experience, especially from an Android phone.

## What Changes

- Add OpenChamber CLI as a new component installed alongside OpenCode via `./install.sh` and removed via `./uninstall.sh`.
- Run OpenChamber as a background daemon in `./start.sh`, connecting to the existing OpenCode backend via `OPENCODE_HOST` + `OPENCODE_SKIP_START=true`.
- Stop the OpenChamber daemon via `openchamber stop` in `./stop.sh`.
- Add an OpenChamber UI password to `./config.sh` and `config.env`, distinct from the existing OpenCode server password.
- Add `OPENCHAMBER_PORT` and `OPENCHAMBER_HOST` to `config.env` for port/host configuration (with sensible defaults).
- Update the Cloudflare tunnel documentation to reflect that `sebastian.lohzi.com` now points to OpenChamber instead of the raw OpenCode web UI.

## Capabilities

### New Capabilities
- `openchamber-service`: Install, configure, start, stop, and uninstall OpenChamber as a frontend layer for the existing OpenCode backend within the opencode-assistance lifecycle scripts.

### Modified Capabilities
<!-- No existing specs are being modified -->

## Impact

- **Scripts modified**: `install.sh`, `start.sh`, `stop.sh`, `uninstall.sh`, `config.sh`
- **Config files modified**: `.opencode/config.env.example`, `.opencode/config.env`
- **New dependency**: OpenChamber CLI (installed via `bun add -g @openchamber/web`, managed consistently with opencode, qmd, and agent-tui)
- **Existing OpenCode backend unchanged**: OpenChamber connects to it over localhost; no changes to the OpenCode serve command or tmux sessions
- **Cloudflare tunnel**: The user updates the `sebastian.lohzi.com` ingress rule in the Cloudflare Zero Trust dashboard to point to the OpenChamber port instead of the OpenCode port (manual, one-time change)
