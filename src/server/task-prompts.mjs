import { randomUUID } from "node:crypto";
import { providerLabel } from "./provider-registry.mjs";
import { roleConfig, workflowRoles } from "../domain/agent-roles.js";
import { listRemoteContextFiles as listRemoteContextFilesBase, usesSharedCheckout } from "./fs-security.mjs";
import { externalWorkspaceContext as buildExternalWorkspaceContext } from "./api-build-ops.mjs";
import { formatProgressiveSkillsIndex } from "./skill-catalog.mjs";
import { userProfileMemorySnapshot, WORKSPACE_MEMORY_MAX_CHARS } from "./memory-bm25.mjs";

export function roleLabel(role) {
  return workflowRoles.find((item) => item.id === role)?.label || role;
}

export function stageSelection(task, stage) {
  return roleConfig(task.config, stage) || { provider: "codex", model: task.config.codexModel, effort: task.config.codexEffort };
}

export function publicProviderName(provider) {
  return providerLabel(provider);
}

export function normalizeTaskPresetProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Cấu hình mẫu tác vụ không hợp lệ.");
  const workflow = String(input.workflow || "");
  if (!["chat-only", "plan-only", "codex-antigravity"].includes(workflow)) throw new Error("Luồng trong mẫu tác vụ không hợp lệ.");
  const permissionPreset = String(input.permissionPreset || "workspace-write");
  if (!["read-only", "workspace-write", "full-access"].includes(permissionPreset)) throw new Error("Preset quyền trong mẫu không hợp lệ.");
  const selection = (value, label) => {
    const provider = String(value?.provider || "").trim();
    const model = String(value?.model || "").trim();
    const effort = String(value?.effort || "").trim();
    if (!/^[a-z][a-z0-9-]{1,39}$/.test(provider) || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(model) || !/^[A-Za-z][A-Za-z0-9-]{0,29}$/.test(effort)) {
      throw new Error(`Cấu hình ${label} trong mẫu tác vụ không hợp lệ.`);
    }
    return { provider, model, effort };
  };
  const roles = {};
  if (workflow === "plan-only" || workflow === "codex-antigravity") {
    for (const role of workflowRoles) {
      if (workflow === "plan-only" && role.id !== "plan") continue;
      roles[role.id] = selection(input.roles?.[role.id], role.label);
    }
  }
  if (workflow === "chat-only") {
    const chat = selection({ provider: input.chatProvider, model: input.chatModel, effort: input.chatEffort }, "chat");
    return { workflow, permissionPreset, roles, chatProvider: chat.provider, chatModel: chat.model, chatEffort: chat.effort };
  }
  return { workflow, permissionPreset, roles };
}

export function supportedRerunStages(task) {
  if (task.config?.workflow === "chat-only") return ["chat"];
  return task.config?.workflow === "plan-only" ? ["plan"] : ["plan", "build", "review"];
}

export function inferredRerunStage(task) {
  if (task.config?.workflow === "chat-only") return "chat";
  return task.failedPhase || (task.implementation?.startsWith("Antigravity hoàn tất (CLI trả mã 0)") ? "build" : task.plan ? task.implementation ? "review" : "build" : "plan");
}

function stageOutputSnapshot(value) {
  const text = String(value || "");
  const limit = 40_000;
  return { text: text.slice(0, limit), truncated: text.length > limit };
}

export function createStageRerunSnapshot(task, stage, now) {
  const order = task.config?.workflow === "chat-only" ? ["chat"] : task.config?.workflow === "plan-only" ? ["plan"] : ["plan", "build", "review"];
  const start = Math.max(0, order.indexOf(stage));
  const affected = new Set(order.slice(start));
  const previousOutputs = {};
  if (affected.has("plan") && task.plan) previousOutputs.plan = stageOutputSnapshot(task.plan);
  if (affected.has("build") && task.implementation) previousOutputs.build = stageOutputSnapshot(task.implementation);
  if (affected.has("review") && task.review) previousOutputs.review = stageOutputSnapshot(task.review);
  return {
    id: randomUUID(), stage, status: "queued", requestedAt: now,
    previousOutputs,
    previousArtifacts: (task.artifacts || []).slice(0, 100),
    previousExecutionPath: task.executionPath || "",
  };
}

