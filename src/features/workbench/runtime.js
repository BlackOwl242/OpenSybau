import { $, esc, icon, view } from "../../shared/state.js";
import { localizeDom, translateText } from "../../shared/i18n.js";
import { syncBrowserRoute } from "../../shell/router.js";
import { createStateLoader } from "../../shared/state-sync.js";
import { trackTaskStatusNotifications } from "./notifications.js";
import {
  buildRemoteRequestHeaders,
  getActiveRemoteHost,
  isAndroidApkRuntime,
  remoteFetch,
  resolveRemoteUrl,
  scanLanForOpenSybauHosts,
} from "../../shared/remote-host.js";

let browserRouteInitialized = false;
let replaceBrowserRoute = false;
let routeNeedsHydration = view.page === "knowledge" || (view.page === "workspaces" && Boolean(view.selected));
let refreshPromise = null;
let refreshInFlight = null;
let inFlightRefreshPromise = null;
let inFlightStateLoadPromise = null;
let refreshPending = false;
let refreshAgain = false;
let refreshConfiguration = false;
let refreshForeground = false;
let refreshTimer = null;
let lastSnapshotRefresh = 0;
const MIN_BACKGROUND_REFRESH_INTERVAL_MS = 600;
const loadState = createStateLoader();
let lastConfigurationRefresh = 0;
let cliScanPromise = null;
let cliScanInProgress = false;
let quotaRefreshPromise = null;
let events = null;
let remotePollTimer = null;

const runtimeHooks = {
  render: null,
  hydrateRouteData: null,
  showCliProviderModal: null,
};

export function registerRuntimeHooks(hooks) {
  Object.assign(runtimeHooks, hooks);
}

export function markReplaceBrowserRoute(value = true) {
  replaceBrowserRoute = Boolean(value);
}

export function setRouteNeedsHydration(value) {
  routeNeedsHydration = Boolean(value);
}

export function getRouteNeedsHydration() {
  return routeNeedsHydration;
}

export function render(options = {}) {
  return runtimeHooks.render?.(options);
}

export function syncLocation() {
  syncBrowserRoute(view, { replace: !browserRouteInitialized || replaceBrowserRoute });
  browserRouteInitialized = true;
  replaceBrowserRoute = false;
}

export function normalizeRouteSelection() {
  if (!view.state) return;
  const workspaces = Array.isArray(view.state.workspaces) ? view.state.workspaces : [];
  const tasks = Array.isArray(view.state.tasks) ? view.state.tasks : [];

  if (view.selectedTaskId && !tasks.some((task) => task.id === view.selectedTaskId)) {
    view.selectedTaskId = null;
  }
  if (view.selectedWorkspaceId && !workspaces.some((workspace) => workspace.id === view.selectedWorkspaceId)) {
    view.selectedWorkspaceId = null;
  }

  if (view.page === "workspaces") {
    const candidateWs = view.selectedWorkspaceId || view.selected || "";
    const wsExists = Boolean(candidateWs) && workspaces.some((workspace) => workspace.id === candidateWs);
    if (wsExists) {
      view.selectedWorkspaceId = candidateWs;
      view.selected = candidateWs;
    } else {
      if (view.selected) replaceBrowserRoute = true;
      view.selectedWorkspaceId = workspaces[0]?.id || null;
      view.selected = view.selectedWorkspaceId;
      view.workspaceDir = "";
    }
    return;
  }

  if (view.page === "chat") {
    const candidateTask = view.selectedTaskId || view.selected || "";
    const taskExists = Boolean(candidateTask) && tasks.some((task) => task.id === candidateTask);
    if (taskExists) {
      view.selectedTaskId = candidateTask;
      view.selected = candidateTask;
    } else {
      if (view.selected) replaceBrowserRoute = true;
      view.selectedTaskId = null;
      view.selected = null;
    }
    return;
  }

  if (["flows", "tasks"].includes(view.page)) {
    if (view.selected && !tasks.some((task) => task.id === view.selected)) {
      view.selected = null;
      replaceBrowserRoute = true;
    }
    return;
  }

  if (view.selected) {
    view.selected = null;
    replaceBrowserRoute = true;
  }
}

