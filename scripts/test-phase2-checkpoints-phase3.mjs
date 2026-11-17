import assert from "node:assert/strict";
import { execFile, execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { AcpClient } from "../src/server/acp-client.mjs";
import { createLocalMcpClient } from "../src/server/mcp-client.mjs";
import { createOpenSybauMcpServer, OPENSYBAU_MCP_TOOLS } from "../src/server/mcp-server.mjs";
import { createOtelTelemetryCollector } from "../src/server/otel-receiver.mjs";
import { createShadowCheckpoint, getShadowCheckpointDiff, rewindToShadowCheckpoint } from "../src/server/shadow-checkpoints.mjs";
import { createTaskRunnerService } from "../src/server/task-runner.mjs";
import { createWorktreePoolManager, parseSafeWorktreeHookSpec } from "../src/server/worktree-pool.mjs";

const execFileAsync = promisify(execFile);

const parent = resolve(".runtime");
await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(join(parent, "phase2-3-"));
const shadowRepoDir = join(root, "shadow-repo");
const taskStorageDir = join(root, "task-storage");
const conflictRepoDir = join(root, "conflict-repo");
const worktreesBaseDir = join(root, "worktrees");
const mcpWsDir = join(root, "mcp-ws");
await fs.mkdir(shadowRepoDir, { recursive: true });
await fs.mkdir(taskStorageDir, { recursive: true });
await fs.mkdir(conflictRepoDir, { recursive: true });
await fs.mkdir(worktreesBaseDir, { recursive: true });
await fs.mkdir(mcpWsDir, { recursive: true });

async function git(cwd, args, options = {}) {
  const exe = process.platform === "win32" ? "git.exe" : "git";
  try {
    const res = await execFileAsync(exe, ["-c", "core.quotepath=false", ...args], {
      cwd,
      env: options.env || process.env,
      timeout: options.timeoutMs || 20_000,
      maxBuffer: options.maxBuffer || 5_000_000,
      windowsHide: true,
    });
    return { code: 0, stdout: String(res.stdout || ""), stderr: String(res.stderr || "") };
  } catch (err) {
    return {
      code: typeof err?.code === "number" ? err.code : 1,
      stdout: String(err?.stdout || ""),
      stderr: String(err?.stderr || err?.message || ""),
    };
  }
}

async function runProcess(exe, args, options = {}) {
  try {
    const res = await execFileAsync(exe, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      timeout: options.timeout || 20_000,
      maxBuffer: options.maxBuffer || 500_000,
      windowsHide: true,
    });
    return { code: 0, stdout: String(res.stdout || ""), stderr: String(res.stderr || "") };
  } catch (err) {
    return {
      code: typeof err?.code === "number" ? err.code : 1,
      stdout: String(err?.stdout || ""),
      stderr: String(err?.stderr || err?.message || ""),
    };
  }
}

function initGitRepo(dir, files) {
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: dir, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["config", "user.email", "test@opensybau.local"], { cwd: dir, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["config", "user.name", "OpenSybau Test"], { cwd: dir, stdio: "ignore", windowsHide: true });
  for (const [name, content] of Object.entries(files)) {
    execFileSync(process.execPath, ["-e", `require('fs').writeFileSync(${JSON.stringify(join(dir, name))}, ${JSON.stringify(content)})`], { windowsHide: true });
  }
  execFileSync("git", ["add", "."], { cwd: dir, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: dir, stdio: "ignore", windowsHide: true });
}

