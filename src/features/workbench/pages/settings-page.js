import { $, esc, icon, view } from "../../../shared/state.js";
import { providersForRole, roleConfig, workflowRoles } from "../../../domain/agent-roles.js";
import { cliConnectionStatus, cliProviderGuides } from "../../../domain/provider-guides.js";
import { getActiveRemoteHost, isMobileCompanionMode } from "../../../shared/remote-host.js";
import { THEMES, THEME_GROUPS, getThemeDefinition } from "../../../shared/themes.js";
import { renderDeviceConnectSettingsSection } from "../device-connect.js";
import { cliRefreshButton, showModal } from "../runtime.js";
import { homeSelectField, roleEditor } from "../ui-controls.js";

export const SETTINGS_NAV_ITEMS = [
  { id: "all", label: "Tất cả cài đặt", mobileLabel: "Tất cả", icon: "sliders-horizontal", keywords: "" },
  {
    id: "theme",
    label: "Giao diện",
    mobileLabel: "Giao diện",
    icon: "sun",
    keywords: "giao diện chủ đề màu sắc theme appearance color dark light tối sáng đa sắc obsidian carbon cosmic indigo tokyo night synthwave catppuccin emerald rose pine amber nordic daylight editorial sakura",
  },
  {
    id: "roles",
    label: "Chọn model AI",
    mobileLabel: "Model AI",
    icon: "workflow",
    keywords: "chọn model ai phân vai vai trò lên kế hoạch viết code kiểm tra code plan build review mặc định suy luận reasoning effort",
  },
  {
    id: "cli",
    label: "Công cụ CLI",
    mobileLabel: "CLI",
    icon: "square-terminal",
    keywords: "công cụ cli trên máy local cli tools codex antigravity agy claude code đăng nhập terminal cài đặt quét lại",
  },
  {
    id: "api",
    label: "Kết nối API",
    mobileLabel: "Kết nối API",
    icon: "plug-zap",
    keywords: "kết nối api model cục bộ local openai chatgpt google gemini claude anthropic ollama lm studio endpoint khóa api key nguồn",
  },
  {
    id: "devices",
    label: "Kết nối điện thoại",
    mobileLabel: "Điện thoại",
    icon: "smartphone",
    keywords: "kết nối điện thoại thiết bị từ xa android apk mạng nội bộ lan wifi tailscale mã qr mật khẩu ghép nối ip máy tính",
  },
  {
    id: "concurrency",
    label: "Hiệu năng",
    mobileLabel: "Hiệu năng",
    icon: "layers",
    keywords: "hiệu năng số công việc chạy cùng lúc tác vụ đồng thời song song concurrency parallel giới hạn limit",
  },
];

export function matchesSettingsSection(sectionId, rawQuery, cardElement = null) {
  const query = String(rawQuery || "").trim().toLocaleLowerCase();
  if (!query) return true;
  const item = SETTINGS_NAV_ITEMS.find((entry) => entry.id === sectionId);
  if (item && (item.label.toLocaleLowerCase().includes(query) || (item.keywords || "").includes(query))) {
    return true;
  }
  if (cardElement && cardElement.textContent?.toLocaleLowerCase().includes(query)) {
    return true;
  }
  return false;
}

export function applySettingsSearch(rawQuery) {
  view.settingsSearchQuery = String(rawQuery ?? "");
  const query = view.settingsSearchQuery.trim().toLocaleLowerCase();
  const activeSection = view.settingsSection || "all";
  let matchedCount = 0;

  document.querySelectorAll(".settings-card[data-settings-section]").forEach((card) => {
    const sectionId = card.dataset.settingsSection || "";
    const matched = matchesSettingsSection(sectionId, query, card);
    if (matched) matchedCount++;
    card.hidden = query ? !matched : (activeSection !== "all" && activeSection !== sectionId);
  });

  document.querySelectorAll("[data-action='settings-nav'][data-section]").forEach((btn) => {
    const sectionId = btn.dataset.section || "";
    if (!query || sectionId === "all") {
      btn.hidden = false;
      return;
    }
    const card = document.querySelector(`.settings-card[data-settings-section="${sectionId}"]`);
    btn.hidden = !matchesSettingsSection(sectionId, query, card);
  });

  const empty = document.querySelector("[data-settings-search-empty]");
  if (empty) empty.hidden = !query || matchedCount > 0;
}

