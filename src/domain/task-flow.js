import { roleConfig } from "./agent-roles.js";

function label(provider) {
  return ({ codex: "Codex", antigravity: "Antigravity", claude: "Claude Code", "claude-api": "Claude API", gemini: "Gemini" })[provider] || provider || "Agent";
}

export function estimateTaskCostUsd(usage = {}) {
  if (!usage || typeof usage !== "object") return 0;
  let totalUsd = 0;
  for (const [provider, metrics] of Object.entries(usage)) {
    if (!metrics || typeof metrics !== "object") continue;
    const input = Math.max(0, Number(metrics.input_tokens || 0));
    const cached = Math.max(0, Number(metrics.cached_input_tokens || 0));
    const output = Math.max(0, Number(metrics.output_tokens || 0));
    const uncachedInput = Math.max(0, input - cached);
    const key = String(provider || "").toLowerCase();
    const inputRate = key.includes("claude") ? 3.0 : key.includes("gemini") ? 1.25 : 2.5;
    const cachedRate = inputRate * 0.25;
    const outputRate = key.includes("claude") ? 15.0 : key.includes("gemini") ? 5.0 : 10.0;
    totalUsd += (uncachedInput * inputRate + cached * cachedRate + output * outputRate) / 1_000_000;
  }
  return Math.round(totalUsd * 1000) / 1000;
}

export function parseReviewFindings(reviewText = "") {
  const raw = String(reviewText || "").trim();
  if (!raw) {
    return { blocking: 0, advisory: 0, status: "pending", items: [] };
  }
  const items = [];
  const lines = raw.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^(?:[-*•]|\d+\.)\s*(?:\[(?:BLOCKING|CRITICAL|HIGH|BUG|ERROR|LỖI NGHIÊM TRỌNG|CẦN SỬA)\]|❌|🔴)/i.test(trimmed) ||
        /^(?:\*\*|__)?(?:Blocking|Critical|Lỗi nghiêm trọng|Cần sửa ngay)(?:\*\*|__)?\s*:/i.test(trimmed)) {
      items.push({
        severity: "blocking",
        text: trimmed.replace(/^(?:[-*•]|\d+\.)\s*/, "").trim()
      });
    } else if (/^(?:[-*•]|\d+\.)\s*(?:\[(?:ADVISORY|WARN|WARNING|MINOR|NIT|GỢI Ý|LƯU Ý)\]|⚠️|🟡)/i.test(trimmed) ||
               /^(?:\*\*|__)?(?:Advisory|Minor|Nit|Gợi ý|Lưu ý)(?:\*\*|__)?\s*:/i.test(trimmed)) {
      items.push({
        severity: "advisory",
        text: trimmed.replace(/^(?:[-*•]|\d+\.)\s*/, "").trim()
      });
    }
  }
  const explicitBlockingMatch = raw.match(/(?:blocking(?:\s+issues|\s+findings)?|lỗi\s+chặn|lỗi\s+nghiêm\s+trọng)\s*[:=]\s*(\d+)/i);
  const explicitAdvisoryMatch = raw.match(/(?:advisory(?:\s+issues|\s+findings)?|cảnh\s+báo\s+nhẹ|gợi\s+ý)\s*[:=]\s*(\d+)/i);
  let blocking = explicitBlockingMatch ? Number(explicitBlockingMatch[1]) : items.filter((item) => item.severity === "blocking").length;
  let advisory = explicitAdvisoryMatch ? Number(explicitAdvisoryMatch[1]) : items.filter((item) => item.severity === "advisory").length;

  if (blocking === 0 && /\b(?:VERDICT\s*:\s*(?:FAIL|REJECT|CHANGES_REQUESTED|NEEDS_FIX)|STATUS\s*:\s*(?:BLOCKING|FAIL))\b/i.test(raw)) {
    blocking = 1;
  }
  const status = blocking > 0 ? "blocking" : advisory > 0 ? "advisory" : "clean";
  return { blocking, advisory, status, items };
}

