import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { workflowRoles } from "../domain/agent-roles.js";
import { within } from "./fs-security.mjs";
import { tokenize, tokenizeTerms } from "./memory-bm25.mjs";

let sqliteModulePromise = null;
async function getSqliteModule() {
  if (!sqliteModulePromise) {
    sqliteModulePromise = import("node:sqlite").catch(() => null);
  }
  return sqliteModulePromise;
}

export function createTaskStoreService({ taskDir }) {
  const syncedTaskTimestamps = new Map();
  let ftsDb = null;
  let ftsAvailable = false;

  async function initFtsEngine() {
    if (ftsDb !== null) return ftsAvailable;
    const mod = await getSqliteModule();
    if (!mod?.DatabaseSync) {
      ftsDb = false;
      ftsAvailable = false;
      return false;
    }
    try {
      const db = new mod.DatabaseSync(":memory:");
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
      const stamp = `${task.updatedAt || ""}:${task.status || ""}:${task.distilledSkillId || ""}:${(task.chatMessages || []).length}:${(task.events || []).length}`;
      if (syncedTaskTimestamps.get(task.id) === stamp) continue;
      const dir = resolve(taskDir, task.id);
      if (!within(taskDir, dir) || dir === taskDir) continue;
      try {
        mkdirSync(dir, { recursive: true });
        const detailPayload = {
          id: task.id,
          code: task.code || "",
          title: task.title || "",
          prompt: task.prompt || "",
          goal: task.goal || "",
          goalChecklist: task.goalChecklist || [],
          plan: task.plan || "",
          implementation: task.implementation || "",
          review: task.review || "",
          distilledSkillId: task.distilledSkillId || "",
          distilledSkillName: task.distilledSkillName || "",
          cliSessions: task.cliSessions || {},
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
    const queryTerms = tokenize(rawQuery);
    if (!queryTerms.length && rawQuery.length >= 2) queryTerms.push(rawQuery.toLowerCase());
    if (!queryTerms.length) return { query: rawQuery, engine: "none", total: 0, results: [] };

    const docs = buildSearchCorpus({ tasks, memories, skills, workspaceId, scope });
    if (!docs.length) return { query: rawQuery, engine: "bm25", total: 0, results: [] };

    const hasSqlite = await initFtsEngine();
    if (hasSqlite && ftsDb) {
      try {
        ftsDb.exec("DELETE FROM workbench_fts;");
        const insert = ftsDb.prepare("INSERT INTO workbench_fts (doc_id, doc_type, task_id, workspace_id, title, body) VALUES (?, ?, ?, ?, ?, ?);");
        const docMap = new Map();
        for (const doc of docs) {
          docMap.set(doc.docId, doc);
          insert.run(doc.docId, doc.type, doc.taskId, doc.workspaceId, doc.title, doc.body);
        }
        const ftsMatchExpr = queryTerms
          .map((t) => `"${t.replace(/"/g, "")}"*`)
          .join(" OR ");
        const stmt = ftsDb.prepare(
          "SELECT doc_id, bm25(workbench_fts, 0.0, 0.0, 0.0, 0.0, 5.0, 1.0) AS rank_score FROM workbench_fts WHERE workbench_fts MATCH ? ORDER BY rank_score LIMIT ?;"
        );
        const rows = stmt.all(ftsMatchExpr, Math.max(1, Math.min(100, Number(limit) || 25)));
        const results = rows.map((row) => {
          const doc = docMap.get(row.doc_id);
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
        });
        return { query: rawQuery, engine: "sqlite-fts5", total: results.length, results };
      } catch {}
    }

    // Fallback BM25 search
    const indexed = docs.map((doc) => {
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
    searchWorkbench,
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

export async function spawnScheduledTask(schedule, { state, taskDir, workspaceInfo, inspectWorkspace }) {
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
    storagePath: resolve(taskDir, id),
  };
  schedule.lastRunAt = now;
  schedule.lastTaskId = id;
  schedule.runCount = (Number(schedule.runCount) || 0) + 1;
  schedule.nextRunAt = schedule.enabled
    ? new Date(Date.now() + (Number(schedule.intervalMinutes) || 60) * 60_000).toISOString()
    : null;
  state.tasks.unshift(task);
  return task;
}
