import { $, esc, fmtDate, icon, view } from "../../shared/state.js";
import { roleConfig } from "../../domain/agent-roles.js";
import { localizeDom, setLanguage } from "../../shared/i18n.js";
import { applyThemeToDom, setSavedThemeId } from "../../shared/themes.js";
import { api, closeOverlay, ensureSubagentProfiles, render, showToast } from "./runtime.js";
import { openSchedulesModal } from "./schedules-modal.js";
import { openTaskModal, showMemoryModal } from "./modals.js";
import { loadWorkspaceDir } from "./pages/tasks-workspaces-page.js";
import { ensureSkillDetail, ensureSubagentProfileDetail, loadVaultDir } from "./pages/knowledge-skills-page.js";

let searchDebounceTimer = 0;
let activeSearchSeq = 0;
let flatPaletteItems = [];

function buildQuickCommands(query = "") {
  const q = String(query || "").trim().toLocaleLowerCase();
  const commands = [
    {
      uid: "cmd:new-chat",
      group: "command",
      iconName: "square-pen",
      title: "Cuộc trò chuyện mới",
      subtitle: "Mở khung soạn thảo mới trong không gian Chat",
      keywords: "new chat trò chuyện mới tạo chat",
      run: () => {
        view.navOriginPage = null;
        view.page = "chat";
        view.mobileScreen = "home";
        view.mpSessionTab = "chat";
        view.selected = null;
        view.selectedTaskId = null;
        view.chatDraft = view.chatDraftsByTask?.__new__ || "";
        render();
        requestAnimationFrame(() => $("[data-home-prompt]")?.focus({ preventScroll: true }));
      },
    },
    {
      uid: "cmd:new-task",
      group: "command",
      iconName: "plus",
      title: "Tạo công việc mới",
      subtitle: "Giao việc theo luồng Kế hoạch → Viết code → Review",
      keywords: "new task tạo việc giao việc pipeline",
      run: () => {
        openTaskModal();
      },
    },
    {
      uid: "cmd:schedules",
      group: "command",
      iconName: "calendar",
      title: "Lịch chạy tự động (Schedules)",
      subtitle: "Tạo hoặc kích hoạt công việc định kỳ trên nhánh Git Worktree",
      keywords: "schedule cron lịch chạy tự động định kỳ worktree",
      run: () => {
        openSchedulesModal();
      },
    },
    {
      uid: "cmd:pin-user-memory",
      group: "command",
      iconName: "pin",
      title: "Ghim quy tắc cá nhân USER.md",
      subtitle: "Lưu quy tắc cố định luôn nạp vào mọi phiên làm việc (Tier-1)",
      keywords: "user.md memory pin ghim quy tắc cá nhân bộ nhớ",
      run: () => {
        showMemoryModal({ kind: "user-profile", pinned: true, workspaceId: "all" });
      },
    },
    {
      uid: "cmd:toggle-theme",
      group: "command",
      iconName: view.theme === "daylight" ? "moon" : "sun",
      title: "Đổi giao diện Sáng / Tối",
      subtitle: `Đang dùng: ${view.theme || "obsidian"}`,
      keywords: "theme dark light giao diện sáng tối màu sắc",
      run: () => {
        const nextTheme = view.theme === "daylight" ? "obsidian" : "daylight";
        view.theme = setSavedThemeId(nextTheme);
        applyThemeToDom(view.theme);
        render();
        showToast(nextTheme === "daylight" ? "Đã chuyển sang giao diện Sáng." : "Đã chuyển sang giao diện Tối.");
      },
    },
    {
      uid: "cmd:toggle-language",
      group: "command",
      iconName: "globe",
      title: view.language === "en" ? "Chuyển sang Tiếng Việt (VI)" : "Switch language to English (EN)",
      subtitle: `Ngôn ngữ hiện tại: ${view.language === "en" ? "English" : "Tiếng Việt"}`,
      keywords: "language ngôn ngữ tiếng việt english vi en",
      run: () => {
        view.language = setLanguage(view.language === "en" ? "vi" : "en");
        view.renderedLanguage = "";
        render();
      },
    },
    {
      uid: "nav:chat",
      group: "nav",
      iconName: "message-circle",
      title: "Đi tới Không gian Chat",
      subtitle: "Trò chuyện, điều phối đa luồng Arena và xem Diff trực tiếp",
      keywords: "navigate chat không gian trò chuyện",
      run: () => navigateFromPalette("chat"),
    },
    {
      uid: "nav:tasks",
      group: "nav",
      iconName: "list-checks",
      title: "Đi tới Công việc",
      subtitle: "Danh sách công việc, bộ lọc trạng thái và biểu đồ 24 giờ",
      keywords: "navigate tasks công việc danh sách",
      run: () => navigateFromPalette("tasks"),
    },
    {
      uid: "nav:flows",
      group: "nav",
      iconName: "workflow",
      title: "Đi tới Tiến trình (Flows)",
      subtitle: "Bảng điều hành 6 trạm, duyệt kế hoạch và chạy theo đợt (Wave DAG)",
      keywords: "navigate flows tiến trình luồng wave",
      run: () => navigateFromPalette("flows"),
    },
    {
      uid: "nav:workspaces",
      group: "nav",
      iconName: "folder-code",
      title: "Đi tới Dự án (Workspaces)",
      subtitle: "Quản lý kho mã nguồn cục bộ và trạng thái nhánh Git",
      keywords: "navigate workspaces projects dự án kho mã",
      run: () => navigateFromPalette("workspaces"),
    },
    {
      uid: "nav:knowledge",
      group: "nav",
      iconName: "book-open-text",
      title: "Đi tới Tri thức (Obsidian Vault)",
      subtitle: "Đọc/sửa ghi chú Markdown và đồ thị liên kết hai chiều",
      keywords: "navigate knowledge vault obsidian tri thức ghi chú",
      run: () => navigateFromPalette("knowledge"),
    },
    {
      uid: "nav:skills",
      group: "nav",
      iconName: "notebook-tabs",
      title: "Đi tới Kỹ năng & Hồ sơ Subagent",
      subtitle: "Quản lý SKILL.md và vai trò Subagent chuyên biệt",
      keywords: "navigate skills subagents kỹ năng hồ sơ",
      run: () => navigateFromPalette("skills"),
    },
    {
      uid: "nav:memory",
      group: "nav",
      iconName: "brain",
      title: "Đi tới Bộ nhớ (USER.md & MEMORY.md)",
      subtitle: "Xem quy tắc cá nhân đã ghim, lỗi cần tránh và bài học dự án",
      keywords: "navigate memory bộ nhớ bài học pitfall",
      run: () => navigateFromPalette("memory"),
    },
    {
      uid: "nav:settings",
      group: "nav",
      iconName: "sliders-horizontal",
      title: "Đi tới Cài đặt & Hạn mức CLI",
      subtitle: "Chủ đề màu, model mặc định, hạn mức 5h/7d và kết nối điện thoại",
      keywords: "navigate settings cài đặt hạn mức quota cli lan",
      run: () => navigateFromPalette("settings"),
    },
  ];
  if (!q) return commands;
  return commands.filter((item) =>
    `${item.title} ${item.subtitle} ${item.keywords}`.toLocaleLowerCase().includes(q)
  );
}

