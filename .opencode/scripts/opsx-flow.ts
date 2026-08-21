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

export const DEFAULT_MODEL = {
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
  kind: "implementer" | "fix" | "issue-audit" | "merge-committer";
  runIdx: number;
  startedAt: string;
  completedAt?: string;
  status: "running" | "completed" | "error";
  report?: string;
};

// A Step is a UI-facing record of one skill invocation within a phase loop
// (implementer run, issue-audit run, or fix run).  It is intentionally
// separate from SessionRecord so the timeline can be reconstructed purely
// from state without dereferencing implementer session metadata.
export type StepKind = "implementer" | "issue-audit" | "fix";
export type StepStatus = "running" | "completed" | "error";

export type Step = {
  skill: string;
  phaseId: string;
  runIdx: number;
  kind: StepKind;
  status: StepStatus;
  startedAt: string;
  completedAt?: string;
  summary?: string;
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
  steps: Step[];
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

// Raised by stopFlow when implementer sessions are still active.  The web UI
// maps this to HTTP 409; the CLI reports it as a plain refusal without killing.
export class BusySessionsError extends Error {
  constructor(sessionIds: string[]) {
    super(
      `cannot stop while implementer sessions are active: ${sessionIds.join(", ")}; pause instead, or wait for them to finish`,
    );
    this.name = "BusySessionsError";
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

export function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

export function positiveInt(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${field} must be a positive integer`);
  return parsed;
}

function positiveConfigInt(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive integer JSON number`);
  }
  return value;
}

function rejectObjectKeys(value: Record<string, unknown>, allowed: readonly string[], field: string): void {
  const allowedKeys = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) throw new Error(`unknown ${field} property: ${key}`);
  }
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

export function pauseMarkerExists(projectDir: string): boolean {
  return existsSync(pauseMarkerPath(projectDir));
}

export function writePauseMarker(projectDir: string, paused: boolean): void {
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

export function readDaemonPid(projectDir: string): number | undefined {
  return readPid(daemonPidPath(projectDir));
}

export function writeDaemonPid(projectDir: string, pid: number): void {
  writeFileSync(daemonPidPath(projectDir), `${pid}\n`, "utf8");
}

export function removeDaemonPid(projectDir: string, expectedPid?: number): void {
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
  state.steps ??= [];
  state.baselineUntracked ??= [];
  state.caps = { ...DEFAULT_CAPS, ...(state.caps ?? {}) };
  state.log ??= [];
  state.loopCounters ??= {};
  state.currentPhaseIdx ??= 0;
  state.workflowStatus ??= state.paused ? "paused" : "running";
  return state;
}

function validateStateForExecution(state: FlowState): void {
  if (!state || typeof state !== "object") throw new Error("workflow state must be an object");
  for (const field of ["proposalName", "proposalDir", "projectDir", "configPath", "branch", "baseBranch"] as const) {
    if (typeof state[field] !== "string" || !state[field].trim()) throw new Error(`workflow state field ${field} is invalid`);
  }
  const expectedProposalDir = path.join(state.projectDir, "openspec", "changes", state.proposalName);
  if (path.resolve(state.proposalDir) !== path.resolve(expectedProposalDir)) {
    throw new Error("workflow state proposalDir does not match projectDir and proposalName");
  }
  if (!Number.isInteger(state.currentPhaseIdx) || state.currentPhaseIdx < 0 || state.currentPhaseIdx > PHASES.length) {
    throw new Error(`workflow state currentPhaseIdx must be between 0 and ${PHASES.length}`);
  }
  if (!Array.isArray(state.baselineUntracked) || state.baselineUntracked.some((file) => typeof file !== "string")) {
    throw new Error("workflow state baselineUntracked is invalid");
  }
  const statuses: WorkflowStatus[] = ["running", "paused", "awaiting-question", "error", "completed"];
  if (!statuses.includes(state.workflowStatus)) throw new Error(`workflow state workflowStatus is invalid: ${state.workflowStatus}`);
  for (const key of Object.keys(DEFAULT_CAPS) as CapKey[]) {
    if (!Number.isSafeInteger(state.caps[key]) || state.caps[key] <= 0) throw new Error(`workflow state cap ${key} is invalid`);
  }
  for (const [key, value] of Object.entries(state.loopCounters)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`workflow state loop counter ${key} is invalid`);
  }
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

function normalizeModelConfig(value: unknown, field: string, allowCap = true): RawModelConfig {
  if (value === undefined) return {};
  if (!record(value)) throw new Error(`${field} must be an object`);
  const model = value as RawModelConfig;
  rejectObjectKeys(model as Record<string, unknown>, allowCap ? ["agent", "provider", "model", "variant", "cap"] : ["agent", "provider", "model", "variant"], field);
  const normalized: RawModelConfig = {};
  for (const key of ["agent", "provider", "model", "variant"] as const) {
    if (model[key] !== undefined) normalized[key] = stringValue(model[key], `${field}.${key}`);
  }
  if (allowCap && model.cap !== undefined) normalized.cap = positiveConfigInt(model.cap, `${field}.cap`);
  return normalized;
}

function parseCaps(value: unknown): Caps {
  if (value === undefined) return { ...DEFAULT_CAPS };
  if (!record(value)) throw new Error("caps must be an object");
  rejectObjectKeys(value, ["selfHeal", "apply", "testFix", "codeReviewFix"], "caps");
  return {
    selfHeal: value.selfHeal === undefined ? DEFAULT_CAPS.selfHeal : positiveConfigInt(value.selfHeal, "caps.selfHeal"),
    apply: value.apply === undefined ? DEFAULT_CAPS.apply : positiveConfigInt(value.apply, "caps.apply"),
    testFix: value.testFix === undefined ? DEFAULT_CAPS.testFix : positiveConfigInt(value.testFix, "caps.testFix"),
    codeReviewFix: value.codeReviewFix === undefined ? DEFAULT_CAPS.codeReviewFix : positiveConfigInt(value.codeReviewFix, "caps.codeReviewFix"),
  };
}

const SUBSTEP_IDS = ["fix", "issue-audit"] as const;
export type SubstepId = (typeof SUBSTEP_IDS)[number];

// Classifies a `phases` config key as a sub-step override: the global "fix" /
// "issue-audit" defaults, or a per-phase "<finding-phase>.fix" /
// "<finding-phase>.issue-audit" override.  Returns undefined for real phase
// ids (handled separately by the caller) and for anything invalid.
function classifySubstepKey(key: string): SubstepId | undefined {
  if ((SUBSTEP_IDS as readonly string[]).includes(key)) return key as SubstepId;
  const dot = key.indexOf(".");
  if (dot < 0) return undefined;
  const parent = key.slice(0, dot);
  const sub = key.slice(dot + 1);
  if (!(SUBSTEP_IDS as readonly string[]).includes(sub)) return undefined;
  const parentIsFinding = PHASES.some((phase) => phase.id === parent && phase.family === "finding");
  return parentIsFinding ? (sub as SubstepId) : undefined;
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
  rejectObjectKeys(parsed, ["projectDir", "proposal", "baseBranch", "branch", "fromStage", "caps", "phases", "mergeCommitter"], "config");

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
    // Accepted keys: real phase ids, the global sub-step defaults ("fix" /
    // "issue-audit"), and per-phase sub-step overrides
    // ("<finding-phase>.fix" / "<finding-phase>.issue-audit").  Issue-audit
    // entries reject `cap`: the audit runs once per finder iteration and has
    // no loop to cap.
    const isPhase = PHASES.some((phase) => phase.id === phaseId);
    const substep = isPhase ? undefined : classifySubstepKey(phaseId);
    if (!isPhase && substep === undefined) throw new Error(`unknown phase override: ${phaseId}`);
    phases[phaseId] = normalizeModelConfig(value, `phases.${phaseId}`, substep !== "issue-audit");
  }

  const rawMerge = normalizeModelConfig(parsed.mergeCommitter, "mergeCommitter", false);
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

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) if (typeof value === "string") return value;
  return undefined;
}

