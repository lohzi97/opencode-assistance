import { CompactionService, CompactionRequestError } from "./compaction";
import { record, sleep } from "./shared";

const CONTROL_PORT = 4097;
const PORT_RETRY_ATTEMPTS = 120;
const PORT_RETRY_DELAY_MS = 1_000;

export async function startControlServer(compaction: CompactionService) {
  let busy = false;

  const handler = async (req: Request): Promise<Response> => {
    const url = new URL(req.url);

    if (url.pathname === "/compact" && req.method === "POST") {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json({ error: "invalid JSON body" }, { status: 400 });
      }

      if (!record(body) || typeof body.sessionID !== "string") {
        return Response.json({ error: "missing or invalid sessionID" }, { status: 400 });
      }

      if (busy) {
        return Response.json(
          { error: "compaction already in progress" },
          { status: 409 },
        );
      }

      busy = true;
      try {
        try {
          const result = await compaction.manualCompact(body.sessionID);
          return Response.json(result, { status: 200 });
        } catch (err) {
          if (err instanceof CompactionRequestError) {
            return Response.json(
              { error: err.message, ...err.extras },
              { status: err.statusCode },
            );
          }
          console.error("[control] manual compaction failed", err);
          return Response.json(
            { error: err instanceof Error ? err.message : String(err) },
            { status: 500 },
          );
        }
      } finally {
        busy = false;
      }
    }

    return Response.json({ error: "not found" }, { status: 404 });
  };

  for (let attempt = 0; attempt < PORT_RETRY_ATTEMPTS; attempt++) {
    try {
      Bun.serve({
        port: CONTROL_PORT,
        hostname: "127.0.0.1",
        fetch: handler,
      });
      console.log(`[control] listening on 127.0.0.1:${CONTROL_PORT}`);
      return;
    } catch (err) {
      if (!isAddressInUse(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[control] failed to start: ${msg}`);
        return;
      }
      console.log(`[control] port ${CONTROL_PORT} in use, retrying (${attempt + 1}/${PORT_RETRY_ATTEMPTS})...`);
      await sleep(PORT_RETRY_DELAY_MS);
    }
  }

  console.error(`[control] could not acquire port ${CONTROL_PORT} after ${PORT_RETRY_ATTEMPTS} attempts, manual compaction unavailable`);
}

function isAddressInUse(err: unknown) {
  const code = record(err) && typeof err.code === "string" ? err.code : undefined;
  const msg = err instanceof Error ? err.message : String(err);
  return code === "EADDRINUSE" || /EADDRINUSE|address already in use|port .*in use/i.test(msg);
}
