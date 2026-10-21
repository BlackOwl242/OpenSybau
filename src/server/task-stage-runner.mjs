import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { completeWithApi } from "./provider-registry.mjs";
import { workflowRoles } from "../domain/agent-roles.js";
import { estimateTaskCostUsd } from "../domain/task-flow.js";
import { applyApiBuildResult } from "./api-build-ops.mjs";
import { addTaskUsage, publicProviderName, roleLabel, stageSelection } from "./task-prompts.mjs";

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

export async function resolveSafeExecCommand(rawCommand, cwd) {
  const cmd = String(rawCommand || "npm test").trim();
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";
  const presets = {
    "npm test": { executable: npmBin, args: ["test"], label: "npm test" },
    "npm run build": { executable: npmBin, args: ["run", "build"], label: "npm run build" },
    "npm run lint": { executable: npmBin, args: ["run", "lint"], label: "npm run lint" },
    "npm run check": { executable: npmBin, args: ["run", "check"], label: "npm run check" },
    "npm run typecheck": { executable: npmBin, args: ["run", "typecheck"], label: "npm run typecheck" },
    "node --test": { executable: process.execPath, args: ["--test"], label: "node --test" },
    "pytest": { executable: process.platform === "win32" ? "pytest.exe" : "pytest", args: ["-q"], label: "pytest -q" },
    "cargo test": { executable: process.platform === "win32" ? "cargo.exe" : "cargo", args: ["test"], label: "cargo test" },
    "go test ./...": { executable: process.platform === "win32" ? "go.exe" : "go", args: ["test", "./..."], label: "go test ./..." },
    "git status": { executable: "git", args: ["status", "--short", "--branch"], label: "git status --short --branch" },
    "git status --short": { executable: "git", args: ["status", "--short"], label: "git status --short" },
    "git log": { executable: "git", args: ["log", "-n", "8", "--oneline", "--decorate"], label: "git log -n 8 --oneline" },
    "git diff --stat": { executable: "git", args: ["diff", "--stat"], label: "git diff --stat" },
    "vitest run": { executable: npxBin, args: ["--no-install", "vitest", "run"], label: "npx vitest run" },
  };
  if (presets[cmd]) return presets[cmd];
  const npmRunMatch = cmd.match(/^npm\s+run\s+([\w:.-]{1,64})$/);
  if (npmRunMatch) {
    const scriptName = npmRunMatch[1];
    try {
      const pkgRaw = await fs.readFile(resolve(cwd, "package.json"), "utf8");
      const pkg = JSON.parse(pkgRaw);
      if (pkg?.scripts && Object.prototype.hasOwnProperty.call(pkg.scripts, scriptName)) {
        return { executable: npmBin, args: ["run", scriptName], label: `npm run ${scriptName}` };
      }
    } catch { }
    throw new Error(`Script "${scriptName}" không tồn tại trong package.json của workspace.`);
  }
  throw new Error("Chỉ cho phép chạy các lệnh kiểm thử/build chuẩn trong danh sách an toàn hoặc script có trong package.json.");
}

