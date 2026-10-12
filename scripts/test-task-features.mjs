import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const dataDir = await mkdtemp(path.join(os.tmpdir(), "opensybau-feature-test-"));
const now = new Date().toISOString();
let providerCalls = 0;
const providerStub = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const prompt = payload.messages?.[0]?.content || "";
  const content = prompt.includes("skill router")
    ? JSON.stringify({ skillIds: [], reason: "No matching test skills." })
    : `Fresh test plan ${++providerCalls}`;
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ choices: [{ message: { content } }] }));
});
await new Promise((resolve, reject) => {
  providerStub.once("error", reject);
  providerStub.listen(0, "127.0.0.1", resolve);
});
const providerPort = providerStub.address().port;
const userOne = { id: "message-one", role: "user", content: "Start the first branch", status: "done", provider: "codex", model: "test-model", effort: "medium", createdAt: now };
const replyOne = { id: "reply-one", role: "assistant", replyToMessageId: userOne.id, content: "First answer", status: "done", provider: "codex", createdAt: now };
const userTwo = { id: "message-two", role: "user", content: "Continue from this point", status: "done", provider: "codex", model: "test-model", effort: "medium", createdAt: now };
const replyTwo = { id: "reply-two", role: "assistant", replyToMessageId: userTwo.id, content: "Second answer", status: "done", provider: "codex", createdAt: now };
const fixture = {
  version: 1,
  settings: { maxConcurrent: 1, defaults: {}, vaultPath: "" },
  workspaces: [{ id: "workspace-test", name: "Test", path: root, sourceFolders: [root], pinned: false, section: "Projects", addedAt: now }],
  tasks: [
    {
      id: "task-feature-test", title: "Feature test", prompt: "A fixture task prompt", workspaceId: "workspace-test", workspacePath: root,
      status: "done", phase: "done", isolated: false, config: { workflow: "chat-only", chatProvider: "codex", chatModel: "test-model", chatEffort: "medium" },
      permissionPreset: "workspace-write", createdAt: now, updatedAt: now, events: [], chatQueue: [], chatMessages: [userOne, replyOne, userTwo, replyTwo],
    },
    {
      id: "task-plan-test", title: "Plan rerun fixture", prompt: "Create a fresh implementation plan", workspaceId: "workspace-test", workspacePath: root,
      status: "done", phase: "done", isolated: false,
      config: { workflow: "plan-only", roles: { plan: { provider: "test-api", model: "test-model", effort: "standard" } } },
      permissionPreset: "workspace-write", createdAt: now, updatedAt: now, events: [{ id: "prior-event", text: "Kept event from the earlier run", kind: "info", at: now }],
      plan: "Old plan to preserve in history", implementation: "", review: "", artifacts: [], skillSelectionMode: "manual", skillSelectionCompleted: true, skillIds: [],
    },
  ],
};

