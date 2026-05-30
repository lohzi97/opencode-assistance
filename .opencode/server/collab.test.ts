import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  OpenCodeClient,
  OpenCodeRequestError,
  type QuestionRequest,
  type SessionStatusInfo,
  type OpenCodeClient as OpenCodeClientType,
} from "./shared";
import {
  CollabService,
  CollabStorage,
  assertValidAlias,
  classifyDeliveryFailure,
  hardAbortWaitMs,
  hashPlannerPassword,
  isValidAlias,
  planHardMessageTargets,
  planMessageTargets,
  planQuestionTargets,
  resolveCollabTemplates,
  verifyPlannerPassword,
} from "./collab";
import { parseCollabConfig, parseWorkerConfig } from "./config";
import type { CollabConfig } from "./config";

let tempDir = "";

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "collab-test-"));
});

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("collab config", () => {
  test("uses disabled defaults", () => {
    const config = parseWorkerConfig({}, {}).collab;
    expect(config.enabled).toBe(false);
    expect(config.host).toBe("127.0.0.1");
    expect(config.port).toBe(9100);
    expect(config.db_path.endsWith(".opencode/server/state/collab.sqlite")).toBe(true);
    expect(config.poll_interval_ms).toBe(5_000);
    expect(config.hard_abort_wait_ms).toBe(15_000);
    expect(config.hard_abort_wait_max_ms).toBe(60_000);
  });

  test("uses file config values", () => {
    const config = parseWorkerConfig(
      {
        collab: {
          enabled: true,
          host: "0.0.0.0",
          port: 9200,
          db_path: "tmp/collab.sqlite",
          poll_interval_ms: 1234,
          hard_abort_wait_ms: 10,
          hard_abort_wait_max_ms: 20,
        },
      },
      {},
    ).collab;

    expect(config.enabled).toBe(true);
    expect(config.host).toBe("0.0.0.0");
    expect(config.port).toBe(9200);
    expect(config.db_path.endsWith("tmp/collab.sqlite")).toBe(true);
    expect(config.poll_interval_ms).toBe(1234);
    expect(config.hard_abort_wait_ms).toBe(10);
    expect(config.hard_abort_wait_max_ms).toBe(20);
  });

  test("environment overrides port, db path, and poll interval", () => {
    const dbPath = path.join(tempDir, "env.sqlite");
    const config = parseCollabConfig(
      {
        port: 9200,
        db_path: "file.sqlite",
        poll_interval_ms: 1_000,
      },
      {
        AGENT_COLLAB_PORT: "9300",
        AGENT_COLLAB_DB_PATH: dbPath,
        AGENT_COLLAB_POLL_INTERVAL: "2500",
      },
    );

    expect(config.port).toBe(9300);
    expect(config.db_path).toBe(dbPath);
    expect(config.poll_interval_ms).toBe(2500);
  });

  test("accepts valid hard abort timeout ordering", () => {
    const config = parseCollabConfig({ hard_abort_wait_ms: 100, hard_abort_wait_max_ms: 100 }, {});
    expect(config.hard_abort_wait_ms).toBe(100);
    expect(config.hard_abort_wait_max_ms).toBe(100);
  });

  test("rejects invalid hard abort timeout ordering", () => {
    expect(() => parseCollabConfig({ hard_abort_wait_ms: 200, hard_abort_wait_max_ms: 100 }, {})).toThrow(
      "collab.hard_abort_wait_max_ms must be greater than or equal to collab.hard_abort_wait_ms",
    );
  });
});

describe("opencode client delivery boundary", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("reads session status and pending questions", async () => {
    const requests: string[] = [];
    globalThis.fetch = async (url) => {
      requests.push(String(url));
      if (String(url).endsWith("/session/status")) {
        return Response.json({ ses_idle: { type: "idle" } });
      }
      if (String(url).endsWith("/question")) {
        return Response.json([{ id: "q1", sessionID: "ses_idle", questions: [] }]);
      }
      return new Response("not found", { status: 404 });
    };

    const client = new OpenCodeClient();
    await expect(client.sessionStatus()).resolves.toEqual({ ses_idle: { type: "idle" } });
    await expect(client.pendingQuestions()).resolves.toEqual([{ id: "q1", sessionID: "ses_idle", questions: [] }]);
    expect(requests.some((url) => url.endsWith("/session/status"))).toBe(true);
    expect(requests.some((url) => url.endsWith("/question"))).toBe(true);
  });

  test("accepts async prompt success and surfaces transient failure", async () => {
    let fail = true;
    globalThis.fetch = async (url) => {
      if (!String(url).endsWith("/session/ses_1/prompt_async")) return new Response("not found", { status: 404 });
      if (fail) {
        fail = false;
        return new Response("temporary", { status: 503 });
      }
      return new Response(null, { status: 204 });
    };

    const client = new OpenCodeClient();
    await expect(client.promptAsync("ses_1", { parts: [{ type: "text", text: "hello" }] })).rejects.toThrow(
      "/session/ses_1/prompt_async failed: 503 temporary",
    );
    await expect(client.promptAsync("ses_1", { parts: [{ type: "text", text: "hello" }] })).resolves.toBeUndefined();
  });

  test("classifies retryable and permanent delivery failures", () => {
    expect(classifyDeliveryFailure(new OpenCodeRequestError("backend", 503, "temporary"))).toBe("retryable");
    expect(classifyDeliveryFailure(new OpenCodeRequestError("rate limited", 429, "retry later"))).toBe("retryable");
    expect(classifyDeliveryFailure(new OpenCodeRequestError("bad request", 400, "invalid"))).toBe("permanent");
    expect(classifyDeliveryFailure(new Error("network disconnected"))).toBe("retryable");
  });

  test("aborts sessions and classifies transport failure", async () => {
    let fail = true;
    globalThis.fetch = async (url) => {
      if (!String(url).endsWith("/session/ses_1/abort")) return new Response("not found", { status: 404 });
      if (fail) {
        fail = false;
        return new Response("temporary", { status: 503 });
      }
      return Response.json(true);
    };

    const client = new OpenCodeClient();
    await expect(client.abortSession("ses_1")).rejects.toThrow("/session/ses_1/abort failed: 503 temporary");
    await expect(client.abortSession("ses_1")).resolves.toBe(true);
  });

  test("creates spawn sessions with supported session-create payload", async () => {
    let payload: Record<string, unknown> | undefined;
    let sessionUrl = "";
    globalThis.fetch = async (url, init) => {
      sessionUrl = String(url);
      payload = JSON.parse(String(init?.body));
      return Response.json({ id: "ses_spawned", title: "spawned", directory: "/project", time: { created: 1, updated: 1 } });
    };

    const client = new OpenCodeClient();
    await expect(
      client.createSpawnSession({
        title: "spawned",
        directory: "/project",
      }),
    ).resolves.toMatchObject({ id: "ses_spawned" });
    expect(new URL(sessionUrl).searchParams.get("directory")).toBe("/project");
    expect(payload).toEqual({
      title: "spawned",
    });
  });
});

describe("collab templates", () => {
  test("uses text templates and preserves unknown placeholders", async () => {
    const templates = await resolveCollabTemplates(
      configWithTemplates({
        spawn_instruction: { text: "spawn {room} {alias} {unknown}" },
        reply_instruction: { text: "reply {from} {role}" },
      }),
      { room: "r", alias: "a", role: "implementer", from: "planner" },
    );

    expect(templates.spawn_instruction).toBe("spawn r a {unknown}");
    expect(templates.reply_instruction).toBe("reply planner implementer");
  });

  test("uses file templates instead of fallbacks", async () => {
    const spawnPath = path.join(tempDir, "spawn.md");
    const replyPath = path.join(tempDir, "reply.md");
    await writeFile(spawnPath, "file spawn {room}");
    await writeFile(replyPath, "file reply {alias}");

    const templates = await resolveCollabTemplates(
      configWithTemplates({
        spawn_instruction: { file: spawnPath },
        reply_instruction: { file: replyPath },
      }),
      { room: "room-one", alias: "worker" },
    );

    expect(templates.spawn_instruction).toBe("file spawn room-one");
    expect(templates.reply_instruction).toBe("file reply worker");
  });

  test("uses fallback templates when templates are absent", async () => {
    const templates = await resolveCollabTemplates(configWithTemplates({}), { room: "r", alias: "a", role: "x" });
    expect(templates.spawn_instruction).toContain("r");
    expect(templates.spawn_instruction).toContain("a");
    expect(templates.reply_instruction).toContain("a");
  });
});

describe("collab storage", () => {
  test("creates required tables and constraints", async () => {
    const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
    try {
      expect(storage.tableNames()).toEqual([
        "deliveries",
        "members",
        "messages",
        "question_targets",
        "rooms",
        "spawned_sessions",
      ]);

      storage.db.run(
        "INSERT INTO rooms (id, base_name, name, planner_password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
        ["room_1", "base", "base-20260527230000", "hash", 1],
      );
      storage.db.run(
        "INSERT INTO members (room_id, session_id, name, role, joined_at) VALUES (?, ?, ?, ?, ?)",
        ["room_1", "ses_1", "planner", "planner", 1],
      );
      expect(() =>
        storage.db.run(
          "INSERT INTO members (room_id, session_id, name, role, joined_at) VALUES (?, ?, ?, ?, ?)",
          ["room_1", "ses_2", "planner", "planner", 2],
        ),
      ).toThrow();
    } finally {
      storage.close();
    }
  });

  test("adds public-message columns to existing room tables", async () => {
    const dbPath = path.join(tempDir, "collab.sqlite");
    const legacy = new Database(dbPath, { create: true });
    legacy.exec(`
      CREATE TABLE rooms (
        id                         TEXT PRIMARY KEY,
        base_name                  TEXT NOT NULL,
        name                       TEXT NOT NULL,
        project_dir                TEXT,
        state                      TEXT NOT NULL DEFAULT 'open',
        planner_password_hash      TEXT NOT NULL,
        created_at                 INTEGER NOT NULL,
        closed_at                  INTEGER
      );
    `);
    legacy.close();

    const storage = await CollabStorage.open(dbPath);
    try {
      const columns = storage.db.query<{ name: string }, []>("PRAGMA table_info(rooms)").all().map((row) => row.name);
      expect(columns).toContain("public_message");
      expect(columns).toContain("public_message_updated_at");
      expect(columns).toContain("public_message_updated_by");
    } finally {
      storage.close();
    }
  });
});

describe("collab password helpers", () => {
  test("hashes and verifies without storing plaintext", async () => {
    const plaintext = "planner-secret";
    const hash = await hashPlannerPassword(plaintext);

    expect(hash).not.toBe(plaintext);
    expect(hash.includes(plaintext)).toBe(false);
    expect(await verifyPlannerPassword(plaintext, hash)).toBe(true);
    expect(await verifyPlannerPassword("wrong", hash)).toBe(false);
  });
});