export function validateAgentSelection(selection, capability, connectors) {
  const connector = connectors[selection.provider];
  if (!connector?.available || !connector.capabilities?.[capability]) return `${publicProviderName(selection.provider)} chưa sẵn sàng hoặc không hỗ trợ vai trò ${roleLabel(capability)}.`;
  if (selection.provider === "codex" && !connector.authenticated) return "Codex CLI chưa đăng nhập.";
  const model = connector.models.find((item) => item.id === selection.model);
  if (!model || !model.efforts.includes(selection.effort)) return `Model hoặc mức suy nghĩ không hợp lệ cho ${publicProviderName(selection.provider)}.`;
  return "";
}

export function addTaskUsage(task, provider, usage) {
  if (!usage || typeof usage !== "object") return;
  task.usage ||= {};
  const prev = task.usage[provider] && typeof task.usage[provider] === "object" ? task.usage[provider] : {};
  const next = { ...prev };
  const numericFields = ["input_tokens", "output_tokens", "total_tokens", "cached_input_tokens", "prompt_tokens", "completion_tokens", "cache_read_input_tokens", "cache_creation_input_tokens"];
  for (const [k, v] of Object.entries(usage)) {
    if (numericFields.includes(k) || typeof v === "number") {
      const num = Number(v);
      if (Number.isFinite(num)) next[k] = (Number(prev[k]) || 0) + num;
    } else if (v !== undefined) {
      next[k] = v;
    }
  }
  if (usage.prompt_tokens !== undefined && usage.input_tokens === undefined) {
    next.input_tokens = (Number(prev.input_tokens) || 0) + (Number(usage.prompt_tokens) || 0);
  }
  if (usage.completion_tokens !== undefined && usage.output_tokens === undefined) {
    next.output_tokens = (Number(prev.output_tokens) || 0) + (Number(usage.completion_tokens) || 0);
  }
  const anthropicCacheRead = Number(usage.cache_read_input_tokens || 0);
  const openAiCacheRead = Number(usage.prompt_tokens_details?.cached_tokens || usage.input_tokens_details?.cached_tokens || 0);
  if ((anthropicCacheRead > 0 || openAiCacheRead > 0) && usage.cached_input_tokens === undefined) {
    next.cached_input_tokens = (Number(prev.cached_input_tokens) || 0) + anthropicCacheRead + openAiCacheRead;
  }
  if (next.total_tokens === undefined && (next.input_tokens !== undefined || next.output_tokens !== undefined)) {
    next.total_tokens = (Number(next.input_tokens) || 0) + (Number(next.output_tokens) || 0);
  }
  task.usage[provider] = next;
}

export function fullChatHistoryBefore(task, messageId) {
  const messages = task.chatMessages || [];
  const messageIndex = messageId ? messages.findIndex((message) => message.id === messageId) : messages.length;
  if (messageIndex < 0) return [];
  const priorUsers = messages.slice(0, messageIndex)
    .filter((message) => message.role === "user" && (message.status === undefined || message.status === "done"));
  const assistantReplies = messages.filter((message) => message.role === "assistant" && (message.status === undefined || message.status === "done"));
  const usedReplies = new Set();
  const history = [];
  for (const userMessage of priorUsers) {
    history.push(userMessage);
    let reply = assistantReplies.find((message) => message.replyToMessageId === userMessage.id && !usedReplies.has(message.id));
    if (!reply) reply = assistantReplies.find((message) => !message.replyToMessageId && !usedReplies.has(message.id));
    if (reply) {
      usedReplies.add(reply.id);
      history.push(reply);
    }
  }
  return history.map(({ id, role, provider, content }) => ({ id, role, provider, content }));
}