function navigateFromPalette(nextPage) {
  view.navOriginPage = null;
  view.page = nextPage;
  view.mobileScreen = nextPage === "chat" ? (view.selectedTaskId ? "session" : "home") : "page";
  if (nextPage === "workspaces") {
    const wsId = view.selectedWorkspaceId || view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || null;
    view.selectedWorkspaceId = wsId;
    view.selected = wsId;
    render();
    if (wsId) void loadWorkspaceDir(wsId, view.workspaceDir || "");
    return;
  }
  if (nextPage === "chat") {
    view.selected = view.selectedTaskId || null;
    render();
    return;
  }
  view.selected = null;
  render();
  if (nextPage === "knowledge" && view.state?.settings?.vaultPath) {
    void loadVaultDir(view.vaultDir || "");
  } else if (nextPage === "skills") {
    const activeWsId = view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || "";
    void Promise.all([api("/api/skills"), ensureSubagentProfiles(activeWsId)]).then(([res]) => {
      if (res?.skills) {
        view.skills = res.skills;
        view.skillsLoaded = true;
      }
      render();
    }).catch(() => {});
  }
}

function selectTaskFromPalette(taskId, subagentId = "") {
  const targetTask = (view.state?.tasks || []).find((item) => item.id === taskId);
  if (!targetTask) {
    showToast("Không tìm thấy phiên công việc này.");
    return;
  }
  view.chatDraftsByTask ||= {};
  const prevKey = view.selectedTaskId || view.selected || "__new__";
  view.chatDraftsByTask[prevKey] = view.chatDraft;
  view.chatDraft = view.chatDraftsByTask[targetTask.id] || "";
  if (view.page !== "chat") view.navOriginPage = view.page;
  view.selectedTaskId = targetTask.id;
  view.selected = targetTask.id;
  view.page = "chat";
  view.mobileScreen = "session";
  view.mpSessionTab = "chat";
  view.homeWorkspaceId = targetTask.workspaceId || view.homeWorkspaceId;
  view.chatProvider = targetTask.config?.workflow === "chat-only"
    ? targetTask.config.chatProvider || "codex"
    : targetTask.config?.chatProvider || roleConfig(targetTask.config, "plan").provider || "codex";
  view.chatModel = targetTask.config?.workflow === "chat-only"
    ? targetTask.config.chatModel || ""
    : targetTask.config?.chatModel || roleConfig(targetTask.config, "plan").model || "";
  view.chatEffort = targetTask.config?.workflow === "chat-only"
    ? targetTask.config.chatEffort || ""
    : targetTask.config?.chatEffort || roleConfig(targetTask.config, "plan").effort || "";
  if (subagentId) {
    view.chatDrawerOpen = true;
    view.chatDrawerTab = "subagents";
    view.selectedDockSubagentId = subagentId;
  }
  render();
}

