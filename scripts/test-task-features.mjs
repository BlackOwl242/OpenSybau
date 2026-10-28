import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { cliIsInstalled } from "../src/server/cli-status.mjs";
import { unquoteGitPath } from "../src/server/fs-security.mjs";
import { pipelineStepperData, computeWaveDag } from "../src/domain/task-flow.js";
import { formatProgressiveSkillsIndex, createSkillCatalogService } from "../src/server/skill-catalog.mjs";
import { autoDistillTaskMemory as distillTaskMemoryUnit, userProfileMemorySnapshot } from "../src/server/memory-bm25.mjs";
import { compactChatHistory } from "../src/server/task-prompts.mjs";
import { applyApiBuildResult, executeApiWorkspaceTool, parseApiBuildOperations, parseApiToolCall } from "../src/server/api-build-ops.mjs";

const root = process.cwd();
assert.equal(
  unquoteGitPath('"H\\341\\273\\207 th\\341\\273\\221ng th\\303\\264ng tin qu\\341\\272\\243n l\\303\\275 h\\303\\240nh ch\\303\\255nh/frontend/src/CitizenProfile.tsx"'),
  "Hệ thống thông tin quản lý hành chính/frontend/src/CitizenProfile.tsx",
  "unquoteGitPath must decode Git octal UTF-8 paths.",
);
assert.equal(
  unquoteGitPath("H/341/273/207 th/341/273/221ng th/303/264ng tin qu/341/272/243n l/303/275 h/303/240nh ch/303/255nh/frontend/src/CitizenProfile.tsx"),
  "Hệ thống thông tin quản lý hành chính/frontend/src/CitizenProfile.tsx",
  "unquoteGitPath must recover slash-corrupted octal UTF-8 paths.",
);
assert.equal(cliIsInstalled("C:\\Users\\test\\agy.exe", -1, () => true), true, "An executable present on disk is installed even if its version command cannot start.");
assert.equal(cliIsInstalled("C:\\Users\\test\\missing.exe", -1, () => false), false, "A missing executable with a failed version command is not installed.");
assert.equal(cliIsInstalled("", 0, () => false), true, "A successful version command confirms installation.");

// Unit tests for Hermes-inspired optimizations:
// 1. Progressive Skill Selection & Workspace Trust Gating
{
  const skillSvc = createSkillCatalogService({
    runtime: os.tmpdir(),
    getWorkspaces: () => [],
    hasApiProvider: () => true,
    stageSelection: () => ({ provider: "codex" }),
    publicProviderName: (p) => p,
    workflowRoles: [{ id: "plan" }, { id: "build" }, { id: "review" }],
  });
  const catalog = [
    { id: "skill-high00000001", name: "sqlite-fts-search", description: "Build SQLite FTS5 full text search indexes", providers: ["codex"], workspaceScoped: false, trusted: true },
    { id: "skill-sec000000002", name: "search-ui-helper", description: "Helper for search filter bars and query inputs", providers: ["codex"], workspaceScoped: false, trusted: true },
    { id: "skill-untrusted003", name: "sqlite-fts-untrusted", description: "Untrusted repo skill for sqlite-fts-search", providers: ["codex"], workspaceScoped: true, trusted: false },
  ];
  const selUntrusted = skillSvc.selectTaskSkillsProgressive({ title: "Implement sqlite-fts-search", prompt: "Add SQLite FTS5 search index" }, catalog);
  assert.equal(selUntrusted.skillIds.includes("skill-high00000001"), true, "Strong matching skill must be selected in Tier 1.");
  assert.equal(selUntrusted.skillIds.includes("skill-untrusted003"), false, "Untrusted workspace skill must be skipped.");
  assert.equal(selUntrusted.progressiveSkills.some((s) => s.id === "skill-sec000000002"), true, "Secondary matching skill must be placed in Tier 0 progressive index.");
  const indexText = formatProgressiveSkillsIndex(selUntrusted.progressiveSkills);
  assert.equal(indexText.includes("</available_skills_index>"), true);
  assert.equal(indexText.includes("search-ui-helper"), true);
}

