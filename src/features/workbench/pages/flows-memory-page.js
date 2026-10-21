import { esc, fmtDate, icon, statuses, view } from "../../../shared/state.js";
import { computeWaveDag, orchestrationNodes, parseReviewFindings, pipelineStepperData } from "../../../domain/task-flow.js";
import { providerTitle, roleConfig } from "../../../domain/agent-roles.js";
import { showModal } from "../runtime.js";
import { homeSelectField, taskProgress, workflowSummary } from "../ui-controls.js";
import { showWorkspaceModal } from "../modals.js";
import { taskDetails } from "./tasks-workspaces-page.js";

export function workflowNodes(task) {
  const nodes = orchestrationNodes(task);
  const labels = { complete: "Hoàn tất", active: "Đang chạy", queued: "Đang chờ", pending: "Chưa chạy", failed: "Lỗi", cancelled: "Đã dừng" };
  return nodes.map((node, index) => `<div class="workflow-step"><button class="workflow-node node-${esc(node.state)}" data-action="inspect-task" data-id="${esc(task.id)}" aria-label="${esc(node.title)} · ${labels[node.state] || "Chưa ghi nhận"}"><span class="workflow-node-mark">${icon(node.state === "complete" ? "check" : node.icon, 14)}</span><strong>${esc(node.title)}</strong><small>${esc(node.group)}</small><em>${labels[node.state] || "Chưa ghi nhận"}</em></button>${index < nodes.length - 1 ? `<span class="workflow-edge ${node.state === "complete" ? "edge-done" : ""}" aria-hidden="true">${icon("chevron-right", 16)}</span>` : ""}</div>`).join("");
}

