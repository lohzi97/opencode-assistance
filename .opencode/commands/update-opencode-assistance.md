---
description: Review changelogs and breaking changes for every opencode-assistance dependency, confirm versions with Master, then update via ./update.sh.
agent: sebastian
---

Safely update the opencode-assistance toolchain: judge first (changelogs, breaking changes), execute second (`./update.sh`).

## Steps

1. Run `./update.sh --status` from the repo root. Exit code 0 means everything is current: report and stop. Exit code 10 means updates are available.
2. From the status table, list the outdated components and their current -> latest versions.
3. Review changelogs for every outdated component with integration risk. Sources:
   - `opencode-ai`: GitHub releases for `sst/opencode` (range: current to latest).
   - `@openchamber/web`: resolve the repo via `npm view @openchamber/web` metadata, else search; it is wired into `start.sh`/`stop.sh` lifecycle (`openchamber stop`, self-daemonize, health wait), so flag ANY lifecycle/config/flag changes.
   - `agent-tui`: releases for `pproenca/agent-tui`; used by agent-tui/antigravity skills.
   - Git repos: `git -C <dir> log --oneline HEAD..@{u}` plus the upstream GitHub releases page. Watch for MCP tool signature changes, config format changes, and Python/Node version requirement bumps.
   - `imap-mcp-server`: MCP is disabled in `opencode.json`; skip its changelog unless re-enabled.
   - bun/uv/node/agy and apt packages: low integration risk; note major-version jumps only.
   Fetch via `curl` (GitHub API `/releases`) or webfetch; use shalltear only if those fail.
4. Present to Master with the question tool: the version table, breaking-change findings (quote the exact changelog lines), and your recommendation (update / pin via `--openchamber <version>` / skip a group). Map choices to flags: `--skip-tools`, `--skip-globals`, `--skip-repos`, `--skip-openchamber`. Do not offer apt as a choice; the agent never updates it (step 5).
5. Run `./update.sh --skip-apt` with the agreed flags. Agent shells cannot satisfy `sudo -v` (no TTY for the password prompt; the only NOPASSWD rule covers the opencode binary, not apt-get), so a run without `--skip-apt` aborts in Phase 1. Watch for `Step failed` warnings; investigate any before continuing.
6. Ask Master to run `sudo apt update && sudo apt upgrade` manually for any apt rows, and re-run `./update.sh --status` after Master confirms; expect exit 0, with apt rows pending until then. Other intentionally skipped items follow the same re-check.
7. Update `notes/projects/opencode-assistance.md`: bump `Last Updated` and record new component versions.
8. If `opencode-ai`, any MCP repo, or `@openchamber/web` changed, remind Master that the running stack still uses old binaries and offer the restart-opencode skill flow. Do not restart on your own initiative beyond that.

Keep the review factual: quote breaking-change lines with source links, no speculation.
