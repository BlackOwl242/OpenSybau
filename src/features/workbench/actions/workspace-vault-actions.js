import { $, view } from "../../../shared/state.js";
import {
  getSavedRemoteHosts,
  parsePairingInput,
  probeRemoteHost,
  removeRemoteHostProfile,
  scanLanForOpenSybauHosts,
  setActiveRemoteHost,
} from "../../../shared/remote-host.js";
import {
  api,
  closeOverlay,
  connectEventStream,
  refresh,
  refreshQuotas,
  render,
  scanCliProviders,
  showToast,
} from "../runtime.js";
import { syncCustomSelect } from "../ui-controls.js";
import { openStageFileTab } from "../stage-tabs.js";
import {
  defaultSkillScope,
  showEditProjectModal,
  showMemoryModal,
  showNewVaultNoteModal,
  showProjectSectionModal,
  showSkillCreateModal,
  showVaultModal,
  showWorkspaceModal,
  sourceFolderRow,
} from "../modals.js";
import { clearSidebarSearch } from "../pages/chat-page.js";
import { loadWorkspaceDir, loadWorkspacePreview } from "../pages/tasks-workspaces-page.js";
import {
  ensureSkillDetail,
  loadVaultDir,
  loadVaultGraph,
  loadVaultPreview,
} from "../pages/knowledge-skills-page.js";
import {
  apiProviderId,
  applySettingsSearch,
  showApiProviderModal,
  showCliProviderModal,
} from "../pages/settings-page.js";

let cliLoginPollTimer = null;

function startCliLoginAutoPoll(providerId) {
  if (cliLoginPollTimer) {
    clearInterval(cliLoginPollTimer);
    cliLoginPollTimer = null;
  }
  let attempts = 0;
  let pollInFlight = false;
  cliLoginPollTimer = setInterval(async () => {
    if (pollInFlight) return;
    attempts += 1;
    if (attempts > 30) {
      clearInterval(cliLoginPollTimer);
      cliLoginPollTimer = null;
      return;
    }
    pollInFlight = true;
    try {
      const connectors = await api("/api/connectors?refresh=1");
      view.connectors = connectors;
      if (connectors?.[providerId]?.available) {
        clearInterval(cliLoginPollTimer);
        cliLoginPollTimer = null;
        await refresh();
        void refreshQuotas({ force: true, background: true });
        if (!$("#overlay")?.hidden && $(".cli-connect-list", $("#overlay"))) {
          showCliProviderModal();
        }
        showToast("Đã đăng nhập và kết nối CLI thành công!");
      }
    } catch {
    } finally {
      pollInFlight = false;
    }
  }, 4000);
}

