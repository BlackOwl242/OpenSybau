import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { workflowRoles } from "../domain/agent-roles.js";
import { within } from "./fs-security.mjs";
import { tokenize, tokenizeTerms } from "./memory-bm25.mjs";
import { hydrateTaskSubagentDetails, serializeTaskSubagentDetails } from "./subagent-tracker.mjs";

let sqliteModulePromise = null;
async function getSqliteModule() {
  if (!sqliteModulePromise) {
    sqliteModulePromise = import("node:sqlite").catch(() => null);
  }
  return sqliteModulePromise;
}

export function deleteTaskDetailStore(runtimeDir, taskId) {
  if (!runtimeDir || !taskId) return false;
  const safeId = String(taskId).trim();
  if (!safeId || /[\\/]/.test(safeId) || safeId === "." || safeId === "..") return false;
  const tasksRoot = resolve(String(runtimeDir), "tasks");
  const target = resolve(tasksRoot, safeId);
  if (!within(tasksRoot, target) || target === tasksRoot) return false;
  try {
    rmSync(target, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

export function createTaskStoreService({ taskDir }) {
  const syncedTaskTimestamps = new Map();
  let ftsDb = null;
  let ftsAvailable = false;
  let lastFtsCorpusStamp = "";
  let lastFtsDocMap = new Map();
  let ftsDocStamps = new Map();

  async function initFtsEngine() {
    if (ftsDb !== null) return ftsAvailable;
    const mod = await getSqliteModule();
    if (!mod?.DatabaseSync) {
      ftsDb = false;
      ftsAvailable = false;
      return false;
    }
    try {
      let db = null;
      if (taskDir) {
        try {
          const runtimeRoot = dirname(resolve(String(taskDir)));
          mkdirSync(runtimeRoot, { recursive: true });
          const sqlitePath = resolve(runtimeRoot, "search.sqlite");
          db = new mod.DatabaseSync(sqlitePath);
          db.exec("PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA temp_store = MEMORY;");
        } catch {
          db = null;
        }
      }
      if (!db) {
        db = new mod.DatabaseSync(":memory:");
      }
      db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS workbench_fts USING fts5(doc_id UNINDEXED, doc_type UNINDEXED, task_id UNINDEXED, workspace_id UNINDEXED, title, body, tokenize='unicode61');");
      ftsDb = db;
      ftsAvailable = true;
      return true;
    } catch {
      ftsDb = false;
      ftsAvailable = false;
      return false;
    }
  }

  function writeAtomicJson(filePath, data) {
    const serialized = JSON.stringify(data, null, 2);
    const tmp = `${filePath}.tmp`;
    writeFileSync(tmp, serialized, { encoding: "utf8", mode: 0o600 });
    try {
      renameSync(tmp, filePath);
    } catch {
      writeFileSync(filePath, serialized, { encoding: "utf8", mode: 0o600 });
      try { rmSync(tmp, { force: true }); } catch {}
    }
  }

  function syncTaskDetailFiles(tasks = []) {
    if (!taskDir || !Array.isArray(tasks)) return;
    for (const task of tasks) {
      if (!task?.id) continue;
      const subCount = Array.isArray(task.subagents) ? task.subagents.length : 0;
      const lastSubAt = subCount ? (task.subagents.at(-1)?.updatedAt || "") : "";
      const stamp = `${task.updatedAt || ""}:${task.status || ""}:${task.distilledSkillId || ""}:${(task.chatMessages || []).length}:${(task.events || []).length}:${subCount}:${lastSubAt}`;
      if (syncedTaskTimestamps.get(task.id) === stamp) continue;
      const dir = resolve(taskDir, task.id);
      if (!within(taskDir, dir) || dir === taskDir) continue;
      try {
        mkdirSync(dir, { recursive: true });
        const detailPayload = {
          id: task.id,
          code: task.code || "",
          title: task.title || "",
          workspaceId: task.workspaceId || "",
          workspacePath: task.workspacePath || "",
          executionPath: task.executionPath || "",
          origin: task.origin || "local",
          config: task.config || {},
          prompt: task.prompt || "",
          goal: task.goal || "",
          goalChecklist: task.goalChecklist || [],
          plan: task.plan || "",
          implementation: task.implementation || "",
          review: task.review || "",
          distilledSkillId: task.distilledSkillId || "",
          distilledSkillName: task.distilledSkillName || "",
          cliSessions: task.cliSessions || {},
          cliStreamSources: task.cliStreamSources || {},
          subagentPolicy: task.subagentPolicy || null,
          subagents: task.subagents || [],
          commandActivities: task.commandActivities || [],
          terminalHistory: task.terminalHistory || [],
          qaResult: task.qaResult || null,
          subagentDetails: serializeTaskSubagentDetails(task),
          chatCompactedSummary: task.chatCompactedSummary || "",
          chatCompactedCount: task.chatCompactedCount || 0,
          compactionLineage: task.compactionLineage || [],
          chatMessages: task.chatMessages || [],
          events: task.events || [],
          cycles: task.cycles || [],
          artifacts: task.artifacts || [],
          stageMetrics: task.stageMetrics || [],
          updatedAt: task.updatedAt || new Date().toISOString(),
        };
        writeAtomicJson(resolve(dir, "detail.json"), detailPayload);
        syncedTaskTimestamps.set(task.id, stamp);
      } catch {}
    }
  }

  function hydrateTasksFromDetailStore(tasks = []) {
    if (!taskDir || !Array.isArray(tasks)) return;
    for (const task of tasks) {
      if (!task?.id) continue;
      const dir = resolve(taskDir, task.id);
      if (!within(taskDir, dir) || dir === taskDir) continue;
      const detailFile = resolve(dir, "detail.json");
      if (!existsSync(detailFile)) continue;
      try {
        const detail = JSON.parse(readFileSync(detailFile, "utf8"));
        if (!detail || typeof detail !== "object") continue;
        if (!task.plan && detail.plan) task.plan = detail.plan;
        if (!task.implementation && detail.implementation) task.implementation = detail.implementation;
        if (!task.review && detail.review) task.review = detail.review;
        if ((!task.chatMessages || !task.chatMessages.length) && Array.isArray(detail.chatMessages) && detail.chatMessages.length) {
          task.chatMessages = detail.chatMessages;
        }
        if ((!task.events || !task.events.length) && Array.isArray(detail.events) && detail.events.length) {
          task.events = detail.events;
        }
        if (!task.chatCompactedSummary && detail.chatCompactedSummary) {
          task.chatCompactedSummary = detail.chatCompactedSummary;
          task.chatCompactedCount = detail.chatCompactedCount || 0;
          task.compactionLineage = detail.compactionLineage || [];
        }
        if (!task.subagentPolicy && detail.subagentPolicy) {
          task.subagentPolicy = detail.subagentPolicy;
        }
        hydrateTaskSubagentDetails(task, detail);
        if (!task.commandActivities?.length && Array.isArray(detail.commandActivities)) task.commandActivities = detail.commandActivities;
      } catch {}
    }
  }

  function buildSearchCorpus({ tasks = [], memories = [], skills = [], workspaceId = "", scope = "all" }) {
    const docs = [];
    const allowScope = (type) => scope === "all" || scope === type || scope === `${type}s`;

    if (allowScope("task")) {
      for (const task of tasks) {
        if (workspaceId && task.workspaceId !== workspaceId) continue;
        const body = [
          task.prompt || "",
          task.goal || "",
          task.plan || "",
          task.implementation || "",
          task.review || "",
          task.chatCompactedSummary || "",
          (task.artifacts || []).join(" "),
        ].filter(Boolean).join("\n");
        docs.push({
          docId: `task:${task.id}`,
          type: "task",
          id: task.id,
          taskId: task.id,
          workspaceId: task.workspaceId || "",
          title: `${task.code ? `[${task.code}] ` : ""}${task.title || "Task"}`,
          body,
          updatedAt: task.updatedAt || task.createdAt || "",
        });
      }
    }

    if (allowScope("chat")) {
      for (const task of tasks) {
        if (workspaceId && task.workspaceId !== workspaceId) continue;
        for (const msg of task.chatMessages || []) {
          if (!msg?.content) continue;
          docs.push({
            docId: `chat:${task.id}:${msg.id}`,
            type: "chat",
            id: msg.id,
            taskId: task.id,
            workspaceId: task.workspaceId || "",
            title: `${task.title || "Chat"} · ${msg.role === "user" ? "User" : (msg.provider || "Assistant")}`,
            body: String(msg.content),
            updatedAt: msg.createdAt || task.updatedAt || "",
          });
        }
      }
    }

    if (allowScope("memory") || scope === "memories") {
      for (const mem of memories) {
        if (workspaceId && mem.workspaceId !== "all" && mem.workspaceId !== workspaceId) continue;
        docs.push({
          docId: `memory:${mem.id}`,
          type: "memory",
          id: mem.id,
          taskId: mem.sourceTaskId || "",
          workspaceId: mem.workspaceId || "all",
          title: mem.title || "Memory",
          body: mem.content || "",
          updatedAt: mem.updatedAt || mem.createdAt || "",
        });
      }
    }

    if (allowScope("skill")) {
      for (const skill of skills) {
        docs.push({
          docId: `skill:${skill.id}`,
          type: "skill",
          id: skill.id,
          taskId: "",
          workspaceId: skill.workspaceId || "",
          title: skill.name || "Skill",
          body: `${skill.description || ""}\n${skill.instruction || ""}`,
          updatedAt: "",
        });
      }
    }

    if (allowScope("subagent")) {
      for (const task of tasks) {
        if (workspaceId && task.workspaceId !== workspaceId) continue;
        const detailsMap = task._subagentDetails || {};
        for (const sub of task.subagents || []) {
          if (!sub?.id) continue;
          const det = detailsMap[sub.id] || {};
          const body = [
            sub.role || "",
            sub.agentType || "",
            det.prompt || sub.promptPreview || "",
            det.result || sub.resultPreview || "",
            sub.lastActivity || "",
          ].filter(Boolean).join("\n");
          if (!body) continue;
          docs.push({
            docId: `subagent:${task.id}:${sub.id}`,
            type: "subagent",
            id: sub.id,
            taskId: task.id,
            workspaceId: task.workspaceId || "",
            title: `${task.title || "Task"} · Subagent: ${sub.role || sub.name || sub.id}`,
            body,
            updatedAt: sub.updatedAt || task.updatedAt || "",
          });
        }
      }
    }
    return docs;
  }

  function makeSnippet(text, queryTerms) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) return "";
    const lower = clean.toLowerCase();
    for (const term of queryTerms) {
      const idx = lower.indexOf(term.toLowerCase());
      if (idx >= 0) {
        const start = Math.max(0, idx - 60);
        const end = Math.min(clean.length, idx + 160);
        return `${start > 0 ? "…" : ""}${clean.slice(start, end)}${end < clean.length ? "…" : ""}`;
      }
    }
    return clean.slice(0, 200);
  }

  async function searchWorkbench({ query = "", tasks = [], memories = [], skills = [], workspaceId = "", scope = "all", limit = 25 }) {
    const rawQuery = String(query || "").trim();
    const baseTerms = tokenize(rawQuery);
    if (!baseTerms.length && rawQuery.length >= 2) baseTerms.push(rawQuery.normalize("NFC").toLowerCase());
    const queryTerms = baseTerms.filter((token) => /[\p{L}\p{N}]/u.test(token));
    if (!queryTerms.length) return { query: rawQuery, engine: "none", total: 0, results: [] };

    let maxTaskUpdatedAt = "";
    for (const t of tasks) {
      const stamp = String(t?.updatedAt || t?.createdAt || "");
      if (stamp > maxTaskUpdatedAt) maxTaskUpdatedAt = stamp;
    }
    let maxMemoryUpdatedAt = "";
    for (const m of memories) {
      const stamp = String(m?.updatedAt || m?.createdAt || "");
      if (stamp > maxMemoryUpdatedAt) maxMemoryUpdatedAt = stamp;
    }
    const corpusStamp = `${workspaceId || ""}::${scope || "all"}::${tasks.length}::${maxTaskUpdatedAt}::${memories.length}::${maxMemoryUpdatedAt}::${skills.length}`;

    let docs = null;
    const ensureDocs = () => {
      if (!docs) docs = buildSearchCorpus({ tasks, memories, skills, workspaceId, scope });
      return docs;
    };

    const hasSqlite = await initFtsEngine();
    if (hasSqlite && ftsDb) {
      try {
        if (corpusStamp !== lastFtsCorpusStamp) {
          const currentDocs = ensureDocs();
          const nextDocMap = new Map();
          const nextDocStamps = new Map();
          ftsDb.exec("BEGIN IMMEDIATE;");
          try {
            if (ftsDocStamps.size === 0) {
              ftsDb.exec("DELETE FROM workbench_fts;");
            }
            const delStmt = ftsDb.prepare("DELETE FROM workbench_fts WHERE doc_id = ?;");
            const insert = ftsDb.prepare("INSERT INTO workbench_fts (doc_id, doc_type, task_id, workspace_id, title, body) VALUES (?, ?, ?, ?, ?, ?);");
            for (const doc of currentDocs) {
              const docStamp = `${doc.updatedAt || ""}::${doc.title.length}::${doc.body.length}`;
              nextDocMap.set(doc.docId, doc);
              nextDocStamps.set(doc.docId, docStamp);
              if (ftsDocStamps.get(doc.docId) !== docStamp) {
                if (ftsDocStamps.has(doc.docId)) delStmt.run(doc.docId);
                insert.run(doc.docId, doc.type, doc.taskId, doc.workspaceId, doc.title, doc.body);
              }
            }
            for (const oldDocId of ftsDocStamps.keys()) {
              if (!nextDocStamps.has(oldDocId)) {
                delStmt.run(oldDocId);
              }
            }
            ftsDb.exec("COMMIT;");
            lastFtsDocMap = nextDocMap;
            ftsDocStamps = nextDocStamps;
            lastFtsCorpusStamp = corpusStamp;
          } catch (err) {
            try { ftsDb.exec("ROLLBACK;"); } catch {}
            throw err;
          }
        }
        if (!lastFtsDocMap.size) return { query: rawQuery, engine: "bm25", total: 0, results: [] };
        const ftsMatchExpr = queryTerms
          .map((t) => `"${String(t).replace(/"/g, "")}"*`)
          .filter((t) => t !== '""*')
          .join(" OR ");
        if (!ftsMatchExpr) return { query: rawQuery, engine: "none", total: 0, results: [] };
        const stmt = ftsDb.prepare(
          "SELECT doc_id, bm25(workbench_fts, 0.0, 0.0, 0.0, 0.0, 5.0, 1.0) AS rank_score FROM workbench_fts WHERE workbench_fts MATCH ? ORDER BY rank_score LIMIT ?;"
        );
        const rows = stmt.all(ftsMatchExpr, Math.max(1, Math.min(100, Number(limit) || 25)));
        const results = rows
          .map((row) => {
            const doc = lastFtsDocMap.get(row.doc_id);
            if (!doc) return null;
            return {
              type: doc.type,
              id: doc.id,
              taskId: doc.taskId,
              workspaceId: doc.workspaceId,
              title: doc.title,
              snippet: makeSnippet(`${doc.title} — ${doc.body}`, queryTerms),
              score: Math.round(Math.abs(Number(row.rank_score) || 1) * 100) / 100,
              updatedAt: doc.updatedAt,
            };
          })
          .filter(Boolean);
        return { query: rawQuery, engine: "sqlite-fts5", total: results.length, results };
      } catch {}
    }

    const fallbackDocs = ensureDocs();
    if (!fallbackDocs.length) return { query: rawQuery, engine: "bm25", total: 0, results: [] };

    // Fallback BM25 search
    const indexed = fallbackDocs.map((doc) => {
      const terms = tokenizeTerms(`${doc.title} ${doc.title} ${doc.body}`);
      const tf = new Map();
      for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
      return { doc, tf, len: Math.max(1, terms.length) };
    });
    const N = indexed.length;
    const avgDl = indexed.reduce((s, d) => s + d.len, 0) / N;
    const df = new Map();
    for (const term of queryTerms) {
      let c = 0;
      for (const d of indexed) if (d.tf.has(term)) c += 1;
      df.set(term, c);
    }
    const scored = indexed
      .map(({ doc, tf, len }) => {
        let score = 0;
        for (const term of queryTerms) {
          const f = tf.get(term) || 0;
          if (!f) {
            if (`${doc.title} ${doc.body}`.toLowerCase().includes(term)) score += 0.5;
            continue;
          }
          const docFreq = df.get(term) || 0;
          const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5));
          const norm = f + 1.5 * (1 - 0.75 + 0.75 * (len / avgDl));
          score += idf * ((f * 2.5) / norm);
        }
        return { doc, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, Math.min(100, Number(limit) || 25)))
      .map(({ doc, score }) => ({
        type: doc.type,
        id: doc.id,
        taskId: doc.taskId,
        workspaceId: doc.workspaceId,
        title: doc.title,
        snippet: makeSnippet(`${doc.title} — ${doc.body}`, queryTerms),
        score: Math.round(score * 100) / 100,
        updatedAt: doc.updatedAt,
      }));
    return { query: rawQuery, engine: "bm25", total: scored.length, results: scored };
  }

  return {
    syncTaskDetailFiles,
    hydrateTasksFromDetailStore,
    deleteTaskDetailStore: (runtimeOrTaskId, maybeTaskId) => {
      if (maybeTaskId !== undefined) {
        syncedTaskTimestamps.delete(String(maybeTaskId));
        return deleteTaskDetailStore(runtimeOrTaskId, maybeTaskId);
      }
      const id = String(runtimeOrTaskId || "").trim();
      syncedTaskTimestamps.delete(id);
      if (!taskDir) return false;
      return deleteTaskDetailStore(resolve(taskDir, ".."), id);
    },
    searchWorkbench,
    close: () => {
      if (ftsDb && typeof ftsDb.close === "function") {
        try { ftsDb.close(); } catch {}
      }
      ftsDb = null;
      ftsAvailable = false;
    },
  };
}

