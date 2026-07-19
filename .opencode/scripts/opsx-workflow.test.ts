import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { __test__ } from "./opsx-workflow.ts";

const {
  uncheckedCount,
  allTasksChecked,
  onlyCheckboxToggles,
  onlyCheckboxTogglesBetween,
  enforceLock,
  isPhaseClean,
  parseStartArgs,
} = __test__;

// Minimal State shape required by enforceLock / isPhaseClean. These functions
// only read projectDir / proposalDir / proposalName, so the other State fields
// are stubbed. Constructed as `any` to avoid dragging the full State type into
// the test (the runtime contract is the only thing under test here).
function makeState(projectDir: string, proposalName: string): any {
  return {
    projectDir,
    proposalName,
    proposalDir: path.join(projectDir, "openspec", "changes", proposalName),
  };
}

function git(dir: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

async function setupRepo(): Promise<{ dir: string; proposalDir: string }> {
  const dir = await mkdtemp(path.join(tmpdir(), "opsx-test-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "t@t"]);
  git(dir, ["config", "user.name", "test"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  const proposalDir = path.join(dir, "openspec", "changes", "demo");
  await mkdir(proposalDir, { recursive: true });
  await writeFile(path.join(proposalDir, "proposal.md"), "# demo\n");
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", "init"]);
  return { dir, proposalDir };
}

describe("uncheckedCount / allTasksChecked", () => {
  it("uncheckedCount returns 0 when the file does not exist; allTasksChecked returns false (missing != complete)", () => {
    expect(uncheckedCount("/nonexistent/tasks.md")).toBe(0);
    // A missing tasks.md must NOT count as "all checked" -- otherwise apply
    // converges vacuously on a malformed proposal.
    expect(allTasksChecked("/nonexistent/tasks.md")).toBe(false);
  });

  it("counts only top-level unchecked boxes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "u-"));
    const f = path.join(dir, "tasks.md");
    await writeFile(
      f,
      [
        "- [ ] task a",
        "- [x] task b",
        "- [ ] task c",
        "  - [ ] nested (should not be counted? it IS line-leading, so it is)",
        "- [x] task d",
        "",
        "text - [ ] not a box (mid-line)",
      ].join("\n"),
    );
    // 3 leading unchecked boxes (lines 1, 3, and the indented line 4 all match
    // /^\s*- \[ \]/). Line 7 is mid-line ("text - [ ]") and does NOT match.
    expect(uncheckedCount(f)).toBe(3);
    expect(allTasksChecked(f)).toBe(false);
  });

  it("allTasksChecked is true when every box is checked", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "u-"));
    const f = path.join(dir, "tasks.md");
    await writeFile(f, "- [x] a\n- [x] b\n");
    expect(allTasksChecked(f)).toBe(true);
  });

  it("allTasksChecked is false for a tasks file with no checkboxes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "u-"));
    const f = path.join(dir, "tasks.md");
    await writeFile(f, "## Tasks\nNothing actionable.\n");
    expect(allTasksChecked(f)).toBe(false);
  });

  it("counts non-standard `-   [ ]` (multiple spaces after dash) consistently with toggle detection", async () => {
    // Regression guard: onlyCheckboxTogglesBetween normalises `-   [ ]` as a
    // checkbox. uncheckedCount/checkboxCount must count it too, otherwise
    // apply/finding would converge prematurely while uncounted boxes remain.
    const dir = await mkdtemp(path.join(tmpdir(), "u-"));
    const f = path.join(dir, "tasks.md");
    await writeFile(f, ["- [ ] standard", "-   [ ] multi-space", "- [x] done"].join("\n"));
    expect(uncheckedCount(f)).toBe(2); // both the standard and multi-space unchecked box
    const { checkboxCount } = __test__;
    expect(checkboxCount(f)).toBe(3); // all three are checkboxes
    expect(allTasksChecked(f)).toBe(false);
  });
});