export function settingsSidebarMarkup() {
  const activeSection = view.settingsSection || "all";
  const searchQuery = view.settingsSearchQuery || "";
  const hasQuery = Boolean(searchQuery.trim());
  const isMobile = isMobileCompanionMode();
  return `<header class="wb-sidebar-header">
    <button type="button" class="wb-sidebar-brand" data-page="chat">
      <strong>OpenSybau</strong>
      ${icon("chevron-down", 13)}
    </button>
    <div class="wb-sidebar-header-actions">
      <button class="wb-sidebar-icon-btn" type="button" data-action="toggle-sidebar-search" title="Tìm kiếm cài đặt" aria-label="Tìm kiếm cài đặt">
        ${icon("search", 15)}
      </button>
    </div>
  </header>
  <label class="wb-sidebar-search" ${hasQuery || view.settingsSearchOpen ? 'data-open="true"' : ""}>
    ${icon("search", 14)}
    <input data-settings-search value="${esc(searchQuery)}" placeholder="Tìm cài đặt…" autocomplete="off" aria-label="Tìm kiếm cài đặt">
  </label>
  <div class="wb-side-scroll wb-settings-sidebar">
    <section class="wb-side-section wb-settings-group">
      <div class="wb-side-heading"><span>Danh mục</span></div>
      <div class="wb-settings-nav-list" role="navigation" aria-label="Danh mục cài đặt">
        ${SETTINGS_NAV_ITEMS.map((item) => {
          const hiddenAttr = hasQuery && item.id !== "all" && !matchesSettingsSection(item.id, searchQuery) ? "hidden" : "";
          const navLabel = isMobile && item.id === "devices" ? "Kết nối máy tính" : item.label;
          const navIcon = isMobile && item.id === "devices" ? "laptop" : item.icon;
          return `<button type="button" class="wb-side-link wb-settings-side-link ${activeSection === item.id ? "is-active" : ""}" data-action="settings-nav" data-section="${esc(item.id)}" aria-current="${activeSection === item.id ? "true" : "false"}" ${hiddenAttr}>
            <span class="wb-side-link-main">${icon(navIcon, 16)}<span>${esc(navLabel)}</span></span>
          </button>`;
        }).join("")}
      </div>
    </section>
  </div>`;
}

function formatInlineReset(isoTime) {
  if (!isoTime) return "";
  const diffMs = Date.parse(isoTime) - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "sắp đặt lại";
  const totalMins = Math.max(1, Math.round(diffMs / 60_000));
  if (totalMins >= 1440) {
    const days = Math.floor(totalMins / 1440);
    const hours = Math.floor((totalMins % 1440) / 60);
    return `${days}n${hours ? ` ${hours}g` : ""}`;
  }
  if (totalMins >= 60) {
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return `${hours}g${mins ? ` ${mins}p` : ""}`;
  }
  return `${totalMins}p`;
}

function renderInlineQuotaWindow(win) {
  const used = Number(win.usedPercent || 0);
  const remaining = Number(win.remainingPercent ?? Math.max(0, 100 - used));
  const tone = used >= 90 ? "critical" : used >= 80 ? "warning" : "normal";
  const label = String(win.label || "").toLowerCase() === "5h" ? "5h" : String(win.label || "").toLowerCase() === "7d" ? "7 ngày" : win.label;
  const reset = formatInlineReset(win.resetsAt);
  return `<div class="wb-quota-window-row is-inline">
    <div class="wb-quota-window-meta">
      <span class="wb-quota-window-label"><b>${esc(label)}</b>${reset ? ` · <em class="wb-quota-reset">${esc(reset)}</em>` : ""}</span>
      <strong class="wb-quota-pct is-${tone}" data-localize-skip="true">${remaining}%</strong>
    </div>
    <div class="wb-quota-bar"><i class="wb-quota-fill is-${tone}" style="width:${Math.max(3, remaining)}%"></i></div>
  </div>`;
}

