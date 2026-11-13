import { $, setBoundedCache, view } from "../../shared/state.js";
import { roleConfig } from "../../domain/agent-roles.js";
import { localizeDom } from "../../shared/i18n.js";
import { applyThemeToDom } from "../../shared/themes.js";
import { updateWorkbenchShell } from "../../shell/mount.jsx";
import { readBrowserRoute } from "../../shell/router.js";
import {
  getActiveRemoteHost,
  isMobileCompanionMode,
  parsePairingInput,
  probeRemoteHost,
  saveRemoteHostProfile,
  setActiveRemoteHost,
} from "../../shared/remote-host.js";
import {
  closeCommandPalette,
  handleCommandPaletteInput,
  handleCommandPaletteKeydown,
  toggleCommandPalette,
} from "./command-palette.js";
import { syncSchedulesFromServer } from "./schedules-modal.js";
import { syncTaskChatDraft } from "./actions/chat-task-actions.js";
import { markIframeInspectorBridgeReady, syncHtmlInspectUi } from "./html-inspector.js";
import { wrapStageWithOrcaTabs } from "./stage-viewer.js";
import { pageSupportsRightDock } from "./right-dock.js";
import {
  api,
  closeOverlay,
  connectEventStream,
  getRouteNeedsHydration,
  hydrateRouteData,
  markReplaceBrowserRoute,
  normalizeRouteSelection,
  refresh,
  registerRuntimeHooks,
  scheduleRefresh,
  setRouteNeedsHydration,
  showToast,
  startPeriodicRefresh,
  syncLocation,
} from "./runtime.js";
import {
  applySkillFilter,
  syncChatAgentFields,
  syncEffortForModel,
  syncIsolation,
  syncRolePicker,
  syncRolePickers,
  syncRoleProvider,
  syncTaskPresetControls,
  syncWorkflow,
} from "./ui-controls.js";
import {
  importContentFiles,
  resizeComposerTextarea,
  updateComposerMentionMenu,
} from "./composer.js";
import { orcaRightDockMarkup } from "./stage-tabs.js";
import { openTaskInstructionModal } from "./modals.js";
import {
  availableArenaCompetitors,
  chatPage,
  ensureHomeArenaSlots,
  homeSearchResults,
} from "./pages/chat-page.js";
import {
  attachChatOutlineListeners,
  updateChatOutline,
} from "./pages/chat-conversation.js";
import {
  loadWorkspaceDir,
  taskPage,
  workspacePage,
} from "./pages/tasks-workspaces-page.js";
import {
  knowledgePage,
  loadVaultDir,
  mountKnowledgeGraphCanvas,
  skillPage,
} from "./pages/knowledge-skills-page.js";
import {
  drawWaveDagEdges,
  memoryPage,
  workflowPage,
} from "./pages/flows-memory-page.js";
import {
  applySettingsSearch,
  settingsPage,
  settingsSidebarMarkup,
  showCliProviderModal,
} from "./pages/settings-page.js";
import { handleSubmit } from "./actions/form-submit.js";
import { handleWorkbenchClick } from "./actions/click-router.js";

Object.assign(view, readBrowserRoute());
if (view.page === "workspaces" && view.selected) {
  view.selectedWorkspaceId = view.selected;
} else if (view.selected && ["chat", "flows", "tasks"].includes(view.page)) {
  view.selectedTaskId = view.selected;
}
view.mobileScreen = "home";
const compactLayout = window.matchMedia("(max-width: 1020px)");
if (compactLayout.matches) view.chatDrawerOpen = false;
compactLayout.addEventListener("change", ({ matches }) => {
  if (matches) {
    view.chatDrawerOpen = false;
    view.stageSplit = false;
    render();
  }
});
document.documentElement.lang = view.language;
applyThemeToDom(view.theme);
if (window.opensybauDesktop?.isDesktop) document.documentElement.classList.add("desktop-glass");