export function missionControlStepperMarkup(task, { compact = false } = {}) {
  const data = pipelineStepperData(task);
  const busy = ["queued", "running"].includes(task.status);
  const artifactsCount = (task.artifacts || []).length;
  const canManageWorktree = Boolean(task.isolated && !busy && !task.worktreeCleaned && !task.worktreeAppliedAt);
  const lastEvent = (task.events || []).filter((e) => e.kind !== "output").at(-1) || (task.events || []).at(-1);
  const stationDocMap = { "plan-review": "plan", you: "plan", build: "impl", "code-review": "review", qa: "qa", pr: "impl" };

  const stationsHtml = data.stations.map((st, idx) => {
    const docId = stationDocMap[st.id] || "spec";
    const iconName = st.state === "done" ? "check" : st.state === "failed" ? "x" : st.state === "attention" ? "shield-check" : st.state === "active" ? "refresh-cw" : "circle-dot";
    return `<div class="mc-station is-${esc(st.state)}">
      <button type="button" class="mc-station-btn" data-action="${st.id === "pr" && artifactsCount ? "show-diff" : "open-stage-doc"}" data-id="${esc(task.id)}" data-doc-id="${esc(docId)}" title="${esc(st.label)} · ${esc(st.sub)}">
        <span class="mc-station-dot">${icon(iconName, 12)}</span>
        <span class="mc-station-text">
          <strong>${esc(st.label)}</strong>
          <small>${esc(st.sub)}</small>
        </span>
      </button>
      ${idx < data.stations.length - 1 ? `<span class="mc-station-line ${st.state === "done" ? "is-done" : ""}"></span>` : ""}
    </div>`;
  }).join("");

  const planGateBanner = data.awaitingGate ? `<div class="mc-plan-gate-banner">
    <div class="mc-plan-gate-info">
      <span class="mc-badge is-attention">BƯỚC 2 · DUYỆT KẾ HOẠCH</span>
      <strong>Kế hoạch đã sẵn sàng — Bạn kiểm tra và bấm duyệt trước khi AI viết code</strong>
    </div>
    <div class="mc-plan-gate-controls">
      <input type="text" data-plan-gate-feedback placeholder="Ghi chú thêm hoặc yêu cầu sửa kế hoạch (tùy chọn)…" autocomplete="off">
      <button type="button" class="button quiet small" data-action="open-stage-doc" data-id="${esc(task.id)}" data-doc-id="plan">${icon("book-open-text", 12)}<span>Xem plan.md</span></button>
      <button type="button" class="button quiet small" data-action="revise-plan-gate" data-id="${esc(task.id)}">${icon("refresh-cw", 12)}<span>Lên lại kế hoạch</span></button>
      <button type="button" class="button primary small" data-action="approve-plan-gate" data-id="${esc(task.id)}">${icon("check", 12)}<span>Duyệt & Viết code</span></button>
    </div>
  </div>` : "";

  const cyclesRows = (data.cycles || []).map((c) => {
    const rowIcon = c.status === "done" ? "check" : c.status === "failed" ? "x" : "refresh-cw";
    const stageDoc = c.stage === "plan" ? "plan" : c.stage === "review" ? "review" : c.stage === "qa" ? "qa" : "impl";
    const durLabel = c.durationSec >= 60 ? `${Math.round(c.durationSec / 60)}m` : `${Math.max(1, c.durationSec || 1)}s`;
    return `<div class="mc-cycle-row is-${esc(c.status || "done")}" data-action="open-stage-doc" data-id="${esc(task.id)}" data-doc-id="${esc(stageDoc)}" role="button" tabindex="0">
      <span class="mc-cycle-status">${icon(rowIcon, 12)}</span>
      <strong class="mc-cycle-label">${esc(c.label || `Vòng ${c.round} · ${c.stage}`)}</strong>
      <span class="mc-cycle-summary">${esc(c.summary || "")}</span>
      <span class="mc-cycle-metrics">
        ${c.stage === "review" || c.blocking > 0 || c.advisory > 0 ? `<span class="mc-badge ${c.blocking > 0 ? "is-blocking" : "is-zero"}">${c.blocking} lỗi chặn</span><span class="mc-badge ${c.advisory > 0 ? "is-advisory" : "is-zero"}">${c.advisory} góp ý</span>` : ""}
        <span class="mc-metric-pill">${c.turns || 1} lượt</span>
        <span class="mc-metric-pill">${durLabel}</span>
        ${c.costUsd > 0 ? `<span class="mc-metric-pill is-cost">$${Number(c.costUsd).toFixed(2)}</span>` : ""}
      </span>
    </div>`;
  }).join("");

  const docsBar = `<div class="mc-stage-docs-bar">
    <span class="mc-docs-label">${icon("book-open-text", 12)} Tài liệu từng bước:</span>
    ${(data.stageDocuments || []).map((doc) => `<button type="button" class="mc-doc-pill ${doc.ready ? "is-ready" : ""}" data-action="open-stage-doc" data-id="${esc(task.id)}" data-doc-id="${esc(doc.id)}">${esc(doc.title)}</button>`).join("")}
  </div>`;

  const worktreeChip = task.isolated
    ? `<span class="chat-worktree-chip ${task.worktreeAppliedAt ? "is-merged" : ""}" title="${esc(task.worktreePath || task.executionPath || "")}">${icon(task.worktreeAppliedAt ? "check" : "git-branch", 12)} ${task.worktreeAppliedAt ? "Đã gộp vào dự án" : task.worktreeCleaned ? "Worktree đã dọn" : esc(task.worktreeBranch || "Worktree cô lập")}</span>`
    : "";
  const activityText = busy && lastEvent?.text ? `<span class="chat-live-event" title="${esc(lastEvent.text)}"><i class="pulse-dot"></i>${esc(String(lastEvent.text).slice(0, 100))}</span>` : "";

  const applyWtBtn = canManageWorktree && artifactsCount > 0
    ? `<button type="button" class="button primary small" data-action="apply-worktree" data-id="${esc(task.id)}">${icon("check", 13)}<span>Gộp vào dự án</span></button>`
    : "";
  const discardWtBtn = canManageWorktree
    ? `<button type="button" class="button quiet small" data-action="discard-worktree" data-id="${esc(task.id)}">${icon("delete", 13)}<span>Hủy worktree</span></button>`
    : "";
  const qaBtn = !busy ? `<button type="button" class="button quiet small" data-action="run-task-qa" data-id="${esc(task.id)}" title="Chạy lệnh kiểm thử cho công việc này">${icon("square-terminal", 13)}<span>Chạy thử</span></button>` : "";
  const diffBtn = task.status !== "queued" ? `<button type="button" class="button quiet small" data-action="show-diff" data-id="${esc(task.id)}">${icon("file", 13)}<span>Diff${artifactsCount ? ` (${artifactsCount})` : ""}</span></button>` : "";
  const flowBtn = compact ? `<button type="button" class="button quiet small" data-action="open-task-flow" data-id="${esc(task.id)}">${icon("workflow", 13)}<span>Luồng</span></button>` : "";
  const stopBtn = busy ? `<button type="button" class="button danger small" data-action="stop-task" data-id="${esc(task.id)}">${icon("square", 12)}<span>Dừng</span></button>` : "";

  return `<section class="mc-stepper-card ${compact ? "is-compact" : "is-full"} ${busy ? "is-running" : ""}" aria-label="Tiến trình 6 bước">
    <header class="mc-stepper-head">
      <div class="mc-stepper-meta">
        <span class="mc-code-pill">${esc(task.code || "TASK")}</span>
        <span class="mc-round-pill">Vòng ${data.currentRound}/${data.maxRounds}</span>
        ${data.findings.blocking > 0 ? `<span class="mc-badge is-blocking">${data.findings.blocking} lỗi chặn</span>` : ""}
        ${data.findings.advisory > 0 ? `<span class="mc-badge is-advisory">${data.findings.advisory} góp ý</span>` : ""}
        ${data.costUsd > 0 ? `<span class="mc-badge is-cost">$${data.costUsd.toFixed(2)}</span>` : ""}
        ${worktreeChip}
        ${activityText}
      </div>
      <div class="mc-stepper-actions">${applyWtBtn}${discardWtBtn}${qaBtn}${diffBtn}${flowBtn}${stopBtn}</div>
    </header>
    <div class="mc-stations-track">${stationsHtml}</div>
    ${planGateBanner}
    ${compact
      ? (cyclesRows ? `<details class="mc-cycles-Region" ${data.awaitingGate || data.findings.blocking > 0 ? "open" : ""}>
          <summary class="mc-cycles-summary"><span>Chi tiết các bước thực hiện (${data.cycles.length} bước) & Tài liệu (5)</span>${icon("chevron-down", 13)}</summary>
          <div class="mc-cycles-list">${cyclesRows}</div>
          ${docsBar}
        </details>` : docsBar)
      : `<div class="mc-cycles-list">${cyclesRows}</div>${docsBar}`}
  </section>`;
}

