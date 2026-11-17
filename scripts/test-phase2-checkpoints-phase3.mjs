import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { execFile, execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { AcpClient } from "../src/server/acp-client.mjs";
import { resolveAntigravityExecutionPolicy } from "../src/server/antigravity-cli.mjs";
import { createCliDiscoveryService } from "../src/server/cli-discovery.mjs";
import { createLocalMcpClient } from "../src/server/mcp-client.mjs";
import { createOpenSybauMcpServer, OPENSYBAU_MCP_TOOLS } from "../src/server/mcp-server.mjs";
import { createOtelTelemetryCollector } from "../src/server/otel-receiver.mjs";
import { probeAntigravityQuota } from "../src/server/provider-quotas.mjs";
import { createShadowCheckpoint, getShadowCheckpointDiff, rewindToShadowCheckpoint } from "../src/server/shadow-checkpoints.mjs";
import { createTaskRunnerService } from "../src/server/task-runner.mjs";
import { createTaskStageRunner } from "../src/server/task-stage-runner.mjs";
import { normalizeScheduleProfile } from "../src/server/task-store.mjs";
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

  // 7. Antigravity Terms Section 6 Guardrails & Consumer OAuth Risk Mitigation
  const prevGeminiKey = process.env.GEMINI_API_KEY;
  const prevGoogleKey = process.env.GOOGLE_API_KEY;
  const prevCooldown = process.env.OPENSYBAU_AGY_COOLDOWN_MS;
  try {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    process.env.OPENSYBAU_AGY_COOLDOWN_MS = "40";

    const oauthPolicy = resolveAntigravityExecutionPolicy({}, []);
    assert.equal(oauthPolicy.allowed, true);
    assert.equal(oauthPolicy.authMode, "consumer-oauth");
    assert.deepEqual(oauthPolicy.extraArgs, []);
    assert.deepEqual(oauthPolicy.extraEnv, {});

    const envKeyPolicy = resolveAntigravityExecutionPolicy({ GEMINI_API_KEY: "AIza-env-123" }, []);
    assert.equal(envKeyPolicy.allowed, true);
    assert.equal(envKeyPolicy.authMode, "gemini-api-key");
    assert.deepEqual(envKeyPolicy.extraArgs, ["--settings", '{"modelProvider":"gemini"}']);
    assert.deepEqual(envKeyPolicy.extraEnv, { GEMINI_API_KEY: "AIza-env-123" });

    const runtimeKeyPolicy = resolveAntigravityExecutionPolicy({}, [{ protocol: "gemini", apiKey: "AIza-runtime-456" }]);
    assert.equal(runtimeKeyPolicy.authMode, "gemini-api-key");
    assert.equal(runtimeKeyPolicy.extraEnv.GEMINI_API_KEY, "AIza-runtime-456");

    const quotasSrc = await fs.readFile(resolve("src/server/provider-quotas.mjs"), "utf8");
    assert.equal(quotasSrc.includes("queryStandaloneAntigravityLs"), false, "Standalone IDE-impersonating LS spawn must stay removed");
    assert.equal(quotasSrc.includes("--override_ide_name"), false, "Must not pass --override_ide_name");
    assert.equal(quotasSrc.includes("GetUserStatus"), true, "Passive IDE quota inspection stays preserved");
    const apiQuota = await probeAntigravityQuota({ installed: true, authenticated: true, authMode: "gemini-api-key" });
    assert.equal(apiQuota.status, "api-key");

    // Cache agy models probe across 60s refreshes until expire/force
    const discoveryDir = join(root, "discovery");
    await fs.mkdir(discoveryDir, { recursive: true });
    let agyModelsCalls = 0;
    const discovery = createCliDiscoveryService({
      cliPathsFile: join(discoveryDir, "cli-paths.json"),
      providerConfigFile: join(discoveryDir, "providers.json"),
      providerSecretsFile: join(discoveryDir, "secrets.json"),
      getWorkspaces: () => [],
      loadJson: () => ({}),
      persistJsonFile: () => {},
      run: async (_exe, args) => {
        if (args[0] === "--version") return { code: 0, stdout: "agy 1.5.10", stderr: "" };
        if (args[0] !== "debug" && args.at(-1) === "models") {
          agyModelsCalls += 1;
          return { code: 0, stdout: "gemini-2.5-pro Gemini 2.5 Pro\n", stderr: "" };
        }
        return { code: 1, stdout: "", stderr: "" };
      },
      git: async () => ({ code: 0, stdout: "", stderr: "" }),
      safeError: (e) => String(e?.message || e),
    });
    discovery.setAgyExe(process.execPath);
    const firstConnectors = await discovery.loadModels(true);
    assert.equal(firstConnectors.antigravity.authMode, "consumer-oauth");
    const callsAfterForce = agyModelsCalls;
    await discovery.loadModels(false);
    assert.equal(agyModelsCalls, callsAfterForce, "Short reload should use cached models");
    discovery.expireModelCache();
    await discovery.loadModels(false);
    assert.equal(agyModelsCalls, callsAfterForce + 1, "expireModelCache must refresh agy probe cache");

    // Serialize concurrent consumer-oauth spawns while allowing concurrent gemini-api-key spawns
    let activeSpawnCount = 0;
    let maxActiveSpawnCount = 0;
    const invocations = [];
    const currentRuntimes = [];
    const stageState = { workspaces: [{ id: "ws-agy", path: mcpWsDir }], tasks: [] };
    const agyRunning = new Map();
    const mkTask = (id) => ({
      id,
      workspaceId: "ws-agy",
      storagePath: taskStorageDir,
      permissionPreset: "workspace-write",
      status: "running",
      events: [],
      config: { workflow: "chat-only", chatProvider: "antigravity" },
    });
    const agyStageRunner = createTaskStageRunner({
      getState: () => stageState,
      running: agyRunning,
      isShuttingDown: () => false,
      record: (t, msg, kind) => t.events.push({ msg, kind }),
      schedulePersist: () => {},
      schedulePublish: () => {},
      run: async () => ({ code: 0, stdout: "", stderr: "" }),
      killTree: () => {},
      loadModels: async () => ({
        antigravity: {
          installed: true,
          available: true,
          authMode: currentRuntimes.length ? "gemini-api-key" : "consumer-oauth",
          capabilities: { chat: true, plan: true, build: true, review: true },
          models: [{ id: "gemini-2.5-pro", efforts: ["medium"] }],
        },
      }),
      getCliExecutables: () => ({ codexExe: "codex", agyExe: "agy", claudeCommand: { executable: "", prefixArgs: [] }, claudeExe: "" }),
      getApiProviderRuntime: () => null,
      getApiProviderRuntimes: () => currentRuntimes,
      additionalWritableProjectDirs: () => [],
      externalWorkspaceContext: () => "",
      spawnProcess: (_exe, args, opts) => {
        activeSpawnCount += 1;
        maxActiveSpawnCount = Math.max(maxActiveSpawnCount, activeSpawnCount);
        const startedAt = Date.now();
        const child = new EventEmitter();
        child.stdin = new PassThrough();
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.stdout.setEncoding("utf8");
        child.stderr.setEncoding("utf8");
        setTimeout(() => {
          child.stdout.write(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "OK" }] } }) + "\n");
          child.stdout.end();
          child.stderr.end();
          activeSpawnCount -= 1;
          invocations.push({ args, env: opts.env, startedAt, endedAt: Date.now() });
          child.emit("close", 0);
        }, 25);
        return child;
      },
    });
    const t1 = mkTask("agy-oauth-1");
    const t2 = mkTask("agy-oauth-2");
    stageState.tasks.push(t1, t2);
    agyRunning.set(t1.id, { cancelRequested: false });
    agyRunning.set(t2.id, { cancelRequested: false });
    const [o1, o2] = await Promise.all([
      agyStageRunner.spawnStage(t1, "antigravity", "chat-initial", mcpWsDir, "Hello 1", { provider: "antigravity", model: "gemini-2.5-pro", effort: "medium" }),
      agyStageRunner.spawnStage(t2, "antigravity", "chat-initial", mcpWsDir, "Hello 2", { provider: "antigravity", model: "gemini-2.5-pro", effort: "medium" }),
    ]);
    assert.equal(o1, "OK");
    assert.equal(o2, "OK");
    assert.equal(maxActiveSpawnCount, 1, "Consumer OAuth agy spawns must serialize strictly (max 1 concurrent)");
    assert.ok(invocations[1].startedAt - invocations[0].endedAt >= 30, "Cooldown gap must apply between OAuth agy spawns");
    assert.equal(invocations[0].args.includes("--settings"), false, "Consumer OAuth must not inject Gemini API --settings");
    assert.equal(invocations[0].env.GEMINI_API_KEY, undefined);
    assert.ok(t1.events.some((e) => e.kind === "warning" && e.msg.includes("OAuth")));

    // Switch to Gemini API Key runtime -> parallel execution allowed + --settings & GEMINI_API_KEY passed
    currentRuntimes.push({ protocol: "gemini", apiKey: "AIza-runtime-789" });
    activeSpawnCount = 0;
    maxActiveSpawnCount = 0;
    invocations.length = 0;
    const k1 = mkTask("agy-key-1");
    const k2 = mkTask("agy-key-2");
    stageState.tasks.push(k1, k2);
    agyRunning.set(k1.id, { cancelRequested: false });
    agyRunning.set(k2.id, { cancelRequested: false });
    await Promise.all([
      agyStageRunner.spawnStage(k1, "antigravity", "chat-initial", mcpWsDir, "Key 1", { provider: "antigravity", model: "gemini-2.5-pro", effort: "medium" }),
      agyStageRunner.spawnStage(k2, "antigravity", "chat-initial", mcpWsDir, "Key 2", { provider: "antigravity", model: "gemini-2.5-pro", effort: "medium" }),
    ]);
    assert.equal(maxActiveSpawnCount, 2, "Gemini API key mode should run concurrently without OAuth serialization");
    assert.equal(invocations[0].args[0], "--settings");
    assert.equal(invocations[0].args[1], '{"modelProvider":"gemini"}');
    assert.equal(invocations[0].env.GEMINI_API_KEY, "AIza-runtime-789");

    // TaskRunner caps auto-fix loops to 1 round when Antigravity OAuth is active
    let buildCalls = 0;
    const capState = { workspaces: [{ id: "ws-cap", path: shadowRepoDir }], tasks: [], settings: {} };
    const capTask = {
      id: "agy-cap-task",
      title: "Check loop cap",
      prompt: "Run one round only under consumer OAuth",
      workspaceId: "ws-cap",
      workspacePath: shadowRepoDir,
      executionPath: shadowRepoDir,
      storagePath: join(taskStorageDir, "agy-cap-task"),
      isolated: false,
      status: "queued",
      maxRounds: 3,
      currentRound: 1,
      permissionPreset: "workspace-write",
      config: {
        workflow: "codex-antigravity",
        roles: {
          plan: { provider: "codex", model: "gpt-5.4", effort: "medium" },
          build: { provider: "antigravity", model: "gemini-2.5-pro", effort: "medium" },
          review: { provider: "codex", model: "gpt-5.4", effort: "medium" },
        },
      },
      events: [],
      stageMetrics: [],
      chatMessages: [],
      chatQueue: [],
    };
    await fs.mkdir(capTask.storagePath, { recursive: true });
    capState.tasks.push(capTask);
    const capRunning = new Map([[capTask.id, { cancelRequested: false }]]);
    const capRunner = createTaskRunnerService({
      taskDir: taskStorageDir,
      worktreeDir: worktreesBaseDir,
      getState: () => capState,
      running: capRunning,
      busyWorkspaces: new Set(),
      isolatedWorkspaces: new Map(),
      isShuttingDown: () => false,
      persist: () => {},
      publish: () => {},
      record: (t, msg, kind) => t.events.push({ msg, kind }),
      safeError: (e) => String(e?.message || e),
      git,
      withGitRepoLock: async (_k, fn) => fn(),
      inspectWorkspace: async (p) => ({ path: p, isGit: true, head: "HEAD", dirty: false }),
      loadModels: async () => ({ antigravity: { installed: true, available: true, authMode: "consumer-oauth" } }),
      relevantMemory: () => [],
      autoDistillTaskMemory: () => {},
      skillCatalogService: {
        loadSkillCatalog: async () => [],
        resolveSelectedSkills: async () => [],
        selectTaskSkillsProgressive: () => ({ scoredCandidates: [], skillIds: [], progressiveSkills: [] }),
        stageAntigravitySkillBundles: async () => [],
        stageAntigravitySkills: async () => [],
      },
      promptService: { makeInitialChatPrompt: () => "p", makeChatPrompt: () => "p", makePrompt: () => "p" },
      stageRunner: {
        assertTaskActive: () => {},
        areTaskDependenciesMet: () => true,
        runTaskQaCheck: async () => ({ status: "passed", output: "" }),
        spawnStage: async (_t, _p, stage) => {
          if (stage === "plan") return "Plan ok";
          if (stage === "build") { buildCalls += 1; return "Built once"; }
          if (stage === "review") return "## Blocking\n- BUG-1: Sample blocking issue";
          return "";
        },
      },
    });
    await capRunner.executeTask(capTask);
    assert.equal(buildCalls, 1, "Consumer OAuth pipeline must cap auto-fix loops to 1 round");
    assert.ok(capTask.events.some((e) => e.msg.includes("maxRounds = 1")));

    // normalizeScheduleProfile blocks enabled Antigravity under OAuth, allows under API Key or paused
    const schedState = { workspaces: [{ id: "ws-sched", name: "Repo", path: shadowRepoDir }], settings: {} };
    assert.throws(
      () => normalizeScheduleProfile({
        name: "Cron OAuth Block",
        workspaceId: "ws-sched",
        prompt: "Run checks automatically on schedule",
        workflow: "chat-only",
        chatProvider: "antigravity",
        enabled: true,
      }, schedState, { antigravity: { available: true, authMode: "consumer-oauth", models: [{ id: "gemini-2.5-pro", efforts: ["medium"] }] } }),
      /Mục 6|Gemini API Key/i
    );
    const pausedSched = normalizeScheduleProfile({
      name: "Paused Legacy Schedule",
      workspaceId: "ws-sched",
      prompt: "Paused checks on schedule",
      workflow: "chat-only",
      chatProvider: "antigravity",
      enabled: false,
    }, schedState, { antigravity: { available: true, authMode: "consumer-oauth", models: [{ id: "gemini-2.5-pro", efforts: ["medium"] }] } });
    assert.equal(pausedSched.enabled, false);
    const apiSched = normalizeScheduleProfile({
      name: "Cron With API Key",
      workspaceId: "ws-sched",
      prompt: "Run checks safely with API Key",
      workflow: "chat-only",
      chatProvider: "antigravity",
      enabled: true,
    }, schedState, { antigravity: { available: true, authMode: "gemini-api-key", models: [{ id: "gemini-2.5-pro", efforts: ["medium"] }] } });
    assert.equal(apiSched.chatProvider, "antigravity");
  } finally {
    if (prevGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevGeminiKey;
    if (prevGoogleKey === undefined) delete process.env.GOOGLE_API_KEY;
    else process.env.GOOGLE_API_KEY = prevGoogleKey;
    if (prevCooldown === undefined) delete process.env.OPENSYBAU_AGY_COOLDOWN_MS;
    else process.env.OPENSYBAU_AGY_COOLDOWN_MS = prevCooldown;
  }

  console.log("test-phase2-checkpoints-phase3: PASS");
} finally {
  // Prune any temporary git worktree registrations before deleting temp dir on Windows
  await git(conflictRepoDir, ["worktree", "prune"]).catch(() => {});
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
}
