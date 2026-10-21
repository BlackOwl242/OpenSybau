import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { estimateTaskCostUsd, parseReviewFindings } from "../domain/task-flow.js";
import { allowedTextFile, resolveInside, safeRelativePath, usesSharedCheckout, within, workspaceLockKey } from "./fs-security.mjs";
import { parseSkillSelection } from "./skill-catalog.mjs";
import { parseUnifiedDiffFiles } from "./diff-parser.mjs";
import { publicProviderName, stageSelection } from "./task-prompts.mjs";
import { changedFilesSince, failQueuedChatTurns, finishStageRerun, mergeTaskArtifacts, recordTaskCycle } from "./task-stage-runner.mjs";

export function createTaskRunnerService({
  taskDir,
  worktreeDir,
  getState,
  running,
  busyWorkspaces,
  isolatedWorkspaces,
  isShuttingDown,
  persist,
  publish,
  record,
  safeError,
  git,
  withGitRepoLock,
  inspectWorkspace,
  relevantMemory,
  autoDistillTaskMemory,
  skillCatalogService,
  promptService,
  stageRunner,
}) {
  let schedulerActive = false;
  const {
    loadSkillCatalog,
    resolveSelectedSkills,
    rankSkillCandidatesScored,
    skillSelectionPrompt,
    stageAntigravitySkillBundles,
    stageAntigravitySkills,
  } = skillCatalogService;
  const { makePrompt, makeChatPrompt, makeInitialChatPrompt } = promptService;
  const { assertTaskActive, areTaskDependenciesMet, runTaskQaCheck, spawnStage } = stageRunner;

  async function cleanupTaskWorktrees(task) {
    const workspace = getState().workspaces.find((w) => w.id === task.workspaceId);
    const repoCandidate = workspace?.path || task.workspacePath;
    let repoRoot = null;
    if (repoCandidate && existsSync(repoCandidate)) {
      const info = await inspectWorkspace(repoCandidate).catch(() => null);
      if (info?.isGit) repoRoot = info.gitRoot || info.path;
    }
    const candidateDirs = new Set();
    if (task.worktreePath && within(worktreeDir, resolve(task.worktreePath)) && resolve(task.worktreePath) !== resolve(worktreeDir)) {
      candidateDirs.add(resolve(task.worktreePath));
    }
    try {
      const entries = await fs.readdir(worktreeDir, { withFileTypes: true });
      const prefix = `${task.id.toLowerCase()}-`;
      for (const entry of entries) {
        if (entry.isDirectory() && entry.name.toLowerCase().startsWith(prefix)) {
          candidateDirs.add(resolve(worktreeDir, entry.name));
        }
      }
    } catch { }
    if (!candidateDirs.size && !repoRoot) return;
    await withGitRepoLock(repoRoot || worktreeDir, async () => {
      for (const wtPath of candidateDirs) {
        if (repoRoot) await git(repoRoot, ["worktree", "remove", "--force", wtPath]).catch(() => {});
        await fs.rm(wtPath, { recursive: true, force: true }).catch(() => {});
      }
      if (repoRoot) {
        await git(repoRoot, ["worktree", "prune"]).catch(() => {});
        const branches = await git(repoRoot, ["branch", "--list", `workbench/${task.id.toLowerCase()}-*`]).catch(() => ({ code: -1, stdout: "" }));
        if (branches.code === 0 && branches.stdout) {
          for (const rawLine of branches.stdout.split(/\r?\n/)) {
            const branch = rawLine.replace(/^[*+]?\s+/, "").trim();
            if (branch.startsWith(`workbench/${task.id.toLowerCase()}-`)) {
              await git(repoRoot, ["branch", "-D", branch]).catch(() => {});
            }
          }
        }
      }
    });
  }

  async function executeTask(task) {
    const workspace = getState().workspaces.find((w) => w.id === task.workspaceId);
    if (!workspace) throw new Error("Workspace not found");
    const info = await inspectWorkspace(workspace.path);
    assertTaskActive(task);
    let cwd = info.path;
    task.workspaceRuntime = info;
    if (info.dirty && !task.isolated) record(task, "Workspace có thay đổi sẵn; diff sau task sẽ gồm cả thay đổi có trước.", "warning");
    task.storagePath = resolve(taskDir, task.id);
    await fs.mkdir(task.storagePath, { recursive: true });
    if (task.isolated) {
      const previousPath = resolve(task.executionPath || task.worktreePath || ".");
      const canReusePrevious = within(worktreeDir, previousPath) && previousPath !== resolve(worktreeDir) && existsSync(previousPath);
      const previousInfo = canReusePrevious ? await inspectWorkspace(previousPath).catch(() => null) : null;
      const previousRepoIsManaged = previousInfo?.path && within(resolve(worktreeDir), resolve(previousInfo.path)) && resolve(previousInfo.path) !== resolve(worktreeDir);
      if (previousInfo?.isGit && previousInfo.head && previousRepoIsManaged) {
        cwd = previousInfo.path;
        task.worktreePath = previousInfo.gitRoot || previousInfo.path;
      } else {
        if (!info.isGit || !info.head) throw new Error("Worktree requires a Git repository with at least one commit. Turn off isolation or create an initial commit first.");
        const attempt = Date.now().toString(36);
        const worktreeRoot = resolve(worktreeDir, `${task.id}-${attempt}`);
        const branchName = `workbench/${task.id.toLowerCase()}-${attempt}`;
        const repoRoot = info.gitRoot || info.path;
        const baseHead = await git(repoRoot, ["rev-parse", "--verify", "HEAD"]);
        const add = await withGitRepoLock(repoRoot, () => git(repoRoot, ["worktree", "add", "-b", branchName, worktreeRoot, "HEAD"]));
        if (add.code !== 0) throw new Error(add.stderr.trim() || "Could not create isolated Git worktree");
        task.worktreePath = worktreeRoot;
        task.worktreeBranch = branchName;
        task.worktreeBaseHead = baseHead.code === 0 ? (baseHead.stdout || "").trim() : null;
        task.worktreeCleaned = false;
        const selectedSubdirectory = relative(repoRoot, info.path);
        cwd = selectedSubdirectory ? resolve(worktreeRoot, selectedSubdirectory) : worktreeRoot;
        assertTaskActive(task);
      }
    } else {
      const lockKey = workspaceLockKey(info.path);
      const sameWorkspaceActive = [...running.entries()].some(([id, runInfo]) => id !== task.id && workspaceLockKey(runInfo.workspacePath) === lockKey && !runInfo.isolated);
      if (sameWorkspaceActive) throw new Error("This workspace already has a running shared-checkout task");
    }
    task.executionPath = cwd;
    task.status = "running";
    task.startedAt = new Date().toISOString();
    let effectiveResumeFrom = task.resumeFrom || "plan";
    if (effectiveResumeFrom === "build" && !task.plan) effectiveResumeFrom = "plan";
    else if (effectiveResumeFrom === "review" && (!task.plan || !task.implementation)) effectiveResumeFrom = !task.plan ? "plan" : "build";
    task.resumeFrom = task.resumeFrom ? effectiveResumeFrom : null;
    task.phase = task.config.workflow === "chat-only" ? "chat" : effectiveResumeFrom;
    const activeRerun = (task.stageRunHistory || []).find((item) => item.id === task.activeStageRunId);
    if (activeRerun) { activeRerun.status = "running"; activeRerun.startedAt = task.startedAt; }
    persist(); publish("task");
    const notes = relevantMemory(task, workspace);
    task.memoryUsed = notes.map((m) => ({ id: m.id, title: m.title }));
    if (notes.length) record(task, `Đã nạp ${notes.length} ghi chú phù hợp từ bộ nhớ cục bộ`, "memory");
    let skillIds = task.skillIds || [];
    let skillCatalog;
    if (task.skillSelectionMode !== "manual" && !task.skillSelectionCompleted) {
      skillCatalog = await loadSkillCatalog(workspace.id);
      assertTaskActive(task);
      const scoredCandidates = rankSkillCandidatesScored(task, skillCatalog);
      const candidates = scoredCandidates.map(({ skill }) => skill);
      task.skillCandidatesConsidered = candidates.length;
      if (candidates.length) {
        if (task.config.workflow === "chat-only") {
          const strongMatches = scoredCandidates.filter(({ score }) => score >= 10).slice(0, 3);
          skillIds = strongMatches.map(({ skill }) => skill.id);
          task.skillSelectionReason = skillIds.length
            ? `Đã tự động khớp nhanh ${skillIds.length} skill sát nhất với nội dung chat.`
            : "Không có skill nào vượt ngưỡng khớp trực tiếp cho lượt chat này.";
        } else {
          const selector = stageSelection(task, "plan");
          record(task, `${publicProviderName(selector.provider)} đang chọn skill phù hợp từ ${candidates.length} ứng viên tìm được trong thư viện`, "stage");
          const selectionOutput = await spawnStage(task, selector.provider, "skill-selection", cwd, skillSelectionPrompt(task, workspace, candidates), selector);
          const decision = parseSkillSelection(selectionOutput, candidates);
          skillIds = decision.ids;
          task.skillSelectionReason = decision.reason;
        }
      } else {
        skillIds = [];
        task.skillSelectionReason = "Không có skill khớp đủ gần với yêu cầu.";
        record(task, "Không tìm được skill phù hợp trực tiếp; tiếp tục với yêu cầu và workspace làm ngữ cảnh.", "memory");
      }
      task.skillSelectionMode = "auto";
      task.skillSelectionCompleted = true;
    }
    const skillInstructionsList = await resolveSelectedSkills(skillIds, workspace.id, skillCatalog);
    assertTaskActive(task);
    task.antigravitySkillDirs = task.config.workflow === "chat-only" && task.config.chatProvider !== "antigravity" ? [] : await stageAntigravitySkillBundles(task, skillInstructionsList);
    task.skillIds = skillInstructionsList.map((skill) => skill.id);
    task.skills = skillInstructionsList.map(({ id, name, source, sources, providers }) => ({ id, name, source, sources, providers }));
    if (task.skills.length) record(task, `${publicProviderName(task.config.workflow === "chat-only" ? task.config.chatProvider : stageSelection(task, "plan").provider)} tự chọn và nạp ${task.skills.length} skill vào stage phù hợp${task.antigravitySkillDirs.length ? ` · ${task.antigravitySkillDirs.length} bộ tài nguyên Antigravity` : ""}`, "memory");
    else if (task.skillSelectionMode === "auto" && task.skillCandidatesConsidered) record(task, task.skillSelectionReason || "Không chọn skill nào vì không có skill thật sự cần thiết.", "memory");
    persist(); publish("task");
    if (task.config.workflow === "chat-only") {
      const provider = task.config.chatProvider || "codex";
      const message = task.chatMessages?.find((item) => item.role === "user" && item.initialChat) || { id: randomUUID(), role: "user", provider, model: task.config.chatModel, effort: task.config.chatEffort, content: task.prompt, attachments: (task.attachments || []).map(({ name }) => ({ name })), status: "running", initialChat: true, createdAt: task.createdAt };
      task.chatMessages ||= [];
      if (!task.chatMessages.some((item) => item.id === message.id)) task.chatMessages.push(message);
      message.status = "running";
      persist(); record(task, `${publicProviderName(provider)} bắt đầu cuộc trò chuyện · ${task.config.chatModel} (${task.config.chatEffort})`, "stage");
      const chatConfig = { provider, model: task.config.chatModel, effort: task.config.chatEffort };
      try {
        const response = await spawnStage(task, provider, "chat-initial", cwd, makeInitialChatPrompt(task, notes, skillInstructionsList, workspace), chatConfig);
        assertTaskActive(task);
        message.status = "done";
        task.chatMessages.push({ id: randomUUID(), role: "assistant", replyToMessageId: message.id, provider, model: task.config.chatModel, effort: task.config.chatEffort, content: response || "CLI hoàn tất nhưng không trả nội dung văn bản.", createdAt: new Date().toISOString() });
        const answer = task.chatMessages.at(-1);
        const metric = task.stageMetrics?.at(-1);
        if (metric?.stage === "chat-initial") { answer.durationMs = metric.durationMs; answer.usage = metric.usage; }
        task.artifacts = mergeTaskArtifacts(task.artifacts, await changedFilesSince(cwd, Date.parse(task.startedAt)));
        assertTaskActive(task);
        task.status = "done"; task.phase = "done"; task.completedAt = new Date().toISOString();
        finishStageRerun(task, "done");
        record(task, "Cuộc trò chuyện đã sẵn sàng. Bạn có thể tiếp tục với agent đã chọn hoặc chuyển sang agent khác.", "success");
      } catch (error) {
        message.status = "failed";
        throw error;
      } finally { persist(); publish("task"); }
      return;
    }
    const planSelection = stageSelection(task, "plan");
    const planStartedAt = Date.now();
    const hadPlanBefore = Boolean(task.plan);
    const plan = task.plan || await spawnStage(task, planSelection.provider, "plan", cwd, makePrompt(task, "plan", "", notes, workspace, skillInstructionsList), planSelection);
    assertTaskActive(task);
    task.plan = plan;
    if (!hadPlanBefore) {
      recordTaskCycle(task, {
        id: "cycle-plan-1",
        round: 1,
        stage: "plan",
        title: "Round 1 · plan",
        provider: publicProviderName(planSelection.provider),
        model: planSelection.model || "",
        status: task.planGate && !task.planGateApprovedAt ? "awaiting_approval" : "clean",
        badge: task.planGate && !task.planGateApprovedAt ? "awaiting you" : "plan ready",
        blocking: 0,
        advisory: 0,
        turns: 1,
        durationMs: Date.now() - planStartedAt,
        summary: String(plan || "").slice(0, 600),
      });
    }
    if (task.planGate && !task.planGateApprovedAt) {
      assertTaskActive(task);
      task.status = "awaiting_approval";
      task.phase = "plan-gate";
      task.costUsd = estimateTaskCostUsd(task.usage);
      record(task, "Kế hoạch đã sẵn sàng tại Plan Gate (You). Chờ bạn bấm Duyệt & Triển khai (GO) hoặc gửi góp ý điều chỉnh.", "stage");
      persist();
      publish("task");
      return;
    }
    if (task.config.workflow === "plan-only") {
      assertTaskActive(task);
      task.costUsd = estimateTaskCostUsd(task.usage);
      task.status = "done"; task.phase = "done"; task.completedAt = new Date().toISOString();
      finishStageRerun(task, "done");
      autoDistillTaskMemory(task, workspace);
      record(task, "Hoàn tất kế hoạch (chưa chạy phần triển khai)", "success");
      return;
    }
    const buildSelection = stageSelection(task, "build");
    const reviewSelection = stageSelection(task, "review");
    const maxRounds = Math.max(1, Math.min(3, Number(task.maxRounds) || 1));
    let round = Math.max(1, Number(task.currentRound) || 1);
    let previousReview = task.review || "";
    let previousQaOutput = task.qaResult?.output || "";

    while (round <= maxRounds) {
      task.currentRound = round;
      const skipBuildForReviewOnlyRerun = round === 1 && task.resumeFrom === "review" && Boolean(task.implementation);
      if (!skipBuildForReviewOnlyRerun) {
        record(
          task,
          round === 1
            ? `Handoff ${publicProviderName(planSelection.provider)} → ${publicProviderName(buildSelection.provider)} · kế hoạch được chuyển sang stage triển khai.`
            : `Vòng tự sửa lỗi ${round}/${maxRounds} · Chuyển phản hồi Review/QA sang ${publicProviderName(buildSelection.provider)} để khắc phục lỗi blocking.`,
          "handoff"
        );
        task.phase = "build"; persist(); publish("task");
        const buildStartedAt = Date.now();
        const toolCountBefore = (task.events || []).filter((e) => e.kind === "tool").length;
        const implementation = await spawnStage(
          task,
          buildSelection.provider,
          "build",
          cwd,
          makePrompt(task, "build", plan, notes, workspace, skillInstructionsList, { round, previousReview, previousQaOutput }),
          buildSelection
        );
        assertTaskActive(task);
        task.implementation = implementation || `${publicProviderName(buildSelection.provider)} hoàn tất nhưng không gửi văn bản cuối. Kiểm tra danh sách tệp/diff bên dưới.`;
        await fs.writeFile(resolve(task.storagePath, "implementation.md"), task.implementation, "utf8");
        task.artifacts = mergeTaskArtifacts(task.artifacts, await changedFilesSince(cwd, Math.min(Date.parse(task.startedAt) || buildStartedAt, buildStartedAt)));
        const toolTurns = Math.max(1, (task.events || []).filter((e) => e.kind === "tool").length - toolCountBefore);
        recordTaskCycle(task, {
          id: `cycle-build-${round}`,
          round,
          stage: "build",
          title: round > 1 ? `Round ${round} · implement (fix r${round - 1})` : `Round ${round} · implement`,
          provider: publicProviderName(buildSelection.provider),
          model: buildSelection.model || "",
          status: "clean",
          badge: `${(task.artifacts || []).length} files`,
          blocking: 0,
          advisory: 0,
          turns: toolTurns,
          durationMs: Date.now() - buildStartedAt,
          summary: String(task.implementation || "").slice(0, 600),
        });
      }

      record(task, `Handoff ${publicProviderName(buildSelection.provider)} → ${publicProviderName(reviewSelection.provider)} · stage triển khai đã kết thúc; reviewer bắt đầu kiểm tra (Round ${round}).`, "handoff");
      task.resumeFrom = null;
      task.phase = "review"; persist(); publish("task");
      const reviewStartedAt = Date.now();
      const review = await spawnStage(task, reviewSelection.provider, "review", cwd, makePrompt(task, "review", plan, notes, workspace, skillInstructionsList, { round }), reviewSelection);
      assertTaskActive(task);
      task.review = review;
      const findings = parseReviewFindings(review);
      task.reviewFindings = findings;
      task.artifacts = mergeTaskArtifacts(task.artifacts, await changedFilesSince(cwd, Date.parse(task.startedAt)));
      recordTaskCycle(task, {
        id: `cycle-review-${round}`,
        round,
        stage: "review",
        title: `Round ${round} · review`,
        provider: publicProviderName(reviewSelection.provider),
        model: reviewSelection.model || "",
        status: findings.blocking > 0 ? "blocking" : "clean",
        badge: findings.blocking > 0 ? `${findings.blocking} blocking` : "clean",
        blocking: findings.blocking,
        advisory: findings.advisory,
        turns: 1,
        durationMs: Date.now() - reviewStartedAt,
        summary: String(review || "").slice(0, 600),
      });

      if (task.qaCommand) {
        task.phase = "qa"; persist(); publish("task");
        const qaRes = await runTaskQaCheck(task, cwd, task.qaCommand).catch((err) => ({
          command: task.qaCommand,
          status: "failed",
          exitCode: 1,
          durationMs: 0,
          summary: `QA lỗi: ${safeError(err)}`,
          output: safeError(err),
        }));
        assertTaskActive(task);
        recordTaskCycle(task, {
          id: `cycle-qa-${round}`,
          round,
          stage: "qa",
          title: `QA · ${qaRes.status === "passed" ? "specs passed" : "specs failed"}`,
          provider: "QA Runner",
          model: qaRes.command || "",
          status: qaRes.status === "passed" ? "clean" : "blocking",
          badge: qaRes.summary || qaRes.status,
          blocking: qaRes.status === "failed" ? 1 : 0,
          advisory: 0,
          turns: 1,
          durationMs: qaRes.durationMs || 1000,
          summary: String(qaRes.output || "").slice(0, 600),
        });
      }

      const needFixLoop = (findings.blocking > 0 || task.qaResult?.status === "failed") && round < maxRounds && task.permissionPreset !== "read-only";
      if (needFixLoop) {
        previousReview = review;
        previousQaOutput = task.qaResult?.status === "failed" ? task.qaResult.output : "";
        record(
          task,
          `Phát hiện ${findings.blocking} lỗi blocking${task.qaResult?.status === "failed" ? " và QA thất bại" : ""} ở Round ${round}. Tự động kích hoạt Round ${round + 1}/${maxRounds} để sửa triệt để.`,
          "warning"
        );
        round += 1;
        continue;
      }
      break;
    }

    assertTaskActive(task);
    task.costUsd = estimateTaskCostUsd(task.usage);
    record(task, `${publicProviderName(reviewSelection.provider)} review hoàn tất · xem kết quả và diff trong task detail.`, "handoff");
    task.status = "done"; task.phase = "done"; task.completedAt = new Date().toISOString();
    finishStageRerun(task, "done");
    autoDistillTaskMemory(task, workspace);
    record(task, `Hoàn tất luồng ${publicProviderName(planSelection.provider)} → ${publicProviderName(buildSelection.provider)} → ${publicProviderName(reviewSelection.provider)} (${round} vòng). Thay đổi nằm trong workspace hiển thị bên dưới.`, "success");
  }

  function drainQueuedChats() {
    if (isShuttingDown()) return;
    const state = getState();
    for (const candidate of state.tasks) {
      if (!candidate.chatQueue?.length || candidate.status === "queued") continue;
      if (running.has(candidate.id)) continue;
      const ws = state.workspaces.find((w) => w.id === candidate.workspaceId);
      if (!ws) continue;
      const sharedCheckout = usesSharedCheckout(candidate);
      const lockKey = workspaceLockKey(sharedCheckout ? ws.path : (candidate.executionPath || candidate.worktreePath || ws.path));
      if (sharedCheckout && busyWorkspaces.has(lockKey)) continue;
      void processTaskChatQueue(candidate);
    }
  }

  async function processTaskChatQueue(task) {
    if (isShuttingDown() || !task.chatQueue?.length) return;
    const workspace = getState().workspaces.find((item) => item.id === task.workspaceId);
    if (!workspace) return;
    const existingRun = running.get(task.id);
    if (existingRun && !existingRun.isChat) return;
    const sharedCheckout = usesSharedCheckout(task);
    const lockPath = sharedCheckout ? workspace.path : (task.executionPath || task.worktreePath || workspace.path);
    const lockKey = workspaceLockKey(lockPath);
    if (!existingRun && sharedCheckout && busyWorkspaces.has(lockKey)) {
      return;
    }
    if (!existingRun) {
      running.set(task.id, { child: null, stopped: false, workspacePath: lockKey, isolated: !sharedCheckout, isChat: true });
      if (sharedCheckout && lockKey) busyWorkspaces.add(lockKey);
    }
    const restoreStatus = task.status === "running" ? (task.preChatStatus || "done") : task.status;
    const restorePhase = task.phase === "chat" ? (task.preChatPhase || (restoreStatus === "done" ? "done" : restoreStatus)) : task.phase;
    task.preChatStatus = restoreStatus;
    task.preChatPhase = restorePhase;
    task.chatResumeState = { status: restoreStatus, phase: restorePhase };
    task.status = "running"; task.phase = "chat";
    try { persist(); } catch {}
    publish("task");
    let anyTurnSucceeded = false;
    let wasStopped = false;
    try {
      task.storagePath ||= resolve(taskDir, task.id);
      await fs.mkdir(task.storagePath, { recursive: true }).catch(() => {});
      if ((task.skillIds || []).length || (task.skills || []).length) {
        await loadSkillCatalog(workspace.id).catch(() => []);
      }
      while (task.chatQueue.length && !running.get(task.id)?.stopped) {
        const turn = task.chatQueue.shift();
        const userMessage = task.chatMessages?.find((item) => item.id === turn.messageId);
        if (userMessage) userMessage.status = "running";
        record(task, `${publicProviderName(turn.provider)} nhận tin nhắn · ${turn.model} (${turn.effort})`, "stage");
        try {
          const turnStartedAt = Date.now();
          const cwd = sharedCheckout ? workspace.path : (task.executionPath || task.worktreePath || workspace.path);
          if (turn.provider === "antigravity" && ((task.skills || []).length > 0 || (task.skillIds || []).length > 0) && !(task.antigravitySkillDirs || []).length) {
            task.antigravitySkillDirs = await stageAntigravitySkills(task);
          }
          const prompt = makeChatPrompt(task, turn);
          const chatConfig = { provider: turn.provider, model: turn.model, effort: turn.effort };
          const response = await spawnStage(task, turn.provider, `chat-${turn.id}`, cwd, prompt, chatConfig);
          assertTaskActive(task);
          const turnChanges = await changedFilesSince(cwd, turnStartedAt);
          if (turnChanges.length) {
            task.artifacts = mergeTaskArtifacts(task.artifacts, turnChanges);
            if (!task.worktreeCleaned && task.worktreePath) task.worktreeAppliedAt = null;
          }
          if (userMessage) userMessage.status = "done";
          anyTurnSucceeded = true;
          task.chatMessages ||= [];
          const answer = { id: randomUUID(), role: "assistant", replyToMessageId: userMessage?.id, provider: turn.provider, model: turn.model, effort: turn.effort, content: response || "CLI hoàn tất nhưng không trả nội dung văn bản.", createdAt: new Date().toISOString() };
          const metric = task.stageMetrics?.at(-1);
          if (metric?.stage === `chat-${turn.id}`) { answer.durationMs = metric.durationMs; answer.usage = metric.usage; }
          task.chatMessages.push(answer);
          record(task, `${publicProviderName(turn.provider)} đã trả lời trong chat.`, "success");
        } catch (error) {
          const messageError = safeError(error);
          if (userMessage) { userMessage.status = "failed"; userMessage.error = messageError; }
          record(task, `${publicProviderName(turn.provider)} chat lỗi: ${messageError}`, "error");
          if (running.get(task.id)?.stopped) { wasStopped = true; break; }
        }
        try { persist(); } catch {}
        publish("task");
      }
    } finally {
      const runInfo = running.get(task.id);
      if (runInfo?.stopped) wasStopped = true;
      if (!isShuttingDown()) {
        if (task.config?.workflow === "chat-only" && anyTurnSucceeded && !wasStopped) {
          task.status = "done";
          task.phase = "done";
          task.error = null;
          task.failedPhase = null;
        } else if (task.status === "running") {
          task.status = restoreStatus;
          task.phase = restorePhase;
        }
      }
      task.preChatStatus = null;
      task.preChatPhase = null;
      task.chatResumeState = null;
      if (runInfo?.workspacePath && !runInfo.isolated) busyWorkspaces.delete(workspaceLockKey(runInfo.workspacePath));
      running.delete(task.id);
      try { persist(); } catch {}
      publish("task");
      if (task.chatQueue?.length && !wasStopped && !isShuttingDown()) void processTaskChatQueue(task);
      drainQueuedChats();
      pump();
    }
  }

  function pump() {
    if (isShuttingDown() || schedulerActive) return;
    schedulerActive = true;
    queueMicrotask(async () => {
      try {
        while (!isShuttingDown()) {
          const state = getState();
          const hasQueuedFanout = state.tasks.some((item) => item.status === "queued" && item.fanoutId && item.isolated);
          const activeFanoutTaskCount = hasQueuedFanout
            ? state.tasks.filter((item) => item.fanoutId && item.isolated && (item.status === "queued" || running.has(item.id))).length
            : 0;
          const maxConcurrent = Math.max(1, Math.min(8, Math.max(Number(state.settings.maxConcurrent) || 1, activeFanoutTaskCount)));
          if (running.size >= maxConcurrent) break;
          const task = state.tasks.find((item) => {
            const path = state.workspaces.find((w) => w.id === item.workspaceId)?.path;
            const lockKey = workspaceLockKey(path);
            return item.status === "queued" && !running.has(item.id) && Boolean(lockKey) && areTaskDependenciesMet(item) && (item.isolated || !busyWorkspaces.has(lockKey));
          });
          if (!task) break;
          const workspacePath = state.workspaces.find((w) => w.id === task.workspaceId)?.path;
          const lockKey = workspaceLockKey(workspacePath);
          running.set(task.id, { child: null, stopped: false, workspacePath: lockKey, isolated: task.isolated });
          if (!task.isolated && lockKey) busyWorkspaces.add(lockKey);
          if (task.isolated && lockKey) isolatedWorkspaces.set(lockKey, (isolatedWorkspaces.get(lockKey) || 0) + 1);
          executeTask(task).catch((error) => {
            if (task.status === "cancelled") { finishStageRerun(task, "cancelled", "Đã dừng theo yêu cầu."); try { persist(); } catch {} publish("task"); return; }
            if (isShuttingDown() || running.get(task.id)?.shuttingDown) return;
            task.failedPhase = task.phase;
            task.status = running.get(task.id)?.stopped ? "cancelled" : "failed";
            task.phase = task.status;
            task.error = safeError(error);
            finishStageRerun(task, task.status, task.error);
            record(task, task.error, "error");
          }).finally(() => {
            const runInfo = running.get(task.id);
            const runKey = workspaceLockKey(runInfo?.workspacePath);
            if (runKey && !runInfo.isolated) busyWorkspaces.delete(runKey);
            if (runKey && runInfo.isolated) {
              const count = (isolatedWorkspaces.get(runKey) || 1) - 1;
              if (count <= 0) isolatedWorkspaces.delete(runKey); else isolatedWorkspaces.set(runKey, count);
            }
            running.delete(task.id);
            if (task.status !== "done" && task.status !== "awaiting_approval" && task.chatQueue?.length) {
              failQueuedChatTurns(task);
            }
            try { persist(); } catch {}
            publish("task");
            if (task.chatQueue?.length && (task.status === "done" || task.status === "awaiting_approval") && !isShuttingDown()) void processTaskChatQueue(task);
            drainQueuedChats();
            pump();
          });
        }
      } finally { schedulerActive = false; }
    });
  }

  async function checkDiff(task) {
    const state = getState();
    const cwd = task.executionPath || state.workspaces.find((w) => w.id === task.workspaceId)?.path;
    if (!cwd || !task.worktreePath && !state.workspaces.find((w) => w.id === task.workspaceId)?.path) return "";
    const info = await inspectWorkspace(cwd).catch(() => ({ isGit: false, head: false }));
    if (!info.isGit || !info.head) {
      const artifacts = task.artifacts || await changedFilesSince(cwd, Date.parse(task.startedAt || task.createdAt));
      return artifacts.length ? `Git diff không khả dụng ở workspace này. Tệp được tạo hoặc sửa trong lượt chạy:\n${artifacts.map((file) => `- ${file}`).join("\n")}` : "Workspace chưa có Git commit và không có tệp nào đổi sau khi task bắt đầu.";
    }
    const head = await git(cwd, ["rev-parse", "--verify", "HEAD"]);
    if (head.code !== 0) return "Git chưa có commit gốc. Task vẫn chạy trong thư mục thật, nhưng Git chưa thể tạo diff đối chiếu.";
    const diffArgs = task.isolated && task.worktreeBaseHead ? ["diff", "--no-ext-diff", "--no-color", task.worktreeBaseHead] : ["diff", "--no-ext-diff", "--no-color"];
    const result = await git(cwd, diffArgs);
    let diff = result.stdout || "";
    const untracked = await git(cwd, ["ls-files", "--others", "--exclude-standard"]);
    for (const rel of (untracked.stdout || "").split(/\r?\n/).filter(Boolean).slice(0, 30)) {
      try {
        const candidate = resolve(cwd, safeRelativePath(rel));
        const lstat = await fs.lstat(candidate);
        if (!lstat.isFile() || lstat.isSymbolicLink() || lstat.size > 180_000) continue;
        const { target: file } = await resolveInside(cwd, rel, true);
        if (!allowedTextFile(file)) continue;
        const content = await fs.readFile(file, "utf8");
        const contentLines = content.split(/\r?\n/);
        diff += `\ndiff --git a/${rel} b/${rel}\n--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${contentLines.length} @@\n` + contentLines.map((line) => `+${line}`).join("\n") + "\n";
      } catch { }
    }
    return diff.slice(0, 1_000_000);
  }

  async function applyTaskWorktree(task, { cleanup = false } = {}) {
    if (!task.isolated || !task.worktreePath || task.worktreeCleaned || !existsSync(task.worktreePath)) {
      throw new Error("Task này không có Git worktree cô lập đang hoạt động để áp dụng.");
    }
    if (running.has(task.id) || ["queued", "running"].includes(task.status)) {
      throw new Error("Hãy đợi task kết thúc trước khi áp dụng worktree vào dự án chính.");
    }
    const workspace = getState().workspaces.find((w) => w.id === task.workspaceId);
    if (!workspace) throw new Error("Workspace của task không còn tồn tại.");
    const info = await inspectWorkspace(workspace.path);
    if (!info.isGit) throw new Error("Workspace chính không phải là Git repository.");
    const lockKey = workspaceLockKey(info.path);
    if (busyWorkspaces.has(lockKey)) throw new Error("Workspace chính đang có task khác chạy; hãy đợi hoàn tất trước khi áp dụng worktree.");
    busyWorkspaces.add(lockKey);
    const repoRoot = info.gitRoot || info.path;
    const wtRoot = resolve(task.worktreePath);
    let appliedFiles = [];
    try {
      await withGitRepoLock(repoRoot, async () => {
        await git(wtRoot, ["add", "-A"]);
        const baseRef = task.worktreeBaseHead || "HEAD";
        const patchRes = await git(wtRoot, ["diff", "--cached", "--binary", "--full-index", baseRef]);
        const namesRes = await git(wtRoot, ["diff", "--cached", "--name-only", baseRef]);
        await git(wtRoot, ["reset"]).catch(() => {});
        const patchContent = patchRes.stdout || "";
        if (!patchContent.trim()) throw new Error("Worktree không có thay đổi nào để áp dụng vào dự án chính.");
        appliedFiles = (namesRes.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        if (!appliedFiles.length) {
          appliedFiles = parseUnifiedDiffFiles(patchContent).map((f) => f.path).filter(Boolean);
        }
        await fs.mkdir(task.storagePath, { recursive: true });
        const patchPath = resolve(task.storagePath, "apply-worktree.patch");
        await fs.writeFile(patchPath, patchContent, "utf8");
        let applyRes = await git(repoRoot, ["apply", "--3way", "--whitespace=nowarn", patchPath]);
        if (applyRes.code !== 0) applyRes = await git(repoRoot, ["apply", "--whitespace=nowarn", patchPath]);
        if (applyRes.code !== 0) {
          throw new Error(`Không thể tự động áp dụng worktree (có xung đột Git): ${(applyRes.stderr || applyRes.stdout || "git apply failed").trim().slice(0, 400)}`);
        }
      });
      task.worktreeAppliedAt = new Date().toISOString();
      task.appliedFiles = appliedFiles;
      if (cleanup) {
        await cleanupTaskWorktrees(task);
        task.worktreeCleaned = true;
        task.executionPath = task.workspacePath;
      }
      workspace.runtime = await inspectWorkspace(workspace.path).catch(() => workspace.runtime);
      record(task, `Đã áp dụng thay đổi từ Git worktree (${task.worktreeBranch || basename(wtRoot)}) vào dự án chính.${cleanup ? " Đã dọn dẹp worktree." : ""}`, "success");
      persist();
      publish("tasks");
      return task;
    } finally {
      busyWorkspaces.delete(lockKey);
      drainQueuedChats();
      pump();
    }
  }

  async function discardTaskWorktree(task) {
    if (!task.isolated || !task.worktreePath || task.worktreeCleaned) {
      throw new Error("Task này không còn Git worktree cô lập cần dọn dẹp.");
    }
    if (running.has(task.id) || ["queued", "running"].includes(task.status)) {
      throw new Error("Hãy dừng hoặc đợi task kết thúc trước khi dọn worktree.");
    }
    await cleanupTaskWorktrees(task);
    task.worktreeCleaned = true;
    task.executionPath = task.workspacePath;
    record(task, "Đã dọn dẹp Git worktree cô lập của task.", "info");
    persist();
    publish("tasks");
  }

  return {
    cleanupTaskWorktrees,
    executeTask,
    drainQueuedChats,
    processTaskChatQueue,
    pump,
    checkDiff,
    applyTaskWorktree,
    discardTaskWorktree,
  };
}
