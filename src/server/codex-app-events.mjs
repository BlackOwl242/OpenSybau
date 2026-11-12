import { parseCodexStreamLine } from "./subagent-tracker.mjs";
import { trackCommand } from "./tool-activity.mjs";

// Normalize the installed App Server v2 schema to the existing CLI tracker.
// Only correlated child threads belong to this task; unrelated notifications do not.
export function trackCodexAppEvent(message, ctx, rootThreadId) {
  const params = message.params || {};
  const item = params.item || {};
  const children = (ctx.appThreads ||= new Set());
  const threadId = params.threadId || rootThreadId;
  if (threadId !== rootThreadId && !children.has(threadId)) return;
  ctx.rootThreadId = rootThreadId;
  if (item.id) {
    const observed = (ctx.appObservedItems ||= new Map()), key = `${threadId}:${item.id}`;
    if (message.snapshot && observed.has(key)) return;
    if (message.method === "item/started" && observed.get(key) === "item/completed") return;
    observed.set(key, message.method);
  }
  if (message.method === "thread/tokenUsage/updated" && threadId === rootThreadId) {
    const total = params.tokenUsage?.total;
    if (total) {
      const usage = { input_tokens: total.inputTokens || 0, output_tokens: total.outputTokens || 0, cached_input_tokens: total.cachedInputTokens || 0, total_tokens: total.totalTokens || 0 };
      const previous = ctx.appUsage || {};
      const delta = Object.fromEntries(Object.entries(usage).map(([key, value]) => [key, Math.max(0, value - (previous[key] || 0))]));
      ctx.tracker.addTaskUsage?.(ctx.task, "codex", delta); ctx.task._currentStageUsage = usage; ctx.appUsage = usage;
    }
  }
  const type = ({ "item/started": "item.started", "item/completed": "item.completed" })[message.method];
  if (item.type === "collabAgentToolCall" && type) {
    for (const id of item.receiverThreadIds || []) children.add(id);
    parseCodexStreamLine(JSON.stringify({ type, thread_id: threadId, item: { ...item, type: "collab_tool_call", receiver_thread_ids: item.receiverThreadIds, sender_thread_id: item.senderThreadId, agents_states: item.agentsStates } }), ctx);
  } else if (item.type === "subAgentActivity" && type === "item.completed" && item.agentThreadId) {
    children.add(item.agentThreadId);
    const status = ({ started: "running", interrupted: "cancelled", completed: "completed" })[item.kind];
    ctx.tracker.upsertSubagent({ externalId: item.agentThreadId, role: item.agentPath, model: item.model || undefined, status, lastActivity: item.kind, eventEntry: { kind: "stage", text: item.kind, status } });
  } else if (item.type === "commandExecution" && type) {
    const status = type === "item.started" ? "running" : item.status === "declined" ? "cancelled" : item.exitCode === 0 ? "completed" : item.exitCode != null || item.status === "failed" ? "failed" : "unknown";
    trackCommand(ctx.task, { id: item.id, source: "codex-app-server", command: item.command, status, output: item.aggregatedOutput, exitCode: item.exitCode, parentId: threadId === rootThreadId ? null : threadId });
    if (threadId !== rootThreadId) ctx.tracker.recordSubagentTool({ externalId: threadId, toolId: item.id, toolName: "terminal", command: item.command, status: type === "item.started" ? "running" : "done", detailText: item.aggregatedOutput, exitCode: item.exitCode, isError: status === "failed" });
  } else if (type && threadId !== rootThreadId && ["fileChange", "mcpToolCall", "agentMessage"].includes(item.type)) {
    parseCodexStreamLine(JSON.stringify({ type, thread_id: threadId, item: { ...item, type: ({fileChange:"file_change",mcpToolCall:"mcp_tool_call",agentMessage:"agent_message"})[item.type] } }), ctx);
  }
}
