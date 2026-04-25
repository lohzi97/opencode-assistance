import path from "node:path";
import {
  OpenCodeClient,
  collapse,
  iso,
  readText,
  record,
  root,
  sleep,
  stateDir,
  truncate,
  writeJsonFile,
} from "./shared";
import { loadWorkerConfig } from "./config";
import type {
  AssistantMessageInfo,
  BusEventPayload,
  CompactionConfig,
  GlobalEventEnvelope,
  MessagePart,
  MessageWithParts,
  ModelRef,
  ProviderInfo,
  SessionInfo,
  SessionStatusInfo,
} from "./shared";

type GroupStatus = "active" | "superseded" | "failed" | "archived";
type ManagedStatus =
  | "monitoring"
  | "threshold_reached"
  | "aborting"
  | "aborted"
  | "summarizing"
  | "creating_continuation"
  | "complete"
  | "failed";

type ContinuationGroup = {
  group_id: string;
  root_session_id: string;
  display_base_title: string;
  latest_session_id: string;
  next_index: number;
  created_at: number;
  updated_at: number;
  status: GroupStatus;
};

type ManagedSession = {
  session_id: string;
  group_id: string;
  index: number;
  title: string;
  agent?: string;
  provider_id?: string;
  model_id?: string;
  variant?: string;
  threshold_ratio?: number;
  last_usage_ratio?: number;
  last_tokens_total?: number;
  last_message_id?: string;
  status: ManagedStatus;
  abort_requested_at?: number;
  aborted_at?: number;
  superseded_by_session_id?: string;
  intervention_key?: string;
  summary_run_id?: string;
  created_at: number;
  updated_at: number;
  error?: string;
};

type SummaryRunStatus = "created" | "completed" | "failed";

type SummaryRun = {
  run_id: string;
  source_session_id: string;
  group_id: string;
  temp_session_id?: string;
  created_at: number;
  completed_at?: number;
  status: SummaryRunStatus;
  summary_message_id?: string;
  summary_text?: string;
  error?: string;
};

type CompactionState = {
  version: 1;
  groups: Record<string, ContinuationGroup>;
  sessions: Record<string, ManagedSession>;
  temp_runs: Record<string, SummaryRun>;
};

type SyncPayload = {
  type: string;
  data: Record<string, unknown>;
};

type ModelPolicy = {
  threshold: number;
  contextLimit: number;
};

type AssistantTurnMessage = {
  info: AssistantMessageInfo;
  parts: MessagePart[];
};

type Round = {
  userMessageID: string;
  userText: string;
  fileRefs: string[];
  assistantMessages: AssistantTurnMessage[];
};

type DerivedHistory = {
  completedRounds: Round[];
  activeRound?: Round;
  recentCarryover: string[];
  filesToRemember: string[];
  latestAgent?: string;
  latestModel?: ModelRef;
  stableGoal: string;
  pendingRisks: string[];
};

const stateFile = path.join(stateDir, "compaction-state.json");

export class CompactionService {
  private readonly client: OpenCodeClient;
  private config: CompactionConfig = defaultCompactionConfig();
  private state: CompactionState = emptyState();
  private readonly statuses = new Map<string, SessionStatusInfo>();
  private readonly queues = new Map<string, Promise<void>>();
  private saveQueue: Promise<void> = Promise.resolve();
  private providersLoadedAt = 0;
  private readonly providers = new Map<string, ProviderInfo["models"][string]>();
  private readonly missingLimitLogged = new Set<string>();

  constructor(client: OpenCodeClient) {
    this.client = client;
  }

  async start() {
    this.config = await this.loadConfig();
    if (!this.config.enabled) {
      console.log("[compaction] disabled");
      return;
    }

    this.state = await this.loadState();
    await this.verifyBuiltinCompactionDisabled();
    await this.refreshProviders(true);

    const statuses = await this.client.sessionStatus().catch(() => ({}));
    for (const [sessionID, status] of Object.entries(statuses)) {
      this.statuses.set(sessionID, status);
    }

    await this.recoverPendingSessions();
    await this.bootstrapBusySessions(statuses);
  }

  async handleEnvelope(envelope: GlobalEventEnvelope) {
    if (!this.config.enabled) return;
    if (envelope.directory && path.resolve(envelope.directory) !== root) return;

    const bus = unwrapBusEvent(envelope);
    if (bus) {
      await this.handleBusEvent(bus);
      return;
    }

    const sync = unwrapSyncEvent(envelope);
    if (!sync) return;

    if (sync.type === "message.updated.1") {
      const sessionID = asString(sync.data.sessionID);
      const info = readAssistantInfo(sync.data.info);
      if (!sessionID || !info) return;
      if (info.sessionID !== sessionID) return;
      this.enqueue(sessionID, "message.updated", async () => {
        await this.processAssistantUpdate(info);
      });
      return;
    }

    if (sync.type === "session.updated.1") {
      const sessionID = asString(sync.data.sessionID);
      const title = readUpdatedTitle(sync.data.info);
      if (!sessionID || !title) return;
      const managed = this.state.sessions[sessionID];
      if (!managed) return;
      managed.title = title;
      managed.updated_at = Date.now();
      void this.persist();
    }
  }

  private async handleBusEvent(event: BusEventPayload) {
    if (event.type === "session.status") {
      const sessionID = asString(event.properties.sessionID);
      const status = readStatus(event.properties.status);
      if (!sessionID || !status) return;
      this.statuses.set(sessionID, status);
      return;
    }

    if (event.type === "session.compacted") {
      const sessionID = asString(event.properties.sessionID);
      if (!sessionID || !this.state.sessions[sessionID]) return;
      const managed = this.state.sessions[sessionID];
      if (managed.status === "complete" || managed.status === "failed") return;
      console.warn(`[compaction] unexpected built-in compaction for ${sessionID}`);
      await this.client.log("warn", "compaction manager observed unexpected built-in compaction", {
        sessionID,
        groupID: managed.group_id,
        status: managed.status,
      });
      return;
    }

    if (event.type === "session.error") {
      const sessionID = asString(event.properties.sessionID);
      const error = readErrorName(event.properties.error);
      if (!sessionID || error !== "ContextOverflowError") return;
      this.enqueue(sessionID, "session.error", async () => {
        await this.processOverflowEvent(sessionID);
      });
    }
  }