function render({ background = false } = {}) {
  if (!view.state) return;
  if (view.page === "workspaces") {
    if (!view.workspaceOverviewMode && view.state.workspaces?.length) {
      const activeWs = view.state.workspaces.find((w) => w.id === (view.selectedWorkspaceId || view.selected))
        || view.state.workspaces.find((w) => w.id === view.homeWorkspaceId)
        || view.state.workspaces[0];
      if (activeWs) {
        if (view.selected !== activeWs.id) {
          view.selected = activeWs.id;
          view.workspaceDir = "";
          view.workspaceEntries = [];
          markReplaceBrowserRoute();
        }
        view.selectedWorkspaceId = activeWs.id;
        view.homeWorkspaceId = activeWs.id;
      }
    }
  } else if (view.page === "chat") {
    const candidateTaskId = view.selectedTaskId || view.selected || "";
    const validTask = candidateTaskId && view.state.tasks.some((t) => t.id === candidateTaskId)
      ? candidateTaskId
      : null;
    view.selectedTaskId = validTask;
    view.selected = validTask;
  }
  syncLocation();
  const pages = {
    chat: chatPage,
    tasks: taskPage,
    flows: workflowPage,
    workspaces: workspacePage,
    knowledge: knowledgePage,
    skills: skillPage,
    memory: memoryPage,
    settings: settingsPage,
  };
  const content = $("#content");
  const rightDockEl = document.querySelector(".orca-right-dock");
  const renderKey = `${view.page}:${view.selected || ""}`;
  const contentScroll = view.renderedPage === renderKey ? content.scrollTop : 0;

  const chatThreadScrolls = new Map();
  content?.querySelectorAll(".chat-thread")?.forEach((thread) => {
    const tId = thread.dataset.taskId || "";
    const key = thread.id || tId || "default";
    const atEnd = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 48;
    chatThreadScrolls.set(key, { top: thread.scrollTop, atEnd, taskId: tId });
  });
  const forceScrollAll = Boolean(view.forceChatScroll);
  view.forceChatScroll = false;

  const selectedTask = view.selected && view.state.tasks.some((task) => task.id === view.selected);
  const selectedWorkspace = view.page === "workspaces" && view.selected && view.state.workspaces.some((w) => w.id === view.selected);
  const openPops = new Map();
  content?.querySelectorAll(".codex-pop-menu[open][data-pop-id]")?.forEach((el) => {
    openPops.set(el.dataset.popId, el.querySelector(".codex-pop-scroll")?.scrollTop || 0);
  });

  const activeEl = document.activeElement;
  let activeInputDescriptor = null;
  if (activeEl && activeEl.matches?.("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea") && (content?.contains(activeEl) || rightDockEl?.contains(activeEl))) {
    const composerForm = activeEl.closest(".chat-composer")
      ? ".chat-composer"
      : activeEl.closest(".home-composer")
        ? ".home-composer"
        : "";
    const composerTaskId = activeEl.closest(".chat-composer")?.dataset.id || activeEl.closest(".multi-chat-pane")?.dataset.taskId || "";
    let selector = "";
    if (activeEl.hasAttribute("data-chat-drawer-filter")) selector = "[data-chat-drawer-filter]";
    else if (activeEl.hasAttribute("data-diff-branch-search")) selector = "[data-diff-branch-search]";
    else if (activeEl.hasAttribute("data-vault-editor")) selector = "[data-vault-editor]";
    else if (activeEl.hasAttribute("data-skill-inline-editor")) selector = "[data-skill-inline-editor]";
    else if (activeEl.hasAttribute("data-stage-line-comment-input")) selector = "[data-stage-line-comment-input]";
    else if (activeEl.hasAttribute("data-html-element-comment-input")) selector = "[data-html-element-comment-input]";
    else if (activeEl.dataset?.fileFilter) selector = `[data-file-filter="${CSS.escape(activeEl.dataset.fileFilter)}"]`;
    else if (activeEl.dataset?.skillFilter) selector = `[data-skill-filter="${CSS.escape(activeEl.dataset.skillFilter)}"]`;
    else if (activeEl.id) selector = `#${CSS.escape(activeEl.id)}`;
    else if (activeEl.name) selector = `${activeEl.tagName.toLowerCase()}[name="${CSS.escape(activeEl.name)}"]`;
    activeInputDescriptor = {
      inDock: Boolean(rightDockEl?.contains(activeEl)),
      composerForm,
      composerTaskId,
      name: activeEl.name || "",
      selector,
      value: activeEl.value,
      selection: typeof activeEl.selectionStart === "number" ? [activeEl.selectionStart, activeEl.selectionEnd] : null,
    };
  }

  const rawPageMarkup = (pages[view.page] || taskPage)();
  const pageMarkup = wrapStageWithOrcaTabs(rawPageMarkup);
  const isRightDockOpen = pageSupportsRightDock(view.page) && (view.page === "chat" ? Boolean(view.chatDrawerOpen) : Boolean(view.homeDockOpen ?? view.chatDrawerOpen));
  const rightDockMarkup = isRightDockOpen ? orcaRightDockMarkup() : "";
  const searchResults = view.searchQuery ? homeSearchResults(view.searchQuery) : "";
  view.searchResults = searchResults;
  const pageSidebarMarkup = view.page === "settings" ? settingsSidebarMarkup() : "";
  const attentionTasks = (view.state.tasks || [])
    .filter((t) => !t.archived && (
      t.status === "awaiting_approval"
      || (Array.isArray(t.pendingApprovals) && t.pendingApprovals.length > 0)
      || t.status === "failed"
    ))
    .sort((a, b) => Date.parse(b.updatedAt || b.createdAt || "") - Date.parse(a.updatedAt || a.createdAt || ""))
    .slice(0, 8);
  updateWorkbenchShell({
    backgroundUpdate: background,
    page: view.page,
    language: view.language,
    theme: view.theme,
    state: view.state,
    connectors: view.connectors,
    quotas: view.quotas,
    quotasLoading: Boolean(view.quotasLoading),
    desktopSetupOpen: view.desktopSetupOpen,
    cliInstallProvider: view.cliInstallProvider,
    skills: view.skills,
    selected: (selectedTask || selectedWorkspace) ? view.selected : null,
    selectedTaskId: view.selectedTaskId || null,
    selectedWorkspaceId: view.selectedWorkspaceId || null,
    homeWorkspaceId: view.homeWorkspaceId,
    searchQuery: view.searchQuery,
    searchResults,
    collapsedWorkspaces: view.collapsedWorkspaces,
    collapsedFanouts: view.collapsedFanouts,
    projectMenuId: view.projectMenuId,
    taskMenuId: view.taskMenuId,
    streamConnected: view.streamConnected,
    activeRemoteHostName: getActiveRemoteHost()?.name || "",
    connectionInfo: view.connectionInfo || null,
    isMobileCompanion: isMobileCompanionMode(),
    sidebarCollapsed: Boolean(view.sidebarCollapsed),
    mobileScreen: view.mobileScreen || "home",
    mpSessionTab: view.mpSessionTab || "chat",
    mpWlFilter: view.mpWlFilter || "all",
    mpWlRepo: view.mpWlRepo || "all",
    mpWlSearchOpen: Boolean(view.mpWlSearchOpen),
    mpWlSearchQuery: view.mpWlSearchQuery || "",
    attentionTasks,
    chatDrawerOpen: view.chatDrawerOpen,
    chatDrawerTab: view.chatDrawerTab || "files",
    rightDockMarkup,
    pageSidebarMarkup,
    stageTabs: view.stageTabs || [],
    activeStageTabId: view.activeStageTabId || "chat",
    stageSplit: Boolean(view.stageSplit),
    chatSplitWorkspaceId: view.chatSplitWorkspaceId,
    chatSplitTaskIds: view.chatSplitTaskIds,
    chatSplitActiveTaskId: view.chatSplitActiveTaskId,
  }, pageMarkup);
  if (view.renderedLanguage !== view.language) {
    view.renderedLanguage = view.language;
    localizeDom(document.querySelector("#root"), view.language);
  }
  const overlay = $("#overlay");
  if (overlay && overlay.children.length > 0) {
    localizeDom(overlay, view.language);
  }
  const nextContent = $("#content");
  nextContent.scrollTop = contentScroll;
  view.renderedPage = renderKey;
  if (openPops.size) {
    for (const [popId, popScroll] of openPops) {
      const nextPop = $(`.codex-pop-menu[data-pop-id="${popId}"]`, nextContent);
      if (nextPop) {
        nextPop.open = true;
        const scroller = nextPop.querySelector(".codex-pop-scroll");
        if (scroller && popScroll) scroller.scrollTop = popScroll;
      }
    }
  }
  nextContent.querySelectorAll(".chat-thread").forEach((nextThread) => {
    const tId = nextThread.dataset.taskId || "";
    const key = nextThread.id || tId || "default";
    const prev = chatThreadScrolls.get(key);
    const taskChanged = prev && prev.taskId !== tId;
    const shouldScrollEnd = Boolean(forceScrollAll || !prev || taskChanged || prev.atEnd);
    nextThread.scrollTop = shouldScrollEnd ? nextThread.scrollHeight : prev.top;
  });
  updateChatOutline();
  if (activeInputDescriptor) {
    const scopeRoot = activeInputDescriptor.inDock ? document.querySelector(".orca-right-dock") : nextContent;
    let nextInput = null;
    if (activeInputDescriptor.composerForm && activeInputDescriptor.name) {
      const nextComposer = activeInputDescriptor.composerTaskId
        ? scopeRoot?.querySelector(`${activeInputDescriptor.composerForm}[data-id="${CSS.escape(activeInputDescriptor.composerTaskId)}"]`) || scopeRoot?.querySelector(`.multi-chat-pane[data-task-id="${CSS.escape(activeInputDescriptor.composerTaskId)}"] ${activeInputDescriptor.composerForm}`)
        : $(activeInputDescriptor.composerForm, scopeRoot);
      nextInput = nextComposer?.querySelector(`[name="${CSS.escape(activeInputDescriptor.name)}"]`);
    } else if (activeInputDescriptor.selector) {
      nextInput = scopeRoot?.querySelector(activeInputDescriptor.selector);
    }
    if (nextInput) {
      if (nextInput !== document.activeElement) {
        nextInput.focus({ preventScroll: true });
      }
      if (nextInput.matches(".chat-input, [data-home-prompt]")) {
        resizeComposerTextarea(nextInput);
      }
      if (activeInputDescriptor.selection && nextInput.setSelectionRange) {
        try { nextInput.setSelectionRange(...activeInputDescriptor.selection); } catch {}
      }
    }
  }
  if (view.page === "skills") applySkillFilter($("[data-skill-filter=library]", nextContent));
  mountKnowledgeGraphCanvas();
  drawWaveDagEdges();
  if (overlay && !overlay.querySelector(".modal")) {
    overlay.innerHTML = "";
  }
  syncWorkflow();
}

