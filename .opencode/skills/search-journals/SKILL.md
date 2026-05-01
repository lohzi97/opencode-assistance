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
2. Run keyword search on `journals-daily`, up to 5 attempts:

```sh
qmd --index sebastian search "<query>" -c journals-daily --json -n 10
```

3. If the daily keyword results are not good enough, run semantic search on `journals-daily`, up to 3 attempts:

```sh
qmd --index sebastian vsearch "<query>" -c journals-daily --json -n 10
```

4. If the daily semantic results are still not good enough, run hybrid search on `journals-daily`, up to 2 attempts:

```sh
qmd --index sebastian query "<query>" -c journals-daily --json -n 10 --min-score 0.3
```

### Phase 2: Widen to `journals-session` Only If Needed

1. If `journals-daily` reveals useful dates, topics, or session clues but lacks the needed detail, search `journals-session` next using those clues first.
2. Start with keyword search on `journals-session`, up to 5 attempts:

```sh
qmd --index sebastian search "<query>" -c journals-session --json -n 10
```

3. If needed, continue with semantic search, up to 3 attempts:

```sh
qmd --index sebastian vsearch "<query>" -c journals-session --json -n 10
```

4. If still needed, continue with hybrid search, up to 2 attempts:

```sh
qmd --index sebastian query "<query>" -c journals-session --json -n 10 --min-score 0.3
```

5. If `journals-daily` yields nothing useful at all, you may still search `journals-session` globally, but only after finishing the daily-first ladder above.

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