  private enqueue(sessionID: string, label: string, fn: () => Promise<void>) {
    const previous = this.queues.get(sessionID) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(fn)
      .catch(async (err) => {
        console.error(`[compaction] ${label} failed for ${sessionID}`, err);
        await this.failSession(sessionID, err);
      })
      .finally(() => {
        if (this.queues.get(sessionID) === next) {
          this.queues.delete(sessionID);
        }
      });
    this.queues.set(sessionID, next);
  }

  private async bootstrapBusySessions(statuses: Record<string, SessionStatusInfo>) {
    for (const [sessionID, status] of Object.entries(statuses)) {
      if (status.type !== "busy") continue;
      if (this.isTempSession(sessionID)) continue;
      this.enqueue(sessionID, "bootstrap", async () => {
        await this.inspectBusySession(sessionID);
      });
    }
  }

  private async recoverPendingSessions() {
    for (const managed of Object.values(this.state.sessions)) {
      if (
        managed.status !== "threshold_reached" &&
        managed.status !== "aborting" &&
        managed.status !== "aborted" &&
        managed.status !== "summarizing" &&
        managed.status !== "creating_continuation"
      ) {
        continue;
      }
      this.enqueue(managed.session_id, "recovery", async () => {
        await this.continueIntervention(managed.session_id);
      });
    }
  }

  private async inspectBusySession(sessionID: string) {
    const session = await this.safeGetSession(sessionID);
    if (!session || session.parentID) return;
    const history = await this.fetchHistoryWithRetry(sessionID);
    const lastAssistant = findLastAssistant(history);
    if (!lastAssistant || lastAssistant.info.summary) return;
    await this.processAssistantUpdate(lastAssistant.info, session);
  }

  private async processAssistantUpdate(info: AssistantMessageInfo, sessionHint?: SessionInfo) {
    if (info.summary) return;
    if (this.isTempSession(info.sessionID)) return;

    const policy = await this.resolvePolicy(info.providerID, info.modelID);
    if (!policy) return;

    const count = tokenCount(info.tokens);
    if (count <= 0) return;
    const ratio = count / policy.contextLimit;
    const managed = this.state.sessions[info.sessionID];

    if (managed) {
      managed.agent = info.agent;
      managed.provider_id = info.providerID;
      managed.model_id = info.modelID;
      managed.variant = info.variant;
      managed.threshold_ratio = policy.threshold;
      managed.last_usage_ratio = ratio;
      managed.last_tokens_total = count;
      managed.last_message_id = info.id;
      managed.updated_at = Date.now();
      if (managed.status !== "monitoring") {
        await this.persist();
        return;
      }
    }

    if (ratio < policy.threshold) return;

    const session = sessionHint ?? (await this.safeGetSession(info.sessionID));
    if (!session || session.parentID || session.time.archived) return;

    const active = this.state.sessions[info.sessionID] ?? this.createManagedSourceSession(session);
    active.agent = info.agent;
    active.provider_id = info.providerID;
    active.model_id = info.modelID;
    active.variant = info.variant;
    active.threshold_ratio = policy.threshold;
    active.last_usage_ratio = ratio;
    active.last_tokens_total = count;
    active.last_message_id = info.id;
    active.intervention_key = `${info.id}:${count}`;
    active.status = "threshold_reached";
    active.updated_at = Date.now();
    await this.persist();

    await this.client.log("info", "compaction threshold crossed", {
      sessionID: info.sessionID,
      groupID: active.group_id,
      providerID: info.providerID,
      modelID: info.modelID,
      ratio,
      threshold: policy.threshold,
      tokens: count,
      messageID: info.id,
    });

    await this.continueIntervention(info.sessionID);
  }

  private async processOverflowEvent(sessionID: string) {
    if (this.isTempSession(sessionID)) return;
    const existing = this.state.sessions[sessionID];
    if (existing && existing.status !== "monitoring") return;

    const session = await this.safeGetSession(sessionID);
    if (!session || session.parentID) return;

    const managed = existing ?? this.createManagedSourceSession(session);
    managed.status = "threshold_reached";
    managed.error = "ContextOverflowError";
    managed.updated_at = Date.now();
    await this.persist();

    await this.client.log("warn", "compaction overflow fallback triggered", {
      sessionID,
      groupID: managed.group_id,
    });

    await this.continueIntervention(sessionID);
  }

  private async continueIntervention(sessionID: string) {
    const managed = this.state.sessions[sessionID];
    if (!managed) return;
    const group = this.state.groups[managed.group_id];
    if (!group) {
      throw new Error(`missing group for ${sessionID}`);
    }

    if (managed.status === "threshold_reached" || managed.status === "aborting") {
      await this.abortPhase(managed);
    }
    if (managed.status === "aborted" || managed.status === "summarizing") {
      await this.summarizePhase(managed, group);
    }
    if (managed.status === "creating_continuation") {
      await this.continuationPhase(managed, group);
    }
  }

  private async abortPhase(managed: ManagedSession) {
    managed.status = "aborting";
    managed.abort_requested_at = Date.now();
    managed.updated_at = Date.now();
    await this.persist();

    await this.client.log("info", "compaction abort requested", {
      sessionID: managed.session_id,
      groupID: managed.group_id,
      trigger: managed.intervention_key,
    });

    try {
      await this.client.abortSession(managed.session_id);
    } catch (err) {
      console.warn(`[compaction] abort request failed for ${managed.session_id}`, err);
    }

    let settled = await this.waitForIdle(managed.session_id, this.config.abort_wait_ms);
    if (!settled) {
      try {
        await this.client.abortSession(managed.session_id);
      } catch {
        // ignore second abort failure
      }
      settled = await this.waitForIdle(managed.session_id, this.config.abort_wait_ms);
    }
    if (!settled) {
      throw new Error("session did not settle after abort");
    }

    managed.status = "aborted";
    managed.aborted_at = Date.now();
    managed.updated_at = Date.now();
    await this.persist();

    await this.client.log("info", "compaction abort confirmed", {
      sessionID: managed.session_id,
      groupID: managed.group_id,
      abortedAt: managed.aborted_at,
    });
  }

