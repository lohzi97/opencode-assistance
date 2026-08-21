import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { __test__, DEFAULT_CAPS, loadState, PHASES } from "./opsx-flow.ts";
import { __test__ as dashboardTest } from "./opsx-flow-dashboard.ts";
import { OpenCodeClient } from "../server/shared.ts";

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
      const server = dashboardTest.createUiServer(first, 0);
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

describe("opsx-flow substep config", () => {
  async function writeSubstepConfig(root: string, phases: Record<string, unknown>, extra: Record<string, unknown> = {}): Promise<string> {
    const project = path.join(root, "project");
    const proposal = path.join(project, "openspec", "changes", "demo");
    await mkdir(proposal, { recursive: true });
    await writeFile(path.join(proposal, "proposal.md"), "# Demo\n");
    await writeFile(path.join(proposal, "tasks.md"), "- [ ] one\n");
    const configFile = path.join(root, "flow.jsonc");
    await writeFile(configFile, JSON.stringify({ projectDir: project, proposal: "demo", baseBranch: "main", phases, ...extra }));
    return configFile;
  }

  function phaseById(id: string) {
    return PHASES.find((candidate) => candidate.id === id)!;
  }

  it("resolves issue-audit settings per-phase over the global substep block", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-substep-cfg-"));
    try {
      const configFile = await writeSubstepConfig(root, {
        "issue-audit": { provider: "openai", model: "gpt-5.6-sol" },
        "code-review.issue-audit": { model: "gpt-5.6-luna", variant: "max" },
      });
      const config = await __test__.loadFlowConfig(configFile);
      const cr = __test__.resolvePhase(config, phaseById("code-review"));
      // Per-phase override wins field-by-field; unset fields fall through to
      // the global block, then DEFAULT_MODEL.
      expect(__test__.resolveIssueAuditSettings(config, cr)).toEqual({
        agent: "levi",
        provider: "openai",
        model: "gpt-5.6-luna",
        variant: "max",
      });
      const test = __test__.resolvePhase(config, phaseById("test"));
      expect(__test__.resolveIssueAuditSettings(config, test)).toEqual({
        agent: "levi",
        provider: "openai",
        model: "gpt-5.6-sol",
        variant: "max",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resolves fix settings per-phase over global fix over the phase model, and decouples caps", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-substep-fix-"));
    try {
      const configFile = await writeSubstepConfig(root, {
        "code-review": { provider: "openai", model: "gpt-5.6-sol", variant: "xhigh", cap: 15 },
        "code-review.fix": { provider: "deepseek", model: "deepseek-v4-flash", variant: "max", cap: 10 },
      });
      const config = await __test__.loadFlowConfig(configFile);
      const cr = __test__.resolvePhase(config, phaseById("code-review"));
      expect(cr.cap).toBe(15);
      const crFix = __test__.resolveFixPhase(config, cr);
      expect(crFix.model).toBe("deepseek-v4-flash");
      expect(crFix.provider).toBe("deepseek");
      expect(crFix.variant).toBe("max");
      expect(crFix.cap).toBe(10);

      // No per-phase fix block: fields inherit from the phase itself and the
      // fix loop keeps the phase cap (pre-substep behavior).
      const test = __test__.resolvePhase(config, phaseById("test"));
      const testFix = __test__.resolveFixPhase(config, test);
      expect(testFix.model).toBe(__test__.DEFAULT_MODEL.model);
      expect(testFix.variant).toBe(__test__.DEFAULT_MODEL.variant);
      expect(testFix.cap).toBe(test.cap);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("lets a global fix block override phase settings for phases without a specific fix block", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-substep-globalfix-"));
    try {
      const configFile = await writeSubstepConfig(root, {
        "code-review": { provider: "openai", model: "gpt-5.6-sol", variant: "xhigh", cap: 15 },
        fix: { model: "deepseek-v4-flash", cap: 6 },
      });
      const config = await __test__.loadFlowConfig(configFile);
      const cr = __test__.resolvePhase(config, phaseById("code-review"));
      const crFix = __test__.resolveFixPhase(config, cr);
      expect(crFix.model).toBe("deepseek-v4-flash");
      // Unset global fields keep the phase's provider/variant.
      expect(crFix.provider).toBe("openai");
      expect(crFix.variant).toBe("xhigh");
      expect(crFix.cap).toBe(6);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects the removed top-level issueAudit block", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-substep-reject-"));
    try {
      const configFile = await writeSubstepConfig(root, {}, {
        issueAudit: { provider: "openai", model: "gpt-5.6-sol" },
      });
      await expect(__test__.loadFlowConfig(configFile)).rejects.toThrow("unknown config property: issueAudit");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects substep overrides on non-finding phases, unknown substeps, and issue-audit caps", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-substep-reject-"));
    try {
      const applyFix = await writeSubstepConfig(root, { "apply.fix": { model: "x" } });
      await expect(__test__.loadFlowConfig(applyFix)).rejects.toThrow("unknown phase override: apply.fix");

      const bogusSub = await writeSubstepConfig(root, { "test.bogus": { model: "x" } });
      await expect(__test__.loadFlowConfig(bogusSub)).rejects.toThrow("unknown phase override: test.bogus");

      const auditCap = await writeSubstepConfig(root, { "issue-audit": { cap: 2 } });
      await expect(__test__.loadFlowConfig(auditCap)).rejects.toThrow("unknown phases.issue-audit property: cap");

      const phaseAuditCap = await writeSubstepConfig(root, { "test.issue-audit": { cap: 2 } });
      await expect(__test__.loadFlowConfig(phaseAuditCap)).rejects.toThrow("unknown phases.test.issue-audit property: cap");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an unknown phase override that is not a substep", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-substep-reject-"));
    try {
      const configFile = await writeSubstepConfig(root, { "not-a-real-phase": { model: "x" } });
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
      await __test__.runIssueAudit(state, phase, { phases: {} } as never);
      expect(state.steps).toHaveLength(0);

      // Clean issue.md (zero unchecked) must also skip the audit.
      await writeFile(path.join(proposal, "issue.md"), "- [x] already resolved\n");
      await __test__.runIssueAudit(state, phase, { phases: {} } as never);
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
      const server = dashboardTest.createUiServer(project, 0);
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

describe("opsx-flow stop lifecycle", () => {
  const script = path.join(import.meta.dir, "opsx-flow.ts");

  async function writeState(project: string, overrides: Record<string, unknown> = {}): Promise<string> {
    const openspec = path.join(project, "openspec");
    await mkdir(openspec, { recursive: true });
    const startedAt = new Date().toISOString();
    const state = {
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
      currentPhaseIdx: 0,
      workflowStatus: "running",
      startedAt,
      completedAt: null,
      lastUpdated: startedAt,
      pendingQuestion: null,
      baselineUntracked: [],
      implementerSessions: [],
      steps: [],
      log: [],
      ...overrides,
    };
    const file = path.join(openspec, ".opsx-flow-state.json");
    await writeFile(file, JSON.stringify(state));
    return file;
  }

  function busyClient(): OpenCodeClient {
    return {
      sessionStatus: async () => ({ s1: { type: "busy" } as never }),
      pendingQuestions: async () => [],
    } as unknown as OpenCodeClient;
  }

  it("computeStopAction decides refuse/noop/kill from liveness and active sessions", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-stop-action-"));
    try {
      const state = { projectDir: root } as never;
      expect(__test__.computeStopAction(state, 12345, ["s1", "s2"])).toEqual({ action: "refuse", sessionIds: ["s1", "s2"] });
      expect(__test__.computeStopAction(state, 999_999_999, [])).toEqual({ action: "noop" });
      const dummy = Bun.spawn(["sleep", "60"]);
      try {
        expect(__test__.computeStopAction(state, dummy.pid, [])).toEqual({ action: "kill", pid: dummy.pid });
      } finally {
        dummy.kill();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stopFlow refuses (and does not kill) while an implementer session is busy", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-stop-busy-"));
    try {
      const project = path.join(root, "project");
      const dummy = Bun.spawn(["sleep", "60"]);
      try {
        await writeState(project, {
          daemonPid: dummy.pid,
          implementerSessions: [{ sessionId: "s1", phaseId: "test", kind: "implementer", runIdx: 1, startedAt: new Date().toISOString(), status: "running" }],
        });
        __test__.setClient(busyClient());
        await expect(__test__.stopFlow(project)).rejects.toThrow(
          "cannot stop while implementer sessions are active: s1; pause instead, or wait for them to finish",
        );
        // The dummy daemon process must still be alive: refusal never kills.
        expect(() => process.kill(dummy.pid, 0)).not.toThrow();
      } finally {
        dummy.kill();
        __test__.setClient(new OpenCodeClient());
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("/api/stop returns 409 with the busy-session refusal and does not kill", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-stop-409-"));
    try {
      const project = path.join(root, "project");
      const dummy = Bun.spawn(["sleep", "60"]);
      try {
        await writeState(project, {
          daemonPid: dummy.pid,
          implementerSessions: [{ sessionId: "s1", phaseId: "test", kind: "implementer", runIdx: 1, startedAt: new Date().toISOString(), status: "running" }],
        });
        __test__.setClient(busyClient());
        const server = dashboardTest.createUiServer(project, 0);
        try {
          const response = await fetch(`http://127.0.0.1:${server.port}/api/stop`, { method: "POST" });
          expect(response.status).toBe(409);
          const body = (await response.json()) as { error: string };
          expect(body.error).toContain("cannot stop while implementer sessions are active: s1");
          expect(() => process.kill(dummy.pid, 0)).not.toThrow();
        } finally {
          server.stop(true);
        }
      } finally {
        dummy.kill();
        __test__.setClient(new OpenCodeClient());
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stopFlow kills a live daemon pid and leaves the workflow paused with the marker set", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-stop-kill-"));
    try {
      const project = path.join(root, "project");
      const dummy = Bun.spawn(["sleep", "60"]);
      try {
        await writeState(project, { daemonPid: dummy.pid });
        await __test__.stopFlow(project);
        const exited = await Promise.race([dummy.exited.then(() => true), Bun.sleep(8_000).then(() => false)]);
        expect(exited).toBe(true);
        const state = await loadState(path.join(project, "openspec", ".opsx-flow-state.json"));
        expect(state.workflowStatus).toBe("paused");
        expect(state.paused).toBe(true);
        expect(state.daemonPid).toBeUndefined();
        expect(state.log.some((entry) => entry.event === "workflow_stopped")).toBe(true);
        expect(await Bun.file(path.join(project, "openspec", ".opsx-flow-paused")).exists()).toBe(true);
      } finally {
        dummy.kill();
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stopFlow is idempotent when no daemon is alive and still tidies state", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-stop-noop-"));
    try {
      const project = path.join(root, "project");
      await writeState(project, { daemonPid: 999_999_999 });
      await expect(__test__.stopFlow(project)).resolves.toBeUndefined();
      const state = await loadState(path.join(project, "openspec", ".opsx-flow-state.json"));
      expect(state.workflowStatus).toBe("paused");
      expect(state.paused).toBe(true);
      expect(state.daemonPid).toBeUndefined();
      expect(state.log.some((entry) => entry.event === "workflow_stop_noop")).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("stopFlow refuses to stop an already completed workflow", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-stop-done-"));
    try {
      const project = path.join(root, "project");
      await writeState(project, { workflowStatus: "completed", completedAt: new Date().toISOString() });
      await expect(__test__.stopFlow(project)).rejects.toThrow("workflow is already completed: demo");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("the CLI stop command fails gracefully without state", () => {
    const missing = path.join(tmpdir(), `opsx-flow-stop-missing-${process.pid}`);
    const result = spawnSync("bun", [script, "stop", "--project-dir", missing], { encoding: "utf8", timeout: 30_000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no existing opsx-flow state");
  });

  it("cmdStop rejects unknown flags", async () => {
    await expect(__test__.cmdStop(["--bogus"])).rejects.toThrow("unknown option: --bogus");
  });
});

describe("opsx-flow decoupled UI lifecycle", () => {
  const script = path.join(import.meta.dir, "opsx-flow.ts");

  it("cmdStart launches the driver only and never sets uiPid/uiPort", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-start-noui-"));
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

      const configFile = path.join(root, "flow.jsonc");
      await writeFile(configFile, JSON.stringify({ projectDir: project, proposal: "demo", baseBranch: "main" }));
      __test__.setClient({ createSpawnSession: async () => { throw new Error("no server"); } } as unknown as OpenCodeClient);
      try {
        // --foreground runs the driver in-process; the session spawn fails
        // against the injected fake, so start returns the driver error code.
        const code = await __test__.cmdStart([configFile, "--foreground"]);
        expect(code).toBe(1);
        const state = await loadState(path.join(project, "openspec", ".opsx-flow-state.json"));
        expect(state.uiPid).toBeUndefined();
        expect(state.uiPort).toBeUndefined();
        expect(state.workflowStatus).toBe("error");
      } finally {
        __test__.setClient(new OpenCodeClient());
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("still parses legacy --no-ui/--ui-port flags for backward compatibility", () => {
    expect(__test__.parseStartArgs(["flow.jsonc", "--no-ui", "--foreground", "--ui-port", "4555"])).toEqual({
      configPath: path.resolve("flow.jsonc"),
      noUi: true,
      foreground: true,
      uiPort: 4555,
    });
  });

  it("rejects the dashboard subcommand now that it is a separate entry", () => {
    // The driver no longer owns the web UI; `dashboard`/`ui` fall through as
    // unknown commands.  The dashboard lives in opsx-flow-dashboard.ts.
    const result = spawnSync("bun", [script, "dashboard", "--bogus"], { encoding: "utf8", timeout: 30_000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown command: dashboard");
  });

  it("starts a real UI server as a standalone dashboard process", async () => {
    const dashboardScript = path.join(import.meta.dir, "opsx-flow-dashboard.ts");
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-dashboard-"));
    const port = await new Promise<number>((resolve, reject) => {
      const server = net.createServer();
      server.unref();
      server.on("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address() as net.AddressInfo;
        server.close(() => resolve(address.port));
      });
    });
    try {
      const proc = Bun.spawn(["bun", dashboardScript, "--project-dir", root, "--port", String(port)], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const reader = proc.stdout.getReader();
      let output = "";
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline && !output.includes("opsx-flow dashboard listening")) {
        const chunk = await Promise.race([
          reader.read().then(({ value, done }) => ({ value, done })),
          Bun.sleep(500).then(() => null),
        ]);
        if (chunk === null) continue;
        if (chunk.done) break;
        output += new TextDecoder().decode(chunk.value);
      }
      try { proc.kill(); } catch { /* already exited */ }
      expect(output).toContain("opsx-flow dashboard listening");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("the CLI help lists stop and the decoupled dashboard note", () => {
    const result = spawnSync("bun", [script, "--help"], { encoding: "utf8", timeout: 30_000 });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("start <config.jsonc> [--foreground]");
    expect(result.stdout).toContain("stop [--project-dir <path>]");
    expect(result.stdout).toContain("Dashboard: bun .opencode/scripts/opsx-flow-dashboard.ts [--port <port>]");
    expect(result.stdout).not.toContain("dashboard [--project-dir");
    expect(result.stdout).not.toContain("ui [--project-dir");
    expect(result.stdout).not.toContain("--no-ui");
  });

  it("the dashboard HTML ships the Stop button, style, and handler", () => {
    const html = dashboardTest.uiHtml("/tmp/demo", 4321);
    expect(html).toContain('<button id="stop">Stop</button>');
    expect(html).toContain("button#stop:hover { border-color: #e57171; }");
    expect(html).toContain("$('stop').onclick");
    expect(html).toContain("getJson('/api/stop', {method:'POST'})");
  });
});

describe("opsx-flow dashboard entry", () => {
  const script = path.join(import.meta.dir, "opsx-flow-dashboard.ts");

  it("is independently loadable and serves the root HTML", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "opsx-flow-dash-module-"));
    try {
      const server = dashboardTest.createUiServer(root, 0);
      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/`);
        expect(response.status).toBe(200);
        const html = await response.text();
        expect(html).toContain("opsx-flow");
        expect(html).toContain(`value="${root}"`);
      } finally {
        server.stop(true);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("prints dashboard help and exits cleanly via --help", () => {
    const result = spawnSync("bun", [script, "--help"], { encoding: "utf8", timeout: 30_000 });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("opsx-flow dashboard");
    expect(result.stdout).toContain("--port <port>");
    expect(result.stdout).toContain("--project-dir <path>");
  });

  it("rejects unknown dashboard flags", () => {
    const result = spawnSync("bun", [script, "--bogus"], { encoding: "utf8", timeout: 30_000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("unknown option: --bogus");
  });
});
