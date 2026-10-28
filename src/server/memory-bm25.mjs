import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export const USER_MEMORY_MAX_CHARS = 1375;
export const WORKSPACE_MEMORY_MAX_CHARS = 2200;

export function tokenizeTerms(text) {
  return (String(text || "").toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) || []).filter(
    (word) => !["the", "and", "for", "with", "this", "that", "cua", "codex", "task", "hãy", "của", "với", "cho", "một", "các", "trong", "được", "thực", "hiện"].includes(word)
  );
}

export function tokenize(text) {
  return [...new Set(tokenizeTerms(text))];
}

export function userProfileMemorySnapshot(memories = []) {
  if (!Array.isArray(memories) || !memories.length) return "";
  const profileItems = memories.filter(
    (item) => item && (item.kind === "user-profile" || item.category === "user" || (item.workspaceId === "all" && item.pinned))
  );
  if (!profileItems.length) return "";
  const lines = [];
  let totalChars = 0;
  for (const item of profileItems) {
    const line = `- ${String(item.title || "Preference").trim()}: ${String(item.content || "").trim()}`;
    if (totalChars + line.length + 1 > USER_MEMORY_MAX_CHARS) {
      const remaining = USER_MEMORY_MAX_CHARS - totalChars - 4;
      if (remaining > 24) lines.push(`${line.slice(0, remaining)}...`);
      break;
    }
    lines.push(line);
    totalChars += line.length + 1;
  }
  return lines.join("\n");
}

export function relevantMemory(task, workspace, memories) {
  const queryTerms = tokenize(`${task.title || ""} ${task.prompt || ""} ${task.goal || ""}`);
  if (!queryTerms.length || !memories?.length) return [];
  const scopedDocs = memories
    .filter((item) => item && (item.workspaceId === "all" || item.workspaceId === workspace?.id))
    .map((item) => {
      const terms = tokenizeTerms(`${item.title || ""} ${item.title || ""} ${item.content || ""} ${(item.tags || []).join(" ")}`);
      const tf = new Map();
      for (const term of terms) tf.set(term, (tf.get(term) || 0) + 1);
      return { item, tf, len: Math.max(1, terms.length) };
    });
  if (!scopedDocs.length) return [];
  const N = scopedDocs.length;
  const avgDl = scopedDocs.reduce((sum, doc) => sum + doc.len, 0) / N;
  const k1 = 1.5;
  const b = 0.75;
  const df = new Map();
  for (const term of queryTerms) {
    let count = 0;
    for (const doc of scopedDocs) if (doc.tf.has(term)) count += 1;
    df.set(term, count);
  }
  return scopedDocs
    .map((doc) => {
      let bm25 = 0;
      for (const term of queryTerms) {
        const f = doc.tf.get(term) || 0;
        if (!f) continue;
        const docFreq = df.get(term) || 0;
        const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5));
        const norm = f + k1 * (1 - b + b * (doc.len / avgDl));
        bm25 += idf * ((f * (k1 + 1)) / norm);
      }
      const workspaceBoost = doc.item.workspaceId === workspace?.id && bm25 > 0 ? 1.25 : 0;
      const pitfallBoost = bm25 > 0 && (doc.item.kind === "pitfall" || /\[BLOCKING\]|Pitfall|QA/i.test(doc.item.content || "")) ? 0.65 : 0;
      return { item: doc.item, score: bm25 + workspaceBoost + pitfallBoost };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((row) => row.item);
}

function cleanMeaningfulLines(text, maxLines = 3, maxChars = 280) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .filter((line) => line.length >= 4 && !/^[-=*_]{3,}$/.test(line))
    .slice(0, maxLines)
    .join(" · ")
    .slice(0, maxChars);
}

function extractReviewLessons(task) {
  const sources = [
    String(task.review || ""),
    ...((task.cycles || []).filter((c) => c.stage === "review" && c.summary).map((c) => String(c.summary))),
  ].join("\n");
  const lines = sources.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const blocking = [];
  const advisory = [];
  for (const line of lines) {
    if (/^(?:[-*]\s*)?\[BLOCKING\]/i.test(line)) {
      const cleaned = line.replace(/^(?:[-*]\s*)?\[BLOCKING\]\s*/i, "").trim();
      if (cleaned && !blocking.includes(cleaned)) blocking.push(cleaned);
    } else if (/^(?:[-*]\s*)?\[ADVISORY\]/i.test(line)) {
      const cleaned = line.replace(/^(?:[-*]\s*)?\[ADVISORY\]\s*/i, "").trim();
      if (cleaned && !advisory.includes(cleaned)) advisory.push(cleaned);
    }
  }
  return { blocking: blocking.slice(0, 4), advisory: advisory.slice(0, 3) };
}