function renderCliQuotaDetails(providerId) {
  const q = view.quotas?.providers?.[providerId];
  if (!q || q.status !== "ok") return "";
  const hasGroups = Array.isArray(q.groups) && q.groups.length > 0;
  const hasWindows = Array.isArray(q.windows) && q.windows.length > 0;
  if (!hasGroups && !hasWindows) return "";
  const body = hasGroups
    ? `<div class="wb-quota-groups is-inline">${q.groups.map((g) => `<div class="wb-quota-group"><div class="wb-quota-group-title" data-localize-skip="true">${esc(g.name)}</div><div class="wb-quota-grid">${g.windows.map(renderInlineQuotaWindow).join("")}</div></div>`).join("")}</div>`
    : `<div class="wb-quota-grid is-inline">${q.windows.map(renderInlineQuotaWindow).join("")}</div>`;
  return `<div class="cli-quota-inline">${body}</div>`;
}

export function settingsPage() {
  const defaults = view.state?.settings?.defaults || {};
  const maxConcurrent = view.state?.settings?.maxConcurrent || 2;
  const isMobile = isMobileCompanionMode();
  const hasConnectedPc = Boolean(getActiveRemoteHost()?.url);
  const mobileDisconnected = isMobile && !hasConnectedPc;
  const canSaveRoles = workflowRoles.every((role) => providersForRole(view.connectors, role.id).length > 0);
  const apiSetup = (view.providers || []).map((provider) => `<div class="provider-setup-row"><span class="provider-status-dot ${provider.available ? "ready" : "missing"}"></span><div><strong>${esc(provider.name)}</strong><small>${provider.available ? `${provider.models.length} model · sẵn sàng${provider.apiKeyConfigured ? " · đã lưu khóa API" : ""}` : esc(provider.error || "Chưa đủ cấu hình")} · ${esc(provider.baseUrl)}</small></div><div class="provider-row-actions">${provider.managedBy === "local" ? `<button class="button quiet small" type="button" data-action="provider-edit" data-id="${esc(provider.id)}">Sửa</button><button class="button quiet small" type="button" data-action="provider-delete" data-id="${esc(provider.id)}">Xóa</button>` : `<button class="button quiet small" type="button" data-action="provider-import-env" data-id="${esc(provider.id)}">Quản lý trong app</button>`}</div></div>`).join("");
  const cliSetup = cliProviderGuides.map((agent) => {
    const connector = view.connectors?.[agent.id];
    const q = view.quotas?.providers?.[agent.id];
    const status = cliConnectionStatus(connector);
    const action = mobileDisconnected
      ? `<button class="button quiet small" type="button" data-action="settings-nav" data-section="devices">Kết nối máy tính</button>`
      : status.tone === "missing"
        ? window.opensybauDesktop?.supportsCliInstall
          ? `<button class="button quiet small" type="button" data-action="provider-cli-install" data-id="${esc(agent.id)}" ${view.cliInstallProvider ? "disabled" : ""}>${view.cliInstallProvider === agent.id ? "Đang cài đặt…" : "Cài CLI"}</button>`
          : `<a class="button quiet small" href="${esc(agent.url)}" target="_blank" rel="noreferrer">Hướng dẫn cài</a>`
        : status.tone === "ready"
          ? ""
          : status.action === "refresh"
            ? cliRefreshButton()
            : `<button class="button quiet small" type="button" data-action="provider-cli-login" data-id="${esc(agent.id)}">Mở terminal đăng nhập</button>`;
    const detail = mobileDisconnected
      ? "Chưa kết nối với máy tính (PC). Ghép nối với PC để đồng bộ CLI và hạn mức."
      : status.tone === "ready"
        ? `${q?.email ? `${q.email} · ` : ""}${connector.models.length} model`
        : status.tone === "missing" ? connector?.error || agent.installHelp : connector?.installed && connector?.error ? connector.error : agent.summary;
    const planBadge = q?.planType ? `<span class="wb-quota-plan-badge" data-localize-skip="true">${esc(q.planType)}</span>` : "";
    return `<article class="cli-guide-row ${status.tone === "ready" ? "is-ready" : ""}">
      <div class="cli-guide-copy">
        <div class="cli-guide-head">
          <div class="cli-guide-title">
            <span class="provider-status-dot ${status.tone === "ready" ? "ready" : "missing"}"></span>
            <strong>${esc(agent.name)}</strong>
            ${planBadge}
          </div>
          <small class="cli-guide-sub">${esc(detail)}</small>
        </div>
        ${renderCliQuotaDetails(agent.id)}
      </div>
      ${action ? `<div class="cli-guide-actions">${action}</div>` : ""}
    </article>`;
  }).join("");
  const noReadyConnector = !Object.values(view.connectors || {}).some((connector) => connector?.available && connector.capabilities?.plan);
  const activeTheme = getThemeDefinition(view.theme);
  const themeGroupsHtml = THEME_GROUPS.map((group) => {
    const groupThemes = THEMES.filter((item) => item.group === group.id);
    const cardsHtml = groupThemes.map((theme) => {
      const isActive = theme.id === activeTheme.id;
      const [bgHex, panelHex, accentHex, inkHex] = theme.swatches;
      return `<button type="button" class="theme-gallery-item ${isActive ? "is-active" : ""}" data-action="pick-theme" data-theme-id="${esc(theme.id)}" aria-pressed="${isActive ? "true" : "false"}">
        <div class="theme-preview-window" style="background:${bgHex};--tp-bg:${bgHex};--tp-panel:${panelHex};--tp-accent:${accentHex};--tp-ink:${inkHex}">
          <span class="theme-preview-rail" style="background:${panelHex}"><i style="background:${accentHex}"></i><i style="background:${inkHex};opacity:.35"></i><i style="background:${inkHex};opacity:.22"></i></span>
          <span class="theme-preview-stage" style="background:${bgHex}">
            <em class="theme-preview-bar" style="background:${inkHex};opacity:.55"></em>
            <em class="theme-preview-bubble" style="background:${panelHex};border-color:${accentHex}55"></em>
            <em class="theme-preview-composer" style="background:${panelHex}"><b style="background:${accentHex}"></b></em>
          </span>
        </div>
        <div class="theme-gallery-meta">
          <div class="theme-gallery-title-row">
            <strong>${esc(theme.label)}</strong>
          </div>
          <small>${esc(theme.description)}</small>
          <div class="theme-gallery-swatches">
            ${theme.swatches.map((hex) => `<i style="background-color:${hex};display:inline-block;width:14px;height:14px;border-radius:999px" title="${hex}"></i>`).join("")}
            <span class="theme-gallery-check">${isActive ? icon("check", 13) : ""}</span>
          </div>
        </div>
      </button>`;
    }).join("");
    return `<div class="theme-gallery-group">
      <div class="theme-gallery-group-head">
        <strong>${esc(group.label)}</strong>
        <small>${esc(group.description)}</small>
      </div>
      <div class="theme-gallery-grid">${cardsHtml}</div>
    </div>`;
  }).join("");

  const activeSection = view.settingsSection || "all";
  const searchQuery = (view.settingsSearchQuery || "").trim();
  const showSection = (id) => searchQuery ? matchesSettingsSection(id, searchQuery) : (activeSection === "all" || activeSection === id);
  const anyVisibleSection = SETTINGS_NAV_ITEMS.some((item) => item.id !== "all" && showSection(item.id));

  return `<div class="page-head">
    <div>
      <h1>Cài đặt</h1>
      <p>${isMobile ? "Tùy chỉnh giao diện, ghép nối với máy tính (PC) và quản lý nguồn AI trên máy chủ." : "Tùy chỉnh giao diện, chọn model AI mặc định và kết nối với điện thoại."}</p>
    </div>
    <div class="page-head-actions">
      ${cliRefreshButton("Quét lại", { small: false })}
      <button class="button primary" type="button" data-action="provider-add">${icon("plus", 15)} Thêm nguồn AI</button>
    </div>
  </div>
  <nav class="settings-nav-sidebar settings-mobile-nav" aria-label="Danh mục cài đặt">
    ${SETTINGS_NAV_ITEMS.map((item) => {
      const mobileTitle = isMobile && item.id === "devices" ? "Máy tính" : (item.mobileLabel || item.label);
      const mobileIcon = isMobile && item.id === "devices" ? "laptop" : item.icon;
      return `<button type="button" class="settings-nav-item ${activeSection === item.id ? "is-active" : ""}" data-action="settings-nav" data-section="${esc(item.id)}" aria-current="${activeSection === item.id ? "true" : "false"}">
      <span class="settings-nav-item-main">${icon(mobileIcon, 14)}<span>${esc(mobileTitle)}</span></span>
    </button>`;
    }).join("")}
  </nav>
  <form class="settings-form" data-modal data-form="settings">
    <section class="settings-card theme-gallery-card" id="settings-theme" data-settings-section="theme" ${showSection("theme") ? "" : "hidden"}>
      <header>
        <div>
          <h2>Giao diện & Chủ đề màu</h2>
          <p>Chuyển đổi tức thì giữa chủ đề Tối, Đa sắc và Sáng.</p>
        </div>
      </header>
      <div class="theme-gallery-groups">${themeGroupsHtml}</div>
    </section>
    <section class="settings-card" id="settings-roles" data-settings-section="roles" ${showSection("roles") ? "" : "hidden"}><header><div><h2>Chọn model AI cho từng việc</h2><p>Chọn AI mặc định phụ trách từng khâu: Lên kế hoạch, Viết code và Kiểm tra code.</p></div></header>
        ${mobileDisconnected
          ? `<div class="provider-connect-callout"><span class="provider-connect-icon">${icon("laptop", 17)}</span><div><strong>Chưa kết nối với máy tính (PC)</strong><p>Điện thoại là thiết bị điều khiển từ xa. Hãy kết nối với OpenSybau trên máy tính để tải danh sách model AI.</p></div><div><button class="button primary small" type="button" data-action="settings-nav" data-section="devices">Kết nối máy tính</button></div></div>`
          : noReadyConnector
            ? `<div class="provider-connect-callout"><span class="provider-connect-icon">${icon("plug-zap", 17)}</span><div><strong>Chưa kết nối nguồn AI nào</strong><p>Thêm API/model local hoặc cài, đăng nhập CLI để bắt đầu.</p></div><div><button class="button primary small" type="button" data-action="provider-add">Kết nối API</button><button class="button quiet small" type="button" data-action="provider-connect-cli">Kết nối CLI</button></div></div>`
            : ""}
      <div class="agent-role-grid settings-role-grid">${workflowRoles.map((role) => roleEditor(role.id, defaults.roles?.[role.id] || roleConfig(defaults, role.id))).join("")}</div>
      ${view.settingsSupported ? "" : `<div class="feature-warning">Server đang chạy phiên bản cũ. Hãy khởi động lại để lưu model mặc định.</div>`}
      <footer class="settings-actions"><button class="button primary" type="submit" ${view.settingsSupported && canSaveRoles ? "" : "disabled"}>Lưu model mặc định</button></footer>
    </section>
    <section class="settings-card cli-setup-card" id="cli-setup" data-settings-section="cli" ${showSection("cli") ? "" : "hidden"}><header><div><h2>Công cụ CLI & Hạn mức</h2><p>${isMobile ? "Trạng thái Codex, Antigravity, Claude Code và hạn mức tài khoản trên máy tính (PC) đang kết nối." : "Tự động nhận diện Codex, Antigravity, Claude Code và kiểm tra hạn mức tài khoản trên máy."}</p></div><div class="page-head-actions"><button class="button quiet small" type="button" data-action="refresh-quotas" ${view.quotasLoading ? "disabled" : ""}>${icon("refresh-cw", 13)} ${view.quotasLoading ? "Đang tải hạn mức..." : "Cập nhật hạn mức"}</button>${cliRefreshButton()}</div></header><div class="cli-guide-list">${cliSetup}</div></section>
    <section class="settings-card provider-setup-card" id="settings-api" data-settings-section="api" ${showSection("api") ? "" : "hidden"}><header><div><h2>Kết nối API & Model cục bộ</h2><p>Dùng thêm khóa API (OpenAI, Gemini, Claude) hoặc model chạy qua Ollama, LM Studio.</p></div><button class="button primary small" type="button" data-action="provider-add">${icon("plus", 14)} Thêm nguồn</button></header><div class="provider-setup-list">${apiSetup || `<div class="provider-empty-state"><strong>Chưa thêm nguồn API nào</strong><p>Bấm Thêm nguồn nếu bạn muốn dùng API key riêng hoặc kết nối Ollama / LM Studio.</p><button class="button quiet small" type="button" data-action="provider-add">${icon("plus", 13)} Thêm nguồn API</button></div>`}${view.connectors?.apiConfigurationError ? `<p class="provider-config-error">${esc(view.connectors.apiConfigurationError)}</p>` : ""}</div></section>
    ${renderDeviceConnectSettingsSection({ hidden: !showSection("devices") })}
    <section class="settings-card concurrency-card" id="settings-concurrency" data-settings-section="concurrency" ${showSection("concurrency") ? "" : "hidden"}><header><div><h2>Số công việc chạy cùng lúc</h2><p>${isMobile ? "Giới hạn số công việc AI được phép chạy song song trên máy tính (PC)." : "Giới hạn số công việc AI được phép chạy song song trên máy."}</p></div></header>
      <div class="concurrency-setting"><span>Giới hạn hiện tại</span><div><button type="button" data-action="parallel-minus" aria-label="Giảm task chạy đồng thời">−</button><strong id="parallel-value">${maxConcurrent}</strong><button type="button" data-action="parallel-plus" aria-label="Tăng task chạy đồng thời">+</button></div></div>
    </section>
    <section class="empty-state settings-search-empty" data-settings-search-empty ${searchQuery && !anyVisibleSection ? "" : "hidden"}>
      <div class="empty-symbol">${icon("search", 18)}</div>
      <strong>Không tìm thấy cài đặt phù hợp</strong>
      <p>Thử tìm theo tên mục như Giao diện, Model AI, CLI, API, Điện thoại hoặc Hiệu năng.</p>
    </section>
  </form>`;
}

