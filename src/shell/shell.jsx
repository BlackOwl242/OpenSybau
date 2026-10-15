import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import { NavRail } from "./components/NavRail.jsx";
import { ContextSidebar } from "./components/ContextSidebar.jsx";
import { MobileNav } from "./components/MobileNav.jsx";
import { TopBar } from "./components/TopBar.jsx";
import { DesktopSetupDialog } from "./components/DesktopSetupDialog.jsx";
import { pageLayouts } from "./navigation.js";
import { Icon } from "../shared/ui/Icon.jsx";
import { formatNumber } from "../shared/i18n.js";

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
      <summary class="wb-status-item wb-status-quota" title="Usage token được OpenSybau ghi nhận theo CLI; không phải hạn mức hoặc số dư tài khoản">
        <span>5h: <strong>{formatNumber(tokens5h)}</strong> tok</span>
        <span class="wb-status-sep">·</span>
        <span>7d: <strong>{formatNumber(tokens7d)}</strong> tok</span>
      </summary>
      <div class="wb-usage-popover">
        <strong>{english ? "Usage by agent" : "Usage theo agent"}</strong>
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

function WindowChrome({ snapshot, sidebarCollapsed, onToggleSidebar }) {
  const desktop = typeof window !== "undefined" ? window.opensybauDesktop : null;
  const [updateState, setUpdateState] = useState(null);
  useEffect(() => {
    if (!desktop?.supportsAutoUpdate) return undefined;
    let active = true;
    const unsubscribe = desktop.onUpdateState((state) => { if (active) setUpdateState(state); });
    desktop.getUpdateState().then((state) => { if (active) setUpdateState(state); }).catch(() => {});
    return () => { active = false; unsubscribe?.(); };
  }, [desktop]);

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
      <button type="button" class="wb-chrome-icon" onClick={() => window.history.back()} title="Quay lại" aria-label="Quay lại">
        <Icon name="arrow-left" size={14} />
      </button>
      <button type="button" class="wb-chrome-icon" onClick={() => window.history.forward()} title="Tiến tới" aria-label="Tiến tới">
        <Icon name="arrow-right" size={14} />
      </button>
      <button
        type="button"
        class={`wb-chrome-icon ${!sidebarCollapsed ? "is-active" : ""}`}
        onClick={onToggleSidebar}
        title="Đóng/mở thanh bên trái"
        aria-label="Đóng/mở thanh bên trái"
      >
        <Icon name="sidebar-left" size={14} />
      </button>
    </div>
    <div class="wb-window-chrome-right">
      <button class="wb-chrome-pill" type="button" data-action="toggle-language" title="Chuyển ngôn ngữ VI / EN">
        {snapshot.language === "en" ? "EN" : "VI"}
      </button>
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
    <WindowChrome
      snapshot={snapshot}
      sidebarCollapsed={sidebarCollapsed}
      onToggleSidebar={() => {
        if (window.matchMedia("(max-width: 740px)").matches) setMobileSidebarOpen((prev) => !prev);
        else setSidebarCollapsed((prev) => !prev);
      }}
    />
    <NavRail page={page} snapshot={snapshot} />
    <ContextSidebar snapshot={snapshot} mobileOpen={mobileSidebarOpen} mobileOnly={!hasContextSidebar} onNavigate={() => setMobileSidebarOpen(false)} />
    {mobileSidebarOpen ? <button class="wb-mobile-sidebar-backdrop" type="button" aria-label="Đóng danh sách workspace" onClick={() => setMobileSidebarOpen(false)} /> : null}
    {hasPageSidebar && <aside class="wb-page-sidebar" dangerouslySetInnerHTML={{ __html: snapshot.pageSidebarMarkup }} />}
    <main class={`wb-main ${home && !hasStageTabs ? "is-home-stage" : ""} ${chatSplit ? "is-chat-split" : ""}`}>
      <div class={`wb-workspace-split ${hasRightDock ? "has-right-dock" : ""}`}>
        <div class="wb-stage-column">
      <TopBar snapshot={snapshot} />
          <section id="content" class={`content wb-page-content ${home ? "is-home" : ""} ${(page === "chat" && snapshot.selected) || isViewingFileTab || chatSplit ? "is-task-detail" : ""} ${isViewingFileTab ? "is-orca-tab-stage" : ""} ${(page === "knowledge" && snapshot.state?.settings?.vaultPath) || page === "skills" || (page === "workspaces" && (snapshot.selected || snapshot.state?.workspaces?.length)) ? "is-knowledge-detail" : ""}`} dangerouslySetInnerHTML={{ __html: pageMarkup }} />
        </div>
        {hasRightDock ? (
          <>
          <button class="wb-dock-backdrop" type="button" data-action="toggle-chat-drawer" aria-label="Đóng thanh bên phải" />
          <aside
            class="orca-right-dock"
            aria-label="Thanh công cụ mở rộng bên phải"
            dangerouslySetInnerHTML={{ __html: snapshot.rightDockMarkup }}
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
