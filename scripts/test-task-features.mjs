import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

const root = process.cwd();
const dataDir = await mkdtemp(path.join(os.tmpdir(), "opensybau-feature-test-"));
const now = new Date().toISOString();
const userOne = { id: "message-one", role: "user", content: "Start the first branch", status: "done", provider: "codex", model: "test-model", effort: "medium", createdAt: now };
const replyOne = { id: "reply-one", role: "assistant", replyToMessageId: userOne.id, content: "First answer", status: "done", provider: "codex", createdAt: now };
const userTwo = { id: "message-two", role: "user", content: "Continue from this point", status: "done", provider: "codex", model: "test-model", effort: "medium", createdAt: now };
const replyTwo = { id: "reply-two", role: "assistant", replyToMessageId: userTwo.id, content: "Second answer", status: "done", provider: "codex", createdAt: now };
const fixture = {
  version: 1,
  settings: { maxConcurrent: 1, defaults: {}, vaultPath: "" },
  workspaces: [{ id: "workspace-test", name: "Test", path: root, sourceFolders: [root], pinned: false, section: "Projects", addedAt: now }],
  tasks: [{
    id: "task-feature-test", title: "Feature test", prompt: "A fixture task prompt", workspaceId: "workspace-test", workspacePath: root,
    status: "done", phase: "done", isolated: false, config: { workflow: "chat-only", chatProvider: "codex", chatModel: "test-model", chatEffort: "medium" },
    permissionPreset: "workspace-write", createdAt: now, updatedAt: now, events: [], chatQueue: [], chatMessages: [userOne, replyOne, userTwo, replyTwo],
  }],
};

await writeFile(path.join(dataDir, "state.json"), JSON.stringify(fixture), "utf8");
const child = spawn(process.execPath, [path.join(root, "scripts/run.mjs"), "production"], {
  cwd: root,
  env: { ...process.env, WORKBENCH_MODE: "production", WORKBENCH_HOST: "127.0.0.1", WORKBENCH_PORT: "0", WORKBENCH_DATA_DIR: dataDir, WORKBENCH_ACCESS_USERNAME: "test", WORKBENCH_ACCESS_PASSWORD: "test-password" },
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

  const persisted = JSON.parse(await readFile(path.join(dataDir, "state.json"), "utf8"));
  assert.equal(persisted.tasks.length, 2);
  assert.equal(persisted.tasks[0].forkedFromMessageId, userTwo.id);
  process.stdout.write("Task feature integration checks passed: goal/checklist, permission validation, fork history, and persistence.\n");
} finally {
  if (child.exitCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    if (process.platform === "win32") spawnSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    else child.kill("SIGTERM");
    await Promise.race([exited, delay(3000)]);
  }
  await rm(dataDir, { recursive: true, force: true });
}
