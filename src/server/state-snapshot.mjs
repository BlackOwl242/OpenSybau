import { randomUUID } from "node:crypto";

// A revision changes on writes, not reads. Include a process identity so a
// reconnect after a server restart cannot mistake a new snapshot for old data.
export function createStateSnapshot(readState, { now = Date.now } = {}) {
  const instance = randomUUID();
  let revision = 0;
  let cached;
  return {
    invalidate() { revision++; cached = undefined; },
    read() {
      const minute = Math.floor(now() / 60_000);
      if (!cached || cached.minute !== minute) {
        cached = {
          minute,
          etag: `"${instance}-${revision}-${minute}"`,
          body: JSON.stringify(readState()),
        };
      }
      return cached;
    },
  };
}
