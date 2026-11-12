import { randomUUID } from "node:crypto";

// A revision changes on writes, not reads. Include a process identity so a
// reconnect after a server restart cannot mistake a new snapshot for old data.
export function createStateSnapshot(readState) {
  const instance = randomUUID();
  let revision = 0;
  let cached;
  return {
    invalidate() { revision++; cached = undefined; },
    read() {
      if (!cached) {
        const payload = readState();
        const tasks = Array.isArray(payload?.tasks) ? payload.tasks : [];
        const workspaces = Array.isArray(payload?.workspaces) ? payload.workspaces : [];
        const memories = Array.isArray(payload?.memories) ? payload.memories : [];
        const latestTaskTs = tasks.reduce((max, t) => {
          const ts = String(t?.updatedAt || t?.createdAt || "");
          return ts > max ? ts : max;
        }, "");
        cached = {
          etag: `"${instance}-${revision}-${tasks.length}-${workspaces.length}-${memories.length}-${latestTaskTs}"`,
          body: JSON.stringify(payload),
        };
      }
      return cached;
    },
  };
}