  private async summarizePhase(managed: ManagedSession, group: ContinuationGroup) {
    managed.status = "summarizing";
    managed.updated_at = Date.now();
    await this.persist();

    const session = await this.client.getSession(managed.session_id);
    const history = await this.fetchHistoryWithRetry(managed.session_id);
    const derived = deriveHistory(history, this.config.carryover);
    if (!managed.agent && derived.latestAgent) {
      managed.agent = derived.latestAgent;
    }
    if ((!managed.provider_id || !managed.model_id) && derived.latestModel) {
      managed.provider_id = derived.latestModel.providerID;
      managed.model_id = derived.latestModel.modelID;
      managed.variant = derived.latestModel.variant;
    }

    const summaryRun = await this.ensureSummaryRun(managed, group, session, derived);
    managed.summary_run_id = summaryRun.run_id;
    managed.status = "creating_continuation";
    managed.updated_at = Date.now();
    await this.persist();
  }

  private async continuationPhase(managed: ManagedSession, group: ContinuationGroup) {
    const session = await this.client.getSession(managed.session_id);
    const run = managed.summary_run_id ? this.state.temp_runs[managed.summary_run_id] : undefined;
    if (!run?.summary_text) {
      managed.status = "summarizing";
      managed.updated_at = Date.now();
      await this.persist();
      await this.summarizePhase(managed, group);
    }

    const resolvedRun = managed.summary_run_id ? this.state.temp_runs[managed.summary_run_id] : undefined;
    const summaryText = resolvedRun?.summary_text;
    if (!summaryText) {
      throw new Error("summary text missing for continuation");
    }

    const continuationIndex = group.next_index;
    const title = formatTitle(group.display_base_title, group.group_id, continuationIndex);
    const priorSessionIDs = collectPriorSessions(this.state, group.group_id);
    const continuation = await this.client.createSession(title);
    const now = Date.now();
    this.state.sessions[continuation.id] = {
      session_id: continuation.id,
      group_id: group.group_id,
      index: continuationIndex,
      title,
      agent: managed.agent,
      provider_id: managed.provider_id,
      model_id: managed.model_id,
      variant: managed.variant,
      threshold_ratio: managed.threshold_ratio,
      status: "monitoring",
      created_at: now,
      updated_at: now,
    };
    group.latest_session_id = continuation.id;
    group.next_index = continuationIndex + 1;
    group.updated_at = now;
    group.status = "active";
    await this.persist();

    const continuationPrompt = buildContinuationPrompt({
      summaryText,
      groupID: group.group_id,
      sourceSessionID: managed.session_id,
      continuationSessionID: continuation.id,
      priorSessionIDs,
    });

    try {
      await this.client.promptAsync(continuation.id, {
        agent: managed.agent,
        model:
          managed.provider_id && managed.model_id
            ? {
                providerID: managed.provider_id,
                modelID: managed.model_id,
                variant: managed.variant,
              }
            : undefined,
        parts: [{ type: "text", text: continuationPrompt }],
      });
    } catch (err) {
      delete this.state.sessions[continuation.id];
      group.latest_session_id = managed.session_id;
      group.next_index = continuationIndex;
      group.updated_at = Date.now();
      await this.persist();
      await this.client.deleteSession(continuation.id).catch(() => undefined);
      throw err;
    }

    managed.superseded_by_session_id = continuation.id;
    managed.status = "complete";
    managed.updated_at = Date.now();
    managed.error = undefined;

    await this.persist();

    if (this.config.rename_original) {
      const desiredTitle = formatTitle(group.display_base_title, group.group_id, managed.index);
      await this.renameSessionIfNeeded(managed.session_id, session.title, desiredTitle).catch(async (err) => {
        await this.client.log("warn", "compaction manager could not rename source session", {
          sessionID: managed.session_id,
          groupID: group.group_id,
          desiredTitle,
          error: errorMessage(err),
        });
      });
    }

    await this.cleanupSummaryRun(resolvedRun);

    await this.client.log("info", "compaction continuation created", {
      sourceSessionID: managed.session_id,
      continuationSessionID: continuation.id,
      groupID: group.group_id,
      title,
    });
  }

  private async ensureSummaryRun(
    managed: ManagedSession,
    group: ContinuationGroup,
    session: SessionInfo,
    derived: DerivedHistory,
  ) {
    const existing = managed.summary_run_id ? this.state.temp_runs[managed.summary_run_id] : undefined;
    if (existing?.summary_text) {
      return existing;
    }

    const runID = existing?.run_id ?? `run_${randomSuffix(8)}`;
    const run: SummaryRun = existing ?? {
      run_id: runID,
      source_session_id: managed.session_id,
      group_id: group.group_id,
      created_at: Date.now(),
      status: "created",
    };
    this.state.temp_runs[runID] = run;
    managed.summary_run_id = runID;
    await this.persist();

    const sourceDocument = buildSourceDocument({
      session,
      group,
      derived,
      managed,
    });
    const fallback = buildFallbackSummary({
      derived,
      group,
      sourceSessionID: managed.session_id,
    });

    try {
      const tempSession = run.temp_session_id
        ? await this.client.getSession(run.temp_session_id).catch(() => undefined)
        : undefined;
      const temp = tempSession ??
        (await this.client.createSession(`Temp Summary [${group.group_id}] [source ${managed.session_id}]`));
      run.temp_session_id = temp.id;
      await this.persist();

      const first = await this.client.prompt(temp.id, {
        agent: this.config.summarizer?.agent,
        model: this.config.summarizer,
        parts: [{ type: "text", text: buildSummarizerPrompt(sourceDocument) }],
      });
      let summaryText = extractText(first);
      let summaryMessageID = first.info.id;

      if (!isValidSummary(summaryText)) {
        const retry = await this.client.prompt(temp.id, {
          agent: this.config.summarizer?.agent,
          model: this.config.summarizer,
          parts: [{ type: "text", text: buildRetrySummarizerPrompt(sourceDocument, summaryText) }],
        });
        summaryText = extractText(retry);
        summaryMessageID = retry.info.id;
      }

      if (!isValidSummary(summaryText)) {
        summaryText = fallback;
      }

      run.status = "completed";
      run.summary_message_id = summaryMessageID;
      run.summary_text = summaryText;
      run.completed_at = Date.now();
      run.error = undefined;
      await this.persist();
      return run;
    } catch (err) {
      run.status = "completed";
      run.summary_text = fallback;
      run.completed_at = Date.now();
      run.error = errorMessage(err);
      await this.persist();
      return run;
    }
  }

