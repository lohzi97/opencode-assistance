## ADDED Requirements

### Requirement: Install OpenChamber CLI
The `install.sh` script SHALL install OpenChamber by running `bun add -g @openchamber/web`. The install function SHALL be idempotent -- if `openchamber` is already found in PATH, it SHALL skip installation and log the existing location. The install function follows the same pattern as `install_opencode()`.

#### Scenario: Fresh installation
- **WHEN** `./install.sh` is run and `openchamber` is not found in PATH
- **THEN** `bun add -g @openchamber/web` is executed and `openchamber` is available in PATH

#### Scenario: Already installed
- **WHEN** `./install.sh` is run and `openchamber` is already present in PATH
- **THEN** a log message indicates OpenChamber is already installed and installation is skipped

### Requirement: Configure OpenChamber settings
The `config.sh` script SHALL prompt for three new configuration values: `OPENCHAMBER_PORT` (default 3000), `OPENCHAMBER_HOST` (default 127.0.0.1), and `OPENCHAMBER_UI_PASSWORD` (suggested default: the existing `OPENCODE_SERVER_PASSWORD`). These values SHALL be written to `.opencode/config.env`. The `config.env.example` template SHALL include placeholder entries for all three variables.

#### Scenario: First-time configuration
- **WHEN** `./config.sh` is run and `OPENCHAMBER_PORT`, `OPENCHAMBER_HOST`, and `OPENCHAMBER_UI_PASSWORD` are not yet in `config.env`
- **THEN** the script prompts for each value with its default and writes them to `config.env`

#### Scenario: Re-configuration
- **WHEN** `./config.sh` is run and values for `OPENCHAMBER_PORT`, `OPENCHAMBER_HOST`, or `OPENCHAMBER_UI_PASSWORD` already exist in `config.env`
- **THEN** the existing values are offered as defaults in the prompts

### Requirement: Start OpenChamber alongside OpenCode
The `start.sh` script SHALL start OpenChamber by running the command directly (not in a tmux session). OpenChamber daemonizes itself. The OpenChamber process SHALL be launched with `OPENCODE_HOST=http://127.0.0.1:<opencode_port> OPENCODE_SERVER_PASSWORD=<password> OPENCODE_SKIP_START=true openchamber --port <chamber_port> --host <chamber_host>` plus `--ui-password <password>` if configured. The script SHALL wait for OpenChamber to become healthy before reporting success.

#### Scenario: Fresh start with OpenChamber
- **WHEN** `./start.sh` is run and `openchamber` is available in PATH
- **THEN** two tmux sessions are created (`opencode-assistant-backend`, `opencode-assistant-worker`) and OpenChamber is started as a background daemon

#### Scenario: OpenChamber session already running
- **WHEN** `./start.sh` is run and OpenChamber is already running
- **THEN** the existing daemon is left as-is

#### Scenario: OpenChamber password not configured
- **WHEN** `OPENCHAMBER_UI_PASSWORD` is empty in `config.env`
- **THEN** OpenChamber starts without the `--ui-password` flag (runs unsecured)

### Requirement: Stop OpenChamber session
The `stop.sh` script SHALL stop OpenChamber using the `openchamber stop` command.

#### Scenario: OpenChamber running
- **WHEN** `./stop.sh` is run and `openchamber` is available in PATH
- **THEN** `openchamber stop` is executed to gracefully stop the OpenChamber daemon

#### Scenario: OpenChamber not available
- **WHEN** `./stop.sh` is run and `openchamber` is not found
- **THEN** the script proceeds without error (OpenChamber was never installed)

### Requirement: Uninstall OpenChamber
The `uninstall.sh` script SHALL remove OpenChamber via `bun remove -g @openchamber/web`, remove the binary from the user's home directory (following the opencode uninstall pattern), and remove the OpenChamber config/data directory at `~/.config/openchamber/`.

#### Scenario: OpenChamber installed via bun
- **WHEN** `./uninstall.sh` is run and OpenChamber was installed via `bun add -g @openchamber/web`
- **THEN** `bun remove -g @openchamber/web` is executed, the binary is removed from `~/.bun/bin/`, and `~/.config/openchamber/` is removed

#### Scenario: OpenChamber not installed
- **WHEN** `./uninstall.sh` is run and `openchamber` binary is not found
- **THEN** the script logs that OpenChamber was not found and continues

### Requirement: Start.sh reads OpenChamber config from config.env
The `start.sh` script SHALL read `OPENCHAMBER_PORT`, `OPENCHAMBER_HOST`, and `OPENCHAMBER_UI_PASSWORD` from `.opencode/config.env` in addition to the existing `BRAVE_API_KEY` and `OPENCODE_SERVER_PASSWORD`. If any OpenChamber variable is missing, sensible defaults SHALL be used (port 3000, host 127.0.0.1, no password).

#### Scenario: All OpenChamber config present
- **WHEN** `start.sh` reads `config.env` and finds all three `OPENCHAMBER_*` variables
- **THEN** OpenChamber starts with the configured values

#### Scenario: OpenChamber config missing
- **WHEN** `start.sh` reads `config.env` and finds none of the `OPENCHAMBER_*` variables
- **THEN** OpenChamber starts with defaults: port 3000, host 127.0.0.1, no password

### Requirement: Start.sh opens OpenChamber in browser
When the `--no-webui` flag is not set, `start.sh` SHALL open the OpenChamber URL in the default browser if `openchamber` is available. If `openchamber` is not available, it SHALL fall back to opening the raw OpenCode web UI.

#### Scenario: OpenChamber available
- **WHEN** `start.sh` finishes starting and `openchamber` is in PATH
- **THEN** `xdg-open` is called with `http://$OPENCHAMBER_HOST:$OPENCHAMBER_PORT`

#### Scenario: OpenChamber not available
- **WHEN** `start.sh` finishes starting and `openchamber` is not in PATH
- **THEN** `xdg-open` is called with the raw OpenCode web UI URL
