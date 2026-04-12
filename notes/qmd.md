# QMD CLI Guide for AI Agents

QMD is an on-device search engine for markdown documents. It combines BM25 full-text search, vector semantic search, and LLM re-ranking — all running locally.

## Quick Reference

| Task | Command |
|------|---------|
| Check status | `qmd status` |
| List collections | `qmd collection list` or `qmd ls` |
| List files in a collection | `qmd ls <collection>` |
| Keyword search | `qmd search "query"` |
| Semantic search | `qmd vsearch "query"` |
| Hybrid search (best quality) | `qmd query "query"` |
| Get document by path | `qmd get <path>` |
| Get document by docid | `qmd get "#abc123"` |
| Get multiple documents | `qmd multi-get "<pattern>"` |
| Search within a collection | `qmd search "query" -c <name>` |

---

## Workflow

### 1. Check Current State

Always start by checking what's indexed:

```sh
qmd status
```

This shows: database path, document counts, collections with file counts, pending embeddings, and whether MCP is running.

```sh
qmd collection list    # List all collections with details
qmd ls                 # List all collections with file counts
qmd ls <collection>    # List all files in a specific collection
```

### 2. Search for Documents

Three search modes, from simple to advanced:

```sh
# BM25 keyword search — fast, no LLM needed
qmd search "authentication flow"

# Vector semantic search — finds conceptually similar content
qmd vsearch "how to deploy the application"

# Hybrid search — query expansion + BM25 + vector + LLM reranking
qmd query "quarterly planning process"
```

**Filter by collection:**

```sh
qmd search "API" -c notes
qmd search "API" -c notes -c docs    # multiple collections
```

**Control result count and quality:**

```sh
qmd query "auth" -n 10                    # 10 results (default: 5)
qmd query "auth" --all --min-score 0.4    # all results above 0.4 score
qmd query "auth" --full                   # show full document body
qmd query "auth" --no-rerank              # skip reranking (faster, CPU-friendly)
```

**Structured queries** (skip auto-expansion, full control):

```sh
qmd query $'lex: "connection pool" timeout -redis\nvec: database connections under load'
qmd query $'intent: distributed systems\nlex: CAP theorem\nvec: consistency'
```

Query types: `lex` (BM25), `vec` (vector), `hyde` (hypothetical document).

### 3. Retrieve Documents

**Get by path** (supports fuzzy matching):

```sh
qmd get "notes/meeting.md"               # by collection-relative path
qmd get "notes/meeting.md:50"            # starting at line 50
qmd get "notes/meeting.md" --from 50     # same, explicit flag
qmd get "notes/meeting.md" -l 100        # limit to 100 lines
qmd get "notes/meeting.md:50" -l 100     # line 50 through 149
qmd get "notes/meeting.md" --line-numbers  # with line numbers
```

**Get by docid** (shown in search results as `#abc123`):

```sh
qmd get "#abc123"        # leading # is optional
qmd get "abc123"         # also works
```

**Get multiple documents** (glob, comma-separated, or docids):

```sh
qmd multi-get "journals/2025-05*.md"         # glob pattern
qmd multi-get "file1.md, file2.md, #abc123"  # comma-separated + docids
qmd multi-get "docs/*.md" --json             # JSON output
qmd multi-get "docs/*.md" -l 50              # max 50 lines per file
qmd multi-get "docs/*.md" --max-bytes 20480  # skip files > 20KB
```

### 4. Output Formats

All search commands and `multi-get` support these output formats:

```sh
qmd search "query" --json      # JSON array (best for agents)
qmd search "query" --files     # simple: docid,score,path,context
qmd search "query" --csv       # CSV with headers
qmd search "query" --md        # Markdown
qmd search "query" --xml       # XML
qmd search "query" --explain   # include score breakdown (query only)
```

**JSON output structure:**

```json
[
  {
    "docid": "#abc123",
    "score": 0.85,
    "file": "qmd://collection/path/to/file.md",
    "line": 42,
    "title": "Document Title",
    "context": "Folder context text",
    "body": "full document (only with --full)",
    "snippet": "matching snippet (without --full)"
  }
]
```

**`--files` output** (lightweight, good for file listing):

```
#abc123,0.85,qmd://collection/path/to/file.md,"context text"
```

