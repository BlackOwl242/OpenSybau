import { esc, fmtDate, formatNumber, icon, statuses, tokenCount, view } from "../../shared/state.js";
import { pipelineStepperData } from "../../domain/task-flow.js";
import { extractMarkdownOutline } from "./markdown.js";
import { buildDockFileTree, dockFileIconName, renderDockTreeLevel } from "./stage-viewer.js";

export function pageSupportsRightDock(page = view.page) {
  if (page === "chat" || page === "workspaces" || page === "skills") return true;
  if (page === "knowledge") return Boolean(view.state?.settings?.vaultPath);
  return false;
}

export function getRightDockTabsForPage(page = view.page, selectedTask = null) {
  if (page === "knowledge") {
    const tabs = [
      { id: "files", icon: "files", title: "Cây ghi chú Vault" },
      { id: "search", icon: "search", title: "Tìm ghi chú & #tag" },
      { id: "git", icon: "waypoints", title: "Liên kết hai chiều & Thẻ #tag" },
    ];
    if (view.vaultPreview?.content) {
      tabs.push({ id: "tasks", icon: "list-checks", title: "Mục lục ghi chú (Outline)" });
    }
    return tabs;
  }
  if (page === "skills") {
    return [
      { id: "files", icon: "files", title: "Danh mục Kỹ năng" },
      { id: "search", icon: "search", title: "Tìm kiếm kỹ năng" },
    ];
  }
  if (page === "workspaces") {
    return [
      { id: "files", icon: "files", title: "Cây thư mục & Thay đổi" },
    ];
  }
  // page === "chat"
  if (selectedTask) {
    return [
      { id: "files", icon: "files", title: "Cây thư mục & Thay đổi" },
      { id: "git", icon: "git-branch", title: "Commit, PR & Worktree" },
      { id: "docs", icon: "book-open-text", title: "Tài liệu giai đoạn (Kế hoạch / Triển khai / Đánh giá / QA)" },
      { id: "terminal", icon: "square-terminal", title: "Kiểm thử QA, Terminal & Xem trực tiếp" },
      { id: "tasks", icon: "list-checks", title: "Mục tiêu & Công cụ phiên" },
    ];
  }
  return [
    { id: "files", icon: "files", title: "Cây thư mục & Thay đổi" },
    { id: "terminal", icon: "square-terminal", title: "Xem trực tiếp ứng dụng cục bộ" },
  ];
}

