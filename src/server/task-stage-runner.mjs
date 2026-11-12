import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { completeWithApi } from "./provider-registry.mjs";
import { workflowRoles } from "../domain/agent-roles.js";
import { estimateTaskCostUsd } from "../domain/task-flow.js";
import { applyApiBuildResult, executeApiWorkspaceTool, parseApiToolCall } from "./api-build-ops.mjs";
import { usesSharedCheckout } from "./fs-security.mjs";
import {
  createAgyStreamContext,
  createClaudeStreamContext,
  createCodexStreamContext,
  createStageSubagentTracker,
  enrichCodexSubagentsFromRollouts,
  parseAgyStreamLine,
  parseClaudeStreamLine,
  parseCodexStreamLine,
} from "./subagent-tracker.mjs";
import { addTaskUsage, publicProviderName, roleLabel, stageSelection } from "./task-prompts.mjs";
import { CodexAppServer } from "./codex-app-server.mjs";
import { trackCodexAppEvent } from "./codex-app-events.mjs";
import { effectiveCliPermissions } from "../domain/cli-permissions.js";
import { CliApprovalQueue } from "./cli-approval-queue.mjs";
import { interruptCommandActivities } from "./tool-activity.mjs";

export function finishStageRerun(task, status, error = "") {
  const attempt = (task.stageRunHistory || []).find((item) => item.id === task.activeStageRunId);
  if (attempt) {
    attempt.status = status;
    attempt.completedAt = new Date().toISOString();
    if (error) attempt.error = String(error).slice(0, 8000);
  }
  task.activeStageRunId = null;
}

export function failQueuedChatTurns(task, includeRunning = false) {
  const queuedMessageIds = new Set((task.chatQueue || []).map((turn) => turn.messageId));
  let failedCount = 0;
  for (const message of task.chatMessages || []) {
    if ((message.status === "queued" && queuedMessageIds.has(message.id)) || (includeRunning && message.status === "running")) {
      message.status = "failed";
      failedCount += 1;
    }
  }
  task.chatQueue = [];
  task.chatResumeState = null;
  return failedCount;
}

export function mergeTaskArtifacts(existing = [], latest = []) {
  return [...new Set([...(Array.isArray(existing) ? existing : []), ...(Array.isArray(latest) ? latest : [])])].sort();
}

export function recordTaskCycle(task, cycleInput) {
  task.cycles ||= [];
  task.costUsd = estimateTaskCostUsd(task.usage);
  const entry = {
    id: cycleInput.id || `cycle-${randomUUID().slice(0, 8)}`,
    round: Number(cycleInput.round || task.currentRound || 1),
    stage: String(cycleInput.stage || "build"),
    title: String(cycleInput.title || `Round ${Number(cycleInput.round || 1)} · ${cycleInput.stage || "stage"}`),
    provider: String(cycleInput.provider || "Agent"),
    model: String(cycleInput.model || ""),
    status: String(cycleInput.status || "clean"),
    badge: String(cycleInput.badge || "clean"),
    blocking: Number(cycleInput.blocking || 0),
    advisory: Number(cycleInput.advisory || 0),
    turns: Math.max(1, Number(cycleInput.turns || 1)),
    durationMs: Math.max(0, Number(cycleInput.durationMs || 0)),
    durationMin: Math.max(1, Math.round(Math.max(1000, Number(cycleInput.durationMs || 1000)) / 60000)),
    costUsd: Number(cycleInput.costUsd ?? task.costUsd ?? 0),
    summary: String(cycleInput.summary || "").slice(0, 1200),
    completedAt: new Date().toISOString(),
  };
  const existingIdx = task.cycles.findIndex((item) => item.id === entry.id || (item.round === entry.round && item.stage === entry.stage));
  if (existingIdx >= 0) task.cycles[existingIdx] = entry;
  else task.cycles.push(entry);
  task.cycles = task.cycles.slice(-24);
}

function buildNpmCommandSpec(args, label) {
  if (process.platform === "win32") {
    const npmCliJs = resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
    if (existsSync(npmCliJs)) {
      return { executable: process.execPath, args: [npmCliJs, ...args], label, shell: false };
    }
  }
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  return { executable: npmBin, args, label, shell: false };
}

function buildNpxCommandSpec(args, label) {
  if (process.platform === "win32") {
    const npxCliJs = resolve(dirname(process.execPath), "node_modules/npm/bin/npx-cli.js");
    if (existsSync(npxCliJs)) {
      return { executable: process.execPath, args: [npxCliJs, ...args], label, shell: false };
    }
  }
  const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";
  return { executable: npxBin, args, label, shell: false };
}

