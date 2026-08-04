#!/usr/bin/env bun

// opsx-flow: planner-free OpenSpec workflow driver.
//
// Unlike opsx-workflow.ts, this driver has no planner session, room, or message
// bus.  It uses the OpenCode HTTP API for implementer lifecycle management and
// leaves all judgment calls to the Master through the local web UI.

import { appendFileSync, existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  OpenCodeClient,
  parseJsonc,
  type MessageWithParts,
  type ModelRef,
  type QuestionRequest,
  type SessionStatusInfo,
} from "../server/shared.ts";

// ---------------------------------------------------------------------------
// Constants and types
// ---------------------------------------------------------------------------

export type Caps = {
  selfHeal: number;
  apply: number;
  testFix: number;
  codeReviewFix: number;
};

export const DEFAULT_CAPS: Caps = {
  selfHeal: 3,
  apply: 5,
  testFix: 10,
  codeReviewFix: 7,
};

export type CapKey = keyof Caps;
export type Family = "self-heal" | "apply" | "finding" | "archive";

export type PhaseDef = {
  id: string;
  skill: string;
  family: Family;
  capKey: CapKey;
  agent: string;
  provider: string;
  model: string;
  variant: string;
  cap: number;
};

type BasePhase = Omit<PhaseDef, "agent" | "provider" | "model" | "variant" | "cap">;

export const PHASES: BasePhase[] = [
  { id: "review-proposal", skill: "openspec-review-proposal", family: "self-heal", capKey: "selfHeal" },
  { id: "apply", skill: "openspec-apply-change", family: "apply", capKey: "apply" },
  { id: "apply-resume", skill: "openspec-apply-resume", family: "self-heal", capKey: "selfHeal" },
  { id: "test", skill: "openspec-test", family: "finding", capKey: "testFix" },
  { id: "code-review", skill: "openspec-code-review", family: "finding", capKey: "codeReviewFix" },
  { id: "test-regression", skill: "openspec-test", family: "finding", capKey: "testFix" },
  { id: "align", skill: "openspec-align", family: "self-heal", capKey: "selfHeal" },
  { id: "archive", skill: "openspec-archive-change", family: "archive", capKey: "selfHeal" },
];

const DEFAULT_MODEL = {
  agent: "levi",
  provider: "deepseek",
  model: "deepseek-v4-flash",
  variant: "max",
};

const DEFAULT_MERGE_COMMITTER = { ...DEFAULT_MODEL };
const POLL_INTERVAL_MS = positiveEnvInt("OPSX_FLOW_POLL_INTERVAL_MS") ?? 5_000;
const IMPLEMENTER_IDLE_STALL_MS = positiveEnvInt("OPSX_FLOW_IDLE_STALL_MS") ?? 8 * 60_000;
const MAX_LOG_ENTRIES = 500;
const MAX_REPORT_LENGTH = 200_000;

const LOCKED_FILE_RULES: Partial<Record<string, { file: string; kind: "tasks" | "issues" }>> = {
  apply: { file: "tasks.md", kind: "tasks" },
  "apply-resume": { file: "tasks.md", kind: "tasks" },
  fix: { file: "issue.md", kind: "issues" },
};

type RawModelConfig = Partial<{
  agent: unknown;
  provider: unknown;
  model: unknown;
  variant: unknown;
  cap: unknown;
}>;

export type FlowConfig = {
  configPath: string;
  projectDir: string;
  proposalName: string;
  proposalDir: string;
  baseBranch: string;
  branch: string;
  branchProvided: boolean;
  fromStage: string;
  caps: Caps;
  phases: Record<string, RawModelConfig>;
  mergeCommitter: {
    agent: string;
    provider: string;
    model: string;
    variant: string;
  };
};

export type PauseReason = "question" | "cap-hit" | "merge-conflict" | "error" | null;
export type WorkflowStatus = "running" | "paused" | "awaiting-question" | "error" | "completed";

export type PendingQuestionState = {
  sessionId: string;
  phaseId: string;
  questionId?: string;
  since: string;
};

export type SessionRecord = {
  sessionId: string;
  phaseId: string;
  kind: "implementer" | "fix" | "merge-committer";
  runIdx: number;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "error";
  report?: string;
};

export type LogEntry = { ts: string; event: string; detail?: string };

export type FlowState = {
  proposalName: string;
  proposalDir: string;
  projectDir: string;
  configPath: string;
  branch: string;
  baseBranch: string;
  paused: boolean;
  pauseReason: PauseReason;
  caps: Caps;
  loopCounters: Record<string, number>;
  currentPhaseIdx: number;
  workflowStatus: WorkflowStatus;
  startedAt: string;
  completedAt: string | null;
  lastUpdated: string;
  daemonPid?: number;
  uiPid?: number;
  uiPort?: number;
  pendingQuestion: PendingQuestionState | null;
  baselineUntracked: string[];
  implementerSessions: SessionRecord[];
  log: LogEntry[];
};

type FileSnapshot = { existed: boolean; content: string } | null;
type SessionReport = { sessionId: string; text: string; messages: MessageWithParts[] };

class FlowPaused extends Error {
  constructor(readonly reason: Exclude<PauseReason, null>, message: string) {
    super(message);
    this.name = "FlowPaused";
  }
}

function positiveEnvInt(name: string): number | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function positiveInt(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${field} must be a positive integer`);
  return parsed;
}

// ---------------------------------------------------------------------------
// Paths, state, markers, and logging
// ---------------------------------------------------------------------------

export function statePath(projectDir: string): string {
  return path.join(projectDir, "openspec", ".opsx-flow-state.json");
}

export function pauseMarkerPath(projectDir: string): string {
  return path.join(projectDir, "openspec", ".opsx-flow-paused");
}

export function daemonPidPath(projectDir: string): string {
  return path.join(projectDir, "openspec", ".opsx-flow.pid");
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
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
}

function readPid(file: string): number | undefined {
  try {
    const pid = Number(readFileSync(file, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function readDaemonPid(projectDir: string): number | undefined {
  return readPid(daemonPidPath(projectDir));
}

function writeDaemonPid(projectDir: string, pid: number): void {
  writeFileSync(daemonPidPath(projectDir), `${pid}\n`, "utf8");
}

function removeDaemonPid(projectDir: string, expectedPid?: number): void {
  const current = readDaemonPid(projectDir);
  if (expectedPid && current && current !== expectedPid) return;
  try {
    unlinkSync(daemonPidPath(projectDir));
  } catch (error) {
    if ((error as { code?: string }).code !== "ENOENT") throw error;
  }
}

export async function loadState(file: string): Promise<FlowState> {
  const state = JSON.parse(await readFile(file, "utf8")) as FlowState;
  // State migrations are intentionally conservative.  These defaults make a
  // state file created by an early build resumable without hiding corruption.
  state.pauseReason ??= null;
  state.completedAt ??= null;
  state.pendingQuestion ??= null;
  state.implementerSessions ??= [];
  state.baselineUntracked ??= [];
  state.caps = { ...DEFAULT_CAPS, ...(state.caps ?? {}) };
  state.log ??= [];
  state.loopCounters ??= {};
  state.currentPhaseIdx ??= 0;
  state.workflowStatus ??= state.paused ? "paused" : "running";
  return state;
}

export async function saveState(state: FlowState, options: { forcePaused?: boolean } = {}): Promise<void> {
  if (options.forcePaused !== undefined) writePauseMarker(state.projectDir, options.forcePaused);
  state.paused = pauseMarkerExists(state.projectDir);
  if (state.workflowStatus !== "error" && state.workflowStatus !== "completed" && state.workflowStatus !== "awaiting-question") {
    state.workflowStatus = state.paused ? "paused" : "running";
  }
  state.lastUpdated = nowIso();
  const file = statePath(state.projectDir);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

export function logEvent(state: FlowState, event: string, detail?: string): void {
  const entry: LogEntry = { ts: nowIso(), event, ...(detail ? { detail } : {}) };
  state.log.push(entry);
  if (state.log.length > MAX_LOG_ENTRIES) state.log.splice(0, state.log.length - MAX_LOG_ENTRIES);
  state.lastUpdated = entry.ts;
  try {
    appendFileSync(
      path.join(state.projectDir, "openspec", ".opsx-flow.log"),
      `${entry.ts}  ${event}${detail ? `: ${detail}` : ""}\n`,
      "utf8",
    );
  } catch {
    // The structured state log remains available when the append-only view is
    // temporarily unavailable (for example while a project is being created).
  }
}

// ---------------------------------------------------------------------------
// JSONC config
// ---------------------------------------------------------------------------

function normalizeModelConfig(value: unknown, field: string): RawModelConfig {
  if (value === undefined) return {};
  if (!record(value)) throw new Error(`${field} must be an object`);
  const model = value as RawModelConfig;
  const normalized: RawModelConfig = {};
  for (const key of ["agent", "provider", "model", "variant"] as const) {
    if (model[key] !== undefined) normalized[key] = stringValue(model[key], `${field}.${key}`);
  }
  if (model.cap !== undefined) normalized.cap = positiveInt(model.cap, `${field}.cap`);
  return normalized;
}

function parseCaps(value: unknown): Caps {
  if (value === undefined) return { ...DEFAULT_CAPS };
  if (!record(value)) throw new Error("caps must be an object");
  return {
    selfHeal: value.selfHeal === undefined ? DEFAULT_CAPS.selfHeal : positiveInt(value.selfHeal, "caps.selfHeal"),
    apply: value.apply === undefined ? DEFAULT_CAPS.apply : positiveInt(value.apply, "caps.apply"),
    testFix: value.testFix === undefined ? DEFAULT_CAPS.testFix : positiveInt(value.testFix, "caps.testFix"),
    codeReviewFix: value.codeReviewFix === undefined ? DEFAULT_CAPS.codeReviewFix : positiveInt(value.codeReviewFix, "caps.codeReviewFix"),
  };
}

export async function loadFlowConfig(configFile: string): Promise<FlowConfig> {
  const configPath = path.resolve(configFile);
  let parsed: unknown;
  try {
    parsed = parseJsonc(await readFile(configPath, "utf8"));
  } catch (error) {
    throw new Error(`could not parse config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!record(parsed)) throw new Error(`config ${configPath} must contain a JSON object`);

  const projectDir = path.resolve(path.dirname(configPath), stringValue(parsed.projectDir, "projectDir"));
  const proposalName = stringValue(parsed.proposal, "proposal");
  if (proposalName.includes("/") || proposalName.includes("\\") || proposalName === "." || proposalName === "..") {
    throw new Error("proposal must be a change name, not a path");
  }
  const baseBranch = stringValue(parsed.baseBranch, "baseBranch");
  const branchProvided = parsed.branch !== undefined;
  const branch = branchProvided ? stringValue(parsed.branch, "branch") : `openspec/${proposalName}`;
  const fromStage = parsed.fromStage === undefined ? PHASES[0]!.id : stringValue(parsed.fromStage, "fromStage");
  if (!PHASES.some((phase) => phase.id === fromStage)) throw new Error(`unknown fromStage: ${fromStage}`);

  const rawPhases = parsed.phases === undefined ? {} : parsed.phases;
  if (!record(rawPhases)) throw new Error("phases must be an object");
  const phases: Record<string, RawModelConfig> = {};
  for (const [phaseId, value] of Object.entries(rawPhases)) {
    if (!PHASES.some((phase) => phase.id === phaseId)) throw new Error(`unknown phase override: ${phaseId}`);
    phases[phaseId] = normalizeModelConfig(value, `phases.${phaseId}`);
  }

  const rawMerge = normalizeModelConfig(parsed.mergeCommitter, "mergeCommitter");
  const mergeCommitter = {
    agent: typeof rawMerge.agent === "string" ? rawMerge.agent : DEFAULT_MERGE_COMMITTER.agent,
    provider: typeof rawMerge.provider === "string" ? rawMerge.provider : DEFAULT_MERGE_COMMITTER.provider,
    model: typeof rawMerge.model === "string" ? rawMerge.model : DEFAULT_MERGE_COMMITTER.model,
    variant: typeof rawMerge.variant === "string" ? rawMerge.variant : DEFAULT_MERGE_COMMITTER.variant,
  };

  return {
    configPath,
    projectDir,
    proposalName,
    proposalDir: path.join(projectDir, "openspec", "changes", proposalName),
    baseBranch,
    branch,
    branchProvided,
    fromStage,
    caps: parseCaps(parsed.caps),
    phases,
    mergeCommitter,
  };
}

