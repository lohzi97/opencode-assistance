import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { __test__, DEFAULT_CAPS, loadState, PHASES } from "./opsx-flow.ts";

function runGit(directory: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd: directory, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout.trim();
}

describe("opsx-flow config", () => {
  it("parses start flags without treating option values as positionals", () => {
    expect(__test__.parseStartArgs(["flow.jsonc", "--no-ui", "--foreground", "--ui-port", "4555"])).toEqual({
      configPath: path.resolve("flow.jsonc"),
      noUi: true,
      foreground: true,
      uiPort: 4555,
    });
  });

  it("loads JSONC, applies defaults, and accepts per-phase model/cap overrides", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-config-"));
    try {
      const project = path.join(root, "project");
      const proposal = path.join(project, "openspec", "changes", "demo");
      await mkdir(proposal, { recursive: true });
      await writeFile(path.join(proposal, "proposal.md"), "# Demo\n");
      await writeFile(path.join(proposal, "tasks.md"), "- [ ] one\n");
      const configFile = path.join(root, "flow.jsonc");
      await writeFile(configFile, `{
        // comments are valid JSONC
        "projectDir": ${JSON.stringify(project)},
        "proposal": "demo",
        "baseBranch": "main",
        "caps": { "apply": 8 },
        "phases": { "code-review": { "provider": "openai", "model": "gpt-test", "variant": "medium", "cap": 4 } }
      }`);
      const config = await __test__.loadFlowConfig(configFile);
      expect(config.branch).toBe("openspec/demo");
      expect(config.fromStage).toBe("review-proposal");
      expect(config.caps).toEqual({ ...DEFAULT_CAPS, apply: 8 });
      const phase = __test__.resolvePhase(config, PHASES.find((candidate) => candidate.id === "code-review")!);
      expect(phase.provider).toBe("openai");
      expect(phase.model).toBe("gpt-test");
      expect(phase.cap).toBe(4);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a missing required baseBranch", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-config-"));
    try {
      const file = path.join(root, "flow.jsonc");
      await writeFile(file, JSON.stringify({ projectDir: root, proposal: "demo" }));
      await expect(__test__.loadFlowConfig(file)).rejects.toThrow("baseBranch");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects unknown config properties and string caps", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-config-"));
    try {
      const file = path.join(root, "flow.jsonc");
      await writeFile(file, JSON.stringify({ projectDir: root, proposal: "demo", baseBranch: "main", extra: true }));
      await expect(__test__.loadFlowConfig(file)).rejects.toThrow("unknown config property");
      await writeFile(file, JSON.stringify({ projectDir: root, proposal: "demo", baseBranch: "main", caps: { apply: "2" } }));
      await expect(__test__.loadFlowConfig(file)).rejects.toThrow("JSON number");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fills missing state cap families when loading an older state file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-state-"));
    try {
      const project = path.join(root, "project");
      const stateFile = path.join(root, "state.json");
      await writeFile(
        stateFile,
        JSON.stringify({
          projectDir: project,
          paused: false,
          caps: { apply: 8 },
        }),
      );
      const state = await loadState(stateFile);
      expect(state.caps).toEqual({ ...DEFAULT_CAPS, apply: 8 });
      expect(state.loopCounters).toEqual({});
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("opsx-flow deterministic checks", () => {
  it("counts task boxes and recognizes checkbox-only changes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-checks-"));
    try {
      const tasks = path.join(root, "tasks.md");
      await writeFile(tasks, "- [ ] first\n- [x] second\n");
      expect(__test__.checkboxCount(tasks)).toBe(2);
      expect(__test__.uncheckedCount(tasks)).toBe(1);
      expect(__test__.allTasksChecked(tasks)).toBe(false);
      expect(__test__.onlyCheckboxTogglesBetween("- [ ] first\n", "- [x] first\n")).toBe(true);
      expect(__test__.onlyCheckboxTogglesBetween("- [ ] first\n", "- [x] renamed\n")).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("exposes the state and pause marker paths under openspec", () => {
    expect(__test__.statePath("/tmp/demo")).toBe("/tmp/demo/openspec/.opsx-flow-state.json");
    expect(__test__.pauseMarkerPath("/tmp/demo")).toBe("/tmp/demo/openspec/.opsx-flow-paused");
  });

  it("reports the merge stage instead of incorrectly showing archive after phases finish", () => {
    expect(__test__.displayedPhase(PHASES.length, "running")).toBe("merge");
    expect(__test__.displayedPhase(PHASES.length, "completed")).toBe("completed");
  });

  it("persists an immediate running status when continuing an active daemon", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-continue-"));
    try {
      const project = path.join(root, "project");
      await mkdir(path.join(project, "openspec"), { recursive: true });
      const state = {
        projectDir: project,
        workflowStatus: "paused",
        paused: true,
        daemonPid: process.pid,
        log: [],
      } as never;
      await writeFile(path.join(project, "openspec", ".opsx-flow-paused"), "paused\n");
      await __test__.clearManualPause(project, state);
      expect(state.workflowStatus).toBe("running");
      expect(state.paused).toBe(false);
      expect(await Bun.file(path.join(project, "openspec", ".opsx-flow-paused")).exists()).toBe(false);
      expect(JSON.parse(await Bun.file(path.join(project, "openspec", ".opsx-flow-state.json")).text()).workflowStatus).toBe("running");

      state.workflowStatus = "awaiting-question";
      state.pendingQuestion = null;
      state.paused = true;
      await writeFile(path.join(project, "openspec", ".opsx-flow-paused"), "question answered\n");
      await __test__.clearManualPause(project, state);
      expect(state.workflowStatus).toBe("running");
      expect(state.paused).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not treat an intermediate tool-call assistant message as completion", () => {
    const base = {
      id: "assistant",
      sessionID: "session",
      role: "assistant" as const,
      time: { created: 1, completed: 2 },
      parentID: "user",
      modelID: "model",
      providerID: "provider",
      agent: "levi",
      cost: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    };
    expect(__test__.hasCompletedAssistant([{ info: { ...base, finish: "tool-calls" }, parts: [] }])).toBe(false);
    expect(__test__.hasCompletedAssistant([{ info: { ...base, finish: "stop" }, parts: [] }])).toBe(true);
    expect(__test__.hasCompletedAssistant([{ info: { ...base, time: { created: 1 } }, parts: [] }])).toBe(false);
    expect(__test__.hasCompletedAssistant([{ info: { ...base, finish: "error", error: { data: { message: "failed" } } }, parts: [] }])).toBe(false);
  });

  it("creates the conventional branch only when starting from a clean base branch", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-git-"));
    try {
      const project = path.join(root, "project");
      await mkdir(project, { recursive: true });
      runGit(project, ["init", "-b", "main"]);
      runGit(project, ["config", "user.email", "opsx-flow-test@example.invalid"]);
      runGit(project, ["config", "user.name", "opsx-flow test"]);
      await mkdir(path.join(project, "openspec", "changes", "demo"), { recursive: true });
      await writeFile(path.join(project, "openspec", "changes", "demo", "proposal.md"), "# Demo\n");
      await writeFile(path.join(project, "openspec", "changes", "demo", "tasks.md"), "- [ ] one\n");
      await writeFile(path.join(project, "README.md"), "demo\n");
      runGit(project, ["add", "."]);
      runGit(project, ["commit", "-m", "initial"]);
      runGit(project, ["checkout", "-b", "other"]);

      const configFile = path.join(root, "flow.jsonc");
      await writeFile(configFile, JSON.stringify({ projectDir: project, proposal: "demo", baseBranch: "main" }));
      const config = await __test__.loadFlowConfig(configFile);
      expect(__test__.prepareGit(config)).toBe(project);
      expect(runGit(project, ["branch", "--show-current"])).toBe("openspec/demo");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an omitted branch when switching from a dirty worktree", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-git-"));
    try {
      const project = path.join(root, "project");
      await mkdir(project, { recursive: true });
      runGit(project, ["init", "-b", "main"]);
      runGit(project, ["config", "user.email", "opsx-flow-test@example.invalid"]);
      runGit(project, ["config", "user.name", "opsx-flow test"]);
      await writeFile(path.join(project, "README.md"), "demo\n");
      runGit(project, ["add", "."]);
      runGit(project, ["commit", "-m", "initial"]);
      runGit(project, ["checkout", "-b", "other"]);
      await writeFile(path.join(project, "README.md"), "manual change\n");

      const configFile = path.join(root, "flow.jsonc");
      await writeFile(configFile, JSON.stringify({ projectDir: project, proposal: "demo", baseBranch: "main" }));
      const config = await __test__.loadFlowConfig(configFile);
      expect(() => __test__.prepareGit(config)).toThrow("dirty worktree");
      expect(runGit(project, ["branch", "--show-current"])).toBe("other");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects creation of an empty locked file during a run", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-lock-"));
    try {
      const project = path.join(root, "project");
      const proposal = path.join(project, "openspec", "changes", "demo");
      await mkdir(proposal, { recursive: true });
      runGit(project, ["init", "-b", "main"]);
      runGit(project, ["config", "user.email", "opsx-flow-test@example.invalid"]);
      runGit(project, ["config", "user.name", "opsx-flow test"]);
      await writeFile(path.join(proposal, "proposal.md"), "# Demo\n");
      runGit(project, ["add", "."]);
      runGit(project, ["commit", "-m", "initial"]);

      const tasks = path.join(proposal, "tasks.md");
      await writeFile(tasks, "");
      const state = { projectDir: project, proposalName: "demo", proposalDir: proposal } as never;
      expect(__test__.enforceLock(state, "apply", { existed: false, content: "" })).toBe(true);
      expect(await Bun.file(tasks).exists()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("returns false instead of throwing for an untracked locked file comparison", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-lock-"));
    try {
      const project = path.join(root, "project");
      const proposal = path.join(project, "openspec", "changes", "demo");
      await mkdir(proposal, { recursive: true });
      runGit(project, ["init", "-b", "main"]);
      runGit(project, ["config", "user.email", "opsx-flow-test@example.invalid"]);
      runGit(project, ["config", "user.name", "opsx-flow test"]);
      await writeFile(path.join(proposal, "proposal.md"), "# Demo\n");
      runGit(project, ["add", "."]);
      runGit(project, ["commit", "-m", "initial"]);

      const tasks = path.join(proposal, "tasks.md");
      await writeFile(tasks, "- [ ] new\n");
      expect(__test__.onlyCheckboxToggles(project, tasks)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes a locked-file rename destination during enforcement", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-lock-"));
    try {
      const project = path.join(root, "project");
      const proposal = path.join(project, "openspec", "changes", "demo");
      await mkdir(proposal, { recursive: true });
      runGit(project, ["init", "-b", "main"]);
      runGit(project, ["config", "user.email", "opsx-flow-test@example.invalid"]);
      runGit(project, ["config", "user.name", "opsx-flow test"]);
      const tasks = path.join(proposal, "tasks.md");
      await writeFile(path.join(proposal, "proposal.md"), "# Demo\n");
      await writeFile(tasks, "- [ ] one\n");
      runGit(project, ["add", "."]);
      runGit(project, ["commit", "-m", "initial"]);
      runGit(project, ["mv", tasks, path.join(proposal, "tasks-renamed.md")]);
      const state = { projectDir: project, proposalName: "demo", proposalDir: proposal } as never;
      expect(__test__.enforceLock(state, "apply", { existed: true, content: "- [ ] one\n" })).toBe(true);
      expect(await Bun.file(tasks).text()).toBe("- [ ] one\n");
      expect(await Bun.file(path.join(proposal, "tasks-renamed.md")).exists()).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not treat a proposal artifact rename out of the change as clean", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-checks-"));
    try {
      const project = path.join(root, "project");
      const proposal = path.join(project, "openspec", "changes", "demo");
      await mkdir(proposal, { recursive: true });
      runGit(project, ["init", "-b", "main"]);
      runGit(project, ["config", "user.email", "opsx-flow-test@example.invalid"]);
      runGit(project, ["config", "user.name", "opsx-flow test"]);
      await writeFile(path.join(proposal, "proposal.md"), "# Demo\n");
      await writeFile(path.join(proposal, "tasks.md"), "- [ ] one\n");
      runGit(project, ["add", "."]);
      runGit(project, ["commit", "-m", "initial"]);
      runGit(project, ["mv", path.join(proposal, "proposal.md"), path.join(project, "proposal-moved.md")]);

      const state = {
        projectDir: project,
        proposalName: "demo",
        proposalDir: proposal,
        baselineUntracked: [],
      } as never;
      const phase = PHASES.find((candidate) => candidate.id === "review-proposal")!;
      expect(__test__.isPhaseClean(state, {
        ...phase,
        agent: "levi",
        provider: "openai",
        model: "gpt-5.6-luna",
        variant: "max",
        cap: DEFAULT_CAPS.selfHeal,
      })).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("opsx-flow web UI", () => {
  it("serves state and can attach the standalone UI to another project", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-ui-"));
    const startedAt = new Date().toISOString();
    const makeProject = async (name: string) => {
      const project = path.join(root, name);
      const openspec = path.join(project, "openspec");
      await mkdir(openspec, { recursive: true });
      const configPath = path.join(root, `${name}.jsonc`);
      await writeFile(configPath, JSON.stringify({ projectDir: project, proposal: name, baseBranch: "main" }));
      await writeFile(
        path.join(openspec, ".opsx-flow-state.json"),
        JSON.stringify({
          proposalName: name,
          proposalDir: path.join(openspec, "changes", name),
          projectDir: project,
          configPath,
          branch: `openspec/${name}`,
          baseBranch: "main",
          paused: false,
          pauseReason: null,
          caps: { ...DEFAULT_CAPS },
          loopCounters: {},
          currentPhaseIdx: 0,
          workflowStatus: "running",
          startedAt,
          completedAt: null,
          lastUpdated: startedAt,
          pendingQuestion: null,
          baselineUntracked: [],
          implementerSessions: [],
          log: [],
        }),
      );
      return project;
    };

    try {
      const first = await makeProject("first");
      const second = await makeProject("second");
      const server = __test__.createUiServer(first, 0);
      try {
        const firstPage = await fetch(`http://127.0.0.1:${server.port}/`);
        expect(firstPage.status).toBe(200);
        expect(await firstPage.text()).toContain(`value="${first}"`);

        const secondPage = await fetch(`http://127.0.0.1:${server.port}/?projectDir=${encodeURIComponent(second)}`);
        expect(secondPage.status).toBe(200);
        expect(await secondPage.text()).toContain(`value="${second}"`);

        const secondState = await fetch(`http://127.0.0.1:${server.port}/api/state?projectDir=${encodeURIComponent(second)}`);
        expect(secondState.status).toBe(200);
        expect((await secondState.json()).proposal).toBe("second");
      } finally {
        server.stop(true);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("opsx-flow issue-audit config", () => {
  it("resolves issueAudit from the top-level block with DEFAULT_MODEL fallbacks", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-audit-cfg-"));
    try {
      const project = path.join(root, "project");
      const proposal = path.join(project, "openspec", "changes", "demo");
      await mkdir(proposal, { recursive: true });
      await writeFile(path.join(proposal, "proposal.md"), "# Demo\n");
      await writeFile(path.join(proposal, "tasks.md"), "- [ ] one\n");
      const configFile = path.join(root, "flow.jsonc");
      await writeFile(configFile, JSON.stringify({
        projectDir: project,
        proposal: "demo",
        baseBranch: "main",
        issueAudit: { agent: "levi", provider: "openai", model: "gpt-5.6-sol", variant: "medium" },
      }));
      const config = await __test__.loadFlowConfig(configFile);
      expect(config.issueAudit).toEqual({ agent: "levi", provider: "openai", model: "gpt-5.6-sol", variant: "medium" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to DEFAULT_MODEL when issueAudit is omitted", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-audit-cfg-"));
    try {
      const project = path.join(root, "project");
      const proposal = path.join(project, "openspec", "changes", "demo");
      await mkdir(proposal, { recursive: true });
      await writeFile(path.join(proposal, "proposal.md"), "# Demo\n");
      await writeFile(path.join(proposal, "tasks.md"), "- [ ] one\n");
      const configFile = path.join(root, "flow.jsonc");
      await writeFile(configFile, JSON.stringify({ projectDir: project, proposal: "demo", baseBranch: "main" }));
      const config = await __test__.loadFlowConfig(configFile);
      expect(config.issueAudit).toEqual(__test__.DEFAULT_MODEL);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("accepts phases[issue-audit] override and lets it win over the top-level block", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-audit-cfg-"));
    try {
      const project = path.join(root, "project");
      const proposal = path.join(project, "openspec", "changes", "demo");
      await mkdir(proposal, { recursive: true });
      await writeFile(path.join(proposal, "proposal.md"), "# Demo\n");
      await writeFile(path.join(proposal, "tasks.md"), "- [ ] one\n");
      const configFile = path.join(root, "flow.jsonc");
      await writeFile(configFile, JSON.stringify({
        projectDir: project,
        proposal: "demo",
        baseBranch: "main",
        issueAudit: { provider: "openai", model: "gpt-5.6-sol" },
        phases: { "issue-audit": { model: "gpt-5.6-luna", variant: "max" } },
      }));
      const config = await __test__.loadFlowConfig(configFile);
      // Phase-level override takes precedence over the top-level block; fields
      // not overridden by the phase block fall through to the top-level block.
      expect(config.issueAudit).toEqual({
        agent: "levi",
        provider: "openai",
        model: "gpt-5.6-luna",
        variant: "max",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an unknown phase override that is not issue-audit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-audit-cfg-"));
    try {
      const project = path.join(root, "project");
      const proposal = path.join(project, "openspec", "changes", "demo");
      await mkdir(proposal, { recursive: true });
      await writeFile(path.join(proposal, "proposal.md"), "# Demo\n");
      await writeFile(path.join(proposal, "tasks.md"), "- [ ] one\n");
      const configFile = path.join(root, "flow.jsonc");
      await writeFile(configFile, JSON.stringify({
        projectDir: project,
        proposal: "demo",
        baseBranch: "main",
        phases: { "not-a-real-phase": { model: "x" } },
      }));
      await expect(__test__.loadFlowConfig(configFile)).rejects.toThrow("unknown phase override: not-a-real-phase");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("counts re-evaluation and enrichment audit notes in issue.md", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-audit-notes-"));
    try {
      const file = path.join(root, "issue.md");
      await writeFile(file, [
        "- [ ] ISSUE-1: bad",
        "  - **Re-evaluation 1:** cleared by filter",
        "- [ ] ISSUE-2: weird",
        "  - **Enrichment 1 (audit):** convention drift",
        "  - **Enrichment 2:** more context",
        "- [ ] ISSUE-3: kept",
      ].join("\n") + "\n");
      expect(__test__.auditNoteCount(file)).toBe(3);
      expect(__test__.auditNoteCount(path.join(root, "missing.md"))).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("opsx-flow step recording", () => {
  function phaseFor(id: string) {
    const base = PHASES.find((candidate) => candidate.id === id)!;
    return { ...base, agent: "levi", provider: "openai", model: "gpt-5.6-luna", variant: "max", cap: DEFAULT_CAPS.testFix };
  }

  it("implementerSummary reports issue counts for finding phases and task state for apply", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-summary-"));
    try {
      const project = path.join(root, "project");
      const proposal = path.join(project, "openspec", "changes", "demo");
      await mkdir(proposal, { recursive: true });
      const state = {
        proposalName: "demo",
        proposalDir: proposal,
        projectDir: project,
      } as never;

      const issue = path.join(proposal, "issue.md");
      await writeFile(issue, "- [ ] one\n- [ ] two\n- [x] three\n");
      expect(__test__.implementerSummary(state, phaseFor("test"), false)).toBe("2 issues");
      expect(__test__.implementerSummary(state, phaseFor("test"), true)).toBe("2 issues");

      const tasks = path.join(proposal, "tasks.md");
      await writeFile(tasks, "- [ ] one\n- [x] two\n");
      expect(__test__.implementerSummary(state, phaseFor("apply"), false)).toBe("1 task unchecked");
      expect(__test__.implementerSummary(state, phaseFor("apply"), true)).toBe("all tasks checked");

      expect(__test__.implementerSummary(state, phaseFor("align"), true)).toBe("clean");
      expect(__test__.implementerSummary(state, phaseFor("align"), false)).toBe("edits made");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("runIssueAudit skips spawning when issue.md is clean or missing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-audit-skip-"));
    try {
      const project = path.join(root, "project");
      const proposal = path.join(project, "openspec", "changes", "demo");
      await mkdir(proposal, { recursive: true });
      const state = {
        proposalName: "demo",
        proposalDir: proposal,
        projectDir: project,
        branch: "openspec/demo",
        loopCounters: {},
        steps: [],
        log: [],
        caps: { ...DEFAULT_CAPS },
        implementerSessions: [],
        baselineUntracked: [],
      } as never;
      const config = await __test__.loadFlowConfig(path.join(root, "flow.jsonc")).catch(() => undefined);
      const phase = phaseFor("test");

      // No issue.md at all: audit must return without pushing a step.
      await __test__.runIssueAudit(state, phase, { issueAudit: __test__.DEFAULT_MODEL } as never);
      expect(state.steps).toHaveLength(0);

      // Clean issue.md (zero unchecked) must also skip the audit.
      await writeFile(path.join(proposal, "issue.md"), "- [x] already resolved\n");
      await __test__.runIssueAudit(state, phase, { issueAudit: __test__.DEFAULT_MODEL } as never);
      expect(state.steps).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("renders a step-based timeline with sub-steps grouped under their phase", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-steps-ui-"));
    try {
      const project = path.join(root, "project");
      const openspec = path.join(project, "openspec");
      await mkdir(openspec, { recursive: true });
      const startedAt = new Date().toISOString();
      const steps = [
        { skill: "openspec-test", phaseId: "test", runIdx: 1, kind: "implementer", status: "completed", startedAt, completedAt: startedAt, summary: "3 issues" },
        { skill: "openspec-issue-audit", phaseId: "test", runIdx: 1, kind: "issue-audit", status: "completed", startedAt, completedAt: startedAt, summary: "1 cleared, 2 enriched" },
        { skill: "openspec-fix", phaseId: "test", runIdx: 1, kind: "fix", status: "completed", startedAt, completedAt: startedAt, summary: "2 resolved" },
        { skill: "openspec-test", phaseId: "test", runIdx: 2, kind: "implementer", status: "running", startedAt },
      ];
      await writeFile(
        path.join(openspec, ".opsx-flow-state.json"),
        JSON.stringify({
          proposalName: "demo",
          proposalDir: path.join(openspec, "changes", "demo"),
          projectDir: project,
          configPath: "",
          branch: "openspec/demo",
          baseBranch: "main",
          paused: false,
          pauseReason: null,
          caps: { ...DEFAULT_CAPS },
          loopCounters: {},
          currentPhaseIdx: 3,
          workflowStatus: "running",
          startedAt,
          completedAt: null,
          lastUpdated: startedAt,
          pendingQuestion: null,
          baselineUntracked: [],
          implementerSessions: [],
          steps,
          log: [],
        }),
      );
      const server = __test__.createUiServer(project, 0);
      try {
        const state = await (await fetch(`http://127.0.0.1:${server.port}/api/state`)).json();
        // The steps array flows through apiState automatically.
        expect(state.steps).toHaveLength(4);
        expect(state.steps.map((step: { skill: string }) => step.skill)).toEqual([
          "openspec-test",
          "openspec-issue-audit",
          "openspec-fix",
          "openspec-test",
        ]);
        const page = await (await fetch(`http://127.0.0.1:${server.port}/`)).text();
        // The static HTML ships the step-rendering logic and styles; the actual
        // sub-step DOM is built client-side from /api/state (verified above).
        expect(page).toContain("phase-steps");
        expect(page).toContain("stepsByPhase");
        expect(page).toContain(".step.running");
      } finally {
        server.stop(true);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
