import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import { StableHtml } from "./components/StableHtml.jsx";
import { NavRail } from "./components/NavRail.jsx";
import { ContextSidebar } from "./components/ContextSidebar.jsx";
import { MobileNav } from "./components/MobileNav.jsx";
import { TopBar } from "./components/TopBar.jsx";
import { DesktopSetupDialog } from "./components/DesktopSetupDialog.jsx";
import { pageLayouts, pageTitles } from "./navigation.js";
import { Icon } from "../shared/ui/Icon.jsx";
import { formatNumber } from "../shared/i18n.js";
import { THEMES, THEME_GROUPS, getThemeDefinition } from "../shared/themes.js";
import { compactChatTitle } from "../shared/chat-labels.js";

function StatusBar({ snapshot }) {
  const state = snapshot.state;
  const telemetry = state?.telemetry || {};
  const task = snapshot.selected ? state?.tasks?.find((item) => item.id === snapshot.selected) : null;
  const workspace = task
    ? state?.workspaces?.find((item) => item.id === task.workspaceId)
    : state?.workspaces?.find((item) => item.id === snapshot.homeWorkspaceId) || state?.workspaces?.[0] || null;
  const runningCount = Number(telemetry.runningCount || 0);
  const queuedCount = Number(telemetry.queuedCount || 0);
  const worktreeCount = Number(telemetry.worktreeCount || 0);
  const tokens5h = Number(telemetry.tokens5h || 0);
  const tokens7d = Number(telemetry.tokens7d || 0);
  const usageProviders = [
    ["codex", "Codex CLI"],
    ["claude", "Claude Code"],
    ["antigravity", "Antigravity"],
  ];
  const connected = snapshot.streamConnected !== false;
  const english = snapshot.language === "en";

  return <footer class="wb-statusbar" aria-label="Trạng thái hệ thống và hạn mức">
    <div class="wb-status-left">
      {!connected ? <span class="wb-status-item wb-status-conn is-offline">
        <i class="wb-status-dot is-offline" />
        <span>Đang kết nối lại…</span>
      </span> : null}
      {workspace ? <span class="wb-status-item" title={workspace.path}>
        <Icon name="folder-code" size={12} />
        <span>{workspace.name}</span>
      </span> : null}
    </div>
    <div class="wb-status-right">
      <button type="button" class="wb-status-item wb-status-btn" data-page="tasks" title="Xem danh sách tác vụ">
        <span class={`wb-task-dot is-${runningCount > 0 ? "running" : queuedCount > 0 ? "queued" : "done"}`} />
        <span>{runningCount > 0 ? `${runningCount} agent đang chạy` : "0 đang chạy"}{queuedCount > 0 ? ` · ${queuedCount} chờ` : ""}</span>
      </button>
      {worktreeCount > 0 ? <span class="wb-status-item" title="Số Git worktree cô lập đang mở">
        <Icon name="git-branch" size={12} />
        <span>{worktreeCount} worktree</span>
      </span> : null}
      <details class="wb-status-usage">
      <summary class="wb-status-item wb-status-quota" title="Lượng token được OpenSybau ghi nhận theo CLI; không phải hạn mức hoặc số dư tài khoản">
        <span>5h: <strong>{formatNumber(tokens5h)}</strong> tok</span>
        <span class="wb-status-sep">·</span>
        <span>7d: <strong>{formatNumber(tokens7d)}</strong> tok</span>
      </summary>
      <div class="wb-usage-popover">
        <strong>{english ? "Usage by agent" : "Mức sử dụng theo agent"}</strong>
        <p>{english ? "Tokens recorded from runs in OpenSybau; account quotas are managed by each CLI/provider." : "Token ghi nhận từ các lượt chạy trong OpenSybau; hạn mức tài khoản do CLI/provider quản lý."}</p>
        {usageProviders.map(([id, name]) => {
          const usage = telemetry.byProvider?.[id] || {};
          return <div class="wb-usage-provider" key={id}><strong>{name}</strong><span>{english ? "5h" : "5 giờ"} <b>{formatNumber(usage.tokens5h || 0)}</b></span><span>{english ? "7d" : "7 ngày"} <b>{formatNumber(usage.tokens7d || 0)}</b></span><span>{english ? "Output" : "Đầu ra"} <b>{formatNumber(usage.outputTokens || 0)}</b></span></div>;
        })}
      </div>
      </details>
    </div>
  </footer>;
}

