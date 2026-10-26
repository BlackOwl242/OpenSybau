import { view } from "../../shared/state.js";
import { pipelineStepperData } from "../../domain/task-flow.js";
import { defaultFileTabMode } from "./stage-viewer.js";
import { renderOrcaRightDockMarkup } from "./right-dock.js";
import { api, ensureWorkspaceFileIndex, ensureWorkspaceGitStatus, render, showToast } from "./runtime.js";
import { loadVaultGraph, vaultNoteOptionsMenu } from "./pages/knowledge-skills-page.js";

export async function openStageFileTab({
  workspaceId = "",
  taskId = "",
  path = "",
  preferredMode = "",
  showChanges = undefined,
  diffBase = "",
} = {}) {
  const cleanPath = String(path || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!cleanPath) return;
  const selectedTask = (taskId || view.selected) ? (view.state?.tasks || []).find((t) => t.id === (taskId || view.selected)) : null;
  const wsId = workspaceId
    || (view.page === "workspaces" && view.selected ? view.selected : "")
    || selectedTask?.workspaceId
    || view.homeWorkspaceId
    || view.state?.workspaces?.[0]?.id
    || "";
  if (!wsId) return;
  const tId = taskId || selectedTask?.id || "";
  const tabId = `${wsId}::${cleanPath}`;
  const name = cleanPath.split("/").at(-1) || cleanPath;
  const ext = name.includes(".") ? `.${name.split(".").at(-1).toLowerCase()}` : "";

  view.stageTabs ||= [];
  let tab = view.stageTabs.find((item) => item.id === tabId);
  if (!tab) {
    tab = {
      id: tabId,
      workspaceId: wsId,
      taskId: tId,
      path: cleanPath,
      name,
      ext,
      mode: defaultFileTabMode(ext, preferredMode),
      showChanges: Boolean(showChanges),
      diffBase: diffBase || "unstaged",
      diffSplit: Boolean(view.stageDiffSplit),
      diffHunkIndex: 0,
      fileData: null,
      diffData: null,
      loading: true,
      error: "",
      loadedAt: Date.now(),
    };
    view.stageTabs.push(tab);
    if (view.stageTabs.length > 10) view.stageTabs.shift();
  } else {
    tab.taskId = tId || tab.taskId;
    if (preferredMode) tab.mode = preferredMode;
    if (showChanges !== undefined) {
      tab.showChanges = Boolean(showChanges);
      if (tab.showChanges) tab.mode = "code";
    }
    if (diffBase) tab.diffBase = diffBase;
  }
  if (tab.showChanges && preferredMode !== "preview") {
    tab.mode = "code";
  }
  view.activeStageTabId = tab.id;
  view.stageLineCommentTarget = null;
  render();
  await reloadStageFileTab(tab.id);
}

export async function openAllChangesStageTab({ workspaceId = "", taskId = "", base = "head" } = {}) {
  const selectedTask = (taskId || view.selected) ? (view.state?.tasks || []).find((t) => t.id === (taskId || view.selected)) : null;
  const wsId = workspaceId
    || (view.page === "workspaces" && view.selected ? view.selected : "")
    || selectedTask?.workspaceId
    || view.homeWorkspaceId
    || view.state?.workspaces?.[0]?.id
    || "";
  if (!wsId) return;
  const tId = taskId || selectedTask?.id || "";
  const tabId = `all-changes::${wsId}::${tId || "ws"}`;
  view.stageTabs ||= [];
  let tab = view.stageTabs.find((item) => item.id === tabId);
  if (!tab) {
    tab = {
      id: tabId,
      kind: "all-changes",
      workspaceId: wsId,
      taskId: tId,
      path: "Tất cả thay đổi",
      name: "Tất cả thay đổi",
      ext: ".diff",
      mode: "code",
      showChanges: true,
      diffBase: base || "head",
      diffSplit: Boolean(view.stageDiffSplit),
      diffHunkIndex: 0,
      fileData: null,
      diffData: null,
      loading: true,
      error: "",
      loadedAt: Date.now(),
    };
    view.stageTabs.push(tab);
    if (view.stageTabs.length > 10) view.stageTabs.shift();
  } else {
    tab.taskId = tId || tab.taskId;
    if (base) tab.diffBase = base;
  }
  view.activeStageTabId = tab.id;
  view.stageLineCommentTarget = null;
  render();
  await reloadStageFileTab(tab.id);
}