export function distillTaskMemoryRecord(task, workspace, { forceChat = false } = {}) {
  if (!task || !workspace) return null;
  const isChatOnly = task.config?.workflow === "chat-only";
  const hasArtifacts = Array.isArray(task.artifacts) && task.artifacts.length > 0;
  if (isChatOnly && !forceChat && !hasArtifacts && !task.goal) return null;

  const filesSummary = (task.artifacts || []).slice(0, 8).join(", ");
  const { blocking, advisory } = extractReviewLessons(task);
  const reviewSummary = cleanMeaningfulLines(task.review, 4, 320);
  const planSummary = cleanMeaningfulLines(task.plan, 3, 260);
  const implSummary = cleanMeaningfulLines(task.implementation, 2, 220);
  const lastAssistantReply = isChatOnly
    ? cleanMeaningfulLines(
        (task.chatMessages || []).filter((m) => m.role === "assistant" && m.content).at(-1)?.content || "",
        3,
        300
      )
    : "";
  const qaNote = task.qaResult?.command
    ? `QA (${task.qaResult.command}): ${task.qaResult.status === "passed" ? "PASSED" : `FAILED (exit ${task.qaResult.exitCode ?? 1})`}.`
    : "";

  if (!filesSummary && !planSummary && !reviewSummary && !implSummary && !lastAssistantReply && !blocking.length) {
    return null;
  }

  const rounds = Number(task.currentRound) || 1;
  const hasPitfalls = blocking.length > 0 || rounds > 1 || task.qaResult?.status === "failed";
  const prefix = hasPitfalls ? "[Pitfall & Lesson]" : "[Auto-Lesson]";
  const title = `${prefix} ${task.code ? `${task.code}: ` : ""}${String(task.title || "Task").slice(0, 80)}`;
  const contentParts = [];
  if (filesSummary) contentParts.push(`Changed files: ${filesSummary}.`);
  if (blocking.length) {
    contentParts.push(
      rounds > 1
        ? `Resolved Pitfalls (${rounds} rounds): ${blocking.join(" | ").slice(0, 420)}.`
        : `Blocking Findings: ${blocking.join(" | ").slice(0, 420)}.`
    );
  } else if (advisory.length) {
    contentParts.push(`Advisory Notes: ${advisory.join(" | ").slice(0, 260)}.`);
  }
  if (qaNote) contentParts.push(qaNote);
  if (planSummary) contentParts.push(`Plan: ${planSummary}`);
  if (implSummary && !planSummary) contentParts.push(`Implementation: ${implSummary}`);
  if (reviewSummary && !blocking.length) contentParts.push(`Review: ${reviewSummary}`);
  if (lastAssistantReply && !planSummary && !reviewSummary) contentParts.push(`Summary: ${lastAssistantReply}`);

  const content = contentParts.join(" ").slice(0, 1400);
  return {
    workspaceId: workspace.id,
    sourceTaskId: task.id,
    kind: hasPitfalls ? "pitfall" : "lesson",
    category: "workspace",
    rounds,
    artifacts: (task.artifacts || []).slice(0, 12),
    title,
    content,
  };
}