export function summarizeTurnsForCompaction(turns = [], existingSummary = "") {
  if (!Array.isArray(turns) || !turns.length) return existingSummary || "";
  const bullets = [];
  for (let i = 0; i < turns.length; i += 1) {
    const turn = turns[i];
    const speaker = turn.role === "user" ? "User" : (turn.provider || "Assistant");
    const firstLine = String(turn.content || "")
      .replace(/```[\s\S]*?```/g, "[code block]")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(" · ")
      .slice(0, 220);
    if (firstLine) bullets.push(`- [${speaker}] ${firstLine}`);
  }
  const combined = [
    ...(existingSummary ? [existingSummary.trim()] : []),
    ...bullets,
  ].join("\n");
  return combined.length > 3200 ? `...\n${combined.slice(-3200)}` : combined;
}

export function compactChatHistory(task, fullHistory = null, windowSize = 12) {
  const resolvedHistory = Array.isArray(fullHistory) ? fullHistory : fullChatHistoryBefore(task, null);
  if (!resolvedHistory.length || resolvedHistory.length <= windowSize) {
    const recent = resolvedHistory.map(({ role, provider, content }) => ({ role, provider, content }));
    return {
      recentHistory: recent,
      recentMessages: recent,
      compactedSummary: task?.chatCompactedSummary || "",
      compactedCount: task?.chatCompactedCount || 0,
    };
  }
  const olderTurns = resolvedHistory.slice(0, resolvedHistory.length - windowSize);
  const recentTurns = resolvedHistory.slice(-windowSize);
  const alreadyCompacted = Number(task?.chatCompactedCount || 0);
  const newlyAgedTurns = olderTurns.slice(alreadyCompacted);
  if (newlyAgedTurns.length > 0 && task) {
    task.chatCompactedSummary = summarizeTurnsForCompaction(newlyAgedTurns, task.chatCompactedSummary || "");
    task.chatCompactedCount = olderTurns.length;
    task.compactionLineage ||= [];
    task.compactionLineage.push({
      id: `compact-${randomUUID().slice(0, 8)}`,
      at: new Date().toISOString(),
      compactedMessages: olderTurns.length,
      keptRecentMessages: recentTurns.length,
    });
    task.compactionLineage = task.compactionLineage.slice(-12);
  }
  const recent = recentTurns.map(({ role, provider, content }) => ({ role, provider, content }));
  return {
    recentHistory: recent,
    recentMessages: recent,
    compactedSummary: task?.chatCompactedSummary || summarizeTurnsForCompaction(olderTurns),
    compactedCount: olderTurns.length,
  };
}

export function compactTaskConversationNow(task, keepRecentMessages = 6) {
  const fullHistory = fullChatHistoryBefore(task, null);
  const keep = Math.max(2, Math.min(12, Number(keepRecentMessages) || 6));
  if (fullHistory.length <= keep) {
    const summary = summarizeTurnsForCompaction(fullHistory, task.chatCompactedSummary || "");
    task.chatCompactedSummary = summary;
    task.chatCompactedCount = fullHistory.length;
    task.compactionLineage ||= [];
    task.compactionLineage.push({
      id: `compact-${randomUUID().slice(0, 8)}`,
      at: new Date().toISOString(),
      compactedMessages: fullHistory.length,
      keptRecentMessages: fullHistory.length,
    });
    return {
      compacted: fullHistory.length > 0,
      compactedCount: fullHistory.length,
      keptCount: fullHistory.length,
      compactedMessages: fullHistory.length,
      keptRecentMessages: fullHistory.length,
      summary,
    };
  }
  const res = compactChatHistory(task, fullHistory, keep);
  return {
    compacted: res.compactedCount > 0,
    compactedCount: res.compactedCount,
    keptCount: res.recentHistory.length,
    compactedMessages: res.compactedCount,
    keptRecentMessages: res.recentHistory.length,
    summary: res.compactedSummary,
  };
}