describe("onlyCheckboxToggles", () => {
  let dir: string;
  let proposalDir: string;

  beforeEach(async () => {
    ({ dir, proposalDir } = await setupRepo());
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("true when diff is only [ ] -> [x] toggles (same text)", async () => {
    const tasks = path.join(proposalDir, "tasks.md");
    await writeFile(tasks, "- [ ] task a\n- [ ] task b\n");
    git(dir, ["add", "-A"]); git(dir, ["commit", "-q", "-m", "c"]);
    // toggle both
    await writeFile(tasks, "- [x] task a\n- [x] task b\n");
    expect(onlyCheckboxToggles(dir, tasks)).toBe(true);
  });

  it("false when a content edit is made (text changed)", async () => {
    const tasks = path.join(proposalDir, "tasks.md");
    await writeFile(tasks, "- [ ] task a\n");
    git(dir, ["add", "-A"]); git(dir, ["commit", "-q", "-m", "c"]);
    await writeFile(tasks, "- [x] task a was rewritten\n");
    expect(onlyCheckboxToggles(dir, tasks)).toBe(false);
  });

  it("false when a brand-new checkbox line is added (no matching removal)", async () => {
    const tasks = path.join(proposalDir, "tasks.md");
    await writeFile(tasks, "- [ ] task a\n");
    git(dir, ["add", "-A"]); git(dir, ["commit", "-q", "-m", "c"]);
    await writeFile(tasks, "- [ ] task a\n- [ ] task b (new)\n");
    expect(onlyCheckboxToggles(dir, tasks)).toBe(false);
  });

  it("false when content is added under a toggle (evidence line)", async () => {
    const tasks = path.join(proposalDir, "tasks.md");
    await writeFile(tasks, "- [ ] task a\n");
    git(dir, ["add", "-A"]); git(dir, ["commit", "-q", "-m", "c"]);
    await writeFile(tasks, "- [x] task a\n  evidence: did it\n");
    // added=2 lines, removed=1 line -> lengths differ -> not a pure toggle
    expect(onlyCheckboxToggles(dir, tasks)).toBe(false);
  });

  it("rejects reordered task lines even when their normalized text is unchanged", () => {
    const before = "- [ ] task a\n- [ ] task b\n";
    const after = "- [x] task b\n- [x] task a\n";
    expect(onlyCheckboxTogglesBetween(before, after)).toBe(false);
  });
});

describe("enforceLock", () => {
  let dir: string;
  let proposalDir: string;

  beforeEach(async () => {
    ({ dir, proposalDir } = await setupRepo());
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("returns false (no violation) when only checkboxes are toggled, file kept", async () => {
    const tasks = path.join(proposalDir, "tasks.md");
    await writeFile(tasks, "- [ ] task a\n");
    git(dir, ["add", "-A"]); git(dir, ["commit", "-q", "-m", "c"]);
    await writeFile(tasks, "- [x] task a\n");
    const state = makeState(dir, "demo");
    expect(enforceLock(state, "apply")).toBe(false);
    // file retained with the toggle
    const after = await Bun.file(tasks).text();
    expect(after).toContain("- [x] task a");
  });

  it("returns true and reverts tasks.md when apply edits content", async () => {
    const tasks = path.join(proposalDir, "tasks.md");
    await writeFile(tasks, "- [ ] task a\n");
    git(dir, ["add", "-A"]); git(dir, ["commit", "-q", "-m", "c"]);
    // cheat: rewrite content + check
    await writeFile(tasks, "- [x] task a (DEFERRED)\n");
    const state = makeState(dir, "demo");
    expect(enforceLock(state, "apply")).toBe(true);
    // file reverted to HEAD
    const after = await Bun.file(tasks).text();
    expect(after).toBe("- [ ] task a\n");
  });

  it("returns false when the locked file was not touched", async () => {
    const tasks = path.join(proposalDir, "tasks.md");
    await writeFile(tasks, "- [ ] task a\n");
    git(dir, ["add", "-A"]); git(dir, ["commit", "-q", "-m", "c"]);
    // edit an unrelated file
    await writeFile(path.join(proposalDir, "notes.md"), "hi\n");
    const state = makeState(dir, "demo");
    expect(enforceLock(state, "apply")).toBe(false);
    expect(existsSync(path.join(proposalDir, "notes.md"))).toBe(true);
  });

  it("returns false for a phase with no lock rule (e.g. test/code-review)", async () => {
    const issue = path.join(proposalDir, "issue.md");
    await writeFile(issue, "- [ ] ISSUE-1: x\n");
    git(dir, ["add", "-A"]); git(dir, ["commit", "-q", "-m", "c"]);
    await writeFile(issue, "- [ ] ISSUE-1: x rewritten by finder\n");
    const state = makeState(dir, "demo");
    expect(enforceLock(state, "test")).toBe(false);
    expect(enforceLock(state, "code-review")).toBe(false);
  });

  it("snapshot-based: preserves planner content edits in the baseline, accepts toggle on top", async () => {
    // Planner paused on a cap and edited tasks.md content (marked task b DEFERRED
    // + checked it). That edit is captured in the session-start snapshot. The
    // implementer then toggles task a only -- legitimate toggle on top of the
    // planner baseline must NOT be flagged or reverted.
    const tasks = path.join(proposalDir, "tasks.md");
    await writeFile(tasks, "- [ ] task a\n- [ ] task b\n");
    git(dir, ["add", "-A"]); git(dir, ["commit", "-q", "-m", "c"]);
    const plannerBaseline = "- [ ] task a\n- [x] task b (DEFERRED by planner)\n";
    await writeFile(tasks, plannerBaseline);
    const state = makeState(dir, "demo");
    const before = { existed: true, content: plannerBaseline };
    // implementer toggles task a only
    await writeFile(tasks, "- [x] task a\n- [x] task b (DEFERRED by planner)\n");
    expect(enforceLock(state, "apply", before)).toBe(false);
    const after = await Bun.file(tasks).text();
    expect(after).toBe("- [x] task a\n- [x] task b (DEFERRED by planner)\n");
  });

  it("snapshot-based: reverts implementer content edit on top of the snapshot baseline", async () => {
    const tasks = path.join(proposalDir, "tasks.md");
    await writeFile(tasks, "- [ ] task a\n");
    git(dir, ["add", "-A"]); git(dir, ["commit", "-q", "-m", "c"]);
    const state = makeState(dir, "demo");
    const before = { existed: true, content: "- [ ] task a\n" };
    // implementer rewrites the task text (content edit, not a toggle)
    await writeFile(tasks, "- [x] task a (IMPLEMENTED differently)\n");
    expect(enforceLock(state, "apply", before)).toBe(true);
    // restored to the session-start snapshot (planner baseline), not HEAD
    const after = await Bun.file(tasks).text();
    expect(after).toBe("- [ ] task a\n");
  });

  it("snapshot-based: restores a locked file deleted by the implementer", async () => {
    const tasks = path.join(proposalDir, "tasks.md");
    const baseline = "- [ ] task a\n";
    await writeFile(tasks, baseline);
    git(dir, ["add", "-A"]); git(dir, ["commit", "-q", "-m", "c"]);
    await rm(tasks);
    const state = makeState(dir, "demo");
    expect(enforceLock(state, "apply", { existed: true, content: baseline })).toBe(true);
    expect(await Bun.file(tasks).text()).toBe(baseline);
  });

  it("snapshot-based: removes a staged invalid content edit as well as restoring the file", async () => {
    const tasks = path.join(proposalDir, "tasks.md");
    const baseline = "- [ ] task a\n";
    await writeFile(tasks, baseline);
    git(dir, ["add", "-A"]); git(dir, ["commit", "-q", "-m", "c"]);
    await writeFile(tasks, "- [x] task a (SKIPPED)\n");
    git(dir, ["add", "-A"]);
    const state = makeState(dir, "demo");
    expect(enforceLock(state, "apply", { existed: true, content: baseline })).toBe(true);
    expect(await Bun.file(tasks).text()).toBe(baseline);
    const cached = spawnSync("git", ["diff", "--cached", "--quiet", "--", "openspec/changes/demo/tasks.md"], { cwd: dir });
    expect(cached.status).toBe(0);
  });
});

describe("isPhaseClean", () => {
  let dir: string;
  let proposalDir: string;

  beforeEach(async () => {
    ({ dir, proposalDir } = await setupRepo());
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("self-heal (review-proposal): clean when no proposal artifacts changed", async () => {
    const state = makeState(dir, "demo");
    const phase: any = { family: "self-heal", id: "review-proposal" };
    expect(isPhaseClean(state, phase)).toBe(true);
    // edit a proposal artifact -> dirty
    await writeFile(path.join(proposalDir, "design.md"), "# design\n");
    expect(isPhaseClean(state, phase)).toBe(false);
  });

  it("self-heal (review-proposal): REGRESSION - editing an existing tracked proposal file is detected", async () => {
    // Catches the workingTreePorcelain-trim bug: a modified *tracked* file has
    // porcelain status ` M path`; if the line were trimmed, the leading space
    // would be stripped and slice(3) would corrupt the path, making the edit
    // invisible and the self-heal loop advance without re-verification.
    const proposalMd = path.join(proposalDir, "proposal.md");
    await writeFile(proposalMd, "# demo\n\nedited by review-proposal run-1\n");
    const state = makeState(dir, "demo");
    const phase: any = { family: "self-heal", id: "review-proposal" };
    expect(isPhaseClean(state, phase)).toBe(false);
  });

  it("self-heal (apply-resume): clean iff the entire working tree is clean", async () => {
    const state = makeState(dir, "demo");
    const phase: any = { family: "self-heal", id: "apply-resume" };
    expect(isPhaseClean(state, phase)).toBe(true);
    // edit a code file outside the proposal dir
    await mkdir(path.join(dir, "backend"), { recursive: true });
    await writeFile(path.join(dir, "backend", "x.py"), "x = 1\n");
    expect(isPhaseClean(state, phase)).toBe(false);
  });

  it("self-heal (apply-resume): ignores pre-existing untracked files captured in baselineUntracked", async () => {
    // A pre-existing stray file (recorded in the baseline at workflow start)
    // must NOT block apply-resume convergence. Only NEW untracked files count.
    await mkdir(path.join(dir, "backend"), { recursive: true });
    await writeFile(path.join(dir, "backend", "stray.txt"), "pre-existing\n");
    const state = makeState(dir, "demo");
    state.baselineUntracked = ["backend/stray.txt"];
    const phase: any = { family: "self-heal", id: "apply-resume" };
    expect(isPhaseClean(state, phase)).toBe(true); // stray file is in baseline -> ignored
    // a NEW untracked file (not in baseline) still counts as dirty
    await writeFile(path.join(dir, "backend", "new.txt"), "new\n");
    expect(isPhaseClean(state, phase)).toBe(false);
  });

  it("self-heal (apply-resume): with no baseline captured, any untracked file is dirty (strict)", async () => {
    // baselineUntracked undefined (old state file / test) -> strict: every
    // current untracked file is treated as new. Preserves the original
    // whole-tree behaviour for callers that never went through cmdStart.
    await mkdir(path.join(dir, "backend"), { recursive: true });
    await writeFile(path.join(dir, "backend", "stray.txt"), "stray\n");
    const state = makeState(dir, "demo");
    const phase: any = { family: "self-heal", id: "apply-resume" };
    expect(isPhaseClean(state, phase)).toBe(false);
  });

  it("apply: clean iff all tasks.md boxes checked", async () => {
    const tasks = path.join(proposalDir, "tasks.md");
    await writeFile(tasks, "- [ ] a\n- [ ] b\n");
    git(dir, ["add", "-A"]); git(dir, ["commit", "-q", "-m", "c"]);
    const state = makeState(dir, "demo");
    const phase: any = { family: "apply", id: "apply" };
    expect(isPhaseClean(state, phase)).toBe(false);
    await writeFile(tasks, "- [x] a\n- [x] b\n");
    expect(isPhaseClean(state, phase)).toBe(true);
  });

  it("finding: clean iff issue.md has zero unchecked boxes", async () => {
    const issue = path.join(proposalDir, "issue.md");
    const state = makeState(dir, "demo");
    const phase: any = { family: "finding", id: "test" };
    // no issue.md -> clean
    expect(isPhaseClean(state, phase)).toBe(true);
    await writeFile(issue, "- [ ] ISSUE-1: x\n- [x] ISSUE-2: y\n");
    expect(isPhaseClean(state, phase)).toBe(false);
    await writeFile(issue, "- [x] ISSUE-1: x\n- [x] ISSUE-2: y\n");
    expect(isPhaseClean(state, phase)).toBe(true);
  });

  it("archive: clean iff this proposal was archived and its active dir is gone", async () => {
    const state = makeState(dir, "demo");
    const phase: any = { family: "archive", id: "archive" };
    // archive dir does not exist yet -> not clean (proposal still in place)
    expect(isPhaseClean(state, phase)).toBe(false);
    const archiveRoot = path.join(dir, "openspec", "changes", "archive");
    await mkdir(path.join(archiveRoot, "2026-01-01-other"), { recursive: true });
    await rm(proposalDir, { recursive: true, force: true });
    await writeFile(path.join(archiveRoot, "2026-01-01-other", "proposal.md"), "# other\n");
    expect(isPhaseClean(state, phase)).toBe(false);
    await mkdir(path.join(archiveRoot, "2026-01-01-demo"), { recursive: true });
    await writeFile(path.join(archiveRoot, "2026-01-01-demo", "proposal.md"), "# demo\n");
    expect(isPhaseClean(state, phase)).toBe(true);
  });
});

describe("parseStartArgs", () => {
  it("parses --foreground as a boolean without consuming another argument", () => {
    const parsed = parseStartArgs(["room", "demo", "--foreground", "--base-branch", "master"]);
    expect(parsed.foreground).toBe(true);
    expect(parsed.baseBranch).toBe("master");
  });

  it("rejects invalid cap values and missing option values", () => {
    expect(() => parseStartArgs(["room", "demo", "--cap-apply", "0"])).toThrow("positive integer");
    expect(() => parseStartArgs(["room", "demo", "--project-dir"])).toThrow("requires a value");
  });
});
