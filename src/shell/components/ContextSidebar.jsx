import { h } from "preact";
import { Icon } from "../../shared/ui/Icon.jsx";

function TaskMenu({ task, archived = false }) {
  return <div class="wb-task-menu" role="menu" aria-label={`Thao tác với ${task.title}`}>
    <button role="menuitem" data-action="rename-task" data-id={task.id}><Icon name="square-pen" size={14} />Đổi tên</button>
    {!archived ? <button role="menuitem" data-action="toggle-task-pin" data-id={task.id}><Icon name="pin" size={14} />{task.pinned ? "Bỏ ghim" : "Ghim"}</button> : null}
    <button role="menuitem" data-action={archived ? "restore-task" : "archive-task"} data-id={task.id}><Icon name={archived ? "archive-restore" : "archive"} size={14} />{archived ? "Khôi phục" : "Lưu trữ"}</button>
    <button role="menuitem" data-action="copy-task-prompt" data-id={task.id}><Icon name="copy" size={14} />Sao chép yêu cầu</button>
    {archived ? <><div class="wb-task-menu-divider" /><button class="is-danger" role="menuitem" data-action="delete-chat" data-id={task.id}><Icon name="delete" size={14} />Xóa vĩnh viễn</button></> : null}
  </div>;
}

function fmtRelative(value) {
  if (!value) return "";
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (diffSec < 45) return "mới";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}p`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}g`;
  return `${Math.floor(diffSec / 86400)}n`;
}

function shortProviderLabel(id = "") {
  const clean = String(id || "").toLowerCase();
  if (clean === "codex") return "Codex";
  if (clean === "antigravity") return "Agy";
  if (clean === "claude") return "Claude";
  if (!clean) return "Agent";
  return clean.slice(0, 8);
}

function taskAgentLabel(task) {
  if (task.fanoutCompetitor?.name) return shortProviderLabel(task.fanoutCompetitor.provider || task.fanoutCompetitor.name);
  const wf = task.config?.workflow;
  if (wf === "chat-only") return shortProviderLabel(task.config?.chatProvider || "codex");
  const roleKey = task.phase === "implementation" ? "build" : (task.phase || "plan");
  const provider = task.config?.roles?.[roleKey]?.provider || task.config?.roles?.plan?.provider || "codex";
  return shortProviderLabel(provider);
}

function taskLiveSnippet(task) {
  if (task.status === "running") {
    const lastTool = [...(task.events || [])].reverse().find((ev) => ev.kind === "tool" || ev.kind === "stage");
    if (lastTool?.toolName) return `${lastTool.toolName}${lastTool.filePath ? ` · ${lastTool.filePath.split(/[\\/]/).pop()}` : ""}`;
    if (lastTool?.text) return String(lastTool.text).slice(0, 42);
    return "Đang thực thi…";
  }
  if (task.status === "queued") return "Đang chờ hàng đợi";
  if (task.status === "failed") return "Có lỗi cần kiểm tra";
  if (task.isolated && !task.worktreeCleaned && !task.worktreeAppliedAt && (task.artifacts?.length || 0) > 0) {
    return `${task.artifacts.length} tệp chờ gộp`;
  }
  if ((task.artifacts?.length || 0) > 0) {
    return `${task.artifacts.length} tệp thay đổi`;
  }
  return "";
}

function TaskLink({ task, selected, archived = false, taskMenuId = "", menuKey = task.id }) {
  const menuOpen = taskMenuId === menuKey;
  const agentLabel = taskAgentLabel(task);
  const snippet = taskLiveSnippet(task);
  const relTime = fmtRelative(task.updatedAt || task.createdAt);
  const needsReview = Boolean(task.isolated && task.status === "done" && !task.worktreeAppliedAt && !task.worktreeCleaned && (task.artifacts?.length || 0) > 0);

  return <div class={`wb-task-item ${selected === task.id ? "is-selected" : ""} ${archived ? "is-archived" : ""} is-status-${task.status || "done"}`}>
    <button class="wb-task-link" data-task={task.id} title={task.title} aria-current={selected === task.id ? "page" : undefined}>
      <span class={`wb-task-dot is-${task.status || "done"}`} aria-hidden="true" />
      <span class="wb-task-copy">
        <span class="wb-task-title-row">
          {task.pinned ? <Icon name="pin" size={11} /> : null}
          <strong>{task.title}</strong>
          {relTime ? <time class="wb-task-time">{relTime}</time> : null}
        </span>
        <span class="wb-task-sub">
          <span class="wb-agent-chip">{agentLabel}</span>
          {task.fanoutId ? <span class="wb-wt-badge is-arena" title="Đấu trường Agent">arena</span> : task.isolated ? <span class={`wb-wt-badge ${task.worktreeAppliedAt ? "is-merged" : ""}`} title={task.worktreeBranch || "Git Worktree"}>{task.worktreeAppliedAt ? "merged" : "wt"}</span> : null}
          {needsReview ? <span class="wb-wt-badge is-review" title="Worktree có thay đổi chờ gộp">review</span> : null}
          {snippet ? <span class="wb-task-snippet">{snippet}</span> : null}
        </span>
      </span>
    </button>
    <div class="wb-task-actions">
      {!archived ? <button class="wb-task-action" data-action="open-task-flow" data-id={task.id} title="Mở bản ghi điều phối" aria-label={`Mở bản ghi điều phối: ${task.title}`}><Icon name="workflow" size={16} /></button> : null}
      <button class="wb-task-action" data-action="toggle-task-menu" data-id={task.id} data-key={menuKey} aria-expanded={menuOpen} title="Thao tác chat" aria-label={`Thao tác chat ${task.title}`}><Icon name="ellipsis" size={16} /></button>
    </div>
    {menuOpen ? <TaskMenu task={task} archived={archived} /> : null}
  </div>;
}

