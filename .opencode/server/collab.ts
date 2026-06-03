import { Database } from "bun:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadWorkerConfig } from "./config";
import type { CollabConfig, CollabInstructionSource } from "./config";
import { sleep } from "./shared";
import { OpenCodeRequestError } from "./shared";
import type { ModelRef, OpenCodeClient, QuestionRequest, SessionStatusInfo } from "./shared";

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;

export type PaginationParams = {
  since?: string;
  limit: number;
};

export type RoomListParams = {
  state: "open" | "closed" | "all";
  before?: string;
  limit: number;
};

export const FALLBACK_ROOM_JOIN_INSTRUCTION =
  "You are joining collaboration room {room} as {alias} ({role}). Coordinate through agent-collab. Reply with ready to confirm your availability.";

export const FALLBACK_REPLY_INSTRUCTION =
  "Reply to the room with agent-collab as {alias}. Preserve room context and address relevant collaborators.";

export type TemplateVars = Partial<Record<"room" | "alias" | "role" | "from", string>>;

export type CollabTemplates = {
  room_join_instruction: string;
  reply_instruction: string;
};

const ALIAS_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

type RoomRow = {
  id: string;
  base_name: string;
  name: string;
  project_dir: string | null;
  state: "open" | "closed";
  public_message: string | null;
  public_message_updated_at: number | null;
  public_message_updated_by: string | null;
  planner_password_hash: string;
  created_at: number;
  closed_at: number | null;
};

type MemberRow = {
  room_id: string;
  session_id: string;
  name: string;
  role: string;
  state: string;
  joined_at: number;
  directory: string | null;
  agent: string | null;
  model_provider_id: string | null;
  model_id: string | null;
  model_variant: string | null;
};

type DeliveryTarget = {
  session_id: string;
  name: string;
};

type MessageTargetPlan = {
  mentions: string[];
  targets: DeliveryTarget[];
  mode: "buffered" | "immediate" | "hard";
};

type QuestionTargetPlan = {
  mentions: string[];
  targets: DeliveryTarget[];
};

type MessageRow = {
  id: string;
  room_id: string;
  sender_type: string;
  sender_id: string | null;
  sender_name: string;
  body: string;
  kind: string;
  mentions: string | null;
  parent_id: string | null;
  created_at: number;
};

type DeliveryRow = {
  message_id: string;
  target_session_id: string;
  target_name: string;
  mode: string;
  state: string;
  injected_at: number | null;
  attempt_count: number;
  last_error: string | null;
  created_at: number;
};

type PendingDeliveryRow = DeliveryRow & {
  room_id: string;
  room_name: string;
  room_state: "open" | "closed";
  public_message: string | null;
  message_sender_name: string;
  message_body: string;
  message_kind: string;
  message_created_at: number;
  member_role: string | null;
  directory: string | null;
  agent: string | null;
  model_provider_id: string | null;
  model_id: string | null;
  model_variant: string | null;
};

type SpawnInput = {
  sessionId: string;
  from: string;
  name: string;
  role: string;
  agent?: string;
  model?: ModelRef;
  directory?: string;
  initialPrompt?: string;
  now: number;
};

type SpawnPromptOptions = {
  agent?: string;
  model?: ModelRef;
  directory?: string;
};

type AgentModelRow = {
  directory: string | null;
  agent: string | null;
  model_provider_id: string | null;
  model_id: string | null;
  model_variant: string | null;
};

export type SessionHandoffResult = {
  roomId: string;
  roomName: string;
  memberName: string;
  memberRole: string;
  memberAlias: string;
  skipped: boolean;
  reason?: string;
};

type DeliveryFailureClassification = "retryable" | "permanent";

export class CollabService {
  private db?: CollabStorage;
  private config?: CollabConfig;
  private server?: { stop(force?: boolean): void };
  private deliveryTimer?: ReturnType<typeof setInterval>;
  private deliveryFlush?: Promise<void>;
  private deliveryFlushRequested = false;

  constructor(
    private readonly client: OpenCodeClient,
    private readonly configLoader: () => Promise<CollabConfig> = async () => (await loadWorkerConfig()).collab,
  ) {}

  async start() {
    this.config = await this.configLoader();
    if (!this.config.enabled) {
      await this.client.log("info", "collab service disabled");
      return;
    }

    this.db = await CollabStorage.open(this.config.db_path);
    this.server = Bun.serve({
      hostname: this.config.host,
      port: this.config.port,
      fetch: (request) => this.handleRequest(request),
    });
    this.deliveryTimer = setInterval(() => {
      void this.tickDelivery().catch((error) => this.logDeliveryError("delivery tick failed", error));
    }, this.config.poll_interval_ms);
    await this.client.log("info", "collab service started", {
      host: this.config.host,
      port: this.config.port,
      db_path: this.config.db_path,
      poll_interval_ms: this.config.poll_interval_ms,
    });
  }

  async shutdown() {
    if (this.deliveryTimer) clearInterval(this.deliveryTimer);
    this.deliveryTimer = undefined;
    this.server?.stop(true);
    this.server = undefined;
    this.db?.close();
    this.db = undefined;
  }

  get active() {
    return this.db !== undefined;
  }

  get loadedConfig() {
    return this.config;
  }

  async handleDeliveryEvent() {
    await this.flushPendingDeliveriesOnce();
  }

  async handleSessionSuperseded(sourceSessionId: string, continuationSessionId: string, metadata?: { groupID?: string; reason?: string }) {
    if (!this.db) return;
    try {
      const results = this.db.handleSessionHandoff({
        oldSessionId: sourceSessionId,
        newSessionId: continuationSessionId,
        reason: metadata?.reason ?? "compaction",
        now: Date.now(),
      });
      if (results.some((r) => !r.skipped)) {
        await this.flushPendingDeliveriesOnce();
      }
    } catch (err) {
      await this.logDeliveryError(`collab handoff failed for ${sourceSessionId} -> ${continuationSessionId}`, err);
    }
  }

  async tickDelivery() {
    await this.flushPendingDeliveriesOnce();
  }

