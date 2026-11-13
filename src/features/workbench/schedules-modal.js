import { $, esc, fmtDate, icon, view } from "../../shared/state.js";
import { providerTitle } from "../../domain/agent-roles.js";
import { api, refresh, render, showModal, showToast } from "./runtime.js";
import { homeSelectField } from "./ui-controls.js";
import { showWorkspaceModal } from "./modals.js";

const INTERVAL_PRESETS = [
  { value: "15", label: "Mỗi 15 phút" },
  { value: "30", label: "Mỗi 30 phút" },
  { value: "60", label: "Mỗi 1 giờ" },
  { value: "180", label: "Mỗi 3 giờ" },
  { value: "360", label: "Mỗi 6 giờ" },
  { value: "720", label: "Mỗi 12 giờ" },
  { value: "1440", label: "Hàng ngày (24 giờ)" },
  { value: "10080", label: "Hàng tuần (7 ngày)" },
];

export function getSchedulesList() {
  const fromState = view.state?.settings?.schedules;
  if (Array.isArray(fromState)) return fromState;
  if (Array.isArray(view.schedules)) return view.schedules;
  return [];
}

export function formatScheduleInterval(minutesInput) {
  const mins = Math.max(1, Number(minutesInput) || 60);
  if (mins % 10080 === 0) return mins === 10080 ? "Hàng tuần" : `Mỗi ${mins / 10080} tuần`;
  if (mins % 1440 === 0) return mins === 1440 ? "Hàng ngày" : `Mỗi ${mins / 1440} ngày`;
  if (mins % 60 === 0) return `Mỗi ${mins / 60} giờ`;
  return `Mỗi ${mins} phút`;
}

function scheduleRetentionValue(schedule) {
  return Number(
    schedule?.maxRetained
    ?? schedule?.keepLast
    ?? schedule?.retentionCount
    ?? schedule?.maxRetainedWorktrees
    ?? 3
  ) || 3;
}

function availableScheduleAgentOptions() {
  const options = [];
  for (const [provId, conn] of Object.entries(view.connectors || {})) {
    if (!conn?.available) continue;
    const provName = providerTitle(view.connectors, provId);
    const models = conn.models?.length ? conn.models : [{ id: "", name: provName }];
    for (const m of models) {
      const val = `${provId}::${m.id || ""}`;
      const label = m.id ? `${provName} · ${m.name || m.id}` : provName;
      options.push({ value: val, label });
    }
  }
  if (!options.length) {
    options.push({ value: "codex::", label: "OpenAI Codex (Mặc định)" });
  }
  return options;
}