export async function resolveSafeExecCommand(rawCommand, cwd) {
  const cmd = String(rawCommand || "npm test").trim();
  const presets = {
    "npm test": buildNpmCommandSpec(["test"], "npm test"),
    "npm run build": buildNpmCommandSpec(["run", "build"], "npm run build"),
    "npm run lint": buildNpmCommandSpec(["run", "lint"], "npm run lint"),
    "npm run check": buildNpmCommandSpec(["run", "check"], "npm run check"),
    "npm run typecheck": buildNpmCommandSpec(["run", "typecheck"], "npm run typecheck"),
    "node --test": { executable: process.execPath, args: ["--test"], label: "node --test", shell: false },
    "pytest": { executable: process.platform === "win32" ? "pytest.exe" : "pytest", args: ["-q"], label: "pytest -q", shell: false },
    "cargo test": { executable: process.platform === "win32" ? "cargo.exe" : "cargo", args: ["test"], label: "cargo test", shell: false },
    "go test ./...": { executable: process.platform === "win32" ? "go.exe" : "go", args: ["test", "./..."], label: "go test ./...", shell: false },
    "git status": { executable: "git", args: ["status", "--short", "--branch"], label: "git status --short --branch", shell: false },
    "git status --short": { executable: "git", args: ["status", "--short"], label: "git status --short", shell: false },
    "git log": { executable: "git", args: ["log", "-n", "8", "--oneline", "--decorate"], label: "git log -n 8 --oneline", shell: false },
    "git diff --stat": { executable: "git", args: ["diff", "--stat"], label: "git diff --stat", shell: false },
    "vitest run": buildNpxCommandSpec(["--no-install", "vitest", "run"], "npx vitest run"),
  };
  if (presets[cmd]) return presets[cmd];
  const nodeCheckMatch = cmd.match(/^node\s+--check(?:\s+([\w./-]+))?$/);
  if (nodeCheckMatch) {
    const relTarget = nodeCheckMatch[1] ? nodeCheckMatch[1].trim() : "server.mjs";
    if (!relTarget.includes("..") && !relTarget.startsWith("/")) {
      return { executable: process.execPath, args: ["--check", relTarget], label: `node --check ${relTarget}`, shell: false };
    }
  }
  const npmRunMatch = cmd.match(/^npm\s+run\s+([\w:.-]{1,64})$/);
  if (npmRunMatch) {
    const scriptName = npmRunMatch[1];
    try {
      const pkgRaw = await fs.readFile(resolve(cwd, "package.json"), "utf8");
      const pkg = JSON.parse(pkgRaw);
      if (pkg?.scripts && Object.prototype.hasOwnProperty.call(pkg.scripts, scriptName)) {
        return buildNpmCommandSpec(["run", scriptName], `npm run ${scriptName}`);
      }
    } catch { }
    throw new Error(`Script "${scriptName}" không tồn tại trong package.json của workspace.`);
  }
  throw new Error("Chỉ cho phép chạy các lệnh kiểm thử/build chuẩn trong danh sách an toàn hoặc script có trong package.json.");
}

export async function changedFilesSince(cwd, startTime) {
  const changed = [];
  const startedAtMs = Number.isFinite(startTime) ? startTime : Date.now();
  const cutoff = startedAtMs - 1000;
  const ignored = new Set([".git", ".runtime", "node_modules", "dist", "build", "release", "out", "target", ".next", "coverage", "vendor", ".venv", "venv", ".cache", ".turbo", ".parcel-cache", "__pycache__", ".gradle"]);
  async function visit(directory, relativePath = "", depth = 0) {
    if (depth > 12) return;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    const subdirs = [];
    const files = [];
    for (const entry of entries) {
      if (ignored.has(entry.name.toLowerCase()) || entry.isSymbolicLink()) continue;
      const absolute = resolve(directory, entry.name);
      const rel = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory()) subdirs.push([absolute, rel]);
      else if (entry.isFile()) files.push([absolute, rel]);
    }
    if (files.length) {
      await Promise.all(files.map(async ([absolute, rel]) => {
        try {
          const stat = await fs.stat(absolute);
          if (stat.mtimeMs >= cutoff) changed.push({ rel, mtimeMs: stat.mtimeMs });
        } catch { }
      }));
    }
    for (const [absolute, rel] of subdirs) {
      await visit(absolute, rel, depth + 1);
    }
  }
  await visit(cwd);
  changed.sort((a, b) => (b.mtimeMs - a.mtimeMs) || a.rel.localeCompare(b.rel));
  return changed.slice(0, 100).map((item) => item.rel);
}

