## Purpose

Defines the project-owned mechanism for installing, verifying, and invoking the forked qmd runtime from `git@github.com:lohzi97/qmd.git`, including cloud provider configuration, search interface compatibility, safe embedding model migration, and local retrieval after cloud embedding.

## Requirements

### Requirement: Forked QMD Runtime Selection
The system SHALL provide a project-owned mechanism for installing, verifying, and invoking the forked qmd runtime from `git@github.com:lohzi97/qmd.git` used by Sebastian memory indexing and retrieval.

#### Scenario: Forked qmd is installed
- **WHEN** a project qmd setup, refresh, or retrieval command invokes qmd through the project-owned mechanism
- **THEN** the command SHALL execute the installed qmd implementation from `git@github.com:lohzi97/qmd.git` rather than an unrelated upstream qmd binary

#### Scenario: Forked qmd is unavailable
- **WHEN** the project-owned qmd mechanism cannot verify that the active qmd runtime is the forked build with cloud query mode support
- **THEN** it SHALL fail with a clear remediation message and SHALL NOT silently fall back to an upstream qmd binary for embedding operations

#### Scenario: Development override is used
- **WHEN** an operator explicitly configures a development qmd path override
- **THEN** the project-owned mechanism SHALL allow the override only after verifying that the runtime exposes the required cloud provider capability

### Requirement: Cloud Provider Configuration via `~/.config/qmd/.env`
The system SHALL configure all three cloud providers (embedding, reranking, query expansion) through `~/.config/qmd/.env`, managed by `config.sh`.

#### Scenario: config.sh prompts for API keys
- **WHEN** `config.sh` runs
- **THEN** it SHALL prompt for `VOYAGE_API_KEY` and `DEEPSEEK_API_KEY` and write the complete cloud provider configuration to `~/.config/qmd/.env` with `chmod 600`

#### Scenario: config.sh writes provider defaults
- **WHEN** `config.sh` writes `~/.config/qmd/.env`
- **THEN** the file SHALL contain `QMD_EMBED_PROVIDER=voyage`, `VOYAGE_EMBED_MODEL=voyage-4-lite`, `QMD_RERANK_PROVIDER=voyage`, `VOYAGE_RERANK_MODEL=rerank-2.5-lite`, `QMD_GENERATE_PROVIDER=deepseek`, and `DEEPSEEK_GENERATE_MODEL=deepseek-v4-flash` alongside the API keys

#### Scenario: config.sh re-runs with existing values
- **WHEN** `config.sh` is re-run and `~/.config/qmd/.env` already exists
- **THEN** it SHALL offer to keep existing API key values (same pattern as other secrets in `config.sh`)

#### Scenario: ~/.config/qmd/.env is absent
- **WHEN** qmd is invoked and `~/.config/qmd/.env` does not exist
- **THEN** qmd SHALL fall back to local GGUF models and setup/refresh scripts SHALL log a warning about missing cloud provider configuration

### Requirement: Existing Search Interface Compatibility
The system SHALL preserve the existing qmd command interface used by Sebastian skills and operators.

#### Scenario: Search skill command runs
- **WHEN** `search-notes` or `search-journals` runs a command shaped like `qmd --index sebastian search`, `qmd --index sebastian vsearch`, `qmd --index sebastian query`, or `qmd --index sebastian get`
- **THEN** the command SHALL remain valid and SHALL search the existing `sebastian` index and collections

#### Scenario: Setup and refresh scripts run
- **WHEN** `.opencode/scripts/qmd-setup.sh` or `.opencode/scripts/qmd-refresh.sh` invokes qmd
- **THEN** the script SHALL use the same project-owned qmd runtime selection mechanism as manual retrieval commands and SHALL NOT need to pass cloud provider environment variables (qmd auto-loads them from `~/.config/qmd/.env`)

### Requirement: Safe Embedding Model Migration
The system SHALL treat switching to Voyage embeddings as an embedding model migration requiring rebuilt vectors.

#### Scenario: Voyage model is activated for an existing index
- **WHEN** the active embedding model changes to `voyage:voyage-4-lite`
- **THEN** the migration procedure SHALL include a forced re-embed of the `sebastian` index before semantic search is considered verified

#### Scenario: Migration verification completes
- **WHEN** forced re-embedding completes
- **THEN** `qmd --index sebastian status` SHALL show the active embedding model as `voyage:voyage-4-lite` or an equivalent Voyage model label

### Requirement: Local Retrieval After Cloud Embedding
The system SHALL keep stored-vector retrieval local after Voyage embeddings are generated.

#### Scenario: Semantic search executes after migration
- **WHEN** `qmd --index sebastian vsearch` runs after Voyage embedding migration
- **THEN** the system SHALL use locally stored vectors for similarity search and SHALL only require a cloud embedding call for the query text

### Requirement: Cloud Reranking and Query Expansion
The system SHALL use Voyage reranking and DeepSeek query expansion for `qmd query` commands when cloud providers are configured in `~/.config/qmd/.env`.

#### Scenario: Hybrid query runs with cloud providers
- **WHEN** `qmd --index sebastian query` runs and `QMD_RERANK_PROVIDER=voyage` and `QMD_GENERATE_PROVIDER=deepseek` are set in `~/.config/qmd/.env`
- **THEN** the query SHALL use Voyage for reranking and DeepSeek for query expansion instead of local GGUF models

#### Scenario: Search and vsearch remain local
- **WHEN** `qmd --index sebastian search` or `qmd --index sebastian vsearch` runs
- **THEN** these commands SHALL NOT invoke cloud API calls regardless of `~/.config/qmd/.env` configuration
