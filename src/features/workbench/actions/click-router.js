import { $, view } from "../../../shared/state.js";
import { roleConfig } from "../../../domain/agent-roles.js";
import { positionHtmlCommentMenu } from "../html-inspector.js";
import { api, closeOverlay, refresh, render, showToast } from "../runtime.js";
import { clearSidebarSearch } from "../pages/chat-page.js";
import { loadWorkspaceDir } from "../pages/tasks-workspaces-page.js";
import { loadVaultDir } from "../pages/knowledge-skills-page.js";
import { handleChatAndTaskAction } from "./chat-task-actions.js";
import { handleStageAndDiffAction } from "./stage-diff-actions.js";
import { handleWorkspaceVaultSettingsAction } from "./workspace-vault-actions.js";

export async function handleWorkbenchClick(event) {
  const clickedPop = event.target.closest?.(".codex-pop-menu, .composer-add");
  document.querySelectorAll(".codex-pop-menu[open], .composer-add[open]").forEach((menu) => {
    if (menu !== clickedPop) menu.open = false;
  });

  const popSummary = event.target.closest?.(".codex-pop-menu > summary");
  if (popSummary) {
    const menu = popSummary.parentElement;
    if (menu.closest(".codex-rail-bar, .home-composer-controls, .chat-composer-controls")) {
      menu.classList.add("is-up");
      menu.classList.remove("is-down");
    } else if (!menu.matches(".agent-role-picker, .home-config-select") && !menu.querySelector(".codex-pop-card.is-effort-list")) {
      menu.classList.add("is-down");
      menu.classList.remove("is-up");
    }
    requestAnimationFrame(() => {
      const scroller = menu.querySelector(".codex-pop-scroll");
      const selected = scroller?.querySelector(".codex-pop-item.is-selected, [aria-selected='true']");
      if (!scroller || !selected) return;
      const itemTop = selected.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const itemBottom = itemTop + selected.offsetHeight;
      if (itemTop < scroller.scrollTop) scroller.scrollTop = itemTop;
      else if (itemBottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = itemBottom - scroller.clientHeight;
    });
  }

  const rolePickerSummary = event.target.closest?.(".agent-role-picker > summary, .home-config-select > summary");
  if (rolePickerSummary) {
    const menu = rolePickerSummary.parentElement;
    let triggerRect = rolePickerSummary.getBoundingClientRect();
    let clipBounds = { top: 0, bottom: window.innerHeight };
    let scrollContainer = null;
    for (let parent = menu.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const overflowY = getComputedStyle(parent).overflowY;
      if (["auto", "scroll"].includes(overflowY) && parent.scrollHeight > parent.clientHeight) {
        scrollContainer = parent;
        const bounds = parent.getBoundingClientRect();
        clipBounds = { top: Math.max(0, bounds.top), bottom: Math.min(window.innerHeight, bounds.bottom) };
        break;
      }
    }
    const optionCount = menu.querySelectorAll(".codex-pop-item").length;
    const hasGroup = Boolean(menu.querySelector("[data-role-picker-group]"));
    const fullHeight = Math.min(236, optionCount * 33 + (hasGroup ? 23 : 0)) + 52;
    let spaceBelow = Math.max(0, clipBounds.bottom - triggerRect.bottom - 10);
    const preferredDownSpace = Math.min(fullHeight, 212);
    if (spaceBelow < preferredDownSpace && scrollContainer) {
      const remainingScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop;
      const scrollBy = Math.min(preferredDownSpace - spaceBelow, Math.max(0, remainingScroll));
      if (scrollBy > 0) {
        scrollContainer.scrollTop += scrollBy;
        triggerRect = rolePickerSummary.getBoundingClientRect();
        const bounds = scrollContainer.getBoundingClientRect();
        clipBounds = { top: Math.max(0, bounds.top), bottom: Math.min(window.innerHeight, bounds.bottom) };
        spaceBelow = Math.max(0, clipBounds.bottom - triggerRect.bottom - 10);
      }
    }
    const spaceAbove = Math.max(0, triggerRect.top - clipBounds.top - 10);
    const opensDown = spaceBelow >= preferredDownSpace || spaceBelow >= spaceAbove;
    const availableSpace = opensDown ? spaceBelow : spaceAbove;
    const listHeight = Math.max(64, Math.min(236, availableSpace - 52));
    menu.classList.toggle("is-down", opensDown);
    menu.classList.toggle("is-up", !opensDown);
    menu.style.setProperty("--role-picker-list-height", `${listHeight}px`);
  }

  const htmlCommentSummary = event.target.closest?.(".orca-el-model-bar .codex-pop-menu > summary");
  if (htmlCommentSummary) positionHtmlCommentMenu(htmlCommentSummary.parentElement);
  if (event.target.matches?.(".home-config-backdrop")) { view.homeConfigOpen = false; render(); return; }
  if (event.target.matches?.(".task-chat-config-backdrop")) { view.chatConfigOpen = false; render(); return; }

  const page = event.target.closest("[data-page]");
  if (page) {
    event.preventDefault();
    closeOverlay();
    view.projectMenuId = "";
    view.page = page.dataset.page;
    view.mobileScreen = view.page === "chat" ? (view.selected ? "session" : "home") : "page";
    if (view.page === "workspaces") {
      view.activeStageTabId = "chat";
      const wsExists = view.selected && view.state?.workspaces?.some((w) => w.id === view.selected);
      if (!wsExists) {
        view.selected = view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || null;
        view.workspaceDir = "";
        view.workspaceEntries = [];
      }
    } else if (view.page !== "chat") {
      view.selected = null;
    }
    view.filePreview = null;
    render();
    if (view.page === "settings") void refresh({ configuration: true });
    try {
      if (view.page === "workspaces" && view.selected) await loadWorkspaceDir(view.selected, view.workspaceDir || "");
      if (view.page === "knowledge" && view.state.settings.vaultPath) await loadVaultDir("");
      if (view.page === "skills") {
        const result = await api("/api/skills");
        view.skills = result.skills || [];
        view.skillsLoaded = true;
        render();
      }
    } catch (error) {
      showToast(error.message);
    }
    return;
  }

  const task = event.target.closest("[data-task]");
  if (task) {
    const selectedTask = view.state.tasks.find((item) => item.id === task.dataset.task);
    clearSidebarSearch();
    view.selected = task.dataset.task;
    view.page = "chat";
    view.mobileScreen = "session";
    view.mpSessionTab = "chat";
    view.projectMenuId = "";
    view.taskMenuId = "";
    if (!view.stageSplit) view.activeStageTabId = "chat";
    view.homeWorkspaceId = selectedTask?.workspaceId || view.homeWorkspaceId;
    view.chatProvider = selectedTask?.config.workflow === "chat-only" ? selectedTask.config.chatProvider || "codex" : selectedTask?.config?.chatProvider || roleConfig(selectedTask?.config, "plan").provider || "codex";
    view.chatModel = selectedTask?.config.workflow === "chat-only" ? selectedTask.config.chatModel || "" : selectedTask?.config?.chatModel || roleConfig(selectedTask?.config, "plan").model || "";
    view.chatEffort = selectedTask?.config.workflow === "chat-only" ? selectedTask.config.chatEffort || "" : selectedTask?.config?.chatEffort || roleConfig(selectedTask?.config, "plan").effort || "";
    view.chatDraft = "";
    render();
    return;
  }

  const homeMode = event.target.closest("[data-home-mode]");
  if (homeMode) {
    homeMode.closest(".home-mode-picker")?.removeAttribute("open");
    view.homeMode = homeMode.dataset.homeMode;
    if (view.homeMode === "chat") view.homeWorkflow = "chat-only";
    if (view.homeMode === "plan") view.homeWorkflow = "plan-only";
    if (view.homeMode === "code") view.homeWorkflow = "codex-antigravity";
    render();
    if (view.homeMode === "chat") $("[data-home-prompt]")?.focus({ preventScroll: true });
    return;
  }

  const workspace = event.target.closest("[data-workspace]");
  if (workspace) {
    clearSidebarSearch();
    await loadWorkspaceDir(workspace.dataset.workspace, "").catch((error) => showToast(error.message));
    return;
  }

  const filter = event.target.closest("[data-filter]");
  if (filter) {
    view.filter = filter.dataset.filter;
    render();
    return;
  }

  const button = event.target.closest("[data-action]");
  if (!button) {
    if (view.projectMenuId && !event.target.closest(".wb-project-group")) { view.projectMenuId = ""; render(); }
    if (view.taskMenuId && !event.target.closest(".wb-task-item")) { view.taskMenuId = ""; render(); }
    return;
  }

  const action = button.dataset.action;
  const id = button.dataset.id;
  button.closest(".codex-pop-menu")?.removeAttribute("open");
  if (!button.closest(".wb-project-group") && view.projectMenuId) { view.projectMenuId = ""; render(); }
  if (!button.closest(".wb-task-item") && view.taskMenuId) view.taskMenuId = "";

  try {
    if (await handleChatAndTaskAction(action, id, button, event)) return;
    if (await handleStageAndDiffAction(action, id, button, event)) return;
    await handleWorkspaceVaultSettingsAction(action, id, button, event);
  } catch (error) {
    showToast(error.message);
  }
}