try {
  // 1. Bare Shadow Git Checkpoints & Rewind (without mutating repo .git/HEAD)
  initGitRepo(shadowRepoDir, { "app.js": "export const v = 1;\n" });
  const initialHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: shadowRepoDir, windowsHide: true }).toString("utf8").trim();

  const cpTask = {
    id: "cp-task-1",
    storagePath: taskStorageDir,
    checkpoints: [],
    chatMessages: [
      { id: "msg-u1", role: "user", content: "Turn 1" },
      { id: "msg-1", role: "assistant", content: "Turn 1 done" },
      { id: "msg-u2", role: "user", content: "Turn 2" },
      { id: "msg-2", role: "assistant", content: "Turn 2 done" },
    ],
  };

  const cp1 = await createShadowCheckpoint(cpTask, shadowRepoDir, { label: "Turn 1 snapshot", stage: "chat", messageId: "msg-1" }, { git });
  assert.ok(cp1?.id && cp1.commit);
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: shadowRepoDir, windowsHide: true }).toString("utf8").trim(), initialHead);

  await fs.writeFile(join(shadowRepoDir, "app.js"), "export const v = 2;\n");
  await fs.writeFile(join(shadowRepoDir, "temp-added.js"), "export const extra = true;\n");
  const cp2 = await createShadowCheckpoint(cpTask, shadowRepoDir, { label: "Turn 2 snapshot", stage: "build", messageId: "msg-2" }, { git });
  assert.ok(cp2?.files.includes("app.js") && cp2.files.includes("temp-added.js"));

  const commitDiff = await getShadowCheckpointDiff(cpTask, shadowRepoDir, cp2.id, { git });
  assert.match(commitDiff.diff, /temp-added\.js/);
  assert.match(commitDiff.diff, /export const v = 2;/);

  await fs.writeFile(join(shadowRepoDir, "later-file.js"), "export const later = 3;\n");
  await fs.writeFile(join(shadowRepoDir, "app.js"), "export const v = 3;\n");
  const liveDiff = await getShadowCheckpointDiff(cpTask, shadowRepoDir, cp1.id, { vsWorkingTree: true, git });
  assert.match(liveDiff.diff, /later-file\.js/);
  assert.match(liveDiff.diff, /export const v = 3;/);

  const rewindRes = await rewindToShadowCheckpoint(cpTask, shadowRepoDir, cp1.id, { mode: "files-and-chat", git });
  assert.equal(await fs.readFile(join(shadowRepoDir, "app.js"), "utf8"), "export const v = 1;\n");
  await assert.rejects(fs.access(join(shadowRepoDir, "temp-added.js")));
  await assert.rejects(fs.access(join(shadowRepoDir, "later-file.js")));
  assert.equal(rewindRes.removedFiles.length, 2);
  assert.equal(cpTask.chatMessages.length, 1, "files-and-chat rewind must truncate turns at checkpoint messageId");
  assert.equal(execFileSync("git", ["rev-parse", "HEAD"], { cwd: shadowRepoDir, windowsHide: true }).toString("utf8").trim(), initialHead);

  // 2. Real Git Worktree Merge Conflict & theirs / ours Resolution
  initGitRepo(conflictRepoDir, { "shared.txt": "LINE1\nLINE2\nLINE3\n" });
  const baseHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: conflictRepoDir, windowsHide: true }).toString("utf8").trim();
  const wt1 = join(worktreesBaseDir, "wt-theirs");
  const wt2 = join(worktreesBaseDir, "wt-ours");
  execFileSync("git", ["worktree", "add", "-b", "wt/theirs", wt1, baseHead], { cwd: conflictRepoDir, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["worktree", "add", "-b", "wt/ours", wt2, baseHead], { cwd: conflictRepoDir, stdio: "ignore", windowsHide: true });

  await fs.writeFile(join(wt1, "shared.txt"), "WORKTREE_THEIRS_1\nLINE2\nLINE3\n");
  await fs.writeFile(join(wt2, "shared.txt"), "WORKTREE_OURS_1\nLINE2\nLINE3\n");
  // Diverge main branch on same line
  await fs.writeFile(join(conflictRepoDir, "shared.txt"), "MAIN_BRANCH_EDIT\nLINE2\nLINE3\n");
  execFileSync("git", ["add", "shared.txt"], { cwd: conflictRepoDir, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["commit", "-m", "main diverge"], { cwd: conflictRepoDir, stdio: "ignore", windowsHide: true });

  const conflictTask1 = {
    id: "wt-task-1",
    workspaceId: "ws-conflict",
    workspacePath: conflictRepoDir,
    storagePath: join(root, "wt-task-1"),
    worktreePath: wt1,
    worktreeBranch: "wt/theirs",
    worktreeBaseCommit: baseHead,
    isolated: true,
    status: "done",
    artifacts: ["shared.txt"],
    events: [],
  };
  const conflictTask2 = {
    id: "wt-task-2",
    workspaceId: "ws-conflict",
    workspacePath: conflictRepoDir,
    storagePath: join(root, "wt-task-2"),
    worktreePath: wt2,
    worktreeBranch: "wt/ours",
    worktreeBaseCommit: baseHead,
    isolated: true,
    status: "done",
    artifacts: ["shared.txt"],
    events: [],
  };
  const state = {
    settings: { maxConcurrent: 2 },
    workspaces: [{ id: "ws-conflict", name: "ConflictRepo", path: conflictRepoDir }],
    tasks: [conflictTask1, conflictTask2],
  };

  const taskRunner = createTaskRunnerService({
    taskDir: root,
    worktreeDir: worktreesBaseDir,
    getState: () => state,
    running: new Map(),
    busyWorkspaces: new Set(),
    isolatedWorkspaces: new Set(),
    isShuttingDown: () => false,
    persist: () => {},
    publish: () => {},
    record: (t, msg) => t.events.push({ msg }),
    safeError: (e) => String(e?.message || e),
    git,
    withGitRepoLock: async (_key, fn) => fn(),
    inspectWorkspace: async (p) => ({ isGit: true, gitRoot: p }),
    relevantMemory: () => [],
    autoDistillTaskMemory: () => {},
    skillCatalogService: {
      loadSkillCatalog: async () => [],
      resolveSelectedSkills: () => [],
      selectTaskSkillsProgressive: () => [],
      stageAntigravitySkillBundles: async () => [],
      stageAntigravitySkills: async () => {},
    },
    promptService: { makePrompt: () => "", makeChatPrompt: () => "", makeInitialChatPrompt: () => "" },
    stageRunner: { assertTaskActive: () => {}, areTaskDependenciesMet: () => true, runTaskQaCheck: async () => ({}), spawnStage: async () => "" },
  });

  await assert.rejects(
    taskRunner.applyTaskWorktree(conflictTask1),
    /xung đột Git/i,
  );
  assert.ok(conflictTask1.mergeConflict?.files?.includes("shared.txt"), "Conflict file list must include shared.txt");

  await taskRunner.applyTaskWorktree(conflictTask1, { strategy: "theirs" });
  assert.equal(conflictTask1.mergeConflict, null);
  assert.equal(await fs.readFile(join(conflictRepoDir, "shared.txt"), "utf8"), "WORKTREE_THEIRS_1\nLINE2\nLINE3\n");

  // Commit first resolved merge to main, then hit conflict on task 2 and keep main ("ours")
  execFileSync("git", ["add", "shared.txt"], { cwd: conflictRepoDir, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["commit", "-m", "apply theirs"], { cwd: conflictRepoDir, stdio: "ignore", windowsHide: true });
  await assert.rejects(taskRunner.applyTaskWorktree(conflictTask2), /xung đột Git/i);
  assert.ok(conflictTask2.mergeConflict?.files?.includes("shared.txt"));
  await taskRunner.applyTaskWorktree(conflictTask2, { strategy: "ours" });
  assert.equal(conflictTask2.mergeConflict, null);
  assert.equal(await fs.readFile(join(conflictRepoDir, "shared.txt"), "utf8"), "WORKTREE_THEIRS_1\nLINE2\nLINE3\n");

  // 3. Worktree Pool: Port Allocator + Safe Worktree Hook Parser & Runner
  const pool = createWorktreePoolManager({ worktreeDir: worktreesBaseDir, git, run: runProcess });
  const p1 = await pool.allocateWorktreePort();
  const p2 = await pool.allocateWorktreePort();
  assert.ok(p1 >= 42100 && p1 <= 42999);
  assert.ok(p2 >= 42100 && p2 <= 42999 && p2 !== p1);
  pool.releaseWorktreePort(p1);
  pool.releaseWorktreePort(p2);

  assert.deepEqual(parseSafeWorktreeHookSpec(["node", "-v"]), { exe: "node", args: ["-v"] });
  assert.deepEqual(parseSafeWorktreeHookSpec("npm test"), { exe: "npm", args: ["test"] });
  assert.equal(parseSafeWorktreeHookSpec("cmd.exe /c whoami"), null);
  assert.equal(parseSafeWorktreeHookSpec("bash -c id"), null);
  assert.equal(parseSafeWorktreeHookSpec("npm test && calc"), null);
  assert.equal(parseSafeWorktreeHookSpec("node -v; id"), null);
  assert.equal(parseSafeWorktreeHookSpec(["powershell.exe", "-Command", "ls"]), null);

  await fs.mkdir(join(mcpWsDir, ".opensybau"), { recursive: true });
  await fs.writeFile(
    join(mcpWsDir, ".opensybau", "worktree.json"),
    JSON.stringify({ setup: ["node", "-e", "process.stdout.write('PORT=' + (process.env.OPENSYBAU_PORT || ''))"] }),
  );
  const hookTask = { id: "hook-task" };
  const untrustedHook = await pool.runWorktreeHook(hookTask, mcpWsDir, "setup", { trusted: false });
  assert.equal(untrustedHook.ran, false);
  const trustedHook = await pool.runWorktreeHook(hookTask, mcpWsDir, "setup", { trusted: true });
  assert.equal(trustedHook.ran, true);
  assert.equal(trustedHook.code, 0);
  assert.ok(hookTask.worktreePort >= 42100);
  assert.equal(trustedHook.stdout, `PORT=${hookTask.worktreePort}`);
  pool.releaseWorktreePort(hookTask.worktreePort);

  // 4. ACP Client Stdio JSON-RPC (initialize -> session/new -> request_permission -> notification -> session/prompt)
  const mockAcpPath = join(root, "mock-acp.mjs");
  await fs.writeFile(mockAcpPath, `
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
let pendingPromptId = null;
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: 1, serverInfo: { name: "mock-acp" } } }) + "\\n");
  } else if (msg.method === "session/new") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { sessionId: "acp-sess-1" } }) + "\\n");
  } else if (msg.method === "session/prompt") {
    pendingPromptId = msg.id;
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 901, method: "session/request_permission", params: { toolCall: { title: "Read app.js" } } }) + "\\n");
  } else if (msg.id === 901 && pendingPromptId !== null) {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { text: "Progress 100%" } }) + "\\n");
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: pendingPromptId, result: { stopReason: "end_turn", decision: msg.result } }) + "\\n");
    pendingPromptId = null;
  }
});
`);

  const acpNotifications = [];
  let approvalSeen = false;
  const acpClient = new AcpClient({
    exe: process.execPath,
    args: [mockAcpPath],
    cwd: root,
    onNotification: (n) => acpNotifications.push(n),
    onApproval: async (params) => {
      approvalSeen = params?.toolCall?.title === "Read app.js";
      return { outcome: { outcome: "selected", optionId: "allow_once" } };
    },
  });
  const acpRes = await acpClient.runPromptSession({ cwd: root, prompt: "Inspect app.js" });
  await acpClient.close();
  assert.equal(approvalSeen, true, "ACP permission callback must fire");
  assert.equal(acpRes.stopReason, "end_turn");
  assert.ok(acpNotifications.some((n) => n.method === "session/update"));

  // 5. OpenSybau MCP Server + Local MCP Client
  const mcpServer = createOpenSybauMcpServer({
    getState: () => state,
    getQuotas: async () => ({ codex: { ready: true } }),
    getTaskDiff: async (t) => `diff --git a/${t.artifacts?.[0] || "x"} b/x`,
    searchWorkbench: async ({ query }) => ({ results: [{ title: "Hit", query }] }),
  });
  const mcpInit = await mcpServer.handleJsonRpcMessage({ jsonrpc: "2.0", id: 1, method: "initialize" });
  assert.equal(mcpInit.result.serverInfo.name, "opensybau-mcp");
  const mcpTools = await mcpServer.handleJsonRpcMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(mcpTools.result.tools.length, OPENSYBAU_MCP_TOOLS.length);
  const wsCall = await mcpServer.handleJsonRpcMessage({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "list_workspaces", arguments: {} } });
  assert.match(wsCall.result.content[0].text, /ConflictRepo/);
  const diffCall = await mcpServer.handleJsonRpcMessage({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "get_task_diff", arguments: { taskId: conflictTask1.id } } });
  assert.match(diffCall.result.content[0].text, /shared\.txt/);

  // Local MCP Client stdio discovery & trust gate
  const mockMcpPath = join(mcpWsDir, "mock-mcp.mjs");
  await fs.writeFile(mockMcpPath, `
import readline from "node:readline";
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} } } }) + "\\n");
  } else if (msg.method === "tools/list") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "echo_tool", description: "Echo input text", inputSchema: { type: "object", properties: { text: { type: "string" } } } }] } }) + "\\n");
  } else if (msg.method === "tools/call") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { content: [{ type: "text", text: "Echo: " + (msg.params?.arguments?.text || "") }] } }) + "\\n");
  }
});
`);
  await fs.writeFile(join(mcpWsDir, ".mcp.json"), JSON.stringify({
    mcpServers: { mock: { command: process.execPath, args: [mockMcpPath] } },
  }));

  const untrustedMcp = createLocalMcpClient({ isWorkspaceTrusted: () => false });
  assert.deepEqual(await untrustedMcp.listToolsForWorkspace(mcpWsDir), [], "Untrusted workspace must not spawn .mcp.json servers");

  const trustedMcp = createLocalMcpClient({ isWorkspaceTrusted: () => true });
  const discovered = await trustedMcp.listToolsForWorkspace(mcpWsDir);
  assert.ok(discovered.some((t) => t.name === "mcp:mock:echo_tool"));
  const echoed = await trustedMcp.callTool(mcpWsDir, "mcp:mock:echo_tool", { text: "HelloMCP" });
  assert.equal(echoed.ok, true);
  assert.equal(echoed.output, "Echo: HelloMCP");

  // 6. OpenTelemetry GenAI Collector
  const otel = createOtelTelemetryCollector();
  const otelTask = { id: "otel-t1", telemetrySpans: [] };
  const span1 = otel.recordGenAiSpan(otelTask, {
    stage: "build",
    provider: "anthropic",
    model: "claude-sonnet",
    usage: { input_tokens: 100, output_tokens: 40, cached_input_tokens: 25 },
    durationMs: 120,
  });
  assert.equal(span1.attributes["gen_ai.system"], "anthropic");
  assert.equal(span1.attributes["gen_ai.usage.cached_tokens"], 25);
  assert.equal(otel.listSpans(otelTask).length, 1);

  const ingestRes = otel.ingestOtlpPayload({
    resourceSpans: [{
      scopeSpans: [{
        spans: [{
          traceId: "t1",
          spanId: "s2",
          name: "gen_ai.review",
          startTimeUnixNano: String(Date.now() * 1_000_000),
          endTimeUnixNano: String((Date.now() + 80) * 1_000_000),
          attributes: [{ key: "opensybau.task_id", value: { stringValue: "otel-t1" } }],
        }],
      }],
    }],
  }, new Map([["otel-t1", otelTask]]));
  assert.equal(ingestRes.accepted, 1);
  assert.equal(otelTask.telemetrySpans.length, 2);

  console.log("test-phase2-checkpoints-phase3: PASS");
} finally {
  // Prune any temporary git worktree registrations before deleting temp dir on Windows
  await git(conflictRepoDir, ["worktree", "prune"]).catch(() => {});
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
}