function ProjectMenu({ workspace }) {
  return <div class="wb-project-menu" role="menu" aria-label={`Thao tác với ${workspace.name}`}>
    <button role="menuitem" data-action="toggle-project-pin" data-id={workspace.id}><Icon name="pin" size={14} />{workspace.pinned ? "Bỏ ghim" : "Ghim"}</button>
    <button role="menuitem" data-action="edit-project" data-id={workspace.id}><Icon name="settings-2" size={14} />Sửa dự án</button>
    <button role="menuitem" data-action="edit-project-section" data-id={workspace.id}><Icon name="list" size={14} />Section <Icon name="chevron-right" size={13} /></button>
    <button role="menuitem" data-action="open-project-folder" data-id={workspace.id}><Icon name="folder-open" size={14} />Mở trong Explorer</button>
    <button role="menuitem" data-action="archive-workspace-chats" data-id={workspace.id}><Icon name="archive" size={14} />Lưu trữ chat</button>
    <div class="wb-project-menu-divider" />
    <button class="is-danger" role="menuitem" data-action="remove-workspace" data-id={workspace.id}><Icon name="x" size={14} />Gỡ dự án</button>
  </div>;
}

function WorkspaceGroup({ workspace, tasks, selected, collapsedWorkspaces, projectMenuId, taskMenuId }) {
  const expanded = !collapsedWorkspaces.includes(workspace.id);
  const activeTasks = tasks.filter((task) => !task.archived);
  const runningCount = activeTasks.filter((task) => ["running", "queued"].includes(task.status)).length;
  const sortedTasks = [...activeTasks].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
  const sourceFolders = workspace.sourceFolders?.length ? workspace.sourceFolders : [workspace.path];
  const menuOpen = projectMenuId === workspace.id;
  const gitBranch = workspace.runtime?.isGit ? (workspace.runtime.branch || "HEAD") : "";

  return <section class={`wb-project-group ${menuOpen ? "has-menu-open" : ""}`} key={workspace.id}>
    <div class="wb-project-row">
      <button class="wb-project-toggle" data-action="toggle-workspace" data-id={workspace.id} title={workspace.path} aria-expanded={expanded}>
        <span class={`wb-project-chevron ${expanded ? "is-expanded" : ""}`}><Icon name="chevron-right" size={13} /></span>
        <Icon name="folder-code" size={15} />
        <strong>{workspace.name}</strong>
        {gitBranch ? <span class="wb-project-branch" title={`Nhánh Git: ${gitBranch}`}>{gitBranch}</span> : null}
        {runningCount > 0 ? <span class="wb-project-active-count" title={`${runningCount} tác vụ đang chạy`}>{runningCount}</span> : null}
        {workspace.pinned ? <Icon name="pin" size={12} /> : null}
      </button>
      <div class="wb-project-actions">
        <button class="wb-project-action" data-action="new-chat" data-workspace-id={workspace.id} title="Chat mới trong dự án" aria-label={`Chat mới trong ${workspace.name}`}><Icon name="plus" size={14} /></button>
        <button class="wb-project-action" data-action="edit-project" data-id={workspace.id} title="Sửa dự án" aria-label={`Sửa dự án ${workspace.name}`}><Icon name="square-pen" size={14} /></button>
        <button class="wb-project-action" data-action="toggle-project-menu" data-id={workspace.id} aria-expanded={menuOpen} title="Thao tác dự án" aria-label={`Thao tác dự án ${workspace.name}`}><Icon name="ellipsis" size={15} /></button>
      </div>
    </div>
    {menuOpen ? <ProjectMenu workspace={workspace} /> : null}
    <div class="wb-project-preview">
      <header><strong>{workspace.name}</strong>{workspace.pinned ? <Icon name="pin" size={13} /> : null}</header>
      <div><Icon name="message-circle" size={13} />{activeTasks.length} chat{gitBranch ? ` · ${gitBranch}` : ""}</div>
      <ul>{sourceFolders.map((path) => <li key={path}><Icon name="folder" size={13} /><span title={path}>{path}</span></li>)}</ul>
      <button data-action="edit-project" data-id={workspace.id}><Icon name="settings-2" size={13} />Sửa dự án</button>
    </div>
    {expanded ? <div class="wb-project-children">
      {sortedTasks.length ? sortedTasks.map((task) => <TaskLink key={task.id} task={task} selected={selected} taskMenuId={taskMenuId} menuKey={`workspace:${task.id}`} />) : <button class="wb-project-new-chat" data-action="new-chat" data-workspace-id={workspace.id}><Icon name="square-terminal" size={14} /><span>Cuộc trò chuyện mới</span></button>}
    </div> : null}
  </section>;
}

