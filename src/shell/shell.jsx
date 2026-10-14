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
  const branch = task?.isolated
    ? (task.worktreeBranch || "worktree")
    : workspace?.runtime?.isGit ? (workspace.runtime.branch || "HEAD") : "";
  const runningCount = Number(telemetry.runningCount || 0);
  const queuedCount = Number(telemetry.queuedCount || 0);
  const worktreeCount = Number(telemetry.worktreeCount || 0);
  const tokens5h = Number(telemetry.tokens5h || 0);
  const tokens7d = Number(telemetry.tokens7d || 0);
  const connected = snapshot.streamConnected !== false;

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
      {branch ? <span class="wb-status-item wb-status-branch" title={`Nhánh Git: ${branch}`}>
        <Icon name="git-branch" size={12} />
        <span>{branch}</span>
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
      <span class="wb-status-item wb-status-quota" title={`Tổng token tiêu thụ cục bộ — 5 giờ qua: ${formatNumber(tokens5h)} · 7 ngày qua: ${formatNumber(tokens7d)}`}>
        <span>5h: <strong>{formatNumber(tokens5h)}</strong> tok</span>
        <span class="wb-status-sep">·</span>
        <span>7d: <strong>{formatNumber(tokens7d)}</strong> tok</span>
      </span>
    </div>
  </footer>;
}

export function AppShell({ snapshot, pageMarkup }) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const page = snapshot.page || "chat";
  const home = page === "chat" && !snapshot.selected;
  const hasContextSidebar = pageLayouts[page]?.sidebar === "context";
  const hasPageSidebar = Boolean(snapshot.pageSidebarMarkup);
  const shellClasses = ["wb-app-shell", hasContextSidebar && "has-context-sidebar", hasPageSidebar && "has-page-sidebar", hasContextSidebar && hasPageSidebar && "has-both-sidebars"].filter(Boolean).join(" ");
  useEffect(() => { setMobileSidebarOpen(false); }, [page, snapshot.selected]);
  return <div class={shellClasses}>
    <NavRail page={page} snapshot={snapshot} />
    <ContextSidebar snapshot={snapshot} mobileOpen={mobileSidebarOpen} mobileOnly={!hasContextSidebar} onNavigate={() => setMobileSidebarOpen(false)} />
    {mobileSidebarOpen ? <button class="wb-mobile-sidebar-backdrop" type="button" aria-label="Đóng danh sách workspace" onClick={() => setMobileSidebarOpen(false)} /> : null}
    {hasPageSidebar && <aside class="wb-page-sidebar" dangerouslySetInnerHTML={{ __html: snapshot.pageSidebarMarkup }} />}
    <main class="wb-main">
      <TopBar snapshot={snapshot} onOpenNavigation={() => setMobileSidebarOpen(true)} />
      <section id="content" class={`content wb-page-content ${home ? "is-home" : ""} ${page === "chat" && snapshot.selected ? "is-task-detail" : ""}`} dangerouslySetInnerHTML={{ __html: pageMarkup }} />
      <StatusBar snapshot={snapshot} />
    </main>
    <MobileNav page={page} />
    {snapshot.desktopSetupOpen && <DesktopSetupDialog connectors={snapshot.connectors} />}
  </div>;
}
