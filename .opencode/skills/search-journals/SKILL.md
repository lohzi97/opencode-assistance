---
name: search-journals
description: Search the repository journals with qmd by checking daily summaries first, then session logs only when needed, and verify findings with qmd get.
---

# Search Journals

## What qmd is

`qmd` is an on-device search engine for markdown documents. It searches indexed markdown using BM25 keyword search, vector semantic search, and hybrid search with query expansion and reranking. In this repository, use it to discover likely journal files first, then verify exact source content with `qmd get`.

## When to use me

Use this skill when you need information from `journals/`, including prior conversations, chronology, exact past wording, debugging history, and what happened on a particular date.

## Rules

- Run `qmd` from the repository root.
- Always use `qmd --index sebastian`.
- Always pin collections explicitly with `-c journals-daily` or `-c journals-session`.
- Search `journals-daily` first. Use `journals-session` only when the daily summaries are insufficient for the required detail.
- Only use search-related `qmd` commands in this workflow: `search`, `vsearch`, `query`, and `get`.
- Do not run `status`, `collection`, `update`, `embed`, or any other non-search `qmd` command unless the user explicitly gives permission.
- If a `qmd` command fails or indicates that the index is unhealthy, pause and inform the user instead of switching to maintenance commands on your own.
- Discovery should use `--json`. Verification should use `qmd get`.
- Standardize dates as `YYYYMMDD`.
- Do not use `qmd multi-get` in this workflow; standardize on `qmd get`.
- Include the verified source path and date in the final reply.

## Search Ladder

Work through the stages in order. Do not skip ahead.

### Phase 1: Search `journals-daily` First

1. Start with exact keywords, dates, topic terms, and likely headings.
2. Run keyword search on `journals-daily`, up to 5 attempts.
Use `search` for exact anchors only: dates, commands, topic names, project names, headings, identifiers, or a very small exact phrase.
Do not stuff multiple loose keywords into one `search` query; if several anchors seem relevant, try them one by one or in very small precise combinations:

```sh
qmd --index sebastian search "<query>" -c journals-daily --json -n 10
```

3. If there is no daily keyword result or the daily keyword results are not good enough, run semantic search on `journals-daily`, up to 3 attempts, using paraphrases, concept-focused phrases, or wording that captures intent when the exact text is uncertain.
Use `vsearch` for semantic retrieval, not exact-token hunting:

```sh
qmd --index sebastian vsearch "<query>" -c journals-daily --json -n 10
```

4. If the daily semantic results are still empty or not good enough, run hybrid search on `journals-daily`, up to 2 attempts.
Use `query` for the highest-quality pass when the request is broad, ambiguous, loosely phrased, or when retrieval quality matters more than runtime. Treat it as the most expensive search mode and not the default:

```sh
qmd --index sebastian query "<query>" -c journals-daily --json -n 10 --min-score 0.3
```

### Phase 2: Widen to `journals-session` Only If Needed

1. If `journals-daily` reveals useful dates, topics, or session clues but lacks the needed detail, search `journals-session` next using those clues first.
2. Start with keyword search on `journals-session`, up to 5 attempts.
Use `search` for exact anchors only: dates, session IDs, commands, topic names, headings, identifiers, or a very small exact phrase.
Do not stuff multiple loose keywords into one `search` query; if several anchors seem relevant, try them one by one or in very small precise combinations:

```sh
qmd --index sebastian search "<query>" -c journals-session --json -n 10
```

3. If there is no session keyword result or the session keyword results are not good enough, continue with semantic search, up to 3 attempts, using paraphrases, concept-focused phrases, or wording that captures intent when the exact text is uncertain.
Use `vsearch` for semantic retrieval, not exact-token hunting:

```sh
qmd --index sebastian vsearch "<query>" -c journals-session --json -n 10
```

4. If semantic search is still empty or not good enough, continue with hybrid search, up to 2 attempts.
Use `query` for the highest-quality pass when the request is broad, ambiguous, loosely phrased, or when retrieval quality matters more than runtime. Treat it as the most expensive search mode and not the default:

```sh
qmd --index sebastian query "<query>" -c journals-session --json -n 10 --min-score 0.3
```

5. If `journals-daily` yields nothing useful at all, you may still search `journals-session` globally, but only after finishing the daily-first ladder above.

## Examples

### `qmd search` examples

Use `search` with one exact anchor or a very small exact phrase:

