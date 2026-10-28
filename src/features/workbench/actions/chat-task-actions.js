import { $, esc, view } from "../../../shared/state.js";
import { roleConfig } from "../../../domain/agent-roles.js";
import { setLanguage } from "../../../shared/i18n.js";
import { setSavedThemeId } from "../../../shared/themes.js";
import {
  api,
  closeOverlay,
  ensureWorkspaceFileIndex,
  refresh,
  render,
  scanCliProviders,
  showErrorDetails,
  showModal,
  showToast,
} from "../runtime.js";
import {
  applyTaskPreset,
  deleteTaskPreset,
  saveTaskPreset,
  syncCustomSelect,
} from "../ui-controls.js";
import { resizeComposerTextarea } from "../composer.js";
import {
  openTaskGoalModal,
  openTaskInstructionModal,
  openTaskModal,
  openTaskPermissionsModal,
} from "../modals.js";
import {
  availableArenaCompetitors,
  clearSidebarSearch,
  ensureHomeArenaSlots,
} from "../pages/chat-page.js";
import { loadWorkspaceDir } from "../pages/tasks-workspaces-page.js";
import { loadVaultDir } from "../pages/knowledge-skills-page.js";
import { openWaveDecomposeModal } from "../pages/flows-memory-page.js";

export async function handleChatAndTaskAction(action, id, button) {
  if (action === "fill-home-prompt") {
    const promptText = String(button.dataset.prompt || "").trim();
    if (promptText) {
      view.chatDraft = promptText;
      const textarea = $("[data-home-prompt]");
      if (textarea) {
        textarea.value = promptText;
        resizeComposerTextarea(textarea);
        textarea.focus();
      } else {
        render();
        requestAnimationFrame(() => $("[data-home-prompt]")?.focus());
      }
    }
    return true;
  }
  if (action === "mp-go-home") {
    closeOverlay();
    view.mobileScreen = "home";
    view.page = "chat";
    view.selected = null;
    view.chatDrawerOpen = false;
    render();
    return true;
  }
  if (action === "mp-open-worktrees") {
    closeOverlay();
    view.mobileScreen = "worktrees";
    view.page = "chat";
    view.chatDrawerOpen = false;
    render();
    return true;
  }
  if (action === "mp-open-session") {
    const taskId = button.dataset.taskId || id || "";
    const selectedTask = view.state?.tasks?.find((item) => item.id === taskId);
    closeOverlay();
    clearSidebarSearch();
    view.mobileScreen = "session";
    view.mpSessionTab = "chat";
    view.page = "chat";
    view.selected = taskId;
    view.activeStageTabId = "chat";
    view.chatDrawerOpen = false;
    view.projectMenuId = "";
    view.taskMenuId = "";
    if (selectedTask) {
      view.homeWorkspaceId = selectedTask.workspaceId || view.homeWorkspaceId;
      view.chatProvider = selectedTask.config?.workflow === "chat-only" ? selectedTask.config.chatProvider || "codex" : selectedTask.config?.chatProvider || roleConfig(selectedTask.config, "plan").provider || "codex";
      view.chatModel = selectedTask.config?.workflow === "chat-only" ? selectedTask.config.chatModel || "" : selectedTask.config?.chatModel || roleConfig(selectedTask.config, "plan").model || "";
      view.chatEffort = selectedTask.config?.workflow === "chat-only" ? selectedTask.config.chatEffort || "" : selectedTask.config?.chatEffort || roleConfig(selectedTask.config, "plan").effort || "";
    }
    view.chatDraft = "";
    render();
    return true;
  }
  if (action === "mp-new-session") {
    closeOverlay();
    clearSidebarSearch();
    if (button.dataset.workspaceId) view.homeWorkspaceId = button.dataset.workspaceId;
    else if (!view.homeWorkspaceId && view.state?.workspaces?.[0]?.id) view.homeWorkspaceId = view.state.workspaces[0].id;
    view.mobileScreen = "session";
    view.mpSessionTab = "chat";
    view.page = "chat";
    view.selected = null;
    view.activeStageTabId = "chat";
    view.stageSplit = false;
    view.chatDraft = "";
    view.chatDrawerOpen = false;
    view.homeConfigOpen = false;
    render();
    requestAnimationFrame(() => $("[data-home-prompt]")?.focus({ preventScroll: true }));
    return true;
  }
  if (action === "mp-open-pair") {
    closeOverlay();
    view.mobileScreen = "page";
    view.page = "settings";
    view.settingsSection = "devices";
    view.selected = null;
    view.orcaConnectTab = "client";
    view.chatDrawerOpen = false;
    render();
    void refresh({ configuration: true });
    return true;
  }
  if (action === "mp-open-page") {
    closeOverlay();
    const targetPage = button.dataset.mpPage || "settings";
    view.mobileScreen = "page";
    view.page = targetPage;
    view.chatDrawerOpen = false;
    if (targetPage === "workspaces") {
      view.activeStageTabId = "chat";
      const wsExists = view.selected && view.state?.workspaces?.some((w) => w.id === view.selected);
      if (!wsExists) {
        view.selected = view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || null;
        view.workspaceDir = "";
        view.workspaceEntries = [];
      }
    } else {
      view.selected = null;
    }
    render();
    if (targetPage === "settings") void refresh({ configuration: true });
    if (targetPage === "workspaces" && view.selected) await loadWorkspaceDir(view.selected, view.workspaceDir || "");
    if (targetPage === "knowledge" && view.state?.settings?.vaultPath) await loadVaultDir("");
    if (targetPage === "skills") {
      const result = await api("/api/skills");
      view.skills = result.skills || [];
      view.skillsLoaded = true;
      render();
    }
    return true;
  }
  if (action === "mp-session-tab") {
    view.mpSessionTab = button.dataset.tab || "chat";
    view.activeStageTabId = "chat";
    view.chatDrawerOpen = false;
    render();
    return true;
  }
  if (action === "mp-stage-file-tab") {
    view.activeStageTabId = button.dataset.tabId || "chat";
    view.chatDrawerOpen = false;
    render();
    return true;
  }
  if (action === "mp-open-dock-tab") {
    const targetTab = button.dataset.tab || "files";
    if (view.chatDrawerOpen && view.chatDrawerTab === targetTab) {
      view.chatDrawerOpen = false;
    } else {
      view.chatDrawerTab = targetTab;
      view.chatDrawerOpen = true;
    }
    const currentTask = view.state?.tasks?.find((item) => item.id === view.selected);
    const wsId = currentTask?.workspaceId || view.homeWorkspaceId || view.state?.workspaces?.[0]?.id;
    if (view.chatDrawerOpen && wsId) {
      void ensureWorkspaceFileIndex(wsId).then(() => render());
    }
    render();
    return true;
  }
  if (action === "mp-cycle-wl-filter") {
    const order = ["all", "running", "attention", "done"];
    const curr = view.mpWlFilter || "all";
    view.mpWlFilter = order[(order.indexOf(curr) + 1) % order.length];
    render();
    return true;
  }
  if (action === "mp-reset-wl-filters") {
    view.mpWlFilter = "all";
    view.mpWlRepo = "all";
    view.mpWlSearchQuery = "";
    view.mpWlSearchOpen = false;
    render();
    return true;
  }
  if (action === "mp-cycle-wl-repo") {
    const wsIds = ["all", ...(view.state?.workspaces || []).map((w) => w.id)];
    const curr = view.mpWlRepo || "all";
    const idx = wsIds.indexOf(curr);
    view.mpWlRepo = wsIds[(idx + 1) % wsIds.length] || "all";
    render();
    return true;
  }
  if (action === "mp-toggle-wl-search") {
    view.mpWlSearchOpen = !view.mpWlSearchOpen;
    if (!view.mpWlSearchOpen) view.mpWlSearchQuery = "";
    render();
    if (view.mpWlSearchOpen) requestAnimationFrame(() => $("[data-mp-wl-search]")?.focus());
    return true;
  }
  if (action === "mp-clear-wl-search") {
    view.mpWlSearchQuery = "";
    render();
    requestAnimationFrame(() => $("[data-mp-wl-search]")?.focus());
    return true;
  }
  if (action === "mp-paste-terminal") {
    const clip = await navigator.clipboard?.readText().catch(() => "");
    const input = $(".mp-screen-terminal .mp-text-input");
    if (input && clip) {
      input.value = `${input.value ? `${input.value} ` : ""}${clip.trim()}`;
      input.focus();
    }
    return true;
  }
  if (action === "jump-chat-answer") {
    const pane = button.closest(".conversation-chat-pane");
    const taskId = pane?.querySelector(".chat-thread")?.dataset.taskId;
    const answerId = taskId && pane.closest(".multi-chat-pane") ? `chat-answer-${taskId}-${Number(button.dataset.answerIndex)}` : `chat-answer-${Number(button.dataset.answerIndex)}`;
    const answer = $(`#${CSS.escape(answerId)}`, pane || document);
    answer?.scrollIntoView({ behavior: "smooth", block: "start" });
    button.closest(".chat-outline-nav")?.classList.remove("is-open");
    $(".wb-mobile-outline-toggle")?.setAttribute("aria-expanded", "false");
    return true;
  }
  if (action === "toggle-chat-outline") {
    const nav = button.closest(".chat-outline-nav") || $(".chat-outline-nav");
    const isOpen = nav?.classList.toggle("is-open");
    button.setAttribute("aria-expanded", String(Boolean(isOpen)));
    return true;
  }
  if (action === "pick-home-select") {
    const select = button.closest("label, .custom-select-wrap")?.querySelector("select");
    const value = button.dataset.value || "";
    if (select && !select.disabled && [...select.options].some((option) => option.value === value && !option.disabled)) {
      select.value = value;
      syncCustomSelect(select);
      button.closest("details")?.removeAttribute("open");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  }
  if (action === "pick-home-workspace") {
    view.homeWorkspaceId = id;
    if (view.page === "workspaces" && id) {
      await loadWorkspaceDir(id, "");
      return true;
    }
    render();
    return true;
  }
  if (action === "pick-role-option") {
    const roleId = button.dataset.roleId;
    const field = button.dataset.roleField;
    const form = button.closest("form");
    const select = form?.querySelector(`[data-role-${field}="${roleId}"]`);
    const value = button.dataset.value || "";
    if (select && !select.disabled && [...select.options].some((option) => option.value === value)) {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return true;
  }
  if (action === "pick-home-agent") {
    const [prov, mod] = String(button.dataset.agent || "").split("::");
    if (prov) {
      view.homeChatProvider = prov;
      view.homeChatModel = mod || "";
      const conn = view.connectors?.[prov];
      const modelObj = conn?.models?.find((m) => m.id === mod) || conn?.models?.[0];
      const nextEffort = modelObj?.efforts?.includes(view.homeChatEffort)
        ? view.homeChatEffort
        : (modelObj?.efforts?.includes("medium") ? "medium" : modelObj?.efforts?.[0] || "medium");
      view.homeChatEffort = nextEffort;
      view.chatProvider = prov;
      view.chatModel = mod || "";
      view.chatEffort = nextEffort;
      if (view.homeRoles) {
        view.homeRoles.plan = { provider: prov, model: mod || "", effort: nextEffort };
        view.homeRoles.build = { provider: prov, model: mod || "", effort: nextEffort };
        view.homeRoles.review = { provider: prov, model: mod || "", effort: nextEffort };
      }
      render();
    }
    return true;
  }
  if (action === "pick-home-effort") {
    const nextEffort = button.dataset.effort || "medium";
    view.homeChatEffort = nextEffort;
    view.chatEffort = nextEffort;
    if (view.homeRoles) {
      if (view.homeRoles.plan) view.homeRoles.plan.effort = nextEffort;
      if (view.homeRoles.build) view.homeRoles.build.effort = nextEffort;
      if (view.homeRoles.review) view.homeRoles.review.effort = nextEffort;
    }
    render();
    return true;
  }
  if (action === "pick-task-chat-agent") {
    const [prov, mod] = String(button.dataset.agent || "").split("::");
    if (prov) {
      const taskId = button.dataset.id || button.closest("form")?.dataset.id;
      const targetTask = taskId ? view.state?.tasks?.find((item) => item.id === taskId) : null;
      if (button.closest(".multi-chat-pane") && taskId) {
        view.chatSplitSelections ||= {};
        const current = view.chatSplitSelections[taskId] || {};
        const conn = view.connectors?.[prov];
        const modelObj = conn?.models?.find((m) => m.id === mod) || conn?.models?.[0];
        const effort = modelObj?.efforts?.includes(current.effort) ? current.effort : (modelObj?.efforts?.includes("medium") ? "medium" : modelObj?.efforts?.[0] || "medium");
        view.chatSplitSelections[taskId] = { provider: prov, model: mod || "", effort };
        if (targetTask?.config) {
          targetTask.config.chatProvider = prov;
          targetTask.config.chatModel = mod || "";
          targetTask.config.chatEffort = effort;
        }
        render();
        return true;
      }
      view.chatProvider = prov;
      view.chatModel = mod || "";
      const conn = view.connectors?.[prov];
      const modelObj = conn?.models?.find((m) => m.id === mod) || conn?.models?.[0];
      view.chatEffort = modelObj?.efforts?.includes(view.chatEffort)
        ? view.chatEffort
        : (modelObj?.efforts?.includes("medium") ? "medium" : modelObj?.efforts?.[0] || "medium");
      view.homeChatProvider = prov;
      view.homeChatModel = mod || "";
      view.homeChatEffort = view.chatEffort;
      if (targetTask?.config) {
        targetTask.config.chatProvider = prov;
        targetTask.config.chatModel = mod || "";
        targetTask.config.chatEffort = view.chatEffort;
      }
      render();
    }
    return true;
  }
  if (action === "pick-task-chat-effort") {
    const taskId = button.dataset.id || button.closest("form")?.dataset.id;
    const targetTask = taskId ? view.state?.tasks?.find((item) => item.id === taskId) : null;
    const nextEffort = button.dataset.effort || "medium";
    if (button.closest(".multi-chat-pane") && taskId) {
      view.chatSplitSelections ||= {};
      const current = view.chatSplitSelections[taskId] || {};
      view.chatSplitSelections[taskId] = { ...current, effort: nextEffort };
      if (targetTask?.config) targetTask.config.chatEffort = nextEffort;
      render();
      return true;
    }
    view.chatEffort = nextEffort;
    view.homeChatEffort = nextEffort;
    if (targetTask?.config) targetTask.config.chatEffort = nextEffort;
    render();
    return true;
  }
  if (action === "toggle-home-isolated") { view.homeIsolated = !view.homeIsolated; render(); return true; }
  if (action === "pick-home-permission") { view.homePermissionPreset = button.dataset.permission || "workspace-write"; render(); return true; }
  if (action === "pick-task-permission") {
    const next = button.dataset.permission || "workspace-write";
    if (id) {
      const targetTask = view.state?.tasks?.find((item) => item.id === id);
      if (targetTask) targetTask.permissionPreset = next;
      render();
      void api(`/api/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ permissionPreset: next }) })
        .then(() => refresh())
        .catch((error) => showToast(error.message));
    }
    return true;
  }
  if (action === "cycle-home-permission") {
    const order = ["workspace-write", "full-access", "read-only"];
    const curr = view.homePermissionPreset || "workspace-write";
    view.homePermissionPreset = order[(order.indexOf(curr) + 1) % order.length];
    render();
    return true;
  }
  if (action === "arena-add-slot") {
    const slots = ensureHomeArenaSlots();
    if (slots.length >= 8) { showToast("Đa luồng hỗ trợ tối đa 8 nhánh Git worktree song song."); return true; }
    const last = slots[slots.length - 1] || { provider: "codex", model: "", effort: "medium" };
    view.homeArenaSlots = [...slots, { ...last }];
    render();
    return true;
  }
  if (action === "arena-clone-slot") {
    const slots = ensureHomeArenaSlots();
    if (slots.length >= 8) { showToast("Đa luồng hỗ trợ tối đa 8 nhánh Git worktree song song."); return true; }
    const idx = Number(button.dataset.index || 0);
    const source = slots[idx] || slots[0];
    const next = [...slots];
    next.splice(idx + 1, 0, { ...source });
    view.homeArenaSlots = next;
    render();
    return true;
  }
  if (action === "arena-remove-slot") {
    const slots = ensureHomeArenaSlots();
    if (slots.length <= 2) { showToast("Đa luồng cần ít nhất 2 nhánh để chạy song song."); return true; }
    const idx = Number(button.dataset.index || 0);
    view.homeArenaSlots = slots.filter((_, i) => i !== idx);
    render();
    return true;
  }
  if (action === "arena-preset") {
    const preset = button.dataset.preset;
    const candidates = availableArenaCompetitors();
    const slots = ensureHomeArenaSlots();
    const base = slots[0] || candidates[0] || { provider: "codex", model: "", effort: "medium" };
    if (preset === "same-2") view.homeArenaSlots = [{ ...base }, { ...base }];
    else if (preset === "same-3") view.homeArenaSlots = [{ ...base }, { ...base }, { ...base }];
    else if (preset === "all-providers") {
      view.homeArenaSlots = candidates.length >= 2
        ? candidates.slice(0, 8).map((c) => ({ provider: c.provider, model: c.model, effort: c.effort }))
        : [{ ...base }, { ...base }];
    }
    render();
    return true;
  }
  if (action === "remove-composer-attachment") {
    const scope = button.dataset.scope;
    const items = view.composerAttachments?.[scope] || [];
    view.composerAttachments[scope] = items.filter((item) => item.id !== button.dataset.attachmentId);
    if (!view.composerAttachments[scope].length) delete view.composerAttachments[scope];
    if (scope === "home") view.chatDraft = $(".home-composer [name=prompt]")?.value || "";
    else if (scope.startsWith("task:")) view.chatDraft = $(`.chat-composer[data-id="${CSS.escape(scope.slice(5))}"] [name=message]`)?.value || "";
    render();
    return true;
  }
  if (action === "view-error-details") { showErrorDetails(button.dataset.error); return true; }
  if (action === "apply-task-preset") {
    applyTaskPreset(button.closest("form[data-form=task]"));
    showToast(view.language === "en" ? "Task template applied. Review its settings before creating the task." : "Đã áp dụng mẫu. Hãy kiểm tra cấu hình trước khi tạo task.");
    return true;
  }
  if (action === "save-task-preset") { await saveTaskPreset(button.closest("form[data-form=task]")); return true; }
  if (action === "delete-task-preset") { await deleteTaskPreset(button.closest("form[data-form=task]")); return true; }
  if (action === "toggle-language") {
    view.language = setLanguage(view.language === "en" ? "vi" : "en");
    render();
    showToast(view.language === "en" ? "Đã chuyển giao diện sang tiếng Anh." : "Đã chuyển giao diện sang tiếng Việt.");
    return true;
  }
  if (action === "pick-theme") {
    const applied = setSavedThemeId(button.dataset.themeId || "");
    view.theme = applied.id;
    document.querySelectorAll(".wb-theme-menu[open]").forEach((menu) => { menu.open = false; });
    render();
    showToast(view.language === "en" ? `Switched theme to ${applied.label}.` : `Đã chuyển sang chủ đề ${applied.label}.`);
    return true;
  }
  if (action === "dismiss-desktop-setup") { view.desktopSetupOpen = false; try { localStorage.setItem("opensybau.setup-v3", "done"); localStorage.setItem("opensybau.desktop-setup-v2", "done"); } catch {} render(); return true; }
  if (action === "desktop-open-settings") { view.desktopSetupOpen = false; view.page = "settings"; view.selected = null; try { localStorage.setItem("opensybau.setup-v3", "done"); localStorage.setItem("opensybau.desktop-setup-v2", "done"); } catch {} render(); return true; }
  if (action === "open-setup-assistant") { view.desktopSetupOpen = true; render(); return true; }
  if (action === "app-update-check") {
    const state = await window.opensybauDesktop?.checkForUpdates();
    if (state?.status === "not-available") showToast(view.language === "en" ? "You are using the latest version." : "Bạn đang dùng phiên bản mới nhất.");
    else if (state?.status === "error") showToast(state.error || (view.language === "en" ? "Could not check for updates." : "Không kiểm tra được cập nhật."));
    else showToast(view.language === "en" ? "Checking for updates…" : "Đang kiểm tra cập nhật…");
    return true;
  }
  if (action === "app-update-restart") { await window.opensybauDesktop?.restartToUpdate(); return true; }
  if (action === "open-chat-split") {
    view.chatSplitReturnWorkspaceId = "";
    const workspaceId = button.dataset.workspaceId || "";
    view.chatSplitWorkspaceId = workspaceId;
    const isolatedChats = view.state.tasks.filter((task) => task.workspaceId === workspaceId && task.isolated && !task.archived && !task.worktreeCleaned && !task.worktreeAppliedAt).sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
    const requestedTask = isolatedChats.find((task) => task.id === button.dataset.taskId);
    view.chatSplitTaskIds = [...new Set([requestedTask?.id, ...isolatedChats.map((task) => task.id)].filter(Boolean))].slice(0, 2);
    view.chatSplitActiveTaskId = view.chatSplitTaskIds[0] || "";
    view.chatSplitPickerOpen = false; view.chatSplitCreateOpen = false; view.page = "chat"; view.selected = null; view.activeStageTabId = "chat"; view.stageSplit = false; view.chatDrawerOpen = false; clearSidebarSearch(); render(); return true;
  }
  if (action === "create-split-chat") {
    if ((view.chatSplitTaskIds || []).length >= 4) { showToast("Đã đạt giới hạn 4 khung chat."); return true; }
    const active = view.state.tasks.find((task) => task.id === view.chatSplitActiveTaskId);
    view.chatSplitReturnWorkspaceId = button.dataset.workspaceId || view.chatSplitWorkspaceId;
    view.homeWorkspaceId = view.chatSplitReturnWorkspaceId;
    view.homeChatProvider = active?.config?.chatProvider || view.homeChatProvider;
    view.homeChatModel = active?.config?.chatModel || view.homeChatModel;
    view.homeChatEffort = active?.config?.chatEffort || view.homeChatEffort;
    view.homePermissionPreset = active?.permissionPreset || view.homePermissionPreset || "workspace-write";
    view.chatSplitCreateDraft = ""; view.homeMode = "chat"; view.chatSplitCreateOpen = true; view.chatSplitPickerOpen = false; render(); return true;
  }
  if (action === "close-split-chat-create") { view.chatSplitCreateOpen = false; view.chatSplitCreateDraft = ""; view.chatSplitReturnWorkspaceId = ""; render(); return true; }
  if (action === "exit-chat-split") { view.selected = view.chatSplitActiveTaskId || view.chatSplitTaskIds[0] || null; view.chatSplitWorkspaceId = ""; view.chatSplitTaskIds = []; view.chatSplitCreateOpen = false; view.chatSplitReturnWorkspaceId = ""; view.activeStageTabId = "chat"; view.stageSplit = false; render(); return true; }
  if (action === "focus-chat-pane") { view.chatSplitActiveTaskId = id; view.activeStageTabId = "chat"; render(); return true; }
  if (action === "toggle-chat-picker") { view.chatSplitPickerOpen = !view.chatSplitPickerOpen; render(); return true; }
  if (action === "close-chat-picker") { view.chatSplitPickerOpen = false; render(); return true; }
  if (action === "add-chat-pane") { if (!view.chatSplitTaskIds.includes(id) && view.chatSplitTaskIds.length < 4) view.chatSplitTaskIds.push(id); view.chatSplitPickerOpen = false; render(); return true; }
  if (action === "remove-chat-pane") { view.chatSplitTaskIds = view.chatSplitTaskIds.filter((taskId) => taskId !== id); if (view.chatSplitActiveTaskId === id) view.chatSplitActiveTaskId = view.chatSplitTaskIds[0] || ""; render(); return true; }
  if (action === "new-chat") { view.chatSplitWorkspaceId = ""; view.chatSplitCreateOpen = false; view.chatSplitReturnWorkspaceId = ""; view.page = "chat"; view.selected = null; view.activeStageTabId = "chat"; view.stageSplit = false; view.chatDraft = ""; view.homeWorkspaceId = button.dataset.workspaceId || view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || ""; view.homeMode = "chat"; view.homeWorkflow = "chat-only"; clearSidebarSearch(); view.homeConfigOpen = false; closeOverlay(); render(); return true; }
  if (action === "refresh") { await scanCliProviders(button); return true; }
  if (action === "new-task") { await openTaskModal(); return true; }
  if (action === "project-quick-mode") {
    const wsId = button.dataset.workspaceId || view.selected || view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || "";
    const mode = button.dataset.mode || "chat";
    view.chatSplitWorkspaceId = ""; view.chatSplitCreateOpen = false; view.chatSplitReturnWorkspaceId = ""; view.page = "chat"; view.selected = null; view.activeStageTabId = "chat"; view.stageSplit = false; view.chatDraft = "";
    if (wsId) view.homeWorkspaceId = wsId;
    view.homeMode = mode;
    view.homeWorkflow = mode === "chat" ? "chat-only" : mode === "plan" ? "plan-only" : "codex-antigravity";
    clearSidebarSearch(); view.homeConfigOpen = false; closeOverlay(); render();
    $("[data-home-prompt]")?.focus({ preventScroll: true });
    return true;
  }
  if (action === "toggle-task-menu") { const key = button.dataset.key || id; view.taskMenuId = view.taskMenuId === key ? "" : key; render(); return true; }
  if (action === "rename-task") {
    const task = view.state.tasks.find((item) => item.id === id);
    view.taskMenuId = "";
    if (task) {
      showModal("Đổi tên chat", `<label>Tên chat<input name="title" value="${esc(task.title)}" maxlength="120" required autocomplete="off" spellcheck="false"></label>`, "Lưu tên", "task-rename");
      $(".modal").dataset.id = task.id;
    }
    return true;
  }
  if (action === "copy-task-prompt") {
    const task = view.state.tasks.find((item) => item.id === id);
    if (task?.prompt) { await navigator.clipboard.writeText(task.prompt); showToast("Đã sao chép yêu cầu ban đầu."); }
    else showToast("Chat này chưa có yêu cầu để sao chép.");
    view.taskMenuId = ""; render(); return true;
  }
  if (action === "toggle-home-config") { view.homeConfigOpen = !view.homeConfigOpen; render(); return true; }
  if (action === "toggle-chat-config") { view.chatConfigOpen = !view.chatConfigOpen; render(); return true; }
  if (action === "close-composer-config") { view.homeConfigOpen = false; view.chatConfigOpen = false; render(); return true; }
  if (action === "stop-task") { await api(`/api/tasks/${encodeURIComponent(id)}/stop`, { method: "POST" }); showToast("Đã gửi lệnh dừng."); await refresh(); return true; }
  if (action === "rerun-task") { await api(`/api/tasks/${encodeURIComponent(id)}/run`, { method: "POST" }); showToast("Task được đưa lại vào hàng đợi."); await refresh(); return true; }
  if (action === "rerun-stage") {
    const stage = button.closest(".stage-rerun-controls")?.querySelector("[data-rerun-stage]")?.value || "";
    await api(`/api/tasks/${encodeURIComponent(id)}/run`, { method: "POST", body: JSON.stringify({ stage }) });
    showToast(view.language === "en" ? "Task queued from the selected stage." : "Task đã vào hàng đợi từ giai đoạn đã chọn.");
    await refresh();
    return true;
  }
  if (action === "open-folder") { await api(`/api/tasks/${encodeURIComponent(id)}/open`, { method: "POST" }); showToast("Đã mở thư mục dự án trong Explorer."); return true; }
  if (action === "toggle-task-pin") {
    const task = view.state.tasks.find((item) => item.id === id);
    if (task) { await api(`/api/tasks/${encodeURIComponent(id)}/pin`, { method: "POST", body: JSON.stringify({ pinned: !task.pinned }) }); view.taskMenuId = ""; await refresh(); }
    return true;
  }
  if (action === "archive-task" || action === "restore-task") {
    await api(`/api/tasks/${encodeURIComponent(id)}/archive`, { method: "POST", body: JSON.stringify({ archived: action === "archive-task" }) });
    view.taskMenuId = ""; await refresh(); showToast(action === "archive-task" ? "Đã lưu trữ chat." : "Đã khôi phục chat.");
    return true;
  }
  if (action === "delete-chat") {
    const task = view.state.tasks.find((item) => item.id === id);
    if (!task || ["queued", "running"].includes(task.status)) { showToast("Hãy dừng chat trước khi xóa."); return true; }
    if (!confirm(`Xóa vĩnh viễn chat “${task.title}”? Lịch sử chat và bản ghi task sẽ bị xóa; thư mục workspace không bị ảnh hưởng.`)) return true;
    if (!task.archived) await api(`/api/tasks/${encodeURIComponent(id)}/archive`, { method: "POST", body: JSON.stringify({ archived: true }) });
    await api(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
    if (view.selected === id) { view.selected = null; view.page = "chat"; }
    view.taskMenuId = "";
    await refresh();
    showToast("Đã xóa chat vĩnh viễn.");
    return true;
  }
  if (action === "approve-plan-gate" || action === "revise-plan-gate") {
    const feedback = String($("[data-plan-gate-feedback]")?.value || "").trim();
    const gateAction = action === "approve-plan-gate" ? "approve" : "revise";
    if (gateAction === "revise" && !feedback) {
      showToast("Nhập ghi chú yêu cầu chỉnh sửa kế hoạch trước khi bấm Lập lại Plan.");
      $("[data-plan-gate-feedback]")?.focus();
      return true;
    }
    await api(`/api/tasks/${encodeURIComponent(id)}/plan-gate`, { method: "POST", body: JSON.stringify({ action: gateAction, feedback }) });
    await refresh();
    showToast(gateAction === "approve" ? "Đã duyệt kế hoạch (GO) — Agent bắt đầu triển khai!" : "Đã gửi yêu cầu lập lại kế hoạch cho Agent.");
    return true;
  }
  if (action === "run-task-qa") {
    const task = view.state.tasks.find((item) => item.id === (id || view.selected));
    if (!task) return true;
    const command = button.dataset.command || $("[data-task-qa-cmd]")?.value || task.qaCommand || "npm test";
    showToast(`Đang chạy lệnh QA: ${command}…`);
    const res = await api(`/api/tasks/${encodeURIComponent(task.id)}/qa`, { method: "POST", body: JSON.stringify({ command }) });
    await refresh();
    const statusMsg = res.qaResult?.status === "passed" ? "Thành công (PASS)" : `Thất bại (Exit ${res.qaResult?.code ?? 1})`;
    showToast(`QA hoàn tất: ${command} · ${statusMsg}`);
    return true;
  }
  if (action === "distill-task-skill") {
    const task = view.state.tasks.find((item) => item.id === (id || view.selected));
    if (!task) return true;
    const res = await api(`/api/tasks/${encodeURIComponent(task.id)}/distill-skill`, { method: "POST", body: JSON.stringify({}) });
    await refresh({ configuration: true });
    showToast(`Đã đúc kết Skill mới: ${res.skill?.name || "SKILL.md"}`);
    return true;
  }
  if (action === "compact-task-chat") {
    const task = view.state.tasks.find((item) => item.id === (id || view.selected));
    if (!task) return true;
    const res = await api(`/api/tasks/${encodeURIComponent(task.id)}/compact`, { method: "POST", body: JSON.stringify({}) });
    await refresh();
    showToast(res.compacted ? `Đã nén ${res.compactedCount} lượt hội thoại cũ.` : "Hội thoại còn ngắn, chưa cần nén.");
    return true;
  }
  if (action === "task-git-commit") {
    const message = String($("[data-git-commit-msg]")?.value || "").trim();
    if (!message) { showToast("Nhập nội dung commit message trước khi Commit."); $("[data-git-commit-msg]")?.focus(); return true; }
    await api(`/api/tasks/${encodeURIComponent(id)}/git-commit`, { method: "POST", body: JSON.stringify({ message }) });
    await refresh();
    showToast(`Đã commit thay đổi Git: ${message}`);
    return true;
  }
  if (action === "open-wave-decompose") { openWaveDecomposeModal(); return true; }
  if (action === "wave-status-filter") { view.waveStatusFilter = button.dataset.status || "all"; render(); return true; }
  if (action === "wave-risk-filter") { view.waveRiskFilter = button.dataset.risk || "all"; render(); return true; }
  if (action === "wave-critical-toggle") { view.waveCriticalOnly = !view.waveCriticalOnly; render(); return true; }
  if (action === "toggle-home-plan-gate") { view.homePlanGate = !view.homePlanGate; render(); return true; }
  if (action === "cycle-home-max-rounds") { const current = Number(view.homeMaxRounds) || 2; view.homeMaxRounds = current >= 3 ? 1 : current + 1; render(); return true; }
  if (action === "edit-task-goal") { const task = view.state.tasks.find((item) => item.id === id); if (task) openTaskGoalModal(task); return true; }
  if (action === "task-permissions") { const task = view.state.tasks.find((item) => item.id === id); if (task) openTaskPermissionsModal(task); return true; }
  if (action === "toggle-goal-item") {
    const itemId = button.dataset.goalId;
    const task = view.state.tasks.find((entry) => entry.id === id);
    const item = task?.goalChecklist?.find((entry) => entry.id === itemId);
    if (item) {
      const result = await api("/api/tasks/" + encodeURIComponent(id) + "/checklist", { method: "POST", body: JSON.stringify({ id: itemId, done: button.checked }) });
      task.goalChecklist = result.task.goalChecklist;
      button.nextElementSibling?.classList.toggle("is-done", button.checked);
    }
    return true;
  }
  if (action === "fork-chat") {
    const source = view.state.tasks.find((item) => item.id === id);
    if (source) {
      const result = await api("/api/tasks/" + encodeURIComponent(id) + "/fork", { method: "POST", body: JSON.stringify({ messageId: button.dataset.messageId }) });
      view.selected = result.task.id; view.page = "chat"; view.chatDraft = "";
      view.chatProvider = result.task.config.chatProvider || source.config?.roles?.plan?.provider || "codex";
      view.chatModel = result.task.config.chatModel || source.config?.roles?.plan?.model || "";
      view.chatEffort = result.task.config.chatEffort || source.config?.roles?.plan?.effort || "";
      await refresh(); showToast("Đã tạo nhánh chat tại lượt này. Chat gốc vẫn được giữ nguyên.");
    }
    return true;
  }
  if (action === "task-instruction") { const task = view.state.tasks.find((item) => item.id === id); if (task) openTaskInstructionModal(task); return true; }
  if (action === "inspect-task" || action === "open-task-flow") { view.selected = id; view.page = "flows"; render(); return true; }
  if (action === "back-flows") { view.selected = null; view.page = "flows"; render(); return true; }
  if (action === "back-chat") { view.selected = id; view.page = "chat"; render(); return true; }
  return false;
}
