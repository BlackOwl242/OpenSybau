import assert from "node:assert/strict";
import { handleTaskRoutes } from "../src/server/routes/task-routes.mjs";

const task = { id: "task", chatQueue: [{ messageId: "pending", content: "private attachment" }], chatMessages: [{ id: "pending", role: "user", content: "hello", status: "queued" }] };
let response;
let persisted = 0;
const ctx = {
  getState: () => ({ tasks: [task], workspaces: [] }), running: new Map(), busyWorkspaces: new Set(),
  persist: () => persisted++, publish() {}, record() {}, json: (_res, status, body) => { response = { status, body }; },
  cliDiscovery: {}, skillCatalogService: {}, promptService: {}, stageRunner: {}, taskRunner: {},
};
await handleTaskRoutes({ method: "DELETE" }, {}, "/api/tasks/task/chat-queue/pending", ctx);
assert.equal(response.status, 200);
assert.equal(task.chatQueue.length, 0);
assert.equal(task.chatMessages[0].status, "cancelled");
assert.equal(persisted, 1);
await handleTaskRoutes({ method: "DELETE" }, {}, "/api/tasks/task/chat-queue/pending", ctx);
assert.equal(response.status, 409);
task.chatMessages[0].status = "running";
task.chatQueue.push({ messageId: "pending" });
await handleTaskRoutes({ method: "DELETE" }, {}, "/api/tasks/task/chat-queue/pending", ctx);
assert.equal(response.status, 409);
assert.equal(task.chatQueue.length, 1);
console.log("Queued message cancellation and running-turn protection passed.");