export async function handleWorkspaceVaultSettingsAction(action, id, button, event) {
  if (action === "scan-skills") {
    button.disabled = true;
    const result = await api("/api/skills?refresh=1");
    view.skills = result.skills || []; view.skillsLoaded = true; render();
    showToast(`Đã quét ${view.skills.length} skill từ thư mục cài đặt hiện tại.`);
    return true;
  }
  if (action === "toggle-workspace") {
    view.projectMenuId = "";
    const collapsed = new Set(view.collapsedWorkspaces);
    if (view.page === "workspaces" && id && view.selected !== id) {
      collapsed.delete(id);
      view.collapsedWorkspaces = [...collapsed];
      try { localStorage.setItem("workbench.collapsed-workspaces", JSON.stringify(view.collapsedWorkspaces)); } catch {}
      await loadWorkspaceDir(id, "");
      return true;
    }
    if (id) view.homeWorkspaceId = id;
    collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
    view.collapsedWorkspaces = [...collapsed];
    try { localStorage.setItem("workbench.collapsed-workspaces", JSON.stringify(view.collapsedWorkspaces)); } catch {}
    render();
    return true;
  }
  if (action === "toggle-workspace-overview") {
    view.workspaceOverviewMode = !view.workspaceOverviewMode;
    view.activeStageTabId = "chat";
    render();
    return true;
  }
  if (action === "toggle-project-menu") { view.projectMenuId = view.projectMenuId === id ? "" : id; render(); return true; }
  if (action === "edit-project") {
    const workspace = view.state.workspaces.find((item) => item.id === id);
    view.projectMenuId = "";
    if (workspace) showEditProjectModal(workspace);
    return true;
  }
  if (action === "edit-project-section") {
    const workspace = view.state.workspaces.find((item) => item.id === id);
    view.projectMenuId = "";
    if (workspace) showProjectSectionModal(workspace);
    return true;
  }
  if (action === "add-source-folder") {
    const list = button.closest(".modal")?.querySelector(".source-folder-list");
    list?.insertAdjacentHTML("beforeend", sourceFolderRow(""));
    list?.querySelector(".source-folder-row:last-child input")?.focus();
    return true;
  }
  if (action === "remove-source-folder") { if (!button.disabled) button.closest(".source-folder-row")?.remove(); return true; }
  if (action === "add-workspace") { showWorkspaceModal(); return true; }
  if (action === "new-memory") { showMemoryModal(); return true; }
  if (action === "new-skill") { showSkillCreateModal(); return true; }
  if (action === "provider-add") { showApiProviderModal(); return true; }
  if (action === "toggle-sidebar-search") {
    const container = button.closest(".wb-page-sidebar, .wb-context-sidebar") || document;
    const searchLabel = container.querySelector(".wb-sidebar-search");
    if (searchLabel) {
      const nextOpen = searchLabel.getAttribute("data-open") !== "true";
      const isSettingsSidebar = Boolean(searchLabel.querySelector("[data-settings-search]"));
      if (isSettingsSidebar) view.settingsSearchOpen = nextOpen;
      else view.sidebarSearchOpen = nextOpen;
      if (nextOpen) {
        searchLabel.setAttribute("data-open", "true");
        searchLabel.querySelector("input")?.focus();
      } else {
        searchLabel.removeAttribute("data-open");
        if (isSettingsSidebar) {
          const input = searchLabel.querySelector("[data-settings-search]");
          if (input) input.value = "";
          applySettingsSearch("");
        } else {
          clearSidebarSearch();
        }
      }
    }
    return true;
  }
  if (action === "settings-nav") {
    view.settingsSection = button.dataset.section || "all";
    if (view.settingsSearchQuery) {
      view.settingsSearchQuery = "";
      view.settingsSearchOpen = false;
    }
    if ((view.settingsSection === "devices" || view.settingsSection === "all") && !view.connectionInfo) {
      api("/api/connection-info").then((info) => {
        view.connectionInfo = info;
        render({ background: true });
      }).catch(() => {});
    }
    render();
    return true;
  }
  if (action === "refresh-connection-info") {
    view.connectionInfo = await api("/api/connection-info");
    render();
    showToast("Đã làm mới thông tin kết nối thiết bị.");
    return true;
  }
  if (action === "refresh-quotas") {
    await refreshQuotas({ force: true, background: false });
    showToast("Đã cập nhật hạn mức Codex, Antigravity và Claude Code.");
    return true;
  }
  if (action === "open-orca-connect") {
    view.page = "settings";
    view.settingsSection = "devices";
    view.selected = null;
    api("/api/connection-info").then((info) => {
      view.connectionInfo = info;
      render({ background: true });
    }).catch(() => {});
    render();
    return true;
  }
  if (action === "orca-connect-tab") {
    view.orcaConnectTab = button.dataset.tab || "host";
    render();
    return true;
  }
  if (action === "generate-connection-password") {
    const info = await api("/api/connection-config", {
      method: "POST",
      body: JSON.stringify({ generate: true }),
    });
    view.connectionInfo = info;
    view.connectionPasswordDraft = info.accessPassword || "";
    render();
    showToast("Đã tạo tự động và lưu mật khẩu kết nối mới!");
    return true;
  }
  if (action === "save-connection-password") {
    const passInput = $("[data-connection-password-input]");
    const password = String(passInput?.value ?? view.connectionPasswordDraft ?? "").trim();
    if (!password || password.length < 6) {
      showToast("Mật khẩu cần tối thiểu 6 ký tự.");
      passInput?.focus();
      return true;
    }
    const info = await api("/api/connection-config", {
      method: "POST",
      body: JSON.stringify({ password }),
    });
    view.connectionInfo = info;
    view.connectionPasswordDraft = info.accessPassword || password;
    render();
    showToast("Đã lưu mật khẩu và mở kết nối cho điện thoại!");
    return true;
  }
  if (action === "copy-connection-password") {
    const pass = $("[data-connection-password-input]")?.value || view.connectionInfo?.accessPassword || "";
    if (pass) {
      await navigator.clipboard?.writeText(pass);
      showToast("Đã sao chép mật khẩu kết nối.");
    }
    return true;
  }
  if (action === "scan-lan-hosts") {
    if (view.scanningLanHosts) return true;
    view.scanningLanHosts = true;
    render();
    try {
      const hintUrl = $("[data-orca-host-url]")?.value || view.orcaConnectDraft?.url || "";
      const hosts = await scanLanForOpenSybauHosts({ hintUrl });
      view.discoveredLanHosts = Array.isArray(hosts) ? hosts : [];
      if (view.discoveredLanHosts.length > 0 && !($("[data-orca-host-url]")?.value || "").trim()) {
        const first = view.discoveredLanHosts[0];
        view.orcaConnectDraft = {
          ...(view.orcaConnectDraft || {}),
          name: first.name || first.hostname || first.url,
          url: first.url,
          username: view.orcaConnectDraft?.username || "opensybau",
          password: $("[data-orca-host-pass]")?.value || view.orcaConnectDraft?.password || "",
        };
      }
      showToast(
        view.discoveredLanHosts.length
          ? `Đã tìm thấy ${view.discoveredLanHosts.length} máy tính trong mạng Wi-Fi!`
          : "Chưa tìm thấy máy tính tự động. Hãy kiểm tra PC đang mở OpenSybau cùng mạng Wi-Fi."
      );
    } finally {
      view.scanningLanHosts = false;
      render();
    }
    return true;
  }
  if (action === "pick-discovered-host") {
    const pickedUrl = button.dataset.url || "";
    const pickedName = button.dataset.name || "";
    if (pickedUrl) {
      view.orcaConnectDraft = {
        name: pickedName || pickedUrl,
        url: pickedUrl,
        username: $("[data-orca-host-user]")?.value || view.orcaConnectDraft?.username || "opensybau",
        password: $("[data-orca-host-pass]")?.value || view.orcaConnectDraft?.password || "",
        quickPair: $("[data-orca-quick-pair-input]")?.value || "",
      };
      view.orcaConnectProbeResult = null;
      render();
      setTimeout(() => $("[data-orca-host-pass]")?.focus(), 40);
      showToast(`Đã chọn ${pickedName || pickedUrl}. Nhập mật khẩu trên PC rồi bấm Lưu & Kết nối.`);
    }
    return true;
  }
  if (action === "copy-pairing-uri") {
    const uri = button.dataset.uri || $("[data-pairing-uri-input]")?.value || "";
    if (uri) { await navigator.clipboard?.writeText(uri); showToast("Đã sao chép mã kết nối."); }
    return true;
  }
  if (action === "copy-lan-url") {
    const url = button.dataset.url || "";
    if (url) { await navigator.clipboard?.writeText(url); showToast(`Đã sao chép địa chỉ: ${url}`); }
    return true;
  }
  if (action === "copy-lan-command") {
    const cmd = button.dataset.cmd || "";
    if (cmd) { await navigator.clipboard?.writeText(cmd); showToast("Đã sao chép vào Clipboard."); }
    return true;
  }
  if (action === "paste-quick-pair") {
    const text = await navigator.clipboard?.readText().catch(() => "");
    const input = $("[data-orca-quick-pair-input]");
    if (input && text) {
      input.value = text.trim();
      view.orcaConnectDraft = { ...(view.orcaConnectDraft || {}), quickPair: input.value };
    }
    return true;
  }
  if (action === "apply-quick-pair") {
    let raw = $("[data-orca-quick-pair-input]")?.value || view.orcaConnectDraft?.quickPair || "";
    if (!raw) raw = (await navigator.clipboard?.readText().catch(() => "")) || "";
    const parsed = parsePairingInput(raw);
    const draft = {
      name: parsed.name || "",
      url: parsed.url || "",
      username: parsed.username || "opensybau",
      password: parsed.password || view.orcaConnectDraft?.password || "",
      quickPair: raw,
    };
    view.orcaConnectDraft = draft;
    const probe = await probeRemoteHost(draft);
    view.orcaConnectProbeResult = probe;
    if (probe.ok) {
      const saved = setActiveRemoteHost({
        ...draft,
        name: draft.name || probe.info?.hostname || draft.url,
        hostname: probe.info?.hostname || "",
        platform: probe.info?.platform || "",
        latencyMs: probe.latencyMs,
      });
      view.connectionInfo = probe.info || view.connectionInfo;
      view.streamConnected = true;
      connectEventStream();
      await refresh({ configuration: true });
      showToast(`Đã kết nối tới ${saved.name} (${probe.latencyMs}ms)!`);
      return true;
    }
    render();
    showToast(probe.error || `Đã nạp địa chỉ ${parsed.url}. Nhập mật khẩu để kết nối.`);
    return true;
  }
  if (action === "test-orca-host-connection") {
    const draft = {
      name: $("[data-orca-host-name]")?.value || "",
      url: $("[data-orca-host-url]")?.value || "",
      username: $("[data-orca-host-user]")?.value || "opensybau",
      password: $("[data-orca-host-pass]")?.value || "",
      quickPair: $("[data-orca-quick-pair-input]")?.value || "",
    };
    view.orcaConnectDraft = draft;
    view.orcaConnectProbeResult = await probeRemoteHost(draft);
    render();
    showToast(view.orcaConnectProbeResult.ok ? `Ping thành công (${view.orcaConnectProbeResult.latencyMs}ms)!` : view.orcaConnectProbeResult.error);
    return true;
  }
  if (action === "save-connect-orca-host") {
    const draft = {
      name: $("[data-orca-host-name]")?.value || "",
      url: $("[data-orca-host-url]")?.value || "",
      username: $("[data-orca-host-user]")?.value || "opensybau",
      password: $("[data-orca-host-pass]")?.value || "",
    };
    const probe = await probeRemoteHost(draft);
    view.orcaConnectProbeResult = probe;
    if (!probe.ok) {
      view.orcaConnectDraft = draft;
      render();
      showToast(probe.error);
      return true;
    }
    const saved = setActiveRemoteHost({
      ...draft,
      name: draft.name || probe.info?.hostname || draft.url,
      hostname: probe.info?.hostname || "",
      platform: probe.info?.platform || "",
      latencyMs: probe.latencyMs,
    });
    view.connectionInfo = probe.info || view.connectionInfo;
    view.streamConnected = true;
    connectEventStream();
    await refresh({ configuration: true });
    showToast(`Đã kết nối tới máy chủ ${saved.name} (${probe.latencyMs}ms)!`);
    return true;
  }
  if (action === "connect-saved-host") {
    const target = getSavedRemoteHosts().find((item) => item.id === id);
    if (!target) return true;
    const probe = await probeRemoteHost(target);
    if (!probe.ok) {
      view.orcaConnectDraft = { ...target };
      view.orcaConnectProbeResult = probe;
      render();
      showToast(probe.error);
      return true;
    }
    const saved = setActiveRemoteHost({
      ...target,
      hostname: probe.info?.hostname || target.hostname || "",
      platform: probe.info?.platform || target.platform || "",
      latencyMs: probe.latencyMs,
    });
    view.connectionInfo = probe.info || view.connectionInfo;
    view.streamConnected = true;
    connectEventStream();
    await refresh({ configuration: true });
    showToast(`Đã chuyển sang máy chủ ${saved.name} (${probe.latencyMs}ms)!`);
    return true;
  }
  if (action === "disconnect-remote-host") {
    setActiveRemoteHost(null);
    view.orcaConnectProbeResult = null;
    connectEventStream();
    render();
    await refresh({ configuration: true }).catch(() => {});
    showToast("Đã ngắt kết nối máy chủ từ xa.");
    return true;
  }
  if (action === "edit-saved-host") {
    const target = getSavedRemoteHosts().find((item) => item.id === id);
    if (target) {
      view.orcaConnectDraft = { ...target, quickPair: "" };
      view.orcaConnectProbeResult = null;
      render();
    }
    return true;
  }
  if (action === "remove-saved-host") {
    removeRemoteHostProfile(id);
    render();
    showToast("Đã xóa máy chủ khỏi danh sách lưu.");
    return true;
  }
  if (action === "provider-connect-cli") { showCliProviderModal(); return true; }
  if (action === "provider-cli-refresh") {
    await scanCliProviders(button, { openModal: Boolean(button.closest("#overlay")) });
    return true;
  }
  if (action === "provider-cli-install") {
    const install = window.opensybauDesktop?.installCli;
    if (!install || view.cliInstallProvider) return true;
    const buttonLabel = button.innerHTML;
    button.disabled = true;
    button.textContent = "Đang cài đặt…";
    view.cliInstallProvider = id;
    render();
    try {
      const result = await install(id, view.language);
      if (result?.cancelled) return true;
      if (!result?.ok) throw new Error("Trình cài đặt chưa hoàn tất.");
      const reopenModal = Boolean(button.closest("#overlay"));
      await scanCliProviders(undefined, { openModal: reopenModal });
      const installedConnector = view.connectors?.[id];
      if (installedConnector && !installedConnector.available) {
        try {
          const loginRes = await api(`/api/connectors/${encodeURIComponent(id)}/login`, { method: "POST" });
          showToast(loginRes.message || "Đã cài đặt xong và mở cửa sổ đăng nhập CLI.");
          startCliLoginAutoPoll(id);
        } catch {}
      }
    } catch (error) {
      showToast(`Cài CLI thất bại: ${error.message}`);
    } finally {
      view.cliInstallProvider = "";
      if (button.isConnected) { button.disabled = false; button.innerHTML = buttonLabel; }
      render();
    }
    return true;
  }
  if (action === "provider-cli-login") {
    const label = button.innerHTML;
    button.disabled = true;
    button.textContent = "Đang mở terminal…";
    try {
      const result = await api(`/api/connectors/${encodeURIComponent(id)}/login`, { method: "POST" });
      const feedback = $(".cli-connect-feedback", button.closest(".modal"));
      if (feedback) { feedback.textContent = result.message; feedback.hidden = false; }
      showToast(result.message);
      startCliLoginAutoPoll(id);
    } catch (error) {
      showToast(error.message || "Không thể mở terminal đăng nhập CLI.");
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.innerHTML = label;
      }
    }
    return true;
  }
  if (action === "provider-preset") {
    const form = button.closest(".modal");
    const presets = {
      openai: { name: "OpenAI / ChatGPT API", protocol: "openai", baseUrl: "https://api.openai.com/v1" },
      gemini: { name: "Google Gemini API", protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
      anthropic: { name: "Claude API", protocol: "anthropic", baseUrl: "https://api.anthropic.com/v1" },
      local: { name: "", protocol: "openai-compatible", baseUrl: "http://localhost:11434/v1" },
    };
    const preset = presets[button.dataset.preset];
    if (form && preset) {
      for (const [field, value] of Object.entries(preset)) {
        const el = form.querySelector(`[name="${field}"]`);
        if (el) {
          el.value = value;
          if (el.tagName === "SELECT") syncCustomSelect(el);
        }
      }
      if (preset.name) form.querySelector('[name="name"]')?.focus();
    }
    return true;
  }
  if (action === "provider-edit") {
    const provider = view.providers.find((item) => item.id === id && item.managedBy === "local");
    if (provider) showApiProviderModal(provider);
    return true;
  }
  if (action === "provider-import-env") {
    button.disabled = true;
    try {
      await api("/api/providers/import-environment", { method: "POST", body: JSON.stringify({ id }) });
      await refresh();
      showToast("Đã chuyển provider và API key vào cấu hình OpenSybau. Bản trong .env gốc vẫn được giữ lại.");
    } finally { button.disabled = false; }
    return true;
  }
  if (action === "provider-discover-models") {
    const form = button.closest(".modal");
    const data = new FormData(form);
    const fields = Object.fromEntries(data.entries());
    const provId = form.dataset.id || apiProviderId(fields.name) || "provider-check";
    button.disabled = true;
    const label = button.innerHTML;
    button.textContent = "Đang tải…";
    try {
      const result = await api("/api/providers/models", { method: "POST", body: JSON.stringify({ ...fields, id: provId, models: fields.models || "provider-check", useSavedKey: !data.has("clearApiKey") }) });
      form.querySelector('[name="models"]').value = result.models.map((model) => model.id).join("\n");
      showToast(`Đã tải ${result.models.length} model từ endpoint.`);
    } catch (error) { showToast(error.message); }
    finally { button.disabled = false; button.innerHTML = label; }
    return true;
  }
  if (action === "provider-delete") {
    const provider = view.providers.find((item) => item.id === id && item.managedBy === "local");
    if (provider && confirm(`Xóa nguồn “${provider.name}” khỏi OpenSybau? API key đã lưu cũng sẽ bị xóa.`)) {
      await api(`/api/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
      await refresh({ configuration: true }); showToast("Đã xóa nguồn AI.");
    }
    return true;
  }
  if (action === "connect-vault") { showVaultModal(); return true; }
  if (action === "disconnect-vault") {
    if (confirm("Ngắt vault khỏi OpenSybau? Ghi chú trên máy không bị thay đổi.")) {
      await api("/api/settings", { method: "POST", body: JSON.stringify({ vaultPath: "" }) });
      view.vaultEntries = []; view.vaultPreview = null; await refresh();
    }
    return true;
  }
  if (action === "close-modal") { if (event.target === button || button.tagName === "BUTTON") closeOverlay(); return true; }
  if (action === "close-details") { view.selected = null; view.page = "chat"; render(); return true; }
  if (action === "parallel-plus" || action === "parallel-minus") {
    const current = view.state.settings.maxConcurrent;
    const maxConcurrent = Math.max(1, Math.min(8, current + (action === "parallel-plus" ? 1 : -1)));
    await api("/api/settings", { method: "POST", body: JSON.stringify({ maxConcurrent }) });
    await refresh();
    return true;
  }
  if (action === "select-skill") {
    view.selectedSkillId = id || ""; view.skillEditing = false; view.skillEditingId = "";
    if (view.selectedSkillId) void ensureSkillDetail(view.selectedSkillId);
    render(); return true;
  }
  if (action === "start-inline-skill-edit") {
    const detail = await ensureSkillDetail(id);
    if (detail) {
      view.selectedSkillId = id; view.skillEditing = true; view.skillEditingId = id; view.skillDraft = detail.content || "";
      render();
    }
    return true;
  }
  if (action === "cancel-inline-skill-edit") {
    view.skillEditing = false; view.skillEditingId = ""; view.skillDraft = ""; render(); return true;
  }
  if (action === "save-inline-skill") {
    const editorEl = document.querySelector("[data-skill-inline-editor]");
    const content = editorEl ? editorEl.value : (view.skillDraft ?? "");
    if (id && content.trim()) {
      await api(`/api/skills/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ content }) });
      if (view.skillDetailsCache) delete view.skillDetailsCache[id];
      view.skillEditing = false; view.skillEditingId = "";
      await ensureSkillDetail(id); render(); showToast("Đã lưu thay đổi SKILL.md.");
    }
    return true;
  }
  if (action === "memory-scope-filter") { view.memoryWorkspaceFilter = button.dataset.scope || "all"; render(); return true; }
  if (action === "settings-scroll-section") {
    const secId = button.dataset.section || "";
    const secEl = secId ? document.getElementById(secId) : null;
    secEl?.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }
  if (action === "open-project-folder") { await api(`/api/workspaces/${encodeURIComponent(id)}/open`, { method: "POST" }); showToast("Đã mở thư mục dự án trong Explorer."); return true; }
  if (action === "toggle-project-pin") {
    const workspace = view.state.workspaces.find((item) => item.id === id);
    if (workspace) { await api(`/api/workspaces/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ pinned: !workspace.pinned }) }); view.projectMenuId = ""; await refresh(); }
    return true;
  }
  if (action === "archive-workspace-chats") {
    const result = await api(`/api/workspaces/${encodeURIComponent(id)}/archive-chats`, { method: "POST" });
    view.projectMenuId = ""; await refresh(); showToast(`${result.archived} chat đã chuyển vào Đã lưu trữ.`);
    return true;
  }
  if (action === "open-workspace") { await loadWorkspaceDir(id, ""); return true; }
  if (action === "back-projects") { view.workspaceOverviewMode = true; view.activeStageTabId = "chat"; view.page = "workspaces"; render(); return true; }
  if (action === "workspace-dir") { await loadWorkspaceDir(view.selected, button.dataset.path || ""); return true; }
  if (action === "workspace-up") { const parent = view.workspaceDir.split("/").filter(Boolean).slice(0, -1).join("/"); await loadWorkspaceDir(view.selected, parent); return true; }
  if (action === "workspace-file-action") {
    const entry = view.workspaceEntries.find((item) => item.path === button.dataset.path);
    if (entry?.type === "directory") await loadWorkspaceDir(view.selected, entry.path);
    else if (entry) {
      await Promise.all([
        loadWorkspacePreview(view.selected, entry.path),
        openStageFileTab({ workspaceId: view.selected, taskId: "", path: entry.path }),
      ]);
    }
    return true;
  }
  if (action === "refresh-project-files") { await loadWorkspaceDir(view.selected, view.workspaceDir); return true; }
  if (action === "vault-dir") { await loadVaultDir(button.dataset.path || ""); return true; }
  if (action === "vault-up") { const parent = view.vaultDir.split("/").filter(Boolean).slice(0, -1).join("/"); await loadVaultDir(parent); return true; }
  if (action === "vault-file-action") {
    const entry = view.vaultEntries.find((item) => item.path === button.dataset.path);
    if (entry?.type === "directory") await loadVaultDir(entry.path);
    else if (entry) await loadVaultPreview(entry.path);
    return true;
  }
  if (action === "refresh-vault-files") { await loadVaultDir(view.vaultDir, { keepPreview: true }); return true; }
  if (action === "toggle-vault-left") { view.vaultLeftOpen = view.vaultLeftOpen === false ? true : false; render(); return true; }
  if (action === "toggle-vault-right") { view.vaultRightOpen = view.vaultRightOpen === false ? true : false; render(); return true; }
  if (action === "vault-filter-tag") {
    const tag = button.dataset.tag || "";
    view.vaultFilter = view.vaultFilter === tag ? "" : tag;
    if (view.vaultLeftOpen === false) view.vaultLeftOpen = true;
    render(); return true;
  }
  if (action === "vault-scroll-heading") {
    const idx = button.dataset.headingIndex;
    const headingEl = document.querySelector(`[data-kb-heading="${CSS.escape(String(idx))}"]`);
    headingEl?.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }
  if (action === "vault-mode") {
    view.vaultViewMode = button.dataset.mode || "files";
    if (view.vaultViewMode === "graph" && !view.vaultGraph) await loadVaultGraph();
    else render();
    return true;
  }
  if (action === "refresh-vault-graph") { await loadVaultGraph(); return true; }
  if (action === "neural-graph-reset") {
    const canvas = document.getElementById("vault-neural-canvas");
    if (canvas?._resetCamera) canvas._resetCamera();
    return true;
  }
  if (action === "vault-select-graph-node") { if (button.dataset.path) await loadVaultPreview(button.dataset.path); return true; }
  if (action === "vault-open-from-graph") {
    view.vaultViewMode = "files";
    if (button.dataset.path) await loadVaultPreview(button.dataset.path);
    else render();
    return true;
  }
  if (action === "vault-focus-graph") {
    view.vaultViewMode = "graph";
    if (button.dataset.path) await loadVaultPreview(button.dataset.path);
    if (!view.vaultGraph) await loadVaultGraph();
    else render();
    return true;
  }
  if (action === "vault-edit-from-graph") {
    view.vaultViewMode = "files";
    if (button.dataset.path) await loadVaultPreview(button.dataset.path, { startEdit: true });
    return true;
  }
  if (action === "vault-new-note") { showNewVaultNoteModal(); return true; }
  if (action === "vault-edit-note") {
    view.vaultViewMode = "files";
    const path = button.dataset.path || view.vaultPreview?.path;
    if (path) await loadVaultPreview(path, { startEdit: true });
    return true;
  }
  if (action === "vault-cancel-edit") {
    view.vaultEditing = false; view.vaultEditingPath = ""; view.vaultDraft = view.vaultPreview?.content || ""; render(); return true;
  }
  if (action === "vault-save-note") {
    const path = button.dataset.path || view.vaultEditingPath || view.vaultPreview?.path;
    const editorEl = document.querySelector("[data-vault-editor]");
    const content = editorEl ? editorEl.value : (view.vaultDraft ?? "");
    if (path) {
      const saved = await api("/api/vault/file", { method: "PUT", body: JSON.stringify({ path, content }) });
      view.vaultPreview = saved; view.vaultEditing = false; view.vaultEditingPath = ""; view.vaultDraft = saved.content;
      await loadVaultDir(view.vaultDir, { keepPreview: true });
      showToast("Đã lưu ghi chú tri thức.");
    }
    return true;
  }
  if (action === "vault-delete-note") {
    const path = button.dataset.path || view.vaultPreview?.path;
    if (path && confirm(`Xóa vĩnh viễn tệp ghi chú “${path}” khỏi Obsidian vault?`)) {
      await api(`/api/vault/file?path=${encodeURIComponent(path)}`, { method: "DELETE" });
      if (view.vaultPreview?.path === path) { view.vaultPreview = null; view.vaultEditing = false; view.vaultEditingPath = ""; }
      await loadVaultDir(view.vaultDir, { keepPreview: true });
      showToast("Đã xóa tệp ghi chú khỏi vault.");
    }
    return true;
  }
  if (action === "vault-open-wikilink") {
    const target = (button.dataset.target || "").trim();
    if (target) {
      const nodes = view.vaultGraph?.nodes || [];
      const lower = target.toLowerCase().replace(/\.(md|mdx|markdown)$/i, "");
      const match = nodes.find((n) => n.path.toLowerCase() === target.toLowerCase() || n.path.replace(/\.(md|mdx|markdown)$/i, "").toLowerCase() === lower || n.stem.toLowerCase() === lower.split("/").at(-1));
      if (match) {
        await loadVaultPreview(match.path);
      } else {
        const candidatePath = /\.(md|mdx|markdown)$/i.test(target) ? target : `${target}.md`;
        try {
          await loadVaultPreview(candidatePath);
        } catch {
          if (confirm(`Ghi chú “${candidatePath}” chưa tồn tại. Tạo mới ngay?`)) {
            const created = await api("/api/vault/file", { method: "POST", body: JSON.stringify({ path: candidatePath, content: `# ${target.replace(/\.(md|mdx|markdown)$/i, "")}\n\n`, createOnly: true }) });
            await loadVaultDir(view.vaultDir, { keepPreview: true });
            view.vaultPreview = created; view.vaultEditing = true; view.vaultEditingPath = created.path; view.vaultDraft = created.content; render();
          }
        }
      }
    }
    return true;
  }
  if (action === "open-obsidian") {
    await api("/api/vault/open-obsidian", { method: "POST", body: JSON.stringify({ path: button.dataset.path || view.vaultPreview?.path || "" }) });
    showToast("Đang mở trong ứng dụng Obsidian…");
    return true;
  }
  if (action === "copy-skill") {
    const skill = view.skills.find((item) => item.id === id);
    const scope = defaultSkillScope(skill?.providers || []);
    await api(`/api/skills/${encodeURIComponent(id)}/copy`, { method: "POST", body: JSON.stringify({ scope }) });
    closeOverlay();
    view.skillsLoaded = false; await refresh();
    const result = await api("/api/skills"); view.skills = result.skills || []; view.skillsLoaded = true; render();
    showToast("Đã sao chép thành skill cá nhân để chỉnh sửa.");
    return true;
  }
  if (action === "delete-skill") {
    const skill = view.skills.find((item) => item.id === id);
    if (confirm(`Xóa skill “${skill?.name || id}” khỏi thư mục cá nhân? Nếu có bản plugin trùng, bản plugin vẫn được giữ.`)) {
      const result = await api(`/api/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
      closeOverlay();
      view.skillsLoaded = false; await refresh();
      const catalog = await api("/api/skills"); view.skills = catalog.skills || []; view.skillsLoaded = true; render();
      showToast(result.readonlySourcesRemain ? "Đã xóa bản cá nhân; bản plugin chỉ đọc vẫn còn." : "Đã xóa skill cá nhân.");
    }
    return true;
  }
  if (action === "remove-workspace") {
    if (confirm("Gỡ dự án khỏi OpenSybau? Thư mục và tệp trên máy sẽ không bị xóa.")) {
      await api(`/api/workspaces/${encodeURIComponent(id)}`, { method: "DELETE" });
      view.projectMenuId = "";
      if (view.homeWorkspaceId === id) view.homeWorkspaceId = "";
      if (view.page === "workspaces" && view.selected === id) {
        view.selected = null; view.workspaceDir = ""; view.workspaceEntries = []; view.workspaceLoadedKey = ""; view.filePreview = null;
      }
      await refresh();
    }
    return true;
  }
  if (action === "delete-memory") {
    if (confirm("Xóa ghi nhớ này?")) { await api(`/api/memory/${encodeURIComponent(id)}`, { method: "DELETE" }); await refresh(); }
    return true;
  }
  return false;
}
