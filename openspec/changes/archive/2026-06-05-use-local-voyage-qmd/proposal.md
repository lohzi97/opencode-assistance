## Why

`opencode-assistant` currently invokes `qmd` directly from `PATH`, so `search-notes`, `search-journals`, setup scripts, and the proactive refresh job may keep using the globally installed upstream package instead of our Voyage-enabled qmd fork at `git@github.com:lohzi97/qmd.git`.

We need a deterministic project-owned way to install and use our forked `qmd` for indexing and retrieval, while preserving the existing `qmd --index sebastian ...` user and skill workflow.

## What Changes

- Install `qmd` from the maintained `main` branch of `git@github.com:lohzi97/qmd.git` rather than the upstream package.
- Add project-owned verification that the active `qmd` binary is the forked Voyage-enabled build before setup/refresh performs embedding.
- Update project-owned qmd setup and refresh scripts to use the verified forked qmd runtime instead of relying on an unverified ambient `PATH` binary.
- Extend `config.sh` to prompt for `VOYAGE_API_KEY` and `DEEPSEEK_API_KEY` and write all cloud provider configuration to `~/.config/qmd/.env`, which the forked qmd auto-loads on every invocation.
- Configure all three cloud providers: Voyage embedding (`voyage-4-lite`), Voyage reranking (`rerank-2.5-lite`), and DeepSeek query expansion (`deepseek-v4-flash`).
- Keep retrieval commands and skills compatible with `qmd --index sebastian ...` so agents do not need to learn a new command shape.
- Add verification steps for fork runtime resolution, qmd setup, forced re-embedding, and semantic search after switching embedding models.
- No breaking changes to qmd collection names, qmd index name, or skill command examples.

## Capabilities

### New Capabilities

- `qmd-runtime-selection`: Deterministic installation, verification, and operation of the forked qmd runtime (Voyage + DeepSeek cloud providers) for Sebastian memory indexing and retrieval.

### Modified Capabilities

- None.

## Impact

- Affected scripts: `.opencode/scripts/qmd-setup.sh`, `.opencode/scripts/qmd-refresh.sh`, and any new qmd verification/helper script.
- Affected configuration: `config.sh` gains new prompts for `VOYAGE_API_KEY` and `DEEPSEEK_API_KEY` and writes `~/.config/qmd/.env` with all provider defaults.
- Affected automation: `.opencode/server.jsonc` daily diary plus qmd refresh workflow; scripts no longer need to pass env vars because qmd auto-loads `~/.config/qmd/.env`.
- Affected skills: `search-notes` and `search-journals` remain command-compatible but should be verified against the forked runtime.
- Affected external dependency: `git@github.com:lohzi97/qmd.git`, maintained by us and expected to provide the Voyage + DeepSeek cloud query mode from its `main` branch.
- Affected secrets: `VOYAGE_API_KEY` and `DEEPSEEK_API_KEY` are stored in `~/.config/qmd/.env` (outside the repo, `chmod 600`) and must not be committed.
