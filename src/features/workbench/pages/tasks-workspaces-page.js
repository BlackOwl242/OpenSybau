import { esc, fmtDate, formatNumber, icon, statuses, tokenCount, view } from "../../../shared/state.js";
import { estimateTaskCostUsd, orchestrationNodes } from "../../../domain/task-flow.js";
import { providerTitle, roleConfig } from "../../../domain/agent-roles.js";
import { translateText } from "../../../shared/i18n.js";
import { api, ensureWorkspaceFileIndex, render } from "../runtime.js";
import { homeSelectField, taskProgress, workflowSummary } from "../ui-controls.js";
import { vaultNoteOptionsMenu } from "./knowledge-skills-page.js";
import { missionControlStepperMarkup } from "./flows-memory-page.js";

let activityChartCache = { key: "", buckets: null, total: 0 };

export function taskRow(task) {
  const workspace = view.state.workspaces.find((w) => w.id === task.workspaceId);
  const hasChatError = (task.chatMessages || []).some((message) => message.status === "failed");
  const roleId = task.phase === "implementation" ? "build" : task.phase;
  const provider = task.phase === "chat"
    ? providerTitle(view.connectors, task.chatQueue?.[0]?.provider || task.config.chatProvider || "codex")
    : providerTitle(view.connectors, task.config?.roles?.[roleId]?.provider || roleConfig(task.config, roleId)?.provider || "codex");
  return `<button class="task-row ${view.selected === task.id ? "selected" : ""}" data-task="${esc(task.id)}">
    <span class="task-state state-${esc(task.status)}"><i></i></span>
    <span class="task-primary"><strong>${esc(task.title)}</strong><small>${esc(workspace?.name || task.workspacePath)} <b>·</b> ${hasChatError ? "Có tin nhắn chat lỗi cần xem" : esc(taskProgress(task))}</small></span>
    <span class="task-agent">${task.status === "running" ? `<i class="spin"></i>${esc(provider)}` : task.status === "queued" ? "Hàng đợi" : esc(task.config.workflow === "chat-only" ? `Chat · ${providerTitle(view.connectors, task.config.chatProvider)}` : task.config.workflow === "plan-only" ? providerTitle(view.connectors, task.config?.roles?.plan?.provider || roleConfig(task.config, "plan")?.provider) : workflowSummary(task))}</span>
    <span class="task-date">${fmtDate(task.updatedAt)}</span>
    <span class="task-chevron">${icon("chevron-right", 16)}</span>
  </button>`;
}