export function openWaveDecomposeModal() {
  const workspaces = view.state?.workspaces || [];
  if (!workspaces.length) return showWorkspaceModal();
  const wsOptions = workspaces.map((w) => ({ value: w.id, label: `${w.name} · ${w.path}` }));
  const defaultWsId = view.homeWorkspaceId || workspaces[0]?.id || "";
  const roundOptions = [
    { value: "1", label: "1 vòng (Tiêu chuẩn)" },
    { value: "2", label: "2 vòng (Tự sửa nếu kiểm tra phát hiện lỗi)" },
    { value: "3", label: "3 vòng (Kỹ lưỡng)" },
  ];
  const defaultCampaign = [
    "[Đợt 1] Phân tích yêu cầu & thiết kế giao diện / API nền tảng",
    "[Đợt 2] Viết code xử lý chính và kết nối dữ liệu",
    "[Đợt 3] Chạy thử, kiểm tra lỗi và hoàn thiện",
  ].join("\n");
  const body = `
    <p class="form-note">Chia công việc lớn thành <strong>nhiều đợt kế tiếp nhau</strong>: các việc trong cùng một đợt sẽ chạy song song trên nhánh Git riêng, và đợt sau sẽ tự động đợi đợt trước làm xong mới bắt đầu.</p>
    <div class="modal-grid-2">
      <label>Tên nhóm công việc<input name="milestone" required maxlength="120" value="Nhóm việc nâng cấp tính năng" placeholder="VD: Nâng cấp đăng nhập & bảo mật"></label>
      ${homeSelectField("Dự án (Workspace)", "workspaceId", "required", wsOptions, defaultWsId)}
    </div>
    <label>Danh sách công việc theo từng đợt (mỗi dòng 1 việc — cú pháp <code>[Đợt 1] Tên việc :: Chi tiết</code>)
      <textarea name="waveSpec" rows="6" required spellcheck="false">${esc(defaultCampaign)}</textarea>
    </label>
    <div class="modal-grid-2">
      ${homeSelectField("Số vòng tự sửa tối đa", "maxRounds", "", roundOptions, "2")}
      <label>Lệnh chạy thử tự động (tùy chọn)
        <input name="qaCommand" placeholder="VD: npm test" autocomplete="off" spellcheck="false">
      </label>
    </div>
    <label class="check-row"><input type="checkbox" name="planGate"><span><strong>Dừng lại chờ duyệt kế hoạch (Bước 2 · Duyệt kế hoạch)</strong><small>Tạm dừng sau khi AI lên kế hoạch để bạn xem qua trước khi AI viết code.</small></span></label>
    <label class="check-row"><input type="checkbox" name="isolated" checked><span><strong>Tách nhánh Git riêng (Worktree) cho từng việc</strong><small>Giúp các việc trong cùng một đợt chạy song song mà không bị đụng độ tệp.</small></span></label>
  `;
  showModal("Chia công việc theo từng đợt", body, "Bắt đầu chạy theo đợt", "wave-decompose");
}