describe("collab alias helpers", () => {
  test("accepts strict lowercase slug aliases", () => {
    for (const alias of ["a", "a1", "agent-1", "0-planner"]) {
      expect(isValidAlias(alias)).toBe(true);
      expect(() => assertValidAlias(alias)).not.toThrow();
    }
  });

  test("rejects invalid aliases", () => {
    for (const alias of ["", "-agent", "Agent", "agent_1", "agent 1"]) {
      expect(isValidAlias(alias)).toBe(false);
      expect(() => assertValidAlias(alias)).toThrow("alias must match [a-z0-9][a-z0-9-]*");
    }
  });
});

describe("collab mention planning", () => {
  const members = [
    { session_id: "ses_planner", name: "planner" },
    { session_id: "ses_worker", name: "worker" },
    { session_id: "ses_reviewer", name: "reviewer" },
  ];

  test("routes no mention as buffered to all other active members", () => {
    const plan = planMessageTargets("Please review the current status", members, "ses_planner");
    expect(plan.mode).toBe("buffered");
    expect(plan.mentions).toEqual([]);
    expect(plan.targets.map((target) => target.name)).toEqual(["worker", "reviewer"]);
  });

  test("routes a single mention as immediate", () => {
    const plan = planMessageTargets("@worker please implement", members, "ses_planner");
    expect(plan.mode).toBe("immediate");
    expect(plan.mentions).toEqual(["worker"]);
    expect(plan.targets.map((target) => target.session_id)).toEqual(["ses_worker"]);
  });

  test("routes multiple mentions once in mention order", () => {
    const plan = planMessageTargets("@reviewer check after @worker finishes @worker", members, "ses_planner");
    expect(plan.mode).toBe("immediate");
    expect(plan.mentions).toEqual(["reviewer", "worker"]);
    expect(plan.targets.map((target) => target.name)).toEqual(["reviewer", "worker"]);
  });

  test("expands everyone and skips the sender", () => {
    const plan = planMessageTargets("@everyone stand by", members, "ses_worker");
    expect(plan.mode).toBe("immediate");
    expect(plan.mentions).toEqual(["planner", "reviewer"]);
    expect(plan.targets.map((target) => target.name)).toEqual(["planner", "reviewer"]);
  });

  test("rejects unknown mentions", () => {
    expect(() => planMessageTargets("@missing hello", members, "ses_planner")).toThrow("unknown mention: @missing");
  });

  test("skips self mentions without creating self-delivery", () => {
    const plan = planMessageTargets("@planner note to self", members, "ses_planner");
    expect(plan.mode).toBe("immediate");
    expect(plan.mentions).toEqual([]);
    expect(plan.targets).toEqual([]);
  });

  test("routes planner hard mentions only to active non-self targets", () => {
    const plan = planHardMessageTargets("@worker hard stop", members, { session_id: "ses_planner", name: "planner" });
    expect(plan.mode).toBe("hard");
    expect(plan.mentions).toEqual(["worker"]);
    expect(plan.targets.map((target) => target.session_id)).toEqual(["ses_worker"]);
  });

  test("rejects hard messages with unknown, missing, or self-only targets", () => {
    expect(() => planHardMessageTargets("@missing hard stop", members, { session_id: "ses_planner", name: "planner" })).toThrow(
      "unknown mention: @missing",
    );
    expect(() => planHardMessageTargets("hard stop", members, { session_id: "ses_planner", name: "planner" })).toThrow(
      "hard target is required",
    );
    expect(() => planHardMessageTargets("@planner hard stop", members, { session_id: "ses_planner", name: "planner" })).toThrow(
      "hard target cannot be self",
    );
  });
});

describe("collab hard timeout scaling", () => {
  test("scales by target count with a cap", () => {
    expect(hardAbortWaitMs(1, 100, 1_000)).toBe(100);
    expect(hardAbortWaitMs(3, 100, 1_000)).toBe(300);
    expect(hardAbortWaitMs(20, 100, 1_000)).toBe(1_000);
  });
});

describe("collab question target planning", () => {
  const members = [
    { session_id: "ses_planner", name: "planner" },
    { session_id: "ses_worker", name: "worker" },
    { session_id: "ses_reviewer", name: "reviewer" },
  ];

  test("expands explicit aliases in mention order", () => {
    const plan = planQuestionTargets("@reviewer and @worker, what do you think?", members, "ses_planner");
    expect(plan.mentions).toEqual(["reviewer", "worker"]);
    expect(plan.targets.map((target) => target.session_id)).toEqual(["ses_reviewer", "ses_worker"]);
  });

  test("expands everyone except asker", () => {
    const plan = planQuestionTargets("@everyone are you ready?", members, "ses_worker");
    expect(plan.mentions).toEqual(["planner", "reviewer"]);
    expect(plan.targets.map((target) => target.name)).toEqual(["planner", "reviewer"]);
  });

  test("rejects unknown aliases", () => {
    expect(() => planQuestionTargets("@missing status?", members, "ses_planner")).toThrow("unknown question target: @missing");
  });

  test("rejects missing or self-only targets", () => {
    expect(() => planQuestionTargets("Status?", members, "ses_planner")).toThrow("question target is required");
    expect(() => planQuestionTargets("@planner Status?", members, "ses_planner")).toThrow("question target is required");
  });
});

