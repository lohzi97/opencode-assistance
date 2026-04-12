# QMD Usage For Opencode-Assistant

This note records the verified setup and operating rules for using `qmd` with this repository.

## Goal

Use `qmd` to retrieve information from:

- `notes/` for durable instructions, stable facts, and persistent project knowledge
- `journals/daily/` for curated historical summaries
- `journals/session/` for raw chronology, exact wording, debugging trails, and implementation details

The design principle is simple: default searches should prefer high-signal material, while raw session logs remain available on demand.

## Fresh Clone Setup

Run all commands from the repository root.

### 1. Verify `qmd`

```sh
qmd --version
qmd --index sebastian status
```

Expected on a brand new setup:

- the named index `sebastian` may not exist yet
- there will be no collections or embeddings yet

### 2. Create Project Collections

```sh
qmd --index sebastian collection add journals/daily --name journals-daily
qmd --index sebastian collection add journals/session --name journals-session
qmd --index sebastian collection add notes --name notes
```

Why this split:

- `journals-daily` is concise and curated, so it should rank well by default
- `journals-session` is valuable but noisy, so it should not dominate default retrieval
- `notes` contains the most durable working knowledge

### 3. Add Retrieval Context

```sh
qmd --index sebastian context add / "Index for the opencode-assistant workspace. Prefer notes for durable guidance and remembered decisions, journals-daily for concise historical summaries, and journals-session for raw chronology, debugging trails, and exact prior exchanges."
qmd --index sebastian context add qmd://journals-daily/ "Curated daily summaries of important work, decisions, and outcomes. Prefer this collection for concise project history."
qmd --index sebastian context add qmd://journals-session/ "Raw session transcripts and working logs. Use when tracing chronology, exact wording, or implementation details that may have been summarized later."
qmd --index sebastian context add qmd://notes/ "Persistent notes, instructions, and durable project knowledge. Prefer for stable guidance and remembered facts."
```

These contexts materially improve retrieval quality by telling `qmd` what each collection is for.

### 4. Exclude Session Logs From Default Queries

```sh
qmd --index sebastian collection exclude journals-session
```

This keeps default searches focused on `notes` and `journals-daily`.

Raw session logs remain available explicitly with `-c journals-session`.

### 5. Build Embeddings

```sh
qmd --index sebastian embed
```

Observed on this repository:

- `95` markdown files indexed
- `7328` chunks embedded
- first embedding run took about `6m 50s`

### 6. Verify Final State

```sh
qmd --index sebastian status
qmd --index sebastian collection list
qmd --index sebastian context list
```

Expected final shape:

- `journals-daily`
- `journals-session` marked as excluded from default queries
- `notes`
- embeddings present, not pending

## Must-Follow Rules For AI Agents

These are mandatory.

1. Always use `--index sebastian`.

Using the default index mixes this project with unrelated markdown and defeats project isolation.

2. Never index the repository root by default.

Do not run `qmd collection add .` for this repository. It hurts ranking quality by mixing all markdown together.

3. Never mutate the same `qmd` index concurrently.

Do not run `collection add`, `update`, `embed`, or other index-writing commands in parallel against `--index sebastian`. During setup, parallel writes caused a SQLite foreign-key failure and left the index in an inconsistent state.

4. Do not assume new markdown is searchable semantically until both steps are run:

```sh
qmd --index sebastian update
qmd --index sebastian embed
```

`update` refreshes documents. `embed` refreshes vectors.

5. Do not use `qmd update --pull` or `qmd collection update-cmd` unless a git pull is explicitly desired.

These introduce repository side effects unrelated to retrieval.

6. Treat `journals-session` as opt-in unless raw chronology or exact wording is required.

Default retrieval should prefer `notes` and `journals-daily`.

7. Confirm important details with `qmd get` before citing them.

Search snippets are for discovery. `get` is for verification.

8. Use `qmd` from the repository root unless you have a concrete reason not to.

This keeps collection-relative paths predictable.

## Best Practices For AI Agents

These are recommended working habits.

### Retrieval Order

