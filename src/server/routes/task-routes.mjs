import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { roleConfig, workflowRoles } from "../../domain/agent-roles.js";
import { usesSharedCheckout, within, workspaceLockKey } from "../fs-security.mjs";
import { parseUnifiedDiffFiles } from "../diff-parser.mjs";
import { createTaskGithubPullRequest } from "../github-cli.mjs";
import {
  createStageRerunSnapshot,
  inferredRerunStage,
  publicProviderName,
  supportedRerunStages,
  validateAgentSelection,
} from "../task-prompts.mjs";
import { failQueuedChatTurns, finishStageRerun, recordTaskCycle } from "../task-stage-runner.mjs";

function parseSafeAttachments(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  if (list.length > 20) return { error: "Mỗi tin nhắn chỉ hỗ trợ tối đa 20 tệp đính kèm." };
  const safeAttachments = [];
  let attachmentBytes = 0;
  for (const attachment of list) {
    const name = String(attachment?.name || "").trim();
    const content = String(attachment?.content || "");
    attachmentBytes += Buffer.byteLength(content, "utf8");
    if (!name || name.length > 300 || content.includes("\u0000")) {
      return { error: "Tệp đính kèm không hợp lệ hoặc không phải tệp văn bản." };
    }
    safeAttachments.push({ name, content });
  }
  if (attachmentBytes > 1_000_000) return { error: "Tổng nội dung tệp đính kèm tối đa 1 MB." };
  return { safeAttachments };
}