export async function changedFilesSince(cwd, startTime) {
  const changed = [];
  const cutoff = Number.isFinite(startTime) ? startTime : Date.now();
  const ignored = new Set([".git", ".runtime", "node_modules", "dist", "build", "release", "out", "target", ".next", "coverage", "vendor", ".venv", "venv", ".cache", ".turbo", ".parcel-cache", "__pycache__", ".gradle"]);
  async function visit(directory, relativePath = "", depth = 0) {
    if (depth > 12 || changed.length >= 100) return;
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
        if (changed.length >= 100) return;
        try {
          const stat = await fs.stat(absolute);
          if (stat.mtimeMs >= cutoff && changed.length < 100) changed.push(rel);
        } catch { }
      }));
    }
    for (const [absolute, rel] of subdirs) {
      if (changed.length >= 100) break;
      await visit(absolute, rel, depth + 1);
    }
  }
  await visit(cwd);
  return changed.sort();
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
}) {
  function assertTaskActive(task) {
    const runInfo = running.get(task.id);
    if (isShuttingDown() || runInfo?.stopped) throw new Error(isShuttingDown() ? "OpenSybau is shutting down." : "Stopped by user");
  }

  function areTaskDependenciesMet(task) {
    const deps = Array.isArray(task?.dependsOn) ? task.dependsOn : [];
    if (!deps.length) return true;
    const tasks = getState().tasks;
    for (const depRef of deps) {
      const ref = String(depRef || "").trim();
      if (!ref) continue;
      const parent = tasks.find(
        (item) => item.id === ref || (item.code && String(item.code).toUpperCase() === ref.toUpperCase())
      );
      if (parent && parent.id !== task.id && parent.status !== "done") {
        return false;
      }
    }
    return true;
  }

  async function runTaskQaCheck(task, cwd, rawCommand = "") {
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
    const resolved = await resolveSafeExecCommand(commandToRun, targetCwd);
    const startedAt = Date.now();
    record(task, `Đang chạy kiểm tra QA / Terminal · ${resolved.label}`, "tool", {
      toolName: "qa-runner",
      command: resolved.label,
      status: "running",
    });
    const res = await run(resolved.executable, resolved.args, { cwd: targetCwd, timeout: 90_000, maxBuffer: 500_000 });
    const durationMs = Date.now() - startedAt;
    const combinedOutput = `${res.stdout || ""}${res.stderr ? `\n${res.stderr}` : ""}`.trim().slice(-16_000);
    const passed = res.code === 0;
    const qaResult = {
      command: resolved.label,
      status: passed ? "passed" : "failed",
      code: res.code,
      exitCode: res.code,
      durationMs,
      durationSec: Math.max(1, Math.round(durationMs / 1000)),
      summary: passed ? `${resolved.label} · PASS (${(durationMs / 1000).toFixed(1)}s)` : `${resolved.label} · FAIL (mã ${res.code})`,
      output: combinedOutput || (passed ? "Hoàn tất thành công (mã thoát 0)." : `Lệnh trả về mã lỗi ${res.code}.`),
      completedAt: new Date().toISOString(),
    };
    task.qaResult = qaResult;
    task.terminalHistory ||= [];
    task.terminalHistory.unshift({
      id: `term-${randomUUID().slice(0, 8)}`,
      ...qaResult,
    });
    task.terminalHistory = task.terminalHistory.slice(0, 20);
    record(task, `Hoàn tất ${resolved.label} · ${passed ? "PASSED" : `FAILED (code ${res.code})`}`, passed ? "success" : "warning", {
      toolName: "qa-runner",
      command: resolved.label,
      exitCode: res.code,
      detail: qaResult.output.slice(0, 600),
      status: "done",
    });
    return qaResult;
  }

  function parseCodexEvent(line, task, outputParts) {
    let event;
    try { event = JSON.parse(line); } catch { return; }
    const item = event.item || {};
    if (event.type === "item.started" && ["command_execution", "mcp_tool_call", "collab_tool_call", "tool_call", "file_change"].includes(item.type)) {
      const tool = item.name || item.tool || item.server_label || (item.type === "command_execution" ? "terminal" : item.type === "file_change" ? "edit" : item.type === "collab_tool_call" ? "subagent" : item.type);
      const cmd = item.command ? (Array.isArray(item.command) ? item.command.join(" ") : String(item.command)).slice(0, 240) : "";
      const filePath = item.changes?.[0]?.path || item.path || "";
      record(task, `Codex gọi công cụ · ${String(tool).slice(0, 120)}${cmd ? ` · ${cmd.slice(0, 80)}` : filePath ? ` · ${filePath}` : ""}`, "tool", { toolName: String(tool).slice(0, 120), command: cmd || undefined, filePath: filePath || undefined, status: "running" });
    }
    if (event.type === "item.completed" && ["command_execution", "mcp_tool_call", "collab_tool_call", "tool_call", "file_change"].includes(item.type)) {
      const tool = item.name || item.tool || item.server_label || (item.type === "command_execution" ? "terminal" : item.type === "file_change" ? "edit" : item.type === "collab_tool_call" ? "subagent" : item.type);
      const cmd = item.command ? (Array.isArray(item.command) ? item.command.join(" ") : String(item.command)).slice(0, 240) : "";
      const filePath = item.changes?.[0]?.path || item.path || "";
      const exitCode = item.exit_code ?? null;
      const detail = String(item.aggregated_output || item.output || "").trim().slice(0, 600);
      record(task, `Codex hoàn tất công cụ · ${String(tool).slice(0, 120)}${cmd ? ` · ${cmd.slice(0, 80)}` : filePath ? ` · ${filePath}` : ""}`, "tool", { toolName: String(tool).slice(0, 120), command: cmd || undefined, filePath: filePath || undefined, exitCode, detail: detail || undefined, status: "done" });
    }
    if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) { outputParts.push(event.item.text); record(task, event.item.text.slice(-1500), "output"); }
    if (event.type === "turn.completed" && event.usage) { addTaskUsage(task, "codex", event.usage); task._currentStageUsage = event.usage; }
    if (event.type === "error" || event.type === "turn.failed") {
      const errMsg = event.message || event.error?.message || "Codex reported an error";
      task.stageFailure = String(errMsg);
      record(task, errMsg, "error");
    }
  }

  function parseAgyEvent(line, task, outputParts) {
    let event;
    try { event = JSON.parse(line); } catch { return record(task, line, "output"); }
    const type = String(event.type || event.event || "").toLowerCase();
    const update = event.step_update || {};
    const message = event.message;
    const deltaText = event.delta?.text || update.text_delta || "";
    const messageText = typeof message === "string" ? message : message?.text || message?.content?.map?.((part) => part.text || "").join("") || "";
    const fullText = event.text || (typeof event.content === "string" ? event.content : "") || event.response || messageText || "";
    if (deltaText && typeof deltaText === "string") {
      outputParts.push(deltaText);
      record(task, deltaText.slice(-1500), "output");
    } else if (fullText && typeof fullText === "string") {
      const accumulated = outputParts.join("");
      if (outputParts.length > 0 && (fullText === accumulated || fullText.includes(accumulated))) {
        outputParts.length = 0;
        outputParts.push(fullText);
        const last = task.events?.at(-1);
        if (last?.kind === "output") {
          last.at = new Date().toISOString();
          last.text = fullText.slice(-1500);
          task.updatedAt = last.at;
          schedulePersist();
          schedulePublish("task");
        } else {
          record(task, fullText.slice(-1500), "output");
        }
      } else if (!accumulated.endsWith(fullText)) {
        outputParts.push(fullText);
        record(task, fullText.slice(-1500), "output");
      }
    }
    const usageObj = (type === "result" && event.result?.usage) || event.usage || update.usage || null;
    if (usageObj) { addTaskUsage(task, "antigravity", usageObj); task._currentStageUsage = usageObj; }
    const toolError = update.tool_info?.error ? String(update.tool_info.error.message || update.tool_info.error) : "";
    if (type === "result" && event.result) {
      if (event.result.response && typeof event.result.response === "string") {
        const respText = event.result.response;
        const accumulated = outputParts.join("");
        if (!outputParts.length) {
          outputParts.push(respText);
          record(task, respText.slice(-1500), "output");
        } else if (respText === accumulated || respText.includes(accumulated)) {
          outputParts.length = 0;
          outputParts.push(respText);
        }
      }
      if (event.result.status && event.result.status !== "SUCCESS") task.stageFailure = event.result.error || `Antigravity status: ${event.result.status}`;
      else task.stageFailure = null;
    }
    const toolName = event.name || event.tool_name || event.tool?.name || update.tool_info?.name;
    const toolArgs = update.tool_info?.args || event.tool?.args || event.args || {};
    const filePath = String(toolArgs?.path || toolArgs?.file || toolArgs?.TargetFile || toolArgs?.AbsolutePath || "").slice(0, 200);
    const cmd = String(toolArgs?.command || toolArgs?.CommandLine || "").slice(0, 240);
    if (["tool_start", "tool_call", "tool.started", "tool_result", "tool.completed", "tool_use", "tool_result"].includes(type) || update.tool_info) {
      record(task, `Antigravity · ${type || "tool"}${toolName ? ` · ${String(toolName).slice(0, 120)}` : ""}${filePath ? ` · ${filePath}` : cmd ? ` · ${cmd.slice(0, 80)}` : ""}${toolError ? ` · ${toolError.slice(0, 120)}` : ""}`, "tool", {
        toolName: toolName ? String(toolName).slice(0, 120) : "tool",
        filePath: filePath || undefined,
        command: cmd || undefined,
        detail: toolError ? toolError.slice(0, 600) : undefined,
        status: toolError ? "done" : (type.includes("result") || type.includes("completed") ? "done" : "running"),
      });
    }
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
      const controller = new AbortController();
      const runInfo = running.get(task.id);
      if (runInfo) runInfo.abortController = controller;
      const timeout = setTimeout(() => controller.abort(new Error("API provider timeout after 120 seconds.")), 120_000);
      try {
        const isChatStage = stage === "chat-initial" || String(stage).startsWith("chat-");
        const remoteContext = ["plan", "build", "review"].includes(stage) || isChatStage ? await externalWorkspaceContext(task, isChatStage ? "plan" : stage) : null;
        assertTaskActive(task);
        const remotePrompt = remoteContext ? `${prompt}${remoteContext.text}` : prompt;
        const result = await completeWithApi(providerRuntime, selection.model, remotePrompt, controller.signal);
        if (result.usage) addTaskUsage(task, provider, result.usage);
        task._currentStageUsage = result.usage || null;
        const output = stage === "build" ? await applyApiBuildResult(cwd, result.content, remoteContext?.buildSnapshotHashes || new Map()) : String(result.content || "").trim();
        await fs.writeFile(resolve(task.storagePath, `${stage}.md`), output, "utf8");
        record(task, output.slice(-1500), "output");
        task.stageMetrics ||= [];
        task.stageMetrics.push({ provider, stage, durationMs: Date.now() - stageStartedAt, usage: task._currentStageUsage, completedAt: new Date().toISOString() });
        task.stageMetrics = task.stageMetrics.slice(-500);
        return output;
      } finally {
        clearTimeout(timeout);
        if (runInfo?.abortController === controller) runInfo.abortController = null;
      }
    }

    const outputPath = resolve(task.storagePath, `${stage}.md`);
    await fs.rm(outputPath, { force: true }).catch(() => {});

    const { codexExe, agyExe, claudeCommand, claudeExe } = getCliExecutables();
    let exe;
    let args;
    if (provider === "codex") {
      exe = codexExe;
      const projectDirs = additionalWritableProjectDirs(task, cwd);
      const sandboxArgs = task.permissionPreset === "full-access"
        ? ["--dangerously-bypass-approvals-and-sandbox"]
        : ["--sandbox", task.permissionPreset === "read-only" || !(stage === "build" || stage.startsWith("chat-") || stage === "chat-initial") ? "read-only" : "workspace-write"];
      args = [
        ...(task.permissionPreset !== "full-access" && process.platform === "win32" ? ["--config", 'windows.sandbox="unelevated"'] : []),
        "--disable", "unified_exec", "--ask-for-approval", "never", "exec", "--json", "--ephemeral", "--skip-git-repo-check", ...sandboxArgs, "-C", cwd, "--model", selection.model, "--config", `model_reasoning_effort=${JSON.stringify(selection.effort)}`, "--output-last-message", outputPath, ...projectDirs.flatMap((directory) => ["--add-dir", directory]), "-",
      ];
    } else if (provider === "antigravity") {
      exe = agyExe;
      const modelEffort = selection.model.match(/-(low|medium|high|xhigh|max)$/)?.[1] || selection.effort;
      const additionalDirs = [...new Map([...(task.antigravitySkillDirs || []), ...additionalWritableProjectDirs(task, cwd)].map((directory) => [directory.toLowerCase(), directory])).values()];
      args = [...additionalDirs.flatMap((directory) => ["--add-dir", directory]), "--prompt", "Follow the complete task instructions supplied on stdin.", "--output-format", "stream-json", "--model", selection.model, "--effort", modelEffort, ...(task.permissionPreset === "full-access" ? ["--dangerously-skip-permissions"] : ["--sandbox"]), "--print-timeout", "0"];
    } else if (provider === "claude") {
      exe = claudeExe;
      const additionalDirs = additionalWritableProjectDirs(task, cwd);
      args = [...claudeCommand.prefixArgs, "-p", "--model", selection.model, "--output-format", "json", "--permission-mode", task.permissionPreset === "full-access" ? "bypassPermissions" : task.permissionPreset === "read-only" || stage === "plan" || stage === "review" ? "plan" : "acceptEdits", "--max-turns", "20", ...additionalDirs.flatMap((directory) => ["--add-dir", directory])];
    } else {
      throw new Error(`Provider ${provider} không có bộ chạy cục bộ.`);
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
          killTree(child);
          child.stdout?.destroy();
          child.stderr?.destroy();
          rejectPromise(new Error("Tiến trình CLI không phản hồi quá thời gian chờ (timeout)."));
        }, stageIdleTimeoutMs);
        idleTimer.unref?.();
      };
      resetIdleTimer();
      let pending = "";
      let stdoutRaw = "";
      const outputParts = [];
      let stderrTail = "";
      child.stdout.on("error", () => {});
      child.stderr.on("error", () => {});
      const onStdout = (chunk) => {
        resetIdleTimer();
        const text = chunk.toString();
        if (provider === "claude") {
          if (stdoutRaw.length < 10_000_000) stdoutRaw += text;
          return;
        }
        pending += text;
        let index;
        while ((index = pending.indexOf("\n")) >= 0) {
          const line = pending.slice(0, index).trim();
          pending = pending.slice(index + 1);
          if (!line) continue;
          if (provider === "codex") parseCodexEvent(line, task, outputParts); else parseAgyEvent(line, task, outputParts);
        }
      };
      child.stdout.on("data", onStdout);
      child.stderr.on("data", (chunk) => {
        resetIdleTimer();
        stderrTail = (stderrTail + chunk.toString()).slice(-5000);
      });
      child.on("error", (error) => {
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        if (!idleTimedOut) rejectPromise(error);
      });
      child.on("close", async (code) => {
        if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        if (idleTimedOut) return;
        if (pending.trim()) { if (provider === "codex") parseCodexEvent(pending.trim(), task, outputParts); else parseAgyEvent(pending.trim(), task, outputParts); }
        if (running.get(task.id)?.stopped) return rejectPromise(new Error("Stopped by user"));
        let output = "";
        if (provider === "claude" && stdoutRaw.trim()) {
          try {
            const data = JSON.parse(stdoutRaw.trim());
            output = String(data.result || data.message || "").trim();
            if (data.usage) { addTaskUsage(task, "claude", data.usage); task._currentStageUsage = data.usage; }
            if (data?.is_error) {
              task.stageFailure = String(data.result || data.error || "Claude CLI báo lỗi thực thi.").trim();
            }
          } catch { output = stdoutRaw.trim(); }
        }
        if (code !== 0) return rejectPromise(new Error(task.stageFailure || stderrTail.trim() || `${publicProviderName(provider)} exited with code ${code}`));
        if (task.stageFailure) return rejectPromise(new Error(task.stageFailure.slice(0, 8000)));
        if (!output) { try { output = (await fs.readFile(outputPath, "utf8")).trim(); } catch { } }
        if (!output) output = outputParts.join("").trim();
        task.stageMetrics ||= [];
        task.stageMetrics.push({ provider, stage, durationMs: Date.now() - stageStartedAt, usage: task._currentStageUsage || null, completedAt: new Date().toISOString() });
        task.stageMetrics = task.stageMetrics.slice(-500);
        resolvePromise(output);
      });
      child.stdin.on("error", () => {});
      child.stdin.end(prompt);
    });
  }

  return {
    assertTaskActive,
    areTaskDependenciesMet,
    runTaskQaCheck,
    spawnStage,
  };
}