export function renderSchedulesSectionMarkup({ compact = false } = {}) {
  const schedules = getSchedulesList();
  const workspaces = view.state?.workspaces || [];

  if (!schedules.length) {
    return `<section class="schedules-overview-card is-empty ${compact ? "is-compact" : ""}" aria-label="Lịch chạy tự động">
      <div class="schedules-card-head">
        <div class="schedules-card-title">
          <span class="schedules-card-icon">${icon("calendar", 16)}</span>
          <div>
            <h2>Lịch chạy tự động trên Git Worktree</h2>
            <p>Thiết lập tác vụ kiểm tra lỗi, chạy test hoặc tổng hợp báo cáo định kỳ trong nhánh cô lập, tự động dọn worktree cũ.</p>
          </div>
        </div>
        <button type="button" class="button quiet small" data-action="open-schedules-modal">
          ${icon("plus", 14)}
          <span>Tạo lịch tự động</span>
        </button>
      </div>
    </section>`;
  }

  const rowsHtml = schedules.map((sched) => {
    const ws = workspaces.find((w) => w.id === sched.workspaceId);
    const enabled = sched.enabled !== false;
    const intervalLabel = formatScheduleInterval(sched.intervalMinutes || sched.everyMinutes || 60);
    const retention = scheduleRetentionValue(sched);
    const provId = sched.chatProvider || sched.roles?.plan?.provider || "codex";
    const provLabel = providerTitle(view.connectors, provId);
    return `<article class="schedule-card schedule-item-row ${enabled ? "is-enabled" : "is-paused"}">
      <div class="schedule-item-main">
        <div class="schedule-meta schedule-item-badges">
          <span class="pill ${enabled ? "status-running" : "status-cancelled"}"><i></i>${enabled ? "Đang bật" : "Tạm dừng"}</span>
          <span class="mc-code-pill">${icon("clock", 12)} <span>${esc(intervalLabel)}</span></span>
          <span class="workspace-meta-pill">${icon("git-branch", 12)} <span>Giữ ${retention} worktree</span></span>
        </div>
        <h3 class="schedule-card-title">${esc(sched.name || sched.title || "Lịch tự động")}</h3>
        <p>
          ${esc(ws?.name || "Workspace")} · ${esc(provLabel)}
          ${sched.lastRunAt ? ` · Chạy gần nhất: ${fmtDate(sched.lastRunAt)}` : " · Chưa chạy lần nào"}
          ${sched.nextRunAt && enabled ? ` · Kế tiếp: ${fmtDate(sched.nextRunAt)}` : ""}
        </p>
      </div>
      <div class="schedule-actions schedule-item-actions">
        <button type="button" class="button quiet small" data-action="trigger-schedule" data-id="${esc(sched.id)}" title="Khởi chạy ngay một phiên Git Worktree từ lịch này">
          ${icon("play", 13)}
          <span>Chạy ngay</span>
        </button>
        <button type="button" class="button quiet small" data-action="toggle-schedule" data-id="${esc(sched.id)}" title="${enabled ? "Tạm dừng lịch chạy" : "Kích hoạt lại lịch chạy"}">
          <span>${enabled ? "Tạm dừng" : "Bật lại"}</span>
        </button>
        <button type="button" class="icon-button" data-action="edit-schedule" data-id="${esc(sched.id)}" title="Chỉnh sửa lịch" aria-label="Chỉnh sửa lịch">
          ${icon("square-pen", 14)}
        </button>
        <button type="button" class="icon-button" data-action="delete-schedule" data-id="${esc(sched.id)}" title="Xóa lịch" aria-label="Xóa lịch">
          ${icon("delete", 14)}
        </button>
      </div>
    </article>`;
  }).join("");

  return `<section class="schedules-overview-card ${compact ? "is-compact" : ""}" aria-label="Lịch chạy tự động">
    <header class="schedules-card-head">
      <div class="schedules-card-title">
        <span class="schedules-card-icon">${icon("calendar", 16)}</span>
        <div>
          <h2>Lịch chạy tự động (${schedules.length})</h2>
          <p>Mỗi lần kích hoạt tạo một nhánh <code>CRON-XX</code> cô lập và tự động thu dọn theo giới hạn lưu giữ.</p>
        </div>
      </div>
      <button type="button" class="button quiet small" data-action="open-schedules-modal">
        ${icon("plus", 14)}
        <span>Thêm lịch mới</span>
      </button>
    </header>
    <div class="schedule-grid schedules-item-list">${rowsHtml}</div>
  </section>`;
}

export async function syncSchedulesFromServer() {
  try {
    const res = await api("/api/schedules");
    if (Array.isArray(res?.schedules)) {
      view.schedules = res.schedules;
      if (view.state?.settings) {
        view.state.settings.schedules = res.schedules;
      }
    }
  } catch {}
}

