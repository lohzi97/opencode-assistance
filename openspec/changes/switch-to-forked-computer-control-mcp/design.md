## Context

The `computer-control` MCP server provides mouse, keyboard, OCR, and screenshot capabilities to OpenCode agents. It is currently launched via `uvx --python 3.13 computer-control-mcp@latest`, which resolves the upstream PyPI package at runtime. A forked version at `git@github.com:lohzi97/computer-control-mcp` adds humanization behavior (human-like mouse movements, randomized delays) that avoids bot detection during browser automation. This change switches the opencode-assistance stack from the upstream package to the forked repo.

The project already follows a pattern for forked local dependencies:
- `qmd` -- cloned to `~/qmd`, installed globally via `bun add -g`.
- `google_workspace_mcp` -- cloned to `../google_workspace_mcp`, launched via `uv run --directory ../google_workspace_mcp`.

The design follows the `google_workspace_mcp` pattern most closely, since both are Python projects launched via `uv run`.

## Goals / Non-Goals

**Goals:**
- Switch the `computer-control` MCP to use the forked repo with humanization behavior.
- Integrate the clone/install step into `install.sh` following existing patterns.
- Integrate cleanup into `uninstall.sh`.
- Update `opencode.json` to reference the local fork via relative path.
- Keep the change minimal and consistent with how other forked MCPs are managed.

**Non-Goals:**
- Modifying the forked `computer-control-mcp` code itself.
- Adding humanization configuration options (those live in the fork).
- Changing how other MCPs are configured or managed.

## Decisions

1. **Clone location: `../computer-control-mcp` (sibling directory)**
   - Follows the same pattern as `../google_workspace_mcp`.
   - Allows a relative path in `opencode.json` (`../computer-control-mcp`), avoiding hardcoded usernames.
   - Alternative considered: `~/computer-control-mcp` -- rejected because `opencode.json` would need an absolute path or `~` expansion (untested in MCP command fields).

2. **Launch via `uv run --directory ../computer-control-mcp computer-control-mcp`**
   - The fork's `pyproject.toml` defines the entry point `computer-control-mcp = "computer_control_mcp.cli:main"`.
   - `uv run --directory` resolves the project, creates/uses the venv, and invokes the entry point.
   - Replaces the current `uvx --python 3.13 computer-control-mcp@latest`.

3. **Install function: `install_computer_control_mcp()` in `install.sh`**
    - Clone via SSH (`git@github.com:lohzi97/computer-control-mcp.git`) or pull if already cloned.
    - Git operations use `run_as_user` to ensure correct file ownership when the script runs under `sudo`.
    - Run `uv sync` to install dependencies into the project's `.venv`.
    - Follows the `install_workspace_mcp()` pattern, with `run_as_user` for git operations matching the `install_qmd()` pattern.

4. **Uninstall: remove `../computer-control-mcp` directory**
   - Use the existing `safe_remove_user_dir` helper in `uninstall.sh`.
   - Also mention in the planned actions summary at the top of the script.

5. **No changes to `config.sh`**
   - The forked MCP does not require API keys or credentials. No configuration step needed.

## Risks / Trade-offs

- **[Fork divergence]** The fork may fall behind the upstream. Mitigation: the fork is Master-controlled; updates are pulled manually or via `install.sh` re-run (which does `git pull --ff-only`).
- **[Disk space]** Cloning the repo adds ~local disk usage. Negligible for a Python project.
- **[uv sync on install]** First-time `uv sync` downloads dependencies. Mitigation: `uv` caches wheels globally, so subsequent runs are fast.
