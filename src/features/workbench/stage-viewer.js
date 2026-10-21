import { esc, icon, view } from "../../shared/state.js";
import { resolveRemoteUrl } from "../../shared/remote-host.js";
import { formatCompactBytes, renderCsvTableMarkup, renderMarkdown } from "./markdown.js";
import { renderHtmlElementCommentPopoverMarkup } from "./html-inspector.js";

let cachedDockTreePaths = null;
let cachedDockTreeKey = "";
let cachedDockTreeRoot = null;

export function sortDockTreeNode(node) {
  node.foldersList = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  node.files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  for (const child of node.foldersList) sortDockTreeNode(child);
}

export function buildDockFileTree(paths = []) {
  const key = `${paths.length}:${paths[0] || ""}:${paths[paths.length - 1] || ""}`;
  if (paths === cachedDockTreePaths && key === cachedDockTreeKey && cachedDockTreeRoot) {
    return cachedDockTreeRoot;
  }
  const root = { folders: new Map(), foldersList: [], files: [] };
  for (const rawPath of paths) {
    const norm = String(rawPath || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    if (!norm) continue;
    const parts = norm.split("/");
    let curr = root;
    let accum = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      accum = accum ? `${accum}/${seg}` : seg;
      if (!curr.folders.has(seg)) {
        curr.folders.set(seg, { name: seg, path: accum, folders: new Map(), foldersList: [], files: [] });
      }
      curr = curr.folders.get(seg);
    }
    const fileName = parts[parts.length - 1];
    curr.files.push({ name: fileName, path: norm });
  }
  sortDockTreeNode(root);
  cachedDockTreePaths = paths;
  cachedDockTreeKey = key;
  cachedDockTreeRoot = root;
  return root;
}

export function dockFileIconName(fileName = "") {
  const lower = String(fileName || "").toLowerCase();
  const ext = lower.includes(".") ? `.${lower.split(".").at(-1)}` : "";
  if (ext === ".html" || ext === ".htm") return "globe";
  if (ext === ".pdf" || ext === ".md" || ext === ".mdx" || ext === ".markdown") return "book-open-text";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp"].includes(ext)) return "image";
  if ([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".cs", ".css", ".scss", ".json", ".sql", ".sh", ".ps1"].includes(ext)) return "code-2";
  return "file-text";
}