// 2. 2-Tier Memory (User Profile Snapshot + Pitfall/Blocking Lesson Distillation)
{
  const memList = [
    { id: "u1", title: "Coding Style", content: "Always use ES modules and strict assertions.", kind: "user-profile", category: "user", workspaceId: "all" },
  ];
  const snapshot = userProfileMemorySnapshot(memList);
  assert.equal(snapshot.includes("Coding Style"), true);
  let persistedCalled = false;
  const distilled = distillTaskMemoryUnit(
    {
      id: "task-pitfall-1",
      code: "LOOP-99",
      title: "Fix race condition in worktree lock",
      status: "done",
      currentRound: 2,
      plan: "## Steps\n1. Add mutex lock around git worktree add",
      implementation: "Added withGitRepoLock around worktree creation.",
      review: "- [BLOCKING] Missing lock release in finally block\n- [ADVISORY] Log lock wait duration",
      qaResult: { command: "npm test", status: "passed", summary: "0 errors" },
      artifacts: ["src/server/task-runner.mjs"],
    },
    { id: "workspace-test" },
    memList,
    () => { persistedCalled = true; },
  );
  assert.equal(persistedCalled, true);
  assert.equal(distilled.kind, "pitfall");
  assert.equal(distilled.content.includes("Resolved Pitfalls (2 rounds)"), true);
  assert.equal(distilled.content.includes("Missing lock release in finally block"), true);
  assert.equal(distilled.content.includes("QA (npm test): PASSED"), true);
}

// 3. Rolling Context Compaction
{
  const manyMessages = [];
  for (let i = 1; i <= 8; i++) {
    manyMessages.push({ id: `u-${i}`, role: "user", content: `User request number ${i} about module ${i}`, status: "done" });
    manyMessages.push({ id: `a-${i}`, role: "assistant", content: `Assistant response number ${i} completed module ${i}`, status: "done" });
  }
  const compactTask = { id: "task-compact-unit", chatMessages: manyMessages };
  const compacted = compactChatHistory(compactTask, undefined, 6);
  assert.equal(compacted.recentMessages.length, 6);
  assert.equal(compacted.compactedSummary.includes("User request number 1"), true);
  assert.equal(Array.isArray(compactTask.compactionLineage) && compactTask.compactionLineage.length === 1, true);
}

// 4. Local Agentic Tool Loop & Targeted Patch Operations
{
  const patchTempDir = await mkdtemp(path.join(os.tmpdir(), "opensybau-patch-unit-"));
  try {
    await writeFile(path.join(patchTempDir, "app.js"), "const a = 1;\nconst b = 2;\nexport default a + b;\n", "utf8");
    await writeFile(path.join(patchTempDir, ".env"), "SECRET_TOKEN=xyz\n", "utf8");
    const toolTask = { id: "task-tool-unit" };
    const parsedTool = parseApiToolCall('```json\n{"tool_call":{"name":"read_file","args":{"path":"app.js","startLine":1,"endLine":2}}}\n```');
    assert.equal(parsedTool?.name, "read_file");
    const readRes = await executeApiWorkspaceTool(toolTask, patchTempDir, parsedTool);
    assert.equal(readRes.ok, true);
    assert.equal(readRes.output.includes("1: const a = 1;"), true);
    assert.equal(typeof toolTask.buildSnapshotHashes?.["app.js"], "string", "read_file tool must snapshot file hash for conflict detection.");

    const envBlocked = await executeApiWorkspaceTool(toolTask, patchTempDir, { name: "read_file", args: { path: ".env" } });
    assert.equal(envBlocked.ok, false, ".env must be blocked from API tool reading.");

    const searchRes = await executeApiWorkspaceTool(toolTask, patchTempDir, { name: "search_files", args: { query: "const b" } });
    assert.equal(searchRes.ok, true);
    assert.equal(searchRes.output.includes("app.js:2:"), true);

    const patchOutput = JSON.stringify({
      summary: "Update b to 42 using targeted search/replace patch",
      patches: [{ path: "app.js", edits: [{ search: "const b = 2;", replace: "const b = 42;" }] }],
      deletePaths: [],
    });
    const parsedOps = parseApiBuildOperations(patchOutput);
    assert.equal(parsedOps.patches.length, 1);
    const appliedSummary = await applyApiBuildResult(patchTempDir, patchOutput, { expectedFileHashes: toolTask.buildSnapshotHashes });
    assert.equal(appliedSummary.includes("Patched app.js"), true);
    const updatedContent = await readFile(path.join(patchTempDir, "app.js"), "utf8");
    assert.equal(updatedContent, "const a = 1;\nconst b = 42;\nexport default a + b;\n");
  } finally {
    await rm(patchTempDir, { recursive: true, force: true });
  }
}

