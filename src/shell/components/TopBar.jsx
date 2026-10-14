import { h } from "preact";
import { pageTitles } from "../navigation.js";
import { Icon } from "../../shared/ui/Icon.jsx";

export function TopBar({ snapshot, onOpenNavigation = () => {} }) {
  const isHome = snapshot.page === "chat" && !snapshot.selected;
  const dockOpen = Boolean(snapshot.chatDrawerOpen);
  if (isHome) {
    return !dockOpen ? <div class="wb-home-dock-trigger">
      <button class="wb-top-icon" type="button" data-action="toggle-chat-drawer" title="Mở thanh bên phải" aria-label="Mở thanh bên phải">
        <Icon name="sidebar-right" size={16} />
      </button>
    </div> : null;
  }

  const title = pageTitles[snapshot.page] || "OpenSybau";
  const task = snapshot.page === "chat" && snapshot.selected
    ? snapshot.state?.tasks?.find((item) => item.id === snapshot.selected)
    : null;
  const workspace = task
    ? snapshot.state?.workspaces?.find((item) => item.id === task.workspaceId)
    : snapshot.page === "workspaces" && snapshot.selected
      ? snapshot.state?.workspaces?.find((item) => item.id === snapshot.selected)
      : null;

  return <header class="wb-topbar">
    <div class="wb-topbar-leading">
      <button class="wb-mobile-menu-button" type="button" onClick={onOpenNavigation} aria-label="Mở workspace và cuộc trò chuyện" title="Workspace và chat" />
      {task ? <div class="wb-breadcrumb wb-chat-breadcrumb" title={task.title}>
        <span>{workspace?.name || task.workspacePath}</span>
        {task.isolated ? <em class="wb-top-wt-pill">{task.worktreeBranch || "worktree"}</em> : workspace?.runtime?.branch ? <em class="wb-top-branch-pill">{workspace.runtime.branch}</em> : null}
        <Icon name="chevron-right" size={13} />
        <strong>{task.title}</strong>
      </div> : <div class="wb-breadcrumb">
        <span>OpenSybau</span>
        <Icon name="chevron-right" size={13} />
        <strong>{title}</strong>
        {workspace ? <><Icon name="chevron-right" size={13} /><span>{workspace.name}</span></> : null}
      </div>}
    </div>
    <div class="wb-top-actions">
      {!dockOpen ? (
        <button class="wb-top-icon" type="button" data-action="toggle-chat-drawer" title="Mở thanh bên phải" aria-label="Mở thanh bên phải">
          <Icon name="sidebar-right" size={16} />
        </button>
      ) : null}
    </div>
  </header>;
}

