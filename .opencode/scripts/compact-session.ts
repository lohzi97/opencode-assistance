/**
 * Manual compaction trigger script.
 *
 * Usage: bun .opencode/scripts/compact-session.ts <sessionID>
 *
 * Sends a POST /compact request to the internal control server on port 4097.
 * On success, prints the continuation session ID, group, and title.
 * On failure, prints the error and exits with code 1.
 */

const CONTROL_PORT = 4097;
const TIMEOUT_MS = 180_000;

const args = process.argv.slice(2);
const sessionID = args[0];
if (args.length !== 1 || !sessionID || sessionID.startsWith("-")) {
  console.error("Usage: bun .opencode/scripts/compact-session.ts <sessionID>");
  process.exit(1);
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

try {
  const res = await fetch(`http://127.0.0.1:${CONTROL_PORT}/compact`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionID }),
    signal: controller.signal,
  });

  const text = await res.text();
  let data: Record<string, unknown> = {};
  try {
    data = JSON.parse(text) as Record<string, unknown>;
  } catch {
    data = { error: text || "empty response" };
  }

  if (res.ok) {
    console.log(`Continuation session: ${data.continuationSessionID}`);
    console.log(`Group: ${data.groupID}`);
    console.log(`Title: ${data.title}`);
    process.exit(0);
  }

  console.error(`Error (${res.status}): ${data.error}`);
  if (data.supersededBy) {
    console.error(`Already superseded by: ${data.supersededBy}`);
  }
  if (data.phase) {
    console.error(`Phase: ${data.phase}`);
  }
  if (data.details) {
    console.error(`Details: ${data.details}`);
  }
  process.exit(1);
} catch (err) {
  if ((err as Error).name === "AbortError") {
    console.error("Error: request timed out after 180s");
  } else {
    console.error(`Error: ${(err as Error).message ?? err}`);
  }
  process.exit(1);
} finally {
  clearTimeout(timer);
}