await writeFile(path.join(dataDir, "state.json"), JSON.stringify(fixture), "utf8");
const child = spawn(process.execPath, [path.join(root, "scripts/run.mjs"), "production"], {
  cwd: root,
  env: {
    ...process.env,
    WORKBENCH_MODE: "production", WORKBENCH_HOST: "127.0.0.1", WORKBENCH_PORT: "0", WORKBENCH_DATA_DIR: dataDir,
    WORKBENCH_ACCESS_USERNAME: "test", WORKBENCH_ACCESS_PASSWORD: "test-password",
    WORKBENCH_API_PROVIDERS: JSON.stringify([{ id: "test-api", name: "Test API", protocol: "openai-compatible", baseUrl: `http://127.0.0.1:${providerPort}/v1`, models: ["test-model"] }]),
  },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let output = "";
let serverUrl = "";
const onOutput = (chunk) => {
  output += chunk.toString();
  serverUrl ||= output.match(/OpenSybau ready at (http:\/\/127\.0\.0\.1:\d+)/)?.[1] || "";
};
child.stdout.on("data", onOutput);
child.stderr.on("data", onOutput);

try {
  const deadline = Date.now() + 20_000;
  while (!serverUrl && Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Server exited early:\n" + output);
    await delay(100);
  }
  assert.ok(serverUrl, "Server did not start:\n" + output);

  const request = async (route, method = "GET", body) => {
    const response = await fetch(serverUrl + route, {
      method,
      headers: { authorization: "Basic " + Buffer.from("test:test-password").toString("base64"), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  };

  const goal = await request("/api/tasks/task-feature-test/goal", "POST", {
    goal: "Deliver a stable feature",
    checklist: ["Preserve the original chat", "Keep the goal in later prompts"],
  });
  assert.equal(goal.status, 200);
  assert.equal(goal.body.task.goalChecklist.length, 2);

  const checked = await request("/api/tasks/task-feature-test/checklist", "POST", {
    id: goal.body.task.goalChecklist[0].id, done: true,
  });
  assert.equal(checked.status, 200);
  assert.equal(checked.body.task.goalChecklist[0].done, true);

  const permission = await request("/api/tasks/task-feature-test", "PATCH", { permissionPreset: "read-only" });
  assert.equal(permission.status, 200);
  assert.equal(permission.body.task.permissionPreset, "read-only");
  const invalidPermission = await request("/api/tasks/task-feature-test", "PATCH", { permissionPreset: "unrestricted" });
  assert.equal(invalidPermission.status, 400);

  const fork = await request("/api/tasks/task-feature-test/fork", "POST", { messageId: userTwo.id });
  assert.equal(fork.status, 201);
  assert.equal(fork.body.task.forkedFrom, "task-feature-test");
  assert.deepEqual(fork.body.task.chatMessages.map((message) => message.id), [userOne.id, replyOne.id, userTwo.id, replyTwo.id]);
  assert.equal(fork.body.task.permissionPreset, "read-only");

  const invalidFork = await request("/api/tasks/task-feature-test/fork", "POST", { messageId: "missing-message" });
  assert.equal(invalidFork.status, 404);

  const invalidStage = await request("/api/tasks/task-plan-test/run", "POST", { stage: "build" });
  assert.equal(invalidStage.status, 400, "A plan-only task must reject a build-stage rerun.");

  const rerun = await request("/api/tasks/task-plan-test/run", "POST", { stage: "plan" });
  assert.equal(rerun.status, 202);
  assert.equal(rerun.body.task.events.some((event) => event.id === "prior-event"), true, "Rerunning must keep prior task events.");
  assert.equal(rerun.body.task.stageRunHistory[0].previousOutputs.plan.text, "Old plan to preserve in history");
  const waitForTask = async (id) => {
    const deadline = Date.now() + 15_000;
    let task;
    while (Date.now() < deadline) {
      const result = await request(`/api/tasks/${id}`);
      assert.equal(result.status, 200);
      task = result.body;
      if (["done", "failed", "cancelled"].includes(task.status)) break;
      await delay(100);
    }
    assert.ok(task && ["done", "failed", "cancelled"].includes(task.status), `Task ${id} did not finish in time.`);
    assert.equal(task.status, "done", task.error || `Task ${id} did not complete.`);
    return task;
  };
  const rerunFinished = await waitForTask("task-plan-test");
  assert.equal(rerunFinished.plan, "Fresh test plan 1");
  assert.equal(rerunFinished.stageRunHistory[0].status, "done");
  assert.equal(rerunFinished.stageRunHistory[0].previousOutputs.plan.text, "Old plan to preserve in history");
  assert.equal(rerunFinished.events.some((event) => event.id === "prior-event"), true);

  const templateProfile = {
    workflow: "plan-only", permissionPreset: "read-only",
    roles: { plan: { provider: "test-api", model: "test-model", effort: "standard" } },
  };
  const firstVersion = await request("/api/task-presets", "POST", { name: "Test planning", profile: templateProfile });
  assert.equal(firstVersion.status, 201);
  assert.equal(firstVersion.body.preset.currentVersion, 1);
  const secondVersion = await request("/api/task-presets", "POST", { id: firstVersion.body.preset.id, name: "Test planning", profile: { ...templateProfile, permissionPreset: "workspace-write" } });
  assert.equal(secondVersion.status, 201);
  assert.equal(secondVersion.body.preset.currentVersion, 2);
  assert.equal(secondVersion.body.preset.versions.length, 2);
  const listedPresets = await request("/api/task-presets");
  assert.equal(listedPresets.body.presets[0].versions.length, 2);

  const createFromStaleTemplate = await request("/api/tasks", "POST", {
    workspaceId: "workspace-test", prompt: "Create task from an older template", workflow: "plan-only", permissionPreset: "workspace-write",
    planProvider: "test-api", planModel: "test-model", planEffort: "standard",
    presetRef: { id: firstVersion.body.preset.id, version: 99 },
  });
  assert.equal(createFromStaleTemplate.status, 409);
  const createdFromTemplate = await request("/api/tasks", "POST", {
    workspaceId: "workspace-test", prompt: "Create task from a saved template", workflow: "plan-only", permissionPreset: "workspace-write",
    planProvider: "test-api", planModel: "test-model", planEffort: "standard",
    presetRef: { id: secondVersion.body.preset.id, version: 2 },
  });
  assert.equal(createdFromTemplate.status, 201);
  assert.deepEqual(createdFromTemplate.body.task.presetRef, { id: secondVersion.body.preset.id, name: "Test planning", version: 2 });
  const createdTask = await waitForTask(createdFromTemplate.body.task.id);
  assert.equal(createdTask.plan, "Fresh test plan 2");

  const persisted = JSON.parse(await readFile(path.join(dataDir, "state.json"), "utf8"));
  assert.equal(persisted.tasks.length, 4);
  assert.equal(persisted.tasks.some((task) => task.forkedFromMessageId === userTwo.id), true);
  assert.equal(persisted.tasks.find((task) => task.id === createdTask.id).presetRef.version, 2);
  assert.equal(persisted.settings.taskPresets[0].versions.length, 2);
  process.stdout.write("Task feature integration checks passed: goal/checklist, permissions, forks, stage reruns with history, versioned task presets, and persistence.\n");
} finally {
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else child.kill("SIGTERM");
    await Promise.race([exited, delay(3000)]);
  }
  await new Promise((resolve) => providerStub.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
}
