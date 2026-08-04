import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { __test__, DEFAULT_CAPS, PHASES } from "./opsx-flow.ts";

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
});
