import { $, view } from "../../../shared/state.js";
import { providerTitle, roleConfig } from "../../../domain/agent-roles.js";
import { defaultFileTabMode } from "../stage-viewer.js";
import { resolveHtmlCommentAgentSelection, syncHtmlInspectUi } from "../html-inspector.js";
import { openGithubCreatePrModal, openGithubIssuesModal } from "../notifications.js";
import {
  api,
  closeOverlay,
  ensureWorkspaceFileIndex,
  refresh,
  render,
  showModal,
  showToast,
} from "../runtime.js";
import {
  openLiveUrlTab,
  openStageDocTab,
  openStageFileTab,
  reloadStageFileTab,
} from "../stage-tabs.js";
import {
  openArenaCompareModal,
  renderDiffStudioModal,
  showDiffModal,
} from "../modals.js";

export async function handleStageAndDiffAction(action, id, button, event) {
  if (action === "show-diff") {
    const data = await api(`/api/tasks/${encodeURIComponent(id)}/diff`);
    showDiffModal(data, id);
    return true;
  }
  if (action === "open-diff-file") {
    const targetTask = view.state.tasks.find((item) => item.id === (id || view.selected));
    await openStageFileTab({
      workspaceId: button.dataset.workspaceId || targetTask?.workspaceId || "",
      taskId: id || view.selected || "",
      path: button.dataset.path || "",
    });
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
    view.stageLineCommentTarget = {
      key: button.dataset.key || "",
      path: button.dataset.path || "",
      line: button.dataset.line || "1",
      code: button.dataset.code || "",
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
    view.diffAnnotationTarget = { key: button.dataset.key, path: button.dataset.path, line: button.dataset.line, side: button.dataset.side || "", code: button.dataset.code || "" };
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
    view.selected = id;
    view.page = "chat";
    await refresh();
    showToast(`Đã gửi ${anns.length} nhận xét diff cho Agent xử lý!`);
    return true;
  }
  if (action === "apply-worktree" || action === "pick-arena-winner") {
    const task = view.state.tasks.find((item) => item.id === id);
    if (!confirm(`Áp dụng toàn bộ thay đổi từ nhánh worktree của “${task?.title || id}” vào thư mục dự án chính?`)) return true;
    const res = await api(`/api/tasks/${encodeURIComponent(id)}/apply-worktree`, { method: "POST", body: JSON.stringify({ cleanup: false }) });
    closeOverlay();
    view.selected = id;
    view.page = "chat";
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
    const task = view.state.tasks.find((item) => item.id === (id || view.selected));
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
      || view.state.tasks.find((item) => item.id === (id || view.selected))?.workspaceId
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
      await ensureWorkspaceFileIndex(wsId);
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
    const task = view.state.tasks.find((item) => item.id === (id || view.selected));
    if (task) {
      view.page = "chat";
      view.selected = task.id;
      openStageDocTab(task, button.dataset.docId || "spec");
    }
    return true;
  }
  if (action === "open-live-url") {
    const rawUrl = button.dataset.url || $("[data-live-url-input]")?.value || "http://localhost:3000";
    view.lastLiveUrl = rawUrl;
    view.page = "chat";
    openLiveUrlTab(rawUrl, id || view.selected || "");
    return true;
  }
  return false;
}