export function syncMarkdownMemories(runtimeDir, memories = [], workspaces = []) {
  if (!runtimeDir) return;
  try {
    const memDir = resolve(runtimeDir, "memories");
    mkdirSync(memDir, { recursive: true });
    const userItems = (memories || []).filter(
      (item) => item && (item.kind === "user-profile" || item.category === "user" || (item.workspaceId === "all" && item.pinned))
    );
    const userHeader = [
      "# USER.md — OpenSybau User Profile & Global Preferences",
      `<!-- Hard prompt snapshot budget: ${USER_MEMORY_MAX_CHARS} chars -->`,
      "",
    ];
    const userBody = userItems.length
      ? userItems.map((item) => `## ${String(item.title || "Preference").trim()}\n${String(item.content || "").trim()}\n`).join("\n")
      : "_No global user profile preferences saved yet._\n";
    writeFileSync(resolve(memDir, "USER.md"), `${userHeader.join("\n")}${userBody}`, { encoding: "utf8", mode: 0o600 });

    const wsMap = new Map((workspaces || []).map((ws) => [ws.id, ws.name || ws.path || ws.id]));
    const lessonItems = (memories || []).filter((item) => item && !userItems.includes(item));
    const memoryHeader = [
      "# MEMORY.md — OpenSybau Workspace Conventions & Distilled Lessons",
      `<!-- Active workspace prompt budget: ${WORKSPACE_MEMORY_MAX_CHARS} chars -->`,
      "",
    ];
    const grouped = new Map();
    for (const item of lessonItems) {
      const scopeLabel = item.workspaceId === "all" ? "Global / Shared" : (wsMap.get(item.workspaceId) || item.workspaceId || "Workspace");
      if (!grouped.has(scopeLabel)) grouped.set(scopeLabel, []);
      grouped.get(scopeLabel).push(item);
    }
    const sections = [];
    for (const [scopeLabel, items] of grouped.entries()) {
      sections.push(`## ${scopeLabel}`);
      for (const item of items.slice(0, 40)) {
        const srcTag = item.sourceTaskId ? ` [${item.sourceTaskId}]` : "";
        sections.push(`- **${String(item.title || "Note").trim()}** (${item.kind || "lesson"})${srcTag}: ${String(item.content || "").trim()}`);
      }
      sections.push("");
    }
    const memoryBody = sections.length ? sections.join("\n") : "_No workspace memories recorded yet._\n";
    writeFileSync(resolve(memDir, "MEMORY.md"), `${memoryHeader.join("\n")}${memoryBody}`, { encoding: "utf8", mode: 0o600 });
  } catch {}
}

export function readMarkdownMemories(runtimeDir, memories = [], workspaces = []) {
  if (runtimeDir) {
    const memDir = resolve(runtimeDir, "memories");
    if (!existsSync(resolve(memDir, "USER.md")) || !existsSync(resolve(memDir, "MEMORY.md"))) {
      syncMarkdownMemories(runtimeDir, memories, workspaces);
    }
    try {
      const userMd = readFileSync(resolve(memDir, "USER.md"), "utf8");
      const memoryMd = readFileSync(resolve(memDir, "MEMORY.md"), "utf8");
      return {
        userMd,
        memoryMd,
        userMarkdown: userMd,
        workspaceMarkdown: memoryMd,
        userSnapshot: userProfileMemorySnapshot(memories),
        limits: { userMaxChars: USER_MEMORY_MAX_CHARS, workspaceMaxChars: WORKSPACE_MEMORY_MAX_CHARS },
      };
    } catch {}
  }
  return {
    userMd: "",
    memoryMd: "",
    userMarkdown: "",
    workspaceMarkdown: "",
    userSnapshot: userProfileMemorySnapshot(memories),
    limits: { userMaxChars: USER_MEMORY_MAX_CHARS, workspaceMaxChars: WORKSPACE_MEMORY_MAX_CHARS },
  };
}

export function autoDistillTaskMemory(task, workspace, memories, persistMemoryFn, options = {}) {
  try {
    const distilled = distillTaskMemoryRecord(task, workspace, options);
    if (!distilled) return null;
    const now = new Date().toISOString();
    const existing = memories.find((item) => item.sourceTaskId === task.id);
    let recordItem;
    if (existing) {
      existing.title = distilled.title;
      existing.content = distilled.content;
      existing.kind = distilled.kind;
      existing.category = distilled.category;
      existing.rounds = distilled.rounds;
      existing.artifacts = distilled.artifacts;
      existing.updatedAt = now;
      recordItem = existing;
    } else {
      recordItem = {
        id: `mem-${randomUUID().slice(0, 8)}`,
        ...distilled,
        createdAt: now,
      };
      memories.unshift(recordItem);
      if (memories.length > 200) memories.length = 200;
    }
    if (typeof persistMemoryFn === "function") persistMemoryFn();
    return recordItem;
  } catch {
    return null;
  }
}

export function countUsageTokens(usage) {
  if (!usage || typeof usage !== "object") return 0;
  return Number(usage.total_tokens ?? ((usage.input_tokens || usage.prompt_tokens || 0) + (usage.output_tokens || usage.completion_tokens || 0))) || 0;
}