export function workflowPage() {
  if (view.selected && view.state.tasks.some((task) => task.id === view.selected)) return taskDetails();
  const allTasks = (view.state.tasks || []).filter((t) => !t.archived);
  const statusFilter = view.waveStatusFilter || "all";
  const tasks = allTasks.filter((t) => {
    if (statusFilter === "all") return true;
    const f = parseReviewFindings(t.review || "");
    const canMerge = t.isolated && !t.worktreeCleaned && !t.worktreeAppliedAt && (t.artifacts || []).length > 0 && t.status === "done";
    if (statusFilter === "attention") {
      return t.status === "awaiting_approval" || t.status === "failed" || f.blocking > 0 || canMerge;
    }
    if (statusFilter === "running") {
      return t.status === "running" || t.status === "queued";
    }
    if (statusFilter === "done") {
      return t.status === "done";
    }
    return true;
  });
  const dag = computeWaveDag(tasks.length ? tasks : allTasks);

  const needsLookHtml = dag.needsLookTasks.length ? `<section class="mc-needs-look-banner" aria-label="Cần bạn xử lý">
    <header class="mc-needs-look-head">
      <div>
        <span class="mc-badge is-attention">${icon("shield-check", 12)} CẦN BẠN DUYỆT · ${dag.needsLookTasks.length}</span>
        <strong>Các công việc đang chờ bạn quyết định (Duyệt kế hoạch, Gộp vào dự án, hoặc Xem lỗi)</strong>
      </div>
    </header>
    <div class="mc-needs-look-grid">
      ${dag.needsLookTasks.map((t) => {
        const stepper = pipelineStepperData(t);
        const isGate = t.status === "awaiting_approval";
        const canMerge = t.isolated && !t.worktreeCleaned && !t.worktreeAppliedAt && (t.artifacts || []).length > 0 && t.status === "done";
        return `<article class="mc-needs-look-card">
          <div class="mc-needs-look-main">
            <span class="mc-code-pill">${esc(t.code || "TASK")}</span>
            <button type="button" class="mc-needs-look-title" data-action="open-task-flow" data-id="${esc(t.id)}"><strong>${esc(t.title)}</strong></button>
            ${isGate ? `<span class="mc-badge is-attention">Chờ duyệt kế hoạch</span>` : ""}
            ${stepper.findings.blocking > 0 ? `<span class="mc-badge is-blocking">${stepper.findings.blocking} lỗi chặn</span>` : ""}
            ${canMerge ? `<span class="mc-badge is-passed">Sẵn sàng gộp (${(t.artifacts || []).length} tệp)</span>` : ""}
          </div>
          <div class="mc-needs-look-actions">
            ${isGate ? `<button type="button" class="button primary small" data-action="approve-plan-gate" data-id="${esc(t.id)}">${icon("check", 12)}<span>Duyệt & Chạy</span></button><button type="button" class="button quiet small" data-action="open-stage-doc" data-id="${esc(t.id)}" data-doc-id="plan">Xem kế hoạch</button>` : ""}
            ${canMerge ? `<button type="button" class="button primary small" data-action="apply-worktree" data-id="${esc(t.id)}">${icon("check", 12)}<span>Gộp vào dự án</span></button>` : ""}
            <button type="button" class="button quiet small" data-action="back-chat" data-id="${esc(t.id)}">Mở Chat</button>
            <button type="button" class="button quiet small" data-action="open-task-flow" data-id="${esc(t.id)}">Chi tiết</button>
          </div>
        </article>`;
      }).join("")}
    </div>
  </section>` : "";

  const statusFilters = [
    { id: "all", label: "Tất cả" },
    { id: "attention", label: "Cần chú ý", iconName: "shield-check" },
    { id: "running", label: "Đang chạy", iconName: "refresh-cw" },
    { id: "done", label: "Hoàn tất", iconName: "check" },
  ];

  const toolbarHtml = `<div class="mc-board-toolbar">
    <div class="mc-counter-strip">
      <span class="mc-counter-pill ${dag.counters.forYou > 0 ? "is-attention" : ""}"><strong>${dag.counters.forYou}</strong> cần bạn duyệt</span>
      <span class="mc-counter-pill ${dag.counters.running > 0 ? "is-running" : ""}"><strong>${dag.counters.running}</strong> đang chạy</span>
      <span class="mc-counter-pill"><strong>${dag.counters.inReview}</strong> đang kiểm tra</span>
      <span class="mc-counter-pill"><strong>${dag.counters.ready}</strong> sẵn sàng</span>
      <span class="mc-counter-pill ${dag.counters.blocked > 0 ? "is-blocked" : ""}"><strong>${dag.counters.blocked}</strong> chờ đợt trước</span>
      <span class="mc-counter-pill is-done"><strong>${dag.counters.done}</strong> hoàn tất</span>
    </div>
    <div class="mc-filter-strip" role="tablist" aria-label="Bộ lọc trạng thái công việc">
      <span class="mc-filter-label">Hiển thị:</span>
      ${statusFilters.map((f) => `<button type="button" class="filter ${statusFilter === f.id ? "active" : ""}" data-action="wave-status-filter" data-status="${f.id}">${f.iconName ? icon(f.iconName, 12) : ""}<span>${f.label}</span></button>`).join("")}
    </div>
  </div>`;

  return `<div class="page-head">
    <div>
      <h1>Tiến trình công việc</h1>
      <p>Theo dõi từng bước làm việc của AI từ lúc lên kế hoạch, viết code, kiểm tra lại cho đến khi chạy thử và gộp vào dự án.</p>
    </div>
    ${allTasks.length ? `<div class="page-head-actions">
      <button class="button quiet" data-action="open-wave-decompose">${icon("workflow", 15)} <span>Giao việc theo đợt</span></button>
      <button class="button primary" data-action="new-task">${icon("plus", 15)} <span>Giao việc mới</span></button>
    </div>` : ""}
  </div>
  ${needsLookHtml}
  ${toolbarHtml}
  ${allTasks.length ? `<section class="workflow-board mc-wave-board" data-wave-dag-board>
    <svg class="mc-wave-svg-layer" data-wave-dag-svg aria-hidden="true"></svg>
    ${dag.waves.map((wave) => `<div class="mc-wave-column" data-wave-index="${wave.index}">
      <header class="mc-wave-column-head">
        <strong>${esc(wave.label)}</strong>
        <span class="mc-wave-count">${wave.tasks.length} công việc · ${wave.doneCount}/${wave.tasks.length} hoàn tất</span>
      </header>
      <div class="mc-wave-column-body">
        ${wave.tasks.map((task) => {
          const stepper = pipelineStepperData(task);
          const wsName = view.state.workspaces.find((workspace) => workspace.id === task.workspaceId)?.name || task.workspacePath;
          const depNames = (task.dependsOn || []).map((depId) => {
            const depTask = allTasks.find((t) => t.id === depId);
            return depTask ? (depTask.code || depTask.title.slice(0, 22)) : depId.slice(0, 6);
          });
          return `<article class="workflow-card mc-wave-card status-${esc(task.status)}" data-wave-task-id="${esc(task.id)}">
            <header>
              <div class="mc-card-title-wrap">
                <div class="mc-card-badges">
                  <span class="mc-code-pill">${esc(task.code || "TASK")}</span>
                  <span class="mc-round-pill">Vòng ${stepper.currentRound}/${stepper.maxRounds}</span>
                  ${stepper.findings.blocking > 0 ? `<span class="mc-badge is-blocking">${stepper.findings.blocking} lỗi chặn</span>` : ""}
                  ${stepper.findings.advisory > 0 ? `<span class="mc-badge is-advisory">${stepper.findings.advisory} góp ý</span>` : ""}
                  ${stepper.costUsd > 0 ? `<span class="mc-badge is-cost">$${stepper.costUsd.toFixed(2)}</span>` : ""}
                </div>
                <button data-action="open-task-flow" data-id="${esc(task.id)}" class="workflow-task-title">
                  <strong>${esc(task.title)}</strong>
                  <small>${esc(wsName)} · ${esc(taskProgress(task))}</small>
                </button>
              </div>
              <span class="pill status-${esc(task.status)}"><i></i>${esc(statuses[task.status] || task.status)}</span>
            </header>
            <div class="mc-mini-stations">
              ${stepper.stations.map((st) => `<span class="mc-mini-station is-${esc(st.state)}" title="${esc(st.label)}: ${esc(st.sub)}"><i></i><small>${esc(st.label)}</small></span>`).join("")}
            </div>
            <div class="workflow-lane">${workflowNodes(task)}</div>
            ${depNames.length ? `<div class="mc-dep-row">${icon("git-branch", 12)} <span>Chờ xong: ${depNames.map((n) => `<code>${esc(n)}</code>`).join(", ")}</span></div>` : ""}
            <footer>
              <span>${task.config.workflow === "chat-only" ? `Chat · ${esc(providerTitle(view.connectors, task.config.chatProvider))}` : task.config.workflow === "plan-only" ? `${esc(providerTitle(view.connectors, task.config?.roles?.plan?.provider || roleConfig(task.config, "plan")?.provider))} · chỉ lên kế hoạch` : esc(workflowSummary(task))}</span>
              <div class="mc-card-footer-actions">
                ${task.status === "awaiting_approval" ? `<button type="button" class="button primary small" data-action="approve-plan-gate" data-id="${esc(task.id)}">Duyệt & Chạy</button>` : ""}
                <button type="button" class="workflow-record-link" data-action="back-chat" data-id="${esc(task.id)}">Chat</button>
                <button class="workflow-record-link" data-action="open-task-flow" data-id="${esc(task.id)}">${icon("workflow", 14)} Xem chi tiết</button>
              </div>
              <time>${fmtDate(task.updatedAt)}</time>
            </footer>
          </article>`;
        }).join("")}
      </div>
    </div>`).join("")}
  </section>` : `<section class="empty-state workflow-empty"><strong>Chưa có công việc nào đang chạy</strong><p>Khi bạn giao việc hoặc trò chuyện với AI trong dự án, toàn bộ các bước thực hiện sẽ hiển thị trực quan tại đây.</p><div class="workflow-empty-actions"><button class="button quiet" data-action="open-wave-decompose">${icon("workflow", 15)} <span>Giao việc theo đợt</span></button><button class="button primary" data-action="new-task">${icon("plus", 15)} <span>Giao việc mới</span></button></div></section>`}`;
}