export function navigateWorkbench(nextRoute, options = {}) {
  const prevPage = view.page;
  if (prevPage === "chat") {
    syncTaskChatDraft(view.selectedTaskId || "");
  }
  view.mobileScreen = "home";
  view.projectMenuId = "";
  view.taskMenuId = "";
  if (view.commandPaletteOpen) {
    closeCommandPalette();
  }
  closeOverlay();
  document.querySelectorAll("details[open]").forEach((el) => {
    if (el.matches(".codex-pop-menu, .composer-add, .wb-status-usage, .vault-action-menu")) {
      el.removeAttribute("open");
    }
  });
  if (isMobileCompanionMode() || window.matchMedia?.("(max-width: 1020px)")?.matches) {
    view.chatDrawerOpen = false;
    view.homeDockOpen = false;
    document.body?.classList?.remove("mobile-nav-open", "sidebar-drawer-open");
  }

  let targetPage = view.page;
  let explicitSelected = undefined;
  if (typeof nextRoute === "string") {
    const trimmed = nextRoute.trim();
    if (trimmed.startsWith("/")) {
      const parts = trimmed.replace(/^\/+/, "").split("/");
      targetPage = parts[0] || "chat";
      if (parts[1]) explicitSelected = decodeURIComponent(parts[1]);
    } else if (trimmed) {
      targetPage = trimmed;
    }
  } else if (nextRoute && typeof nextRoute === "object") {
    if (nextRoute.page) targetPage = nextRoute.page;
    if ("selected" in nextRoute) explicitSelected = nextRoute.selected;
    if (nextRoute.settingsSection) view.settingsSection = nextRoute.settingsSection;
    if ("selectedTaskId" in nextRoute) view.selectedTaskId = nextRoute.selectedTaskId;
    if ("selectedWorkspaceId" in nextRoute) view.selectedWorkspaceId = nextRoute.selectedWorkspaceId;
    if (nextRoute.mpSessionTab) view.mpSessionTab = nextRoute.mpSessionTab;
  }

  if (options.preserveOrigin && prevPage !== targetPage) {
    view.navOriginPage = prevPage;
  } else if (!options.keepOrigin) {
    view.navOriginPage = nextRoute?.navOriginPage ?? null;
  }

  view.page = targetPage;
  if (targetPage === "chat") {
    if (explicitSelected !== undefined) {
      view.selectedTaskId = explicitSelected || null;
    }
    view.selected = view.selectedTaskId || null;
    view.chatDraft = view.chatDraftsByTask?.[view.selectedTaskId || "__new__"] || "";
  } else if (targetPage === "workspaces") {
    if (explicitSelected) {
      view.selectedWorkspaceId = explicitSelected;
    }
    view.selected = view.selectedWorkspaceId || view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || null;
    view.selectedWorkspaceId = view.selected;
  } else if (["flows", "tasks"].includes(targetPage)) {
    view.selected = explicitSelected !== undefined ? explicitSelected : null;
    void syncSchedulesFromServer({ silent: true });
  } else {
    view.selected = null;
  }

  if (targetPage === "knowledge" && view.state?.settings?.vaultPath && !view.vaultEntries?.length) {
    void loadVaultDir(view.vaultDir || "");
  } else if (targetPage === "settings" && !view.connectionInfo) {
    api("/api/connection-info")
      .then((info) => {
        view.connectionInfo = info;
        render({ background: true });
      })
      .catch(() => {});
  }

  render();
}