  private async cleanupSummaryRun(run: SummaryRun | undefined) {
    if (!run?.temp_session_id) return;
    if (this.config.temp_session_cleanup === "keep") return;

    try {
      if (this.config.temp_session_cleanup === "delete") {
        await this.client.deleteSession(run.temp_session_id);
      } else {
        await this.client.updateSession(run.temp_session_id, {
          time: {
            archived: Date.now(),
          },
        });
      }
    } catch (err) {
      console.warn(`[compaction] failed to cleanup temp session ${run.temp_session_id}`, err);
    }
  }

  private async renameSessionIfNeeded(sessionID: string, currentTitle: string, desiredTitle: string) {
    if (currentTitle === desiredTitle) return;
    if (this.config.rename_delay_ms > 0) {
      await sleep(this.config.rename_delay_ms);
    }
    await this.client.updateSession(sessionID, { title: desiredTitle });
    const managed = this.state.sessions[sessionID];
    if (managed) {
      managed.title = desiredTitle;
      managed.updated_at = Date.now();
      await this.persist();
    }
  }

  private async waitForIdle(sessionID: string, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const known = this.statuses.get(sessionID);
      if (known && known.type !== "busy") return true;
      const snapshot = await this.client.sessionStatus().catch(() => undefined);
      if (snapshot) {
        for (const [id, status] of Object.entries(snapshot)) {
          this.statuses.set(id, status);
        }
        const current = snapshot[sessionID];
        if (!current || current.type !== "busy") return true;
      }
      await sleep(500);
    }
    return false;
  }

  private async fetchHistoryWithRetry(sessionID: string) {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.config.history_retry_count; attempt++) {
      try {
        return await this.client.sessionMessages(sessionID);
      } catch (err) {
        lastError = err;
        await sleep(500 * (attempt + 1));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async resolvePolicy(providerID: string, modelID: string): Promise<ModelPolicy | undefined> {
    const key = `${providerID}/${modelID}`;
    await this.refreshProviders(false);
    const override = this.config.models[key] ?? {};
    const model = this.providers.get(key);
    const contextLimit =
      (typeof override.context_limit === "number" && override.context_limit > 0
        ? override.context_limit
        : model?.limit?.context) ?? undefined;

    if (!contextLimit) {
      if (!this.missingLimitLogged.has(key)) {
        this.missingLimitLogged.add(key);
        console.warn(`[compaction] skipping ${key}: missing context limit`);
      }
      return undefined;
    }

    return {
      threshold: clampRatio(
        typeof override.threshold === "number" ? override.threshold : this.config.default_threshold,
      ),
      contextLimit,
    };
  }

  private async refreshProviders(force: boolean) {
    const now = Date.now();
    if (!force && now - this.providersLoadedAt < this.config.provider_refresh_ms) {
      return;
    }
    const result = await this.client.providers().catch(() => undefined);
    if (!result) return;

    this.providers.clear();
    for (const provider of result.all) {
      for (const [modelID, model] of Object.entries(provider.models ?? {})) {
        this.providers.set(`${provider.id}/${modelID}`, model);
      }
    }
    this.providersLoadedAt = now;
  }

  private createManagedSourceSession(session: SessionInfo) {
    const groupID = randomGroupID(this.state.groups);
    const baseTitle = normalizeTitle(session.title);
    const now = Date.now();
    this.state.groups[groupID] = {
      group_id: groupID,
      root_session_id: session.id,
      display_base_title: baseTitle,
      latest_session_id: session.id,
      next_index: 2,
      created_at: now,
      updated_at: now,
      status: "active",
    };
    const managed: ManagedSession = {
      session_id: session.id,
      group_id: groupID,
      index: 1,
      title: session.title,
      status: "monitoring",
      created_at: now,
      updated_at: now,
    };
    this.state.sessions[session.id] = managed;
    return managed;
  }

  private isTempSession(sessionID: string) {
    return Object.values(this.state.temp_runs).some((run) => run.temp_session_id === sessionID);
  }

  private async safeGetSession(sessionID: string) {
    try {
      return await this.client.getSession(sessionID);
    } catch {
      return undefined;
    }
  }

  private async failSession(sessionID: string, err: unknown) {
    const managed = this.state.sessions[sessionID];
    if (!managed) return;
    managed.status = "failed";
    managed.error = errorMessage(err);
    managed.updated_at = Date.now();
    const group = this.state.groups[managed.group_id];
    if (group) {
      group.status = "failed";
      group.updated_at = Date.now();
    }
    await this.persist();
    await this.client.log("error", "compaction intervention failed", {
      sessionID,
      groupID: managed.group_id,
      error: managed.error,
    });
  }

  private async loadConfig() {
    return (await loadWorkerConfig()).compaction;
  }

  private async loadState() {
    try {
      const raw = JSON.parse(await readText(stateFile));
      return parseState(raw);
    } catch {
      return emptyState();
    }
  }

  private async persist() {
    this.saveQueue = this.saveQueue
      .catch(() => undefined)
      .then(async () => {
        await writeJsonFile(stateFile, this.state);
      });
    await this.saveQueue;
  }

  private async verifyBuiltinCompactionDisabled() {
    if (!this.config.prevent_builtin_compaction) return;
    try {
      const raw = parseJsonc(await readText(path.resolve(root, "opencode.json")));
      if (!record(raw) || !record(raw.compaction) || raw.compaction.auto !== false) {
        console.warn("[compaction] opencode.json should set compaction.auto to false");
      }
    } catch {
      console.warn("[compaction] could not verify compaction.auto in opencode.json");
    }
  }
}

function parseState(input: unknown): CompactionState {
  if (!record(input)) return emptyState();

  const groups: CompactionState["groups"] = {};
  if (record(input.groups)) {
    for (const [key, value] of Object.entries(input.groups)) {
      const group = parseGroup(value);
      if (group) groups[key] = group;
    }
  }

  const sessions: CompactionState["sessions"] = {};
  if (record(input.sessions)) {
    for (const [key, value] of Object.entries(input.sessions)) {
      const session = parseManagedSession(value);
      if (session) sessions[key] = session;
    }
  }

  const tempRuns: CompactionState["temp_runs"] = {};
  if (record(input.temp_runs)) {
    for (const [key, value] of Object.entries(input.temp_runs)) {
      const run = parseSummaryRun(value);
      if (run) tempRuns[key] = run;
    }
  }

  return {
    version: 1,
    groups,
    sessions,
    temp_runs: tempRuns,
  };
}

function parseGroup(input: unknown): ContinuationGroup | undefined {
  if (!record(input)) return undefined;
  if (typeof input.group_id !== "string") return undefined;
  if (typeof input.root_session_id !== "string") return undefined;
  if (typeof input.display_base_title !== "string") return undefined;
  if (typeof input.latest_session_id !== "string") return undefined;
  if (typeof input.next_index !== "number") return undefined;
  if (typeof input.created_at !== "number") return undefined;
  if (typeof input.updated_at !== "number") return undefined;
  if (
    input.status !== "active" &&
    input.status !== "superseded" &&
    input.status !== "failed" &&
    input.status !== "archived"
  ) {
    return undefined;
  }
  return {
    group_id: input.group_id,
    root_session_id: input.root_session_id,
    display_base_title: input.display_base_title,
    latest_session_id: input.latest_session_id,
    next_index: input.next_index,
    created_at: input.created_at,
    updated_at: input.updated_at,
    status: input.status,
  };
}

function parseManagedSession(input: unknown): ManagedSession | undefined {
  if (!record(input)) return undefined;
  if (typeof input.session_id !== "string") return undefined;
  if (typeof input.group_id !== "string") return undefined;
  if (typeof input.index !== "number") return undefined;
  if (typeof input.title !== "string") return undefined;
  if (typeof input.status !== "string") return undefined;
  if (typeof input.created_at !== "number") return undefined;
  if (typeof input.updated_at !== "number") return undefined;
  return {
    session_id: input.session_id,
    group_id: input.group_id,
    index: input.index,
    title: input.title,
    agent: asString(input.agent),
    provider_id: asString(input.provider_id),
    model_id: asString(input.model_id),
    variant: asString(input.variant),
    threshold_ratio: asNumber(input.threshold_ratio),
    last_usage_ratio: asNumber(input.last_usage_ratio),
    last_tokens_total: asNumber(input.last_tokens_total),
    last_message_id: asString(input.last_message_id),
    status: input.status as ManagedStatus,
    abort_requested_at: asNumber(input.abort_requested_at),
    aborted_at: asNumber(input.aborted_at),
    superseded_by_session_id: asString(input.superseded_by_session_id),
    intervention_key: asString(input.intervention_key),
    summary_run_id: asString(input.summary_run_id),
    created_at: input.created_at,
    updated_at: input.updated_at,
    error: asString(input.error),
  };
}

function parseSummaryRun(input: unknown): SummaryRun | undefined {
  if (!record(input)) return undefined;
  if (typeof input.run_id !== "string") return undefined;
  if (typeof input.source_session_id !== "string") return undefined;
  if (typeof input.group_id !== "string") return undefined;
  if (typeof input.created_at !== "number") return undefined;
  if (input.status !== "created" && input.status !== "completed" && input.status !== "failed") {
    return undefined;
  }
  return {
    run_id: input.run_id,
    source_session_id: input.source_session_id,
    group_id: input.group_id,
    temp_session_id: asString(input.temp_session_id),
    created_at: input.created_at,
    completed_at: asNumber(input.completed_at),
    status: input.status,
    summary_message_id: asString(input.summary_message_id),
    summary_text: asString(input.summary_text),
    error: asString(input.error),
  };
}

function emptyState(): CompactionState {
  return {
    version: 1,
    groups: {},
    sessions: {},
    temp_runs: {},
  };
}

function unwrapSyncEvent(envelope: GlobalEventEnvelope): SyncPayload | undefined {
  if (!record(envelope) || !record(envelope.payload)) return undefined;
  if (envelope.payload.type !== "sync") return undefined;
  const sync = envelope.payload.syncEvent;
  if (!record(sync) || typeof sync.type !== "string" || !record(sync.data)) return undefined;
  return {
    type: sync.type,
    data: sync.data,
  };
}

function readAssistantInfo(input: unknown): AssistantMessageInfo | undefined {
  if (!record(input) || input.role !== "assistant") return undefined;
  if (typeof input.id !== "string") return undefined;
  if (typeof input.sessionID !== "string") return undefined;
  if (!record(input.time) || typeof input.time.created !== "number") return undefined;
  if (typeof input.parentID !== "string") return undefined;
  if (typeof input.modelID !== "string") return undefined;
  if (typeof input.providerID !== "string") return undefined;
  if (typeof input.agent !== "string") return undefined;
  if (!record(input.tokens)) return undefined;
  if (typeof input.tokens.input !== "number") return undefined;
  if (typeof input.tokens.output !== "number") return undefined;
  if (typeof input.tokens.reasoning !== "number") return undefined;
  if (!record(input.tokens.cache)) return undefined;
  if (typeof input.tokens.cache.read !== "number") return undefined;
  if (typeof input.tokens.cache.write !== "number") return undefined;
  return {
    id: input.id,
    sessionID: input.sessionID,
    role: "assistant",
    time: {
      created: input.time.created,
      completed: asNumber(input.time.completed),
    },
    parentID: input.parentID,
    modelID: input.modelID,
    providerID: input.providerID,
    agent: input.agent,
    summary: input.summary === true,
    cost: typeof input.cost === "number" ? input.cost : 0,
    tokens: {
      total: asNumber(input.tokens.total),
      input: input.tokens.input,
      output: input.tokens.output,
      reasoning: input.tokens.reasoning,
      cache: {
        read: input.tokens.cache.read,
        write: input.tokens.cache.write,
      },
    },
    finish: asString(input.finish),
    variant: asString(input.variant),
    error: record(input.error)
      ? {
          name: asString(input.error.name),
          data: record(input.error.data) ? { message: asString(input.error.data.message) } : undefined,
        }
      : undefined,
  };
}

function deriveHistory(
  history: MessageWithParts[],
  carryover: CompactionConfig["carryover"],
): DerivedHistory {
  const rounds: Round[] = [];
  let current: Round | undefined;

  for (const message of history) {
    if (message.info.role === "user") {
      if (message.parts.some((part) => part.type === "compaction")) continue;
      current = {
        userMessageID: message.info.id,
        userText: summarizeUserMessage(message),
        fileRefs: extractFileRefs(message.parts),
        assistantMessages: [],
      };
      rounds.push(current);
      continue;
    }
    if (message.info.role !== "assistant") continue;
    if (!current) continue;
    current.assistantMessages.push({
      info: message.info,
      parts: message.parts,
    } as AssistantTurnMessage);
  }

  const completedRounds = rounds.slice(0, -1);
  const activeRound = rounds[rounds.length - 1];
  const recentCarryover = buildRecentCarryover(activeRound, carryover);
  const filesToRemember = collectFileRefs(history);
  const latestAssistant = findLastAssistant(history);
  const stableGoal = pickStableGoal(rounds);
  const pendingRisks = collectPendingRisks(activeRound, latestAssistant);

  return {
    completedRounds,
    activeRound,
    recentCarryover,
    filesToRemember,
    latestAgent: latestAssistant?.info.agent,
    latestModel: latestAssistant
      ? {
          providerID: latestAssistant.info.providerID,
          modelID: latestAssistant.info.modelID,
          variant: latestAssistant.info.variant,
        }
      : undefined,
    stableGoal,
    pendingRisks,
  };
}

function buildRecentCarryover(activeRound: Round | undefined, carryover: CompactionConfig["carryover"]) {
  if (!activeRound) return ["- No active assistant carryover captured."];

  const selected = activeRound.assistantMessages.slice(-carryover.max_recent_assistant_messages);
  const lines: string[] = [];
  let remainingChars = carryover.max_recent_text_chars;
  let toolCount = 0;

  for (const message of selected) {
    const chunks: string[] = [];
    const text = truncate(composeTextSummary(message.parts), Math.min(remainingChars, 1800));
    if (text) {
      chunks.push(`Assistant text: ${text}`);
      remainingChars -= text.length;
    }

    for (const part of message.parts) {
      if (!isToolPart(part)) continue;
      if (toolCount >= carryover.max_recent_tool_parts) break;
      toolCount += 1;
      if (part.state.status === "completed") {
        chunks.push(
          `Tool ${part.tool}: ${part.state.title}${part.state.output ? ` -> ${truncate(collapse(part.state.output), 400)}` : ""}`,
        );
      } else if (part.state.status === "error") {
        chunks.push(`Tool ${part.tool} error: ${truncate(collapse(part.state.error), 300)}`);
      } else if (part.state.status === "running") {
        chunks.push(`Tool ${part.tool}: still running when aborted`);
      }
    }

    const patchFiles = message.parts
      .filter(isPatchPart)
      .flatMap((part) => part.files);
    if (patchFiles.length > 0) {
      chunks.push(`Patched files: ${patchFiles.join(", ")}`);
    }

    if (message.info.error?.name) {
      chunks.push(`Assistant error: ${message.info.error.name}`);
    }

    if (chunks.length > 0) {
      lines.push(`- ${chunks.join(" | ")}`);
    }
    if (remainingChars <= 0) break;
  }

  return lines.length > 0 ? lines : ["- No active assistant carryover captured."];
}

function buildSourceDocument(input: {
  session: SessionInfo;
  group: ContinuationGroup;
  derived: DerivedHistory;
  managed: ManagedSession;
}) {
  const { session, group, derived, managed } = input;
  const lines = [
    "# Source Session",
    "",
    `Session title: ${session.title}`,
    `Session ID: ${session.id}`,
    `Continuation group: ${group.group_id}`,
    managed.provider_id && managed.model_id
      ? `Model: ${managed.provider_id}/${managed.model_id}${managed.variant ? ` [variant ${managed.variant}]` : ""}`
      : "Model: (unknown)",
    `Aborted at: ${managed.aborted_at ? iso(managed.aborted_at) : "(unknown)"}`,
    "",
  ];

  derived.completedRounds.forEach((round, idx) => {
    lines.push(`## Completed Round ${idx + 1}`);
    lines.push("### User");
    lines.push(round.userText || "(empty)");
    lines.push("");
    lines.push("### Assistant Work");
    lines.push(summarizeRoundWork(round.assistantMessages));
    lines.push("");
  });

  if (derived.activeRound) {
    lines.push("## Active Round");
    lines.push("### User");
    lines.push(derived.activeRound.userText || "(empty)");
    lines.push("");
    lines.push("### Recent Assistant Messages");
    lines.push(...derived.recentCarryover);
    lines.push("");
  }

  lines.push("## Files / Paths");
  if (derived.filesToRemember.length === 0) {
    lines.push("- (none)");
  } else {
    lines.push(...derived.filesToRemember.map((item) => `- ${item}`));
  }

  if (derived.pendingRisks.length > 0) {
    lines.push("");
    lines.push("## Risks / Unknowns");
    lines.push(...derived.pendingRisks.map((item) => `- ${item}`));
  }

  return lines.join("\n").trim();
}

function buildSummarizerPrompt(sourceDocument: string) {
  return [
    "You are preparing continuation context for a compaction-managed OpenCode rollover.",
    "Return only Markdown.",
    "",
    "Use exactly these top-level sections in this order:",
    "## Stable Goal",
    "## Global Constraints",
    "## Turn 1 (if a completed turn exists)",
    "### User Request",
    "### Completed Work Summary",
    "## Turn 2 (if needed)",
    "## Active Turn",
    "### User Request",
    "### Work In Progress",
    "### Pending Risks / Unknowns",
    "## Recent Carryover",
    "## Files / Paths / Entities To Remember",
    "## Next Agent Brief",
    "",
    "Rules:",
    "- Preserve user intent faithfully.",
    "- Summarize completed work rather than replaying every intermediate step.",
    "- Distinguish verified work from interrupted or uncertain work.",
    "- Keep exact file paths, commands, model IDs, errors, and identifiers when useful.",
    "- Keep the output compact and continuation-focused.",
    "- Do not mention this prompt, the summarization process, or provider token limits.",
    "",
    sourceDocument,
  ].join("\n");
}

function buildRetrySummarizerPrompt(sourceDocument: string, previous: string) {
  return [
    "Your previous reply did not satisfy the required structure. Redo it from scratch.",
    "Return only Markdown with the exact required headings.",
    "",
    "Invalid previous reply:",
    previous || "(empty)",
    "",
    buildSummarizerPrompt(sourceDocument),
  ].join("\n");
}

function buildFallbackSummary(input: {
  derived: DerivedHistory;
  group: ContinuationGroup;
  sourceSessionID: string;
}) {
  const { derived, group, sourceSessionID } = input;
  const lines = [
    "## Stable Goal",
    `- ${derived.stableGoal}`,
    "",
    "## Global Constraints",
    "- Re-verify any uncertain detail from the workspace before acting on it.",
    "",
  ];

  derived.completedRounds.forEach((round, idx) => {
    lines.push(`## Turn ${idx + 1}`);
    lines.push("### User Request");
    lines.push(`- ${truncate(collapse(round.userText || "(empty)"), 600)}`);
    lines.push("### Completed Work Summary");
    lines.push(...summarizeRoundWorkBullets(round.assistantMessages));
    lines.push("");
  });

  lines.push("## Active Turn");
  lines.push("### User Request");
  lines.push(`- ${truncate(collapse(derived.activeRound?.userText || "(empty)"), 600)}`);
  lines.push("### Work In Progress");
  lines.push(...(derived.recentCarryover.length > 0 ? derived.recentCarryover : ["- (none)"]));
  lines.push("### Pending Risks / Unknowns");
  lines.push(...(derived.pendingRisks.length > 0 ? derived.pendingRisks.map((item) => `- ${item}`) : ["- (none)"]));
  lines.push("");
  lines.push("## Recent Carryover");
  lines.push(...(derived.recentCarryover.length > 0 ? derived.recentCarryover : ["- (none)"]));
  lines.push("");
  lines.push("## Files / Paths / Entities To Remember");
  lines.push(...(derived.filesToRemember.length > 0 ? derived.filesToRemember.map((item) => `- ${item}`) : ["- (none)"]));
  lines.push("");
  lines.push("## Next Agent Brief");
  lines.push(`- Continue the latest work for continuation group ${group.group_id}.`);
  lines.push(`- This continuation was created from source session ${sourceSessionID}.`);
  lines.push("- Re-check any uncertain assumptions directly in the workspace before taking action.");
  return lines.join("\n");
}

function buildContinuationPrompt(input: {
  summaryText: string;
  groupID: string;
  sourceSessionID: string;
  continuationSessionID: string;
  priorSessionIDs: string[];
}) {
  return [
    "You are continuing a previously interrupted OpenCode task after a compaction-managed context rollover.",
    "",
    "Use the structured history below as the authoritative summary of prior work.",
    "",
    `<compaction_metadata group_id="${input.groupID}" source_session_id="${input.sourceSessionID}" continuation_session_id="${input.continuationSessionID}">`,
    `prior_sessions: ${input.priorSessionIDs.join(", ")}`,
    "</compaction_metadata>",
    "",
    "<custom_summary>",
    input.summaryText.trim(),
    "</custom_summary>",
    "",
    "Important instructions:",
    "- Continue the active turn rather than restarting the whole task.",
    "- Re-verify assumptions if the summary marks them as uncertain.",
    "- If a needed detail is missing, inspect the workspace rather than guessing.",
    "- Prefer continuing from the latest in-progress work described in `Active Turn` and `Recent Carryover`.",
    "- The previous session was interrupted intentionally to avoid context overflow.",
  ].join("\n");
}

function summarizeRoundWork(messages: AssistantTurnMessage[]) {
  const bullets = summarizeRoundWorkBullets(messages);
  return bullets.length > 0 ? bullets.join("\n") : "- (none)";
}

function summarizeRoundWorkBullets(messages: AssistantTurnMessage[]) {
  const lines: string[] = [];
  for (const message of messages.slice(-3)) {
    const text = truncate(composeTextSummary(message.parts), 700);
    const toolSummary = summarizeTools(message.parts, 2);
    const patchSummary = summarizePatchFiles(message.parts);
    const chunks = [text, toolSummary, patchSummary, summarizeError(message.info.error)]
      .filter(Boolean)
      .map((item) => item as string);
    if (chunks.length > 0) {
      lines.push(`- ${chunks.join(" | ")}`);
    }
  }
  return lines.length > 0 ? lines : ["- (none)"];
}

function summarizeUserMessage(message: MessageWithParts) {
  const text = composeTextSummary(message.parts);
  const refs = extractFileRefs(message.parts);
  if (!text && refs.length === 0) return "";
  if (refs.length === 0) return text;
  return [text || "(no plain text)", `Files: ${refs.join(", ")}`].filter(Boolean).join("\n\n");
}

function composeTextSummary(parts: MessagePart[]) {
  const text = parts
    .filter(
      (part): part is Extract<MessagePart, { type: "text" | "reasoning" }> =>
        part.type === "text" || part.type === "reasoning",
    )
    .map((part) => collapse(part.text))
    .filter(Boolean)
    .join(" ")
    .trim();
  return truncate(text, 1800);
}

function summarizeTools(parts: MessagePart[], max: number) {
  const tools = parts.filter(isToolPart).slice(0, max);
  if (tools.length === 0) return "";
  return tools
    .map((tool) => {
      if (tool.state.status === "completed") {
        return `${tool.tool}: ${tool.state.title}${tool.state.output ? ` -> ${truncate(collapse(tool.state.output), 240)}` : ""}`;
      }
      if (tool.state.status === "error") {
        return `${tool.tool} error: ${truncate(collapse(tool.state.error), 180)}`;
      }
      return `${tool.tool}: ${tool.state.status}`;
    })
    .join("; ");
}

function summarizePatchFiles(parts: MessagePart[]) {
  const files = parts
    .filter(isPatchPart)
    .flatMap((part) => part.files);
  if (files.length === 0) return "";
  return `Patched files: ${files.join(", ")}`;
}

function summarizeError(error: AssistantMessageInfo["error"]) {
  if (!error?.name) return "";
  return `Assistant error: ${error.name}${error.data?.message ? ` (${truncate(collapse(error.data.message), 180)})` : ""}`;
}

function collectFileRefs(history: MessageWithParts[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const message of history) {
    for (const ref of extractFileRefs(message.parts)) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      result.push(ref);
      if (result.length >= 20) return result;
    }
  }
  return result;
}