function normalizeSearchHits(payload, query) {
  const rawList = Array.isArray(payload?.results)
    ? payload.results
    : Array.isArray(payload?.hits)
      ? payload.hits
      : Array.isArray(payload?.items)
        ? payload.items
        : [];
  const items = [];
  for (const hit of rawList) {
    if (!hit || typeof hit !== "object") continue;
    const rawScope = String(hit.scope || hit.kind || hit.type || "task").toLowerCase();
    const scope = ["task", "chat", "memory", "skill", "subagent"].includes(rawScope) ? rawScope : "task";
    const entityId = String(hit.id || hit.entityId || "");
    const taskId = String(hit.taskId || hit.parentId || (scope === "task" || scope === "chat" ? entityId : ""));
    const snippet = String(hit.snippet || hit.excerpt || hit.summary || hit.description || hit.content || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140);
    const title = String(hit.title || hit.name || hit.role || entityId || "Kết quả").trim();
    const iconMap = {
      task: "workflow",
      chat: "message-circle",
      memory: "brain",
      skill: "notebook-tabs",
      subagent: "waypoints",
    };
    items.push({
      uid: `hit:${scope}:${entityId || taskId}:${items.length}`,
      group: scope,
      iconName: iconMap[scope] || "search",
      title,
      subtitle: snippet || (hit.updatedAt ? fmtDate(hit.updatedAt) : ""),
      run: () => {
        if (scope === "task" || scope === "chat") {
          selectTaskFromPalette(taskId || entityId);
          return;
        }
        if (scope === "subagent") {
          if (taskId) {
            selectTaskFromPalette(taskId, String(hit.subagentId || entityId || ""));
          } else {
            if (view.page !== "skills") view.navOriginPage = view.page;
            view.page = "skills";
            view.skillsSection = "subagents";
            view.selectedSubagentProfileId = entityId;
            if (entityId) void ensureSubagentProfileDetail(entityId);
            render();
          }
          return;
        }
        if (scope === "memory") {
          if (view.page !== "memory") view.navOriginPage = view.page;
          view.page = "memory";
          view.memoryWorkspaceFilter = "all";
          view.selected = null;
          render();
          return;
        }
        if (scope === "skill") {
          if (view.page !== "skills") view.navOriginPage = view.page;
          view.page = "skills";
          view.skillsSection = "skills";
          view.selectedSkillId = entityId;
          if (entityId) void ensureSkillDetail(entityId);
          render();
        }
      },
    });
  }

  const q = String(query || "").trim().toLocaleLowerCase();
  if (q && !items.length) {
    for (const task of (view.state?.tasks || []).filter((t) => !t.archived)) {
      if (`${task.title || ""} ${task.code || ""} ${task.prompt || ""}`.toLocaleLowerCase().includes(q)) {
        items.push({
          uid: `local-task:${task.id}`,
          group: "task",
          iconName: task.config?.workflow === "chat-only" ? "message-circle" : "workflow",
          title: task.title || task.code || "Task",
          subtitle: `${task.code ? `${task.code} · ` : ""}${fmtDate(task.updatedAt)}`,
          run: () => selectTaskFromPalette(task.id),
        });
        if (items.length >= 8) break;
      }
    }
  }
  return items;
}