export function handleWorkbenchBack() {
  if (view.commandPaletteOpen) {
    closeCommandPalette();
    render();
    return true;
  }
  const overlay = $("#overlay");
  if (overlay && overlay.children.length > 0) {
    closeOverlay();
    return true;
  }
  const openDetails = [
    ...document.querySelectorAll(
      "details.codex-pop-menu[open], details.composer-add[open], details.wb-status-usage[open], details.vault-action-menu[open], .orca-viewer-toolbar details[open]",
    ),
  ];
  if (openDetails.length > 0) {
    openDetails.forEach((el) => el.removeAttribute("open"));
    return true;
  }
  const isNarrow = isMobileCompanionMode() || Boolean(window.matchMedia?.("(max-width: 1020px)")?.matches);
  const hasBodyDrawer = document.body?.classList?.contains("mobile-nav-open")
    || document.body?.classList?.contains("sidebar-drawer-open");
  if (hasBodyDrawer || (isNarrow && (view.chatDrawerOpen || view.homeDockOpen))) {
    view.chatDrawerOpen = false;
    view.homeDockOpen = false;
    document.body?.classList?.remove("mobile-nav-open", "sidebar-drawer-open");
    render();
    return true;
  }
  if (view.mobileScreen && view.mobileScreen !== "home") {
    view.mobileScreen = "home";
    render();
    return true;
  }
  if (isMobileCompanionMode() && view.page === "chat" && view.selectedTaskId) {
    if (view.mpSessionTab && view.mpSessionTab !== "chat") {
      view.mpSessionTab = "chat";
      render();
      return true;
    }
    syncTaskChatDraft("");
    view.selectedTaskId = null;
    view.selected = null;
    render();
    return true;
  }
  if (view.navOriginPage) {
    const origin = view.navOriginPage;
    view.navOriginPage = null;
    navigateWorkbench(origin);
    return true;
  }
  if (view.page !== "chat") {
    navigateWorkbench("chat");
    return true;
  }
  return false;
}

if (typeof window !== "undefined") {
  window.__opensybauNavigate = (nextRoute, options) => navigateWorkbench(nextRoute, options);
  window.__opensybauHandleBack = handleWorkbenchBack;
}

registerRuntimeHooks({
  render,
  showCliProviderModal,
  hydrateRouteData: async () => {
    if (!view.state) return;
    if (view.page === "workspaces" && (view.selectedWorkspaceId || view.selected)) {
      await loadWorkspaceDir(view.selectedWorkspaceId || view.selected, view.workspaceDir);
    } else if (view.page === "knowledge" && view.state.settings.vaultPath) {
      await loadVaultDir(view.vaultDir);
    } else if (["tasks", "flows"].includes(view.page)) {
      void syncSchedulesFromServer({ silent: true });
    } else if (view.page === "settings" && !view.connectionInfo) {
      view.connectionInfo = await api("/api/connection-info").catch(() => null);
      render({ background: true });
    }
  },
});

attachChatOutlineListeners();

const activeButtonActions = new WeakSet();
const lastButtonActionAt = new WeakMap();
const MUTATION_CLICK_ACTIONS = new Set([
  "create-task",
  "send-chat-message",
  "apply-worktree",
  "pick-arena-winner",
  "discard-worktree",
  "rerun-stage",
  "rerun-task",
  "stop-task",
  "git-commit",
  "task-git-commit",
  "promote-subagent",
  "submit-diff-review",
  "send-html-element-comment",
  "send-stage-line-comment",
  "save-stage-file",
  "run-task-qa",
  "approve-plan-gate",
  "revise-plan-gate",
  "resolve-cli-approval",
  "distill-task-skill",
  "distill-task-memory",
  "compact-task-chat",
  "toggle-pin-memory",
  "trigger-schedule",
  "delete-schedule",
  "toggle-schedule",
  "delete-chat",
  "archive-task",
  "restore-task",
  "fork-chat",
]);

document.addEventListener("click", async (event) => {
  const button = event.target.closest?.("button, [data-action]");
  if (!button) return handleWorkbenchClick(event);
  const action = button.dataset?.action || "";
  if (!MUTATION_CLICK_ACTIONS.has(action)) {
    return handleWorkbenchClick(event);
  }
  const now = Date.now();
  const lastActionAt = lastButtonActionAt.get(button) || 0;
  if (activeButtonActions.has(button) || now - lastActionAt < 250) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  activeButtonActions.add(button);
  lastButtonActionAt.set(button, now);
  button.setAttribute("aria-busy", "true");
  try { await handleWorkbenchClick(event); }
  finally {
    activeButtonActions.delete(button);
    if (button.isConnected) button.removeAttribute("aria-busy");
  }
});