### 5. Named Indexes

Use separate SQLite databases for different projects:

```sh
qmd --index project-a collection add ~/project-a --name docs
qmd --index project-a search "query"
qmd --index project-b collection add ~/project-b --name docs
qmd --index project-b search "query"
```

Database files: `~/.cache/qmd/<name>.sqlite` (default: `index.sqlite`).

### 6. Understanding Scores

| Score | Meaning |
|-------|---------|
| 0.8 - 1.0 | Highly relevant |
| 0.5 - 0.8 | Moderately relevant |
| 0.2 - 0.5 | Somewhat relevant |
| 0.0 - 0.2 | Low relevance |

Use `--min-score` to filter out low-quality results. Default minimum: `0` for `search`/`query`, `0.3` for `vsearch`.

---

## Common Patterns for AI Agents

### Find relevant documents

```sh
# Fast — keyword only, no LLM
qmd search "authentication" --json -n 10

# Fast — semantic only
qmd vsearch "how users log in" --json -n 10

# Best quality — hybrid search with reranking
qmd query "how does authentication work" --json -n 10 --min-score 0.3
```

### Read specific content

```sh
# After finding a docid in search results
qmd get "#abc123"

# Read a specific section
qmd get "docs/guide.md:100" -l 50

# Batch read multiple files
qmd multi-get "docs/*.md" --json --max-bytes 20480
```

### Explore the index

```sh
qmd status                     # overall health
qmd ls                         # list collections
qmd ls docs                    # list files in a collection
qmd collection list            # detailed collection info
qmd context list               # see all configured contexts
```

### Export for analysis

```sh
# All matching files above threshold
qmd query "error handling" --all --files --min-score 0.4

# Structured JSON for processing
qmd search "API design" --json -n 20 --full

# Score explanation for debugging
qmd query "auth" --json --explain -n 5
```

---

## All Flags Reference

### Global

| Flag | Description |
|------|-------------|
| `--index <name>` | Use named index (default: `index`) |
| `--context <text>` | Additional context for query expansion |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show version |

### Search (search, vsearch, query)

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `-n <num>` | | 5 (CLI) / 20 (JSON/files) | Max results |
| `-c, --collection <name>` | `-c` | all defaults | Filter by collection (repeatable) |
| `--all` | | false | Return all matches |
| `--min-score <num>` | | 0 (0.3 for vsearch) | Minimum score threshold |
| `--full` | | false | Show full document body |
| `--line-numbers` | | false | Add line numbers |
| `--explain` | | false | Include score breakdown (query only) |
| `--no-rerank` | | false | Skip LLM reranking |
| `--candidate-limit <n>` | `-C` | 40 | Max candidates to rerank |
| `--intent <text>` | | | Domain intent for disambiguation |
| `--chunk-strategy <auto\|regex>` | | regex | Chunking mode |
| `--json` | | false | JSON output |
| `--csv` | | false | CSV output |
| `--md` | | false | Markdown output |
| `--xml` | | false | XML output |
| `--files` | | false | Simple file listing output |

### Get

| Flag | Short | Description |
|------|-------|-------------|
| `--from <line>` | | Starting line number (1-indexed) |
| `-l <num>` | `-l` | Maximum lines to display |
| `--line-numbers` | | Add line numbers |

### Multi-Get

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `-l <num>` | `-l` | all | Max lines per file |
| `--max-bytes <num>` | | 10240 (10KB) | Skip files larger than N bytes |

### Embed

| Flag | Short | Default | Description |
|------|-------|---------|-------------|
| `--force` | `-f` | false | Clear all vectors and re-embed |
| `--chunk-strategy <auto\|regex>` | | regex | Chunking mode |
| `--max-docs-per-batch <n>` | | 64 | Docs loaded per batch |
| `--max-batch-mb <n>` | | 64 | MB loaded per batch |

---

## Environment Variables