export function defaultFileTabMode(ext = "", preferredMode = "") {
  if (["preview", "code", "edit"].includes(preferredMode)) return preferredMode;
  const lower = String(ext || "").toLowerCase();
  if ([".html", ".htm", ".pdf", ".md", ".mdx", ".markdown", ".docx", ".doc", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp", ".mp4", ".webm", ".mp3", ".wav", ".csv", ".tsv", ".json"].includes(lower)) {
    return "preview";
  }
  return "code";
}

export function canRichPreviewExtension(ext = "", kind = "text") {
  if (kind && kind !== "text") return true;
  const lower = String(ext || "").toLowerCase();
  return [".html", ".htm", ".pdf", ".md", ".mdx", ".markdown", ".docx", ".doc", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp", ".mp4", ".webm", ".mp3", ".wav", ".csv", ".tsv", ".json"].includes(lower);
}

export function canEditWorkspaceTab(tab) {
  if (!tab || tab.kind === "live-url" || tab.kind === "stage-doc") return false;
  if (!tab.workspaceId || !tab.path) return false;
  const file = tab.fileData;
  const kind = file?.kind || "text";
  if (kind !== "text") return false;
  const ext = (file?.extension || tab.ext || "").toLowerCase();
  if ([".docx", ".doc", ".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp", ".mp4", ".webm", ".mp3", ".wav"].includes(ext)) return false;
  const baseName = String(tab.path).split("/").at(-1) || "";
  if (/^\.env(?:\.|$)/i.test(baseName)) return false;
  return true;
}

export function renderStageFileViewer(tab, { formatEffortLabel } = {}) {
  if (!tab) return "";
  const isLiveUrl = tab.kind === "live-url" && Boolean(tab.liveUrl);
  const file = tab.fileData;
  const ext = (file?.extension || tab.ext || "").toLowerCase();
  const kind = isLiveUrl ? "live-url" : (file?.kind || "text");
  const hasRichPreview = isLiveUrl || canRichPreviewExtension(ext, kind);
  const hasCodeView = !isLiveUrl && kind === "text";
  const hasEditView = canEditWorkspaceTab(tab);
  let mode = ["code", "preview", "edit"].includes(tab.mode) ? tab.mode : defaultFileTabMode(ext);
  if (mode === "edit" && !hasEditView) mode = hasCodeView ? "code" : "preview";
  if (mode === "preview" && !hasRichPreview) mode = "code";
  if (mode === "code" && !hasCodeView) mode = "preview";

  const isWebBrowser = isLiveUrl || ((ext === ".html" || ext === ".htm") && mode === "preview");
  const rawUrl = isLiveUrl
    ? `${tab.liveUrl}${tab.liveUrl.includes("?") ? "&" : "?"}_t=${tab.loadedAt || 0}`
    : resolveRemoteUrl(`/api/workspaces/${encodeURIComponent(tab.workspaceId)}/raw/${tab.path.split("/").map(encodeURIComponent).join("/")}?${tab.taskId ? `taskId=${encodeURIComponent(tab.taskId)}&` : ""}t=${tab.loadedAt || 0}`);
  const sizeBadge = file?.size !== undefined ? formatCompactBytes(file.size) : "";
  const totalLines = hasCodeView && file?.content ? String(file.content).split(/\r?\n/).length : 0;

  let bodyHtml = "";
  if (tab.loading && !file) {
    bodyHtml = `<div class="orca-viewer-empty">
      <span>${icon("refresh-cw", 18)}</span>
      <strong>Đang tải ${esc(tab.name)}…</strong>
      <small>${esc(tab.path)}</small>
    </div>`;
  } else if (tab.error) {
    bodyHtml = `<div class="orca-viewer-empty is-error">
      <strong>Không thể đọc tệp ${esc(tab.name)}</strong>
      <p>${esc(tab.error)}</p>
      <div class="orca-viewer-empty-actions">
        <button type="button" class="button quiet small" data-action="reload-stage-tab" data-tab-id="${esc(tab.id)}">${icon("refresh-cw", 13)}<span>Thử lại</span></button>
      </div>
    </div>`;
  } else if (mode === "edit") {
    const draftContent = tab.editDraft !== undefined ? tab.editDraft : (file?.content ?? "");
    bodyHtml = `<div class="vault-editor-wrap kb-editor-wrap orca-stage-editor-wrap">
      <textarea class="vault-editor-textarea orca-stage-editor" data-stage-file-editor data-tab-id="${esc(tab.id)}" spellcheck="false" placeholder="Chỉnh sửa nội dung tệp ${esc(tab.path)}…">${esc(draftContent)}</textarea>
      <div class="vault-editor-foot">
        <small>Đang chỉnh sửa trực tiếp <code>${esc(tab.path)}</code> · Nhấn <code>Ctrl+S</code> để lưu nhanh.</small>
        <div class="kb-editor-foot-actions">
          <button type="button" class="button quiet small" data-action="cancel-stage-file-edit" data-tab-id="${esc(tab.id)}">Hủy</button>
          <button type="button" class="button primary small" data-action="save-stage-file" data-tab-id="${esc(tab.id)}">${icon("check", 13)}<span>Lưu tệp</span></button>
        </div>
      </div>
    </div>`;
  } else if (mode === "preview") {
    if (isLiveUrl || ext === ".html" || ext === ".htm") {
      const hasPopover = Boolean(view.stageHtmlInspectActive && view.stageHtmlSelectedElement);
      bodyHtml = `<div class="orca-live-frame-wrap">
        <iframe class="orca-live-frame" src="${esc(rawUrl)}" title="Xem trực tiếp ${esc(tab.name)}" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"></iframe>
        <div class="orca-element-comment-layer" data-html-comment-layer ${hasPopover ? "" : "hidden"}>
          ${hasPopover ? renderHtmlElementCommentPopoverMarkup({ formatEffortLabel }) : ""}
        </div>
      </div>`;
    } else if (ext === ".pdf" || kind === "pdf") {
      bodyHtml = `<div class="orca-live-frame-wrap is-pdf">
        <iframe class="orca-live-frame is-pdf" src="${esc(rawUrl)}#toolbar=1&navpanes=1&view=FitH" title="Tài liệu PDF ${esc(tab.name)}"></iframe>
      </div>`;
    } else if (kind === "image" || [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp"].includes(ext)) {
      bodyHtml = `<div class="orca-media-stage is-image">
        <div class="orca-image-canvas">
          <img class="orca-image-preview" src="${esc(rawUrl)}" alt="${esc(tab.name)}" />
        </div>
      </div>`;
    } else if (kind === "media" || [".mp4", ".webm", ".mp3", ".wav"].includes(ext)) {
      const isAudio = ext === ".mp3" || ext === ".wav";
      bodyHtml = `<div class="orca-media-stage">
        ${isAudio
          ? `<audio controls src="${esc(rawUrl)}" class="orca-audio-player"></audio>`
          : `<video controls src="${esc(rawUrl)}" class="orca-video-player"></video>`}
        <div class="orca-media-caption">
          <strong>${esc(tab.name)}</strong>
          <small>${esc(tab.path)}${sizeBadge ? ` · ${esc(sizeBadge)}` : ""}</small>
        </div>
      </div>`;
    } else if ([".md", ".mdx", ".markdown", ".docx", ".doc"].includes(ext)) {
      bodyHtml = `<div class="orca-doc-scroll">
        <article class="markdown-preview orca-markdown-doc">${renderMarkdown(file?.content || "")}</article>
      </div>`;
    } else if (ext === ".csv" || ext === ".tsv") {
      bodyHtml = renderCsvTableMarkup(file?.content || "", ext === ".tsv" ? "\t" : ",");
    } else if (ext === ".json") {
      let formattedJson = file?.content || "";
      try {
        formattedJson = JSON.stringify(JSON.parse(formattedJson), null, 2);
      } catch {}
      const lines = formattedJson.split(/\r?\n/);
      bodyHtml = `<div class="orca-code-scroll">
        <div class="orca-code-lines">
          ${lines.map((line, idx) => `<div class="orca-code-row"><span class="orca-code-ln">${idx + 1}</span><code class="orca-code-text">${esc(line)}</code></div>`).join("")}
        </div>
      </div>`;
    }
  } else {
    const lines = String(file?.content || "").split(/\r?\n/);
    const commentTarget = view.stageLineCommentTarget;
    bodyHtml = `<div class="orca-code-scroll">
      <div class="orca-code-lines">
        ${lines.map((line, idx) => {
          const lineNum = idx + 1;
          const lineKey = `code:${tab.id}:${lineNum}`;
          const isCommenting = commentTarget?.key === lineKey;
          return `<div class="orca-code-row ${isCommenting ? "is-commenting" : ""}" data-action="open-stage-line-comment" data-key="${esc(lineKey)}" data-path="${esc(tab.path)}" data-line="${lineNum}" data-code="${esc(line)}">
            <span class="orca-code-ln">${lineNum}</span>
            <code class="orca-code-text">${esc(line)}</code>
            <span class="diff-comment-trigger">+ Nhận xét</span>
          </div>
          ${isCommenting ? `<div class="diff-comment-editor">
            <input type="text" data-stage-line-comment-input placeholder="Nhập yêu cầu cho Agent tại dòng ${lineNum} của ${esc(tab.name)}…" autocomplete="off">
            <button type="button" class="button primary small" data-action="send-stage-line-comment">${icon("arrow-up-right", 12)}<span>Gửi</span></button>
            <button type="button" class="button quiet small" data-action="cancel-stage-line-comment">Hủy</button>
          </div>` : ""}`;
        }).join("")}
      </div>
    </div>`;
  }

  const metaParts = [];
  if (totalLines > 0) metaParts.push(`${totalLines} dòng`);
  if (sizeBadge) metaParts.push(esc(sizeBadge));

  const leftToolbarMarkup = isWebBrowser
    ? `<div class="orca-viewer-nav is-web-browser">
        <button type="button" class="icon-button orca-viewer-icon" data-action="activate-stage-tab" data-tab-id="chat" title="Quay về cửa sổ Chat">${icon("arrow-left", 13)}</button>
        <button type="button" class="icon-button orca-viewer-icon" data-action="reload-stage-tab" data-tab-id="${esc(tab.id)}" title="Tải lại trang web">${icon("refresh-cw", 12)}</button>
        <div class="orca-viewer-address is-url-bar" title="${esc(tab.path)}">
          ${icon("globe", 12)}
          <span class="orca-address-host">localhost</span>
          <span class="orca-address-path">/${esc(tab.path)}</span>
        </div>
      </div>`
    : `<div class="orca-viewer-file-meta" title="${esc(tab.path)}">
        <span class="orca-meta-path">${esc(tab.path)}</span>
        ${metaParts.length ? `<small class="orca-meta-sub">${metaParts.join(" · ")}</small>` : ""}
      </div>`;

  const showModeSwitch = (hasRichPreview && hasCodeView) || hasEditView;
  const previewModeLabel = view.language === "en" ? "Preview" : "Xem trước";
  const codeModeLabel = view.language === "en" ? "Source code" : "Mã nguồn";
  const editModeLabel = view.language === "en" ? "Edit file" : "Chỉnh sửa tệp";

  return `<section class="orca-file-viewer" aria-label="Trình xem tệp ${esc(tab.name)}">
    <header class="orca-viewer-toolbar">
      ${leftToolbarMarkup}
      <div class="orca-viewer-actions">
        ${isWebBrowser ? `
          <button type="button" class="icon-button orca-viewer-icon orca-inspect-comment-btn ${view.stageHtmlInspectActive ? "is-active" : ""}" data-action="toggle-html-inspect" title="Nhấp vào phần tử để gửi nhận xét cho Agent">${icon("message-square-plus", 13)}</button>
        ` : ""}
        ${mode === "edit" ? `
          <button type="button" class="button quiet small" data-action="cancel-stage-file-edit" data-tab-id="${esc(tab.id)}">Hủy</button>
          <button type="button" class="button primary small" data-action="save-stage-file" data-tab-id="${esc(tab.id)}">${icon("check", 12)}<span>Lưu tệp</span></button>
        ` : ""}
        ${showModeSwitch ? `<div class="orca-mode-switch" role="tablist" aria-label="Chế độ xem tệp">
          ${hasRichPreview ? `<button type="button" role="tab" aria-selected="${mode === "preview"}" class="orca-mode-btn ${mode === "preview" ? "is-active" : ""}" data-action="stage-tab-mode" data-tab-id="${esc(tab.id)}" data-mode="preview" aria-label="${previewModeLabel}" title="${previewModeLabel}">${icon("eye", 15)}</button>` : ""}
          ${hasCodeView ? `<button type="button" role="tab" aria-selected="${mode === "code"}" class="orca-mode-btn ${mode === "code" ? "is-active" : ""}" data-action="stage-tab-mode" data-tab-id="${esc(tab.id)}" data-mode="code" aria-label="${codeModeLabel}" title="${codeModeLabel}">${icon("code-2", 15)}</button>` : ""}
          ${hasEditView ? `<button type="button" role="tab" aria-selected="${mode === "edit"}" class="orca-mode-btn ${mode === "edit" ? "is-active" : ""}" data-action="stage-tab-mode" data-tab-id="${esc(tab.id)}" data-mode="edit" aria-label="${editModeLabel}" title="${editModeLabel}">${icon("square-pen", 14)}</button>` : ""}
        </div>` : ""}
      </div>
    </header>
    ${isWebBrowser ? `<div class="orca-inspect-banner" data-html-inspect-banner ${view.stageHtmlInspectActive ? "" : "hidden"}>
      <span class="orca-inspect-banner-text" data-html-inspect-banner-text>Nhấp vào một phần tử trên trang để thêm nhận xét cho Agent.</span>
      <div class="orca-inspect-banner-right">
        <button type="button" class="orca-inspect-banner-close" data-action="close-html-inspect" title="Thoát chế độ chọn phần tử (Esc)">Esc</button>
      </div>
    </div>` : ""}
    <div class="orca-viewer-body">
      ${bodyHtml}
    </div>
  </section>`;
}

export function wrapStageWithOrcaTabs(primaryMarkup, { formatEffortLabel } = {}) {
  const tabs = view.stageTabs || [];
  if (!tabs.length || !["chat", "workspaces"].includes(view.page)) return primaryMarkup;
  const activeTab = tabs.find((t) => t.id === view.activeStageTabId) || (view.stageSplit ? tabs[tabs.length - 1] : null);
  if (view.stageSplit && activeTab) {
    return `<div class="orca-stage-split-layout">
      <div class="orca-stage-pane is-primary">${primaryMarkup}</div>
      <div class="orca-stage-split-resizer" data-stage-split-resizer title="Kéo để thay đổi tỷ lệ giữa Chat và Trình xem tệp"></div>
      <div class="orca-stage-pane is-viewer">${renderStageFileViewer(activeTab, { formatEffortLabel })}</div>
    </div>`;
  }
  if (view.activeStageTabId !== "chat" && activeTab) {
    return renderStageFileViewer(activeTab, { formatEffortLabel });
  }
  return primaryMarkup;
}

export function renderDockTreeLevel(node, depth, { collapsedSet, activePath, fileAction, workspaceId = "", taskId = "", showMention = false, showVaultMenu = false, vaultNoteOptionsMenu }) {
  const folders = node.foldersList || [...node.folders.values()];
  const files = node.files;
  let html = "";
  const padLeft = 10 + depth * 14;
  for (const folder of folders) {
    const isCollapsed = collapsedSet.has(folder.path);
    html += `<li class="orca-tree-item is-folder">
      <button type="button" class="orca-tree-row" style="padding-left:${padLeft}px" data-action="toggle-dock-folder" data-folder="${esc(folder.path)}" title="${esc(folder.path)}">
        <span class="orca-tree-caret ${isCollapsed ? "" : "is-open"}">${icon("chevron-right", 12)}</span>
        <span class="orca-tree-icon">${icon("folder", 14)}</span>
        <span class="orca-tree-label">${esc(folder.name)}</span>
      </button>
    </li>`;
    if (!isCollapsed) {
      html += renderDockTreeLevel(folder, depth + 1, { collapsedSet, activePath, fileAction, workspaceId, taskId, showMention, showVaultMenu, vaultNoteOptionsMenu });
    }
  }
  for (const file of files) {
    const isSelected = activePath && activePath === file.path;
    const fIcon = showVaultMenu ? "file-text" : dockFileIconName(file.name);
    html += `<li class="orca-tree-item is-file ${isSelected ? "is-selected" : ""}">
      <button type="button" class="orca-tree-row ${isSelected ? "is-selected" : ""}" style="padding-left:${padLeft + 16}px" data-action="${esc(fileAction)}" ${workspaceId ? `data-workspace-id="${esc(workspaceId)}"` : ""} ${taskId ? `data-id="${esc(taskId)}"` : ""} data-path="${esc(file.path)}" title="${esc(file.path)}">
        <span class="orca-tree-icon">${icon(fIcon, 14)}</span>
        <span class="orca-tree-label">${esc(file.name)}</span>
      </button>
      ${showMention ? `<button type="button" class="orca-tree-quick" data-action="mention-drawer-file" data-path="${esc(file.path)}" title="Chèn @${esc(file.path)} vào khung chat">@</button>` : ""}
      ${showVaultMenu && typeof vaultNoteOptionsMenu === "function" ? vaultNoteOptionsMenu(file.path, { showRead: view.vaultViewMode === "graph", showGraph: view.vaultViewMode !== "graph", direction: "down" }) : ""}
    </li>`;
  }
  return html;
}