export function resolvePhase(config: FlowConfig, phase: BasePhase): PhaseDef {
  const override = config.phases[phase.id] ?? {};
  return {
    ...phase,
    agent: typeof override.agent === "string" ? override.agent : DEFAULT_MODEL.agent,
    provider: typeof override.provider === "string" ? override.provider : DEFAULT_MODEL.provider,
    model: typeof override.model === "string" ? override.model : DEFAULT_MODEL.model,
    variant: typeof override.variant === "string" ? override.variant : DEFAULT_MODEL.variant,
    cap: typeof override.cap === "number" ? override.cap : config.caps[phase.capKey],
  };
}

export function phaseIndex(phaseId: string): number {
  const index = PHASES.findIndex((phase) => phase.id === phaseId);
  if (index < 0) throw new Error(`unknown phase: ${phaseId}`);
  return index;
}

function displayedPhase(currentPhaseIdx: number, workflowStatus: WorkflowStatus): string {
  if (workflowStatus === "completed") return "completed";
  if (currentPhaseIdx >= PHASES.length) return "merge";
  return PHASES[currentPhaseIdx]?.id ?? "?";
}

// ---------------------------------------------------------------------------
// Git helpers
// ---------------------------------------------------------------------------

export function git(projectDir: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("git", args, {
    cwd: projectDir,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export function requireGit(projectDir: string, args: string[]): string {
  const result = git(projectDir, args);
  if (!result.ok) throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim() || result.stdout.trim()}`);
  return result.stdout;
}

export function gitTopLevel(directory: string): string {
  const result = git(directory, ["rev-parse", "--show-toplevel"]);
  if (!result.ok) throw new Error(`not a git repository: ${directory}`);
  return path.resolve(result.stdout.trim());
}

export function currentBranch(projectDir: string): string {
  return requireGit(projectDir, ["rev-parse", "--abbrev-ref", "HEAD"]).trim();
}

export function workingTreePorcelain(projectDir: string): string[] {
  return requireGit(projectDir, ["status", "--porcelain"]).split("\n").filter(Boolean);
}

export function porcelainPath(line: string): string {
  const raw = line.replace(/^.{3}/, "").trim();
  const renameMarker = " -> ";
  return raw.includes(renameMarker) ? raw.slice(raw.lastIndexOf(renameMarker) + renameMarker.length) : raw;
}

export function changedFiles(projectDir: string): string[] {
  return workingTreePorcelain(projectDir).map(porcelainPath);
}

function trackedChangedFiles(projectDir: string): string[] {
  return requireGit(projectDir, ["diff", "HEAD", "--name-only"]).split("\n").filter(Boolean);
}

function currentUntrackedFiles(projectDir: string): string[] {
  return requireGit(projectDir, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
}

function newUntrackedFiles(state: FlowState): string[] {
  const baseline = new Set(state.baselineUntracked ?? []);
  return currentUntrackedFiles(state.projectDir).filter((file) => !baseline.has(file));
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

async function ensureGitignore(projectDir: string): Promise<void> {
  const file = path.join(projectDir, ".gitignore");
  const entries = [
    "openspec/.opsx-flow-state.json",
    "openspec/.opsx-flow-state.json.*.tmp",
    "openspec/.opsx-flow.log",
    "openspec/.opsx-flow-ui.log",
    "openspec/.opsx-flow-paused",
    "openspec/.opsx-flow.pid",
  ];
  const lines = existsSync(file) ? readFileSync(file, "utf8").split(/\r?\n/) : [];
  let changed = false;
  for (const entry of entries) {
    if (lines.some((line) => line.trim() === entry)) continue;
    if (!changed) {
      lines.push("", "# opsx-flow daemon state/log/control (do not commit)");
      changed = true;
    }
    lines.push(entry);
  }
  if (changed) await writeFile(file, `${lines.join("\n").replace(/\n+$/, "")}\n`, "utf8");
}

function commitGitignoreGuard(projectDir: string): void {
  if (!git(projectDir, ["status", "--porcelain", "--", ".gitignore"]).stdout.trim()) return;
  requireGit(projectDir, ["add", ".gitignore"]);
  requireGit(projectDir, ["commit", "-m", "chore: gitignore opsx-flow daemon state/log"]);
}

function commitWorkingTree(projectDir: string, message: string): boolean {
  const dirty = workingTreePorcelain(projectDir);
  if (dirty.length === 0) return false;
  requireGit(projectDir, ["add", "-A"]);
  requireGit(projectDir, ["commit", "-m", message]);
  return true;
}

// ---------------------------------------------------------------------------
// Checkbox and deterministic completion checks
// ---------------------------------------------------------------------------

export function uncheckedCount(file: string): number {
  if (!existsSync(file)) return 0;
  const matches = readFileSync(file, "utf8").match(/^\s*-\s*\[ \]/gm);
  return matches?.length ?? 0;
}

export function checkboxCount(file: string): number {
  if (!existsSync(file)) return 0;
  const matches = readFileSync(file, "utf8").match(/^\s*-\s*\[[ xX]\]/gm);
  return matches?.length ?? 0;
}

export function allTasksChecked(file: string): boolean {
  return existsSync(file) && checkboxCount(file) > 0 && uncheckedCount(file) === 0;
}

export function onlyCheckboxTogglesBetween(before: string, after: string): boolean {
  const normalize = (line: string) => line.replace(/^(\s*-\s*)\[[ xX]\](?=\s|$)/, "$1[~]");
  const left = before.replace(/\r\n/g, "\n").split("\n");
  const right = after.replace(/\r\n/g, "\n").split("\n");
  return left.length === right.length && left.every((line, index) => normalize(line) === normalize(right[index]!));
}

export function onlyCheckboxToggles(projectDir: string, file: string): boolean {
  if (!existsSync(file)) return false;
  const relative = path.relative(projectDir, file);
  const before = requireGit(projectDir, ["show", `HEAD:${relative}`]);
  return onlyCheckboxTogglesBetween(before, readFileSync(file, "utf8"));
}

function snapshotLockedFile(state: FlowState, phaseId: string): FileSnapshot {
  const rule = LOCKED_FILE_RULES[phaseId];
  if (!rule) return null;
  const file = path.join(state.proposalDir, rule.file);
  return existsSync(file) ? { existed: true, content: readFileSync(file, "utf8") } : { existed: false, content: "" };
}

export function enforceLock(state: FlowState, phaseId: string, before?: FileSnapshot): boolean {
  const rule = LOCKED_FILE_RULES[phaseId];
  if (!rule) return false;
  const file = path.join(state.proposalDir, rule.file);
  if (before !== undefined && before !== null) {
    const current = existsSync(file) ? readFileSync(file, "utf8") : undefined;
    if (current !== undefined && onlyCheckboxTogglesBetween(before.content, current)) return false;
    if (current === undefined && !before.existed) return false;
    try {
      requireGit(state.projectDir, ["reset", "--", path.relative(state.projectDir, file)]);
    } catch {
      // The file can be entirely untracked in a malformed proposal; restore it
      // directly below rather than turning enforcement into a fatal error.
    }
    if (before.existed) writeFileSync(file, before.content, "utf8");
    else if (existsSync(file)) unlinkSync(file);
    return true;
  }
  if (!existsSync(file)) return false;
  const expected = `openspec/changes/${state.proposalName}/${rule.file}`;
  if (!workingTreePorcelain(state.projectDir).some((line) => porcelainPath(line) === expected)) return false;
  if (onlyCheckboxToggles(state.projectDir, file)) return false;
  requireGit(state.projectDir, ["checkout", "HEAD", "--", path.relative(state.projectDir, file)]);
  return true;
}

function proposalArtifactFiles(state: FlowState): string[] {
  const prefix = `openspec/changes/${state.proposalName}/`;
  return changedFiles(state.projectDir).filter((file) => file.startsWith(prefix));
}

export function archivedProposalExists(state: FlowState): boolean {
  const root = path.join(state.projectDir, "openspec", "changes", "archive");
  if (!existsSync(root)) return false;
  const escaped = state.proposalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^(?:\\d{4}-\\d{2}-\\d{2}-|\\d{8}-)?${escaped}$`);
  return readdirSync(root, { withFileTypes: true }).some(
    (entry) => entry.isDirectory() && pattern.test(entry.name) && existsSync(path.join(root, entry.name, "proposal.md")),
  );
}

export function isPhaseClean(state: FlowState, phase: PhaseDef): boolean {
  const tasks = path.join(state.proposalDir, "tasks.md");
  const issue = path.join(state.proposalDir, "issue.md");
  switch (phase.family) {
    case "self-heal":
      return phase.id === "apply-resume"
        ? trackedChangedFiles(state.projectDir).length === 0 && newUntrackedFiles(state).length === 0
        : proposalArtifactFiles(state).length === 0;
    case "apply":
      return allTasksChecked(tasks);
    case "finding":
      return uncheckedCount(issue) === 0;
    case "archive":
      return !existsSync(state.proposalDir) && archivedProposalExists(state);
  }
}

// ---------------------------------------------------------------------------
// OpenCode raw-API lifecycle
// ---------------------------------------------------------------------------

const client = new OpenCodeClient();

function modelRef(provider: string, model: string): ModelRef {
  return { providerID: provider, modelID: model };
}

function assistantText(message: MessageWithParts): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n")
    .trim();
}