document.addEventListener("submit", handleSubmit);
document.addEventListener("dragover", (event) => {
  if (event.target.closest?.("[data-workspace-path]")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }
});
document.addEventListener("drop", (event) => {
  const input = event.target.closest?.("[data-workspace-path]");
  if (!input) return;
  event.preventDefault();
  const filePath = event.dataTransfer?.files?.[0]?.path;
  let droppedPath = filePath || event.dataTransfer?.getData("text/uri-list")?.split(/\r?\n/).find((line) => line && !line.startsWith("#")) || event.dataTransfer?.getData("text/plain");
  if (droppedPath?.startsWith("file:")) {
    try {
      const url = new URL(droppedPath);
      droppedPath = url.hostname ? `\\\\${url.hostname}${decodeURIComponent(url.pathname).replaceAll("/", "\\")}` : decodeURIComponent(url.pathname).replace(/^\/(\w:)/, "$1").replaceAll("/", "\\");
    } catch {}
  }
  input.value = String(droppedPath || "").trim().replace(/^(["'])(.*)\1$/, "$2");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});

let filterRenderRafId = 0;
function scheduleFilterRender(focusSelector, selectionPos) {
  if (filterRenderRafId && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(filterRenderRafId);
  }
  const run = () => {
    filterRenderRafId = 0;
    render();
    if (focusSelector) {
      const nextInput = $(focusSelector);
      nextInput?.focus();
      if (typeof selectionPos === "number") {
        try { nextInput?.setSelectionRange(selectionPos, selectionPos); } catch {}
      }
    }
  };
  if (typeof requestAnimationFrame === "function") {
    filterRenderRafId = requestAnimationFrame(run);
  } else {
    run();
  }
}

document.addEventListener("input", (event) => {
  if (event.target.matches?.("[data-command-palette-input]")) {
    handleCommandPaletteInput(event.target);
    return;
  }
  if (event.target.matches?.("[data-skill-picker-search]")) {
    const q = String(event.target.value || "").trim().toLowerCase();
    const root = event.target.closest("[data-skill-picker-root]");
    root?.querySelectorAll("[data-skill-picker-item]").forEach((row) => {
      const hay = row.dataset.skillPickerItem || "";
      row.hidden = Boolean(q && !hay.includes(q));
    });
    return;
  }
  if (event.target.matches?.("[data-html-element-comment-input]")) {
    view.stageHtmlCommentDraft = event.target.value;
    return;
  }
  const chatInput = event.target.closest(".chat-input");
  if (chatInput) {
    const splitTaskId = chatInput.closest(".multi-chat-pane")?.dataset.taskId;
    if (splitTaskId) {
      view.chatSplitDrafts ||= {};
      setBoundedCache(view.chatSplitDrafts, splitTaskId, chatInput.value);
    } else {
      view.chatDraft = chatInput.value;
      view.chatDraftsByTask ||= {};
      const key = view.selectedTaskId || view.selected || "__new__";
      view.chatDraftsByTask[key] = chatInput.value;
      setBoundedCache(view.chatDraftsByTask, key, chatInput.value);
    }
    resizeComposerTextarea(chatInput);
    void updateComposerMentionMenu(chatInput);
    return;
  }
  const homePrompt = event.target.closest("[data-home-prompt]");
  if (homePrompt) {
    if (homePrompt.closest("[data-split-chat-create]")) {
      view.chatSplitCreateDraft = homePrompt.value;
    } else {
      view.chatDraft = homePrompt.value;
      view.chatDraftsByTask ||= {};
      view.chatDraftsByTask.__new__ = homePrompt.value;
      setBoundedCache(view.chatDraftsByTask, "__new__", homePrompt.value);
    }
    resizeComposerTextarea(homePrompt);
    void updateComposerMentionMenu(homePrompt);
    return;
  }
  const drawerFilter = event.target.closest("[data-chat-drawer-filter]");
  if (drawerFilter) {
    view.chatDrawerFilter = drawerFilter.value;
    scheduleFilterRender("[data-chat-drawer-filter]", drawerFilter.selectionStart);
    return;
  }
  const skillOrSubagentSearch = event.target.closest("[data-skill-search], [data-subagent-search]");
  if (skillOrSubagentSearch) {
    const isSubagent = skillOrSubagentSearch.hasAttribute("data-subagent-search");
    if (isSubagent) view.subagentFilter = skillOrSubagentSearch.value;
    else view.skillFilter = skillOrSubagentSearch.value;
    view.chatDrawerFilter = skillOrSubagentSearch.value;
    scheduleFilterRender(
      isSubagent ? "[data-subagent-search]" : "[data-skill-search]",
      skillOrSubagentSearch.selectionStart,
    );
    return;
  }
  const diffBranchSearch = event.target.closest("[data-diff-branch-search]");
  if (diffBranchSearch) {
    view.diffBranchFilter = diffBranchSearch.value;
    scheduleFilterRender("[data-diff-branch-search]", diffBranchSearch.selectionStart);
    return;
  }
  const settingsSearch = event.target.closest("[data-settings-search]");
  if (settingsSearch) { applySettingsSearch(settingsSearch.value); return; }
  const mpWlSearch = event.target.closest("[data-mp-wl-search]");
  if (mpWlSearch) {
    view.mpWlSearchQuery = mpWlSearch.value;
    scheduleFilterRender("[data-mp-wl-search]", mpWlSearch.selectionStart);
    return;
  }
  const homeSearch = event.target.closest("[data-home-search]");
  if (homeSearch) {
    view.searchQuery = homeSearch.value;
    view.searchResults = homeSearchResults(view.searchQuery);
    document.querySelectorAll("[data-home-search-results]").forEach((results) => {
      results.innerHTML = view.searchResults;
      results.hidden = !view.searchQuery.trim();
      localizeDom(results, view.language);
    });
    return;
  }
  const fileInput = event.target.closest("[data-file-filter]");
  if (fileInput) {
    if (fileInput.dataset.fileFilter === "vault") view.vaultFilter = fileInput.value;
    const query = fileInput.value.trim().toLocaleLowerCase();
    const list = fileInput.closest(".file-browser")?.querySelector(".file-list");
    list?.querySelectorAll("[data-file-entry]").forEach((entry) => { entry.hidden = !entry.textContent.toLocaleLowerCase().includes(query); });
    return;
  }
  const vaultEditor = event.target.closest("[data-vault-editor]");
  if (vaultEditor) { view.vaultDraft = vaultEditor.value; return; }
  const skillEditor = event.target.closest("[data-skill-inline-editor]");
  if (skillEditor) { view.skillDraft = skillEditor.value; return; }
  const stageFileEditor = event.target.closest("[data-stage-file-editor]");
  if (stageFileEditor) {
    const tabId = stageFileEditor.dataset.stageFileEditor || view.activeStageTabId;
    const tab = (view.stageTabs || []).find((item) => item.id === tabId);
    if (tab) tab.editDraft = stageFileEditor.value;
    return;
  }
  const connPassInput = event.target.closest("[data-connection-password-input]");
  if (connPassInput) { view.connectionPasswordDraft = connPassInput.value; return; }
  const connAllowedInput = event.target.closest("[data-connection-allowed-hosts]");
  if (connAllowedInput) { view.connectionAllowedHostsDraft = connAllowedInput.value; return; }
  const orcaPairInput = event.target.closest("[data-orca-quick-pair-input], [data-orca-host-url], [data-orca-host-pass], [data-orca-host-name], [data-orca-host-user]");
  if (orcaPairInput) {
    view.orcaConnectDraft ||= { name: "", url: "", username: "opensybau", password: "", quickPair: "" };
    if (orcaPairInput.hasAttribute("data-orca-quick-pair-input")) view.orcaConnectDraft.quickPair = orcaPairInput.value;
    else if (orcaPairInput.hasAttribute("data-orca-host-url")) view.orcaConnectDraft.url = orcaPairInput.value;
    else if (orcaPairInput.hasAttribute("data-orca-host-pass")) view.orcaConnectDraft.password = orcaPairInput.value;
    else if (orcaPairInput.hasAttribute("data-orca-host-name")) view.orcaConnectDraft.name = orcaPairInput.value;
    else if (orcaPairInput.hasAttribute("data-orca-host-user")) view.orcaConnectDraft.username = orcaPairInput.value;
    return;
  }
  const input = event.target.closest("[data-skill-filter]");
  if (!input) return;
  if (input.dataset.skillFilter === "library") view.skillFilter = input.value;
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => applySkillFilter(input));
  } else {
    applySkillFilter(input);
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("[data-home-quick-agent]")) {
    const [prov, mod] = String(event.target.value || "").split("::");
    if (prov) {
      view.homeChatProvider = prov; view.homeChatModel = mod || "";
      const conn = view.connectors?.[prov];
      const modelObj = conn?.models?.find((m) => m.id === mod) || conn?.models?.[0];
      const nextEffort = modelObj?.efforts?.includes(view.homeChatEffort) ? view.homeChatEffort : (modelObj?.efforts?.includes("medium") ? "medium" : modelObj?.efforts?.[0] || "medium");
      view.homeChatEffort = nextEffort;
      if (view.homeRoles) {
        view.homeRoles.plan = { provider: prov, model: mod || "", effort: nextEffort };
        view.homeRoles.build = { provider: prov, model: mod || "", effort: nextEffort };
      }
      render();
    }
    return;
  }
  if (event.target.matches("[data-home-quick-effort]")) {
    const nextEffort = event.target.value;
    view.homeChatEffort = nextEffort;
    if (view.homeRoles) {
      if (view.homeRoles.plan) view.homeRoles.plan.effort = nextEffort;
      if (view.homeRoles.build) view.homeRoles.build.effort = nextEffort;
    }
    render();
    return;
  }
  if (event.target.matches("[data-arena-slot-provider]")) {
    const idx = Number(event.target.dataset.arenaSlotProvider || 0);
    const slots = ensureHomeArenaSlots();
    if (slots[idx]) {
      const cand = availableArenaCompetitors().find((c) => c.provider === event.target.value);
      slots[idx].provider = event.target.value;
      slots[idx].model = cand?.model || "";
      slots[idx].effort = cand?.effort || "medium";
      view.homeArenaSlots = [...slots];
      render();
    }
    return;
  }
  if (event.target.matches("[data-arena-slot-model]")) {
    const idx = Number(event.target.dataset.arenaSlotModel || 0);
    const slots = ensureHomeArenaSlots();
    if (slots[idx]) {
      const nextModelId = event.target.value;
      slots[idx].model = nextModelId;
      const providerId = slots[idx].provider;
      const models = view.connectors?.[providerId]?.models || [];
      const modelObj = models.find((m) => m.id === nextModelId) || models[0];
      const supportedEfforts = modelObj?.reasoningEfforts || modelObj?.efforts || [];
      if (supportedEfforts.length && !supportedEfforts.includes(slots[idx].effort)) {
        slots[idx].effort = modelObj?.defaultEffort
          || (supportedEfforts.includes("medium") ? "medium" : supportedEfforts[0]);
      }
      view.homeArenaSlots = [...slots];
      render();
    }
    return;
  }
  if (event.target.matches("[data-arena-slot-effort]")) {
    const idx = Number(event.target.dataset.arenaSlotEffort || 0);
    const slots = ensureHomeArenaSlots();
    if (slots[idx]) { slots[idx].effort = event.target.value; view.homeArenaSlots = [...slots]; render(); }
    return;
  }
  if (event.target.matches("[data-content-file-import]")) { void importContentFiles(event.target); return; }
  if (event.target.matches("[data-task-preset-version]")) syncTaskPresetControls(event.target.closest("form"));
  if (event.target.matches("select[name=workflow], select[name=workspaceId]")) { syncWorkflow(); syncIsolation(); }
  if (event.target.matches(".home-composer select[name=workflow]")) {
    view.homeWorkflow = event.target.value;
    view.homeMode = event.target.value === "chat-only" ? "chat" : event.target.value === "plan-only" ? "plan" : "code";
    render();
  }
  if (event.target.matches("[data-role-provider]")) {
    const roleId = event.target.dataset.roleProvider;
    const form = event.target.closest("form");
    syncRoleProvider(form, roleId); syncRolePickers(form, roleId);
    if (form?.classList.contains("home-composer")) {
      view.homeRoles[roleId] = { provider: event.target.value, model: form.querySelector(`[data-role-model="${roleId}"]`)?.value || "", effort: form.querySelector(`[data-role-effort="${roleId}"]`)?.value || "" };
      render();
    }
  }
  if (event.target.matches("[data-role-model]")) {
    const roleId = event.target.dataset.roleModel;
    const form = event.target.closest("form");
    syncEffortForModel(form, `[data-role-model="${roleId}"]`, `[data-role-effort="${roleId}"]`, `[data-role-provider="${roleId}"]`);
    syncRolePickers(form, roleId);
    if (form?.classList.contains("home-composer")) {
      view.homeRoles[roleId] = { provider: form.querySelector(`[data-role-provider="${roleId}"]`)?.value || "", model: event.target.value, effort: form.querySelector(`[data-role-effort="${roleId}"]`)?.value || "" };
      render();
    }
  }
  if (event.target.matches("[data-role-effort]")) {
    const roleId = event.target.dataset.roleEffort;
    const form = event.target.closest("form");
    syncRolePicker(form, roleId, "effort");
    if (form?.classList.contains("home-composer")) view.homeRoles[roleId] = { provider: form.querySelector(`[data-role-provider="${roleId}"]`)?.value || "", model: form.querySelector(`[data-role-model="${roleId}"]`)?.value || "", effort: event.target.value };
  }
  if (event.target.matches("[data-chat-agent-provider]")) {
    const form = event.target.closest("form");
    syncChatAgentFields(form);
    if (form?.classList.contains("home-composer")) {
      view.homeChatProvider = event.target.value;
      view.homeChatModel = form.querySelector("[data-chat-agent-model]")?.value || "";
      view.homeChatEffort = form.querySelector("[data-chat-agent-effort]")?.value || "";
      render();
    }
  }
  if (event.target.matches("[data-chat-agent-model]")) {
    const form = event.target.closest("form");
    syncEffortForModel(form, "[data-chat-agent-model]", "[data-chat-agent-effort]", "[data-chat-agent-provider]");
    if (form?.classList.contains("home-composer")) {
      view.homeChatModel = event.target.value;
      view.homeChatEffort = form.querySelector("[data-chat-agent-effort]")?.value || "";
      render();
    }
  }
  if (event.target.matches("[data-chat-agent-effort]")) view.homeChatEffort = event.target.value;
  if (event.target.matches("[data-home-workspace]")) { view.homeWorkspaceId = event.target.value; render(); }
  if (event.target.matches("[data-home-permission]")) { view.homePermissionPreset = event.target.value; }
  if (event.target.matches("[data-home-isolated]")) { view.homeIsolated = Boolean(event.target.checked); render(); }
  if (event.target.matches("[data-chat-provider]")) {
    view.chatProvider = event.target.value; view.chatModel = ""; view.chatEffort = "";
    const task = view.state.tasks.find((item) => item.id === $(".task-chat-config-modal")?.dataset.id);
    if (task) openTaskInstructionModal(task); else render();
  }
  if (event.target.matches("[data-chat-model]")) {
    view.chatModel = event.target.value;
    const models = view.connectors?.[view.chatProvider]?.models || [];
    const model = models.find((item) => item.id === view.chatModel);
    view.chatEffort = model?.efforts?.includes("medium") ? "medium" : model?.efforts?.[0] || "";
    const task = view.state.tasks.find((item) => item.id === $(".task-chat-config-modal")?.dataset.id);
    if (task) openTaskInstructionModal(task); else render();
  }
  if (event.target.matches("[data-chat-effort]")) { view.chatEffort = event.target.value; }
  if (event.target.matches("[data-html-comment-agent]")) {
    const val = String(event.target.value || "");
    const [prov, mod] = val.includes("::") ? val.split("::") : [val, ""];
    view.stageHtmlCommentProvider = prov || "";
    view.stageHtmlCommentModel = mod || "";
    view.stageHtmlCommentDraft = String($("[data-html-element-comment-input]")?.value || view.stageHtmlCommentDraft || "");
    syncHtmlInspectUi();
  }
  if (event.target.matches("[data-html-comment-effort]")) { view.stageHtmlCommentEffort = event.target.value; }
});

window.addEventListener("message", (event) => {
  const frame = document.querySelector(".orca-live-frame");
  if (!frame || event.source !== frame.contentWindow) return;
  const data = event?.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "orca-inspect:ready" || data.type === "orca-inspect-ready") {
    markIframeInspectorBridgeReady(frame);
    syncHtmlInspectUi();
  } else if (data.type === "orca-inspect:selected" && data.element) {
    markIframeInspectorBridgeReady(frame);
    view.stageHtmlInspectActive = true;
    view.stageHtmlSelectedElement = data.element;
    syncHtmlInspectUi({ focusInput: true });
  } else if (data.type === "orca-inspect:escape") {
    if (view.stageHtmlSelectedElement) { view.stageHtmlSelectedElement = null; view.stageHtmlCommentDraft = ""; syncHtmlInspectUi(); }
    else if (view.stageHtmlInspectActive) { view.stageHtmlInspectActive = false; syncHtmlInspectUi(); }
  }
});

document.addEventListener("load", (event) => {
  if (event.target?.matches?.(".orca-live-frame:not(.is-pdf)")) syncHtmlInspectUi();
}, true);

document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    toggleCommandPalette();
    return;
  }
  if (handleCommandPaletteKeydown(event)) {
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && view.page === "knowledge" && view.vaultEditing) {
    event.preventDefault(); document.querySelector("[data-action='vault-save-note']")?.click(); return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && document.querySelector("[data-stage-file-editor]")) {
    event.preventDefault(); document.querySelector("[data-action='save-stage-file']")?.click(); return;
  }
  const activePopover = event.target.closest?.(".composer-input-wrap")?.querySelector("[data-mention-popover]:not([hidden])");
  if (activePopover && (event.key === "Tab" || event.key === "Enter") && !event.shiftKey) {
    const firstBtn = activePopover.querySelector("[data-action='insert-file-mention']");
    if (firstBtn) { event.preventDefault(); firstBtn.click(); return; }
  }
  if (activePopover && event.key === "Escape") { event.preventDefault(); activePopover.hidden = true; view.mentionMenu = null; return; }
  const search = event.target.matches?.("[data-home-search]") ? event.target : null;
  if (search && event.key === "Enter") { event.preventDefault(); document.querySelector("[data-home-search-results] button")?.click(); return; }
  if (search && event.key === "Escape") {
    event.preventDefault(); view.searchQuery = ""; view.searchResults = ""; search.value = "";
    const results = $("[data-home-search-results]");
    if (results) { results.hidden = true; results.innerHTML = ""; }
    return;
  }
  if (event.key === "Escape") {
    if (view.stageHtmlSelectedElement) { view.stageHtmlSelectedElement = null; view.stageHtmlCommentDraft = ""; syncHtmlInspectUi(); return; }
    if (view.stageHtmlInspectActive) { view.stageHtmlInspectActive = false; syncHtmlInspectUi(); return; }
    if ($("#overlay")?.children.length > 0) { closeOverlay(); return; }
    const openDetails = [...document.querySelectorAll("details.codex-pop-menu[open], details.composer-add[open], details.wb-status-usage[open], details.vault-action-menu[open]")];
    if (openDetails.length > 0) { openDetails.forEach((el) => el.removeAttribute("open")); return; }
    closeOverlay();
  }
  if (event.key === "Enter" && !event.shiftKey && event.target.matches?.("[data-html-element-comment-input]")) {
    event.preventDefault(); document.querySelector("[data-action='send-html-element-comment']")?.click(); return;
  }
  if (event.key === "Enter" && event.target.matches?.("[data-stage-line-comment-input]")) {
    event.preventDefault(); document.querySelector("[data-action='send-stage-line-comment']")?.click(); return;
  }
  if (event.key === "Enter" && !event.shiftKey && event.target.matches?.(".chat-input, [data-home-prompt]")) {
    event.preventDefault(); event.target.closest("form")?.requestSubmit();
  }
});

