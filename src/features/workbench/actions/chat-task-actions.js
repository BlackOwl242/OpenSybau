import { $, esc, setBoundedCache, view } from "../../../shared/state.js";
import { roleConfig } from "../../../domain/agent-roles.js";
import { setLanguage } from "../../../shared/i18n.js";
import { isMobileCompanionMode } from "../../../shared/remote-host.js";
import { setSavedThemeId } from "../../../shared/themes.js";
import {
  api,
  closeOverlay,
  ensureSubagentProfiles,
  ensureTaskSubagentsDetail,
  ensureCustomizationInventory,
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
  openSkillPickerModal,
  openSubagentDetailModal,
  openTaskGoalModal,
  openTaskInstructionModal,
  openTaskModal,
  openTaskPermissionsModal,
  showSubagentProfileCreateModal,
} from "../modals.js";
import {
  availableArenaCompetitors,
  clearSidebarSearch,
  ensureHomeArenaSlots,
} from "../pages/chat-page.js";
import { loadWorkspaceDir } from "../pages/tasks-workspaces-page.js";
import { loadVaultDir } from "../pages/knowledge-skills-page.js";
import { openWaveDecomposeModal } from "../pages/flows-memory-page.js";

export function syncTaskChatDraft(nextId) {
  view.chatDraftsByTask ||= {};
  const currentKey = view.selectedTaskId || view.selected || "__new__";
  view.chatDraftsByTask[currentKey] = view.chatDraft;
  setBoundedCache(view.chatDraftsByTask, currentKey, view.chatDraft);
  view.chatDraft = view.chatDraftsByTask[nextId || "__new__"] || "";
  view.mpSessionTab = "chat";
}

