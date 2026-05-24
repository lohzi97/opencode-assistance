/**
 * # Project Worker
 *
 * This Bun worker hosts project-local automation on top of a shared OpenCode
 * backend started by `opencode serve`.
 *
 * Current services:
 * - compaction management from `.opencode/server.jsonc#compaction`
 * - proactive automation from `.opencode/server.jsonc#proactive`
 * - internal control server on port 4097 for manual compaction triggers
 *
 * The worker shares one OpenCode HTTP client and one `/global/event` listener
 * across all services. It connects outbound to the OpenCode backend on port
 * 4096 as a client and accepts inbound HTTP requests on port 4097 for control
 * operations.
 */

import { CompactionService } from "./compaction";
import { startControlServer } from "./control";
import { ProactiveService } from "./proactive";
import { OpenCodeClient, ensureStateDir, listenGlobalEvents, unwrapBusEvent } from "./shared";

const client = new OpenCodeClient();
const compaction = new CompactionService(client);
const proactive = new ProactiveService(client);

main().catch((err) => {
  console.error("project worker failed", err);
  process.exit(1);
});

async function main() {
  await ensureStateDir();
  await client.health();

  await compaction.start();
  await proactive.start();
  void startControlServer(compaction);

  void listenGlobalEvents({
    onEvent: async (envelope) => {
      const bus = unwrapBusEvent(envelope);
      if (bus) {
        await proactive.handleEvent(bus);
      }
      await compaction.handleEnvelope(envelope);
    },
  });
}