export function renderOrcaRightDockMarkup({
  loadVaultGraph,
  ensureWorkspaceFileIndex,
  ensureWorkspaceGitStatus,
  vaultNoteOptionsMenu,
  render,
} = {}) {
  const page = view.page || "chat";
  if (!pageSupportsRightDock(page)) return "";
  const selectedTask = (page === "chat" && view.selected) ? (view.state?.tasks || []).find((t) => t.id === view.selected) : null;
  const availableTabs = getRightDockTabsForPage(page, selectedTask);
  const tab = availableTabs.some((t) => t.id === view.chatDrawerTab) ? view.chatDrawerTab : (availableTabs[0]?.id || "files");
  const filter = (view.chatDrawerFilter || "").trim().toLowerCase();
  const activeWsId = (page === "workspaces" && view.selected)
    ? view.selected
    : selectedTask?.workspaceId || view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || "";
  const activeWs = (view.state?.workspaces || []).find((w) => w.id === activeWsId) || null;

  if (!Array.isArray(view.collapsedDockFolders)) {
    view.collapsedDockFolders = null;
  }

  let subTitle = "Workspace";
  let subTooltip = "";
  let refreshAction = "refresh-dock-context";
  let moreMenuHtml = "";

  if (page === "knowledge") {
    const vaultPath = view.state?.settings?.vaultPath || "";
    subTitle = vaultPath ? (vaultPath.split(/[\\/]/).filter(Boolean).at(-1) || "Obsidian Vault") : "Obsidian Vault";
    subTooltip = vaultPath;
    refreshAction = "refresh-vault-files";
    moreMenuHtml = `<details class="codex-pop-menu is-right is-down">
      <summary class="icon-button orca-sub-btn" title="Tùy chọn Vault">${icon("ellipsis", 14)}</summary>
      <div class="codex-pop-card">
        <button type="button" class="codex-pop-item" data-action="vault-new-note"><span class="codex-pop-item-main">${icon("plus", 13)}<span>Ghi chú Markdown mới</span></span></button>
        <button type="button" class="codex-pop-item" data-action="open-obsidian" data-path="${esc(view.vaultPreview?.path || "")}"><span class="codex-pop-item-main">${icon("arrow-up-right", 13)}<span>Mở trong Obsidian</span></span></button>
        <button type="button" class="codex-pop-item" data-action="connect-vault"><span class="codex-pop-item-main">${icon("folder-open", 13)}<span>Đổi thư mục Vault…</span></span></button>
        <div class="codex-pop-sep"></div>
        <button type="button" class="codex-pop-item is-danger" data-action="disconnect-vault"><span class="codex-pop-item-main">${icon("x", 13)}<span>Ngắt kết nối Vault</span></span></button>
      </div>
    </details>`;
  } else if (page === "skills") {
    subTitle = `Kỹ năng (${(view.skills || []).length})`;
    subTooltip = "Thư viện Kỹ năng Agent";
    refreshAction = "scan-skills";
    moreMenuHtml = `<button type="button" class="icon-button orca-sub-btn" data-action="new-skill" title="Tạo skill mới">${icon("plus", 14)}</button>`;
  } else if (activeWs) {
    subTitle = activeWs.name;
    subTooltip = activeWs.path;
    refreshAction = "refresh-dock-context";
    const taskArtifactsCount = (selectedTask?.artifacts || []).length;
    moreMenuHtml = `<details class="codex-pop-menu is-right is-down">
      <summary class="icon-button orca-sub-btn" title="Tùy chọn dự án & phiên">${icon("ellipsis", 14)}</summary>
      <div class="codex-pop-card">
        ${selectedTask ? `
          <div class="codex-pop-head">Phiên trò chuyện</div>
          <button type="button" class="codex-pop-item" data-action="show-diff" data-id="${esc(selectedTask.id)}"><span class="codex-pop-item-main">${icon("file-text", 13)}<span>Diff & Review (${taskArtifactsCount})</span></span></button>
          <button type="button" class="codex-pop-item" data-action="open-task-flow" data-id="${esc(selectedTask.id)}"><span class="codex-pop-item-main">${icon("workflow", 13)}<span>Luồng điều phối</span></span></button>
          <button type="button" class="codex-pop-item" data-action="task-permissions" data-id="${esc(selectedTask.id)}"><span class="codex-pop-item-main">${icon("shield", 13)}<span>Quyền truy cập</span></span></button>
          <button type="button" class="codex-pop-item" data-action="edit-task-goal" data-id="${esc(selectedTask.id)}"><span class="codex-pop-item-main">${icon("target", 13)}<span>Mục tiêu & Checklist</span></span></button>
          <button type="button" class="codex-pop-item" data-action="task-instruction" data-id="${esc(selectedTask.id)}"><span class="codex-pop-item-main">${icon("settings-2", 13)}<span>Cấu hình Agent / Model</span></span></button>
          <button type="button" class="codex-pop-item" data-action="${selectedTask.archived ? "restore-task" : "archive-task"}" data-id="${esc(selectedTask.id)}"><span class="codex-pop-item-main">${icon("archive", 13)}<span>${selectedTask.archived ? "Khôi phục chat" : "Lưu trữ chat"}</span></span></button>
          <div class="codex-pop-sep"></div>
        ` : ""}
        <div class="codex-pop-head">Dự án</div>
        <button type="button" class="codex-pop-item" data-action="open-project-folder" data-id="${esc(activeWs.id)}"><span class="codex-pop-item-main">${icon("folder-open", 13)}<span>Mở trong Explorer</span></span></button>
        <button type="button" class="codex-pop-item" data-action="open-github-issues" data-workspace-id="${esc(activeWs.id)}"><span class="codex-pop-item-main">${icon("git-branch", 13)}<span>GitHub Issues & PRs</span></span></button>
        <button type="button" class="codex-pop-item" data-action="edit-project" data-id="${esc(activeWs.id)}"><span class="codex-pop-item-main">${icon("settings-2", 13)}<span>Sửa cấu hình dự án</span></span></button>
        <button type="button" class="codex-pop-item" data-action="add-workspace"><span class="codex-pop-item-main">${icon("folder-plus", 13)}<span>Thêm dự án mới…</span></span></button>
      </div>
    </details>`;
  }

  let bodyHtml = "";

  if (tab === "files") {
    if (page === "knowledge") {
      const vaultPath = view.state?.settings?.vaultPath || "";
      if (!vaultPath) {
        bodyHtml = `<div class="orca-dock-empty"><p>Chưa kết nối Obsidian Vault.</p><button type="button" class="button primary small" data-action="connect-vault">${icon("plus", 12)}<span>Kết nối Vault</span></button></div>`;
      } else {
        if (!view.vaultGraph && !view.vaultGraphLoading && typeof loadVaultGraph === "function") {
          void loadVaultGraph();
        }
        const graphNodes = view.vaultGraph?.nodes || [];
        const paths = graphNodes.length
          ? graphNodes.map((n) => n.path)
          : (view.vaultEntries || []).filter((e) => e.type !== "directory").map((e) => e.path);
        const tree = buildDockFileTree(paths);
        if (view.collapsedDockFolders === null) {
          view.collapsedDockFolders = [];
        }
        const collapsedSet = new Set(view.collapsedDockFolders);
        const activePath = view.vaultPreview?.path || "";
        const rows = renderDockTreeLevel(tree, 0, {
          collapsedSet,
          activePath,
          fileAction: "vault-select-graph-node",
          showVaultMenu: true,
          vaultNoteOptionsMenu,
        });
        bodyHtml = `<ul class="orca-tree-list">${rows || `<li class="orca-dock-empty">Chưa có ghi chú Markdown.</li>`}</ul>`;
      }
    } else if (page === "skills") {
      const allSkills = view.skills || [];
      const groups = [
        ["personal", "Cá nhân", allSkills.filter((s) => s.editable)],
        ["codex", "Codex CLI", allSkills.filter((s) => !s.editable && (s.providers?.includes("codex") || (s.sources || []).join(" ").toLowerCase().includes("codex")))],
        ["antigravity", "Antigravity", allSkills.filter((s) => !s.editable && (s.providers?.includes("antigravity") || (s.sources || []).join(" ").toLowerCase().includes("antigravity")))],
        ["claude", "Claude Code", allSkills.filter((s) => !s.editable && (s.providers?.includes("claude") || (s.sources || []).join(" ").toLowerCase().includes("claude")))],
      ];
      const collapsedSet = new Set(view.collapsedDockFolders || []);
      bodyHtml = `<ul class="orca-tree-list">${groups.map(([key, label, items]) => {
        const folderKey = `skill:${key}`;
        const isCollapsed = collapsedSet.has(folderKey);
        return `<li class="orca-tree-item is-folder">
          <button type="button" class="orca-tree-row" style="padding-left:10px" data-action="toggle-dock-folder" data-folder="${esc(folderKey)}">
            <span class="orca-tree-caret ${isCollapsed ? "" : "is-open"}">${icon("chevron-right", 12)}</span>
            <span class="orca-tree-icon">${icon("folder", 14)}</span>
            <span class="orca-tree-label">${esc(label)}</span>
            <small class="orca-tree-badge">${items.length}</small>
          </button>
        </li>${isCollapsed ? "" : items.map((s) => `<li class="orca-tree-item is-file ${s.id === view.selectedSkillId ? "is-selected" : ""}">
          <button type="button" class="orca-tree-row ${s.id === view.selectedSkillId ? "is-selected" : ""}" style="padding-left:38px" data-action="select-skill" data-id="${esc(s.id)}" title="${esc(s.description || s.name)}">
            <span class="orca-tree-icon">${icon("file-text", 14)}</span>
            <span class="orca-tree-label">${esc(s.name)}</span>
          </button>
        </li>`).join("")}`;
      }).join("")}</ul>`;
    } else if (activeWs) {
      const allFiles = view.workspaceFileIndex?.[activeWs.id] || [];
      if (!view.workspaceFileIndex?.[activeWs.id] && typeof ensureWorkspaceFileIndex === "function") {
        void ensureWorkspaceFileIndex(activeWs.id).then(() => render?.());
      }
      const gitCacheKey = `${activeWs.id}::${selectedTask?.id || ""}`;
      const gitStatus = view.workspaceGitStatus?.[gitCacheKey] || null;
      if (!gitStatus && typeof ensureWorkspaceGitStatus === "function") {
        void ensureWorkspaceGitStatus(activeWs.id, selectedTask?.id || "").then(() => render?.());
      }

      const gitStatusMap = new Map();
      const folderHasChangesSet = new Set();
      const rawChangedList = gitStatus?.changedFiles?.length
        ? gitStatus.changedFiles
        : (selectedTask?.artifacts || []).map((p) => ({
            path: p,
            unstaged: true,
            staged: false,
            badge: "M↓",
            statusKind: "modified",
          }));

      for (const entry of rawChangedList) {
        if (!entry?.path) continue;
        gitStatusMap.set(entry.path, entry);
        const segs = entry.path.split("/").filter(Boolean);
        for (let i = 1; i < segs.length; i++) {
          folderHasChangesSet.add(segs.slice(0, i).join("/"));
        }
      }

      const changedPaths = [...gitStatusMap.keys()].filter((f) => !filter || f.toLowerCase().includes(filter));
      const filteredAllFiles = allFiles.filter((f) => !filter || f.toLowerCase().includes(filter));

      const allTree = buildDockFileTree(filteredAllFiles);
      const changedTree = buildDockFileTree(changedPaths);
      if (view.collapsedDockFolders === null && allFiles.length > 0) {
        const topFolders = (allTree.foldersList || [...allTree.folders.values()]).map((f) => f.path);
        view.collapsedDockFolders = topFolders.filter((p) => p !== "src");
      }
      const collapsedSet = filter ? new Set() : new Set(view.collapsedDockFolders || []);
      const collapsedSections = new Set(view.collapsedDockSections || []);
      const isChangedSectionCollapsed = collapsedSections.has("changed-files");
      const isAllSectionCollapsed = collapsedSections.has("all-files");

      const activeStageTab = (view.stageTabs || []).find((t) => t.id === view.activeStageTabId);
      const isAllChangesSelected = activeStageTab?.kind === "all-changes" && activeStageTab?.workspaceId === activeWs.id;
      const activePath = activeStageTab?.path || (page === "workspaces" ? (view.filePreview?.path || "") : (view.chatDrawerPreview?.path || ""));
      const fileAction = page === "workspaces" ? "dock-open-workspace-file" : "preview-drawer-file";

      const changedRows = changedPaths.length && !isChangedSectionCollapsed
        ? renderDockTreeLevel(changedTree, 0, {
            collapsedSet,
            activePath,
            fileAction,
            workspaceId: activeWs.id,
            taskId: selectedTask?.id || "",
            showMention: false,
            gitStatusMap,
            folderHasChangesSet,
            showStageButtons: true,
            keyPrefix: "chg",
          })
        : "";

      const allRows = !isAllSectionCollapsed
        ? renderDockTreeLevel(allTree, 0, {
            collapsedSet,
            activePath,
            fileAction,
            workspaceId: activeWs.id,
            taskId: selectedTask?.id || "",
            showMention: page === "chat",
            gitStatusMap,
            folderHasChangesSet,
            showStageButtons: false,
          })
        : "";

      bodyHtml = `<div class="orca-dock-search-wrap codex-sidebar-filter-wrap">
        <label class="orca-dock-search codex-sidebar-filter">
          ${icon("search", 13)}
          <input type="search" data-chat-drawer-filter value="${esc(view.chatDrawerFilter || "")}" placeholder="Lọc tệp…" autocomplete="off">
        </label>
      </div>
      <div class="codex-unified-tree-scroll">
        ${gitStatusMap.size > 0 ? `
          <button type="button" class="codex-all-changes-row ${isAllChangesSelected ? "is-selected" : ""}" data-action="open-all-changes-tab" data-workspace-id="${esc(activeWs.id)}" data-id="${esc(selectedTask?.id || "")}" title="Mở tổng hợp tất cả thay đổi trong dự án">
            <span class="codex-all-changes-icon">${icon("list-checks", 13)}</span>
            <span class="codex-all-changes-label">Tất cả thay đổi</span>
            <small class="orca-tree-badge">${gitStatusMap.size}</small>
          </button>
          <div class="codex-tree-section">
            <button type="button" class="codex-tree-section-btn" data-action="toggle-dock-section" data-section="changed-files">
              <span class="orca-tree-caret ${isChangedSectionCollapsed ? "" : "is-open"}">${icon("chevron-right", 12)}</span>
              <span class="codex-tree-section-title">Tệp đã sửa</span>
              <span class="codex-folder-dot" title="${changedPaths.length} tệp thay đổi"></span>
            </button>
            ${!isChangedSectionCollapsed ? `<ul class="orca-tree-list codex-changed-tree">${changedRows || `<li class="orca-dock-empty">Không có tệp thay đổi khớp bộ lọc.</li>`}</ul>` : ""}
          </div>
        ` : ""}
        <div class="codex-tree-section">
          <button type="button" class="codex-tree-section-btn" data-action="toggle-dock-section" data-section="all-files">
            <span class="orca-tree-caret ${isAllSectionCollapsed ? "" : "is-open"}">${icon("chevron-right", 12)}</span>
            <span class="codex-tree-section-title">Tất cả tệp</span>
          </button>
          ${!isAllSectionCollapsed ? `<ul class="orca-tree-list codex-all-files-tree">${allRows || `<li class="orca-dock-empty">${allFiles.length ? "Không tìm thấy tệp phù hợp." : "Đang tải cây tệp dự án…"}</li>`}</ul>` : ""}
        </div>
      </div>`;
    } else {
      bodyHtml = `<div class="orca-dock-empty"><p>Chưa có dự án nào được chọn.</p><button type="button" class="button primary small" data-action="add-workspace">${icon("plus", 12)}<span>Thêm dự án</span></button></div>`;
    }
  } else if (tab === "search") {
    let resultsHtml = "";
    const searchPlaceholder = page === "knowledge"
      ? "Tìm ghi chú hoặc #tag…"
      : page === "skills"
        ? "Tìm tên hoặc mô tả kỹ năng…"
        : "Tìm nhanh tên tệp trong dự án…";
    if (page === "knowledge") {
      const nodes = view.vaultGraph?.nodes || [];
      const matches = nodes.filter((n) => !filter || `${n.path} ${n.title || ""} ${(n.tags || []).join(" ")}`.toLowerCase().includes(filter)).slice(0, 80);
      resultsHtml = matches.length
        ? matches.map((n) => `<li class="orca-tree-item is-file"><button type="button" class="orca-tree-row" style="padding-left:12px" data-action="vault-select-graph-node" data-path="${esc(n.path)}"><span class="orca-tree-icon">${icon("file-text", 14)}</span><span class="orca-tree-label">${esc(n.title || n.name)}</span></button></li>`).join("")
        : `<li class="orca-dock-empty">Không có ghi chú khớp từ khóa.</li>`;
    } else if (page === "skills") {
      const matches = (view.skills || []).filter((s) => !filter || `${s.name} ${s.description}`.toLowerCase().includes(filter)).slice(0, 80);
      resultsHtml = matches.length
        ? matches.map((s) => `<li class="orca-tree-item is-file"><button type="button" class="orca-tree-row" style="padding-left:12px" data-action="select-skill" data-id="${esc(s.id)}"><span class="orca-tree-icon">${icon("file-text", 14)}</span><span class="orca-tree-label">${esc(s.name)}</span></button></li>`).join("")
        : `<li class="orca-dock-empty">Không có kỹ năng phù hợp.</li>`;
    } else {
      const allFiles = (activeWs && view.workspaceFileIndex?.[activeWs.id]) || [];
      const matches = allFiles.filter((f) => !filter || f.toLowerCase().includes(filter)).slice(0, 100);
      const fileAction = page === "workspaces" ? "dock-open-workspace-file" : "preview-drawer-file";
      resultsHtml = matches.length
        ? matches.map((f) => `<li class="orca-tree-item is-file"><button type="button" class="orca-tree-row" style="padding-left:12px" data-action="${fileAction}" data-workspace-id="${esc(activeWs?.id || "")}" data-id="${esc(selectedTask?.id || "")}" data-path="${esc(f)}"><span class="orca-tree-icon">${icon(dockFileIconName(f), 14)}</span><span class="orca-tree-label">${esc(f)}</span></button>${page === "chat" ? `<button type="button" class="orca-tree-quick" data-action="mention-drawer-file" data-path="${esc(f)}" title="Chèn @${esc(f)}">@</button>` : ""}</li>`).join("")
        : `<li class="orca-dock-empty">Không tìm thấy tệp phù hợp.</li>`;
    }
    bodyHtml = `<div class="orca-dock-search-wrap">
      <label class="orca-dock-search">
        ${icon("search", 13)}
        <input type="search" data-chat-drawer-filter value="${esc(view.chatDrawerFilter || "")}" placeholder="${esc(searchPlaceholder)}" autocomplete="off">
      </label>
    </div>
    <ul class="orca-tree-list">${resultsHtml}</ul>`;
  } else if (tab === "git") {
    if (page === "knowledge") {
      const graph = view.vaultGraph || { nodes: [], edges: [] };
      const activeFile = view.vaultPreview;
      const selectedNode = (graph.nodes || []).find((n) => n.path === activeFile?.path) || null;
      const connectedEdges = selectedNode ? (graph.edges || []).filter((e) => e.source === selectedNode.id || e.target === selectedNode.id) : [];
      const connectedNodes = selectedNode
        ? connectedEdges.map((e) => {
            const isOut = e.source === selectedNode.id;
            const otherId = isOut ? e.target : e.source;
            const node = (graph.nodes || []).find((n) => n.id === otherId);
            return node ? { node, kind: e.kind, direction: isOut ? "out" : "in" } : null;
          }).filter(Boolean)
        : [];
      const allTags = [...new Set((graph.nodes || []).flatMap((n) => n.tags || []))].slice(0, 20);
      bodyHtml = `<div class="orca-dock-pad">
        <div class="orca-section-label">LIÊN KẾT HAI CHIỀU (${connectedNodes.length})</div>
        ${connectedNodes.length
          ? `<ul class="orca-tree-list">${connectedNodes.map(({ node, direction }) => `<li class="orca-tree-item is-file"><button type="button" class="orca-tree-row" style="padding-left:10px" data-action="vault-select-graph-node" data-path="${esc(node.path)}"><span class="orca-tree-icon">${icon("file-text", 14)}</span><span class="orca-tree-label">${esc(node.title || node.name)}</span><small class="orca-tree-badge">${direction === "out" ? "→" : "←"}</small></button></li>`).join("")}</ul>`
          : `<p class="orca-muted-note">Chưa có liên kết <code>[[WikiLink]]</code> cho ghi chú này.</p>`}
        ${allTags.length ? `<div class="orca-section-label" style="margin-top:14px">THẺ CHỦ ĐỀ (#TAGS)</div>
        <div class="neural-tag-list">${allTags.map((t) => `<button type="button" class="kb-tag-chip" data-action="vault-filter-tag" data-tag="#${esc(t)}">#${esc(t)}</button>`).join("")}</div>` : ""}
      </div>`;
    } else {
      const artifacts = selectedTask?.artifacts || [];
      const taskBusy = selectedTask && ["running", "queued"].includes(selectedTask.status);
      const canManageWt = Boolean(selectedTask?.isolated && !taskBusy && !selectedTask.worktreeCleaned && !selectedTask.worktreeAppliedAt);
      const canMergeWt = Boolean(canManageWt && artifacts.length > 0);
      const isolatedTasks = (view.state?.tasks || []).filter((t) => t.workspaceId === activeWs?.id && t.isolated && !t.worktreeCleaned && !t.archived);
      const fanoutSiblings = selectedTask?.fanoutId ? (view.state?.tasks || []).filter((t) => t.fanoutId === selectedTask.fanoutId && !t.archived) : [];
      bodyHtml = `<div class="orca-dock-pad">
        ${selectedTask ? `<div class="orca-dock-actions-grid">
          ${selectedTask.status !== "queued" ? `<button type="button" class="button quiet small" data-action="show-diff" data-id="${esc(selectedTask.id)}">${icon("file-text", 13)}<span>Diff & Review (${artifacts.length})</span></button>` : ""}
          <button type="button" class="button quiet small" data-action="open-task-flow" data-id="${esc(selectedTask.id)}">${icon("workflow", 13)}<span>Luồng</span></button>
          <button type="button" class="button quiet small" data-action="open-github-create-pr" data-id="${esc(selectedTask.id)}">${icon("git-branch", 13)}<span>Tạo Pull Request</span></button>
          <button type="button" class="button quiet small" data-action="open-github-issues" data-workspace-id="${esc(activeWs?.id || "")}">${icon("arrow-up-right", 13)}<span>GitHub Issues</span></button>
          ${canMergeWt ? `<button type="button" class="button primary small" data-action="apply-worktree" data-id="${esc(selectedTask.id)}">${icon("check", 13)}<span>Gộp vào dự án</span></button>` : ""}
          ${canManageWt ? `<button type="button" class="button quiet small" data-action="discard-worktree" data-id="${esc(selectedTask.id)}">${icon("delete", 13)}<span>Hủy worktree</span></button>` : ""}
        </div>` : ""}
        ${selectedTask && !taskBusy && artifacts.length > 0 ? `<div class="orca-git-commit-box">
          <div class="orca-section-label">COMMIT NHANH GIT (${selectedTask.isolated && !selectedTask.worktreeCleaned ? "WORKTREE" : "DỰ ÁN"})</div>
          <div class="orca-inline-input-row">
            <input type="text" data-git-commit-msg placeholder="feat: lưu thay đổi của task…" value="${esc(selectedTask.code ? `${selectedTask.code}: ${selectedTask.title.slice(0, 48)}` : `feat: ${selectedTask.title.slice(0, 52)}`)}" autocomplete="off">
            <button type="button" class="button primary small" data-action="task-git-commit" data-id="${esc(selectedTask.id)}">${icon("check", 12)}<span>Commit</span></button>
          </div>
          ${selectedTask.lastCommitAt ? `<small class="orca-muted-note">Đã commit lúc ${fmtDate(selectedTask.lastCommitAt)}: <code>${esc(selectedTask.lastCommitMessage || "")}</code></small>` : ""}
          ${selectedTask.pullRequestUrl ? `<small class="orca-muted-note" style="display:block;margin-top:4px"><a href="${esc(selectedTask.pullRequestUrl)}" target="_blank" rel="noopener">PR: ${esc(selectedTask.pullRequestUrl)}</a></small>` : ""}
        </div>` : ""}
        ${fanoutSiblings.length > 1 ? `<div class="orca-section-head" style="margin-top:8px">
          <span class="orca-section-label">ĐA LUỒNG (${fanoutSiblings.length})</span>
          <button type="button" class="button quiet small" data-action="compare-fanout" data-fanout-id="${esc(selectedTask.fanoutId)}">So sánh</button>
        </div>
        <ul class="orca-tree-list">${fanoutSiblings.map((t) => {
          const compName = t.fanoutCompetitor?.name || t.fanoutLabel || t.title;
          return `<li class="orca-tree-item is-file ${t.id === selectedTask.id ? "is-selected" : ""}"><button type="button" class="orca-tree-row ${t.id === selectedTask.id ? "is-selected" : ""}" style="padding-left:10px" data-task="${esc(t.id)}"><span class="wb-task-dot is-${esc(t.status || "done")}"></span><span class="orca-tree-label">${esc(compName)}</span><small class="orca-tree-badge">${(t.artifacts || []).length}</small></button></li>`;
        }).join("")}</ul>` : ""}
        <div class="orca-section-label" style="margin-top:8px">TỆP THAY ĐỔI (${artifacts.length})</div>
        ${artifacts.length
          ? `<ul class="orca-tree-list">${artifacts.map((filePath) => `<li class="orca-tree-item is-file"><button type="button" class="orca-tree-row" style="padding-left:10px" data-action="open-diff-file" data-id="${esc(selectedTask.id)}" data-path="${esc(filePath)}" title="${esc(filePath)}"><span class="orca-tree-icon">${icon("file-text", 14)}</span><span class="orca-tree-label">${esc(filePath)}</span><small class="orca-diff-dot">M</small></button></li>`).join("")}</ul>`
          : `<p class="orca-muted-note">${selectedTask ? "Chưa có tệp thay đổi nào trong phiên này." : "Chọn một cuộc trò chuyện để xem danh sách tệp thay đổi."}</p>`}
        ${isolatedTasks.length ? `<div class="orca-section-label" style="margin-top:14px">WORKTREE CÔ LẬP (${isolatedTasks.length})</div>
        <ul class="orca-tree-list">${isolatedTasks.slice(0, 10).map((t) => `<li class="orca-tree-item is-file"><button type="button" class="orca-tree-row" style="padding-left:10px" data-task="${esc(t.id)}"><span class="orca-tree-icon">${icon("git-branch", 14)}</span><span class="orca-tree-label">${esc(t.title)}</span><small class="orca-tree-badge">${(t.artifacts || []).length}</small></button></li>`).join("")}</ul>` : ""}
      </div>`;
    }
  } else if (tab === "docs" && selectedTask) {
    const stepper = pipelineStepperData(selectedTask);
    const docs = stepper.stageDocuments || [];
    const activeStageTab = (view.stageTabs || []).find((t) => t.id === view.activeStageTabId);
    bodyHtml = `<div class="orca-dock-pad">
      <div class="orca-section-head">
        <span class="orca-section-label">TÀI LIỆU GIAI ĐOẠN (${docs.length})</span>
        <small class="orca-tree-badge">${esc(selectedTask.code || "TASK")} · Vòng ${stepper.currentRound}/${stepper.maxRounds}</small>
      </div>
      <p class="orca-muted-note">Nhấn vào bất kỳ tài liệu giai đoạn nào để mở ở khung bên trái (hỗ trợ xem Markdown, mã nguồn và gắn nhận xét theo dòng).</p>
      <ul class="orca-tree-list" style="margin-top:8px">
        ${docs.map((doc) => {
          const tabId = `doc::${selectedTask.id}::${doc.id}`;
          const isSelected = activeStageTab?.id === tabId;
          return `<li class="orca-tree-item is-file ${isSelected ? "is-selected" : ""}">
            <button type="button" class="orca-tree-row ${isSelected ? "is-selected" : ""}" style="padding-left:10px" data-action="open-stage-doc" data-id="${esc(selectedTask.id)}" data-doc-id="${esc(doc.id)}">
              <span class="orca-tree-icon">${icon(doc.ready ? "file-text" : "circle-dot", 14)}</span>
              <span class="orca-tree-label"><strong>${esc(doc.group)}</strong> · ${esc(doc.title)}</span>
              <small class="orca-tree-badge ${doc.ready ? "is-ready" : ""}">${doc.ready ? "Sẵn sàng" : "Chờ"}</small>
            </button>
          </li>`;
        }).join("")}
      </ul>
      ${stepper.findings.blocking > 0 || stepper.findings.advisory > 0 ? `<div class="orca-section-label" style="margin-top:14px">KẾT QUẢ ĐÁNH GIÁ</div>
      <div class="mc-findings-summary">
        <span class="mc-badge is-blocking">${stepper.findings.blocking} lỗi chặn</span>
        <span class="mc-badge is-advisory">${stepper.findings.advisory} góp ý</span>
        ${stepper.costUsd > 0 ? `<span class="mc-badge is-cost">$${stepper.costUsd.toFixed(2)}</span>` : ""}
      </div>` : ""}
    </div>`;
  } else if (tab === "terminal") {
    const qaRes = selectedTask?.qaResult || null;
    const termHistory = selectedTask?.terminalHistory || [];
    const defaultCmd = selectedTask?.qaCommand || "npm test";
    const presetCommands = ["npm test", "npm run build", "npm run lint", "npm run check", "git status", "git diff --stat"];
    bodyHtml = `<div class="orca-dock-pad">
      <div class="orca-section-label">XEM TRỰC TIẾP MÁY CHỦ CỤC BỘ (LOCALHOST)</div>
      <p class="orca-muted-note">Mở ứng dụng web đang chạy cục bộ (localhost) ngay trong khung xem kèm công cụ chọn phần tử giao diện.</p>
      <div class="orca-inline-input-row" style="margin-top:6px">
        <input type="url" data-live-url-input placeholder="http://localhost:3000" value="${esc(view.lastLiveUrl || "http://localhost:3000")}" autocomplete="off" spellcheck="false">
        <button type="button" class="button primary small" data-action="open-live-url" data-id="${esc(selectedTask?.id || "")}">${icon("globe", 12)}<span>Mở</span></button>
      </div>
      <div class="orca-quick-pills" style="margin-top:6px">
        ${[3000, 5173, 4173, 8080].map((port) => `<button type="button" class="kb-tag-chip" data-action="open-live-url" data-url="http://localhost:${port}" data-id="${esc(selectedTask?.id || "")}">:${port}</button>`).join("")}
      </div>
      ${selectedTask ? `
        <div class="orca-section-head" style="margin-top:16px">
          <span class="orca-section-label">CHẠY KIỂM THỬ QA & LỆNH TERMINAL (${selectedTask.isolated && !selectedTask.worktreeCleaned ? "WORKTREE" : "DỰ ÁN"})</span>
          ${qaRes ? `<span class="mc-badge is-${qaRes.status === "passed" ? "passed" : "blocking"}">${qaRes.status === "passed" ? "ĐẠT" : `MÃ LỖI ${qaRes.code ?? 1}`}</span>` : ""}
        </div>
        <div class="orca-inline-input-row" style="margin-top:6px">
          <input type="text" data-task-qa-cmd value="${esc(defaultCmd)}" placeholder="npm test, pytest, cargo test…" autocomplete="off" spellcheck="false">
          <button type="button" class="button primary small" data-action="run-task-qa" data-id="${esc(selectedTask.id)}">${icon("square-terminal", 12)}<span>Chạy</span></button>
        </div>
        <div class="orca-quick-pills" style="margin-top:6px">
          ${presetCommands.map((cmd) => `<button type="button" class="kb-tag-chip" data-action="run-task-qa" data-id="${esc(selectedTask.id)}" data-command="${esc(cmd)}">${esc(cmd)}</button>`).join("")}
        </div>
        ${qaRes ? `<div class="orca-terminal-box" style="margin-top:10px">
          <header><code>$ ${esc(qaRes.command)}</code><small>${qaRes.durationSec}s · ${qaRes.status === "passed" ? "Thành công" : "Thất bại"}</small></header>
          <pre>${esc(String(qaRes.output || "(Không có đầu ra)").slice(-3500))}</pre>
          <footer style="margin-top:6px;display:flex;justify-content:flex-end">
            <button type="button" class="button quiet small" data-action="open-stage-doc" data-id="${esc(selectedTask.id)}" data-doc-id="qa">${icon("book-open-text", 12)}<span>Mở báo cáo QA</span></button>
          </footer>
        </div>` : ""}
        ${termHistory.length > 1 ? `<div class="orca-section-label" style="margin-top:12px">LỊCH SỬ LỆNH (${termHistory.length})</div>
        <ul class="orca-tree-list">${termHistory.slice(0, 6).map((h) => `<li class="orca-tree-item is-file"><button type="button" class="orca-tree-row" style="padding-left:8px" data-action="run-task-qa" data-id="${esc(selectedTask.id)}" data-command="${esc(h.command)}"><span class="orca-tree-icon">${icon(h.status === "passed" ? "check" : "x", 13)}</span><span class="orca-tree-label"><code>${esc(h.command)}</code></span><small class="orca-tree-badge">${h.durationSec}s</small></button></li>`).join("")}</ul>` : ""}
      ` : `<p class="orca-muted-note" style="margin-top:14px">Chọn một task để chạy kiểm thử QA hoặc lệnh Git trực tiếp trong worktree.</p>`}
    </div>`;
  } else if (tab === "tasks") {
    if (page === "knowledge" && view.vaultPreview?.content) {
      const outline = extractMarkdownOutline(view.vaultPreview.content);
      bodyHtml = `<div class="orca-dock-pad">
        <div class="orca-section-label">MỤC LỤC GHI CHÚ (${outline.length})</div>
        ${outline.length
          ? `<ul class="orca-tree-list">${outline.map((item) => `<li class="orca-tree-item is-file"><button type="button" class="orca-tree-row" style="padding-left:${8 + (item.level - 1) * 10}px" data-action="vault-scroll-heading" data-heading-index="${item.index}"><span class="orca-tree-label">${esc(item.text)}</span></button></li>`).join("")}</ul>`
          : `<p class="orca-muted-note">Thêm tiêu đề <code># H1</code>, <code>## H2</code> để tạo mục lục tự động.</p>`}
      </div>`;
    } else if (selectedTask) {
      const checklist = selectedTask.goalChecklist || [];
      const totalUsage = Object.values(selectedTask.usage || {}).reduce((sum, item) => sum + tokenCount(item), 0);
      const taskBusy = ["running", "queued"].includes(selectedTask.status);
      const artifactsCount = (selectedTask.artifacts || []).length;
      const permLabel = selectedTask.permissionPreset === "read-only" ? "Chỉ đọc" : selectedTask.permissionPreset === "full-access" ? "Toàn quyền máy" : "Sửa workspace";
      bodyHtml = `<div class="orca-dock-pad">
        <div class="orca-section-label">THÔNG TIN & CÔNG CỤ PHIÊN</div>
        <p class="orca-muted-note">${esc(statuses[selectedTask.status] || selectedTask.status)} · ${fmtDate(selectedTask.createdAt)}${totalUsage ? ` · ${formatNumber(totalUsage)} tok` : ""} · ${esc(permLabel)}</p>
        <div class="orca-dock-actions-grid">
          ${selectedTask.status !== "queued" ? `<button type="button" class="button quiet small" data-action="show-diff" data-id="${esc(selectedTask.id)}">${icon("file-text", 13)}<span>Diff & Review (${artifactsCount})</span></button>` : ""}
          <button type="button" class="button quiet small" data-action="open-task-flow" data-id="${esc(selectedTask.id)}">${icon("workflow", 13)}<span>Luồng</span></button>
          <button type="button" class="button quiet small" data-action="task-permissions" data-id="${esc(selectedTask.id)}">${icon("shield", 13)}<span>Quyền</span></button>
          <button type="button" class="button quiet small" data-action="edit-task-goal" data-id="${esc(selectedTask.id)}">${icon("target", 13)}<span>Mục tiêu</span></button>
          <button type="button" class="button quiet small" data-action="open-folder" data-id="${esc(selectedTask.id)}">${icon("folder-open", 13)}<span>Mở thư mục</span></button>
          ${taskBusy ? `<button type="button" class="button danger small" data-action="stop-task" data-id="${esc(selectedTask.id)}">${icon("square", 12)}<span>Dừng</span></button>` : ""}
        </div>
        <div class="orca-section-head" style="margin-top:12px">
          <span class="orca-section-label">MỤC TIÊU & CHECKLIST (${checklist.length})</span>
          <button type="button" class="icon-button" data-action="edit-task-goal" data-id="${esc(selectedTask.id)}" title="Sửa mục tiêu">${icon("square-pen", 13)}</button>
        </div>
        ${selectedTask.goal ? `<p class="orca-goal-text">${esc(selectedTask.goal)}</p>` : ""}
        ${checklist.length
          ? `<ul class="orca-checklist">${checklist.map((item) => `<li><label><input type="checkbox" data-action="toggle-goal-item" data-id="${esc(selectedTask.id)}" data-goal-id="${esc(item.id)}" ${item.done ? "checked" : ""}><span class="${item.done ? "is-done" : ""}">${esc(item.text)}</span></label></li>`).join("")}</ul>`
          : `<p class="orca-muted-note">Chưa có checklist nghiệm thu.</p><button type="button" class="button quiet small" data-action="edit-task-goal" data-id="${esc(selectedTask.id)}">${icon("plus", 12)}<span>Thêm checklist</span></button>`}
      </div>`;
    }
  }

  return `<div class="orca-dock-resizer" data-right-dock-resizer title="Kéo để thay đổi độ rộng thanh bên phải"></div>
  <header class="orca-dock-topbar">
    <div class="orca-dock-tabs" role="tablist" aria-label="Công cụ thanh bên phải">
      ${availableTabs.map((item) => `<button type="button" class="orca-dock-tab ${tab === item.id ? "is-active" : ""}" data-action="right-dock-tab" data-tab="${esc(item.id)}" title="${esc(item.title)}">${icon(item.icon, 16)}</button>`).join("")}
    </div>
    <button type="button" class="icon-button orca-dock-toggle" data-action="toggle-chat-drawer" title="Đóng thanh bên phải">${icon("sidebar-right", 16)}</button>
  </header>
  <div class="orca-dock-subheader">
    <strong class="orca-dock-title" title="${esc(subTooltip || subTitle)}">${esc(subTitle)}</strong>
    <div class="orca-dock-subactions">
      <button type="button" class="icon-button orca-sub-btn" data-action="${refreshAction}" title="Làm mới">${icon("refresh-cw", 14)}</button>
      ${moreMenuHtml}
    </div>
  </div>
  <div class="orca-dock-body">
    ${bodyHtml}
  </div>`;
}