function WindowChrome({ snapshot, sidebarCollapsed, mobileSidebarOpen, onToggleSidebar }) {
  const desktop = typeof window !== "undefined" ? window.opensybauDesktop : null;
  const [updateState, setUpdateState] = useState(null);
  useEffect(() => {
    if (!desktop?.supportsAutoUpdate) return undefined;
    let active = true;
    const unsubscribe = desktop.onUpdateState((state) => { if (active) setUpdateState(state); });
    desktop.getUpdateState().then((state) => { if (active) setUpdateState(state); }).catch(() => {});
    return () => { active = false; unsubscribe?.(); };
  }, [desktop]);

  const page = snapshot.page || "chat";
  const task = page === "chat" && snapshot.selected
    ? snapshot.state?.tasks?.find((item) => item.id === snapshot.selected)
    : null;
  const workspace = task
    ? snapshot.state?.workspaces?.find((item) => item.id === task.workspaceId)
    : snapshot.state?.workspaces?.find((item) => item.id === snapshot.homeWorkspaceId) || snapshot.state?.workspaces?.[0] || null;
  const mobileTitle = task
    ? compactChatTitle(task)
    : pageTitles[page] || "OpenSybau";
  const mobileSubtitle = workspace && ["chat", "tasks", "flows", "workspaces"].includes(page)
    ? workspace.name
    : "";
  const supportsDock = page === "chat" || page === "workspaces" || page === "skills" || (page === "knowledge" && Boolean(snapshot.state?.settings?.vaultPath));
  const dockOpen = Boolean(supportsDock && snapshot.chatDrawerOpen && snapshot.rightDockMarkup);

  const activeTheme = getThemeDefinition(snapshot.theme);
  const updateDownloaded = updateState?.status === "downloaded";
  const updateBusy = ["checking", "available", "downloading"].includes(updateState?.status);
  const updateLabel = updateDownloaded
    ? snapshot.language === "en" ? "Restart to update" : "Khởi động lại để cập nhật"
    : updateState?.status === "downloading"
      ? `${updateState.percent || 0}%`
      : updateBusy
        ? "..."
        : snapshot.language === "en" ? "Update" : "Cập nhật";

  return <header class={`wb-window-chrome ${desktop ? "is-desktop" : "is-web"}`} aria-label="Thanh tiêu đề cửa sổ">
    <div class="wb-window-chrome-left">
      <button type="button" class="wb-chrome-icon wb-desktop-nav-btn" onClick={() => window.history.back()} title="Quay lại" aria-label="Quay lại">
        <Icon name="arrow-left" size={14} />
      </button>
      <button type="button" class="wb-chrome-icon wb-desktop-nav-btn" onClick={() => window.history.forward()} title="Tiến tới" aria-label="Tiến tới">
        <Icon name="arrow-right" size={14} />
      </button>
      <button
        type="button"
        class={`wb-chrome-icon wb-sidebar-toggle-btn ${!sidebarCollapsed || mobileSidebarOpen ? "is-active" : ""}`}
        onClick={onToggleSidebar}
        title="Đóng/mở thanh bên trái"
        aria-label="Đóng/mở thanh bên trái"
      >
        <Icon name="sidebar-left" size={15} />
      </button>
      <div class="wb-mobile-chrome-title">
        <strong data-localize-skip={task ? "true" : undefined}>{mobileTitle}</strong>
        {mobileSubtitle ? <small data-localize-skip="true">{mobileSubtitle}</small> : null}
      </div>
    </div>
    <div class="wb-window-chrome-right">
      {page === "chat" ? (
        <button
          type="button"
          class="wb-chrome-icon wb-mobile-only-btn"
          data-action="new-chat"
          title="Mở cuộc trò chuyện mới"
          aria-label="Mở cuộc trò chuyện mới"
        >
          <Icon name="plus" size={16} />
        </button>
      ) : null}
      <details class="codex-pop-menu is-down is-right wb-theme-menu">
        <summary class="wb-chrome-pill wb-theme-trigger" title="Đổi chủ đề màu sắc (Theme)">
          <span
            class="wb-theme-dot"
            style={{
              backgroundColor: activeTheme.swatches[2] || activeTheme.swatches[0],
              width: "8px",
              height: "8px",
              borderRadius: "999px",
              display: "inline-block",
              flexShrink: 0,
            }}
          />
          <span class="wb-theme-trigger-label">{activeTheme.label}</span>
        </summary>
        <div class="codex-pop-card wb-theme-pop-card">
          {THEME_GROUPS.map((group) => {
            const groupThemes = THEMES.filter((item) => item.group === group.id);
            return <div class="wb-theme-pop-group" key={group.id}>
              <div class="codex-pop-title">{group.label}</div>
              <div class="wb-theme-pop-grid">
                {groupThemes.map((theme) => {
                  const isActive = theme.id === activeTheme.id;
                  return <button
                    key={theme.id}
                    type="button"
                    class={`codex-pop-item wb-theme-pop-item ${isActive ? "is-active is-selected" : ""}`}
                    data-action="pick-theme"
                    data-theme-id={theme.id}
                    title={theme.description}
                  >
                    <span class="wb-theme-swatch-mini" aria-hidden="true">
                      {theme.swatches.map((hex, index) => (
                        <i
                          key={index}
                          style={{
                            backgroundColor: hex,
                            display: "block",
                            width: "100%",
                            height: "100%",
                            minWidth: "8px",
                            minHeight: "20px",
                          }}
                        />
                      ))}
                    </span>
                    <span class="wb-theme-pop-copy">
                      <strong>{theme.label}</strong>
                      <small>{theme.badge}</small>
                    </span>
                    <span class="codex-pop-check wb-theme-pop-check">{isActive ? <Icon name="check" size={13} /> : null}</span>
                  </button>;
                })}
              </div>
            </div>;
          })}
        </div>
      </details>
      <button class="wb-chrome-pill" type="button" data-action="toggle-language" title="Chuyển ngôn ngữ VI / EN">
        {snapshot.language === "en" ? "EN" : "VI"}
      </button>
      {supportsDock ? (
        <button
          type="button"
          class={`wb-chrome-icon wb-mobile-only-btn ${dockOpen ? "is-active" : ""}`}
          data-action="toggle-chat-drawer"
          title="Mở thanh công cụ bên phải"
          aria-label="Mở thanh công cụ bên phải"
        >
          <Icon name="sidebar-right" size={15} />
        </button>
      ) : null}
      {desktop?.supportsAutoUpdate ? (
        <button
          class={`wb-chrome-pill ${updateDownloaded ? "is-ready" : ""}`}
          type="button"
          data-action={updateDownloaded ? "app-update-restart" : "app-update-check"}
          disabled={updateBusy}
          title={updateState?.status === "error" ? updateState.error : "Kiểm tra bản cập nhật mới"}
        >
          <Icon name={updateDownloaded ? "rotate-cw" : "download-cloud"} size={12} />
          <span>{updateLabel}</span>
        </button>
      ) : null}
    </div>
  </header>;
}