const dataDir = await mkdtemp(path.join(os.tmpdir(), "opensybau-feature-test-"));
const now = new Date().toISOString();
let providerCalls = 0;
const providerStub = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const prompt = payload.messages?.[0]?.content || "";
  let content;
  if (prompt.includes("[TOOL_LOOP_TEST]") && !prompt.includes("<tool_response")) {
    content = JSON.stringify({ tool_call: { name: "read_file", args: { path: "package.json", startLine: 1, endLine: 5 } } });
  } else if (prompt.includes("[TOOL_LOOP_TEST]") && prompt.includes("<tool_response")) {
    content = "Plan after reading package.json: opensybau";
  } else if (prompt.includes("skill router")) {
    content = JSON.stringify({ skillIds: [], reason: "No matching test skills." });
  } else {
    content = `Fresh test plan ${++providerCalls}`;
  }
  response.writeHead(200, { "content-type": "application/json" });
  response.end(JSON.stringify({ choices: [{ message: { content } }], usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, prompt_tokens_details: { cached_tokens: 64 } } }));
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
    {
      id: "task-archived-test", title: "Archived chat fixture", prompt: "An archived chat for deletion", workspaceId: "workspace-test", workspacePath: root,
      status: "done", phase: "done", isolated: false, archived: true, config: { workflow: "chat-only" },
      permissionPreset: "workspace-write", createdAt: now, updatedAt: now, events: [], chatMessages: [],
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
    return { status: response.status, headers: response.headers, body: await response.json() };
  };

  const nestedWorkspace = await request("/api/workspaces", "POST", { path: path.join(root, "src", "domain") });
  assert.equal(nestedWorkspace.status, 201);
  assert.equal(nestedWorkspace.body.workspace.path, path.join(root, "src", "domain"), "Registering a nested folder must preserve the exact folder selected by the user.");

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
  const fullAccess = await request("/api/tasks/task-feature-test", "PATCH", { permissionPreset: "full-access" });
  assert.equal(fullAccess.status, 200);
  assert.equal(fullAccess.body.task.permissionPreset, "full-access");
  await request("/api/tasks/task-feature-test", "PATCH", { permissionPreset: "read-only" });
  const invalidPermission = await request("/api/tasks/task-feature-test", "PATCH", { permissionPreset: "unrestricted" });
  assert.equal(invalidPermission.status, 400);
  const invalidAntigravityPath = await request("/api/connectors/antigravity/path", "POST", { path: "agy.exe" });
  assert.equal(invalidAntigravityPath.status, 400, "Antigravity path override must require an absolute executable path.");
  const invalidClaudePath = await request("/api/connectors/claude/path", "POST", { path: "cli.js" });
  assert.equal(invalidClaudePath.status, 400, "Manual Claude selection must reject relative paths.");
  const chosenClaudeScript = path.join(dataDir, "claude-cli.js");
  await writeFile(chosenClaudeScript, 'if (process.argv[2] === "--version") console.log("2.0.0"); else process.exitCode = 1;\n', "utf8");
  const chosenClaudePath = await request("/api/connectors/claude/path", "POST", { path: chosenClaudeScript });
  assert.equal(chosenClaudePath.status, 200, "A selected Claude cli.js must be validated and persisted.");
  assert.equal(chosenClaudePath.body.connector.installed, true, "The selected Claude entry point must be recognized as installed.");
  assert.equal(JSON.parse(await readFile(path.join(dataDir, "cli-paths.json"), "utf8")).claude, chosenClaudeScript, "The selected Claude CLI path must survive app restart.");
  const rejectUnarchivedDelete = await request("/api/tasks/task-feature-test", "DELETE");
  assert.equal(rejectUnarchivedDelete.status, 409, "Chats must be archived before permanent deletion.");
  const deletedArchivedChat = await request("/api/tasks/task-archived-test", "DELETE");
  assert.equal(deletedArchivedChat.status, 200);
  assert.equal(deletedArchivedChat.body.deleted, true);
  assert.equal((await request("/api/state")).body.workspaces.some((workspace) => workspace.id === "workspace-test"), true, "Deleting a chat must not delete its workspace.");

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
    workspaceId: "workspace-test", prompt: "Create task from a saved template", workflow: "plan-only",
    planProvider: "test-api", planModel: "test-model", planEffort: "standard",
    presetRef: { id: secondVersion.body.preset.id, version: 2 },
  });
  assert.equal(createdFromTemplate.status, 201);
  assert.equal(createdFromTemplate.body.task.permissionPreset, "workspace-write", "New tasks default to workspace-write when the user has not chosen a narrower preset.");
  assert.deepEqual(createdFromTemplate.body.task.presetRef, { id: secondVersion.body.preset.id, name: "Test planning", version: 2 });
  const createdTask = await waitForTask(createdFromTemplate.body.task.id);
  assert.equal(createdTask.plan, "Fresh test plan 2");

  const stateRes = await request("/api/state");
  assert.equal(stateRes.status, 200);
  assert.equal(typeof stateRes.body.telemetry?.runningCount, "number", "State payload must include live telemetry summary.");
  assert.equal(typeof stateRes.body.telemetry?.tokens5h, "number", "Telemetry must include 5h token counter.");
  const stateTag = stateRes.headers.get("etag");
  assert.ok(stateTag, "Snapshots must have an ETag for background revalidation.");
  const revalidated = await fetch(serverUrl + "/api/state", { headers: { authorization: "Basic " + Buffer.from("test:test-password").toString("base64"), "If-None-Match": stateTag } });
  assert.equal(revalidated.status, 304, "Unchanged state must not transfer task history again.");
  assert.equal(await revalidated.text(), "");
  const streamController = new AbortController();
  const stream = await fetch(serverUrl + "/__events", { headers: { authorization: "Basic " + Buffer.from("test:test-password").toString("base64") }, signal: streamController.signal });
  const reader = stream.body.getReader();
  const connected = new TextDecoder().decode((await reader.read()).value);
  assert.match(connected, /retry: 3000/);
  assert.match(connected, /event: connected/);
  await request("/api/tasks/task-feature-test/pin", "POST", { pinned: true });
  const update = new TextDecoder().decode((await reader.read()).value);
  assert.match(update, /event: update/, "A mutation must update the existing event connection.");
  streamController.abort();
  const changedState = await fetch(serverUrl + "/api/state", { headers: { authorization: "Basic " + Buffer.from("test:test-password").toString("base64"), "If-None-Match": stateTag } });
  assert.equal(changedState.status, 200, "Mutating a task must invalidate the cached state.");
  assert.notEqual(changedState.headers.get("etag"), stateTag);
  assert.equal((await changedState.json()).tasks.find((task) => task.id === "task-feature-test").pinned, true);

  const fileIndexRes = await request("/api/workspaces/workspace-test/file-index");
  assert.equal(fileIndexRes.status, 200);
  assert.equal(Array.isArray(fileIndexRes.body.files), true, "Workspace file-index endpoint must return a flat files array.");
  assert.equal(fileIndexRes.body.files.includes("server.mjs"), true, "Workspace file-index must include root project files.");

  const diffRes = await request("/api/tasks/task-feature-test/diff");
  assert.equal(diffRes.status, 200);
  assert.equal(Array.isArray(diffRes.body.files), true, "Diff endpoint must return structured per-file hunks for Diff Review Studio.");

  const fanoutRes = await request("/api/tasks/fanout", "POST", {
    workspaceId: "workspace-test",
    prompt: "Compare two parallel solutions",
    competitors: [
      { provider: "test-api", model: "test-model", effort: "standard", label: "Test A" },
      { provider: "test-api", model: "test-model", effort: "standard", label: "Test B" },
    ],
  });
  assert.equal(fanoutRes.status, 201);
  assert.ok(fanoutRes.body.fanoutId, "Fanout endpoint must return a shared fanoutId.");
  assert.equal(fanoutRes.body.tasks.length, 2, "Fanout endpoint must spawn one task per competitor.");
  assert.equal(fanoutRes.body.tasks[0].fanoutId, fanoutRes.body.fanoutId);
  assert.equal(fanoutRes.body.tasks[0].isolated, true, "Arena fanout tasks must be isolated in Git worktrees.");
  await waitForTask(fanoutRes.body.tasks[0].id);
  await waitForTask(fanoutRes.body.tasks[1].id);
  await request(`/api/tasks/${fanoutRes.body.tasks[0].id}/discard-worktree`, "POST", {});
  await request(`/api/tasks/${fanoutRes.body.tasks[1].id}/discard-worktree`, "POST", {});

  const rawHtmlRes = await fetch(serverUrl + "/api/workspaces/workspace-test/raw/index.html", {
    headers: { authorization: "Basic " + Buffer.from("test:test-password").toString("base64") },
  });
  assert.equal(rawHtmlRes.status, 200);
  const rawCsp = rawHtmlRes.headers.get("content-security-policy") || "";
  assert.match(rawCsp, /sandbox allow-scripts/);
  assert.equal(rawCsp.includes("allow-same-origin"), false, "Raw HTML preview must not include allow-same-origin in sandbox CSP.");

  const badContentTypeRes = await fetch(serverUrl + "/api/memory", {
    method: "POST",
    headers: {
      authorization: "Basic " + Buffer.from("test:test-password").toString("base64"),
      "content-type": "text/plain",
    },
    body: JSON.stringify({ title: "x", content: "y" }),
  });
  assert.equal(badContentTypeRes.status, 415, "Non-JSON Content-Type with body must be rejected with 415.");

  const readOnlyFullWorkflow = await request("/api/tasks", "POST", {
    workspaceId: "workspace-test",
    prompt: "Should reject read-only full pipeline",
    workflow: "codex-antigravity",
    permissionPreset: "read-only",
  });
  assert.equal(readOnlyFullWorkflow.status, 400, "codex-antigravity workflow must reject read-only preset.");

  const forbiddenRootWorkspace = await request("/api/workspaces", "POST", {
    path: process.platform === "win32" ? "C:\\" : "/",
  });
  assert.equal(forbiddenRootWorkspace.status, 400, "Filesystem root must be rejected as a workspace.");

  // Test Human Plan Gate (awaiting_approval -> approve -> done), Cycles, Auto-Distilled Memory & QA Runner
  const gatedCreate = await request("/api/tasks", "POST", {
    workspaceId: "workspace-test",
    prompt: "Implement authentication token validation with Plan Gate approval",
    workflow: "plan-only",
    planGate: true,
    maxRounds: 2,
    riskLevel: "L",
    planProvider: "test-api",
    planModel: "test-model",
    planEffort: "standard",
  });
  assert.equal(gatedCreate.status, 201);
  const gatedId = gatedCreate.body.task.id;
  const gateDeadline = Date.now() + 15_000;
  let awaitingTask = null;
  while (Date.now() < gateDeadline) {
    const res = await request(`/api/tasks/${gatedId}`);
    if (res.body?.status === "awaiting_approval") {
      awaitingTask = res.body;
      break;
    }
    await delay(80);
  }
  assert.ok(awaitingTask, "Task with planGate:true must pause at awaiting_approval after plan stage.");
  assert.equal(awaitingTask.phase, "plan-gate");
  const awaitingStepper = pipelineStepperData(awaitingTask);
  assert.equal(awaitingStepper.stations.length, 6);
  assert.equal(awaitingStepper.stations.find((s) => s.id === "you")?.state, "attention");
  assert.equal(awaitingStepper.currentRound, 1);
  assert.equal(awaitingStepper.maxRounds, 2);
  assert.equal(awaitingStepper.stageDocuments.find((d) => d.id === "plan")?.ready, true);

  const approveGate = await request(`/api/tasks/${gatedId}/plan-gate`, "POST", {
    action: "approve",
    feedback: "Approved, proceed with implementation.",
  });
  assert.equal(approveGate.status, 200);
  const completedGated = await waitForTask(gatedId);
  assert.equal(Boolean(completedGated.planGateApprovedAt), true);
  assert.equal(Array.isArray(completedGated.cycles) && completedGated.cycles.length >= 1, true);
  const completedStepper = pipelineStepperData(completedGated);
  assert.equal(completedStepper.stations.find((s) => s.id === "you")?.state, "done");
  assert.equal(completedStepper.cycles.length >= 1, true);
  assert.equal(Boolean(completedStepper.cycles[0].label), true);
  assert.equal(completedStepper.cycles[0].status, "done");

  const qaExec = await request(`/api/tasks/${gatedId}/qa`, "POST", {
    command: "git status --short",
  });
  assert.equal(qaExec.status, 200);
  assert.equal(qaExec.body.qaResult.status, "passed");

  // Test In-Tab Workspace File Edit & Secret Protection
  const tempEditRel = "src/domain/.in-tab-edit-test.md";
  const tempEditAbs = path.join(root, tempEditRel);
  await writeFile(tempEditAbs, "# Initial\n", "utf8");
  try {
    const editFileRes = await request("/api/workspaces/workspace-test/file", "PUT", {
      path: tempEditRel,
      content: "# Agent Workbench\n\nUpdated via in-tab editor.\n",
    });
    assert.equal(editFileRes.status, 200, JSON.stringify(editFileRes.body));
    assert.equal(editFileRes.body.content.includes("Updated via in-tab editor."), true);
  } finally {
    await rm(tempEditAbs, { force: true });
  }

  const editSecretRes = await request("/api/workspaces/workspace-test/file", "PUT", {
    path: ".env",
    content: "SECRET=123",
  });
  assert.equal(editSecretRes.status, 400);

  // Test GitHub Issues/PRs CLI Status Endpoint
  const ghStatusRes = await request("/api/workspaces/workspace-test/github", "GET");
  assert.equal(ghStatusRes.status, 200);
  assert.equal(Array.isArray(ghStatusRes.body.issues), true);
  assert.equal(Array.isArray(ghStatusRes.body.prs), true);

  // Test Device Connect /api/ping and /api/connection-info + Android APK CORS
  const pingRes = await request("/api/ping", "GET");
  assert.equal(pingRes.status, 200);
  assert.equal(pingRes.body.ok, true);
  assert.equal(pingRes.body.app, "OpenSybau");

  const connInfoRes = await request("/api/connection-info", "GET");
  assert.equal(connInfoRes.status, 200);
  assert.equal(connInfoRes.body.ok, true);
  assert.equal(typeof connInfoRes.body.pairingUri, "string");
  assert.equal(connInfoRes.body.pairingUri.startsWith("opensybau://connect?"), true);
  assert.equal(connInfoRes.body.pairingUri.includes("pass=test-password"), true);
  assert.equal(typeof connInfoRes.body.qrSvg, "string");
  assert.equal(connInfoRes.body.qrSvg.startsWith("<svg"), true);
  assert.equal(typeof connInfoRes.body.launchers?.powershell, "string");

  const updatePassRes = await request("/api/connection-config", "POST", {
    password: "test-password",
  });
  assert.equal(updatePassRes.status, 200);
  assert.equal(updatePassRes.body.hasPassword, true);
  assert.equal(updatePassRes.body.accessPassword, "test-password");

  const apkCorsRes = await fetch(`${serverUrl}/api/ping`, {
    method: "GET",
    headers: {
      Authorization: "Basic " + Buffer.from("test:test-password").toString("base64"),
      Origin: "capacitor://localhost",
      "X-OpenSybau-Client": "android-apk",
    },
  });
  assert.equal(apkCorsRes.status, 200);
  assert.equal(apkCorsRes.headers.get("access-control-allow-origin"), "capacitor://localhost");
  assert.equal(apkCorsRes.headers.get("access-control-allow-private-network"), "true");

  const publicPingRes = await fetch(`${serverUrl}/api/ping`, {
    method: "GET",
    headers: {
      Origin: "https://appassets.androidplatform.net",
      "X-OpenSybau-Client": "android-apk",
    },
  });
  assert.equal(publicPingRes.status, 200, "Unauthenticated /api/ping must succeed for LAN Wi-Fi host discovery.");
  const publicPingBody = await publicPingRes.json();
  assert.equal(publicPingBody.app, "OpenSybau");
  assert.equal(typeof publicPingBody.hostname, "string");
  assert.equal(publicPingBody.authRequired, true);

  const pnaPreflightRes = await fetch(`${serverUrl}/api/connection-info`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://appassets.androidplatform.net",
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Private-Network": "true",
    },
  });
  assert.equal(pnaPreflightRes.status, 204, "Android WebView PNA preflight must return 204.");
  assert.equal(pnaPreflightRes.headers.get("access-control-allow-origin"), "https://appassets.androidplatform.net");
  assert.equal(pnaPreflightRes.headers.get("access-control-allow-private-network"), "true");

  // Test Wave DAG Decompose
  const waveRes = await request("/api/tasks/decompose", "POST", {
    workspaceId: "workspace-test",
    milestone: "Wave DAG Test",
    workflow: "plan-only",
    isolated: false,
    planProvider: "test-api",
    planModel: "test-model",
    planEffort: "standard",
    waves: [
      { index: 1, tasks: [{ title: "Wave 1 Spec", prompt: "Write base specification for Wave 1", riskLevel: "S" }] },
      { index: 2, tasks: [{ title: "Wave 2 Followup", prompt: "Build on Wave 1 specification", riskLevel: "M" }] },
    ],
  });
  assert.equal(waveRes.status, 201);
  assert.equal(waveRes.body.tasks.length, 2);
  assert.equal(waveRes.body.tasks[1].dependsOn.includes(waveRes.body.tasks[0].id), true);
  await waitForTask(waveRes.body.tasks[0].id);
  await waitForTask(waveRes.body.tasks[1].id);

  // Test API Provider Multi-Turn Workspace Tool Loop in spawnStage
  const toolLoopTaskRes = await request("/api/tasks", "POST", {
    workspaceId: "workspace-test",
    title: "API Tool Loop Task",
    prompt: "[TOOL_LOOP_TEST] Inspect package.json before writing the plan",
    workflow: "plan-only",
    planProvider: "test-api",
    planModel: "test-model",
    planEffort: "standard",
  });
  assert.equal(toolLoopTaskRes.status, 201);
  const completedToolLoopTask = await waitForTask(toolLoopTaskRes.body.task.id);
  assert.equal(completedToolLoopTask.plan, "Plan after reading package.json: opensybau");
  assert.equal(completedToolLoopTask.events.some((e) => e.text.includes("Tool call (read_file)")), true, "Task events must record the workspace read_file tool call.");
  assert.equal((completedToolLoopTask.usage?.["test-api"]?.cached_input_tokens || 0) >= 64, true, "Cached input tokens must be tracked in usage.");

  // Test Self-Improving Skill Distillation (POST /api/tasks/:id/distill-skill)
  const distillSkillRes = await request(`/api/tasks/${gatedId}/distill-skill`, "POST", {
    name: "Gate Pipeline Skill",
  });
  assert.equal(distillSkillRes.status, 201, JSON.stringify(distillSkillRes.body));
  assert.equal(distillSkillRes.body.ok, true);
  assert.equal(distillSkillRes.body.skill.name, "Gate Pipeline Skill");
  const skillsListAfterDistill = await request("/api/skills?refresh=1", "GET");
  assert.equal(skillsListAfterDistill.status, 200);
  assert.equal(skillsListAfterDistill.body.skills.some((s) => s.name === "Gate Pipeline Skill"), true, "Distilled skill must appear in skill catalog.");

  // Test Workspace Skill Trust Gating (POST /api/workspaces/:id/trust-skills)
  const untrustRes = await request("/api/workspaces/workspace-test/trust-skills", "POST", { trusted: false });
  assert.equal(untrustRes.status, 200);
  assert.equal(untrustRes.body.workspace.trustedSkills, false);
  const retrustRes = await request("/api/workspaces/workspace-test/trust-skills", "POST", { trusted: true });
  assert.equal(retrustRes.status, 200);
  assert.equal(retrustRes.body.workspace.trustedSkills, true);

  // Test 2-Tier Memory (user-profile + USER.md & MEMORY.md Markdown sync)
  const userMemRes = await request("/api/memory", "POST", {
    title: "Preferred Test Runner",
    content: "Always run npm test and verify exit code 0 before finishing.",
    kind: "user-profile",
  });
  assert.equal(userMemRes.status, 201);
  assert.equal(userMemRes.body.memory.kind, "user-profile");
  assert.equal(userMemRes.body.memory.category, "user");
  const mdMemRes = await request("/api/memory/markdown", "GET");
  assert.equal(mdMemRes.status, 200);
  assert.equal(mdMemRes.body.userMarkdown.includes("Preferred Test Runner"), true);
  assert.equal(mdMemRes.body.workspaceMarkdown.includes(gatedId), true);

  // Test Rolling Context Compaction Endpoint (POST /api/tasks/:id/compact)
  const compactRes = await request("/api/tasks/task-feature-test/compact", "POST", {
    keepRecentMessages: 2,
  });
  assert.equal(compactRes.status, 200);
  assert.equal(compactRes.body.compacted, true);
  assert.equal(compactRes.body.compactedCount, 2);
  assert.equal(compactRes.body.keptCount, 2);
  assert.equal(compactRes.body.task.chatCompactedSummary.includes("Start the first branch"), true);

  // Test Per-Task Atomic Detail Store & Cross-Session SQLite FTS5 Search (GET /api/search)
  const gatedDetailRaw = JSON.parse(await readFile(path.join(dataDir, "tasks", gatedId, "detail.json"), "utf8"));
  assert.equal(gatedDetailRaw.id, gatedId);
  assert.equal(gatedDetailRaw.distilledSkillName, "Gate Pipeline Skill");

  const searchRes = await request("/api/search?q=Gate%20Pipeline", "GET");
  assert.equal(searchRes.status, 200);
  assert.equal(searchRes.body.engine, "sqlite-fts5");
  assert.equal(searchRes.body.results.some((r) => r.type === "skill" && r.title.includes("Gate Pipeline Skill")), true, "FTS5 search must find distilled skill.");

  const searchTaskRes = await request("/api/search?q=package.json%20opensybau", "GET");
  assert.equal(searchTaskRes.status, 200);
  assert.equal(searchTaskRes.body.results.some((r) => r.id === completedToolLoopTask.id), true, "FTS5 search must find task by plan output.");

  // Test Scheduled Worktree Tasks (POST /api/schedules, trigger, DELETE)
  const createSchedRes = await request("/api/schedules", "POST", {
    name: "Nightly Architecture Audit",
    workspaceId: "workspace-test",
    prompt: "Audit module boundaries and report findings",
    workflow: "plan-only",
    intervalMinutes: 60,
    isolated: false,
    planProvider: "test-api",
    planModel: "test-model",
    planEffort: "standard",
  });
  assert.equal(createSchedRes.status, 201, JSON.stringify(createSchedRes.body));
  const scheduleId = createSchedRes.body.schedule.id;

  const triggerSchedRes = await request(`/api/schedules/${scheduleId}/trigger`, "POST", {});
  assert.equal(triggerSchedRes.status, 201, JSON.stringify(triggerSchedRes.body));
  assert.equal(triggerSchedRes.body.task.scheduleId, scheduleId);
  assert.equal(triggerSchedRes.body.task.code, "CRON-01");
  await waitForTask(triggerSchedRes.body.task.id);

  const listSchedRes = await request("/api/schedules", "GET");
  assert.equal(listSchedRes.status, 200);
  assert.equal(listSchedRes.body.schedules.find((s) => s.id === scheduleId)?.runCount, 1);

  const delSchedRes = await request(`/api/schedules/${scheduleId}`, "DELETE");
  assert.equal(delSchedRes.status, 200);

  const persisted = JSON.parse(await readFile(path.join(dataDir, "state.json"), "utf8"));
  const persistedMemories = JSON.parse(await readFile(path.join(dataDir, "memory.json"), "utf8"));
  const dag = computeWaveDag(persisted.tasks);
  assert.equal(dag.waves.length >= 2, true, "Wave DAG must compute at least 2 waves.");
  assert.equal(Array.isArray(dag.waves[0].tasks) && dag.waves[0].tasks.length >= 1, true);
  assert.equal(dag.waves[0].label, "Đợt 1");
  assert.equal(dag.edges.length >= 1, true, "Wave DAG must include dependency edges.");
  assert.equal(Array.isArray(dag.needsLookTasks), true);
  assert.equal(persisted.tasks.length, 11);
  assert.equal(persistedMemories.some((m) => m.sourceTaskId === gatedId), true, "Completed pipeline task must auto-distill a lesson memory.");
  assert.equal(persisted.tasks.some((task) => task.forkedFromMessageId === userTwo.id), true);
  assert.equal(persisted.tasks.find((task) => task.id === createdTask.id).presetRef.version, 2);
  assert.equal(persisted.settings.taskPresets[0].versions.length, 2);
  process.stdout.write("Task feature integration checks passed: goal/checklist, permissions, archived chat deletion, forks, stage reruns with history, versioned task presets, telemetry, file-index, diff studio parser, parallel arena fanout, Plan Gate, Multi-Round Cycles, QA Runner, Wave DAG, 2-tier BM25 + USER.md/MEMORY.md memory distillation, progressive skill disclosure & distillation, workspace skill trust, rolling context compaction, API multi-turn tool loop & patch edits, per-task detail store, SQLite FTS5 cross-session search, scheduled tasks, and persistence.\n");
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
