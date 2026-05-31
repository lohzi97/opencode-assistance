## 1. Config Infrastructure

- [x] 1.1 Add `OPENCHAMBER_PORT`, `OPENCHAMBER_HOST`, and `OPENCHAMBER_UI_PASSWORD` placeholder entries to `.opencode/config.env.example`
- [x] 1.2 Update `start.sh` to read the three new `OPENCHAMBER_*` variables from `config.env` (with defaults: port 3000, host 127.0.0.1, no password)

## 2. Install

- [x] 2.1 Add `install_openchamber()` function to `install.sh` that runs `bun add -g @openchamber/web`, is idempotent (checks `user_has_command openchamber`), and follows the opencode install pattern
- [x] 2.2 Add `install_openchamber` call to the `main()` function in `install.sh` (after `install_nvm_and_node`)

## 3. Start

- [x] 3.1 Run `openchamber` with `OPENCODE_HOST=http://127.0.0.1:$port OPENCODE_SERVER_PASSWORD=$password OPENCODE_SKIP_START=true openchamber --port $chamber_port --host $chamber_host` (plus `--ui-password` if configured); OpenChamber daemonizes itself, no tmux session needed
- [x] 3.2 Add health check for OpenChamber in `start.sh` (curl the OpenChamber port after the existing OpenCode health check)

## 4. Stop

- [x] 4.1 Add `openchamber stop` to `stop.sh` (no tmux session to manage for chamber)

## 5. Config

- [x] 5.1 Add prompts for `OPENCHAMBER_PORT`, `OPENCHAMBER_HOST`, and `OPENCHAMBER_UI_PASSWORD` to `config.sh` (load existing, prompt, write to `config.env`)
- [x] 5.2 Update `write_config_env()` in `config.sh` to template the three new variables

## 6. Uninstall

- [x] 6.1 Add OpenChamber removal to `uninstall.sh`: remove `~/.local/bin/openchamber` binary and `~/.config/openchamber/` directory
- [x] 6.2 Add OpenChamber to the planned actions summary and uninstall confirmation prompt in `uninstall.sh`

## 7. Verification

- [x] 7.1 Run `./install.sh` and verify `openchamber` is available via `bun add -g @openchamber/web` (binary at `~/.bun/bin/openchamber`)
- [x] 7.2 Run `./config.sh` and verify the three new config values are written to `.opencode/config.env`
- [x] 7.3 Run `./start.sh` and verify OpenChamber daemonizes and is accessible at the configured port, and browser opens the OpenChamber URL
- [x] 7.4 Run `./stop.sh` and verify `openchamber stop` is called and the two tmux sessions (backend, worker) are killed
- [x] 7.5 Run `./uninstall.sh -y` and verify `bun remove -g @openchamber/web` is executed, binary is removed from `~/.bun/bin/`, and `~/.config/openchamber/` is removed
