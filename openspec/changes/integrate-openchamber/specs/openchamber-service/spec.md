## ADDED Requirements

### Requirement: Install OpenChamber CLI
The `install.sh` script SHALL install the OpenChamber CLI binary by running its official install script. The install function SHALL be idempotent -- if `openchamber` is already found at `~/.local/bin/openchamber`, it SHALL skip installation and log that it is already present. The install function SHALL verify that Node.js 20+ is available before attempting installation.

#### Scenario: Fresh installation
- **WHEN** `./install.sh` is run and `openchamber` is not found at `~/.local/bin/openchamber`
- **THEN** the official OpenChamber install script is executed and `openchamber` is available at `~/.local/bin/openchamber`

#### Scenario: Already installed
- **WHEN** `./install.sh` is run and `openchamber` is already present at `~/.local/bin/openchamber`
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
The `start.sh` script SHALL start OpenChamber as a third tmux session named `opencode-assistant-chamber`. The OpenChamber process SHALL be launched with `OPENCODE_HOST=http://localhost:<opencode_port> OPENCODE_SKIP_START=true openchamber --port <chamber_port> --host <chamber_host>` plus `--ui-password <password>` if configured. The script SHALL wait for OpenChamber to become healthy before reporting success.

#### Scenario: Fresh start with all three sessions
- **WHEN** `./start.sh` is run and no tmux sessions exist
- **THEN** three tmux sessions are created: `opencode-assistant-backend`, `opencode-assistant-worker`, and `opencode-assistant-chamber`

#### Scenario: OpenChamber session already running
- **WHEN** `./start.sh` is run and `opencode-assistant-chamber` tmux session already exists
- **THEN** the existing session is left as-is (same behavior as existing backend/worker sessions)

#### Scenario: OpenChamber password not configured
- **WHEN** `OPENCHAMBER_UI_PASSWORD` is empty in `config.env`
- **THEN** OpenChamber starts without the `--ui-password` flag (runs unsecured)

### Requirement: Stop OpenChamber session
The `stop.sh` script SHALL kill the `opencode-assistant-chamber` tmux session in addition to the existing backend and worker sessions.

#### Scenario: All sessions running
- **WHEN** `./stop.sh` is run and all three tmux sessions are active
- **THEN** all three sessions (`opencode-assistant-chamber`, `opencode-assistant-worker`, `opencode-assistant-backend`) are killed

#### Scenario: OpenChamber not running
- **WHEN** `./stop.sh` is run and `opencode-assistant-chamber` does not exist
- **THEN** the script proceeds without error (idempotent, same as existing sessions)

### Requirement: Uninstall OpenChamber
The `uninstall.sh` script SHALL remove the `openchamber` binary from `~/.local/bin/openchamber` and remove the OpenChamber config/data directory at `~/.config/openchamber/`.

#### Scenario: OpenChamber installed
- **WHEN** `./uninstall.sh` is run and `~/.local/bin/openchamber` exists
- **THEN** the binary is removed and `~/.config/openchamber/` directory is removed

#### Scenario: OpenChamber not installed
- **WHEN** `./uninstall.sh` is run and `~/.local/bin/openchamber` does not exist
- **THEN** the script logs that OpenChamber was not found and continues

### Requirement: Start.sh reads OpenChamber config from config.env
The `start.sh` script SHALL read `OPENCHAMBER_PORT`, `OPENCHAMBER_HOST`, and `OPENCHAMBER_UI_PASSWORD` from `.opencode/config.env` in addition to the existing `BRAVE_API_KEY` and `OPENCODE_SERVER_PASSWORD`. If any OpenChamber variable is missing, sensible defaults SHALL be used (port 3000, host 127.0.0.1, no password).

#### Scenario: All OpenChamber config present
- **WHEN** `start.sh` reads `config.env` and finds all three `OPENCHAMBER_*` variables
- **THEN** OpenChamber starts with the configured values

#### Scenario: OpenChamber config missing
- **WHEN** `start.sh` reads `config.env` and finds none of the `OPENCHAMBER_*` variables
- **THEN** OpenChamber starts with defaults: port 3000, host 127.0.0.1, no password
