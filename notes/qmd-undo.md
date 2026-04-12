# QMD Undo and Reset Guide

How to recover from mistakes or start over with `qmd` for this repository.

All commands assume you are at the repository root and use `--index sebastian`.

## Undo By Scenario

### Accidentally indexed the repository root

If you ran `qmd collection add .` or similar and now have a collection covering everything:

```sh
qmd --index sebastian collection remove <collection-name>
```

Then verify it is gone:

```sh
qmd --index sebastian collection list
```

The collection name is whatever you assigned with `--name`, or the auto-generated default. If you are unsure, `collection list` shows every collection with its name.

### Added the wrong directory as a collection

Same as above. Remove it and add the correct one:

```sh
qmd --index sebastian collection remove wrong-name
qmd --index sebastian collection add journals/daily --name journals-daily
```

### Collection has stale or missing files

Re-index without touching the rest of the setup:

```sh
qmd --index sebastian update
qmd --index sebastian embed
```

`update` re-scans all collection directories, adds new files, removes deleted ones, and marks changed files for re-embedding. `embed` generates vectors for anything that needs them.

### Embeddings are corrupted or outdated

Force a full re-embed from scratch:

```sh
qmd --index sebastian embed --force
```

This clears all existing vectors and re-embeds every document. It takes roughly the same time as the initial embed (about 7 minutes on this repository).

### Context was set incorrectly

Remove the wrong context and add the correct one:

```sh
qmd --index sebastian context rm qmd://notes/
qmd --index sebastian context add qmd://notes/ "Corrected context text here."
```

For the global root context:

```sh
qmd --index sebastian context rm /
qmd --index sebastian context add / "Corrected global context."
```

### Collection excluded by accident

Reverse an accidental exclude:

```sh
qmd --index sebastian collection include journals-session
```

### Collection included by accident

Reverse an accidental include:

```sh
qmd --index sebastian collection exclude journals-session
```

### Collection named wrong

Rename without re-indexing:

```sh
qmd --index sebastian collection rename old-name new-name
```

Contexts survive a rename because they are keyed by collection identity, not name.

### Index became corrupted from concurrent writes

If `qmd` commands start failing with SQLite errors, or a collection shows 0 files when it should have many:

```sh
qmd --index sebastian cleanup
```

`cleanup` clears cached API responses and vacuums the database. If that does not resolve it, proceed to a full reset (see below).

## Full Reset

To wipe the `sebastian` index entirely and start fresh from the setup steps in `notes/qmd-usage.md`.

### Step 1. Delete the index file

```sh
rm ~/.cache/qmd/sebastian.sqlite
```

Also remove the accompanying WAL and shared-memory files if they exist:

```sh
rm -f ~/.cache/qmd/sebastian.sqlite-shm
rm -f ~/.cache/qmd/sebastian.sqlite-wal
```

This deletes all collections, contexts, documents, and embeddings for the `sebastian` index. Nothing else is affected.

### Step 2. Verify the index is gone

```sh
qmd --index sebastian status
```

Expected output: empty state, zero files, no collections.

### Step 3. Re-run fresh clone setup

Follow the steps in `notes/qmd-usage.md` under "Fresh Clone Setup", starting at step 2.

The full sequence:

```sh
qmd --index sebastian collection add journals/daily --name journals-daily
qmd --index sebastian collection add journals/session --name journals-session
qmd --index sebastian collection add notes --name notes
qmd --index sebastian context add / "Index for the opencode-assistant workspace. Prefer notes for durable guidance and remembered decisions, journals-daily for concise historical summaries, and journals-session for raw chronology, debugging trails, and exact prior exchanges."
qmd --index sebastian context add qmd://journals-daily/ "Curated daily summaries of important work, decisions, and outcomes. Prefer this collection for concise project history."
qmd --index sebastian context add qmd://journals-session/ "Raw session transcripts and working logs. Use when tracing chronology, exact wording, or implementation details that may have been summarized later."
qmd --index sebastian context add qmd://notes/ "Persistent notes, instructions, and durable project knowledge. Prefer for stable guidance and remembered facts."
qmd --index sebastian collection exclude journals-session
qmd --index sebastian embed
qmd --index sebastian status
```

## Nuclear Reset (Everything)

To wipe all `qmd` state including models, the default index, and the `sebastian` index.

### Step 1. Delete the entire cache directory

```sh
rm -rf ~/.cache/qmd/
```

This removes:

- `~/.cache/qmd/sebastian.sqlite` and all named indexes
- `~/.cache/qmd/index.sqlite` the default index
- `~/.cache/qmd/models/` all downloaded local models

### Step 2. Verify

```sh
qmd --index sebastian status
```

This will be slow on first run because it re-downloads models. Expect:

- embedding model download (~329 MB)
- query expansion model download (~1.1 GB)
- reranking model download (~640 MB, only needed for `qmd query` with reranking)

### Step 3. Re-run fresh clone setup

Same as full reset step 3 above.

## Quick Reference

| What went wrong | Fix |
|---|---|
| Wrong collection added | `qmd --index sebastian collection remove <name>` |
| Stale files in collection | `qmd --index sebastian update && qmd --index sebastian embed` |
| Bad embeddings | `qmd --index sebastian embed --force` |
| Wrong context text | `qmd --index sebastian context rm <path>` then `context add` again |
| Accidentally excluded collection | `qmd --index sebastian collection include <name>` |
| Accidentally included collection | `qmd --index sebastian collection exclude <name>` |
| Wrong collection name | `qmd --index sebastian collection rename <old> <new>` |
| SQLite corruption | `qmd --index sebastian cleanup`, then full reset if that fails |
| Want to start over (project only) | Delete `~/.cache/qmd/sebastian.sqlite*` and re-run setup |
| Want to start over (everything) | Delete `~/.cache/qmd/` entirely and re-run setup |

## What Is Safe To Delete

| Path | What it is | Safe to delete |
|---|---|---|
| `~/.cache/qmd/sebastian.sqlite` | The `sebastian` named index | Yes, but requires re-running full setup and embed |
| `~/.cache/qmd/sebastian.sqlite-shm` | SQLite shared memory | Yes, SQLite recreates it automatically |
| `~/.cache/qmd/sebastian.sqlite-wal` | SQLite write-ahead log | Yes, SQLite replays it on next open |
| `~/.cache/qmd/index.sqlite` | The default unnamed index | Yes, this project does not use it |
| `~/.cache/qmd/models/` | Downloaded ML models | Yes, but `qmd` re-downloads them on next semantic or hybrid search (~2 GB total) |
| `~/.cache/qmd/` (entire directory) | Everything above | Yes, equivalent to "nuclear reset" |

## Important Notes

- `qmd` stores no state inside the repository itself. All index data lives under `~/.cache/qmd/`. Deleting files there never touches your working tree.
- `cleanup` is lightweight and non-destructive. It vacuums the database and clears API response caches. It does not remove collections, documents, or embeddings.
- `embed --force` is the correct way to rebuild vectors without removing the documents or collections.
- After any reset, the first `vsearch` or `query` command will be slow because models must be loaded into memory. Subsequent commands are faster.
