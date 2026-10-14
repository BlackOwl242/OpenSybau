import { h } from "preact";
import { pageTitles } from "../navigation.js";
import { Icon } from "../../shared/ui/Icon.jsx";

function tabIconName(ext = "") {
  const lower = String(ext || "").toLowerCase();
  if (lower === ".html" || lower === ".htm") return "globe";
  if (lower === ".pdf" || lower === ".md" || lower === ".mdx" || lower === ".markdown") return "book-open-text";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp"].includes(lower)) return "image";
  if ([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".cs", ".css", ".scss", ".json", ".sql", ".sh", ".ps1"].includes(lower)) return "code-2";
  return "file-text";
}

export function TopBar({ snapshot, onOpenNavigation = () => {} }) {
  const page = snapshot.page || "chat";
  const stageTabs = snapshot.stageTabs || [];
  const activeStageTabId = snapshot.activeStageTabId || "chat";
  const stageSplit = Boolean(snapshot.stageSplit && stageTabs.length > 0);
  const isHome = page === "chat" && !snapshot.selected;
  const supportsDock = page === "chat" || page === "workspaces" || page === "skills" || (page === "knowledge" && Boolean(snapshot.state?.settings?.vaultPath));
  const dockOpen = Boolean(supportsDock && snapshot.chatDrawerOpen && snapshot.rightDockMarkup);

  if (isHome && stageTabs.length === 0) {
    return supportsDock && !dockOpen ? <div class="wb-home-dock-trigger">
      <button class="wb-top-icon" type="button" data-action="toggle-chat-drawer" title="Mở thanh bên phải" aria-label="Mở thanh bên phải">
        <Icon name="sidebar-right" size={16} />
      </button>
    </div> : null;
  }

  const title = pageTitles[page] || "OpenSybau";
  const task = page === "chat" && snapshot.selected
    ? snapshot.state?.tasks?.find((item) => item.id === snapshot.selected)
    : null;
  const workspace = task
    ? snapshot.state?.workspaces?.find((item) => item.id === task.workspaceId)
    : page === "workspaces" && snapshot.selected
      ? snapshot.state?.workspaces?.find((item) => item.id === snapshot.selected)
      : snapshot.state?.workspaces?.find((item) => item.id === snapshot.homeWorkspaceId) || snapshot.state?.workspaces?.[0] || null;

  const useOrcaTabs = page === "chat" || page === "workspaces";

  if (useOrcaTabs) {
    const primaryTitle = task
      ? task.title
      : page === "workspaces" && workspace
        ? workspace.name
        : "Cuộc trò chuyện mới";
    const primaryIcon = page === "workspaces" && !task ? "folder-code" : "message-circle";
    const isPrimaryActive = activeStageTabId === "chat" && !stageSplit;

    return <header class="wb-topbar orca-tabbar" aria-label="Thanh tab đa cửa sổ">
      <div class="orca-tabbar-scroll" role="tablist">
        <button class="wb-mobile-menu-button" type="button" onClick={onOpenNavigation} aria-label="Mở workspace và cuộc trò chuyện" title="Workspace và chat" />
        <button
          type="button"
          role="tab"
          aria-selected={isPrimaryActive}
          class={`orca-tab is-primary-tab ${isPrimaryActive ? "is-active" : ""} ${stageSplit ? "is-split-pinned" : ""}`}
          data-action="activate-stage-tab"
          data-tab-id="chat"
          title={primaryTitle}
        >
          <Icon name={primaryIcon} size={13} />
          <span class="orca-tab-title">{primaryTitle}</span>
        </button>
        {stageTabs.map((tab) => {
          const isActive = activeStageTabId === tab.id || (stageSplit && activeStageTabId === "chat" && stageTabs[0]?.id === tab.id);
          return <div
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            class={`orca-tab ${isActive ? "is-active" : ""}`}
            data-action="activate-stage-tab"
            data-tab-id={tab.id}
            title={tab.path}
          >
            <Icon name={tabIconName(tab.ext)} size={13} />
            <span class="orca-tab-title">{tab.name}</span>
            <button
              type="button"
              class="orca-tab-close"
              data-action="close-stage-tab"
              data-tab-id={tab.id}
              title={`Đóng tab ${tab.name}`}
              aria-label={`Đóng tab ${tab.name}`}
            >
              <Icon name="x" size={11} />
            </button>
          </div>;
        })}
        <button
          type="button"
          class="orca-tabbar-add"
          data-action="new-chat"
          title="Mở cuộc trò chuyện mới"
          aria-label="Mở cuộc trò chuyện mới"
        >
          <Icon name="plus" size={14} />
        </button>
      </div>
      <div class="wb-top-actions orca-tabbar-actions">
        {stageTabs.length > 0 ? (
          <button
            class={`wb-top-icon ${stageSplit ? "is-active" : ""}`}
            type="button"
            data-action="toggle-stage-split"
            title={stageSplit ? "Tắt chế độ chia đôi màn hình" : "Chia đôi màn hình: Chat + Xem File song song"}
            aria-label="Chia đôi màn hình: Chat + Xem File song song"
          >
            <Icon name="columns-2" size={15} />
          </button>
        ) : null}
        {supportsDock && !dockOpen ? (
          <button class="wb-top-icon" type="button" data-action="toggle-chat-drawer" title="Mở thanh bên phải" aria-label="Mở thanh bên phải">
            <Icon name="sidebar-right" size={16} />
          </button>
        ) : null}
      </div>
    </header>;
  }

  return <header class="wb-topbar">
    <div class="wb-topbar-leading">
      <button class="wb-mobile-menu-button" type="button" onClick={onOpenNavigation} aria-label="Mở workspace và cuộc trò chuyện" title="Workspace và chat" />
      <div class="wb-breadcrumb">
        <span>OpenSybau</span>
        <Icon name="chevron-right" size={13} />
        <strong>{title}</strong>
        {workspace && ["tasks", "flows", "workspaces"].includes(page) ? <><Icon name="chevron-right" size={13} /><span>{workspace.name}</span></> : null}
      </div>
    </div>
    <div class="wb-top-actions">
      {supportsDock && !dockOpen ? (
        <button class="wb-top-icon" type="button" data-action="toggle-chat-drawer" title="Mở thanh bên phải" aria-label="Mở thanh bên phải">
          <Icon name="sidebar-right" size={16} />
        </button>
      ) : null}
    </div>
  </header>;
}


