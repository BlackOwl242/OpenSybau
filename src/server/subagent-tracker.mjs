import { randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const MAX_TASK_SUBAGENTS = 64;
const MAX_SUBAGENT_EVENTS = 120;
const MAX_SUBAGENT_FILES = 60;

export function normalizeSubagentPolicy(raw = null) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      mode: "auto",
      codexMultiAgentV2: false,
      sharedCheckoutReadOnly: true,
      profileIds: [],
    };
  }
  const rawMode = String(raw.mode || "").trim().toLowerCase();
  const mode = ["auto", "enabled", "disabled"].includes(rawMode) ? rawMode : "auto";
  const codexMultiAgentV2 = Boolean(raw.codexMultiAgentV2);
  const sharedCheckoutReadOnly = raw.sharedCheckoutReadOnly !== false;
  const profileIds = Array.isArray(raw.profileIds)
    ? [...new Set(raw.profileIds.map((id) => String(id || "").trim().toLowerCase()).filter((id) => /^[a-f0-9]{8,32}$/.test(id)))].slice(0, 16)
    : [];
  return { mode, codexMultiAgentV2, sharedCheckoutReadOnly, profileIds };
}

function cleanIdPart(value = "") {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function previewText(value = "", maxLen = 280) {
  const clean = String(value || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 1)}…` : clean;
}

function mergeUsageMetrics(prev = null, incoming = null) {
  if (!incoming || typeof incoming !== "object") return prev || null;
  const base = prev && typeof prev === "object"
    ? { ...prev }
    : { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0, total_tokens: 0 };
  const input = Number(incoming.input_tokens ?? incoming.prompt_tokens ?? 0) || 0;
  const output = Number(incoming.output_tokens ?? incoming.completion_tokens ?? 0) || 0;
  const cached = Number(
    incoming.cached_input_tokens
    ?? incoming.cache_read_input_tokens
    ?? incoming.prompt_tokens_details?.cached_tokens
    ?? incoming.input_tokens_details?.cached_tokens
    ?? 0
  ) || 0;
  const explicitTotal = Number(incoming.total_tokens ?? 0) || 0;
  base.input_tokens = (Number(base.input_tokens) || 0) + input;
  base.output_tokens = (Number(base.output_tokens) || 0) + output;
  base.cached_input_tokens = (Number(base.cached_input_tokens) || 0) + cached;
  base.total_tokens = (Number(base.total_tokens) || 0) + (explicitTotal || (input + output));
  return base;
}

export function ensureTaskSubagentContainers(task) {
  if (!Array.isArray(task.subagents)) task.subagents = [];
  if (!task._subagentDetails || typeof task._subagentDetails !== "object" || Array.isArray(task._subagentDetails)) {
    Object.defineProperty(task, "_subagentDetails", {
      value: {},
      writable: true,
      configurable: true,
      enumerable: false,
    });
  }
  return { summaries: task.subagents, details: task._subagentDetails };
}

export function hydrateTaskSubagentDetails(task, detailPayload = {}) {
  if (!task || typeof task !== "object") return;
  if ((!Array.isArray(task.subagents) || !task.subagents.length) && Array.isArray(detailPayload.subagents) && detailPayload.subagents.length) {
    task.subagents = detailPayload.subagents;
  }
  const { details } = ensureTaskSubagentContainers(task);
  if (detailPayload.subagentDetails && typeof detailPayload.subagentDetails === "object" && !Array.isArray(detailPayload.subagentDetails)) {
    for (const [id, item] of Object.entries(detailPayload.subagentDetails)) {
      if (!details[id] && item && typeof item === "object") {
        details[id] = {
          id,
          prompt: String(item.prompt || ""),
          result: String(item.result || ""),
          events: Array.isArray(item.events) ? item.events.slice(-MAX_SUBAGENT_EVENTS) : [],
          filesTouched: Array.isArray(item.filesTouched) ? item.filesTouched.slice(0, MAX_SUBAGENT_FILES) : [],
        };
      }
    }
  }
}

export function serializeTaskSubagentDetails(task) {
  if (!task || typeof task !== "object") return {};
  const raw = task._subagentDetails;
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const sub of task.subagents || []) {
    if (!sub?.id || !raw[sub.id]) continue;
    const detail = raw[sub.id];
    out[sub.id] = {
      id: sub.id,
      prompt: String(detail.prompt || "").slice(0, 32_000),
      result: String(detail.result || "").slice(0, 48_000),
      events: Array.isArray(detail.events) ? detail.events.slice(-MAX_SUBAGENT_EVENTS) : [],
      filesTouched: Array.isArray(detail.filesTouched) ? detail.filesTouched.slice(0, MAX_SUBAGENT_FILES) : [],
    };
  }
  return out;
}

export function getTaskSubagentsWithDetails(task) {
  const { summaries, details } = ensureTaskSubagentContainers(task);
  return summaries.map((sub) => {
    const detail = details[sub.id] || {};
    return {
      ...sub,
      prompt: detail.prompt || sub.promptPreview || "",
      result: detail.result || sub.resultPreview || "",
      events: Array.isArray(detail.events) ? detail.events : [],
      filesTouched: Array.isArray(detail.filesTouched) ? detail.filesTouched : [],
    };
  });
}

export function countActiveSubagents(tasks = []) {
  let active = 0;
  let total = 0;
  for (const task of tasks || []) {
    const list = Array.isArray(task?.subagents) ? task.subagents : [];
    total += list.length;
    if (task.status !== "running") continue;
    for (const sub of list) {
      if (["spawning", "running", "waiting"].includes(sub?.status)) active += 1;
    }
  }
  return { active, total };
}

export function createStageSubagentTracker({
  task,
  harness,
  stage,
  round = 1,
  record,
  addTaskUsage,
  schedulePersist,
  schedulePublish,
}) {
  const { summaries, details } = ensureTaskSubagentContainers(task);
  const aliasToId = new Map();
  const stageSpawnedIds = new Set();

  for (const existing of summaries) {
    if (!existing?.id) continue;
    aliasToId.set(existing.id, existing.id);
    if (existing.externalId) aliasToId.set(String(existing.externalId), existing.id);
    for (const alias of existing.aliases || []) {
      aliasToId.set(String(alias), existing.id);
    }
  }

  function touchTask(nowIso) {
    task.updatedAt = nowIso;
    schedulePersist?.();
    schedulePublish?.("task");
  }

  function findByExternalId(externalKey) {
    if (!externalKey) return null;
    const resolvedId = aliasToId.get(String(externalKey));
    if (!resolvedId) return null;
    return summaries.find((item) => item.id === resolvedId) || null;
  }

  function bindAlias(sub, aliasKey) {
    const clean = String(aliasKey || "").trim();
    if (!sub?.id || !clean) return;
    aliasToId.set(clean, sub.id);
    if (!sub.externalId) sub.externalId = clean;
    sub.aliases ||= [];
    if (!sub.aliases.includes(clean) && sub.aliases.length < 8) {
      sub.aliases.push(clean);
    }
  }

  function upsertSubagent(patch = {}) {
    const nowIso = patch.at || new Date().toISOString();
    const lookupKeys = [patch.id, patch.externalId, ...(patch.aliases || [])].filter(Boolean).map(String);
    let sub = null;
    for (const key of lookupKeys) {
      sub = findByExternalId(key);
      if (sub) break;
    }

    const parentSub = patch.parentExternalId ? findByExternalId(patch.parentExternalId) : (patch.parentId ? findByExternalId(patch.parentId) : null);

    if (!sub) {
      const idSuffix = cleanIdPart(patch.externalId || patch.id || randomUUID().slice(0, 8)) || randomUUID().slice(0, 8);
      const id = patch.id && String(patch.id).startsWith("sub-") ? String(patch.id) : `sub-${harness}-${idSuffix}`;
      sub = {
        id,
        externalId: patch.externalId ? String(patch.externalId) : "",
        aliases: [],
        harness,
        stage: String(stage || "chat"),
        round: Number(round || task.currentRound || 1),
        parentId: parentSub?.id || null,
        name: String(patch.name || patch.agentType || patch.role || "subagent").trim().slice(0, 80),
        role: String(patch.role || patch.name || patch.agentType || "Subagent").trim().slice(0, 140),
        agentType: String(patch.agentType || patch.name || "subagent").trim().slice(0, 80),
        model: String(patch.model || "inherit").trim().slice(0, 80),
        workspaceMode: String(patch.workspaceMode || "inherit").trim().slice(0, 32),
        background: Boolean(patch.background),
        status: patch.status || "running",
        startedAt: nowIso,
        updatedAt: nowIso,
        completedAt: null,
        durationMs: 0,
        toolCount: 0,
        errorCount: 0,
        filesCount: 0,
        lastActivity: "",
        usage: null,
        promptPreview: "",
        resultPreview: "",
      };
      summaries.push(sub);
      if (summaries.length > MAX_TASK_SUBAGENTS) {
        const evicted = summaries.shift();
        if (evicted?.id) delete details[evicted.id];
      }
      aliasToId.set(sub.id, sub.id);
      stageSpawnedIds.add(sub.id);
    }

    for (const key of lookupKeys) bindAlias(sub, key);
    if (parentSub?.id && !sub.parentId && parentSub.id !== sub.id) {
      sub.parentId = parentSub.id;
    }
    if (patch.name) sub.name = String(patch.name).trim().slice(0, 80);
    if (patch.role) sub.role = String(patch.role).trim().slice(0, 140);
    if (patch.agentType) sub.agentType = String(patch.agentType).trim().slice(0, 80);
    if (patch.model && (sub.model === "inherit" || !sub.model)) sub.model = String(patch.model).trim().slice(0, 80);
    if (patch.workspaceMode && sub.workspaceMode === "inherit") sub.workspaceMode = String(patch.workspaceMode).trim().slice(0, 32);
    if (patch.background !== undefined) sub.background = Boolean(patch.background);

    const detail = (details[sub.id] ||= {
      id: sub.id,
      prompt: "",
      result: "",
      events: [],
      filesTouched: [],
    });

    if (patch.prompt && typeof patch.prompt === "string") {
      detail.prompt = patch.prompt.slice(0, 32_000);
      sub.promptPreview = previewText(patch.prompt, 280);
    }
    if (patch.result && typeof patch.result === "string") {
      detail.result = patch.result.slice(0, 48_000);
      sub.resultPreview = previewText(patch.result, 400);
    }
    if (patch.usage) {
      sub.usage = mergeUsageMetrics(sub.usage, patch.usage);
    }
    if (Number(patch.toolCountFloor) > sub.toolCount) {
      sub.toolCount = Number(patch.toolCountFloor);
    }
    if (patch.incrementTools) {
      sub.toolCount += Number(patch.incrementTools) || 1;
    }
    if (patch.incrementErrors) {
      sub.errorCount += Number(patch.incrementErrors) || 1;
    }
    if (patch.filePath && typeof patch.filePath === "string") {
      const cleanFile = patch.filePath.trim().slice(0, 220);
      if (cleanFile && !detail.filesTouched.includes(cleanFile) && detail.filesTouched.length < MAX_SUBAGENT_FILES) {
        detail.filesTouched.push(cleanFile);
        sub.filesCount = detail.filesTouched.length;
      }
    }
    if (patch.lastActivity) {
      sub.lastActivity = previewText(patch.lastActivity, 180);
    }
    if (patch.eventEntry && typeof patch.eventEntry === "object") {
      detail.events.push({
        at: nowIso,
        ...patch.eventEntry,
      });
      if (detail.events.length > MAX_SUBAGENT_EVENTS) {
        detail.events = detail.events.slice(-MAX_SUBAGENT_EVENTS);
      }
    }

    if (patch.status) {
      sub.status = patch.status;
    }
    sub.updatedAt = nowIso;
    const startedMs = Date.parse(sub.startedAt) || Date.now();
    const nowMs = Date.parse(nowIso) || Date.now();
    if (["completed", "failed", "cancelled"].includes(sub.status)) {
      sub.completedAt = sub.completedAt || nowIso;
      sub.durationMs = Number(patch.durationMs) > 0
        ? Number(patch.durationMs)
        : Math.max(0, (Date.parse(sub.completedAt) || nowMs) - startedMs);
    } else {
      sub.durationMs = Math.max(0, nowMs - startedMs);
    }

    touchTask(nowIso);
    return sub;
  }

  function recordSubagentTool({
    externalId,
    toolId = "",
    toolName = "tool",
    command = "",
    filePath = "",
    detailText = "",
    status = "running",
    isError = false,
    exitCode = undefined,
  }) {
    const sub = findByExternalId(externalId);
    if (!sub) return null;
    const detail = (details[sub.id] ||= { id: sub.id, prompt: "", result: "", events: [], filesTouched: [] });
    const nowIso = new Date().toISOString();

    if (status === "done" && toolId) {
      const existingEv = [...detail.events].reverse().find((ev) => ev.toolId === toolId && ev.status === "running");
      if (existingEv) {
        existingEv.status = isError ? "failed" : "done";
        existingEv.completedAt = nowIso;
        if (detailText) existingEv.detail = String(detailText).slice(0, 600);
        if (exitCode !== undefined) existingEv.exitCode = exitCode;
        if (isError) sub.errorCount += 1;
        sub.updatedAt = nowIso;
        sub.durationMs = Math.max(0, Date.now() - (Date.parse(sub.startedAt) || Date.now()));
        touchTask(nowIso);
        return sub;
      }
    }

    const summaryLine = `${toolName}${command ? ` · ${command.slice(0, 90)}` : filePath ? ` · ${filePath}` : ""}`;
    return upsertSubagent({
      id: sub.id,
      incrementTools: status === "running" ? 1 : 0,
      incrementErrors: isError ? 1 : 0,
      filePath,
      lastActivity: summaryLine,
      eventEntry: {
        kind: isError ? "error" : "tool",
        toolId: toolId || undefined,
        toolName: String(toolName).slice(0, 100),
        command: command || undefined,
        filePath: filePath || undefined,
        detail: detailText ? String(detailText).slice(0, 600) : undefined,
        exitCode,
        status: isError ? "failed" : status,
        text: summaryLine,
      },
    });
  }

  function finalizeStageSubagents(outcome = "completed", reason = "") {
    const nowIso = new Date().toISOString();
    let changed = false;
    for (const sub of summaries) {
      if (!stageSpawnedIds.has(sub.id)) continue;
      if (!["spawning", "running", "waiting"].includes(sub.status)) continue;
      sub.status = outcome === "cancelled" ? "cancelled" : outcome === "failed" ? "failed" : "completed";
      sub.completedAt = nowIso;
      sub.updatedAt = nowIso;
      sub.durationMs = Math.max(0, Date.now() - (Date.parse(sub.startedAt) || Date.now()));
      if (reason) sub.lastActivity = previewText(reason, 180);
      else if (sub.status === "completed" && !sub.resultPreview) {
        sub.lastActivity = sub.lastActivity || "Hoàn tất cùng phiên chính";
      }
      changed = true;
    }
    if (changed) touchTask(nowIso);
  }

  return {
    task,
    harness,
    stage,
    record,
    addTaskUsage,
    schedulePersist,
    schedulePublish,
    findByExternalId,
    bindAlias,
    upsertSubagent,
    recordSubagentTool,
    finalizeStageSubagents,
  };
}

export function createClaudeStreamContext(task, outputParts, tracker) {
  return {
    task,
    outputParts,
    tracker,
    toolUseMap: new Map(),
    sawStreamDeltas: false,
    turnUsageFallback: null,
    finalResultText: "",
    resultReceived: false,
  };
}

export function parseClaudeStreamLine(line, ctx) {
  const { task, outputParts, tracker } = ctx;
  const { record, addTaskUsage } = tracker;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  if (!event || typeof event !== "object") return;

  const sid = event.session_id || event.conversation_id;
  if (sid && typeof sid === "string") {
    task.cliSessions ||= {};
    task.cliSessions.claude = sid;
  }

  const type = String(event.type || "").toLowerCase();
  const parentToolUseId = event.parent_tool_use_id || event.message?.parent_tool_use_id || null;

  if (type === "stream_event") {
    const inner = event.event || {};
    if (!parentToolUseId && inner.type === "content_block_delta" && inner.delta?.type === "text_delta" && inner.delta?.text) {
      ctx.sawStreamDeltas = true;
      outputParts.push(inner.delta.text);
      record(task, inner.delta.text.slice(-1500), "output");
    }
    return;
  }

  if (type === "assistant") {
    const msgUsage = event.message?.usage || event.usage || null;
    if (msgUsage) {
      ctx.turnUsageFallback = mergeUsageMetrics(ctx.turnUsageFallback, msgUsage);
      if (parentToolUseId) {
        tracker.upsertSubagent({
          externalId: parentToolUseId,
          usage: msgUsage,
        });
      }
    }

    const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
    for (const block of blocks) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "text" && block.text) {
        if (parentToolUseId) {
          const sub = tracker.findByExternalId(parentToolUseId);
          if (sub) {
            tracker.upsertSubagent({
              id: sub.id,
              lastActivity: block.text,
              result: block.text,
            });
          }
        } else if (!ctx.sawStreamDeltas) {
          outputParts.push(block.text);
          record(task, block.text.slice(-1500), "output");
        }
      } else if (block.type === "tool_use") {
        const toolName = String(block.name || "tool");
        const toolId = String(block.id || "");
        const input = block.input && typeof block.input === "object" ? block.input : {};

        if (["Task", "Agent", "dispatch_agent"].includes(toolName)) {
          const agentType = String(input.subagent_type || input.agent_type || input.type || "general-purpose").trim().slice(0, 80);
          const role = String(input.description || input.name || input.role || agentType).trim().slice(0, 140);
          const subPrompt = String(input.prompt || input.task || input.instructions || "");
          const subModel = String(input.model || "inherit").trim().slice(0, 80);
          const background = Boolean(input.run_in_background);
          const workspaceMode = input.isolation === "worktree" ? "worktree" : "inherit";
          const sub = tracker.upsertSubagent({
            externalId: toolId || undefined,
            parentExternalId: parentToolUseId,
            name: String(input.name || agentType).slice(0, 80),
            role,
            agentType,
            model: subModel,
            workspaceMode,
            background,
            status: "running",
            prompt: subPrompt,
            lastActivity: `Khởi chạy ${agentType}${background ? " (nền)" : ""}`,
            eventEntry: {
              kind: "stage",
              text: `Khởi chạy subagent ${role} (${agentType})`,
              status: "running",
            },
          });
          if (toolId) ctx.toolUseMap.set(toolId, { isSubagent: true, subagentId: sub.id, role, agentType });
          record(task, `Claude khởi chạy subagent · ${role} (${agentType})`, "tool", {
            toolName: "subagent",
            subagentId: sub.id,
            subagentRole: role,
            status: "running",
            detail: subPrompt ? subPrompt.slice(0, 320) : undefined,
          });
        } else {
          const cmd = String(input.command || input.cmd || "").slice(0, 240);
          const filePath = String(input.file_path || input.path || input.file || input.pattern || "").slice(0, 200);
          if (toolId) ctx.toolUseMap.set(toolId, { isSubagent: false, toolName, cmd, filePath, parentToolUseId });
          if (parentToolUseId && tracker.findByExternalId(parentToolUseId)) {
            tracker.recordSubagentTool({
              externalId: parentToolUseId,
              toolId,
              toolName,
              command: cmd,
              filePath,
              status: "running",
            });
          } else {
            record(
              task,
              `Claude gọi công cụ · ${toolName}${cmd ? ` · ${cmd.slice(0, 80)}` : filePath ? ` · ${filePath}` : ""}`,
              "tool",
              {
                toolName: toolName.slice(0, 120),
                command: cmd || undefined,
                filePath: filePath || undefined,
                status: "running",
              }
            );
          }
        }
      }
    }
    return;
  }

  if (type === "user") {
    const blocks = Array.isArray(event.message?.content) ? event.message.content : [];
    const resultMeta = event.tool_use_result && typeof event.tool_use_result === "object" ? event.tool_use_result : null;

    for (const block of blocks) {
      if (!block || block.type !== "tool_result") continue;
      const toolUseId = String(block.tool_use_id || "");
      const isErr = Boolean(block.is_error);
      const resultText = typeof block.content === "string"
        ? block.content
        : Array.isArray(block.content)
          ? block.content.map((part) => (typeof part === "string" ? part : part?.text || "")).filter(Boolean).join("\n")
          : "";

      const sub = toolUseId ? tracker.findByExternalId(toolUseId) : null;
      if (sub) {
        const metaUsage = resultMeta?.usage || (Number(resultMeta?.totalTokens) > 0 ? { total_tokens: Number(resultMeta.totalTokens) } : null);
        tracker.upsertSubagent({
          id: sub.id,
          status: isErr ? "failed" : "completed",
          result: resultText || String(resultMeta?.content || ""),
          usage: metaUsage,
          durationMs: Number(resultMeta?.totalDurationMs) || undefined,
          toolCountFloor: Number(resultMeta?.totalToolUseCount) || undefined,
          incrementErrors: isErr ? 1 : 0,
          lastActivity: isErr ? `Lỗi: ${resultText.slice(0, 120) || "Subagent thất bại"}` : "Đã trả kết quả về phiên chính",
          eventEntry: {
            kind: isErr ? "error" : "success",
            text: isErr ? `Subagent dừng với lỗi` : `Hoàn tất và trả báo cáo`,
            detail: resultText ? resultText.slice(0, 600) : undefined,
            status: isErr ? "failed" : "done",
          },
        });
        record(
          task,
          `Claude hoàn tất subagent · ${sub.role}${isErr ? " (lỗi)" : ""}`,
          isErr ? "warning" : "tool",
          {
            toolName: "subagent",
            subagentId: sub.id,
            subagentRole: sub.role,
            status: isErr ? "failed" : "done",
            detail: resultText ? resultText.slice(0, 500) : undefined,
          }
        );
        continue;
      }

      if (parentToolUseId && tracker.findByExternalId(parentToolUseId)) {
        const trackedTool = ctx.toolUseMap.get(toolUseId);
        tracker.recordSubagentTool({
          externalId: parentToolUseId,
          toolId: toolUseId,
          toolName: trackedTool?.toolName || "tool",
          command: trackedTool?.cmd || "",
          filePath: trackedTool?.filePath || "",
          detailText: resultText,
          status: "done",
          isError: isErr,
        });
        continue;
      }

      const topTool = ctx.toolUseMap.get(toolUseId);
      if (topTool && !topTool.isSubagent) {
        record(
          task,
          `Claude hoàn tất công cụ · ${topTool.toolName}${topTool.cmd ? ` · ${topTool.cmd.slice(0, 80)}` : topTool.filePath ? ` · ${topTool.filePath}` : ""}`,
          "tool",
          {
            toolName: topTool.toolName.slice(0, 120),
            command: topTool.cmd || undefined,
            filePath: topTool.filePath || undefined,
            detail: isErr && resultText ? resultText.slice(0, 600) : undefined,
            status: isErr ? "failed" : "done",
          }
        );
      }
    }
    return;
  }

  if (type === "result" || (!type && (event.result !== undefined || event.message !== undefined || event.is_error !== undefined))) {
    ctx.resultReceived = true;
    if (typeof event.result === "string" && event.result.trim()) {
      ctx.finalResultText = event.result.trim();
    } else if (typeof event.message === "string" && event.message.trim()) {
      ctx.finalResultText = event.message.trim();
    }
    const finalUsage = event.usage || ctx.turnUsageFallback;
    if (finalUsage) {
      addTaskUsage(task, "claude", finalUsage);
      task._currentStageUsage = finalUsage;
    }
    if (event.is_error) {
      task.stageFailure = String(event.result || event.error || "Claude CLI báo lỗi thực thi.").trim();
      record(task, task.stageFailure, "error");
    }
  }
}

export function createCodexStreamContext(task, outputParts, tracker) {
  return {
    task,
    outputParts,
    tracker,
    rootThreadId: "",
    pendingSpawnItemIds: new Map(),
    sawCollabActivity: false,
  };
}

function mapCodexAgentState(rawState) {
  const value = typeof rawState === "string"
    ? rawState.toLowerCase()
    : String(rawState?.status || rawState?.state || "").toLowerCase();
  if (!value) return "";
  if (value.includes("complete") || value === "done" || value === "idle") return "completed";
  if (value.includes("error") || value.includes("fail")) return "failed";
  if (value.includes("shutdown") || value.includes("cancel") || value.includes("close")) return "cancelled";
  if (value.includes("pending") || value.includes("init") || value.includes("spawn")) return "spawning";
  if (value.includes("wait")) return "waiting";
  return "running";
}

export function parseCodexStreamLine(line, ctx) {
  const { task, outputParts, tracker } = ctx;
  const { record, addTaskUsage } = tracker;
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  if (!event || typeof event !== "object") return;

  const sid = event.thread_id || event.session_id || event.conversation_id || "";
  if (sid && typeof sid === "string") {
    if (!ctx.rootThreadId) {
      ctx.rootThreadId = sid;
      task.cliSessions ||= {};
      task.cliSessions.codex = sid;
    }
  }

  const isChildThread = Boolean(sid && ctx.rootThreadId && sid !== ctx.rootThreadId);
  if (isChildThread && !tracker.findByExternalId(sid)) {
    ctx.sawCollabActivity = true;
    tracker.upsertSubagent({
      externalId: sid,
      role: `Codex Worker (${sid.slice(0, 8)})`,
      agentType: "codex-worker",
      status: "running",
      lastActivity: "Đang thực thi trên luồng con",
    });
  }

  const item = event.item || {};

  if (item.type === "collab_tool_call" && ["item.started", "item.updated", "item.completed"].includes(event.type)) {
    ctx.sawCollabActivity = true;
    const op = String(item.tool || item.name || item.collab_type || item.operation || "collab").trim();
    const opLower = op.toLowerCase();
    const agentsStates = (item.agents_states || item.agent_states) && typeof (item.agents_states || item.agent_states) === "object"
      ? (item.agents_states || item.agent_states)
      : {};
    const receiverList = [
      item.new_thread_id,
      item.receiver_thread_id,
      ...(Array.isArray(item.receiver_thread_ids) ? item.receiver_thread_ids : []),
      item.agent_id,
      item.target_agent_id,
      ...Object.keys(agentsStates),
    ].filter(Boolean).map(String);
    const uniqueTargets = [...new Set(receiverList)];
    const roleLabelText = String(item.agent_role || item.role || item.agent_type || item.nickname || (opLower.includes("spawn") ? "Codex Subagent" : "")).trim();
    const promptText = String(item.prompt || item.message || item.input || "");
    const outText = String(item.aggregated_output || item.output || item.result || "").trim();

    if (event.type === "item.started" && (opLower.includes("spawn") || !uniqueTargets.length)) {
      const provisionalKey = uniqueTargets[0] || (item.id ? `call-${item.id}` : `call-${randomUUID().slice(0, 8)}`);
      const sub = tracker.upsertSubagent({
        externalId: provisionalKey,
        parentExternalId: item.sender_thread_id && item.sender_thread_id !== ctx.rootThreadId ? item.sender_thread_id : null,
        name: item.nickname || item.agent_role || "worker",
        role: roleLabelText || "Codex Subagent",
        agentType: item.agent_role || item.agent_type || "worker",
        model: item.model || "inherit",
        status: "spawning",
        prompt: promptText || undefined,
        lastActivity: `Đang khởi tạo (${op})`,
        eventEntry: {
          kind: "stage",
          toolName: op,
          text: `Codex gọi ${op}${roleLabelText ? ` · ${roleLabelText}` : ""}`,
          detail: promptText ? promptText.slice(0, 500) : undefined,
          status: "running",
        },
      });
      if (item.id) ctx.pendingSpawnItemIds.set(String(item.id), sub.id);
      record(task, `Codex khởi chạy subagent · ${sub.role}`, "tool", {
        toolName: "subagent",
        subagentId: sub.id,
        subagentRole: sub.role,
        status: "running",
        detail: promptText ? promptText.slice(0, 320) : undefined,
      });
      return;
    }

    if (item.id && ctx.pendingSpawnItemIds.has(String(item.id)) && uniqueTargets.length === 1) {
      const pendingSubId = ctx.pendingSpawnItemIds.get(String(item.id));
      const pendingSub = tracker.findByExternalId(pendingSubId);
      if (pendingSub) tracker.bindAlias(pendingSub, uniqueTargets[0]);
      if (event.type === "item.completed") ctx.pendingSpawnItemIds.delete(String(item.id));
    }

    const effectiveTargets = uniqueTargets.length
      ? uniqueTargets
      : (item.id && ctx.pendingSpawnItemIds.has(String(item.id)) ? [ctx.pendingSpawnItemIds.get(String(item.id))] : []);

    for (const targetKey of effectiveTargets) {
      const rawAgentState = agentsStates[targetKey];
      const mappedState = mapCodexAgentState(rawAgentState);
      const agentMsg = typeof rawAgentState === "object"
        ? String(rawAgentState?.message || rawAgentState?.last_message || rawAgentState?.output || "")
        : "";
      let nextStatus = mappedState || undefined;
      if (!nextStatus) {
        if (opLower.includes("close")) nextStatus = "completed";
        else if (opLower.includes("wait") && event.type === "item.completed") nextStatus = item.exit_code && item.exit_code !== 0 ? "failed" : "completed";
        else if (opLower.includes("wait")) nextStatus = "waiting";
        else nextStatus = "running";
      }
      const resultBody = agentMsg || (opLower.includes("wait") && event.type === "item.completed" ? outText : "");
      const sub = tracker.upsertSubagent({
        externalId: targetKey,
        parentExternalId: item.sender_thread_id && item.sender_thread_id !== ctx.rootThreadId ? item.sender_thread_id : null,
        role: roleLabelText || undefined,
        model: item.model || undefined,
        status: nextStatus,
        prompt: promptText || undefined,
        result: resultBody || undefined,
        lastActivity: `${op}${resultBody ? ` · ${resultBody.slice(0, 100)}` : promptText ? ` · ${promptText.slice(0, 100)}` : ""}`,
        eventEntry: {
          kind: nextStatus === "failed" ? "error" : "tool",
          toolName: op,
          text: `${op} (${nextStatus})`,
          detail: (resultBody || outText || promptText).slice(0, 600) || undefined,
          status: event.type === "item.completed" ? "done" : "running",
        },
      });
      if (event.type === "item.completed") {
        record(task, `Codex điều phối subagent · ${op} · ${sub.role}`, "tool", {
          toolName: "subagent",
          subagentId: sub.id,
          subagentRole: sub.role,
          status: "done",
          detail: (resultBody || outText).slice(0, 500) || undefined,
        });
      }
    }
    return;
  }

  if (event.type === "item.started" && ["command_execution", "mcp_tool_call", "tool_call", "file_change"].includes(item.type)) {
    const tool = item.name || item.tool || item.server_label || (item.type === "command_execution" ? "terminal" : item.type === "file_change" ? "edit" : item.type);
    const cmd = item.command ? (Array.isArray(item.command) ? item.command.join(" ") : String(item.command)).slice(0, 240) : "";
    const filePath = item.changes?.[0]?.path || item.path || "";
    if (isChildThread) {
      tracker.recordSubagentTool({
        externalId: sid,
        toolId: item.id ? String(item.id) : "",
        toolName: String(tool),
        command: cmd,
        filePath,
        status: "running",
      });
    } else {
      record(
        task,
        `Codex gọi công cụ · ${String(tool).slice(0, 120)}${cmd ? ` · ${cmd.slice(0, 80)}` : filePath ? ` · ${filePath}` : ""}`,
        "tool",
        { toolName: String(tool).slice(0, 120), command: cmd || undefined, filePath: filePath || undefined, status: "running" }
      );
    }
  }

  if (event.type === "item.completed" && ["command_execution", "mcp_tool_call", "tool_call", "file_change"].includes(item.type)) {
    const tool = item.name || item.tool || item.server_label || (item.type === "command_execution" ? "terminal" : item.type === "file_change" ? "edit" : item.type);
    const cmd = item.command ? (Array.isArray(item.command) ? item.command.join(" ") : String(item.command)).slice(0, 240) : "";
    const filePath = item.changes?.[0]?.path || item.path || "";
    const exitCode = item.exit_code ?? null;
    const detail = String(item.aggregated_output || item.output || "").trim().slice(0, 600);
    if (isChildThread) {
      tracker.recordSubagentTool({
        externalId: sid,
        toolId: item.id ? String(item.id) : "",
        toolName: String(tool),
        command: cmd,
        filePath,
        detailText: detail,
        exitCode,
        status: "done",
        isError: exitCode !== null && exitCode !== 0,
      });
    } else {
      record(
        task,
        `Codex hoàn tất công cụ · ${String(tool).slice(0, 120)}${cmd ? ` · ${cmd.slice(0, 80)}` : filePath ? ` · ${filePath}` : ""}`,
        "tool",
        { toolName: String(tool).slice(0, 120), command: cmd || undefined, filePath: filePath || undefined, exitCode, detail: detail || undefined, status: "done" }
      );
    }
  }

  if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) {
    if (isChildThread) {
      tracker.upsertSubagent({
        externalId: sid,
        result: event.item.text,
        lastActivity: event.item.text,
      });
    } else {
      outputParts.push(event.item.text);
      record(task, event.item.text.slice(-1500), "output");
    }
  }

  if (event.type === "turn.completed" && event.usage) {
    if (isChildThread) {
      tracker.upsertSubagent({ externalId: sid, usage: event.usage });
    } else {
      addTaskUsage(task, "codex", event.usage);
      task._currentStageUsage = event.usage;
    }
  }

  if (event.type === "error" || event.type === "turn.failed") {
    const errMsg = event.message || event.error?.message || "Codex reported an error";
    if (isChildThread) {
      tracker.upsertSubagent({
        externalId: sid,
        status: "failed",
        incrementErrors: 1,
        lastActivity: String(errMsg),
      });
    } else {
      task.stageFailure = String(errMsg);
      record(task, errMsg, "error");
    }
  }
}

export async function enrichCodexSubagentsFromRollouts({
  codexHome = resolve(process.env.CODEX_HOME || resolve(homedir(), ".codex")),
  rootThreadId = "",
  stageStartedAt = 0,
  tracker,
}) {
  if (!rootThreadId || !tracker) return;
  const sessionsRoot = resolve(codexHome, "sessions");
  if (!existsSync(sessionsRoot)) return;

  try {
    const candidateFiles = [];
    const cutoff = (stageStartedAt || Date.now()) - 120_000;

    async function collectRecentRollouts(dir, depth = 0) {
      if (depth > 4 || candidateFiles.length >= 24) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => b.name.localeCompare(a.name));
      for (const entry of entries) {
        if (candidateFiles.length >= 24) break;
        const full = resolve(dir, entry.name);
        if (entry.isDirectory()) {
          await collectRecentRollouts(full, depth + 1);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          try {
            const st = await fs.stat(full);
            if (st.mtimeMs >= cutoff && st.size <= 8_000_000) {
              candidateFiles.push(full);
            }
          } catch {}
        }
      }
    }

    await collectRecentRollouts(sessionsRoot);
    if (!candidateFiles.length) return;

    const callIdToSubMeta = new Map();
    const childThreadIds = new Set();
    const parsedRollouts = [];

    for (const file of candidateFiles) {
      let raw;
      try {
        raw = await fs.readFile(file, "utf8");
      } catch {
        continue;
      }
      const lines = raw.split(/\r?\n/).filter(Boolean);
      if (!lines.length) continue;
      let meta = null;
      try {
        const first = JSON.parse(lines[0]);
        if (first?.type === "session_meta") meta = first.payload || first;
      } catch {}
      parsedRollouts.push({ file, meta, lines });

      const sessionId = String(meta?.id || "");
      if (sessionId === rootThreadId || file.includes(rootThreadId)) {
        for (const line of lines) {
          let row;
          try { row = JSON.parse(line); } catch { continue; }
          const payload = row?.payload || row;
          if (payload?.type === "function_call" && /^(?:[\w.]*\.)?(spawn_agent|send_input|wait|close_agent)$/i.test(String(payload.name || ""))) {
            const fnName = String(payload.name).split(".").at(-1);
            let args = {};
            try { args = typeof payload.arguments === "string" ? JSON.parse(payload.arguments) : (payload.arguments || {}); } catch {}
            callIdToSubMeta.set(String(payload.call_id || ""), { fnName, args });
          } else if (payload?.type === "function_call_output" && callIdToSubMeta.has(String(payload.call_id || ""))) {
            const callInfo = callIdToSubMeta.get(String(payload.call_id || ""));
            const outStr = String(payload.output || "");
            let outJson = null;
            try { outJson = JSON.parse(outStr); } catch {}
            if (callInfo.fnName === "spawn_agent") {
              const spawnedId = String(outJson?.agent_id || outJson?.thread_id || outStr.match(/[0-9a-f]{8}-[0-9a-f-]{27}/i)?.[0] || "").trim();
              if (spawnedId) {
                childThreadIds.add(spawnedId);
                const role = String(callInfo.args?.agent_type || callInfo.args?.role || outJson?.nickname || "Codex Worker").trim();
                tracker.upsertSubagent({
                  externalId: spawnedId,
                  name: outJson?.nickname || role,
                  role,
                  agentType: callInfo.args?.agent_type || "worker",
                  model: callInfo.args?.model || "inherit",
                  prompt: String(callInfo.args?.message || callInfo.args?.prompt || ""),
                  status: "running",
                });
              }
            }
          }
        }
      }
    }

    for (const { meta, lines } of parsedRollouts) {
      const sessionId = String(meta?.id || "");
      if (!sessionId || sessionId === rootThreadId) continue;
      const parentRef = String(
        meta?.parent_thread_id
        || meta?.forked_from_id
        || meta?.source?.subagent?.parent_thread_id
        || ""
      );
      const isTrackedChild = childThreadIds.has(sessionId)
        || parentRef === rootThreadId
        || Boolean(tracker.findByExternalId(sessionId));
      if (!isTrackedChild) continue;

      let toolCalls = 0;
      let lastOutput = "";
      let childModel = String(meta?.model || "");
      let childRole = String(meta?.agent_role || meta?.role || meta?.source?.subagent?.role || "");
      let latestUsage = null;

      for (const line of lines) {
        let row;
        try { row = JSON.parse(line); } catch { continue; }
        const payload = row?.payload || row;
        if (!childModel && payload?.model) childModel = String(payload.model);
        if (payload?.type === "function_call") {
          toolCalls += 1;
        } else if (payload?.type === "message" && payload?.role === "assistant") {
          const text = Array.isArray(payload.content)
            ? payload.content.map((c) => c?.text || "").filter(Boolean).join("\n")
            : String(payload.content || "");
          if (text) lastOutput = text;
        } else if (row?.type === "event_msg" && payload?.type === "token_count" && payload?.info?.total_token_usage) {
          latestUsage = payload.info.total_token_usage;
        }
      }

      tracker.upsertSubagent({
        externalId: sessionId,
        role: childRole || undefined,
        model: childModel || undefined,
        toolCountFloor: toolCalls,
        result: lastOutput || undefined,
        usage: latestUsage || undefined,
        status: lastOutput ? "completed" : undefined,
      });
    }
  } catch {}
}

export function createAgyStreamContext(task, outputParts, tracker) {
  return {
    task,
    outputParts,
    tracker,
    rootSessionId: "",
    pendingAgyCalls: new Map(),
    callCounter: 0,
  };
}

const AGY_SUBAGENT_TOOL_RE = /^(?:[\w-]+:)?(invoke_subagent|define_subagent|send_message|manage_subagents|spawn_subagent)$/i;

export function parseAgyStreamLine(line, ctx) {
  const { task, outputParts, tracker } = ctx;
  const { record, addTaskUsage, schedulePersist, schedulePublish } = tracker;

  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return record(task, line, "output");
  }
  if (!event || typeof event !== "object") return;

  const sid = event.session_id || event.conversation_id || event.thread_id || "";
  if (sid && typeof sid === "string") {
    if (!ctx.rootSessionId) {
      ctx.rootSessionId = sid;
      task.cliSessions ||= {};
      task.cliSessions.antigravity = sid;
    }
  }

  const isChildSession = Boolean(
    (event.parent_conversation_id && event.conversation_id)
    || (sid && ctx.rootSessionId && sid !== ctx.rootSessionId && tracker.findByExternalId(sid))
  );

  const type = String(event.type || event.event || "").toLowerCase();
  const update = event.step_update || {};
  const message = event.message;
  const deltaText = event.delta?.text || update.text_delta || "";
  const messageText = typeof message === "string" ? message : message?.text || message?.content?.map?.((part) => part.text || "").join("") || "";
  const fullText = event.text || (typeof event.content === "string" ? event.content : "") || event.response || messageText || "";

  const senderSub = event.sender ? tracker.findByExternalId(String(event.sender)) : null;
  if (senderSub && fullText) {
    tracker.upsertSubagent({
      id: senderSub.id,
      status: "completed",
      result: fullText,
      lastActivity: "Đã gửi báo cáo hoàn tất",
      eventEntry: {
        kind: "success",
        text: "Subagent gửi phản hồi hoàn tất",
        detail: fullText.slice(0, 600),
        status: "done",
      },
    });
    record(task, `Antigravity nhận báo cáo từ subagent · ${senderSub.role}`, "tool", {
      toolName: "subagent",
      subagentId: senderSub.id,
      subagentRole: senderSub.role,
      status: "done",
      detail: fullText.slice(0, 500),
    });
    return;
  }

  if (isChildSession) {
    const childKey = String(event.conversation_id || sid);
    if (deltaText || fullText) {
      tracker.upsertSubagent({
        externalId: childKey,
        result: fullText || deltaText,
        lastActivity: fullText || deltaText,
      });
    }
  } else if (deltaText && typeof deltaText === "string") {
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
  if (usageObj) {
    if (isChildSession) {
      tracker.upsertSubagent({ externalId: String(event.conversation_id || sid), usage: usageObj });
    } else {
      addTaskUsage(task, "antigravity", usageObj);
      task._currentStageUsage = usageObj;
    }
  }

  const toolError = update.tool_info?.error
    ? String(update.tool_info.error.message || update.tool_info.error)
    : (event.error ? String(event.error.message || event.error) : "");

  if (type === "result" && event.result && !isChildSession) {
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
    if (event.result.status && event.result.status !== "SUCCESS") {
      task.stageFailure = event.result.error || `Antigravity status: ${event.result.status}`;
    } else {
      task.stageFailure = null;
    }
  }

  const toolName = String(event.name || event.tool_name || event.tool?.name || update.tool_info?.name || "");
  const toolArgs = update.tool_info?.args || event.tool?.args || event.args || {};
  const toolResultRaw = update.tool_info?.result ?? update.tool_info?.output ?? event.tool_result ?? event.output ?? (type === "tool_result" ? event.result : undefined);
  const toolResultText = typeof toolResultRaw === "string"
    ? toolResultRaw
    : toolResultRaw && typeof toolResultRaw === "object"
      ? JSON.stringify(toolResultRaw)
      : "";
  const isResultEvent = type.includes("result") || type.includes("completed");
  const isToolEvent = ["tool_start", "tool_call", "tool.started", "tool_result", "tool.completed", "tool_use"].includes(type) || Boolean(update.tool_info);

  const subToolMatch = toolName.match(AGY_SUBAGENT_TOOL_RE);
  if (isToolEvent && subToolMatch) {
    const subAction = subToolMatch[1].toLowerCase();
    const callKey = String(event.id || event.call_id || event.tool_call_id || update.tool_info?.id || "");

    if (subAction === "invoke_subagent" || subAction === "spawn_subagent") {
      if (!isResultEvent) {
        ctx.callCounter += 1;
        const provisionalKey = callKey || `agy-call-${ctx.callCounter}`;
        const role = String(toolArgs.Role || toolArgs.role || toolArgs.description || "Antigravity Subagent").trim().slice(0, 140);
        const agentType = String(toolArgs.TypeName || toolArgs.type || "research").trim().slice(0, 80);
        const model = String(toolArgs.Model || toolArgs.model || "inherit").trim().slice(0, 80);
        const workspaceMode = String(toolArgs.Workspace || toolArgs.workspace || "inherit").trim().slice(0, 32);
        const subPrompt = String(toolArgs.Prompt || toolArgs.prompt || "");
        const sub = tracker.upsertSubagent({
          externalId: provisionalKey,
          name: agentType,
          role,
          agentType,
          model,
          workspaceMode,
          status: "running",
          prompt: subPrompt,
          lastActivity: `Khởi chạy ${role} (${agentType})`,
          eventEntry: {
            kind: "stage",
            toolName: subAction,
            text: `Khởi chạy ${role} (${agentType})`,
            detail: subPrompt ? subPrompt.slice(0, 500) : undefined,
            status: "running",
          },
        });
        ctx.pendingAgyCalls.set(provisionalKey, sub.id);
        ctx.pendingAgyCalls.set("__latest__", sub.id);
        record(task, `Antigravity khởi chạy subagent · ${role} (${agentType})`, "tool", {
          toolName: "subagent",
          subagentId: sub.id,
          subagentRole: role,
          status: "running",
          detail: subPrompt ? subPrompt.slice(0, 320) : undefined,
        });
      } else {
        const subId = (callKey && ctx.pendingAgyCalls.get(callKey)) || ctx.pendingAgyCalls.get("__latest__");
        const sub = subId ? tracker.findByExternalId(subId) : null;
        const convMatch = toolResultText.match(/"conversationId"\s*:\s*"([^"]+)"/);
        const convId = convMatch?.[1] || "";
        if (sub) {
          if (convId) tracker.bindAlias(sub, convId);
          tracker.upsertSubagent({
            id: sub.id,
            status: toolError ? "failed" : (convId ? "running" : "completed"),
            result: !convId && toolResultText ? toolResultText : undefined,
            incrementErrors: toolError ? 1 : 0,
            lastActivity: toolError
              ? `Lỗi: ${toolError}`
              : convId
                ? `Đang chạy phiên con (${convId.slice(0, 8)})`
                : "Hoàn tất thực thi",
          });
        }
      }
      return;
    }

    if (subAction === "send_message") {
      const recipient = String(toolArgs.Recipient || toolArgs.recipient || "");
      const msgBody = String(toolArgs.Message || toolArgs.message || "");
      const sub = recipient ? tracker.findByExternalId(recipient) : null;
      if (sub && !isResultEvent) {
        tracker.upsertSubagent({
          id: sub.id,
          status: "running",
          lastActivity: `Nhận chỉ dẫn mới: ${msgBody}`,
          eventEntry: {
            kind: "chat",
            toolName: "send_message",
            text: `Gửi tin nhắn tới ${sub.role}`,
            detail: msgBody.slice(0, 500),
            status: "done",
          },
        });
      }
      return;
    }

    if (subAction === "manage_subagents") {
      const action = String(toolArgs.Action || toolArgs.action || "").toLowerCase();
      if (action === "kill" || action === "kill_all") {
        const ids = Array.isArray(toolArgs.ConversationIds) ? toolArgs.ConversationIds.map(String) : [];
        for (const candidate of task.subagents || []) {
          if (candidate.harness !== "antigravity") continue;
          if (action === "kill_all" || ids.some((id) => candidate.externalId === id || candidate.aliases?.includes(id))) {
            tracker.upsertSubagent({
              id: candidate.id,
              status: "cancelled",
              lastActivity: "Đã dừng bởi manage_subagents",
            });
          }
        }
      } else if (isResultEvent && toolResultText) {
        const arrayMatch = toolResultText.match(/\[[\s\S]*\]/);
        if (arrayMatch) {
          try {
            const list = JSON.parse(arrayMatch[0]);
            for (const entry of Array.isArray(list) ? list : []) {
              if (!entry?.conversationId) continue;
              const st = String(entry.state || "").toLowerCase();
              tracker.upsertSubagent({
                externalId: String(entry.conversationId),
                role: entry.role || undefined,
                agentType: entry.type || undefined,
                status: st === "idle" || st === "done" ? "completed" : st === "failed" ? "failed" : "running",
                lastActivity: entry.stateDetail ? `${st} (${entry.stateDetail})` : st,
              });
            }
          } catch {}
        }
      }
      return;
    }
  }

  const filePath = String(toolArgs?.path || toolArgs?.file || toolArgs?.TargetFile || toolArgs?.AbsolutePath || toolArgs?.Path || "").slice(0, 200);
  const cmd = String(toolArgs?.command || toolArgs?.CommandLine || "").slice(0, 240);

  if (isToolEvent) {
    if (isChildSession) {
      tracker.recordSubagentTool({
        externalId: String(event.conversation_id || sid),
        toolId: String(event.id || event.call_id || ""),
        toolName: toolName || "tool",
        command: cmd,
        filePath,
        detailText: toolError || toolResultText,
        status: isResultEvent || toolError ? "done" : "running",
        isError: Boolean(toolError),
      });
    } else {
      record(
        task,
        `Antigravity · ${type || "tool"}${toolName ? ` · ${toolName.slice(0, 120)}` : ""}${filePath ? ` · ${filePath}` : cmd ? ` · ${cmd.slice(0, 80)}` : ""}${toolError ? ` · ${toolError.slice(0, 120)}` : ""}`,
        "tool",
        {
          toolName: toolName ? toolName.slice(0, 120) : "tool",
          filePath: filePath || undefined,
          command: cmd || undefined,
          detail: (toolError || (isResultEvent && toolResultText ? toolResultText : "")).slice(0, 600) || undefined,
          status: toolError ? "failed" : (isResultEvent ? "done" : "running"),
        }
      );
    }
  }
}
