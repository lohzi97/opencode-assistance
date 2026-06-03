import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_AGENT_COLLAB_URL, parseArgs, readBody, resolveBaseUrl, runAgentCollabCli } from "./agent-collab";

type RequestRecord = {
  url: string;
  method: string;
  body?: unknown;
};

describe("agent-collab CLI foundation", () => {
  test("resolves default and environment base URLs", () => {
    expect(resolveBaseUrl({})).toBe(DEFAULT_AGENT_COLLAB_URL);
    expect(resolveBaseUrl({ AGENT_COLLAB_URL: "http://localhost:9999/" })).toBe("http://localhost:9999");
  });

  test("parses positionals, values, equals flags, and boolean flags", () => {
    expect(parseArgs(["room", "list", "--closed", "--room=x", "--session", "ses_1"])).toEqual({
      positionals: ["room", "list"],
      flags: { closed: true, room: "x", session: "ses_1" },
    });
  });
});

describe("agent-collab HTTP and output handling", () => {
  test("prints JSON output and sends successful requests", async () => {
    const client = mockCli({ ok: true, body: { room_id: "room_1", name: "room-one", state: "open" } });
    const exit = await client.run(["room", "status", "--room", "room-one", "--json"]);

    expect(exit).toBe(0);
    expect(client.stdoutText()).toContain('"name": "room-one"');
    expect(client.requests[0]).toMatchObject({ method: "GET", url: "http://127.0.0.1:9100/room/room-one/status" });
  });

  test("prints non-2xx errors without leaking request bodies", async () => {
    const client = mockCli({ ok: false, status: 403, body: { error: "invalid planner password" } });
    const exit = await client.run(["join", "--room", "room-one", "--session", "ses_1", "--name", "planner", "--password", "secret"]);

    expect(exit).toBe(1);
    expect(client.stderrText()).toContain("Error: invalid planner password");
    expect(client.stderrText()).not.toContain("secret");
  });
});

describe("agent-collab room commands", () => {
  test("room create sends payload and warns that password is one-time", async () => {
    const client = mockCli({
      ok: true,
      status: 201,
      body: { name: "build-cli-20260530000000", founder: { name: "planner" }, planner_password: "one-time" },
    });
    const exit = await client.run([
      "room",
      "create",
      "--name",
      "build-cli",
      "--session",
      "ses_planner",
      "--from",
      "planner",
      "--project-dir",
      "/tmp/project",
    ]);

    expect(exit).toBe(0);
    expect(client.requests[0]).toMatchObject({
      method: "POST",
      url: "http://127.0.0.1:9100/room",
      body: { name: "build-cli", session_id: "ses_planner", from: "planner", project_dir: "/tmp/project" },
    });
    expect(client.stdoutText()).toContain("Planner password: one-time");
    expect(client.stdoutText()).toContain("will not be shown again");
  });

  test("room list maps closed and all flags to state query", async () => {
    const client = mockCli({ ok: true, body: { rooms: [] } });

    await client.run(["room", "list", "--closed"]);
    await client.run(["room", "list", "--all"]);

    expect(client.requests[0].url).toBe("http://127.0.0.1:9100/room/list?state=closed");
    expect(client.requests[1].url).toBe("http://127.0.0.1:9100/room/list?state=all");
  });

  test("room list forwards before and limit query parameters", async () => {
    const client = mockCli({ ok: true, body: { rooms: [] } });

    await client.run(["room", "list", "--before", "room_abc", "--limit", "10"]);
    await client.run(["room", "list", "--closed", "--before", "room_xyz", "--limit", "5"]);

    expect(client.requests[0].url).toBe("http://127.0.0.1:9100/room/list?before=room_abc&limit=10");
    expect(client.requests[1].url).toBe("http://127.0.0.1:9100/room/list?state=closed&before=room_xyz&limit=5");
  });

  test("room close requires planner identity and sends delete payload", async () => {
    const missing = mockCli({ ok: true, body: {} });
    expect(await missing.run(["room", "close", "--room", "r", "--session", "ses_planner"])).toBe(1);
    expect(missing.stderrText()).toContain("--from is required");

    const client = mockCli({ ok: true, body: { name: "r", state: "closed" } });
    expect(await client.run(["room", "close", "--room", "r", "--session", "ses_planner", "--from", "planner"])).toBe(0);

    expect(client.requests[0]).toMatchObject({
      method: "DELETE",
      url: "http://127.0.0.1:9100/room/r",
      body: { session_id: "ses_planner", from: "planner" },
    });
  });

  test("room close supports human output, JSON passthrough, and server errors", async () => {
    const client = mockCli({ ok: true, body: { room_id: "room_r", name: "r", state: "closed", closed_at: 1 } });

    expect(await client.run(["room", "close", "--room", "r", "--session", "ses_planner", "--from", "planner"])).toBe(0);
    expect(await client.run(["room", "close", "--room", "r", "--session", "ses_planner", "--from", "planner", "--json"])).toBe(0);

    expect(client.stdoutText()).toContain("Room closed.");
    expect(client.stdoutText()).toContain("Room: r");
    expect(client.stdoutText()).toContain("State: closed");
    expect(client.stdoutText()).toContain('"closed_at": 1');

    const rejected = mockCli({ ok: false, status: 403, body: { error: "caller is not an active planner" } });
    expect(await rejected.run(["room", "close", "--room", "r", "--session", "ses_worker", "--from", "worker"])).toBe(1);
    expect(rejected.stderrText()).toContain("Error: caller is not an active planner");
  });
});

