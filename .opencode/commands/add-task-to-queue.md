---
description: Add an ad-hoc isolated proactive task to the durable queue
agent: sebastian
---

Create one ad-hoc proactive queue item by passing a JSON payload to `.opencode/scripts/add-task-to-queue`.

Input payload: `$ARGUMENTS`

Rules:

1. The argument must be a JSON object or a path to a JSON file.
2. If the argument begins with `{`, pass it to the script via stdin.
3. Otherwise treat it as a file path relative to the repository root unless already absolute.
4. Print the script output directly.

Required payload field:

1. `instructions`

Optional fields:

1. `priority`
2. `ttl_ms`
3. `agent`
4. `model`
5. `context`
6. `dedupe_key`
7. `not_before`

Use Bash to invoke the script.