function renderPaletteResultsMarkup() {
  const query = String(view.commandPaletteQuery || "").trim();
  const quickItems = buildQuickCommands(query);
  const searchHits = query ? normalizeSearchHits(view.commandPaletteResults, query) : [];

  const groupLabels = {
    task: "Công việc (FTS5)",
    chat: "Tin nhắn hội thoại (FTS5)",
    subagent: "Subagent (FTS5)",
    memory: "Bộ nhớ & Quy tắc (FTS5)",
    skill: "Kỹ năng (FTS5)",
    command: "Lệnh nhanh",
    nav: "Điều hướng trang",
  };
  const groupOrder = query
    ? ["task", "chat", "subagent", "memory", "skill", "command", "nav"]
    : ["command", "nav"];

  const allSource = query ? [...searchHits, ...quickItems] : quickItems;
  const ordered = [];
  const groupedHtml = [];

  for (const grp of groupOrder) {
    const bucket = allSource.filter((item) => item.group === grp);
    if (!bucket.length) continue;
    const rows = bucket.map((item) => {
      const idx = ordered.length;
      ordered.push(item);
      const active = idx === view.commandPaletteIndex;
      return `<button type="button" class="cmd-palette-item command-palette-item codex-pop-item ${active ? "is-active is-selected" : ""}" role="option" aria-selected="${active ? "true" : "false"}" data-action="exec-command-palette-item" data-palette-index="${idx}">
        <span class="command-palette-item-icon">${icon(item.iconName, 16)}</span>
        <span class="cmd-palette-item-main command-palette-item-body">
          <strong class="cmd-palette-item-title">${esc(item.title)}</strong>
          ${item.subtitle ? `<small class="cmd-palette-item-sub">${esc(item.subtitle)}</small>` : ""}
        </span>
        <span class="cmd-palette-item-meta command-palette-item-enter" aria-hidden="true">${icon("arrow-up-right", 14)}</span>
      </button>`;
    }).join("");
    groupedHtml.push(`<section class="cmd-palette-group command-palette-group">
      <div class="cmd-palette-group-title codex-pop-group-label command-palette-group-title">${esc(groupLabels[grp] || grp)}</div>
      <div class="command-palette-group-list">${rows}</div>
    </section>`);
  }

  flatPaletteItems = ordered;
  if (view.commandPaletteIndex >= flatPaletteItems.length) {
    view.commandPaletteIndex = Math.max(0, flatPaletteItems.length - 1);
  }

  if (view.commandPaletteLoading && !ordered.length) {
    return `<div class="cmd-palette-empty command-palette-empty"><p>Đang tìm kiếm trên chỉ mục FTS5…</p></div>`;
  }
  if (!ordered.length) {
    return `<div class="cmd-palette-empty command-palette-empty">
      ${icon("search", 20)}
      <strong>Không tìm thấy kết quả phù hợp</strong>
      <p>Thử tìm theo tên công việc, nội dung hội thoại, quy tắc bộ nhớ hoặc kỹ năng.</p>
    </div>`;
  }
  return groupedHtml.join("");
}

function updatePaletteResultsDom() {
  const resultsEl = $("#overlay [data-command-palette-results]");
  if (!resultsEl) return;
  resultsEl.innerHTML = renderPaletteResultsMarkup();
  localizeDom(resultsEl, view.language);
  const activeItem = resultsEl.querySelector(".command-palette-item.is-selected");
  activeItem?.scrollIntoView({ block: "nearest" });
}

