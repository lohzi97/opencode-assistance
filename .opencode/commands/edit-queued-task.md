---
description: Edit a queued proactive task item
agent: sebastian
---

Arguments: `$ARGUMENTS`

The first token is the queue ID. The remainder must be a JSON object or JSON file path containing allowed queued-item patch fields.

Allowed fields:

1. `instructions`
2. `priority`
3. `ttl_ms`
4. `agent`
5. `model`
6. `context`
7. `dedupe_key`
8. `not_before`

Invoke `.opencode/scripts/edit-queued-task` and return its JSON output directly.
