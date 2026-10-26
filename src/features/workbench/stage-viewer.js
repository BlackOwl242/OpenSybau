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

export function buildDockFileTree(paths = [], { useCache = true } = {}) {
  const key = `${paths.length}:${paths[0] || ""}:${paths[paths.length - 1] || ""}`;
  if (useCache && paths === cachedDockTreePaths && key === cachedDockTreeKey && cachedDockTreeRoot) {
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
  if (useCache) {
    cachedDockTreePaths = paths;
    cachedDockTreeKey = key;
    cachedDockTreeRoot = root;
  }
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
  if (!tab || tab.kind === "live-url" || tab.kind === "stage-doc" || tab.kind === "all-changes") return false;
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

export function highlightSourceLine(rawLine = "", ext = "") {
  const line = String(rawLine ?? "");
  if (!line) return " ";
  const lowerExt = String(ext || "").toLowerCase();
  if ([".md", ".mdx", ".markdown"].includes(lowerExt)) {
    if (/^\s*#{1,6}\s+/.test(line)) {
      return `<span class="syn-md-heading">${esc(line)}</span>`;
    }
    let html = esc(line);
    html = html.replace(/^(\s*(?:[-*+]|\d+\.)\s)/, '<span class="syn-md-list">$1</span>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<span class="syn-md-bold">**$1**</span>');
    html = html.replace(/`([^`]+)`/g, '<span class="syn-md-code">`$1`</span>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<span class="syn-md-link">[$1]</span><span class="syn-md-url">($2)</span>');
    return html;
  }
  return esc(line);
}

export function buildFullFileDiffModel(newContent = "", diffText = "") {
  const newLines = String(newContent ?? "").split(/\r?\n/);
  const rawDiff = String(diffText ?? "");
  if (!rawDiff.trim()) {
    const unified = newLines.map((text, idx) => ({
      type: "ctx",
      oldLn: idx + 1,
      newLn: idx + 1,
      text,
      changeIdx: -1,
    }));
    const split = newLines.map((text, idx) => ({
      changeIdx: -1,
      left: { type: "ctx", ln: idx + 1, text },
      right: { type: "ctx", ln: idx + 1, text },
    }));
    return { unified, split, changeBlocks: [] };
  }

  const diffLines = rawDiff.split(/\r?\n/);
  const hunks = [];
  let currentHunk = null;
  for (const dLine of diffLines) {
    const m = dLine.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
    if (m) {
      currentHunk = {
        oldStart: Number(m[1]),
        oldCount: m[2] !== undefined ? Number(m[2]) : 1,
        newStart: Number(m[3]),
        newCount: m[4] !== undefined ? Number(m[4]) : 1,
        lines: [],
      };
      hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk) continue;
    if (dLine.startsWith("\\ No newline")) continue;
    const prefix = dLine[0];
    if (prefix === "+" || prefix === "-" || prefix === " ") {
      currentHunk.lines.push({ prefix, text: dLine.slice(1) });
    }
  }

  if (!hunks.length) {
    const unified = newLines.map((text, idx) => ({
      type: "ctx",
      oldLn: idx + 1,
      newLn: idx + 1,
      text,
      changeIdx: -1,
    }));
    const split = newLines.map((text, idx) => ({
      changeIdx: -1,
      left: { type: "ctx", ln: idx + 1, text },
      right: { type: "ctx", ln: idx + 1, text },
    }));
    return { unified, split, changeBlocks: [] };
  }

  const unified = [];
  const split = [];
  const changeBlocks = [];
  let newCursor = 1;
  let oldCursor = 1;

  const flushChangeGroup = (delGroup, addGroup) => {
    if (!delGroup.length && !addGroup.length) return;
    const changeIdx = changeBlocks.length;
    changeBlocks.push({
      index: changeIdx,
      newLine: addGroup[0]?.ln || delGroup[0]?.ln || newCursor,
    });
    for (const d of delGroup) {
      unified.push({ type: "del", oldLn: d.ln, newLn: null, text: d.text, changeIdx, isFirstInBlock: d === delGroup[0] });
    }
    for (const a of addGroup) {
      unified.push({ type: "add", oldLn: null, newLn: a.ln, text: a.text, changeIdx, isFirstInBlock: !delGroup.length && a === addGroup[0] });
    }
    const maxLen = Math.max(delGroup.length, addGroup.length);
    for (let i = 0; i < maxLen; i++) {
      const d = delGroup[i];
      const a = addGroup[i];
      split.push({
        changeIdx,
        isFirstInBlock: i === 0,
        left: d ? { type: "del", ln: d.ln, text: d.text } : { type: "gap", ln: null, text: "" },
        right: a ? { type: "add", ln: a.ln, text: a.text } : { type: "gap", ln: null, text: "" },
      });
    }
  };

  for (const hunk of hunks) {
    const targetNewStart = Math.max(1, hunk.newStart);
    while (newCursor < targetNewStart && newCursor <= newLines.length) {
      const text = newLines[newCursor - 1] ?? "";
      unified.push({ type: "ctx", oldLn: oldCursor, newLn: newCursor, text, changeIdx: -1 });
      split.push({
        changeIdx: -1,
        left: { type: "ctx", ln: oldCursor, text },
        right: { type: "ctx", ln: newCursor, text },
      });
      newCursor++;
      oldCursor++;
    }

    let hOldLn = hunk.oldStart;
    let hNewLn = hunk.newStart;
    let delGroup = [];
    let addGroup = [];

    for (const item of hunk.lines) {
      if (item.prefix === " ") {
        flushChangeGroup(delGroup, addGroup);
        delGroup = [];
        addGroup = [];
        const text = newLines[hNewLn - 1] ?? item.text;
        unified.push({ type: "ctx", oldLn: hOldLn, newLn: hNewLn, text, changeIdx: -1 });
        split.push({
          changeIdx: -1,
          left: { type: "ctx", ln: hOldLn, text },
          right: { type: "ctx", ln: hNewLn, text },
        });
        hOldLn++;
        hNewLn++;
      } else if (item.prefix === "-") {
        delGroup.push({ ln: hOldLn++, text: item.text });
      } else if (item.prefix === "+") {
        addGroup.push({ ln: hNewLn++, text: item.text });
      }
    }
    flushChangeGroup(delGroup, addGroup);
    oldCursor = hOldLn;
    newCursor = hNewLn;
  }

  while (newCursor <= newLines.length) {
    const text = newLines[newCursor - 1] ?? "";
    unified.push({ type: "ctx", oldLn: oldCursor, newLn: newCursor, text, changeIdx: -1 });
    split.push({
      changeIdx: -1,
      left: { type: "ctx", ln: oldCursor, text },
      right: { type: "ctx", ln: newCursor, text },
    });
    newCursor++;
    oldCursor++;
  }

  return { unified, split, changeBlocks };
}

function renderBreadcrumbPillMarkup(tab, activeWs) {
  if (tab.kind === "all-changes") {
    return `<div class="codex-breadcrumb-pill" title="Tất cả thay đổi trong ${esc(activeWs?.name || "Workspace")}">
      ${activeWs?.name ? `<span class="codex-bc-seg" data-localize-skip="true">${esc(activeWs.name)}</span><span class="codex-bc-sep">›</span>` : ""}
      <strong class="codex-bc-current">Tất cả thay đổi</strong>
    </div>`;
  }
  const parts = String(tab.path || tab.name || "").split("/").filter(Boolean);
  const fileName = parts.pop() || tab.name || "";
  const compact = Boolean(tab.showChanges);
  if (compact && parts.length > 1) {
    const lastFolder = parts.at(-1);
    return `<div class="codex-breadcrumb-pill" title="${esc(tab.path)}">
      <span class="codex-bc-seg" data-localize-skip="true">${esc(lastFolder)}</span>
      <span class="codex-bc-sep">›</span>
      <strong class="codex-bc-current" data-localize-skip="true">${esc(fileName)}</strong>
    </div>`;
  }
  return `<div class="codex-breadcrumb-pill" title="${esc(tab.path)}">
    ${activeWs?.name && parts.length <= 2 ? `<span class="codex-bc-seg" data-localize-skip="true">${esc(activeWs.name)}</span><span class="codex-bc-sep">›</span>` : ""}
    ${parts.map((seg) => `<span class="codex-bc-seg" data-localize-skip="true">${esc(seg)}</span><span class="codex-bc-sep">›</span>`).join("")}
    <strong class="codex-bc-current" data-localize-skip="true">${esc(fileName)}</strong>
  </div>`;
}

function renderDiffBasePopoverMarkup(tab, gitStatus) {
  const currentBase = tab.diffBase || "unstaged";
  const branches = gitStatus?.branches || ["main"];
  const branchQuery = String(view.diffBranchFilter || "").trim().toLowerCase();
  const filteredBranches = branches.filter((b) => !branchQuery || b.toLowerCase().includes(branchQuery));
  const baseLabel = currentBase === "head"
    ? "HEAD"
    : currentBase.startsWith("branch:")
      ? currentBase.slice("branch:".length)
      : "Chưa stage";

  return `<div class="codex-diff-target-pill">
    <details class="codex-pop-menu is-down codex-diff-base-menu" data-pop-id="diff-base-${esc(tab.id)}">
      <summary class="codex-diff-target-trigger" title="Chọn mốc so sánh thay đổi">
        <span class="codex-diff-target-icon">${icon("file-diff", 13)}</span>
        <span class="codex-diff-target-label">${esc(baseLabel)}</span>
        ${icon("chevron-down", 12)}
      </summary>
      <div class="codex-pop-card codex-diff-base-card">
        <button type="button" class="codex-diff-base-option ${currentBase === "unstaged" ? "is-selected" : ""}" data-action="select-stage-diff-base" data-tab-id="${esc(tab.id)}" data-base="unstaged">
          <div class="codex-diff-base-text">
            <strong>Chỉ mục (Index)</strong>
            <small>Thay đổi chưa stage</small>
          </div>
          ${currentBase === "unstaged" ? `<span class="codex-diff-base-check">${icon("check", 14)}</span>` : ""}
        </button>
        <button type="button" class="codex-diff-base-option ${currentBase === "head" ? "is-selected" : ""}" data-action="select-stage-diff-base" data-tab-id="${esc(tab.id)}" data-base="head">
          <div class="codex-diff-base-text">
            <strong>HEAD</strong>
            <small>Thay đổi chưa commit</small>
          </div>
          ${currentBase === "head" ? `<span class="codex-diff-base-check">${icon("check", 14)}</span>` : ""}
        </button>
        <div class="codex-pop-sep"></div>
        <div class="codex-diff-branch-section">
          <div class="codex-diff-branch-head">
            <span>Nhánh</span>
            ${icon("chevron-down", 12)}
          </div>
          <label class="codex-diff-branch-search">
            ${icon("search", 12)}
            <input type="search" data-diff-branch-search value="${esc(view.diffBranchFilter || "")}" placeholder="Tìm nhánh" autocomplete="off">
          </label>
          <div class="codex-diff-branch-group-label">Các nhánh</div>
          <div class="codex-diff-branch-list">
            ${filteredBranches.map((br) => {
              const bKey = `branch:${br}`;
              const isSel = currentBase === bKey;
              return `<button type="button" class="codex-diff-branch-item ${isSel ? "is-selected" : ""}" data-action="select-stage-diff-base" data-tab-id="${esc(tab.id)}" data-base="${esc(bKey)}">
                ${icon("git-branch", 13)}
                <span data-localize-skip="true">${esc(br)}</span>
                ${isSel ? `<span class="codex-diff-base-check">${icon("check", 13)}</span>` : ""}
              </button>`;
            }).join("") || `<div class="codex-diff-branch-empty">Không tìm thấy nhánh</div>`}
          </div>
        </div>
      </div>
    </details>
    ${tab.kind !== "all-changes" ? `<button type="button" class="codex-diff-target-close" data-action="toggle-stage-show-changes" data-tab-id="${esc(tab.id)}" title="Đóng chế độ xem thay đổi">${icon("x", 12)}</button>` : ""}
  </div>`;
}

export function renderStageFileViewer(tab, { formatEffortLabel } = {}) {
  if (!tab) return "";
  const isLiveUrl = tab.kind === "live-url" && Boolean(tab.liveUrl);
  const isAllChanges = tab.kind === "all-changes";
  const file = tab.fileData;
  const ext = (file?.extension || tab.ext || "").toLowerCase();
  const kind = isLiveUrl ? "live-url" : (file?.kind || "text");
  const hasRichPreview = !isAllChanges && (isLiveUrl || canRichPreviewExtension(ext, kind));
  const hasCodeView = !isLiveUrl && kind === "text";
  const hasEditView = canEditWorkspaceTab(tab);
  let mode = ["code", "preview", "edit"].includes(tab.mode) ? tab.mode : defaultFileTabMode(ext);
  if (tab.showChanges && mode === "preview" && isAllChanges) mode = "code";
  if (mode === "edit" && !hasEditView) mode = hasCodeView ? "code" : "preview";
  if (mode === "preview" && !hasRichPreview) mode = "code";
  if (mode === "code" && !hasCodeView) mode = "preview";

  const activeWs = (view.state?.workspaces || []).find((w) => w.id === tab.workspaceId) || null;
  const gitCacheKey = `${tab.workspaceId || ""}::${tab.taskId || ""}`;
  const gitStatus = view.workspaceGitStatus?.[gitCacheKey] || { branches: ["main"], changedFiles: [] };
  const fileGitEntry = (gitStatus.changedFiles || []).find((f) => f.path === tab.path);
  const hasDiffContent = Boolean(tab.diffData?.diff && String(tab.diffData.diff).trim());
  const isShowingChanges = Boolean((tab.showChanges || isAllChanges) && mode === "code");

  const isWebBrowser = isLiveUrl || ((ext === ".html" || ext === ".htm") && mode === "preview");
  const rawUrl = isLiveUrl
    ? `${tab.liveUrl}${tab.liveUrl.includes("?") ? "&" : "?"}_t=${tab.loadedAt || 0}`
    : resolveRemoteUrl(`/api/workspaces/${encodeURIComponent(tab.workspaceId)}/raw/${tab.path.split("/").map(encodeURIComponent).join("/")}?${tab.taskId ? `taskId=${encodeURIComponent(tab.taskId)}&` : ""}t=${tab.loadedAt || 0}`);
  const sizeBadge = file?.size !== undefined ? formatCompactBytes(file.size) : "";

  let diffModel = null;
  let changeBlocksCount = 0;
  if (isShowingChanges && !isAllChanges) {
    const contentForDiff = tab.diffData?.newContent || file?.content || "";
    diffModel = buildFullFileDiffModel(contentForDiff, tab.diffData?.diff || "");
    changeBlocksCount = diffModel.changeBlocks.length;
  } else if (isAllChanges && tab.diffData?.files) {
    changeBlocksCount = (tab.diffData.files || []).reduce((acc, f) => acc + (f.hunks?.length || 1), 0);
  }

  const activeHunkIdx = changeBlocksCount > 0
    ? Math.max(0, Math.min(changeBlocksCount - 1, Number(tab.diffHunkIndex) || 0))
    : 0;

  let bodyHtml = "";
  if (tab.loading && !file && !tab.diffData) {
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
  } else if (isAllChanges) {
    const parsedFiles = tab.diffData?.files || [];
    if (!parsedFiles.length) {
      bodyHtml = `<div class="orca-viewer-empty">
        <span>${icon("check", 18)}</span>
        <strong>Không có thay đổi nào chưa commit</strong>
        <small>Thư mục làm việc hiện tại hoàn toàn sạch.</small>
      </div>`;
    } else {
      let hunkCounter = 0;
      bodyHtml = `<div class="orca-code-scroll codex-all-changes-scroll">
        ${parsedFiles.map((df) => `<section class="codex-all-diff-card">
          <header class="codex-all-diff-head">
            <button type="button" class="codex-all-diff-file-btn" data-action="dock-open-workspace-file" data-workspace-id="${esc(tab.workspaceId)}" data-id="${esc(tab.taskId || "")}" data-path="${esc(df.path)}" data-show-changes="true">
              <span class="codex-git-badge is-modified">M↓</span>
              <strong data-localize-skip="true">${esc(df.path)}</strong>
            </button>
            <small class="codex-all-diff-stats">
              <span class="is-add">+${df.additions || 0}</span>
              <span class="is-del">-${df.deletions || 0}</span>
            </small>
          </header>
          <div class="orca-code-lines is-codex-diff">
            ${(df.lines || []).map((dl) => {
              const isHunk = dl.type === "hunk";
              const hAttr = isHunk ? `id="stage-diff-change-${hunkCounter++}"` : "";
              const rowCls = dl.type === "add" ? "is-add" : dl.type === "del" ? "is-del" : isHunk ? "is-hunk" : "";
              const ln = dl.newLine ?? dl.oldLine ?? "";
              return `<div class="orca-code-row ${rowCls}" ${hAttr}>
                <span class="orca-code-ln">${ln}</span>
                <code class="orca-code-text" data-localize-skip="true">${highlightSourceLine(dl.text || "", df.path.includes(".") ? `.${df.path.split(".").at(-1)}` : "")}</code>
              </div>`;
            }).join("")}
          </div>
        </section>`).join("")}
      </div>`;
    }
  } else if (mode === "edit") {
    const draftContent = tab.editDraft !== undefined ? tab.editDraft : (file?.content ?? "");
    bodyHtml = `<div class="vault-editor-wrap kb-editor-wrap orca-stage-editor-wrap">
      <textarea class="vault-editor-textarea orca-stage-editor" data-stage-file-editor="${esc(tab.id)}" data-tab-id="${esc(tab.id)}" spellcheck="false" placeholder="Chỉnh sửa nội dung tệp ${esc(tab.path)}…">${esc(draftContent)}</textarea>
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
      bodyHtml = `<div class="orca-doc-scroll codex-doc-scroll">
        <button type="button" class="codex-doc-copy-btn" data-action="copy-stage-file-content" data-tab-id="${esc(tab.id)}" title="Sao chép toàn bộ nội dung">${icon("copy", 14)}</button>
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
          ${lines.map((line, idx) => `<div class="orca-code-row"><span class="orca-code-ln">${idx + 1}</span><code class="orca-code-text" data-localize-skip="true">${esc(line)}</code></div>`).join("")}
        </div>
      </div>`;
    }
  } else if (isShowingChanges && diffModel) {
    const isMobileViewport = typeof window !== "undefined" && Boolean(window.matchMedia?.("(max-width: 740px)")?.matches);
    if (tab.diffSplit && !isMobileViewport) {
      bodyHtml = `<div class="orca-code-scroll codex-split-diff-scroll">
        <button type="button" class="codex-doc-copy-btn" data-action="copy-stage-file-content" data-tab-id="${esc(tab.id)}" title="Sao chép toàn bộ nội dung">${icon("copy", 14)}</button>
        <div class="codex-split-diff-grid">
          ${diffModel.split.map((row) => {
            const anchorAttr = row.isFirstInBlock && row.changeIdx >= 0 ? `id="stage-diff-change-${row.changeIdx}"` : "";
            const leftCls = row.left.type === "del" ? "is-del" : row.left.type === "gap" ? "is-gap" : "";
            const rightCls = row.right.type === "add" ? "is-add" : row.right.type === "gap" ? "is-gap" : "";
            return `<div class="codex-split-diff-row" ${anchorAttr}>
              <div class="codex-split-cell is-left ${leftCls}">
                <span class="orca-code-ln">${row.left.ln ?? ""}</span>
                ${row.left.type === "gap"
                  ? `<div class="codex-diff-hatched-gap"></div>`
                  : `<code class="orca-code-text" data-localize-skip="true">${highlightSourceLine(row.left.text, ext)}</code>`}
              </div>
              <div class="codex-split-cell is-right ${rightCls}">
                <span class="orca-code-ln">${row.right.ln ?? ""}</span>
                ${row.right.type === "gap"
                  ? `<div class="codex-diff-hatched-gap"></div>`
                  : `<code class="orca-code-text" data-localize-skip="true">${highlightSourceLine(row.right.text, ext)}</code>`}
              </div>
            </div>`;
          }).join("")}
        </div>
      </div>`;
    } else {
      const commentTarget = view.stageLineCommentTarget;
      bodyHtml = `<div class="orca-code-scroll">
        <button type="button" class="codex-doc-copy-btn" data-action="copy-stage-file-content" data-tab-id="${esc(tab.id)}" title="Sao chép toàn bộ nội dung">${icon("copy", 14)}</button>
        <div class="orca-code-lines is-codex-diff">
          ${diffModel.unified.map((row) => {
            const lineNum = row.newLn ?? row.oldLn ?? "";
            const anchorAttr = row.isFirstInBlock && row.changeIdx >= 0 ? `id="stage-diff-change-${row.changeIdx}"` : "";
            const rowCls = row.type === "add" ? "is-add" : row.type === "del" ? "is-del" : "";
            const lineKey = `code:${tab.id}:${lineNum}:${row.type}`;
            const isCommenting = commentTarget?.key === lineKey;
            return `<div class="orca-code-row ${rowCls} ${isCommenting ? "is-commenting" : ""}" ${anchorAttr} data-action="open-stage-line-comment" data-key="${esc(lineKey)}" data-path="${esc(tab.path)}" data-line="${lineNum}" data-code="${esc(row.text)}">
              <span class="orca-code-ln">${lineNum}</span>
              <code class="orca-code-text" data-localize-skip="true">${highlightSourceLine(row.text, ext)}</code>
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
  } else {
    const lines = String(file?.content || "").split(/\r?\n/);
    const commentTarget = view.stageLineCommentTarget;
    bodyHtml = `<div class="orca-code-scroll">
      <button type="button" class="codex-doc-copy-btn" data-action="copy-stage-file-content" data-tab-id="${esc(tab.id)}" title="Sao chép toàn bộ nội dung">${icon("copy", 14)}</button>
      <div class="orca-code-lines">
        ${lines.map((line, idx) => {
          const lineNum = idx + 1;
          const lineKey = `code:${tab.id}:${lineNum}`;
          const isCommenting = commentTarget?.key === lineKey;
          return `<div class="orca-code-row ${isCommenting ? "is-commenting" : ""}" data-action="open-stage-line-comment" data-key="${esc(lineKey)}" data-path="${esc(tab.path)}" data-line="${lineNum}" data-code="${esc(line)}">
            <span class="orca-code-ln">${lineNum}</span>
            <code class="orca-code-text" data-localize-skip="true">${highlightSourceLine(line, ext)}</code>
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
    : renderBreadcrumbPillMarkup(tab, activeWs);

  const canDiffFile = !isLiveUrl && tab.kind !== "stage-doc" && kind === "text" && Boolean(tab.workspaceId);
  const hasFileChanges = Boolean(fileGitEntry || hasDiffContent);

  return `<section class="orca-file-viewer" aria-label="Trình xem tệp ${esc(tab.name)}">
    <header class="orca-viewer-toolbar is-codex-pill-bar">
      ${leftToolbarMarkup}
      <div class="orca-viewer-actions codex-viewer-pills">
        ${isWebBrowser ? `
          <button type="button" class="codex-pill-btn ${view.stageHtmlInspectActive ? "is-active" : ""}" data-action="toggle-html-inspect" title="Nhấp vào phần tử để gửi nhận xét cho Agent">
            ${icon("message-square-plus", 13)}
            <span>Chọn phần tử</span>
          </button>
        ` : ""}
        ${mode === "edit" ? `
          <button type="button" class="codex-pill-btn" data-action="cancel-stage-file-edit" data-tab-id="${esc(tab.id)}">Hủy</button>
          <button type="button" class="codex-pill-btn is-primary" data-action="save-stage-file" data-tab-id="${esc(tab.id)}">${icon("check", 12)}<span>Lưu tệp</span></button>
        ` : ""}
        ${canDiffFile && mode !== "edit" ? (
          isShowingChanges
            ? `${renderDiffBasePopoverMarkup(tab, gitStatus)}
               ${changeBlocksCount > 0 ? `<div class="codex-hunk-stepper" title="Di chuyển giữa ${changeBlocksCount} cụm thay đổi">
                 <button type="button" class="codex-hunk-step-btn" data-action="step-stage-diff-hunk" data-tab-id="${esc(tab.id)}" data-dir="-1" aria-label="Thay đổi trước">${icon("chevron-up", 12)}</button>
                 <span class="codex-hunk-step-count">${activeHunkIdx + 1}/${changeBlocksCount}</span>
                 <button type="button" class="codex-hunk-step-btn" data-action="step-stage-diff-hunk" data-tab-id="${esc(tab.id)}" data-dir="1" aria-label="Thay đổi tiếp theo">${icon("chevron-down", 12)}</button>
               </div>` : ""}`
            : `<button type="button" class="codex-pill-btn is-show-changes ${hasFileChanges ? "has-changes" : ""}" data-action="toggle-stage-show-changes" data-tab-id="${esc(tab.id)}" title="Hiển thị các dòng thay đổi Git ngay trong tệp">
                 ${icon("file-diff", 13)}
                 <span>Xem thay đổi</span>
                 ${hasFileChanges ? `<span class="codex-pill-dot"></span>` : ""}
               </button>`
        ) : ""}
        ${!isAllChanges && mode !== "edit" && hasRichPreview && hasCodeView ? (
          mode === "preview"
            ? `<button type="button" class="codex-pill-btn is-mode-toggle" data-action="stage-tab-mode" data-tab-id="${esc(tab.id)}" data-mode="code" title="Xem mã nguồn tệp">
                 ${icon("file-search", 13)}
                 <span>Xem mã nguồn</span>
               </button>`
            : `<button type="button" class="codex-pill-btn is-mode-toggle" data-action="stage-tab-mode" data-tab-id="${esc(tab.id)}" data-mode="preview" title="Xem bản dựng trực quan">
                 ${icon("file-search", 13)}
                 <span>Xem bản dựng</span>
               </button>`
        ) : ""}
        ${isShowingChanges && !isAllChanges ? `<button type="button" class="codex-pill-icon-btn is-split-diff ${tab.diffSplit ? "is-active" : ""}" data-action="toggle-stage-diff-split" data-tab-id="${esc(tab.id)}" title="${tab.diffSplit ? "Chuyển sang xem Diff 1 cột (Unified)" : "Chuyển sang xem Diff 2 cột song song (Split)"}">
          <span class="codex-split-glyph"><i class="is-left"></i><i class="is-right"></i></span>
        </button>` : ""}
        ${!isAllChanges && !isLiveUrl && tab.workspaceId ? `<div class="codex-open-group">
          <button type="button" class="codex-open-folder-btn" data-action="open-project-folder" data-id="${esc(tab.workspaceId)}" title="Mở thư mục dự án">${icon("folder", 13)}</button>
          <details class="codex-pop-menu is-right is-down">
            <summary class="codex-open-menu-trigger" title="Tùy chọn mở hoặc chỉnh sửa tệp">
              <span>Mở</span>
              ${icon("chevron-down", 11)}
            </summary>
            <div class="codex-pop-card">
              <button type="button" class="codex-pop-item" data-action="open-project-folder" data-id="${esc(tab.workspaceId)}"><span class="codex-pop-item-main">${icon("folder-open", 13)}<span>Mở trong Explorer</span></span></button>
              ${hasEditView ? `<button type="button" class="codex-pop-item" data-action="stage-tab-mode" data-tab-id="${esc(tab.id)}" data-mode="edit"><span class="codex-pop-item-main">${icon("square-pen", 13)}<span>Chỉnh sửa trực tiếp</span></span></button>` : ""}
              <button type="button" class="codex-pop-item" data-action="copy-stage-file-path" data-path="${esc(tab.path)}"><span class="codex-pop-item-main">${icon("copy", 13)}<span>Sao chép đường dẫn</span></span></button>
              <button type="button" class="codex-pop-item" data-action="copy-stage-file-content" data-tab-id="${esc(tab.id)}"><span class="codex-pop-item-main">${icon("clipboard", 13)}<span>Sao chép nội dung tệp</span></span></button>
            </div>
          </details>
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

export function renderDockTreeLevel(node, depth, {
  collapsedSet,
  activePath,
  fileAction,
  workspaceId = "",
  taskId = "",
  showMention = false,
  showVaultMenu = false,
  vaultNoteOptionsMenu,
  gitStatusMap = null,
  folderHasChangesSet = null,
  showStageButtons = false,
  keyPrefix = "",
}) {
  const folders = node.foldersList || [...node.folders.values()];
  const files = node.files;
  let html = "";
  const padLeft = 10 + depth * 14;
  for (const folder of folders) {
    const collapseKey = keyPrefix ? `${keyPrefix}:${folder.path}` : folder.path;
    const isCollapsed = collapsedSet.has(collapseKey);
    const hasModifiedChild = Boolean(!showStageButtons && folderHasChangesSet?.has(folder.path));
    html += `<li class="orca-tree-item is-folder">
      <button type="button" class="orca-tree-row" style="padding-left:${padLeft}px" data-action="toggle-dock-folder" data-folder="${esc(collapseKey)}" title="${esc(folder.path)}">
        <span class="orca-tree-caret ${isCollapsed ? "" : "is-open"}">${icon("chevron-right", 12)}</span>
        <span class="orca-tree-label" data-localize-skip="true">${esc(folder.name)}</span>
        ${hasModifiedChild ? `<span class="codex-folder-dot" title="Thư mục có tệp thay đổi"></span>` : ""}
      </button>
    </li>`;
    if (!isCollapsed) {
      html += renderDockTreeLevel(folder, depth + 1, {
        collapsedSet,
        activePath,
        fileAction,
        workspaceId,
        taskId,
        showMention,
        showVaultMenu,
        vaultNoteOptionsMenu,
        gitStatusMap,
        folderHasChangesSet,
        showStageButtons,
        keyPrefix,
      });
    }
  }
  for (const file of files) {
    const isSelected = activePath && activePath === file.path;
    const gitInfo = gitStatusMap?.get(file.path) || null;
    const fIcon = showVaultMenu ? "file-text" : dockFileIconName(file.name);
    const statusCls = gitInfo ? `is-git-${gitInfo.statusKind || "modified"}` : "";
    const openInChangesAttr = showStageButtons ? `data-show-changes="true"` : "";
    html += `<li class="orca-tree-item is-file ${isSelected ? "is-selected" : ""} ${statusCls}">
      <button type="button" class="orca-tree-row ${isSelected ? "is-selected" : ""}" style="padding-left:${padLeft + 14}px" data-action="${esc(fileAction)}" ${workspaceId ? `data-workspace-id="${esc(workspaceId)}"` : ""} ${taskId ? `data-id="${esc(taskId)}"` : ""} data-path="${esc(file.path)}" ${openInChangesAttr} title="${esc(file.path)}">
        ${gitInfo
          ? `<span class="codex-git-badge is-${esc(gitInfo.statusKind || "modified")}" data-localize-skip="true">${esc(gitInfo.badge || "M↓")}</span>`
          : `<span class="orca-tree-icon">${icon(fIcon, 13)}</span>`}
        <span class="orca-tree-label ${statusCls}" data-localize-skip="true">${esc(file.name)}</span>
      </button>
      ${showStageButtons && gitInfo ? `<button type="button" class="codex-stage-btn ${gitInfo.unstaged ? "is-stage" : "is-staged"}" data-action="git-toggle-stage" data-stage-action="${gitInfo.unstaged ? "stage" : "unstage"}" data-workspace-id="${esc(workspaceId)}" data-id="${esc(taskId)}" data-path="${esc(file.path)}" title="${gitInfo.unstaged ? "Stage tệp (+)" : "Đã stage · Bấm để bỏ stage"}">
        <span>${gitInfo.unstaged ? "+" : "·"}</span>
      </button>` : ""}
      ${showMention && !showStageButtons ? `<button type="button" class="orca-tree-quick" data-action="mention-drawer-file" data-path="${esc(file.path)}" title="Chèn @${esc(file.path)} vào khung chat">@</button>` : ""}
      ${showVaultMenu && typeof vaultNoteOptionsMenu === "function" ? vaultNoteOptionsMenu(file.path, { showRead: view.vaultViewMode === "graph", showGraph: view.vaultViewMode !== "graph", direction: "down" }) : ""}
    </li>`;
  }
  return html;
}
