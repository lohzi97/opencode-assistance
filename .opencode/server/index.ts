/**
 * # Project Worker
 *
 * This Bun worker hosts project-local automation on top of a shared OpenCode
 * backend started by `opencode serve`.
 *
 * Current services:
 * - compaction management from `.opencode/server.jsonc#compaction`
 * - proactive automation from `.opencode/server.jsonc#proactive`
 * - collaboration foundation from `.opencode/server.jsonc#collab`
 *
 * The worker shares one OpenCode HTTP client and one `/global/event` listener
 * across services.
 */

import { CompactionService } from "./compaction";
import { CollabService } from "./collab";
import { ProactiveService } from "./proactive";
import { OpenCodeClient, ensureStateDir, listenGlobalEvents, unwrapBusEvent } from "./shared";

const client = new OpenCodeClient();
const compaction = new CompactionService(client);
const proactive = new ProactiveService(client);
const collab = new CollabService(client);

main().catch((err) => {
  console.error("project worker failed", err);
  process.exit(1);
});

async function main() {
  await ensureStateDir();
  await client.health();

  await compaction.start();
  await proactive.start();
  await collab.start();

  void listenGlobalEvents({
    onEvent: async (envelope) => {
      const bus = unwrapBusEvent(envelope);
      if (bus) {
        await proactive.handleEvent(bus);
      }
      await compaction.handleEnvelope(envelope);
      await collab.handleDeliveryEvent();
    },
  });
}
