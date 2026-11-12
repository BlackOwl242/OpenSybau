import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTaskStageRunner } from "../src/server/task-stage-runner.mjs";
const catalog = JSON.parse(execFileSync("codex", ["debug", "models"], { encoding: "utf8", windowsHide: true }));
const model = catalog.models.find((item) => item.slug && item.visibility !== "hidden" && item.supported_reasoning_levels?.length);
assert.ok(model, "Installed Codex catalog must provide a model");
const effort = model.supported_reasoning_levels[0].effort;
const cwd = await mkdtemp(join(tmpdir(), "opensybau-stage-live-"));
const task = { id: "live", storagePath: cwd, permissionPreset: "read-only", config: { codexTransport: "app-server" } };
const running = new Map([[task.id, {}]]);
const runner = createTaskStageRunner({ running, getState: () => ({tasks:[task]}), isShuttingDown: () => false, record() {}, schedulePersist() {}, schedulePublish() {},
  getCliExecutables: () => ({ codexExe: "codex" }), getApiProviderRuntime: () => null, additionalWritableProjectDirs: () => [],
  loadModels: async () => ({ codex: { available: true, capabilities: {chat:true}, models:[{id:model.slug,efforts:[effort]}] } }),
});
try {
  const result = await runner.spawnStage(task, "codex", "chat-initial", cwd, "Reply with OK only. Do not run tools or read files.", { provider: "codex", model: model.slug, effort });
  assert.match(result, /OK/i);
  assert.equal(task.stageMetrics[0].transport, "app-server");
  assert.equal(task.liveControl, undefined);
  assert.equal(running.get(task.id).appClient, undefined);
  task.config.codexTransport = "exec";
  const fallback = await runner.spawnStage(task, "codex", "chat-followup", cwd, "Reply with FALLBACK_OK only. Do not run tools, delegate or read files.", {provider:"codex",model:model.slug,effort});
  assert.match(fallback,/FALLBACK_OK/);
  console.log("Real Codex App Server stage lifecycle and CLI exec fallback passed.");
} finally { await rm(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
