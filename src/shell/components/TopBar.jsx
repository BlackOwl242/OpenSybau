import { h } from "preact";
import { pageTitles } from "../navigation.js";
import { Icon } from "../../shared/ui/Icon.jsx";

export function TopBar({ snapshot, onOpenNavigation = () => {} }) {
  const title = pageTitles[snapshot.page] || "OpenSybau";
  const task = snapshot.page === "chat" && snapshot.selected
    ? snapshot.state?.tasks?.find((item) => item.id === snapshot.selected)
    : null;
  const workspace = task
    ? snapshot.state?.workspaces?.find((item) => item.id === task.workspaceId)
    : null;

  return <header class="wb-topbar">
    <div class="wb-topbar-leading">
      <button class="wb-mobile-menu-button" type="button" onClick={onOpenNavigation} aria-label="Mở workspace và cuộc trò chuyện" title="Workspace và chat" />
      {task ? <div class="wb-task-heading" title={task.title}>
        <span><Icon name="folder-code" size={13} />{workspace?.name || task.workspacePath}</span>
        <strong>{task.title}</strong>
      </div> : <div class="wb-breadcrumb"><span>OpenSybau</span><Icon name="chevron-right" size={13} /><strong>{title}</strong></div>}
    </div>
    <div class="wb-top-actions">
      <button class="wb-language-toggle" type="button" data-action="toggle-language" title={snapshot.language === "en" ? "Chuyển sang tiếng Việt" : "Chuyển sang tiếng Anh"} aria-label={snapshot.language === "en" ? "Chuyển sang tiếng Việt" : "Chuyển sang tiếng Anh"}>{snapshot.language === "en" ? "VI" : "EN"}</button>
      {task && <button class="wb-top-icon" data-action="open-task-flow" data-id={task.id} title="Bản ghi điều phối" aria-label="Mở bản ghi điều phối"><Icon name="workflow" size={16} /></button>}
      {task && <button class="wb-top-icon" data-action="open-folder" data-id={task.id} title="Mở thư mục workspace" aria-label="Mở thư mục workspace"><Icon name="folder-code" size={16} /></button>}
      <button class="wb-top-icon" data-action="refresh" title="Làm mới dữ liệu" aria-label="Làm mới dữ liệu"><Icon name="refresh-cw" size={16} /></button>
    </div>
  </header>;
}
