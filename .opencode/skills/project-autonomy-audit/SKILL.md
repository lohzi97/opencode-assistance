---
name: project-autonomy-audit
description: Audit a project directory or PRD to identify tools, MCPs, CLIs, APIs, credentials, permissions, and observability needed for autonomous AI development and testing. Use when the user asks what capabilities an agent needs to develop a project autonomously.
---

# Project Autonomy Audit

Assess what capabilities an AI agent needs to develop, run, verify, and maintain a target project without human intervention.

## When To Use

Use this skill for prompts like:

- "Given `/path/to/project`, what tools/MCPs/CLIs/APIs are needed to perform autonomous development?"
- "I have `/path/to/prd.md`; tell me what capabilities I need to give an AI agent so it can be developed autonomously without human interaction."
- "Audit this repo for autonomous agent readiness."
- "What is missing before an agent can build and test this by itself?"

## Core Rules

- Default to read-only inspection. Do not modify the target project, install dependencies, create configs, start long-lived services, or initialize git unless the user explicitly asks.
- Audit capability, not implementation quality. Mention obvious architectural blockers only when they affect autonomy.
- Distinguish smooth automation from awkward automation. A task being technically possible does not make it operationally good.
- Be explicit about assumptions, required credentials, external accounts, paid services, devices, and human approval gates.
- Prefer concrete tool names over generic labels. For example, say `chrome-devtools MCP`, `Playwright MCP`, `psql`, `docker compose`, `aws CLI`, or `Stripe sandbox` when those are the actual need.
- If a target path is ambiguous or inaccessible, ask one focused clarification before auditing.

## Intake

Establish these inputs before deep inspection:

- Target: project directory, PRD file, design doc, issue, or repository URL already present locally.
- Mode: `brownfield-codebase`, `greenfield-prd`, or `mixed`.
- Desired autonomy depth: development only, unit tests, integration tests, browser E2E, deployment verification, production operations, or full lifecycle.
- Runtime target: local only, Docker, remote server, cloud provider, mobile device, desktop app, browser extension, embedded/hardware, or unknown.
- Constraints: allowed MCPs, forbidden external services, security boundaries, credential availability, and whether network access is permitted.

Infer what is safe from the target files and conversation. Ask only for details that materially change the audit.

## Workflow

1. Inspect the target material.

   For a brownfield project, identify:
   - language, framework, package manager, build system, and test runners
   - app type: web, API, CLI, worker, mobile, desktop, data pipeline, infra, library, plugin, agent, or mixed
   - runtime dependencies: databases, queues, caches, object storage, browsers, emulators, Docker services, cloud services, third-party APIs, secrets
   - existing scripts, docs, CI, test fixtures, seed data, dev containers, compose files, IaC, and deployment manifests
   - current `.opencode`, `opencode.json`, MCP, skill, plugin, and agent configuration when present

   For a greenfield PRD, identify:
   - required product surfaces: UI screens, APIs, jobs, workflows, integrations, admin tools, reports, notifications
   - likely stack if specified; otherwise list stack-agnostic capability requirements
   - acceptance criteria, edge cases, operational needs, data model expectations, and external dependencies
   - testability risks created by vague requirements or missing environment assumptions

2. Inventory available agent capabilities.

   Consider:
   - terminal and PTY access for package managers, test runners, servers, CLIs, logs, Docker, and process control
   - file tools for reading, searching, and patching source files
   - browser/UI tools such as Chrome DevTools MCP, Playwright MCP, Steel Browser, screenshots, OCR, and GUI control
   - data tools such as database CLIs/MCPs, migration tools, queue CLIs, cache CLIs, and object-storage CLIs
   - cloud/provider CLIs such as `aws`, `gcloud`, `az`, `vercel`, `flyctl`, `kubectl`, `terraform`, or `pulumi`
   - API tooling such as `curl`, HTTP clients, WebSocket/SSE clients, sandbox accounts, mock servers, and API keys
   - observability tools such as log access, structured logs, traces, metrics, process managers, container logs, browser console/network inspection, and error dashboards
   - available local skills, custom agents, plugins, MCP servers, and permission rules relevant to autonomous work

3. Map project needs to capabilities.

   For each development and verification activity, determine:
   - what the agent must do
   - which tool/MCP/CLI/API/permission enables it
   - whether the capability already exists, must be configured, or cannot be provided safely
   - how the agent would prove success without human observation
   - what cleanup or rollback capability is required

4. Classify each capability.

   Use these categories exactly:
   - `Supported`: available and straightforward for autonomous use
   - `Supported but awkward`: possible, but indirect, brittle, slow, invasive, or hard to debug
   - `Unsupported but addable`: not currently available, but can be added through MCP, CLI, config, credentials, sandbox, fixture, or permission changes
   - `Unsupported/blocking`: cannot be autonomous without human action, unavailable infrastructure, unavailable credentials, physical access, legal/security approval, or major product clarification

5. Call out awkward paths plainly.

   Examples of awkward but possible automation:
   - using `curl` to inspect built HTML when browser DOM, console, network, or screenshots are required
   - SSHing into a host and writing temporary scripts to inspect a database instead of using a database CLI/MCP with least-privilege access
   - scraping log files over shell instead of using structured log queries
   - manually driving a GUI through screenshots/OCR when a browser, emulator, or product API exists
   - editing remote state directly because no admin/test API exists
   - testing emails, payments, OAuth, or notifications against production-like services without sandbox tooling

6. Produce the report.

   Provide a concise but complete report with this structure:

   ```markdown
   ## Autonomy Verdict
   - Verdict: Ready / Mostly ready / Not ready
   - Primary blockers: ...
   - Recommended next action: ...

   ## Target Summary
   - Mode: ...
   - Project/app type: ...
   - Expected runtime: ...
   - Development surfaces: ...
   - Verification surfaces: ...

   ## Capability Matrix
   | Area | Required capability | Current status | Needed tool/MCP/CLI/API/permission | Notes |
   | --- | --- | --- | --- | --- |

   ## Supported
   - ...

   ## Supported But Awkward
   - ...

   ## Unsupported But Addable
   - ...

   ## Unsupported Or Blocking
   - ...

   ## Recommended Capability Set
   - MCPs: ...
   - CLIs: ...
   - APIs/sandboxes: ...
   - Credentials/secrets: ...
   - Agent permissions: ...
   - Skills/plugins: ...
   - Test fixtures/data: ...

   ## Autonomous Test Strategy
   - Unit: ...
   - Integration: ...
   - E2E/manual-style: ...
   - Observability/proof of correctness: ...
   - Cleanup/rollback: ...

   ## Assumptions And Open Questions
   - ...
   ```

## Verification Guidance

When possible, verify claims by inspecting actual files and command availability rather than guessing. Use non-mutating commands only, such as version checks, config reads, package-script inspection, and listing installed tools. Do not run commands that install, migrate, deploy, seed, delete, or start persistent infrastructure unless the user explicitly approves that expansion.

If the audit requires public internet research for a framework, provider, or integration, use the available web-search workflow and cite the specific finding in the report.

## Output Standard

End with a practical recommendation:

- If ready, say what autonomous workflow can safely begin.
- If mostly ready, list the smallest set of additions needed before autonomy is dependable.
- If not ready, list the blocking capabilities first and avoid pretending a brittle workaround is acceptable.
