---
name: search-notes
description: Search the repository notes collection with qmd using a staged keyword, semantic, and hybrid workflow, then verify results with qmd get.
---

# Search Notes

## What qmd is

`qmd` is an on-device search engine for markdown documents. It searches indexed markdown using BM25 keyword search, vector semantic search, and hybrid search with query expansion and reranking. In this repository, use it to discover likely note files first, then verify exact source content with `qmd get`.

## When to use me

Use this skill when you need information from `notes/`, including durable instructions, stable facts, remembered decisions, and persistent project knowledge.

## Rules

- Run `qmd` from the repository root.
- Always use `qmd --index sebastian`.
- Run `qmd` commands sequentially, one at a time. Never launch multiple `qmd` searches in parallel or through `multi_tool_use.parallel`, because the shared SQLite index can report `database is locked` under concurrent access.
- Always pin the collection explicitly with `-c notes`.
- `qmd` is the preferred retrieval method for `notes/`, but it does not forbid normal tools when they are clearly more appropriate.
- Only use search-related `qmd` commands in this workflow: `search`, `vsearch`, `query`, and `get`.
- Do not run `status`, `collection`, `update`, `embed`, or any other non-search `qmd` command unless the user explicitly gives permission.
- If a `qmd` command fails or indicates that the index is unhealthy, pause and inform the user instead of switching to maintenance commands on your own.
- Discovery should use `--json`. Verification should use `qmd get`.
- Standardize dates as `YYYYMMDD`.
- Do not use `qmd multi-get` in this workflow; standardize on `qmd get`.
- Include the verified source path and date in the final reply.

## Search Ladder

Work through the stages in order. Do not skip ahead.

1. Extract likely exact terms first: project names, commands, file names, headings, dates in `YYYYMMDD`, identifiers, and durable phrasing.
2. Run keyword search first, up to 5 attempts, refining the query each time.
Use `search` for exact anchors only: commands, filenames, headings, dates, IDs, product names, or a very small exact phrase.
Do not stuff multiple loose keywords into one `search` query; if several anchors seem relevant, try them one by one or in very small precise combinations:

```sh
qmd --index sebastian search "<query>" -c notes --json -n 10
```

3. If there is no keyword result or the keyword results are not good enough, run semantic search, up to 3 attempts, using paraphrases, concept-focused phrases, or wording that captures intent when the exact text is uncertain.
Use `vsearch` for semantic retrieval, not exact-token hunting:

```sh
qmd --index sebastian vsearch "<query>" -c notes --json -n 10
```

4. If semantic search is still empty or not good enough, run hybrid search, up to 2 attempts.
Use `query` for the highest-quality pass when the request is broad, ambiguous, loosely phrased, or when retrieval quality matters more than runtime. Treat it as the most expensive search mode and not the default:

```sh
qmd --index sebastian query "<query>" -c notes --json -n 10 --min-score 0.3
```

## Examples

### `qmd search` examples

Use `search` with one exact anchor or a very small exact phrase:

```sh
qmd --index sebastian search "qmd" -c notes --json -n 10
qmd --index sebastian search "vulkan" -c notes --json -n 10
qmd --index sebastian search "node-llama-cpp" -c notes --json -n 10
qmd --index sebastian search "20260502" -c notes --json -n 10
```

Good uses:

- a command name like `qmd`
- a product or library name like `vulkan`
- a file-like or package-like token such as `node-llama-cpp`
- an exact date such as `20260502`

Avoid this style for `search`:

```sh
qmd --index sebastian search "install script qmd node-llama-cpp vulkan" -c notes --json -n 10
```

That kind of loose keyword bundle is usually a poor BM25 query. Split it into separate searches or very small precise combinations instead.

### `qmd vsearch` examples

Use `vsearch` when you know the concept but not the exact wording:

```sh
qmd --index sebastian vsearch "qmd in this repository" -c notes --json -n 10
qmd --index sebastian vsearch "gpu backend issues for local models" -c notes --json -n 10
qmd --index sebastian vsearch "sebastian memory architecture" -c notes --json -n 10
```

Good uses:

- paraphrases of likely note content
- concept-focused descriptions
- intent phrasing when the exact title, heading, or keyword is unknown

### `qmd query` examples

Use `query` when the request is broad, ambiguous, or requires the best retrieval quality:

```sh
qmd --index sebastian query "What note explains how Sebastian should use qmd to search notes?" -c notes --json -n 10 --min-score 0.3
qmd --index sebastian query "Which note discusses Vulkan or local model setup problems and what was concluded?" -c notes --json -n 10 --min-score 0.3
qmd --index sebastian query "Find the most relevant prior guidance about Sebastian memory architecture and retrieval order" -c notes --json -n 10 --min-score 0.3
```

Good uses:

- natural-language questions
- broad requests with multiple possible phrasings
- cases where `search` and `vsearch` did not produce a clear answer

### Full search flow example

Example goal: find notes related to `qmd`, local model setup, and `vulkan`. Even when multiple commands are listed together, run them one by one rather than in parallel.

1. Start with exact anchors using `search`:

```sh
qmd --index sebastian search "qmd" -c notes --json -n 10
qmd --index sebastian search "vulkan" -c notes --json -n 10
qmd --index sebastian search "node-llama-cpp" -c notes --json -n 10
```

2. If exact search has no result or is not good enough, try semantic phrasing with `vsearch`:

```sh
qmd --index sebastian vsearch "notes about qmd setup and usage" -c notes --json -n 10
qmd --index sebastian vsearch "notes about local model runtime or gpu backend issues" -c notes --json -n 10
```

3. If semantic search still has no result or not good enough, use `query` for the highest-quality pass:

```sh
qmd --index sebastian query "Find the note that explains qmd usage and any related local model or Vulkan setup issues" -c notes --json -n 10 --min-score 0.3
```

4. After discovery, verify the most likely matches with `qmd get`:

```sh
qmd --index sebastian get "notes/qmd-usage.md"
qmd --index sebastian get "notes/qmd.md"
```

## What "Not Good Enough" Means

Use soft judgment. Results are not good enough when no retrieved result clearly answers the request after verification, or when the likely matches are partial, tangential, conflicting, or missing the exact detail requested.

## Verification

1. Review the discovery results and choose the most likely candidates.
2. Verify them with `qmd get`, using judgment-based selection up to 5 documents.
3. Prefer the smallest number of documents needed to answer confidently.
4. Use collection-relative paths or docids from the discovery output.

```sh
qmd --index sebastian get "<path-or-docid>"
```

5. If the question also appears to require historical conversation context, load `search-journals` after this skill and merge the verified findings.

## Output

- Answer directly from verified content.
- Include the verified source path and `YYYYMMDD` date when available.
- State clearly when evidence is partial or uncertain.