describe("collab service", () => {
  test("disabled startup performs no API binding or delivery work", async () => {
    const logs: unknown[] = [];
    const client = {
      log: async (_level: string, message: string, extra?: Record<string, unknown>) => {
        logs.push({ message, extra });
      },
    } as OpenCodeClientType;
    const service = new CollabService(client, async () => configWithTemplates({ enabled: false }));

    await service.start();
    expect(service.active).toBe(false);
    expect(logs).toEqual([{ message: "collab service disabled", extra: undefined }]);
    await service.shutdown();
  });

  test("creates room with timestamped name and persisted founder planner", async () => {
    const service = await startedService();
    try {
      const response = await routeJson(service, "POST", "/room", {
        name: "add-dark-mode",
        session_id: "ses_creator",
        from: "planner",
        project_dir: "/tmp/project",
      });

      expect(response.status).toBe(201);
      expect(response.body.room_id).toStartWith("room_");
      expect(response.body.base_name).toBe("add-dark-mode");
      expect(response.body.name).toMatch(/^add-dark-mode-\d{14}$/);
      expect(response.body.project_dir).toBe("/tmp/project");
      expect(response.body.state).toBe("open");
      expect(response.body.founder).toEqual({ session_id: "ses_creator", name: "planner", role: "planner" });
      expect(typeof response.body.planner_password).toBe("string");

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const member = storage.db
          .query<{ role: string; state: string }, []>("SELECT role, state FROM members WHERE session_id = 'ses_creator'")
          .get();
        expect(member).toEqual({ role: "planner", state: "active" });
      } finally {
        storage.close();
      }
    } finally {
      await service.shutdown();
    }
  });

  test("rejects room creation when required fields are missing", async () => {
    const service = await startedService();
    try {
      const response = await routeJson(service, "POST", "/room", { name: "x", session_id: "ses_creator" });
      expect(response.status).toBe(400);
      expect(response.body.error).toBe("from is required");
    } finally {
      await service.shutdown();
    }
  });

  test("returns planner password once and excludes password data from messages and inspection", async () => {
    const service = await startedService();
    try {
      const created = await routeJson(service, "POST", "/room", {
        name: "secret-room",
        session_id: "ses_creator",
        from: "planner",
      });
      const password = created.body.planner_password;

      const status = await routeJson(service, "GET", `/room/${created.body.room_id}/status`);
      const listed = await routeJson(service, "GET", "/room/list");
      expect(JSON.stringify(status.body)).not.toContain(password);
      expect(JSON.stringify(status.body)).not.toContain("planner_password");
      expect(JSON.stringify(listed.body)).not.toContain(password);
      expect(JSON.stringify(listed.body)).not.toContain("planner_password_hash");

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const room = storage.db
          .query<{ planner_password_hash: string }, []>("SELECT planner_password_hash FROM rooms LIMIT 1")
          .get();
        const messages = storage.db.query<{ body: string }, []>("SELECT body FROM messages").all();
        expect(room?.planner_password_hash).not.toBe(password);
        expect(JSON.stringify(messages)).not.toContain(password);
        expect(JSON.stringify(messages)).not.toContain(room?.planner_password_hash ?? "missing-hash");
      } finally {
        storage.close();
      }
    } finally {
      await service.shutdown();
    }
  });

  test("rejects new room when founder session is already in another open room", async () => {
    const service = await startedService();
    try {
      await routeJson(service, "POST", "/room", { name: "first", session_id: "ses_creator", from: "planner" });
      const response = await routeJson(service, "POST", "/room", {
        name: "second",
        session_id: "ses_creator",
        from: "planner2",
      });

      expect(response.status).toBe(409);
      expect(response.body.error).toBe("founder session already belongs to an open room");
    } finally {
      await service.shutdown();
    }
  });

  test("returns status and lists open rooms by default with closed and all flags", async () => {
    const service = await startedService();
    try {
      const openRoom = await routeJson(service, "POST", "/room", { name: "open", session_id: "ses_open", from: "planner" });
      const closingRoom = await routeJson(service, "POST", "/room", {
        name: "closed",
        session_id: "ses_closed",
        from: "planner",
      });
      await routeJson(service, "DELETE", `/room/${closingRoom.body.room_id}`, { session_id: "ses_closed", from: "planner" });

      const status = await routeJson(service, "GET", `/room/${openRoom.body.name}/status`);
      expect(status.body.members).toEqual([
        expect.objectContaining({ session_id: "ses_open", name: "planner", role: "planner", state: "active" }),
      ]);

      const defaultList = await routeJson(service, "GET", "/room/list");
      expect(defaultList.body.rooms.map((room: { room_id: string }) => room.room_id)).toEqual([openRoom.body.room_id]);

      const closedList = await routeJson(service, "GET", "/room/list?state=closed");
      expect(closedList.body.rooms.map((room: { room_id: string }) => room.room_id)).toEqual([closingRoom.body.room_id]);

      const allList = await routeJson(service, "GET", "/room/list?state=all");
      expect(allList.body.rooms.map((room: { room_id: string }) => room.room_id).sort()).toEqual(
        [openRoom.body.room_id, closingRoom.body.room_id].sort(),
      );
    } finally {
      await service.shutdown();
    }
  });

  test("allows only active planners to close rooms and stores terminal closure", async () => {
    const service = await startedService();
    try {
      const created = await routeJson(service, "POST", "/room", { name: "close-me", session_id: "ses_creator", from: "planner" });
      const rejected = await routeJson(service, "DELETE", `/room/${created.body.room_id}`, {
        session_id: "ses_creator",
        from: "not-planner",
      });
      expect(rejected.status).toBe(403);

      const closed = await routeJson(service, "DELETE", `/room/${created.body.room_id}`, {
        session_id: "ses_creator",
        from: "planner",
      });
      expect(closed.body.state).toBe("closed");
      expect(typeof closed.body.closed_at).toBe("number");

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const closeMessage = storage.db
          .query<{ kind: string; body: string }, []>("SELECT kind, body FROM messages WHERE kind = 'room_closed'")
          .get();
        expect(closeMessage).toEqual({ kind: "room_closed", body: "Room closed by planner." });
      } finally {
        storage.close();
      }
    } finally {
      await service.shutdown();
    }
  });

  test("rejects closed-room mutations but keeps reads available", async () => {
    const service = await startedService();
    try {
      const created = await routeJson(service, "POST", "/room", { name: "read-after-close", session_id: "ses_creator", from: "planner" });
      await routeJson(service, "DELETE", `/room/${created.body.room_id}`, { session_id: "ses_creator", from: "planner" });
      const closeAgain = await routeJson(service, "DELETE", `/room/${created.body.room_id}`, {
        session_id: "ses_creator",
        from: "planner",
      });
      const status = await routeJson(service, "GET", `/room/${created.body.room_id}/status`);
      const all = await routeJson(service, "GET", "/room/list?all=true");

      expect(closeAgain.status).toBe(409);
      expect(closeAgain.body.error).toBe("room is closed");
      expect(status.status).toBe(200);
      expect(status.body.state).toBe("closed");
      expect(all.body.rooms).toHaveLength(1);
    } finally {
      await service.shutdown();
    }
  });

  test("validates member aliases and rejects room alias collisions", async () => {
    const service = await startedService();
    try {
      const created = await routeJson(service, "POST", "/room", { name: "aliases", session_id: "ses_creator", from: "planner" });
      const invalid = await routeJson(service, "POST", `/room/${created.body.room_id}/member`, {
        session_id: "ses_creator",
        from: "planner",
        target_session_id: "ses_worker",
        name: "Worker_1",
        role: "implementer",
      });
      const added = await routeJson(service, "POST", `/room/${created.body.room_id}/member`, {
        session_id: "ses_creator",
        from: "planner",
        target_session_id: "ses_worker",
        name: "worker-1",
        role: "implementer",
      });
      const collision = await routeJson(service, "POST", `/room/${created.body.room_id}/member`, {
        session_id: "ses_creator",
        from: "planner",
        target_session_id: "ses_other",
        name: "worker-1",
        role: "implementer",
      });
      await routeJson(service, "DELETE", `/room/${created.body.room_id}/leave`, {
        session_id: "ses_worker",
        from: "worker-1",
      });
      const immutableCollision = await routeJson(service, "POST", `/room/${created.body.room_id}/member`, {
        session_id: "ses_creator",
        from: "planner",
        target_session_id: "ses_other",
        name: "worker-1",
        role: "implementer",
      });

      expect(invalid.status).toBe(400);
      expect(added.status).toBe(201);
      expect(collision.status).toBe(409);
      expect(collision.body.error).toBe("alias already exists in room");
      expect(immutableCollision.status).toBe(409);
      expect(immutableCollision.body.error).toBe("alias already exists in room");
    } finally {
      await service.shutdown();
    }
  });

  test("allows only active planners for planner mutations and active members to leave themselves", async () => {
    const service = await startedService();
    try {
      const created = await routeJson(service, "POST", "/room", { name: "authz", session_id: "ses_creator", from: "planner" });
      await routeJson(service, "POST", `/room/${created.body.room_id}/member`, {
        session_id: "ses_creator",
        from: "planner",
        target_session_id: "ses_worker",
        name: "worker",
        role: "implementer",
      });

      const nonPlannerAdd = await routeJson(service, "POST", `/room/${created.body.room_id}/member`, {
        session_id: "ses_worker",
        from: "worker",
        target_session_id: "ses_other",
        name: "other",
        role: "implementer",
      });
      const spoofedLeave = await routeJson(service, "DELETE", `/room/${created.body.room_id}/leave`, {
        session_id: "ses_worker",
        from: "planner",
      });
      const left = await routeJson(service, "DELETE", `/room/${created.body.room_id}/leave`, {
        session_id: "ses_worker",
        from: "worker",
      });

      expect(nonPlannerAdd.status).toBe(403);
      expect(nonPlannerAdd.body.error).toBe("planner role required");
      expect(spoofedLeave.status).toBe(403);
      expect(spoofedLeave.body.error).toBe("active member required");
      expect(left.status).toBe(200);
      expect(left.body.members.map((member: { name: string }) => member.name)).toEqual(["planner"]);
    } finally {
      await service.shutdown();
    }
  });

  test("planner public-message set fully replaces room fields and records transcript", async () => {
    const service = await startedService();
    try {
      const room = await roomWithMembers(service);
      const rejected = await routeJson(service, "POST", `/room/${room.room_id}/public-message`, {
        session_id: "ses_worker",
        from: "worker",
        body: "Workers may not pin context.",
      });
      const first = await routeJson(service, "POST", `/room/${room.room_id}/public-message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Initial pinned context.",
      });
      const second = await routeJson(service, "POST", `/room/${room.room_id}/public-message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Replacement pinned context.",
      });

      expect(rejected.status).toBe(403);
      expect(rejected.body.error).toBe("planner role required");
      expect(first.status).toBe(200);
      expect(first.body.public_message).toBe("Initial pinned context.");
      expect(first.body.public_message_updated_by).toBe("planner");
      expect(typeof first.body.public_message_updated_at).toBe("number");
      expect(second.body.public_message).toBe("Replacement pinned context.");
      expect(second.body.public_message_updated_by).toBe("planner");
      expect(second.body.public_message_updated_at).toBeGreaterThanOrEqual(first.body.public_message_updated_at);

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const roomRow = storage.db
          .query<{ public_message: string; public_message_updated_by: string; public_message_updated_at: number }, [string]>(
            "SELECT public_message, public_message_updated_by, public_message_updated_at FROM rooms WHERE id = ?",
          )
          .get(room.room_id);
        const messages = storage.db
          .query<{ kind: string; body: string }, []>(
            "SELECT kind, body FROM messages WHERE kind = 'room_public_message_updated' ORDER BY created_at ASC",
          )
          .all();
        expect(roomRow).toEqual({
          public_message: "Replacement pinned context.",
          public_message_updated_by: "planner",
          public_message_updated_at: second.body.public_message_updated_at,
        });
        expect(messages).toEqual([
          { kind: "room_public_message_updated", body: "Public message updated by planner:\nInitial pinned context." },
          { kind: "room_public_message_updated", body: "Public message updated by planner:\nReplacement pinned context." },
        ]);
      } finally {
        storage.close();
      }
    } finally {
      await service.shutdown();
    }
  });

  test("planner public-message clear nulls status fields and records transcript", async () => {
    const service = await startedService();
    try {
      const room = await roomWithMembers(service);
      await routeJson(service, "POST", `/room/${room.room_id}/public-message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Context to clear.",
      });
      const cleared = await routeJson(service, "DELETE", `/room/${room.room_id}/public-message`, {
        session_id: "ses_planner",
        from: "planner",
      });
      const status = await routeJson(service, "GET", `/room/${room.room_id}/status`);

      expect(cleared.status).toBe(200);
      expect(cleared.body.public_message).toBeNull();
      expect(cleared.body.public_message_updated_by).toBeNull();
      expect(cleared.body.public_message_updated_at).toBeNull();
      expect(status.body.public_message).toBeNull();
      expect(status.body.public_message_updated_by).toBeNull();
      expect(status.body.public_message_updated_at).toBeNull();

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const message = storage.db
          .query<{ kind: string; body: string }, []>("SELECT kind, body FROM messages WHERE kind = 'room_public_message_cleared'")
          .get();
        expect(message).toEqual({ kind: "room_public_message_cleared", body: "Public message cleared by planner." });
      } finally {
        storage.close();
      }
    } finally {
      await service.shutdown();
    }
  });

  test("public-message set and clear immediately notify other active members only", async () => {
    const service = await startedService();
    try {
      const room = await roomWithMembers(service);
      const updated = await routeJson(service, "POST", `/room/${room.room_id}/public-message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Notify the room.",
      });
      const cleared = await routeJson(service, "DELETE", `/room/${room.room_id}/public-message`, {
        session_id: "ses_planner",
        from: "planner",
      });

      expect(updated.status).toBe(200);
      expect(cleared.status).toBe(200);

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const rows = storage.db
          .query<{ kind: string; target_name: string; mode: string }, []>(
            `SELECT messages.kind, deliveries.target_name, deliveries.mode
             FROM messages
             JOIN deliveries ON deliveries.message_id = messages.id
             WHERE messages.kind IN ('room_public_message_updated', 'room_public_message_cleared')
             ORDER BY messages.kind ASC, deliveries.target_name ASC`,
          )
          .all();
        expect(rows).toEqual([
          { kind: "room_public_message_cleared", target_name: "reviewer", mode: "immediate" },
          { kind: "room_public_message_cleared", target_name: "worker", mode: "immediate" },
          { kind: "room_public_message_updated", target_name: "reviewer", mode: "immediate" },
          { kind: "room_public_message_updated", target_name: "worker", mode: "immediate" },
        ]);
      } finally {
        storage.close();
      }
    } finally {
      await service.shutdown();
    }
  });

  test("status includes populated and null public-message fields", async () => {
    const service = await startedService();
    try {
      const room = await roomWithMembers(service);
      const initial = await routeJson(service, "GET", `/room/${room.room_id}/status`);
      await routeJson(service, "POST", `/room/${room.room_id}/public-message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Visible in status.",
      });
      const populated = await routeJson(service, "GET", `/room/${room.room_id}/status`);

      expect(initial.body.public_message).toBeNull();
      expect(initial.body.public_message_updated_by).toBeNull();
      expect(initial.body.public_message_updated_at).toBeNull();
      expect(populated.body.public_message).toBe("Visible in status.");
      expect(populated.body.public_message_updated_by).toBe("planner");
      expect(typeof populated.body.public_message_updated_at).toBe("number");
    } finally {
      await service.shutdown();
    }
  });

  test("public-message text is injected into update notifications and future deliveries", async () => {
    const client = mockClient();
    const service = await startedService(client);
    try {
      const room = await roomWithMembers(service);
      await markAllDeliveriesInjected();
      await routeJson(service, "POST", `/room/${room.room_id}/public-message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Pinned: finish the public-message change.",
      });

      await expect(service.attemptFlush("ses_worker", { type: "busy" }, [])).resolves.toEqual({ flushed: true, count: 1 });
      expect(client.prompts).toHaveLength(1);
      expect(client.prompts[0].text).toContain("[Room Public Message]\nPinned: finish the public-message change.");
      expect(client.prompts[0].text).toContain("Public message updated by planner:\nPinned: finish the public-message change.");

      await markAllDeliveriesInjected();
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Buffered work item.",
      });
      await expect(service.attemptFlush("ses_worker", { type: "idle" }, [])).resolves.toEqual({ flushed: true, count: 1 });
      expect(client.prompts[1].text).toContain("[Room Public Message]\nPinned: finish the public-message change.");
      expect(client.prompts[1].text).toContain("Buffered work item.");

      await markAllDeliveriesInjected();
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker Immediate work item.",
      });
      await expect(service.attemptFlush("ses_worker", { type: "busy" }, [])).resolves.toEqual({ flushed: true, count: 1 });
      expect(client.prompts[2].text).toContain("[Room Public Message]\nPinned: finish the public-message change.");
      expect(client.prompts[2].text).toContain("@worker Immediate work item.");
    } finally {
      await service.shutdown();
    }
  });

  test("closed rooms reject public-message mutations while reads remain available", async () => {
    const service = await startedService();
    try {
      const room = await roomWithMembers(service);
      await routeJson(service, "DELETE", `/room/${room.room_id}`, { session_id: "ses_planner", from: "planner" });

      const rejectedSet = await routeJson(service, "POST", `/room/${room.room_id}/public-message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Too late.",
      });
      const rejectedClear = await routeJson(service, "DELETE", `/room/${room.room_id}/public-message`, {
        session_id: "ses_planner",
        from: "planner",
      });
      const status = await routeJson(service, "GET", `/room/${room.room_id}/status`);
      const messages = await routeJson(service, "GET", `/room/${room.room_id}/messages`);

      expect(rejectedSet.status).toBe(409);
      expect(rejectedSet.body.error).toBe("room is closed");
      expect(rejectedClear.status).toBe(409);
      expect(rejectedClear.body.error).toBe("room is closed");
      expect(status.status).toBe(200);
      expect(status.body.state).toBe("closed");
      expect(messages.status).toBe(200);
      expect(messages.body.messages).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "room_closed" })]));
    } finally {
      await service.shutdown();
    }
  });

  test("rejects member add and self-join for sessions active in another open room", async () => {
    const service = await startedService();
    try {
      const first = await routeJson(service, "POST", "/room", { name: "first", session_id: "ses_one", from: "planner" });
      const second = await routeJson(service, "POST", "/room", { name: "second", session_id: "ses_two", from: "planner" });
      const addActive = await routeJson(service, "POST", `/room/${second.body.room_id}/member`, {
        session_id: "ses_two",
        from: "planner",
        target_session_id: "ses_one",
        name: "taken",
        role: "implementer",
      });
      const joinActive = await routeJson(service, "POST", `/room/${second.body.room_id}/join`, {
        session_id: "ses_one",
        name: "planner-2",
        password: second.body.planner_password,
      });

      expect(first.status).toBe(201);
      expect(addActive.status).toBe(409);
      expect(addActive.body.error).toBe("target session already belongs to an open room");
      expect(joinActive.status).toBe(409);
      expect(joinActive.body.error).toBe("session already belongs to an open room");
    } finally {
      await service.shutdown();
    }
  });

  test("planner member add persists member, system message, and bootstrap delivery order", async () => {
    const service = await startedService();
    try {
      const created = await routeJson(service, "POST", "/room", { name: "add-member", session_id: "ses_creator", from: "planner" });
      const added = await routeJson(service, "POST", `/room/${created.body.room_id}/member`, {
        session_id: "ses_creator",
        from: "planner",
        target_session_id: "ses_worker",
        name: "worker",
        role: "implementer",
      });

      expect(added.status).toBe(201);
      expect(added.body.members).toEqual([
        expect.objectContaining({ session_id: "ses_creator", name: "planner", role: "planner" }),
        expect.objectContaining({ session_id: "ses_worker", name: "worker", role: "implementer" }),
      ]);

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const rows = storage.db
          .query<{ kind: string; target_session_id: string | null; mode: string | null; created_at: number }, []>(
            `SELECT messages.kind, deliveries.target_session_id, deliveries.mode, messages.created_at
             FROM messages
             LEFT JOIN deliveries ON deliveries.message_id = messages.id
             WHERE messages.kind IN ('join_bootstrap', 'member_joined')
             ORDER BY messages.created_at ASC, messages.kind ASC`,
          )
          .all();
        expect(rows).toEqual([
          { kind: "join_bootstrap", target_session_id: "ses_worker", mode: "bootstrap", created_at: expect.any(Number) },
          { kind: "member_joined", target_session_id: "ses_creator", mode: "buffered", created_at: expect.any(Number) },
        ]);
        expect(rows[0].created_at).toBeLessThan(rows[1].created_at);
      } finally {
        storage.close();
      }
    } finally {
      await service.shutdown();
    }
  });

  test("planner spawn persists ownership and rejects non-planners without creating sessions", async () => {
    const client = mockClient();
    const service = await startedService(client);
    try {
      const created = await routeJson(service, "POST", "/room", { name: "spawn-room", session_id: "ses_planner", from: "planner" });
      await routeJson(service, "POST", `/room/${created.body.room_id}/member`, {
        session_id: "ses_planner",
        from: "planner",
        target_session_id: "ses_worker",
        name: "worker",
        role: "implementer",
      });
      const rejected = await routeJson(service, "POST", `/room/${created.body.room_id}/spawn`, {
        session_id: "ses_worker",
        from: "worker",
        name: "spawned-a",
        role: "implementer",
      });
      const spawned = await routeJson(service, "POST", `/room/${created.body.room_id}/spawn`, {
        session_id: "ses_planner",
        from: "planner",
        name: "spawned-a",
        role: "implementer",
        agent: "sebastian",
        model: { providerID: "provider-x", modelID: "model-y" },
        directory: "/tmp/spawn",
        initial_prompt: "Implement the task.",
      });

      expect(rejected.status).toBe(403);
      expect(rejected.body.error).toBe("planner role required");
      expect(client.createdSessions).toHaveLength(1);
      expect(client.createdSessions[0]).toEqual({
        title: expect.stringContaining("spawned-a"),
        directory: "/tmp/spawn",
      });
      expect(spawned.status).toBe(201);
      expect(spawned.body.members).toContainEqual(expect.objectContaining({ session_id: "ses_spawned_1", name: "spawned-a" }));

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const row = storage.db
          .query<{ room_id: string; session_id: string; spawned_by: string }, []>("SELECT room_id, session_id, spawned_by FROM spawned_sessions")
          .get();
        const prompt = storage.db
          .query<{ agent: string; model_provider_id: string; model_id: string }, []>(
            "SELECT agent, model_provider_id, model_id FROM deliveries WHERE mode = 'spawn_initial'",
          )
          .get();
        expect(row).toEqual({ room_id: created.body.room_id, session_id: "ses_spawned_1", spawned_by: "ses_planner" });
        expect(prompt).toEqual({ agent: "sebastian", model_provider_id: "provider-x", model_id: "model-y" });
      } finally {
        storage.close();
      }
    } finally {
      await service.shutdown();
    }
  });

  test("spawn reuses alias and open-room validation before session creation", async () => {
    const client = mockClient();
    const service = await startedService(client);
    try {
      const first = await routeJson(service, "POST", "/room", { name: "first", session_id: "ses_one", from: "planner" });
      const second = await routeJson(service, "POST", "/room", { name: "second", session_id: "ses_two", from: "planner" });
      const collision = await routeJson(service, "POST", `/room/${second.body.room_id}/spawn`, {
        session_id: "ses_two",
        from: "planner",
        name: "planner",
        role: "implementer",
      });
      client.nextSessionId = "ses_one";
      const alreadyActive = await routeJson(service, "POST", `/room/${second.body.room_id}/spawn`, {
        session_id: "ses_two",
        from: "planner",
        name: "spawned-b",
        role: "implementer",
      });

      expect(first.status).toBe(201);
      expect(collision.status).toBe(409);
      expect(collision.body.error).toBe("alias already exists in room");
      expect(alreadyActive.status).toBe(409);
      expect(alreadyActive.body.error).toBe("target session already belongs to an open room");
      expect(client.createdSessions).toHaveLength(1);
    } finally {
      await service.shutdown();
    }
  });

  test("password self-join grants planner and does not leak password on failures", async () => {
    const service = await startedService();
    try {
      const created = await routeJson(service, "POST", "/room", { name: "join-room", session_id: "ses_creator", from: "planner" });
      const password = created.body.planner_password;
      const missingAlias = await routeJson(service, "POST", `/room/${created.body.room_id}/join`, {
        session_id: "ses_missing",
        password,
      });
      const invalidPassword = await routeJson(service, "POST", `/room/${created.body.room_id}/join`, {
        session_id: "ses_bad",
        name: "planner-2",
        password: "wrong",
      });
      const joined = await routeJson(service, "POST", `/room/${created.body.room_id}/join`, {
        session_id: "ses_joiner",
        name: "planner-2",
        password,
      });

      expect(missingAlias.status).toBe(400);
      expect(missingAlias.body.error).toBe("name is required");
      expect(invalidPassword.status).toBe(403);
      expect(invalidPassword.body.error).toBe("invalid planner password");
      expect(JSON.stringify(invalidPassword.body)).not.toContain(password);
      expect(joined.status).toBe(201);
      expect(joined.body.members).toContainEqual(expect.objectContaining({ session_id: "ses_joiner", name: "planner-2", role: "planner" }));
      expect(JSON.stringify(joined.body)).not.toContain(password);
    } finally {
      await service.shutdown();
    }
  });

  test("leave and planner removal reject final planner and cancel pending work", async () => {
    const service = await startedService();
    try {
      const created = await routeJson(service, "POST", "/room", { name: "remove-room", session_id: "ses_creator", from: "planner" });
      await routeJson(service, "POST", `/room/${created.body.room_id}/join`, {
        session_id: "ses_planner2",
        name: "planner-2",
        password: created.body.planner_password,
      });
      await routeJson(service, "POST", `/room/${created.body.room_id}/member`, {
        session_id: "ses_creator",
        from: "planner",
        target_session_id: "ses_worker",
        name: "worker",
        role: "implementer",
      });

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        storage.db.run(
          "INSERT INTO messages (id, room_id, sender_type, sender_name, body, kind, created_at) VALUES (?, ?, 'system', 'system', ?, 'question', ?)",
          ["msg_question", created.body.room_id, "Question?", 1],
        );
        storage.db.run(
          "INSERT INTO deliveries (message_id, target_session_id, target_name, mode, created_at) VALUES (?, ?, ?, 'buffered', ?)",
          ["msg_question", "ses_worker", "worker", 1],
        );
        storage.db.run(
          "INSERT INTO question_targets (message_id, target_session_id, target_name) VALUES (?, ?, ?)",
          ["msg_question", "ses_worker", "worker"],
        );
      } finally {
        storage.close();
      }

      const planner2Left = await routeJson(service, "DELETE", `/room/${created.body.room_id}/leave`, {
        session_id: "ses_planner2",
        from: "planner-2",
      });
      const removedWorker = await routeJson(service, "DELETE", `/room/${created.body.room_id}/member`, {
        session_id: "ses_creator",
        from: "planner",
        target: "worker",
      });
      const finalPlannerRemove = await routeJson(service, "DELETE", `/room/${created.body.room_id}/member`, {
        session_id: "ses_creator",
        from: "planner",
        target: "planner",
      });
      const finalPlannerLeave = await routeJson(service, "DELETE", `/room/${created.body.room_id}/leave`, {
        session_id: "ses_creator",
        from: "planner",
      });

      expect(planner2Left.status).toBe(200);
      expect(removedWorker.status).toBe(200);
      expect(finalPlannerRemove.status).toBe(409);
      expect(finalPlannerRemove.body.error).toBe("room must retain at least one planner");
      expect(finalPlannerLeave.status).toBe(409);
      expect(finalPlannerLeave.body.error).toBe("room must retain at least one planner");

      const verifyStorage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const delivery = verifyStorage.db
          .query<{ state: string; last_error: string }, []>(
            "SELECT state, last_error FROM deliveries WHERE message_id = 'msg_question' AND target_session_id = 'ses_worker'",
          )
          .get();
        const question = verifyStorage.db
          .query<{ state: string; cancelled_reason: string }, []>(
            "SELECT state, cancelled_reason FROM question_targets WHERE message_id = 'msg_question' AND target_session_id = 'ses_worker'",
          )
          .get();
        expect(delivery).toEqual({ state: "cancelled", last_error: "member removed" });
        expect(question).toEqual({ state: "cancelled", cancelled_reason: "member removed" });
      } finally {
        verifyStorage.close();
      }
    } finally {
      await service.shutdown();
    }
  });

  test("member messages require matching active sender identity", async () => {
    const service = await startedService();
    try {
      const room = await roomWithMembers(service);

      const valid = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_worker",
        from: "worker",
        body: "Ready to work.",
        kind: "note",
      });
      const mismatched = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_worker",
        from: "planner",
        body: "spoofed",
      });
      await routeJson(service, "DELETE", `/room/${room.room_id}/leave`, { session_id: "ses_worker", from: "worker" });
      const inactive = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_worker",
        from: "worker",
        body: "after leave",
      });

      expect(valid.status).toBe(201);
      expect(valid.body.sender_type).toBe("member");
      expect(valid.body.sender_id).toBe("ses_worker");
      expect(valid.body.sender_name).toBe("worker");
      expect(valid.body.kind).toBe("note");
      expect(mismatched.status).toBe(403);
      expect(mismatched.body.error).toBe("active member required");
      expect(inactive.status).toBe(403);
      expect(inactive.body.error).toBe("active member required");
    } finally {
      await service.shutdown();
    }
  });

  test("member messages persist delivery mode and chronological timestamps", async () => {
    const service = await startedService();
    try {
      const room = await roomWithMembers(service);
      const buffered = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "General update",
      });
      const immediate = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker Please take this now",
        kind: "task_assignment",
      });

      expect(buffered.status).toBe(201);
      expect(buffered.body.deliveries.map((delivery: { target_name: string; mode: string }) => [delivery.target_name, delivery.mode])).toEqual([
        ["reviewer", "buffered"],
        ["worker", "buffered"],
      ]);
      expect(immediate.status).toBe(201);
      expect(immediate.body.mentions).toEqual(["worker"]);
      expect(immediate.body.deliveries).toEqual([
        expect.objectContaining({ target_session_id: "ses_worker", target_name: "worker", mode: "immediate", state: "pending" }),
      ]);
      expect(buffered.body.created_at).toBeLessThanOrEqual(immediate.body.created_at);
      expect(buffered.body.deliveries[0].created_at).toBe(buffered.body.created_at);
      expect(immediate.body.deliveries[0].created_at).toBe(immediate.body.created_at);
    } finally {
      await service.shutdown();
    }
  });

  test("unknown message mentions reject the whole message without deliveries", async () => {
    const service = await startedService();
    try {
      const room = await roomWithMembers(service);
      const rejected = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@missing please help",
      });
      expect(rejected.status).toBe(400);
      expect(rejected.body.error).toBe("unknown mention: @missing");

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const count = storage.db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM messages WHERE body LIKE '%missing%'").get();
        expect(count?.count).toBe(0);
      } finally {
        storage.close();
      }
    } finally {
      await service.shutdown();
    }
  });

  test("hard messages require planner sender and valid active non-self targets", async () => {
    const service = await startedService();
    try {
      const room = await roomWithMembers(service);
      await routeJson(service, "DELETE", `/room/${room.room_id}/member`, { session_id: "ses_planner", from: "planner", target: "reviewer" });

      const nonPlanner = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_worker",
        from: "worker",
        body: "@planner stop",
        hard: true,
      });
      const unknown = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@missing stop",
        hard: true,
      });
      const inactive = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@reviewer stop",
        hard: true,
      });
      const self = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@planner stop",
        hard: true,
      });

      expect(nonPlanner.status).toBe(403);
      expect(nonPlanner.body.error).toBe("planner role required");
      expect(unknown.status).toBe(400);
      expect(unknown.body.error).toBe("unknown mention: @missing");
      expect(inactive.status).toBe(400);
      expect(inactive.body.error).toBe("unknown mention: @reviewer");
      expect(self.status).toBe(400);
      expect(self.body.error).toBe("hard target cannot be self");

      const valid = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker stop now",
        hard: true,
      });
      expect(valid.status).toBe(201);
      expect(valid.body.deliveries).toEqual([expect.objectContaining({ target_name: "worker", mode: "hard", state: "pending" })]);
    } finally {
      await service.shutdown();
    }
  });

  test("room-wide messages include member and system transcript entries with delivery annotations", async () => {
    const service = await startedService();
    try {
      const room = await roomWithMembers(service);
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@everyone please sync",
      });

      const transcript = await routeJson(service, "GET", `/room/${room.room_id}/messages`);
      expect(transcript.status).toBe(200);
      expect(transcript.body.room_id).toBe(room.room_id);
      expect(transcript.body.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ sender_type: "system", sender_name: "system", kind: "founder_joined" }),
          expect.objectContaining({ sender_type: "system", sender_name: "system", kind: "member_joined" }),
          expect.objectContaining({ sender_type: "member", sender_name: "planner", body: "@everyone please sync" }),
        ]),
      );
      const memberMessage = transcript.body.messages.find((message: { body: string }) => message.body === "@everyone please sync");
      expect(memberMessage.deliveries.map((delivery: { target_name: string; mode: string }) => [delivery.target_name, delivery.mode])).toEqual([
        ["reviewer", "immediate"],
        ["worker", "immediate"],
      ]);
    } finally {
      await service.shutdown();
    }
  });

  test("member-scoped messages include only targeted deliveries and their states", async () => {
    const service = await startedService();
    try {
      const room = await roomWithMembers(service);
      const workerMessage = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker please implement",
      });
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@reviewer please review",
      });

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        storage.db.run("UPDATE deliveries SET state = 'injected', injected_at = ? WHERE message_id = ? AND target_session_id = ?", [
          123,
          workerMessage.body.id,
          "ses_worker",
        ]);
      } finally {
        storage.close();
      }

      const workerView = await routeJson(service, "GET", `/room/${room.room_id}/messages?session_id=ses_worker&from=worker`);
      expect(workerView.status).toBe(200);
      expect(workerView.body.member).toEqual({ session_id: "ses_worker", name: "worker" });
      expect(workerView.body.messages.map((message: { body: string }) => message.body)).toContain("@worker please implement");
      expect(workerView.body.messages.map((message: { body: string }) => message.body)).not.toContain("@reviewer please review");
      const message = workerView.body.messages.find((entry: { body: string }) => entry.body === "@worker please implement");
      expect(message.deliveries).toEqual([
        expect.objectContaining({ target_session_id: "ses_worker", target_name: "worker", mode: "immediate", state: "injected", injected_at: 123 }),
      ]);

      const workerByName = await routeJson(service, "GET", `/room/${room.room_id}/messages?from=worker&since=${workerMessage.body.id}&limit=2`);
      expect(workerByName.status).toBe(200);
      expect(workerByName.body.member).toEqual({ session_id: "ses_worker", name: "worker" });
      expect(workerByName.body.messages.map((entry: { body: string }) => entry.body)).toContain("@worker please implement");

      const workerBySession = await routeJson(service, "GET", `/room/${room.room_id}/messages?session_id=ses_worker`);
      expect(workerBySession.status).toBe(200);
      expect(workerBySession.body.member).toEqual({ session_id: "ses_worker", name: "worker" });

      const mismatchedView = await routeJson(service, "GET", `/room/${room.room_id}/messages?session_id=ses_worker&from=reviewer`);
      expect(mismatchedView.status).toBe(403);
      expect(mismatchedView.body.error).toBe("active member required");
    } finally {
      await service.shutdown();
    }
  });

  test("ask persists question targets and immediate target deliveries", async () => {
    const service = await startedService();
    try {
      const room = await roomWithMembers(service);
      const asked = await routeJson(service, "POST", `/room/${room.room_id}/ask`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker @reviewer Can you confirm readiness?",
      });
      const everyone = await routeJson(service, "POST", `/room/${room.room_id}/ask`, {
        session_id: "ses_worker",
        from: "worker",
        body: "@everyone Any blockers?",
      });
      const missing = await routeJson(service, "POST", `/room/${room.room_id}/ask`, {
        session_id: "ses_planner",
        from: "planner",
        body: "No explicit target here.",
      });

      expect(asked.status).toBe(201);
      expect(asked.body.kind).toBe("question");
      expect(asked.body.mentions).toEqual(["worker", "reviewer"]);
      expect(asked.body.deliveries.map((delivery: { target_name: string; mode: string }) => [delivery.target_name, delivery.mode])).toEqual([
        ["reviewer", "immediate"],
        ["worker", "immediate"],
      ]);
      expect(everyone.body.deliveries.map((delivery: { target_name: string; mode: string }) => [delivery.target_name, delivery.mode])).toEqual([
        ["planner", "immediate"],
        ["reviewer", "immediate"],
      ]);
      expect(missing.status).toBe(400);
      expect(missing.body.error).toBe("question target is required");

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const targets = storage.db
          .query<{ target_name: string; state: string }, [string]>(
            "SELECT target_name, state FROM question_targets WHERE message_id = ? ORDER BY target_name ASC",
          )
          .all(asked.body.id);
        expect(targets).toEqual([
          { target_name: "reviewer", state: "pending" },
          { target_name: "worker", state: "pending" },
        ]);
      } finally {
        storage.close();
      }
    } finally {
      await service.shutdown();
    }
  });

  test("answer marks first target answer and rejects duplicates and closed rooms", async () => {
    const service = await startedService();
    try {
      const room = await roomWithMembers(service);
      const question = await routeJson(service, "POST", `/room/${room.room_id}/ask`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker Can you take implementation?",
      });
      const answer = await routeJson(service, "POST", `/room/${room.room_id}/answer`, {
        session_id: "ses_worker",
        from: "worker",
        parent: question.body.id,
        body: "Yes, I will take it.",
      });
      const duplicate = await routeJson(service, "POST", `/room/${room.room_id}/answer`, {
        session_id: "ses_worker",
        from: "worker",
        parent: question.body.id,
        body: "Second answer should fail.",
      });
      await routeJson(service, "DELETE", `/room/${room.room_id}`, { session_id: "ses_planner", from: "planner" });
      const afterClose = await routeJson(service, "POST", `/room/${room.room_id}/answer`, {
        session_id: "ses_worker",
        from: "worker",
        parent: question.body.id,
        body: "Too late.",
      });

      expect(answer.status).toBe(201);
      expect(answer.body.kind).toBe("answer");
      expect(answer.body.parent_id).toBe(question.body.id);
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.error).toBe("question already answered by target");
      expect(afterClose.status).toBe(409);
      expect(afterClose.body.error).toBe("room is closed");

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const target = storage.db
          .query<{ state: string; answered_at: number | null }, [string]>(
            "SELECT state, answered_at FROM question_targets WHERE message_id = ? AND target_session_id = 'ses_worker'",
          )
          .get(question.body.id);
        const duplicateCount = storage.db
          .query<{ count: number }, []>("SELECT COUNT(*) AS count FROM messages WHERE body = 'Second answer should fail.'")
          .get();
        expect(target?.state).toBe("answered");
        expect(typeof target?.answered_at).toBe("number");
        expect(duplicateCount?.count).toBe(0);
      } finally {
        storage.close();
      }
    } finally {
      await service.shutdown();
    }
  });

  test("answer immediately notifies asker and buffers all other active members despite mentions", async () => {
    const service = await startedService();
    try {
      const room = await roomWithMembers(service);
      const question = await routeJson(service, "POST", `/room/${room.room_id}/ask`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker Please answer with review impact.",
      });
      const answer = await routeJson(service, "POST", `/room/${room.room_id}/answer`, {
        session_id: "ses_worker",
        from: "worker",
        parent: question.body.id,
        body: "@reviewer This mention stays buffered for you.",
      });

      expect(answer.status).toBe(201);
      expect(answer.body.mentions).toEqual(["reviewer"]);
      expect(answer.body.deliveries.map((delivery: { target_name: string; mode: string }) => [delivery.target_name, delivery.mode])).toEqual([
        ["planner", "immediate"],
        ["reviewer", "buffered"],
      ]);
    } finally {
      await service.shutdown();
    }
  });

  test("pending question blocks buffered backlog until answer, removal, or close cancels it", async () => {
    const client = mockClient();
    const service = await startedService(client);
    try {
      const room = await roomWithMembers(service);
      await markAllDeliveriesInjected();
      const question = await routeJson(service, "POST", `/room/${room.room_id}/ask`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker Are you clear?",
      });
      await markAllDeliveriesInjected();
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Buffered after question.",
      });

      await expect(service.attemptFlush("ses_worker", { type: "idle" }, [])).resolves.toEqual({
        flushed: false,
        reason: "pending_collab_question",
      });
      await routeJson(service, "POST", `/room/${room.room_id}/answer`, {
        session_id: "ses_worker",
        from: "worker",
        parent: question.body.id,
        body: "Clear.",
      });
      await expect(service.attemptFlush("ses_worker", { type: "idle" }, [])).resolves.toEqual({ flushed: true, count: 1 });

      await markAllDeliveriesInjected();
      const removeQuestion = await routeJson(service, "POST", `/room/${room.room_id}/ask`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@reviewer Can you review?",
      });
      await routeJson(service, "DELETE", `/room/${room.room_id}/member`, { session_id: "ses_planner", from: "planner", target: "reviewer" });
      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const removedTarget = storage.db
          .query<{ state: string; cancelled_reason: string }, [string]>(
            "SELECT state, cancelled_reason FROM question_targets WHERE message_id = ? AND target_session_id = 'ses_reviewer'",
          )
          .get(removeQuestion.body.id);
        expect(removedTarget).toEqual({ state: "cancelled", cancelled_reason: "member removed" });
      } finally {
        storage.close();
      }

      const closeQuestion = await routeJson(service, "POST", `/room/${room.room_id}/ask`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker Final check?",
      });
      await routeJson(service, "DELETE", `/room/${room.room_id}`, { session_id: "ses_planner", from: "planner" });
      const closeStorage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const closedTarget = closeStorage.db
          .query<{ state: string; cancelled_reason: string }, [string]>(
            "SELECT state, cancelled_reason FROM question_targets WHERE message_id = ? AND target_session_id = 'ses_worker'",
          )
          .get(closeQuestion.body.id);
        expect(closedTarget).toEqual({ state: "cancelled", cancelled_reason: "room closed" });
        expect(closeStorage.hasOpenPendingCollabQuestion("ses_worker")).toBe(false);
        const closeDeliveries = closeStorage.db
          .query<{ target_name: string; state: string }, []>(
            `SELECT deliveries.target_name, deliveries.state
             FROM deliveries
             JOIN messages ON messages.id = deliveries.message_id
             WHERE messages.kind = 'room_closed'
             ORDER BY deliveries.target_name ASC`,
          )
          .all();
        expect(closeDeliveries).toEqual([{ target_name: "worker", state: "pending" }]);
      } finally {
        closeStorage.close();
      }
    } finally {
      await service.shutdown();
    }
  });

  test("closed room drains buffered, immediate, hard, and closure deliveries chronologically", async () => {
    const client = mockClient({ statuses: { ses_worker: { type: "idle" } } });
    const service = await startedService(client);
    try {
      const room = await roomWithMembers(service);
      await markAllDeliveriesInjected();
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Closed drain buffered context",
      });
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker Closed drain immediate context",
      });
      const hard = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker Closed drain hard stop",
        hard: true,
      });
      await routeJson(service, "DELETE", `/room/${room.room_id}`, { session_id: "ses_planner", from: "planner" });

      await expect(service.attemptHardFlush(hard.body.id)).resolves.toEqual({ flushed: true, count: 1 });
      await expect(service.attemptFlush("ses_worker", { type: "idle" }, [])).resolves.toEqual({ flushed: true, count: 1 });

      expect(client.prompts).toHaveLength(2);
      expect(client.prompts[0].text.indexOf("Closed drain buffered context")).toBeLessThan(
        client.prompts[0].text.indexOf("Closed drain immediate context"),
      );
      expect(client.prompts[0].text.indexOf("Closed drain immediate context")).toBeLessThan(
        client.prompts[0].text.indexOf("Closed drain hard stop"),
      );
      expect(client.prompts[1].text).toContain("Room closed by planner.");
    } finally {
      await service.shutdown();
    }
  });

  test("closed room hard drain treats absent session status as eligible", async () => {
    const client = mockClient();
    const service = await startedService(client);
    try {
      const room = await roomWithMembers(service);
      await markAllDeliveriesInjected();
      const hard = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker Hard after close should execute",
        hard: true,
      });
      await routeJson(service, "DELETE", `/room/${room.room_id}`, { session_id: "ses_planner", from: "planner" });

      await expect(service.attemptHardFlush(hard.body.id)).resolves.toEqual({ flushed: true, count: 1 });
      expect(client.events).toEqual(["abort:ses_worker", "prompt:ses_worker"]);
      expect(client.prompts).toHaveLength(1);
      expect(client.prompts[0].text).toContain("Hard after close should execute");
    } finally {
      await service.shutdown();
    }
  });

  test("close drain ignores collab questions but still respects session blockers", async () => {
    const client = mockClient();
    const service = await startedService(client);
    try {
      const room = await roomWithMembers(service);
      await markAllDeliveriesInjected();
      const question = await routeJson(service, "POST", `/room/${room.room_id}/ask`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker Can this close drain?",
      });
      await markAllDeliveriesInjected();
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Closed drain after question.",
      });
      await routeJson(service, "DELETE", `/room/${room.room_id}`, { session_id: "ses_planner", from: "planner" });

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        storage.db.run("UPDATE question_targets SET state = 'pending', cancelled_at = NULL, cancelled_reason = NULL WHERE message_id = ?", [
          question.body.id,
        ]);
      } finally {
        storage.close();
      }

      await expect(service.attemptFlush("ses_worker", { type: "busy" }, [])).resolves.toEqual({ flushed: false, reason: "busy" });
      await expect(service.attemptFlush("ses_worker", { type: "retry", attempt: 1, message: "rate limit", next: 1 }, [])).resolves.toEqual({
        flushed: false,
        reason: "retry",
      });
      await expect(
        service.attemptFlush("ses_worker", { type: "idle" }, [{ id: "q1", sessionID: "ses_worker", questions: [] }]),
      ).resolves.toEqual({ flushed: false, reason: "pending_user_question" });
      await expect(service.attemptFlush("ses_worker", { type: "idle" }, [])).resolves.toEqual({ flushed: true, count: 2 });
      expect(client.prompts[0].text).toContain("Closed drain after question.");
      expect(client.prompts[0].text).toContain("Room closed by planner.");
    } finally {
      await service.shutdown();
    }
  });

  test("blocks buffered delivery for busy, retry, user question, and open collab question blockers", async () => {
    const client = mockClient();
    const service = await startedService(client);
    try {
      const room = await roomWithMembers(service);

      await expect(service.attemptFlush("ses_worker", { type: "busy" }, [])).resolves.toEqual({ flushed: false, reason: "busy" });
      await expect(service.attemptFlush("ses_worker", { type: "retry", attempt: 1, message: "rate limit", next: 1 }, [])).resolves.toEqual({
        flushed: false,
        reason: "retry",
      });
      await expect(
        service.attemptFlush("ses_worker", { type: "idle" }, [{ id: "q1", sessionID: "ses_worker", questions: [] }]),
      ).resolves.toEqual({ flushed: false, reason: "pending_user_question" });

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        storage.db.run(
          "INSERT INTO messages (id, room_id, sender_type, sender_name, body, kind, created_at) VALUES (?, ?, 'system', 'system', ?, 'question', ?)",
          ["msg_question", room.room_id, "Need input", 999],
        );
        storage.db.run(
          "INSERT INTO question_targets (message_id, target_session_id, target_name) VALUES (?, ?, ?)",
          ["msg_question", "ses_worker", "worker"],
        );
      } finally {
        storage.close();
      }

      await expect(service.attemptFlush("ses_worker", { type: "idle" }, [])).resolves.toEqual({
        flushed: false,
        reason: "pending_collab_question",
      });
      expect(client.prompts).toHaveLength(0);
    } finally {
      await service.shutdown();
    }
  });

  test("immediate delivery is allowed while busy but blocked by retry and pending user question", async () => {
    const client = mockClient();
    const service = await startedService(client);
    try {
      const room = await roomWithMembers(service);
      await markAllDeliveriesInjected();
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker please take this now",
        kind: "task_assignment",
      });

      await expect(service.attemptFlush("ses_worker", { type: "busy" }, [])).resolves.toEqual({ flushed: true, count: 1 });
      expect(client.prompts).toHaveLength(1);
      expect(client.prompts[0].text).toContain(`[Room: ${room.name}`);
      expect(client.prompts[0].text).toContain("Delivery: immediate");
      expect(client.prompts[0].text).toContain("From: planner");
      expect(client.prompts[0].text).toContain("Kind: task_assignment");
      expect(client.prompts[0].text).toContain("@worker please take this now");
      expect(client.prompts[0].text).toContain("Reply to the room with agent-collab as worker");

      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker retry should block this",
      });
      await expect(service.attemptFlush("ses_worker", { type: "retry", attempt: 1, message: "rate limit", next: 1 }, [])).resolves.toEqual({
        flushed: false,
        reason: "retry",
      });
      await expect(
        service.attemptFlush("ses_worker", { type: "idle" }, [{ id: "q1", sessionID: "ses_worker", questions: [] }]),
      ).resolves.toEqual({ flushed: false, reason: "pending_user_question" });
      expect(client.prompts).toHaveLength(1);
    } finally {
      await service.shutdown();
    }
  });

  test("newer immediate delivery flushes one ordered mixed batch and leaves later buffered records pending", async () => {
    const client = mockClient();
    const service = await startedService(client);
    try {
      const room = await roomWithMembers(service);
      await markAllDeliveriesInjected();
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Older buffered context",
      });
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker Immediate decision point",
      });
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Later buffered context",
      });

      const orderingStorage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        orderingStorage.db.run(
          `UPDATE messages
           SET created_at = CASE body
             WHEN 'Older buffered context' THEN 1000
             WHEN '@worker Immediate decision point' THEN 2000
             WHEN 'Later buffered context' THEN 3000
             ELSE created_at
           END
           WHERE body IN ('Older buffered context', '@worker Immediate decision point', 'Later buffered context')`,
        );
        orderingStorage.db.run(
          `UPDATE deliveries
           SET created_at = (SELECT messages.created_at FROM messages WHERE messages.id = deliveries.message_id)
           WHERE message_id IN (
             SELECT id FROM messages WHERE body IN ('Older buffered context', '@worker Immediate decision point', 'Later buffered context')
           )`,
        );
      } finally {
        orderingStorage.close();
      }

      await expect(service.attemptFlush("ses_worker", { type: "busy" }, [])).resolves.toEqual({ flushed: true, count: 2 });
      expect(client.prompts).toHaveLength(1);
      expect(client.prompts[0].text.indexOf("Older buffered context")).toBeLessThan(
        client.prompts[0].text.indexOf("@worker Immediate decision point"),
      );
      expect(client.prompts[0].text).not.toContain("Later buffered context");

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const rows = storage.db
          .query<{ body: string; state: string }, []>(
            `SELECT messages.body, deliveries.state
             FROM deliveries
             JOIN messages ON messages.id = deliveries.message_id
             WHERE deliveries.target_session_id = 'ses_worker'
               AND messages.body IN ('Older buffered context', '@worker Immediate decision point', 'Later buffered context')
             ORDER BY messages.created_at ASC`,
          )
          .all();
        expect(rows).toEqual([
          { body: "Older buffered context", state: "injected" },
          { body: "@worker Immediate decision point", state: "injected" },
          { body: "Later buffered context", state: "pending" },
        ]);
      } finally {
        storage.close();
      }
    } finally {
      await service.shutdown();
    }
  });

  test("configured reply instruction renders target variables across delivery modes", async () => {
    const client = mockClient({ statuses: { ses_worker: { type: "idle" } } });
    const service = await startedService(client, {
      reply_instruction: { text: "Custom reply for {alias}/{role} in {room} from {from}." },
    });
    try {
      const room = await roomWithMembers(service);

      await expect(service.attemptFlush("ses_worker", { type: "idle" }, [])).resolves.toEqual({ flushed: true, count: 2 });
      expect(client.prompts[0].text).toContain("Join Bootstrap");
      expect(client.prompts[0].text).toContain(`Custom reply for worker/implementer in ${room.name} from system.`);
      expect(client.prompts[0].text).not.toContain("Reply to the room with agent-collab as worker");

      await markAllDeliveriesInjected();
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Buffered configured reply.",
      });
      await expect(service.attemptFlush("ses_worker", { type: "idle" }, [])).resolves.toEqual({ flushed: true, count: 1 });
      expect(client.prompts[1].text).toContain(`Custom reply for worker/implementer in ${room.name} from planner.`);

      await markAllDeliveriesInjected();
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker Immediate configured reply.",
      });
      await expect(service.attemptFlush("ses_worker", { type: "busy" }, [])).resolves.toEqual({ flushed: true, count: 1 });
      expect(client.prompts[2].text).toContain("Delivery: immediate");
      expect(client.prompts[2].text).toContain(`Custom reply for worker/implementer in ${room.name} from planner.`);

      await markAllDeliveriesInjected();
      const hard = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker Hard configured reply.",
        hard: true,
      });
      await expect(service.attemptHardFlush(hard.body.id)).resolves.toEqual({ flushed: true, count: 1 });
      expect(client.prompts[3].text).toContain("Delivery: hard");
      expect(client.prompts[3].text).toContain(`Custom reply for worker/implementer in ${room.name} from planner.`);

      await markAllDeliveriesInjected();
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Older configured backlog.",
      });
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker Combined configured backlog.",
      });
      await expect(service.attemptFlush("ses_worker", { type: "busy" }, [])).resolves.toEqual({ flushed: true, count: 2 });
      expect(client.prompts[4].text).toContain("Older configured backlog.");
      expect(client.prompts[4].text).toContain("@worker Combined configured backlog.");
      expect(client.prompts[4].text.match(/Custom reply for worker\/implementer/g)).toHaveLength(2);
    } finally {
      await service.shutdown();
    }
  });

  test("hard delivery aborts all targets before injecting any prompts", async () => {
    const client = mockClient({ statuses: { ses_worker: { type: "idle" }, ses_reviewer: { type: "idle" } } });
    const service = await startedService(client);
    try {
      const room = await roomWithMembers(service);
      await markAllDeliveriesInjected();
      const hard = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@everyone stop immediately",
        hard: true,
      });

      await expect(service.attemptHardFlush(hard.body.id)).resolves.toEqual({ flushed: true, count: 2 });
      expect(client.events).toEqual(["abort:ses_worker", "abort:ses_reviewer", "prompt:ses_worker", "prompt:ses_reviewer"]);
      expect(client.prompts).toHaveLength(2);
      expect(client.prompts.map((prompt) => prompt.text)).toEqual([expect.stringContaining("Delivery: hard"), expect.stringContaining("Delivery: hard")]);
    } finally {
      await service.shutdown();
    }
  });

  test("hard delivery preserves older buffered context before hard message", async () => {
    const client = mockClient({ statuses: { ses_worker: { type: "idle" } } });
    const service = await startedService(client);
    try {
      const room = await roomWithMembers(service);
      await markAllDeliveriesInjected();
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Older buffered context",
      });
      const hard = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker hard decision point",
        hard: true,
      });

      await expect(service.attemptHardFlush(hard.body.id)).resolves.toEqual({ flushed: true, count: 1 });
      expect(client.prompts).toHaveLength(1);
      expect(client.prompts[0].text.indexOf("Older buffered context")).toBeLessThan(
        client.prompts[0].text.indexOf("@worker hard decision point"),
      );
    } finally {
      await service.shutdown();
    }
  });

  test("hard delivery marks all targeted records failed when one target never becomes idle", async () => {
    const client = mockClient({ statuses: { ses_worker: { type: "idle" }, ses_reviewer: { type: "busy" } } });
    const service = await startedService(client, { hard_abort_wait_ms: 1, hard_abort_wait_max_ms: 1 });
    try {
      const room = await roomWithMembers(service);
      await markAllDeliveriesInjected();
      const hard = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@everyone stop immediately",
        hard: true,
      });

      await expect(service.attemptHardFlush(hard.body.id)).resolves.toEqual({ flushed: false, reason: "idle_timeout" });
      expect(client.prompts).toHaveLength(0);

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const rows = storage.db
          .query<{ target_name: string; state: string; last_error: string }, [string]>(
            "SELECT target_name, state, last_error FROM deliveries WHERE message_id = ? ORDER BY target_name ASC",
          )
          .all(hard.body.id);
        expect(rows).toEqual([
          { target_name: "reviewer", state: "failed", last_error: "hard idle wait timed out: ses_reviewer" },
          { target_name: "worker", state: "failed", last_error: "hard idle wait timed out: ses_reviewer" },
        ]);
      } finally {
        storage.close();
      }
    } finally {
      await service.shutdown();
    }
  });

  test("message kind is informational and mentions alone control immediate urgency", async () => {
    const service = await startedService();
    try {
      const room = await roomWithMembers(service);
      const mentionedNote = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "@worker noted for immediate attention",
        kind: "note",
      });
      const unmentionedTask = await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Please handle this when available",
        kind: "task_assignment",
      });

      expect(mentionedNote.body.deliveries).toEqual([
        expect.objectContaining({ target_name: "worker", mode: "immediate" }),
      ]);
      expect(unmentionedTask.body.deliveries.map((delivery: { target_name: string; mode: string }) => [delivery.target_name, delivery.mode])).toEqual([
        ["reviewer", "buffered"],
        ["worker", "buffered"],
      ]);
    } finally {
      await service.shutdown();
    }
  });

  test("flushes eligible idle backlog in chronological order", async () => {
    const client = mockClient();
    const service = await startedService(client);
    try {
      const room = await roomWithMembers(service);
      await markAllDeliveriesInjected();
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "First buffered update",
      });
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Second buffered update",
      });

      await expect(service.attemptFlush("ses_worker", { type: "idle" }, [])).resolves.toEqual({ flushed: true, count: 2 });
      expect(client.prompts).toHaveLength(1);
      expect(client.prompts[0].text.indexOf("First buffered update")).toBeLessThan(client.prompts[0].text.indexOf("Second buffered update"));

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const rows = storage.db
          .query<{ state: string }, []>("SELECT state FROM deliveries WHERE target_session_id = 'ses_worker' AND state != 'injected'")
          .all();
        expect(rows).toEqual([]);
      } finally {
        storage.close();
      }
    } finally {
      await service.shutdown();
    }
  });

  test("delivery tick and event entry points flush without timers", async () => {
    const client = mockClient({ statuses: { ses_worker: { type: "idle" } } });
    const service = await startedService(client);
    try {
      await roomWithMembers(service);

      await service.tickDelivery();
      await service.handleDeliveryEvent();

      expect(client.prompts).toHaveLength(3);
      expect(client.prompts.map((prompt) => prompt.sessionID).sort()).toEqual(["ses_planner", "ses_reviewer", "ses_worker"]);
    } finally {
      await service.shutdown();
    }
  });

  test("join bootstrap is injected before later room traffic", async () => {
    const client = mockClient();
    const service = await startedService(client);
    try {
      const created = await routeJson(service, "POST", "/room", { name: "bootstrap-order", session_id: "ses_planner", from: "planner" });
      await routeJson(service, "POST", `/room/${created.body.room_id}/member`, {
        session_id: "ses_planner",
        from: "planner",
        target_session_id: "ses_worker",
        name: "worker",
        role: "implementer",
      });
      await routeJson(service, "POST", `/room/${created.body.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Later room traffic",
      });

      await service.attemptFlush("ses_worker", { type: "idle" }, []);
      expect(client.prompts).toHaveLength(1);
      expect(client.prompts[0].text).toContain("[Room: bootstrap-order-");
      expect(client.prompts[0].text.indexOf("Join Bootstrap")).toBeLessThan(client.prompts[0].text.indexOf("Later room traffic"));
      expect(client.prompts[0].text).toContain("Reply with ready to confirm your availability");
      expect(client.prompts[0].text).toContain("Reply to the room with agent-collab as worker");
    } finally {
      await service.shutdown();
    }
  });

  test("spawn queues bootstrap before initial prompt and flushes in separate turns", async () => {
    const client = mockClient();
    const service = await startedService(client, { spawn_instruction: { text: "Spawn as {alias} in {room} from {from}." } });
    try {
      const created = await routeJson(service, "POST", "/room", { name: "spawn-order", session_id: "ses_planner", from: "planner" });
      await routeJson(service, "POST", `/room/${created.body.room_id}/spawn`, {
        session_id: "ses_planner",
        from: "planner",
        name: "worker",
        role: "implementer",
        agent: "sebastian",
        model: { providerID: "provider-x", modelID: "model-y", variant: "fast" },
        initial_prompt: "Start implementation now.",
      });

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const rows = storage.db
          .query<{ kind: string; mode: string; created_at: number }, []>(
            `SELECT messages.kind, deliveries.mode, deliveries.created_at
             FROM messages
             JOIN deliveries ON deliveries.message_id = messages.id
             WHERE deliveries.target_session_id = 'ses_spawned_1'
             ORDER BY deliveries.created_at ASC`,
          )
          .all();
        expect(rows.map((row) => [row.kind, row.mode])).toEqual([
          ["join_bootstrap", "bootstrap"],
          ["spawn_initial", "spawn_initial"],
        ]);
        expect(rows[0].created_at).toBeLessThan(rows[1].created_at);
      } finally {
        storage.close();
      }

      await expect(service.attemptFlush("ses_spawned_1", { type: "idle" }, [])).resolves.toEqual({ flushed: true, count: 1 });
      expect(client.prompts).toHaveLength(1);
      expect(client.prompts[0].text).toContain("Join Bootstrap");
      expect(client.prompts[0].text).not.toContain("Start implementation now.");

      await expect(service.attemptFlush("ses_spawned_1", { type: "idle" }, [])).resolves.toEqual({ flushed: true, count: 1 });
      expect(client.prompts).toHaveLength(2);
      expect(client.prompts[1].text).toContain("Spawn as worker in spawn-order-");
      expect(client.prompts[1].text).toContain("Start implementation now.");
      expect(client.prompts[1].agent).toBe("sebastian");
      expect(client.prompts[1].model).toEqual({ providerID: "provider-x", modelID: "model-y", variant: "fast" });
    } finally {
      await service.shutdown();
    }
  });

  test("spawn initial prompt remains pending if bootstrap delivery fails", async () => {
    const client = mockClient({ failPrompt: true });
    const service = await startedService(client);
    try {
      const created = await routeJson(service, "POST", "/room", { name: "spawn-fail", session_id: "ses_planner", from: "planner" });
      await routeJson(service, "POST", `/room/${created.body.room_id}/spawn`, {
        session_id: "ses_planner",
        from: "planner",
        name: "worker",
        role: "implementer",
        initial_prompt: "Do not inject until bootstrap succeeds.",
      });

      await expect(service.attemptFlush("ses_spawned_1", { type: "idle" }, [])).resolves.toEqual({ flushed: false, reason: "inject_failed" });
      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const rows = storage.db
          .query<{ kind: string; state: string; attempt_count: number }, []>(
            `SELECT messages.kind, deliveries.state, deliveries.attempt_count
             FROM messages
             JOIN deliveries ON deliveries.message_id = messages.id
             WHERE deliveries.target_session_id = 'ses_spawned_1'
             ORDER BY deliveries.created_at ASC`,
          )
          .all();
        expect(rows).toEqual([
          { kind: "join_bootstrap", state: "pending", attempt_count: 1 },
          { kind: "spawn_initial", state: "pending", attempt_count: 0 },
        ]);
      } finally {
        storage.close();
      }
    } finally {
      await service.shutdown();
    }
  });

  test("retryable failures persist attempts and can later inject", async () => {
    const client = mockClient({ promptErrors: [new OpenCodeRequestError("temporary", 503, "temporary")] });
    const service = await startedService(client);
    try {
      const room = await roomWithMembers(service);
      await markAllDeliveriesInjected();
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Retryable delivery.",
      });

      await expect(service.attemptFlush("ses_worker", { type: "idle" }, [])).resolves.toEqual({ flushed: false, reason: "inject_failed" });
      await expect(service.attemptFlush("ses_worker", { type: "idle" }, [])).resolves.toEqual({ flushed: true, count: 1 });

      const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
      try {
        const delivery = storage.db
          .query<{ state: string; attempt_count: number; last_error: string | null }, []>(
            "SELECT state, attempt_count, last_error FROM deliveries WHERE target_session_id = 'ses_worker' ORDER BY created_at DESC LIMIT 1",
          )
          .get();
        expect(delivery).toEqual({ state: "injected", attempt_count: 1, last_error: null });
      } finally {
        storage.close();
      }
    } finally {
      await service.shutdown();
    }
  });

  test("permanent failures are visible after close without new failure messages", async () => {
    const client = mockClient({ promptErrors: [new OpenCodeRequestError("invalid", 400, "invalid prompt")] });
    const service = await startedService(client);
    try {
      const room = await roomWithMembers(service);
      await markAllDeliveriesInjected();
      await routeJson(service, "POST", `/room/${room.room_id}/message`, {
        session_id: "ses_planner",
        from: "planner",
        body: "Permanent failure delivery.",
      });

      await expect(service.attemptFlush("ses_worker", { type: "idle" }, [])).resolves.toEqual({ flushed: false, reason: "inject_failed" });
      await routeJson(service, "DELETE", `/room/${room.room_id}`, { session_id: "ses_planner", from: "planner" });

      const status = await routeJson(service, "GET", `/room/${room.room_id}/status`);
      expect(status.body.outstanding_failures).toEqual([
        expect.objectContaining({
          message_body: "Permanent failure delivery.",
          target_name: "worker",
          state: "failed",
          attempt_count: 1,
          last_error: "invalid",
        }),
      ]);

      const messages = await routeJson(service, "GET", `/room/${room.room_id}/messages`);
      const failureMessage = messages.body.messages.find((message: { body: string }) => message.body === "Permanent failure delivery.");
      expect(failureMessage.deliveries).toEqual([
        expect.objectContaining({ target_name: "reviewer", state: "pending" }),
        expect.objectContaining({ target_name: "worker", state: "failed", attempt_count: 1, last_error: "invalid" }),
      ]);
      expect(messages.body.messages.filter((message: { kind: string }) => message.kind === "delivery_failed")).toEqual([]);
    } finally {
      await service.shutdown();
    }
  });

  test("delivered records are not duplicated on idempotent retry", async () => {
    const client = mockClient();
    const service = await startedService(client);
    try {
      await roomWithMembers(service);

      await service.attemptFlush("ses_worker", { type: "idle" }, []);
      await service.attemptFlush("ses_worker", { type: "idle" }, []);

      expect(client.prompts).toHaveLength(1);
      await expect(service.attemptFlush("ses_worker", { type: "idle" }, [])).resolves.toEqual({ flushed: false, reason: "empty" });
    } finally {
      await service.shutdown();
    }
  });
});

