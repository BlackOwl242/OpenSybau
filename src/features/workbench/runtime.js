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
let refreshPending = false;
let refreshAgain = false;
let refreshConfiguration = false;
let refreshForeground = false;
let refreshTimer = null;
let lastSnapshotRefresh = 0;
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
  const selectedExists = view.page === "workspaces"
    ? view.state.workspaces.some((workspace) => workspace.id === view.selected)
    : ["chat", "flows"].includes(view.page) && view.state.tasks.some((task) => task.id === view.selected);
  if (view.selected && !selectedExists) {
    view.selected = null;
    view.workspaceDir = "";
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
  const statePromise = loadState();
  const configurationPromise = includeConfiguration
    ? Promise.all([
        api("/api/connectors"),
        api("/api/providers").catch(() => ({ providers: [] })),
        api("/api/connection-info").catch(() => null),
      ])
    : Promise.resolve(null);
  const [{ state, changed }, configuration] = await Promise.all([statePromise, configurationPromise]);
  lastSnapshotRefresh = Date.now();
  if (!changed && !configuration && background && view.skillsLoaded) return;
  const skills = view.skillsLoaded ? { skills: view.skills } : await api("/api/skills").catch(() => ({ skills: [] }));
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
  refreshAgain = true;
  refreshForeground ||= !background;
  refreshConfiguration ||= configuration || !view.connectors;
  if (refreshInFlight) {
    refreshPending = true;
    return refreshInFlight;
  }
  refreshInFlight = refreshPromise = (async () => {
    try {
      while (refreshAgain) {
        refreshAgain = false;
        const includeConfiguration = refreshConfiguration;
        const foreground = refreshForeground;
        refreshConfiguration = false;
        refreshForeground = false;
        if (!foreground) {
          const wait = 600 - (Date.now() - lastSnapshotRefresh);
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
    refreshInFlight = null;
    refreshPromise = null;
    if (refreshPending) {
      refreshPending = false;
      scheduleRefresh(80);
    }
  });
  return refreshInFlight;
}

export function scheduleRefresh(delay = 160) {
  if (document.hidden) return;
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void refresh({ background: true });
  }, delay);
}

export async function ensureWorkspaceFileIndex(workspaceId) {
  if (!workspaceId) return [];
  if (Array.isArray(view.workspaceFileIndex?.[workspaceId])) return view.workspaceFileIndex[workspaceId];
  try {
    const res = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/file-index`);
    view.workspaceFileIndex ||= {};
    view.workspaceFileIndex[workspaceId] = res.files || [];
    return view.workspaceFileIndex[workspaceId];
  } catch {
    return [];
  }
}

const gitStatusInFlight = new Map();

export async function ensureWorkspaceGitStatus(workspaceId, taskId = "", { force = false } = {}) {
  if (!workspaceId) return { currentBranch: "main", branches: ["main"], changedFiles: [] };
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
      const record = {
        currentBranch: res.currentBranch || "main",
        branches: Array.isArray(res.branches) && res.branches.length ? res.branches : ["main"],
        changedFiles: Array.isArray(res.changedFiles) ? res.changedFiles : [],
        fetchedAt: Date.now(),
      };
      view.workspaceGitStatus[cacheKey] = record;
      return record;
    } catch {
      const fallback = existing || { currentBranch: "main", branches: ["main"], changedFiles: [], fetchedAt: Date.now() };
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
  $("#overlay").innerHTML = `<div class="modal-backdrop" data-action="close-modal"><form class="modal app-dialog-shell" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-form="${type}" data-modal><header class="modal-head app-dialog-header"><h2 id="modal-title">${esc(title)}</h2><button type="button" class="icon-button app-dialog-close" data-action="close-modal" aria-label="Đóng" title="Đóng">${icon("x", 16)}</button></header><div class="modal-body app-dialog-content">${body}</div><footer class="modal-actions app-dialog-footer">${type === "dismiss" ? "" : `<button type="button" class="button quiet" data-action="close-modal">Hủy</button>`}<button class="button primary" type="submit">${esc(submitLabel)}</button></footer></form></div>`;
  localizeDom($("#overlay"), view.language);
  $(".modal input, .modal textarea, .modal select")?.focus();
}

export function showErrorDetails(text) {
  const details = String(text || "Không có thông tin lỗi chi tiết.");
  showModal("Chi tiết lỗi", `<div class="error-detail-content"><p>Nguyên nhân được trả về từ agent hoặc tiến trình:</p><pre>${esc(details)}</pre></div>`, "Đóng");
  const form = $("#overlay .modal");
  if (form) form.dataset.form = "dismiss";
}

export function closeOverlay() {
  $("#overlay").innerHTML = "";
}

export function showToast(message) {
  const toast = $("#toast");
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
  if (activeHost?.url && activeHost.password) {
    view.streamConnected = true;
    remotePollTimer = setInterval(() => {
      if (!document.hidden) scheduleRefresh(0);
    }, 2500);
    return;
  }
  try {
    events = new EventSource(resolveRemoteUrl("/__events"));
    events.addEventListener("update", () => scheduleRefresh(220));
    events.addEventListener("open", () => {
      const changed = !view.streamConnected;
      view.streamConnected = true;
      if (changed && ["tasks", "chat"].includes(view.page)) render({ background: true });
      if (view.state) scheduleRefresh(0);
    });
    events.addEventListener("error", () => {
      if (!view.streamConnected) return;
      view.streamConnected = false;
      if (["tasks", "chat"].includes(view.page)) render({ background: true });
    });
  } catch {
    view.streamConnected = false;
  }
}

export function startPeriodicRefresh() {
  setInterval(() => {
    if (document.hidden) return;
    if (!view.streamConnected || Date.now() - lastSnapshotRefresh >= 60_000) scheduleRefresh(0);
    if (view.page === "settings" && Date.now() - lastConfigurationRefresh > 300_000) {
      void refresh({ configuration: true, background: true });
    }
  }, 30_000);
}