export function pipelineStepperData(task) {
  if (!task || typeof task !== "object") {
    return { stations: [], cycles: [], stageDocuments: [], findings: { blocking: 0, advisory: 0, status: "pending", items: [] }, costUsd: 0, currentRound: 1, maxRounds: 1, awaitingGate: false };
  }
  const isChat = task.config?.workflow === "chat-only";
  const planOnly = task.config?.workflow === "plan-only";
  const awaitingGate = task.status === "awaiting_approval" || task.phase === "plan-gate";
  const planDone = Boolean(task.plan);
  const buildDone = Boolean(task.implementation);
  const reviewDone = Boolean(task.review);
  const currentRound = Math.max(1, Number(task.currentRound || 1));
  const maxRounds = Math.max(1, Number(task.maxRounds || (isChat || planOnly ? 1 : 2)));
  const findings = task.reviewFindings && typeof task.reviewFindings === "object"
    ? task.reviewFindings
    : parseReviewFindings(task.review);
  const qaDone = Boolean(task.qaResult?.completedAt || task.qaResult?.status === "passed" || task.qaResult?.status === "failed");
  const qaPassed = task.qaResult?.status === "passed" || (!task.qaResult && reviewDone && findings.blocking === 0 && task.status === "done");
  const prDone = Boolean(task.worktreeAppliedAt || task.mergedAt || task.commitHash || (task.status === "done" && !task.isolated));

  const stations = [
    {
      id: "plan-review",
      roleId: "plan",
      label: "1. Lập kế hoạch",
      viLabel: "1. Lập kế hoạch",
      state: task.phase === "plan" && task.status === "running"
        ? "active"
        : planDone || (isChat && task.status === "done")
          ? "done"
          : task.failedPhase === "plan" && task.status === "failed"
            ? "failed"
            : "pending",
      sub: planDone ? "Đã có kế hoạch" : isChat ? "Chat trực tiếp" : "AI Lập kế hoạch"
    },
    {
      id: "you",
      label: "2. Duyệt kế hoạch",
      viLabel: "2. Duyệt kế hoạch",
      isGate: true,
      state: awaitingGate
        ? "attention"
        : task.planGateApprovedAt || (!task.planGate && (buildDone || task.phase === "build" || task.phase === "review" || task.status === "done"))
          ? "done"
          : "pending",
      sub: awaitingGate ? "Chờ bạn duyệt" : task.planGateApprovedAt ? "Đã duyệt" : task.planGate ? "Cổng duyệt" : "Chuyển tự động"
    },
    {
      id: "build",
      roleId: "build",
      label: "3. Triển khai",
      viLabel: "3. Triển khai",
      state: task.phase === "build" && task.status === "running"
        ? "active"
        : buildDone || (task.status === "done" && !planOnly)
          ? "done"
          : task.failedPhase === "build" && task.status === "failed"
            ? "failed"
            : "pending",
      sub: buildDone
        ? `${(task.artifacts || []).length} tệp thay đổi`
        : task.phase === "build" && task.status === "running"
          ? `Đang sửa · Vòng ${currentRound}/${maxRounds}`
          : "AI Triển khai"
    },
    {
      id: "code-review",
      roleId: "review",
      label: "4. Đánh giá",
      viLabel: "4. Đánh giá",
      state: task.phase === "review" && task.status === "running"
        ? "active"
        : reviewDone
          ? (findings.blocking > 0 && task.status !== "done" ? "attention" : "done")
          : task.failedPhase === "review" && task.status === "failed"
            ? "failed"
            : "pending",
      sub: reviewDone
        ? (findings.blocking > 0 ? `${findings.blocking} lỗi chặn` : findings.advisory > 0 ? `${findings.advisory} lưu ý · đạt` : "Đạt chuẩn")
        : task.phase === "review" && task.status === "running"
          ? "Đang đánh giá"
          : "AI Đánh giá"
    },
    {
      id: "qa",
      label: "5. Kiểm thử QA",
      viLabel: "5. Kiểm thử QA",
      state: task.phase === "qa" && task.status === "running"
        ? "active"
        : task.qaResult?.status === "failed"
          ? "failed"
          : (qaDone && qaPassed) || (task.status === "done" && !planOnly)
            ? "done"
            : "pending",
      sub: task.qaResult?.summary || (qaPassed ? "Đạt kiểm thử" : "Hệ thống kiểm thử")
    },
    {
      id: "pr",
      label: "6. Tích hợp",
      viLabel: "6. Tích hợp",
      state: prDone
        ? "done"
        : task.status === "done" && task.isolated && !task.worktreeAppliedAt
          ? "attention"
          : "pending",
      sub: task.commitHash
        ? `Commit ${String(task.commitHash).slice(0, 7)}`
        : task.worktreeAppliedAt
          ? "Đã gộp nhánh"
          : task.isolated
            ? "Worktree sẵn sàng"
            : task.status === "done"
              ? "Hoàn tất"
              : "Git / Worktree"
    }
  ];

  const costUsd = Number(task.costUsd || estimateTaskCostUsd(task.usage));
  const rawCycles = Array.isArray(task.cycles) && task.cycles.length ? task.cycles : [];
  const baseCycles = rawCycles.length
    ? rawCycles
    : (() => {
        const synthesized = [];
        if (task.plan) {
          const planRole = roleConfig(task.config || {}, "plan");
          synthesized.push({
            id: "syn-plan-1",
            round: 1,
            stage: "plan",
            title: "Vòng 1 · Lập kế hoạch",
            provider: label(planRole.provider),
            model: planRole.model || "",
            status: awaitingGate ? "awaiting_approval" : "clean",
            badge: awaitingGate ? "Chờ bạn duyệt" : "Đã có kế hoạch",
            blocking: 0,
            advisory: 0,
            turns: 1,
            durationMin: 1,
            durationSec: 18,
            costUsd: Math.round((costUsd * 0.25) * 100) / 100,
            summary: String(task.plan || "").split(/\r?\n/).find((l) => l.trim()) || "Kế hoạch đã hoàn tất",
          });
        }
        if (task.implementation) {
          const buildRole = roleConfig(task.config || {}, "build");
          synthesized.push({
            id: "syn-build-1",
            round: currentRound,
            stage: "build",
            title: `Vòng ${currentRound} · Triển khai`,
            provider: label(buildRole.provider),
            model: buildRole.model || "",
            status: "clean",
            badge: `${(task.artifacts || []).length} tệp`,
            blocking: 0,
            advisory: 0,
            turns: Math.max(1, (task.events || []).filter((e) => e.kind === "tool").length || 1),
            durationMin: 2,
            durationSec: 45,
            costUsd: Math.round((costUsd * 0.5) * 100) / 100,
            summary: `${(task.artifacts || []).length} tệp thay đổi · ${String(task.implementation || "").split(/\r?\n/).find((l) => l.trim()) || "Đã triển khai"}`,
          });
        }
        if (task.review) {
          const reviewRole = roleConfig(task.config || {}, "review");
          synthesized.push({
            id: "syn-review-1",
            round: currentRound,
            stage: "review",
            title: `Vòng ${currentRound} · Đánh giá`,
            provider: label(reviewRole.provider),
            model: reviewRole.model || "",
            status: findings.blocking > 0 ? "blocking" : "clean",
            badge: findings.blocking > 0 ? `${findings.blocking} lỗi chặn` : "Đạt chuẩn",
            blocking: findings.blocking,
            advisory: findings.advisory,
            turns: 1,
            durationMin: 1,
            durationSec: 20,
            costUsd: Math.round((costUsd * 0.25) * 100) / 100,
            summary: String(task.review || "").split(/\r?\n/).find((l) => l.trim()) || "Hoàn tất đánh giá mã nguồn",
          });
        }
        if (task.qaResult) {
          synthesized.push({
            id: "syn-qa-1",
            round: currentRound,
            stage: "qa",
            title: "Kiểm thử QA",
            provider: "Hệ thống",
            model: task.qaResult.command || "test",
            status: task.qaResult.status === "passed" ? "clean" : "blocking",
            badge: task.qaResult.summary || (task.qaResult.status === "passed" ? "Đạt" : "Lỗi"),
            blocking: task.qaResult.status === "failed" ? 1 : 0,
            advisory: 0,
            turns: 1,
            durationMin: Math.max(1, Math.round(Number(task.qaResult.durationMs || 1000) / 60000)),
            durationSec: Math.max(1, Math.round(Number(task.qaResult.durationMs || 1000) / 1000)),
            costUsd: 0,
            summary: task.qaResult.summary || task.qaResult.command || "Kiểm thử tự động",
          });
        }
        return synthesized;
      })();

  const stageLabelMap = { plan: "Lập kế hoạch", build: "Triển khai", implement: "Triển khai", review: "Đánh giá", qa: "Kiểm thử QA" };
  const cycles = baseCycles.map((c) => {
    const rawStatus = String(c.status || "clean");
    const normStatus = rawStatus === "blocking" || rawStatus === "failed" ? "failed" : rawStatus === "awaiting_approval" || rawStatus === "running" ? "active" : "done";
    const durSec = Number(c.durationSec || (c.durationMs ? Math.max(1, Math.round(c.durationMs / 1000)) : (c.durationMin ? c.durationMin * 60 : 12)));
    const firstLine = String(c.summary || "").split(/\r?\n/).map((l) => l.replace(/^#+\s*/, "").trim()).find(Boolean) || c.badge || c.provider || "";
    const fallbackTitle = `Vòng ${c.round || 1} · ${stageLabelMap[c.stage] || c.stage || "Bước"}`;
    const normalizedTitle = String(c.label || c.title || fallbackTitle)
      .replace(/^Round\s+(\d+)\s*·\s*plan$/i, "Vòng $1 · Lập kế hoạch")
      .replace(/^Round\s+(\d+)\s*·\s*(?:implement|build)$/i, "Vòng $1 · Triển khai")
      .replace(/^Round\s+(\d+)\s*·\s*review$/i, "Vòng $1 · Đánh giá")
      .replace(/^QA\s*·\s*verification$/i, "Kiểm thử QA");
    return {
      ...c,
      label: normalizedTitle,
      title: normalizedTitle,
      status: normStatus,
      durationSec: durSec,
      durationMin: Math.max(1, Math.round(durSec / 60)),
      costUsd: Number(c.costUsd ?? (c.stage === "build" ? costUsd * 0.5 : c.stage === "plan" || c.stage === "review" ? costUsd * 0.25 : 0)),
      summary: firstLine.slice(0, 140),
    };
  });

  const stageDocuments = [
    {
      id: "spec",
      group: "Đầu vào",
      title: "spec.md",
      label: "Yêu cầu & Ngữ cảnh",
      ready: Boolean(task.prompt || task.goal),
      available: Boolean(task.prompt || task.goal),
      content: `# ${task.title || "Đặc tả tác vụ"}\n\n${task.prompt || task.goal || ""}`.trim(),
      updatedAt: task.createdAt
    },
    {
      id: "plan",
      group: "Kế hoạch",
      title: "plan.md",
      label: "Kế hoạch kiến trúc",
      ready: Boolean(task.plan),
      available: Boolean(task.plan),
      content: String(task.plan || ""),
      updatedAt: task.planGateApprovedAt || task.updatedAt
    },
    {
      id: "implementation",
      group: "Triển khai",
      title: "implementation.md",
      label: "Báo cáo triển khai",
      ready: Boolean(task.implementation),
      available: Boolean(task.implementation),
      content: String(task.implementation || ""),
      updatedAt: task.updatedAt
    },
    {
      id: "review",
      group: "Đánh giá",
      title: "review-verdict.md",
      label: `Đánh giá mã nguồn (${findings.blocking} lỗi chặn · ${findings.advisory} lưu ý)`,
      ready: Boolean(task.review),
      available: Boolean(task.review),
      content: String(task.review || ""),
      updatedAt: task.updatedAt
    },
    {
      id: "qa",
      group: "Kiểm thử QA",
      title: "qa-report.md",
      label: "Báo cáo kiểm thử QA",
      ready: Boolean(task.qaResult?.output || task.qaResult?.summary),
      available: Boolean(task.qaResult?.output || task.qaResult?.summary),
      content: task.qaResult
        ? `# Báo cáo kiểm thử QA (${task.qaResult.status === "passed" ? "ĐẠT" : task.qaResult.status === "failed" ? "LỖI" : "HOÀN TẤT"})\n\nLệnh: \`${task.qaResult.command || "auto"}\`\nMã thoát: ${task.qaResult.exitCode ?? 0}\n\n\`\`\`\n${task.qaResult.output || task.qaResult.summary || ""}\n\`\`\``
        : "",
      updatedAt: task.qaResult?.completedAt || task.updatedAt
    }
  ];

  return {
    stations,
    cycles,
    stageDocuments,
    findings,
    costUsd,
    currentRound,
    maxRounds,
    awaitingGate
  };
}

export function computeWaveDag(tasks = []) {
  const list = Array.isArray(tasks) ? tasks : [];
  const byId = new Map();
  const byCode = new Map();
  list.forEach((task, index) => {
    if (!task?.id) return;
    byId.set(task.id, task);
    const code = task.code || `TASK-${String(list.length - index).padStart(2, "0")}`;
    byCode.set(String(code).toUpperCase(), task);
  });

  const resolveDepTask = (depRef) => {
    if (!depRef) return null;
    const raw = String(depRef).trim();
    return byId.get(raw) || byCode.get(raw.toUpperCase()) || null;
  };

  const waveMemo = new Map();
  const visiting = new Set();

  const getWaveIndex = (task) => {
    if (!task?.id) return 1;
    if (waveMemo.has(task.id)) return waveMemo.get(task.id);
    if (Array.isArray(task.wave) && typeof task.wave === "number" && task.wave > 0) {
      waveMemo.set(task.id, task.wave);
      return task.wave;
    }
    if (visiting.has(task.id)) return 1;
    visiting.add(task.id);
    const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
    let maxParentWave = 0;
    for (const depRef of deps) {
      const parent = resolveDepTask(depRef);
      if (parent && parent.id !== task.id) {
        maxParentWave = Math.max(maxParentWave, getWaveIndex(parent));
      }
    }
    visiting.delete(task.id);
    const explicitWave = Number(task.waveIndex || 0);
    const computed = Math.max(explicitWave > 0 ? explicitWave : 1, maxParentWave + 1);
    waveMemo.set(task.id, computed);
    return computed;
  };

  const counters = {
    forYou: 0,
    running: 0,
    inReview: 0,
    ready: 0,
    blocked: 0,
    done: 0,
    failed: 0,
    critical: 0
  };

  const enrichedTasks = list.map((task, idx) => {
    const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
    const parentTasks = deps.map(resolveDepTask).filter((parent) => parent && parent.id !== task.id);
    const unmetDependencies = parentTasks.filter((parent) => parent.status !== "done");
    const isBlocked = unmetDependencies.length > 0 && task.status !== "done";
    const waveIndex = getWaveIndex(task);
    const stepper = pipelineStepperData(task);
    const riskLevel = ["S", "M", "L"].includes(String(task.riskLevel || "").toUpperCase())
      ? String(task.riskLevel).toUpperCase()
      : (task.config?.workflow === "codex-antigravity" ? "M" : "S");
    const code = task.code || `TASK-${String(Math.max(1, list.length - idx)).padStart(2, "0")}`;
    const needsHumanLook = task.status === "awaiting_approval" || task.phase === "plan-gate" || task.status === "failed" || (task.status === "done" && task.isolated && !task.worktreeAppliedAt && (task.artifacts || []).length > 0);

    let boardState = "ready";
    if (task.status === "awaiting_approval" || task.phase === "plan-gate") {
      boardState = "for-you";
      counters.forYou += 1;
    } else if (task.status === "failed" || task.status === "cancelled") {
      boardState = "failed";
      counters.failed += 1;
      counters.forYou += 1;
    } else if (task.status === "running" && (task.phase === "review" || task.phase === "qa")) {
      boardState = "in-review";
      counters.inReview += 1;
    } else if (task.status === "running") {
      boardState = "running";
      counters.running += 1;
    } else if (task.status === "done") {
      boardState = "done";
      counters.done += 1;
    } else if (isBlocked) {
      boardState = "blocked";
      counters.blocked += 1;
    } else {
      boardState = "ready";
      counters.ready += 1;
    }

    if (riskLevel === "L" || stepper.findings.blocking > 0 || boardState === "for-you" || boardState === "failed") {
      counters.critical += 1;
    }

    return {
      task,
      id: task.id,
      code,
      riskLevel,
      milestone: task.milestone || "Core",
      waveIndex,
      parentIds: parentTasks.map((parent) => parent.id),
      unmetDependencies: unmetDependencies.map((parent) => ({ id: parent.id, code: parent.code || parent.title })),
      isBlocked,
      boardState,
      needsHumanLook,
      stepper,
      costUsd: stepper.costUsd
    };
  });

  const wavesMap = new Map();
  for (const item of enrichedTasks) {
    if (!wavesMap.has(item.waveIndex)) {
      wavesMap.set(item.waveIndex, []);
    }
    wavesMap.get(item.waveIndex).push(item);
  }

  const waves = [...wavesMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([waveIndex, items]) => ({
      index: waveIndex,
      waveIndex,
      label: `Đợt ${waveIndex}`,
      title: `Đợt ${waveIndex}`,
      tasks: items.map((item) => item.task),
      doneCount: items.filter((item) => item.task.status === "done").length,
      items
    }));

  const edges = [];
  for (const item of enrichedTasks) {
    for (const parentId of item.parentIds) {
      edges.push({
        from: parentId,
        to: item.id,
        satisfied: !item.unmetDependencies.some((u) => u.id === parentId)
      });
    }
  }

  return {
    waves,
    edges,
    counters,
    enrichedTasks,
    needsLookTasks: enrichedTasks.filter((item) => item.needsHumanLook).map((item) => item.task),
    needsLookItems: enrichedTasks.filter((item) => item.needsHumanLook)
  };
}

export function orchestrationNodes(task) {
  const events = task.events || [];
  const hasEvent = (pattern) => events.some((event) => pattern.test(event.text || ""));
  const isChat = task.config.workflow === "chat-only";
  const planOnly = task.config.workflow === "plan-only";
  const failed = task.status === "failed" || task.status === "cancelled";
  const phaseOrder = { queued: 0, chat: 2, plan: 3, "plan-gate": 3.5, build: 5, review: 7, qa: 8, done: 9, failed: 9, cancelled: 9 };
  const activeOrder = phaseOrder[task.phase] ?? 0;
  const failedOrder = phaseOrder[task.failedPhase] ?? activeOrder;
  const pipelineCompleted = task.status === "done" || (task.phase === "chat" && (planOnly ? Boolean(task.plan) : Boolean(task.review)));
  const status = (order, done, active = false, failureRelevant = false) => {
    if (done || task.status === "done" && order <= activeOrder) return "complete";
    if (failureRelevant && failed && order === failedOrder) return task.status;
    if (task.status === "queued") return order === 0 ? "complete" : "queued";
    if (active || (task.status === "running" || task.status === "awaiting_approval") && order === activeOrder) return "active";
    return (task.status === "running" || task.status === "awaiting_approval") && order < activeOrder ? "complete" : "pending";
  };
  const nodes = [{ id: "request", group: "HỆ THỐNG", title: "Nhận yêu cầu & tạo task", detail: "Task được ghi vào hàng đợi cục bộ.", icon: "square-terminal", order: 0, state: status(0, true) }];
  const skillEvidence = task.skillSelectionCompleted || hasEvent(/chọn skill|nạp .*skill|không tìm được skill/i);
  nodes.push({ id: "skills", group: "ĐỊNH TUYẾN", title: "Tìm và chọn skill", detail: task.skills?.length ? `${task.skills.length} skill được chọn: ${task.skills.map((skill) => skill.name).join(", ")}` : skillEvidence ? "Đã tìm thư viện; task tiếp tục theo lựa chọn của bộ định tuyến." : "Tìm ứng viên phù hợp trong thư viện skill.", icon: "notebook-tabs", order: 1, state: status(1, skillEvidence, false, true), output: task.skillSelectionReason });
  const memoryEvidence = (task.memoryUsed || []).length > 0 || hasEvent(/ghi chú phù hợp từ bộ nhớ|bộ nhớ cục bộ/i);
  nodes.push({ id: "memory", group: "NGỮ CẢNH", title: "Nạp ghi nhớ liên quan (BM25)", detail: (task.memoryUsed || []).length ? `${task.memoryUsed.length} ghi chú: ${task.memoryUsed.map((item) => item.title).join(", ")}` : memoryEvidence ? "Đã kiểm tra bộ nhớ cục bộ." : task.status === "queued" ? "Chờ task bắt đầu để kiểm tra ghi nhớ phù hợp." : "Đã kiểm tra; không có ghi chú phù hợp.", icon: "brain", order: 1.5, state: status(1.5, memoryEvidence || task.status !== "queued"), output: task.memoryUsed?.map((item) => item.title).join("\n") });
  if (isChat) {
    const provider = label(task.config.chatProvider);
    nodes.push({ id: "agent-chat", group: "HỘI THOẠI", title: `Agent trả lời · ${provider}`, detail: `${task.config.chatModel || "Model theo cấu hình task"} · ${task.config.chatEffort || "mức suy nghĩ đã chọn"}`, icon: "book-open-text", order: 3, state: status(2, task.status === "done", task.phase === "chat", true), output: task.chatMessages?.filter((message) => message.role === "assistant").at(-1)?.content });
    nodes.push({ id: "result", group: "KẾT QUẢ", title: "Lưu kết quả hội thoại", detail: task.status === "done" ? "Phản hồi đã được lưu trong task." : "Phản hồi sẽ xuất hiện tại đây khi CLI hoàn tất.", icon: "book-check", order: 9, state: status(9, task.status === "done") });
    return nodes;
  }
  const planRole = roleConfig(task.config, "plan");
  const buildRole = roleConfig(task.config, "build");
  const reviewRole = roleConfig(task.config, "review");
  const planDone = Boolean(task.plan) || task.phase === "plan-gate" || task.phase === "build" || task.phase === "review" || task.phase === "qa" || pipelineCompleted && planOnly;
  nodes.push({ id: "plan", group: `TRẠM 1 · ${label(planRole.provider).toLocaleUpperCase()}`, title: "Phân tích dự án & lập kế hoạch", detail: `${planRole.model || "Model chưa lưu"} · ${planRole.effort || "mức suy nghĩ đã chọn"}`, icon: "list-checks", order: 3, state: status(3, planDone, task.phase === "plan", true), output: task.plan });
  if (planOnly) {
    nodes.push({ id: "result", group: "KẾT QUẢ", title: "Lưu kế hoạch", detail: pipelineCompleted ? "Kế hoạch đã hoàn tất; chưa chạy triển khai." : "Đầu ra kế hoạch sẽ được lưu ở đây.", icon: "book-check", order: 9, state: status(9, pipelineCompleted), output: task.plan });
    return nodes;
  }
  if (task.planGate || task.phase === "plan-gate" || task.status === "awaiting_approval" || task.planGateApprovedAt) {
    const gateDone = Boolean(task.planGateApprovedAt) || task.phase === "build" || task.phase === "review" || task.phase === "qa" || pipelineCompleted;
    nodes.push({
      id: "plan-gate",
      group: "TRẠM 2 · BẠN DUYỆT KẾ HOẠCH",
      title: gateDone ? "Đã duyệt kế hoạch" : "Chờ bạn duyệt kế hoạch",
      detail: gateDone
        ? `Đã xác nhận duyệt${task.planGateFeedback ? ` · Ghi chú: ${task.planGateFeedback}` : ""}`
        : "Tạm dừng an toàn trước khi sửa code. Bạn có thể bấm Duyệt & Triển khai hoặc yêu cầu lập lại kế hoạch.",
      icon: "shield-check",
      order: 3.5,
      state: status(3.5, gateDone, task.phase === "plan-gate" || task.status === "awaiting_approval", true)
    });
  }
  const handoffToBuild = hasEvent(/Handoff .* → .*kế hoạch được chuyển sang stage triển khai/i);
  nodes.push({ id: "handoff-build", group: "BÀN GIAO", title: `Chuyển kế hoạch sang ${label(buildRole.provider)}`, detail: `Bàn giao đầu ra ${label(planRole.provider)} và cấu hình triển khai (Vòng ${Number(task.currentRound || 1)}/${Number(task.maxRounds || 1)}).`, icon: "arrow-up-right", order: 4, state: status(4, handoffToBuild || planDone && (task.phase === "build" || task.phase === "review" || task.phase === "qa" || Boolean(task.implementation) || pipelineCompleted)) });
  const buildDone = Boolean(task.implementation) || task.phase === "review" || task.phase === "qa" || pipelineCompleted;
  nodes.push({ id: "build", group: `TRẠM 3 · ${label(buildRole.provider).toLocaleUpperCase()}`, title: `Triển khai thay đổi (Vòng ${Number(task.currentRound || 1)})`, detail: `${buildRole.model || "Model chưa lưu"} · ${buildRole.effort || "mức suy nghĩ đã chọn"}`, icon: "folder-code", order: 5, state: status(5, buildDone, task.phase === "build", true), output: task.implementation });
  const toolEvents = events.filter((event) => event.kind === "tool");
  if (toolEvents.length) nodes.push({ id: "tools", group: "CÔNG CỤ ĐÃ GỌI", title: `${toolEvents.length} lần gọi công cụ CLI`, detail: "Danh sách chỉ gồm sự kiện công cụ được CLI ghi nhận thực tế.", icon: "settings-2", order: 5.5, state: status(5.5, buildDone || task.status === "running" && task.phase === "review"), events: toolEvents });
  const handoffToReview = hasEvent(/stage triển khai đã kết thúc/i);
  nodes.push({ id: "handoff-review", group: "BÀN GIAO", title: `Chuyển thay đổi sang ${label(reviewRole.provider)}`, detail: `Bàn giao kết quả ${label(buildRole.provider)} cho trạm đánh giá.`, icon: "arrow-up-right", order: 6, state: status(6, handoffToReview || task.phase === "review" || task.phase === "qa" || Boolean(task.review) || pipelineCompleted) });
  const findings = parseReviewFindings(task.review);
  nodes.push({ id: "review", group: `TRẠM 4 · ${label(reviewRole.provider).toLocaleUpperCase()}`, title: `Đánh giá thay đổi (${findings.blocking} lỗi chặn · ${findings.advisory} lưu ý)`, detail: `${reviewRole.model || "Model chưa lưu"} · ${reviewRole.effort || "mức suy nghĩ đã chọn"}`, icon: "book-check", order: 7, state: status(7, Boolean(task.review) || pipelineCompleted, task.phase === "review", true), output: task.review });
  if (task.qaCommand || task.qaResult || task.phase === "qa") {
    const qaDone = Boolean(task.qaResult?.completedAt) || pipelineCompleted;
    nodes.push({
      id: "qa",
      group: "TRẠM 5 · KIỂM THỬ QA",
      title: `Kiểm thử tự động (${task.qaResult?.status === "failed" ? "LỖI" : task.qaResult?.status === "passed" ? "ĐẠT" : "QA"})`,
      detail: task.qaResult?.summary || `Lệnh: ${task.qaCommand || "tự động"}`,
      icon: "check-check",
      order: 8,
      state: status(8, qaDone && task.qaResult?.status !== "failed", task.phase === "qa", task.qaResult?.status === "failed"),
      output: task.qaResult?.output || ""
    });
  }
  const artifactCount = (task.artifacts || []).length;
  nodes.push({ id: "result", group: "TRẠM 6 · TÍCH HỢP", title: "Ghi nhận đầu ra & tệp thay đổi", detail: pipelineCompleted ? `${artifactCount} tệp thay đổi được ghi nhận trong task.` : "Kết quả và danh sách tệp sẽ hiện sau khi luồng hoàn tất.", icon: "file", order: 9, state: status(9, pipelineCompleted), files: task.artifacts || [] });
  return nodes;
}