export function normalizeScheduleProfile(body = {}, stateOrWorkspaces = {}, connectors = {}) {
  const state = Array.isArray(stateOrWorkspaces) ? { workspaces: stateOrWorkspaces, settings: {} } : (stateOrWorkspaces || {});
  const name = String(body.name || "").trim().slice(0, 80);
  if (!name) throw new Error("Nhập tên lịch chạy tự động (1–80 ký tự).");
  const workspace = (state.workspaces || []).find((w) => w.id === body.workspaceId);
  if (!workspace) throw new Error("Chọn workspace hợp lệ cho lịch chạy tự động.");
  const prompt = String(body.prompt || "").trim();
  if (prompt.length < 6 || prompt.length > 20_000) throw new Error("Nội dung yêu cầu của lịch chạy cần từ 6 đến 20.000 ký tự.");
  const workflow = ["chat-only", "plan-only", "codex-antigravity"].includes(body.workflow) ? body.workflow : "plan-only";
  const permissionPreset = ["read-only", "workspace-write", "full-access"].includes(body.permissionPreset)
    ? body.permissionPreset
    : (workflow === "plan-only" ? "read-only" : "workspace-write");
  if (permissionPreset === "read-only" && workflow === "codex-antigravity") {
    throw new Error("Luồng Plan → Build → Review cần quyền workspace-write trở lên.");
  }
  const intervalMinutes = Math.max(5, Math.min(10080, Number(body.intervalMinutes) || 60));
  const isolated = body.isolated !== undefined ? Boolean(body.isolated) : true;
  const enabled = body.enabled !== undefined ? Boolean(body.enabled) : true;
  const qaCommand = String(body.qaCommand || "").trim().slice(0, 80);
  const maxRounds = Math.max(1, Math.min(3, Number(body.maxRounds) || (workflow === "codex-antigravity" ? 2 : 1)));
  const planGate = Boolean(body.planGate);

  const defaultProvider = Object.keys(connectors).find((k) => connectors[k]?.available) || "codex";
  const defaultModel = connectors[defaultProvider]?.models?.[0]?.id || "test-model";
  const defaultEffort = connectors[defaultProvider]?.models?.[0]?.efforts?.[0] || "standard";

  const pickRole = (roleId) => {
    const sub = body.roles?.[roleId] || {};
    const provider = String(sub.provider || body[`${roleId}Provider`] || state.settings?.defaults?.roles?.[roleId]?.provider || defaultProvider);
    const conn = connectors[provider];
    const model = String(sub.model || body[`${roleId}Model`] || state.settings?.defaults?.roles?.[roleId]?.model || conn?.models?.[0]?.id || defaultModel);
    const modelObj = conn?.models?.find((m) => m.id === model);
    const effort = String(sub.effort || body[`${roleId}Effort`] || state.settings?.defaults?.roles?.[roleId]?.effort || modelObj?.efforts?.[0] || defaultEffort);
    return { provider, model, effort };
  };
  const roles = Object.fromEntries(workflowRoles.map((r) => [r.id, pickRole(r.id)]));
  const chatRole = pickRole("plan");
  const chatProvider = String(body.chatProvider || chatRole.provider);
  const chatModel = String(body.chatModel || chatRole.model);
  const chatEffort = String(body.chatEffort || chatRole.effort);

  const nowMs = Date.now();
  return {
    id: body.id ? String(body.id) : `sched-${randomUUID().slice(0, 8)}`,
    name,
    workspaceId: workspace.id,
    prompt,
    workflow,
    permissionPreset,
    isolated,
    intervalMinutes,
    qaCommand,
    maxRounds,
    planGate,
    enabled,
    roles,
    chatProvider,
    chatModel,
    chatEffort,
    createdAt: body.createdAt || new Date(nowMs).toISOString(),
    updatedAt: new Date(nowMs).toISOString(),
    lastRunAt: body.lastRunAt || null,
    nextRunAt: enabled ? new Date(nowMs + intervalMinutes * 60_000).toISOString() : null,
    lastTaskId: body.lastTaskId || null,
    runCount: Number(body.runCount) || 0,
  };
}