async function startedService(client: OpenCodeClientType = mockClient(), config: Partial<CollabConfig> = {}) {
  const service = new CollabService(client, async () => configWithTemplates({ enabled: true, port: 0, poll_interval_ms: 1_000_000, ...config }));
  await service.start();
  return service;
}

async function routeJson(service: CollabService, method: string, route: string, body?: unknown) {
  const response = await service.handleRequest(
    new Request(`http://127.0.0.1${route}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: body === undefined ? undefined : { "content-type": "application/json" },
    }),
  );
  return { status: response.status, body: await response.json() } as { status: number; body: any };
}

async function roomWithMembers(service: CollabService) {
  const created = await routeJson(service, "POST", "/room", { name: "messages", session_id: "ses_planner", from: "planner" });
  await routeJson(service, "POST", `/room/${created.body.room_id}/member`, {
    session_id: "ses_planner",
    from: "planner",
    target_session_id: "ses_worker",
    name: "worker",
    role: "implementer",
  });
  await routeJson(service, "POST", `/room/${created.body.room_id}/member`, {
    session_id: "ses_planner",
    from: "planner",
    target_session_id: "ses_reviewer",
    name: "reviewer",
    role: "reviewer",
  });
  return created.body as { room_id: string; name: string };
}

async function markAllDeliveriesInjected() {
  const storage = await CollabStorage.open(path.join(tempDir, "collab.sqlite"));
  try {
    storage.db.run("UPDATE deliveries SET state = 'injected', injected_at = 1");
  } finally {
    storage.close();
  }
}

function mockClient(
  input: {
    statuses?: Record<string, SessionStatusInfo>;
    questions?: QuestionRequest[];
    failPrompt?: boolean;
    failAbort?: boolean;
    promptErrors?: unknown[];
  } = {},
) {
  const client = {
    prompts: [] as Array<{ sessionID: string; text: string; agent?: string; model?: { providerID: string; modelID: string; variant?: string } }>,
    events: [] as string[],
    createdSessions: [] as Array<{ title?: string; directory?: string }>,
    nextSessionId: undefined as string | undefined,
    getSession: async (sessionID: string) => ({ id: sessionID, title: sessionID, directory: "/caller", time: { created: 1, updated: 1 } }),
    sessionMessages: async () => [],
    createSpawnSession: async (body: { title?: string; directory?: string }) => {
      client.createdSessions.push(body);
      const id = client.nextSessionId ?? `ses_spawned_${client.createdSessions.length}`;
      client.nextSessionId = undefined;
      return { id, title: body.title ?? id, directory: "/spawned", time: { created: 1, updated: 1 } };
    },
    sessionStatus: async () => input.statuses ?? {},
    pendingQuestions: async () => input.questions ?? [],
    abortSession: async (sessionID: string) => {
      client.events.push(`abort:${sessionID}`);
      if (input.failAbort) throw new Error("abort failure");
      return true;
    },
    promptAsync: async (
      sessionID: string,
      body: { agent?: string; model?: { providerID: string; modelID: string; variant?: string }; parts: Array<{ type: "text"; text: string }> },
    ) => {
      const promptError = input.promptErrors?.shift();
      if (promptError) throw promptError;
      if (input.failPrompt) throw new Error("temporary failure");
      client.events.push(`prompt:${sessionID}`);
      client.prompts.push({ sessionID, text: body.parts.map((part) => part.text).join("\n"), agent: body.agent, model: body.model });
    },
    log: async () => {},
  } as OpenCodeClientType & {
    prompts: Array<{ sessionID: string; text: string; agent?: string; model?: { providerID: string; modelID: string; variant?: string } }>;
    events: string[];
    createdSessions: Array<{ title?: string; directory?: string }>;
    nextSessionId?: string;
  };
  return client;
}

function configWithTemplates(input: Partial<CollabConfig>): CollabConfig {
  return {
    enabled: false,
    host: "127.0.0.1",
    port: 9100,
    db_path: path.join(tempDir, "collab.sqlite"),
    poll_interval_ms: 5_000,
    hard_abort_wait_ms: 15_000,
    hard_abort_wait_max_ms: 60_000,
    ...input,
  };
}