export function drawWaveDagEdges() {
  if (view.page !== "flows") return;
  const board = document.querySelector("[data-wave-dag-board]");
  const svg = board?.querySelector("[data-wave-dag-svg]");
  if (!board || !svg) return;
  const allTasks = view.state?.tasks || [];
  const boardRect = board.getBoundingClientRect();
  if (!boardRect.width || !boardRect.height) return;
  svg.setAttribute("viewBox", `0 0 ${Math.round(boardRect.width)} ${Math.round(boardRect.height)}`);
  const paths = [];
  for (const task of allTasks) {
    const deps = Array.isArray(task.dependsOn) ? task.dependsOn : [];
    if (!deps.length) continue;
    const toEl = board.querySelector(`[data-wave-task-id="${CSS.escape(task.id)}"]`);
    if (!toEl) continue;
    const toRect = toEl.getBoundingClientRect();
    const x2 = toRect.left - boardRect.left;
    const y2 = toRect.top - boardRect.top + toRect.height * 0.5;
    for (const depId of deps) {
      const fromEl = board.querySelector(`[data-wave-task-id="${CSS.escape(depId)}"]`);
      if (!fromEl) continue;
      const fromRect = fromEl.getBoundingClientRect();
      const x1 = fromRect.right - boardRect.left;
      const y1 = fromRect.top - boardRect.top + fromRect.height * 0.5;
      const dx = Math.max(36, Math.abs(x2 - x1) * 0.45);
      const isActive = task.status === "running" || task.status === "awaiting_approval";
      const isDone = task.status === "done";
      paths.push(`<path class="mc-wave-edge ${isActive ? "is-active" : isDone ? "is-done" : ""}" d="M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${(x1 + dx).toFixed(1)} ${y1.toFixed(1)}, ${(x2 - dx).toFixed(1)} ${y2.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}" />`);
    }
  }
  svg.innerHTML = paths.join("");
}

