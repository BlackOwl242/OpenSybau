import { $, esc, formatNumber, icon, statuses, tokenCount, view } from "../../shared/state.js";
import { providerTitle } from "../../domain/agent-roles.js";
import { renderMarkdown } from "./markdown.js";

export function renderDiffStudioModal({ showModal } = {}) {
  const data = view.diffStudioData;
  if (!data || typeof showModal !== "function") return;
  const prevHunkScroll = document.querySelector("#overlay .diff-hunk-list")?.scrollTop || 0;
  const prevFileScroll = document.querySelector("#overlay .diff-file-list")?.scrollTop || 0;
  const taskId = view.diffStudioTaskId || view.selected || "";
  const files = data.files || [];
  const annotations = view.diffAnnotations?.[taskId] || [];
  const annotationMap = new Map();
  const fileCommentCounts = new Map();
  for (const ann of annotations) {
    const p = ann.path || "";
    fileCommentCounts.set(p, (fileCommentCounts.get(p) || 0) + 1);
    const sideKey = `${p}::${ann.side || "any"}::${ann.line}`;
    const list = annotationMap.get(sideKey);
    if (list) list.push(ann);
    else annotationMap.set(sideKey, [ann]);
  }
  const totalAdd = files.reduce((sum, f) => sum + (f.additions || 0), 0);
  const totalDel = files.reduce((sum, f) => sum + (f.deletions || 0), 0);
  const selectedFile = files.find((f) => f.path === view.diffSelectedFile) || files[0] || null;
  if (selectedFile && view.diffSelectedFile !== selectedFile.path) view.diffSelectedFile = selectedFile.path;
  const wt = data.worktree;
  const canApplyWt = Boolean(wt && !wt.cleaned && !wt.appliedAt && files.length > 0 && taskId);
  const canDiscardWt = Boolean(wt && !wt.cleaned && !wt.appliedAt && taskId);

  const toolbarHtml = `<div class="diff-studio-toolbar">
    <div class="diff-location">
      <small>${wt ? `WORKTREE · ${esc(wt.branch || "isolated")}` : "THƯ MỤC"}</small>
      <code>${esc(data.path || "")}</code>
      ${files.length ? `<span class="diff-totals"><em class="is-add">+${totalAdd}</em><em class="is-del">-${totalDel}</em> · ${files.length} tệp</span>` : ""}
    </div>
    <div class="diff-studio-actions">
      ${wt?.appliedAt ? `<span class="chat-worktree-chip is-merged">${icon("check", 12)} Đã gộp vào nhánh chính</span>` : ""}
      ${canApplyWt ? `<button type="button" class="button primary small" data-action="apply-worktree" data-id="${esc(taskId)}">${icon("check", 13)}<span>Gộp Worktree vào dự án</span></button>` : ""}
      ${canDiscardWt ? `<button type="button" class="button quiet small" data-action="discard-worktree" data-id="${esc(taskId)}">${icon("delete", 13)}<span>Hủy Worktree</span></button>` : ""}
    </div>
  </div>`;

  let contentHtml = "";
  if (!files.length) {
    const rawDiff = String(data.diff || "Không có thay đổi được Git theo dõi.");
    const formattedLines = rawDiff.split(/\r?\n/).map((line) => {
      const cls = line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ") ? "diff-line diff-line-meta" : line.startsWith("@@") ? "diff-line diff-line-hunk" : line.startsWith("+") ? "diff-line diff-line-add" : line.startsWith("-") ? "diff-line diff-line-del" : "diff-line";
      return `<span class="${cls}">${esc(line) || " "}</span>`;
    }).join("\n");
    contentHtml = data.diff ? `<pre class="diff-content">${formattedLines}</pre>` : `<p class="diff-empty-state">Không có thay đổi được Git theo dõi.</p>`;
  } else {
    const sidebarHtml = files.map((file) => {
      const fileComments = fileCommentCounts.get(file.path) || 0;
      const statusChar = file.status === "added" ? "A" : file.status === "deleted" ? "D" : file.status === "renamed" ? "R" : "M";
      return `<button type="button" class="diff-file-item ${file.path === selectedFile?.path ? "is-active" : ""}" data-action="select-diff-file" data-path="${esc(file.path)}" title="${esc(file.path)}">
        <span class="diff-file-status is-${esc(file.status || "modified")}">${statusChar}</span>
        <span class="diff-file-name">${esc(file.path)}</span>
        ${fileComments ? `<span class="diff-file-comment-count">${fileComments}</span>` : ""}
        <span class="diff-file-stats"><em class="is-add">+${file.additions}</em><em class="is-del">-${file.deletions}</em></span>
      </button>`;
    }).join("");

    const hunksHtml = (selectedFile?.hunks || []).map((hunk) => {
      const linesHtml = (hunk.lines || []).map((line, idx) => {
        const lineNo = line.newLine ?? line.oldLine ?? (idx + 1);
        const side = line.type === "del" ? "old" : "new";
        const lineKey = `${selectedFile.path}:${lineNo}:${line.type}`;
        const lineAnns = annotationMap.get(`${selectedFile.path}::${side}::${lineNo}`) || annotationMap.get(`${selectedFile.path}::any::${lineNo}`) || [];
        const isEditing = view.diffAnnotationTarget && view.diffAnnotationTarget.key === lineKey;
        const cls = line.type === "add" ? "diff-row-add" : line.type === "del" ? "diff-row-del" : "diff-row-ctx";
        const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
        return `<div class="diff-row-group">
          <div class="diff-row ${cls} diff-line-annotatable" data-action="open-diff-comment" data-key="${esc(lineKey)}" data-path="${esc(selectedFile.path)}" data-side="${side}" data-line="${esc(lineNo)}" data-code="${esc(line.text)}" title="Nhấn để thêm nhận xét review tại dòng ${lineNo}">
            <span class="diff-ln">${line.oldLine ?? ""}</span>
            <span class="diff-ln">${line.newLine ?? ""}</span>
            <span class="diff-sign">${prefix}<i class="diff-add-comment-icon">+</i></span>
            <code class="diff-code">${esc(line.text) || " "}</code>
          </div>
          ${lineAnns.map((ann) => `<div class="diff-inline-annotation">
            <div class="diff-annotation-head"><strong>Nhận xét dòng ${esc(ann.line)}</strong><button type="button" class="icon-button" data-action="remove-diff-comment" data-comment-id="${esc(ann.id)}" title="Xóa nhận xét">${icon("x", 13)}</button></div>
            <p>${esc(ann.comment)}</p>
          </div>`).join("")}
          ${isEditing ? `<div class="diff-inline-editor">
            <textarea data-diff-comment-input rows="2" placeholder="Nhập yêu cầu chỉnh sửa hoặc nhận xét cho dòng ${lineNo}…"></textarea>
            <div class="diff-inline-editor-actions">
              <button type="button" class="button quiet small" data-action="cancel-diff-comment">Hủy</button>
              <button type="button" class="button primary small" data-action="save-diff-comment">Lưu nhận xét</button>
            </div>
          </div>` : ""}
        </div>`;
      }).join("");
      return `<div class="diff-hunk-block"><div class="diff-hunk-header">${esc(hunk.header)}</div>${linesHtml}</div>`;
    }).join("");

    contentHtml = `<div class="diff-studio-layout">
      <aside class="diff-file-list" aria-label="Danh sách tệp thay đổi">${sidebarHtml}</aside>
      <section class="diff-viewer-pane">
        <header class="diff-viewer-head">
          <strong>${esc(selectedFile?.path || "")}</strong>
          <small>Nhấn vào dòng bất kỳ để gắn nhận xét cho Agent sửa</small>
        </header>
        <div class="diff-hunk-list">${hunksHtml || `<p class="diff-empty-file">Tệp nhị phân hoặc không có dòng thay đổi văn bản.</p>`}</div>
      </section>
    </div>`;
  }

  const body = `${toolbarHtml}${contentHtml}`;
  showModal("Diff Review Studio", body, "Đóng", "dismiss");
  const modal = $("#overlay .modal");
  modal?.classList.add("diff-studio-modal");
  modal?.classList.toggle("is-empty", !files.length && !data.diff);
  if (annotations.length && taskId) {
    const footer = $("#overlay .modal-actions");
    footer?.insertAdjacentHTML("afterbegin", `<button type="button" class="button primary" data-action="submit-diff-review" data-id="${esc(taskId)}">${icon("arrow-up-right", 14)} Gửi ${annotations.length} nhận xét cho Agent sửa</button>`);
  }
  const nextHunkList = document.querySelector("#overlay .diff-hunk-list");
  if (nextHunkList && prevHunkScroll) nextHunkList.scrollTop = prevHunkScroll;
  const nextFileList = document.querySelector("#overlay .diff-file-list");
  if (nextFileList && prevFileScroll) nextFileList.scrollTop = prevFileScroll;
  $("[data-diff-comment-input]")?.focus();
}