export async function loadStageTabDiff(tabId, base = "") {
  const tab = (view.stageTabs || []).find((item) => item.id === tabId);
  if (!tab || !tab.workspaceId) return;
  if (base) tab.diffBase = base;
  const effectiveBase = tab.diffBase || "unstaged";
  try {
    if (tab.kind === "all-changes") {
      const q = `all=1&base=${encodeURIComponent(effectiveBase)}${tab.taskId ? `&taskId=${encodeURIComponent(tab.taskId)}` : ""}`;
      tab.diffData = await api(`/api/workspaces/${encodeURIComponent(tab.workspaceId)}/file-diff?${q}`);
    } else if (tab.path) {
      const q = `path=${encodeURIComponent(tab.path)}&base=${encodeURIComponent(effectiveBase)}${tab.taskId ? `&taskId=${encodeURIComponent(tab.taskId)}` : ""}`;
      tab.diffData = await api(`/api/workspaces/${encodeURIComponent(tab.workspaceId)}/file-diff?${q}`);
    }
    tab.diffHunkIndex = 0;
  } catch {
    tab.diffData = null;
  }
  render();
}

export async function reloadStageFileTab(tabId) {
  const tab = (view.stageTabs || []).find((item) => item.id === tabId);
  if (!tab) return;
  if (tab.kind === "live-url") {
    tab.loadedAt = Date.now();
    tab.loading = false;
    render();
    return;
  }
  if (tab.kind === "all-changes") {
    tab.loading = true;
    tab.error = "";
    render();
    try {
      const effectiveBase = tab.diffBase || "head";
      const q = `all=1&base=${encodeURIComponent(effectiveBase)}${tab.taskId ? `&taskId=${encodeURIComponent(tab.taskId)}` : ""}`;
      tab.diffData = await api(`/api/workspaces/${encodeURIComponent(tab.workspaceId)}/file-diff?${q}`);
      tab.loadedAt = Date.now();
      tab.loading = false;
    } catch (error) {
      tab.error = error.message || "Không thể tải danh sách thay đổi.";
      tab.loading = false;
    }
    render();
    return;
  }
  if (tab.kind === "stage-doc") {
    const task = (view.state?.tasks || []).find((t) => t.id === tab.taskId);
    if (task) {
      const stepper = pipelineStepperData(task);
      const doc = stepper.stageDocuments.find((d) => d.id === tab.docId);
      if (doc) {
        tab.fileData = {
          name: doc.title,
          path: doc.title,
          extension: ".md",
          kind: "text",
          size: (doc.content || "").length,
          content: doc.content || "Chưa có nội dung cho tài liệu giai đoạn này.",
        };
      }
    }
    tab.loadedAt = Date.now();
    tab.loading = false;
    render();
    return;
  }
  tab.loading = true;
  tab.error = "";
  render();
  try {
    const effectiveBase = tab.diffBase || "unstaged";
    const q = `path=${encodeURIComponent(tab.path)}${tab.taskId ? `&taskId=${encodeURIComponent(tab.taskId)}` : ""}`;
    const [fileRes, diffRes] = await Promise.all([
      api(`/api/workspaces/${encodeURIComponent(tab.workspaceId)}/file?${q}`),
      api(`/api/workspaces/${encodeURIComponent(tab.workspaceId)}/file-diff?${q}&base=${encodeURIComponent(effectiveBase)}`).catch(() => null),
    ]);
    tab.fileData = fileRes;
    tab.diffData = diffRes;
    tab.ext = fileRes.extension || tab.ext;
    if (tab.mode === "edit" && tab.editDraft === undefined) {
      tab.editDraft = fileRes.content ?? "";
    }
    tab.loadedAt = Date.now();
    tab.loading = false;
  } catch (error) {
    tab.error = error.message || "Không thể đọc tệp.";
    tab.loading = false;
  }
  render();
}