export function memoryPage() {
  const notes = view.state?.memories || [];
  const workspaces = view.state?.workspaces || [];
  const scopeFilter = view.memoryWorkspaceFilter || "all";
  const sharedCount = notes.filter((m) => m.workspaceId === "all").length;
  const filteredNotes = notes.filter((m) => {
    if (scopeFilter === "all") return true;
    if (scopeFilter === "global") return m.workspaceId === "all";
    return m.workspaceId === scopeFilter;
  });

  return `<div class="page-head">
    <div>
      <h1>Bộ nhớ</h1>
      <p>Ghi chú lưu trong máy này. Task chỉ nhận tối đa ba ghi chú có từ khóa phù hợp.</p>
    </div>
    ${notes.length ? `<div class="page-head-actions"><button class="button primary" data-action="new-memory">${icon("plus", 15)} <span>Thêm ghi nhớ</span></button></div>` : ""}
  </div>
  <div class="flow-summary">
    <div><small>Đang hiển thị</small><strong>${filteredNotes.length}</strong></div>
    <div><small>Dùng chung</small><strong>${sharedCount}</strong></div>
    <div><small>Tổng ghi nhớ</small><strong>${notes.length}</strong></div>
  </div>
  <div class="list-toolbar">
    <div class="filters" role="tablist" aria-label="Phạm vi bộ nhớ">
      <button type="button" class="filter ${scopeFilter === "all" ? "active" : ""}" data-action="memory-scope-filter" data-scope="all">Tất cả (${notes.length})</button>
      <button type="button" class="filter ${scopeFilter === "global" ? "active" : ""}" data-action="memory-scope-filter" data-scope="global">Dùng chung (${sharedCount})</button>
      ${workspaces.map((ws) => {
        const count = notes.filter((m) => m.workspaceId === ws.id).length;
        return `<button type="button" class="filter ${scopeFilter === ws.id ? "active" : ""}" data-action="memory-scope-filter" data-scope="${esc(ws.id)}">${esc(ws.name)} (${count})</button>`;
      }).join("")}
    </div>
    <span>${notes.length} ghi nhớ đã lưu trên máy này</span>
  </div>
  ${filteredNotes.length ? `<section class="memory-list">
    ${filteredNotes.map((m) => `<article class="memory-card">
      <div>
        <strong>${esc(m.title)}</strong>
        <small>${m.workspaceId === "all" ? "Dùng chung" : esc(workspaces.find((w) => w.id === m.workspaceId)?.name || "Workspace đã gỡ")} · ${fmtDate(m.createdAt)}</small>
      </div>
      <p>${esc(m.content)}</p>
      <button class="icon-button" data-action="delete-memory" data-id="${esc(m.id)}" title="Xóa ghi nhớ" aria-label="Xóa ghi nhớ">${icon("x", 16)}</button>
    </article>`).join("")}
  </section>` : `<section class="empty-state">
    <div class="empty-symbol">${icon("brain", 18)}</div>
    <strong>Chưa có ghi nhớ lưu</strong>
    <p>Mọi ghi nhớ đều bắt đầu từ nội dung bạn tự lưu. OpenSybau không bịa dữ liệu hoặc tự lấy toàn bộ vault vào prompt.</p>
    <button class="button primary" data-action="new-memory">${icon("plus", 15)} Thêm ghi nhớ</button>
  </section>`}`;
}
