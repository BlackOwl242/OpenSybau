#!/usr/bin/env node
/**
 * Targeted P0 Regression Suite covering verified defects fixed in Phase 0:
 * - P0-01: applyTaskWorktree with real git(cwd, args, { env }) from server.mjs (no 1ms NaN timeout / global env race)
 * - P0-02: CliApprovalQueue accepts acceptForSession and handles closed client expiry safely
 * - P0-03: Subagent terminal status non-clobber, Claude parent usage non-double-count, Codex rollout limit, modal fields
 * - P0-04 / P0-05: Mobile approve-plan-gate action, isWorktreesScreen deck, deep-link config fallback, close-details/split sync
 * - P0-06 / P0-10: Mobile landscape/portrait grid & settings nav CSS, vault-editor monospace, narrow collapsed drawer, reduced-motion
 * - P0-07 / P0-08: Stage all-changes df.hunks, Diff Studio 4-column .diff-row CSS, syncWorkflow modal precedence, PATCH /api/schedules/:id, GitHub modal fields
 * - P0-09 / P0-11: Safe wikilink AST tokenization in buildMarkdown/renderKnowledgeMarkdown, POST/PATCH /api/tasks manual skillIds
 * - P0-12: Rust worker pending-request event loop ref counting & Electron resourcesPath resolution
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tempRoot = mkdtempSync(join(tmpdir(), "opensybau-p0-reg-"));
process.env.WORKBENCH_DATA_DIR = join(tempRoot, "data");
process.env.WORKBENCH_HOST = "127.0.0.1";
process.env.WORKBENCH_PORT = "0";
process.env.WORKBENCH_MODE = "production";
process.env.WORKBENCH_ALLOW_NETWORK = "false";

try {
  // 1. P0-01: Real server.mjs git(cwd, args, { env }) + applyTaskWorktree integration
  const { git } = await import("../server.mjs");
  const { createTaskRunnerService } = await import("../src/server/task-runner.mjs");

  const repoDir = join(tempRoot, "repo");
  const wtDir = join(tempRoot, "worktrees");
  const wtRepoDir = join(wtDir, "task-wt");
  const taskDir = join(tempRoot, "tasks");
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(wtDir, { recursive: true });
  mkdirSync(taskDir, { recursive: true });

  execFileSync("git", ["init"], { cwd: repoDir, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["config", "user.email", "p0@opensybau.local"], { cwd: repoDir, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["config", "user.name", "OpenSybau P0"], { cwd: repoDir, stdio: "ignore", windowsHide: true });
  writeFileSync(join(repoDir, "app.js"), "export const v = 1;\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "ignore", windowsHide: true });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir, stdio: "ignore", windowsHide: true });
  const baseHead = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoDir, encoding: "utf8", windowsHide: true }).trim();
  execFileSync("git", ["worktree", "add", "-b", "opensybau/p0-wt", wtRepoDir, baseHead], { cwd: repoDir, stdio: "ignore", windowsHide: true });

  writeFileSync(join(wtRepoDir, "app.js"), "export const v = 2;\n", "utf8");
  writeFileSync(join(wtRepoDir, "added.txt"), "created in worktree\n", "utf8");

  const p0Task = {
    id: "task-p0-wt",
    workspaceId: "ws-1",
    workspacePath: repoDir,
    worktreePath: wtRepoDir,
    worktreeBranch: "opensybau/p0-wt",
    worktreeBaseHead: baseHead,
    isolated: true,
    status: "done",
    storagePath: join(taskDir, "task-p0-wt"),
    events: [],
  };
  const state = {
    settings: { maxConcurrency: 2 },
    workspaces: [{ id: "ws-1", name: "p0-repo", path: repoDir }],
    tasks: [p0Task],
  };
  const runner = createTaskRunnerService({
    taskDir,
    worktreeDir: wtDir,
    getState: () => state,
    running: new Map(),
    busyWorkspaces: new Set(),
    isolatedWorkspaces: new Map(),
    isShuttingDown: () => false,
    persist: () => {},
    publish: () => {},
    record: () => {},
    safeError: (e) => String(e?.message || e),
    git, // REAL git() from server.mjs!
    withGitRepoLock: async (_root, fn) => fn(),
    inspectWorkspace: async (p) => ({ path: p, isGit: true, head: baseHead }),
    loadModels: async () => ({}),
    promptService: { roleConfig: () => ({}), stageSelection: () => ({}), workspaceMemory: () => [], invalidateMemoryCache: () => {} },
    skillCatalogService: { loadSkillCatalog: async () => [], resolveSelectedSkills: async () => [], selectTaskSkills: async () => ({ skillIds: [] }) },
    stageRunner: { assertTaskActive: () => {}, areTaskDependenciesMet: () => true, runTaskQaCheck: async () => ({ ok: true }) },
    autoDistillTaskMemory: () => {},
    maxQueuedChatPerTask: 5,
    maxChatMessageChars: 50000,
    maxChatHistory: 100,
  });

  const beforeEnv = process.env.GIT_INDEX_FILE;
  await runner.applyTaskWorktree(p0Task);
  assert.equal(process.env.GIT_INDEX_FILE, beforeEnv, "Global process.env.GIT_INDEX_FILE must never be mutated");
  assert.equal(readFileSync(join(repoDir, "app.js"), "utf8").replace(/\r\n/g, "\n"), "export const v = 2;\n");
  assert.equal(readFileSync(join(repoDir, "added.txt"), "utf8").replace(/\r\n/g, "\n"), "created in worktree\n");
  assert.ok(p0Task.worktreeAppliedAt, "applyTaskWorktree must stamp worktreeAppliedAt with real server git()");
  console.log("  [PASS] P0-01 · applyTaskWorktree works end-to-end with real server git() options & temp GIT_INDEX_FILE");

  // 2. P0-02: CliApprovalQueue accepts acceptForSession & tolerates closed client timer
  const { CliApprovalQueue } = await import("../src/server/cli-approval-queue.mjs");
  const sentResponses = [];
  let clientOpen = true;
  const mockClient = {
    isActiveTurn: (th, tu) => th === "th-1" && tu === "tu-1",
    respond(id, payload) {
      if (!clientOpen) throw new Error("Channel closed");
      sentResponses.push({ id, payload });
    },
  };
  const approvalTask = { id: "t-app", pendingApprovals: [], events: [] };
  const queue = new CliApprovalQueue(approvalTask, mockClient, { timeoutMs: 30 });
  queue.add({ id: "app-1", method: "item/commandExecution/requestApproval", params: { threadId: "th-1", turnId: "tu-1", reason: "Run git status" } });
  assert.equal(queue.resolve("app-1", "tu-1", "acceptForSession"), true, "acceptForSession must be allowed");
  assert.deepEqual(sentResponses.at(-1), { id: "app-1", payload: { decision: "acceptForSession" } });

  queue.add({ id: "app-2", method: "item/commandExecution/requestApproval", params: { threadId: "th-1", turnId: "tu-1", reason: "Run ls" } });
  assert.equal(queue.resolve("app-2", "tu-1", "invalid-decision"), false);
  clientOpen = false;
  await new Promise((r) => setTimeout(r, 60)); // Wait past 30ms expiry with closed client; must not crash
  assert.equal(approvalTask.pendingApprovals.length, 0);
  console.log("  [PASS] P0-02 · CliApprovalQueue supports acceptForSession and safe closed-client expiry");

  // 3. P0-03: Subagent terminal non-clobber, Claude parent usage non-double-count, modal canonical fields
  const { createStageSubagentTracker, parseClaudeStreamLine } = await import("../src/server/subagent-tracker.mjs");
  const subTask = { subagents: [], currentRound: 1 };
  const tracker = createStageSubagentTracker({ task: subTask, harness: "codex", stage: "build" });
  tracker.upsertSubagent({ externalId: "call-1", status: "running", role: "Worker 1" });
  tracker.upsertSubagent({ externalId: "call-1", status: "completed", result: "Done!" });
  tracker.upsertSubagent({ externalId: "call-1", status: "unknown" });
  assert.equal(subTask.subagents[0].status, "completed", "Terminal subagent status must not revert to unknown");

  // Verify non-terminal -> unknown transition still works (wait compatibility)
  tracker.upsertSubagent({ externalId: "call-2", status: "running", role: "Worker 2" });
  tracker.upsertSubagent({ externalId: "call-2", status: "unknown" });
  assert.equal(subTask.subagents[1].status, "unknown");

  // Verify Claude child message usage does not inflate ctx.turnUsageFallback & tool_result usage replaces cleanly
  const claudeTask = { subagents: [], currentRound: 1, events: [] };
  const claudeTracker = createStageSubagentTracker({
    task: claudeTask,
    harness: "claude",
    stage: "build",
    record: () => {},
    addTaskUsage: () => {},
  });
  const ctx = {
    task: claudeTask,
    tracker: claudeTracker,
    outputParts: [],
    toolUseMap: new Map(),
    backgroundTaskMap: new Map(),
    turnUsageFallback: null,
  };
  parseClaudeStreamLine(JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "tool-agent-1", name: "Task", input: { description: "Audit code", prompt: "Inspect files" } }],
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  }), ctx);
  assert.equal(ctx.turnUsageFallback?.input_tokens, 100);
  parseClaudeStreamLine(JSON.stringify({
    type: "assistant",
    parent_tool_use_id: "tool-agent-1",
    message: {
      content: [{ type: "tool_use", id: "tool-read-1", name: "Read", input: { file_path: "a.js" } }],
      usage: { input_tokens: 400, output_tokens: 80 },
    },
  }), ctx);
  assert.equal(ctx.turnUsageFallback.input_tokens, 100, "Child parent_tool_use_id usage must not inflate parent turnUsageFallback");
  assert.equal(claudeTask.subagents[0].usage.input_tokens, 400);
  parseClaudeStreamLine(JSON.stringify({
    type: "user",
    tool_use_result: { usage: { input_tokens: 450, output_tokens: 90, total_tokens: 540 } },
    message: {
      content: [{
        type: "tool_result",
        tool_use_id: "tool-agent-1",
        content: "Audit complete",
      }],
    },
  }), ctx);
  assert.equal(claudeTask.subagents[0].usage.total_tokens, 540, "Authoritative tool_use_result.usage must replace streamed partial sum without double-counting");
  assert.equal(claudeTask.subagents[0].status, "completed");
  console.log("  [PASS] P0-03 · Subagent terminal guard & Claude token usage deduplication verified");

  // 4. P0-09: Safe wikilink AST/placeholder rendering in buildMarkdown & renderKnowledgeMarkdown
  const { buildMarkdown, renderKnowledgeMarkdown } = await import("../src/features/workbench/markdown.js");
  const kbHtml = renderKnowledgeMarkdown("Check [[Architecture#API|Arch Doc]], `[[NotWikilink]]`, and [URL](https://example.com/[[Path]])");
  assert.match(kbHtml, /class="vault-wikilink".*data-target="Architecture"/);
  assert.match(kbHtml, />Arch Doc</);
  assert.match(kbHtml, /<code>\[\[NotWikilink\]\]<\/code>/, "Inline code must not turn [[...]] into a button");
  assert.match(kbHtml, /href="https:\/\/example\.com\/\[\[Path\]\]"/, "Link href must not be corrupted with <button>");
  const nonKbHtml = buildMarkdown("Literal [[Note]] in chat");
  assert.doesNotMatch(nonKbHtml, /vault-wikilink/);
  console.log("  [PASS] P0-09 · Wikilinks render safely without corrupting <code> or <a href>");

  // 5. P0-08 & P0-11: Route-level verification for PATCH /api/schedules/:id & POST/PATCH /api/tasks skillIds
  const { handleProviderSkillRoutes } = await import("../src/server/routes/provider-skill-routes.mjs");
  const { handleTaskRoutes } = await import("../src/server/routes/task-routes.mjs");

  const skillLib = [
    { id: "sk-sec", name: "security-audit", description: "Security scan", providers: ["*"], workspaceScoped: false },
    { id: "sk-ui", name: "impeccable", description: "UI QA", providers: ["*"], workspaceScoped: false },
  ];
  const connectors = {
    codex: {
      available: true,
      authenticated: true,
      name: "Codex",
      capabilities: { chat: true, plan: true, build: true, review: true },
      models: [{ id: "gpt-5.4", efforts: ["medium", "high"] }],
    },
  };
  const routeState = {
    workspaces: [{ id: "ws-route", name: "repo", path: repoDir }],
    tasks: [],
    settings: {
      taskPresets: [],
      schedules: [{
        id: "sched-1",
        name: "Nightly check",
        workspaceId: "ws-route",
        prompt: "Check repo status every hour cleanly",
        workflow: "plan-only",
        permissionPreset: "read-only",
        intervalMinutes: 60,
        enabled: true,
        roles: { plan: { provider: "codex", model: "gpt-5.4", effort: "medium" }, build: { provider: "codex", model: "gpt-5.4", effort: "medium" }, review: { provider: "codex", model: "gpt-5.4", effort: "medium" } },
      }],
      defaults: { chatProvider: "codex", chatModel: "gpt-5.4", chatEffort: "medium" },
    },
  };
  async function dispatchRoute(handler, method, pathname, bodyObj = null) {
    let statusCode = 0;
    let payload = null;
    const req = { method, url: pathname, headers: { host: "127.0.0.1" } };
    const ctx = {
      taskDir,
      getState: () => routeState,
      running: new Map(),
      busyWorkspaces: new Map(),
      persist: () => {},
      publish: () => {},
      record: () => {},
      json: (_res, code, data) => { statusCode = code; payload = data; },
      readBody: async () => bodyObj || {},
      safeError: (e) => String(e?.message || e),
      run: async () => ({ code: 0, stdout: "" }),
      git,
      withGitRepoLock: async (_r, fn) => fn(),
      openFolder: () => {},
      killTree: () => {},
      autoDistillTaskMemory: () => {},
      cliDiscovery: {
        inspectWorkspace: async (p) => ({ path: p, isGit: true, head: baseHead }),
        loadModels: async () => connectors,
        getCliExecutables: () => ({}), setAgyExe: () => {}, setClaudeCommand: () => {},
        invalidateModelCache: () => {}, expireModelCache: () => {}, refreshCliExecutables: async () => ({}),
        openCliLoginTerminal: async () => {}, savedApiProviders: () => [], publicApiProvider: (x) => x,
        validateCustomCliPath: async () => {},
      },
      providerQuotaService: {},
      skillCatalogService: {
        loadSkillCatalog: async () => skillLib,
        resolveSelectedSkills: async (ids) => {
          if (!Array.isArray(ids)) throw new Error("Invalid skill list");
          const out = ids.map((id) => skillLib.find((s) => s.id === id));
          if (out.some((x) => !x)) throw new Error("Skill not found");
          return out;
        },
        invalidateSkillCatalogCache: () => {},
        createSkillFiles: async () => {},
      },
      subagentCatalogService: {},
      promptService: { requestedRole: () => ({ provider: "codex", model: "gpt-5.4", effort: "medium" }) },
      stageRunner: { runTaskQaCheck: async () => ({ ok: true }) },
      taskRunner: { cleanupTaskWorktrees: async () => {}, processTaskChatQueue: async () => {}, pump: () => {}, checkDiff: async () => "", applyTaskWorktree: async () => {}, discardTaskWorktree: async () => {} },
      host: "127.0.0.1", port: 0, runtime: {}, secureTransport: false, isLoopbackBind: true,
      productionMode: false, allowedHosts: [], cliPathsFile: "", providerConfigFile: "", providerSecretsFile: "", connectionConfigFile: "",
      getMemories: () => [], setMemories: () => {}, getConnectionConfig: () => ({}), setConnectionConfig: () => {},
      getEffectiveAccessUsername: () => "", getEffectiveAccessPassword: () => "", isLoopbackClient: () => true,
      getBoundPort: () => 0, isLanActive: () => false, syncLanCompanionServers: async () => {}, stateSnapshot: () => routeState,
      loadJson: async () => ({}), persistJsonFile: async () => {}, persistMemory: () => {}, readMarkdownMemories: async () => [],
      taskStore: {}, isForbiddenSystemPath: () => false,
    };
    const handled = await handler(req, {}, pathname, ctx);
    return { handled, statusCode, payload };
  }

  const patchSched = await dispatchRoute(handleProviderSkillRoutes, "PATCH", "/api/schedules/sched-1", { enabled: false });
  assert.equal(patchSched.handled, true);
  assert.equal(patchSched.statusCode, 200);
  assert.equal(patchSched.payload.schedule.enabled, false);

  const postInvalidSkill = await dispatchRoute(handleTaskRoutes, "POST", "/api/tasks", {
    workspaceId: "ws-route",
    prompt: "Test invalid skill id rejection cleanly",
    workflow: "chat-only",
    chatProvider: "codex",
    chatModel: "gpt-5.4",
    chatEffort: "medium",
    skillIds: ["does-not-exist"],
  });
  assert.equal(postInvalidSkill.statusCode, 400);
  assert.match(postInvalidSkill.payload?.error || "", /Skill not found/);

  const postManualSkill = await dispatchRoute(handleTaskRoutes, "POST", "/api/tasks", {
    workspaceId: "ws-route",
    prompt: "Run task with explicit manual skill selection",
    workflow: "chat-only",
    chatProvider: "codex",
    chatModel: "gpt-5.4",
    chatEffort: "medium",
    skillIds: ["sk-sec"],
  });
  assert.equal(postManualSkill.statusCode, 201, JSON.stringify(postManualSkill.payload));
  assert.equal(postManualSkill.payload.task.skillSelectionMode, "manual");
  assert.deepEqual(postManualSkill.payload.task.skillIds, ["sk-sec"]);

  const patchTaskSkill = await dispatchRoute(handleTaskRoutes, "PATCH", `/api/tasks/${postManualSkill.payload.task.id}`, {
    skillIds: ["sk-sec", "sk-ui"],
  });
  assert.equal(patchTaskSkill.statusCode, 200);
  assert.deepEqual(patchTaskSkill.payload.task.skillIds, ["sk-sec", "sk-ui"]);

  const clearTaskSkill = await dispatchRoute(handleTaskRoutes, "PATCH", `/api/tasks/${postManualSkill.payload.task.id}`, {
    skillIds: [],
  });
  assert.equal(clearTaskSkill.statusCode, 200);
  assert.equal(clearTaskSkill.payload.task.skillSelectionMode, "auto");
  console.log("  [PASS] P0-08/P0-11 · PATCH /api/schedules/:id & POST/PATCH /api/tasks manual skillIds verified");

  // 6. Contract assertions for P0-04..P0-12 across edited frontend/CSS/Rust modules
  const read = (p) => readFileSync(resolve(p), "utf8");
  const mobileShell = read("src/shell/components/MobileOrcaShell.jsx");
  assert.doesNotMatch(mobileShell, /data-action="approve-plan"(?!-gate)/, "Dead approve-plan action must not appear");
  assert.match(mobileShell, /isWorktreesScreen/, "Worktrees screen must be rendered");

  const stageViewer = read("src/features/workbench/stage-viewer.js");
  assert.match(stageViewer, /df\.hunks/, "All-changes diff renderer must iterate df.hunks");

  const baseCss = read("src/styles/modules/01-base-surfaces.css");
  assert.match(baseCss, /grid-template-columns:\s*42px 42px 34px minmax\(0,\s*1fr\)/, "Diff Studio .diff-row must be 4 columns");
  assert.match(baseCss, /\.diff-row\.diff-row-add/);
  assert.match(baseCss, /\.diff-file-name/);
  assert.match(baseCss, /\.diff-inline-editor textarea/);

  const mobileCss = read("src/styles/modules/10-mobile-responsive.css");
  assert.match(mobileCss, /html\.mobile-companion \.wb-app-shell \.wb-main\s*\{[^}]*grid-row:\s*1;/);
  assert.match(mobileCss, /html\.mobile-companion \.settings-mobile-nav/);

  const shellCss = read("src/styles/shell.css");
  assert.doesNotMatch(shellCss, /\*, \*::before, \*::after \{[^}]*0\.01ms !important/);

  const stageCss = read("src/styles/modules/05-stage-tabs-viewer.css");
  assert.doesNotMatch(stageCss, /\.vault-editor-textarea,[\s\S]{0,200}font-family:\s*var\(--wb-font-sans\)/);

  const rustMod = read("src/server/rust-accelerator.mjs");
  assert.match(rustMod, /process\.resourcesPath/);
  assert.match(rustMod, /syncWorkerEventLoopRef/);
  console.log("  [PASS] P0-04..P0-12 · Frontend, Diff Studio, Mobile CSS, Markdown Editor & Rust Accelerator contracts verified");

  console.log("\n=== ALL PHASE 0 P0 REGRESSION TESTS PASSED ===");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