| Variable | Description |
|----------|-------------|
| `XDG_CACHE_HOME` | Base cache dir (default: `~/.cache`) |
| `XDG_CONFIG_HOME` | Base config dir (default: `~/.config`) |
| `QMD_EDITOR_URI` | Editor link template (default: `vscode://file/{path}:{line}:{col}`) |
| `QMD_EMBED_MODEL` | Override embedding model URI |
| `QMD_RERANK_MODEL` | Override reranking model URI |
| `QMD_GENERATE_MODEL` | Override generation model URI |
| `QMD_LLAMA_GPU` | GPU mode: `auto`, `metal`, `vulkan`, `cuda`, `false` |
| `NO_COLOR` | Disable color output |
| `HF_ENDPOINT` | HuggingFace mirror for model downloads |

---

## Data Locations

| What | Path |
|------|------|
| SQLite index | `~/.cache/qmd/index.sqlite` |
| Named index | `~/.cache/qmd/<name>.sqlite` |
| YAML config | `~/.config/qmd/<name>.yml` |
| Cached models | `~/.cache/qmd/models/` |
| MCP PID file | `~/.cache/qmd/mcp.pid` |
| MCP log | `~/.cache/qmd/mcp.log` |

## Models (auto-downloaded)

| Model | Purpose | Size |
|-------|---------|------|
| `embeddinggemma-300M-Q8_0` | Vector embeddings | ~300MB |
| `qwen3-reranker-0.6b-q8_0` | Re-ranking | ~640MB |
| `qmd-query-expansion-1.7B-q4_k_m` | Query expansion | ~1.1GB |

---

## Opencode-Assistant Setup

Recommended project setup:

```sh
qmd --index sebastian collection add journals/daily --name journals-daily
qmd --index sebastian collection add journals/session --name journals-session
qmd --index sebastian collection add notes --name notes
```

Why this split:

- `journals-daily` contains curated summaries and should rank highly for historical context.
- `journals-session` contains raw transcripts and working logs; useful for chronology and exact details, but noisy.
- `notes` contains persistent instructions, durable project knowledge, and task notes.

Add retrieval context so hybrid search understands the purpose of each collection:

```sh
qmd --index sebastian context add / "Index for the opencode-assistant workspace. Prefer notes for durable guidance and remembered decisions, journals-daily for concise historical summaries, and journals-session for raw chronology, debugging trails, and exact prior exchanges."
qmd --index sebastian context add qmd://journals-daily/ "Curated daily summaries of important work, decisions, and outcomes. Prefer this collection for concise project history."
qmd --index sebastian context add qmd://journals-session/ "Raw session transcripts and working logs. Use when tracing chronology, exact wording, or implementation details that may have been summarized later."
qmd --index sebastian context add qmd://notes/ "Persistent notes, instructions, and durable project knowledge. Prefer for stable guidance and remembered facts."
```

Recommended default behavior:

```sh
qmd --index sebastian collection exclude journals-session
qmd --index sebastian embed
```

This keeps default searches focused on high-signal material (`notes` + `journals-daily`) while still allowing explicit session searches with `-c journals-session`.

### Maintenance

After adding or changing markdown files:

```sh
qmd --index sebastian update
qmd --index sebastian embed
qmd --index sebastian status
```

Do not use `qmd update --pull` or collection `update-cmd` in this repository unless a Git pull is explicitly desired.

### Retrieval Workflow for This Repo

1. Start with high-signal sources:

```sh
qmd --index sebastian search "query"
qmd --index sebastian vsearch "query"
```

2. Widen to raw transcripts only when needed:

```sh
qmd --index sebastian search "query" -c journals-session
qmd --index sebastian vsearch "query" -c journals-session
```

3. Retrieve exact files once found:

```sh
qmd --index sebastian get "notes/qmd.md"
qmd --index sebastian get "journals-daily/20260402.md"
qmd --index sebastian get "journals-session/20260407202706593-ses_2981de1b6ffepySEjWWhBQMtNy.md:60" -l 40
```

### Best Practices

- Do not index the entire repository root by default; it mixes operational notes with unrelated markdown and hurts ranking.
- Prefer one topic per note file and explicit headings with stable terms such as project names, commands, file paths, and dates.
- Use `search` for exact strings, filenames, commands, or IDs.
- Use `vsearch` when the concept is known but the wording is not.
- Use `query` only when best-quality ranking is worth the extra local model cost.
- Expect the first semantic or hybrid runs to download local models and use noticeable disk space.
- Consider adding `memory/` later as a separate collection if summary documents should participate directly in retrieval.