1. Start with exact keyword search:

```sh
qmd --index sebastian search "query"
```

2. If needed, use semantic search:

```sh
qmd --index sebastian vsearch "concept"
```

3. If the question is broad, ambiguous, or phrased loosely, use hybrid search:

```sh
qmd --index sebastian query "question"
```

4. If high-signal sources are insufficient, widen explicitly to sessions:

```sh
qmd --index sebastian search "query" -c journals-session
qmd --index sebastian vsearch "concept" -c journals-session
```

5. Once a result is found, retrieve the source exactly:

```sh
qmd --index sebastian get "notes/qmd-usage.md"
qmd --index sebastian get "journals-daily/20260402.md"
qmd --index sebastian get "journals-session/20260407202706593-ses_2981de1b6ffepySEjWWhBQMtNy.md:60" -l 40
```

### Which Command To Prefer

- Use `search` for exact strings, commands, filenames, dates, IDs, and known terminology
- Use `vsearch` when the concept is known but the wording is uncertain
- Use `query` when search quality matters more than runtime and local model cost
- Use `get` to verify and quote exact content
- Use `--files` or `--json` when machine-readable output is more useful than formatted text

### Source Preference

- Prefer `notes` for stable instructions and durable project memory
- Prefer `journals-daily` for summarized history and important past decisions
- Prefer `journals-session` only when summary material is insufficient and exact detail matters

### Maintenance Habit

After editing markdown in `notes/` or `journals/`, refresh the index:

```sh
qmd --index sebastian update
qmd --index sebastian embed
qmd --index sebastian status
```

### Writing For Better Retrieval

Agents should write markdown in a retrieval-friendly way:

- one topic per note when possible
- explicit headings
- stable keywords such as project names, commands, file paths, dates, and identifiers
- concise summaries before long details when appropriate

Good source material makes `qmd` much more useful.

## Useful Observations

These were directly observed while setting up and testing this repository.

### 1. Named Index Path

Current named index path:

```text
~/.cache/qmd/sebastian.sqlite
```

This is the correct project-specific database to use.

### 2. Model Downloads Are Real And Non-Trivial

Observed downloads:

- embedding model: `hf_ggml-org_embeddinggemma-300M-Q8_0.gguf`
- query expansion model: `hf_tobil_qmd-query-expansion-1.7B-q4_k_m.gguf`

Model files observed in:

```text
~/.cache/qmd/models/
```

Agents should expect first-use latency and significant disk usage.

### 3. `vsearch` Is Heavier Than It First Appears

On `qmd 2.1.0`, observed `vsearch` behavior included query expansion and multiple generated vector queries before searching. In practice, `vsearch` is not just a trivial embedding lookup.

Therefore:

- prefer `search` first when exact language is available
- reserve `vsearch` for cases where semantic expansion is actually helpful

### 4. `qmd` URI Output Normalizes Filenames

`qmd ls journals-session` prints normalized `qmd://` paths with lowercase and hyphenated file names. However, `qmd get` still accepted the original collection-relative session filename from disk during testing.

Practical rule:

- use search or `ls` output to locate documents
- use `get` with the real relative filename if that is what you already have

### 5. Default Search Shape For This Repo

With the recommended setup:

- default searches hit `notes` and `journals-daily`
- raw session logs require explicit `-c journals-session`

This is the preferred behavior.

## Suggested Minimal Command Set

For daily work, these commands are usually enough:

```sh
qmd --index sebastian status
qmd --index sebastian search "query"
qmd --index sebastian search "query" -c journals-session
qmd --index sebastian vsearch "concept"
qmd --index sebastian get "notes/file.md"
qmd --index sebastian update
qmd --index sebastian embed
```

## Bottom Line

The recommended `qmd` design for this repository is:

- one named index: `sebastian`
- three collections: `notes`, `journals-daily`, `journals-session`
- collection context enabled
- `journals-session` excluded from default queries
- index writes always performed sequentially
- `search` first, `get` to verify, `vsearch` or `query` only when the problem justifies the added cost