export async function handleChatAndTaskAction(action, id, button) {
  if (action === "toggle-sidebar-collapse") {
    view.sidebarCollapsed = !view.sidebarCollapsed;
    render();
    return true;
  }
  if (action === "stop-managed-command") {
    const targetTaskId = button.dataset.taskId || id || view.selectedTaskId || view.selected;
    await api(`/api/tasks/${encodeURIComponent(targetTaskId)}/terminal/${encodeURIComponent(button.dataset.commandId)}/stop`, { method: "POST" });
    await refresh(); showToast("Đã gửi yêu cầu dừng lệnh."); return true;
  }
  if (action === "set-codex-transport" || action === "pick-codex-transport") {
    const rawTransport = button.dataset.transport || "auto";
    if (id) {
      const resolved = rawTransport === "auto" ? "app-server" : rawTransport;
      await api(`/api/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ codexTransport: resolved }) });
      await refresh();
    } else {
      view.homeCodexTransport = rawTransport;
      render();
    }
    return true;
  }
  if (action === "cycle-home-codex-transport") {
    const order = ["auto", "app-server", "exec"];
    const curr = view.homeCodexTransport || "auto";
    view.homeCodexTransport = order[(order.indexOf(curr) + 1) % order.length];
    render();
    return true;
  }
  if (action === "open-skill-picker") {
    openSkillPickerModal(id || "");
    return true;
  }
  if (action === "toggle-picker-skill") {
    const skillId = String(button.dataset.skillId || "").trim();
    if (skillId) {
      const current = Array.isArray(view.homeSelectedSkills) ? [...view.homeSelectedSkills] : [];
      const next = button.checked
        ? [...new Set([...current, skillId])]
        : current.filter((s) => s !== skillId);
      view.homeSelectedSkills = next;
      const badge = document.querySelector("[data-skill-picker-count]");
      if (badge) {
        badge.textContent = next.length > 0 ? `Đã chọn ${next.length} kỹ năng` : "Tự động chọn theo ngữ cảnh";
      }
      render({ background: true });
    }
    return true;
  }
  if (action === "clear-picker-skills") {
    view.homeSelectedSkills = [];
    document.querySelectorAll("[data-skill-picker-root] input[type='checkbox'][data-action='toggle-picker-skill']").forEach((cb) => {
      cb.checked = false;
    });
    const badge = document.querySelector("[data-skill-picker-count]");
    if (badge) badge.textContent = "Tự động chọn theo ngữ cảnh";
    render({ background: true });
    return true;
  }
  if (action === "open-skill-library") {
    closeOverlay();
    if (view.page !== "skills") view.navOriginPage = view.page;
    view.page = "skills";
    view.skillsSection = "skills";
    view.selected = null;
    render();
    return true;
  }
  if (action === "steer-active-turn" || action === "resolve-cli-approval") {
    const targetTaskId = button.dataset.taskId || id || view.selectedTaskId || view.selected;
    const task = view.state.tasks.find((item) => item.id === targetTaskId);
    const approvalItem = action === "resolve-cli-approval"
      ? task?.pendingApprovals?.find((item) => String(item.id) === String(button.dataset.approvalId))
      : null;
    const turnId = action === "resolve-cli-approval"
      ? (approvalItem?.turnId || task?.liveControl?.turnId)
      : task?.liveControl?.turnId;
    if (!turnId || !targetTaskId) { showToast("Lượt chạy đã kết thúc."); return true; }
    let body;
    if (action === "steer-active-turn") {
      showModal("Gửi vào lượt đang chạy", `<label>Chỉ dẫn bổ sung<textarea name="message" required maxlength="50000" rows="4" autofocus></textarea></label><p class="form-note">Tin nhắn được gửi trực tiếp vào lượt Codex hiện tại. Nếu lượt đã kết thúc, hãy dùng ô chat để gửi lượt tiếp theo.</p>`, "Gửi", "task-steer");
      const form = $("#overlay [data-form=task-steer]");
      form.dataset.id = targetTaskId; form.dataset.turnId = turnId; form.dataset.requestId = crypto.randomUUID();
      return true;
    } else {
      const decision = button.dataset.decision || "accept";
      body = { turnId, id: approvalItem?.id ?? button.dataset.approvalId, decision };
      await api(`/api/tasks/${encodeURIComponent(targetTaskId)}/approval`, { method: "POST", body: JSON.stringify(body) });
      await refresh();
      showToast(decision === "decline" ? "Đã từ chối yêu cầu lệnh CLI." : "Đã cho phép thực thi lệnh CLI.");
      return true;
    }
  }
  if (action === "refresh-customizations") { await ensureCustomizationInventory(id, true); return true; }
  if (action === "cancel-queued-chat") {
    button.disabled = true;
    try {
      await api(`/api/tasks/${encodeURIComponent(id)}/chat-queue/${encodeURIComponent(button.dataset.messageId || "")}`, { method: "DELETE" });
      await refresh();
      showToast("Đã hủy tin nhắn đang chờ; nội dung đã chuyển vào stage trước không thể thu hồi.");
    } finally {
      if (button.isConnected) button.disabled = false;
    }
    return true;
  }
  if (action === "select-task") {
    const nextId = button?.dataset?.task || button?.dataset?.taskId || id || "";
    const selectedTask = view.state?.tasks?.find((item) => item.id === nextId);
    syncTaskChatDraft(nextId);
    clearSidebarSearch();
    view.selected = nextId;
    view.selectedTaskId = nextId;
    view.page = "chat";
    view.mobileScreen = "session";
    view.mpSessionTab = "chat";
    view.projectMenuId = "";
    view.taskMenuId = "";
    if (!view.stageSplit) view.activeStageTabId = "chat";
    if (selectedTask) {
      view.homeWorkspaceId = selectedTask.workspaceId || view.homeWorkspaceId;
      view.chatProvider = selectedTask.config?.workflow === "chat-only" ? selectedTask.config.chatProvider || "codex" : selectedTask.config?.chatProvider || roleConfig(selectedTask.config, "plan").provider || "codex";
      view.chatModel = selectedTask.config?.workflow === "chat-only" ? selectedTask.config.chatModel || "" : selectedTask.config?.chatModel || roleConfig(selectedTask.config, "plan").model || "";
      view.chatEffort = selectedTask.config?.workflow === "chat-only" ? selectedTask.config.chatEffort || "" : selectedTask.config?.chatEffort || roleConfig(selectedTask.config, "plan").effort || "";
    }
    render();
    return true;
  }
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
    syncTaskChatDraft(null);
    view.mobileScreen = "home";
    view.page = "chat";
    view.selected = null;
    view.selectedTaskId = "";
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
    syncTaskChatDraft(taskId);
    view.mobileScreen = "home";
    view.mpSessionTab = "chat";
    view.page = "chat";
    view.selected = taskId;
    view.selectedTaskId = taskId;
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
    render();
    return true;
  }
  if (action === "mp-new-session") {
    closeOverlay();
    clearSidebarSearch();
    if (button.dataset.workspaceId) view.homeWorkspaceId = button.dataset.workspaceId;
    else if (!view.homeWorkspaceId && view.state?.workspaces?.[0]?.id) view.homeWorkspaceId = view.state.workspaces[0].id;
    syncTaskChatDraft(null);
    view.mobileScreen = "home";
    view.mpSessionTab = "chat";
    view.page = "chat";
    view.selected = null;
    view.selectedTaskId = "";
    view.activeStageTabId = "chat";
    view.stageSplit = false;
    view.chatDrawerOpen = false;
    view.homeConfigOpen = false;
    render();
    requestAnimationFrame(() => $("[data-home-prompt]")?.focus({ preventScroll: true }));
    return true;
  }
  if (action === "mp-open-pair") {
    closeOverlay();
    view.mobileScreen = "home";
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
    if (view.page === "chat") syncTaskChatDraft(view.selectedTaskId || "");
    view.mobileScreen = "home";
    view.page = targetPage;
    view.chatDrawerOpen = false;
    if (targetPage === "workspaces") {
      view.activeStageTabId = "chat";
      const wsCandidate = view.selectedWorkspaceId || view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || null;
      const wsExists = wsCandidate && view.state?.workspaces?.some((w) => w.id === wsCandidate);
      view.selectedWorkspaceId = wsExists ? wsCandidate : (view.state?.workspaces?.[0]?.id || null);
      view.selected = view.selectedWorkspaceId;
    } else if (targetPage === "chat") {
      view.selected = view.selectedTaskId || null;
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
  if (action === "new-chat") { syncTaskChatDraft(null); view.chatSplitWorkspaceId = ""; view.chatSplitCreateOpen = false; view.chatSplitReturnWorkspaceId = ""; view.page = "chat"; view.selected = null; view.selectedTaskId = ""; view.mpSessionTab = "chat"; view.activeStageTabId = "chat"; view.stageSplit = false; view.homeWorkspaceId = button?.dataset?.workspaceId || view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || ""; view.homeMode = "chat"; view.homeWorkflow = "chat-only"; clearSidebarSearch(); view.homeConfigOpen = false; closeOverlay(); render(); return true; }
  if (action === "refresh") { await scanCliProviders(button); return true; }
  if (action === "new-task") { await openTaskModal(); return true; }
  if (action === "project-quick-mode") {
    const wsId = button.dataset.workspaceId || view.selected || view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || "";
    const mode = button.dataset.mode || "chat";
    syncTaskChatDraft(null);
    view.chatSplitWorkspaceId = ""; view.chatSplitCreateOpen = false; view.chatSplitReturnWorkspaceId = ""; view.page = "chat"; view.selected = null; view.selectedTaskId = ""; view.mpSessionTab = "chat"; view.activeStageTabId = "chat"; view.stageSplit = false;
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
    if (view.selected === id || view.selectedTaskId === id) {
      view.selected = null;
      view.selectedTaskId = null;
    }
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
    const targetId = id || view.selectedTaskId || view.selected;
    const task = view.state.tasks.find((item) => item.id === targetId);
    if (!task) return true;
    const res = await api(`/api/tasks/${encodeURIComponent(task.id)}/distill-skill`, { method: "POST", body: JSON.stringify({}) });
    view.skillsLoaded = false;
    await refresh({ configuration: true });
    showToast(`Đã đúc kết Skill mới: ${res.skill?.name || "SKILL.md"}`);
    return true;
  }
  if (action === "distill-task-memory") {
    const targetId = id || view.selectedTaskId || view.selected;
    const task = view.state.tasks.find((item) => item.id === targetId);
    if (!task) return true;
    const res = await api(`/api/tasks/${encodeURIComponent(task.id)}/distill-memory`, { method: "POST", body: JSON.stringify({}) });
    await refresh();
    showToast(`Đã đúc kết bài học vào Bộ nhớ: ${res.memory?.title || task.title}`);
    return true;
  }
  if (action === "compact-task-chat") {
    const targetId = id || view.selectedTaskId || view.selected;
    const task = view.state.tasks.find((item) => item.id === targetId);
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
  if (action === "reset-flow-filter") {
    view.waveStatusFilter = "all";
    view.waveRiskFilter = "all";
    view.waveCriticalOnly = false;
    view.filter = "all";
    render();
    return true;
  }
  if (action === "toggle-home-plan-gate") { view.homePlanGate = !view.homePlanGate; render(); return true; }
  if (action === "cycle-home-max-rounds") { const current = Number(view.homeMaxRounds) || 2; view.homeMaxRounds = current >= 3 ? 1 : current + 1; render(); return true; }
  if (action === "edit-task-goal") { const task = view.state.tasks.find((item) => item.id === (id || view.selectedTaskId || view.selected)); if (task) openTaskGoalModal(task); return true; }
  if (action === "edit-task-instruction") { const task = view.state.tasks.find((item) => item.id === (id || view.selectedTaskId || view.selected)); if (task) openTaskInstructionModal(task); return true; }
  if (action === "task-permissions") { const task = view.state.tasks.find((item) => item.id === (id || view.selectedTaskId || view.selected)); if (task) openTaskPermissionsModal(task); return true; }
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
  if (action === "fork-chat" || action === "fork-task-chat") {
    const source = view.state.tasks.find((item) => item.id === id);
    if (source) {
      const result = await api("/api/tasks/" + encodeURIComponent(id) + "/fork", { method: "POST", body: JSON.stringify({ messageId: button.dataset.messageId }) });
      if (view.page !== "chat") view.navOriginPage = view.page;
      syncTaskChatDraft(result.task.id);
      view.selected = result.task.id;
      view.selectedTaskId = result.task.id;
      view.page = "chat";
      view.mobileScreen = "home";
      view.mpSessionTab = "chat";
      view.chatProvider = result.task.config.chatProvider || source.config?.roles?.plan?.provider || "codex";
      view.chatModel = result.task.config.chatModel || source.config?.roles?.plan?.model || "";
      view.chatEffort = result.task.config.chatEffort || source.config?.roles?.plan?.effort || "";
      await refresh(); showToast("Đã tạo nhánh chat tại lượt này. Chat gốc vẫn được giữ nguyên.");
    }
    return true;
  }
  if (["pick-subagent-mode", "toggle-subagent-readonly", "toggle-codex-multi-v2", "toggle-subagent-profile"].includes(action)) {
    const scope = button.dataset.scope || (id ? "task" : "home");
    const targetTask = scope === "task" ? view.state?.tasks?.find((item) => item.id === (id || view.selected)) : null;
    const base = scope === "task" ? (targetTask?.subagentPolicy || {}) : (view.homeSubagentPolicy || {});
    const next = {
      mode: ["auto", "enabled", "disabled"].includes(base.mode) ? base.mode : "auto",
      codexMultiAgentV2: Boolean(base.codexMultiAgentV2),
      sharedCheckoutReadOnly: base.sharedCheckoutReadOnly !== false,
      profileIds: Array.isArray(base.profileIds) ? [...base.profileIds] : [],
    };
    if (action === "pick-subagent-mode") {
      const nextMode = button.dataset.mode || "auto";
      if (["auto", "enabled", "disabled"].includes(nextMode)) next.mode = nextMode;
    } else if (action === "toggle-subagent-readonly") {
      next.sharedCheckoutReadOnly = !next.sharedCheckoutReadOnly;
    } else if (action === "toggle-codex-multi-v2") {
      next.codexMultiAgentV2 = !next.codexMultiAgentV2;
    } else if (action === "toggle-subagent-profile") {
      const pid = String(button.dataset.profileId || "").trim();
      if (pid) {
        if (next.profileIds.includes(pid)) {
          next.profileIds = next.profileIds.filter((item) => item !== pid);
        } else {
          next.profileIds = [...next.profileIds, pid].slice(0, 12);
          if (next.mode === "disabled") next.mode = "auto";
        }
      }
    }
    if (scope === "task" && targetTask) {
      targetTask.subagentPolicy = next;
      render();
      await api(`/api/tasks/${encodeURIComponent(targetTask.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ subagentPolicy: next }),
      });
    } else {
      view.homeSubagentPolicy = next;
      render();
    }
    return true;
  }
  if (action === "open-dock-subagents" || action === "inspect-subagent" || action === "open-subagent-detail") {
    const targetId = id || view.selectedTaskId || view.selected;
    if (targetId) {
      if (view.page !== "chat" || isMobileCompanionMode() || button.closest("#overlay")) {
        await openSubagentDetailModal(targetId, button.dataset.subId || "");
      } else {
        view.selected = targetId;
        view.selectedTaskId = targetId;
        view.chatDrawerOpen = true;
        view.chatDrawerTab = "subagents";
        view.selectedDockSubagentId = button.dataset.subId || "";
        render();
        void ensureTaskSubagentsDetail(targetId, { force: true });
      }
    }
    return true;
  }
  if (action === "dock-subagent-filter") {
    view.dockSubagentFilter = button.dataset.subFilter || "all";
    render();
    return true;
  }
  if (action === "refresh-task-subagents") {
    const targetId = id || view.selectedTaskId || view.selected;
    if (targetId) {
      await ensureTaskSubagentsDetail(targetId, { force: true });
      showToast("Đã làm mới nhật ký Subagent.");
    }
    return true;
  }
  if (action === "promote-subagent" || action === "promote-subagent-worktree") {
    const targetId = id || view.selectedTaskId || view.selected;
    const subId = button.dataset.subId || "";
    if (!targetId || !subId) return true;
    const res = await api(`/api/tasks/${encodeURIComponent(targetId)}/subagents/${encodeURIComponent(subId)}/promote`, {
      method: "POST",
      body: JSON.stringify({}),
    });
    closeOverlay();
    if (res?.task?.id) {
      if (view.page !== "chat") view.navOriginPage = view.page;
      syncTaskChatDraft(res.task.id);
      view.selected = res.task.id;
      view.selectedTaskId = res.task.id;
      view.page = "chat";
      view.mobileScreen = "home";
      view.mpSessionTab = "chat";
    }
    await refresh();
    showToast(`Đã tách Subagent thành Worktree Task độc lập: ${res?.task?.title || "Task mới"}`);
    return true;
  }
  if (action === "create-subagent-profile" || action === "open-subagent-profiles") {
    showSubagentProfileCreateModal();
    return true;
  }
  if (action === "open-subagent-library") {
    closeOverlay();
    if (view.page !== "skills") view.navOriginPage = view.page;
    view.page = "skills";
    view.skillsSection = "subagents";
    view.selected = null;
    view.mobileScreen = "home";
    render();
    await ensureSubagentProfiles("", { force: false });
    render();
    return true;
  }
  if (action === "task-instruction") { const task = view.state.tasks.find((item) => item.id === (id || view.selectedTaskId || view.selected)); if (task) openTaskInstructionModal(task); return true; }
  if (action === "inspect-task" || action === "open-task-flow") {
    if (view.page !== "flows") view.navOriginPage = view.page;
    view.selected = id;
    view.page = "flows";
    render();
    return true;
  }
  if (action === "back-flows") { view.selected = null; view.page = "flows"; render(); return true; }
  if (action === "back-chat" || action === "open-task-chat") {
    const targetId = id || button.dataset.taskId || view.selectedTaskId || view.selected;
    closeOverlay();
    if (view.page !== "chat") view.navOriginPage = view.page;
    syncTaskChatDraft(targetId);
    view.selected = targetId;
    view.selectedTaskId = targetId;
    view.mobileScreen = "home";
    view.mpSessionTab = "chat";
    view.page = "chat";
    render();
    if (action === "open-task-chat") showToast("Đã mở phiên làm việc trong Không gian Chat.");
    return true;
  }
  return false;
}