// Resolves the settings for a fix run inside a finding phase.  Precedence,
// field by field: phases["<phase>.fix"], then the global phases["fix"], then
// the enclosing phase's own settings, so an unconfigured fix loop keeps using
// the phase model (the pre-substep behavior).  cap follows the same chain and
// decouples the fix-loop cap from the finder-loop cap.
export function resolveFixPhase(config: FlowConfig, phase: PhaseDef): PhaseDef {
  const specific = config.phases[`${phase.id}.fix`] ?? {};
  const global = config.phases["fix"] ?? {};
  return {
    ...phase,
    agent: firstString(specific.agent, global.agent) ?? phase.agent,
    provider: firstString(specific.provider, global.provider) ?? phase.provider,
    model: firstString(specific.model, global.model) ?? phase.model,
    variant: firstString(specific.variant, global.variant) ?? phase.variant,
    cap: specific.cap ?? global.cap ?? phase.cap,
  };
}

// Resolves the settings for an issue-audit run inside a finding phase.
// Precedence: phases["<phase>.issue-audit"], then the global
// phases["issue-audit"], then DEFAULT_MODEL.  Unlike fix, the audit never
// inherits the enclosing phase's model.
export function resolveIssueAuditSettings(config: FlowConfig, phase: Pick<PhaseDef, "id">): {
  agent: string;
  provider: string;
  model: string;
  variant: string;
} {
  const specific = config.phases[`${phase.id}.issue-audit`] ?? {};
  const global = config.phases["issue-audit"] ?? {};
  return {
    agent: firstString(specific.agent, global.agent) ?? DEFAULT_MODEL.agent,
    provider: firstString(specific.provider, global.provider) ?? DEFAULT_MODEL.provider,
    model: firstString(specific.model, global.model) ?? DEFAULT_MODEL.model,
    variant: firstString(specific.variant, global.variant) ?? DEFAULT_MODEL.variant,
  };
}

export function phaseIndex(phaseId: string): number {
  const index = PHASES.findIndex((phase) => phase.id === phaseId);
  if (index < 0) throw new Error(`unknown phase: ${phaseId}`);
  return index;
}

