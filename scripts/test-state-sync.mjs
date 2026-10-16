import assert from "node:assert/strict";
import { createStateSnapshot } from "../src/server/state-snapshot.mjs";
import { createStateLoader } from "../src/shared/state-sync.js";

let now = 120_000;
let reads = 0;
const state = { tasks: [{ id: "one", status: "running" }] };
const cache = createStateSnapshot(() => { reads++; return state; }, { now: () => now });
const first = cache.read();
for (let i = 0; i < 100; i++) assert.strictEqual(cache.read(), first);
assert.equal(reads, 1, "Repeated reads serialize only once per revision.");
state.tasks[0].status = "done";
cache.invalidate();
const next = cache.read();
assert.notEqual(next.etag, first.etag);
assert.equal(JSON.parse(next.body).tasks[0].status, "done");
now += 60_000;
assert.notEqual(cache.read().etag, next.etag, "Time-based telemetry gets refreshed without task writes.");
assert.notEqual(createStateSnapshot(() => state, { now: () => now }).read().etag, cache.read().etag, "A server restart cannot reuse an old ETag.");

let calls = 0;
const loader = createStateLoader(async (_path, options) => {
  calls++;
  if (calls === 1) return new Response(JSON.stringify(state), { headers: { ETag: next.etag } });
  assert.equal(options.headers["If-None-Match"], next.etag);
  if (calls === 2) return new Response(null, { status: 304 });
  if (calls === 3) return new Response('{"error":"Temporary failure"}', { status: 503 });
  return new Response('{"tasks":[]}', { headers: { ETag: '"new-process"' } });
});
const loaded = await loader();
assert.equal(loaded.changed, true);
const unchanged = await loader();
assert.equal(unchanged.changed, false);
assert.strictEqual(unchanged.state, loaded.state);
await assert.rejects(loader(), /Temporary failure/);
assert.deepEqual((await loader()).state.tasks, [], "Reconnect accepts the next valid server snapshot.");
console.log("State synchronization checks passed: serialization cache, invalidation, expiry, restart identity, 304, and recovery.");
