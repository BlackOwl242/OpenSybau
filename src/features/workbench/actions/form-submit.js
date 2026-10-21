import { $, view } from "../../../shared/state.js";
import { providerTitle, workflowRoles } from "../../../domain/agent-roles.js";
import { api, refresh, render, showToast } from "../runtime.js";
import { normalizedChatSelection } from "../ui-controls.js";
import {
  clearComposerAttachments,
  composerAttachmentKey,
  readComposerAttachments,
  resizeComposerTextarea,
} from "../composer.js";
import { showWorkspaceModal } from "../modals.js";
import { ensureHomeArenaSlots } from "../pages/chat-page.js";
import { apiProviderId } from "../pages/settings-page.js";
import { loadWorkspaceDir } from "../pages/tasks-workspaces-page.js";
import { loadVaultDir } from "../pages/knowledge-skills-page.js";

export async function handleSubmit(event) {
  const form = event.target.closest("[data-modal]");
  if (!form) return;
  event.preventDefault();
  const isTaskChat = form.dataset.form === "task-chat";
  if (form.dataset.submitting === "true" || (view.busy && !isTaskChat)) return;
  if (form.dataset.form === "home-task" && !view.state?.workspaces?.length) {
    showWorkspaceModal();
    showToast("Chọn thư mục dự án (Workspace) trước khi bắt đầu.");
    return;
  }
  if (!isTaskChat) view.busy = true;
  if (isTaskChat) form.dataset.submitting = "true";
  const submit = $("[type=submit]", form);
  const isIconSubmit = Boolean(submit?.classList.contains("home-submit") || submit?.classList.contains("chat-send-button") || submit?.classList.contains("mp-round-button"));
  if (submit) {
    submit.disabled = true;
    if (!isIconSubmit) submit.textContent = "Đang xử lý…";
  }
  const data = new FormData(form);
  const object = Object.fromEntries(data.entries());
  try {
    if (["home-task", "task-chat"].includes(form.dataset.form)) {
      const field = form.dataset.form === "task-chat" ? "message" : "prompt";
      const typedText = String(object[field] || "").trim();
      const attachments = view.composerAttachments?.[composerAttachmentKey(form)] || [];
      if (typedText.length < 6 && !attachments.length) throw new Error("Nhập ít nhất 6 ký tự hoặc đính kèm tệp trước khi gửi.");
      object.attachments = await readComposerAttachments(form);
    }
    if (form.dataset.form === "workspace") {
      const created = await api("/api/workspaces", { method: "POST", body: JSON.stringify({ path: object.path }) });
      if (created?.workspace?.id) {
        view.homeWorkspaceId = created.workspace.id;
        view.workspaceOverviewMode = false;
        if (view.page === "workspaces") {
          view.selected = created.workspace.id;
          view.activeStageTabId = "chat";
          view.workspaceDir = "";
          view.filePreview = null;
          view.workspaceEntries = [];
          view.workspaceLoadedKey = "";
        }
      }
      showToast("Đã kiểm tra và thêm workspace thật.");
    } else if (form.dataset.form === "workspace-edit") {
      const sourceFolders = data.getAll("sourceFolder").map((path) => String(path).trim()).filter(Boolean);
      await api(`/api/workspaces/${encodeURIComponent(form.dataset.id)}`, { method: "PATCH", body: JSON.stringify({ name: object.name, sourceFolders }) });
      view.projectMenuId = "";
      showToast("Đã cập nhật tên và thư mục nguồn của dự án.");
    } else if (form.dataset.form === "workspace-section") {
      await api(`/api/workspaces/${encodeURIComponent(form.dataset.id)}`, { method: "PATCH", body: JSON.stringify({ section: object.section }) });
      view.projectMenuId = "";
      showToast("Đã chuyển dự án sang section.");
    } else if (form.dataset.form === "task-rename") {
      await api(`/api/tasks/${encodeURIComponent(form.dataset.id)}`, { method: "PATCH", body: JSON.stringify({ title: object.title }) });
      view.taskMenuId = "";
      showToast("Đã đổi tên chat.");
    } else if (form.dataset.form === "task") {
      const { taskPresetVersion, taskPresetName, appliedPresetId, appliedPresetVersion, dependsOnTaskId, ...taskInput } = object;
      const presetRef = appliedPresetId && appliedPresetVersion ? { id: appliedPresetId, version: Number(appliedPresetVersion) } : null;
      const task = await api("/api/tasks", {
        method: "POST",
        body: JSON.stringify({
          ...taskInput,
          ...(presetRef ? { presetRef } : {}),
          isolated: data.has("isolated"),
          planGate: data.has("planGate"),
          maxRounds: Number(object.maxRounds) || 2,
          riskLevel: object.riskLevel || "M",
          qaCommand: object.qaCommand || "",
          dependsOn: dependsOnTaskId ? [dependsOnTaskId] : [],
        }),
      });
      view.selected = task.task.id;
      view.page = "chat";
      view.chatProvider = task.task.config.chatProvider || task.task.config.roles?.plan?.provider || "codex";
      view.chatModel = task.task.config.workflow === "chat-only" ? task.task.config.chatModel : task.task.config.roles?.plan?.model || "";
      view.chatEffort = task.task.config.workflow === "chat-only" ? task.task.config.chatEffort : task.task.config.roles?.plan?.effort || "";
      view.chatDraft = "";
      showToast("Task thật đã vào hàng đợi.");
    } else if (form.dataset.form === "wave-decompose") {
      const rawLines = String(object.waveSpec || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const waveMap = new Map();
      for (const line of rawLines) {
        const match = line.match(/^(?:\[(?:Wave|Đợt|Dot)\s*(\d+)(?:\s*\|\s*([SML]))?\]\s*)?(.+)$/i);
        const wIdx = Math.max(1, Math.min(8, Number(match?.[1]) || 1));
        const risk = String(match?.[2] || "M").toUpperCase();
        const rest = String(match?.[3] || line).trim();
        if (rest.length < 6) continue;
        const [titlePart, promptPart] = rest.includes("::") ? rest.split("::").map((s) => s.trim()) : [rest.slice(0, 90), rest];
        if (!waveMap.has(wIdx)) waveMap.set(wIdx, []);
        waveMap.get(wIdx).push({ title: titlePart, prompt: promptPart || titlePart, riskLevel: risk });
      }
      const waves = [...waveMap.entries()].sort((a, b) => a[0] - b[0]).map(([index, tasks]) => ({ index, tasks }));
      if (!waves.length) throw new Error("Nhập ít nhất 1 dòng công việc hợp lệ (tối thiểu 6 ký tự).");
      const res = await api("/api/tasks/decompose", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: object.workspaceId,
          milestone: object.milestone || "Nhóm việc theo đợt",
          workflow: "codex-antigravity",
          permissionPreset: "workspace-write",
          isolated: data.has("isolated"),
          planGate: data.has("planGate"),
          maxRounds: Number(object.maxRounds) || 2,
          qaCommand: object.qaCommand || "",
          waves,
        }),
      });
      view.selected = null;
      view.page = "flows";
      showToast(`Đã bắt đầu chạy ${res.tasks?.length || 0} công việc theo đợt!`);
    } else if (form.dataset.form === "home-task") {
      if (view.homeMode === "arena") {
        const slots = ensureHomeArenaSlots();
        const competitors = slots.map((slot, idx) => ({
          provider: slot.provider,
          model: slot.model,
          effort: slot.effort,
          label: `#${idx + 1} ${providerTitle(view.connectors, slot.provider)}${slot.model ? ` (${slot.model})` : ""}`,
        }));
        const rawPerm = view.homePermissionPreset || object.permissionPreset || "workspace-write";
        const permissionPreset = rawPerm === "read-only" ? "workspace-write" : rawPerm;
        const result = await api("/api/tasks/fanout", {
          method: "POST",
          body: JSON.stringify({
            workspaceId: object.workspaceId || view.homeWorkspaceId || view.state.workspaces[0]?.id,
            prompt: String(object.prompt || "").trim(),
            attachments: object.attachments,
            permissionPreset,
            workflow: "codex-antigravity",
            competitors,
          }),
        });
        const firstTask = result.tasks?.[0];
        if (firstTask) {
          view.selected = firstTask.id;
          view.page = "chat";
          view.mobileScreen = "session";
          view.mpSessionTab = "chat";
          view.chatDraft = "";
          const liveInput = form.querySelector("textarea[name=prompt], textarea[name=message]");
          if (liveInput) { liveInput.value = ""; resizeComposerTextarea(liveInput); }
          clearComposerAttachments(form);
        }
        showToast(`Đã khởi chạy Đa luồng với ${result.tasks?.length || competitors.length} nhánh Git worktree song song!`);
      } else {
        const workflow = object.workflow || view.homeWorkflow || "chat-only";
        const isSplitForm = form.dataset.splitChatCreate === "true";
        const chatSelection = normalizedChatSelection({
          provider: (!isSplitForm && view.homeChatProvider) || object.chatProvider,
          model: (!isSplitForm && view.homeChatModel) || object.chatModel,
          effort: (!isSplitForm && view.homeChatEffort) || object.chatEffort,
        });
        const payload = {
          ...object,
          chatProvider: object.chatProvider || chatSelection.provider,
          chatModel: (!isSplitForm && view.homeChatModel && (!object.chatProvider || object.chatProvider === view.homeChatProvider)) ? view.homeChatModel : (object.chatModel || chatSelection.model?.id || ""),
          chatEffort: (!isSplitForm && view.homeChatEffort && (!object.chatProvider || object.chatProvider === view.homeChatProvider)) ? view.homeChatEffort : (object.chatEffort || chatSelection.effort || ""),
          workspaceId: view.chatSplitReturnWorkspaceId || object.workspaceId || view.homeWorkspaceId || view.state.workspaces[0]?.id,
          prompt: String(object.prompt || "").trim(),
          workflow,
          isolated: Boolean(view.chatSplitReturnWorkspaceId) || data.has("isolated") || Boolean(view.homeIsolated),
          permissionPreset: view.homePermissionPreset || object.permissionPreset || "workspace-write",
          planGate: Boolean(view.homePlanGate),
          maxRounds: Number(view.homeMaxRounds) || 2,
        };
        const task = await api("/api/tasks", { method: "POST", body: JSON.stringify(payload) });
        const splitWorkspaceId = view.chatSplitReturnWorkspaceId;
        const returnToSplit = Boolean(splitWorkspaceId && (splitWorkspaceId === task.task.workspaceId || form.dataset.splitChatCreate === "true"));
        const resolvedProvider = workflow === "chat-only" ? task.task.config.chatProvider : task.task.config.roles?.plan?.provider || task.task.config.chatProvider || "codex";
        const resolvedModel = workflow === "chat-only" ? task.task.config.chatModel : task.task.config.roles?.plan?.model || task.task.config.chatModel || "";
        const resolvedEffort = workflow === "chat-only" ? task.task.config.chatEffort : task.task.config.roles?.plan?.effort || task.task.config.chatEffort || "";
        view.selected = task.task.id;
        view.page = "chat";
        view.mobileScreen = "session";
        view.mpSessionTab = "chat";
        view.chatProvider = resolvedProvider;
        view.chatModel = resolvedModel;
        view.chatEffort = resolvedEffort;
        view.homeChatProvider = resolvedProvider;
        view.homeChatModel = resolvedModel;
        view.homeChatEffort = resolvedEffort;
        view.chatDraft = "";
        const liveInput = form.querySelector("textarea[name=prompt], textarea[name=message]");
        if (liveInput) { liveInput.value = ""; resizeComposerTextarea(liveInput); }
        clearComposerAttachments(form);
        if (returnToSplit) {
          view.state.tasks = [task.task, ...(view.state.tasks || []).filter((existing) => existing.id !== task.task.id)];
          view.chatSplitWorkspaceId = splitWorkspaceId;
          view.chatSplitTaskIds = [...new Set([...(view.chatSplitTaskIds || []), task.task.id])].slice(-4);
          view.chatSplitActiveTaskId = task.task.id;
          view.selected = null;
          view.chatSplitReturnWorkspaceId = "";
          view.chatSplitCreateOpen = false;
          view.chatSplitCreateDraft = "";
          view.chatSplitPickerOpen = false;
        }
        showToast(workflow === "chat-only" ? "Đã gửi tin nhắn cho agent." : "Task thật đã vào hàng đợi.");
      }
    } else if (form.dataset.form === "settings") {
      const roles = Object.fromEntries(workflowRoles.map((role) => [role.id, { provider: object[`${role.id}Provider`], model: object[`${role.id}Model`], effort: object[`${role.id}Effort`] }]));
      await api("/api/settings", { method: "POST", body: JSON.stringify({ defaults: { roles } }) });
      showToast("Đã lưu định tuyến agent mặc định trên máy.");
    } else if (form.dataset.form === "api-provider") {
      const id = form.dataset.id || apiProviderId(object.name);
      if (!id) throw new Error("Tên nguồn cần tạo được ID gồm chữ hoặc số.");
      await api(form.dataset.id ? `/api/providers/${encodeURIComponent(id)}` : "/api/providers", {
        method: form.dataset.id ? "PUT" : "POST",
        body: JSON.stringify({ ...object, ...(object.apiKeyRequired === undefined ? {} : { apiKeyRequired: object.apiKeyRequired === "true" }), id, clearApiKey: data.has("clearApiKey") }),
      });
      showToast("Đã lưu nguồn AI. API key chỉ được giữ trên máy này.");
    } else if (form.dataset.form === "task-chat") {
      view.forceChatScroll = true;
      const taskId = form.dataset.id;
      const splitSel = form.closest(".multi-chat-pane") ? view.chatSplitSelections?.[taskId] : null;
      const provider = splitSel?.provider || object.provider || view.chatProvider;
      const model = splitSel?.model || object.model || view.chatModel;
      const effort = splitSel?.effort || object.effort || view.chatEffort;
      if (!form.closest(".multi-chat-pane")) {
        view.chatProvider = provider;
        view.chatModel = model;
        view.chatEffort = effort;
        view.homeChatProvider = provider;
        view.homeChatModel = model;
        view.homeChatEffort = effort;
      }
      const targetTask = view.state?.tasks?.find((item) => item.id === taskId);
      if (targetTask?.config) {
        targetTask.config.chatProvider = provider;
        targetTask.config.chatModel = model;
        targetTask.config.chatEffort = effort;
      }
      const result = await api(`/api/tasks/${encodeURIComponent(taskId)}/chat`, { method: "POST", body: JSON.stringify({ message: object.message, attachments: object.attachments, provider, model, effort }) });
      view.chatDraft = "";
      if (view.chatSplitDrafts) delete view.chatSplitDrafts[taskId];
      const liveInput = form.querySelector("textarea[name=message], textarea[name=prompt], input[name=message]");
      if (liveInput) { liveInput.value = ""; if (liveInput.tagName === "TEXTAREA") resizeComposerTextarea(liveInput); }
      clearComposerAttachments(form);
      showToast(view.language === "en" ? `Added to chat queue · position ${result.queuedPosition || 1}.` : `Đã thêm vào hàng đợi chat · vị trí ${result.queuedPosition || 1}.`);
    } else if (form.dataset.form === "task-chat-config") {
      view.chatProvider = object.provider;
      view.chatModel = object.model;
      view.chatEffort = object.effort;
      showToast("Đã áp dụng agent và model cho tin nhắn tiếp theo.");
    } else if (form.dataset.form === "task-goal") {
      const checklist = String(object.checklist || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      await api("/api/tasks/" + encodeURIComponent(form.dataset.id) + "/goal", { method: "POST", body: JSON.stringify({ goal: object.goal, checklist }) });
      showToast("Đã lưu mục tiêu và checklist cho các lượt chat tiếp theo.");
    } else if (form.dataset.form === "task-permissions") {
      await api("/api/tasks/" + encodeURIComponent(form.dataset.id), { method: "PATCH", body: JSON.stringify({ permissionPreset: object.permissionPreset }) });
      showToast("Đã cập nhật preset quyền của task.");
    } else if (form.dataset.form === "memory") {
      await api("/api/memory", { method: "POST", body: JSON.stringify(object) });
      showToast("Đã lưu ghi nhớ trên máy.");
    } else if (form.dataset.form === "skill-create") {
      await api("/api/skills", { method: "POST", body: JSON.stringify(object) });
      view.skillsLoaded = false;
      view.page = "skills";
      showToast("Đã tạo skill trên máy.");
    } else if (form.dataset.form === "vault") {
      await api("/api/settings", { method: "POST", body: JSON.stringify({ vaultPath: object.vaultPath }) });
      view.page = "knowledge";
      view.vaultDir = "";
      view.vaultPreview = null;
      showToast("Đã kết nối Obsidian vault.");
    } else if (form.dataset.form === "vault-note-create") {
      const created = await api("/api/vault/file", { method: "POST", body: JSON.stringify({ path: object.notePath, content: object.content, createOnly: true }) });
      $("#overlay").innerHTML = "";
      view.page = "knowledge";
      const folder = created.path.includes("/") ? created.path.slice(0, created.path.lastIndexOf("/")) : "";
      await loadVaultDir(folder, { keepPreview: true });
      view.vaultPreview = created;
      view.vaultEditing = false;
      view.vaultEditingPath = "";
      render();
      showToast("Đã tạo ghi chú tri thức mới.");
      return;
    } else if (form.dataset.form === "github-create-pr") {
      const taskId = form.dataset.id || view.selected || "";
      const res = await api(`/api/tasks/${encodeURIComponent(taskId)}/github-pr`, {
        method: "POST",
        body: JSON.stringify({
          title: object.title,
          body: object.body,
          base: object.base || "",
          draft: data.has("draft"),
        }),
      });
      $("#overlay").innerHTML = "";
      await refresh();
      showToast(res.url ? `Đã tạo Pull Request: ${res.url}` : "Đã tạo Pull Request trên GitHub.");
      return;
    } else if (form.dataset.form === "dismiss") {
      // Informational modal; its primary action only closes the dialog.
    } else {
      return;
    }
    $("#overlay").innerHTML = "";
    if (form.dataset.splitChatCreate === "true") render();
    else await refresh({ configuration: form.dataset.form === "api-provider" });
    if (form.dataset.form === "workspace" && view.page === "workspaces" && view.selected) {
      await loadWorkspaceDir(view.selected, "");
    }
    if (view.page === "knowledge" && view.state.settings.vaultPath) await loadVaultDir("");
    if (view.page === "skills" && !view.skillsLoaded) {
      const result = await api("/api/skills");
      view.skills = result.skills || [];
      view.skillsLoaded = true;
      render();
    }
  } catch (error) {
    if (form.dataset.form === "task-chat") view.forceChatScroll = false;
    showToast(error.message);
    if (submit) {
      submit.disabled = false;
      if (!isIconSubmit) submit.textContent = "Thử lại";
    }
  } finally {
    if (isTaskChat) delete form.dataset.submitting;
    else view.busy = false;
  }
}