export function showApiProviderModal(provider = null) {
  const editing = Boolean(provider);
  const models = (provider?.models || []).map((model) => model.id).join("\n");
  const protocolOptions = [
    { value: "openai", label: "OpenAI Responses API" },
    { value: "gemini", label: "Google Gemini API" },
    { value: "anthropic", label: "Anthropic Messages API" },
    { value: "openai-compatible", label: "OpenAI-compatible · Ollama, LM Studio…" },
  ];
  const currentProtocol = provider?.protocol || "openai-compatible";
  const sourceChoice = editing ? "" : `<section class="provider-cli-entry"><span class="provider-connect-icon">${icon("square-terminal", 16)}</span><div><strong>Dùng Codex, Antigravity hoặc Claude CLI?</strong><p>OpenSybau tự dò CLI đã cài và đăng nhập qua terminal, không cần nhập API key.</p></div><button class="button quiet small" type="button" data-action="provider-connect-cli">Kết nối CLI</button></section>`;
  const body = `${sourceChoice}<div class="provider-presets" aria-label="Cấu hình nhanh"><div class="provider-presets-head"><span>Chọn mẫu cấu hình nhanh</span></div><div><button type="button" class="button quiet small" data-action="provider-preset" data-preset="openai">OpenAI / ChatGPT</button><button type="button" class="button quiet small" data-action="provider-preset" data-preset="gemini">Google Gemini</button><button type="button" class="button quiet small" data-action="provider-preset" data-preset="anthropic">Claude API</button><button type="button" class="button quiet small" data-action="provider-preset" data-preset="local">Model local / khác</button></div></div><div class="modal-grid-2"><label>Tên hiển thị<input name="name" required maxlength="80" autocomplete="off" spellcheck="false" value="${esc(provider?.name || "")}" placeholder="Ví dụ: Ollama · Qwen local"></label>${homeSelectField("Giao thức", "protocol", "", protocolOptions, currentProtocol)}</div><label>API endpoint<input name="baseUrl" required maxlength="500" value="${esc(provider?.baseUrl || "")}" placeholder="http://localhost:11434/v1" autocomplete="url" spellcheck="false"><small>OpenAI-compatible: URL /v1 · Gemini: v1beta · HTTP chỉ dùng với localhost.</small></label><div class="provider-model-field"><label>Model ID<textarea name="models" required rows="3" spellcheck="false" placeholder="Chọn dịch vụ rồi bấm tải danh sách, hoặc nhập mỗi dòng một model ID">${esc(models)}</textarea></label><button class="button small" type="button" data-action="provider-discover-models">${icon("refresh-cw", 13)} Tải danh sách model</button></div>${editing ? `<input type="hidden" name="apiKeyRequired" value="${provider.apiKeyRequired ? "true" : "false"}">` : ""}<label>API key<input name="apiKey" type="password" maxlength="2048" autocomplete="new-password" spellcheck="false" placeholder="${editing && provider.apiKeyConfigured ? "Để trống để giữ key hiện tại" : "Nhập key của dịch vụ; model local có thể không cần"}"><small class="provider-key-help">Lấy khóa API: <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">OpenAI</a> · <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google Gemini</a> · <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">Anthropic Claude</a></small></label>${editing && provider.apiKeyConfigured ? `<label class="check-row"><input type="checkbox" name="clearApiKey" value="true"><span><strong>Xóa API key đã lưu</strong><small>Chỉ bật nếu muốn gỡ key khỏi cấu hình cục bộ.</small></span></label>` : ""}<p class="form-note">API key được lưu cục bộ trong thư mục dữ liệu riêng của OpenSybau; API OpenAI tính phí riêng với gói ChatGPT.</p>`;
  showModal(editing ? "Sửa nguồn AI" : "Thêm nguồn AI", body, editing ? "Lưu nguồn" : "Thêm nguồn", "api-provider");
  if (provider) $(".modal").dataset.id = provider.id;
}