export function openSchedulesModal(editId = "") {
  const workspaces = view.state?.workspaces || [];
  if (!workspaces.length) {
    showWorkspaceModal();
    return;
  }
  const schedules = getSchedulesList();
  const editing = editId ? schedules.find((s) => s.id === editId) || null : null;

  const defaultWsId = editing?.workspaceId || view.homeWorkspaceId || workspaces[0]?.id || "";
  const wsOptions = workspaces.map((ws) => ({
    value: ws.id,
    label: `${ws.name}${ws.runtime?.isGit ? "" : " (Cần khởi tạo Git)"} · ${ws.path}`,
  }));

  const currentInterval = String(editing?.intervalMinutes || editing?.everyMinutes || 360);
  const intervalOptions = INTERVAL_PRESETS.some((p) => p.value === currentInterval)
    ? INTERVAL_PRESETS
    : [{ value: currentInterval, label: formatScheduleInterval(currentInterval) }, ...INTERVAL_PRESETS];

  const workflowOptions = [
    { value: "chat-only", label: "Một Agent tự chủ (Nhanh, gọn)" },
    { value: "codex-antigravity", label: "Quy trình 6 bước (Kế hoạch → Viết code → Review)" },
    { value: "plan-only", label: "Chỉ phân tích & lập kế hoạch" },
  ];
  const currentWorkflow = editing?.workflow || "chat-only";

  const permOptions = [
    { value: "read-only", label: "Chỉ đọc an toàn (Phân tích & báo cáo)" },
    { value: "workspace-write", label: "Đọc & sửa trong Worktree cô lập" },
    { value: "full-access", label: "Toàn quyền thực thi" },
  ];
  const currentPerm = editing?.permissionPreset || "read-only";

  const retentionVal = String(scheduleRetentionValue(editing));
  const retentionOptions = [
    { value: "1", label: "Giữ 1 bản gần nhất" },
    { value: "2", label: "Giữ 2 bản gần nhất" },
    { value: "3", label: "Giữ 3 bản gần nhất (Khuyên dùng)" },
    { value: "5", label: "Giữ 5 bản gần nhất" },
    { value: "10", label: "Giữ 10 bản gần nhất" },
  ];

  const agentOptions = availableScheduleAgentOptions();
  const editProv = editing?.chatProvider || editing?.roles?.plan?.provider || view.homeChatProvider || "codex";
  const editModel = editing?.chatModel || editing?.roles?.plan?.model || view.homeChatModel || "";
  const matchedAgentVal = agentOptions.find((o) => o.value === `${editProv}::${editModel}`)?.value
    || agentOptions.find((o) => o.value.startsWith(`${editProv}::`))?.value
    || agentOptions[0]?.value
    || "codex::";

  const existingListHtml = schedules.length && !editing ? `<div class="schedules-modal-existing">
    <div class="orca-section-head">
      <span class="orca-section-label">LỊCH ĐÃ CẤU HÌNH (${schedules.length})</span>
    </div>
    <div class="schedules-modal-list">
      ${schedules.map((s) => {
        const wsName = workspaces.find((w) => w.id === s.workspaceId)?.name || "Workspace";
        const isEn = s.enabled !== false;
        return `<div class="schedule-modal-row">
          <div class="schedule-modal-row-info">
            <strong>${esc(s.name || s.title || "Lịch chạy")}</strong>
            <small>${esc(wsName)} · ${esc(formatScheduleInterval(s.intervalMinutes || 60))} · ${isEn ? "Đang bật" : "Tạm dừng"}</small>
          </div>
          <div class="schedule-modal-row-actions">
            <button type="button" class="button quiet small" data-action="trigger-schedule" data-id="${esc(s.id)}">${icon("play", 12)}<span>Chạy ngay</span></button>
            <button type="button" class="button quiet small" data-action="toggle-schedule" data-id="${esc(s.id)}"><span>${isEn ? "Tạm dừng" : "Bật"}</span></button>
            <button type="button" class="button quiet small" data-action="edit-schedule" data-id="${esc(s.id)}">${icon("square-pen", 12)}<span>Sửa</span></button>
            <button type="button" class="icon-button" data-action="delete-schedule" data-id="${esc(s.id)}" title="Xóa">${icon("delete", 13)}</button>
          </div>
        </div>`;
      }).join("")}
    </div>
  </div>` : "";

  const body = `
    ${existingListHtml}
    <p class="form-note">Mỗi chu kỳ sẽ khởi chạy trên một <strong>Git Worktree cô lập</strong> để không bao giờ xung đột với nhánh bạn đang sửa trực tiếp.</p>
    ${editing ? `<input type="hidden" name="id" value="${esc(editing.id)}">` : ""}
    <div class="modal-grid-2">
      <label>Tên lịch tự động
        <input name="name" required maxlength="120" value="${esc(editing?.name || "")}" placeholder="VD: Kiểm tra lỗi & chạy test mỗi sáng">
      </label>
      ${homeSelectField("Dự án Git (Workspace)", "workspaceId", "required", wsOptions, defaultWsId)}
    </div>
    <div class="modal-grid-2">
      ${homeSelectField("Chu kỳ thực thi", "intervalMinutes", "", intervalOptions, currentInterval)}
      ${homeSelectField("Agent & Model", "agentSpec", "", agentOptions, matchedAgentVal)}
    </div>
    <div class="modal-grid-2">
      ${homeSelectField("Chế độ luồng", "workflow", "", workflowOptions, currentWorkflow)}
      ${homeSelectField("Quyền truy cập", "permissionPreset", "", permOptions, currentPerm)}
    </div>
    <div class="modal-grid-2">
      ${homeSelectField("Tự động dọn Worktree cũ", "maxRetained", "", retentionOptions, retentionVal)}
      <label class="check-row" style="align-self:end">
        <input type="checkbox" name="enabled" ${editing ? (editing.enabled !== false ? "checked" : "") : "checked"}>
        <span><strong>Bật lịch chạy định kỳ</strong><small>Tự động kích hoạt theo chu kỳ đã chọn</small></span>
      </label>
    </div>
    <label>Chỉ dẫn công việc cho Agent
      <textarea name="prompt" rows="4" required minlength="6" maxlength="20000" placeholder="VD: Chạy bộ test hiện tại, kiểm tra các cảnh báo bảo mật hoặc lỗi biên dịch mới phát sinh và lập báo cáo tóm tắt.">${esc(editing?.prompt || "")}</textarea>
    </label>
  `;

  showModal(
    editing ? `Chỉnh sửa lịch: ${editing.name || "Tự động"}` : "Lịch chạy tự động (Git Worktree)",
    body,
    editing ? "Lưu cập nhật" : "Tạo lịch tự động",
    "schedule-save"
  );
}