export function openCommandPalette(initialQuery = "") {
  clearTimeout(searchDebounceTimer);
  view.commandPaletteOpen = true;
  view.commandPaletteQuery = String(initialQuery || "");
  view.commandPaletteIndex = 0;
  view.commandPaletteResults = null;
  view.commandPaletteLoading = Boolean(view.commandPaletteQuery.trim());

  const overlay = $("#overlay");
  if (!overlay) return;
  overlay.hidden = false;
  overlay.innerHTML = `<div class="modal-backdrop cmd-palette-backdrop" data-action="close-command-palette"><div class="modal app-dialog-shell cmd-palette-modal command-palette-modal" role="dialog" aria-modal="true" aria-label="Tìm kiếm toàn cục và Bảng lệnh nhanh">
    <header class="cmd-palette-input-wrap command-palette-header">
      <span class="command-palette-search-icon">${icon("search", 16)}</span>
      <input
        type="search"
        class="command-palette-input"
        data-command-palette-input
        value="${esc(view.commandPaletteQuery)}"
        placeholder="Tìm kiếm công việc, hội thoại, bộ nhớ, kỹ năng hoặc gõ lệnh nhanh…"
        autocomplete="off"
        spellcheck="false"
      >
      <kbd class="command-palette-kbd">Esc</kbd>
      <button type="button" class="icon-button app-dialog-close" data-action="close-command-palette" aria-label="Đóng" title="Đóng">${icon("x", 16)}</button>
    </header>
    <div class="cmd-palette-results command-palette-results codex-pop-scroll" role="listbox" data-command-palette-results>
      ${renderPaletteResultsMarkup()}
    </div>
    <footer class="cmd-palette-footer command-palette-footer">
      <span><kbd>↑↓</kbd> Di chuyển</span>
      <span><kbd>Enter</kbd> Mở</span>
      <span><kbd>Ctrl+K</kbd> Đóng / Mở nhanh</span>
    </footer>
  </div></div>`;
  localizeDom(overlay, view.language);
  requestAnimationFrame(() => {
    const input = overlay.querySelector("[data-command-palette-input]");
    input?.focus({ preventScroll: true });
    if (input && input.value) {
      input.setSelectionRange(input.value.length, input.value.length);
      triggerPaletteSearch(input.value);
    }
  });
}

export function closeCommandPalette() {
  clearTimeout(searchDebounceTimer);
  activeSearchSeq += 1;
  view.commandPaletteOpen = false;
  view.commandPaletteLoading = false;
  flatPaletteItems = [];
  closeOverlay();
}

export function toggleCommandPalette() {
  if (view.commandPaletteOpen && !$("#overlay")?.hidden && $("#overlay [data-command-palette-input]")) {
    closeCommandPalette();
    return;
  }
  openCommandPalette("");
}

function triggerPaletteSearch(rawQuery) {
  clearTimeout(searchDebounceTimer);
  const query = String(rawQuery || "").trim();
  if (!query) {
    activeSearchSeq += 1;
    view.commandPaletteResults = null;
    view.commandPaletteLoading = false;
    updatePaletteResultsDom();
    return;
  }
  view.commandPaletteLoading = true;
  updatePaletteResultsDom();
  const seq = ++activeSearchSeq;
  searchDebounceTimer = window.setTimeout(async () => {
    try {
      const res = await api(`/api/search?q=${encodeURIComponent(query)}&limit=24`);
      if (seq !== activeSearchSeq || !view.commandPaletteOpen) return;
      view.commandPaletteResults = res;
      view.commandPaletteLoading = false;
      view.commandPaletteIndex = 0;
      updatePaletteResultsDom();
    } catch {
      if (seq !== activeSearchSeq || !view.commandPaletteOpen) return;
      view.commandPaletteResults = { results: [] };
      view.commandPaletteLoading = false;
      updatePaletteResultsDom();
    }
  }, 150);
}

export function handleCommandPaletteInput(inputEl) {
  view.commandPaletteQuery = inputEl.value;
  view.commandPaletteIndex = 0;
  triggerPaletteSearch(inputEl.value);
}

export function executeCommandPaletteIndex(index) {
  const item = flatPaletteItems[index];
  if (!item || typeof item.run !== "function") return false;
  closeCommandPalette();
  item.run();
  return true;
}

export function handleCommandPaletteKeydown(event) {
  if (!view.commandPaletteOpen || $("#overlay")?.hidden || !$("#overlay [data-command-palette-input]")) {
    return false;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    closeCommandPalette();
    return true;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (flatPaletteItems.length > 0) {
      view.commandPaletteIndex = (view.commandPaletteIndex + 1) % flatPaletteItems.length;
      updatePaletteResultsDom();
    }
    return true;
  }
  if (event.key === "ArrowUp") {
    event.preventDefault();
    if (flatPaletteItems.length > 0) {
      view.commandPaletteIndex = (view.commandPaletteIndex - 1 + flatPaletteItems.length) % flatPaletteItems.length;
      updatePaletteResultsDom();
    }
    return true;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    executeCommandPaletteIndex(view.commandPaletteIndex);
    return true;
  }
  return false;
}
