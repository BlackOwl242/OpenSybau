import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import { join, resolve } from "node:path";
import { parseReviewFindings } from "../src/domain/task-flow.js";
import { applyApiBuildResult, tryApplyApiChatBuildResult } from "../src/server/api-build-ops.mjs";
import { flushTaskProposedMemories } from "../src/server/memory-bm25.mjs";
import { completeWithApi, normalizeApiUsage } from "../src/server/provider-registry.mjs";
import { createTaskPromptService } from "../src/server/task-prompts.mjs";
import { createTaskStageRunner } from "../src/server/task-stage-runner.mjs";

const parent = resolve(".runtime");
await fs.mkdir(parent, { recursive: true });
const root = await fs.mkdtemp(join(parent, "phase2-api-"));
const repoDir = join(root, "repo");
const storageDir = join(root, "task-storage");
await fs.mkdir(repoDir, { recursive: true });
await fs.mkdir(storageDir, { recursive: true });

await fs.writeFile(join(repoDir, "sample.mjs"), `// ${"Long architecture docstring for masking verification. ".repeat(10)}\nexport const version = 1;\n`);
await fs.writeFile(join(repoDir, "crlf.js"), "function greet() {\r\n  return 'old';\r\n}\r\n");
await fs.writeFile(join(repoDir, "config.json"), '{"name":"valid","count":1}\n');

let retryAttempts = 0;
let anthropicSawCacheControl = false;
let toolLoopStep = 0;
let overflowTriggered = false;
let syntaxHealTriggered = false;
let scenarioMode = "idle";
const compatRequestBodies = [];