function extractFileRefs(parts: MessagePart[]) {
  const refs: string[] = [];
  for (const part of parts) {
    if (isFilePart(part)) {
      refs.push(part.filename ?? part.url);
    }
    if (isPatchPart(part)) {
      refs.push(...part.files);
    }
    if (isToolPart(part) && part.state.status === "completed" && part.state.attachments) {
      refs.push(...part.state.attachments.map((item) => item.filename ?? item.url));
    }
  }
  return [...new Set(refs)];
}

function pickStableGoal(rounds: Round[]) {
  const first = rounds.find((round) => collapse(round.userText));
  return first ? truncate(collapse(first.userText), 400) : "Continue the interrupted task faithfully.";
}

function collectPendingRisks(activeRound: Round | undefined, latestAssistant: AssistantTurnMessage | undefined) {
  const risks: string[] = [];
  if (!activeRound) {
    risks.push("No active round was reconstructed from session history.");
  }
  if (latestAssistant?.info.error?.name) {
    risks.push(`Latest assistant message ended with ${latestAssistant.info.error.name}.`);
  }
  if (
    activeRound &&
    activeRound.assistantMessages.some((msg) => msg.parts.some((part) => isToolPart(part) && part.state.status === "running"))
  ) {
    risks.push("At least one tool call was still running when the session was aborted.");
  }
  return risks;
}

