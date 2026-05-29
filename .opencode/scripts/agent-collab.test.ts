import { describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_COLLAB_URL, parseArgs, resolveBaseUrl, runAgentCollabCli } from "./agent-collab";

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