function SideContent({ snapshot }) {
  const state = snapshot.state;
  if (!state) return <div class="wb-side-placeholder">Đang đọc dữ liệu…</div>;

  const workspaces = state.workspaces || [];
  const tasks = state.tasks || [];
  const collapsedWorkspaces = snapshot.collapsedWorkspaces || [];
  const tasksByWorkspace = new Map();
  tasks.forEach((task) => {
    if (!tasksByWorkspace.has(task.workspaceId)) tasksByWorkspace.set(task.workspaceId, []);
    tasksByWorkspace.get(task.workspaceId).push(task);
  });
  const sections = new Map();
  [...workspaces]
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || a.name.localeCompare(b.name))
    .forEach((workspace) => {
      const section = workspace.section || "Projects";
      if (!sections.has(section)) sections.set(section, []);
      sections.get(section).push(workspace);
    });
  const recent = [...tasks].filter((task) => !task.archived)
    .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
    .slice(0, 12);
  const archived = [...tasks].filter((task) => task.archived)
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

  return <>
    <div class="wb-side-heading"><span>Workspace</span><button class="wb-small-icon" data-action="add-workspace" title="Thêm workspace" aria-label="Thêm workspace"><Icon name="plus" size={16} /></button></div>
    <div class="wb-side-list wb-workspace-list">
      {workspaces.length ? [...sections.entries()].map(([section, items]) => <div class="wb-project-section" key={section}>
        <div class="wb-project-section-title">{section}</div>
        {items.map((workspace) => <WorkspaceGroup
          key={workspace.id}
          workspace={workspace}
          tasks={tasksByWorkspace.get(workspace.id) || []}
          selected={snapshot.selected}
          collapsedWorkspaces={collapsedWorkspaces}
          projectMenuId={snapshot.projectMenuId}
          taskMenuId={snapshot.taskMenuId}
        />)}
      </div>) : <div class="wb-side-empty"><span>Chưa có workspace</span><button data-action="add-workspace">Thêm workspace</button></div>}
    </div>

    <div class="wb-side-heading wb-recent-heading"><span>Gần đây</span></div>
    <div class="wb-side-list wb-recent-list">
      {recent.length ? recent.map((task) => <TaskLink key={task.id} task={task} selected={snapshot.selected} taskMenuId={snapshot.taskMenuId} menuKey={`recent:${task.id}`} />) : <div class="wb-side-empty wb-recent-empty">Chưa có cuộc trò chuyện</div>}
    </div>
    {archived.length ? <>
      <div class="wb-side-heading wb-archived-heading"><span>Đã lưu trữ</span></div>
      <div class="wb-side-list wb-recent-list wb-archived-list">{archived.map((task) => <TaskLink key={task.id} task={task} selected={snapshot.selected} archived taskMenuId={snapshot.taskMenuId} menuKey={`archived:${task.id}`} />)}</div>
    </> : null}
  </>;
}

export function ContextSidebar({ snapshot, mobileOpen = false, mobileOnly = false, onNavigate = () => {} }) {
  return <aside class={`wb-context-sidebar ${mobileOnly ? "is-mobile-only" : ""} ${mobileOpen ? "is-mobile-open" : ""}`} aria-label="Workspace và cuộc trò chuyện" onClick={(event) => {
    if (event.target.closest("[data-page], [data-task], [data-action='new-chat'], [data-action='add-workspace'], [data-action='edit-project']")) onNavigate();
  }}>
    <header class="wb-sidebar-header"><strong>OpenSybau</strong><button class="wb-sidebar-close" type="button" onClick={onNavigate} aria-label="Đóng danh sách"><Icon name="x" size={18} /></button></header>
    <label class="wb-sidebar-search">
      <Icon name="search" size={16} />
      <input data-home-search value={snapshot.searchQuery || ""} placeholder="Tìm cuộc trò chuyện" autoComplete="off" aria-label="Tìm task, chat hoặc workspace" />
      <div class="home-search-results wb-search-results" data-home-search-results hidden={!(snapshot.searchQuery || "").trim()}>{snapshot.searchResults || ""}</div>
    </label>
    <button class="wb-new-chat" data-action="new-chat" data-workspace-id={snapshot.homeWorkspaceId || ""}><Icon name="square-terminal" size={16} /><span>Cuộc trò chuyện mới</span></button>
    <div class="wb-side-scroll"><SideContent snapshot={snapshot} /></div>
  </aside>;
}