window.addEventListener("popstate", () => {
  const prevSelectedTaskId = view.selectedTaskId;
  const prevSelectedWsId = view.selectedWorkspaceId;
  Object.assign(view, readBrowserRoute());
  if (view.page === "workspaces" && view.selected) {
    view.selectedWorkspaceId = view.selected;
    view.selectedTaskId = prevSelectedTaskId;
  } else if (view.page === "chat") {
    view.selectedTaskId = view.selected || null;
    view.selectedWorkspaceId = prevSelectedWsId;
  } else {
    view.selectedTaskId = prevSelectedTaskId;
    view.selectedWorkspaceId = prevSelectedWsId;
  }
  view.mobileScreen = "home";
  view.chatDraft = view.chatDraftsByTask?.[view.selectedTaskId || "__new__"] || "";
  view.projectMenuId = ""; view.filePreview = null; view.vaultPreview = null;
  view.workspaceEntries = []; view.vaultEntries = []; view.renderedPage = "";
  setRouteNeedsHydration(view.page === "knowledge" || (view.page === "workspaces" && Boolean(view.selected)));
  closeOverlay(); normalizeRouteSelection();
  const selectedTask = view.state?.tasks.find((task) => task.id === (view.selectedTaskId || view.selected));
  if (selectedTask && view.page === "chat") {
    view.homeWorkspaceId = selectedTask.workspaceId;
    view.chatProvider = selectedTask.config?.workflow === "chat-only" ? selectedTask.config.chatProvider || "codex" : roleConfig(selectedTask.config, "plan").provider || "codex";
    view.chatModel = selectedTask.config?.workflow === "chat-only" ? selectedTask.config.chatModel || "" : roleConfig(selectedTask.config, "plan").model || "";
    view.chatEffort = selectedTask.config?.workflow === "chat-only" ? selectedTask.config.chatEffort || "" : roleConfig(selectedTask.config, "plan").effort || "";
  }
  render();
  if (view.state && getRouteNeedsHydration()) {
    setRouteNeedsHydration(false);
    hydrateRouteData().catch((error) => showToast(error.message));
  }
});

