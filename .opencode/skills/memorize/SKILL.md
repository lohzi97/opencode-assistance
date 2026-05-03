---
name: memorize
description: Capture direct remember or forget requests into memory.
---

# Memorize

Use this skill when the Master makes an explicit direct memory request, such as `remember this`, `memorize this`, `keep this in mind`, `store this into your memory`, `forget this`, or `stop remembering that`.

## Purpose

- Capture the request into `memory/candidates/` or `memory/private-candidates/`.
- Never write directly into `memory/canonical/` or `memory/private/private.md`.
- Acknowledge that the request is pending review through `/update-memory`.

## Core Rules

- Ask one short clarification question if the requested remembered or forgotten statement is ambiguous.
- Treat pending candidates as pending review only, not approved runtime truth.
- Use one candidate file per direct request.
- Use `YYYYMMDDHHmmss` for `captured-at` and `YYYYMMDD` for `last-confirmed`.
- Prefer `basis: explicit-user-statement` for direct remember requests.
- Use `action: remove` for direct forget requests.
- Use `target: private` for approved private or sensitive memory requests.

## Private And Secret Handling

- If the request is private or sensitive but not clearly a raw secret, write it to `memory/private-candidates/`.
- If the request includes a raw secret such as a password, token, private key, or recovery code, warn clearly that storing it in this repo is high risk because Git history may retain it.
- Only proceed with raw secret capture if the Master explicitly confirms they still want it stored.
- If the Master does not clearly confirm, do not write the candidate.

## Candidate File Format

Use this exact normalized shape:

```markdown
---
status: pending-review
source-kind: direct-request
captured-at: YYYYMMDDHHmmss
session-id: ses_xxx or unknown-session
---

## Entry 1

- action: add|remove
- target: master|working-preferences|environment|projects|private
- basis: explicit-user-statement
- statement: <normalized statement>
- scope: global
- provenance: session:<session-id>@<captured-at>
- last-confirmed: YYYYMMDD
- note-path-suggestion:
```

## How To Write The Candidate

1. Determine the normalized statement and target file.
2. Run `date +%Y%m%d%H%M%S` and `date +%Y%m%d` in the shell.
3. Take note of the current session id. If absent, use `unknown-session`.
4. Choose the destination directory:
   - normal requests: `memory/candidates/`
   - private requests or explicitly confirmed raw secrets: `memory/private-candidates/`
5. Create a filename using one file per direct request:
   - normal: `YYYYMMDDHHmmss-direct-request.md`
   - private: `YYYYMMDDHHmmss-private-request.md`
6. Write the candidate file.
7. Tell the Master the request was captured as a pending candidate and is not active durable memory until `/update-memory` reviews and applies it.

## Target Guidance

- `master`: stable Master facts, collaboration-relevant personal facts, approved recurring personal dates.
- `working-preferences`: communication style, operating preferences, broad corrections, risk and reporting preferences.
- `environment`: stable machine, repo, tooling, and environment facts.
- `projects`: compact durable project orientation only.
- `private`: explicitly approved sensitive facts and explicitly confirmed raw secrets.

## Scope Guidance

- Default to `global`.
- If the Master explicitly scopes the statement to a project, keep the candidate scoped to that project and mention in the statement which project it belongs to so `/update-memory` can route it toward `notes/projects/<slug>.md` if appropriate.