export const MAX_CRON_HISTORY_PER_SCHEDULE = 10;

export async function pruneCompletedCronTasks(state, {
  scheduleId = "",
  taskDir = "",
  runtimeDir = "",
  cleanupTaskWorktrees = null,
  maxHistoryPerSchedule = MAX_CRON_HISTORY_PER_SCHEDULE,
} = {}) {
  if (!state || !Array.isArray(state.tasks)) return [];
  const cap = Math.max(1, Number(maxHistoryPerSchedule) || MAX_CRON_HISTORY_PER_SCHEDULE);
  const isCronTask = (t) => Boolean(t) && (t.origin === "schedule" || Boolean(t.scheduleId) || String(t.code || "").startsWith("CRON-"));
  const isTerminal = (t) => ["done", "failed", "cancelled"].includes(t?.status) && !t?.pinned;

  const bySchedule = new Map();
  for (const t of state.tasks) {
    if (!isCronTask(t)) continue;
    if (scheduleId && t.scheduleId && t.scheduleId !== scheduleId) continue;
    const key = t.scheduleId || "__cron__";
    if (!bySchedule.has(key)) bySchedule.set(key, []);
    bySchedule.get(key).push(t);
  }

  const evictedIds = new Set();
  const evictedTasks = [];
  for (const group of bySchedule.values()) {
    const completed = group.filter(isTerminal);
    // Clean up stale isolated worktrees for older completed cron runs beyond the 2 most recent
    for (const staleTask of completed.slice(2)) {
      if (staleTask.isolated && staleTask.worktreePath && !staleTask.worktreeCleaned && !staleTask.worktreeAppliedAt) {
        if (typeof cleanupTaskWorktrees === "function") {
          try { await cleanupTaskWorktrees(staleTask); } catch {}
        } else {
          try { rmSync(resolve(staleTask.worktreePath), { recursive: true, force: true }); } catch {}
        }
        staleTask.worktreeCleaned = true;
      }
    }
    if (completed.length > cap) {
      for (const oldTask of completed.slice(cap)) {
        evictedIds.add(oldTask.id);
        evictedTasks.push(oldTask);
      }
    }
  }

  if (evictedTasks.length) {
    const resolvedRuntime = runtimeDir || (taskDir ? resolve(taskDir, "..") : "");
    for (const oldTask of evictedTasks) {
      if (oldTask.worktreePath && !oldTask.worktreeCleaned) {
        if (typeof cleanupTaskWorktrees === "function") {
          try { await cleanupTaskWorktrees(oldTask); } catch {}
        } else {
          try { rmSync(resolve(oldTask.worktreePath), { recursive: true, force: true }); } catch {}
        }
        oldTask.worktreeCleaned = true;
      }
      if (resolvedRuntime) {
        deleteTaskDetailStore(resolvedRuntime, oldTask.id);
      } else if (taskDir && oldTask.id) {
        const target = resolve(taskDir, String(oldTask.id));
        if (within(taskDir, target) && target !== taskDir) {
          try { rmSync(target, { recursive: true, force: true }); } catch {}
        }
      }
    }
    state.tasks = state.tasks.filter((t) => !evictedIds.has(t?.id));
  }
  return evictedTasks;
}

