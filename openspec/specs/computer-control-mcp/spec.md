# computer-control-mcp Specification

## Purpose

Define the durable contract for integrating Master's forked computer-control-mcp repository into the opencode-assistance lifecycle scripts: cloning/syncing the fork, configuring the MCP entry in opencode.json, and uninstall cleanup.

## Requirements

### Requirement: Install the forked computer-control-mcp repo
`install.sh` SHALL include a function `install_computer_control_mcp()` that clones `git@github.com:lohzi97/computer-control-mcp.git` into `../computer-control-mcp` (relative to the project root) if not already present, or pulls the latest changes if the directory already exists. Git operations (clone and pull) SHALL use `run_as_user` to ensure correct file ownership. It SHALL then run `uv sync` inside the cloned directory to install dependencies. This function SHALL be called from the `main()` function in `install.sh`.

#### Scenario: Fresh clone on first install
- **WHEN** `install.sh` is run and `../computer-control-mcp/.git` does not exist
- **THEN** the repo is cloned via SSH into `../computer-control-mcp` and `uv sync` is executed inside it

#### Scenario: Pull latest on re-install
- **WHEN** `install.sh` is run and `../computer-control-mcp/.git` already exists
- **THEN** `git pull --ff-only` is executed in the repo directory and `uv sync` is executed; a warning is printed if the pull fails but installation continues

### Requirement: OpenCode launches the forked MCP via relative path
The `computer-control` MCP entry in `opencode.json` SHALL use `uv run --directory ../computer-control-mcp computer-control-mcp` as its command, replacing the previous `uvx --python 3.13 computer-control-mcp@latest` invocation.

#### Scenario: MCP server starts from forked code
- **WHEN** OpenCode starts the `computer-control` MCP server
- **THEN** it invokes `uv run --directory ../computer-control-mcp computer-control-mcp`, resolving the entry point from the fork's `pyproject.toml`

### Requirement: Uninstall removes the cloned repo
`uninstall.sh` SHALL remove the `../computer-control-mcp` directory using the existing `safe_remove_user_dir` helper. The planned actions summary at the top of `uninstall.sh` SHALL be updated to include this removal step.

#### Scenario: Uninstall cleans up cloned repo
- **WHEN** `uninstall.sh` is executed
- **THEN** the directory `../computer-control-mcp` is removed if it exists and is owned by the target user