describe("agent-collab membership commands", () => {
  test("member add requires identity flags and sends payload", async () => {
    const missing = mockCli({ ok: true, body: {} });
    expect(await missing.run(["member", "add", "--room", "r"])).toBe(1);
    expect(missing.stderrText()).toContain("--session is required");

    const client = mockCli({ ok: true, status: 201, body: { name: "r", state: "open" } });
    expect(
      await client.run([
        "member",
        "add",
        "--room",
        "r",
        "--session",
        "ses_planner",
        "--from",
        "planner",
        "--target-session",
        "ses_worker",
        "--name",
        "worker",
        "--role",
        "implementer",
      ]),
    ).toBe(0);
    expect(client.requests[0].body).toEqual({
      session_id: "ses_planner",
      from: "planner",
      target_session_id: "ses_worker",
      name: "worker",
      role: "implementer",
    });
  });

  test("member remove and leave send expected payloads", async () => {
    const client = mockCli({ ok: true, body: { name: "r", state: "open" } });

    await client.run(["member", "remove", "--room", "r", "--session", "ses_planner", "--from", "planner", "--target", "worker"]);
    await client.run(["leave", "--room", "r", "--session", "ses_worker", "--from", "worker"]);

    expect(client.requests[0]).toMatchObject({
      method: "DELETE",
      url: "http://127.0.0.1:9100/room/r/member",
      body: { session_id: "ses_planner", from: "planner", target: "worker" },
    });
    expect(client.requests[1]).toMatchObject({
      method: "DELETE",
      url: "http://127.0.0.1:9100/room/r/leave",
      body: { session_id: "ses_worker", from: "worker" },
    });
  });
});