export function activityChart() {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const start = Math.floor(now / hour) * hour - 23 * hour;
  const tasks = view.state.tasks;
  const key = `${start}:${tasks.map((task) => `${task.id}:${task.events?.length || 0}:${task.events?.at(-1)?.at || ""}`).join("|")}`;
  if (activityChartCache.key !== key) {
    const buckets = Array.from({ length: 24 }, (_, index) => ({ start: start + index * hour, events: [0, 0, 0] }));
    let total = 0;
    for (const task of tasks) {
      for (const event of task.events || []) {
        const at = Date.parse(event.at);
        const index = Math.floor((at - start) / hour);
        if (!Number.isFinite(at) || index < 0 || index >= buckets.length) continue;
        const kind = String(event.kind || "info").toLowerCase();
        const series = ["error", "warning"].includes(kind) ? 2 : kind === "success" ? 1 : 0;
        buckets[index].events[series]++;
        total++;
      }
    }
    activityChartCache = { key, buckets, total };
  }
  const { buckets, total } = activityChartCache;
  const max = Math.max(1, ...buckets.map((bucket) => bucket.events.reduce((sum, value) => sum + value, 0)));
  const width = 960, height = 150, left = 15, right = 15, top = 12, baseline = 112;
  const slot = (width - left - right) / buckets.length;
  const barWidth = Math.min(20, slot * 0.58);
  const bars = buckets.map((bucket, index) => {
    const x = left + index * slot + (slot - barWidth) / 2;
    let y = baseline;
    const sum = bucket.events.reduce((a, b) => a + b, 0);
    const pieces = sum === 0 ? `<rect class="activity-zero" x="${x.toFixed(1)}" y="${(baseline - 2).toFixed(1)}" width="${barWidth.toFixed(1)}" height="2" rx="1"/>` : bucket.events.map((value, series) => {
      if (!value) return "";
      const barHeight = Math.max(2, value / max * (baseline - top));
      y -= barHeight;
      return `<rect class="activity-bar activity-bar-${series}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="2"/>`;
    }).join("");
    const label = new Intl.DateTimeFormat(view.language === "en" ? "en-US" : "vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date(bucket.start));
    const title = `${label}: ${sum} sự kiện · ${bucket.events[0]} cập nhật, ${bucket.events[1]} hoàn tất, ${bucket.events[2]} cảnh báo/lỗi`;
    const tick = index % 6 === 0 || index === 23 ? `<text class="activity-axis-label" x="${(x + barWidth / 2).toFixed(1)}" y="136" text-anchor="middle">${label}</text>` : "";
    return `<g role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${pieces}${tick}</g>`;
  }).join("");
  const series = [["Cập nhật", 0], ["Hoàn tất", 1], ["Cảnh báo / lỗi", 2]];
  if (!total) {
    return `<section class="activity-card is-empty-activity" aria-labelledby="activity-title"><header class="activity-header"><div><h2 id="activity-title">Hoạt động · 24 giờ</h2><p>Chưa phát sinh sự kiện task trong 24 giờ qua</p></div><span class="stream-status ${view.streamConnected ? "connected" : "disconnected"}"><i></i>${view.streamConnected ? "Đang nhận cập nhật" : "Đang kết nối lại"}</span></header></section>`;
  }
  return `<section class="activity-card" aria-labelledby="activity-title"><header class="activity-header"><div><h2 id="activity-title">Hoạt động · 24 giờ</h2><p>${total} sự kiện · task thật</p></div><span class="stream-status ${view.streamConnected ? "connected" : "disconnected"}"><i></i>${view.streamConnected ? "Đang nhận cập nhật" : "Đang kết nối lại"}</span></header>
    <div class="activity-chart-wrap"><svg class="activity-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Biểu đồ sự kiện task theo giờ trong 24 giờ qua"><line class="activity-baseline" x1="${left}" y1="${baseline}" x2="${width - right}" y2="${baseline}"/>${bars}</svg></div><footer class="activity-legend">${series.map(([label, index]) => `<span><i class="activity-key activity-bar-${index}"></i>${label}</span>`).join("")}<small>Di chuột vào cột để xem số liệu theo giờ</small></footer>
  </section>`;
}

export function taskPage() {
  const all = view.state.tasks.filter((task) => !task.archived);
  const hasRecordedError = (task) => task.status === "failed" || (task.events || []).some((event) => event.kind === "error") || (task.chatMessages || []).some((message) => message.status === "failed");
  const visible = all.filter((task) => view.filter === "all" || (view.filter === "failed" ? hasRecordedError(task) : task.status === view.filter));
  const running = all.filter((task) => task.status === "running").length;
  const queued = all.filter((task) => task.status === "queued").length;
  const completed = all.filter((task) => task.status === "done").length;
  return `<div class="page-head"><div><h1>Công việc</h1><p>Tạo việc thật trong repository bạn chọn, xem tiến độ và đầu ra trực tiếp.</p></div>${all.length ? `<div class="page-head-actions"><button class="button primary" data-action="${view.state.workspaces.length ? "new-task" : "add-workspace"}">${icon("plus", 15)} <span>${view.state.workspaces.length ? "Tạo task" : "Thêm dự án"}</span></button></div>` : ""}</div>
  <div class="quick-stats is-four-cols">
    <div><small>Tổng số</small><strong>${all.length}</strong></div>
    <div><small>Đang chạy</small><strong>${running}</strong></div>
    <div><small>Đang chờ</small><strong>${queued}</strong></div>
    <div><small>Hoàn tất</small><strong>${completed}</strong></div>
  </div>
  ${activityChart()}
  <div class="list-toolbar"><div class="filters">${[["all", "Tất cả"], ["running", "Đang chạy"], ["queued", "Chờ"], ["done", "Xong"], ["failed", "Lỗi"], ["cancelled", "Đã dừng"]].map(([key, label]) => `<button class="filter ${view.filter === key ? "active" : ""}" data-filter="${key}">${label}</button>`).join("")}</div><span>${all.length} task đã ghi trên máy này</span></div>
  <section class="task-list">${visible.length ? visible.map(taskRow).join("") : `<div class="empty-state"><div class="empty-symbol">${icon("folder-code", 18)}</div><strong>${all.length ? "Không có task trong bộ lọc này" : view.state.workspaces.length ? "Chưa có task nào được chạy" : "Thêm repository của bạn để bắt đầu"}</strong><p>${all.length ? "Chọn bộ lọc khác để xem task." : view.state.workspaces.length ? "Task tiếp theo sẽ chạy trong đúng workspace đã đăng ký và lịch sử sẽ được lưu cục bộ." : "OpenSybau chỉ chạy trong thư mục bạn chỉ định. Hãy thêm đường dẫn repository hoặc thư mục ứng dụng trước; thư mục cài đặt ứng dụng không được tự coi là dự án của bạn."}</p>${all.length ? "" : view.state.workspaces.length ? `<button class="button primary" data-action="new-task">${icon("plus", 15)} Tạo task đầu tiên</button>` : `<button class="button primary" data-action="add-workspace">${icon("plus", 15)} Thêm đường dẫn dự án</button>`}</div>`}</section>`;
}

export function workspacePage() {
  const workspaces = view.state.workspaces || [];
  if (!workspaces.length) {
    return `<div class="page-head"><div><h1>Dự án</h1><p>Chỉ các đường dẫn bạn thêm mới được đưa vào bộ điều phối.</p></div></div>
    <section class="workspace-list"><div class="empty-state"><div class="empty-symbol">${icon("folder-code", 18)}</div><strong>Chưa có dự án</strong><p>Thêm đường dẫn repository hoặc thư mục làm việc trên máy để bắt đầu điều phối AI và duyệt mã nguồn.</p><button class="button primary" data-action="add-workspace">${icon("plus", 15)} Thêm dự án</button></div></section>`;
  }
  const activeWs = workspaces.find((item) => item.id === view.selected)
    || workspaces.find((item) => item.id === view.homeWorkspaceId)
    || workspaces[0];
  if (activeWs) {
    view.selected = activeWs.id;
    view.homeWorkspaceId = activeWs.id;
    if (!view.workspaceFileIndex?.[activeWs.id]) {
      void ensureWorkspaceFileIndex(activeWs.id).then(() => render());
    }
  }
  const allTasks = (view.state.tasks || []).filter((t) => !t.archived);
  const gitCount = workspaces.filter((w) => w.runtime?.isGit).length;
  const statusText = (w) => {
    if (!w.runtime) return "Sẽ kiểm tra trạng thái khi chạy tác vụ";
    if (!w.runtime.isGit) return "Thư mục cục bộ";
    const commitPart = w.runtime.head ? "Đã có commit" : "Chưa có commit";
    const treePart = w.runtime.dirty ? "Có thay đổi chưa commit" : "Working tree sạch";
    return `${commitPart} · ${treePart}`;
  };

  return `<div class="page-head">
    <div>
      <h1>Dự án</h1>
      <p>Quản lý thư mục mã nguồn cục bộ, chọn không gian làm việc đang hoạt động và cấu hình phạm vi cho AI.</p>
    </div>
    <div class="page-head-actions">
      <button type="button" class="button quiet kb-mobile-drawer-btn" data-action="toggle-chat-drawer">${icon("folder-tree", 15)} <span>Cây tệp & Git</span></button>
      <button type="button" class="button primary" data-action="add-workspace">${icon("plus", 15)} <span>Thêm dự án</span></button>
    </div>
  </div>
  <div class="quick-stats">
    <div><small>Tổng dự án</small><strong>${workspaces.length}</strong></div>
    <div><small>Git repository</small><strong>${gitCount}/${workspaces.length}</strong></div>
    <div><small>Phiên làm việc</small><strong>${allTasks.length}</strong></div>
  </div>
  <section class="workspace-list">${workspaces.map((w) => {
    const isCurrent = w.id === activeWs?.id;
    const wsTasks = allTasks.filter((t) => t.workspaceId === w.id);
    const runningCount = wsTasks.filter((t) => ["running", "queued"].includes(t.status)).length;
    const isGit = Boolean(w.runtime?.isGit);
    const branchLabel = isGit ? (w.runtime.branch || "HEAD") : "Thư mục thường";
    const extraFolders = (w.sourceFolders || []).filter((p) => p.toLowerCase() !== w.path.toLowerCase());
    return `<article class="workspace-card ${isCurrent ? "is-active-workspace" : ""}">
      <div class="workspace-card-icon">${icon("folder-code", 17)}</div>
      <div class="workspace-card-main" data-action="open-workspace" data-id="${esc(w.id)}" role="button" tabindex="0" title="Chọn ${esc(w.name)} làm dự án đang làm việc">
        <div class="workspace-card-title-row">
          <strong data-localize-skip="true">${esc(w.name)}</strong>
          ${isCurrent ? `<span class="workspace-meta-pill is-current">Đang chọn</span>` : ""}
          <span class="workspace-meta-pill">${icon(isGit ? "git-branch" : "folder", 11)}<span data-localize-skip="true">${esc(branchLabel)}</span></span>
          ${extraFolders.length ? `<span class="workspace-meta-pill">+${extraFolders.length} thư mục phụ</span>` : ""}
        </div>
        <code data-localize-skip="true">${esc(w.path)}</code>
        <small>${esc(statusText(w))} · ${wsTasks.length} phiên làm việc${runningCount ? ` (${runningCount} đang chạy)` : ""}</small>
      </div>
      <div class="workspace-card-actions">
        <button type="button" class="button ${isCurrent ? "primary" : "quiet"} small" data-action="new-chat" data-workspace-id="${esc(w.id)}">${icon("square-pen", 13)} <span>Chat mới</span></button>
        <button type="button" class="icon-button" data-action="open-project-folder" data-id="${esc(w.id)}" title="Mở thư mục trong Explorer" aria-label="Mở thư mục trong Explorer">${icon("folder-open", 15)}</button>
        <button type="button" class="icon-button" data-action="edit-project" data-id="${esc(w.id)}" title="Cấu hình dự án" aria-label="Cấu hình dự án">${icon("settings-2", 15)}</button>
        <button type="button" class="icon-button" data-action="remove-workspace" data-id="${esc(w.id)}" title="Gỡ dự án" aria-label="Gỡ dự án">${icon("x", 16)}</button>
      </div>
    </article>`;
  }).join("")}</section>`;
}

export function breadcrumbButtons(path, action) {
  const parts = String(path || "").split("/").filter(Boolean);
  const crumbs = [`<button class="path-crumb" data-action="${action}" data-path="">Thư mục gốc</button>`];
  let current = "";
  parts.forEach((part, index) => {
    current = current ? `${current}/${part}` : part;
    crumbs.push(`<span aria-hidden="true">/</span><button class="path-crumb" data-action="${action}" data-path="${esc(current)}" ${index === parts.length - 1 ? "aria-current=page" : ""}>${esc(part)}</button>`);
  });
  return crumbs.join("");
}

export function localFileRows(entries, action, filter = "") {
  const query = filter.toLocaleLowerCase();
  const visible = (entries || []).filter((entry) => {
    if (!query) return true;
    if (entry.name.toLocaleLowerCase().includes(query)) return true;
    if (action === "vault-file-action" && entry.type === "file") {
      const gNode = (view.vaultGraph?.nodes || []).find((n) => n.path === entry.path);
      if (gNode && (gNode.tags || []).some((t) => `#${t}`.toLocaleLowerCase().includes(query))) return true;
    }
    return false;
  });
  if (!visible.length) return `<li class="file-empty">${query ? "Không có tệp khớp bộ lọc." : "Thư mục trống."}</li>`;
  const isVault = action === "vault-file-action";
  const graphNodes = isVault ? (view.vaultGraph?.nodes || []) : [];
  return visible.map((entry, idx) => {
    const isSelected = isVault && entry.type === "file" && view.vaultPreview?.path === entry.path;
    if (isVault && entry.type === "file") {
      const gNode = graphNodes.find((n) => n.path === entry.path);
      const degree = gNode?.degree || 0;
      const popDir = visible.length > 4 && idx >= visible.length - 2 ? "up" : "down";
      return `<li data-file-entry class="vault-file-item ${isSelected ? "is-selected" : ""}"><button class="file-row file ${isSelected ? "is-selected" : ""}" data-action="${action}" data-path="${esc(entry.path)}" aria-label="Mở ${esc(entry.name)}"><span>${icon("file", 14)}</span><strong title="${esc(entry.name)}">${esc(entry.name.replace(/\.(md|mdx|markdown)$/i, ""))}</strong>${degree > 0 ? `<small class="kb-degree-pill" title="${degree} liên kết">${degree}</small>` : ""}</button>${vaultNoteOptionsMenu(entry.path, { showGraph: view.vaultViewMode !== "graph", showRead: view.vaultViewMode === "graph", direction: popDir })}</li>`;
    }
    return `<li data-file-entry><button class="file-row ${entry.type === "directory" ? "directory" : "file"}" data-action="${action}" data-path="${esc(entry.path)}" ${entry.type === "file" ? `aria-label="Mở ${esc(entry.name)}"` : "aria-expanded=false"}><span>${entry.type === "directory" ? icon("folder-code", 15) : icon("file", 15)}</span><strong title="${esc(entry.name)}">${esc(entry.name)}</strong>${entry.type === "file" ? `<small>${formatNumber(entry.size || 0)} B</small>` : icon("chevron-right", 14)}</button></li>`;
  }).join("");
}

export async function loadWorkspaceDir(workspaceId, path = "") {
  const workspace = view.state.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) return;
  view.page = "workspaces";
  view.selected = workspaceId;
  view.homeWorkspaceId = workspaceId;
  view.activeStageTabId = "chat";
  view.workspaceDir = path;
  view.filePreview = null;
  view.collapsedDockFolders = null;
  render();
  await ensureWorkspaceFileIndex(workspaceId);
  render();
}

