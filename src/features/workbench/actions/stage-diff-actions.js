import { $, esc, fmtDate, view } from "../../../shared/state.js";
import { providerTitle, roleConfig } from "../../../domain/agent-roles.js";
import { defaultFileTabMode } from "../stage-viewer.js";
import { resolveHtmlCommentAgentSelection, syncHtmlInspectUi } from "../html-inspector.js";
import { openGithubCreatePrModal, openGithubIssuesModal } from "../notifications.js";
import {
  api,
  closeOverlay,
  ensureWorkspaceFileIndex,
  ensureWorkspaceGitStatus,
  refresh,
  render,
  showModal,
  showToast,
} from "../runtime.js";
import {
  loadStageTabDiff,
  openAllChangesStageTab,
  openLiveUrlTab,
  openStageDocTab,
  openStageFileTab,
  reloadStageFileTab,
} from "../stage-tabs.js";
import {
  openArenaCompareModal,
  openStageDocModal,
  renderDiffStudioModal,
  showDiffModal,
} from "../modals.js";

export async function handleStageAndDiffAction(action, id, button, event) {
  if (action === "show-diff" || action === "open-diff-modal") {
    const targetId = id || view.selectedTaskId || view.selected;
    const data = await api(`/api/tasks/${encodeURIComponent(targetId)}/diff`);
    showDiffModal(data, targetId, button.dataset.path || "");
    return true;
  }
  if (action === "open-diff-file" || action === "open-stage-file") {
    const targetId = id || view.selectedTaskId || view.selected;
    const targetTask = (view.state?.tasks || []).find((item) => item.id === targetId);
    const filePath = button.dataset.path || "";
    if (!["chat", "workspaces"].includes(view.page) && targetTask?.id) {
      const data = await api(`/api/tasks/${encodeURIComponent(targetTask.id)}/diff`);
      showDiffModal(data, targetTask.id, filePath);
      return true;
    }
    await openStageFileTab({
      workspaceId: button.dataset.workspaceId || targetTask?.workspaceId || "",
      taskId: targetId || "",
      path: filePath,
      showChanges: action === "open-diff-file" || button.dataset.showChanges === "true",
    });
    return true;
  }
  if (action === "open-all-changes-tab") {
    const selectedTask = view.selected ? (view.state?.tasks || []).find((t) => t.id === view.selected) : null;
    const wsId = button.dataset.workspaceId
      || (view.page === "workspaces" && view.selected ? view.selected : "")
      || selectedTask?.workspaceId
      || view.homeWorkspaceId
      || view.state?.workspaces?.[0]?.id
      || "";
    if (wsId) {
      if (window.matchMedia("(max-width: 740px)").matches) {
        view.chatDrawerOpen = false;
      }
      await openAllChangesStageTab({
        workspaceId: wsId,
        taskId: id || (view.page === "chat" ? view.selected : "") || "",
      });
    }
    return true;
  }
  if (action === "toggle-dock-section") {
    const section = button.dataset.section || "";
    if (section) {
      const set = new Set(view.collapsedDockSections || []);
      if (set.has(section)) set.delete(section);
      else set.add(section);
      view.collapsedDockSections = [...set];
      render();
    }
    return true;
  }
  if (action === "git-toggle-stage") {
    event.stopPropagation();
    const wsId = button.dataset.workspaceId
      || (view.page === "workspaces" && view.selected ? view.selected : "")
      || view.homeWorkspaceId
      || view.state?.workspaces?.[0]?.id
      || "";
    const filePath = button.dataset.path || "";
    const stageAction = button.dataset.stageAction || "stage";
    const taskId = id || (view.page === "chat" ? view.selected : "") || "";
    if (wsId && filePath) {
      await api(`/api/workspaces/${encodeURIComponent(wsId)}/git-stage`, {
        method: "POST",
        body: JSON.stringify({ path: filePath, action: stageAction, taskId }),
      });
      await ensureWorkspaceGitStatus(wsId, taskId, { force: true });
      const activeTab = (view.stageTabs || []).find((t) => t.id === view.activeStageTabId);
      if (activeTab && activeTab.workspaceId === wsId && (activeTab.path === filePath || activeTab.kind === "all-changes")) {
        await loadStageTabDiff(activeTab.id, activeTab.diffBase || "unstaged");
      } else {
        render();
      }
    }
    return true;
  }
  if (action === "toggle-stage-show-changes") {
    const tabId = button.dataset.tabId || view.activeStageTabId;
    const tab = (view.stageTabs || []).find((item) => item.id === tabId);
    if (tab) {
      tab.showChanges = !tab.showChanges;
      if (tab.showChanges) {
        tab.mode = "code";
        tab.diffHunkIndex = 0;
        if (!tab.diffData) {
          await loadStageTabDiff(tab.id, tab.diffBase || "unstaged");
          return true;
        }
      }
      render();
    }
    return true;
  }
  if (action === "select-stage-diff-base") {
    const tabId = button.dataset.tabId || view.activeStageTabId;
    const tab = (view.stageTabs || []).find((item) => item.id === tabId);
    const nextBase = button.dataset.base || "unstaged";
    button.closest?.("details")?.removeAttribute("open");
    if (tab) {
      tab.diffBase = nextBase;
      tab.showChanges = true;
      tab.mode = "code";
      tab.diffHunkIndex = 0;
      await loadStageTabDiff(tab.id, nextBase);
    }
    return true;
  }
  if (action === "toggle-stage-diff-split") {
    const tabId = button.dataset.tabId || view.activeStageTabId;
    const tab = (view.stageTabs || []).find((item) => item.id === tabId);
    if (tab) {
      tab.diffSplit = !tab.diffSplit;
      view.stageDiffSplit = tab.diffSplit;
      render();
    }
    return true;
  }
  if (action === "step-stage-diff-hunk") {
    const tabId = button.dataset.tabId || view.activeStageTabId;
    const tab = (view.stageTabs || []).find((item) => item.id === tabId);
    if (tab) {
      const dir = Number(button.dataset.dir || 1);
      const anchors = document.querySelectorAll('[id^="stage-diff-change-"]');
      const total = Math.max(1, anchors.length);
      const current = Number(tab.diffHunkIndex) || 0;
      tab.diffHunkIndex = ((current + dir) % total + total) % total;
      render();
      requestAnimationFrame(() => {
        document.getElementById(`stage-diff-change-${tab.diffHunkIndex}`)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      });
    }
    return true;
  }
  if (action === "copy-stage-file-content") {
    const tabId = button.dataset.tabId || view.activeStageTabId;
    const tab = (view.stageTabs || []).find((item) => item.id === tabId);
    const text = tab?.fileData?.content ?? tab?.diffData?.diff ?? "";
    button.closest?.("details")?.removeAttribute("open");
    try {
      await navigator.clipboard.writeText(String(text));
      showToast("Đã sao chép nội dung tệp vào clipboard.");
    } catch {
      showToast("Không thể sao chép vào clipboard.");
    }
    return true;
  }
  if (action === "copy-stage-file-path") {
    const path = button.dataset.path || "";
    button.closest?.("details")?.removeAttribute("open");
    if (path) {
      try {
        await navigator.clipboard.writeText(path);
        showToast(`Đã sao chép đường dẫn: ${path}`);
      } catch {
        showToast("Không thể sao chép đường dẫn.");
      }
    }
    return true;
  }
  if (action === "activate-stage-tab") {
    if (event.target.closest?.("[data-action='close-stage-tab']")) return true;
    const tabId = button.dataset.tabId || "chat";
    view.activeStageTabId = tabId;
    view.stageLineCommentTarget = null;
    render();
    return true;
  }
  if (action === "close-stage-tab") {
    event.stopPropagation();
    const tabId = button.dataset.tabId || "";
    const closingTab = (view.stageTabs || []).find((item) => item.id === tabId);
    const hasUnsaved = Boolean(closingTab && typeof closingTab.editDraft === "string" && closingTab.editDraft !== String(closingTab.fileData?.content ?? ""));
    if (hasUnsaved && !confirm(`Tab “${closingTab.name || closingTab.path}” có chỉnh sửa chưa lưu. Bạn chắc chắn muốn đóng và bỏ thay đổi?`)) {
      return true;
    }
    view.stageTabs = (view.stageTabs || []).filter((item) => item.id !== tabId);
    if (!view.stageTabs.length) {
      view.activeStageTabId = "chat";
      view.stageSplit = false;
    } else if (view.activeStageTabId === tabId) {
      view.activeStageTabId = view.stageTabs[view.stageTabs.length - 1].id;
    }
    view.stageLineCommentTarget = null;
    render();
    return true;
  }
  if (action === "toggle-stage-split") {
    view.stageSplit = !view.stageSplit;
    if (view.stageSplit && view.activeStageTabId === "chat" && view.stageTabs?.length) {
      view.activeStageTabId = view.stageTabs[view.stageTabs.length - 1].id;
    }
    render();
    return true;
  }
  if (action === "stage-tab-mode") {
    const tabId = button.dataset.tabId || view.activeStageTabId;
    const tab = (view.stageTabs || []).find((item) => item.id === tabId);
    if (tab && button.dataset.mode) {
      if (button.dataset.mode === "edit" && typeof tab.editDraft !== "string") {
        tab.editDraft = tab.fileData?.content ?? "";
      }
      tab.mode = button.dataset.mode;
      view.stageLineCommentTarget = null;
      render();
    }
    return true;
  }
  if (action === "cancel-stage-file-edit") {
    const tabId = button.dataset.tabId || view.activeStageTabId;
    const tab = (view.stageTabs || []).find((item) => item.id === tabId);
    if (tab) {
      delete tab.editDraft;
      tab.mode = defaultFileTabMode(tab.ext);
      render();
    }
    return true;
  }
  if (action === "save-stage-file") {
    const tabId = button.dataset.tabId || view.activeStageTabId;
    const tab = (view.stageTabs || []).find((item) => item.id === tabId);
    if (!tab || !tab.workspaceId || !tab.path) return true;
    const editorEl = document.querySelector(`[data-stage-file-editor="${CSS.escape(tab.id)}"]`) || document.querySelector("[data-stage-file-editor]");
    const content = editorEl ? editorEl.value : (tab.editDraft ?? tab.fileData?.content ?? "");
    const saved = await api(`/api/workspaces/${encodeURIComponent(tab.workspaceId)}/file`, {
      method: "PUT",
      body: JSON.stringify({
        path: tab.path,
        taskId: tab.taskId || "",
        content,
      }),
    });
    tab.fileData = saved;
    delete tab.editDraft;
    tab.mode = defaultFileTabMode(tab.ext);
    tab.loadedAt = Date.now();
    await ensureWorkspaceGitStatus(tab.workspaceId, tab.taskId || "", { force: true });
    await loadStageTabDiff(tab.id, tab.diffBase || "unstaged");
    render();
    showToast(`Đã lưu tệp ${tab.path}.`);
    return true;
  }
  if (action === "open-github-issues") {
    const selectedTask = view.selected ? (view.state?.tasks || []).find((t) => t.id === view.selected) : null;
    const wsId = button.dataset.workspaceId || (view.page === "workspaces" && view.selected ? view.selected : "") || selectedTask?.workspaceId || view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || "";
    if (wsId) await openGithubIssuesModal(wsId, { api, showModal });
    return true;
  }
  if (action === "open-github-create-pr") {
    const task = view.state.tasks.find((item) => item.id === (id || view.selected));
    if (task) openGithubCreatePrModal(task, { showModal });
    return true;
  }
  if (action === "import-github-issue") {
    const wsId = button.dataset.workspaceId || view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || "";
    const num = button.dataset.issueNumber || "";
    const title = button.dataset.issueTitle || "";
    const bodyText = button.dataset.issueBody || "";
    const issueUrl = button.dataset.issueUrl || "";
    closeOverlay();
    view.page = "chat";
    view.selected = null;
    view.selectedTaskId = null;
    view.chatSplitWorkspaceId = "";
    view.mobileScreen = "home";
    if (wsId) view.homeWorkspaceId = wsId;
    view.chatDraft = `Giải quyết GitHub Issue #${num}: ${title}\n${issueUrl ? `URL: ${issueUrl}\n` : ""}${bodyText ? `\nMô tả chi tiết:\n${bodyText}` : ""}`.trim();
    render();
    $("[data-home-prompt]")?.focus();
    showToast(`Đã nạp GitHub Issue #${num} vào khung tạo tác vụ.`);
    return true;
  }
  if (action === "reload-stage-tab") {
    const tabId = button.dataset.tabId || view.activeStageTabId;
    if (tabId && tabId !== "chat") {
      await reloadStageFileTab(tabId);
      showToast("Đã làm mới nội dung tệp.");
    }
    return true;
  }
  if (action === "open-stage-line-comment") {
    const rowEl = button.matches?.(".codex-split-cell")
      ? button
      : button.closest(".codex-split-cell, .stage-code-row, .orca-code-row, .diff-row, .orca-diff-row, .stage-code-line, .stage-diff-line, tr");
    const domCode = rowEl?.querySelector(".stage-code-text, .diff-cell-code, .orca-code-text, .orca-diff-code, .orca-file-code, .stage-diff-code, code")?.textContent || "";
    view.stageLineCommentTarget = {
      key: button.dataset.key || "",
      path: button.dataset.path || "",
      line: button.dataset.line || "1",
      code: button.dataset.code || domCode,
    };
    render();
    $("[data-stage-line-comment-input]")?.focus();
    return true;
  }
  if (action === "cancel-stage-line-comment") {
    view.stageLineCommentTarget = null;
    render();
    return true;
  }
  if (action === "send-stage-line-comment") {
    const comment = String($("[data-stage-line-comment-input]")?.value || "").trim();
    const target = view.stageLineCommentTarget;
    if (!comment || !target) { showToast("Nhập nội dung nhận xét cho dòng này trước khi gửi."); return true; }
    const snippet = `Tại tệp @${target.path} (Dòng ${target.line}: \`${String(target.code || "").trim().slice(0, 120)}\`): ${comment}`;
    view.stageLineCommentTarget = null;
    const activeTask = view.page === "chat" && view.selected ? view.state.tasks.find((t) => t.id === view.selected) : null;
    if (activeTask && String(snippet).length >= 6) {
      const wf = activeTask.config?.workflow || "codex-antigravity";
      const provider = view.chatProvider || (wf === "chat-only" ? activeTask.config?.chatProvider : roleConfig(activeTask.config, "build")?.provider || roleConfig(activeTask.config, "plan")?.provider) || "codex";
      const models = view.connectors?.[provider]?.models || [];
      const model = view.chatModel || models[0]?.id || "";
      const effort = view.chatEffort || "medium";
      await api(`/api/tasks/${encodeURIComponent(activeTask.id)}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: snippet, provider, model, effort }),
      });
      view.stageSplit = true;
      await refresh();
      showToast(`Đã gửi nhận xét dòng ${target.line} của ${target.path} cho Agent!`);
    } else {
      view.page = "chat";
      view.stageSplit = true;
      view.chatDraft = view.chatDraft ? `${view.chatDraft}\n${snippet}` : snippet;
      render();
      const textarea = $(".chat-input") || $("[data-home-prompt]");
      textarea?.focus();
      showToast("Đã chèn nhận xét dòng vào khung Chat.");
    }
    return true;
  }
  if (action === "toggle-html-inspect") {
    view.stageHtmlInspectActive = !view.stageHtmlInspectActive;
    if (!view.stageHtmlInspectActive) {
      view.stageHtmlSelectedElement = null;
      view.stageHtmlCommentDraft = "";
    }
    syncHtmlInspectUi();
    return true;
  }
  if (action === "close-html-inspect") {
    view.stageHtmlInspectActive = false;
    view.stageHtmlSelectedElement = null;
    view.stageHtmlCommentDraft = "";
    syncHtmlInspectUi();
    return true;
  }
  if (action === "cancel-html-element-comment") {
    view.stageHtmlSelectedElement = null;
    view.stageHtmlCommentDraft = "";
    syncHtmlInspectUi();
    return true;
  }
  if (action === "pick-html-comment-agent") {
    const [prov, mod] = String(button.dataset.agent || "").split("::");
    if (prov) {
      view.stageHtmlCommentProvider = prov;
      view.stageHtmlCommentModel = mod || "";
      const conn = view.connectors?.[prov];
      const modelObj = conn?.models?.find((m) => m.id === mod) || conn?.models?.[0];
      view.stageHtmlCommentEffort = modelObj?.efforts?.includes(view.stageHtmlCommentEffort)
        ? view.stageHtmlCommentEffort
        : (modelObj?.efforts?.includes("medium") ? "medium" : modelObj?.efforts?.[0] || "medium");
      view.stageHtmlCommentDraft = String($("[data-html-element-comment-input]")?.value ?? view.stageHtmlCommentDraft ?? "");
      syncHtmlInspectUi();
    }
    return true;
  }
  if (action === "pick-html-comment-effort") {
    view.stageHtmlCommentEffort = button.dataset.effort || "medium";
    view.stageHtmlCommentDraft = String($("[data-html-element-comment-input]")?.value ?? view.stageHtmlCommentDraft ?? "");
    syncHtmlInspectUi();
    return true;
  }
  if (action === "send-html-element-comment") {
    const comment = String($("[data-html-element-comment-input]")?.value || view.stageHtmlCommentDraft || "").trim();
    const el = view.stageHtmlSelectedElement;
    if (!comment || !el) {
      showToast("Nhập nội dung nhận xét cho phần tử HTML này trước khi gửi.");
      return true;
    }
    const fallback = resolveHtmlCommentAgentSelection();
    const provider = fallback.provider || "codex";
    const model = fallback.model || "";
    const effort = fallback.effort || "medium";
    view.stageHtmlCommentProvider = provider;
    view.stageHtmlCommentModel = model;
    view.stageHtmlCommentEffort = effort;
    view.chatProvider = provider;
    view.chatModel = model;
    view.chatEffort = effort;

    const activeTab = (view.stageTabs || []).find((t) => t.id === view.activeStageTabId) || (view.stageSplit ? (view.stageTabs || []).at(-1) : null);
    const filePath = activeTab?.path || "index.html";
    const selectorText = el.selector ? `\`${el.selector}\`` : `\`<${el.tagName || "element"}>\``;
    const labelText = el.label ? ` ("${el.label}")` : "";
    const htmlBlock = el.outerHTML ? `\n\`\`\`html\n${el.outerHTML}\n\`\`\`\n` : "\n";
    const snippet = `Tại tệp @${filePath} — Phần tử ${selectorText}${labelText}:${htmlBlock}Yêu cầu chỉnh sửa: ${comment}`;

    view.stageHtmlSelectedElement = null;
    view.stageHtmlCommentDraft = "";
    syncHtmlInspectUi();

    const activeTask = view.page === "chat" && view.selected ? (view.state?.tasks || []).find((t) => t.id === view.selected) : null;
    if (activeTask) {
      await api(`/api/tasks/${encodeURIComponent(activeTask.id)}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: snippet, provider, model, effort }),
      });
      view.stageSplit = true;
      await refresh();
      showToast(`Đã gửi nhận xét phần tử <${el.tagName}> cho ${providerTitle(view.connectors, provider)}!`);
    } else {
      const wsId = activeTab?.workspaceId || view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || "";
      if (wsId) {
        const created = await api("/api/tasks", {
          method: "POST",
          body: JSON.stringify({
            title: `${filePath} · ${comment.slice(0, 56)}`,
            prompt: snippet,
            workspaceId: wsId,
            workflow: "chat-only",
            permissionPreset: view.homePermissionPreset || "workspace-write",
            chatProvider: provider,
            chatModel: model,
            chatEffort: effort,
          }),
        });
        view.page = "chat";
        view.selected = created.task.id;
        view.selectedTaskId = created.task.id;
        view.chatSplitWorkspaceId = "";
        view.mobileScreen = "session";
        if (created.task.workspaceId) view.homeWorkspaceId = created.task.workspaceId;
        view.stageSplit = true;
        await refresh();
        showToast(`Đã tạo tác vụ mới và gửi phần tử <${el.tagName}> cho ${providerTitle(view.connectors, provider)}!`);
      } else {
        view.page = "chat";
        view.stageSplit = true;
        view.chatDraft = view.chatDraft ? `${view.chatDraft}\n\n${snippet}` : snippet;
        render();
        showToast("Đã chèn nhận xét phần tử HTML vào khung Chat.");
      }
    }
    return true;
  }
  if (action === "select-diff-file") { view.diffSelectedFile = button.dataset.path || ""; view.diffAnnotationTarget = null; renderDiffStudioModal(); return true; }
  if (action === "open-diff-comment") {
    const rowEl = button.closest(".diff-row, .orca-diff-row, .diff-studio-line, .stage-diff-line, tr");
    const domCode = rowEl?.querySelector(".diff-cell-code, .orca-diff-code, .diff-line-text, .stage-diff-code, code")?.textContent || "";
    view.diffAnnotationTarget = { key: button.dataset.key, path: button.dataset.path, line: button.dataset.line, side: button.dataset.side || "", code: button.dataset.code || domCode };
    renderDiffStudioModal();
    return true;
  }
  if (action === "cancel-diff-comment") { view.diffAnnotationTarget = null; renderDiffStudioModal(); return true; }
  if (action === "save-diff-comment") {
    const comment = String($("[data-diff-comment-input]")?.value || "").trim();
    const target = view.diffAnnotationTarget;
    const tId = view.diffStudioTaskId || view.selected || "";
    if (!comment || !target || !tId) { showToast("Nhập nội dung nhận xét trước khi lưu."); return true; }
    view.diffAnnotations ||= {};
    view.diffAnnotations[tId] ||= [];
    view.diffAnnotations[tId].push({ id: crypto.randomUUID(), path: target.path, line: target.line, side: target.side || "", code: target.code, comment });
    view.diffAnnotationTarget = null;
    renderDiffStudioModal();
    return true;
  }
  if (action === "remove-diff-comment") {
    const tId = view.diffStudioTaskId || view.selected || "";
    if (view.diffAnnotations?.[tId]) {
      view.diffAnnotations[tId] = view.diffAnnotations[tId].filter((a) => a.id !== button.dataset.commentId);
    }
    renderDiffStudioModal();
    return true;
  }
  if (action === "submit-diff-review") {
    const anns = view.diffAnnotations?.[id] || [];
    if (!anns.length) return true;
    const task = view.state.tasks.find((item) => item.id === id);
    const wf = task?.config?.workflow || "codex-antigravity";
    const provider = view.chatProvider || (wf === "chat-only" ? task?.config?.chatProvider : roleConfig(task?.config, "build")?.provider || roleConfig(task?.config, "plan")?.provider) || "codex";
    const models = view.connectors?.[provider]?.models || [];
    const model = view.chatModel || models[0]?.id || "";
    const effort = view.chatEffort || "medium";
    const reviewLines = [
      "Hãy chỉnh sửa mã nguồn theo các nhận xét review trên diff dưới đây:",
      "",
      ...anns.map((ann, idx) => `${idx + 1}. **Tệp \`${ann.path}\` (Dòng ${ann.line})**:\n   - Dòng hiện tại: \`${String(ann.code || "").trim()}\`\n   - Yêu cầu sửa: ${ann.comment}`),
    ].join("\n");
    await api(`/api/tasks/${encodeURIComponent(id)}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: reviewLines, provider, model, effort }),
    });
    delete view.diffAnnotations[id];
    closeOverlay();
    if (view.page !== "chat") view.navOriginPage = view.page;
    view.selected = id;
    view.selectedTaskId = id;
    view.page = "chat";
    await refresh();
    showToast(`Đã gửi ${anns.length} nhận xét diff cho Agent xử lý!`);
    return true;
  }
  if (action === "set-design-viewport") {
    const tabId = button.dataset.tabId || view.activeStageTabId;
    const tab = (view.stageTabs || []).find((item) => item.id === tabId);
    if (tab) {
      tab.designViewport = ["mobile", "tablet", "desktop"].includes(button.dataset.viewport) ? button.dataset.viewport : "desktop";
      render();
    }
    return true;
  }
  if (action === "capture-design-region") {
    const iframe = document.querySelector(".orca-live-frame:not(.is-pdf)");
    const rect = iframe?.getBoundingClientRect?.();
    const sel = view.stageHtmlSelectedElement;
    const vp = (view.stageTabs || []).find((t) => t.id === view.activeStageTabId)?.designViewport || "desktop";
    let capSize = null;
    if (rect && typeof window.opensybauDesktop?.captureRegion === "function") {
      const cap = await window.opensybauDesktop.captureRegion({
        x: rect.left + (sel?.rect?.left || 0),
        y: rect.top + (sel?.rect?.top || 0),
        width: sel?.rect?.width || rect.width,
        height: sel?.rect?.height || Math.min(rect.height, 720),
      }).catch(() => null);
      if (cap?.ok) capSize = cap.size;
    }
    const summary = sel
      ? `[Ảnh bố cục vùng chọn] Viewport=${vp} (${Math.round(rect?.width || 0)}×${Math.round(rect?.height || 0)}) · Selector=${sel.selector || sel.tag} · Box=(x=${Math.round(sel.rect?.left || 0)}, y=${Math.round(sel.rect?.top || 0)}, w=${Math.round(sel.rect?.width || 0)}, h=${Math.round(sel.rect?.height || 0)})${capSize ? ` · Snapshot=${capSize.width}×${capSize.height}px` : ""}`
      : `[Ảnh bố cục Viewport ${vp}] Kích thước=${Math.round(rect?.width || 0)}×${Math.round(rect?.height || 0)}${capSize ? ` · Snapshot=${capSize.width}×${capSize.height}px` : ""} (${iframe?.src || "live preview"})`;
    view.chatDraft = view.chatDraft ? `${view.chatDraft}\n${summary}` : `${summary}\n`;
    view.stageSplit = true;
    render();
    $(".chat-input")?.focus();
    showToast(capSize ? `Đã chụp snapshot vùng (${capSize.width}×${capSize.height}px) vào Chat.` : "Đã đính kèm snapshot thông số bố cục vùng xem vào khung Chat.");
    return true;
  }
  if (action === "open-task-telemetry") {
    const res = await api(`/api/tasks/${encodeURIComponent(id)}/telemetry`);
    const spans = [...(res.spans || [])].reverse();
    const totalMs = spans.reduce((s, sp) => s + (Number(sp.durationMs) || 0), 0);
    const listHtml = spans.length
      ? `<div class="provider-setup-list">${spans.map((sp) => {
          const attrs = sp.attributes || {};
          const tok = (Number(attrs["gen_ai.usage.input_tokens"] || 0) + Number(attrs["gen_ai.usage.output_tokens"] || 0));
          return `<article class="provider-setup-row">
            <div>
              <strong data-localize-skip="true">${esc(sp.name || "span")}</strong>
              <small data-localize-skip="true">${esc(attrs["gen_ai.system"] || "—")} · ${esc(attrs["gen_ai.request.model"] || "—")} · ${sp.durationMs || 0} ms${tok ? ` · ${tok} tok` : ""}</small>
            </div>
            <span class="pill">${esc(sp.status || "OK")}</span>
          </article>`;
        }).join("")}</div>`
      : `<p class="form-note">Chưa ghi nhận span OpenTelemetry GenAI nào cho tác vụ này.</p>`;
    showModal("Telemetry Waterfall (GenAI Spans)", `<p class="form-note">${spans.length} span · Tổng thời lượng ghi nhận ${totalMs} ms${res.worktreePort ? ` · OPENSYBAU_PORT=${res.worktreePort}` : ""}.</p>${listHtml}`, "Đóng", "dismiss");
    return true;
  }
  if (action === "open-checkpoints-modal") {
    const task = view.state.tasks.find((item) => item.id === id);
    if (!task) return true;
    const res = await api(`/api/tasks/${encodeURIComponent(id)}/checkpoints`);
    const cps = [...(res.checkpoints || [])].reverse();
    const listHtml = cps.length
      ? `<div class="provider-setup-list">${cps.map((cp) => `<article class="provider-setup-row">
          <div>
            <strong>${esc(cp.label || cp.stage)}</strong>
            <small>${esc(fmtDate(cp.createdAt))} · ${cp.fileCount || 0} tệp · <code data-localize-skip="true">${esc((cp.commit || "").slice(0, 7))}</code></small>
            ${cp.files?.length ? `<small class="muted" data-localize-skip="true">${esc(cp.files.slice(0, 4).join(", "))}${cp.files.length > 4 ? "…" : ""}</small>` : ""}
          </div>
          <div class="provider-row-actions">
            <button type="button" class="button quiet small" data-action="inspect-checkpoint-diff" data-id="${esc(task.id)}" data-cp-id="${esc(cp.id)}">Xem diff</button>
            <button type="button" class="button quiet small" data-action="rewind-checkpoint" data-id="${esc(task.id)}" data-cp-id="${esc(cp.id)}" data-mode="files-only">Khôi phục tệp</button>
            <button type="button" class="button primary small" data-action="rewind-checkpoint" data-id="${esc(task.id)}" data-cp-id="${esc(cp.id)}" data-mode="files-and-chat">Tệp + Chat</button>
          </div>
        </article>`).join("")}</div>`
      : `<p class="form-note">Chưa có checkpoint nào được ghi nhận cho tác vụ này.</p>`;
    showModal("Checkpoints & Hoàn tác (/rewind)", `<p class="form-note">OpenSybau tự động chụp snapshot trước/sau mỗi lượt chỉnh sửa trong kho Git ẩn riêng (không ảnh hưởng nhánh <code>.git</code> chính).</p>${listHtml}<div data-checkpoint-diff-preview></div>`, "Đóng", "dismiss");
    return true;
  }
  if (action === "inspect-checkpoint-diff") {
    const cpId = button.dataset.cpId || "";
    const res = await api(`/api/tasks/${encodeURIComponent(id)}/checkpoints/diff?checkpointId=${encodeURIComponent(cpId)}&live=1`);
    const preview = $("[data-checkpoint-diff-preview]");
    if (preview) {
      preview.innerHTML = `<div class="diff-location"><strong>Diff từ ${esc(res.checkpoint?.label || cpId)} tới hiện tại:</strong></div><pre class="diff-content" data-localize-skip="true">${esc(res.diff || "Không có thay đổi nào so với hiện tại.")}</pre>`;
    }
    return true;
  }
  if (action === "rewind-checkpoint") {
    const cpId = button.dataset.cpId || "";
    const mode = button.dataset.mode === "files-and-chat" ? "files-and-chat" : "files-only";
    const promptMsg = mode === "files-and-chat"
      ? "Khôi phục toàn bộ tệp về checkpoint này VÀ cắt các tin nhắn chat phát sinh sau thời điểm đó?"
      : "Khôi phục toàn bộ tệp dự án về đúng trạng thái ở checkpoint này?";
    if (!confirm(promptMsg)) return true;
    const res = await api(`/api/tasks/${encodeURIComponent(id)}/rewind`, {
      method: "POST",
      body: JSON.stringify({ checkpointId: cpId, mode }),
    });
    closeOverlay();
    await refresh();
    showToast(`Đã khôi phục ${res.restoredFiles?.length || 0} tệp (${res.removedFiles?.length || 0} tệp tạo sau đã xóa).`);
    return true;
  }
  if (action === "apply-skill-proposal") {
    const index = Number(button.dataset.index || 0);
    const scope = button.dataset.scope === "workspace" ? "workspace" : "universal";
    await api(`/api/tasks/${encodeURIComponent(id)}/apply-skill-proposal`, {
      method: "POST",
      body: JSON.stringify({ index, scope }),
    });
    view.skillsLoaded = false;
    await refresh();
    showToast("Đã cài đặt kỹ năng mới từ đề xuất của AI!");
    return true;
  }
  if (action === "resolve-merge-conflict") {
    const task = view.state.tasks.find((item) => item.id === id);
    if (!task) return true;
    const strategy = button.dataset.strategy || "";
    if (strategy === "ai-resolve") {
      const filesList = (task.mergeConflict?.files || []).slice(0, 12).map((f) => `- ${f}`).join("\n");
      const msg = `Phát hiện xung đột Git khi gộp worktree (${task.worktreeBranch || task.id}).\nLỗi: ${task.mergeConflict?.message || "Git conflict"}${filesList ? `\nTệp xung đột:\n${filesList}` : ""}\nHãy kiểm tra các vùng xung đột \`<<<<<<<\` / \`=======\` / \`>>>>>>>\` hoặc khác biệt với nhánh chính và đề xuất / hoàn thiện bản gộp sạch sẽ.`;
      await api(`/api/tasks/${encodeURIComponent(task.id)}/chat`, {
        method: "POST",
        body: JSON.stringify({
          message: msg,
          provider: view.chatProvider || roleConfig(task.config, "build")?.provider || "codex",
          model: view.chatModel || roleConfig(task.config, "build")?.model || "",
          effort: view.chatEffort || roleConfig(task.config, "build")?.effort || "medium",
        }),
      });
      await refresh();
      showToast("Đã giao Agent phân tích và hòa giải xung đột Git.");
      return true;
    }
    if (strategy === "theirs" && !confirm("Ghi đè tệp từ worktree sang nhánh chính cho các tệp xung đột?")) return true;
    const res = await api(`/api/tasks/${encodeURIComponent(id)}/apply-worktree`, {
      method: "POST",
      body: JSON.stringify({ strategy }),
    });
    await refresh();
    showToast(strategy === "ours"
      ? "Đã giữ phiên bản nhánh chính và xóa đánh dấu xung đột."
      : `Đã áp dụng thay đổi từ worktree (${(res.appliedFiles || []).length} tệp).`);
    return true;
  }
  if (action === "apply-worktree" || action === "pick-arena-winner") {
    const task = view.state.tasks.find((item) => item.id === id);
    if (!confirm(`Áp dụng toàn bộ thay đổi từ nhánh worktree của “${task?.title || id}” vào thư mục dự án chính?`)) return true;
    const res = await api(`/api/tasks/${encodeURIComponent(id)}/apply-worktree`, { method: "POST", body: JSON.stringify({ cleanup: false }) });
    closeOverlay();
    if (view.page === "chat") {
      view.selected = id;
      view.selectedTaskId = id;
    }
    await refresh();
    const count = (res.appliedFiles || res.task?.appliedFiles || []).length;
    showToast(`Đã gộp ${count} tệp từ worktree vào dự án chính!`);
    return true;
  }
  if (action === "discard-worktree") {
    const task = view.state.tasks.find((item) => item.id === id);
    if (!confirm(`Hủy bỏ và xóa thư mục Git worktree cô lập của “${task?.title || id}”? Lịch sử trò chuyện vẫn được giữ lại.`)) return true;
    await api(`/api/tasks/${encodeURIComponent(id)}/discard-worktree`, { method: "POST" });
    closeOverlay();
    await refresh();
    showToast("Đã dọn dẹp Git worktree cô lập.");
    return true;
  }
  if (action === "compare-fanout") {
    await openArenaCompareModal(button.dataset.fanoutId || "");
    return true;
  }
  if (action === "toggle-chat-drawer") {
    view.chatDrawerOpen = !view.chatDrawerOpen;
    if (view.page !== "chat") view.homeDockOpen = view.chatDrawerOpen;
    const task = (view.state?.tasks || []).find((item) => item.id === (id || view.selected));
    if (view.chatDrawerOpen && task?.workspaceId) {
      void ensureWorkspaceFileIndex(task.workspaceId).then(() => render());
    }
    render();
    return true;
  }
  if (action === "chat-drawer-tab" || action === "right-dock-tab") {
    view.chatDrawerTab = button.dataset.tab || "files";
    render();
    return true;
  }
  if (action === "toggle-dock-folder") {
    const folderPath = button.dataset.folder || "";
    if (folderPath) {
      const set = new Set(view.collapsedDockFolders || []);
      if (set.has(folderPath)) set.delete(folderPath);
      else set.add(folderPath);
      view.collapsedDockFolders = [...set];
      render();
    }
    return true;
  }
  if (action === "toggle-fanout-group") {
    const fid = button.dataset.fanoutId || id || "";
    if (fid) {
      const set = new Set(view.collapsedFanouts || []);
      if (set.has(fid)) set.delete(fid);
      else set.add(fid);
      view.collapsedFanouts = [...set];
      try { localStorage.setItem("workbench.collapsed-fanouts", JSON.stringify(view.collapsedFanouts)); } catch {}
      render();
    }
    return true;
  }
  if (action === "dock-open-workspace-file" || action === "preview-drawer-file") {
    const wsId = button.dataset.workspaceId
      || (view.page === "workspaces" && view.selected ? view.selected : "")
      || (view.state?.tasks || []).find((item) => item.id === (id || view.selected))?.workspaceId
      || view.homeWorkspaceId
      || view.state?.workspaces?.[0]?.id;
    if (wsId && button.dataset.path) {
      if (window.matchMedia("(max-width: 740px)").matches) {
        view.chatDrawerOpen = false;
      }
      await openStageFileTab({
        workspaceId: wsId,
        taskId: id || (view.page === "chat" ? view.selected : "") || "",
        path: button.dataset.path,
        showChanges: button.dataset.showChanges === "true",
      });
    }
    return true;
  }
  if (action === "close-workspace-preview" || action === "close-drawer-preview") {
    view.filePreview = null;
    view.chatDrawerPreview = null;
    view.activeStageTabId = "chat";
    render();
    return true;
  }
  if (action === "refresh-dock-context") {
    const selectedTask = view.selected ? (view.state?.tasks || []).find((t) => t.id === view.selected) : null;
    const wsId = (view.page === "workspaces" && view.selected)
      ? view.selected
      : selectedTask?.workspaceId || view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || "";
    if (wsId) {
      if (view.workspaceFileIndex) delete view.workspaceFileIndex[wsId];
      await Promise.all([
        ensureWorkspaceFileIndex(wsId),
        ensureWorkspaceGitStatus(wsId, selectedTask?.id || "", { force: true }),
      ]);
      render();
      showToast("Đã làm mới cây thư mục dự án.");
    }
    return true;
  }
  if (action === "mention-drawer-file") {
    const path = button.dataset.path || "";
    if (!path) return true;
    let textarea = $(".chat-input") || $("[data-home-prompt]");
    if (!textarea) {
      view.page = "chat";
      if ((view.stageTabs || []).length > 0 && view.activeStageTabId !== "chat") {
        view.stageSplit = true;
      } else {
        view.activeStageTabId = "chat";
      }
      render();
      textarea = $(".chat-input") || $("[data-home-prompt]");
    }
    if (textarea) {
      const prefix = textarea.value && !/\s$/.test(textarea.value) ? " " : "";
      textarea.value = `${textarea.value}${prefix}@${path} `;
      view.chatDraft = textarea.value;
      textarea.focus();
    }
    return true;
  }
  if (action === "insert-file-mention") {
    const path = button.dataset.path || "";
    const menu = view.mentionMenu;
    const textarea = $(".chat-input") || $("[data-home-prompt]");
    if (textarea && path && menu) {
      const before = textarea.value.slice(0, menu.startPos);
      const after = textarea.value.slice(menu.endPos);
      textarea.value = `${before}@${path} ${after}`;
      view.chatDraft = textarea.value;
      view.mentionMenu = null;
      const pop = textarea.closest(".composer-input-wrap")?.querySelector("[data-mention-popover]");
      if (pop) { pop.hidden = true; pop.innerHTML = ""; }
      textarea.focus();
      const cursor = before.length + path.length + 2;
      textarea.setSelectionRange?.(cursor, cursor);
    }
    return true;
  }
  if (action === "open-stage-doc") {
    const targetId = id || view.selectedTaskId || view.selected;
    const task = view.state.tasks.find((item) => item.id === targetId);
    const docKey = button.dataset.docId || button.dataset.doc || "spec";
    if (task) {
      if (view.page !== "chat" || button.closest("#overlay")) {
        openStageDocModal(task, docKey);
      } else {
        view.selected = task.id;
        view.selectedTaskId = task.id;
        openStageDocTab(task, docKey);
      }
    }
    return true;
  }
  if (action === "open-live-url") {
    const rawUrl = button.dataset.url || $("[data-live-url-input]")?.value || "http://localhost:3000";
    view.lastLiveUrl = rawUrl;
    if (!["chat", "workspaces"].includes(view.page)) {
      view.navOriginPage = view.page;
      view.page = "chat";
    }
    openLiveUrlTab(rawUrl, id || view.selectedTaskId || view.selected || "");
    return true;
  }
  return false;
}
