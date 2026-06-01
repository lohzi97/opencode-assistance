---
name: write-findings-report
description: Write a detailed findings report to /tmp for handoff to another agent or human review. Use when the master says "write down your findings", "write a report on", "I want to hand this over for review", or asks for a detailed document covering investigation, reasoning, and results of work just completed.
---

# Write Findings Report

## When to use me

The Master asks you to document findings from a completed investigation, fix, research session, or discussion so that another agent or person can review it. This is a handoff artifact -- it must be self-contained, detailed, and reviewable without access to the original conversation.

## Rules

1. Reports are **temporary files**, not notes. Always write to `/tmp/opencode/`.
2. Use the filename format: `YYYYMMDD-<short-kebab-topic>.md` (e.g., `20260601-proactive-cli-timeout-fix.md`).
3. Use the `/tmp/opencode/` directory (create it if it does not exist).
4. Reports must be fully self-contained. Include all context, code references, and reasoning needed for an independent reviewer.
5. Adapt the sections to the nature of the work -- not every report is a bug fix. Use the sections that apply and skip those that do not.

## Report Structure

Use the following section template. Include every section that is relevant; omit sections that do not apply.

```markdown
# <Title>

**Date:** YYYYMMDD
**Component:** <file paths or system areas involved>
**Status:** <Investigating / Fixed / Resolved / Concluded / Open>

---

## 1. Original Statement

What was the original request, question, or problem? Capture it verbatim or near-verbatim from the Master's words. Provide enough context so a reviewer understands what prompted this work.

## 2. Background

Explain the system, architecture, or domain relevant to the statement. Include file paths, data structures, process relationships, or configuration that a reviewer needs to know. Use code blocks, tables, and diagrams where they clarify.

## 3. Findings

List each distinct finding as a numbered or lettered sub-section. For each finding:
- State what was discovered.
- Provide evidence (command output, file contents, log lines, code excerpts).
- Note any uncertainty or assumptions.

If findings interact or compound, add a sub-section explaining how they combine.

## 4. Reasoning

Explain the decision-making process:
- Why certain approaches were chosen or rejected.
- What trade-offs were considered.
- What constraints (time, scope, risk) influenced the decision.

## 5. Proposed Solution / Recommendation

Describe what should be done (or was decided). If multiple options exist, list them with pros/cons and the chosen option clearly marked.

## 6. What Was Done

If implementation occurred, describe each change precisely:
- Which files were modified.
- What was added, removed, or replaced.
- Before/after code snippets for non-trivial changes.
- What was deliberately left unchanged and why.

## 7. Result / Outcome

Show verification:
- Before/after behavior (command output, test results, screenshots).
- Whether the original statement is fully addressed or partially.

List any known trade-offs, limitations, or follow-up items.

## 8. Files Changed

A table listing every modified file and a one-line summary of the change.

## 9. Review Checklist

A list of specific verification points for the reviewing agent to check. Frame each as a concrete assertion that can be confirmed or denied by reading the code.
```

## Workflow

1. Ensure `/tmp/opencode/` exists: `mkdir -p /tmp/opencode`.
2. Gather all relevant context from the current session: what the Master said, what was investigated, what was found, what was done.
3. Write the report following the structure above. Include only sections relevant to the nature of the work (bug fix, research, design discussion, etc.).
4. Write the file to `/tmp/opencode/YYYYMMDD-<short-kebab-topic>.md`.
5. Report the file path back to the Master.
