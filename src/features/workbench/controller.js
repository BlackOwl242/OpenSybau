import { $, view } from "../../shared/state.js";
import { roleConfig } from "../../domain/agent-roles.js";
import { localizeDom } from "../../shared/i18n.js";
import { applyThemeToDom } from "../../shared/themes.js";
import { updateWorkbenchShell } from "../../shell/mount.jsx";
import { readBrowserRoute } from "../../shell/router.js";
import {
  getActiveRemoteHost,
  parsePairingInput,
  probeRemoteHost,
} from "../../shared/remote-host.js";
import { syncHtmlInspectUi } from "./html-inspector.js";
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
if (view.page !== "chat") view.mobileScreen = "page";
else if (view.selected) view.mobileScreen = "session";
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
  if (view.page === "workspaces" && !view.workspaceOverviewMode && view.state.workspaces?.length) {
    const activeWs = view.state.workspaces.find((w) => w.id === view.selected)
      || view.state.workspaces.find((w) => w.id === view.homeWorkspaceId)
      || view.state.workspaces[0];
    if (activeWs) {
      if (view.selected !== activeWs.id) {
        view.selected = activeWs.id;
        view.workspaceDir = "";
        view.workspaceEntries = [];
        markReplaceBrowserRoute();
      }
      view.homeWorkspaceId = activeWs.id;
    }
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
  updateWorkbenchShell({ backgroundUpdate: background, page: view.page, language: view.language, theme: view.theme, state: view.state, connectors: view.connectors, quotas: view.quotas, quotasLoading: Boolean(view.quotasLoading), desktopSetupOpen: view.desktopSetupOpen, cliInstallProvider: view.cliInstallProvider, skills: view.skills, selected: (selectedTask || selectedWorkspace) ? view.selected : null, homeWorkspaceId: view.homeWorkspaceId, searchQuery: view.searchQuery, searchResults, collapsedWorkspaces: view.collapsedWorkspaces, collapsedFanouts: view.collapsedFanouts, projectMenuId: view.projectMenuId, taskMenuId: view.taskMenuId, streamConnected: view.streamConnected, activeRemoteHostName: getActiveRemoteHost()?.name || "", chatDrawerOpen: view.chatDrawerOpen, rightDockMarkup, pageSidebarMarkup, stageTabs: view.stageTabs || [], activeStageTabId: view.activeStageTabId || "chat", stageSplit: Boolean(view.stageSplit), chatSplitWorkspaceId: view.chatSplitWorkspaceId, chatSplitTaskIds: view.chatSplitTaskIds, chatSplitActiveTaskId: view.chatSplitActiveTaskId }, pageMarkup);
  localizeDom(document.querySelector("#root"), view.language);
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
  localizeDom(document.querySelector("#root"), view.language);
}

registerRuntimeHooks({
  render,
  showCliProviderModal,
  hydrateRouteData: async () => {
    if (!view.state) return;
    if (view.page === "workspaces" && view.selected) await loadWorkspaceDir(view.selected, view.workspaceDir);
    else if (view.page === "knowledge" && view.state.settings.vaultPath) await loadVaultDir(view.vaultDir);
    else if (view.page === "settings" && !view.connectionInfo) {
      view.connectionInfo = await api("/api/connection-info").catch(() => null);
      render({ background: true });
    }
  },
});

attachChatOutlineListeners();