connectEventStream();
window.addEventListener("opensybau:pair", async (event) => {
  const uri = String(event?.detail?.uri || event?.detail || "").trim();
  if (!uri) return;
  try {
    const parsed = parsePairingInput(uri);
    const draft = {
      name: parsed.name || "",
      url: parsed.url || "",
      username: parsed.username || "opensybau",
      password: parsed.password || "",
      quickPair: uri,
    };
    view.orcaConnectDraft = draft;
    const probe = await probeRemoteHost(draft);
    view.orcaConnectProbeResult = probe;
    if (probe.ok) {
      const saved = saveRemoteHostProfile({
        ...draft,
        name: draft.name || probe.info?.hostname || draft.url,
      });
      setActiveRemoteHost(saved || draft);
      view.page = "chat";
      view.mobileScreen = "home";
      view.navOriginPage = null;
      connectEventStream();
      await refresh({ configuration: true });
      render();
      showToast(`Đã ghép nối và kết nối tới ${probe.info?.hostname || draft.name || draft.url}.`);
    } else {
      view.page = "settings";
      view.settingsSection = "devices";
      view.selected = null;
      view.orcaConnectTab = "client";
      render();
      showToast(probe.error || "Không thể kết nối tới máy tính từ liên kết ghép nối.");
    }
  } catch (error) { showToast(error.message); }
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleRefresh(80); });