describe("agent-collab join password handling", () => {
  test("join supports inline password without echoing it", async () => {
    const client = mockCli({ ok: true, status: 201, body: { name: "r", state: "open" } });

    expect(await client.run(["join", "--room", "r", "--session", "ses_1", "--name", "planner", "--password", "secret"])).toBe(0);

    expect(client.requests[0].body).toEqual({ session_id: "ses_1", name: "planner", password: "secret" });
    expect(client.stdoutText()).not.toContain("secret");
  });

  test("join supports password stdin without echoing it", async () => {
    const client = mockCli({ ok: true, status: 201, body: { name: "r", state: "open" } }, "secret-from-stdin\n");

    expect(await client.run(["join", "--room", "r", "--session", "ses_1", "--name", "planner", "--password-stdin"])).toBe(0);

    expect(client.requests[0].body).toEqual({ session_id: "ses_1", name: "planner", password: "secret-from-stdin" });
    expect(client.stdoutText()).not.toContain("secret-from-stdin");
  });

  test("join reads password stdin from real process-style streams", async () => {
    const requests: RequestRecord[] = [];
    let stdout = "";
    let stderr = "";
    const fetch = async (url: URL | RequestInfo, init?: RequestInit) => {
      requests.push({
        url: String(url),
        method: init?.method ?? "GET",
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Response.json({ name: "r", state: "open" }, { status: 201 });
    };
    const stdin = {
      async *[Symbol.asyncIterator]() {
        yield Buffer.from("secret-from-stream\n");
      },
    };

    const exit = await runAgentCollabCli(["join", "--room", "r", "--session", "ses_1", "--name", "planner", "--password-stdin"], {
      fetch: fetch as typeof globalThis.fetch,
      stdout: { write: (chunk: string) => ((stdout += chunk), true) },
      stderr: { write: (chunk: string) => ((stderr += chunk), true) },
      stdin,
      env: {},
    });

    expect(exit).toBe(0);
    expect(requests[0].body).toEqual({ session_id: "ses_1", name: "planner", password: "secret-from-stream" });
    expect(stdout).not.toContain("secret-from-stream");
    expect(stderr).toBe("");
  });
});

describe("agent-collab spawn command", () => {
  test("spawn maps explicit agent, model, directory, and initial prompt", async () => {
    const client = mockCli({ ok: true, status: 201, body: { name: "r", state: "open" } });

    expect(
      await client.run([
        "spawn",
        "--room",
        "r",
        "--session",
        "ses_planner",
        "--from",
        "planner",
        "--name",
        "worker",
        "--role",
        "implementer",
        "--agent",
        "sebastian",
        "--provider",
        "github-copilot",
        "--model",
        "gpt-5.5",
        "--variant",
        "large",
        "--dir",
        "/tmp/project",
        "--initial-prompt",
        "Implement this.",
      ]),
    ).toBe(0);

    expect(client.requests[0]).toMatchObject({ method: "POST", url: "http://127.0.0.1:9100/room/r/spawn" });
    expect(client.requests[0].body).toEqual({
      session_id: "ses_planner",
      from: "planner",
      name: "worker",
      role: "implementer",
      agent: "sebastian",
      model: { providerID: "github-copilot", modelID: "gpt-5.5", variant: "large" },
      directory: "/tmp/project",
      initial_prompt: "Implement this.",
    });
  });
});

describe("agent-collab body input helpers", () => {
  test("reads direct text, files, explicit stdin, and rejects missing bodies", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-collab-cli-"));
    try {
      const file = join(dir, "body.txt");
      await writeFile(file, "from file", "utf8");
      const io = { stdin: { text: async () => "from stdin" } };

      await expect(readBody(parseArgs(["--body", "from text"]), io, { text: "body", file: "body-file", stdinTextValue: "-" })).resolves.toBe(
        "from text",
      );
      await expect(readBody(parseArgs(["--body-file", file]), io, { text: "body", file: "body-file", stdinTextValue: "-" })).resolves.toBe(
        "from file",
      );
      await expect(readBody(parseArgs(["--body", "-"]), io, { text: "body", file: "body-file", stdinTextValue: "-" })).resolves.toBe(
        "from stdin",
      );
      await expect(readBody(parseArgs([]), io, { text: "body", file: "body-file", stdinTextValue: "-" })).rejects.toThrow(
        "provide exactly one body input source",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("agent-collab public-message commands", () => {
  test("set and clear send payloads and support human and JSON outputs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-collab-cli-"));
    try {
      const file = join(dir, "public-message.txt");
      await writeFile(file, "Pinned from file", "utf8");
      const client = mockCli({ ok: true, body: { name: "r", state: "open", public_message: "Pinned from file" } });

      expect(
        await client.run(["room", "public-message", "set", "--room", "r", "--session", "ses_planner", "--from", "planner", "--file", file]),
      ).toBe(0);
      expect(await client.run(["room", "public-message", "clear", "--room", "r", "--session", "ses_planner", "--from", "planner", "--json"])).toBe(0);

      expect(client.requests[0]).toMatchObject({
        method: "POST",
        url: "http://127.0.0.1:9100/room/r/public-message",
        body: { session_id: "ses_planner", from: "planner", body: "Pinned from file" },
      });
      expect(client.requests[1]).toMatchObject({
        method: "DELETE",
        url: "http://127.0.0.1:9100/room/r/public-message",
        body: { session_id: "ses_planner", from: "planner" },
      });
      expect(client.stdoutText()).toContain("Room r is open.");
      expect(client.stdoutText()).toContain('"public_message": "Pinned from file"');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("agent-collab send command", () => {
  test("send supports text, file, stdin, kind, hard flag, and server validation errors", async () => {
    const dir = await mkdtemp(join(tmpdir(), "agent-collab-cli-"));
    try {
      const file = join(dir, "message.txt");
      await writeFile(file, "Message from file", "utf8");
      const client = mockCli({ ok: true, status: 201, body: { id: "msg_1", kind: "note" } }, "Message from stdin");

      await client.run(["send", "--room", "r", "--session", "ses_worker", "--from", "worker", "--body", "Message from text", "--kind", "note"]);
      await client.run(["send", "--room", "r", "--session", "ses_worker", "--from", "worker", "--body-file", file]);
      await client.run(["send", "--room", "r", "--session", "ses_planner", "--from", "planner", "--body", "-", "--hard"]);

      expect(client.requests[0].body).toEqual({ session_id: "ses_worker", from: "worker", body: "Message from text", kind: "note" });
      expect(client.requests[1].body).toEqual({ session_id: "ses_worker", from: "worker", body: "Message from file" });
      expect(client.requests[2].body).toEqual({ session_id: "ses_planner", from: "planner", body: "Message from stdin", hard: true });

      const rejected = mockCli({ ok: false, status: 400, body: { error: "unknown mention: @missing" } });
      expect(await rejected.run(["send", "--room", "r", "--session", "ses_planner", "--from", "planner", "--body", "@missing help"])).toBe(1);
      expect(rejected.stderrText()).toContain("Error: unknown mention: @missing");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("agent-collab ask and answer commands", () => {
  test("ask and answer send parent, body, options, and propagate non-2xx errors", async () => {
    const client = mockCli({ ok: true, status: 201, body: { id: "msg_question", kind: "question" } });

    await client.run([
      "ask",
      "--room",
      "r",
      "--session",
      "ses_planner",
      "--from",
      "planner",
      "--body",
      "@worker Choose an option",
      "--options",
      "yes,no",
    ]);
    await client.run(["answer", "--room", "r", "--session", "ses_worker", "--from", "worker", "--parent", "msg_question", "--body", "yes"]);

    expect(client.requests[0]).toMatchObject({
      method: "POST",
      url: "http://127.0.0.1:9100/room/r/ask",
      body: { session_id: "ses_planner", from: "planner", body: "@worker Choose an option", options: ["yes", "no"] },
    });
    expect(client.requests[1]).toMatchObject({
      method: "POST",
      url: "http://127.0.0.1:9100/room/r/answer",
      body: { session_id: "ses_worker", from: "worker", parent: "msg_question", body: "yes" },
    });

    const rejected = mockCli({ ok: false, status: 409, body: { error: "question already answered by target" } });
    expect(await rejected.run(["answer", "--room", "r", "--session", "ses_worker", "--from", "worker", "--parent", "msg_question", "--body", "again"])).toBe(1);
    expect(rejected.stderrText()).toContain("Error: question already answered by target");
  });
});

describe("agent-collab messages command", () => {
  test("messages sends room, session, member, since, limit, and supports JSON output", async () => {
    const client = mockCli({ ok: true, body: { room_id: "room_r", messages: [{ id: "msg_1", body: "hello" }] } });

    await client.run(["messages", "--room", "r"]);
    await client.run(["messages", "--room", "r", "--session", "ses_worker"]);
    await client.run(["messages", "--room", "r", "--session", "ses_worker", "--member", "worker", "--since", "msg_1", "--limit", "10", "--json"]);

    expect(client.requests[0].url).toBe("http://127.0.0.1:9100/room/r/messages");
    expect(client.requests[1].url).toBe("http://127.0.0.1:9100/room/r/messages?session_id=ses_worker");
    expect(client.requests[2].url).toBe("http://127.0.0.1:9100/room/r/messages?session_id=ses_worker&from=worker&since=msg_1&limit=10");
    expect(client.stdoutText()).toContain('"messages"');
  });
});

function mockCli(response: { ok: boolean; status?: number; body?: unknown }, stdin = "") {
  const requests: RequestRecord[] = [];
  let stdout = "";
  let stderr = "";
  const fetch = async (url: URL | RequestInfo, init?: RequestInit) => {
    requests.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return Response.json(response.body, { status: response.status ?? (response.ok ? 200 : 500) });
  };

  return {
    requests,
    run: (argv: string[]) =>
      runAgentCollabCli(argv, {
        fetch: fetch as typeof globalThis.fetch,
        stdout: { write: (chunk: string) => ((stdout += chunk), true) },
        stderr: { write: (chunk: string) => ((stderr += chunk), true) },
        stdin: { text: async () => stdin },
        env: {},
      }),
    stdoutText: () => stdout,
    stderrText: () => stderr,
  };
}