const activeButtonActions = new WeakSet();
const lastButtonActionAt = new WeakMap();
document.addEventListener("click", async (event) => {
  const button = event.target.closest?.("button, [data-action='open-diff-comment']");
  if (!button) return handleWorkbenchClick(event);
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

document.addEventListener("input", (event) => {
  if (event.target.matches?.("[data-html-element-comment-input]")) {
    view.stageHtmlCommentDraft = event.target.value;
    return;
  }
  const chatInput = event.target.closest(".chat-input");
  if (chatInput) {
    const splitTaskId = chatInput.closest(".multi-chat-pane")?.dataset.taskId;
    if (splitTaskId) { view.chatSplitDrafts ||= {}; view.chatSplitDrafts[splitTaskId] = chatInput.value; }
    else view.chatDraft = chatInput.value;
    resizeComposerTextarea(chatInput);
    void updateComposerMentionMenu(chatInput);
    return;
  }
  const homePrompt = event.target.closest("[data-home-prompt]");
  if (homePrompt) {
    if (homePrompt.closest("[data-split-chat-create]")) view.chatSplitCreateDraft = homePrompt.value;
    else view.chatDraft = homePrompt.value;
    resizeComposerTextarea(homePrompt);
    void updateComposerMentionMenu(homePrompt);
    return;
  }
  const drawerFilter = event.target.closest("[data-chat-drawer-filter]");
  if (drawerFilter) {
    view.chatDrawerFilter = drawerFilter.value;
    const pos = drawerFilter.selectionStart;
    render();
    const nextFilter = $("[data-chat-drawer-filter]");
    nextFilter?.focus();
    if (typeof pos === "number") nextFilter?.setSelectionRange(pos, pos);
    return;
  }
  const diffBranchSearch = event.target.closest("[data-diff-branch-search]");
  if (diffBranchSearch) {
    view.diffBranchFilter = diffBranchSearch.value;
    const pos = diffBranchSearch.selectionStart;
    render();
    const nextInput = $("[data-diff-branch-search]");
    nextInput?.focus();
    if (typeof pos === "number") nextInput?.setSelectionRange(pos, pos);
    return;
  }
  const settingsSearch = event.target.closest("[data-settings-search]");
  if (settingsSearch) { applySettingsSearch(settingsSearch.value); return; }
  const mpWlSearch = event.target.closest("[data-mp-wl-search]");
  if (mpWlSearch) {
    view.mpWlSearchQuery = mpWlSearch.value;
    const pos = mpWlSearch.selectionStart;
    render();
    const nextInput = $("[data-mp-wl-search]");
    nextInput?.focus();
    if (typeof pos === "number") nextInput?.setSelectionRange(pos, pos);
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
  const input = event.target.closest("[data-skill-filter]");
  if (!input) return;
  if (input.dataset.skillFilter === "library") view.skillFilter = input.value;
  applySkillFilter(input);
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
    if (slots[idx]) { slots[idx].model = event.target.value; view.homeArenaSlots = [...slots]; render(); }
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
  if (data.type === "orca-inspect:ready") syncHtmlInspectUi();
  else if (data.type === "orca-inspect:selected" && data.element) {
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
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && view.page === "knowledge" && view.vaultEditing) {
    event.preventDefault(); document.querySelector("[data-action='vault-save-note']")?.click(); return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && document.querySelector("[data-stage-file-editor]")) {
    event.preventDefault(); document.querySelector("[data-action='save-stage-file']")?.click(); return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault(); view.page = "chat"; view.selected = null; view.chatDraft = ""; render(); $(`[data-home-prompt]`)?.focus({ preventScroll: true }); return;
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
  Object.assign(view, readBrowserRoute());
  view.chatDraft = ""; view.projectMenuId = ""; view.filePreview = null; view.vaultPreview = null;
  view.workspaceEntries = []; view.vaultEntries = []; view.renderedPage = "";
  setRouteNeedsHydration(view.page === "knowledge" || (view.page === "workspaces" && Boolean(view.selected)));
  closeOverlay(); normalizeRouteSelection();
  const selectedTask = view.state?.tasks.find((task) => task.id === view.selected);
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
    view.page = "settings"; view.settingsSection = "devices"; view.selected = null; view.orcaConnectTab = "client";
    view.orcaConnectDraft = { name: parsed.name || "", url: parsed.url || "", username: parsed.username || "opensybau", password: parsed.password || "", quickPair: uri };
    view.orcaConnectProbeResult = await probeRemoteHost(view.orcaConnectDraft);
    render();
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
  document.addEventListener("pointerdown", (event) => {
    if (event.target.closest?.("[data-right-dock-resizer]")) { event.preventDefault(); resizingDock = true; document.body.classList.add("is-resizing-dock"); return; }
    if (event.target.closest?.("[data-stage-split-resizer]")) { event.preventDefault(); resizingSplit = true; document.body.classList.add("is-resizing-dock"); }
  });
  window.addEventListener("pointermove", (event) => {
    if (resizingDock) {
      document.documentElement.style.setProperty("--right-dock-width", `${Math.max(220, Math.min(620, Math.round(window.innerWidth - event.clientX)))}px`);
      return;
    }
    if (resizingSplit) {
      const splitContainer = document.querySelector(".orca-stage-split-layout");
      const rect = splitContainer?.getBoundingClientRect();
      if (!rect || rect.width <= 100) return;
      document.documentElement.style.setProperty("--stage-split-ratio", `${Math.max(28, Math.min(72, Math.round(((event.clientX - rect.left) / rect.width) * 100)))}%`);
    }
  });
  window.addEventListener("pointerup", () => {
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
  });
})();

refresh({ configuration: true });
startPeriodicRefresh();