  async handleRequest(request: Request): Promise<Response> {
    if (!this.db) return jsonResponse({ error: "collab service disabled" }, 503);

    const url = new URL(request.url);
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (request.method === "POST" && parts.length === 1 && parts[0] === "room") {
        return jsonResponse(await this.createRoom(await readJsonObject(request)), 201);
      }

      if (request.method === "GET" && parts.length === 2 && parts[0] === "room" && parts[1] === "list") {
        return jsonResponse({ rooms: this.db.listRooms(parseRoomListParams(url.searchParams)) });
      }

      if (request.method === "GET" && parts.length === 3 && parts[0] === "room" && parts[2] === "status") {
        return jsonResponse(this.db.roomStatus(parts[1]));
      }

      if (request.method === "DELETE" && parts.length === 2 && parts[0] === "room") {
        return jsonResponse(await this.closeRoom(parts[1], await readJsonObject(request)));
      }

      if (request.method === "POST" && parts.length === 3 && parts[0] === "room" && parts[2] === "public-message") {
        return jsonResponse(this.setPublicMessage(parts[1], await readJsonObject(request)));
      }

      if (request.method === "DELETE" && parts.length === 3 && parts[0] === "room" && parts[2] === "public-message") {
        return jsonResponse(this.clearPublicMessage(parts[1], await readJsonObject(request)));
      }

      if (request.method === "POST" && parts.length === 3 && parts[0] === "room" && parts[2] === "member") {
        return jsonResponse(await this.addMember(parts[1], await readJsonObject(request)), 201);
      }

      if (request.method === "POST" && parts.length === 3 && parts[0] === "room" && parts[2] === "join") {
        return jsonResponse(await this.joinRoom(parts[1], await readJsonObject(request)), 201);
      }

      if (request.method === "POST" && parts.length === 3 && parts[0] === "room" && parts[2] === "spawn") {
        return jsonResponse(await this.spawnMember(parts[1], await readJsonObject(request)), 201);
      }

      if (request.method === "DELETE" && parts.length === 3 && parts[0] === "room" && parts[2] === "leave") {
        return jsonResponse(this.leaveRoom(parts[1], await readJsonObject(request)));
      }

      if (request.method === "DELETE" && parts.length === 3 && parts[0] === "room" && parts[2] === "member") {
        return jsonResponse(this.removeMember(parts[1], await readJsonObject(request)));
      }

      if (request.method === "POST" && parts.length === 3 && parts[0] === "room" && parts[2] === "message") {
        return jsonResponse(this.sendMessage(parts[1], await readJsonObject(request)), 201);
      }

      if (request.method === "POST" && parts.length === 3 && parts[0] === "room" && parts[2] === "ask") {
        return jsonResponse(this.askQuestion(parts[1], await readJsonObject(request)), 201);
      }

      if (request.method === "POST" && parts.length === 3 && parts[0] === "room" && parts[2] === "answer") {
        return jsonResponse(this.answerQuestion(parts[1], await readJsonObject(request)), 201);
      }

      if (request.method === "GET" && parts.length === 3 && parts[0] === "room" && parts[2] === "messages") {
        return jsonResponse(this.listMessages(parts[1], url.searchParams));
      }

      return jsonResponse({ error: "not found" }, 404);
    } catch (error) {
      return errorResponse(error);
    }
  }

  private async createRoom(input: Record<string, unknown>) {
    const baseName = requireString(input, "name");
    const sessionId = requireString(input, "session_id");
    const founderName = requireAlias(input, "from");
    const projectDir = optionalString(input, "project_dir");
    const now = Date.now();

    if (this.db?.openRoomForSession(sessionId)) {
      throw httpError(409, "founder session already belongs to an open room");
    }

    const agentModel = await this.sessionAgentModel(sessionId);
    const password = generatePlannerPassword();
    const passwordHash = await hashPlannerPassword(password);
    const room = this.db!.createRoom({
      id: `room_${randomUUID()}`,
      baseName,
      name: this.db!.uniqueRoomName(baseName, now),
      projectDir,
      plannerPasswordHash: passwordHash,
      createdAt: now,
      founder: { sessionId, name: founderName, joinedAt: now, agentModel },
    });

    return {
      room_id: room.id,
      base_name: room.base_name,
      name: room.name,
      project_dir: room.project_dir,
      state: room.state,
      founder: {
        session_id: sessionId,
        name: founderName,
        role: "planner",
      },
      planner_password: password,
    };
  }

  private async closeRoom(roomRef: string, input: Record<string, unknown>) {
    const sessionId = requireString(input, "session_id");
    const from = requireAlias(input, "from");
    return this.db!.closeRoom(roomRef, sessionId, from, Date.now());
  }

  private async addMember(roomRef: string, input: Record<string, unknown>) {
    if (!this.config) throw httpError(503, "collab service disabled");
    const sessionId = requireString(input, "session_id");
    const from = requireAlias(input, "from");
    const targetSessionId = requireString(input, "target_session_id");
    const name = requireAlias(input, "name");
    const role = requireString(input, "role");
    const room = this.db!.validateAddMember(roomRef, { sessionId, from, targetSessionId, name });
    const templates = await resolveCollabTemplates(this.config, { room: room.name, alias: name, role, from });
    const agentModel = await this.sessionAgentModel(targetSessionId);
    return this.db!.addMember(room.id, {
      sessionId,
      from,
      targetSessionId,
      name,
      role,
      roomJoinInstruction: templates.room_join_instruction,
      agentModel,
      now: Date.now(),
    });
  }

  private async joinRoom(roomRef: string, input: Record<string, unknown>) {
    if (!this.config) throw httpError(503, "collab service disabled");
    const sessionId = requireString(input, "session_id");
    const name = requireAlias(input, "name");
    const password = requireString(input, "password");
    const room = this.db!.openRoom(roomRef);
    if (!(await verifyPlannerPassword(password, room.planner_password_hash))) throw httpError(403, "invalid planner password");
    const templates = await resolveCollabTemplates(this.config, { room: room.name, alias: name, role: "planner", from: "system" });
    const agentModel = await this.sessionAgentModel(sessionId);
    return this.db!.selfJoin(room.id, { sessionId, name, roomJoinInstruction: templates.room_join_instruction, agentModel, now: Date.now() });
  }

  private async spawnMember(roomRef: string, input: Record<string, unknown>) {
    if (!this.config) throw httpError(503, "collab service disabled");
    const spawn: SpawnInput = {
      sessionId: requireString(input, "session_id"),
      from: requireAlias(input, "from"),
      name: requireAlias(input, "name"),
      role: requireString(input, "role"),
      agent: optionalString(input, "agent"),
      model: optionalModel(input),
      directory: optionalString(input, "directory"),
      initialPrompt: optionalString(input, "initial_prompt"),
      now: Date.now(),
    };

    const room = this.db!.validateSpawn(roomRef, spawn);
    const defaults = await this.callerDefaults(spawn.sessionId);
    const selectedPrompt = {
      agent: spawn.agent ?? defaults.agent,
      model: spawn.model ?? defaults.model,
    };
    const session = await this.client.createSpawnSession({ title: `Collab: ${room.name}/${spawn.name}`, directory: spawn.directory });
    const spawnPrompt = {
      ...selectedPrompt,
      directory: session.directory ?? spawn.directory,
    };
    const templates = await resolveCollabTemplates(this.config, {
      room: room.name,
      alias: spawn.name,
      role: spawn.role,
      from: spawn.from,
    });
    return this.db!.addSpawnedMember(room.id, {
      ...spawn,
      targetSessionId: session.id,
      roomJoinInstruction: templates.room_join_instruction,
      spawnPrompt,
    });
  }

  private async callerDefaults(sessionId: string) {
    const [session, messages] = await Promise.all([
      this.client.getSession(sessionId).catch(() => undefined),
      this.client.sessionMessages(sessionId).catch(() => []),
    ]);
    for (const message of [...messages].reverse()) {
      if (message.info.role === "assistant") {
        return {
          agent: message.info.agent,
          model: { providerID: message.info.providerID, modelID: message.info.modelID, variant: message.info.variant },
          directory: session?.directory,
        };
      }
      if (message.info.role === "user" && message.info.agent && message.info.model) {
        return { agent: message.info.agent, model: message.info.model, directory: session?.directory };
      }
    }
    return { directory: session?.directory };
  }

  private async sessionAgentModel(sessionId: string): Promise<SpawnPromptOptions> {
    const [session, messages] = await Promise.all([
      this.client.getSession(sessionId).catch(() => undefined),
      this.client.sessionMessages(sessionId).catch(() => []),
    ]);
    for (const message of [...messages].reverse()) {
      if (message.info.role === "user") return { agent: message.info.agent, model: message.info.model, directory: session?.directory };
    }
    return { directory: session?.directory };
  }

  private leaveRoom(roomRef: string, input: Record<string, unknown>) {
    const sessionId = requireString(input, "session_id");
    const from = requireAlias(input, "from");
    return this.db!.leaveMember(roomRef, { sessionId, from, now: Date.now() });
  }

  private removeMember(roomRef: string, input: Record<string, unknown>) {
    const sessionId = requireString(input, "session_id");
    const from = requireAlias(input, "from");
    const target = requireAlias(input, "target");
    return this.db!.removeMember(roomRef, { sessionId, from, target, now: Date.now() });
  }

  private setPublicMessage(roomRef: string, input: Record<string, unknown>) {
    const sessionId = requireString(input, "session_id");
    const from = requireAlias(input, "from");
    const body = requireString(input, "body");
    return this.db!.setPublicMessage(roomRef, { sessionId, from, body, now: Date.now() });
  }

  private clearPublicMessage(roomRef: string, input: Record<string, unknown>) {
    const sessionId = requireString(input, "session_id");
    const from = requireAlias(input, "from");
    return this.db!.clearPublicMessage(roomRef, { sessionId, from, now: Date.now() });
  }

  private sendMessage(roomRef: string, input: Record<string, unknown>) {
    const sessionId = requireString(input, "session_id");
    const from = requireAlias(input, "from");
    const body = requireString(input, "body");
    const kind = optionalString(input, "kind") ?? "note";
    const hard = optionalBoolean(input, "hard") ?? false;
    return this.db!.sendMemberMessage(roomRef, { sessionId, from, body, kind, hard, now: Date.now() });
  }

  private askQuestion(roomRef: string, input: Record<string, unknown>) {
    const sessionId = requireString(input, "session_id");
    const from = requireAlias(input, "from");
    const body = requireString(input, "body");
    return this.db!.askQuestion(roomRef, { sessionId, from, body, now: Date.now() });
  }

  private answerQuestion(roomRef: string, input: Record<string, unknown>) {
    const sessionId = requireString(input, "session_id");
    const from = requireAlias(input, "from");
    const parentId = requireString(input, "parent");
    const body = requireString(input, "body");
    return this.db!.answerQuestion(roomRef, { sessionId, from, parentId, body, now: Date.now() });
  }

  private listMessages(roomRef: string, params: URLSearchParams) {
    const sessionId = params.get("session_id") ?? undefined;
    const from = params.get("from") ?? undefined;
    const pagination = parsePaginationParams(params);
    if (sessionId !== undefined || from !== undefined) {
      return this.db!.memberMessages(roomRef, sessionId, from, pagination);
    }
    return this.db!.roomMessages(roomRef, pagination);
  }

  private async flushPendingDeliveries() {
    if (!this.db) return;
    for (const messageId of this.db.pendingHardMessageIds()) {
      await this.attemptHardFlush(messageId);
    }

    const targetSessionIds = this.db.pendingDeliveryTargets();
    if (targetSessionIds.length === 0) return;

    const [statuses, questions] = await Promise.all([this.client.sessionStatus(), this.client.pendingQuestions()]);
    for (const targetSessionId of targetSessionIds) {
      await this.attemptFlush(targetSessionId, statuses[targetSessionId], questions);
    }
  }

  private async flushPendingDeliveriesOnce() {
    if (this.deliveryFlush) {
      this.deliveryFlushRequested = true;
      return await this.deliveryFlush;
    }
    // Coalesce overlapping SSE and poll triggers without dropping a request that arrives mid-flush.
    let flush!: Promise<void>;
    flush = (async () => {
      try {
        do {
          this.deliveryFlushRequested = false;
          await this.flushPendingDeliveries();
        } while (this.deliveryFlushRequested);
      } finally {
        if (this.deliveryFlush === flush) this.deliveryFlush = undefined;
      }
    })();
    this.deliveryFlush = flush;
    await flush;
  }

  async attemptHardFlush(messageId: string) {
    if (!this.db || !this.config) return { flushed: false, reason: "disabled" };
    const targets = this.db.pendingHardDeliveries(messageId);
    if (targets.length === 0) return { flushed: false, reason: "empty" };

    try {
      await Promise.all(
        targets.map((delivery) => this.client.abortSession(delivery.target_session_id, this.db!.memberRouteForSession(delivery.target_session_id))),
      );
    } catch (error) {
      const reason = `hard abort failed: ${error instanceof Error ? error.message : String(error)}`;
      this.db.markDeliveryFailure(targets, reason, classifyDeliveryFailure(error));
      return { flushed: false, reason: "abort_failed" };
    }

    const wait = await this.waitForHardTargetsIdle(
      targets.map((delivery) => delivery.target_session_id),
      hardAbortWaitMs(targets.length, this.config.hard_abort_wait_ms, this.config.hard_abort_wait_max_ms),
    );
    if (!wait.ok) {
      this.db.markDeliveriesFailed(targets, `hard idle wait timed out: ${wait.targetSessionId}`);
      return { flushed: false, reason: "idle_timeout" };
    }

    const batches = targets.map((target) => {
      const backlog = this.db!.pendingBacklogForTarget(target.target_session_id);
      const hardIndex = backlog.findIndex((delivery) => delivery.message_id === messageId && delivery.mode === "hard");
      return { target, backlog: hardIndex >= 0 ? backlog.slice(0, hardIndex + 1) : [] };
    });
    if (batches.some((batch) => batch.backlog.length === 0)) {
      this.db.markDeliveriesFailed(targets, "hard delivery missing from backlog");
      return { flushed: false, reason: "missing_backlog" };
    }

    try {
      const replyInstructionTemplate = await this.replyInstructionTemplate();
      for (const batch of batches) {
        await this.client.promptAsync(batch.target.target_session_id, {
          ...this.promptOptionsForMember(batch.backlog),
          parts: [{ type: "text", text: this.formatDeliveryPrompt(batch.backlog, replyInstructionTemplate) }],
        });
      }
    } catch (error) {
      const reason = `hard injection failed: ${error instanceof Error ? error.message : String(error)}`;
      this.db.markDeliveryFailure(targets, reason, classifyDeliveryFailure(error));
      return { flushed: false, reason: "inject_failed" };
    }

    const now = Date.now();
    for (const batch of batches) this.db.markDeliveriesInjected(batch.backlog, now);
    return { flushed: true, count: targets.length };
  }

  private async waitForHardTargetsIdle(targetSessionIds: string[], timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const statuses = await this.client.sessionStatus();
      const blocked = targetSessionIds.find((sessionId) => {
        const status = statuses[sessionId];
        return status !== undefined && status.type !== "idle";
      });
      if (!blocked) return { ok: true as const };
      if (Date.now() >= deadline) return { ok: false as const, targetSessionId: blocked };
      await sleep(Math.min(100, Math.max(1, deadline - Date.now())));
    }
  }

  async attemptFlush(targetSessionId: string, status?: SessionStatusInfo, questions: QuestionRequest[] = []) {
    if (!this.db) return { flushed: false, reason: "disabled" };
    const backlog = this.db.pendingBacklogForTarget(targetSessionId);
    if (backlog.length === 0) return { flushed: false, reason: "empty" };
    const selection = this.deliverableBacklog(targetSessionId, backlog, status, questions);
    if (selection.reason) return { flushed: false, reason: selection.reason };

    const prompt = this.formatDeliveryPrompt(selection.backlog, await this.replyInstructionTemplate());
    try {
      await this.client.promptAsync(targetSessionId, { ...this.promptOptionsForMember(selection.backlog), parts: [{ type: "text", text: prompt }] });
      this.db.markDeliveriesInjected(selection.backlog, Date.now());
      return { flushed: true, count: selection.backlog.length };
    } catch (error) {
      this.db.markDeliveryFailure(selection.backlog, error instanceof Error ? error.message : String(error), classifyDeliveryFailure(error));
      return { flushed: false, reason: "inject_failed" };
    }
  }

  private deliverableBacklog(
    targetSessionId: string,
    backlog: PendingDeliveryRow[],
    status?: SessionStatusInfo,
    questions: QuestionRequest[] = [],
  ) {
    const firstSpawnInitialIndex = backlog.findIndex((delivery) => delivery.mode === "spawn_initial");
    const firstBootstrapIndex = backlog.findIndex((delivery) => delivery.mode === "bootstrap" || delivery.message_kind === "join_bootstrap");
    if (firstSpawnInitialIndex >= 0 && firstBootstrapIndex >= 0 && firstBootstrapIndex < firstSpawnInitialIndex) {
      const blocker = this.bufferedDeliveryBlocker(targetSessionId, status, questions);
      return blocker ? { reason: blocker, backlog: [] } : { backlog: backlog.slice(0, firstBootstrapIndex + 1) };
    }

    const firstImmediateIndex = backlog.findIndex((delivery) => delivery.mode === "immediate");
    if (firstImmediateIndex >= 0) {
      const blocker = this.immediateDeliveryBlocker(targetSessionId, status, questions);
      return blocker ? { reason: blocker, backlog: [] } : { backlog: backlog.slice(0, firstImmediateIndex + 1) };
    }

    const blocker = this.bufferedDeliveryBlocker(targetSessionId, status, questions);
    return blocker ? { reason: blocker, backlog: [] } : { backlog };
  }

  private promptOptionsForMember(backlog: PendingDeliveryRow[]): SpawnPromptOptions {
    const first = backlog[0];
    if (!first || !this.db) return {};
    return this.db.memberPromptOptions(first.room_id, first.target_session_id);
  }

  private immediateDeliveryBlocker(targetSessionId: string, status?: SessionStatusInfo, questions: QuestionRequest[] = []) {
    if (status?.type === "retry") return "retry";
    if (questions.some((question) => question.sessionID === targetSessionId)) return "pending_user_question";
    return undefined;
  }

  private bufferedDeliveryBlocker(targetSessionId: string, status?: SessionStatusInfo, questions: QuestionRequest[] = []) {
    if (status?.type === "busy") return "busy";
    if (status?.type === "retry") return "retry";
    if (questions.some((question) => question.sessionID === targetSessionId)) return "pending_user_question";
    if (this.db!.hasOpenPendingCollabQuestion(targetSessionId)) return "pending_collab_question";
    return undefined;
  }

  private async replyInstructionTemplate() {
    return await loadTemplate(this.config?.reply_instruction, FALLBACK_REPLY_INSTRUCTION);
  }

  private formatDeliveryPrompt(backlog: PendingDeliveryRow[], replyInstructionTemplate: string) {
    const bootstrap = backlog.filter((delivery) => this.isBootstrapDelivery(delivery));
    const normal = backlog.filter((delivery) => !this.isBootstrapDelivery(delivery));
    const first = backlog[0];
    const lastNormal = normal.at(-1);
    const replySource = lastNormal ?? bootstrap.at(-1) ?? first;
    const replyInstruction = renderTemplate(replyInstructionTemplate, {
      room: replySource.room_name,
      alias: replySource.target_name,
      role: replySource.member_role ?? "member",
      from: replySource.message_sender_name,
    });
    return [
      `[Room: ${first.room_name}]`,
      "",
      first.public_message ? `[Public Message]\n${first.public_message}\n` : undefined,
      ...bootstrap.map((delivery) => this.formatBootstrapBlock(delivery)),
      normal.length > 0 ? this.formatMessageBlock(normal) : undefined,
      "---",
      replyInstruction,
    ]
      .filter((line): line is string => line !== undefined)
      .join("\n");
  }

  private isBootstrapDelivery(delivery: PendingDeliveryRow) {
    return delivery.mode === "bootstrap" || delivery.message_kind === "join_bootstrap";
  }

  private formatBootstrapBlock(delivery: PendingDeliveryRow) {
    return [
      "[Join Bootstrap]",
      "",
      delivery.message_body,
    ]
      .join("\n");
  }

  private formatMessageBlock(deliveries: PendingDeliveryRow[]) {
    return [
      "[Message]",
      "",
      deliveries
        .map((delivery) =>
          [`[${formatTimestamp(delivery.message_created_at)}|${delivery.message_kind}|id:${delivery.message_id}] ${delivery.message_sender_name}:`, "", delivery.message_body].join(
            "\n",
          ),
        )
        .join("\n\n"),
      "",
    ].join("\n");
  }

  private async logDeliveryError(message: string, error: unknown) {
    await this.client.log("warn", message, { error: error instanceof Error ? error.message : String(error) });
  }
}

