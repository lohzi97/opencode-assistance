---
name: create-custom-agent
description: Create an OpenCode custom agent (primary or subagent) from completed work by summarizing the work, consulting the agents docs, and writing the agent markdown file with proper frontmatter, permissions, and prompt. Use when the user asks to create, write, or build a new agent based on completed work or a described role.
---

# Create Custom Agent

Use this skill when the user says something like "Based on what you have done, create a xxx agent for it" or asks to create a new agent.

## Process

1. Summarize what you have done or what the agent should do into a concise role definition.
2. Read the OpenCode agents documentation before writing anything.
   - Use the official agents guide: `https://opencode.ai/docs/agents/`
   - Inspect existing agent files in `.opencode/agents/` for conventions.
3. Decide the agent structure using the guidelines below.
4. Create the agent file with proper frontmatter and prompt.
5. Verify against the review checklist.

## Agent File Location

Place project agents in `.opencode/agents/<name>.md`.
The markdown filename (without `.md`) becomes the agent name.

Global agents go in `~/.config/opencode/agents/<name>.md`.

## Frontmatter Reference

Every agent file must start with YAML frontmatter. Only `description` is required, but most agents need `mode` and `permission` too.

```yaml
---
description: <required, 1-1024 chars, what the agent does and when to use it>
mode: primary | subagent
model: <optional, provider/model-id, defaults to parent agent model>
temperature: <optional, 0.0-1.0>
top_p: <optional, 0.0-1.0>
steps: <optional, max agentic iterations>
hidden: <optional, true hides subagent from @ autocomplete>
color: <optional, hex color or theme color name>
disable: <optional, true to disable>
permission:
  "*": allow | ask | deny
  read: allow | ask | deny | <glob-pattern map>
  edit: allow | ask | deny | <glob-pattern map>
  glob: allow | ask | deny | <glob-pattern map>
  grep: allow | ask | deny | <glob-pattern map>
  list: allow | ask | deny | <glob-pattern map>
  bash: allow | ask | deny | <glob-pattern map>
  task: allow | ask | deny | <glob-pattern map>
  external_directory: allow | ask | deny | <glob-pattern map>
  todowrite: allow | ask | deny
  webfetch: allow | ask | deny
  websearch: allow | ask | deny
  lsp: allow | ask | deny | <glob-pattern map>
  skill: allow | ask | deny | <glob-pattern map>
  question: allow | ask | deny
  doom_loop: allow | ask | deny
---
```

## Writing a Good Description

The description is what the orchestrator uses to decide when to invoke this agent. It also appears in the `@` autocomplete menu for subagents.

**Goal**: State what the agent does and when to use it.

**Format**:
- First sentence: what it does.
- Second sentence: "Use when [specific triggers]."

**Good example**: `Searches the public internet and collects verified information. Use when you need to research topics, find documentation, or look up facts online.`

**Bad example**: `Helps with research.`

## Permission Keys and What They Gate

| Key | Tools gated |
|---|---|
| `*` (catch-all) | All tools -- matches any permission name |
| `read` | `read` |
| `edit` | `write`, `edit`, `apply_patch` |
| `glob` | `glob` |
| `grep` | `grep` |
| `list` | `list` |
| `bash` | `bash` |
| `task` | `task` |
| `external_directory` | Any tool accessing files outside the project worktree |
| `todowrite` | `todowrite`, `todoread` |
| `webfetch` | `webfetch` |
| `websearch` | `websearch` |
| `lsp` | `lsp` |
| `skill` | `skill` |
| `question` | `question` |
| `doom_loop` | Recovery prompts when agent appears stuck |

## How Permission Evaluation Works

Understanding precedence is critical for writing correct agent configs.

**Baseline**: Every agent inherits default permissions that broadly allow tools (`"*": allow`), with specific overrides for safety (`*.env` files ask, `external_directory` asks, `doom_loop` asks, etc.). The user's global `opencode.json` permission config is then layered on top.

**Agent config is merged last**: The agent's own `permission:` block is appended after defaults and user global rules.

**Last match wins** (`findLast`): When a tool triggers a permission check, OpenCode evaluates all rules in order and picks the **last** matching rule. This means agent-specific rules always override earlier defaults.

**Wildcard `*`**: The `*` character matches everything, including `/`. It is effectively a globstar, not a shell glob. A pattern like `"*"` matches any string.

### Catch-all pattern

Use `"*": deny` to create a deny-by-default agent. This is strongly recommended for restrictive subagents to prevent future OpenCode tools from slipping through uncontrolled.