export function hasFailedTaskDependency(state, task) {
  const deps = Array.isArray(task?.dependsOn) ? task.dependsOn : [];
  if (!deps.length) return false;
  const tasks = Array.isArray(state) ? state : (Array.isArray(state?.tasks) ? state.tasks : []);
  for (const depRef of deps) {
    const ref = String(depRef || "").trim();
    if (!ref) continue;
    const parent = tasks.find(
      (item) => item.id === ref || (item.code && String(item.code).toUpperCase() === ref.toUpperCase())
    );
    if (parent && parent.id !== task.id && (parent.status === "failed" || parent.status === "cancelled")) {
      return true;
    }
  }
  return false;
}

export function createTaskStageRunner({
  getState,
  running,
  isShuttingDown,
  record,
  schedulePersist,
  schedulePublish,
  run,
  killTree,
  loadModels,
  getCliExecutables,
  getApiProviderRuntime,
  additionalWritableProjectDirs,
  externalWorkspaceContext,
  subagentCatalogService = null,
}) {
  const managedCommands = new Map();
  function cancelManagedCommand(taskId, commandId) {
    const entry = managedCommands.get(commandId);
    if (!entry || entry.task.id !== taskId || entry.cancelled) return false;
    entry.cancelled = true; entry.history.status = "stopping";
    if (entry.child) killTree(entry.child);
    record(entry.task, "Đã gửi yêu cầu dừng lệnh do OpenSybau quản lý.", "warning", { source: "opensybau", commandId });
    schedulePersist?.(); schedulePublish?.("task"); return true;
  }
  function cancelManagedCommands(taskId) { for (const [id, entry] of managedCommands) if (entry.task.id === taskId) cancelManagedCommand(taskId, id); }
  function assertTaskActive(task) {
    const runInfo = running.get(task.id);
    if (isShuttingDown() || runInfo?.stopped) throw new Error(isShuttingDown() ? "OpenSybau is shutting down." : "Stopped by user");
  }

  function areTaskDependenciesMet(task) {
    const deps = Array.isArray(task?.dependsOn) ? task.dependsOn : [];
    if (!deps.length) return true;
    const state = getState();
    if (hasFailedTaskDependency(state, task)) return false;
    const tasks = state.tasks;
    for (const depRef of deps) {
      const ref = String(depRef || "").trim();
      if (!ref) continue;
      const parent = tasks.find(
        (item) => item.id === ref || (item.code && String(item.code).toUpperCase() === ref.toUpperCase())
      );
      if (parent && parent.id !== task.id && (parent.status === "failed" || parent.status === "cancelled" || parent.status !== "done")) {
        return false;
      }
    }
    return true;
  }

  async function runTaskQaCheck(task, cwd, rawCommand = "") {
    if ([...managedCommands.values()].some((entry) => entry.task.id === task.id)) throw new Error("Task đang có lệnh QA/terminal chạy.");
    const targetCwd = cwd || task.executionPath || task.workspacePath;
    if (!targetCwd || !existsSync(targetCwd)) throw new Error("Thư mục thực thi của task không tồn tại.");
    let commandToRun = String(rawCommand || task.qaCommand || "").trim();
    if (!commandToRun) {
      try {
        const pkg = JSON.parse(await fs.readFile(resolve(targetCwd, "package.json"), "utf8"));
        if (pkg?.scripts?.test) commandToRun = "npm test";
        else if (pkg?.scripts?.check) commandToRun = "npm run check";
        else if (pkg?.scripts?.build) commandToRun = "npm run build";
      } catch { }
    }
    if (!commandToRun) commandToRun = "git status";
    if (task.permissionPreset === "read-only" && /^npm\s+(?:test|t|run\b)/i.test(commandToRun)) {
      const blockedMsg = `Đã bỏ qua "${commandToRun}": package.json scripts bị chặn trong chế độ read-only (chỉ cho phép kiểm tra cú pháp node --check hoặc lệnh đọc an toàn).`;
      const qaResult = {
        command: commandToRun,
        status: "skipped",
        skipped: true,
        code: 0,
        exitCode: 0,
        durationMs: 0,
        durationSec: 0,
        summary: `${commandToRun} · SKIPPED (package.json scripts blocked in read-only mode)`,
        output: blockedMsg,
        completedAt: new Date().toISOString(),
      };
      task.qaResult = qaResult;
      task.terminalHistory ||= [];
      task.terminalHistory.unshift({
        id: `term-${randomUUID().slice(0, 8)}`,
        source: "opensybau",
        ...qaResult,
      });
      task.terminalHistory = task.terminalHistory.slice(0, 20);
      record(task, blockedMsg, "warning", {
        toolName: "qa-runner",
        command: commandToRun,
        exitCode: 0,
        detail: blockedMsg,
        status: "done",
      });
      return qaResult;
    }
    const resolved = await resolveSafeExecCommand(commandToRun, targetCwd);
    const startedAt = Date.now();
    const historyEntry = { id: `term-${randomUUID()}`, source: "opensybau", command: resolved.label, status: "running", startedAt: new Date(startedAt).toISOString() };
    task.terminalHistory ||= [];
    task.terminalHistory.unshift(historyEntry);
    task.terminalHistory = task.terminalHistory.slice(0, 20);
    task.updatedAt = historyEntry.startedAt;
    schedulePersist?.();
    schedulePublish?.("task");
    record(task, `Đang chạy kiểm tra QA / Terminal · ${resolved.label}`, "tool", {
      toolName: "qa-runner",
      command: resolved.label,
      status: "running",
    });
    let res;
    const managed = { task, history: historyEntry, child: null, cancelled: false };
    managedCommands.set(historyEntry.id, managed);
    try {
      res = await run(resolved.executable, resolved.args, { cwd: targetCwd, timeout: 90_000, maxBuffer: 4_000_000, shell: false, onSpawn(child) {
        managed.child = child; historyEntry.cancellable = true;
        const owner = running.get(task.id); if (owner) owner.child = child;
        if (managed.cancelled) killTree(child);
        schedulePersist?.(); schedulePublish?.("task");
      } });
    } catch (error) {
      Object.assign(historyEntry, { status: "failed", completedAt: new Date().toISOString(), output: String(error?.message || error).slice(0, 16000) });
      task.updatedAt = historyEntry.completedAt;
      schedulePersist?.(); schedulePublish?.("task");
      throw error;
    } finally {
      managedCommands.delete(historyEntry.id); historyEntry.cancellable = false;
    }
    const durationMs = Date.now() - startedAt;
    const combinedOutput = `${res.stdout || ""}${res.stderr ? `\n${res.stderr}` : ""}`.trim().slice(-16_000);
    const passed = !managed.cancelled && res.code === 0;
    const qaResult = {
      command: resolved.label,
      status: managed.cancelled ? "cancelled" : passed ? "passed" : "failed",
      code: res.code,
      exitCode: res.code,
      durationMs,
      durationSec: Math.max(1, Math.round(durationMs / 1000)),
      summary: managed.cancelled ? `${resolved.label} · Đã dừng` : passed ? `${resolved.label} · PASS (${(durationMs / 1000).toFixed(1)}s)` : `${resolved.label} · FAIL (mã ${res.code})`,
      output: combinedOutput || (managed.cancelled ? "Đã dừng theo yêu cầu." : passed ? "Hoàn tất thành công (mã thoát 0)." : `Lệnh trả về mã lỗi ${res.code}.`),
      completedAt: new Date().toISOString(),
    };
    task.qaResult = qaResult;
    Object.assign(historyEntry, qaResult);
    task.updatedAt = qaResult.completedAt;
    schedulePersist?.(); schedulePublish?.("task");
    record(task, `Hoàn tất ${resolved.label} · ${passed ? "PASSED" : `FAILED (code ${res.code})`}`, passed ? "success" : "warning", {
      toolName: "qa-runner",
      command: resolved.label,
      exitCode: res.code,
      detail: qaResult.output.slice(0, 600),
      status: "done",
    });
    return qaResult;
  }

  async function spawnStage(task, provider, stage, cwd, prompt, selectionOverride = null) {
    const stageStartedAt = Date.now();
    task._currentStageUsage = null;
    task.stageFailure = null;
    assertTaskActive(task);
    const selection = selectionOverride || (workflowRoles.some((role) => role.id === stage) ? stageSelection(task, stage) : {
      provider: task.config.chatProvider || "codex", model: task.config.chatModel || task.config.codexModel, effort: task.config.chatEffort || task.config.codexEffort,
    });
    const connector = (await loadModels())[provider];
    assertTaskActive(task);
    if (!connector?.available) throw new Error(connector?.error || `${publicProviderName(provider)} chưa sẵn sàng.`);
    const capability = stage === "plan" || stage === "review" ? stage : stage === "build" ? "build" : "chat";
    if (!connector.capabilities?.[capability]) throw new Error(`${publicProviderName(provider)} không hỗ trợ vai trò ${roleLabel(capability)}.`);
    if (task.permissionPreset === "read-only" && stage === "build") throw new Error("Preset chỉ đọc đang bật; không chạy stage triển khai để tránh sửa workspace.");
    if (task.permissionPreset === "read-only" && provider === "antigravity") throw new Error("Antigravity CLI chưa có chế độ chỉ đọc cho lần chạy nền của OpenSybau. Hãy chọn Codex/Claude/API hoặc đổi preset quyền.");
    if (!connector.models?.some((item) => item.id === selection.model && item.efforts.includes(selection.effort))) throw new Error(`Model hoặc mức suy nghĩ không hợp lệ cho ${publicProviderName(provider)}.`);

    record(task, `${publicProviderName(provider)} bắt đầu · ${roleLabel(stage)} · ${selection.model} (${selection.effort})`, "stage");
    if (connector.kind === "api") {
      const providerRuntime = getApiProviderRuntime(provider);
      if (!providerRuntime) throw new Error(`${publicProviderName(provider)} chưa được cấu hình đầy đủ.`);
      const userController = new AbortController();
      const runInfo = running.get(task.id);
      if (runInfo) runInfo.abortController = userController;
      const turnTimeoutMs = 120_000;
      try {
        const isChatStage = stage === "chat-initial" || String(stage).startsWith("chat-");
        const remoteContext = ["plan", "build", "review"].includes(stage) || isChatStage ? await externalWorkspaceContext(task, isChatStage ? "plan" : stage) : null;
        assertTaskActive(task);
        const buildSnapshotHashes = remoteContext?.buildSnapshotHashes || new Map();
        const gitFn = (targetCwd, args) => run(process.platform === "win32" ? "git.exe" : "git", ["-c", "core.quotepath=false", ...args], { cwd: targetCwd, timeout: 10000, maxBuffer: 500000 });
        let activePrompt = remoteContext ? `${prompt}${remoteContext.text}` : prompt;
        let finalContent = "";
        const maxToolTurns = 4;
        for (let toolTurn = 0; toolTurn <= maxToolTurns; toolTurn += 1) {
          const turnController = new AbortController();
          const onUserAbort = () => turnController.abort(userController.signal.reason || new Error("Stopped by user"));
          if (userController.signal.aborted) onUserAbort();
          else userController.signal.addEventListener("abort", onUserAbort, { once: true });
          const turnTimeout = setTimeout(() => turnController.abort(new Error("API provider timeout after 120 seconds.")), turnTimeoutMs);
          turnTimeout.unref?.();
          let result;
          try {
            result = await completeWithApi(providerRuntime, selection.model, activePrompt, turnController.signal);
          } finally {
            clearTimeout(turnTimeout);
            userController.signal.removeEventListener("abort", onUserAbort);
          }
          if (result.usage) addTaskUsage(task, provider, result.usage);
          task._currentStageUsage = result.usage || task._currentStageUsage || null;
          finalContent = String(result.content || "").trim();
          const toolCall = toolTurn < maxToolTurns ? parseApiToolCall(finalContent) : null;
          if (!toolCall) break;
          assertTaskActive(task);
          record(task, `${publicProviderName(provider)} gọi công cụ nội bộ · Tool call (${toolCall.name})`, "tool", {
            toolName: toolCall.name,
            filePath: toolCall.args?.path || toolCall.args?.directory || undefined,
            status: "running",
          });
          const toolRes = await executeApiWorkspaceTool(task, cwd, toolCall, { gitFn, buildSnapshotHashes });
          record(task, `${publicProviderName(provider)} hoàn tất công cụ · ${toolRes.summary}`, "tool", {
            toolName: toolCall.name,
            filePath: toolCall.args?.path || toolCall.args?.directory || undefined,
            detail: toolRes.output.slice(0, 500),
            status: "done",
          });
          activePrompt = `${activePrompt}\n\n<tool_response name="${toolCall.name}" summary="${toolRes.summary}">\n${toolRes.output}\n</tool_response>\n\nContinue with the requested stage output.`;
        }
        const output = stage === "build" ? await applyApiBuildResult(cwd, finalContent, buildSnapshotHashes) : finalContent;
        await fs.writeFile(resolve(task.storagePath, `${stage}.md`), output, "utf8");
        record(task, output.slice(-1500), "output");
        task.stageMetrics ||= [];
        task.stageMetrics.push({ provider, stage, durationMs: Date.now() - stageStartedAt, usage: task._currentStageUsage, completedAt: new Date().toISOString() });
        task.stageMetrics = task.stageMetrics.slice(-500);
        return output;
      } finally {
        if (runInfo?.abortController === userController) runInfo.abortController = null;
      }
    }

    const outputPath = resolve(task.storagePath, `${stage}.md`);
    await fs.rm(outputPath, { force: true }).catch(() => {});

    const subagentExec = subagentCatalogService
      ? await subagentCatalogService.resolveStageSubagentExecution({
          task,
          provider,
          workspaceId: task.workspaceId,
          usesSharedWorkspaceCheckout: usesSharedCheckout(task),
        }).catch(() => null)
      : null;
    if (subagentExec?.selectedProfiles?.length) {
      task.subagentProfilesUsed = subagentExec.selectedProfiles;
    }
    const effectivePrompt = subagentExec?.promptAppendix ? `${prompt}${subagentExec.promptAppendix}` : prompt;
    task.cliStreamSources ||= {};
    task.cliStreamSources[provider] = { version: connector.version || null, transport: provider === "codex" && task.config?.codexTransport === "app-server" ? "app-server-v2" : "stream-json", stage, observedAt: new Date().toISOString() };

    const { codexExe, agyExe, claudeCommand, claudeExe } = getCliExecutables();
    let exe;
    let args;
    const permissions = effectiveCliPermissions(provider, task.permissionPreset, stage, task.config?.codexTransport);
    if (provider === "codex") {
      exe = codexExe;
      const projectDirs = additionalWritableProjectDirs(task, cwd);
      const sandboxArgs = task.permissionPreset === "full-access"
        ? ["--dangerously-bypass-approvals-and-sandbox"]
        : ["--sandbox", permissions.sandbox];
      args = [
        ...(task.permissionPreset !== "full-access" && process.platform === "win32" ? ["--config", 'windows.sandbox="unelevated"'] : []),
        "--disable", "unified_exec",
        ...(subagentExec?.codexArgs || []),
        "--ask-for-approval", "never", "exec", "--json", "--ephemeral", "--skip-git-repo-check", ...sandboxArgs, "-C", cwd, "--model", selection.model, "--config", `model_reasoning_effort=${JSON.stringify(selection.effort)}`, "--output-last-message", outputPath, ...projectDirs.flatMap((directory) => ["--add-dir", directory]), "-",
      ];
    } else if (provider === "antigravity") {
      exe = agyExe;
      const modelEffort = selection.model.match(/-(low|medium|high|xhigh|max)$/)?.[1] || selection.effort;
      const additionalDirs = [...new Map([...(task.antigravitySkillDirs || []), ...additionalWritableProjectDirs(task, cwd)].map((directory) => [directory.toLowerCase(), directory])).values()];
      args = [...additionalDirs.flatMap((directory) => ["--add-dir", directory]), "--prompt", "Follow the complete task instructions supplied on stdin.", "--output-format", "stream-json", "--model", selection.model, "--effort", modelEffort, ...(task.permissionPreset === "full-access" ? ["--dangerously-skip-permissions"] : ["--sandbox"]), "--print-timeout", "0"];
    } else if (provider === "claude") {
      exe = claudeExe;
      const additionalDirs = additionalWritableProjectDirs(task, cwd);
      const claudeEffortArgs = selection.effort && ["low", "medium", "high"].includes(selection.effort) ? ["--effort", selection.effort] : [];
      args = [
        ...claudeCommand.prefixArgs,
        "-p",
        "--model", selection.model,
        "--output-format", "stream-json",
        "--verbose",
        ...claudeEffortArgs,
        "--permission-mode", permissions.mode,
        "--max-turns", "20",
        ...(subagentExec?.claudeArgs || []),
        ...additionalDirs.flatMap((directory) => ["--add-dir", directory]),
      ];
    } else {
      throw new Error(`Provider ${provider} không có bộ chạy cục bộ.`);
    }

    const tracker = createStageSubagentTracker({
      task,
      harness: provider,
      stage,
      round: task.currentRound || 1,
      record,
      addTaskUsage,
      schedulePersist,
      schedulePublish,
    });
    const outputParts = [];
    const streamCtx = provider === "codex"
      ? createCodexStreamContext(task, outputParts, tracker)
      : provider === "claude"
        ? createClaudeStreamContext(task, outputParts, tracker)
        : createAgyStreamContext(task, outputParts, tracker);

    const dispatchStreamLine = (line) => {
      if (provider === "codex") parseCodexStreamLine(line, streamCtx);
      else if (provider === "claude") parseClaudeStreamLine(line, streamCtx);
      else parseAgyStreamLine(line, streamCtx);
    };

    if (provider === "codex" && task.config?.codexTransport === "app-server") {
      let output = "", finalOutput = "";
      const subscribedChildren = new Map();
      let complete, fail;
      const completion = new Promise((resolve, reject) => { complete = resolve; fail = reject; });
      // Register a rejection handler before asynchronous initialization.
      completion.catch(() => {});
      const runInfo = running.get(task.id);
      const client = new CodexAppServer(exe, { cwd, args: subagentExec?.codexArgs || [],
        onEvent(message) {
          const params = message.params || {};
          trackCodexAppEvent(message, streamCtx, client.threadId);
          if (params.item?.type === "fileChange" && (params.threadId === client.threadId || streamCtx.appThreads?.has(params.threadId))) client.fileProposals.set(params.item.id, params.item.changes || []);
          for (const threadId of streamCtx.appThreads || []) {
            if (subscribedChildren.has(threadId)) continue;
            client.childThreads.add(threadId);
            // Resume attaches this client to a child stream; it does not start a turn.
            const subscription = client.request("thread/resume", { threadId }, 5000).then(({ thread }) => {
              for (const turn of thread?.turns || []) {
                if (turn.status === "inProgress") client.activeTurns.set(threadId, turn.id);
                for (const item of turn.items || []) trackCodexAppEvent({ method: item.status === "inProgress" ? "item/started" : "item/completed", params: { threadId, turnId: turn.id, item }, snapshot: true }, streamCtx, client.threadId);
              }
            }).catch(() => {}); // Keep the observed lifecycle when details are unavailable.
            subscribedChildren.set(threadId, subscription);
          }
          if (message.method === "serverRequest/resolved") client.approvals?.remove(params.requestId);
          if (params.threadId && params.threadId !== client.threadId) return;
          if (message.method === "item/agentMessage/delta") { output += params.delta || ""; if (output.length > 8000000) throw new Error("Codex stage output exceeded limit"); record(task, params.delta || "", "output"); }
          if (message.method === "turn/started") { task.liveControl = { provider: "codex", threadId: client.threadId, turnId: params.turn?.id }; schedulePublish?.("task"); }
          if (message.method === "turn/completed") {
            client.turnId = null;
            client.stageEnded = true; delete task.liveControl; client.approvals.close();
            schedulePersist?.(); schedulePublish?.("task");
            params.turn?.status === "completed" ? complete(finalOutput || output) : fail(new Error(params.turn?.error?.message || `Codex turn ${params.turn?.status || "failed"}`));
          }
          if (message.method === "item/started" || message.method === "item/completed") {
            const item = params.item || {};
            if (message.method === "item/completed" && item.type === "agentMessage" && item.phase === "final_answer") finalOutput = item.text || finalOutput;
            if (item.type === "commandExecution") {
              record(task, item.command || "Codex command", "tool", { toolName: "terminal", command: item.command, status: message.method === "item/started" ? "running" : item.status, source: "codex-app-server", itemId: item.id });
            }
          }
        },
        onRequest(message) {
          const allowed = ["item/commandExecution/requestApproval", "item/fileChange/requestApproval"];
          if (client.stageEnded || !allowed.includes(message.method) || !client.isActiveTurn(message.params?.threadId, message.params?.turnId)) { client.child.stdin.write(`${JSON.stringify({ id: message.id, error: { code: -32601, message: "Request not supported or active turn changed" } })}\n`); return; }
          client.approvals.add(message);
        },
      });
      client.fileProposals = new Map();
      client.approvals = new CliApprovalQueue(task, client, { record, changed() { task.updatedAt = new Date().toISOString(); schedulePersist?.(); schedulePublish?.("task"); } });
      if (runInfo) { runInfo.child = client.child; runInfo.appClient = client; }
      client.onDisconnect = fail;
      const timeout = setTimeout(() => client.close(new Error("Codex App Server stage timed out")), Number(process.env.WORKBENCH_STAGE_TIMEOUT_MS) || 900000);
      try {
        await client.initialize();
        const sandbox = permissions.sandbox;
        const writableRoots = additionalWritableProjectDirs(task, cwd);
        const thread = await client.request("thread/start", { cwd, model: selection.model, sandbox, approvalPolicy: permissions.approval, ephemeral: true, config: { ...(process.platform === "win32" ? { "windows.sandbox": "unelevated" } : {}), ...(writableRoots.length ? { "sandbox_workspace_write.writable_roots": writableRoots } : {}) } });
        client.threadId = thread.thread.id;
        task.cliSessions ||= {}; task.cliSessions.codex = client.threadId;
        await client.request("turn/start", { threadId: client.threadId, input: [{ type: "text", text: effectivePrompt }], effort: selection.effort });
        const result = await completion;
        await Promise.allSettled(subscribedChildren.values());
        task.stageMetrics ||= []; task.stageMetrics.push({ provider, stage, durationMs: Date.now() - stageStartedAt, usage: task._currentStageUsage, transport: "app-server", completedAt: new Date().toISOString() });
        task.stageMetrics = task.stageMetrics.slice(-500);
        await fs.writeFile(outputPath, result, "utf8");
        return result;
      } finally {
        clearTimeout(timeout); client.onDisconnect = null; await client.close();
        client.approvals.close();
        interruptCommandActivities(task);
        tracker.finalizeStageSubagents("completed");
        if (runInfo) delete runInfo.appClient;
        delete task.liveControl; task.pendingApprovals = []; schedulePersist?.(); schedulePublish?.("task");
      }
    }

    return new Promise((resolvePromise, rejectPromise) => {
      const childEnv = { ...process.env, NO_COLOR: "1", ...(exe === process.execPath ? { ELECTRON_RUN_AS_NODE: "1" } : {}) };
      if (exe !== process.execPath) delete childEnv.ELECTRON_RUN_AS_NODE;
      const child = spawn(exe, args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: childEnv });
      const runInfo = running.get(task.id);
      if (runInfo) runInfo.child = child;
      const stageIdleTimeoutMs = Number(process.env.WORKBENCH_STAGE_TIMEOUT_MS) || 15 * 60 * 1000;
      let idleTimedOut = false;
      let idleTimer = null;
      const resetIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          idleTimedOut = true;
          if (runInfo) runInfo.stopped = false;
          tracker.finalizeStageSubagents("failed", "Tiến trình CLI quá thời gian chờ (timeout)");
          killTree(child);
          child.stdout?.destroy();
          child.stderr?.destroy();
          rejectPromise(new Error("Tiến trình CLI không phản hồi quá thời gian chờ (timeout)."));
        }, stageIdleTimeoutMs);
        idleTimer.unref?.();
      };
      resetIdleTimer();
      let pending = "";
      let stdoutFallback = "";
      let stderrTail = "";
      child.stdout.on("error", () => {});
      child.stdout.setEncoding("utf8");
      child.stderr.on("error", () => {});
      const onStdout = (chunk) => {
        resetIdleTimer();
        const text = chunk.toString();
        if (provider === "claude" && stdoutFallback.length < 256_000) {
          stdoutFallback += text;
        }
        pending += text;
        if (pending.length > 8000000) {
          idleTimedOut = true; if (idleTimer) clearTimeout(idleTimer); killTree(child);
          tracker.finalizeStageSubagents("failed", "CLI stream vượt giới hạn bộ đệm.");
          rejectPromise(new Error("CLI stream vượt giới hạn bộ đệm.")); return;
        }
        let index;
        while ((index = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, index).trim();
          pending = pending.slice(index + 1);
          if (!line) continue;
          dispatchStreamLine(line);
        }
      };
      child.stdout.on("data", onStdout);
      child.stderr.on("data", (chunk) => {
        resetIdleTimer();
        stderrTail = (stderrTail + chunk.toString()).slice(-5000);
      });
      child.on("error", (error) => {
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        tracker.finalizeStageSubagents("failed", error?.message || "Lỗi tiến trình CLI");
        if (!idleTimedOut) rejectPromise(error);
      });
      child.on("close", async (code) => {
        interruptCommandActivities(task);
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        if (idleTimedOut) return;
        if (pending.trim()) dispatchStreamLine(pending.trim());

        if (provider === "codex" && streamCtx.rootThreadId && (streamCtx.sawCollabActivity || (task.subagents || []).some((s) => s.harness === "codex"))) {
          await enrichCodexSubagentsFromRollouts({
            rootThreadId: streamCtx.rootThreadId,
            stageStartedAt,
            tracker,
          });
        }

        if (running.get(task.id)?.stopped) {
          tracker.finalizeStageSubagents("cancelled", "Đã dừng bởi người dùng");
          return rejectPromise(new Error("Stopped by user"));
        }

        let output = "";
        if (provider === "claude") {
          output = streamCtx.finalResultText || outputParts.join("").trim();
          if (!output && !streamCtx.resultReceived && stdoutFallback.trim()) {
            output = stdoutFallback.trim();
          }
        }
        if (code !== 0) {
          tracker.finalizeStageSubagents("failed", task.stageFailure || stderrTail.trim() || `Mã thoát ${code}`);
          return rejectPromise(new Error(task.stageFailure || stderrTail.trim() || `${publicProviderName(provider)} exited with code ${code}`));
        }
        if (task.stageFailure) {
          tracker.finalizeStageSubagents("failed", task.stageFailure.slice(0, 240));
          return rejectPromise(new Error(task.stageFailure.slice(0, 8000)));
        }
        tracker.finalizeStageSubagents("completed");
        if (!output) { try { output = (await fs.readFile(outputPath, "utf8")).trim(); } catch { } }
        if (!output) output = outputParts.join("").trim();
        task.stageMetrics ||= [];
        task.stageMetrics.push({
          provider,
          stage,
          durationMs: Date.now() - stageStartedAt,
          usage: task._currentStageUsage || null,
          subagentCount: (task.subagents || []).filter((s) => s.stage === stage).length,
          completedAt: new Date().toISOString(),
        });
        task.stageMetrics = task.stageMetrics.slice(-500);
        resolvePromise(output);
      });
      child.stdin.on("error", () => {});
      child.stdin.end(effectivePrompt);
    });
  }

  return {
    assertTaskActive,
    areTaskDependenciesMet,
    hasFailedTaskDependency: (task) => hasFailedTaskDependency(getState(), task),
    runTaskQaCheck,
    cancelManagedCommand,
    cancelManagedCommands,
    spawnStage,
  };
}
