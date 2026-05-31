## 1. Config Infrastructure

- [x] 1.1 Add `OPENCHAMBER_PORT`, `OPENCHAMBER_HOST`, and `OPENCHAMBER_UI_PASSWORD` placeholder entries to `.opencode/config.env.example`
- [x] 1.2 Update `start.sh` to read the three new `OPENCHAMBER_*` variables from `config.env` (with defaults: port 3000, host 127.0.0.1, no password)

## 2. Install

- [x] 2.1 Add `install_openchamber()` function to `install.sh` that runs the official OpenChamber install script, is idempotent (checks `~/.local/bin/openchamber`), and verifies Node.js 20+ is available
- [x] 2.2 Add `install_openchamber` call to the `main()` function in `install.sh` (after `install_nvm_and_node`)

## 3. Start

- [x] 3.1 Add `opencode-assistant-chamber` tmux session to `start.sh` that runs `OPENCODE_HOST=http://localhost:$port OPENCODE_SKIP_START=true openchamber --port $chamber_port --host $chamber_host` (plus `--ui-password` if configured)
- [x] 3.2 Add health check for OpenChamber in `start.sh` (curl the OpenChamber port after the existing OpenCode health check)

## 4. Stop

- [x] 4.1 Add `tmux kill-session -t opencode-assistant-chamber` to `stop.sh`

## 5. Config

- [x] 5.1 Add prompts for `OPENCHAMBER_PORT`, `OPENCHAMBER_HOST`, and `OPENCHAMBER_UI_PASSWORD` to `config.sh` (load existing, prompt, write to `config.env`)
- [x] 5.2 Update `write_config_env()` in `config.sh` to template the three new variables

## 6. Uninstall

- [x] 6.1 Add OpenChamber removal to `uninstall.sh`: remove `~/.local/bin/openchamber` binary and `~/.config/openchamber/` directory
- [x] 6.2 Add OpenChamber to the planned actions summary and uninstall confirmation prompt in `uninstall.sh`

## 7. Verification

- [ ] 7.1 Run `./install.sh` and verify `openchamber` is available at `~/.local/bin/openchamber`
- [ ] 7.2 Run `./config.sh` and verify the three new config values are written to `.opencode/config.env`
- [ ] 7.3 Run `./start.sh` and verify all three tmux sessions are created and OpenChamber is accessible at the configured port
- [ ] 7.4 Run `./stop.sh` and verify all three sessions are killed
- [ ] 7.5 Run `./uninstall.sh -y` and verify `openchamber` binary and config directory are removed