export function showCliProviderModal() {
  const rows = cliProviderGuides.map((agent) => {
    const connector = view.connectors?.[agent.id];
    const status = cliConnectionStatus(connector);
    const modelCount = connector?.models?.length || 0;
    const detail = status.tone === "ready"
      ? `${modelCount} model khả dụng${connector?.version && connector.version !== "unavailable" ? ` · ${connector.version}` : ""}`
      : status.tone === "missing" ? agent.installHelp : connector?.error || agent.summary;
    const primary = status.tone === "missing"
      ? window.opensybauDesktop?.supportsCliInstall
        ? `<button class="button quiet small" type="button" data-action="provider-cli-install" data-id="${esc(agent.id)}">Cài CLI</button>`
        : `<a class="button quiet small" href="${esc(agent.url)}" target="_blank" rel="noreferrer">Hướng dẫn cài</a>`
      : status.action === "refresh"
        ? cliRefreshButton(status.tone === "ready" ? "Đã kết nối · quét lại" : "Quét lại")
        : `<button class="button primary small" type="button" data-action="provider-cli-login" data-id="${esc(agent.id)}">${icon("square-terminal", 13)} ${status.tone === "needs-action" && connector?.authenticated ? "Mở CLI để kiểm tra" : "Bắt đầu đăng nhập"}</button>`;
    const docsUrl = status.tone === "missing" ? agent.url : agent.authUrl || agent.url;
    const instructions = status.tone === "missing"
      ? `<div class="cli-connect-login"><span>Cài đặt CLI</span><small>${esc(agent.installHelp)}</small></div>`
      : status.tone !== "ready" && status.action === "refresh"
        ? `<div class="cli-connect-login"><span>Kiểm tra kết nối CLI</span><small>CLI đã có trên máy. Bấm Quét lại để thử đọc danh sách model.</small></div>`
        : `<div class="cli-connect-login"><span>Cách đăng nhập</span><code>${esc(agent.loginCommand)}</code><small>${esc(agent.loginHelp)}</small></div>`;
    return `<article class="cli-connect-card ${esc(status.tone)}"><header><span class="cli-connect-mark">${icon("square-terminal", 17)}</span><div><h3>${esc(agent.name)}</h3><span class="cli-guide-status ${esc(status.tone)}">${esc(status.label)}</span></div></header><p>${esc(detail)}</p>${instructions}<footer>${primary}<a href="${esc(docsUrl)}" target="_blank" rel="noreferrer">Tài liệu chính thức</a></footer></article>`;
  }).join("");
  const body = `<div class="cli-connect-intro"><span class="provider-connect-icon">${icon("workflow", 17)}</span><div><strong>OpenSybau tự dò CLI trên máy chủ</strong><p>CLI đã cài sẽ tự kết nối. Bấm Quét lại nếu vừa cài hoặc đăng nhập.</p></div>${cliRefreshButton()}</div><div class="cli-connect-list">${rows}</div><p class="cli-connect-feedback" role="status" aria-live="polite" hidden></p><p class="form-note">CLI dùng tài khoản riêng, không cần API key. Nếu bạn dùng OpenSybau từ điện thoại, terminal sẽ mở trên máy chủ; hoàn tất đăng nhập tại máy đó rồi bấm Quét lại.</p>`;
  showModal("Thêm / kết nối CLI agent", body, "Xong", "dismiss");
  $(".modal-actions .button.quiet")?.remove();
}

export function apiProviderId(name) {
  return String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}