```sh
qmd --index sebastian search "20260503" -c journals-daily --json -n 10
qmd --index sebastian search "qmd" -c journals-daily --json -n 10
qmd --index sebastian search "Vulkan" -c journals-daily --json -n 10
qmd --index sebastian search "ses_213c56b85ffe5iClm4u0SjzAi2" -c journals-session --json -n 10
```

Good uses:

- an exact date such as `20260503`
- a command name like `qmd`
- a product or topic name like `Vulkan`
- a specific session ID such as `ses_213c56b85ffe5iClm4u0SjzAi2`

Avoid this style for `search`:

```sh
qmd --index sebastian search "install script qmd node-llama-cpp vulkan" -c journals-daily --json -n 10
```

That kind of loose keyword bundle is usually a poor BM25 query. Split it into separate searches or very small precise combinations instead.

### `qmd vsearch` examples

Use `vsearch` when you know the concept but not the exact wording:

```sh
qmd --index sebastian vsearch "session where we discussed qmd usage" -c journals-daily --json -n 10
qmd --index sebastian vsearch "conversation about gpu backend issues for local models" -c journals-daily --json -n 10
qmd --index sebastian vsearch "past session about sebastian memory architecture" -c journals-session --json -n 10
```

Good uses:

- paraphrases of likely journal content
- concept-focused descriptions
- intent phrasing when the exact date, heading, or keyword is unknown

### `qmd query` examples

Use `query` when the request is broad, ambiguous, or requires the best retrieval quality:

```sh
qmd --index sebastian query "Which journal entry explains how Sebastian should use qmd and what workflow was agreed?" -c journals-daily --json -n 10 --min-score 0.3
qmd --index sebastian query "Find the past discussion about Vulkan or local model setup problems and summarize what was concluded" -c journals-daily --json -n 10 --min-score 0.3
qmd --index sebastian query "Find the most relevant past session where Sebastian searched notes poorly and the correction that was given" -c journals-session --json -n 10 --min-score 0.3
```

Good uses:

- natural-language questions
- broad requests with multiple possible phrasings
- cases where `search` and `vsearch` did not produce a clear answer

### Full journal search flow example

Example goal: find the past discussion about `qmd`, local model setup, and `Vulkan`.

1. Start with exact anchors in `journals-daily` using `search`:

```sh
qmd --index sebastian search "qmd" -c journals-daily --json -n 10
qmd --index sebastian search "Vulkan" -c journals-daily --json -n 10
qmd --index sebastian search "node-llama-cpp" -c journals-daily --json -n 10
```

2. If exact search has no result or is not good enough, try semantic phrasing in `journals-daily` with `vsearch`:

```sh
qmd --index sebastian vsearch "daily summary about qmd setup and usage" -c journals-daily --json -n 10
qmd --index sebastian vsearch "daily summary about local model runtime or gpu backend issues" -c journals-daily --json -n 10
```

3. If semantic search still has no result or is not good enough, use `query` in `journals-daily` for the highest-quality pass:

```sh
qmd --index sebastian query "Find the daily summary that mentions qmd usage and any related local model or Vulkan setup issues" -c journals-daily --json -n 10 --min-score 0.3
```

4. If the daily results reveal useful dates or clues but still lack exact detail, widen to `journals-session` and repeat the ladder:

```sh
qmd --index sebastian search "qmd" -c journals-session --json -n 10
qmd --index sebastian vsearch "session about qmd setup and usage" -c journals-session --json -n 10
qmd --index sebastian query "Find the past session that discussed qmd usage and any related local model or Vulkan setup issues" -c journals-session --json -n 10 --min-score 0.3
```

5. After discovery, verify the most likely matches with `qmd get`:

```sh
qmd --index sebastian get "journals-daily/20260501.md"
qmd --index sebastian get "journals-session/20260501181947105-ses_21d329df1ffejWC54ofMlAXIvf.md"
```

## What "Not Good Enough" Means

Use soft judgment. Results are not good enough when no retrieved result clearly answers the request after verification, or when the likely matches are partial, tangential, conflicting, or missing the exact detail requested.

## Verification

1. Review the discovery results and choose the most likely candidates.
2. Verify them with `qmd get`, using judgment-based selection up to 5 documents.
3. Prefer daily summaries when they are sufficient. Read session logs only as far as needed to answer the exact question.
4. Use collection-relative paths or docids from the discovery output.

```sh
qmd --index sebastian get "<path-or-docid>"
```

5. If the request also needs durable project memory, load `search-notes` after this skill and merge the verified findings.

## Output

- Answer directly from verified content.
- Include the verified source path and `YYYYMMDD` date when available.
- State clearly when evidence is partial or uncertain.