const mockServer = createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const rawBody = Buffer.concat(chunks).toString("utf8");
  const body = rawBody ? JSON.parse(rawBody) : {};

  if (req.url === "/compat/v1/chat/completions") {
    compatRequestBodies.push(body);
    if (scenarioMode === "retry-sse") {
      retryAttempts += 1;
      if (retryAttempts === 1) {
        res.writeHead(429, { "Retry-After": "0", "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Rate limit" } }));
        return;
      }
      if (retryAttempts === 2) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Overloaded" } }));
        return;
      }
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Streamed " } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "chunk " } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "OK" } }], usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150, prompt_tokens_details: { cached_tokens: 40 } } })}\n\n`);
      res.write("data: [DONE]\n\n");
      res.end();
      return;
    }

    if (scenarioMode === "tool-loop") {
      // Nested read-only delegate_subagent call comes in with a single user message + subagent instruction
      const sysMsg = body.messages?.find((m) => m.role === "system")?.content || "";
      if (sysMsg.includes("focused read-only subagent")) {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          choices: [{ message: { content: "Subagent verified sample.mjs version = 1" } }],
          usage: { prompt_tokens: 50, completion_tokens: 12, total_tokens: 62 },
        }));
        return;
      }

      toolLoopStep += 1;
      const sendTool = (id, name, args) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          choices: [{
            message: {
              content: "",
              tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
            },
          }],
          usage: { prompt_tokens: 80, completion_tokens: 15, total_tokens: 95 },
        }));
      };

      if (toolLoopStep === 1) return sendTool("tc1", "list_files", { maxFiles: 20 });
      if (toolLoopStep === 2) return sendTool("tc2", "read_file", { path: "sample.mjs" });
      if (toolLoopStep === 3) return sendTool("tc3", "propose_skill_patch", { name: "Verify Exports", description: "Check JS exports", instructions: "Run node --check before finish" });
      if (toolLoopStep === 4) return sendTool("tc4", "recall_sessions", { query: "version" });
      if (toolLoopStep === 5) return sendTool("tc5", "memory_save", { title: "Lesson Build Check", content: "Always verify sample.mjs exports version carefully in multi-stage tasks", kind: "lesson" });
      if (toolLoopStep === 6) return sendTool("tc6", "delegate_subagent", { role: "Code Scout", prompt: "Inspect sample.mjs" });
      if (toolLoopStep === 7 && !overflowTriggered) {
        overflowTriggered = true;
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: { message: "maximum context length exceeded", type: "context_length_exceeded" } }));
        return;
      }
      if (toolLoopStep === 8 && !syntaxHealTriggered) {
        // First return syntax-broken build JSON to trigger syntaxHealUsed auto-repair
        syntaxHealTriggered = true;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                summary: "Broken draft",
                files: [{ path: "sample.mjs", content: "export const broken = ;\n" }],
                deletePaths: [],
              }),
            },
          }],
          usage: { prompt_tokens: 90, completion_tokens: 20, total_tokens: 110 },
        }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              summary: "Implemented valid export",
              files: [{ path: "sample.mjs", content: "export const version = 2;\n" }],
              deletePaths: [],
            }),
          },
        }],
        usage: { prompt_tokens: 100, completion_tokens: 25, total_tokens: 125 },
      }));
      return;
    }
  }

  if (req.url === "/anthropic/v1/messages") {
    assert.equal(req.headers["anthropic-version"], "2023-06-01");
    assert.ok(String(req.headers["anthropic-beta"] || "").includes("prompt-caching"));
    anthropicSawCacheControl = Array.isArray(body.system) && body.system.some((b) => b.cache_control?.type === "ephemeral");
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(`data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 300, cache_read_input_tokens: 120 } } })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "Claude " } })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "cached OK" } })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 18 } })}\n\n`);
    res.end();
    return;
  }

  if (req.url?.startsWith("/gemini/v1beta/models/")) {
    assert.equal(req.headers["x-goog-api-key"], "gem-key");
    if (req.url.includes("streamGenerateContent")) {
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "Gemini " }] } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "SSE OK" }] } }], usageMetadata: { promptTokenCount: 200, cachedContentTokenCount: 50, candidatesTokenCount: 25, totalTokenCount: 225 } })}\n\n`);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "Gemini JSON OK" }] } }],
      usageMetadata: { promptTokenCount: 200, cachedContentTokenCount: 50, candidatesTokenCount: 25, totalTokenCount: 225 },
    }));
    return;
  }

  res.writeHead(404).end();
});

await new Promise((ok) => mockServer.listen(0, "127.0.0.1", ok));
const port = mockServer.address().port;

try {
  // 1. Backoff retry + SSE delta streaming (OpenAI-compatible)
  scenarioMode = "retry-sse";
  const deltas = [];
  const compatProvider = {
    id: "custom-compat",
    name: "Compat Mock",
    protocol: "openai-compatible",
    endpoint: `http://127.0.0.1:${port}/compat/v1`,
    apiKey: "test-key",
  };
  const sseRes = await completeWithApi(compatProvider, "gpt-mock", {
    prompt: "Say streamed ok",
    onDelta: (d) => deltas.push(d),
  });
  assert.equal(retryAttempts, 3, "Expected 2 retries after 429 and 503");
  assert.equal(deltas.join(""), "Streamed chunk OK");
  assert.equal(sseRes.content, "Streamed chunk OK");
  assert.equal(sseRes.usage.cached_input_tokens, 40);

  // 2. Anthropic Tier-1 ephemeral prompt cache control + SSE usage
  const antProvider = {
    id: "claude-api",
    name: "Claude Mock",
    protocol: "anthropic",
    endpoint: `http://127.0.0.1:${port}/anthropic/v1`,
    apiKey: "ant-key",
  };
  const antDeltas = [];
  const longStablePrefix = "Project repository rules and permanent architecture invariants. ".repeat(8);
  assert.ok(longStablePrefix.length >= 256);
  const antRes = await completeWithApi(antProvider, "claude-mock", {
    stablePrefix: longStablePrefix,
    dynamicSystem: "Current stage: review",
    messages: [{ role: "user", content: "Check this." }],
    onDelta: (d) => antDeltas.push(d),
  });
  assert.equal(anthropicSawCacheControl, true, "Anthropic Tier-1 stablePrefix must carry cache_control: ephemeral");
  assert.equal(antRes.content, "Claude cached OK");
  assert.equal(antRes.usage.cached_input_tokens, 120);
  assert.equal(antRes.usage.output_tokens, 18);

  // 3. Gemini SSE streaming + usageMetadata normalization
  const gemProvider = {
    id: "gemini",
    name: "Gemini Mock",
    protocol: "gemini",
    endpoint: `http://127.0.0.1:${port}/gemini/v1beta`,
    apiKey: "gem-key",
  };
  const gemDeltas = [];
  const gemRes = await completeWithApi(gemProvider, "gemini-2.5-pro", {
    prompt: "Hello Gemini",
    onDelta: (d) => gemDeltas.push(d),
  });
  assert.equal(gemDeltas.join(""), "Gemini SSE OK");
  assert.equal(gemRes.usage.input_tokens, 200);
  assert.equal(gemRes.usage.cached_input_tokens, 50);
  assert.equal(gemRes.usage.output_tokens, 25);
  assert.equal(gemRes.usage.total_tokens, 225);

  const normalizedGem = normalizeApiUsage({ promptTokenCount: 100, cachedContentTokenCount: 30, candidatesTokenCount: 10 }, "gemini");
  assert.deepEqual(normalizedGem, { input_tokens: 100, output_tokens: 10, cached_input_tokens: 30, total_tokens: 110 });

  // 4. applyApiBuildResult: CRLF/LF SEARCH/REPLACE, broken JSON rollback, readOnly guard
  const crlfApply = await applyApiBuildResult(
    repoDir,
    JSON.stringify({
      summary: "Update crlf.js",
      patches: [{ path: "crlf.js", edits: [{ search: "function greet() {\n  return 'old';\n}", replace: "function greet() {\n  return 'new';\n}" }] }],
    }),
    new Map(),
  );
  assert.match(crlfApply, /Patched crlf\.js/);
  assert.match(await fs.readFile(join(repoDir, "crlf.js"), "utf8"), /return 'new';/);

  const configBuf = await fs.readFile(join(repoDir, "config.json"));
  const configHash = createHash("sha256").update(configBuf).digest("hex");
  await assert.rejects(
    applyApiBuildResult(
      repoDir,
      JSON.stringify({ summary: "Break json", files: [{ path: "config.json", content: "{broken json" }], deletePaths: [] }),
      new Map([["config.json", configHash]]),
    ),
    /Invalid JSON syntax/i,
  );
  assert.equal(await fs.readFile(join(repoDir, "config.json"), "utf8"), '{"name":"valid","count":1}\n', "Broken JSON write must roll back cleanly");

  await assert.rejects(
    applyApiBuildResult(repoDir, JSON.stringify({ files: [{ path: "sample.mjs", content: "export const blocked = 1;\n" }], deletePaths: [] }), new Map(), { readOnly: true }),
    /chỉ đọc/i,
  );

  const ignoredChat = await tryApplyApiChatBuildResult(repoDir, "Plain text chat response.", new Map());
  assert.equal(ignoredChat, null);
  const appliedChat = await tryApplyApiChatBuildResult(
    repoDir,
    JSON.stringify({ summary: "Chat patch", patches: [{ path: "crlf.js", edits: [{ search: "return 'new';", replace: "return 'chat';" }] }] }),
    new Map(),
  );
  assert.match(appliedChat || "", /Patched crlf\.js/);

  // 5. parseReviewFindings headings & explicit markers
  const findings = parseReviewFindings([
    "### Blocking Issues",
    "- Missing bounds check in handler.js:14",
    "- [ADVISORY] Rename temp variable",
    "**Advisory**:",
    "- Could simplify loop condition",
  ].join("\n"));
  assert.equal(findings.blocking, 1);
  assert.equal(findings.advisory, 2);

  // 6. buildStagePromptParts Tier-1 vs dynamic split
  const promptSvc = createTaskPromptService({
    getState: () => ({ workspaces: [{ id: "ws1", name: "Repo", path: repoDir, notes: "Never skip tests." }], tasks: [], skills: [], memories: [] }),
    git: async () => ({ code: 0, stdout: "", stderr: "" }),
    getRuntimeMode: () => "local",
    hasApiProvider: () => true,
  });
  const parts = promptSvc.buildStagePromptParts(
    { id: "t1", workspaceId: "ws1", prompt: "Implement feature X", config: { roles: { plan: { provider: "openai", model: "gpt" }, build: { provider: "openai", model: "gpt" } } } },
    "build",
    "Plan step 1",
    [{ title: "Coding Rule", content: "Always validate inputs carefully. ".repeat(12), kind: "lesson" }],
    { id: "ws1", name: "Repo", path: repoDir, notes: "Always run unit checks." },
    [],
  );
  assert.ok(parts.tier1StablePrefix.length >= 256);
  assert.ok(!parts.tier1StablePrefix.includes("Plan step 1"));
  assert.ok(parts.dynamicBody.includes("Plan step 1"));

  // 7. Full task-stage-runner API tool loop (>5 turns, overflow masking, subagent, memory flush, skill proposal, syntax heal)
  scenarioMode = "tool-loop";
  compatRequestBodies.length = 0;
  const persistedMemories = [];
  const state = {
    workspaces: [{ id: "ws1", name: "Repo", path: repoDir }],
    tasks: [],
    memories: persistedMemories,
    skills: [],
  };
  const task = {
    id: "api-loop-task",
    code: "TASK-API",
    title: "API Harness Task",
    workspaceId: "ws1",
    workspacePath: repoDir,
    executionPath: repoDir,
    storagePath: storageDir,
    status: "running",
    permissionPreset: "workspace-write",
    config: {
      workflow: "codex-antigravity",
      permissionPreset: "workspace-write",
      roles: {
        plan: { provider: "openai-compat", model: "gpt-mock", effort: "medium" },
        build: { provider: "openai-compat", model: "gpt-mock", effort: "medium" },
        review: { provider: "openai-compat", model: "gpt-mock", effort: "low" },
      },
    },
    events: [],
    artifacts: [],
    stageMetrics: [],
    subagents: [],
  };
  state.tasks.push(task);

  const stageRunner = createTaskStageRunner({
    getState: () => state,
    running: new Map([[task.id, { cancelRequested: false, child: null }]]),
    isShuttingDown: () => false,
    record: (t, msg, level = "info", meta = null) => { t.events.push({ msg, level, meta }); },
    schedulePersist: () => {},
    schedulePublish: () => {},
    run: async () => ({ code: 0, stdout: "", stderr: "" }),
    killTree: () => {},
    loadModels: async () => ({
      "openai-compat": {
        id: "openai-compat",
        kind: "api",
        available: true,
        capabilities: { plan: true, build: true, review: true, chat: true },
        models: [{ id: "gpt-mock", name: "GPT Mock", efforts: ["low", "medium", "high"] }],
      },
    }),
    getCliExecutables: () => ({}),
    getApiProviderRuntime: () => ({
      id: "openai-compat",
      name: "Compat Mock",
      protocol: "openai-compatible",
      endpoint: `http://127.0.0.1:${port}/compat/v1`,
      apiKey: "test-key",
      models: [{ id: "gpt-mock", name: "GPT Mock" }],
    }),
    additionalWritableProjectDirs: () => [],
    externalWorkspaceContext: async () => ({ buildSnapshotHashes: new Map(), summaryText: "Repo context", files: ["sample.mjs"] }),
    searchWorkbenchFn: (q) => [{ docId: "task:prev", type: "task", title: "Previous Version Task", snippet: `Matched ${q} ` + "historical context detail ".repeat(15) }],
    flushProposedMemoriesFn: (t) => flushTaskProposedMemories(t, persistedMemories, () => {}),
  });

  const buildOutput = await stageRunner.spawnStage(task, "openai-compat", "build", repoDir, "Build step 2");
  assert.match(buildOutput, /Implemented valid export/);
  assert.equal(await fs.readFile(join(repoDir, "sample.mjs"), "utf8"), "export const version = 2;\n");
  assert.equal(overflowTriggered, true, "Expected context overflow retry path");
  assert.equal(syntaxHealTriggered, true, "Expected syntax self-heal retry path");
  assert.ok(persistedMemories.some((m) => m.title === "Lesson Build Check"), "memory_save tool must flush to persisted memories");
  assert.ok(task.proposedSkills?.some((s) => s.name === "Verify Exports"), "propose_skill_patch must attach to task.proposedSkills");
  assert.ok(task.subagents?.some((s) => s.role === "Code Scout" && s.status === "completed"), "delegate_subagent must record completed subagent");
  const lastApiReq = compatRequestBodies.at(-1);
  const maskedToolMsgs = (lastApiReq?.messages || []).filter((m) => m.role === "tool" && String(m.content || "").includes("Masked tool observation"));
  assert.ok(maskedToolMsgs.length >= 2, `Expected >=2 masked older tool observations, got ${maskedToolMsgs.length}`);

  console.log("test-phase2-api-harness: PASS");
} finally {
  await new Promise((ok) => mockServer.close(ok)).catch(() => {});
  await fs.rm(root, { recursive: true, force: true }).catch(() => {});
}
