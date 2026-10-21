import { randomUUID } from "node:crypto";

export function tokenizeTerms(text) {
  return (String(text || "").toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) || []).filter(
    (word) => !["the", "and", "for", "with", "this", "that", "cua", "codex", "task", "hãy", "của", "với", "cho", "một", "các", "trong", "được", "thực", "hiện"].includes(word)
  );
}

export function tokenize(text) {
  return [...new Set(tokenizeTerms(text))];
}

export function relevantMemory(task, workspace, memories) {
  const queryTerms = tokenize(`${task.title || ""} ${task.prompt || ""} ${task.goal || ""}`);
  if (!queryTerms.length || !memories?.length) return [];
  const scopedDocs = memories
    .filter((item) => item && (item.workspaceId === "all" || item.workspaceId === workspace?.id))
    .map((item) => {
      const terms = tokenizeTerms(`${item.title || ""} ${item.title || ""} ${item.content || ""}`);
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
      return { item: doc.item, score: bm25 + workspaceBoost };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 4)
    .map((row) => row.item);
}

export function autoDistillTaskMemory(task, workspace, memories, persistMemoryFn) {
  try {
    if (!task || !workspace || task.config?.workflow === "chat-only") return;
    const filesSummary = (task.artifacts || []).slice(0, 8).join(", ");
    const reviewSummary = String(task.review || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 4).join(" · ").slice(0, 320);
    const planSummary = String(task.plan || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 3).join(" · ").slice(0, 260);
    if (!filesSummary && !planSummary && !reviewSummary) return;
    const title = `[Auto-Lesson] ${task.code ? `${task.code}: ` : ""}${String(task.title || "Task").slice(0, 80)}`;
    const contentParts = [];
    if (filesSummary) contentParts.push(`Changed files: ${filesSummary}.`);
    if (planSummary) contentParts.push(`Plan: ${planSummary}`);
    if (reviewSummary) contentParts.push(`Review: ${reviewSummary}`);
    const content = contentParts.join(" ").slice(0, 1200);
    const existing = memories.find((item) => item.sourceTaskId === task.id);
    if (existing) {
      existing.title = title;
      existing.content = content;
      existing.updatedAt = new Date().toISOString();
    } else {
      memories.unshift({
        id: `mem-${randomUUID().slice(0, 8)}`,
        workspaceId: workspace.id,
        sourceTaskId: task.id,
        title,
        content,
        createdAt: new Date().toISOString(),
      });
      if (memories.length > 200) memories.length = 200;
    }
    if (typeof persistMemoryFn === "function") persistMemoryFn();
  } catch {}
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
        if (!tok && !metric.durationMs) continue;
        if (tok || parts.inputTokens || parts.outputTokens) meteredProviders.add(metric.provider);
        const entry = byProvider[metric.provider] ||= { totalTokens: 0, inputTokens: 0, outputTokens: 0, tokens5h: 0, tokens7d: 0, responses: 0 };
        entry.totalTokens += tok;
        entry.inputTokens += parts.inputTokens;
        entry.outputTokens += parts.outputTokens;
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
        const entry = byProvider[provider] ||= { totalTokens: 0, inputTokens: 0, outputTokens: 0, tokens5h: 0, tokens7d: 0, responses: 0 };
        entry.totalTokens += tok;
        entry.inputTokens += parts.inputTokens;
        entry.outputTokens += parts.outputTokens;
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
        const entry = byProvider[provider] ||= { totalTokens: 0, inputTokens: 0, outputTokens: 0, tokens5h: 0, tokens7d: 0, responses: 0 };
        entry.totalTokens += tok;
        entry.inputTokens += parts.inputTokens;
        entry.outputTokens += parts.outputTokens;
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
    byProvider,
  };
}
