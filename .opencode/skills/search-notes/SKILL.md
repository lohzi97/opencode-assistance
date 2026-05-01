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
2. Run keyword search first, up to 5 attempts, refining the query each time:

```sh
qmd --index sebastian search "<query>" -c notes --json -n 10
```

3. If the keyword results are not good enough, run semantic search, up to 3 attempts, using paraphrases or concept-focused phrases:

```sh
qmd --index sebastian vsearch "<query>" -c notes --json -n 10
```

4. If semantic search is still not good enough, run hybrid search, up to 2 attempts:

```sh
qmd --index sebastian query "<query>" -c notes --json -n 10 --min-score 0.3
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
