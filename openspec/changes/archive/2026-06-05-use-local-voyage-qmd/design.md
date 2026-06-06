## Context

`opencode-assistant` uses `qmd` as Sebastian's durable notes and journals retrieval layer. The active integrations are shell-based: `.opencode/scripts/qmd-setup.sh`, `.opencode/scripts/qmd-refresh.sh`, `search-notes`, `search-journals`, and the proactive daily workflow configured in `.opencode/server.jsonc`. All of these currently assume `qmd` is discoverable from `PATH`.

The modified qmd implementation with `voyage-4-lite` cloud embeddings lives in our forked qmd repository at `git@github.com:lohzi97/qmd.git` and should be installed from that fork's maintained `main` branch. The current `/home/lohzi/Projects/qmd` clone is a development working copy, not the durable production reference. Relying on an unverified `PATH` binary would make behavior dependent on each shell/session and could silently use the globally installed upstream qmd package, losing Voyage support.

## Goals / Non-Goals

**Goals:**

- Ensure project-owned setup, refresh, and retrieval commands consistently use the forked Voyage-enabled qmd runtime.
- Preserve the existing `qmd --index sebastian ...` command shape used by skills and humans.
- Keep `VOYAGE_API_KEY` out of repository files and fail clearly when cloud embedding is requested without it.
- Force a safe re-embed path when switching to `voyage:voyage-4-lite` because existing local vectors are incompatible.
- Keep BM25 and vector retrieval local after embeddings are stored.

**Non-Goals:**

- Vendoring qmd source into `opencode-assistant`.
- Depending permanently on a single machine-local clone path as the production contract.
- Changing qmd collection names, index name, or search skill syntax.
- Adding cloud reranking or cloud query expansion by default.

## Decisions

1. Use our qmd fork as the durable source of truth.

   The Voyage embedding changes are maintained in `git@github.com:lohzi97/qmd.git` and should be installed from that fork's `main` branch with a global PATH install. The local clone may remain useful for development, but `opencode-assistant` should not hardcode `/home/lohzi/Projects/qmd` as the normal runtime contract.

   Alternatives considered:

   - Hardcode `/home/lohzi/Projects/qmd`: fastest local test path but not portable and easy to break after moving machines or worktrees.
   - Vendor qmd into `opencode-assistant`: deterministic but creates an unnecessary large source copy and maintenance burden.
   - Keep using upstream `qmd`: simplest but lacks the Voyage functionality we need.

2. Install or resolve qmd through a verified forked runtime.

   `opencode-assistant` should include a small verification/helper path that confirms the `qmd` binary being used is the forked build. The installation mechanism is a global install from the fork's `main` branch so normal `qmd --index sebastian ...` commands continue working for skills and humans.

   Preferred order:

   - Install from `git@github.com:lohzi97/qmd.git` using the maintained `main` branch and ensure that installed binary is first on `PATH` for OpenCode and shell scripts.
   - If a package-manager-managed install is awkward, add a small project helper that locates the installed fork and validates its version/capability before scripts call it.
   - Use `/home/lohzi/Projects/qmd` only as a development override, for example through `QMD_BIN` or `QMD_SOURCE_DIR`, not as the default proposal contract.

3. Configure cloud providers via `~/.config/qmd/.env`, managed by `config.sh`.

   The forked qmd auto-loads `~/.config/qmd/.env` on every invocation. This is the native, supported mechanism for persistent cloud provider configuration. `config.sh` should prompt for `VOYAGE_API_KEY` and `DEEPSEEK_API_KEY`, then write the complete cloud provider configuration to `~/.config/qmd/.env` with `chmod 600`.

   The file lives outside the repository (under `~/.config/qmd/`), eliminating accidental secret exposure through git. Scripts do not need to set or export environment variables because qmd loads them automatically.

   Three cloud providers are configured:
   - Voyage embedding (`QMD_EMBED_PROVIDER=voyage`, `VOYAGE_EMBED_MODEL=voyage-4-lite`)
   - Voyage reranking (`QMD_RERANK_PROVIDER=voyage`, `VOYAGE_RERANK_MODEL=rerank-2.5-lite`)
   - DeepSeek query expansion (`QMD_GENERATE_PROVIDER=deepseek`, `DEEPSEEK_GENERATE_MODEL=deepseek-v4-flash`)

   Alternatives considered:

   - Pass env vars in scripts only: requires every invocation site to set the same vars; fragile and duplicative now that qmd has native `.env` support.
   - Project-owned `.opencode/qmd.env` sourced by scripts: adds boilerplate and diverges from qmd's own configuration convention.

4. Update setup and refresh scripts to use a shared qmd verification path.

   `qmd-setup.sh` and `qmd-refresh.sh` should either source a shared helper or call a project qmd wrapper that first verifies the active runtime. This avoids duplicating runtime validation. Scripts no longer need to pass cloud provider env vars since `~/.config/qmd/.env` handles that.

   Alternatives considered:

   - Make every script require the caller to alter `PATH`: too easy to misconfigure.
   - Trust `command -v qmd`: insufficient because it cannot distinguish upstream qmd from the fork.

5. Treat the migration as an embedding model switch.

   The implementation should require or document `qmd --index sebastian embed -f` after switching to Voyage, because qmd vectors generated from local embeddinggemma/Qwen and Voyage are not compatible. The model label `voyage:voyage-4-lite` should be visible in `qmd status` after migration.

## Risks / Trade-offs

- Fork not installed or wrong qmd binary first on `PATH` -> verification must print a clear remediation that points to installing the forked qmd package/source.
- `VOYAGE_API_KEY` or `DEEPSEEK_API_KEY` missing or `~/.config/qmd/.env` absent -> qmd will fall back to local GGUF models; refresh/setup should detect and log this clearly.
- Skills still resolve upstream global `qmd` -> implementation should ensure the forked install is first on the OpenCode process `PATH` or update skill instructions if that is not feasible.
- Forced re-embed can take time and creates external API usage -> run once intentionally after confirming `qmd status` resolves the Voyage model.
- Cloud reranking and query expansion add per-query API cost for `qmd query` -> `search` and `vsearch` remain local-only; `query` uses the cloud providers configured in `.env`.
- Secrets stored in `~/.config/qmd/.env` are outside the repo but on the local filesystem -> `chmod 600` and no git tracking mitigates exposure.

## Migration Plan

1. Install qmd globally from the maintained `main` branch of `git@github.com:lohzi97/qmd.git`.
2. Verify the normal `qmd` command resolves to the fork and exposes the cloud query mode capability.
3. Run `config.sh` to prompt for `VOYAGE_API_KEY` and `DEEPSEEK_API_KEY` and write `~/.config/qmd/.env` with all provider defaults.
4. Add the project qmd verification/helper path and update qmd setup/refresh scripts to use it.
5. Verify `qmd status` reports `Embedding: voyage:voyage-4-lite` and that reranking and query expansion also resolve to their cloud providers.
6. Run a forced re-embed for the `sebastian` index.
7. Run `qmd --index sebastian vsearch ...` against `notes` and `journals-daily` to confirm semantic retrieval.
8. Run `qmd --index sebastian query ...` to confirm hybrid search with cloud reranking and query expansion.
9. Roll back by reinstalling upstream qmd or a previous fork tag, removing `~/.config/qmd/.env` (or clearing provider lines), and running `qmd --index sebastian embed -f` with the previous local model.