function isFilePart(part: MessagePart): part is Extract<MessagePart, { type: "file" }> {
  return part.type === "file" && typeof part.url === "string";
}

function isPatchPart(part: MessagePart): part is Extract<MessagePart, { type: "patch" }> {
  return part.type === "patch" && Array.isArray(part.files) && part.files.every((file) => typeof file === "string");
}

function isToolPart(part: MessagePart): part is Extract<MessagePart, { type: "tool" }> {
  return part.type === "tool" && record(part.state) && typeof part.tool === "string";
}

function findLastAssistant(history: MessageWithParts[]) {
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i];
    if (message.info.role === "assistant") {
      return {
        info: message.info,
        parts: message.parts,
      } as AssistantTurnMessage;
    }
  }
  return undefined;
}

function extractText(message: MessageWithParts) {
  return message.parts
    .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
    .map((part) => part.text.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function isValidSummary(text: string) {
  if (!text.trim()) return false;
  return (
    /## Stable Goal/i.test(text) &&
    /## Active Turn/i.test(text) &&
    /## Recent Carryover/i.test(text) &&
    /## Next Agent Brief/i.test(text)
  );
}

function normalizeTitle(title: string) {
  const stripped = title.replace(/\s*\[ctx-[a-z0-9]+\]\s+#\d+$/i, "").trim();
  return stripped || "Untitled Task";
}

function formatTitle(baseTitle: string, groupID: string, index: number) {
  return `${baseTitle} [${groupID}] #${index}`;
}

function randomGroupID(groups: Record<string, ContinuationGroup>) {
  while (true) {
    const value = `ctx-${randomSuffix(4)}`;
    if (!groups[value]) return value;
  }
}

function randomSuffix(length: number) {
  let out = "";
  while (out.length < length) {
    out += Math.random().toString(36).slice(2);
  }
  return out.slice(0, length).toLowerCase();
}

function tokenCount(tokens: AssistantMessageInfo["tokens"]) {
  if (typeof tokens.total === "number") return tokens.total;
  return tokens.input + tokens.output + tokens.cache.read + tokens.cache.write;
}

function collectPriorSessions(state: CompactionState, groupID: string) {
  return Object.values(state.sessions)
    .filter((session) => session.group_id === groupID)
    .sort((a, b) => a.index - b.index)
    .map((session) => session.session_id);
}

function readUpdatedTitle(input: unknown) {
  if (!record(input)) return undefined;
  return typeof input.title === "string" ? input.title : undefined;
}

function readStatus(input: unknown): SessionStatusInfo | undefined {
  if (!record(input) || typeof input.type !== "string") return undefined;
  if (input.type === "idle") return { type: "idle" };
  if (input.type === "busy") return { type: "busy" };
  if (
    input.type === "retry" &&
    typeof input.attempt === "number" &&
    typeof input.message === "string" &&
    typeof input.next === "number"
  ) {
    return {
      type: "retry",
      attempt: input.attempt,
      message: input.message,
      next: input.next,
    };
  }
  return undefined;
}

function readErrorName(input: unknown) {
  if (!record(input)) return undefined;
  return typeof input.name === "string" ? input.name : undefined;
}

function asString(input: unknown) {
  return typeof input === "string" ? input : undefined;
}

function asNumber(input: unknown) {
  return typeof input === "number" ? input : undefined;
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function defaultCompactionConfig(): CompactionConfig {
  return {
    enabled: true,
    default_threshold: 0.7,
    models: {},
    carryover: {
      max_recent_assistant_messages: 3,
      max_recent_tool_parts: 6,
      max_recent_text_chars: 12_000,
    },
    summarizer: {
      providerID: "zai-coding-plan",
      modelID: "glm-5.1",
    },
    rename_original: true,
    rename_delay_ms: 500,
    temp_session_cleanup: "archive",
    prevent_builtin_compaction: true,
    abort_wait_ms: 15_000,
    history_retry_count: 3,
    provider_refresh_ms: 300_000,
  };
}