export function AppShell({ snapshot, pageMarkup }) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const page = snapshot.page || "chat";
  const hasStageTabs = (page === "chat" || page === "workspaces") && (snapshot.stageTabs?.length || 0) > 0;
  const isViewingFileTab = hasStageTabs && (snapshot.activeStageTabId !== "chat" || snapshot.stageSplit);
  const chatSplit = page === "chat" && Boolean(snapshot.chatSplitWorkspaceId);
  const home = page === "chat" && !snapshot.selected && !isViewingFileTab && !chatSplit;
  const hasContextSidebar = pageLayouts[page]?.sidebar === "context" && !sidebarCollapsed;
  const hasPageSidebar = Boolean(snapshot.pageSidebarMarkup);
  const hasRightDock = Boolean(snapshot.chatDrawerOpen && snapshot.rightDockMarkup);
  const shellClasses = [
    "wb-app-shell",
    hasContextSidebar && "has-context-sidebar",
    hasPageSidebar && "has-page-sidebar",
    hasContextSidebar && hasPageSidebar && "has-both-sidebars",
    hasRightDock && "has-right-dock",
    sidebarCollapsed && "is-sidebar-collapsed",
  ].filter(Boolean).join(" ");
  useEffect(() => { setMobileSidebarOpen(false); }, [page, snapshot.selected]);
  return <div class={shellClasses}>
    <div class="wb-boot-splash" aria-hidden="true">
      <div class="wb-boot-logo-stage">
        <svg class="wb-boot-svg" viewBox="0 0 64 64" fill="none">
          <defs>
            <clipPath id="wbSplashLogoClip">
              <circle cx="19.6" cy="19.8" r="6.8" />
              <circle cx="44.4" cy="44.2" r="6.8" />
              <path d="M29.8 24.2C29.8 23.45 30.22 22.76 30.89 22.43L48.72 13.51C49.91 12.92 51.2 13.78 51.2 15.11V24.9C51.2 25.65 50.78 26.34 50.11 26.67L35.09 34.18C34.55 34.45 34.2 35 34.2 35.61V39.8C34.2 40.55 33.78 41.24 33.11 41.57L15.28 50.49C14.09 51.08 12.8 50.22 12.8 48.89V39.1C12.8 38.35 13.22 37.66 13.89 37.33L28.91 29.82C29.45 29.55 29.8 29 29.8 28.39V24.2Z" />
            </clipPath>
          </defs>
          <g class="wireframe">
            <circle cx="19.6" cy="19.8" r="6.1" />
            <circle cx="44.4" cy="44.2" r="6.1" />
            <path d="M29.8 24.2C29.8 23.45 30.22 22.76 30.89 22.43L48.72 13.51C49.91 12.92 51.2 13.78 51.2 15.11V24.9C51.2 25.65 50.78 26.34 50.11 26.67L35.09 34.18C34.55 34.45 34.2 35 34.2 35.61V39.8C34.2 40.55 33.78 41.24 33.11 41.57L15.28 50.49C14.09 51.08 12.8 50.22 12.8 48.89V39.1C12.8 38.35 13.22 37.66 13.89 37.33L28.91 29.82C29.45 29.55 29.8 29 29.8 28.39V24.2Z" />
          </g>
          <g clip-path="url(#wbSplashLogoClip)">
            <rect class="solid-fill-rect" x="-10" y="-10" width="84" height="84" fill="currentColor" />
          </g>
        </svg>
      </div>
      <div class="wb-boot-copy">
        <strong class="wb-boot-title">OpenSybau</strong>
        <span class="wb-boot-subtitle">Đang khởi động không gian làm việc…</span>
      </div>
    </div>
    <WindowChrome
      snapshot={snapshot}
      sidebarCollapsed={sidebarCollapsed}
      mobileSidebarOpen={mobileSidebarOpen}
      onToggleSidebar={() => {
        if (window.matchMedia("(max-width: 740px)").matches) setMobileSidebarOpen((prev) => !prev);
        else setSidebarCollapsed((prev) => !prev);
      }}
    />
    <NavRail page={page} snapshot={snapshot} />
    <ContextSidebar snapshot={snapshot} mobileOpen={mobileSidebarOpen} mobileOnly={!hasContextSidebar} onNavigate={() => setMobileSidebarOpen(false)} />
    {mobileSidebarOpen ? <button class="wb-mobile-sidebar-backdrop" type="button" aria-label="Đóng danh sách workspace" onClick={() => setMobileSidebarOpen(false)} /> : null}
    {hasPageSidebar && <aside class="wb-page-sidebar" dangerouslySetInnerHTML={{ __html: snapshot.pageSidebarMarkup }} />}
    <main class={`wb-main ${home && !hasStageTabs ? "is-home-stage" : ""} ${hasStageTabs || chatSplit ? "has-stage-tabs" : ""} ${chatSplit ? "is-chat-split" : ""}`}>
      <div class={`wb-workspace-split ${hasRightDock ? "has-right-dock" : ""}`}>
        <div class="wb-stage-column">
      <TopBar snapshot={snapshot} />
          <StableHtml id="content" class={`content wb-page-content ${home ? "is-home" : ""} ${(page === "chat" && snapshot.selected) || isViewingFileTab || chatSplit ? "is-task-detail" : ""} ${isViewingFileTab ? "is-orca-tab-stage" : ""} ${(page === "knowledge" && snapshot.state?.settings?.vaultPath) || page === "skills" ? "is-knowledge-detail" : ""}`} html={pageMarkup} background={snapshot.backgroundUpdate} scope={`${page}:${snapshot.chatSplitWorkspaceId || snapshot.selected || ""}`} />
        </div>
        {hasRightDock ? (
          <>
          <button class="wb-dock-backdrop" type="button" data-action="toggle-chat-drawer" aria-label="Đóng thanh bên phải" />
          <StableHtml as="aside"
            class="orca-right-dock"
            aria-label="Thanh công cụ mở rộng bên phải"
            html={snapshot.rightDockMarkup}
            background={snapshot.backgroundUpdate}
            scope={snapshot.homeWorkspaceId}
          />
          </>
        ) : null}
      </div>
      <StatusBar snapshot={snapshot} />
    </main>
    <MobileNav page={page} />
    {snapshot.desktopSetupOpen && <DesktopSetupDialog connectors={snapshot.connectors} installingProvider={snapshot.cliInstallProvider} />}
  </div>;
}