export async function spawnScheduledTask(schedule, {
  state,
  taskDir,
  runtimeDir = "",
  workspaceInfo,
  inspectWorkspace,
  cleanupTaskWorktrees = null,
  maxHistoryPerSchedule = MAX_CRON_HISTORY_PER_SCHEDULE,
}) {
  const workspace = (state.workspaces || []).find((w) => w.id === schedule.workspaceId);
  if (!workspace) throw new Error("Workspace của lịch chạy không còn tồn tại.");
  const resolvedInfo = workspaceInfo || (typeof inspectWorkspace === "function" ? await inspectWorkspace(workspace.path).catch(() => null) : null);
  const id = `task-${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const nextSeq = (Number(schedule.runCount) || 0) + 1;
  const code = `CRON-${String(nextSeq).padStart(2, "0")}`;
  const canIsolate = Boolean(schedule.isolated && resolvedInfo?.isGit && resolvedInfo?.head);
  const config = {
    roles: structuredClone(schedule.roles || {}),
    codexModel: schedule.roles?.plan?.provider === "codex" ? schedule.roles.plan.model : "",
    codexEffort: schedule.roles?.plan?.provider === "codex" ? schedule.roles.plan.effort : "medium",
    agyModel: schedule.roles?.build?.provider === "antigravity" ? schedule.roles.build.model : "",
    agyEffort: schedule.roles?.build?.provider === "antigravity" ? schedule.roles.build.effort : "medium",
    chatProvider: schedule.chatProvider || schedule.roles?.plan?.provider || "codex",
    chatModel: schedule.chatModel || schedule.roles?.plan?.model || "",
    chatEffort: schedule.chatEffort || schedule.roles?.plan?.effort || "standard",
    workflow: schedule.workflow || "plan-only",
  };
  const task = {
    id,
    code,
    origin: "schedule",
    scheduleId: schedule.id,
    scheduleName: schedule.name,
    riskLevel: schedule.workflow === "codex-antigravity" ? "M" : "S",
    milestone: `Schedule · ${schedule.name}`.slice(0, 60),
    dependsOn: [],
    planGate: Boolean(schedule.planGate),
    planGateApprovedAt: null,
    planGateFeedback: "",
    maxRounds: Number(schedule.maxRounds) || 1,
    currentRound: 1,
    qaCommand: schedule.qaCommand || "",
    cycles: [],
    title: `[Lịch tự động] ${schedule.name}`.slice(0, 120),
    prompt: schedule.prompt,
    attachments: [],
    workspaceId: workspace.id,
    workspacePath: resolvedInfo?.path || workspace.path,
    status: "queued",
    phase: "queued",
    isolated: canIsolate,
    config,
    permissionPreset: schedule.permissionPreset || "workspace-write",
    goal: `Thực thi lịch định kỳ "${schedule.name}"${canIsolate ? " trên nhánh Git Worktree cô lập" : ""}.`,
    goalChecklist: [],
    createdAt: now,
    updatedAt: now,
    events: [{
      at: now,
      kind: "success",
      text: `Khởi chạy từ lịch định kỳ "${schedule.name}" (${schedule.intervalMinutes} phút/lần)${canIsolate ? " trên Git worktree cô lập" : ""}.`,
    }],
    skillSelectionMode: "auto",
    skillSelectionCompleted: false,
    skillIds: [],
    skills: [],
    memoryUsed: [],
    storagePath: taskDir ? resolve(taskDir, id) : "",
  };
  schedule.lastRunAt = now;
  schedule.lastTaskId = id;
  schedule.runCount = (Number(schedule.runCount) || 0) + 1;
  schedule.nextRunAt = schedule.enabled
    ? new Date(Date.now() + (Number(schedule.intervalMinutes) || 60) * 60_000).toISOString()
    : null;
  state.tasks.unshift(task);
  await pruneCompletedCronTasks(state, {
    scheduleId: schedule.id,
    taskDir,
    runtimeDir,
    cleanupTaskWorktrees,
    maxHistoryPerSchedule,
  });
  schedule.recentTaskIds = state.tasks
    .filter((t) => t?.scheduleId === schedule.id)
    .map((t) => t.id)
    .slice(0, Math.max(1, Number(maxHistoryPerSchedule) || MAX_CRON_HISTORY_PER_SCHEDULE));
  return task;
}

export async function tickSchedules(stateOrCtx = {}, maybeOptions = {}) {
  const isCtx = stateOrCtx && typeof stateOrCtx === "object" && !Array.isArray(stateOrCtx) && ("state" in stateOrCtx || ("schedules" in stateOrCtx && !("settings" in stateOrCtx)));
  const ctx = isCtx ? stateOrCtx : { ...maybeOptions, state: stateOrCtx };
  const state = ctx.state || stateOrCtx || {};
  state.tasks ||= [];
  const schedules = Array.isArray(state.settings?.schedules)
    ? state.settings.schedules
    : (Array.isArray(ctx.schedules) ? ctx.schedules : []);
  const nowMs = Number.isFinite(Number(ctx.nowMs)) ? Number(ctx.nowMs) : Date.now();
  const spawned = [];

  await pruneCompletedCronTasks(state, {
    taskDir: ctx.taskDir || "",
    runtimeDir: ctx.runtimeDir || "",
    cleanupTaskWorktrees: ctx.cleanupTaskWorktrees || null,
    maxHistoryPerSchedule: ctx.maxHistoryPerSchedule || MAX_CRON_HISTORY_PER_SCHEDULE,
  });

  if (!schedules.length) return spawned;
  let connectors = ctx.connectors || null;

  for (const sched of schedules) {
    if (!sched?.enabled) continue;
    const dueMs = sched.nextRunAt ? Date.parse(sched.nextRunAt) : 0;
    if (Number.isFinite(dueMs) && dueMs > nowMs) continue;
    const activeForSchedule = state.tasks.some((t) => t?.scheduleId === sched.id && ["queued", "running"].includes(t.status));
    if (activeForSchedule) continue;
    try {
      if (!connectors && typeof ctx.loadModels === "function") {
        connectors = await ctx.loadModels().catch(() => ({}));
      }
      const task = await spawnScheduledTask(sched, {
        state,
        taskDir: ctx.taskDir || "",
        runtimeDir: ctx.runtimeDir || "",
        workspaceInfo: ctx.workspaceInfo,
        inspectWorkspace: ctx.inspectWorkspace,
        requestedRole: ctx.requestedRole,
        connectors: connectors || {},
        cleanupTaskWorktrees: ctx.cleanupTaskWorktrees || null,
        maxHistoryPerSchedule: ctx.maxHistoryPerSchedule || MAX_CRON_HISTORY_PER_SCHEDULE,
      });
      spawned.push(task);
    } catch {}
  }
  return spawned;
}