export function chatHistoryBefore(task, messageId) {
  const fullHistory = fullChatHistoryBefore(task, messageId);
  const { recentHistory } = compactChatHistory(task, fullHistory, 12);
  return recentHistory;
}

export function projectSourceFolders(task, workspace) {
  if (!usesSharedCheckout(task)) return [task.executionPath || task.workspacePath || workspace?.path].filter(Boolean);
  const folders = workspace?.sourceFolders?.length ? workspace.sourceFolders : [workspace?.path];
  return [...new Set(folders.filter(Boolean))];
}

export function createTaskPromptService({
  getState,
  getMemories,
  isForbiddenSystemPath,
  hasApiProvider,
  git,
  relevantMemory,
  skillProviderCompatible,
  skillInstructions,
}) {
  function additionalWritableProjectDirs(task, cwd) {
    if (!usesSharedCheckout(task)) return [];
    const workspace = getState().workspaces.find((item) => item.id === task.workspaceId);
    return projectSourceFolders(task, workspace).filter((directory) => directory.toLowerCase() !== String(cwd).toLowerCase() && !isForbiddenSystemPath(directory));
  }

  function requestedRole(body, roleId, connectors) {
    const defaults = getState().settings.defaults || {};
    const saved = defaults.roles?.[roleId] || roleConfig(defaults, roleId);
    const submitted = body.roles?.[roleId] || {};
    const provider = String(submitted.provider || body[`${roleId}Provider`] || saved?.provider || "");
    const connector = connectors[provider];
    const model = String(submitted.model || body[`${roleId}Model`] || saved?.model || connector?.models?.[0]?.id || "");
    const modelInfo = connector?.models?.find((item) => item.id === model);
    const effort = String(submitted.effort || body[`${roleId}Effort`] || saved?.effort || modelInfo?.efforts?.find((item) => item === "medium") || modelInfo?.efforts?.[0] || "");
    return { provider, model, effort };
  }

  async function listRemoteContextFiles(cwd, maxFiles = 180) {
    return listRemoteContextFilesBase(cwd, maxFiles, git);
  }

  async function externalWorkspaceContext(task, stage) {
    return buildExternalWorkspaceContext(task, stage, git);
  }

  function frozenUserSnapshotText() {
    const snap = userProfileMemorySnapshot(getMemories?.() || []);
    return snap ? `\n\nUser profile & global preferences (USER.md snapshot):\n${snap}` : "";
  }

  function makePrompt(task, stage, plan, memory, workspace, skillInstructionsList = [], roundInfo = null) {
    const userProfileText = frozenUserSnapshotText();
    const memText = memory.length
      ? `\n\nRelevant workspace memory (MEMORY.md lessons):\n${memory.map((m) => `- ${m.title}: ${m.content}`).join("\n").slice(0, WORKSPACE_MEMORY_MAX_CHARS)}`
      : "";
    const provider = stageSelection(task, stage).provider;
    const applicableSkills = skillInstructionsList.filter((skill) => skillProviderCompatible(provider, skill.providers || ["codex", "antigravity"]));
    const skillText = applicableSkills.length
      ? `\n\nSelected skills for ${provider} (follow only when relevant to the user's request):\n${applicableSkills.map((skill) => `<skill name="${skill.name}">\n${skill.instruction}${skill.runtimeDirectory ? `\n\nSupporting files for this skill are available in the task copy at: ${skill.runtimeDirectory}. Read referenced files from there when needed.` : ""}\n</skill>`).join("\n\n")}`
      : "";
    const progressiveIndexText = !hasApiProvider(provider)
      ? formatProgressiveSkillsIndex((task.progressiveSkills || []).filter((s) => skillProviderCompatible(provider, s.providers || ["*"])))
      : "";
    const goalText = task.goal ? `\n\nLong-term goal:\n${task.goal}${task.goalChecklist?.length ? `\nAcceptance checklist:\n${task.goalChecklist.map((item) => `- [${item.done ? "x" : " "}] ${item.text}`).join("\n")}` : ""}` : "";
    const gateFeedbackText = task.planGateFeedback ? `\n\nHuman Plan Gate guidance / feedback:\n${task.planGateFeedback}` : "";
    const attachmentText = Array.isArray(task.attachments) && task.attachments.length
      ? `\n\nAttached files:\n${task.attachments.map((file) => `### ${String(file.name || "attached file").slice(0, 180)}\n${String(file.content || "")}`).join("\n\n")}`
      : "";

    // Tier 1 (Stable) -> Tier 2 (Context) -> Tier 3 (Volatile Request)
    const context = `Workspace: ${task.executionPath || workspace.path}\nProject source folders:\n${projectSourceFolders(task, workspace).map((directory) => `- ${directory}`).join("\n")}${userProfileText}${memText}${skillText}${progressiveIndexText}${goalText}${gateFeedbackText}\nUser request:\n${task.prompt}${attachmentText}`;

    if (stage === "plan") {
      return `You are the planning agent in a local coding workflow. Inspect the project context provided. Do not modify files. Produce a concise implementation plan, risks, files likely involved, and checks. If you are an API provider, you may either request read-only workspace inspection via {"tool_call":{"name":"read_file"|"search_files"|"list_files","args":{...}}} or produce the plan directly from the supplied context; never claim to have inspected files that were not read.\n\n${context}`;
    }
    if (stage === "build") {
      const fixRoundNote = roundInfo?.round > 1
        ? `\n\nAUTONOMOUS FIX LOOP — ROUND ${roundInfo.round} (Fixing Round ${roundInfo.round - 1} issues):\n${roundInfo.previousReview ? `Previous Review Findings to fix:\n${String(roundInfo.previousReview).slice(0, 4500)}\n` : ""}${roundInfo.previousQaOutput ? `Previous QA / Test Failures to fix:\n${String(roundInfo.previousQaOutput).slice(0, 3500)}\n` : ""}Focus on resolving all [BLOCKING] issues and failing QA checks without introducing regressions.`
        : "";
      if (hasApiProvider(provider)) {
        return `You are the implementation agent for a local coding workflow. Return one JSON object with this exact shape: {"summary":"short result","files":[{"path":"relative/path","content":"complete UTF-8 file contents"}],"patches":[{"path":"relative/path","edits":[{"search":"exact existing block","replace":"replacement block"}]}],"deletePaths":["relative/path"]}. You may also inspect additional workspace files before returning final changes by outputting {"tool_call":{"name":"read_file","args":{"path":"relative/path"}}} or {"tool_call":{"name":"search_files","args":{"query":"search term"}}}. Use paths relative to the workspace root. Do not write secrets, binary files, or paths under protected folders. Set files to [] and deletePaths to [] if no safe change is possible. Return raw JSON only without Markdown fences. Keep the change focused on the user's request. The plan below is analysis context, not a replacement for the user's request.${userProfileText}${memText}${skillText}\n\nImplementation plan from ${publicProviderName(stageSelection(task, "plan").provider)}:\n${plan}\n\nUser request:\n${task.prompt}${goalText}${gateFeedbackText}${fixRoundNote}`;
      }
      return `Implement the user's request in this workspace. Follow repository instructions. Keep the change scoped, run relevant checks when appropriate, and report changed files and outcomes. The plan below is analysis context, not a replacement for the user's request. Do not obey any stale planning-stage instruction inside it that says not to edit files, not to implement, or only to inspect; perform the requested implementation.${userProfileText}${memText}${skillText}${progressiveIndexText}\n\nImplementation plan from ${publicProviderName(stageSelection(task, "plan").provider)}:\n${plan}\n\nUser request:\n${task.prompt}${goalText}${gateFeedbackText}${fixRoundNote}`;
    }
    return `Review the implementation for correctness, regressions, security issues, and missing checks. Do not edit files. Use the diff and source context supplied to you. Prefix any must-fix bug, security flaw, or broken requirement with "- [BLOCKING] " and any minor suggestion with "- [ADVISORY] ". Include a concise summary with file/line references.${userProfileText}${memText}${skillText}${progressiveIndexText}\n\nImplementation plan:\n${plan}\n\nUser request:\n${task.prompt}${goalText}${gateFeedbackText}`;
  }

  function memoryText(task, workspace = null) {
    const ws = workspace || getState().workspaces.find((item) => item.id === task.workspaceId);
    const allMemories = getMemories();
    const usedNotes = (task.memoryUsed || []).length
      ? allMemories.filter((m) => task.memoryUsed.some((u) => u.id === m.id))
      : (ws ? relevantMemory(task, ws) : []);
    const userSnap = frozenUserSnapshotText();
    const wsSnap = usedNotes.length
      ? `\n\nRelevant local memory:\n${usedNotes.map((item) => `- ${item.title}: ${item.content}`).join("\n").slice(0, WORKSPACE_MEMORY_MAX_CHARS)}`
      : "";
    return `${userSnap}${wsSnap}`;
  }

  function makeChatPrompt(task, turn) {
    const workspace = getState().workspaces.find((item) => item.id === task.workspaceId);
    const fullHistory = fullChatHistoryBefore(task, turn.messageId);
    const { recentHistory, compactedSummary } = compactChatHistory(task, fullHistory, 12);
    const history = recentHistory.map((message) => `${message.role === "user" ? "User" : message.provider || "Assistant"}: ${String(message.content || "").slice(0, 4000)}`).join("\n\n");
    const compactedSection = compactedSummary
      ? `\n\nCompacted earlier conversation summary (${task.chatCompactedCount || 0} earlier turns):\n${compactedSummary}`
      : "";
    const plan = String(task.plan || "").slice(0, 4500);
    const implementation = String(task.implementation || "").slice(0, 6000);
    const review = String(task.review || "").slice(0, 4000);
    const implementationSection = implementation ? `\n\nSaved implementation summary (truncated if long):\n${implementation}` : "";
    const reviewSection = review ? `\n\nSaved review findings (truncated if long):\n${review}` : "";
    const memSection = memoryText(task, workspace);
    const skillSection = skillInstructions(task, turn?.provider || task.config?.chatProvider || "codex");
    const latestEvents = (task.events || []).filter((event) => ["stage", "handoff", "tool", "error", "success"].includes(event.kind)).slice(-8).map((event) => `- ${String(event.text).slice(0, 220)}`).join("\n");
    const goalText = task.goal ? `\n\nLong-term goal:\n${task.goal}${task.goalChecklist?.length ? `\nAcceptance checklist:\n${task.goalChecklist.map((item) => `- [${item.done ? "x" : " "}] ${item.text}`).join("\n")}` : ""}` : "";
    const accessNote = task.permissionPreset === "read-only" ? "You may inspect files but must not edit, create, or delete workspace files." : task.permissionPreset === "full-access" ? "The user explicitly granted full local access for this task. You may run commands and read or modify files anywhere available to the user's operating-system account, but keep changes scoped to the request." : "You may inspect or edit files to fulfill the new request, but keep changes scoped to what the user asks; inspect only files relevant to the request.";
    const attachments = Array.isArray(turn.attachments) ? turn.attachments : [];
    const attachmentText = attachments.length
      ? `\n\nAttached files:\n${attachments.map((file) => `### ${String(file.name || "attached file").slice(0, 180)}\n${String(file.content || "")}`).join("\n\n")}`
      : "";
    return `Continue the user's OpenSybau conversation for this real workspace. Answer in the user's language. ${accessNote} The latest user message defines this chat turn and may request work that differs from the long-term goal. Follow that explicit request for this turn, briefly point out a conflict with the saved goal, and never silently change the saved goal. If the user wants a lasting direction change, tell them to update it through the Goal control. Do not reveal private chain-of-thought; give a concise rationale, actions, and results.\n\nWorkspace: ${task.executionPath || task.workspacePath}\nProject source folders:\n${projectSourceFolders(task, workspace).map((directory) => `- ${directory}`).join("\n")}\nOriginal task: ${String(task.prompt).slice(0, 5000)}${goalText}${memSection}${skillSection}\nSaved plan (truncated if long):\n${plan || "No plan saved."}${implementationSection}${reviewSection}${compactedSection}\n\nRecent observable activity:\n${latestEvents || "No activity recorded."}\n\nRecent conversation:\n${history || "No earlier chat messages."}\n\nNew user message:\n${String(turn.content).slice(0, 50000)}${attachmentText}`;
  }

  function makeInitialChatPrompt(task, memory, skillInstructionsList, workspace) {
    const userProfileText = frozenUserSnapshotText();
    const memText = memory.length ? `\n\nRelevant local memory:\n${memory.map((item) => `- ${item.title}: ${item.content}`).join("\n").slice(0, WORKSPACE_MEMORY_MAX_CHARS)}` : "";
    const provider = task.config.chatProvider || "codex";
    const applicableSkills = skillInstructionsList.filter((skill) => skillProviderCompatible(provider, skill.providers || ["codex", "antigravity"]));
    const skillText = applicableSkills.length ? `\n\nSelected local skills:\n${applicableSkills.map((skill) => `- ${skill.name}: ${String(skill.instruction).slice(0, 5000)}`).join("\n\n").slice(0, 7000)}` : "";
    const progressiveIndexText = !hasApiProvider(provider)
      ? formatProgressiveSkillsIndex((task.progressiveSkills || []).filter((s) => skillProviderCompatible(provider, s.providers || ["*"])))
      : "";
    const goalText = task.goal ? `\n\nLong-term goal:\n${task.goal}${task.goalChecklist?.length ? `\nAcceptance checklist:\n${task.goalChecklist.map((item) => `- [${item.done ? "x" : " "}] ${item.text}`).join("\n")}` : ""}` : "";
    const readOnly = task.permissionPreset === "read-only";
    const accessNote = provider === "claude-api" || hasApiProvider(provider) ? "You may inspect supplied context or request read-only file lookups via tool_call JSON; never claim to have inspected or changed files that were not read." : readOnly ? "You may inspect files but must not edit, create, or delete workspace files." : task.permissionPreset === "full-access" ? "The user explicitly granted full local access for this task. You may run commands and access files anywhere available to the user's operating-system account, while keeping changes scoped to the request." : "Inspect relevant files only when useful. You may edit files only when the user asks for a change; keep edits scoped.";
    const attachmentText = Array.isArray(task.attachments) && task.attachments.length
      ? `\n\nAttached files:\n${task.attachments.map((file) => `### ${String(file.name || "attached file").slice(0, 180)}\n${String(file.content || "")}`).join("\n\n")}`
      : "";
    return `You are ${publicProviderName(provider)} in a continuing local project conversation. Answer in the user's language. Be conversational and concise. ${accessNote} Treat the user's latest explicit request as the work for this turn. If it differs from the saved long-term goal, briefly point out the conflict, follow the request for this turn, and do not silently change the saved goal. Never reveal private chain-of-thought; summarize your rationale, actions, and results.\n\nWorkspace: ${task.executionPath || workspace.path}\nProject: ${workspace.name}\nProject source folders:\n${projectSourceFolders(task, workspace).map((directory) => `- ${directory}`).join("\n")}${userProfileText}${goalText}${memText}${skillText}${progressiveIndexText}\n\nUser message:\n${String(task.prompt).slice(0, 50000)}${attachmentText}`;
  }

  return {
    additionalWritableProjectDirs,
    requestedRole,
    listRemoteContextFiles,
    externalWorkspaceContext,
    makePrompt,
    memoryText,
    makeChatPrompt,
    makeInitialChatPrompt,
  };
}