```yaml
permission:
  "*": deny            # deny everything by default
  bash: allow          # explicitly allow only what's needed
  skill: allow
  todowrite: allow
```

### Value forms

**String form** -- applies to all patterns (`"*"`):
```yaml
bash: allow            # → { permission: "bash", pattern: "*", action: "allow" }
```

**Object form** -- per-pattern rules. `findLast` means later entries override earlier ones:
```yaml
bash:
  "*": ask             # default: ask
  "git status *": allow   # allow git status
  "git push": ask         # but still ask for push
```

### Path expansion

Patterns in the object form support `~` and `$HOME` expansion (prefix only):
- `~/.config/*` → `/home/<user>/.config/*`
- `$HOME/projects/*` → `/home/<user>/projects/*`

Other patterns pass through unchanged.

### `read` vs `external_directory` -- two separate checks

When the `read` tool accesses a file outside the project, **both** permissions are checked:

1. `external_directory` -- checked against the **absolute path** glob (e.g., `/home/user/.config/app/*`)
2. `read` -- checked against the path **relative to the worktree** (e.g., `../../.config/app/file`)

This means `read: { "/absolute/path/*": allow }` will **not** match, because the `read` permission is evaluated against relative paths. To allow reading external files, grant `external_directory` for the absolute path and ensure `read` is not denied.

### `external_directory` scoping

`external_directory` accepts an object with path patterns for fine-grained control:

```yaml
external_directory:
  "~/.gemini/antigravity-cli/*": allow
```

When omitted, the default `"*": ask` applies (which effectively denies for non-interactive subagents since no user is available to approve).

Keys that accept glob maps: `*`, `bash`, `task`, `read`, `edit`, `glob`, `grep`, `list`, `skill`, `external_directory`, `lsp`.

## Agent Prompt Best Practices

Treat the prompt as an **API contract**, not a conversation:

1. **One job only** -- the agent should have a single, clear responsibility.
2. **Name the role** -- "You are [Name], a specialist [role]."
3. **State the single responsibility** -- one sentence defining the agent's only job.
4. **List rules as flat bullets** -- behavioral constraints, tool restrictions, error handling.
5. **Define the output format** -- explicit field names the agent must return.
6. **Keep it under 200 lines** -- if longer, the prompt may be too broad; consider splitting.
7. **Avoid restating skill workflows** -- reference skills by name instead of duplicating their instructions.
8. **Handle failures explicitly** -- tell the agent what to do when its primary tool fails.

## Prompt Template

```markdown
---
description: <what it does>
mode: subagent
temperature: 0.1
permission:
  "*": deny
  <only the tools this agent needs, explicitly allowed>
---

You are <Name>, a specialist <role>.

Your only job is to <single responsibility>.

Rules:
- <behavioral constraint>
- <tool restriction>
- <error handling>
- <output discipline>

Return format:
- `field_1`
- `field_2`
- `field_n`
```

## Decision Guide: Primary vs Subagent

- **Primary**: use for agents the user interacts with directly (Tab to switch). Example: build, plan.
- **Subagent**: use for agents invoked programmatically or via `@mention`. Example: code reviewer, web researcher.
- **Hidden subagent**: use for internal workers that should only be invoked by other agents via the Task tool.

## Decision Guide: When to Create a New Agent

Create a new agent when:
- The capability needs a **distinct toolset** from existing agents.
- The capability has a **different safety boundary** (e.g. read-only vs write).
- The capability is **reused repeatedly** across different tasks.
- The existing agent has **too many tools** (>10), causing confusion.

Do not create a new agent when:
- A skill or command can handle it.
- The capability is a one-off task.
- Adding a tool to an existing agent is sufficient.

## Review Checklist

After drafting, verify:

- [ ] `description` includes triggers ("Use when...")
- [ ] `description` is under 1024 chars
- [ ] `mode` is set (`primary` or `subagent`)
- [ ] Permissions follow least-privilege -- only allow what the agent needs
- [ ] Restrictive subagents use `"*": deny` catch-all with explicit allows
- [ ] `external_directory` is scoped to specific paths (not bare `allow`) if the agent needs external file access
- [ ] Permission keys use valid names from the reference table above
- [ ] Prompt states a single responsibility
- [ ] Prompt lists rules as flat bullets
- [ ] Prompt defines a clear output format
- [ ] Prompt is under 200 lines
- [ ] No time-sensitive info unless inherently part of the agent
- [ ] Consistent terminology throughout
- [ ] Filename matches the intended agent name
- [ ] The agent is focused on the user's requested intent

## Output Expectations

- Be concise.
- Preserve the user's requested intent.
- Prefer a reusable agent that can be invoked by name or `@mention`.
