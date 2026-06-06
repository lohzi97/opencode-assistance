## 1. install.sh

- [x] 1.1 Add `COMPUTER_CONTROL_MCP_REPO` and `COMPUTER_CONTROL_MCP_DIR` variables (repo: `git@github.com:lohzi97/computer-control-mcp.git`, dir: `${PROJECT_ROOT}/../computer-control-mcp`)
- [x] 1.2 Add `install_computer_control_mcp()` function: clone or pull the fork (via `run_as_user`), then run `uv sync`
- [x] 1.3 Add `install_computer_control_mcp` call to `main()` (after `install_workspace_mcp`, before `install_qmd`)
- [x] 1.4 Add comment in the header section noting computer-control-mcp as a required forked dependency

## 2. opencode.json

- [x] 2.1 Update `mcp.computer-control.command` from `["uvx", "--python", "3.13", "computer-control-mcp@latest"]` to `["uv", "run", "--directory", "../computer-control-mcp", "computer-control-mcp"]`

## 3. uninstall.sh

- [x] 3.1 Add removal of `../computer-control-mcp` directory using `safe_remove_user_dir` (after the imap-mcp-server cleanup section)
- [x] 3.2 Update the planned actions summary at the top of the script to include computer-control-mcp repo removal

## 4. Verification

- [x] 4.1 Restart the opencode-assistance stack and confirm the `computer-control` MCP starts successfully from the forked repo