export function openStageDocTab(task, docId) {
  if (!task || !docId) return;
  const cleanId = docId === "impl" ? "implementation" : docId;
  const stepper = pipelineStepperData(task);
  const doc = stepper.stageDocuments.find((d) => d.id === cleanId);
  if (!doc) return;
  const tabId = `doc::${task.id}::${doc.id}`;
  view.stageTabs ||= [];
  let tab = view.stageTabs.find((item) => item.id === tabId);
  const fileData = {
    name: doc.title,
    path: `${task.code || task.id.slice(0, 8)}/${doc.title}`,
    extension: ".md",
    kind: "text",
    size: (doc.content || "").length,
    content: doc.content || "Chưa có nội dung cho giai đoạn này.",
  };
  if (!tab) {
    tab = {
      id: tabId,
      kind: "stage-doc",
      docId: doc.id,
      workspaceId: task.workspaceId,
      taskId: task.id,
      path: `${task.code || task.id.slice(0, 8)}/${doc.title}`,
      name: doc.title,
      ext: ".md",
      mode: "preview",
      fileData,
      loading: false,
      error: "",
      loadedAt: Date.now(),
    };
    view.stageTabs.push(tab);
    if (view.stageTabs.length > 10) view.stageTabs.shift();
  } else {
    tab.fileData = fileData;
    tab.loadedAt = Date.now();
  }
  view.activeStageTabId = tab.id;
  view.stageSplit = true;
  render();
}

export function openLiveUrlTab(rawUrl, taskId = "") {
  let cleanUrl = String(rawUrl || "").trim();
  if (!cleanUrl) return;
  if (/^\d{2,5}(\/.*)?$/.test(cleanUrl)) cleanUrl = `http://localhost:${cleanUrl}`;
  else if (/^localhost:\d+/i.test(cleanUrl)) cleanUrl = `http://${cleanUrl}`;
  let parsed;
  try {
    parsed = new URL(cleanUrl);
  } catch {
    showToast("Nhập địa chỉ localhost hợp lệ (ví dụ: http://localhost:3000 hoặc 5173).");
    return;
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname.toLowerCase())) {
    showToast("Trình duyệt Live Dev Server chỉ cho phép kết nối tới localhost / 127.0.0.1 để bảo mật.");
    return;
  }
  const normalizedUrl = parsed.href;
  view.liveDevServerUrl = normalizedUrl;
  const tabId = `live::${normalizedUrl}`;
  view.stageTabs ||= [];
  let tab = view.stageTabs.find((item) => item.id === tabId);
  if (!tab) {
    tab = {
      id: tabId,
      kind: "live-url",
      liveUrl: normalizedUrl,
      workspaceId: view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || "",
      taskId,
      path: normalizedUrl,
      name: `${parsed.hostname}:${parsed.port || (parsed.protocol === "https:" ? "443" : "80")}${parsed.pathname !== "/" ? parsed.pathname : ""}`,
      ext: ".html",
      mode: "preview",
      fileData: { name: normalizedUrl, path: normalizedUrl, extension: ".html", kind: "live-url" },
      loading: false,
      error: "",
      loadedAt: Date.now(),
    };
    view.stageTabs.push(tab);
    if (view.stageTabs.length > 10) view.stageTabs.shift();
  } else {
    tab.loadedAt = Date.now();
  }
  view.activeStageTabId = tab.id;
  view.stageSplit = true;
  render();
}

export function orcaRightDockMarkup() {
  return renderOrcaRightDockMarkup({
    loadVaultGraph,
    ensureWorkspaceFileIndex,
    ensureWorkspaceGitStatus,
    vaultNoteOptionsMenu,
    render,
  });
}
