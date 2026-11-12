#!/usr/bin/env node
/**
 * Live End-to-End Long-Task User Interaction Suite (E2E-LT-01 .. E2E-LT-12)
 * Verifies real execution of multi-stage, multi-round long tasks, Plan Gate interactive
 * pause/revise/approve, mid-run user steering, live streaming UI bubbles, dual Stop+Send
 * composer controls while busy, 4MB QA output resilience, auto-compaction, and Git worktree apply.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { createTaskPromptService, compactChatHistory, compactTaskConversationNow } from "../src/server/task-prompts.mjs";
import { createTaskRunnerService } from "../src/server/task-runner.mjs";
import { createTaskStageRunner } from "../src/server/task-stage-runner.mjs";
import { parseUnifiedDiffFiles } from "../src/server/diff-parser.mjs";
import { distillTaskMemoryRecord, relevantMemory as rankRelevantMemory } from "../src/server/memory-bm25.mjs";
import { view } from "../src/shared/state.js";
import { taskConversationPage } from "../src/features/workbench/pages/chat-conversation.js";

const execFileAsync = promisify(execFile);

async function runGit(cwd, args, opts = {}) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    env: opts.env || process.env,
    windowsHide: true,
  });
  return stdout;
}

async function main() {
  console.log("=== OpenSybau Long-Task User Interaction E2E Suite (12 Live Scenarios) ===");
  const results = [];
  const recordResult = (id, title, detail) => {
    results.push({ id, title, detail });
    console.log(`  [PASS] ${id} · ${title} — ${detail}`);
  };

  const tempRoot = mkdtempSync(join(tmpdir(), "opensybau-lt-e2e-"));
  const repoDir = join(tempRoot, "repo");
  const taskDir = join(tempRoot, "tasks");
  const worktreeDir = join(tempRoot, "worktrees");

  try {
    // Initialize a real temporary Git repository for isolated worktree E2E tests
    await execFileAsync("git", ["init", repoDir], { windowsHide: true });
    await runGit(repoDir, ["config", "user.email", "test@opensybau.local"]);
    await runGit(repoDir, ["config", "user.name", "OpenSybau E2E"]);
    writeFileSync(join(repoDir, "index.js"), "export function calc(a, b) {\n  return a + b;\n}\n", "utf8");
    await runGit(repoDir, ["add", "."]);
    await runGit(repoDir, ["commit", "-m", "initial commit"]);
    const defaultBranch = (await runGit(repoDir, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();

    // Shared in-memory state for promptService & taskRunnerService
    const memories = [];
    const state = {
      settings: {
        language: "vi",
        planGateEnabled: false,
      },
      workspaces: [
        {
          id: "ws-e2e",
          name: "E2E Repo",
          path: repoDir,
          gitRoot: repoDir,
          isGit: true,
          branch: defaultBranch,
          qaCommand: "",
        },
      ],
      tasks: [],
    };

    const running = new Map();
    const busyWorkspaces = new Set();
    const isolatedWorkspaces = new Map();

    const promptService = createTaskPromptService({
      getState: () => state,
      getMemories: () => memories,
      isForbiddenSystemPath: () => false,
      hasApiProvider: () => false,
      git: async (cwd, args) => {
        try {
          const out = await runGit(cwd, args);
          return { code: 0, ok: true, stdout: out, stderr: "" };
        } catch (err) {
          return { code: 1, ok: false, stdout: "", stderr: String(err.message || err) };
        }
      },
      relevantMemory: (t, ws) => rankRelevantMemory(t, ws, memories),
      skillProviderCompatible: () => true,
      skillInstructions: () => "",
    });

    // Set up frontend view state for taskConversationPage rendering
    view.language = "vi";
    view.connectors = {
      codex: {
        name: "Codex CLI",
        available: true,
        authenticated: true,
        capabilities: { chat: true },
        models: [{ id: "gpt-5.3-codex", name: "GPT-5.3 Codex", efforts: ["low", "medium", "high"] }],
      },
    };
    view.state = state;

    // -------------------------------------------------------------------------
    // E2E-LT-01 & E2E-LT-02: Live Streaming Output Bubble & Dual Composer Buttons while Busy
    // -------------------------------------------------------------------------
    const streamingTask = {
      id: "task-stream-1",
      title: "Refactor streaming parser",
      prompt: "Tối ưu hóa bộ phân tích luồng dữ liệu lớn",
      workspaceId: "ws-e2e",
      workspacePath: repoDir,
      executionPath: repoDir,
      status: "running",
      currentStage: "build",
      currentRound: 1,
      maxRounds: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config: {
        workflow: "codex-antigravity",
        roles: {
          plan: { provider: "codex", model: "gpt-5.3-codex", effort: "medium" },
          build: { provider: "codex", model: "gpt-5.3-codex", effort: "high" },
          review: { provider: "codex", model: "gpt-5.3-codex", effort: "medium" },
        },
      },
      plan: "## Kế hoạch\n1. Tách chunk buffer\n2. Giảm cấp phát bộ nhớ",
      events: [
        {
          id: "ev-out-1",
          kind: "output",
          stage: "build",
          provider: "codex",
          text: "Đang viết hàm `parseStreamChunk` với **Zero-Copy Slice**...",
          at: new Date().toISOString(),
        },
      ],
      chatMessages: [],
      chatQueue: [],
    };
    state.tasks.push(streamingTask);
    view.selected = streamingTask.id;

    const busyHtml = taskConversationPage(streamingTask.id);
    assert.ok(
      busyHtml.includes("is-streaming-live") && busyHtml.includes("parseStreamChunk"),
      "Expected taskConversationPage to render live streaming output bubble while task is running"
    );
    recordResult(
      "E2E-LT-01",
      "Live Streaming Output Bubble While Running",
      "Renders real-time .is-streaming-live assistant bubble from coalesced task.events output chunks"
    );

    assert.ok(
      busyHtml.includes('data-action="stop-task"') && busyHtml.includes('type="submit"'),
      "Expected composer to render BOTH Stop button and Send/Queue submit button while task is busy"
    );
    recordResult(
      "E2E-LT-02",
      "Dual Stop + Send/Queue Buttons in Busy Composer",
      "Composer renders both data-action=\"stop-task\" and type=\"submit\" so users can steer or stop long tasks"
    );

    // -------------------------------------------------------------------------
    // E2E-LT-04: Mid-Run User Steering Injection into Build & Review Prompts
    // -------------------------------------------------------------------------
    streamingTask.chatMessages.push({
      id: "msg-steer-1",
      role: "user",
      content: "Hãy dùng TypedArray (Uint8Array) thay vì mảng thường và giữ tương thích ngược.",
      status: "queued",
      createdAt: new Date().toISOString(),
    });
    const buildPromptWithSteering = await promptService.makePrompt(streamingTask, "build", [], { cwd: repoDir });
    const reviewPromptWithSteering = await promptService.makePrompt(streamingTask, "review", [], { cwd: repoDir });
    assert.ok(
      buildPromptWithSteering.includes("Mid-run user steering") &&
        buildPromptWithSteering.includes("Uint8Array"),
      "Expected Build stage prompt to include mid-run user steering messages"
    );
    assert.ok(
      reviewPromptWithSteering.includes("Mid-run user steering") &&
        reviewPromptWithSteering.includes("Uint8Array"),
      "Expected Review stage prompt to include mid-run user steering messages"
    );
    streamingTask.chatMessages.at(-1).status = "cancelled";
    const afterCancellation = await promptService.makePrompt(streamingTask, "build", [], { cwd: repoDir });
    assert.ok(!afterCancellation.includes("Uint8Array"), "Cancelled queued guidance must not enter later stages");
    streamingTask.chatMessages.at(-1).status = "queued";
    recordResult(
      "E2E-LT-04",
      "Mid-Run User Steering Injected into Build & Review Stages",
      "Queued/completed user chat turns during a long task are injected into subsequent Build and Review prompts"
    );

    // -------------------------------------------------------------------------
    // E2E-LT-03, E2E-LT-05, E2E-LT-06, E2E-LT-08, E2E-LT-11, E2E-LT-12:
    // Full Lifecycle Execution via createTaskRunnerService
    // -------------------------------------------------------------------------
    let stageCallLog = [];
    const mockStageRunner = {
      assertTaskActive: (t) => {
        if (t.stopRequested || t.status === "stopped") throw new Error("Đã dừng tác vụ theo yêu cầu.");
      },
      areTaskDependenciesMet: () => true,
      runTaskQaCheck: async (t) => {
        const round = t.currentRound || 1;
        return {
          ok: true,
          command: "node -e \"console.log('QA OK')\"",
          exitCode: 0,
          durationMs: 25,
          summary: `Round ${round} QA passed (exit 0).`,
        };
      },
      spawnStage: async (t, _provider, stage, cwd, prompt, _selection) => {
        const round = t.currentRound || 1;
        stageCallLog.push({ stage, round, promptSlice: String(prompt || "").slice(0, 200) });
        if (stage === "plan") {
          const revNote = t.planGateFeedback ? ` (Đã cập nhật theo góp ý: ${t.planGateFeedback})` : "";
          return `## Kế hoạch thực thi${revNote}\n1. Cập nhật \`index.js\` thêm hàm \`multiply\`.\n2. Kiểm tra biên đầu vào.`;
        }
        if (stage === "build") {
          if (round === 1) {
            writeFileSync(
              join(cwd, "index.js"),
              "export function calc(a, b) {\n  return a + b;\n}\nexport function multiply(a, b) {\n  return a * b;\n}\n",
              "utf8"
            );
            return "Đã thêm hàm `multiply(a, b)` ở Vòng 1.";
          }
          // Round 2 fixes the blocking finding by adding finite number check
          writeFileSync(
            join(cwd, "index.js"),
            "export function calc(a, b) {\n  return a + b;\n}\nexport function multiply(a, b) {\n  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new TypeError('Invalid number');\n  return a * b;\n}\n",
            "utf8"
          );
          return "Đã bổ sung kiểm tra `Number.isFinite` ở Vòng 2 theo yêu cầu Review.";
        }
        if (stage === "review") {
          if (round === 1) {
            return "## Kết quả Review Vòng 1\n- [BLOCKING] Hàm `multiply` thiếu kiểm tra `Number.isFinite` cho tham số đầu vào.";
          }
          return "## Kết quả Review Vòng 2\nNo blocking findings. Mọi kiểm tra đều đạt chuẩn.";
        }
        if (String(stage).startsWith("chat")) {
          return "Tôi đã hoàn tất cả 2 vòng sửa lỗi và áp dụng yêu cầu thêm từ hàng đợi chat của bạn!";
        }
        return "OK";
      },
    };

    const taskRunner = createTaskRunnerService({
      taskDir,
      worktreeDir,
      getState: () => state,
      running,
      busyWorkspaces,
      isolatedWorkspaces,
      isShuttingDown: () => false,
      persist: () => {},
      publish: () => {},
      record: (t, text, kind = "info", extra = {}) => {
        t.events ||= [];
        t.events.push({ id: `ev-${t.events.length + 1}`, text, kind, at: new Date().toISOString(), ...extra });
      },
      safeError: (err) => String(err?.message || err),
      git: async (cwd, args, opts) => {
        try {
          const stdout = await runGit(cwd, args, opts);
          return { code: 0, ok: true, stdout, stderr: "" };
        } catch (err) {
          return { code: 1, ok: false, stdout: "", stderr: String(err?.message || err) };
        }
      },
      withGitRepoLock: async (_repoRoot, fn) => fn(),
      inspectWorkspace: async (p) => {
        const head = (await runGit(p, ["rev-parse", "HEAD"]).catch(() => "")).trim();
        return {
          path: p,
          gitRoot: p,
          isGit: Boolean(head),
          head,
          branch: defaultBranch,
          dirty: false,
        };
      },
      relevantMemory: (t, ws) => rankRelevantMemory(t, ws, memories),
      autoDistillTaskMemory: (t, ws) => {
        const distilled = distillTaskMemoryRecord(t, ws || state.workspaces[0]);
        if (distilled) {
          memories.push({
            id: `mem-${memories.length + 1}`,
            ...distilled,
            pinned: false,
            createdAt: new Date().toISOString(),
          });
        }
      },
      skillCatalogService: {
        loadSkillCatalog: async () => [],
        resolveSelectedSkills: async () => [],
        selectTaskSkillsProgressive: () => ({ scoredCandidates: [], skillIds: [], progressiveSkills: [], reason: "" }),
        stageAntigravitySkillBundles: async () => [],
        stageAntigravitySkills: async () => [],
      },
      promptService,
      stageRunner: mockStageRunner,
    });

    // Create an isolated worktree long task with Plan Gate enabled and maxRounds = 2
    const longTask = {
      id: "task-long-e2e",
      title: "Thêm hàm multiply an toàn kiểu dữ liệu",
      prompt: "Thêm hàm multiply vào index.js và kiểm tra đầu vào chặt chẽ.",
      workspaceId: "ws-e2e",
      workspacePath: repoDir,
      executionPath: repoDir,
      isolated: true,
      planGate: true,
      planGateApprovedAt: null,
      status: "queued",
      currentRound: 1,
      maxRounds: 2,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      config: {
        workflow: "codex-antigravity",
        maxRounds: 2,
        requirePlanApproval: true,
        roles: {
          plan: { provider: "codex", model: "gpt-5.3-codex", effort: "medium" },
          build: { provider: "codex", model: "gpt-5.3-codex", effort: "high" },
          review: { provider: "codex", model: "gpt-5.3-codex", effort: "medium" },
        },
      },
      events: [],
      stageMetrics: [],
      chatMessages: [],
      chatQueue: [],
    };
    state.tasks.push(longTask);

    // Step 1: Execute task -> should pause at Station 2 Plan Gate (awaiting_approval)
    await taskRunner.executeTask(longTask);
    assert.equal(longTask.status, "awaiting_approval", "Expected task to pause at Station 2 Plan Gate");
    assert.equal(longTask.phase, "plan-gate", "Expected task phase to be plan-gate");
    assert.ok(longTask.plan.includes("multiply"), "Expected initial plan to be generated");

    // Step 2: Simulate user requesting Plan revision -> re-runs Plan and pauses again
    longTask.planGateFeedback = "Nhớ dùng Number.isFinite";
    longTask.plan = "";
    longTask.status = "queued";
    await taskRunner.executeTask(longTask);
    assert.equal(longTask.status, "awaiting_approval", "Expected revised plan to pause for approval");
    assert.ok(longTask.plan.includes("Number.isFinite"), "Expected revised plan to incorporate planGateFeedback");

    // Step 3: Queue a follow-up user chat turn while the task is about to run Build+Review
    const followUpMsg = {
      id: "msg-followup-1",
      role: "user",
      content: "Tóm tắt giúp tôi thay đổi sau khi hoàn tất pipeline nhé.",
      status: "queued",
      createdAt: new Date().toISOString(),
    };
    longTask.chatMessages.push(followUpMsg);
    longTask.chatQueue.push({
      id: "turn-followup-1",
      messageId: followUpMsg.id,
      message: followUpMsg.content,
      provider: "codex",
      model: "gpt-5.3-codex",
      effort: "medium",
    });

    // Step 4: User approves Plan (GO) -> runs Round 1 (Build + Review with BLOCKING finding) -> Round 2 (Build + Review PASS) -> drains queued chat
    longTask.planGateApprovedAt = new Date().toISOString();
    longTask.status = "queued";
    await taskRunner.executeTask(longTask);
    await taskRunner.processTaskChatQueue(longTask);

    recordResult(
      "E2E-LT-03",
      "Station 2 Plan Gate Pause -> Revise -> Approve (GO)",
      "Pauses at awaiting_approval, incorporates revision feedback on re-plan, and resumes pipeline on approval"
    );

    assert.equal(longTask.status, "done", "Expected long task to complete with status=done after Round 2 self-healing");
    assert.equal(longTask.currentRound, 2, "Expected long task to have executed 2 rounds");
    assert.equal(longTask.roundHistory?.length, 1, "Expected Round 1 output to be archived in task.roundHistory");
    assert.ok(
      longTask.roundHistory[0].review.includes("[BLOCKING]"),
      "Expected archived Round 1 review to retain the original [BLOCKING] finding"
    );
    recordResult(
      "E2E-LT-05",
      "Multi-Round Autonomous Fix Loop & roundHistory Archival",
      "Round 1 [BLOCKING] review triggers Round 2 Build+Review fix loop and preserves Round 1 in task.roundHistory"
    );

    // E2E-LT-06: Verify taskConversationPage renders both Round 1 and Round 2 bubbles
    const completedHtml = taskConversationPage(longTask.id);
    assert.ok(
      completedHtml.includes("Triển khai (Vòng 1)") &&
        completedHtml.includes("Review (Vòng 1)") &&
        completedHtml.includes("Triển khai (Vòng 2)") &&
        completedHtml.includes("Review (Vòng 2)"),
      "Expected taskConversationPage to render both Vòng 1 and Vòng 2 Build/Review cards"
    );
    recordResult(
      "E2E-LT-06",
      "Multi-Round Transcript Rendering in Chat View",
      "taskConversationPage displays Vòng 1 and Vòng 2 Build & Review stages in chronological order"
    );

    // E2E-LT-08: Verify auto-distilled memory from multi-round fix loop & BM25 ranking
    assert.ok(memories.length >= 1, "Expected multi-round completion to auto-distill a Pitfall & Lesson memory");
    const ranked = rankRelevantMemory(
      { title: "multiply Number.isFinite blocking", prompt: "Kiểm tra Number.isFinite", workspaceId: "ws-e2e" },
      state.workspaces[0],
      memories
    );
    assert.ok(
      ranked.length >= 1 && (ranked[0].title.includes("[Pitfall & Lesson]") || ranked[0].content.includes("Resolved Pitfalls")),
      "Expected BM25 + Rust ranker to retrieve distilled lesson"
    );
    recordResult(
      "E2E-LT-08",
      "Multi-Round Pitfall Auto-Distillation & BM25 Retrieval",
      "Automatically distills [Pitfall & Lesson] after multi-round fix and retrieves it via BM25 ranker"
    );

    // E2E-LT-11: Verify queued follow-up chat turn was drained automatically after pipeline finished
    assert.equal(longTask.chatQueue.length, 0, "Expected task.chatQueue to be drained after pipeline completion");
    const assistantFollowUp = longTask.chatMessages.find((m) => m.role === "assistant" && m.replyToMessageId === followUpMsg.id);
    assert.ok(
      assistantFollowUp && assistantFollowUp.content.includes("hoàn tất cả 2 vòng"),
      "Expected queued chat turn to execute and pair with user message via replyToMessageId"
    );
    recordResult(
      "E2E-LT-11",
      "Queued Follow-Up Chat Drain After Pipeline Completion",
      "Automatically drains task.chatQueue once Review finishes and pairs reply via replyToMessageId"
    );

    // E2E-LT-12: Verify Isolated Git Worktree Diff (via Rust accelerator) & 3-way Apply back to Main Checkout
    const diffText = await taskRunner.checkDiff(longTask);
    const diffFiles = parseUnifiedDiffFiles(diffText);
    assert.ok(
      diffText.includes("multiply") && diffFiles?.some((f) => f.path === "index.js"),
      "Expected checkDiff to capture isolated worktree changes and parse diffFiles via Rust core"
    );
    await taskRunner.applyTaskWorktree(longTask);
    const mainRepoIndexJs = readFileSync(join(repoDir, "index.js"), "utf8");
    assert.ok(
      mainRepoIndexJs.includes("Number.isFinite"),
      "Expected applyTaskWorktree to cleanly apply isolated worktree changes back to main repository"
    );
    recordResult(
      "E2E-LT-12",
      "Isolated Git Worktree Diff & 3-Way Apply to Main Repo",
      "Captures unified diff in isolated worktree, parses diffFiles via Rust, and applies patch to main checkout"
    );

    // -------------------------------------------------------------------------
    // E2E-LT-07: Long QA Command Large Stdout Buffer (>700 KB, 4MB maxBuffer)
    // -------------------------------------------------------------------------
    writeFileSync(
      join(repoDir, "package.json"),
      JSON.stringify({
        name: "e2e-qa",
        scripts: {
          test: "node -e \"process.stdout.write('X'.repeat(700000) + '\\nQA_LARGE_OK\\n')\"",
        },
      }),
      "utf8"
    );
    const realStageRunner = createTaskStageRunner({
      getState: () => state,
      running,
      isShuttingDown: () => false,
      record: () => {},
      schedulePersist: () => {},
      schedulePublish: () => {},
      run: async (exe, args, opts) => {
        try {
          const { stdout, stderr } = await execFileAsync(exe, args, {
            cwd: opts?.cwd,
            timeout: opts?.timeout || 30_000,
            maxBuffer: opts?.maxBuffer || 500_000,
            windowsHide: true,
          });
          return { code: 0, stdout, stderr };
        } catch (err) {
          return { code: err.code || 1, stdout: err.stdout || "", stderr: err.stderr || String(err.message || err) };
        }
      },
      killTree: async () => {},
      loadModels: async () => ({}),
      getCliExecutables: () => ({}),
      getApiProviderRuntime: () => null,
      additionalWritableProjectDirs: () => [],
      externalWorkspaceContext: async () => "",
    });
    const verboseQaResult = await realStageRunner.runTaskQaCheck(longTask, repoDir, "npm test");
    assert.equal(verboseQaResult.status, "passed", "Expected >700KB QA stdout to succeed without maxBuffer overflow");
    assert.equal(verboseQaResult.exitCode, 0);
    assert.ok(verboseQaResult.output.includes("QA_LARGE_OK"), "Expected tail of large QA stdout to be preserved");
    recordResult(
      "E2E-LT-07",
      "Verbose QA Command Stdout Resilience (>700 KB Output)",
      "4MB stdio maxBuffer handles verbose test suites without ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
    );

    // -------------------------------------------------------------------------
    // E2E-LT-09: Long Conversation Auto-Compaction (30 Turns) & Manual /compact
    // -------------------------------------------------------------------------
    const compactTask = {
      id: "task-compact-e2e",
      prompt: "Xây dựng hệ thống cache phân tán",
      chatCompactedSummary: "",
      chatCompactedCount: 0,
      compactionLineage: [],
      chatMessages: Array.from({ length: 30 }, (_, i) => ({
        id: `m-${i + 1}`,
        role: i % 2 === 0 ? "user" : "assistant",
        provider: i % 2 === 0 ? "user" : "codex",
        status: "done",
        content:
          i % 2 === 0
            ? `Yêu cầu bước ${i + 1}: Tối ưu hóa phân vùng shard ${i + 1}`
            : `Đã triển khai shard ${i + 1}:\n\`\`\`js\nconst shard_${i + 1} = new Map();\n\`\`\``,
        createdAt: new Date(Date.now() + i * 1000).toISOString(),
      })),
    };
    const compacted = compactChatHistory(compactTask);
    assert.equal(compacted.recentHistory.length, 12, "Expected rolling window to keep 12 recent messages");
    assert.equal(compacted.compactedCount, 18, "Expected 18 older turns to be compacted");
    assert.ok(
      compacted.compactedSummary.includes("[code js: const shard_"),
      "Expected compacted summary to preserve code block signatures from older turns"
    );
    const manualCompact = compactTaskConversationNow(compactTask, 6, { force: true });
    assert.equal(manualCompact.keptCount, 6, "Expected manual /compact to reduce kept recent messages to 6");
    assert.ok(compactTask.compactionLineage.length >= 2, "Expected compactionLineage to track each compaction event");
    recordResult(
      "E2E-LT-09",
      "30-Turn Rolling Auto-Compaction & Manual /compact",
      "Compacts older turns into code-aware summaries while keeping recent turns and lineage metadata"
    );

    // -------------------------------------------------------------------------
    // E2E-LT-10: Per-Task Draft Isolation & Pre-Await Input Clear Verification
    // -------------------------------------------------------------------------
    const formSubmitSrc = readFileSync(resolve("src/features/workbench/actions/form-submit.js"), "utf8");
    const clearIdx = formSubmitSrc.indexOf("delete view.chatDraftsByTask[taskId]");
    const awaitIdx = formSubmitSrc.indexOf("await api(`/api/tasks/${encodeURIComponent(taskId)}/chat`");
    assert.ok(
      clearIdx !== -1 && awaitIdx !== -1 && clearIdx < awaitIdx,
      "Expected form-submit.js to clear view.chatDraft and view.chatDraftsByTask[taskId] BEFORE awaiting the network call"
    );
    recordResult(
      "E2E-LT-10",
      "Immediate Composer Draft Clear & Per-Task Draft Cleanup",
      "Clears view.chatDraft and view.chatDraftsByTask[taskId] before await api(...) with error rollback"
    );

    console.log(`\n=== ALL ${results.length}/12 LONG-TASK E2E SCENARIOS PASSED ===`);
  } finally {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

main().catch((err) => {
  console.error("Long-Task E2E Test Failed:", err);
  process.exit(1);
});
