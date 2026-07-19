#!/usr/bin/env bun
// opsx-workflow: deterministic driver for the OpenSpec 8-phase workflow.
//
// One proposal per branch. For each phase the driver spawns a fresh implementer
// session into an agent-collab room, waits for the implementer's completion
// message, waits for the planner to finish reacting (polled via the OpenCode
// session-status API), runs a deterministic completion check, spawns a committer
// session to commit, then advances or loops per the phase graph.
//
// The planner (an OpenCode session) supervises: it receives implementer reports
// as ordinary user messages, intervenes with `pause` + agent-collab messaging,
// answers questions, and escalates to the Master. The planner never spawns or
// routes phases itself -- this script owns the plumbing.

import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { existsSync, readFileSync, writeFileSync, unlinkSync, readdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Poll twice within the Master's ~30s cadence so planner-idle can be re-confirmed
// before advancing rather than trusting a single instantaneous status sample.
const POLL_INTERVAL_MS = 15_000;
const PLANNER_PROCEED_IDLE_RECONFIRM_MS = 10_000; // re-confirm idle before proceeding
const IMPLEMENTER_NEVER_BUSY_STALL_MS = 8 * 60_000;
const IMPLEMENTER_IDLE_STALL_MS = 2 * 60_000;
const COMMITTER_RETRY_LIMIT = 3;

// Caps are a mutable record (CLI overrides reassign them), so they are typed as
// `{ number }` rather than `as const` -- literal types from `as const` make
// `caps.selfHeal = Number(...)` fail typecheck ("Type 'number' is not assignable to type '3'").
type Caps = { selfHeal: number; apply: number; testFix: number; codeReviewFix: number };
const DEFAULT_CAPS: Caps = {
  selfHeal: 3, // review-proposal / apply-resume / align self-loops
  apply: 5, // apply self-loop
  testFix: 10, // test <-> fix loops (functional + regression)
  codeReviewFix: 5, // code-review <-> fix loop
};
type CapKey = keyof Caps;

const PLANNER_ALIAS = "planner";

type Family = "self-heal" | "apply" | "finding" | "archive";

type PhaseDef = {
  id: string;
  skill: string;
  aliasBase: string;
  family: Family;
  capKey: CapKey;
  provider: string;
  model: string;
  variant: string;
};

// The canonical phase graph. test-regression is a second run of openspec-test
// after the code-review loop converges, to catch regressions from quality fixes.
const PHASES: PhaseDef[] = [
  { id: "review-proposal", skill: "openspec-review-proposal", aliasBase: "reviewer-proposal", family: "self-heal", capKey: "selfHeal", provider: "deepseek", model: "deepseek-v4-pro", variant: "max" },
  { id: "apply", skill: "openspec-apply-change", aliasBase: "implementer", family: "apply", capKey: "apply", provider: "deepseek", model: "deepseek-v4-pro", variant: "max" },
  { id: "apply-resume", skill: "openspec-apply-resume", aliasBase: "reviewer-impl", family: "self-heal", capKey: "selfHeal", provider: "deepseek", model: "deepseek-v4-pro", variant: "max" },
  { id: "test", skill: "openspec-test", aliasBase: "tester", family: "finding", capKey: "testFix", provider: "deepseek", model: "deepseek-v4-pro", variant: "max" },
  { id: "code-review", skill: "openspec-code-review", aliasBase: "reviewer-code", family: "finding", capKey: "codeReviewFix", provider: "openai", model: "gpt-5.5", variant: "medium" },
  { id: "test-regression", skill: "openspec-test", aliasBase: "tester-regress", family: "finding", capKey: "testFix", provider: "deepseek", model: "deepseek-v4-pro", variant: "max" },
  { id: "align", skill: "openspec-align", aliasBase: "aligner", family: "self-heal", capKey: "selfHeal", provider: "deepseek", model: "deepseek-v4-flash", variant: "max" },
  { id: "archive", skill: "openspec-archive-change", aliasBase: "archiver", family: "archive", capKey: "selfHeal", provider: "deepseek", model: "deepseek-v4-pro", variant: "max" },
];

// Phases whose implementers may only toggle checkboxes on the locked file.
// Any non-checkbox content change to the locked file is reverted and the run
// is retried (no commit). The finder/owner phases edit content freely.
const LOCKED_FILE_RULES: Partial<Record<string, { file: string; kind: "tasks" | "issues" }>> = {
  apply: { file: "tasks.md", kind: "tasks" },
  "apply-resume": { file: "tasks.md", kind: "tasks" },
  fix: { file: "issue.md", kind: "issues" },
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type LogEntry = { ts: string; event: string; detail?: string };

type State = {
  proposalName: string;
  proposalDir: string; // absolute path to openspec/changes/<name>
  projectDir: string; // git toplevel
  roomId: string;
  plannerSessionId: string;
  branch: string;
  baseBranch: string;
  paused: boolean;
  caps: Caps;
  loopCounters: Record<string, number>; // per phase-id
  currentPhaseIdx: number; // index into PHASES; enables resume after daemon exit
  workflowStatus?: "running" | "paused" | "error" | "completed";
  startedAt: string;
  lastUpdated: string;
  completedAt?: string;
  daemonPid?: number;
  botSessionId?: string;
  // Untracked files present at workflow start. apply-resume's clean check treats
  // these as pre-existing (ignored) so stray editor/build/dev files in the target
  // project don't block convergence. undefined = strict (treat all untracked as new).
  baselineUntracked?: string[];
  log: LogEntry[];
};

function statePath(projectDir: string): string {
  return path.join(projectDir, "openspec", ".opsx-workflow-state.json");
}

function pauseMarkerPath(projectDir: string): string {
  return path.join(projectDir, "openspec", ".opsx-workflow-paused");
}

function daemonPidPath(projectDir: string): string {
  return path.join(projectDir, "openspec", ".opsx-workflow.pid");
}

function pauseMarkerExists(projectDir: string): boolean {
  return existsSync(pauseMarkerPath(projectDir));
}

function writePauseMarker(projectDir: string, paused: boolean): void {
  const marker = pauseMarkerPath(projectDir);
  if (paused) {
    writeFileSync(marker, `${nowIso()}\n`, "utf8");
    return;
  }
  try {
    unlinkSync(marker);
  } catch (err) {
    if ((err as { code?: string }).code !== "ENOENT") throw err;
  }
}

function readDaemonPid(projectDir: string): number | undefined {
  try {
    const pid = Number(readFileSync(daemonPidPath(projectDir), "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function writeDaemonPid(projectDir: string, pid: number): void {
  writeFileSync(daemonPidPath(projectDir), `${pid}\n`, "utf8");
}

function removeDaemonPid(projectDir: string, expectedPid?: number): void {
  const current = readDaemonPid(projectDir);
  if (expectedPid && current && current !== expectedPid) return;
  try {
    unlinkSync(daemonPidPath(projectDir));
  } catch (err) {
    if ((err as { code?: string }).code !== "ENOENT") throw err;
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

async function loadState(file: string): Promise<State> {
  const raw = await readFile(file, "utf8");
  return JSON.parse(raw) as State;
}

async function saveState(state: State, opts?: { forcePaused?: boolean }): Promise<void> {
  // Pause/continue can race daemon state writes. A separate marker file is the
  // authoritative control signal: create/unlink is atomic, while this JSON file
  // remains an observational snapshot. Routine saves read the marker; intentional
  // pause transitions update it before writing JSON.
  if (opts?.forcePaused) writePauseMarker(state.projectDir, state.paused);
  else state.paused = pauseMarkerExists(state.projectDir);
  if (state.workflowStatus !== "error" && state.workflowStatus !== "completed") {
    state.workflowStatus = state.paused ? "paused" : state.workflowStatus === "paused" ? "running" : state.workflowStatus;
  }
  state.lastUpdated = nowIso();
  const file = statePath(state.projectDir);
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(state, null, 2) + "\n", "utf8");
  await rename(temp, file);
}

function logEvent(state: State, event: string, detail?: string): void {
  const entry = { ts: nowIso(), event, detail };
  state.log.push(entry);
  if (state.log.length > 500) state.log.splice(0, state.log.length - 500);
  state.lastUpdated = entry.ts;
  // Append a human-readable line to the daemon log on every event so that
  // `opsx-workflow log` and any self-healing session can tail a single
  // always-current file to understand what the driver is doing, without
  // depending on the state file being flushed (which only happens at saveState
  // points). The state file's structured `log` array is the secondary view.
  try {
    const line = detail ? `${entry.ts}  ${event}: ${detail}\n` : `${entry.ts}  ${event}\n`;
    appendFileSync(path.join(state.projectDir, "openspec", ".opsx-workflow.log"), line, "utf8");
  } catch {
    // best-effort: the in-memory log + periodic saveState still capture the event
  }
}

// ---------------------------------------------------------------------------
// Environment / config.env resolution (mirrors session-info.ts)
// ---------------------------------------------------------------------------

function loadConfigEnv(): void {
  const root = path.resolve(import.meta.dir, "../..");
  const cfg = path.join(root, ".opencode", "config.env");
  if (!existsSync(cfg)) return;
  for (const rawLine of readFileSyncLines(cfg)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    const [, key, rawVal] = m;
    if (process.env[key] !== undefined) continue;
    process.env[key] = unquote(rawVal);
  }
}

function readFileSyncLines(file: string): string[] {
  return readFileSync(file, "utf8").split(/\r?\n/);
}

function unquote(v: string): string {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

function opencodeServerUrl(): string {
  if (process.env.OPENCODE_SERVER_URL) return process.env.OPENCODE_SERVER_URL.replace(/\/$/, "");
  const host = process.env.OPENCODE_ASSISTANT_HOST || "127.0.0.1";
  const port = process.env.OPENCODE_ASSISTANT_PORT || "4096";
  return `http://${host}:${port}`;
}

function plannerSessionId(): string {
  const id = process.env.OPENCODE_SESSION_ID?.trim();
  if (!id || !id.startsWith("ses_")) throw new Error("OPENCODE_SESSION_ID is not set or invalid; pass --planner-session.");
  return id;
}

function agentCollabScript(): string {
  return path.join(import.meta.dir, "agent-collab.ts");
}

function agentCollabUrl(): string {
  return (process.env.AGENT_COLLAB_URL?.trim() || "http://127.0.0.1:9100").replace(/\/+$/, "");
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

function git(projectDir: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd: projectDir, encoding: "utf8" });
  return { ok: r.status === 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function requireGit(projectDir: string, args: string[]): string {
  const r = git(projectDir, args);
  if (!r.ok) throw new Error(`git ${args.join(" ")} failed: ${r.stderr.trim() || r.stdout.trim()}`);
  return r.stdout;
}

function gitTopLevel(dir: string): string {
  const r = git(dir, ["rev-parse", "--show-toplevel"]);
  if (!r.ok) throw new Error(`not a git repo: ${dir}`);
  return r.stdout.trim();
}

function currentBranch(projectDir: string): string {
  return requireGit(projectDir, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
}

function workingTreePorcelain(projectDir: string): string[] {
  const stdout = requireGit(projectDir, ["status", "--porcelain"]);
  // IMPORTANT: do NOT trim the lines here. Porcelain v1 format is `XY <path>`
  // (2 status chars + 1 space + path), and downstream consumers strip the first
  // 3 chars via slice/replace. Trimming here would remove the leading space of
  // entries like ` M path` (modified tracked file), shifting the slice and
  // corrupting the parsed path -- which silently breaks the self-heal loop for
  // edits to existing tracked files (review-proposal editing proposal.md would
  // look "clean" and advance without a fresh re-run). Empty lines are filtered;
  // trailing whitespace on the path is trimmed by each consumer.
  return stdout.split("\n").filter((l) => l.length > 0);
}

function porcelainPath(line: string): string {
  const raw = line.replace(/^.{3}/, "").trim();
  const renameMarker = " -> ";
  return raw.includes(renameMarker) ? raw.slice(raw.lastIndexOf(renameMarker) + renameMarker.length) : raw;
}

// files changed in the working tree relative to HEAD (this session's changes)
function changedFiles(projectDir: string): string[] {
  return workingTreePorcelain(projectDir).map(porcelainPath);
}

// Tracked file changes (modified/added/deleted) relative to HEAD. Unlike
// workingTreePorcelain this EXCLUDES untracked files, so it is not polluted by
// pre-existing stray files in the target project. Used by apply-resume's clean
// check so that editor temps / build output / dev notes don't block convergence.
function trackedChangedFiles(projectDir: string): string[] {
  return requireGit(projectDir, ["diff", "HEAD", "--name-only"]).split("\n").filter((l) => l.length > 0);
}

// Current untracked, non-ignored files (one relative path per line).
function currentUntrackedFiles(projectDir: string): string[] {
  return requireGit(projectDir, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter((l) => l.length > 0);
}

// Untracked files that appeared AFTER the workflow started (i.e. not in the
// baseline snapshot captured at cmdStart). undefined baseline = strict mode
// (treat every current untracked file as new) for old state files / tests.
function newUntrackedFiles(state: State): string[] {
  const current = currentUntrackedFiles(state.projectDir);
  if (state.baselineUntracked === undefined) return current;
  const baseline = new Set(state.baselineUntracked);
  return current.filter((f) => !baseline.has(f));
}

function revertFile(projectDir: string, file: string): void {
  const rel = path.relative(projectDir, file);
  // Restore both staged and unstaged changes to HEAD.
  requireGit(projectDir, ["checkout", "HEAD", "--", rel]);
}

function isProcessAlive(pid?: number): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Ensure the daemon's state/log files are gitignored in the target project so they
// don't pollute workingTreePorcelain (which would make self-heal phases never clean).
// Idempotent: appends the patterns only if they aren't already present.
async function ensureGitignore(projectDir: string): Promise<void> {
  const gi = path.join(projectDir, ".gitignore");
  const want = [
    "openspec/.opsx-workflow-state.json",
    "openspec/.opsx-workflow-state.json.*.tmp",
    "openspec/.opsx-workflow.log",
    "openspec/.opsx-workflow-paused",
    "openspec/.opsx-workflow.pid",
  ];
  let lines: string[] = [];
  if (existsSync(gi)) lines = readFileSyncLines(gi);
  let appended = false;
  for (const p of want) {
    if (!lines.some((l) => l.trim() === p)) {
      if (!appended) {
        lines.push("");
        lines.push("# opsx-workflow daemon state/log/control (do not commit)");
        appended = true;
      }
      lines.push(p);
    }
  }
  if (appended) await writeFile(gi, lines.join("\n").replace(/\n+$/, "\n"), "utf8");
}

// Deterministically commit the .gitignore guard added by ensureGitignore, so the
// working tree is clean before the first implementer runs. Without this,
// apply-resume's whole-tree clean check (`workingTreePorcelain().length === 0`)
// would be polluted by an uncommitted .gitignore and never converge. Must be
// called AFTER the feature branch is checked out so the commit lands on the
// feature branch (and merges at the end), not on the base branch.
function commitGitignoreGuard(projectDir: string): void {
  const dirty = requireGit(projectDir, ["status", "--porcelain", "--", ".gitignore"]).trim();
  if (!dirty) return;
  requireGit(projectDir, ["add", ".gitignore"]);
  requireGit(projectDir, ["commit", "-m", "chore: gitignore opsx-workflow daemon state/log"]);
}

// Detect the project's default branch so the final merge targets the right place
// without forcing the user to pass --base-branch on main-based repos.
function detectBaseBranch(projectDir: string): string {
  const head = git(projectDir, ["symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"]).stdout.trim();
  if (head.startsWith("origin/")) return head.slice("origin/".length);
  for (const cand of ["main", "master"]) {
    if (git(projectDir, ["rev-parse", "-q", "--verify", `refs/heads/${cand}`]).ok) return cand;
    if (git(projectDir, ["rev-parse", "-q", "--verify", `refs/remotes/origin/${cand}`]).ok) return cand;
  }
  return currentBranch(projectDir);
}

// ---------------------------------------------------------------------------
// Checkbox helpers
// ---------------------------------------------------------------------------

function uncheckedCount(file: string): number {
  if (!existsSync(file)) return 0;
  const txt: string = readFileSync(file, "utf8");
  // Count task/issue checkbox lines. Indented task items are intentional.
  // `-\s*` (flexible whitespace after the dash) mirrors onlyCheckboxTogglesBetween's
  // normalisation: a non-standard `-   [ ]` box must be BOTH counted here AND
  // recognised as a toggle there. With a strict `- ` here, such a box would be
  // accepted as a toggle but not counted -> allTasksChecked / finding-clean would
  // return true while uncounted boxes remain, causing premature convergence.
  const matches = txt.match(/^\s*-\s*\[ \]/gm);
  return matches ? matches.length : 0;
}

function checkboxCount(file: string): number {
  if (!existsSync(file)) return 0;
  const txt = readFileSync(file, "utf8");
  const matches = txt.match(/^\s*-\s*\[[ xX]\]/gm);
  return matches ? matches.length : 0;
}

function allTasksChecked(tasksFile: string): boolean {
  // A missing tasks.md is NOT "all checked" -- it means apply has nothing to
  // converge on and would otherwise skip instantly on a malformed proposal.
  // cmdStart validates tasks.md exists up front; this is defensive.
  if (!existsSync(tasksFile)) return false;
  return checkboxCount(tasksFile) > 0 && uncheckedCount(tasksFile) === 0;
}

// Returns true when the current file differs from HEAD only by checkbox toggles
// with identical line order and text. Any other change is a content edit.
function onlyCheckboxToggles(projectDir: string, file: string): boolean {
  if (!existsSync(file)) return false;
  const rel = path.relative(projectDir, file);
  const before = requireGit(projectDir, ["show", `HEAD:${rel}`]);
  return onlyCheckboxTogglesBetween(before, readFileSync(file, "utf8"));
}

// Session-start snapshot of a locked file, used so enforceLock compares the
// post-run state against the exact pre-run baseline rather than HEAD. Planner
// decision edits made before the fresh run starts are therefore preserved.
type FileSnapshot = { existed: boolean; content: string } | null;

function snapshotLockedFile(state: State, phaseId: string): FileSnapshot {
  const rule = LOCKED_FILE_RULES[phaseId];
  if (!rule) return null;
  const fileAbs = path.join(state.proposalDir, rule.file);
  if (!existsSync(fileAbs)) return { existed: false, content: "" };
  return { existed: true, content: readFileSync(fileAbs, "utf8") };
}

// Snapshot-based toggle check: true iff the only difference between before and
// after is `- [ ]` <-> `- [x]` toggles with identical line order/text otherwise.
function onlyCheckboxTogglesBetween(before: string, after: string): boolean {
  const norm = (line: string) => line.replace(/^(\s*-\s*)\[[ xX]\](?=\s|$)/, "$1[~]");
  const a = after.replace(/\r\n/g, "\n").split("\n");
  const b = before.replace(/\r\n/g, "\n").split("\n");
  if (a.length !== b.length) return false;
  return a.every((line, i) => norm(line) === norm(b[i]!));
}

// ---------------------------------------------------------------------------
// agent-collab helpers (shell out to the sibling CLI for exact parity)
// ---------------------------------------------------------------------------

type JsonValue = unknown;

function agentCollab(args: string[]): JsonValue {
  const r = spawnSync("bun", [agentCollabScript(), ...args, "--json"], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const out = (r.stdout ?? "").trim();
  if (r.status !== 0 || !out) {
    throw new Error(`agent-collab failed: ${args.join(" ")}\nstdout=${r.stdout}\nstderr=${r.stderr}`);
  }
  try {
    return JSON.parse(out);
  } catch {
    return out;
  }
}

function acSpawnImpl(state: State, phase: PhaseDef, alias: string, runIdx: number): { sessionId: string } {
  const prompt = implementerPrompt(state, phase, alias, runIdx);
  const res = agentCollab([
    "spawn",
    "--room", state.roomId,
    "--session", state.plannerSessionId,
    "--from", PLANNER_ALIAS,
    "--name", alias,
    "--role", "implementer",
    "--agent", "levi",
    "--provider", phase.provider,
    "--model", phase.model,
    "--variant", phase.variant,
    "--dir", state.projectDir,
    "--initial-prompt", prompt,
  ]) as { members?: Array<{ name: string; session_id: string }> };
  const member = res?.members?.find((m) => m.name === alias);
  if (!member) throw new Error(`spawn did not return member ${alias}`);
  return { sessionId: member.session_id };
}

function acSpawnFix(state: State, findingPhase: PhaseDef, alias: string, runIdx: number): { sessionId: string } {
  const prompt = fixPrompt(state, findingPhase, alias, runIdx);
  const res = agentCollab([
    "spawn",
    "--room", state.roomId,
    "--session", state.plannerSessionId,
    "--from", PLANNER_ALIAS,
    "--name", alias,
    "--role", "implementer",
    "--agent", "levi",
    "--provider", "deepseek",
    "--model", "deepseek-v4-pro",
    "--variant", "max",
    "--dir", state.projectDir,
    "--initial-prompt", prompt,
  ]) as { members?: Array<{ name: string; session_id: string }> };
  const member = res?.members?.find((m) => m.name === alias);
  if (!member) throw new Error(`spawn did not return member ${alias}`);
  return { sessionId: member.session_id };
}

function acSpawnCommitter(state: State, alias: string, phaseLabel: string): { sessionId: string } {
  const prompt = committerPrompt(state, alias, phaseLabel);
  const res = agentCollab([
    "spawn",
    "--room", state.roomId,
    "--session", state.plannerSessionId,
    "--from", PLANNER_ALIAS,
    "--name", alias,
    "--role", "committer",
    "--agent", "levi",
    "--provider", "deepseek",
    "--model", "deepseek-v4-flash",
    "--variant", "max",
    "--dir", state.projectDir,
    "--initial-prompt", prompt,
  ]) as { members?: Array<{ name: string; session_id: string }> };
  const member = res?.members?.find((m) => m.name === alias);
  if (!member) throw new Error(`spawn did not return member ${alias}`);
  return { sessionId: member.session_id };
}

// Persistent notifier bot. Spawned once at driver start, removed at driver end.
// The driver delivers notifications through this session via deterministic
// `agent-collab send` shell calls (no per-notification LLM), which is reliable
// for control-plane events (caps, stalls, errors, completion). The previous
// design spawned a fresh one-shot LLM session per notification and asked it to
// run shell commands -- too unreliable for control-plane signalling.
const NOTIFIER_ALIAS = "opsx-bot";

function ensureNotifierBot(state: State): void {
  if (state.botSessionId) return;
  const prompt =
    `You are the opsx-workflow notifier bot for room "${state.roomId}".\n` +
    `Reply once with "ready", then stay idle. Do NOT edit files. Do NOT send further messages on your own. ` +
    `The workflow driver delivers notifications to the planner through your session identity.`;
  const res = agentCollab([
    "spawn",
    "--room", state.roomId,
    "--session", state.plannerSessionId,
    "--from", PLANNER_ALIAS,
    "--name", NOTIFIER_ALIAS,
    "--role", "bot",
    "--agent", "levi",
    "--provider", "deepseek",
    "--model", "deepseek-v4-flash",
    "--variant", "max",
    "--dir", state.projectDir,
    "--initial-prompt", prompt,
  ]) as { members?: Array<{ name: string; session_id: string }> };
  const member = res?.members?.find((m) => m.name === NOTIFIER_ALIAS);
  if (!member) throw new Error("could not spawn opsx-bot notifier session");
  state.botSessionId = member.session_id;
}

function removeNotifierBot(state: State): void {
  if (!state.botSessionId) return;
  try {
    agentCollab([
      "member", "remove",
      "--room", state.roomId,
      "--session", state.plannerSessionId,
      "--from", PLANNER_ALIAS,
      "--target", NOTIFIER_ALIAS,
    ]);
  } catch (err) {
    console.error("[opsx-workflow] notifier bot remove failed:", (err as Error).message);
  }
  state.botSessionId = undefined;
}

function acBotNotify(state: State, message: string): void {
  // Deterministic shell send through the persistent bot. @planner triggers
  // immediate delivery to the planner session. Best-effort: the pause flag is the
  // real halt mechanism; this only tells the planner WHY it paused.
  if (!state.botSessionId) {
    console.warn(`[opsx-workflow] no notifier bot; message not delivered: ${message}`);
    return;
  }
  const r = spawnSync("bun", [
    agentCollabScript(), "send",
    "--room", state.roomId,
    "--session", state.botSessionId,
    "--from", NOTIFIER_ALIAS,
    "--body", `@planner ${message}`,
    "--kind", "task_assignment",
  ], { encoding: "utf8" });
  if (r.status !== 0) {
    console.error(`[opsx-workflow] bot notify send failed: ${(r.stderr ?? "").trim()}`);
  }
}

function acMemberRemove(state: State, alias: string): void {
  try {
    agentCollab([
      "member", "remove",
      "--room", state.roomId,
      "--session", state.plannerSessionId,
      "--from", PLANNER_ALIAS,
      "--target", alias,
    ]);
  } catch (err) {
    console.error(`[opsx-workflow] member remove ${alias} failed:`, (err as Error).message);
  }
}

function acRoomClose(state: State): void {
  try {
    agentCollab([
      "room", "close",
      "--room", state.roomId,
      "--session", state.plannerSessionId,
      "--from", PLANNER_ALIAS,
    ]);
  } catch (err) {
    console.error("[opsx-workflow] room close failed:", (err as Error).message);
  }
}

type RoomDelivery = {
  target_session_id?: string;
  target_name?: string;
  state?: string;
  injected_at?: number | null;
};

type RoomMessage = {
  id?: string;
  sender_name?: string;
  kind?: string;
  body?: string;
  created_at?: number;
  deliveries?: RoomDelivery[];
};

function acRoomMessages(state: State, sinceMs?: number): RoomMessage[] {
  // The room service's message listing uses ascending cursor pagination with a
  // default page size of 50 (DEFAULT_PAGE_SIZE in collab.ts). Without an
  // explicit filter, only the OLDEST 50 messages are returned -- recent
  // completions land on "page 2" and become invisible, causing stalls.
  //
  // The driver only ever cares about messages after a specific implementer was
  // spawned, so filter by --since <spawnedAtMs> at the API level. This both
  // avoids the pagination blind-spot at any scale and keeps the response small.
  // Callers that need the full history (e.g. reportDeliveredToPlanner) omit
  // sinceMs and fall back to a large limit instead.
  const args = ["messages", "--room", state.roomId];
  if (sinceMs !== undefined) {
    args.push("--since", String(sinceMs));
  } else {
    args.push("--limit", "1000");
  }
  const res = agentCollab(args);
  if (Array.isArray(res)) return res as RoomMessage[];
  if (res && Array.isArray((res as { messages?: RoomMessage[] }).messages)) return (res as { messages: RoomMessage[] }).messages;
  return [];
}

type RoomStatus = {
  state?: string;
  project_dir?: string;
  members?: Array<{ session_id?: string; name?: string; role?: string; state?: string }>;
};

function acRoomStatus(roomId: string): RoomStatus {
  return agentCollab(["room", "status", "--room", roomId]) as RoomStatus;
}

// ---------------------------------------------------------------------------
// OpenCode server: planner status + pending-question detection
// ---------------------------------------------------------------------------

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { accept: "application/json" };
  const pw = process.env.OPENCODE_SERVER_PASSWORD;
  if (pw) {
    const user = process.env.OPENCODE_SERVER_USERNAME || "opencode";
    h.authorization = `Basic ${Buffer.from(`${user}:${pw}`).toString("base64")}`;
  }
  return h;
}

async function sessionStatus(sessionId: string): Promise<"idle" | "busy" | "retry" | "unknown"> {
  const url = `${opencodeServerUrl()}/session/status`;
  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) return "unknown";
    const data = (await res.json()) as Record<string, { type?: string }>;
    // OpenCode's /session/status map ONLY contains busy/retry sessions: when a
    // session goes idle it is DELETED from the map (opencode src/session/status.ts
    // -> set() deletes idle entries). So an absent entry means the planner is
    // IDLE -- which is exactly the state in which the driver should be allowed to
    // proceed. Returning "unknown" here would stall the workflow forever, because
    // the planner is idle far more often than it is busy.
    const entry = data?.[sessionId];
    if (!entry) return "idle";
    const t = entry.type;
    if (t === "idle" || t === "busy" || t === "retry") return t;
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function plannerStatus(state: State): Promise<"idle" | "busy" | "retry" | "unknown"> {
  return sessionStatus(state.plannerSessionId);
}

// Detect whether the planner has a pending `question` tool request awaiting the
// Master's reply. The session-status union (idle/busy/retry) has no "waiting for
// question" type, and a pending question can leave the planner reading idle, so we
// query the question-request API directly. Returns:
//   true    -> planner has >=1 pending question (do NOT proceed)
//   false   -> planner has no pending question (ok to proceed, subject to other checks)
//   "unknown" -> API/auth failure; caller fails closed and holds the workflow.
async function plannerHasPendingQuestion(state: State): Promise<boolean | "unknown"> {
  // The planner session lives in the opencode-assistant workspace (this repo), so
  // scope the query to that location regardless of which target project is being
  // orchestrated -- the question is owned by the planner session, not the target.
  const plannerWorkspace = path.resolve(import.meta.dir, "..", "..");
  const url =
    `${opencodeServerUrl()}/api/question/request` +
    `?location%5Bdirectory%5D=${encodeURIComponent(plannerWorkspace)}`;
  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) return "unknown";
    const data = (await res.json()) as { data?: Array<{ sessionID?: string }> };
    const reqs = data?.data ?? [];
    return reqs.some((r) => r.sessionID === state.plannerSessionId);
  } catch {
    return "unknown";
  }
}



function implementerPrompt(state: State, phase: PhaseDef, alias: string, runIdx: number): string {
  const lockNote = LOCKED_FILE_RULES[phase.id]
    ? `\n\nIMPORTANT ENFORCEMENT RULE: You may ONLY toggle checkboxes (\`- [ ]\` <-> \`- [x]\`) in ${LOCKED_FILE_RULES[phase.id]!.file}. ` +
      `Do NOT edit, add, rename, or rewrite any other content in that file. ` +
      `If a task/issue is genuinely infeasible, leave its box unchecked and explain in your report -- the planner will decide. ` +
      `Any non-checkbox content change you make to that file will be reverted and your run repeated.`
    : "";
  // The issue-recording format (ISSUE-<n> template, evidence indentation) is
  // owned by the openspec-test and openspec-code-review skills themselves, not
  // injected here. The driver only needs to tell the implementer which skill to
  // load and how to signal completion.
  return [
    `Load the \`${phase.skill}\` skill and follow its instructions to work on the OpenSpec change.`,
    ``,
    `Proposal: ${state.proposalName} (at ${state.proposalDir}).`,
    `Run ${runIdx} of this phase (${phase.id}). Work in ${state.projectDir} on branch ${state.branch}.`,
    lockNote,
    ``,
    `When you have finished this phase, you MUST send a single completion message to this room. ` +
      `Use the agent-collab member workflow you received on joining the room. The exact command is:`,
    ``,
    `  bun ${agentCollabScript()} send --room ${state.roomId} --session "$OPENCODE_SESSION_ID" --from ${alias} --kind completion --body "<one-paragraph summary: what you did + current tasks.md/issue.md state>"`,
    ``,
    `The workflow will not advance until it sees your completion message, so do not skip it. ` +
      `For all other communication (questions, progress notes) also use agent-collab as described in the member workflow; never use the user-facing \`question\` tool.`,
  ].join("\n");
}

function fixPrompt(state: State, findingPhase: PhaseDef, alias: string, runIdx: number): string {
  return [
    `Load the \`openspec-fix\` skill and follow its instructions to resolve the unchecked issues for the OpenSpec change.`,
    ``,
    `Proposal: ${state.proposalName} (at ${state.proposalDir}).`,
    `The ${findingPhase.id} phase left unchecked issues in openspec/changes/${state.proposalName}/issue.md. Fix them.`,
    `Fix run ${runIdx}. Work in ${state.projectDir} on branch ${state.branch}.`,
    ``,
    `IMPORTANT ENFORCEMENT RULE: You may ONLY toggle checkboxes (\`- [ ]\` -> \`- [x]\`) in issue.md to mark an issue resolved. ` +
      `Do NOT edit issue descriptions, add new issues, or rewrite any content. Only the finder phases (test/code-review) edit issue.md content; you only resolve. ` +
      `Any non-checkbox content change you make to issue.md will be reverted and your run repeated.`,
    ``,
    `When finished, send a completion message to this room:`,
    ``,
    `  bun ${agentCollabScript()} send --room ${state.roomId} --session "$OPENCODE_SESSION_ID" --from ${alias} --kind completion --body "<which issues you resolved>"`,
  ].join("\n");
}

function committerPrompt(state: State, alias: string, phaseLabel: string): string {
  return [
    `You are the committer for an OpenSpec workflow checkpoint.`,
    ``,
    `Work in ${state.projectDir} on branch ${state.branch}.`,
    `Inspect: git status, git diff, git log --oneline -5.`,
    `Stage all changes relevant to the just-completed phase (${phaseLabel}). ` +
      `Include all changes under openspec/ (proposal artifacts, archive directory moves, synced specs) and any code/doc/test changes the implementer made. ` +
      `If .gitignore was modified to add opsx-workflow state/log entries, include that too.`,
    `Do NOT stage openspec/.opsx-workflow-state.json (it is gitignored planner state).`,
    `Commit with a concise message matching the repo's existing style. If there is nothing to commit, report "nothing to commit".`,
    `Do not push (the workflow merges the branch at the end).`,
    ``,
    `When finished, send a completion message to this room:`,
    ``,
    `  bun ${agentCollabScript()} send --room ${state.roomId} --session "$OPENCODE_SESSION_ID" --from ${alias} --kind completion --body "<commit hash or nothing-to-commit>"`,
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Wait helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// Wait until the implementer emits a completion-kind message to the room. Long
// busy runs are allowed indefinitely; only an idle worker that failed to report
// completion is treated as stalled.
async function waitForImplementerCompletion(
  state: State,
  alias: string,
  sessionId: string,
  spawnedAtMs: number,
): Promise<RoomMessage> {
  let sawBusy = false;
  let idleSince = 0;
  for (;;) {
    await sleep(POLL_INTERVAL_MS);
    // Filter at the API level with --since to avoid the room-service pagination
    // blind-spot (DEFAULT_PAGE_SIZE = 50, oldest-first). The 5s back-off covers
    // the gap between spawning the member and the room service indexing its
    // join/spawn messages.
    const msgs = acRoomMessages(state, spawnedAtMs - 5_000).filter((m) => m.sender_name === alias);
    const completion = msgs.find((m) => m.kind === "completion");
    if (completion) return completion;

    if (pauseMarkerExists(state.projectDir)) {
      idleSince = 0;
      continue;
    }

    const status = await sessionStatus(sessionId);
    if (status === "busy" || status === "retry") {
      sawBusy = true;
      idleSince = 0;
      continue;
    }
    if (status === "unknown") continue;
    if (idleSince === 0) idleSince = Date.now();
    const idleLimit = sawBusy ? IMPLEMENTER_IDLE_STALL_MS : IMPLEMENTER_NEVER_BUSY_STALL_MS;
    if (Date.now() - idleSince > idleLimit) {
      logEvent(state, "implementer_stalled", `${alias}: idle without completion for ${idleLimit}ms; pausing for planner`);
      state.paused = true;
      state.workflowStatus = "paused";
      await saveState(state, { forcePaused: true });
      acBotNotify(
        state,
        `Implementer "${alias}" is idle and has not reported completion for ${Math.round(idleLimit / 60_000)} min. ` +
          `It may be stuck, crashed, or have skipped the completion message. Inspect the room; message or hard-interrupt the implementer via agent-collab. ` +
          `When resolved, run: opsx-workflow continue.`,
      );
      await waitForPlannerProceed(state, `implementer ${alias} stall resolved`);
      sawBusy = false;
      idleSince = 0;
      // Do NOT reset spawnedAtMs here. The stall often fires because the
      // implementer's completion message was missed (e.g. before the pagination
      // fix, messages beyond page 1 were invisible). Resetting spawnedAtMs to
      // Date.now() would exclude any pre-stall completion from the time-window
      // filter (created_at >= spawnedAtMs - 5000), making recovery impossible
      // without manual intervention. Keep the original spawn time so the driver
      // can still detect a completion that landed before the stall fired.
    }
  }
}

function reportDeliveredToPlanner(state: State, reportMessageId: string): boolean {
  const report = acRoomMessages(state).find((message) => message.id === reportMessageId);
  return Boolean(
    report?.deliveries?.some(
      (delivery) =>
        delivery.target_session_id === state.plannerSessionId &&
        delivery.target_name === PLANNER_ALIAS &&
        delivery.state === "injected",
    ),
  );
}

// Wait until the latest report has actually been injected into the planner
// session, then until the planner is stably idle, has no pending user question,
// and has not paused the workflow. Delivery injection replaces the fragile
// "saw busy" heuristic, which could miss a short planner turn between polls.
async function waitForPlannerProceed(state: State, label: string, reportMessageId?: string): Promise<void> {
  let idleSince = 0;
  for (;;) {
    await sleep(POLL_INTERVAL_MS);
    // The marker file is the atomic control signal written by pause/continue.
    state.paused = pauseMarkerExists(state.projectDir);
    if (state.workflowStatus !== "error" && state.workflowStatus !== "completed") {
      state.workflowStatus = state.paused ? "paused" : "running";
    }
    if (state.paused) {
      idleSince = 0;
      continue;
    }
    if (reportMessageId && !reportDeliveredToPlanner(state, reportMessageId)) {
      idleSince = 0;
      continue;
    }
    const status = await plannerStatus(state);
    if (status === "unknown") {
      // Server/auth failure or planner session absent from the status response.
      // Never advance blindly on an unknown status -- fail-stall so the planner
      // can notice the lack of progress and investigate. Log each poll so it is
      // visible in the daemon log.
      console.warn(`[opsx-workflow] planner status unknown (server/auth/planner-session); holding at "${label}"`);
      idleSince = 0;
      continue;
    }
    if (status === "busy" || status === "retry") {
      idleSince = 0;
      continue;
    }
    // status == idle
    if (idleSince === 0) {
      idleSince = Date.now();
      continue;
    }
    if (Date.now() - idleSince < PLANNER_PROCEED_IDLE_RECONFIRM_MS) continue;
    // Final guard: do not advance while the planner has a `question` tool request
    // awaiting the Master's reply (the session may read idle in that state). Re-check
    // on each poll until the planner answers and the question clears.
    const pending = await plannerHasPendingQuestion(state);
    if (pending === true) {
      idleSince = 0;
      continue;
    }
    if (pending === "unknown") {
      console.warn(`[opsx-workflow] pending-question probe unknown at "${label}"; holding to avoid advancing while the Master may be answering`);
      idleSince = 0;
      continue;
    }
    logEvent(state, "planner_proceed", label);
    return;
  }
}

// ---------------------------------------------------------------------------
// Deterministic completion checks
// ---------------------------------------------------------------------------

function proposalArtifactFiles(state: State): string[] {
  // files under openspec/changes/<proposal>/ that are tracked or untracked-new
  const porcelain = workingTreePorcelain(state.projectDir);
  return porcelain
    .map(porcelainPath)
    .filter((f) => f.startsWith(`openspec/changes/${state.proposalName}/`));
}

function archivedProposalExists(state: State): boolean {
  const archiveRoot = path.join(state.projectDir, "openspec", "changes", "archive");
  if (!existsSync(archiveRoot)) return false;
  const escaped = state.proposalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expectedName = new RegExp(`^(?:\\d{4}-\\d{2}-\\d{2}-)?${escaped}$`);
  return readdirSync(archiveRoot, { withFileTypes: true }).some(
    (entry) =>
      entry.isDirectory() &&
      expectedName.test(entry.name) &&
      existsSync(path.join(archiveRoot, entry.name, "proposal.md")),
  );
}

function isPhaseClean(state: State, phase: PhaseDef): boolean {
  const tasksFile = path.join(state.proposalDir, "tasks.md");
  const issueFile = path.join(state.proposalDir, "issue.md");
  switch (phase.family) {
    case "self-heal":
      // apply-resume reviews the whole implementation -> clean iff this session
      // changed no tracked file AND created no new untracked file beyond the
      // baseline. Tracked-only + baseline-aware untracked so pre-existing stray
      // files (editor temps, build output) don't block convergence.
      // review-proposal / align touch only proposal artifacts -> clean = no
      // proposal-artifact edits.
      if (phase.id === "apply-resume") {
        return trackedChangedFiles(state.projectDir).length === 0 && newUntrackedFiles(state).length === 0;
      }
      return proposalArtifactFiles(state).length === 0;
    case "apply":
      return allTasksChecked(tasksFile);
    case "finding":
      // test / code-review / test-regression: clean when issue.md has no unchecked boxes
      return uncheckedCount(issueFile) === 0;
    case "archive": {
      const originalGone = !existsSync(state.proposalDir);
      return originalGone && archivedProposalExists(state);
    }
  }
}

// Enforce checkbox-only editing on the locked file for apply/apply-resume/fix.
// Returns true if a violation was found (and reverted). Pass a `before` snapshot
// (from snapshotLockedFile at session start) so the comparison baseline includes
// any content edits the planner made during a pause; without a snapshot the
// HEAD-based path is used (kept for tests / no-snapshot callers).
function enforceLock(state: State, phaseId: string, before?: FileSnapshot): boolean {
  const rule = LOCKED_FILE_RULES[phaseId];
  if (!rule) return false;
  const fileAbs = path.join(state.proposalDir, rule.file);

  if (before !== undefined && before !== null) {
    if (!existsSync(fileAbs)) {
      if (!before.existed) return false;
      requireGit(state.projectDir, ["reset", "--", path.relative(state.projectDir, fileAbs)]);
      writeFileSync(fileAbs, before.content, "utf8");
      return true;
    }
    const currentContent = readFileSync(fileAbs, "utf8");
    if (onlyCheckboxTogglesBetween(before.content, currentContent)) return false; // toggles only = OK
    requireGit(state.projectDir, ["reset", "--", path.relative(state.projectDir, fileAbs)]);
    if (before.existed) {
      writeFileSync(fileAbs, before.content, "utf8");
    } else {
      try { unlinkSync(fileAbs); } catch { /* already gone */ }
    }
    return true; // violation reverted to session-start snapshot
  }

  if (!existsSync(fileAbs)) return false;

  const porcelain = workingTreePorcelain(state.projectDir);
  const touched = porcelain.some((line) => {
    const f = porcelainPath(line);
    return f === `openspec/changes/${state.proposalName}/${rule.file}`;
  });
  if (!touched) return false;
  if (onlyCheckboxToggles(state.projectDir, fileAbs)) return false; // toggles only = OK
  revertFile(state.projectDir, fileAbs);
  return true; // violation reverted
}

// ---------------------------------------------------------------------------
// Driver: phase graph traversal
// ---------------------------------------------------------------------------

async function spawnAndWaitImplementer(state: State, phase: PhaseDef, alias: string, runIdx: number): Promise<void> {
  logEvent(state, "spawn", `${phase.id} ${alias} run ${runIdx}`);
  const spawnedAt = Date.now();
  const spawned = acSpawnImpl(state, phase, alias, runIdx);
  const report = await waitForImplementerCompletion(state, alias, spawned.sessionId, spawnedAt);
  await waitForPlannerProceed(state, `${phase.id} run ${runIdx} reviewed`, report.id);
  acMemberRemove(state, alias);
}

async function spawnAndWaitFix(state: State, findingPhase: PhaseDef, runIdx: number): Promise<void> {
  // Alias is phase-scoped so test's fixer-1 and code-review's fixer-1 don't
  // collide in the room transcript (and survive any member-removal timing).
  const alias = `fixer-${findingPhase.id}-${runIdx}`;
  logEvent(state, "spawn", `fix for ${findingPhase.id} ${alias} run ${runIdx}`);
  const spawnedAt = Date.now();
  const spawned = acSpawnFix(state, findingPhase, alias, runIdx);
  const report = await waitForImplementerCompletion(state, alias, spawned.sessionId, spawnedAt);
  await waitForPlannerProceed(state, `fix for ${findingPhase.id} run ${runIdx} reviewed`, report.id);
  acMemberRemove(state, alias);
}

async function commitCheckpoint(state: State, phaseLabel: string): Promise<void> {
  let attempt = 0;
  for (;;) {
    attempt += 1;
    const alias = `committer-${phaseLabel}-${Date.now()}`;
    logEvent(state, "spawn", `committer ${alias} (${phaseLabel}, attempt ${attempt})`);
    const spawnedAt = Date.now();
    const spawned = acSpawnCommitter(state, alias, phaseLabel);
    const report = await waitForImplementerCompletion(state, alias, spawned.sessionId, spawnedAt);
    await waitForPlannerProceed(state, `committer ${phaseLabel} reviewed`, report.id);
    acMemberRemove(state, alias);

    if (currentBranch(state.projectDir) !== state.branch) {
      throw new Error(`committer left repository on ${currentBranch(state.projectDir)}; expected ${state.branch}`);
    }
    const remaining = workingTreePorcelain(state.projectDir);
    if (remaining.length === 0) return;
    logEvent(state, "committer_incomplete", `${phaseLabel}: ${remaining.join(" | ")}`);
    if (attempt < COMMITTER_RETRY_LIMIT) continue;

    state.paused = true;
    state.workflowStatus = "paused";
    await saveState(state, { forcePaused: true });
    acBotNotify(
      state,
      `Committer left uncommitted changes after ${COMMITTER_RETRY_LIMIT} attempts for ${phaseLabel}: ${remaining.join(", ")}. ` +
        `Workflow paused. Inspect and commit or revert the files, then run opsx-workflow continue.`,
    );
    await waitForPlannerProceed(state, `committer ${phaseLabel} cleanup resolved`);
    if (workingTreePorcelain(state.projectDir).length === 0) return;
    attempt = 0;
  }
}

async function resolveCap(state: State, phase: PhaseDef, counterKey: string, detail: string): Promise<void> {
  const cap = state.caps[phase.capKey];
  if ((state.loopCounters[counterKey] ?? 0) < cap) return;
  logEvent(state, "cap_reached", `${detail}=${state.loopCounters[counterKey]}/${cap}`);
  state.paused = true;
  state.workflowStatus = "paused";
  await saveState(state, { forcePaused: true });
  acBotNotify(
    state,
    `CAP REACHED on ${detail} (${state.loopCounters[counterKey]}/${cap}). ` +
      `The workflow is paused. Inspect ${state.proposalDir}/tasks.md and issue.md, edit content if a task/issue is genuinely infeasible, ` +
      `then run: opsx-workflow continue. If you cannot decide, escalate to the Master.`,
  );
  await waitForPlannerProceed(state, `cap on ${detail} resolved`);
  state.loopCounters[counterKey] = 0;
  state.workflowStatus = "running";
  await saveState(state);
}

async function runFixLoop(state: State, findingPhase: PhaseDef): Promise<void> {
  const issueFile = path.join(state.proposalDir, "issue.md");
  const counterKey = `${findingPhase.id}:fix`;
  state.loopCounters[counterKey] ??= 0;

  while (uncheckedCount(issueFile) > 0) {
    await resolveCap(state, findingPhase, counterKey, `fix for ${findingPhase.id}`);
    if (uncheckedCount(issueFile) === 0) break; // planner may have resolved at the cap

    const beforeUnchecked = uncheckedCount(issueFile);
    const beforeFix = snapshotLockedFile(state, "fix");
    const runIdx = (state.loopCounters[counterKey] ?? 0) + 1;
    await spawnAndWaitFix(state, findingPhase, runIdx);
    state.loopCounters[counterKey] = runIdx;

    if (enforceLock(state, "fix", beforeFix)) {
      logEvent(
        state,
        "enforcement_revert",
        `fix for ${findingPhase.id} modified issue.md content; issue.md restored, code changes retained, retrying fix without commit`,
      );
      await saveState(state);
      continue;
    }

    const afterUnchecked = uncheckedCount(issueFile);
    if (afterUnchecked >= beforeUnchecked) {
      logEvent(
        state,
        "fix_no_progress",
        `fix for ${findingPhase.id} checked no issue boxes; code changes retained, retrying fix without commit`,
      );
      await saveState(state);
      continue;
    }

    await commitCheckpoint(state, `fix-${findingPhase.id}-run${runIdx}`);
    await saveState(state);
  }

  state.loopCounters[counterKey] = 0;
  await saveState(state);
}

async function runPhaseLoop(state: State, phase: PhaseDef): Promise<void> {
  state.loopCounters[phase.id] ??= 0;
  let runIdx = 0;
  for (;;) {
    runIdx += 1;
    await resolveCap(state, phase, phase.id, `phase ${phase.id}`);

    // 1. spawn implementer for this phase
    const alias = `${phase.aliasBase}-${runIdx}`;
    const beforeLock = snapshotLockedFile(state, phase.id);
    await spawnAndWaitImplementer(state, phase, alias, runIdx);

    // 2. enforcement on locked file (apply/apply-resume/fix). Retry without commit.
    if (enforceLock(state, phase.id, beforeLock)) {
      logEvent(state, "enforcement_revert", `${phase.id} modified locked-file content; retrying`);
      state.loopCounters[phase.id] += 1;
      await saveState(state);
      continue;
    }

    // 3. deterministic completion check
    const clean = isPhaseClean(state, phase);

    // 4. commit checkpoint (always, per design)
    await commitCheckpoint(state, `${phase.id}-run${runIdx}`);

    // 5. route
    if (phase.family === "finding") {
      if (clean) {
        logEvent(state, "phase_complete", `${phase.id} clean on run ${runIdx}`);
        state.loopCounters[phase.id] = 0;
        await saveState(state);
        return; // advance
      }
      // Dirty finding -> commit its issue.md additions, run fresh fix sessions
      // until every issue is checked, then re-run the finding phase once.
      state.loopCounters[phase.id] += 1;
      await saveState(state);
      await runFixLoop(state, phase);
      continue; // re-run finding
    }

    // self-heal / apply / align / archive
    if (clean) {
      logEvent(state, "phase_complete", `${phase.id} clean on run ${runIdx}`);
      state.loopCounters[phase.id] = 0;
      await saveState(state);
      return;
    }
    state.loopCounters[phase.id] += 1;
    await saveState(state);
    // loop -> re-run phase
  }
}

async function mergeAndCleanup(state: State): Promise<void> {
  // Merge the feature branch into the local base branch ONLY.
  // Deliberately does NOT push and does NOT delete the feature branch:
  //  - No push: keeps the workflow's git writes local so the planner/master can
  //    review the merge and push manually. If something went wrong, everything
  //    is local and recoverable; a bad remote push would be much harder to undo.
  //  - No branch delete: the feature branch preserves the per-phase commit
  //    history for inspection/troubleshooting. The planner/master deletes it
  //    manually after reviewing.
  if (workingTreePorcelain(state.projectDir).length > 0) {
    throw new Error(`cannot merge with uncommitted changes: ${workingTreePorcelain(state.projectDir).join(" | ")}`);
  }
  logEvent(state, "merging", `${state.branch} -> ${state.baseBranch}`);
  const mergeBase = git(state.projectDir, ["checkout", state.baseBranch]);
  if (!mergeBase.ok) throw new Error(`checkout ${state.baseBranch} failed: ${mergeBase.stderr}`);
  const merge = git(state.projectDir, ["merge", "--no-ff", state.branch, "-m", `merge: OpenSpec ${state.proposalName} (opsx-workflow)`]);
  if (!merge.ok) {
    // conflict -> abort merge, return to branch, pause, notify planner
    requireGit(state.projectDir, ["merge", "--abort"]);
    requireGit(state.projectDir, ["checkout", state.branch]);
    state.paused = true;
    state.workflowStatus = "paused";
    await saveState(state, { forcePaused: true });
    acBotNotify(state, `MERGE CONFLICT merging ${state.branch} into ${state.baseBranch}. Workflow paused. Resolve manually or adjust, then opsx-workflow continue.`);
    await waitForPlannerProceed(state, "merge conflict resolved");
    return mergeAndCleanup(state);
  }
  logEvent(state, "merged_local", `${state.branch} merged into ${state.baseBranch} (local; not pushed, branch kept)`);
}

async function driverLoop(state: State): Promise<void> {
  // Resume support: start from the saved phase index so a daemon relaunched
  // via `resume` (after an error exit) continues where it left off. Completed
  // phases already produced clean commits, so re-entering a completed phase
  // will converge on the first run (wasting one session but never re-doing
  // work destructively).
  const startIdx = Math.min(state.currentPhaseIdx ?? 0, PHASES.length - 1);
  for (let idx = startIdx; idx < PHASES.length; idx++) {
    state.currentPhaseIdx = idx;
    await saveState(state);
    const phase = PHASES[idx]!;
    logEvent(state, "phase_start", phase.id);
    await runPhaseLoop(state, phase);
  }
  await mergeAndCleanup(state);
  logEvent(state, "workflow_complete", state.proposalName);
  state.currentPhaseIdx = PHASES.length;
  state.workflowStatus = "completed";
  state.completedAt = nowIso();
  await saveState(state);
  // Intentionally do NOT delete the feature branch: it preserves the per-phase
  // commit history for inspection. The planner/master deletes it manually after
  // reviewing the merge. Pushing to the remote is also a manual step.
  acBotNotify(
    state,
    `WORKFLOW COMPLETE: ${state.proposalName} merged into local ${state.baseBranch} (not pushed). ` +
      `Feature branch ${state.branch} kept for inspection. Review the merge, then push and delete the branch manually.`,
  );
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`opsx-workflow -- deterministic driver for the OpenSpec 8-phase workflow.

Usage:
  bun .opencode/scripts/opsx-workflow.ts start <room-id> <proposal-path-or-name> [options]
  bun .opencode/scripts/opsx-workflow.ts resume [options]
  bun .opencode/scripts/opsx-workflow.ts pause [options]
  bun .opencode/scripts/opsx-workflow.ts continue [options]
  bun .opencode/scripts/opsx-workflow.ts status [options]
  bun .opencode/scripts/opsx-workflow.ts log [options]
  bun .opencode/scripts/opsx-workflow.ts --help

Commands:
  start    Create the feature branch, initialise state, and run the driver in the
           background. Returns immediately with the driver pid.
  resume   Re-launch the daemon after it exited (error/cap recovery). Resumes from
           the saved phase index. Use this (not 'continue') when the daemon process
           is no longer running.
  pause    Set the pause flag (the driver stops advancing until 'continue').
  continue Clear the pause flag (only effective while the daemon is still running).
  status   Print current workflow state.
  log      Tail the daemon log.

Common options (pause/continue/status/log):
  --project-dir <path>          Target project root (default: git toplevel of cwd).
                                 Use this when the planner's cwd is not the target project.

start options:
  --planner-session <ses_...>   Planner OpenCode session id (defaults to OPENCODE_SESSION_ID).
  --project-dir <path>          Project root (defaults to git toplevel of the proposal path).
  --base-branch <name>          Branch to merge into at the end (default: detected main/master).
  --cap-selfHeal <n>            Override self-heal cap (default ${DEFAULT_CAPS.selfHeal}).
  --cap-apply <n>               Override apply self-loop cap (default ${DEFAULT_CAPS.apply}).
  --cap-testFix <n>             Override test<->fix cap (default ${DEFAULT_CAPS.testFix}).
  --cap-codeReviewFix <n>       Override code-review<->fix cap (default ${DEFAULT_CAPS.codeReviewFix}).
  --foreground                   Run the driver in the foreground (default: background/daemon).`);
}

function parseStartArgs(argv: string[]): {
  room: string;
  proposalArg: string;
  plannerSession: string | undefined;
  projectDir: string | undefined;
  baseBranch: string;
  caps: Caps;
  foreground: boolean;
} {
  const positionals: string[] = [];
  const flags: Record<string, string> = {};
  const valueFlags = new Set(["planner-session", "project-dir", "base-branch", "cap-selfHeal", "cap-apply", "cap-testFix", "cap-codeReviewFix"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq >= 0 ? a.slice(2, eq) : a.slice(2);
      if (name === "foreground") {
        if (eq >= 0) throw new Error("--foreground does not take a value");
        flags[name] = "true";
        continue;
      }
      if (!valueFlags.has(name)) throw new Error(`unknown start option: --${name}`);
      const val = eq >= 0 ? a.slice(eq + 1) : argv[++i];
      if (!val || val.startsWith("--")) throw new Error(`--${name} requires a value`);
      flags[name] = val;
    } else {
      positionals.push(a);
    }
  }
  const [room, proposalArg] = positionals;
  if (!room || !proposalArg) throw new Error("start requires <room-id> <proposal-path-or-name>");
  if (positionals.length > 2) throw new Error(`unexpected start arguments: ${positionals.slice(2).join(" ")}`);
  const caps: Caps = { ...DEFAULT_CAPS };
  const positiveInt = (name: string, value?: string) => {
    if (value === undefined) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive integer`);
    return parsed;
  };
  caps.selfHeal = positiveInt("cap-selfHeal", flags["cap-selfHeal"]) ?? caps.selfHeal;
  caps.apply = positiveInt("cap-apply", flags["cap-apply"]) ?? caps.apply;
  caps.testFix = positiveInt("cap-testFix", flags["cap-testFix"]) ?? caps.testFix;
  caps.codeReviewFix = positiveInt("cap-codeReviewFix", flags["cap-codeReviewFix"]) ?? caps.codeReviewFix;
  return {
    room,
    proposalArg,
    plannerSession: flags["planner-session"],
    projectDir: flags["project-dir"],
    baseBranch: flags["base-branch"] || "",
    caps,
    foreground: Boolean(flags["foreground"]),
  };
}

function resolveProposal(proposalArg: string, projectDirHint?: string): { name: string; proposalDir: string; projectDir: string } {
  const abs = path.isAbsolute(proposalArg) ? proposalArg : path.resolve(process.cwd(), proposalArg);
  let proposalDir: string;
  if (existsSync(abs) && existsSync(path.join(abs, "proposal.md"))) {
    proposalDir = abs;
  } else {
    // treat as a name under openspec/changes/<name> relative to the project
    const projectDir = projectDirHint ? path.resolve(projectDirHint) : gitTopLevelFromCwd();
    proposalDir = path.join(projectDir, "openspec", "changes", proposalArg);
    if (!existsSync(path.join(proposalDir, "proposal.md"))) {
      throw new Error(`proposal not found: ${proposalArg} (looked at ${abs} and ${proposalDir})`);
    }
  }
  const projectDir = projectDirHint ? path.resolve(projectDirHint) : gitTopLevel(proposalDir);
  const name = path.basename(proposalDir);
  return { name, proposalDir, projectDir };
}

function gitTopLevelFromCwd(): string {
  return gitTopLevel(process.cwd());
}

// Resolve the target project directory from CLI args. Allows pause/continue/status/log
// to target a project other than the planner's cwd (the planner lives in opencode-assistant
// but may be orchestrating a proposal in a different repo).
function resolveProjectDir(args: string[]): string {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--project-dir") {
      const v = args[++i];
      if (v) return path.resolve(v);
    } else if (a.startsWith("--project-dir=")) {
      return path.resolve(a.slice("--project-dir=".length));
    }
  }
  return gitTopLevelFromCwd();
}

function validateProposalLocation(projectDir: string, proposalDir: string, proposalName: string): void {
  const expected = path.join(projectDir, "openspec", "changes", proposalName);
  if (path.resolve(proposalDir) !== path.resolve(expected)) {
    throw new Error(`proposal must be an active change at ${expected}; received ${proposalDir}`);
  }
}

function validateRoomForStart(roomId: string, plannerSession: string, projectDir: string): void {
  const room = acRoomStatus(roomId);
  if (room.state !== "open") throw new Error(`agent-collab room ${roomId} is not open (state=${room.state ?? "unknown"})`);
  if (room.project_dir && path.resolve(room.project_dir) !== path.resolve(projectDir)) {
    throw new Error(`room project ${room.project_dir} does not match proposal project ${projectDir}`);
  }
  const planner = room.members?.find(
    (member) => member.session_id === plannerSession && member.name === PLANNER_ALIAS && member.role === "planner" && member.state === "active",
  );
  if (!planner) throw new Error(`planner session ${plannerSession} is not the active planner in room ${roomId}`);
}

function validateStartWorktree(projectDir: string, proposalName: string): void {
  const proposalPrefix = `openspec/changes/${proposalName}/`;
  const unrelated = changedFiles(projectDir).filter(
    (file) => file !== `openspec/changes/${proposalName}` && file !== `${proposalPrefix.slice(0, -1)}` && !file.startsWith(proposalPrefix),
  );
  if (unrelated.length > 0) {
    throw new Error(
      `workflow start requires a clean worktree outside this proposal; commit/stash these files first: ${unrelated.join(", ")}`,
    );
  }
}

function localBranchExists(projectDir: string, branch: string): boolean {
  return git(projectDir, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).ok;
}

async function cmdStart(argv: string[]): Promise<number> {
  loadConfigEnv();
  const opts = parseStartArgs(argv);
  const { name, proposalDir, projectDir } = resolveProposal(opts.proposalArg, opts.projectDir);
  const planner = opts.plannerSession || plannerSessionId();
  const branch = `openspec/${name}`;
  const baseBranch = opts.baseBranch || detectBaseBranch(projectDir);

  validateProposalLocation(projectDir, proposalDir, name);
  const tasksPath = path.join(proposalDir, "tasks.md");
  if (!existsSync(tasksPath)) {
    throw new Error(`proposal has no tasks.md (looked at ${tasksPath}); the apply phase requires it`);
  }
  if (checkboxCount(tasksPath) === 0) throw new Error(`proposal tasks.md has no task checkboxes: ${tasksPath}`);
  validateRoomForStart(opts.room, planner, projectDir);

  const existingStateFile = statePath(projectDir);
  if (existsSync(existingStateFile)) {
    const existing = await loadState(existingStateFile);
    const incomplete = existing.workflowStatus !== "completed";
    if (incomplete || isProcessAlive(readDaemonPid(projectDir) ?? existing.daemonPid)) {
      throw new Error(
        `existing workflow state for ${existing.proposalName} is ${existing.workflowStatus ?? "incomplete"}; ` +
          `use resume/continue or remove the stale state deliberately before starting another proposal`,
      );
    }
  }

  if (!git(projectDir, ["check-ref-format", "--branch", branch]).ok) throw new Error(`invalid workflow branch name: ${branch}`);
  if (localBranchExists(projectDir, branch)) {
    throw new Error(`workflow branch already exists: ${branch}; resume the prior workflow or delete the stale branch deliberately`);
  }
  if (currentBranch(projectDir) !== baseBranch) {
    throw new Error(`start from base branch ${baseBranch}; current branch is ${currentBranch(projectDir)}`);
  }
  validateStartWorktree(projectDir, name);

  // branch setup FIRST so the .gitignore guard commit lands on the feature branch
  requireGit(projectDir, ["checkout", "-b", branch]);

  // Make sure daemon state/log won't leak into working-tree checks, then commit
  // the guard on the feature branch so apply-resume's whole-tree clean check
  // isn't polluted by an uncommitted .gitignore.
  await ensureGitignore(projectDir);
  commitGitignoreGuard(projectDir);

  // Snapshot the untracked-file baseline so apply-resume's clean check can
  // ignore pre-existing stray files (editor temps, build output, dev notes)
  // unrelated to this proposal. Captured AFTER the feature branch + gitignore
  // guard commit so it reflects the workflow's actual starting tree.
  const baselineUntracked = currentUntrackedFiles(projectDir);
  writePauseMarker(projectDir, false);

  const state: State = {
    proposalName: name,
    proposalDir,
    projectDir,
    roomId: opts.room,
    plannerSessionId: planner,
    branch,
    baseBranch,
    paused: false,
    caps: opts.caps,
    loopCounters: {},
    currentPhaseIdx: 0,
    workflowStatus: "running",
    startedAt: nowIso(),
    lastUpdated: nowIso(),
    baselineUntracked,
    log: [],
  };
  await saveState(state);

  if (opts.foreground) {
    await runDriverProcess(state);
    return 0;
  }

  // background/daemon: re-exec self with --daemon <statefile>, redirecting
  // stdout/stderr to a log file via a shell wrapper (reliable across runtimes).
  const stateFile = statePath(projectDir);
  const logFile = path.join(projectDir, "openspec", ".opsx-workflow.log");
  const daemonCmd = `exec bun "${import.meta.path}" --daemon "${stateFile}" >> "${logFile}" 2>&1`;
  // Bun.spawn requires stdio as an array (unlike Node's "ignore" shorthand).
  const child = Bun.spawn(["sh", "-c", daemonCmd], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  child.unref();
  writeDaemonPid(projectDir, child.pid);
  console.log(`opsx-workflow started: proposal=${name} branch=${branch} room=${opts.room} pid=${child.pid}`);
  console.log(`state: ${stateFile}`);
  console.log(`log:   ${logFile}`);
  return 0;
}

async function runDriverProcess(state: State): Promise<void> {
  state.daemonPid = process.pid;
  writeDaemonPid(state.projectDir, process.pid);
  // Spawn the persistent notifier bot once. If it fails the driver still runs;
  // notifications degrade to console warnings (the pause flag remains the real halt).
  try {
    ensureNotifierBot(state);
    await saveState(state);
  } catch (err) {
    console.error("[opsx-workflow] notifier bot setup failed:", (err as Error).message);
  }
  let completed = false;
  try {
    state.workflowStatus = "running";
    await saveState(state);
    await driverLoop(state);
    logEvent(state, "driver_exit", "complete");
    completed = true;
  } catch (err) {
    logEvent(state, "driver_error", (err as Error).message);
    state.paused = true;
    state.workflowStatus = "error";
    await saveState(state, { forcePaused: true });
    acBotNotify(state, `WORKFLOW ERROR: ${(err as Error).message}. Workflow paused and the daemon has exited. Investigate, then run: opsx-workflow resume [--project-dir <path>].`);
  } finally {
    // Always release the notifier bot, even on error/cap paths, so it doesn't
    // outlive the driver.
    removeNotifierBot(state);
    if (completed) acRoomClose(state);
    removeDaemonPid(state.projectDir, process.pid);
    state.daemonPid = undefined;
    try {
      await saveState(state);
    } catch {
      // best-effort cleanup save
    }
  }
}

async function cmdDaemon(stateFile: string): Promise<number> {
  loadConfigEnv();
  const state = await loadState(stateFile);
  await runDriverProcess(state);
  return 0;
}

async function cmdPause(args: string[]): Promise<number> {
  loadConfigEnv();
  const projectDir = resolveProjectDir(args);
  const state = await loadState(statePath(projectDir));
  if (state.workflowStatus === "completed") throw new Error(`workflow is already completed: ${state.proposalName}`);
  // Do not rewrite the daemon-owned JSON state from this CLI process. The
  // marker is authoritative and avoids clobbering a concurrent phase/log save.
  writePauseMarker(projectDir, true);
  console.log(`paused: ${state.proposalName} (phase counters preserved)`);
  return 0;
}

async function cmdContinue(args: string[]): Promise<number> {
  loadConfigEnv();
  const projectDir = resolveProjectDir(args);
  const state = await loadState(statePath(projectDir));
  if (state.workflowStatus === "completed") throw new Error(`workflow is already completed: ${state.proposalName}`);
  writePauseMarker(projectDir, false);
  console.log(`continue: ${state.proposalName}`);
  return 0;
}

// Re-launch the daemon after it exited (error/cap recovery). Loads the existing
// state, checks out the feature branch, and spawns the daemon; it resumes from
// state.currentPhaseIdx. `continue` alone cannot recover from a daemon exit
// because there is no running process to read the flag -- `resume` is required.
async function cmdResume(args: string[]): Promise<number> {
  loadConfigEnv();
  const projectDir = resolveProjectDir(args);
  const stateFile = statePath(projectDir);
  if (!existsSync(stateFile)) throw new Error("no existing opsx-workflow state; use 'start' for a new workflow");
  const state = await loadState(stateFile);
  if (state.workflowStatus === "completed") throw new Error(`workflow is already completed: ${state.proposalName}`);
  const runningPid = readDaemonPid(projectDir) ?? state.daemonPid;
  if (isProcessAlive(runningPid)) {
    throw new Error(`workflow daemon is already running (pid ${runningPid}); use continue rather than resume`);
  }
  // clear pause -- planner is explicitly choosing to resume
  state.paused = false;
  state.workflowStatus = "running";
  await saveState(state, { forcePaused: true });
  // check out the feature branch (the daemon expects to be on it)
  const cur = currentBranch(projectDir);
  if (cur !== state.branch) {
    requireGit(projectDir, ["checkout", state.branch]);
  }
  // Flush any uncommitted changes left by a crashed run before re-entering the
  // phase loop. Without this, orphaned implementer edits (from a daemon death
  // between implementer-edit and committer-commit) would make self-heal /
  // apply-resume's clean check permanently dirty, wasting sessions until the
  // cap fires and forcing the planner to clean up manually. Daemon state/log
  // files are gitignored and are never staged by `git add -A`.
  const dirtyOnResume = workingTreePorcelain(projectDir);
  if (dirtyOnResume.length > 0) {
    requireGit(projectDir, ["add", "-A"]);
    requireGit(projectDir, ["commit", "-m", "chore: flush uncommitted changes before opsx-workflow resume"]);
    console.log(`[opsx-workflow] flushed ${dirtyOnResume.length} uncommitted file(s) before resume: ${dirtyOnResume.map(porcelainPath).join(", ")}`);
  }
  const logFile = path.join(projectDir, "openspec", ".opsx-workflow.log");
  const daemonCmd = `exec bun "${import.meta.path}" --daemon "${stateFile}" >> "${logFile}" 2>&1`;
  const child = Bun.spawn(["sh", "-c", daemonCmd], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  child.unref();
  writeDaemonPid(projectDir, child.pid);
  const phaseId = PHASES[Math.min(state.currentPhaseIdx ?? 0, PHASES.length - 1)]?.id ?? "?";
  console.log(`opsx-workflow resumed: proposal=${state.proposalName} phase=${phaseId} (idx ${state.currentPhaseIdx ?? 0}) branch=${state.branch} pid=${child.pid}`);
  return 0;
}

async function cmdStatus(args: string[]): Promise<number> {
  loadConfigEnv();
  const projectDir = resolveProjectDir(args);
  const file = statePath(projectDir);
  if (!existsSync(file)) {
    console.log("no active opsx-workflow state in this project");
    return 1;
  }
  const state = await loadState(file);
  state.paused = pauseMarkerExists(projectDir);
  const effectiveStatus = state.paused && state.workflowStatus !== "completed" && state.workflowStatus !== "error"
    ? "paused"
    : state.workflowStatus ?? "unknown";
  const phaseId = state.workflowStatus === "completed"
    ? "completed"
    : PHASES[Math.min(state.currentPhaseIdx ?? 0, PHASES.length - 1)]?.id ?? "?";
  console.log(JSON.stringify({
    proposal: state.proposalName,
    phase: phaseId,
    phaseIdx: state.currentPhaseIdx ?? 0,
    branch: state.branch,
    workflowStatus: effectiveStatus,
    paused: state.paused,
    caps: state.caps,
    loopCounters: state.loopCounters,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    lastUpdated: state.lastUpdated,
    daemonPid: readDaemonPid(projectDir) ?? state.daemonPid,
    lastEvents: state.log.slice(-10),
  }, null, 2));
  return 0;
}

async function cmdLog(args: string[]): Promise<number> {
  const projectDir = resolveProjectDir(args);
  // Primary view: the daemon log file, which logEvent appends to on every
  // event (human-readable, always-current). This is what a self-healing session
  // tails to understand what the driver is doing.
  const logFile = path.join(projectDir, "openspec", ".opsx-workflow.log");
  if (existsSync(logFile)) {
    const txt = readFileSync(logFile, "utf8");
    const lines = txt.split("\n").filter(Boolean).slice(-200);
    if (lines.length > 0) {
      console.log(lines.join("\n"));
      return 0;
    }
  }
  // Fallback: pretty-print the structured event log from the state file. This
  // covers the rare case where the daemon log file is missing/empty (e.g. the
  // daemon hasn't started yet but a stale state file exists from a prior run).
  const stateFile = statePath(projectDir);
  if (existsSync(stateFile)) {
    try {
      const state = await loadState(stateFile);
      const events = state.log.slice(-200);
      if (events.length > 0) {
        for (const e of events) {
          console.log(e.detail ? `${e.ts}  ${e.event}: ${e.detail}` : `${e.ts}  ${e.event}`);
        }
        return 0;
      }
    } catch {
      // fall through
    }
  }
  console.log(`no opsx-workflow log found at ${logFile}`);
  return 1;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

export const __test__ = {
  uncheckedCount,
  checkboxCount,
  allTasksChecked,
  onlyCheckboxToggles,
  onlyCheckboxTogglesBetween,
  enforceLock,
  isPhaseClean,
  archivedProposalExists,
  changedFiles,
  parseStartArgs,
};

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "-h" || argv[0] === "--help") {
    printHelp();
    return 0;
  }
  const cmd = argv[0]!;
  const rest = argv.slice(1);
  switch (cmd) {
    case "start":
      return cmdStart(rest);
    case "resume":
      return cmdResume(rest);
    case "pause":
      return cmdPause(rest);
    case "continue":
      return cmdContinue(rest);
    case "status":
      return cmdStatus(rest);
    case "log":
      return cmdLog(rest);
    case "--daemon":
      if (!rest[0]) throw new Error("--daemon requires <state-file>");
      return cmdDaemon(rest[0]!);
    default:
      console.error(`unknown command: ${cmd}`);
      printHelp();
      return 1;
  }
}

const isMain = (() => {
  try {
    return (import.meta as { main?: boolean }).main === true;
  } catch {
    return false;
  }
})();

if (isMain) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      console.error("[opsx-workflow] fatal:", err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
