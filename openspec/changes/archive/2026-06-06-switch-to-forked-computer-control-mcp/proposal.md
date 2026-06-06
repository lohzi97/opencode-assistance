## Why

The `computer-control` MCP server currently runs from the upstream PyPI package (`computer-control-mcp@latest` via `uvx`), which lacks the humanization behavior added in the forked repo (`lohzi97/computer-control-mcp`). The fork introduces human-like mouse/keyboard interactions to avoid bot detection when navigating browsers. Switching to the fork allows the opencode-assistance stack to use these enhancements while keeping the install/uninstall lifecycle consistent with other forked dependencies (qmd, google_workspace_mcp).

## What Changes

- Clone the forked `computer-control-mcp` repo (`lohzi97/computer-control-mcp`) as a sibling directory to `opencode-assistance` during `install.sh`.
- Run `uv sync` inside the cloned repo to prepare the virtual environment.
- Update `opencode.json` MCP config to launch the forked version via `uv run --directory ../computer-control-mcp` instead of `uvx ... computer-control-mcp@latest`.
- Add cleanup logic to `uninstall.sh` to remove the cloned repo directory.

## Capabilities

### New Capabilities

- `computer-control-mcp-fork-setup`: Manages the clone, install, and uninstall lifecycle of the forked `computer-control-mcp` repository as a local dependency of the opencode-assistance stack.

### Modified Capabilities

(none)

## Impact

- `install.sh` -- new function `install_computer_control_mcp()`, called from `main()`.
- `uninstall.sh` -- new cleanup step to remove the cloned repo directory.
- `opencode.json` -- `mcp.computer-control.command` changes from `uvx` to `uv run --directory`.
- Filesystem -- new directory `../computer-control-mcp` (sibling of project root).
