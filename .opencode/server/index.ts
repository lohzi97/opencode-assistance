/**
 * # Project Worker
 *
 * This Bun worker hosts project-local automation on top of a shared OpenCode
 * backend started by `opencode serve`.
 *
 * Current services:
 * - cron automation from `.opencode/server.jsonc#cron`
 * - compaction management from `.opencode/server.jsonc#compaction`
 *
 * The worker shares one OpenCode HTTP client and one `/global/event` listener
 * across both services.
 */

import { CronService } from "./cron";
import { CompactionService } from "./compaction";
import { OpenCodeClient, ensureStateDir, listenGlobalEvents, unwrapBusEvent } from "./shared";

const client = new OpenCodeClient();
const cron = new CronService(client);
const compaction = new CompactionService(client);

main().catch((err) => {
  console.error("project worker failed", err);
  process.exit(1);
});

async function main() {
  await ensureStateDir();
  await client.health();

  await compaction.start();

  void listenGlobalEvents({
    onEvent: async (envelope) => {
      const bus = unwrapBusEvent(envelope);
      if (bus) {
        await cron.handleEvent(bus);
      }
      await compaction.handleEnvelope(envelope);
    },
  });

  await cron.start();
}