function lastAssistant(messages: MessageWithParts[]): MessageWithParts | undefined {
  return [...messages].reverse().find((message) => message.info.role === "assistant");
}

async function getSessionReport(sessionId: string, projectDir: string): Promise<SessionReport> {
  const messages = await client.sessionMessages(sessionId, { directory: projectDir });
  const last = lastAssistant(messages);
  return {
    sessionId,
    text: last ? assistantText(last) : "",
    messages,
  };
}

async function sessionStatus(sessionId: string): Promise<"idle" | "busy" | "retry" | "unknown"> {
  try {
    const statuses = await client.sessionStatus();
    const status: SessionStatusInfo | undefined = statuses[sessionId];
    if (!status) return "idle";
    if (status.type === "busy" || status.type === "retry" || status.type === "idle") return status.type;
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function pendingQuestion(sessionId: string): Promise<QuestionRequest | undefined> {
  const requests = await client.pendingQuestions();
  return requests.find((request) => request.sessionID === sessionId);
}

function lockedPromptNote(phaseId: string): string {
  const rule = LOCKED_FILE_RULES[phaseId];
  if (!rule) return "";
  return [
    "",
    "IMPORTANT LOCKED-FILE RULE:",
    `You may only toggle existing checkbox markers (- [ ] <-> - [x]) in ${rule.file}.`,
    `Do not edit, add, remove, reorder, or rewrite any other content in ${rule.file}.`,
    "If an item is infeasible, leave it unchecked and explain why in your report.",
    "Any non-checkbox edit will be reverted and this run will be retried.",
  ].join("\n");
}

function implementerPrompt(state: FlowState, phase: PhaseDef, runIdx: number): string {
  return [
    `Load the \`${phase.skill}\` skill and follow its instructions to work on the OpenSpec change.`,
    "",
    `Proposal: ${state.proposalName} (${state.proposalDir}).`,
    `Work in ${state.projectDir} on branch ${state.branch}.`,
    `This is run ${runIdx} of the ${phase.id} phase.`,
    lockedPromptNote(phase.id),
    "",
    "Do not commit changes; the workflow driver commits deterministic phase checkpoints.",
    "If a decision or external input blocks progress, use OpenCode's question tool and wait for the Master.",
    "When finished, give a concise final report describing the work and the current tasks.md/issue.md state.",
  ].join("\n");
}

function fixPrompt(state: FlowState, phase: PhaseDef, runIdx: number): string {
  return [
    "Load the `openspec-fix` skill and follow its instructions to resolve the unchecked issues for this OpenSpec change.",
    "",
    `Proposal: ${state.proposalName} (${state.proposalDir}).`,
    `The ${phase.id} finding phase left unchecked issues in ${path.join(state.proposalDir, "issue.md")}.`,
    `This is fix run ${runIdx}. Work in ${state.projectDir} on branch ${state.branch}.`,
    "",
    "You may only toggle existing issue.md checkbox markers from unchecked to checked.",
    "Do not rewrite issue descriptions, add issues, or alter unrelated issue.md content.",
    "Do not commit changes; the workflow driver commits deterministic checkpoints.",
    "If blocked, use OpenCode's question tool. Finish with a concise report of resolved issues.",
  ].join("\n");
}

function mergeCommitterPrompt(state: FlowState, diff: string, proposal: string): string {
  return [
    "You are the final merge-commit message writer for an OpenSpec workflow.",
    "",
    `Project: ${state.projectDir}`,
    `Proposal: ${state.proposalName}`,
    `Feature branch: ${state.branch}`,
    `Base branch: ${state.baseBranch}`,
    "",
    "Read the proposal and complete branch diff below. Return only a detailed, conventional Git commit message for the merge.",
    "The message should explain the user-visible change and important implementation/testing details.",
    "Do not edit files, commit, merge, push, or use the question tool.",
    "",
    "--- proposal.md ---",
    proposal || "(proposal.md is in the archived change or unavailable)",
    "",
    "--- git diff baseBranch...branch ---",
    diff || "(no diff)",
  ].join("\n");
}

async function spawnSession(
  state: FlowState,
  phaseId: string,
  kind: SessionRecord["kind"],
  runIdx: number,
  settings: { agent: string; provider: string; model: string; variant: string },
  prompt: string,
): Promise<SessionRecord> {
  const session = await client.createSpawnSession({
    title: `opsx-flow: ${state.proposalName}/${phaseId}`,
    directory: state.projectDir,
  });
  const record: SessionRecord = {
    sessionId: session.id,
    phaseId,
    kind,
    runIdx,
    startedAt: nowIso(),
    status: "running",
  };
  state.implementerSessions.push(record);
  await saveState(state);
  try {
    await client.promptAsync(session.id, {
      agent: settings.agent,
      model: modelRef(settings.provider, settings.model),
      variant: settings.variant,
      directory: state.projectDir,
      parts: [{ type: "text", text: prompt }],
    });
  } catch (error) {
    record.status = "error";
    record.completedAt = nowIso();
    await saveState(state);
    throw new Error(`failed to start ${kind} session ${session.id}: ${error instanceof Error ? error.message : String(error)}`);
  }
  logEvent(state, "session_spawned", `${kind} ${session.id} (${phaseId}, run ${runIdx})`);
  await saveState(state);
  return record;
}

async function markQuestionPaused(state: FlowState, phaseId: string, request: QuestionRequest): Promise<void> {
  const wasSame = state.pendingQuestion?.questionId === request.id;
  state.pendingQuestion = {
    sessionId: request.sessionID,
    phaseId,
    questionId: request.id,
    since: state.pendingQuestion?.since ?? nowIso(),
  };
  state.pauseReason = "question";
  state.workflowStatus = "awaiting-question";
  state.paused = true;
  writePauseMarker(state.projectDir, true);
  if (!wasSame) logEvent(state, "question_pending", `${phaseId}: ${request.id} from ${request.sessionID}`);
  await saveState(state);
}

async function clearQuestionPause(state: FlowState): Promise<void> {
  if (!state.pendingQuestion) return;
  const old = state.pendingQuestion;
  state.pendingQuestion = null;
  state.pauseReason = null;
  if (!pauseMarkerExists(state.projectDir)) state.workflowStatus = "running";
  logEvent(state, "question_cleared", `${old.phaseId}: ${old.questionId ?? old.sessionId}`);
  await saveState(state);
}

async function waitForSessionCompletion(state: FlowState, phaseId: string, session: SessionRecord): Promise<SessionReport> {
  let sawBusy = false;
  let idleSince = 0;
  let unknownSince = 0;
  for (;;) {
    await sleep(POLL_INTERVAL_MS);

    let request: QuestionRequest | undefined;
    try {
      request = await pendingQuestion(session.sessionId);
      unknownSince = 0;
    } catch (error) {
      if (!unknownSince) unknownSince = Date.now();
      if (Date.now() - unknownSince > IMPLEMENTER_IDLE_STALL_MS) {
        throw new Error(`question API unavailable while waiting for ${session.sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }

    // A question request takes precedence over idle status: OpenCode can report
    // a question-blocked session as absent from /session/status.
    if (request) {
      await markQuestionPaused(state, phaseId, request);
      continue;
    }
    await clearQuestionPause(state);

    if (pauseMarkerExists(state.projectDir)) {
      state.paused = true;
      if (state.workflowStatus !== "awaiting-question") state.workflowStatus = "paused";
      await saveState(state);
      continue;
    }

    const status = await sessionStatus(session.sessionId);
    if (status === "busy" || status === "retry") {
      sawBusy = true;
      idleSince = 0;
      continue;
    }
    if (status === "unknown") {
      if (!unknownSince) unknownSince = Date.now();
      if (Date.now() - unknownSince > IMPLEMENTER_IDLE_STALL_MS) {
        throw new Error(`OpenCode status API unavailable while waiting for ${session.sessionId}`);
      }
      continue;
    }
    unknownSince = 0;

    let report: SessionReport | undefined;
    try {
      report = await getSessionReport(session.sessionId, state.projectDir);
    } catch {
      // A just-finished session can briefly expose status before its messages;
      // keep polling instead of treating that race as completion.
      report = undefined;
    }
    if (status === "idle" && (sawBusy || Boolean(report?.messages.some((message) => message.info.role === "assistant")))) {
      const result = report ?? { sessionId: session.sessionId, text: "", messages: [] };
      session.status = "completed";
      session.completedAt = nowIso();
      session.report = result.text.slice(0, MAX_REPORT_LENGTH);
      await saveState(state);
      logEvent(state, "session_complete", `${session.sessionId} (${phaseId})`);
      await saveState(state);
      return result;
    }

    if (!idleSince) idleSince = Date.now();
    if (Date.now() - idleSince > IMPLEMENTER_IDLE_STALL_MS) {
      throw new Error(`session ${session.sessionId} is idle without a final report`);
    }
  }
}

async function waitForImplementerCompletion(state: FlowState, phaseId: string, session: SessionRecord): Promise<SessionReport> {
  return waitForSessionCompletion(state, phaseId, session);
}

async function spawnImplementer(state: FlowState, phase: PhaseDef, runIdx: number): Promise<SessionRecord> {
  return spawnSession(
    state,
    phase.id,
    "implementer",
    runIdx,
    phase,
    implementerPrompt(state, phase, runIdx),
  );
}

async function spawnAndWaitImplementer(state: FlowState, phase: PhaseDef, runIdx: number): Promise<SessionReport> {
  const session = await spawnImplementer(state, phase, runIdx);
  return waitForImplementerCompletion(state, phase.id, session);
}

async function spawnAndWaitFix(state: FlowState, phase: PhaseDef, runIdx: number): Promise<SessionReport> {
  const session = await spawnSession(
    state,
    `fix-${phase.id}`,
    "fix",
    runIdx,
    phase,
    fixPrompt(state, phase, runIdx),
  );
  return waitForSessionCompletion(state, `fix-${phase.id}`, session);
}

async function pauseAndStop(state: FlowState, reason: Exclude<PauseReason, null>, detail: string): Promise<never> {
  state.paused = true;
  state.pauseReason = reason;
  state.workflowStatus = "paused";
  writePauseMarker(state.projectDir, true);
  logEvent(state, "workflow_paused", `${reason}: ${detail}`);
  await saveState(state);
  throw new FlowPaused(reason, detail);
}

// ---------------------------------------------------------------------------
// Phase graph and direct git checkpoints
// ---------------------------------------------------------------------------

async function waitForExternalContinue(state: FlowState): Promise<void> {
  while (pauseMarkerExists(state.projectDir)) {
    state.paused = true;
    if (state.workflowStatus !== "awaiting-question") state.workflowStatus = "paused";
    await saveState(state);
    await sleep(POLL_INTERVAL_MS);
  }
  state.paused = false;
  if (state.workflowStatus !== "error" && state.workflowStatus !== "completed") state.workflowStatus = "running";
  await saveState(state);
}

async function enforceCap(state: FlowState, phase: PhaseDef, counterKey: string, detail: string): Promise<void> {
  const count = state.loopCounters[counterKey] ?? 0;
  if (count < phase.cap) return;
  logEvent(state, "cap_reached", `${detail} reached ${count}/${phase.cap}`);
  await pauseAndStop(state, "cap-hit", `${detail} reached ${count}/${phase.cap}; edit config or intervene, then resume`);
}

async function commitPhaseCheckpoint(state: FlowState, phaseId: string, runIdx: number, clean: boolean): Promise<void> {
  if (currentBranch(state.projectDir) !== state.branch) {
    throw new Error(`expected branch ${state.branch}, found ${currentBranch(state.projectDir)}`);
  }
  const message = `opsx-flow(${phaseId}) run ${runIdx}: ${clean ? "clean" : "looped"}`;
  const committed = commitWorkingTree(state.projectDir, message);
  logEvent(state, committed ? "checkpoint_commit" : "checkpoint_noop", `${message}${committed ? "" : " (nothing to commit)"}`);
  await saveState(state);
}

async function runFixLoop(state: FlowState, phase: PhaseDef): Promise<void> {
  const issueFile = path.join(state.proposalDir, "issue.md");
  const counterKey = `${phase.id}:fix`;
  state.loopCounters[counterKey] ??= 0;
  while (uncheckedCount(issueFile) > 0) {
    await enforceCap(state, phase, counterKey, `fix for ${phase.id}`);
    const beforeUnchecked = uncheckedCount(issueFile);
    const runIdx = (state.loopCounters[counterKey] ?? 0) + 1;
    const beforeLock = snapshotLockedFile(state, "fix");
    await spawnAndWaitFix(state, phase, runIdx);
    state.loopCounters[counterKey] = runIdx;
    await waitForExternalContinue(state);

    if (enforceLock(state, "fix", beforeLock)) {
      logEvent(state, "enforcement_revert", `fix for ${phase.id} changed issue.md content; retrying without commit`);
      await saveState(state);
      continue;
    }
    const afterUnchecked = uncheckedCount(issueFile);
    if (afterUnchecked >= beforeUnchecked) {
      logEvent(state, "fix_no_progress", `fix for ${phase.id} resolved no issue boxes; retrying without commit`);
      await saveState(state);
      continue;
    }
    await commitPhaseCheckpoint(state, `fix-${phase.id}`, runIdx, afterUnchecked === 0);
  }
  state.loopCounters[counterKey] = 0;
  await saveState(state);
}

async function runPhaseLoop(state: FlowState, phase: PhaseDef): Promise<void> {
  state.loopCounters[phase.id] ??= 0;
  for (;;) {
    await waitForExternalContinue(state);
    await enforceCap(state, phase, phase.id, `phase ${phase.id}`);
    const runIdx = (state.loopCounters[phase.id] ?? 0) + 1;
    const beforeLock = snapshotLockedFile(state, phase.id);
    logEvent(state, "phase_run", `${phase.id} run ${runIdx}`);
    await saveState(state);
    await spawnAndWaitImplementer(state, phase, runIdx);
    await waitForExternalContinue(state);

    if (enforceLock(state, phase.id, beforeLock)) {
      state.loopCounters[phase.id] = runIdx;
      logEvent(state, "enforcement_revert", `${phase.id} modified locked-file content; retrying without commit`);
      await saveState(state);
      continue;
    }

    const clean = isPhaseClean(state, phase);
    await commitPhaseCheckpoint(state, phase.id, runIdx, clean);

    if (phase.family === "finding" && !clean) {
      state.loopCounters[phase.id] = runIdx;
      await saveState(state);
      await runFixLoop(state, phase);
      continue;
    }
    if (!clean) {
      state.loopCounters[phase.id] = runIdx;
      await saveState(state);
      continue;
    }

    logEvent(state, "phase_complete", `${phase.id} clean on run ${runIdx}`);
    state.loopCounters[phase.id] = 0;
    await saveState(state);
    return;
  }
}

function archivedProposalFile(state: FlowState): string | undefined {
  if (existsSync(path.join(state.proposalDir, "proposal.md"))) return path.join(state.proposalDir, "proposal.md");
  const root = path.join(state.projectDir, "openspec", "changes", "archive");
  if (!existsSync(root)) return undefined;
  const escaped = state.proposalName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^(?:\\d{4}-\\d{2}-\\d{2}-|\\d{8}-)?${escaped}$`);
  const entry = readdirSync(root, { withFileTypes: true }).find(
    (candidate) => candidate.isDirectory() && pattern.test(candidate.name) && existsSync(path.join(root, candidate.name, "proposal.md")),
  );
  return entry ? path.join(root, entry.name, "proposal.md") : undefined;
}

function normalizeMergeMessage(text: string, proposalName: string): string {
  const clean = text.replace(/\u0000/g, "").trim().replace(/^```(?:text|gitcommit|markdown)?\s*/i, "").replace(/\s*```$/, "").trim();
  return (clean || `merge: OpenSpec ${proposalName} (opsx-flow)`).slice(0, 20_000);
}

async function mergeAndFinish(state: FlowState, config: FlowConfig): Promise<void> {
  if (currentBranch(state.projectDir) !== state.branch) {
    throw new Error(`cannot merge while not on feature branch ${state.branch}`);
  }
  const dirty = workingTreePorcelain(state.projectDir);
  if (dirty.length > 0) throw new Error(`cannot merge with uncommitted changes: ${dirty.join(" | ")}`);
  const diff = requireGit(state.projectDir, ["diff", `${state.baseBranch}...${state.branch}`]);
  const proposalFile = archivedProposalFile(state);
  const proposal = proposalFile ? readFileSync(proposalFile, "utf8") : "";
  const prompt = mergeCommitterPrompt(state, diff, proposal);
  const session = await spawnSession(state, "merge", "merge-committer", 1, config.mergeCommitter, prompt);
  const report = await waitForSessionCompletion(state, "merge", session);
  if (currentBranch(state.projectDir) !== state.branch) {
    throw new Error(`merge committer left repository on ${currentBranch(state.projectDir)}; expected ${state.branch}`);
  }
  const committerChanges = workingTreePorcelain(state.projectDir);
  if (committerChanges.length > 0) {
    throw new Error(`merge committer modified the worktree: ${committerChanges.join(" | ")}`);
  }
  const message = normalizeMergeMessage(report.text, state.proposalName);

  logEvent(state, "merge_start", `${state.branch} -> ${state.baseBranch}`);
  requireGit(state.projectDir, ["checkout", state.baseBranch]);
  const merged = git(state.projectDir, ["merge", "--no-ff", state.branch, "-m", message]);
  if (!merged.ok) {
    try { requireGit(state.projectDir, ["merge", "--abort"]); } catch { /* already aborted or not a merge */ }
    try { requireGit(state.projectDir, ["checkout", state.branch]); } catch { /* preserve the diagnostic below */ }
    await pauseAndStop(state, "merge-conflict", `merge ${state.branch} into ${state.baseBranch} failed: ${merged.stderr.trim() || merged.stdout.trim()}`);
  }
  logEvent(state, "merged_local", `${state.branch} merged into ${state.baseBranch}; branch preserved and nothing pushed`);
  await saveState(state);
}

async function driverLoop(state: FlowState, config: FlowConfig): Promise<void> {
  for (let index = Math.max(0, state.currentPhaseIdx); index < PHASES.length; index++) {
    state.currentPhaseIdx = index;
    const phase = resolvePhase(config, PHASES[index]!);
    logEvent(state, "phase_start", phase.id);
    await saveState(state);
    await runPhaseLoop(state, phase);
    state.currentPhaseIdx = index + 1;
    await saveState(state);
  }

  await mergeAndFinish(state, config);
  state.workflowStatus = "completed";
  state.paused = false;
  state.pauseReason = null;
  state.currentPhaseIdx = PHASES.length;
  state.completedAt = nowIso();
  writePauseMarker(state.projectDir, false);
  logEvent(state, "workflow_complete", state.proposalName);
  await saveState(state);
}

// ---------------------------------------------------------------------------
// Startup, daemon, and resume lifecycle
// ---------------------------------------------------------------------------

function localBranchExists(projectDir: string, branch: string): boolean {
  return git(projectDir, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]).ok;
}

function validateProposal(config: FlowConfig): void {
  if (!existsSync(config.projectDir)) throw new Error(`projectDir does not exist: ${config.projectDir}`);
  if (!existsSync(path.join(config.proposalDir, "proposal.md"))) {
    throw new Error(`proposal.md not found: ${path.join(config.proposalDir, "proposal.md")}`);
  }
  if (!existsSync(path.join(config.proposalDir, "tasks.md"))) {
    throw new Error(`tasks.md not found: ${path.join(config.proposalDir, "tasks.md")}`);
  }
  if (checkboxCount(path.join(config.proposalDir, "tasks.md")) === 0) {
    throw new Error(`tasks.md has no task checkboxes: ${path.join(config.proposalDir, "tasks.md")}`);
  }
}

function validateStartWorktree(projectDir: string, proposalName: string): void {
  const prefix = `openspec/changes/${proposalName}/`;
  const unrelated = changedFiles(projectDir).filter((file) => !file.startsWith(prefix));
  if (unrelated.length > 0) {
    throw new Error(`workflow start requires a clean worktree outside this proposal: ${unrelated.join(", ")}`);
  }
}

function prepareGit(config: FlowConfig): string {
  const projectDir = gitTopLevel(config.projectDir);
  if (projectDir !== path.resolve(config.projectDir)) {
    throw new Error(`projectDir must be the git toplevel: ${config.projectDir} (expected ${projectDir})`);
  }
  if (!git(projectDir, ["check-ref-format", "--branch", config.branch]).ok) {
    throw new Error(`invalid workflow branch name: ${config.branch}`);
  }
  if (!git(projectDir, ["rev-parse", "--verify", `refs/heads/${config.baseBranch}`]).ok) {
    throw new Error(`baseBranch does not exist locally: ${config.baseBranch}`);
  }
  if (config.baseBranch === config.branch) throw new Error("branch and baseBranch must be different");

  const current = currentBranch(projectDir);
  if (!config.branchProvided) {
    // An omitted branch is a request to create the conventional branch from
    // baseBranch.  Checkout is safe only after the current worktree is clean;
    // otherwise the caller could lose manual changes while changing branches.
    if (current !== config.baseBranch) {
      const currentDirty = workingTreePorcelain(projectDir);
      if (currentDirty.length > 0) {
        throw new Error(`cannot checkout baseBranch ${config.baseBranch} with dirty worktree: ${currentDirty.join(" | ")}`);
      }
      requireGit(projectDir, ["checkout", config.baseBranch]);
    }
    const dirty = workingTreePorcelain(projectDir);
    if (dirty.length > 0) throw new Error(`baseBranch must be clean before starting: ${dirty.join(" | ")}`);
    if (localBranchExists(projectDir, config.branch)) {
      throw new Error(`default workflow branch already exists: ${config.branch}; resume the prior workflow or remove it deliberately`);
    }
    requireGit(projectDir, ["checkout", "-b", config.branch]);
  } else if (current === config.baseBranch) {
    const dirty = workingTreePorcelain(projectDir);
    if (dirty.length > 0) throw new Error(`baseBranch must be clean before starting: ${dirty.join(" | ")}`);
    if (!localBranchExists(projectDir, config.branch)) throw new Error(`configured branch does not exist: ${config.branch}`);
    requireGit(projectDir, ["checkout", config.branch]);
  } else if (current !== config.branch) {
    const expectation = config.branchProvided
      ? `baseBranch ${config.baseBranch} or branch ${config.branch}`
      : `baseBranch ${config.baseBranch}`;
    throw new Error(`workflow must start on ${expectation}; current branch is ${current}`);
  }
  validateStartWorktree(projectDir, config.proposalName);
  return projectDir;
}

function configMatchesState(config: FlowConfig, state: FlowState): void {
  if (path.resolve(config.projectDir) !== path.resolve(state.projectDir)) throw new Error("config projectDir differs from workflow state");
  if (config.proposalName !== state.proposalName) throw new Error("config proposal differs from workflow state");
  if (config.baseBranch !== state.baseBranch) throw new Error("config baseBranch differs from workflow state");
  if (config.branch !== state.branch) throw new Error("config branch differs from workflow state");
}

function createInitialState(config: FlowConfig): FlowState {
  return {
    proposalName: config.proposalName,
    proposalDir: config.proposalDir,
    projectDir: config.projectDir,
    configPath: config.configPath,
    branch: config.branch,
    baseBranch: config.baseBranch,
    paused: false,
    pauseReason: null,
    caps: { ...config.caps },
    loopCounters: {},
    currentPhaseIdx: phaseIndex(config.fromStage),
    workflowStatus: "running",
    startedAt: nowIso(),
    completedAt: null,
    lastUpdated: nowIso(),
    pendingQuestion: null,
    baselineUntracked: [],
    implementerSessions: [],
    log: [],
  };
}

function launchDaemon(projectDir: string, stateFile: string): number {
  const child = Bun.spawn(["bun", import.meta.path, "--daemon", stateFile], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  child.unref();
  writeDaemonPid(projectDir, child.pid);
  return child.pid;
}

function launchUi(projectDir: string, port: number): number {
  const child = Bun.spawn(["bun", import.meta.path, "ui", "--project-dir", projectDir, "--port", String(port)], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  child.unref();
  return child.pid;
}

async function runDriverProcess(state: FlowState): Promise<WorkflowStatus> {
  state.daemonPid = process.pid;
  writeDaemonPid(state.projectDir, process.pid);
  try {
    const config = await loadFlowConfig(state.configPath);
    configMatchesState(config, state);
    state.workflowStatus = "running";
    await saveState(state);
    await driverLoop(state, config);
  } catch (error) {
    if (error instanceof FlowPaused) {
      // Cap hits and merge conflicts are controlled pauses, not driver errors.
      state.workflowStatus = "paused";
      state.paused = true;
      await saveState(state).catch(() => undefined);
    } else {
      const message = error instanceof Error ? error.message : String(error);
      logEvent(state, "driver_error", message);
      state.workflowStatus = "error";
      state.pauseReason = "error";
      state.paused = true;
      writePauseMarker(state.projectDir, true);
      await saveState(state).catch(() => undefined);
    }
  } finally {
    removeDaemonPid(state.projectDir, process.pid);
    state.daemonPid = undefined;
    await saveState(state).catch(() => undefined);
  }
  return state.workflowStatus;
}

function parseBooleanFlag(args: string[], flag: string): boolean {
  return args.includes(flag) || args.some((arg) => arg === `${flag}=true`);
}

function valueFlag(args: string[], flag: string): string | undefined {
  const prefix = `${flag}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag) || args.some((arg) => arg.startsWith(`${flag}=`));
}

function rejectUnknownFlags(args: string[], allowed: Set<string>): void {
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const flag = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (!allowed.has(flag)) throw new Error(`unknown option: ${arg}`);
  }
}

type StartOptions = { configPath: string; noUi: boolean; foreground: boolean; uiPort: number };

function parseStartArgs(args: string[]): StartOptions {
  rejectUnknownFlags(args, new Set(["--no-ui", "--foreground", "--ui-port"]));
  const positionals: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--ui-port") {
      if (!args[index + 1] || args[index + 1]!.startsWith("--")) throw new Error("--ui-port requires a value");
      index++;
    } else if (!arg.startsWith("--")) {
      positionals.push(arg);
    }
  }
  if (positionals.length !== 1) throw new Error("start requires <config.jsonc>");
  const portRaw = valueFlag(args, "--ui-port");
  if (args.includes("--ui-port=") || (args.includes("--ui-port") && portRaw === undefined)) throw new Error("--ui-port requires a value");
  const uiPort = portRaw === undefined ? 4321 : positiveInt(portRaw, "--ui-port");
  if (uiPort > 65535) throw new Error("--ui-port must be between 1 and 65535");
  return {
    configPath: path.resolve(positionals[0]!),
    noUi: parseBooleanFlag(args, "--no-ui"),
    foreground: parseBooleanFlag(args, "--foreground"),
    uiPort,
  };
}

function resolveProjectDir(args: string[]): string {
  if (hasFlag(args, "--project-dir")) {
    const value = valueFlag(args, "--project-dir");
    if (!value || value.startsWith("--")) throw new Error("--project-dir requires a value");
    return path.resolve(value);
  }
  return gitTopLevel(process.cwd());
}

function parseNextPhase(args: string[]): string | undefined {
  if (!hasFlag(args, "--next-phase")) return undefined;
  const value = valueFlag(args, "--next-phase");
  if (!value || value.startsWith("--")) throw new Error("--next-phase requires a value");
  phaseIndex(value);
  return value;
}

async function cmdStart(args: string[]): Promise<number> {
  const options = parseStartArgs(args);
  const config = await loadFlowConfig(options.configPath);
  validateProposal(config);
  const configuredProjectDir = gitTopLevel(config.projectDir);
  const stateFile = statePath(configuredProjectDir);
  if (existsSync(stateFile)) {
    const existing = await loadState(stateFile);
    const running = isProcessAlive(readDaemonPid(configuredProjectDir) ?? existing.daemonPid);
    throw new Error(
      `existing opsx-flow state for ${existing.proposalName} is ${existing.workflowStatus}; ` +
      `${running ? "the daemon is still running" : "resume it or remove the stale state deliberately"}`,
    );
  }
  const projectDir = prepareGit(config);

  await ensureGitignore(projectDir);
  commitGitignoreGuard(projectDir);
  const state = createInitialState({ ...config, projectDir, proposalDir: path.join(projectDir, "openspec", "changes", config.proposalName) });
  if (!options.noUi) state.uiPort = options.uiPort;
  state.baselineUntracked = currentUntrackedFiles(projectDir);
  writePauseMarker(projectDir, false);
  logEvent(state, "workflow_start", `${state.proposalName} on ${state.branch} from ${state.baseBranch}`);
  await saveState(state);

  if (!options.noUi) {
    state.uiPid = launchUi(projectDir, options.uiPort);
    await saveState(state);
  }
  if (options.foreground) {
    const status = await runDriverProcess(state);
    return status === "error" ? 1 : 0;
  }
  const daemonPid = launchDaemon(projectDir, stateFile);
  console.log(`opsx-flow started: proposal=${state.proposalName} branch=${state.branch} pid=${daemonPid}`);
  console.log(`state: ${stateFile}`);
  console.log(`log:   ${path.join(projectDir, "openspec", ".opsx-flow.log")}`);
  if (!options.noUi) console.log(`ui:    http://127.0.0.1:${options.uiPort}/`);
  return 0;
}

async function cmdDaemon(stateFile: string): Promise<number> {
  const state = await loadState(path.resolve(stateFile));
  await runDriverProcess(state);
  return 0;
}

async function cmdPause(args: string[]): Promise<number> {
  rejectUnknownFlags(args, new Set(["--project-dir"]));
  const projectDir = resolveProjectDir(args);
  const state = await loadState(statePath(projectDir));
  if (state.workflowStatus === "completed") throw new Error(`workflow is already completed: ${state.proposalName}`);
  writePauseMarker(projectDir, true);
  console.log(`paused: ${state.proposalName}`);
  return 0;
}

async function cmdContinue(args: string[]): Promise<number> {
  rejectUnknownFlags(args, new Set(["--project-dir"]));
  const projectDir = resolveProjectDir(args);
  const state = await loadState(statePath(projectDir));
  if (state.workflowStatus === "completed") throw new Error(`workflow is already completed: ${state.proposalName}`);
  writePauseMarker(projectDir, false);
  console.log(`continue: ${state.proposalName}`);
  return 0;
}

async function flushResumeWorktree(projectDir: string): Promise<void> {
  const dirty = workingTreePorcelain(projectDir);
  if (dirty.length === 0) return;
  commitWorkingTree(projectDir, "opsx-flow(resume): flush manual changes");
  console.log(`flushed ${dirty.length} manual change(s) before resume`);
}

async function resumeFlow(projectDir: string, nextPhaseId?: string): Promise<{ state: FlowState; pid: number }> {
  const stateFile = statePath(projectDir);
  if (!existsSync(stateFile)) throw new Error("no existing opsx-flow state; use start for a new workflow");
  const state = await loadState(stateFile);
  if (state.workflowStatus === "completed") throw new Error(`workflow is already completed: ${state.proposalName}`);
  const runningPid = readDaemonPid(projectDir) ?? state.daemonPid;
  if (isProcessAlive(runningPid)) throw new Error(`workflow daemon is already running (pid ${runningPid}); use continue instead`);

  const config = await loadFlowConfig(state.configPath);
  configMatchesState(config, state);
  const requestedPhaseIdx = nextPhaseId === undefined ? undefined : phaseIndex(nextPhaseId);
  if (requestedPhaseIdx !== undefined && requestedPhaseIdx < state.currentPhaseIdx) {
    throw new Error(
      `resume --next-phase cannot move backward from ${displayedPhase(state.currentPhaseIdx, state.workflowStatus)} to ${nextPhaseId}`,
    );
  }
  state.caps = { ...config.caps };
  if (currentBranch(projectDir) !== state.branch) {
    if (workingTreePorcelain(projectDir).length > 0) {
      throw new Error(`cannot checkout ${state.branch} with dirty worktree; clean the current branch first`);
    }
    requireGit(projectDir, ["checkout", state.branch]);
  }
  await flushResumeWorktree(projectDir);

  if (nextPhaseId !== undefined && requestedPhaseIdx !== undefined) {
    state.currentPhaseIdx = requestedPhaseIdx;
    state.loopCounters = {};
    logEvent(state, "force_advance", `resume --next-phase ${nextPhaseId}`);
  }
  state.pendingQuestion = null;
  state.pauseReason = null;
  state.workflowStatus = "running";
  state.paused = false;
  writePauseMarker(projectDir, false);
  if (state.uiPort && !isProcessAlive(state.uiPid)) {
    state.uiPid = launchUi(projectDir, state.uiPort);
  }
  await saveState(state);
  const pid = launchDaemon(projectDir, stateFile);
  return { state, pid };
}

async function cmdResume(args: string[]): Promise<number> {
  rejectUnknownFlags(args, new Set(["--project-dir", "--next-phase"]));
  const projectDir = resolveProjectDir(args);
  const nextPhase = parseNextPhase(args);
  const result = await resumeFlow(projectDir, nextPhase);
  const phase = displayedPhase(result.state.currentPhaseIdx, result.state.workflowStatus);
  console.log(`opsx-flow resumed: proposal=${result.state.proposalName} phase=${phase} pid=${result.pid}`);
  return 0;
}

async function cmdStatus(args: string[]): Promise<number> {
  rejectUnknownFlags(args, new Set(["--project-dir"]));
  const projectDir = resolveProjectDir(args);
  const file = statePath(projectDir);
  if (!existsSync(file)) {
    console.log("no active opsx-flow state in this project");
    return 1;
  }
  const state = await loadState(file);
  const paused = pauseMarkerExists(projectDir);
  const phase = displayedPhase(state.currentPhaseIdx, state.workflowStatus);
  console.log(JSON.stringify({
    ...state,
    phase,
    daemonAlive: isProcessAlive(readDaemonPid(projectDir) ?? state.daemonPid),
    uiAlive: isProcessAlive(state.uiPid),
    paused,
    workflowStatus: paused && state.workflowStatus !== "completed" && state.workflowStatus !== "error" ? (state.workflowStatus === "awaiting-question" ? "awaiting-question" : "paused") : state.workflowStatus,
  }, null, 2));
  return 0;
}

async function cmdLog(args: string[]): Promise<number> {
  rejectUnknownFlags(args, new Set(["--project-dir"]));
  const projectDir = resolveProjectDir(args);
  const file = path.join(projectDir, "openspec", ".opsx-flow.log");
  if (existsSync(file)) {
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean).slice(-200);
    if (lines.length > 0) {
      console.log(lines.join("\n"));
      return 0;
    }
  }
  const stateFile = statePath(projectDir);
  if (existsSync(stateFile)) {
    const state = await loadState(stateFile);
    for (const entry of state.log.slice(-200)) console.log(`${entry.ts}  ${entry.event}${entry.detail ? `: ${entry.detail}` : ""}`);
    return state.log.length > 0 ? 0 : 1;
  }
  console.log(`no opsx-flow log found at ${file}`);
  return 1;
}

// ---------------------------------------------------------------------------
// Local web UI
// ---------------------------------------------------------------------------

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function requestJson(request: Request): Promise<Record<string, unknown>> {
  const body = await request.text();
  if (!body.trim()) return {};
  const parsed: unknown = JSON.parse(body);
  if (!record(parsed)) throw new Error("request body must be a JSON object");
  return parsed;
}

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function resolveUiProject(defaultProjectDir: string, url: URL): string {
  const requested = url.searchParams.get("projectDir");
  if (!requested) return defaultProjectDir;
  const projectDir = path.resolve(requested);
  if (!existsSync(statePath(projectDir))) {
    throw new Error(`no opsx-flow state for ${projectDir}`);
  }
  return projectDir;
}

function shellArg(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value)
    ? value
    : `'${value.replace(/'/g, "'\\''")}'`;
}

async function apiState(projectDir: string): Promise<Record<string, unknown>> {
  const file = statePath(projectDir);
  if (!existsSync(file)) throw new Error(`no opsx-flow state for ${projectDir}`);
  const state = await loadState(file);
  const config = await loadFlowConfig(state.configPath).catch(() => undefined);
  const paused = pauseMarkerExists(projectDir);
  const phases = PHASES.map((base, index) => {
    const phase = config ? resolvePhase(config, base) : { ...base, ...DEFAULT_MODEL, cap: state.caps[base.capKey] };
    return {
      id: phase.id,
      skill: phase.skill,
      family: phase.family,
      cap: phase.cap,
      loopCounter: state.loopCounters[phase.id] ?? 0,
      current: index === state.currentPhaseIdx,
      complete: index < state.currentPhaseIdx || state.workflowStatus === "completed",
    };
  });
  return {
    ...state,
    proposal: state.proposalName,
    phase: displayedPhase(state.currentPhaseIdx, state.workflowStatus),
    phases,
    paused,
    workflowStatus: paused && state.workflowStatus !== "completed" && state.workflowStatus !== "error"
      ? (state.workflowStatus === "awaiting-question" ? "awaiting-question" : "paused")
      : state.workflowStatus,
    daemonAlive: isProcessAlive(readDaemonPid(projectDir) ?? state.daemonPid),
    uiAlive: isProcessAlive(state.uiPid),
  };
}

async function apiLog(projectDir: string, since?: string): Promise<{ entries: LogEntry[]; text: string }> {
  const file = path.join(projectDir, "openspec", ".opsx-flow.log");
  let lines: string[] = [];
  if (existsSync(file)) lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  if (since) lines = lines.filter((line) => line.slice(0, 24) > since);
  lines = lines.slice(-500);
  const entries: LogEntry[] = lines.map((line) => {
    const match = line.match(/^(\S+)\s{2}(\S+)(?::\s(.*))?$/);
    return match ? { ts: match[1]!, event: match[2]!, ...(match[3] ? { detail: match[3] } : {}) } : { ts: "", event: line };
  });
  return { entries, text: lines.join("\n") };
}

async function apiQuestions(projectDir: string): Promise<unknown[]> {
  const stateFile = statePath(projectDir);
  if (!existsSync(stateFile)) return [];
  const state = await loadState(stateFile);
  const sessionIds = new Set(state.implementerSessions.map((session) => session.sessionId));
  const requests = await client.pendingQuestions();
  return requests
    .filter((request) => sessionIds.has(request.sessionID))
    .map((request) => ({
      ...request,
      phaseId: state.implementerSessions.find((session) => session.sessionId === request.sessionID)?.phaseId,
      openCommand: `opencode --directory ${shellArg(projectDir)} --resume ${shellArg(request.sessionID)}`,
    }));
}

function knownProjectDirs(projectDir: string): string[] {
  const projects = new Set([projectDir]);
  const parent = path.dirname(projectDir);
  try {
    for (const entry of readdirSync(parent, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(parent, entry.name);
      if (existsSync(statePath(candidate))) projects.add(candidate);
    }
  } catch {
    // The attached project is always a valid fallback.
  }
  return [...projects].sort();
}

async function apiReport(projectDir: string, sessionId: string): Promise<{ sessionId: string; text: string }> {
  const state = await loadState(statePath(projectDir));
  if (!state.implementerSessions.some((session) => session.sessionId === sessionId)) {
    throw new Error("session is not part of this workflow");
  }
  const report = await getSessionReport(sessionId, projectDir);
  return { sessionId, text: report.text };
}

function uiHtml(projectDir: string, port: number): string {
  const projectJson = JSON.stringify(projectDir).replace(/</g, "\\u003c");
  const projectValue = htmlEscape(projectDir);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>opsx-flow</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, sans-serif; background: #101318; color: #e8edf5; }
    body { margin: 0; padding: 24px; max-width: 1280px; margin-inline: auto; }
    h1 { margin: 0 0 4px; font-size: 24px; }
    h2 { font-size: 16px; margin: 0 0 10px; }
    .muted { color: #9ba6b7; font-size: 13px; }
    .panel { border: 1px solid #2c3543; border-radius: 9px; padding: 16px; margin: 14px 0; background: #171c24; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    button, select, input { border: 1px solid #3d4a5d; border-radius: 5px; background: #202938; color: inherit; padding: 7px 9px; }
    button { cursor: pointer; } button:hover { border-color: #86aef8; }
    .status { display: inline-block; border-radius: 999px; padding: 4px 9px; font-size: 12px; background: #26364d; }
    .status.paused, .status.awaiting-question { background: #6a4b1f; }
    .status.completed { background: #245c42; }
    .timeline { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
    .phase { padding: 10px; border: 1px solid #2c3543; border-radius: 6px; opacity: .72; }
    .phase.current { border-color: #80a9ff; opacity: 1; box-shadow: 0 0 0 1px #80a9ff44; }
    .phase.complete { border-color: #397354; opacity: 1; }
    .phase-name { font-weight: 600; font-size: 13px; } .phase-meta { margin-top: 4px; font-size: 12px; color: #9ba6b7; }
    .question { border-left: 3px solid #e0a544; padding: 10px 12px; margin: 8px 0; background: #20242d; }
    .question h3 { font-size: 14px; margin: 0 0 6px; } .question p { white-space: pre-wrap; }
    code, pre { font-family: ui-monospace, monospace; } pre { overflow: auto; white-space: pre-wrap; background: #0c0f13; padding: 12px; border-radius: 5px; max-height: 360px; }
    .error { color: #ff9e9e; } .success { color: #9ae6b4; }
    #events { max-height: 300px; overflow: auto; }
    .event { font: 12px ui-monospace, monospace; padding: 3px 0; border-bottom: 1px solid #232a35; }
  </style>
</head>
<body>
  <header>
    <h1>opsx-flow</h1>
    <div class="muted">Planner-free OpenSpec workflow · UI port ${port}</div>
  </header>
  <section class="panel">
    <div class="toolbar">
      <label for="project-picker">Project</label>
      <input id="project-picker" list="known-projects" size="60" value="${projectValue}">
      <datalist id="known-projects"></datalist>
      <span id="proposal" class="muted"></span>
      <span id="status" class="status">loading</span>
    </div>
    <div class="toolbar" style="margin-top:10px">
      <button id="pause">Pause</button><button id="continue">Continue</button>
      <label for="next-phase">Resume at</label>
      <select id="next-phase"><option value="">current phase</option></select>
      <button id="resume">Resume daemon</button>
      <span id="message" class="muted"></span>
    </div>
  </section>
  <section class="panel"><h2>Phase timeline</h2><div id="timeline" class="timeline"></div></section>
  <section class="panel"><h2>Pending questions</h2><div id="questions"><span class="muted">None</span></div></section>
  <section class="panel"><h2>Implementer report</h2><select id="session-select"><option value="">Select a session</option></select><pre id="report">Select a session to view its last assistant report.</pre></section>
  <section class="panel"><h2>Event stream</h2><div id="events"></div></section>
<script>
const attachedProject = ${projectJson};
const queryProject = new URLSearchParams(window.location.search).get('projectDir');
const selectedProject = queryProject || attachedProject;
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $ = (id) => document.getElementById(id);
let seenQuestions = new Set();
let lastLog = '';
function apiUrl(url) { const target = new URL(url, window.location.href); if (!target.searchParams.has('projectDir')) target.searchParams.set('projectDir', selectedProject); return target.pathname + target.search; }
async function getJson(url, options) { const response = await fetch(apiUrl(url), options); const data = await response.json(); if (!response.ok) throw new Error(data.error || response.statusText); return data; }
function showMessage(text, error = false) { $('message').textContent = text; $('message').className = error ? 'error' : 'success'; }
async function refreshState() {
  try {
    const state = await getJson('/api/state');
    $('proposal').textContent = state.proposal + ' · ' + state.branch + ' · daemon ' + (state.daemonAlive ? 'alive' : 'stopped');
    $('status').textContent = state.workflowStatus + (state.pauseReason ? ' · ' + state.pauseReason : '');
    $('status').className = 'status ' + state.workflowStatus;
    $('timeline').innerHTML = (state.phases || []).map((phase) => '<div class="phase ' + (phase.current ? 'current ' : '') + (phase.complete ? 'complete' : '') + '"><div class="phase-name">' + esc(phase.id) + '</div><div class="phase-meta">' + esc(phase.family) + ' · loop ' + phase.loopCounter + '/' + phase.cap + '</div></div>').join('');
    const select = $('next-phase'); const selected = select.value; select.innerHTML = '<option value="">current phase</option>' + (state.phases || []).filter((phase, index) => index >= state.currentPhaseIdx).map((phase) => '<option value="' + esc(phase.id) + '">' + esc(phase.id) + '</option>').join(''); select.value = selected;
    const sessionSelect = $('session-select'); const old = sessionSelect.value; sessionSelect.innerHTML = '<option value="">Select a session</option>' + (state.implementerSessions || []).slice().reverse().map((session) => '<option value="' + esc(session.sessionId) + '">' + esc(session.phaseId + ' · ' + session.kind + ' · ' + session.status) + '</option>').join(''); sessionSelect.value = old;
  } catch (error) { showMessage(error.message, true); }
}
async function refreshQuestions() {
  try {
    const questions = await getJson('/api/questions');
    const current = new Set(questions.map((question) => question.id));
    if (questions.some((question) => !seenQuestions.has(question.id)) && 'Notification' in window && Notification.permission === 'granted') new Notification('opsx-flow question pending');
    seenQuestions = current;
    $('questions').innerHTML = questions.length ? questions.map((request) => '<article class="question"><h3>' + esc((request.questions[0] && request.questions[0].header) || request.phaseId || 'Question') + '</h3>' + request.questions.map((question) => '<p>' + esc(question.question) + '</p>' + (question.options && question.options.length ? '<ul>' + question.options.map((option) => '<li><strong>' + esc(option.label) + '</strong> — ' + esc(option.description) + '</li>').join('') + '</ul>' : '') + (question.custom ? '<div class="muted">Custom answer allowed</div>' : '')).join('') + '<div class="muted">Session: ' + esc(request.sessionID) + '</div><button onclick="navigator.clipboard.writeText(this.nextElementSibling.textContent)">Copy open command</button><pre>' + esc(request.openCommand) + '</pre></article>').join('') : '<span class="muted">None</span>';
  } catch (error) { $('questions').innerHTML = '<span class="error">' + esc(error.message) + '</span>'; }
}
async function refreshLog() {
  try {
    const data = await getJson('/api/log' + (lastLog ? '?since=' + encodeURIComponent(lastLog) : ''));
    if (data.entries.length) {
      $('events').innerHTML += data.entries.map((entry) => '<div class="event">' + esc(entry.ts + '  ' + entry.event + (entry.detail ? ': ' + entry.detail : '')) + '</div>').join('');
      lastLog = data.entries[data.entries.length - 1].ts;
    }
    while ($('events').children.length > 500) $('events').firstElementChild.remove();
  } catch (error) { showMessage(error.message, true); }
}
async function refreshProjects() { try { const data = await getJson('/api/projects'); $('known-projects').innerHTML = data.projects.map((project) => '<option value="' + esc(project) + '"></option>').join(''); } catch (_) {} }
async function refresh() { await Promise.all([refreshState(), refreshQuestions(), refreshLog()]); }
$('project-picker').onchange = () => { const project = $('project-picker').value.trim(); if (project) window.location.href = '/?projectDir=' + encodeURIComponent(project); };
$('pause').onclick = async () => { try { await getJson('/api/pause', {method:'POST'}); showMessage('Pause requested'); await refresh(); } catch (error) { showMessage(error.message, true); } };
$('continue').onclick = async () => { try { await getJson('/api/continue', {method:'POST'}); showMessage('Continue requested'); await refresh(); } catch (error) { showMessage(error.message, true); } };
$('resume').onclick = async () => { try { const nextPhase = $('next-phase').value; await getJson('/api/resume', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(nextPhase ? {nextPhase} : {})}); showMessage('Daemon resumed'); await refresh(); } catch (error) { showMessage(error.message, true); } };
$('session-select').onchange = async () => { if (!$('session-select').value) { $('report').textContent = 'Select a session to view its last assistant report.'; return; } try { const data = await getJson('/api/report?sessionId=' + encodeURIComponent($('session-select').value)); $('report').textContent = data.text || '(no assistant text)'; } catch (error) { $('report').textContent = error.message; } };
if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(() => {});
refreshProjects(); refresh(); setInterval(refresh, 3000);
</script>
</body>
</html>`;
}

function createUiServer(projectDir: string, port: number): ReturnType<typeof Bun.serve> {
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    fetch: async (request) => {
      const url = new URL(request.url);
      try {
        const attachedProjectDir = resolveUiProject(projectDir, url);
        if (request.method === "GET" && url.pathname === "/") return new Response(uiHtml(attachedProjectDir, port), { headers: { "content-type": "text/html; charset=utf-8" } });
        if (request.method === "GET" && url.pathname === "/api/state") return jsonResponse(await apiState(attachedProjectDir));
        if (request.method === "GET" && url.pathname === "/api/log") return jsonResponse(await apiLog(attachedProjectDir, url.searchParams.get("since") ?? undefined));
        if (request.method === "GET" && url.pathname === "/api/questions") return jsonResponse(await apiQuestions(attachedProjectDir));
        if (request.method === "GET" && url.pathname === "/api/projects") return jsonResponse({ projects: knownProjectDirs(attachedProjectDir) });
        if (request.method === "GET" && url.pathname === "/api/report") {
          const sessionId = url.searchParams.get("sessionId");
          if (!sessionId) return jsonResponse({ error: "sessionId is required" }, 400);
          return jsonResponse(await apiReport(attachedProjectDir, sessionId));
        }
        if (request.method === "POST" && url.pathname === "/api/pause") {
          const state = await loadState(statePath(attachedProjectDir));
          if (state.workflowStatus === "completed") return jsonResponse({ error: "workflow is already completed" }, 409);
          writePauseMarker(attachedProjectDir, true);
          return jsonResponse(await apiState(attachedProjectDir));
        }
        if (request.method === "POST" && url.pathname === "/api/continue") {
          const state = await loadState(statePath(attachedProjectDir));
          if (state.workflowStatus === "completed") return jsonResponse({ error: "workflow is already completed" }, 409);
          writePauseMarker(attachedProjectDir, false);
          return jsonResponse(await apiState(attachedProjectDir));
        }
        if (request.method === "POST" && url.pathname === "/api/resume") {
          const body = await requestJson(request);
          const nextPhase = body.nextPhase === undefined ? undefined : stringValue(body.nextPhase, "nextPhase");
          const result = await resumeFlow(attachedProjectDir, nextPhase);
          return jsonResponse({ ...(await apiState(attachedProjectDir)), resumedPid: result.pid });
        }
        return jsonResponse({ error: "not found" }, 404);
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : String(error) }, 500);
      }
    },
  });
}

async function cmdUi(args: string[]): Promise<number> {
  rejectUnknownFlags(args, new Set(["--project-dir", "--port"]));
  const projectDir = resolveProjectDir(args);
  if (hasFlag(args, "--port") && (!valueFlag(args, "--port") || valueFlag(args, "--port")!.startsWith("--"))) {
    throw new Error("--port requires a value");
  }
  const portRaw = valueFlag(args, "--port");
  const port = portRaw === undefined ? 4321 : positiveInt(portRaw, "--port");
  if (port > 65535) throw new Error("--port must be between 1 and 65535");
  const server = createUiServer(projectDir, port);
  console.log(`opsx-flow UI listening at http://127.0.0.1:${server.port}/ (project ${projectDir})`);
  await new Promise<void>(() => undefined);
  return 0;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`opsx-flow -- planner-free OpenSpec workflow driver

Usage:
  bun .opencode/scripts/opsx-flow.ts start <config.jsonc> [--no-ui] [--foreground] [--ui-port <port>]
  bun .opencode/scripts/opsx-flow.ts ui [--project-dir <path>] [--port <port>]
  bun .opencode/scripts/opsx-flow.ts status [--project-dir <path>]
  bun .opencode/scripts/opsx-flow.ts log [--project-dir <path>]
  bun .opencode/scripts/opsx-flow.ts pause [--project-dir <path>]
  bun .opencode/scripts/opsx-flow.ts continue [--project-dir <path>]
  bun .opencode/scripts/opsx-flow.ts resume [--project-dir <path>] [--next-phase <phase-id>]

The start command requires projectDir, proposal, and baseBranch in JSONC config.
The workflow state lives at <projectDir>/openspec/.opsx-flow-state.json.
`);
}

export const __test__ = {
  PHASES,
  DEFAULT_CAPS,
  parseStartArgs,
  loadFlowConfig,
  resolvePhase,
  phaseIndex,
  displayedPhase,
  prepareGit,
  uncheckedCount,
  checkboxCount,
  allTasksChecked,
  onlyCheckboxToggles,
  onlyCheckboxTogglesBetween,
  enforceLock,
  isPhaseClean,
  archivedProposalExists,
  changedFiles,
  statePath,
  pauseMarkerPath,
  shellArg,
  uiHtml,
  createUiServer,
};

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    return 0;
  }
  const command = argv[0]!;
  const args = argv.slice(1);
  switch (command) {
    case "start":
      return cmdStart(args);
    case "ui":
      return cmdUi(args);
    case "status":
      return cmdStatus(args);
    case "log":
      return cmdLog(args);
    case "pause":
      return cmdPause(args);
    case "continue":
      return cmdContinue(args);
    case "resume":
      return cmdResume(args);
    case "--daemon":
      if (!args[0]) throw new Error("--daemon requires <state-file>");
      return cmdDaemon(args[0]!);
    default:
      console.error(`unknown command: ${command}`);
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
    .catch((error) => {
      console.error("[opsx-flow] fatal:", error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