export function showDiffModal(data, taskId = view.selected, preferredFile = "", { showModal } = {}) {
  view.diffStudioData = data;
  view.diffStudioTaskId = taskId || view.selected || "";
  const files = data?.files || [];
  view.diffSelectedFile = preferredFile && files.some((f) => f.path === preferredFile) ? preferredFile : (files[0]?.path || "");
  view.diffAnnotationTarget = null;
  renderDiffStudioModal({ showModal });
}

export async function openArenaCompareModal(fanoutId, { api, showModal } = {}) {
  const siblings = (view.state?.tasks || []).filter((item) => item.fanoutId === fanoutId && !item.archived);
  if (!siblings.length || typeof showModal !== "function" || typeof api !== "function") return;
  showModal("Đa luồng Agent · Đang tải Diff…", `<p class="form-note">Đang thu thập kết quả và diff từ ${siblings.length} Git worktree…</p>`, "Đóng", "dismiss");
  const diffs = await Promise.all(siblings.map((t) => api(`/api/tasks/${encodeURIComponent(t.id)}/diff`).catch(() => ({ files: [], diff: "" }))));
  const cardsHtml = siblings.map((item, idx) => {
    const diffData = diffs[idx] || { files: [] };
    const files = diffData.files || [];
    const adds = files.reduce((s, f) => s + (f.additions || 0), 0);
    const dels = files.reduce((s, f) => s + (f.deletions || 0), 0);
    const modelName = item.fanoutCompetitor?.model || item.config?.roles?.build?.model || item.config?.chatModel || "";
    const rawName = item.fanoutCompetitor?.name || providerTitle(view.connectors, item.config?.roles?.build?.provider || item.config?.chatProvider || "codex");
    const compName = modelName && rawName.endsWith(` (${modelName})`) ? rawName.slice(0, -modelName.length - 3) : rawName;
    const tok = Object.values(item.usage || {}).reduce((s, u) => s + tokenCount(u), 0);
    const summaryText = String(item.implementation || item.review || item.plan || item.chatMessages?.filter((m) => m.role === "assistant").at(-1)?.content || "").slice(0, 800);
    const emptySummary = item.status === "failed" ? "Lượt chạy thất bại. Mở chat để xem nguyên nhân." : ["running", "queued"].includes(item.status) ? "Agent đang xử lý, kết quả sẽ xuất hiện khi hoàn tất." : "Chưa có nội dung trả lời.";
    const canPick = Boolean(item.isolated && !["running", "queued"].includes(item.status) && !item.worktreeCleaned && !item.worktreeAppliedAt && files.length > 0);
    return `<article class="arena-compare-card ${item.worktreeAppliedAt ? "is-winner" : ""}">
      <header>
        <div class="arena-compare-identity"><h3>${esc(compName)}</h3>${modelName && modelName !== compName ? `<p>${esc(modelName)}</p>` : ""}</div>
        <span class="arena-compare-status is-${esc(item.status)}"><i class="wb-task-dot is-${esc(item.status)}"></i>${esc(statuses[item.status] || item.status)}</span>
      </header>
      <dl class="arena-compare-stats"><div><dt>Tệp thay đổi</dt><dd>${formatNumber(files.length)}</dd></div><div><dt>Thêm / xoá</dt><dd><span class="is-add">+${formatNumber(adds)}</span> / <span class="is-del">−${formatNumber(dels)}</span></dd></div><div><dt>Token</dt><dd>${formatNumber(tok)}</dd></div></dl>
      <div class="arena-compare-excerpt ${summaryText ? "" : "is-empty"}">${summaryText ? renderMarkdown(summaryText) : `<p>${esc(emptySummary)}</p>`}</div>
      ${files.length ? `<ul class="arena-compare-files">${files.slice(0, 8).map((f) => `<li><code>${esc(f.path)}</code><span>+${f.additions} / −${f.deletions}</span></li>`).join("")}</ul>` : ""}
      <footer>
        <button type="button" class="button quiet small" data-action="show-diff" data-id="${esc(item.id)}">${icon("file", 13)} Xem Diff</button>
        <button type="button" class="button quiet small" data-task="${esc(item.id)}">Mở Chat</button>
        ${item.worktreeAppliedAt ? `<span class="arena-compare-merged">${icon("check", 12)} Đã gộp vào dự án</span>` : canPick ? `<button type="button" class="button primary small" data-action="pick-arena-winner" data-id="${esc(item.id)}">${icon("check", 13)} Chọn & Gộp vào dự án</button>` : ""}
      </footer>
    </article>`;
  }).join("");
  showModal("So sánh các nhánh song song", `<div class="arena-compare-grid">${cardsHtml}</div>`, "Đóng", "dismiss");
  $("#overlay .modal")?.classList.add("arena-compare-modal");
}