export async function submitScheduleForm(form, data, object) {
  const [provRaw, modRaw] = String(object.agentSpec || "codex::").split("::");
  const provider = provRaw || "codex";
  const model = modRaw || "";
  const conn = view.connectors?.[provider];
  const modelObj = conn?.models?.find((m) => m.id === model) || conn?.models?.[0];
  const effort = modelObj?.efforts?.includes("medium") ? "medium" : (modelObj?.efforts?.[0] || "medium");
  const retentionCount = Math.max(1, Math.min(20, Number(object.maxRetained) || 3));
  const intervalMinutes = Math.max(5, Number(object.intervalMinutes) || 60);

  const payload = {
    ...(object.id ? { id: String(object.id).trim() } : {}),
    name: String(object.name || "").trim(),
    workspaceId: String(object.workspaceId || "").trim(),
    prompt: String(object.prompt || "").trim(),
    intervalMinutes,
    workflow: object.workflow || "chat-only",
    permissionPreset: object.permissionPreset || "read-only",
    chatProvider: provider,
    chatModel: model,
    chatEffort: effort,
    roles: {
      plan: { provider, model, effort },
      build: { provider, model, effort },
      review: { provider, model, effort },
    },
    maxRetained: retentionCount,
    keepLast: retentionCount,
    retentionCount,
    maxRetainedWorktrees: retentionCount,
    enabled: data.has("enabled"),
  };

  await api("/api/schedules", { method: "POST", body: JSON.stringify(payload) });
  await syncSchedulesFromServer();
  await refresh();
  showToast(object.id ? "Đã cập nhật lịch chạy tự động." : "Đã tạo lịch chạy tự động trên Git Worktree.");
}

export async function handleScheduleAction(action, id) {
  if (action === "open-schedules-modal") {
    await syncSchedulesFromServer();
    openSchedulesModal("");
    return true;
  }
  if (action === "edit-schedule") {
    openSchedulesModal(id);
    return true;
  }
  if (action === "toggle-schedule") {
    const schedules = getSchedulesList();
    const target = schedules.find((item) => item.id === id);
    if (!target) return true;
    const nextEnabled = target.enabled === false;
    try {
      await api(`/api/schedules/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: nextEnabled }),
      });
    } catch {
      await api("/api/schedules", {
        method: "POST",
        body: JSON.stringify({ ...target, id: target.id, enabled: nextEnabled }),
      });
    }
    await syncSchedulesFromServer();
    await refresh();
    if (!$("#overlay")?.hidden && $("#overlay [data-form='schedule-save']")) {
      openSchedulesModal("");
    } else {
      render();
    }
    showToast(nextEnabled ? `Đã bật lịch "${target.name}".` : `Đã tạm dừng lịch "${target.name}".`);
    return true;
  }
  if (action === "trigger-schedule") {
    const res = await api(`/api/schedules/${encodeURIComponent(id)}/trigger`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    await syncSchedulesFromServer();
    await refresh();
    if (!$("#overlay")?.hidden && $("#overlay [data-form='schedule-save']")) {
      openSchedulesModal("");
    } else {
      render();
    }
    showToast(`Đã khởi chạy phiên Worktree: ${res?.task?.code || res?.task?.title || "CRON"}`);
    return true;
  }
  if (action === "delete-schedule") {
    const schedules = getSchedulesList();
    const target = schedules.find((item) => item.id === id);
    if (!confirm(`Xóa lịch tự động “${target?.name || id}”? Các worktree đã hoàn tất trước đó không bị ảnh hưởng.`)) {
      return true;
    }
    await api(`/api/schedules/${encodeURIComponent(id)}`, { method: "DELETE" });
    await syncSchedulesFromServer();
    await refresh();
    if (!$("#overlay")?.hidden && $("#overlay [data-form='schedule-save']")) {
      openSchedulesModal("");
    } else {
      render();
    }
    showToast("Đã xóa lịch chạy tự động.");
    return true;
  }
  return false;
}
