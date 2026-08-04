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
        "phases": { "code-review": { "provider": "openai", "model": "gpt-test", "variant": "medium", "cap": "4" } }
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
