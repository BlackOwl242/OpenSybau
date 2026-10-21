import { $, esc, icon, view } from "../../shared/state.js";

const previousTaskStateMap = new Map();
let notificationsInitialized = false;

export function trackTaskStatusNotifications(tasks = [], { showToast } = {}) {
  if (!Array.isArray(tasks)) return;
  if (!notificationsInitialized) {
    for (const task of tasks) {
      if (task?.id) previousTaskStateMap.set(task.id, task.status);
    }
    notificationsInitialized = true;
    return;
  }

  for (const task of tasks) {
    if (!task?.id) continue;
    const prevStatus = previousTaskStateMap.get(task.id);
    const nextStatus = task.status;
    previousTaskStateMap.set(task.id, nextStatus);

    if (!prevStatus || prevStatus === nextStatus) continue;
    const wasActive = prevStatus === "running" || prevStatus === "queued";
    if (!wasActive) continue;

    const codeLabel = task.code ? `${task.code} · ` : "";
    const shortTitle = String(task.title || "Tác vụ").slice(0, 56);
    let notice = "";
    if (nextStatus === "awaiting_approval") {
      notice = view.language === "en"
        ? `Plan ready for approval: ${codeLabel}${shortTitle}`
        : `Kế hoạch chờ bạn duyệt: ${codeLabel}${shortTitle}`;
    } else if (nextStatus === "done" && task.config?.workflow !== "chat-only") {
      notice = view.language === "en"
        ? `Task completed: ${codeLabel}${shortTitle}`
        : `Tác vụ đã hoàn tất: ${codeLabel}${shortTitle}`;
    } else if (nextStatus === "failed") {
      notice = view.language === "en"
        ? `Task failed: ${codeLabel}${shortTitle}`
        : `Tác vụ gặp lỗi: ${codeLabel}${shortTitle}`;
    }

    if (notice) {
      if (typeof showToast === "function") showToast(notice);
      try {
        if (document.hidden && "Notification" in window && Notification.permission === "granted") {
          new Notification("OpenSybau", { body: notice, silent: false });
        }
      } catch {}
    }
  }
}

export async function openGithubCreatePrModal(task, { showModal } = {}) {
  if (!task || typeof showModal !== "function") return;
  const defaultTitle = task.code ? `${task.code}: ${task.title}` : task.title;
  const defaultBody = [
    `## Tóm tắt thay đổi (${task.code || "Task"})`,
    "",
    task.goal ? `**Mục tiêu:** ${task.goal}\n` : "",
    (task.artifacts || []).length ? `### Tệp thay đổi (${task.artifacts.length})\n${task.artifacts.slice(0, 20).map((f) => `- \`${f}\``).join("\n")}` : "",
  ].filter(Boolean).join("\n");

  const body = `
    <p class="form-note">Đẩy nhánh hiện tại lên <code>origin</code> và tạo Pull Request trên GitHub thông qua <code>gh pr create</code>.</p>
    <label>Tiêu đề Pull Request
      <input name="title" required maxlength="200" value="${esc(defaultTitle)}" autocomplete="off">
    </label>
    <div class="modal-grid-2">
      <label>Nhánh đích (Base branch)
        <input name="baseBranch" maxlength="120" placeholder="Mặc định của repo (main / master)" autocomplete="off">
      </label>
      <label class="check-row" style="align-self:end;padding-bottom:6px">
        <input type="checkbox" name="draft">
        <span><strong>Tạo dưới dạng Draft PR</strong></span>
      </label>
    </div>
    <label>Mô tả Pull Request (Markdown)
      <textarea name="body" rows="6" maxlength="16000">${esc(defaultBody)}</textarea>
    </label>
  `;
  showModal("Tạo GitHub Pull Request", body, "Đẩy nhánh & Tạo PR", "github-create-pr");
  const modal = $("#overlay .modal");
  if (modal) modal.dataset.id = task.id;
}

export async function openGithubIssuesModal(workspaceId, { api, showModal } = {}) {
  if (!workspaceId || typeof api !== "function" || typeof showModal !== "function") return;
  showModal("GitHub Issues & Pull Requests", `<p class="form-note">Đang kiểm tra <code>gh</code> CLI và tải danh sách Issues / PRs…</p>`, "Đóng", "dismiss");
  const data = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/github`).catch((err) => ({ available: false, reason: err.message, issues: [], pulls: [] }));
  if (!data.available) {
    const body = `<div class="empty-state">
      <strong>Chưa kết nối GitHub CLI (gh)</strong>
      <p>${esc(data.reason || "Hãy cài đặt GitHub CLI (gh) và chạy gh auth login trong thư mục repository.")}</p>
    </div>`;
    showModal("GitHub Issues & Pull Requests", body, "Đóng", "dismiss");
    return;
  }
  const issues = data.issues || [];
  const pulls = data.pulls || [];
  const issuesHtml = issues.length
    ? `<ul class="orca-tree-list">${issues.map((iss) => `<li class="orca-tree-item is-file" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px">
        <div style="min-width:0;flex:1">
          <strong>#${esc(String(iss.number))} · ${esc(iss.title)}</strong>
          ${(iss.labels || []).length ? `<small style="display:block;opacity:.75">${iss.labels.map((l) => esc(l.name || "")).filter(Boolean).join(", ")}</small>` : ""}
        </div>
        <button type="button" class="button primary small" data-action="import-github-issue" data-workspace-id="${esc(workspaceId)}" data-issue-number="${esc(String(iss.number))}" data-issue-title="${esc(iss.title)}" data-issue-url="${esc(iss.url || "")}">${icon("plus", 12)}<span>Giao Agent</span></button>
      </li>`).join("")}</ul>`
    : `<p class="orca-muted-note">Không có Issue nào đang mở.</p>`;

  const pullsHtml = pulls.length
    ? `<ul class="orca-tree-list">${pulls.map((pr) => `<li class="orca-tree-item is-file" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px">
        <div style="min-width:0;flex:1">
          <strong>PR #${esc(String(pr.number))} · ${esc(pr.title)}</strong>
          <small style="display:block;opacity:.75"><code>${esc(pr.headRefName || "")}</code>${pr.isDraft ? " · Draft" : ""}</small>
        </div>
        ${pr.url ? `<a class="button quiet small" href="${esc(pr.url)}" target="_blank" rel="noreferrer">${icon("arrow-up-right", 12)}<span>Mở</span></a>` : ""}
      </li>`).join("")}</ul>`
    : `<p class="orca-muted-note">Không có Pull Request nào đang mở.</p>`;

  const body = `<div class="github-modal-content">
    <div class="orca-section-label">ISSUES ĐANG MỞ (${issues.length})</div>
    ${issuesHtml}
    <div class="orca-section-label" style="margin-top:14px">PULL REQUESTS ĐANG MỞ (${pulls.length})</div>
    ${pullsHtml}
  </div>`;
  showModal("GitHub Issues & Pull Requests", body, "Đóng", "dismiss");
}
