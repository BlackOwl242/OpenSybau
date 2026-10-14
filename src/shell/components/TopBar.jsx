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

  const siblingTasks = task
    ? (task.fanoutId
      ? (snapshot.state?.tasks || []).filter((item) => item.fanoutId === task.fanoutId && !item.archived)
      : (snapshot.state?.tasks || [])
          .filter((item) => item.workspaceId === task.workspaceId && !item.archived)
          .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
          .slice(0, 5))
    : [];
  if (task && !siblingTasks.some((item) => item.id === task.id)) siblingTasks.unshift(task);

  return <header class="wb-topbar">
    <div class="wb-topbar-leading">
      <button class="wb-mobile-menu-button" type="button" onClick={onOpenNavigation} aria-label="Mở workspace và cuộc trò chuyện" title="Workspace và chat" />
      {task ? <div class="wb-task-heading" title={task.title}>
        <span>
          <Icon name="folder-code" size={13} />
          {workspace?.name || task.workspacePath}
          {task.isolated ? <em class="wb-top-wt-pill">{task.worktreeBranch || "worktree"}</em> : workspace?.runtime?.branch ? <em class="wb-top-branch-pill">{workspace.runtime.branch}</em> : null}
        </span>
        <strong>{task.title}</strong>
      </div> : <div class="wb-breadcrumb">
        <span>OpenSybau</span>
        <Icon name="chevron-right" size={13} />
        <strong>{title}</strong>
        {workspace ? <><Icon name="chevron-right" size={13} /><span>{workspace.name}</span></> : null}
      </div>}
      {task && siblingTasks.length > 1 ? <nav class="wb-topbar-tabs" aria-label="Phiên làm việc trong dự án">
        {siblingTasks.map((item) => {
          const badge = item.fanoutCompetitor?.name || item.config?.chatProvider || item.config?.roles?.plan?.provider || "agent";
          return <button
            key={item.id}
            type="button"
            class={`wb-topbar-tab ${item.id === task.id ? "is-active" : ""}`}
            data-task={item.id}
            title={`${item.title} (${badge})`}
          >
            <span class={`wb-task-dot is-${item.status || "done"}`} />
            <span class="wb-topbar-tab-title">{item.fanoutId && item.fanoutCompetitor?.name ? item.fanoutCompetitor.name : item.title}</span>
          </button>;
        })}
        <button type="button" class="wb-topbar-tab wb-topbar-tab-add" data-action="new-chat" data-workspace-id={task.workspaceId} title="Phiên mới trong dự án" aria-label="Phiên mới">
          <Icon name="plus" size={13} />
        </button>
      </nav> : null}
    </div>
    <div class="wb-top-actions">
      {task ? <>
        <button class="wb-top-icon" type="button" data-action="open-task-flow" data-id={task.id} title="Bản ghi điều phối" aria-label="Mở bản ghi điều phối"><Icon name="workflow" size={16} /></button>
        <button class="wb-top-icon" type="button" data-action="open-folder" data-id={task.id} title="Mở thư mục workspace" aria-label="Mở thư mục workspace"><Icon name="folder-code" size={16} /></button>
      </> : null}
      {!dockOpen ? (
        <button class="wb-top-icon" type="button" data-action="toggle-chat-drawer" title="Mở thanh bên phải" aria-label="Mở thanh bên phải">
          <Icon name="sidebar-right" size={16} />
        </button>
      ) : null}
    </div>
  </header>;
}