export async function loadWorkspacePreview(workspaceId, path) {
  const file = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/file?path=${encodeURIComponent(path)}`);
  if (view.selected !== workspaceId) return;
  view.filePreview = file;
  render();
}

export function orchestrationNodeHtml(node, index, count) {
  const stateLabel = { complete: "Hoàn tất", active: "Đang chạy", queued: "Đang chờ", pending: "Chưa chạy", failed: "Lỗi", cancelled: "Đã dừng" }[node.state] || "Chưa ghi nhận";
  const stateIcon = node.state === "complete" ? "check" : node.state === "active" ? "refresh-cw" : node.state === "failed" || node.state === "cancelled" ? "x" : node.icon;
  const extra = node.events?.length ? `<details class="orchestration-node-details"><summary>${node.events.length} sự kiện công cụ quan sát được</summary><div>${node.events.map((event) => `<p><time>${fmtDate(event.at)}</time>${esc(event.text)}</p>`).join("")}</div></details>` : node.output ? `<details class="orchestration-node-details"><summary>Xem đầu ra stage</summary><pre>${esc(node.output)}</pre></details>` : node.files?.length ? `<details class="orchestration-node-details"><summary>Xem ${node.files.length} tệp thay đổi</summary><div>${node.files.map((file) => `<code>${esc(file)}</code>`).join("")}</div></details>` : "";
  return `<article class="orchestration-node state-${esc(node.state)}" data-node="${esc(node.id)}"><div class="orchestration-rail"><span>${icon(stateIcon, 16)}</span>${index < count - 1 ? "<i></i>" : ""}</div><div class="orchestration-node-card"><header><small>${esc(node.group)}</small><span>${stateLabel}</span></header><div class="orchestration-node-main"><span class="orchestration-node-icon">${icon(node.icon, 17)}</span><div><h3>${esc(node.title)}</h3><p>${esc(node.detail)}</p></div></div>${extra}</div></article>`;
}

export function taskDetails() {
  const task = view.state.tasks.find((item) => item.id === view.selected);
  if (!task) return "";
  const workspace = view.state.workspaces.find((w) => w.id === task.workspaceId);
  const usage = Object.values(task.usage || {}).reduce((sum, providerUsage) => sum + tokenCount(providerUsage), 0);
  const events = task.events || [];
  const busy = ["queued", "running"].includes(task.status);
  const nodes = orchestrationNodes(task);
  const eventLabels = { stage: "TRẠM AI", handoff: "CHUYỂN GIAO", tool: "CÔNG CỤ", output: "ĐẦU RA", chat: "TIN NHẮN", memory: "BỘ NHỚ", error: "LỖI", success: "HOÀN TẤT", warning: "GHI CHÚ" };
  const sortedEvents = [...events].slice(-150).reverse();
  const stages = [
    [`Kế hoạch · ${providerTitle(view.connectors, roleConfig(task.config, "plan").provider)}`, task.plan],
    [`Triển khai · ${providerTitle(view.connectors, roleConfig(task.config, "build").provider)}`, task.implementation],
    [`Đánh giá · ${providerTitle(view.connectors, roleConfig(task.config, "review").provider)}`, task.review],
  ].filter(([, output]) => output);
  const replayStages = task.config.workflow === "plan-only" ? [["plan", "Kế hoạch"]] : [["plan", "Kế hoạch"], ["build", "Triển khai"], ["review", "Đánh giá"]];
  const defaultReplayStage = task.status === "done"
    ? replayStages.at(-1)[0]
    : replayStages.some(([id]) => id === task.failedPhase) ? task.failedPhase
      : task.plan ? task.implementation ? "review" : "build" : "plan";
  const canRerun = !busy && !task.processRunning;
  const presetBadge = task.presetRef?.name ? `<span class="pill">${esc(translateText("Nguồn mẫu", view.language))}: ${esc(task.presetRef.name)} · v${Number(task.presetRef.version) || 1}</span>` : "";
  const replayControls = canRerun && task.config.workflow !== "chat-only"
    ? `<div class="stage-rerun-controls">${homeSelectField("Chạy lại từ", "rerunStage", "data-rerun-stage", replayStages.map(([id, label]) => ({ value: id, label })), defaultReplayStage)}<button class="button primary" data-action="rerun-stage" data-id="${esc(task.id)}">Chạy lại</button></div>`
    : canRerun && task.config.workflow === "chat-only" && ["failed", "cancelled"].includes(task.status)
      ? `<button class="button primary" data-action="rerun-task" data-id="${esc(task.id)}">Chạy lại chat</button>`
      : "";
  const stageRunHistory = (task.stageRunHistory || []).length ? `<section class="orchestration-stage-history"><strong>Lịch sử chạy lại</strong>${[...(task.stageRunHistory || [])].reverse().map((attempt) => {
    const stageLabel = { plan: "Kế hoạch", build: "Triển khai", review: "Đánh giá", chat: "Chat" }[attempt.stage] || attempt.stage;
    const statusLabel = { queued: "Trong hàng đợi", running: "Đang chạy", done: "Hoàn tất", failed: "Lỗi", cancelled: "Đã dừng" }[attempt.status] || "Đã ghi nhận";
    const outputRows = Object.entries(attempt.previousOutputs || {}).map(([stage, snapshot]) => {
      const label = { plan: "Kế hoạch trước đó", build: "Triển khai trước đó", review: "Đánh giá trước đó" }[stage] || stage;
      return `<details><summary>${esc(label)}</summary><pre>${esc(snapshot.text || "")}${snapshot.truncated ? "\n\n… phần cuối đã được rút gọn trong lịch sử." : ""}</pre></details>`;
    }).join("");
    const previousArtifacts = attempt.previousArtifacts?.length ? `<div class="stage-history-files"><small>${esc(translateText("Tệp từ lần chạy trước", view.language))}</small>${attempt.previousArtifacts.slice(0, 30).map((file) => `<code>${esc(file)}</code>`).join("")}</div>` : "";
    return `<details class="stage-history-entry"><summary>${esc(stageLabel)} · ${esc(statusLabel)} · ${fmtDate(attempt.requestedAt)}</summary>${attempt.error ? `<p class="stage-history-error">${esc(attempt.error)}</p>` : ""}${outputRows || "<p>Không có đầu ra cũ cho giai đoạn này.</p>"}${previousArtifacts}</details>`;
  }).join("")}</section>` : "";
  const costUsd = estimateTaskCostUsd(task.usage);
  return `<section class="task-orchestration-page" aria-label="Tiến trình công việc">
    <header class="conversation-top"><div class="conversation-context"><span class="conversation-repo">${icon("folder-code", 15)} ${esc(workspace?.name || task.workspacePath)}</span><span class="conversation-separator">/</span><span class="conversation-task-id">${esc(task.code || task.id)}</span></div><div class="detail-head-actions"><button class="button quiet small" data-action="back-flows">${icon("arrow-left", 14)} Quay lại Tiến trình</button><button class="button quiet small" data-action="back-chat" data-id="${esc(task.id)}">${icon("square-terminal", 14)} Cuộc trò chuyện</button><button class="button quiet small" data-action="open-folder" data-id="${esc(task.id)}">${icon("folder-code", 14)} Mở workspace</button><button class="button quiet small" data-action="task-instruction" data-id="${esc(task.id)}">${icon("arrow-up-right", 14)} Gửi chỉ dẫn</button><button class="button quiet small" data-action="new-task">${icon("plus", 14)} Giao việc mới</button></div></header>
    <div class="detail-title-row"><div><h2>${esc(task.title)}</h2><div class="detail-meta"><span class="pill status-${esc(task.status)}"><i></i>${esc(statuses[task.status] || task.status)}</span>${presetBadge}<span>${fmtDate(task.createdAt)}</span>${usage ? `<span>${formatNumber(usage)} token${costUsd > 0 ? ` · $${costUsd.toFixed(2)}` : ""}</span>` : ""}<span>${formatNumber(events.length)} sự kiện · ${formatNumber(nodes.length)} bước</span></div></div></div>
    ${missionControlStepperMarkup(task, { compact: false })}
    ${task.skills?.length ? `<div class="skill-used">${icon("notebook-tabs", 14)} Skill đã chọn: ${task.skills.map((skill) => esc(skill.name)).join(" · ")}</div>` : ""}
    <div class="orchestration-layout"><section class="orchestration-canvas"><header class="orchestration-canvas-head"><div><small>TIẾN TRÌNH THỰC HIỆN · ${esc(task.config.workflow === "chat-only" ? "TRÒ CHUYỆN" : task.config.workflow === "plan-only" ? "CHỈ LÊN KẾ HOẠCH" : "QUY TRÌNH 6 BƯỚC")}</small><h3>${busy ? "Đang thực hiện công việc" : "Chi tiết các bước đã chạy"}</h3></div><span class="activity-live ${busy ? "is-live" : ""}"><i></i>${busy ? "Đang chạy" : "Đã lưu"}</span></header><div class="orchestration-flow">${nodes.map((node, index) => orchestrationNodeHtml(node, index, nodes.length)).join("")}</div></section>
      <aside class="orchestration-activity"><header class="orchestration-activity-head"><div><small>NHẬT KÝ SỰ KIỆN</small><h3>Điều phối & hoạt động</h3></div><span>${events.length} sự kiện</span></header><div class="orchestration-activity-note">${icon("workflow", 14)} Chỉ hiện hoạt động, bàn giao, đầu ra và công cụ được CLI ghi nhận. Suy luận nội bộ của model không được cung cấp.</div><div class="orchestration-event-list" id="agent-activity-feed">${sortedEvents.length ? sortedEvents.map((item) => { const text = String(item.text || ""); const longOutput = item.kind === "output" && text.length > 320; return `<article class="orchestration-event kind-${esc(item.kind)}"><span class="orchestration-event-mark">${icon(({ stage: "square-terminal", handoff: "workflow", tool: "settings-2", output: "file", chat: "book-open-text", memory: "brain", error: "circle-question-mark", success: "check", warning: "circle-question-mark" })[item.kind] || "workflow", 14)}</span><div><header><strong>${esc(eventLabels[item.kind] || "SỰ KIỆN")}</strong><time>${fmtDate(item.at)}</time>${item.kind === "error" ? `<button type="button" class="event-error-open" data-action="view-error-details" data-error="${esc(text)}">Xem lỗi</button>` : ""}</header>${longOutput ? `<p>${esc(text.slice(0, 280))}…</p><details class="orchestration-event-details"><summary>Xem đầu ra đầy đủ</summary><pre>${esc(text)}</pre></details>` : `<p>${esc(text)}</p>`}</div></article>`; }).join("") : `<p class="orchestration-activity-empty">Các sự kiện sẽ xuất hiện khi task được chạy.</p>`}</div>${stages.length ? `<section class="orchestration-stage-results"><strong>Đầu ra agent</strong>${stages.map(([label, output]) => `<details><summary>${esc(label)}</summary><pre>${esc(output)}</pre></details>`).join("")}</section>` : ""}${(task.artifacts || []).length ? `<section class="orchestration-artifacts"><strong>${icon("file", 14)} Tệp thay đổi · ${task.artifacts.length}</strong>${task.artifacts.slice(0, 20).map((file) => `<div>${icon("file", 13)}<code>${esc(file)}</code></div>`).join("")}</section>` : ""}${stageRunHistory}</aside></div>
    <footer class="detail-actions">${task.status === "running" || task.status === "queued" ? `<button class="button danger" data-action="stop-task" data-id="${esc(task.id)}">${icon("square", 13)} Dừng task</button>` : replayControls}${task.status !== "queued" ? `<button class="button quiet" data-action="show-diff" data-id="${esc(task.id)}">Xem diff</button>` : ""}</footer>
  </section>`;
}