export class CollabStorage {
  private constructor(readonly db: Database) {}

  static async open(dbPath: string) {
    await mkdir(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath, { create: true });
    const storage = new CollabStorage(db);
    storage.migrate();
    return storage;
  }

  close() {
    this.db.close();
  }

  tableNames() {
    return this.db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => row.name);
  }

  createRoom(input: {
    id: string;
    baseName: string;
    name: string;
    projectDir?: string;
    plannerPasswordHash: string;
    createdAt: number;
    founder: { sessionId: string; name: string; joinedAt: number; agentModel?: SpawnPromptOptions };
  }) {
    const transaction = this.db.transaction(() => {
      this.db.run(
        "INSERT INTO rooms (id, base_name, name, project_dir, planner_password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        [input.id, input.baseName, input.name, input.projectDir ?? null, input.plannerPasswordHash, input.createdAt],
      );
      this.insertMember(input.id, input.founder.sessionId, input.founder.name, "planner", input.founder.joinedAt, input.founder.agentModel);
      this.insertSystemMessage(input.id, `Founder ${input.founder.name} joined as planner.`, "founder_joined", input.createdAt);
    });

    transaction();
    return this.getRoom(input.id);
  }

  openRoomForSession(sessionId: string) {
    return this.db
      .query<RoomRow, [string]>(
        `SELECT rooms.* FROM rooms
         JOIN members ON members.room_id = rooms.id
         WHERE members.session_id = ? AND members.state = 'active' AND rooms.state = 'open'
         LIMIT 1`,
      )
      .get(sessionId);
  }

  openRoom(roomRef: string) {
    const room = this.getRoom(roomRef);
    if (room.state === "closed") throw httpError(409, "room is closed");
    return room;
  }

  roomStatus(roomRef: string) {
    const room = this.getRoom(roomRef);
    return this.publicRoom(room, { members: this.activeMembers(room.id) });
  }

  listRooms(params: RoomListParams) {
    const cursor = params.before ? this.resolveRoomCursor(params.before, params.state) : undefined;

    let rows: RoomRow[];
    if (params.state === "all") {
      rows = cursor
        ? this.db
            .query<RoomRow, [number, string, number, string]>(
              `SELECT * FROM rooms
               WHERE (created_at < ? OR (created_at = ? AND id < ?))
               ORDER BY created_at DESC, id DESC
               LIMIT ?`,
            )
            .all(cursor.created_at, cursor.created_at, cursor.id, params.limit)
        : this.db
            .query<RoomRow, [number]>(
              `SELECT * FROM rooms ORDER BY created_at DESC, id DESC LIMIT ?`,
            )
            .all(params.limit);
    } else {
      rows = cursor
        ? this.db
            .query<RoomRow, [string, number, string, number, string]>(
              `SELECT * FROM rooms
               WHERE state = ?
                 AND (created_at < ? OR (created_at = ? AND id < ?))
               ORDER BY created_at DESC, id DESC
               LIMIT ?`,
            )
            .all(params.state, cursor.created_at, cursor.created_at, cursor.id, params.limit)
        : this.db
            .query<RoomRow, [string, number]>(
              `SELECT * FROM rooms WHERE state = ? ORDER BY created_at DESC, id DESC LIMIT ?`,
            )
            .all(params.state, params.limit);
    }

    return rows.map((room) => this.publicRoom(room));
  }

  closeRoom(roomRef: string, sessionId: string, from: string, now: number) {
    const room = this.openRoom(roomRef);
    this.requirePlanner(room.id, sessionId, from);

    const transaction = this.db.transaction(() => {
      const messageId = this.insertSystemMessage(room.id, `Room closed by ${from}.`, "room_closed", now);
      this.insertDeliveries(messageId, this.activeMembersForDelivery(room.id, sessionId), "buffered", now);
      this.cancelPendingQuestionTargetsForRoom(room.id, now, "room closed");
      this.db.run("UPDATE rooms SET state = 'closed', closed_at = ? WHERE id = ?", [now, room.id]);
    });
    transaction();

    return this.roomStatus(room.id);
  }

  addMember(
    roomRef: string,
    input: {
      sessionId: string;
      from: string;
      targetSessionId: string;
      name: string;
      role: string;
      roomJoinInstruction: string;
      agentModel?: SpawnPromptOptions;
      now: number;
    },
  ) {
    const room = this.validateAddMember(roomRef, input);

    const transaction = this.db.transaction(() => {
      this.insertMember(room.id, input.targetSessionId, input.name, input.role, input.now, input.agentModel);
      this.insertJoinBootstrap({ room, target: { session_id: input.targetSessionId, name: input.name }, role: input.role, body: input.roomJoinInstruction, createdAt: input.now });
      const messageId = this.insertSystemMessage(room.id, `${input.name} joined as ${input.role}.`, "member_joined", input.now + 1);
      this.insertDeliveries(messageId, this.activeMembersForDelivery(room.id, input.targetSessionId), "buffered", input.now + 1);
    });
    transaction();

    return this.roomStatus(room.id);
  }

  validateAddMember(roomRef: string, input: { sessionId: string; from: string; targetSessionId: string; name: string }) {
    const room = this.openRoom(roomRef);
    this.requirePlanner(room.id, input.sessionId, input.from);
    if (this.memberByName(room.id, input.name)) throw httpError(409, "alias already exists in room");
    if (this.openRoomForSession(input.targetSessionId)) throw httpError(409, "target session already belongs to an open room");
    return room;
  }

  selfJoin(roomRef: string, input: { sessionId: string; name: string; roomJoinInstruction: string; agentModel?: SpawnPromptOptions; now: number }) {
    const room = this.openRoom(roomRef);
    if (this.memberByName(room.id, input.name)) throw httpError(409, "alias already exists in room");
    if (this.openRoomForSession(input.sessionId)) throw httpError(409, "session already belongs to an open room");

    const transaction = this.db.transaction(() => {
      this.insertMember(room.id, input.sessionId, input.name, "planner", input.now, input.agentModel);
      this.insertJoinBootstrap({ room, target: { session_id: input.sessionId, name: input.name }, role: "planner", body: input.roomJoinInstruction, createdAt: input.now });
      const messageId = this.insertSystemMessage(room.id, `${input.name} joined as planner.`, "member_joined", input.now + 1);
      this.insertDeliveries(messageId, this.activeMembersForDelivery(room.id, input.sessionId), "buffered", input.now + 1);
    });
    transaction();

    return this.roomStatus(room.id);
  }

  validateSpawn(roomRef: string, input: { sessionId: string; from: string; name: string }) {
    const room = this.openRoom(roomRef);
    this.requirePlanner(room.id, input.sessionId, input.from);
    if (this.memberByName(room.id, input.name)) throw httpError(409, "alias already exists in room");
    return room;
  }

  addSpawnedMember(
    roomRef: string,
    input: SpawnInput & { targetSessionId: string; roomJoinInstruction: string; spawnPrompt: SpawnPromptOptions },
  ) {
    const room = this.openRoom(roomRef);
    this.requirePlanner(room.id, input.sessionId, input.from);
    if (this.memberByName(room.id, input.name)) throw httpError(409, "alias already exists in room");
    if (this.openRoomForSession(input.targetSessionId)) throw httpError(409, "target session already belongs to an open room");

    const transaction = this.db.transaction(() => {
      this.insertMember(room.id, input.targetSessionId, input.name, input.role, input.now, input.spawnPrompt);
      this.db.run("INSERT INTO spawned_sessions (room_id, session_id, spawned_by, created_at) VALUES (?, ?, ?, ?)", [
        room.id,
        input.targetSessionId,
        input.sessionId,
        input.now,
      ]);
      this.insertJoinBootstrap({ room, target: { session_id: input.targetSessionId, name: input.name }, role: input.role, body: input.roomJoinInstruction, createdAt: input.now });
      const joinedId = this.insertSystemMessage(room.id, `${input.name} spawned by ${input.from} as ${input.role}.`, "member_joined", input.now + 1);
      this.insertDeliveries(joinedId, this.activeMembersForDelivery(room.id, input.targetSessionId), "buffered", input.now + 1);
      if (input.initialPrompt) {
        const promptId = this.insertSystemMessage(room.id, input.initialPrompt, "spawn_initial", input.now + 2);
        this.insertDeliveries(promptId, [{ session_id: input.targetSessionId, name: input.name }], "spawn_initial", input.now + 2, input.spawnPrompt);
      }
    });
    transaction();

    return this.roomStatus(room.id);
  }

  leaveMember(roomRef: string, input: { sessionId: string; from: string; now: number }) {
    const room = this.openRoom(roomRef);
    const member = this.requireActiveMember(room.id, input.sessionId, input.from);
    this.ensurePlannerRemains(room.id, member);

    const transaction = this.db.transaction(() => {
      this.db.run("UPDATE members SET state = 'left', left_at = ? WHERE room_id = ? AND session_id = ?", [
        input.now,
        room.id,
        input.sessionId,
      ]);
      this.cancelPendingDeliveries(input.sessionId, "member left");
      this.cancelPendingQuestionTargets(input.sessionId, input.now, "member left");
      const messageId = this.insertSystemMessage(room.id, `${input.from} left the room.`, "member_left", input.now);
      this.insertDeliveries(messageId, this.activeMembersForDelivery(room.id), "buffered", input.now);
    });
    transaction();

    return this.roomStatus(room.id);
  }

  removeMember(roomRef: string, input: { sessionId: string; from: string; target: string; now: number }) {
    const room = this.openRoom(roomRef);
    this.requirePlanner(room.id, input.sessionId, input.from);
    const target = this.activeMemberByName(room.id, input.target);
    if (!target) throw httpError(404, "member not found");
    this.ensurePlannerRemains(room.id, target);

    const transaction = this.db.transaction(() => {
      this.db.run("UPDATE members SET state = 'removed', removed_at = ?, removed_by = ? WHERE room_id = ? AND session_id = ?", [
        input.now,
        input.from,
        room.id,
        target.session_id,
      ]);
      this.cancelPendingDeliveries(target.session_id, "member removed");
      this.cancelPendingQuestionTargets(target.session_id, input.now, "member removed");
      const messageId = this.insertSystemMessage(room.id, `${target.name} was removed by ${input.from}.`, "member_removed", input.now);
      this.insertDeliveries(messageId, this.activeMembersForDelivery(room.id), "buffered", input.now);
    });
    transaction();

    return this.roomStatus(room.id);
  }

  setPublicMessage(roomRef: string, input: { sessionId: string; from: string; body: string; now: number }) {
    const room = this.openRoom(roomRef);
    this.requirePlanner(room.id, input.sessionId, input.from);

    const transaction = this.db.transaction(() => {
      this.db.run(
        "UPDATE rooms SET public_message = ?, public_message_updated_at = ?, public_message_updated_by = ? WHERE id = ?",
        [input.body, input.now, input.from, room.id],
      );
      const messageId = this.insertSystemMessage(
        room.id,
        `Public message updated by ${input.from}:\n${input.body}`,
        "room_public_message_updated",
        input.now,
      );
      this.insertDeliveries(messageId, this.activeMembersForDelivery(room.id, input.sessionId), "immediate", input.now);
    });
    transaction();

    return this.roomStatus(room.id);
  }

  clearPublicMessage(roomRef: string, input: { sessionId: string; from: string; now: number }) {
    const room = this.openRoom(roomRef);
    this.requirePlanner(room.id, input.sessionId, input.from);

    const transaction = this.db.transaction(() => {
      this.db.run(
        "UPDATE rooms SET public_message = NULL, public_message_updated_at = NULL, public_message_updated_by = NULL WHERE id = ?",
        [room.id],
      );
      const messageId = this.insertSystemMessage(
        room.id,
        `Public message cleared by ${input.from}.`,
        "room_public_message_cleared",
        input.now,
      );
      this.insertDeliveries(messageId, this.activeMembersForDelivery(room.id, input.sessionId), "immediate", input.now);
    });
    transaction();

    return this.roomStatus(room.id);
  }

  sendMemberMessage(roomRef: string, input: { sessionId: string; from: string; body: string; kind: string; hard: boolean; now: number }) {
    const room = this.openRoom(roomRef);
    const sender = input.hard
      ? this.requirePlanner(room.id, input.sessionId, input.from)
      : this.requireActiveMember(room.id, input.sessionId, input.from);
    const plan = input.hard
      ? planHardMessageTargets(input.body, this.activeMembersForDelivery(room.id), sender)
      : planMessageTargets(input.body, this.activeMembersForDelivery(room.id), sender.session_id);
    let messageId = "";

    const transaction = this.db.transaction(() => {
      messageId = this.insertMemberMessage(room.id, sender, input.body, input.kind, plan.mentions, input.now);
      this.insertDeliveries(messageId, plan.targets, plan.mode, input.now);
    });
    transaction();

    return this.publicMessage(this.messageById(messageId), this.deliveriesForMessages([messageId]));
  }

  askQuestion(roomRef: string, input: { sessionId: string; from: string; body: string; now: number }) {
    const room = this.openRoom(roomRef);
    const sender = this.requireActiveMember(room.id, input.sessionId, input.from);
    const plan = planQuestionTargets(input.body, this.activeMembersForDelivery(room.id), sender.session_id);
    let messageId = "";

    const transaction = this.db.transaction(() => {
      messageId = this.insertMemberMessage(room.id, sender, input.body, "question", plan.mentions, input.now);
      this.insertQuestionTargets(messageId, plan.targets);
      this.insertDeliveries(messageId, plan.targets, "immediate", input.now);
    });
    transaction();

    return this.publicMessage(this.messageById(messageId), this.deliveriesForMessages([messageId]));
  }

  answerQuestion(roomRef: string, input: { sessionId: string; from: string; parentId: string; body: string; now: number }) {
    const room = this.openRoom(roomRef);
    const sender = this.requireActiveMember(room.id, input.sessionId, input.from);
    const parent = this.findMessageById(input.parentId);
    if (!parent) throw httpError(404, "question not found");
    if (parent.room_id !== room.id || parent.kind !== "question") throw httpError(404, "question not found");
    const target = this.questionTarget(input.parentId, sender.session_id);
    if (!target) throw httpError(403, "pending question target required");
    if (target.state === "answered") throw httpError(409, "question already answered by target");
    if (target.state === "cancelled") throw httpError(409, "question target is cancelled");

    const asker = parent.sender_id ? this.activeMemberBySession(room.id, parent.sender_id) : undefined;
    const bufferedTargets = this.activeMembersForDelivery(room.id, sender.session_id).filter(
      (member) => member.session_id !== asker?.session_id,
    );
    const mentions = parseMentionTokens(input.body);
    let messageId = "";

    const transaction = this.db.transaction(() => {
      messageId = this.insertMemberMessage(room.id, sender, input.body, "answer", mentions, input.now, input.parentId);
      const updated = this.db.run(
        "UPDATE question_targets SET state = 'answered', answered_at = ? WHERE message_id = ? AND target_session_id = ? AND state = 'pending'",
        [input.now, input.parentId, sender.session_id],
      );
      if (updated.changes !== 1) throw httpError(409, "question already answered by target");
      if (asker) this.insertDeliveries(messageId, [{ session_id: asker.session_id, name: asker.name }], "immediate", input.now);
      this.insertDeliveries(messageId, bufferedTargets, "buffered", input.now);
    });
    transaction();

    return this.publicMessage(this.messageById(messageId), this.deliveriesForMessages([messageId]));
  }

  roomMessages(roomRef: string, pagination: PaginationParams = { limit: DEFAULT_PAGE_SIZE }) {
    const room = this.getRoom(roomRef);
    const cursor = pagination.since ? this.resolveCursor(room.id, pagination.since) : undefined;
    const messages = cursor
      ? this.db
          .query<MessageRow, [string, number, string]>(
            `SELECT * FROM messages WHERE room_id = ? AND (created_at > ? OR (created_at = ? AND id > ?)) ORDER BY created_at ASC, id ASC LIMIT ${pagination.limit}`,
          )
          .all(room.id, cursor.created_at, cursor.created_at, cursor.id)
      : this.db
          .query<MessageRow, [string]>(
            `SELECT * FROM messages WHERE room_id = ? ORDER BY created_at ASC, id ASC LIMIT ${pagination.limit}`,
          )
          .all(room.id);
    const deliveries = this.deliveriesForMessages(messages.map((message) => message.id));
    return { room_id: room.id, messages: messages.map((message) => this.publicMessage(message, deliveries)) };
  }

  memberMessages(roomRef: string, sessionId?: string, from?: string, pagination: PaginationParams = { limit: DEFAULT_PAGE_SIZE }) {
    const room = this.getRoom(roomRef);
    const member = this.requireActiveMessageViewMember(room.id, sessionId, from);
    const cursor = pagination.since ? this.resolveCursor(room.id, pagination.since) : undefined;
    const deliveries = cursor
      ? this.db
          .query<DeliveryRow, [string, string, number, string]>(
            `SELECT deliveries.* FROM deliveries
             JOIN messages ON messages.id = deliveries.message_id
             WHERE messages.room_id = ? AND deliveries.target_session_id = ?
               AND (messages.created_at > ? OR (messages.created_at = ? AND messages.id > ?))
             ORDER BY messages.created_at ASC, deliveries.created_at ASC, messages.id ASC
             LIMIT ${pagination.limit}`,
          )
          .all(room.id, member.session_id, cursor.created_at, cursor.created_at, cursor.id)
      : this.db
          .query<DeliveryRow, [string, string]>(
            `SELECT deliveries.* FROM deliveries
             JOIN messages ON messages.id = deliveries.message_id
             WHERE messages.room_id = ? AND deliveries.target_session_id = ?
             ORDER BY messages.created_at ASC, deliveries.created_at ASC, messages.id ASC
             LIMIT ${pagination.limit}`,
          )
          .all(room.id, member.session_id);
    const messageIds = [...new Set(deliveries.map((delivery) => delivery.message_id))];
    const messages = this.messageRowsById(messageIds);
    return {
      room_id: room.id,
      member: { session_id: member.session_id, name: member.name },
      messages: messages.map((message) => this.publicMessage(message, deliveries.filter((delivery) => delivery.message_id === message.id))),
    };
  }

  pendingDeliveryTargets() {
    return this.db
      .query<{ target_session_id: string }, []>(
        `SELECT DISTINCT deliveries.target_session_id
         FROM deliveries
         JOIN messages ON messages.id = deliveries.message_id
         JOIN rooms ON rooms.id = messages.room_id
         WHERE deliveries.state = 'pending'
           AND (rooms.state = 'open' OR deliveries.created_at <= rooms.closed_at)
         ORDER BY deliveries.target_session_id ASC`,
      )
      .all()
      .map((row) => row.target_session_id);
  }

  pendingHardMessageIds() {
    return this.db
      .query<{ message_id: string }, []>(
        `SELECT deliveries.message_id
         FROM deliveries
          JOIN messages ON messages.id = deliveries.message_id
          JOIN rooms ON rooms.id = messages.room_id
          WHERE deliveries.state = 'pending'
            AND deliveries.mode = 'hard'
            AND (rooms.state = 'open' OR deliveries.created_at <= rooms.closed_at)
          GROUP BY deliveries.message_id
         ORDER BY messages.created_at ASC, deliveries.created_at ASC, deliveries.message_id ASC`,
      )
      .all()
      .map((row) => row.message_id);
  }

  pendingHardDeliveries(messageId: string) {
    return this.db
      .query<DeliveryRow, [string]>(
        `SELECT deliveries.* FROM deliveries
         JOIN messages ON messages.id = deliveries.message_id
         JOIN rooms ON rooms.id = messages.room_id
         WHERE deliveries.message_id = ?
           AND deliveries.mode = 'hard'
           AND deliveries.state = 'pending'
           AND (rooms.state = 'open' OR deliveries.created_at <= rooms.closed_at)
         ORDER BY deliveries.created_at ASC, deliveries.rowid ASC`,
      )
      .all(messageId);
  }

  pendingBacklogForTarget(targetSessionId: string) {
    return this.db
      .query<PendingDeliveryRow, [string]>(
        `SELECT deliveries.*,
                rooms.id AS room_id,
                rooms.name AS room_name,
                rooms.state AS room_state,
                rooms.public_message AS public_message,
                messages.sender_name AS message_sender_name,
                messages.body AS message_body,
                messages.kind AS message_kind,
                messages.created_at AS message_created_at,
                members.role AS member_role,
                members.directory AS directory,
                members.agent AS agent,
                members.model_provider_id AS model_provider_id,
                members.model_id AS model_id,
                members.model_variant AS model_variant
         FROM deliveries
         JOIN messages ON messages.id = deliveries.message_id
         JOIN rooms ON rooms.id = messages.room_id
         LEFT JOIN members ON members.room_id = rooms.id AND members.session_id = deliveries.target_session_id
          WHERE deliveries.target_session_id = ? AND deliveries.state = 'pending'
            AND (rooms.state = 'open' OR deliveries.created_at <= rooms.closed_at)
          ORDER BY messages.created_at ASC, deliveries.created_at ASC, messages.id ASC`,
      )
      .all(targetSessionId);
  }

  memberPromptOptions(roomId: string, sessionId: string): SpawnPromptOptions {
    const row = this.db
      .query<AgentModelRow, [string, string]>(
        `SELECT directory, agent, model_provider_id, model_id, model_variant
         FROM members
         WHERE room_id = ? AND session_id = ? AND state = 'active'
         LIMIT 1`,
      )
      .get(roomId, sessionId);
    return promptOptionsFromRow(row);
  }

  memberRouteForSession(sessionId: string): SpawnPromptOptions {
    const row = this.db
      .query<AgentModelRow, [string]>(
        `SELECT directory, agent, model_provider_id, model_id, model_variant
         FROM members
         WHERE session_id = ? AND state = 'active'
         ORDER BY joined_at DESC
         LIMIT 1`,
      )
      .get(sessionId);
    return promptOptionsFromRow(row);
  }

  hasOpenPendingCollabQuestion(targetSessionId: string) {
    return Boolean(
      this.db
        .query<{ message_id: string }, [string]>(
          `SELECT question_targets.message_id
           FROM question_targets
           JOIN messages ON messages.id = question_targets.message_id
           JOIN rooms ON rooms.id = messages.room_id
           WHERE question_targets.target_session_id = ?
             AND question_targets.state = 'pending'
             AND rooms.state = 'open'
           LIMIT 1`,
        )
        .get(targetSessionId),
    );
  }

  handleSessionHandoff(input: {
    oldSessionId: string;
    newSessionId: string;
    reason: string;
    now: number;
  }): SessionHandoffResult[] {
    const { oldSessionId, newSessionId, reason, now } = input;
    const results: SessionHandoffResult[] = [];

    const transaction = this.db.transaction(() => {
      const memberships = this.db
        .query<
          MemberRow & { room_state: string; room_name: string },
          [string]
        >(
          `SELECT members.*, rooms.state AS room_state, rooms.name AS room_name
           FROM members
           JOIN rooms ON rooms.id = members.room_id
           WHERE members.session_id = ? AND members.state = 'active'
             AND (rooms.state = 'open'
               OR EXISTS (
                 SELECT 1 FROM deliveries d
                 JOIN messages m ON m.id = d.message_id
                 WHERE d.target_session_id = members.session_id
                   AND d.state = 'pending'
                   AND m.room_id = members.room_id
               ))`,
        )
        .all(oldSessionId);

      for (const member of memberships) {
        const roomId = member.room_id;

        const existingHistory = this.db
          .query<{ room_id: string }, [string, string, string]>(
            "SELECT room_id FROM member_session_history WHERE room_id = ? AND old_session_id = ? AND new_session_id = ?",
          )
          .get(roomId, oldSessionId, newSessionId);
        if (existingHistory) {
          results.push({
            roomId,
            roomName: member.room_name,
            memberName: member.name,
            memberRole: member.role,
            memberAlias: member.name,
            skipped: true,
            reason: "idempotent",
          });
          continue;
        }

        const conflictMember = this.db
          .query<MemberRow, [string]>(
            "SELECT * FROM members WHERE session_id = ? AND state = 'active' LIMIT 1",
          )
          .get(newSessionId);
        if (conflictMember && conflictMember.room_id !== roomId) {
          const conflictRoom = this.db.query<RoomRow, [string]>("SELECT * FROM rooms WHERE id = ?").get(conflictMember.room_id);
          results.push({
            roomId,
            roomName: member.room_name,
            memberName: member.name,
            memberRole: member.role,
            memberAlias: member.name,
            skipped: true,
            reason: `continuation session already active in room ${conflictRoom?.name ?? conflictMember.room_id}`,
          });
          continue;
        }

        // Retarget deliveries (DELETE + INSERT because PK includes target_session_id)
        const pendingDeliveries = this.db
          .query<DeliveryRow, [string, string]>(
            "SELECT * FROM deliveries WHERE target_session_id = ? AND state = 'pending' AND message_id IN (SELECT id FROM messages WHERE room_id = ?)",
          )
          .all(oldSessionId, roomId);
        for (const delivery of pendingDeliveries) {
          this.db.run("DELETE FROM deliveries WHERE message_id = ? AND target_session_id = ?", [delivery.message_id, oldSessionId]);
          this.db.run(
            `INSERT INTO deliveries (message_id, target_session_id, target_name, mode, state, injected_at, attempt_count, last_error, created_at, agent, model_provider_id, model_id, model_variant)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              delivery.message_id, newSessionId, delivery.target_name, delivery.mode, delivery.state,
              delivery.injected_at, delivery.attempt_count, delivery.last_error, delivery.created_at,
              delivery.agent, delivery.model_provider_id, delivery.model_id, delivery.model_variant,
            ],
          );
        }

        // Retarget question_targets (DELETE + INSERT)
        const pendingQuestions = this.db
          .query<{ message_id: string; target_session_id: string; target_name: string; state: string; answered_at: number | null; cancelled_at: number | null; cancelled_reason: string | null }, [string, string]>(
            "SELECT * FROM question_targets WHERE target_session_id = ? AND state = 'pending' AND message_id IN (SELECT id FROM messages WHERE room_id = ?)",
          )
          .all(oldSessionId, roomId);
        for (const qt of pendingQuestions) {
          this.db.run("DELETE FROM question_targets WHERE message_id = ? AND target_session_id = ?", [qt.message_id, oldSessionId]);
          this.db.run(
            `INSERT INTO question_targets (message_id, target_session_id, target_name, state, answered_at, cancelled_at, cancelled_reason)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [qt.message_id, newSessionId, qt.target_name, qt.state, qt.answered_at, qt.cancelled_at, qt.cancelled_reason],
          );
        }

        // Retarget spawned_sessions (DELETE + INSERT)
        const spawned = this.db
          .query<{ room_id: string; session_id: string; spawned_by: string; created_at: number }, [string, string]>(
            "SELECT * FROM spawned_sessions WHERE room_id = ? AND session_id = ?",
          )
          .get(roomId, oldSessionId);
        if (spawned) {
          this.db.run("DELETE FROM spawned_sessions WHERE room_id = ? AND session_id = ?", [roomId, oldSessionId]);
          this.db.run(
            "INSERT INTO spawned_sessions (room_id, session_id, spawned_by, created_at) VALUES (?, ?, ?, ?)",
            [roomId, newSessionId, spawned.spawned_by, spawned.created_at],
          );
        }

        // Update member row (DELETE old + INSERT new)
        this.db.run("DELETE FROM members WHERE room_id = ? AND session_id = ?", [roomId, oldSessionId]);
        this.db.run(
          `INSERT INTO members (room_id, session_id, name, role, state, joined_at, left_at, removed_at, removed_by, directory, agent, model_provider_id, model_id, model_variant)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            roomId, newSessionId, member.name, member.role, member.state, member.joined_at,
            member.left_at ?? null, member.removed_at ?? null, member.removed_by ?? null,
            member.directory ?? null, member.agent ?? null, member.model_provider_id ?? null,
            member.model_id ?? null, member.model_variant ?? null,
          ],
        );

        // Insert history row
        this.db.run(
          "INSERT OR IGNORE INTO member_session_history (room_id, name, old_session_id, new_session_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          [roomId, member.name, oldSessionId, newSessionId, reason, now],
        );

        // Insert transcript system message
        const transcriptBody = `Member ${member.name} session handed off from ${oldSessionId} to ${newSessionId} (reason: ${reason}).`;
        const transcriptMessageId = this.insertSystemMessage(roomId, transcriptBody, "session_handoff", now);

        // Queue reminder delivery
        const reminderBody = [
          "[Collab Session Handoff]",
          "",
          "Your collaboration session has been continued after a context rollover.",
          "",
          `Room: ${member.room_name}`,
          `Alias: ${member.name}`,
          `Role: ${member.role}`,
          `Previous session: ${oldSessionId}`,
          `Current session: ${newSessionId}`,
          "",
          `You are still an active member of this room. Continue coordinating through agent-collab as ${member.name}.`,
        ].join("\n");
        const reminderMessageId = this.insertSystemMessage(roomId, reminderBody, "session_handoff_reminder", now + 1);
        this.insertDeliveries(reminderMessageId, [{ session_id: newSessionId, name: member.name }], "handoff_reminder", now + 1, {
          directory: member.directory ?? undefined,
          agent: member.agent ?? undefined,
          model: member.model_provider_id && member.model_id
            ? { providerID: member.model_provider_id, modelID: member.model_id, variant: member.model_variant ?? undefined }
            : undefined,
        });

        results.push({
          roomId,
          roomName: member.room_name,
          memberName: member.name,
          memberRole: member.role,
          memberAlias: member.name,
          skipped: false,
        });
      }
    });

    transaction();
    return results;
  }

  markDeliveriesInjected(deliveries: DeliveryRow[], now: number) {
    const transaction = this.db.transaction(() => {
      for (const delivery of deliveries) {
        this.db.run(
          `UPDATE deliveries
           SET state = 'injected', injected_at = ?, last_error = NULL
           WHERE message_id = ? AND target_session_id = ? AND state = 'pending'`,
          [now, delivery.message_id, delivery.target_session_id],
        );
      }
    });
    transaction();
  }

  markDeliveryAttempt(deliveries: DeliveryRow[], error: string) {
    const transaction = this.db.transaction(() => {
      for (const delivery of deliveries) {
        this.db.run(
          `UPDATE deliveries
           SET attempt_count = attempt_count + 1, last_error = ?
           WHERE message_id = ? AND target_session_id = ? AND state = 'pending'`,
          [error, delivery.message_id, delivery.target_session_id],
        );
      }
    });
    transaction();
  }

  markDeliveryFailure(deliveries: DeliveryRow[], error: string, classification: DeliveryFailureClassification) {
    if (classification === "permanent") this.markDeliveriesFailed(deliveries, error);
    else this.markDeliveryAttempt(deliveries, error);
  }

  markDeliveriesFailed(deliveries: DeliveryRow[], error: string) {
    const transaction = this.db.transaction(() => {
      for (const delivery of deliveries) {
        this.db.run(
          `UPDATE deliveries
           SET state = 'failed', attempt_count = attempt_count + 1, last_error = ?
           WHERE message_id = ? AND target_session_id = ? AND state = 'pending'`,
          [error, delivery.message_id, delivery.target_session_id],
        );
      }
    });
    transaction();
  }

  uniqueRoomName(baseName: string, now: number) {
    const stamped = `${baseName}-${formatTimestamp(now)}`;
    if (!this.roomNameExists(stamped)) return stamped;
    for (let suffix = 2; suffix < 1000; suffix += 1) {
      const candidate = `${stamped}-${suffix}`;
      if (!this.roomNameExists(candidate)) return candidate;
    }
    throw httpError(500, "unable to allocate unique room name");
  }

  private roomNameExists(name: string) {
    return Boolean(this.db.query<{ id: string }, [string]>("SELECT id FROM rooms WHERE name = ? LIMIT 1").get(name));
  }

  private getRoom(roomRef: string) {
    const room = this.db.query<RoomRow, [string, string]>("SELECT * FROM rooms WHERE id = ? OR name = ? LIMIT 1").get(roomRef, roomRef);
    if (!room) throw httpError(404, "room not found");
    return room;
  }

  private activeMembers(roomId: string) {
    return this.db
      .query<MemberRow, [string]>(
        "SELECT room_id, session_id, name, role, state, joined_at FROM members WHERE room_id = ? AND state = 'active' ORDER BY joined_at ASC",
      )
      .all(roomId)
      .map((member) => ({
        session_id: member.session_id,
        name: member.name,
        role: member.role,
        state: member.state,
        joined_at: member.joined_at,
      }));
  }

  private activeMembersForDelivery(roomId: string, exceptSessionId?: string) {
    return this.db
      .query<DeliveryTarget, [string]>(
        "SELECT session_id, name FROM members WHERE room_id = ? AND state = 'active' ORDER BY joined_at ASC",
      )
      .all(roomId)
      .filter((member) => member.session_id !== exceptSessionId);
  }

  private activeMemberByName(roomId: string, name: string) {
    return this.db
      .query<MemberRow, [string, string]>("SELECT * FROM members WHERE room_id = ? AND name = ? AND state = 'active' LIMIT 1")
      .get(roomId, name);
  }

  private activeMemberBySession(roomId: string, sessionId: string) {
    return this.db
      .query<MemberRow, [string, string]>("SELECT * FROM members WHERE room_id = ? AND session_id = ? AND state = 'active' LIMIT 1")
      .get(roomId, sessionId);
  }

  private memberByName(roomId: string, name: string) {
    return this.db.query<MemberRow, [string, string]>("SELECT * FROM members WHERE room_id = ? AND name = ? LIMIT 1").get(roomId, name);
  }

  private requireActiveMember(roomId: string, sessionId: string, name: string) {
    const member = this.db
      .query<MemberRow, [string, string, string]>(
        "SELECT * FROM members WHERE room_id = ? AND session_id = ? AND name = ? AND state = 'active' LIMIT 1",
      )
      .get(roomId, sessionId, name);
    if (!member) throw httpError(403, "active member required");
    return member;
  }

  private requireActiveMessageViewMember(roomId: string, sessionId?: string, name?: string) {
    if (name !== undefined) assertValidAlias(name, "from");

    if (sessionId !== undefined && name !== undefined) return this.requireActiveMember(roomId, sessionId, name);
    const member = sessionId !== undefined ? this.activeMemberBySession(roomId, sessionId) : name ? this.activeMemberByName(roomId, name) : undefined;
    if (!member) throw httpError(403, "active member required");
    return member;
  }

  private requirePlanner(roomId: string, sessionId: string, name: string) {
    const member = this.requireActiveMember(roomId, sessionId, name);
    if (member.role !== "planner") throw httpError(403, "planner role required");
    return member;
  }

  private ensurePlannerRemains(roomId: string, removedMember: MemberRow) {
    if (removedMember.role !== "planner") return;
    const remaining = this.db
      .query<{ count: number }, [string, string]>(
        "SELECT COUNT(*) AS count FROM members WHERE room_id = ? AND state = 'active' AND role = 'planner' AND session_id != ?",
      )
      .get(roomId, removedMember.session_id)?.count;
    if (!remaining) throw httpError(409, "room must retain at least one planner");
  }

  private publicRoom(room: RoomRow, extra: Record<string, unknown> = {}) {
    return {
      room_id: room.id,
      base_name: room.base_name,
      name: room.name,
      project_dir: room.project_dir,
      state: room.state,
      public_message: room.public_message,
      public_message_updated_at: room.public_message_updated_at,
      public_message_updated_by: room.public_message_updated_by,
      created_at: room.created_at,
      closed_at: room.closed_at,
      outstanding_failures: this.failedDeliveriesForRoom(room.id),
      ...extra,
    };
  }

  private failedDeliveriesForRoom(roomId: string) {
    return this.db
      .query<DeliveryRow & { message_kind: string; message_body: string; message_created_at: number }, [string]>(
        `SELECT deliveries.*,
                messages.kind AS message_kind,
                messages.body AS message_body,
                messages.created_at AS message_created_at
         FROM deliveries
         JOIN messages ON messages.id = deliveries.message_id
         WHERE messages.room_id = ?
           AND deliveries.state = 'failed'
         ORDER BY messages.created_at ASC, deliveries.created_at ASC, deliveries.target_name ASC`,
      )
      .all(roomId)
      .map((delivery) => ({
        message_id: delivery.message_id,
        message_kind: delivery.message_kind,
        message_body: delivery.message_body,
        message_created_at: delivery.message_created_at,
        target_session_id: delivery.target_session_id,
        target_name: delivery.target_name,
        mode: delivery.mode,
        state: delivery.state,
        attempt_count: delivery.attempt_count,
        last_error: delivery.last_error,
        created_at: delivery.created_at,
      }));
  }

  private insertMember(roomId: string, sessionId: string, name: string, role: string, joinedAt: number, prompt?: SpawnPromptOptions) {
    this.db.run(
      `INSERT INTO members (room_id, session_id, name, role, joined_at, directory, agent, model_provider_id, model_id, model_variant)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        roomId,
        sessionId,
        name,
        role,
        joinedAt,
        prompt?.directory ?? null,
        prompt?.agent ?? null,
        prompt?.model?.providerID ?? null,
        prompt?.model?.modelID ?? null,
        prompt?.model?.variant ?? null,
      ],
    );
  }

  private insertSystemMessage(roomId: string, body: string, kind: string, createdAt: number) {
    const messageId = `msg_${randomUUID()}`;
    this.db.run(
      "INSERT INTO messages (id, room_id, sender_type, sender_name, body, kind, created_at) VALUES (?, ?, 'system', 'system', ?, ?, ?)",
      [messageId, roomId, body, kind, createdAt],
    );
    return messageId;
  }

  private insertMemberMessage(
    roomId: string,
    sender: MemberRow,
    body: string,
    kind: string,
    mentions: string[],
    createdAt: number,
    parentId?: string,
  ) {
    const messageId = `msg_${randomUUID()}`;
    this.db.run(
      `INSERT INTO messages (id, room_id, sender_type, sender_id, sender_name, body, kind, mentions, parent_id, created_at)
       VALUES (?, ?, 'member', ?, ?, ?, ?, ?, ?, ?)`,
      [messageId, roomId, sender.session_id, sender.name, body, kind, JSON.stringify(mentions), parentId ?? null, createdAt],
    );
    return messageId;
  }

  private questionTarget(messageId: string, targetSessionId: string) {
    return this.db
      .query<{ state: string }, [string, string]>(
        "SELECT state FROM question_targets WHERE message_id = ? AND target_session_id = ? LIMIT 1",
      )
      .get(messageId, targetSessionId);
  }

  private messageById(messageId: string) {
    const message = this.findMessageById(messageId);
    if (!message) throw httpError(500, "message not found after insert");
    return message;
  }

  private findMessageById(messageId: string) {
    return this.db.query<MessageRow, [string]>("SELECT * FROM messages WHERE id = ? LIMIT 1").get(messageId);
  }

  private resolveCursor(roomId: string, since: string) {
    const message = this.findMessageById(since);
    if (!message || message.room_id !== roomId) throw httpError(400, "since must reference a message in this room");
    return message;
  }

  private resolveRoomCursor(roomId: string, state: "open" | "closed" | "all") {
    const room = this.db.query<RoomRow, [string]>("SELECT * FROM rooms WHERE id = ? LIMIT 1").get(roomId);
    if (!room) throw httpError(400, "before must reference an existing room");
    if (state !== "all" && room.state !== state) throw httpError(400, `before cursor room is not in state '${state}'`);
    return room;
  }

  private messageRows(roomId: string) {
    return this.db.query<MessageRow, [string]>("SELECT * FROM messages WHERE room_id = ? ORDER BY created_at ASC, id ASC").all(roomId);
  }

  private messageRowsById(messageIds: string[]) {
    if (messageIds.length === 0) return [];
    const placeholders = messageIds.map(() => "?").join(", ");
    return this.db
      .query<MessageRow, string[]>(`SELECT * FROM messages WHERE id IN (${placeholders}) ORDER BY created_at ASC, id ASC`)
      .all(...messageIds);
  }

  private deliveriesForMessages(messageIds: string[]) {
    if (messageIds.length === 0) return [];
    const placeholders = messageIds.map(() => "?").join(", ");
    return this.db
      .query<DeliveryRow, string[]>(`SELECT * FROM deliveries WHERE message_id IN (${placeholders}) ORDER BY created_at ASC, target_name ASC`)
      .all(...messageIds);
  }

  private memberDeliveryRows(roomId: string, sessionId: string) {
    return this.db
      .query<DeliveryRow, [string, string]>(
        `SELECT deliveries.* FROM deliveries
         JOIN messages ON messages.id = deliveries.message_id
         WHERE messages.room_id = ? AND deliveries.target_session_id = ?
         ORDER BY messages.created_at ASC, deliveries.created_at ASC`,
      )
      .all(roomId, sessionId);
  }

  private publicMessage(message: MessageRow, deliveries: DeliveryRow[]) {
    return {
      id: message.id,
      room_id: message.room_id,
      sender_type: message.sender_type,
      sender_id: message.sender_id,
      sender_name: message.sender_name,
      body: message.body,
      kind: message.kind,
      mentions: parseStoredMentions(message.mentions),
      parent_id: message.parent_id,
      created_at: message.created_at,
      deliveries: deliveries
        .filter((delivery) => delivery.message_id === message.id)
        .map((delivery) => ({
          target_session_id: delivery.target_session_id,
          target_name: delivery.target_name,
          mode: delivery.mode,
          state: delivery.state,
          injected_at: delivery.injected_at,
          attempt_count: delivery.attempt_count,
          last_error: delivery.last_error,
          created_at: delivery.created_at,
        })),
    };
  }

  private insertJoinBootstrap(input: { room: RoomRow; target: DeliveryTarget; role: string; body: string; createdAt: number }) {
    const { room, target, body, createdAt } = input;
    const messageId = this.insertSystemMessage(room.id, body, "join_bootstrap", createdAt);
    this.insertDeliveries(messageId, [target], "bootstrap", createdAt);
  }

  private insertDeliveries(messageId: string, targets: DeliveryTarget[], mode: string, createdAt: number, prompt?: SpawnPromptOptions) {
    for (const target of targets) {
      this.db.run(
        `INSERT INTO deliveries (message_id, target_session_id, target_name, mode, created_at, agent, model_provider_id, model_id, model_variant)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          messageId,
          target.session_id,
          target.name,
          mode,
          createdAt,
          prompt?.agent ?? null,
          prompt?.model?.providerID ?? null,
          prompt?.model?.modelID ?? null,
          prompt?.model?.variant ?? null,
        ],
      );
    }
  }

  private insertQuestionTargets(messageId: string, targets: DeliveryTarget[]) {
    for (const target of targets) {
      this.db.run("INSERT INTO question_targets (message_id, target_session_id, target_name) VALUES (?, ?, ?)", [
        messageId,
        target.session_id,
        target.name,
      ]);
    }
  }

  private cancelPendingDeliveries(targetSessionId: string, reason: string) {
    this.db.run("UPDATE deliveries SET state = 'cancelled', last_error = ? WHERE target_session_id = ? AND state = 'pending'", [
      reason,
      targetSessionId,
    ]);
  }

  private cancelPendingQuestionTargets(targetSessionId: string, now: number, reason: string) {
    this.db.run(
      "UPDATE question_targets SET state = 'cancelled', cancelled_at = ?, cancelled_reason = ? WHERE target_session_id = ? AND state = 'pending'",
      [now, reason, targetSessionId],
    );
  }

  private cancelPendingQuestionTargetsForRoom(roomId: string, now: number, reason: string) {
    this.db.run(
      `UPDATE question_targets
       SET state = 'cancelled', cancelled_at = ?, cancelled_reason = ?
       WHERE state = 'pending'
         AND message_id IN (SELECT id FROM messages WHERE room_id = ?)`,
      [now, reason, roomId],
    );
  }

  private migrate() {
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id                         TEXT PRIMARY KEY,
        base_name                  TEXT NOT NULL,
        name                       TEXT NOT NULL,
        project_dir                TEXT,
        state                      TEXT NOT NULL DEFAULT 'open',
        public_message             TEXT,
        public_message_updated_at  INTEGER,
        public_message_updated_by  TEXT,
        planner_password_hash      TEXT NOT NULL,
        created_at                 INTEGER NOT NULL,
        closed_at                  INTEGER
      );

      CREATE TABLE IF NOT EXISTS members (
        room_id                    TEXT NOT NULL REFERENCES rooms(id),
        session_id                 TEXT NOT NULL,
        name                       TEXT NOT NULL,
        role                       TEXT NOT NULL,
        state                      TEXT NOT NULL DEFAULT 'active',
        joined_at                  INTEGER NOT NULL,
        left_at                    INTEGER,
        removed_at                 INTEGER,
        removed_by                 TEXT,
        directory                  TEXT,
        agent                      TEXT,
        model_provider_id          TEXT,
        model_id                   TEXT,
        model_variant              TEXT,
        PRIMARY KEY (room_id, session_id),
        UNIQUE (room_id, name)
      );

      CREATE TABLE IF NOT EXISTS messages (
        id                         TEXT PRIMARY KEY,
        room_id                    TEXT NOT NULL REFERENCES rooms(id),
        sender_type                TEXT NOT NULL DEFAULT 'member',
        sender_id                  TEXT,
        sender_name                TEXT NOT NULL,
        body                       TEXT NOT NULL,
        kind                       TEXT NOT NULL DEFAULT 'note',
        mentions                   TEXT,
        parent_id                  TEXT,
        created_at                 INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS deliveries (
        message_id                 TEXT NOT NULL REFERENCES messages(id),
        target_session_id          TEXT NOT NULL,
        target_name                TEXT NOT NULL,
        mode                       TEXT NOT NULL,
        state                      TEXT NOT NULL DEFAULT 'pending',
        injected_at                INTEGER,
        attempt_count              INTEGER NOT NULL DEFAULT 0,
        last_error                 TEXT,
        created_at                 INTEGER NOT NULL,
        agent                      TEXT,
        model_provider_id          TEXT,
        model_id                   TEXT,
        model_variant              TEXT,
        PRIMARY KEY (message_id, target_session_id)
      );

      CREATE TABLE IF NOT EXISTS spawned_sessions (
        room_id                    TEXT NOT NULL REFERENCES rooms(id),
        session_id                 TEXT NOT NULL,
        spawned_by                 TEXT NOT NULL,
        created_at                 INTEGER NOT NULL,
        PRIMARY KEY (room_id, session_id)
      );

      CREATE TABLE IF NOT EXISTS question_targets (
        message_id                 TEXT NOT NULL REFERENCES messages(id),
        target_session_id          TEXT NOT NULL,
        target_name                TEXT NOT NULL,
        state                      TEXT NOT NULL DEFAULT 'pending',
        answered_at                INTEGER,
        cancelled_at               INTEGER,
        cancelled_reason           TEXT,
        PRIMARY KEY (message_id, target_session_id)
      );

      CREATE TABLE IF NOT EXISTS member_session_history (
        room_id        TEXT NOT NULL,
        name           TEXT NOT NULL,
        old_session_id TEXT NOT NULL,
        new_session_id TEXT NOT NULL,
        reason         TEXT NOT NULL,
        created_at     INTEGER NOT NULL,
        PRIMARY KEY (room_id, old_session_id, new_session_id)
      );
    `);
    this.ensureColumn("rooms", "public_message", "TEXT");
    this.ensureColumn("rooms", "public_message_updated_at", "INTEGER");
    this.ensureColumn("rooms", "public_message_updated_by", "TEXT");
    this.ensureColumn("messages", "parent_id", "TEXT");
    this.ensureColumn("members", "directory", "TEXT");
    this.ensureColumn("members", "agent", "TEXT");
    this.ensureColumn("members", "model_provider_id", "TEXT");
    this.ensureColumn("members", "model_id", "TEXT");
    this.ensureColumn("members", "model_variant", "TEXT");
    this.ensureColumn("deliveries", "agent", "TEXT");
    this.ensureColumn("deliveries", "model_provider_id", "TEXT");
    this.ensureColumn("deliveries", "model_id", "TEXT");
    this.ensureColumn("deliveries", "model_variant", "TEXT");
  }

  private ensureColumn(table: string, column: string, definition: string) {
    const exists = this.db
      .query<{ name: string }, []>(`PRAGMA table_info(${table})`)
      .all()
      .some((row) => row.name === column);
    if (!exists) this.db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function generatePlannerPassword() {
  return randomBytes(24).toString("base64url");
}

function formatTimestamp(ms: number) {
  const date = new Date(ms);
  const parts = [
    date.getFullYear(),
    date.getMonth() + 1,
    date.getDate(),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
  ];
  return `${parts[0]}${pad(parts[1])}${pad(parts[2])}${pad(parts[3])}${pad(parts[4])}${pad(parts[5])}`;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function promptOptionsFromRow(row?: AgentModelRow): SpawnPromptOptions {
  if (!row) return {};
  return {
    directory: row.directory ?? undefined,
    agent: row.agent ?? undefined,
    model:
      row.model_provider_id && row.model_id
        ? {
            providerID: row.model_provider_id,
            modelID: row.model_id,
            variant: row.model_variant ?? undefined,
          }
        : undefined,
  };
}

async function readJsonObject(request: Request) {
  const input = await request.json().catch(() => undefined);
  if (!input || typeof input !== "object" || Array.isArray(input)) throw httpError(400, "request body must be an object");
  return input as Record<string, unknown>;
}

function requireString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (typeof value !== "string" || value.trim() === "") throw httpError(400, `${key} is required`);
  return value;
}

function requireAlias(input: Record<string, unknown>, key: string) {
  const alias = requireString(input, key);
  assertValidAlias(alias, key);
  return alias;
}

export function assertValidAlias(alias: string, label = "alias") {
  if (!ALIAS_PATTERN.test(alias)) throw httpError(400, `${label} must match [a-z0-9][a-z0-9-]*`);
}

export function isValidAlias(alias: string) {
  return ALIAS_PATTERN.test(alias);
}

export function planMessageTargets(body: string, activeMembers: DeliveryTarget[], senderSessionId: string): MessageTargetPlan {
  const membersByName = new Map(activeMembers.map((member) => [member.name, member]));
  const tokens = parseMentionTokens(body);
  if (tokens.length === 0) {
    return {
      mentions: [],
      targets: activeMembers.filter((member) => member.session_id !== senderSessionId),
      mode: "buffered",
    };
  }

  for (const name of tokens) {
    if (name !== "everyone" && !membersByName.has(name)) throw httpError(400, `unknown mention: @${name}`);
  }

  const selected = tokens.includes("everyone")
    ? activeMembers
    : tokens.map((name) => membersByName.get(name)!);
  const targets = selected.filter((member) => member.session_id !== senderSessionId);
  const mentions = [...new Set(targets.map((member) => member.name))];
  return { mentions, targets, mode: "immediate" };
}

export function planHardMessageTargets(body: string, activeMembers: DeliveryTarget[], sender: { session_id: string; name: string }): MessageTargetPlan {
  const tokens = parseMentionTokens(body);
  if (tokens.length === 0) throw httpError(400, "hard target is required");
  if (tokens.includes(sender.name)) throw httpError(400, "hard target cannot be self");

  const plan = planMessageTargets(body, activeMembers, sender.session_id);
  if (plan.targets.length === 0) throw httpError(400, "hard target is required");
  return { ...plan, mode: "hard" };
}

export function hardAbortWaitMs(targetCount: number, baseMs: number, maxMs: number) {
  return Math.min(maxMs, Math.max(1, targetCount) * baseMs);
}

export function classifyDeliveryFailure(error: unknown): DeliveryFailureClassification {
  if (error instanceof OpenCodeRequestError) {
    if (error.status === 408 || error.status === 429 || error.status >= 500) return "retryable";
    return "permanent";
  }
  return "retryable";
}

export function planQuestionTargets(body: string, activeMembers: DeliveryTarget[], senderSessionId: string): QuestionTargetPlan {
  const tokens = parseMentionTokens(body);
  if (tokens.length === 0) throw httpError(400, "question target is required");

  const membersByName = new Map(activeMembers.map((member) => [member.name, member]));
  for (const name of tokens) {
    if (name !== "everyone" && !membersByName.has(name)) throw httpError(400, `unknown question target: @${name}`);
  }

  const selected = tokens.includes("everyone") ? activeMembers : tokens.map((name) => membersByName.get(name)!);
  const targets = selected.filter((member) => member.session_id !== senderSessionId);
  if (targets.length === 0) throw httpError(400, "question target is required");

  const mentions = [...new Set(targets.map((member) => member.name))];
  return { mentions, targets };
}

function parseMentionTokens(body: string) {
  return uniqueMatches(body, /@([a-z0-9][a-z0-9-]*|everyone)\b/g);
}

function uniqueMatches(input: string, pattern: RegExp) {
  const values: string[] = [];
  for (const match of input.matchAll(pattern)) {
    const value = match[1];
    if (value && !values.includes(value)) values.push(value);
  }
  return values;
}

function parseStoredMentions(mentions: string | null) {
  if (!mentions) return [];
  try {
    const parsed = JSON.parse(mentions);
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
  } catch {
    return [];
  }
}

function optionalString(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim() === "") throw httpError(400, `${key} must be a non-empty string`);
  return value;
}

function optionalBoolean(input: Record<string, unknown>, key: string) {
  const value = input[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw httpError(400, `${key} must be a boolean`);
  return value;
}

function optionalModel(input: Record<string, unknown>) {
  const value = input.model;
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw httpError(400, "model must be an object");
  const record = value as Record<string, unknown>;
  if (typeof record.providerID !== "string" || record.providerID.trim() === "") throw httpError(400, "model.providerID is required");
  if (typeof record.modelID !== "string" || record.modelID.trim() === "") throw httpError(400, "model.modelID is required");
  return {
    providerID: record.providerID,
    modelID: record.modelID,
    variant: typeof record.variant === "string" && record.variant.trim() !== "" ? record.variant : undefined,
  };
}

function parseRoomListParams(params: URLSearchParams): RoomListParams {
  const state = listState(params);
  const before = params.get("before") ?? undefined;
  let limit = DEFAULT_PAGE_SIZE;
  const limitParam = params.get("limit");
  if (limitParam !== null) {
    const parsed = parseInt(limitParam, 10);
    if (isNaN(parsed) || parsed < 1) throw httpError(400, "limit must be a positive integer");
    limit = Math.min(parsed, MAX_PAGE_SIZE);
  }
  return { state, before, limit };
}

function parsePaginationParams(params: URLSearchParams): PaginationParams {
  const since = params.get("since") ?? undefined;
  let limit = DEFAULT_PAGE_SIZE;
  const limitParam = params.get("limit");
  if (limitParam !== null) {
    const parsed = parseInt(limitParam, 10);
    if (isNaN(parsed) || parsed < 1) throw httpError(400, "limit must be a positive integer");
    limit = Math.min(parsed, MAX_PAGE_SIZE);
  }
  return { since, limit };
}

function listState(params: URLSearchParams): "open" | "closed" | "all" {
  const state = params.get("state");
  if (state === "all" || state === "closed" || state === "open") return state;
  if (params.get("all") === "true") return "all";
  if (params.get("closed") === "true") return "closed";
  return "open";
}

function jsonResponse(body: unknown, status = 200) {
  return Response.json(body, { status });
}

function httpError(status: number, message: string) {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

function errorResponse(error: unknown) {
  const status = typeof error === "object" && error && "status" in error ? Number((error as { status: unknown }).status) : 500;
  const message = error instanceof Error ? error.message : "internal server error";
  return jsonResponse({ error: message }, Number.isInteger(status) ? status : 500);
}

export async function resolveCollabTemplates(config: CollabConfig, vars: TemplateVars = {}): Promise<CollabTemplates> {
  return {
    room_join_instruction: renderTemplate(
      await loadTemplate(config.room_join_instruction, FALLBACK_ROOM_JOIN_INSTRUCTION),
      vars,
    ),
    reply_instruction: renderTemplate(
      await loadTemplate(config.reply_instruction, FALLBACK_REPLY_INSTRUCTION),
      vars,
    ),
  };
}

export async function loadTemplate(source: CollabInstructionSource | undefined, fallback: string) {
  if (!source) return fallback;
  if ("text" in source) return source.text;
  return await readFile(source.file, "utf8");
}

export function renderTemplate(template: string, vars: TemplateVars) {
  return template.replace(/\{([a-z_]+)\}/g, (match, key: keyof TemplateVars) => vars[key] ?? match);
}

export async function hashPlannerPassword(password: string) {
  return await Bun.password.hash(password, {
    algorithm: "argon2id",
  });
}

export async function verifyPlannerPassword(password: string, hash: string) {
  return await Bun.password.verify(password, hash);
}