export async function hydrateRouteData() {
  return runtimeHooks.hydrateRouteData?.();
}

export async function api(path, options = {}) {
  const response = await remoteFetch(resolveRemoteUrl(path), {
    ...options,
    headers: buildRemoteRequestHeaders({
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}

async function refreshSnapshot(includeConfiguration, background) {
  if (isAndroidApkRuntime() && !getActiveRemoteHost()) {
    if (!view.state) {
      await new Promise((resolve) => setTimeout(resolve, 420));
      view.state = { version: 1, settings: { maxConcurrent: 2, defaults: {}, vaultPath: "", taskPresets: [] }, workspaces: [], tasks: [] };
      view.connectors = {};
      view.providers = [];
      view.skills = [];
      view.skillsLoaded = true;
      view.streamConnected = false;
      view.page = "settings";
      view.settingsSection = "devices";
      view.orcaConnectTab = "client";
    }
    if (!view.lanScanAutoStarted && !view.scanningLanHosts) {
      view.lanScanAutoStarted = true;
      view.scanningLanHosts = true;
      scanLanForOpenSybauHosts()
        .then((hosts) => {
          view.discoveredLanHosts = Array.isArray(hosts) ? hosts : [];
          if (view.discoveredLanHosts.length === 1 && !view.orcaConnectDraft?.url) {
            const first = view.discoveredLanHosts[0];
            view.orcaConnectDraft = {
              name: first.name || first.hostname || first.url,
              url: first.url,
              username: "opensybau",
              password: "",
              quickPair: "",
            };
          }
        })
        .catch(() => {})
        .finally(() => {
          view.scanningLanHosts = false;
          render({ background: true });
        });
    }
    render({ background });
    return;
  }
  if (!inFlightStateLoadPromise) {
    inFlightStateLoadPromise = loadState().finally(() => {
      inFlightStateLoadPromise = null;
    });
  }
  const statePromise = inFlightStateLoadPromise;
  const configurationPromise = includeConfiguration
    ? Promise.all([
        api("/api/connectors"),
        api("/api/providers").catch(() => ({ providers: [] })),
        api("/api/connection-info").catch(() => null),
      ])
    : Promise.resolve(null);
  const [{ state, changed }, configuration] = await Promise.all([statePromise, configurationPromise]);
  lastSnapshotRefresh = Date.now();
  const activeWsId = view.homeWorkspaceId || state?.workspaces?.[0]?.id || "";
  if (!changed && !configuration && background && view.skillsLoaded && view.subagentProfilesLoaded) return;
  const [skills, subagentRes] = await Promise.all([
    view.skillsLoaded ? Promise.resolve({ skills: view.skills }) : api(`/api/skills${activeWsId ? `?workspaceId=${encodeURIComponent(activeWsId)}` : ""}`).catch(() => ({ skills: [] })),
    view.subagentProfilesLoaded && view.subagentProfilesWorkspaceId === activeWsId
      ? Promise.resolve({ profiles: view.subagentProfiles })
      : api(`/api/subagent-profiles${activeWsId ? `?workspaceId=${encodeURIComponent(activeWsId)}` : ""}`).catch(() => ({ profiles: [] })),
  ]);
  view.state = state;
  trackTaskStatusNotifications(state.tasks, { showToast });
  if (configuration) {
    view.connectors = configuration[0];
    view.providers = configuration[1].providers || [];
    if (configuration[2]) view.connectionInfo = configuration[2];
    lastConfigurationRefresh = Date.now();
  }
  view.skills = skills.skills || [];
  view.skillsLoaded = true;
  view.subagentProfiles = subagentRes.profiles || [];
  view.subagentProfilesLoaded = true;
  view.subagentProfilesWorkspaceId = activeWsId;
  const activeSubagentTaskId = view.selectedTaskId || view.selected;
  if (activeSubagentTaskId && view.chatDrawerTab === "subagents") {
    const activeTask = (state.tasks || []).find((t) => t.id === activeSubagentTaskId);
    const cached = view.taskSubagentDetailCache?.[activeSubagentTaskId];
    if (activeTask && (activeTask.subagents || []).length > 0 && (!cached || cached.updatedAt !== activeTask.updatedAt)) {
      void ensureTaskSubagentsDetail(activeTask.id, { force: true });
    }
  }
  view.settingsSupported = Object.hasOwn(state.settings, "defaults");
  normalizeRouteSelection();
  render({ background });
  if (configuration || (!view.quotas && !quotaRefreshPromise)) {
    void refreshQuotas({ background: true });
  }
  if (routeNeedsHydration) {
    routeNeedsHydration = false;
    hydrateRouteData().catch((error) => showToast(error.message));
  }
}

export function refresh({ configuration = false, background = false } = {}) {
  const needsConfig = Boolean(configuration || !view.connectors);
  if (inFlightRefreshPromise) {
    if (!background || needsConfig) {
      refreshAgain = true;
      refreshForeground ||= !background;
      refreshConfiguration ||= needsConfig;
    } else {
      refreshPending = true;
    }
    return inFlightRefreshPromise;
  }
  refreshAgain = true;
  refreshForeground = !background;
  refreshConfiguration = needsConfig;
  inFlightRefreshPromise = refreshInFlight = refreshPromise = (async () => {
    try {
      while (refreshAgain) {
        refreshAgain = false;
        const includeConfiguration = refreshConfiguration;
        const foreground = refreshForeground;
        refreshConfiguration = false;
        refreshForeground = false;
        if (!foreground) {
          const wait = MIN_BACKGROUND_REFRESH_INTERVAL_MS - (Date.now() - lastSnapshotRefresh);
          if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        }
        await refreshSnapshot(includeConfiguration, !foreground);
      }
    } catch (error) {
      refreshAgain = false;
      if (!view.state && (isAndroidApkRuntime() || getActiveRemoteHost())) {
        view.state = { version: 1, settings: { maxConcurrent: 2, defaults: {}, vaultPath: "", taskPresets: [] }, workspaces: [], tasks: [] };
        view.streamConnected = false;
        view.page = "settings";
        view.settingsSection = "devices";
        render();
      } else {
        showToast(error.message);
      }
    }
  })().finally(() => {
    inFlightRefreshPromise = null;
    refreshInFlight = null;
    refreshPromise = null;
    if (refreshPending) {
      refreshPending = false;
      const elapsed = Date.now() - lastSnapshotRefresh;
      scheduleRefresh(Math.max(120, MIN_BACKGROUND_REFRESH_INTERVAL_MS - elapsed));
    }
  });
  return inFlightRefreshPromise;
}

export const refreshState = refresh;

export function scheduleRefresh(delay = 160) {
  if (typeof document !== "undefined" && document.hidden) return;
  if (inFlightRefreshPromise) {
    refreshPending = true;
    return;
  }
  if (refreshTimer) return;
  const elapsed = Date.now() - lastSnapshotRefresh;
  const effectiveDelay = Math.max(delay, MIN_BACKGROUND_REFRESH_INTERVAL_MS - elapsed);
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refresh({ background: true });
  }, effectiveDelay);
}

const subagentProfilesInFlight = new Map();
const taskSubagentDetailInFlight = new Map();

export async function ensureSubagentProfiles(workspaceId = "", { force = false } = {}) {
  const wsId = workspaceId || view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || "";
  if (!force && view.subagentProfilesLoaded && view.subagentProfilesWorkspaceId === wsId) {
    return view.subagentProfiles || [];
  }
  const key = `${wsId}::${force ? "1" : "0"}`;
  if (subagentProfilesInFlight.has(key)) return subagentProfilesInFlight.get(key);
  const promise = (async () => {
    try {
      const qs = new URLSearchParams();
      if (wsId) qs.set("workspaceId", wsId);
      if (force) qs.set("refresh", "1");
      const suffix = qs.toString() ? `?${qs.toString()}` : "";
      const res = await api(`/api/subagent-profiles${suffix}`);
      view.subagentProfiles = Array.isArray(res.profiles) ? res.profiles : [];
      view.subagentProfilesLoaded = true;
      view.subagentProfilesWorkspaceId = wsId;
      return view.subagentProfiles;
    } catch {
      return view.subagentProfiles || [];
    } finally {
      subagentProfilesInFlight.delete(key);
    }
  })();
  subagentProfilesInFlight.set(key, promise);
  return promise;
}

const inventoryInFlight = new Map();
export async function ensureCustomizationInventory(workspaceId, force = false) {
  if (!workspaceId) return null;
  view.customizationInventory ||= {};
  if (!force && view.customizationInventory[workspaceId]) return view.customizationInventory[workspaceId];
  if (inventoryInFlight.has(workspaceId)) return inventoryInFlight.get(workspaceId);
  const pending = (async () => {
    try { view.customizationInventory[workspaceId] = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/customizations`); }
    catch { view.customizationInventory[workspaceId] = { error: true }; }
    finally { inventoryInFlight.delete(workspaceId); render({ background: true }); }
    return view.customizationInventory[workspaceId];
  })();
  inventoryInFlight.set(workspaceId, pending);
  return pending;
}

export async function ensureTaskSubagentsDetail(taskId, { force = false } = {}) {
  if (!taskId) return null;
  view.taskSubagentDetailCache ||= {};
  const task = (view.state?.tasks || []).find((t) => t.id === taskId);
  const existing = view.taskSubagentDetailCache[taskId];
  if (!force && existing && (!task || existing.updatedAt === task.updatedAt)) {
    return existing;
  }
  if (taskSubagentDetailInFlight.has(taskId)) return taskSubagentDetailInFlight.get(taskId);
  const promise = (async () => {
    try {
      const res = await api(`/api/tasks/${encodeURIComponent(taskId)}/subagents`);
      const entry = {
        subagents: Array.isArray(res.subagents) ? res.subagents : [],
        subagentPolicy: res.subagentPolicy || null,
        updatedAt: task?.updatedAt || new Date().toISOString(),
        fetchedAt: Date.now(),
      };
      view.taskSubagentDetailCache[taskId] = entry;
      render({ background: true });
      return entry;
    } catch {
      const entry = { ...(existing || { subagents: [] }), updatedAt: task?.updatedAt || "", error: true };
      view.taskSubagentDetailCache[taskId] = entry;
      render({ background: true });
      return entry;
    } finally {
      taskSubagentDetailInFlight.delete(taskId);
    }
  })();
  taskSubagentDetailInFlight.set(taskId, promise);
  return promise;
}

const fileIndexInFlight = new Map();

export async function ensureWorkspaceFileIndex(workspaceId) {
  if (!workspaceId) return [];
  if (Array.isArray(view.workspaceFileIndex?.[workspaceId])) return view.workspaceFileIndex[workspaceId];
  if (fileIndexInFlight.has(workspaceId)) return fileIndexInFlight.get(workspaceId);
  const promise = (async () => {
    try {
      const res = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/file-index`);
      view.workspaceFileIndex ||= {};
      view.workspaceFileIndex[workspaceId] = res.files || [];
      return view.workspaceFileIndex[workspaceId];
    } catch {
      view.workspaceFileIndex ||= {};
      view.workspaceFileIndex[workspaceId] = [];
      view.workspaceFileIndexErrorAt ||= {};
      view.workspaceFileIndexErrorAt[workspaceId] = Date.now();
      return [];
    } finally {
      fileIndexInFlight.delete(workspaceId);
    }
  })();
  fileIndexInFlight.set(workspaceId, promise);
  return promise;
}

const gitStatusInFlight = new Map();

export async function ensureWorkspaceGitStatus(workspaceId, taskId = "", { force = false } = {}) {
  if (!workspaceId) return { currentBranch: "main", branches: ["main"], changedFiles: [], clean: true, entries: [] };
  const cacheKey = `${workspaceId}::${taskId || ""}`;
  view.workspaceGitStatus ||= {};
  const existing = view.workspaceGitStatus[cacheKey];
  if (!force && existing && Date.now() - (existing.fetchedAt || 0) < 12_000) {
    return existing;
  }
  if (gitStatusInFlight.has(cacheKey)) {
    return gitStatusInFlight.get(cacheKey);
  }
  const promise = (async () => {
    try {
      const q = taskId ? `?taskId=${encodeURIComponent(taskId)}` : "";
      const res = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/git-status${q}`);
      const changedFiles = Array.isArray(res.changedFiles) ? res.changedFiles : [];
      const record = {
        currentBranch: res.currentBranch || "main",
        branches: Array.isArray(res.branches) && res.branches.length ? res.branches : ["main"],
        changedFiles,
        entries: changedFiles,
        clean: changedFiles.length === 0,
        error: false,
        fetchedAt: Date.now(),
      };
      view.workspaceGitStatus[cacheKey] = record;
      return record;
    } catch {
      const fallback = existing || {
        currentBranch: "main",
        branches: ["main"],
        changedFiles: [],
        clean: true,
        entries: [],
        error: true,
        fetchedAt: Date.now(),
      };
      view.workspaceGitStatus[cacheKey] = fallback;
      return fallback;
    } finally {
      gitStatusInFlight.delete(cacheKey);
    }
  })();
  gitStatusInFlight.set(cacheKey, promise);
  return promise;
}

export function showModal(title, body, submitLabel, formType = "") {
  const inferred = title === "Task mới" ? "task" : title === "Thêm workspace" ? "workspace" : title === "Ghi nhớ mới" ? "memory" : "dismiss";
  const type = formType || inferred;
  const overlay = $("#overlay");
  if (!overlay) return;
  overlay.hidden = false;
  view.commandPaletteOpen = false;
  overlay.innerHTML = `<div class="modal-backdrop" data-action="close-modal"><form class="modal app-dialog-shell" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-form="${type}" data-modal><header class="modal-head app-dialog-header"><h2 id="modal-title">${esc(title)}</h2><button type="button" class="icon-button app-dialog-close" data-action="close-modal" aria-label="Đóng" title="Đóng">${icon("x", 16)}</button></header><div class="modal-body app-dialog-content">${body}</div><footer class="modal-actions app-dialog-footer">${type === "dismiss" ? "" : `<button type="button" class="button quiet" data-action="close-modal">Hủy</button>`}<button class="button primary" type="submit">${esc(submitLabel)}</button></footer></form></div>`;
  localizeDom(overlay, view.language);
  $(".modal input, .modal textarea, .modal select")?.focus();
}

export function showErrorDetails(text) {
  const details = String(text || "Không có thông tin lỗi chi tiết.");
  showModal("Chi tiết lỗi", `<div class="error-detail-content"><p>Nguyên nhân được trả về từ agent hoặc tiến trình:</p><pre>${esc(details)}</pre></div>`, "Đóng");
  const form = $("#overlay .modal");
  if (form) form.dataset.form = "dismiss";
}

export function closeOverlay() {
  view.commandPaletteOpen = false;
  const overlay = $("#overlay");
  if (overlay) overlay.innerHTML = "";
}

export const closeModal = closeOverlay;

export function showToast(message) {
  const toast = $("#toast");
  if (!toast) return;
  toast.textContent = translateText(message, view.language);
  toast.classList.add("visible");
  clearTimeout(view.toastTimer);
  view.toastTimer = setTimeout(() => toast.classList.remove("visible"), 3500);
}

export function refreshQuotas({ force = false, background = false } = {}) {
  if (quotaRefreshPromise) return quotaRefreshPromise;
  view.quotasLoading = true;
  if (!background) render({ background: true });
  quotaRefreshPromise = (async () => {
    try {
      const data = await api(force ? "/api/quotas?refresh=1" : "/api/quotas");
      view.quotas = data;
      return data;
    } catch (error) {
      if (!background) showToast(`Không tải được hạn mức: ${error.message}`);
      return null;
    } finally {
      view.quotasLoading = false;
      quotaRefreshPromise = null;
      render({ background: true });
    }
  })();
  return quotaRefreshPromise;
}

export function cliRefreshButton(label = "Quét lại", { small = true } = {}) {
  const busy = cliScanInProgress;
  return `<button class="button quiet${small ? " small" : ""}" type="button" data-action="provider-cli-refresh" ${busy ? 'disabled aria-busy="true"' : ""}>${icon("refresh-cw", 13)} ${busy ? "Đang quét..." : label}</button>`;
}

export function scanCliProviders(button, { openModal = false } = {}) {
  if (cliScanPromise) {
    showToast("Đang quét CLI, vui lòng đợi kết quả.");
    return cliScanPromise;
  }
  cliScanInProgress = true;
  const previousLabel = button?.innerHTML;
  if (button) {
    button.disabled = true;
    button.innerHTML = `${icon("refresh-cw", 13)} Đang quét...`;
  }
  showToast("Đang quét Codex, Antigravity và Claude Code...");
  cliScanPromise = (async () => {
    try {
      view.connectors = await api("/api/connectors?refresh=1");
      cliScanInProgress = false;
      await refresh();
      void refreshQuotas({ force: true, background: true });
      if (openModal) runtimeHooks.showCliProviderModal?.();
      showToast("Đã quét lại Codex, Antigravity và Claude Code trên máy chạy OpenSybau.");
    } catch (error) {
      cliScanInProgress = false;
      render();
      showToast(`Quét CLI thất bại: ${error.message}`);
    } finally {
      cliScanInProgress = false;
      cliScanPromise = null;
      if (button?.isConnected) {
        button.disabled = false;
        button.innerHTML = previousLabel;
      }
    }
  })();
  return cliScanPromise;
}

export function connectEventStream() {
  try { events?.close?.(); } catch {}
  events = null;
  if (remotePollTimer) {
    clearInterval(remotePollTimer);
    remotePollTimer = null;
  }
  const activeHost = getActiveRemoteHost();
  if (isAndroidApkRuntime() && !activeHost?.url) {
    view.streamConnected = false;
    return;
  }
  try {
    events = new EventSource(resolveRemoteUrl("/api/events"));
    events.addEventListener("update", (ev) => {
      try {
        const payload = JSON.parse(ev.data || "{}");
        if (payload.type === "subagents") view.subagentProfilesLoaded = false;
        if (payload.type === "skills") view.skillsLoaded = false;
      } catch {}
      scheduleRefresh(250);
    });
    events.addEventListener("open", () => {
      if (remotePollTimer) {
        clearInterval(remotePollTimer);
        remotePollTimer = null;
      }
      const changed = !view.streamConnected;
      view.streamConnected = true;
      if (changed && ["tasks", "chat"].includes(view.page)) render({ background: true });
      if (view.state) scheduleRefresh(0);
    });
    events.addEventListener("error", () => {
      if (activeHost?.url && !remotePollTimer) {
        remotePollTimer = setInterval(() => {
          if (typeof document === "undefined" || !document.hidden) scheduleRefresh(0);
        }, 2500);
      }
      if (!view.streamConnected) return;
      view.streamConnected = false;
      if (["tasks", "chat"].includes(view.page)) render({ background: true });
    });
  } catch {
    view.streamConnected = false;
  }
}

export const connectEvents = connectEventStream;

export function startPeriodicRefresh() {
  setInterval(() => {
    if (document.hidden) return;
    if (!view.streamConnected || Date.now() - lastSnapshotRefresh >= 60_000) scheduleRefresh(0);
    if (view.page === "settings" && Date.now() - lastConfigurationRefresh > 300_000) {
      void refresh({ configuration: true, background: true });
    }
  }, 30_000);
}

let lifecycleWakeBound = false;
if (typeof window !== "undefined" && typeof document !== "undefined" && !lifecycleWakeBound) {
  lifecycleWakeBound = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      if (!view.streamConnected || getActiveRemoteHost()?.url) {
        connectEvents();
      }
      void refreshState({ background: true });
    }
  });
  window.addEventListener("online", () => {
    connectEvents();
    void refreshState({ background: true });
  });
}