export async function handleTaskRoutes(request, response, pathname, ctx) {
  const {
    taskDir,
    getState,
    running,
    busyWorkspaces,
    persist,
    publish,
    record,
    json,
    readBody,
    safeError,
    run,
    git,
    withGitRepoLock,
    openFolder,
    killTree,
    autoDistillTaskMemory,
    cliDiscovery,
    promptService,
    stageRunner,
    taskRunner,
  } = ctx;

  const { inspectWorkspace, loadModels } = cliDiscovery;
  const { requestedRole } = promptService;
  const { runTaskQaCheck } = stageRunner;
  const {
    cleanupTaskWorktrees,
    processTaskChatQueue,
    pump,
    checkDiff,
    applyTaskWorktree,
    discardTaskWorktree,
  } = taskRunner;
  const state = getState();

  if (request.method === "POST" && pathname === "/api/tasks") {
    const body = await readBody(request);
    const prompt = String(body.prompt || "").trim();
    const { safeAttachments, error: attachError } = parseSafeAttachments(body.attachments);
    if (attachError) { json(response, 400, { error: attachError }); return true; }
    const workspace = state.workspaces.find((w) => w.id === body.workspaceId);
    if (!workspace) { json(response, 400, { error: "Chọn workspace thật trước khi tạo task." }); return true; }
    if ((prompt.length < 6 && !safeAttachments.length) || prompt.length > 50000) {
      json(response, 400, { error: "Nhập ít nhất 6 ký tự hoặc đính kèm tệp; phần chữ tối đa 50.000 ký tự." });
      return true;
    }
    const connectors = await loadModels();
    const workflow = ["chat-only", "plan-only", "codex-antigravity"].includes(body.workflow) ? body.workflow : "codex-antigravity";
    const permissionPreset = body.permissionPreset === undefined ? "workspace-write" : body.permissionPreset;
    if (!["read-only", "workspace-write", "full-access"].includes(permissionPreset)) { json(response, 400, { error: "Preset quyền không hợp lệ." }); return true; }
    if (permissionPreset === "read-only" && workflow === "codex-antigravity") {
      json(response, 400, { error: "Luồng Plan → Build → Review cần quyền ghi vào workspace. Hãy chọn Chỉ lên kế hoạch, Chỉ chat, hoặc đổi quyền sang Ghi trong workspace." });
      return true;
    }
    const roles = Object.fromEntries(workflowRoles.map((role) => [role.id, requestedRole(body, role.id, connectors)]));
    const chatProvider = String(body.chatProvider || state.settings.defaults?.chatProvider || "codex");
    const chatConnector = connectors[chatProvider];
    const chatModel = String(body.chatModel || state.settings.defaults?.chatModel || chatConnector?.models?.[0]?.id || "");
    const chatModelInfo = chatConnector?.models?.find((item) => item.id === chatModel);
    const chatEffort = String(body.chatEffort || state.settings.defaults?.chatEffort || chatModelInfo?.efforts?.find((item) => item === "medium") || chatModelInfo?.efforts?.[0] || "");
    const config = {
      roles,
      codexModel: roles.plan.provider === "codex" ? roles.plan.model : String(state.settings.defaults?.codexModel || ""),
      codexEffort: roles.plan.provider === "codex" ? roles.plan.effort : String(state.settings.defaults?.codexEffort || "medium"),
      agyModel: roles.build.provider === "antigravity" ? roles.build.model : String(state.settings.defaults?.agyModel || ""),
      agyEffort: roles.build.provider === "antigravity" ? roles.build.effort : String(state.settings.defaults?.agyEffort || "medium"),
      chatProvider, chatModel, chatEffort, workflow,
    };
    if (workflow === "chat-only") {
      const error = validateAgentSelection({ provider: chatProvider, model: chatModel, effort: chatEffort }, "chat", connectors);
      if (error) { json(response, 400, { error }); return true; }
    } else {
      for (const roleId of workflow === "plan-only" ? ["plan"] : ["plan", "build", "review"]) {
        const error = validateAgentSelection(roles[roleId], roleId, connectors);
        if (error) { json(response, 400, { error }); return true; }
      }
    }
    let presetRef = null;
    if (body.presetRef !== undefined && body.presetRef !== null) {
      const presetId = String(body.presetRef?.id || "");
      const presetVersion = Number(body.presetRef?.version);
      const preset = state.settings.taskPresets.find((item) => item.id === presetId);
      if (!Number.isSafeInteger(presetVersion) || presetVersion < 1 || !preset?.versions?.some((item) => Number(item.version) === presetVersion)) {
        json(response, 409, { error: "Mẫu tác vụ đã thay đổi hoặc bị xóa. Hãy chọn lại mẫu trước khi tạo task." });
        return true;
      }
      presetRef = { id: preset.id, name: preset.name, version: presetVersion };
    }
    const info = await inspectWorkspace(workspace.path);
    const isolated = body.isolated === true;
    if (isolated && (!info.isGit || !info.head)) {
      json(response, 400, { error: "Tách task cần Git repo có ít nhất một commit. Bỏ chọn cách ly để chạy tuần tự trong workspace." });
      return true;
    }
    const id = `task-${randomUUID().slice(0, 8)}`;
    const nextSeq = state.tasks.length + 1;
    const rawCode = String(body.code || "").trim().slice(0, 32);
    const code = rawCode || (workflow === "codex-antigravity" ? `LOOP-${String(nextSeq).padStart(2, "0")}` : `TASK-${String(nextSeq).padStart(2, "0")}`);
    const riskLevel = ["S", "M", "L"].includes(String(body.riskLevel || "").toUpperCase())
      ? String(body.riskLevel).toUpperCase()
      : (workflow === "codex-antigravity" ? "M" : "S");
    const milestone = String(body.milestone || "Core").trim().slice(0, 60) || "Core";
    const dependsOn = Array.isArray(body.dependsOn)
      ? [...new Set(body.dependsOn.map((d) => String(d || "").trim()).filter(Boolean))].slice(0, 16)
      : [];
    const planGate = Boolean(body.planGate);
    const maxRounds = Math.max(1, Math.min(3, Number(body.maxRounds) || (workflow === "codex-antigravity" ? 2 : 1)));
    const qaCommand = String(body.qaCommand || "").trim().slice(0, 80);
    const waveIndex = Number(body.waveIndex) > 0 ? Number(body.waveIndex) : undefined;
    const task = {
      id, code, riskLevel, milestone, dependsOn, planGate, planGateApprovedAt: null, planGateFeedback: "",
      maxRounds, currentRound: 1, qaCommand, waveIndex, cycles: [],
      title: String(body.title || prompt.split(/\r?\n/)[0]).trim().slice(0, 120) || safeAttachments[0]?.name || "Task mới",
      prompt, attachments: safeAttachments, workspaceId: workspace.id, workspacePath: info.path, status: "queued", phase: "queued",
      isolated, config, permissionPreset, presetRef, goal: String(body.goal || "").trim().slice(0, 2000), goalChecklist: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), events: [],
      skillSelectionMode: "auto", skillSelectionCompleted: false, skillIds: [], skills: [],
      memoryUsed: [], storagePath: resolve(taskDir, id),
    };
    state.tasks.unshift(task); persist(); record(task, `Task ${code} được tạo từ giao diện và đưa vào hàng đợi thật.${dependsOn.length ? ` Phụ thuộc: ${dependsOn.join(", ")}.` : ""}`, "success"); pump();
    json(response, 201, { task });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/tasks/fanout") {
    const body = await readBody(request);
    const prompt = String(body.prompt || "").trim();
    const { safeAttachments, error: attachError } = parseSafeAttachments(body.attachments);
    if (attachError) { json(response, 400, { error: attachError }); return true; }
    const workspace = state.workspaces.find((w) => w.id === body.workspaceId);
    if (!workspace) { json(response, 400, { error: "Chọn workspace thật trước khi chạy Đa luồng Agent." }); return true; }
    if ((prompt.length < 6 && !safeAttachments.length) || prompt.length > 50000) { json(response, 400, { error: "Nhập ít nhất 6 ký tự hoặc đính kèm tệp." }); return true; }
    const info = await inspectWorkspace(workspace.path);
    if (!info.isGit || !info.head) { json(response, 400, { error: "Đa luồng Agent cần Git repository có ít nhất 1 commit để tách Git worktree cô lập cho từng nhánh." }); return true; }
    const competitors = Array.isArray(body.competitors) ? body.competitors : [];
    if (competitors.length < 2 || competitors.length > 8) { json(response, 400, { error: "Chọn từ 2 đến 8 nhánh agent để chạy song song trên các Git worktree." }); return true; }
    const connectors = await loadModels();
    const workflow = ["chat-only", "plan-only", "codex-antigravity"].includes(body.workflow) ? body.workflow : "chat-only";
    const permissionPreset = body.permissionPreset === undefined ? "workspace-write" : body.permissionPreset;
    if (!["read-only", "workspace-write", "full-access"].includes(permissionPreset)) { json(response, 400, { error: "Preset quyền không hợp lệ." }); return true; }
    if (permissionPreset === "read-only" && workflow === "codex-antigravity") {
      json(response, 400, { error: "Luồng Plan → Build → Review cần quyền ghi vào workspace. Hãy chọn Chỉ lên kế hoạch, Chỉ chat, hoặc đổi quyền sang Ghi trong workspace." });
      return true;
    }
    const normalizedCompetitors = [];
    for (const entry of competitors) {
      const provider = String(entry?.provider || "").trim();
      const connector = connectors[provider];
      if (!connector?.available) { json(response, 400, { error: `${publicProviderName(provider || "Agent")} chưa sẵn sàng.` }); return true; }
      const model = String(entry?.model || connector.models?.[0]?.id || "").trim();
      const modelInfo = connector.models?.find((item) => item.id === model);
      const effort = String(entry?.effort || modelInfo?.efforts?.find((item) => item === "medium") || modelInfo?.efforts?.[0] || "").trim();
      const requiredCaps = workflow === "chat-only" ? ["chat"] : workflow === "plan-only" ? ["plan"] : ["plan", "build", "review"];
      for (const requiredCap of requiredCaps) {
        const validationError = validateAgentSelection({ provider, model, effort }, requiredCap, connectors);
        if (validationError) { json(response, 400, { error: validationError }); return true; }
      }
      normalizedCompetitors.push({ provider, model, effort, customLabel: String(entry?.label || "").trim() });
    }
    const fanoutId = `fanout-${randomUUID().slice(0, 8)}`;
    const baseTitle = String(body.title || prompt.split(/\r?\n/)[0]).trim().slice(0, 96) || safeAttachments[0]?.name || "Đa luồng Agent";
    const createdTasks = [];
    for (const [idx, comp] of normalizedCompetitors.entries()) {
      const id = `task-${randomUUID().slice(0, 8)}`;
      const singleRole = { provider: comp.provider, model: comp.model, effort: comp.effort };
      const config = {
        roles: { plan: { ...singleRole }, build: { ...singleRole }, review: { ...singleRole } },
        codexModel: comp.provider === "codex" ? comp.model : String(state.settings.defaults?.codexModel || ""),
        codexEffort: comp.provider === "codex" ? comp.effort : String(state.settings.defaults?.codexEffort || "medium"),
        agyModel: comp.provider === "antigravity" ? comp.model : String(state.settings.defaults?.agyModel || ""),
        agyEffort: comp.provider === "antigravity" ? comp.effort : String(state.settings.defaults?.agyEffort || "medium"),
        chatProvider: comp.provider, chatModel: comp.model, chatEffort: comp.effort, workflow,
      };
      const slotName = comp.customLabel || `#${idx + 1} ${publicProviderName(comp.provider)}${comp.model ? ` (${comp.model})` : ""}`;
      const now = new Date().toISOString();
      const task = {
        id,
        title: `[#${idx + 1} ${publicProviderName(comp.provider)}] ${baseTitle}`.slice(0, 120),
        prompt, attachments: safeAttachments, workspaceId: workspace.id, workspacePath: info.path,
        status: "queued", phase: "queued", isolated: true,
        fanoutId, fanoutProvider: comp.provider, fanoutModel: comp.model, fanoutLabel: slotName,
        fanoutCompetitor: { index: idx + 1, name: slotName, provider: comp.provider, model: comp.model, effort: comp.effort },
        config, permissionPreset, goal: String(body.goal || "").trim().slice(0, 2000), goalChecklist: [],
        createdAt: now, updatedAt: now,
        events: [{ at: now, kind: "success", text: `Khởi tạo trong Đa luồng Song song (${fanoutId} · Nhánh #${idx + 1}) trên Git worktree riêng.` }],
        skillSelectionMode: "auto", skillSelectionCompleted: false, skillIds: [], skills: [], memoryUsed: [],
        storagePath: resolve(taskDir, id),
      };
      createdTasks.push(task);
    }
    for (const task of [...createdTasks].reverse()) state.tasks.unshift(task);
    persist(); publish("tasks"); pump();
    json(response, 201, { fanoutId, tasks: createdTasks });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/tasks/decompose") {
    const body = await readBody(request);
    const workspace = state.workspaces.find((w) => w.id === body.workspaceId);
    if (!workspace) { json(response, 400, { error: "Chọn workspace thật trước khi khởi tạo chiến dịch Wave DAG." }); return true; }
    const info = await inspectWorkspace(workspace.path);
    const connectors = await loadModels();
    const roles = Object.fromEntries(workflowRoles.map((role) => [role.id, requestedRole(body, role.id, connectors)]));
    const chatProvider = String(body.chatProvider || state.settings.defaults?.chatProvider || "codex");
    const chatConnector = connectors[chatProvider];
    const chatModel = String(body.chatModel || state.settings.defaults?.chatModel || chatConnector?.models?.[0]?.id || "");
    const chatModelInfo = chatConnector?.models?.find((item) => item.id === chatModel);
    const chatEffort = String(body.chatEffort || state.settings.defaults?.chatEffort || chatModelInfo?.efforts?.find((item) => item === "medium") || chatModelInfo?.efforts?.[0] || "");
    const milestone = String(body.milestone || "Wave Campaign").trim().slice(0, 60) || "Wave Campaign";
    const campaignGoal = String(body.goal || body.prompt || "").trim();
    let rawItems = [];
    if (Array.isArray(body.waves) && body.waves.length) {
      let prevWaveCodes = [];
      let seq = 0;
      for (const wave of body.waves.slice(0, 8)) {
        const wIdx = Math.max(1, Math.min(8, Number(wave.index) || 1));
        const currentWaveCodes = [];
        for (const t of (Array.isArray(wave.tasks) ? wave.tasks : []).slice(0, 8)) {
          seq += 1;
          const code = String(t.code || `WAVE-${String(seq).padStart(2, "0")}`).trim().slice(0, 32);
          currentWaveCodes.push(code);
          rawItems.push({
            ...t, code, waveIndex: wIdx,
            workflow: t.workflow || body.workflow || "codex-antigravity",
            planGate: t.planGate !== undefined ? Boolean(t.planGate) : Boolean(body.planGate),
            maxRounds: Number(t.maxRounds || body.maxRounds) || 2,
            qaCommand: String(t.qaCommand || body.qaCommand || "").trim(),
            dependsOn: Array.isArray(t.dependsOn) && t.dependsOn.length ? t.dependsOn : [...prevWaveCodes],
          });
        }
        if (currentWaveCodes.length) prevWaveCodes = currentWaveCodes;
      }
    } else if (Array.isArray(body.items) && body.items.length) {
      rawItems = body.items.slice(0, 12);
    } else if (campaignGoal.length >= 6) {
      const shortTitle = campaignGoal.split(/\r?\n/)[0].trim().slice(0, 72);
      rawItems = [
        { code: "WAVE-01", waveIndex: 1, riskLevel: "S", workflow: "plan-only", planGate: false, title: `[Wave 1 · Spec & Kiến trúc] ${shortTitle}`, prompt: `Phân tích yêu cầu tổng thể, xác định các tệp liên quan, giao thức dữ liệu và rủi ro cho chiến dịch:\n\n${campaignGoal}`, dependsOn: [] },
        { code: "WAVE-02", waveIndex: 2, riskLevel: "M", workflow: body.workflow || "codex-antigravity", planGate: Boolean(body.planGate), maxRounds: 2, title: `[Wave 2 · Triển khai Core] ${shortTitle}`, prompt: `Triển khai mã nguồn cốt lõi theo kiến trúc của chiến dịch:\n\n${campaignGoal}`, dependsOn: ["WAVE-01"] },
        { code: "WAVE-03", waveIndex: 3, riskLevel: "L", workflow: body.workflow || "codex-antigravity", planGate: false, maxRounds: 2, qaCommand: String(body.qaCommand || "").trim(), title: `[Wave 3 · Kiểm thử QA & Hoàn thiện] ${shortTitle}`, prompt: `Rà soát tích hợp, bổ sung kiểm thử và xác minh toàn bộ tính năng cho chiến dịch:\n\n${campaignGoal}`, dependsOn: ["WAVE-02"] },
      ];
    }
    if (!rawItems.length) {
      json(response, 400, { error: "Nhập mục tiêu chiến dịch (tối thiểu 6 ký tự) hoặc danh sách các node trong Wave." });
      return true;
    }
    const campaignId = `wave-${randomUUID().slice(0, 8)}`;
    const codeToId = new Map();
    const createdTasks = [];
    const isolatedDefault = Boolean(body.isolated && info.isGit && info.head);
    for (const [idx, item] of rawItems.entries()) {
      const id = `task-${randomUUID().slice(0, 8)}`;
      const itemWorkflow = ["chat-only", "plan-only", "codex-antigravity"].includes(item.workflow || body.workflow) ? (item.workflow || body.workflow) : "codex-antigravity";
      const code = String(item.code || `WAVE-${String(idx + 1).padStart(2, "0")}`).trim().slice(0, 32);
      codeToId.set(code.toUpperCase(), id);
      const itemDeps = Array.isArray(item.dependsOn)
        ? item.dependsOn.map((dep) => { const ref = String(dep || "").trim(); return codeToId.get(ref.toUpperCase()) || ref; }).filter(Boolean)
        : [];
      const config = {
        roles: structuredClone(roles),
        codexModel: roles.plan.provider === "codex" ? roles.plan.model : String(state.settings.defaults?.codexModel || ""),
        codexEffort: roles.plan.provider === "codex" ? roles.plan.effort : String(state.settings.defaults?.codexEffort || "medium"),
        agyModel: roles.build.provider === "antigravity" ? roles.build.model : String(state.settings.defaults?.agyModel || ""),
        agyEffort: roles.build.provider === "antigravity" ? roles.build.effort : String(state.settings.defaults?.agyEffort || "medium"),
        chatProvider, chatModel, chatEffort, workflow: itemWorkflow,
      };
      const now = new Date().toISOString();
      const task = {
        id, campaignId, code,
        waveIndex: Number(item.waveIndex) > 0 ? Number(item.waveIndex) : idx + 1,
        riskLevel: ["S", "M", "L"].includes(String(item.riskLevel || "").toUpperCase()) ? String(item.riskLevel).toUpperCase() : "M",
        milestone: String(item.milestone || milestone).trim().slice(0, 60),
        dependsOn: itemDeps, planGate: Boolean(item.planGate), planGateApprovedAt: null, planGateFeedback: "",
        maxRounds: Math.max(1, Math.min(3, Number(item.maxRounds) || 2)), currentRound: 1,
        qaCommand: String(item.qaCommand || body.qaCommand || "").trim().slice(0, 80),
        cycles: [], title: String(item.title || `Wave ${idx + 1}`).trim().slice(0, 120),
        prompt: String(item.prompt || campaignGoal).trim().slice(0, 50000), attachments: [],
        workspaceId: workspace.id, workspacePath: info.path, status: "queued", phase: "queued",
        isolated: item.isolated !== undefined ? Boolean(item.isolated && info.isGit && info.head) : isolatedDefault,
        config, permissionPreset: "workspace-write", goal: campaignGoal.slice(0, 2000), goalChecklist: [],
        createdAt: now, updatedAt: now,
        events: [{ at: now, kind: "success", text: `Khởi tạo trong chiến dịch Wave DAG (${code} · Wave ${Number(item.waveIndex) || idx + 1}).` }],
        skillSelectionMode: "auto", skillSelectionCompleted: false, skillIds: [], skills: [], memoryUsed: [],
        storagePath: resolve(taskDir, id),
      };
      createdTasks.push(task);
    }
    for (const task of [...createdTasks].reverse()) state.tasks.unshift(task);
    persist(); publish("tasks"); pump();
    json(response, 201, { campaignId, tasks: createdTasks });
    return true;
  }

  const match = pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(run|stop|diff|open|chat|pin|archive|fork|goal|checklist|plan-gate|qa|exec|git-commit|github-pr|apply-worktree|discard-worktree|worktree\/apply|worktree\/discard))?$/);
  if (!match) return false;

  const id = decodeURIComponent(match[1]);
  const action = match[2] || "";
  const task = state.tasks.find((t) => t.id === id);
  if (!task) { json(response, 404, { error: "Task không tồn tại." }); return true; }

  if (request.method === "DELETE" && !action) {
    if (!task.archived) { json(response, 409, { error: "Chỉ có thể xóa chat sau khi đã lưu trữ." }); return true; }
    if (running.has(task.id) || ["queued", "running"].includes(task.status)) { json(response, 409, { error: "Không thể xóa chat đang chạy hoặc đang chờ." }); return true; }
    const storagePath = resolve(String(task.storagePath || resolve(taskDir, task.id)));
    if (!within(taskDir, storagePath) || storagePath === taskDir) { json(response, 400, { error: "Đường dẫn dữ liệu task không hợp lệ; không thể xóa chat an toàn." }); return true; }
    try {
      await cleanupTaskWorktrees(task);
      await fs.rm(storagePath, { recursive: true, force: true });
    } catch (error) { json(response, 500, { error: `Không thể xóa dữ liệu chat: ${safeError(error)}` }); return true; }
    state.tasks = state.tasks.filter((item) => item.id !== task.id);
    persist(); publish("tasks");
    json(response, 200, { deleted: true, id: task.id });
    return true;
  }

  if (request.method === "PATCH" && !action) {
    const body = await readBody(request);
    if (body.permissionPreset !== undefined) {
      if (!["read-only", "workspace-write", "full-access"].includes(body.permissionPreset)) { json(response, 400, { error: "Preset quyền không hợp lệ." }); return true; }
      if (["queued", "running"].includes(task.status)) { json(response, 409, { error: "Hãy đợi task kết thúc trước khi đổi quyền." }); return true; }
      task.permissionPreset = body.permissionPreset;
    }
    if (body.title !== undefined) {
      const title = String(body.title || "").trim();
      if (!title || title.length > 120) { json(response, 400, { error: "Tên chat cần từ 1 đến 120 ký tự." }); return true; }
      task.title = title;
    }
    if (body.riskLevel !== undefined && ["S", "M", "L"].includes(String(body.riskLevel).toUpperCase())) {
      task.riskLevel = String(body.riskLevel).toUpperCase();
    }
    if (body.milestone !== undefined) task.milestone = String(body.milestone || "Core").trim().slice(0, 60) || "Core";
    if (body.code !== undefined) task.code = String(body.code || "").trim().slice(0, 32) || task.code;
    if (body.planGate !== undefined) task.planGate = Boolean(body.planGate);
    if (body.maxRounds !== undefined) task.maxRounds = Math.max(1, Math.min(3, Number(body.maxRounds) || 1));
    if (body.qaCommand !== undefined) task.qaCommand = String(body.qaCommand || "").trim().slice(0, 80);
    if (Array.isArray(body.dependsOn)) {
      task.dependsOn = [...new Set(body.dependsOn.map((d) => String(d || "").trim()).filter((d) => d && d !== task.id))].slice(0, 16);
    }
    task.updatedAt = new Date().toISOString();
    persist(); publish("tasks"); pump();
    json(response, 200, { task });
    return true;
  }

  if (request.method === "POST" && action === "plan-gate") {
    const body = await readBody(request);
    const decision = String(body.decision || body.action || "approve").toLowerCase();
    const feedback = String(body.feedback || "").trim().slice(0, 4000);
    if (running.has(task.id)) { json(response, 409, { error: "Task đang chạy tiến trình; vui lòng đợi giây lát." }); return true; }
    if (feedback) task.planGateFeedback = feedback;
    if (decision === "revise" || decision === "reject") {
      task.plan = "";
      task.planGateApprovedAt = null;
      task.resumeFrom = "plan";
      task.status = "queued";
      task.phase = "plan";
      task.updatedAt = new Date().toISOString();
      record(task, `Bạn đã yêu cầu lập lại kế hoạch tại Plan Gate${feedback ? `: "${feedback.slice(0, 200)}"` : "."}`, "warning");
      persist(); publish("tasks"); pump();
      json(response, 200, { ok: true, decision: "revise", task });
      return true;
    }
    task.planGateApprovedAt = new Date().toISOString();
    const planCycle = (task.cycles || []).find((c) => c.stage === "plan");
    if (planCycle) {
      planCycle.status = "clean";
      planCycle.badge = "GO approved";
    }
    if (task.config?.workflow === "plan-only") {
      task.status = "done";
      task.phase = "done";
      task.completedAt = task.planGateApprovedAt;
      task.updatedAt = task.planGateApprovedAt;
      const ws = state.workspaces.find((w) => w.id === task.workspaceId);
      if (ws) autoDistillTaskMemory(task, ws);
      record(task, `Bạn đã duyệt kế hoạch (Plan Gate · GO)${feedback ? ` với ghi chú: "${feedback.slice(0, 200)}"` : ""}.`, "success");
      persist(); publish("tasks"); pump();
      json(response, 200, { ok: true, decision: "approve", task });
      return true;
    }
    task.resumeFrom = "build";
    task.status = "queued";
    task.phase = "build";
    task.updatedAt = task.planGateApprovedAt;
    record(task, `Bạn đã duyệt kế hoạch (Plan Gate · GO)${feedback ? ` với ghi chú: "${feedback.slice(0, 200)}"` : ""}. Bắt đầu triển khai code.`, "success");
    persist(); publish("tasks"); pump();
    json(response, 200, { ok: true, decision: "approve", task });
    return true;
  }

  if (request.method === "POST" && (action === "qa" || action === "exec")) {
    const body = await readBody(request);
    const cwd = task.executionPath || task.workspacePath;
    if (!cwd || !existsSync(cwd)) { json(response, 404, { error: "Không tìm thấy thư mục thực thi của task." }); return true; }
    try {
      const result = await runTaskQaCheck(task, cwd, body.command);
      recordTaskCycle(task, {
        id: `cycle-qa-${Number(task.currentRound || 1)}`,
        round: Number(task.currentRound || 1),
        stage: "qa",
        title: `QA · ${result.status === "passed" ? "specs passed" : "specs failed"}`,
        provider: "QA Runner",
        model: result.command,
        status: result.status === "passed" ? "clean" : "blocking",
        badge: result.summary,
        blocking: result.status === "failed" ? 1 : 0,
        advisory: 0,
        turns: 1,
        durationMs: result.durationMs,
        summary: String(result.output || "").slice(0, 600),
      });
      persist(); publish("task");
      json(response, 200, { ok: true, result, qaResult: result, task });
    } catch (error) {
      json(response, 400, { error: safeError(error) });
    }
    return true;
  }

  if (request.method === "POST" && action === "git-commit") {
    const body = await readBody(request);
    const cwd = task.executionPath || task.workspacePath;
    if (!cwd || !existsSync(cwd)) { json(response, 404, { error: "Không tìm thấy thư mục workspace để commit." }); return true; }
    const info = await inspectWorkspace(cwd).catch(() => null);
    if (!info?.isGit) { json(response, 400, { error: "Workspace không phải là Git repository." }); return true; }
    const message = String(body.message || `${task.code ? `${task.code}: ` : ""}${task.title || "Update from OpenSybau"}`).trim().slice(0, 200);
    if (!message) { json(response, 400, { error: "Nhập nội dung commit message." }); return true; }
    const repoRoot = info.gitRoot || cwd;
    try {
      const commitInfo = await withGitRepoLock(repoRoot, async () => {
        await git(cwd, ["add", "-A"]);
        const statusRes = await git(cwd, ["status", "--porcelain"]);
        if (!(statusRes.stdout || "").trim()) throw new Error("Không có thay đổi nào cần commit trong workspace/worktree này.");
        const commitRes = await git(cwd, ["commit", "-m", message]);
        if (commitRes.code !== 0) throw new Error((commitRes.stderr || commitRes.stdout || "git commit thất bại").trim().slice(0, 400));
        const headRes = await git(cwd, ["rev-parse", "--short", "HEAD"]);
        return { hash: (headRes.stdout || "").trim(), output: (commitRes.stdout || "").trim() };
      });
      task.commitHash = commitInfo.hash;
      task.lastCommitMessage = message;
      task.committedAt = new Date().toISOString();
      record(task, `Đã tạo Git commit ${commitInfo.hash} ("${message}").`, "success");
      persist(); publish("tasks");
      json(response, 200, { ok: true, commitHash: commitInfo.hash, output: commitInfo.output, task });
    } catch (error) {
      json(response, 409, { error: safeError(error) });
    }
    return true;
  }

  if (request.method === "POST" && action === "github-pr") {
    const body = await readBody(request);
    const cwd = task.executionPath || task.workspacePath;
    if (!cwd || !existsSync(cwd)) { json(response, 404, { error: "Không tìm thấy thư mục workspace để tạo Pull Request." }); return true; }
    const info = await inspectWorkspace(cwd).catch(() => null);
    if (!info?.isGit) { json(response, 400, { error: "Workspace không phải là Git repository." }); return true; }
    const title = String(body.title || `${task.code ? `${task.code}: ` : ""}${task.title || "Pull Request from OpenSybau"}`).trim().slice(0, 180);
    const defaultBody = [
      `## Yêu cầu`,
      String(task.prompt || "").slice(0, 2000),
      task.plan ? `\n## Kế hoạch\n${String(task.plan).slice(0, 3000)}` : "",
      task.implementation ? `\n## Triển khai\n${String(task.implementation).slice(0, 3000)}` : "",
      task.review ? `\n## Review\n${String(task.review).slice(0, 2000)}` : "",
    ].filter(Boolean).join("\n");
    const prBody = String(body.body || defaultBody).trim().slice(0, 12_000);
    try {
      const result = await createTaskGithubPullRequest(
        cwd,
        { title, body: prBody, baseBranch: String(body.baseBranch || "").trim(), draft: Boolean(body.draft) },
        run,
        git
      );
      task.pullRequestUrl = result.url || task.pullRequestUrl || "";
      task.updatedAt = new Date().toISOString();
      record(task, `Đã tạo GitHub Pull Request trên nhánh ${result.branch}${result.url ? `: ${result.url}` : "."}`, "success");
      persist(); publish("tasks");
      json(response, 200, { ...result, task });
    } catch (error) {
      json(response, 400, { error: safeError(error) });
    }
    return true;
  }

  if (request.method === "POST" && action === "fork") {
    const body = await readBody(request);
    const messageIndex = (task.chatMessages || []).findIndex((item) => item.id === body.messageId && item.role === "user");
    if (messageIndex < 0) { json(response, 404, { error: "Không tìm thấy lượt chat để fork." }); return true; }
    const sourceMessage = task.chatMessages[messageIndex];
    if (sourceMessage.status && sourceMessage.status !== "done") { json(response, 409, { error: "Chỉ có thể fork từ lượt chat đã hoàn tất." }); return true; }
    const copiedMessages = task.chatMessages.slice(0, messageIndex + 1).filter((item) => !item.status || item.status === "done");
    const reply = task.chatMessages.find((item) => item.role === "assistant" && item.replyToMessageId === sourceMessage.id && (!item.status || item.status === "done"));
    if (reply) copiedMessages.push(reply);
    const forkId = `task-${randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    const clonedConfig = structuredClone(task.config || {});
    clonedConfig.workflow = "chat-only";
    clonedConfig.chatProvider = sourceMessage.provider || task.config?.chatProvider;
    clonedConfig.chatModel = sourceMessage.model || task.config?.chatModel;
    clonedConfig.chatEffort = sourceMessage.effort || task.config?.chatEffort;
    const forkTask = {
      id: forkId, title: `Fork: ${task.title}`.slice(0, 120), prompt: task.prompt, workspaceId: task.workspaceId, workspacePath: task.workspacePath,
      status: "done", phase: "done", isolated: false, config: clonedConfig, permissionPreset: task.permissionPreset || "workspace-write",
      plan: task.plan || "", implementation: task.implementation || "", review: task.review || "",
      goal: task.goal || "", goalChecklist: (task.goalChecklist || []).map((item) => ({ ...item })), chatMessages: structuredClone(copiedMessages), chatQueue: [],
      forkedFrom: task.id, forkedFromMessageId: sourceMessage.id, createdAt: now, updatedAt: now, completedAt: now,
      events: [{ at: now, kind: "success", text: `Forked from ${task.title} at a completed user message.` }],
      skills: structuredClone(task.skills || []), skillIds: [...(task.skillIds || [])], memoryUsed: structuredClone(task.memoryUsed || []),
      storagePath: resolve(taskDir, forkId),
    };
    await fs.mkdir(forkTask.storagePath, { recursive: true });
    state.tasks.unshift(forkTask); persist(); publish("tasks");
    json(response, 201, { task: forkTask });
    return true;
  }

  if (request.method === "POST" && action === "goal") {
    const body = await readBody(request);
    if (["queued", "running"].includes(task.status)) { json(response, 409, { error: "Hãy đợi task kết thúc trước khi sửa mục tiêu." }); return true; }
    const goal = String(body.goal || "").trim();
    if (goal.length > 2000) { json(response, 400, { error: "Mục tiêu tối đa 2.000 ký tự." }); return true; }
    if (!Array.isArray(body.checklist) || body.checklist.length > 20) { json(response, 400, { error: "Checklist cần là danh sách tối đa 20 mục." }); return true; }
    const checklist = [];
    for (const [index, entry] of body.checklist.entries()) {
      const text = String(typeof entry === "string" ? entry : entry.text || "").trim();
      if (!text || text.length > 300) { json(response, 400, { error: "Mỗi mục checklist cần từ 1 đến 300 ký tự." }); return true; }
      const old = (task.goalChecklist || []).find((item) => item.id === entry?.id) || (task.goalChecklist || [])[index];
      checklist.push({ id: old?.id || randomUUID(), text, done: Boolean(old?.done) });
    }
    task.goal = goal; task.goalChecklist = checklist; task.updatedAt = new Date().toISOString();
    persist(); publish("tasks");
    json(response, 200, { task });
    return true;
  }

  if (request.method === "POST" && action === "checklist") {
    const body = await readBody(request);
    const item = (task.goalChecklist || []).find((entry) => entry.id === body.id);
    if (!item) { json(response, 404, { error: "Không tìm thấy mục checklist." }); return true; }
    item.done = Boolean(body.done); task.updatedAt = new Date().toISOString(); persist(); publish("tasks");
    json(response, 200, { task });
    return true;
  }

  if (request.method === "POST" && action === "pin") {
    const body = await readBody(request); task.pinned = Boolean(body.pinned);
    persist(); publish("tasks");
    json(response, 200, { task });
    return true;
  }

  if (request.method === "POST" && action === "archive") {
    const body = await readBody(request); task.archived = Boolean(body.archived);
    persist(); publish("tasks");
    json(response, 200, { task });
    return true;
  }

  if (request.method === "POST" && action === "chat") {
    const body = await readBody(request);
    const content = String(body.message || "").trim();
    const { safeAttachments, error: attachError } = parseSafeAttachments(body.attachments);
    if (attachError) { json(response, 400, { error: attachError }); return true; }
    if ((!content && !safeAttachments.length) || content.length > 50000) {
      json(response, 400, { error: "Tin nhắn cần có nội dung hoặc tệp đính kèm; phần chữ tối đa 50.000 ký tự." });
      return true;
    }
    const provider = String(body.provider || "");
    const connectors = await loadModels();
    const connector = connectors[provider];
    if (!connector?.available || !connector.capabilities?.chat || provider === "codex" && !connector.authenticated) {
      json(response, 503, { error: connector?.error || `${publicProviderName(provider)} chưa sẵn sàng để chat.` });
      return true;
    }
    if (task.permissionPreset === "read-only" && provider === "antigravity") {
      json(response, 409, { error: "Antigravity CLI chưa có chế độ chỉ đọc cho lần chạy nền. Hãy chọn Codex/Claude/API hoặc đổi preset quyền." });
      return true;
    }
    const model = connector.models.find((item) => item.id === String(body.model || ""));
    const effort = String(body.effort || "");
    if (!model || !model.efforts.includes(effort)) { json(response, 400, { error: `Model hoặc mức suy nghĩ không hợp lệ cho ${publicProviderName(provider)}.` }); return true; }
    const workspace = state.workspaces.find((item) => item.id === task.workspaceId);
    if (!workspace) { json(response, 404, { error: "Workspace của task không còn tồn tại." }); return true; }
    const currentRun = running.get(task.id);
    if (task.status === "cancelled" && currentRun?.stopped) { json(response, 409, { error: "Task đang dừng. Hãy gửi tin nhắn lại sau khi tiến trình đã kết thúc." }); return true; }
    const sharedLock = usesSharedCheckout(task);
    const lockKey = workspaceLockKey(sharedLock ? workspace.path : (task.executionPath || task.worktreePath || workspace.path));
    const workspaceBusy = !currentRun && sharedLock && busyWorkspaces.has(lockKey);
    const message = { id: randomUUID(), role: "user", provider, model: model.id, effort, content, attachments: safeAttachments.map(({ name }) => ({ name })), status: "queued", createdAt: new Date().toISOString() };
    task.config ||= {};
    task.config.chatProvider = provider;
    task.config.chatModel = model.id;
    task.config.chatEffort = effort;
    task.chatMessages ||= [];
    task.chatQueue ||= [];
    task.chatMessages.push(message);
    task.chatQueue.push({ id: randomUUID(), messageId: message.id, provider, model: model.id, effort, content, attachments: safeAttachments });
    const queuedPosition = task.chatQueue.length;
    record(task, `Đã nhận tin nhắn chat cho ${publicProviderName(provider)}${currentRun && !currentRun.isChat ? "; sẽ chuyển sau stage đang chạy" : workspaceBusy ? "; đang chờ workspace rảnh" : ""}.`, "chat");
    persist();
    if (!currentRun && task.status !== "queued") void processTaskChatQueue(task);
    else if (!currentRun) pump();
    json(response, 202, { accepted: true, queuedPosition, task });
    return true;
  }

  if (request.method === "POST" && action === "run") {
    const body = await readBody(request);
    const canReplayCompleted = task.config?.workflow !== "chat-only";
    if (!(["failed", "cancelled"].includes(task.status) || canReplayCompleted && task.status === "done")) {
      json(response, 409, { error: "Chỉ có thể chạy lại task đã hoàn tất, dừng hoặc thất bại." });
      return true;
    }
    if (running.has(task.id)) { json(response, 409, { error: "Task vẫn đang dừng. Hãy thử lại sau khi tiến trình kết thúc." }); return true; }
    const stage = body.stage === undefined ? inferredRerunStage(task) : String(body.stage);
    if (!supportedRerunStages(task).includes(stage)) { json(response, 400, { error: "Giai đoạn chạy lại không hợp lệ với luồng của task." }); return true; }
    if (task.config?.workflow === "chat-only" && task.status === "done") { json(response, 409, { error: "Chat đã hoàn tất. Hãy gửi tin nhắn mới để tiếp tục cuộc trò chuyện." }); return true; }
    if (task.permissionPreset === "read-only" && task.config?.workflow === "codex-antigravity" && (stage === "plan" || stage === "build")) {
      json(response, 400, { error: "Luồng Plan → Build → Review cần quyền ghi vào workspace. Hãy đổi quyền sang Ghi trong workspace trước khi chạy lại." });
      return true;
    }
    const workspace = state.workspaces.find((item) => item.id === task.workspaceId);
    if (!workspace) { json(response, 404, { error: "Workspace của task không còn tồn tại." }); return true; }
    const connectors = await loadModels();
    const notices = [];
    task.config ||= {};
    task.config.roles ||= {};
    for (const roleId of ["plan", "build", "review"]) {
      const role = { ...roleConfig(task.config, roleId) };
      const roleModel = connectors[role.provider]?.models?.find((model) => model.id === role.model);
      if (roleModel && roleModel.efforts?.length && !roleModel.efforts.includes(role.effort)) {
        const previousEffort = role.effort;
        role.effort = roleModel.efforts[0];
        if (roleId === "plan" && role.provider === "codex") task.config.codexEffort = role.effort;
        if (roleId === "build" && role.provider === "antigravity") task.config.agyEffort = role.effort;
        notices.push(`Mức suy nghĩ ${previousEffort} cũ không tương thích với model ${roleModel.name}; dùng ${role.effort} theo cấu hình agent.`);
      }
      task.config.roles[roleId] = role;
    }
    if (task.config.chatProvider && task.config.chatModel) {
      const chatModel = connectors[task.config.chatProvider]?.models?.find((model) => model.id === task.config.chatModel);
      if (chatModel && chatModel.efforts?.length && !chatModel.efforts.includes(task.config.chatEffort)) {
        const previousEffort = task.config.chatEffort;
        task.config.chatEffort = chatModel.efforts[0];
        notices.push(`Mức suy nghĩ chat ${previousEffort} cũ không tương thích với model ${chatModel.name}; dùng ${task.config.chatEffort}.`);
      }
    }
    if (notices.length) task.retryNotice = notices[0];
    const now = new Date().toISOString();
    const attempt = createStageRerunSnapshot(task, stage, now);
    task.stageRunHistory = [...(task.stageRunHistory || []), attempt].slice(-5);
    task.activeStageRunId = attempt.id;
    task.resumeFrom = stage;
    const stageOrder = task.config?.workflow === "plan-only" ? ["plan"] : ["plan", "build", "review"];
    const affected = stage === "chat" ? [] : stageOrder.slice(stageOrder.indexOf(stage));
    if (affected.includes("plan")) task.plan = "";
    if (affected.includes("build")) task.implementation = "";
    if (affected.includes("review")) task.review = "";
    if (affected.includes("plan") || affected.includes("build")) task.artifacts = [];
    if (stage === "chat" || affected.includes("plan") || affected.includes("build")) task.worktreeAppliedAt = null;
    task.status = "queued"; task.phase = "queued"; task.error = null; task.failedPhase = null; task.stageFailure = null; task.completedAt = null;
    persist(); record(task, `Đưa task vào hàng đợi chạy lại từ stage ${stage}; giữ các đầu ra trước đó trong lịch sử.${task.retryNotice ? ` ${task.retryNotice}` : ""}`, "success"); pump();
    json(response, 202, { task });
    return true;
  }

  if (request.method === "POST" && action === "stop") {
    const active = running.get(task.id);
    if (task.status === "queued" && !active) {
      task.failedPhase = task.phase;
      task.status = "cancelled"; task.phase = "cancelled";
      finishStageRerun(task, "cancelled", "Đã hủy khi task còn trong hàng đợi.");
      const abandoned = failQueuedChatTurns(task, true);
      record(task, `Đã hủy khi task còn trong hàng đợi.${abandoned ? ` Đã hủy ${abandoned} tin nhắn đang chờ.` : ""}`, "warning");
      persist();
      json(response, 200, { task });
      return true;
    }
    if (!active) { json(response, 409, { error: "Task không chạy." }); return true; }
    active.stopped = true;
    if (active.child) killTree(active.child);
    if (active.abortController) active.abortController.abort(new Error("Stopped by user"));
    const abandoned = failQueuedChatTurns(task, true);
    if (active.isChat && task.preChatStatus === "done") {
      task.status = "done";
      task.phase = "done";
      task.error = null;
      record(task, `Đã dừng lượt chat theo yêu cầu; giữ nguyên kết quả task đã hoàn tất.${abandoned ? ` Đã hủy ${abandoned} tin nhắn đang chờ.` : ""}`, "warning");
      persist();
      json(response, 202, { task });
      return true;
    }
    finishStageRerun(task, "cancelled", "Đã dừng theo yêu cầu.");
    task.failedPhase = task.phase;
    task.status = "cancelled"; task.phase = "cancelled"; task.completedAt = new Date().toISOString();
    record(task, `Đã gửi yêu cầu dừng tới tiến trình CLI.${abandoned ? ` Đã hủy ${abandoned} tin nhắn đang chờ.` : ""}`, "warning");
    persist();
    json(response, 202, { task });
    return true;
  }

  if (request.method === "POST" && (action === "apply-worktree" || action === "worktree/apply")) {
    const body = await readBody(request);
    try {
      const updated = await applyTaskWorktree(task, { cleanup: Boolean(body.cleanup) });
      json(response, 200, { ok: true, task: updated, appliedFiles: updated.appliedFiles || [] });
    } catch (error) {
      json(response, 409, { error: safeError(error) });
    }
    return true;
  }

  if (request.method === "POST" && (action === "discard-worktree" || action === "worktree/discard")) {
    try {
      await discardTaskWorktree(task);
      json(response, 200, { ok: true, task });
    } catch (error) {
      json(response, 409, { error: safeError(error) });
    }
    return true;
  }

  if (request.method === "GET" && action === "diff") {
    const diff = await checkDiff(task);
    const files = parseUnifiedDiffFiles(diff);
    json(response, 200, {
      diff,
      path: task.executionPath || task.workspacePath,
      files,
      worktree: {
        isolated: Boolean(task.isolated),
        worktreePath: task.worktreePath || null,
        branch: task.worktreeBranch || null,
        appliedAt: task.worktreeAppliedAt || null,
        cleaned: Boolean(task.worktreeCleaned),
      },
    });
    return true;
  }

  if (request.method === "POST" && action === "open") {
    const path = task.executionPath || task.workspacePath;
    if (!path || !existsSync(path)) { json(response, 404, { error: "Không tìm thấy thư mục workspace để mở." }); return true; }
    await openFolder(path);
    json(response, 200, { ok: true });
    return true;
  }

  if (request.method === "GET" && !action) {
    json(response, 200, task);
    return true;
  }

  return false;
}
