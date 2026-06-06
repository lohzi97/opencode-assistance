## 1. Forked Runtime Installation

- [x] 1.1 Document `git@github.com:lohzi97/qmd.git` as the qmd fork that carries the Voyage embedding and cloud query mode changes.
- [x] 1.2 Document that the installation source is the maintained `main` branch of `git@github.com:lohzi97/qmd.git`, not a pinned commit or tag.
- [x] 1.3 Install qmd globally from `git@github.com:lohzi97/qmd.git` so the normal `qmd` command resolves to the Voyage-enabled build in the OpenCode/runtime environment.
- [x] 1.4 Add a project-owned verification/helper command that confirms the active qmd runtime is the forked build with cloud query mode support and prints clear remediation when it is not.

## 2. Cloud Provider Configuration

- [x] 2.1 Add `VOYAGE_API_KEY` prompt to `config.sh` using the existing `prompt_secret` pattern, with re-run support (detect existing value from `~/.config/qmd/.env`).
- [x] 2.2 Add `DEEPSEEK_API_KEY` prompt to `config.sh` using the existing `prompt_secret` pattern, with re-run support.
- [x] 2.3 Add `write_qmd_env()` function to `config.sh` that writes `~/.config/qmd/.env` with all provider defaults (`QMD_EMBED_PROVIDER=voyage`, `VOYAGE_EMBED_MODEL=voyage-4-lite`, `QMD_RERANK_PROVIDER=voyage`, `VOYAGE_RERANK_MODEL=rerank-2.5-lite`, `QMD_GENERATE_PROVIDER=deepseek`, `DEEPSEEK_GENERATE_MODEL=deepseek-v4-flash`) and the prompted API keys, with `chmod 600`.
- [x] 2.4 Add `load_existing_qmd_values()` helper to `config.sh` that reads existing `VOYAGE_API_KEY` and `DEEPSEEK_API_KEY` from `~/.config/qmd/.env` if present, so re-runs offer to keep existing values.
- [x] 2.5 Wire the new prompts and `write_qmd_env()` call into `config.sh` main flow.

## 3. Script Integration

- [x] 3.1 Update `.opencode/scripts/qmd-setup.sh` to verify the forked qmd runtime before invoking qmd.
- [x] 3.2 Update `.opencode/scripts/qmd-refresh.sh` to verify the forked qmd runtime before invoking qmd.
- [x] 3.3 Scripts do NOT need to set cloud provider env vars; qmd auto-loads `~/.config/qmd/.env`.
- [x] 3.4 Keep qmd search/get/update command arguments and the `sebastian` index name unchanged.

## 4. Skill And Automation Compatibility

- [x] 4.1 Verify `search-notes` and `search-journals` commands resolve the forked qmd runtime or document the required PATH/runtime setup.
- [x] 4.2 Verify the proactive daily diary plus qmd refresh command in `.opencode/server.jsonc` works without explicit env var passing (qmd auto-loads `.env`).
- [x] 4.3 Update user-facing qmd notes or script comments with the fork installation and cloud provider setup procedure.

## 5. Migration And Verification

- [x] 5.1 Run `qmd --index sebastian status` through the forked runtime and confirm the active embedding model is `voyage:voyage-4-lite` when `~/.config/qmd/.env` is present.
- [x] 5.2 Confirm `qmd --index sebastian status` shows `voyage:rerank-2.5-lite` for reranking and `deepseek:deepseek-v4-flash` for query expansion.
- [x] 5.3 With cloud providers configured, run a forced re-embed of the `sebastian` index.
- [x] 5.4 Verify `qmd --index sebastian vsearch "qmd" -c notes --json -n 5` returns valid results after migration.
- [x] 5.5 Verify `qmd --index sebastian query "sebastian memory architecture" --json -n 3` uses cloud reranking and query expansion successfully.
- [x] 5.6 Verify `.opencode/scripts/qmd-refresh.sh` logs successful update and embed phases to `.opencode/server/state/qmd.log`.
- [x] 5.7 Document rollback: reinstall upstream qmd or a previous fork tag, remove or clear provider lines from `~/.config/qmd/.env`, and force re-embed with the prior local model.