(() => {
  try {
    const savedWidth = Number(localStorage.getItem("opensybau.right-dock-width"));
    if (savedWidth >= 220 && savedWidth <= 620) document.documentElement.style.setProperty("--right-dock-width", `${savedWidth}px`);
    const savedSplit = Number(localStorage.getItem("opensybau.stage-split-ratio"));
    if (savedSplit >= 28 && savedSplit <= 72) document.documentElement.style.setProperty("--stage-split-ratio", `${savedSplit}%`);
  } catch {}
  let resizingDock = false;
  let resizingSplit = false;
  let splitBounds = null;
  let pendingX = null;
  let resizeFrame = 0;
  function applyResize() {
    resizeFrame = 0;
    if (pendingX === null) return;
    if (resizingDock) document.documentElement.style.setProperty("--right-dock-width", `${Math.max(220, Math.min(620, Math.round(window.innerWidth - pendingX)))}px`);
    else if (resizingSplit && splitBounds?.width > 100) document.documentElement.style.setProperty("--stage-split-ratio", `${Math.max(28, Math.min(72, Math.round(((pendingX - splitBounds.left) / splitBounds.width) * 100)))}%`);
    pendingX = null;
  }
  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest?.("[data-right-dock-resizer]")) { event.preventDefault(); resizingDock = true; event.target.closest("[data-right-dock-resizer]").setPointerCapture?.(event.pointerId); document.body.classList.add("is-resizing-dock"); return; }
    if (event.target.closest?.("[data-stage-split-resizer]")) { event.preventDefault(); resizingSplit = true; splitBounds = document.querySelector(".orca-stage-split-layout")?.getBoundingClientRect(); event.target.closest("[data-stage-split-resizer]").setPointerCapture?.(event.pointerId); document.body.classList.add("is-resizing-dock"); }
  });
  window.addEventListener("pointermove", (event) => {
    if (!resizingDock && !resizingSplit) return;
    pendingX = event.clientX;
    if (!resizeFrame) resizeFrame = requestAnimationFrame(applyResize);
  });
  const finishResize = () => {
    if (resizeFrame) { cancelAnimationFrame(resizeFrame); applyResize(); }
    if (resizingDock) {
      resizingDock = false; document.body.classList.remove("is-resizing-dock");
      try {
        const px = parseInt(document.documentElement.style.getPropertyValue("--right-dock-width"), 10);
        if (px >= 220 && px <= 620) localStorage.setItem("opensybau.right-dock-width", String(px));
      } catch {}
    }
    if (resizingSplit) {
      resizingSplit = false; document.body.classList.remove("is-resizing-dock");
      try {
        const pct = parseInt(document.documentElement.style.getPropertyValue("--stage-split-ratio"), 10);
        if (pct >= 28 && pct <= 72) localStorage.setItem("opensybau.stage-split-ratio", String(pct));
      } catch {}
    }
    splitBounds = null;
  };
  window.addEventListener("pointerup", finishResize);
  window.addEventListener("pointercancel", finishResize);
})();

refresh({ configuration: true });
startPeriodicRefresh();