export function displayedPhase(currentPhaseIdx: number, workflowStatus: WorkflowStatus): string {
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

function porcelainPaths(line: string): string[] {
  const raw = line.replace(/^.{3}/, "").trim();
  return raw.includes(" -> ") ? raw.split(" -> ").map((part) => part.trim()) : [raw];
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

export function isProcessAlive(pid?: number): boolean {
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

function assertSessionPreservedBranch(state: FlowState, beforeHead: string, context: string): void {
  const branch = currentBranch(state.projectDir);
  if (branch !== state.branch) throw new Error(`${context} changed branch from ${state.branch} to ${branch}`);
  const afterHead = requireGit(state.projectDir, ["rev-parse", "HEAD"]).trim();
  if (afterHead !== beforeHead) throw new Error(`${context} committed or rewrote branch history; expected HEAD ${beforeHead}, found ${afterHead}`);
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
  const result = git(projectDir, ["show", `HEAD:${relative}`]);
  if (!result.ok) return false;
  const before = result.stdout;
  return onlyCheckboxTogglesBetween(before, readFileSync(file, "utf8"));
}

function snapshotLockedFile(state: FlowState, phaseId: string): FileSnapshot {
  const rule = LOCKED_FILE_RULES[phaseId];
  if (!rule) return null;
  const file = path.join(state.proposalDir, rule.file);
  return existsSync(file) ? { existed: true, content: readFileSync(file, "utf8") } : { existed: false, content: "" };
}

export function enforceLock(state: FlowState, phaseId: string, before?: FileSnapshot, beforeChanges: string[] = []): boolean {
  const rule = LOCKED_FILE_RULES[phaseId];
  if (!rule) return false;
  const file = path.join(state.proposalDir, rule.file);
  const expected = `openspec/changes/${state.proposalName}/${rule.file}`;
  const previousEntries = new Set(beforeChanges);
  const relatedRenames = workingTreePorcelain(state.projectDir)
    .filter((line) => !previousEntries.has(line))
    .map((line) => ({ line, paths: porcelainPaths(line) }))
    .filter(({ paths }) => paths.length > 1 && paths.includes(expected));
  for (const { paths } of relatedRenames) {
    const destination = paths[paths.length - 1]!;
    if (destination === expected) continue;
    try {
      requireGit(state.projectDir, ["reset", "--", destination]);
    } catch {
      // An untracked rename destination has no index entry; remove it below.
    }
    if (!git(state.projectDir, ["cat-file", "-e", `HEAD:${destination}`]).ok && existsSync(path.join(state.projectDir, destination))) {
      unlinkSync(path.join(state.projectDir, destination));
    }
  }
  if (before !== undefined && before !== null) {
    const current = existsSync(file) ? readFileSync(file, "utf8") : undefined;
    // A locked file that did not exist at session start may not be created by
    // the implementer, even when the new file happens to be empty (an empty
    // string is otherwise indistinguishable from an unchanged snapshot to the
    // checkbox-only comparison below).
    if (!before.existed) {
      if (current === undefined) return false;
      try {
        requireGit(state.projectDir, ["reset", "--", path.relative(state.projectDir, file)]);
      } catch {
        // Untracked files have no index entry to reset; unlinking below is the
        // complete rollback for that case.
      }
      if (existsSync(file)) unlinkSync(file);
      return true;
    }
    if (current !== undefined && onlyCheckboxTogglesBetween(before.content, current)) return false;
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
  if (!workingTreePorcelain(state.projectDir).some((line) => porcelainPath(line) === expected)) return false;
  if (onlyCheckboxToggles(state.projectDir, file)) return false;
  const relative = path.relative(state.projectDir, file);
  if (git(state.projectDir, ["cat-file", "-e", `HEAD:${relative}`]).ok) {
    requireGit(state.projectDir, ["checkout", "HEAD", "--", relative]);
  } else {
    // A newly added locked file has no HEAD version to check out. Remove the
    // index entry first when it was staged, then remove the worktree file.
    try {
      requireGit(state.projectDir, ["reset", "--", relative]);
    } catch {
      // An entirely untracked file has no index entry; unlinking is sufficient.
    }
    if (existsSync(file)) unlinkSync(file);
  }
  return true;
}

function proposalArtifactFiles(state: FlowState): string[] {
  const prefix = `openspec/changes/${state.proposalName}/`;
  // A rename out of the proposal directory is still a proposal-artifact
  // change, even though porcelainPath() intentionally reports only the
  // destination. Include both sides of renames for the self-heal clean check.
  return workingTreePorcelain(state.projectDir)
    .flatMap((line) => porcelainPaths(line))
    .filter((file) => file.startsWith(prefix));
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

// Testable seam: tests replace `client` with a fake to exercise lifecycle
// guards (busy-session reconciliation, daemon refusal) without a live server.
// The dashboard module imports the same live binding, so a test-set client
// also affects dashboard API calls.
export let client: OpenCodeClient = new OpenCodeClient();

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

function hasCompletedAssistant(messages: MessageWithParts[]): boolean {
  const last = lastAssistant(messages);
  if (!last || last.info.role !== "assistant") return false;
  // OpenCode emits an assistant message with `finish: "tool-calls"` after
  // every tool step, while the agent may continue working in a later step.
  // The session-status endpoint can briefly report that session as idle
  // between those steps, so an assistant message alone is not completion.
  return last.info.time.completed !== undefined && last.info.finish !== "tool-calls" && last.info.finish !== "error" && !last.info.error;
}

function assistantFailed(messages: MessageWithParts[]): string | undefined {
  const last = lastAssistant(messages);
  if (!last || last.info.role !== "assistant") return undefined;
  if (last.info.finish !== "error" && !last.info.error) return undefined;
  const detail = last.info.error?.data?.message;
  return detail ? ` (${detail})` : "";
}

export async function getSessionReport(sessionId: string, projectDir: string): Promise<SessionReport> {
  const messages = await client.sessionMessages(sessionId, { directory: projectDir });
  const last = lastAssistant(messages);
  return {
    sessionId,
    text: last ? assistantText(last) : "",
    messages,
  };
}

async function sessionStatus(sessionId: string, projectDir: string): Promise<"idle" | "busy" | "retry" | "unknown"> {
  try {
    const statuses = await client.sessionStatus({ directory: projectDir });
    const status: SessionStatusInfo | undefined = statuses[sessionId];
    if (!status) return "idle";
    if (status.type === "busy" || status.type === "retry" || status.type === "idle") return status.type;
    return "unknown";
  } catch {
    return "unknown";
  }
}

async function pendingQuestion(sessionId: string, projectDir: string): Promise<QuestionRequest | undefined> {
  const requests = await client.pendingQuestions({ directory: projectDir });
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

function issueAuditPrompt(state: FlowState, phase: PhaseDef, runIdx: number): string {
  return [
    "Load the `openspec-issue-audit` skill and follow its instructions to audit the issues for this OpenSpec change.",
    "",
    `Proposal: ${state.proposalName} (${state.proposalDir}).`,
    `The ${phase.id} finding phase left issues in ${path.join(state.proposalDir, "issue.md")} that must be re-evaluated before fixing.`,
    `This is issue-audit run ${runIdx}. Work in ${state.projectDir} on branch ${state.branch}.`,
    "",
    "You may freely edit issue.md: append Re-evaluation/Enrichment notes and toggle false-positive checkboxes from [ ] to [x].",
    "Preserve every line of the original issue content verbatim; only append audit notes after the original details.",
    "Do not modify implementation code, tests, proposal artifacts, or task files.",
    "Do not commit changes; the workflow driver commits deterministic checkpoints.",
    "If blocked, use OpenCode's question tool. Finish with a concise report of cleared/enriched issue counts.",
  ].join("\n");
}

// Count `**Re-evaluation N:**` and `**Enrichment N:**` audit-trail markers so
// the issue-audit step summary can report how many issues the auditor touched.
export function auditNoteCount(file: string): number {
  if (!existsSync(file)) return 0;
  const content = readFileSync(file, "utf8");
  const reeval = content.match(/\*\*Re-evaluation\s+\d+/gi)?.length ?? 0;
  const enrich = content.match(/\*\*Enrichment\s+\d+/gi)?.length ?? 0;
  return reeval + enrich;
}

function pushStep(state: FlowState, step: Step): Step {
  state.steps.push(step);
  return step;
}

function completeStep(step: Step, status: Exclude<StepStatus, "running">, summary?: string): void {
  step.status = status;
  step.completedAt = nowIso();
  if (summary !== undefined) step.summary = summary;
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
  // Global monotonic session sequence (1-based) so each OpenCode session title
  // uniquely maps to one entry in the UI Implementer-report dropdown, even when
  // runIdx repeats across phase loops.  Derived from the appended-sessions
  // length, which is stable across daemon resume/reloads.
  const seq = state.implementerSessions.length + 1;
  const session = await client.createSpawnSession({
    title: `opsx-flow: ${state.proposalName} #${seq} ${phaseId} run ${runIdx}`,
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

async function waitForSessionCompletionLoop(state: FlowState, phaseId: string, session: SessionRecord): Promise<SessionReport> {
  let idleSince = 0;
  let unknownSince = 0;
  for (;;) {
    await sleep(POLL_INTERVAL_MS);

    let request: QuestionRequest | undefined;
    try {
      request = await pendingQuestion(session.sessionId, state.projectDir);
      unknownSince = 0;
    } catch (error) {
      if (!unknownSince) unknownSince = Date.now();
      if (Date.now() - unknownSince > IMPLEMENTER_IDLE_STALL_MS) {
        throw new Error(`question API unavailable while waiting for ${session.sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      }
      continue;
    }

    // A pending question usually means the session is blocked waiting for
    // the Master's answer.  But the question can become stale: if the
    // conversation continued without formally answering the question tool
    // (e.g. an interrupted question re-asked and answered via plain text),
    // the session may have already produced a terminal assistant message
    // while the original pending question lingers in OpenCode's database.
    // hasCompletedAssistant is the discriminator — a live question leaves
    // the last assistant message with finish:"tool-calls", while a finished
    // session has a terminal finish.  When stale, clear the pause and fall
    // through to normal completion instead of blocking forever.
    if (request) {
      let sessionCompleted = false;
      try {
        const report = await getSessionReport(session.sessionId, state.projectDir);
        sessionCompleted = hasCompletedAssistant(report.messages);
      } catch {
        // Messages not yet available; treat as not completed.
      }
      if (!sessionCompleted) {
        await markQuestionPaused(state, phaseId, request);
        continue;
      }
      logEvent(state, "question_stale", `${phaseId}: ${request.id} from ${request.sessionID} — session completed without formal answer`);
      if (state.pauseReason === "question") writePauseMarker(state.projectDir, false);
    }
    await clearQuestionPause(state);

    if (pauseMarkerExists(state.projectDir)) {
      state.paused = true;
      if (state.workflowStatus !== "awaiting-question") state.workflowStatus = "paused";
      await saveState(state);
      continue;
    }
    // `continue` can clear a manual pause marker while the implementer is
    // still busy.  Reflect that transition immediately instead of leaving the
    // persisted status as `paused` until the session eventually completes.
    if (state.paused || state.workflowStatus === "paused" || state.workflowStatus === "awaiting-question") {
      state.paused = false;
      if (state.workflowStatus !== "error" && state.workflowStatus !== "completed") {
        state.workflowStatus = "running";
      }
      await saveState(state);
    }

    const status = await sessionStatus(session.sessionId, state.projectDir);
    if (status === "busy" || status === "retry") {
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
    if (status === "idle" && report) {
      const failure = assistantFailed(report.messages);
      if (failure !== undefined) {
        throw new Error(`session ${session.sessionId} finished with an assistant error${failure}`);
      }
    }
    if (status === "idle" && Boolean(report && hasCompletedAssistant(report.messages))) {
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

async function markSessionError(state: FlowState, session: SessionRecord, error: unknown): Promise<void> {
  if (session.status !== "running") return;
  session.status = "error";
  session.completedAt = nowIso();
  const detail = error instanceof Error ? error.message : String(error);
  logEvent(state, "session_error", `${session.sessionId} (${session.phaseId}): ${detail}`);
  await saveState(state);
}

async function waitForSessionCompletion(state: FlowState, phaseId: string, session: SessionRecord): Promise<SessionReport> {
  try {
    return await waitForSessionCompletionLoop(state, phaseId, session);
  } catch (error) {
    await markSessionError(state, session, error).catch(() => undefined);
    throw error;
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

async function reconcileRunningSessions(state: FlowState): Promise<string[]> {
  const running = state.implementerSessions.filter((session) => session.status === "running");
  if (running.length === 0) return [];

  const statuses = await client.sessionStatus({ directory: state.projectDir });
  const active: string[] = [];
  for (const session of running) {
    const status = statuses[session.sessionId]?.type;
    // Busy/retry sessions are actively processing — always active.
    // Idle or unknown sessions (including question-blocked ones) fall
    // through to the completion check below; a stale pending question
    // leaves a terminal assistant message that reconcile can detect.
    if (status === "busy" || status === "retry") {
      active.push(session.sessionId);
      continue;
    }
    try {
      const report = await getSessionReport(session.sessionId, state.projectDir);
      if (hasCompletedAssistant(report.messages)) {
        session.status = "completed";
        session.completedAt = nowIso();
        session.report = report.text.slice(0, MAX_REPORT_LENGTH);
        logEvent(state, "session_reconciled", `${session.sessionId} (${session.phaseId})`);
        continue;
      }
    } catch {
      // A session that cannot be inspected is treated as active.  Resuming by
      // spawning another session would be unsafe until the Master inspects it.
    }
    active.push(session.sessionId);
  }
  await saveState(state);
  return active;
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

async function runFixLoop(state: FlowState, phase: PhaseDef, config: FlowConfig): Promise<void> {
  // Fix sessions use their own resolved settings (phases["<phase>.fix"] /
  // phases["fix"] / phase fallback), including a dedicated fix-loop cap.
  const fixPhase = resolveFixPhase(config, phase);
  const issueFile = path.join(state.proposalDir, "issue.md");
  const counterKey = `${phase.id}:fix`;
  state.loopCounters[counterKey] ??= 0;
  while (uncheckedCount(issueFile) > 0) {
    await enforceCap(state, fixPhase, counterKey, `fix for ${phase.id}`);
    const beforeUnchecked = uncheckedCount(issueFile);
    const runIdx = (state.loopCounters[counterKey] ?? 0) + 1;
    const beforeLock = snapshotLockedFile(state, "fix");
    const beforeChanges = workingTreePorcelain(state.projectDir);
    const beforeHead = requireGit(state.projectDir, ["rev-parse", "HEAD"]).trim();
    const step = pushStep(state, {
      skill: "openspec-fix",
      phaseId: phase.id,
      runIdx,
      kind: "fix",
      status: "running",
      startedAt: nowIso(),
    });
    await saveState(state);
    await spawnAndWaitFix(state, fixPhase, runIdx);
    state.loopCounters[counterKey] = runIdx;
    await waitForExternalContinue(state);
    assertSessionPreservedBranch(state, beforeHead, `fix session for ${phase.id}`);

    if (enforceLock(state, "fix", beforeLock, beforeChanges)) {
      completeStep(step, "completed", "locked-file revert");
      logEvent(state, "enforcement_revert", `fix for ${phase.id} changed issue.md content; retrying without commit`);
      await saveState(state);
      continue;
    }
    const afterUnchecked = uncheckedCount(issueFile);
    if (afterUnchecked >= beforeUnchecked) {
      completeStep(step, "completed", "no progress");
      logEvent(state, "fix_no_progress", `fix for ${phase.id} resolved no issue boxes; retrying without commit`);
      await saveState(state);
      continue;
    }
    const resolved = beforeUnchecked - afterUnchecked;
    completeStep(step, "completed", `${resolved} resolved${afterUnchecked === 0 ? "" : `, ${afterUnchecked} remaining`}`);
    await commitPhaseCheckpoint(state, `fix-${phase.id}`, runIdx, afterUnchecked === 0);
  }
  state.loopCounters[counterKey] = 0;
  await saveState(state);
}

// Computes the UI step summary for a completed implementer run from the
// post-run deterministic clean check.  Keeping this centralized ensures every
// family has a consistent summary shape across phases.
function implementerSummary(state: FlowState, phase: PhaseDef, clean: boolean): string {
  switch (phase.family) {
    case "finding": {
      const issueFile = path.join(state.proposalDir, "issue.md");
      const issues = uncheckedCount(issueFile);
      return issues === 0 ? "clean" : `${issues} issue${issues === 1 ? "" : "s"}`;
    }
    case "apply": {
      const tasksFile = path.join(state.proposalDir, "tasks.md");
      if (clean) return "all tasks checked";
      const unchecked = uncheckedCount(tasksFile);
      return unchecked === 0 ? "tasks checked" : `${unchecked} task${unchecked === 1 ? "" : "s"} unchecked`;
    }
    case "self-heal":
      return clean ? "clean" : "edits made";
    case "archive":
      return clean ? "archived" : "looped";
  }
}

// Re-evaluates issue.md before fixing.  The auditor freely edits issue.md
// (appends Re-evaluation/Enrichment notes, toggles false-positive checkboxes),
// so this step is intentionally NOT registered in LOCKED_FILE_RULES and
// enforceLock is never called here.  This runs once per finding-phase loop
// iteration, between the finder and the fixer.
async function runIssueAudit(state: FlowState, phase: PhaseDef, config: FlowConfig): Promise<void> {
  const issueFile = path.join(state.proposalDir, "issue.md");
  // Nothing to audit if issue.md is absent or already clean.
  if (!existsSync(issueFile) || uncheckedCount(issueFile) === 0) return;

  const counterKey = `${phase.id}:audit`;
  state.loopCounters[counterKey] ??= 0;
  const runIdx = (state.loopCounters[counterKey] ?? 0) + 1;
  const settings = resolveIssueAuditSettings(config, phase);
  const beforeHead = requireGit(state.projectDir, ["rev-parse", "HEAD"]).trim();
  const beforeUnchecked = uncheckedCount(issueFile);
  const beforeNotes = auditNoteCount(issueFile);

  const step = pushStep(state, {
    skill: "openspec-issue-audit",
    phaseId: phase.id,
    runIdx,
    kind: "issue-audit",
    status: "running",
    startedAt: nowIso(),
  });
  logEvent(state, "issue_audit_run", `${phase.id} run ${runIdx}`);
  await saveState(state);

  const session = await spawnSession(
    state,
    `issue-audit-${phase.id}`,
    "issue-audit",
    runIdx,
    settings,
    issueAuditPrompt(state, phase, runIdx),
  );
  await waitForSessionCompletion(state, `issue-audit-${phase.id}`, session);
  state.loopCounters[counterKey] = runIdx;
  await waitForExternalContinue(state);
  assertSessionPreservedBranch(state, beforeHead, `issue-audit session for ${phase.id}`);

  const afterUnchecked = uncheckedCount(issueFile);
  const afterNotes = auditNoteCount(issueFile);
  const cleared = Math.max(0, beforeUnchecked - afterUnchecked);
  const enriched = Math.max(0, afterNotes - beforeNotes);
  completeStep(step, "completed", `${cleared} cleared${enriched ? `, ${enriched} enriched` : ""}`);
  await commitPhaseCheckpoint(state, `issue-audit-${phase.id}`, runIdx, afterUnchecked === 0);
}

async function runPhaseLoop(state: FlowState, phase: PhaseDef, config: FlowConfig): Promise<void> {
  state.loopCounters[phase.id] ??= 0;
  for (;;) {
    await waitForExternalContinue(state);
    await enforceCap(state, phase, phase.id, `phase ${phase.id}`);
    const runIdx = (state.loopCounters[phase.id] ?? 0) + 1;
    const beforeLock = snapshotLockedFile(state, phase.id);
    const beforeChanges = workingTreePorcelain(state.projectDir);
    const beforeHead = requireGit(state.projectDir, ["rev-parse", "HEAD"]).trim();
    logEvent(state, "phase_run", `${phase.id} run ${runIdx}`);
    const step = pushStep(state, {
      skill: phase.skill,
      phaseId: phase.id,
      runIdx,
      kind: "implementer",
      status: "running",
      startedAt: nowIso(),
    });
    await saveState(state);
    await spawnAndWaitImplementer(state, phase, runIdx);
    await waitForExternalContinue(state);
    assertSessionPreservedBranch(state, beforeHead, `implementer session for ${phase.id}`);

    if (enforceLock(state, phase.id, beforeLock, beforeChanges)) {
      state.loopCounters[phase.id] = runIdx;
      completeStep(step, "completed", "locked-file revert");
      logEvent(state, "enforcement_revert", `${phase.id} modified locked-file content; retrying without commit`);
      await saveState(state);
      continue;
    }

    const clean = isPhaseClean(state, phase);
    completeStep(step, "completed", implementerSummary(state, phase, clean));
    await commitPhaseCheckpoint(state, phase.id, runIdx, clean);

    if (phase.family === "finding" && !clean) {
      state.loopCounters[phase.id] = runIdx;
      await saveState(state);
      await runIssueAudit(state, phase, config);
      await runFixLoop(state, phase, config);
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
  const beforeHead = requireGit(state.projectDir, ["rev-parse", "HEAD"]).trim();
  const session = await spawnSession(state, "merge", "merge-committer", 1, config.mergeCommitter, prompt);
  const report = await waitForSessionCompletion(state, "merge", session);
  assertSessionPreservedBranch(state, beforeHead, "merge committer session");
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
    await runPhaseLoop(state, phase, config);
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
  validateStateForExecution(state);
  if (path.resolve(config.projectDir) !== path.resolve(state.projectDir)) throw new Error("config projectDir differs from workflow state");
  if (config.proposalName !== state.proposalName) throw new Error("config proposal differs from workflow state");
  if (path.resolve(config.proposalDir) !== path.resolve(state.proposalDir)) throw new Error("config proposalDir differs from workflow state");
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
    steps: [],
    log: [],
  };
}

function launchDaemon(projectDir: string, stateFile: string): number {
  const existingPid = readDaemonPid(projectDir);
  if (existingPid && isProcessAlive(existingPid)) {
    throw new Error(`workflow daemon is already running (pid ${existingPid})`);
  }
  const child = Bun.spawn(["bun", import.meta.path, "--daemon", stateFile], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  });
  child.unref();
  writeDaemonPid(projectDir, child.pid);
  return child.pid;
}

async function runDriverProcess(state: FlowState): Promise<WorkflowStatus> {
  const existingPid = readDaemonPid(state.projectDir);
  if (existingPid && existingPid !== process.pid && isProcessAlive(existingPid)) {
    throw new Error(`workflow daemon is already running (pid ${existingPid})`);
  }
  state.daemonPid = process.pid;
  writeDaemonPid(state.projectDir, process.pid);
  try {
    const config = await loadFlowConfig(state.configPath);
    configMatchesState(config, state);
    const branch = currentBranch(state.projectDir);
    if (branch !== state.branch) {
      throw new Error(`workflow daemon must run on branch ${state.branch}; found ${branch}`);
    }
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

export function valueFlag(args: string[], flag: string): string | undefined {
  const prefix = `${flag}=`;
  const inline = args.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag) || args.some((arg) => arg.startsWith(`${flag}=`));
}

export function rejectUnknownFlags(args: string[], allowed: Set<string>): void {
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const flag = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (!allowed.has(flag)) throw new Error(`unknown option: ${arg}`);
  }
}

type StartOptions = { configPath: string; noUi: boolean; foreground: boolean; uiPort: number };

// `--no-ui` / `--ui-port` are still parsed (and returned) for backward
// compatibility with callers and tests that pass them, but they are IGNORED:
// the driver no longer manages a web UI.  Launch the dashboard separately
// with the `dashboard` / `ui` command.
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

export function resolveProjectDir(args: string[]): string {
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
    if (running) throw new Error(`existing opsx-flow daemon is still running (pid ${readDaemonPid(configuredProjectDir) ?? existing.daemonPid})`);
    if (existing.workflowStatus !== "completed") {
      throw new Error(
        `existing opsx-flow state for ${existing.proposalName} is ${existing.workflowStatus}; ` +
        "resume it or remove the stale state deliberately",
      );
    }
  }
  const projectDir = prepareGit(config);

  await ensureGitignore(projectDir);
  commitGitignoreGuard(projectDir);
  const state = createInitialState({ ...config, projectDir, proposalDir: path.join(projectDir, "openspec", "changes", config.proposalName) });
  state.baselineUntracked = currentUntrackedFiles(projectDir);
  writePauseMarker(projectDir, false);
  logEvent(state, "workflow_start", `${state.proposalName} on ${state.branch} from ${state.baseBranch}`);
  await saveState(state);

  if (options.foreground) {
    const status = await runDriverProcess(state);
    return status === "error" ? 1 : 0;
  }
  const daemonPid = launchDaemon(projectDir, stateFile);
  console.log(`opsx-flow started: proposal=${state.proposalName} branch=${state.branch} pid=${daemonPid}`);
  console.log(`state: ${stateFile}`);
  console.log(`log:   ${path.join(projectDir, "openspec", ".opsx-flow.log")}`);
  console.log('dashboard: bun .opencode/scripts/opsx-flow-dashboard.ts [--port <port>] to launch the web UI');
  return 0;
}

async function cmdDaemon(stateFile: string): Promise<number> {
  const state = await loadState(path.resolve(stateFile));
  validateStateForExecution(state);
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
  await clearManualPause(projectDir, state);
  console.log(`continue: ${state.proposalName}`);
  return 0;
}

async function cmdStop(args: string[]): Promise<number> {
  rejectUnknownFlags(args, new Set(["--project-dir"]));
  const projectDir = resolveProjectDir(args);
  await stopFlow(projectDir);
  console.log("opsx-flow stopped; run resume to restart the driver");
  return 0;
}

async function flushResumeWorktree(projectDir: string): Promise<void> {
  const dirty = workingTreePorcelain(projectDir);
  if (dirty.length === 0) return;
  commitWorkingTree(projectDir, "opsx-flow(resume): flush manual changes");
  console.log(`flushed ${dirty.length} manual change(s) before resume`);
}

export async function clearManualPause(projectDir: string, state: FlowState): Promise<void> {
  writePauseMarker(projectDir, false);
  // A running daemon will reconcile this on its next poll, but persist the
  // transition now so status and the UI do not report a stale paused state.
  // Do not turn a stopped cap-hit/error workflow into running: those require
  // the explicit resume command.
  const daemonPid = readDaemonPid(projectDir) ?? state.daemonPid;
  const canReconcile = state.workflowStatus === "paused"
    || (state.workflowStatus === "awaiting-question" && state.pendingQuestion === null);
  if (canReconcile && isProcessAlive(daemonPid)) {
    state.paused = false;
    state.workflowStatus = "running";
    await saveState(state);
  }
}

// Pure decision helper for stopFlow: keeps the guard/kill/noop branches unit
// testable without real processes.  `activeSessions` comes from the caller's
// busy-session reconciliation; a live `pid` wins over the noop path.
export type StopAction = { action: "refuse"; sessionIds: string[] } | { action: "noop" } | { action: "kill"; pid: number };

export function computeStopAction(state: FlowState, pid: number | undefined, activeSessions: string[]): StopAction {
  if (activeSessions.length > 0) return { action: "refuse", sessionIds: activeSessions };
  if (!isProcessAlive(pid)) return { action: "noop" };
  return { action: "kill", pid: pid! };
}

export async function stopFlow(projectDir: string): Promise<void> {
  const stateFile = statePath(projectDir);
  if (!existsSync(stateFile)) throw new Error("no existing opsx-flow state; nothing to stop");
  const state = await loadState(stateFile);
  if (state.workflowStatus === "completed") throw new Error(`workflow is already completed: ${state.proposalName}`);
  const pid = readDaemonPid(projectDir) ?? state.daemonPid;

  // Never kill while an implementer session is still working: the sessions
  // would be orphaned.  Refuse and let the operator pause instead.
  const activeSessions = await reconcileRunningSessions(state);
  const action = computeStopAction(state, pid, activeSessions);
  if (action.action === "refuse") {
    throw new BusySessionsError(action.sessionIds);
  }

  if (action.action === "kill") {
    try {
      process.kill(action.pid);
    } catch {
      // The process exited between the liveness check and the signal; the
      // polling loop below confirms it and we proceed with cleanup.
    }
    for (let attempt = 0; attempt < 10 && isProcessAlive(action.pid); attempt++) {
      await sleep(500);
    }
    if (isProcessAlive(action.pid)) {
      try {
        process.kill(action.pid, 9);
      } catch {
        // Exited concurrently; treat as killed.
      }
    }
    logEvent(state, "workflow_stopped", `manual stop; pid ${action.pid}`);
  } else {
    logEvent(state, "workflow_stop_noop", "daemon not running");
  }
  removeDaemonPid(projectDir);
  state.daemonPid = undefined;
  if (state.workflowStatus !== "completed" && state.workflowStatus !== "error") {
    // A manual stop looks like a cap-hit from the UI's perspective: the driver
    // is dead and resume is required to continue.
    state.workflowStatus = "paused";
    state.paused = true;
    writePauseMarker(projectDir, true);
  }
  await saveState(state);
}

export async function resumeFlow(projectDir: string, nextPhaseId?: string): Promise<{ state: FlowState; pid: number }> {
  const stateFile = statePath(projectDir);
  if (!existsSync(stateFile)) throw new Error("no existing opsx-flow state; use start for a new workflow");
  const state = await loadState(stateFile);
  validateStateForExecution(state);
  if (state.workflowStatus === "completed") throw new Error(`workflow is already completed: ${state.proposalName}`);
  const runningPid = readDaemonPid(projectDir) ?? state.daemonPid;
  if (isProcessAlive(runningPid)) throw new Error(`workflow daemon is already running (pid ${runningPid}); use continue instead`);

  const config = await loadFlowConfig(state.configPath);
  configMatchesState(config, state);
  const activeSessions = await reconcileRunningSessions(state);
  if (activeSessions.length > 0) {
    throw new Error(`cannot resume while implementer sessions are still active: ${activeSessions.join(", ")}`);
  }
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
// Known project dirs (shared with the dashboard module)
// ---------------------------------------------------------------------------

export function knownProjectDirs(projectDir: string): string[] {
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

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function printHelp(): void {
  console.log(`opsx-flow -- planner-free OpenSpec workflow driver

Usage:
  bun .opencode/scripts/opsx-flow.ts start <config.jsonc> [--foreground]
  bun .opencode/scripts/opsx-flow.ts status [--project-dir <path>]
  bun .opencode/scripts/opsx-flow.ts log [--project-dir <path>]
  bun .opencode/scripts/opsx-flow.ts pause [--project-dir <path>]
  bun .opencode/scripts/opsx-flow.ts continue [--project-dir <path>]
  bun .opencode/scripts/opsx-flow.ts stop [--project-dir <path>]
  bun .opencode/scripts/opsx-flow.ts resume [--project-dir <path>] [--next-phase <phase-id>]

Dashboard: bun .opencode/scripts/opsx-flow-dashboard.ts [--port <port>]

The start command requires projectDir, proposal, and baseBranch in JSONC config.
The workflow state lives at <projectDir>/openspec/.opsx-flow-state.json.
`);
}

export const __test__ = {
  PHASES,
  DEFAULT_CAPS,
  DEFAULT_MODEL,
  parseStartArgs,
  loadFlowConfig,
  resolvePhase,
  resolveFixPhase,
  resolveIssueAuditSettings,
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
  hasCompletedAssistant,
  changedFiles,
  statePath,
  pauseMarkerPath,
  clearManualPause,
  auditNoteCount,
  implementerSummary,
  runIssueAudit,
  computeStopAction,
  stopFlow,
  cmdStop,
  cmdStart,
  dispatchCommand,
  setClient(next: OpenCodeClient): void {
    client = next;
  },
};

export async function dispatchCommand(command: string, args: string[]): Promise<number> {
  switch (command) {
    case "start":
      return cmdStart(args);
    case "status":
      return cmdStatus(args);
    case "log":
      return cmdLog(args);
    case "pause":
      return cmdPause(args);
    case "continue":
      return cmdContinue(args);
    case "stop":
      return cmdStop(args);
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

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    return 0;
  }
  return dispatchCommand(argv[0]!, argv.slice(1));
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