export function usageParts(usage) {
  if (!usage || typeof usage !== "object") return { inputTokens: 0, outputTokens: 0 };
  return {
    inputTokens: Number(usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens) || 0,
    outputTokens: Number(usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens) || 0,
  };
}

export function buildTelemetrySummary(tasks, runningCount = 0) {
  const now = Date.now();
  const fiveHoursAgo = now - 5 * 3600_000;
  const sevenDaysAgo = now - 7 * 24 * 3600_000;
  let tokens5h = 0;
  let tokens7d = 0;
  let cachedTokensTotal = 0;
  let worktreeCount = 0;
  const byProvider = {};
  for (const task of tasks || []) {
    if (task.isolated && task.worktreePath && !task.worktreeCleaned) worktreeCount++;
    const stageMetrics = Array.isArray(task.stageMetrics) ? task.stageMetrics : [];
    if (stageMetrics.length) {
      const meteredProviders = new Set();
      for (const metric of stageMetrics) {
        const ts = Date.parse(metric.completedAt || "") || 0;
        const parts = usageParts(metric.usage);
        const tok = countUsageTokens(metric.usage);
        const cachedTok = Number(metric.usage?.cached_input_tokens ?? metric.usage?.cache_read_input_tokens ?? 0) || 0;
        if (!tok && !metric.durationMs) continue;
        if (tok || parts.inputTokens || parts.outputTokens) meteredProviders.add(metric.provider);
        const entry = byProvider[metric.provider] ||= { totalTokens: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, tokens5h: 0, tokens7d: 0, responses: 0 };
        entry.totalTokens += tok;
        entry.inputTokens += parts.inputTokens;
        entry.outputTokens += parts.outputTokens;
        entry.cachedTokens += cachedTok;
        cachedTokensTotal += cachedTok;
        entry.responses++;
        if (ts >= fiveHoursAgo) { entry.tokens5h += tok; tokens5h += tok; }
        if (ts >= sevenDaysAgo) { entry.tokens7d += tok; tokens7d += tok; }
      }
      const ts = Date.parse(task.updatedAt || task.createdAt || "") || 0;
      for (const [provider, usage] of Object.entries(task.usage || {})) {
        if (meteredProviders.has(provider)) continue;
        const tok = countUsageTokens(usage);
        if (!tok) continue;
        const parts = usageParts(usage);
        const cachedTok = Number(usage?.cached_input_tokens ?? usage?.cache_read_input_tokens ?? 0) || 0;
        const entry = byProvider[provider] ||= { totalTokens: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, tokens5h: 0, tokens7d: 0, responses: 0 };
        entry.totalTokens += tok;
        entry.inputTokens += parts.inputTokens;
        entry.outputTokens += parts.outputTokens;
        entry.cachedTokens += cachedTok;
        cachedTokensTotal += cachedTok;
        entry.responses++;
        if (ts >= fiveHoursAgo) { entry.tokens5h += tok; tokens5h += tok; }
        if (ts >= sevenDaysAgo) { entry.tokens7d += tok; tokens7d += tok; }
      }
      continue;
    }
    if (task.usage && typeof task.usage === "object") {
      const ts = Date.parse(task.updatedAt || task.createdAt || "") || 0;
      for (const [provider, u] of Object.entries(task.usage)) {
        const tok = countUsageTokens(u);
        if (!tok) continue;
        const parts = usageParts(u);
        const cachedTok = Number(u?.cached_input_tokens ?? u?.cache_read_input_tokens ?? 0) || 0;
        const entry = byProvider[provider] ||= { totalTokens: 0, inputTokens: 0, outputTokens: 0, cachedTokens: 0, tokens5h: 0, tokens7d: 0, responses: 0 };
        entry.totalTokens += tok;
        entry.inputTokens += parts.inputTokens;
        entry.outputTokens += parts.outputTokens;
        entry.cachedTokens += cachedTok;
        cachedTokensTotal += cachedTok;
        entry.responses++;
        if (ts >= fiveHoursAgo) { entry.tokens5h += tok; tokens5h += tok; }
        if (ts >= sevenDaysAgo) { entry.tokens7d += tok; tokens7d += tok; }
      }
    }
  }
  return {
    runningCount,
    queuedCount: (tasks || []).filter((t) => t.status === "queued").length,
    worktreeCount,
    tokens5h,
    tokens7d,
    cachedTokensTotal,
    byProvider,
  };
}
