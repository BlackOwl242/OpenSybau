import { $, efforts, esc, fmtDate, icon, view } from "../../shared/state.js";
import { connectorSupports, providersForRole, roleConfig, workflowRoles } from "../../domain/agent-roles.js";
import { pipelineStepperData } from "../../domain/task-flow.js";
import { isMobileCompanionMode } from "../../shared/remote-host.js";
import { effectiveCliPermissions } from "../../domain/cli-permissions.js";
import {
  openArenaCompareModal as openFanoutCompareModal,
  renderDiffStudioModal as renderDiffModalContent,
  showDiffModal as openDiffStudioModal,
} from "./diff-studio.js";
import { renderMarkdown } from "./markdown.js";
import { openGithubCreatePrModal as openGhCreatePrModal } from "./notifications.js";
import { api, ensureTaskSubagentsDetail, render, showModal, showToast } from "./runtime.js";
import {
  chatAgentEditor,
  formatEffortLabel,
  homeSelectField,
  roleEditor,
  syncIsolation,
  syncTaskPresetControls,
  syncWorkflow,
  taskPresetToolsMarkup,
} from "./ui-controls.js";
import { contentFileImportField } from "./composer.js";

export function showNewVaultNoteModal() {
  const prefix = view.vaultDir ? `${view.vaultDir}/` : "";
  const today = new Date().toISOString().slice(0, 10);
  const body = `<label>Đường dẫn tệp ghi chú (.md)<input name="notePath" required maxlength="240" value="${esc(`${prefix}${today}.md`)}" placeholder="Ví dụ: kien-truc/he-thong.md"></label><label>Nội dung Markdown<textarea name="content" rows="6" spellcheck="false" placeholder="# Tiêu đề ghi chú\n\nNội dung ghi chú… Liên kết tới [[Ghi chú khác]] hoặc gắn #tag."># </textarea><small>Sử dụng cú pháp <code>[[Tên ghi chú]]</code> hoặc <code>#tag</code> để tạo liên kết trên đồ thị tri thức.</small></label>`;
  showModal("Ghi chú tri thức mới", body, "Tạo ghi chú", "vault-note-create");
}

export function showSkillCreateModal() {
  const scopeOptions = [
    { value: "universal", label: "OpenSybau · mọi agent, gồm API" },
    { value: "codex", label: "Codex CLI" },
    { value: "antigravity", label: "Antigravity CLI" },
    { value: "claude", label: "Claude Code CLI" },
    { value: "all-cli", label: "Tất cả CLI · Codex, Antigravity, Claude" },
  ];
  const body = '<label>Tên skill<input name="name" maxlength="100" required autocomplete="off" spellcheck="false" placeholder="Ví dụ: review-api"></label><label>Mô tả ngắn<input name="description" maxlength="500" required placeholder="Khi nào và cách nào nên dùng skill này"></label>' + homeSelectField("Dùng cho", "scope", "", scopeOptions, "universal") + contentFileImportField("instructions") + '<label>Hướng dẫn<textarea name="instructions" maxlength="98000" rows="9" placeholder="Quy trình, quy tắc và kết quả mong muốn…"></textarea></label><p class="form-note">OpenSybau lưu skill dùng chung trong dữ liệu riêng của ứng dụng và đưa hướng dẫn vào prompt của agent đã chọn, kể cả API. Chọn một CLI để cài skill trực tiếp vào thư mục cá nhân của CLI đó. OpenSybau không ghi đè skill trùng tên.</p>';
  showModal("Tạo skill", body, "Tạo skill", "skill-create");
}

export function showSubagentProfileCreateModal() {
  const activeWsId = (view.page === "workspaces" && view.selected)
    ? view.selected
    : view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || "";
  const activeWs = (view.state?.workspaces || []).find((w) => w.id === activeWsId);
  const scopeOptions = [
    { value: "global", label: "OpenSybau · Dùng chung mọi Harness (.runtime/subagents)" },
    { value: "claude-personal", label: "Claude Code cá nhân (~/.claude/agents)" },
    { value: "agy-personal", label: "Antigravity CLI cá nhân (~/.gemini/config/agents)" },
    ...(activeWs
      ? [
          { value: "workspace", label: `Dự án ${activeWs.name} · .agents/agents` },
          { value: "workspace-claude", label: `Dự án ${activeWs.name} · .claude/agents` },
        ]
      : []),
  ];
  const modelOptions = [
    { value: "inherit", label: "Kế thừa model của Agent cha (inherit)" },
    { value: "sonnet", label: "Claude Sonnet (nhanh & cân bằng)" },
    { value: "opus", label: "Claude Opus (suy luận sâu)" },
    { value: "haiku", label: "Claude Haiku (tốc độ cao)" },
  ];
  const body = `<input type="hidden" name="workspaceId" value="${esc(activeWsId)}">
    <div class="modal-grid-2">
      <label>Định danh hồ sơ (slug)<input name="name" maxlength="80" required autocomplete="off" spellcheck="false" placeholder="Ví dụ: security-auditor"></label>
      ${homeSelectField("Model ưu tiên", "model", "", modelOptions, "inherit")}
    </div>
    <label>Mô tả nhiệm vụ khi uỷ quyền<input name="description" maxlength="300" required placeholder="Khi nào Agent chính nên gọi subagent này?"></label>
    <div class="modal-grid-2">
      ${homeSelectField("Phạm vi lưu trữ", "scopeId", "", scopeOptions, "global")}
      <label>Danh sách công cụ cho phép (tùy chọn)<input name="tools" maxlength="300" autocomplete="off" spellcheck="false" placeholder="VD: Read, Grep, Glob, Bash"></label>
    </div>
    <label class="check-row"><input type="checkbox" name="readOnly" checked><span><strong>Chế độ Subagent chỉ đọc (Read-only)</strong><small>Khuyến nghị bật để nhiều subagent rà soát mã nguồn song song mà không gây xung đột ghi tệp.</small></span></label>
    <label>Chỉ dẫn hệ thống (System Prompt)<textarea name="prompt" maxlength="80000" rows="7" required spellcheck="false" placeholder="Vai trò chuyên môn, tiêu chí kiểm tra và định dạng báo cáo trả về cho Agent cha…"></textarea></label>
    <p class="form-note">Hồ sơ được lưu dưới dạng Markdown chuẩn có YAML frontmatter. Claude Code nhận trực tiếp qua cờ <code>--agents</code>, còn Codex và Antigravity nhận hướng dẫn điều phối tương ứng.</p>`;
  showModal("Tạo hồ sơ Subagent", body, "Lưu hồ sơ", "subagent-profile-create");
}

export const openSubagentModal = showSubagentProfileCreateModal;

export function openSkillPickerModal(taskId = "") {
  const skills = Array.isArray(view.skills) ? view.skills : [];
  const activeTask = taskId ? (view.state?.tasks || []).find((t) => t.id === taskId) : null;
  const selectedIds = activeTask && Array.isArray(activeTask.skillIds)
    ? [...activeTask.skillIds]
    : Array.isArray(view.homeSelectedSkills)
      ? [...view.homeSelectedSkills]
      : [];
  const selectedSet = new Set(selectedIds);
  const countLabel = selectedSet.size > 0
    ? `Đã chọn ${selectedSet.size} kỹ năng`
    : "Tự động chọn theo ngữ cảnh";

  const rows = skills.length
    ? skills.map((skill) => {
        const checked = selectedSet.has(skill.id);
        const searchKey = `${skill.name || ""} ${skill.description || ""} ${skill.id || ""}`.toLowerCase();
        const providerBadge = Array.isArray(skill.providers) && skill.providers.includes("*")
          ? "Mọi agent"
          : (skill.providers || []).join(", ") || "OpenSybau";
        return `<label class="check-row skill-picker-row" data-skill-picker-item="${esc(searchKey)}">
          <input type="checkbox" data-action="toggle-picker-skill" data-skill-id="${esc(skill.id)}" ${taskId ? `data-task-id="${esc(taskId)}"` : ""} ${checked ? "checked" : ""}>
          <span>
            <strong>${esc(skill.name || skill.id)} <small class="workspace-meta-pill">${esc(providerBadge)}</small></strong>
            <small>${esc(skill.description || "Kỹ năng chuyên biệt nạp vào ngữ cảnh khi chạy.")}</small>
          </span>
        </label>`;
      }).join("")
    : `<div class="empty-state"><div class="empty-symbol">${icon("notebook-tabs", 18)}</div><strong>Chưa có kỹ năng nào trong thư viện</strong><p>Tạo kỹ năng mới hoặc cài đặt SKILL.md để tái sử dụng quy trình chuẩn cho các agent.</p></div>`;

  const body = `<div class="skill-picker-modal-body" data-skill-picker-root ${taskId ? `data-task-id="${esc(taskId)}"` : ""}>
    <div class="skill-picker-toolbar" style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <div class="search-field" style="flex:1;min-width:200px">
        <input type="search" data-skill-picker-search placeholder="Tìm kỹ năng theo tên hoặc mô tả..." autocomplete="off" spellcheck="false">
      </div>
      <span class="badge neutral" data-skill-picker-count>${esc(countLabel)}</span>
      <button type="button" class="button quiet small" data-action="clear-picker-skills" ${taskId ? `data-task-id="${esc(taskId)}"` : ""}>Đặt lại Tự động</button>
    </div>
    <div class="skill-picker-list" style="max-height:320px;overflow-y:auto;display:flex;flex-direction:column;gap:6px">${rows}</div>
    <div class="skill-picker-footer" style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border-subtle, rgba(128,128,128,0.18))">
      <button type="button" class="button quiet small" data-action="new-skill">${icon("plus", 14)} <span>Tạo skill mới</span></button>
      <button type="button" class="button quiet small" data-action="open-skill-library"><span>Quản lý thư viện Kỹ năng</span> ${icon("arrow-right", 14)}</button>
    </div>
  </div>`;
  showModal("Chọn kỹ năng cho phiên làm việc", body, "Xong", "dismiss");
  const modal = $(".modal");
  if (modal) modal.classList.add("modal-wide");
}

export function defaultSkillScope(providers = []) {
  if (providers.includes("*")) return "universal";
  const cliProviders = ["codex", "antigravity", "claude"].filter((provider) => providers.includes(provider));
  if (cliProviders.length === 3) return "all-cli";
  if (cliProviders.includes("codex") && cliProviders.includes("antigravity")) return "shared";
  if (cliProviders.length === 1) return cliProviders[0];
  return "universal";
}

export function showVaultModal() {
  const current = view.state?.settings?.vaultPath || "";
  const body = `<label>Đường dẫn thư mục Obsidian vault<input name="vaultPath" required value="${esc(current)}" placeholder="D:\\Notes\\My Vault" autocomplete="off" spellcheck="false"></label><p class="form-note">OpenSybau chỉ đọc tệp Markdown bên trong thư mục này. Kết nối không tự đưa ghi chú vào ngữ cảnh task.</p>`;
  showModal(current ? "Đổi Obsidian vault" : "Kết nối Obsidian vault", body, "Kết nối", "vault");
}

export function openTaskInstructionModal(task) {
  const defaultRole = roleConfig(task.config, "plan");
  const provider = view.chatProvider || (task.config.workflow === "chat-only" ? task.config.chatProvider : defaultRole.provider) || "codex";
  view.chatProvider = provider;
  const models = view.connectors?.[provider]?.models || [];
  const selected = view.chatModel || (task.config.workflow === "chat-only" ? task.config.chatModel : defaultRole.model) || models[0]?.id || "";
  const model = models.find((item) => item.id === selected) || models[0];
  view.chatModel = model?.id || "";
  view.chatEffort = view.chatEffort || (task.config.workflow === "chat-only" ? task.config.chatEffort : defaultRole.effort) || model?.efforts?.find((effort) => effort === "medium") || model?.efforts?.[0] || "";
  const providers = Object.entries(view.connectors || {}).filter(([, connector]) => connectorSupports(connector, "chat"));
  const providerOptions = providers.length ? providers.map(([id, connector]) => ({ value: id, label: `${connector.name || id}${connector.kind === "api" ? " · API" : " · CLI"}` })) : [{ value: "", label: "Chưa có agent khả dụng" }];
  const modelOptions = models.length ? models.map((item) => ({ value: item.id, label: item.name || item.id })) : [{ value: "", label: "Chưa có model khả dụng" }];
  const effortOptions = (model?.efforts || efforts).map((effort) => ({ value: effort, label: formatEffortLabel(effort) }));
  const transportOptions = [
    { value: "auto", label: "Tự động (App Server khi cần duyệt lệnh)" },
    { value: "app-server", label: "App Server · gửi trực tiếp & duyệt lệnh" },
    { value: "exec", label: "CLI exec · hàng đợi nền" },
  ];
  const currentTransport = task.config?.codexTransport || view.homeCodexTransport || "auto";
  const body = `<div class="task-instruction-models">${homeSelectField("Agent", "provider", "data-chat-provider", providerOptions, provider, !providers.length)}${homeSelectField("Model", "model", "data-chat-model", modelOptions, model?.id || "", !model)}${homeSelectField("Mức suy nghĩ", "effort", "data-chat-effort", effortOptions, view.chatEffort, !effortOptions.length)}</div>${homeSelectField("Bộ chạy Codex", "codexTransport", "", transportOptions, currentTransport, Boolean(task.processRunning || ["queued", "running"].includes(task.status)))}<p class="form-note">Chế độ App Server cho phép duyệt lệnh trực tiếp ngay trên khung chat khi dùng Codex. Claude và Antigravity nhận tin nhắn qua hàng đợi.</p>`;
  showModal("Cấu hình lượt chat", body, "Áp dụng", "task-chat-config");
  $(".modal").dataset.id = task.id;
  $(".modal").classList.add("task-chat-config-modal");
}

export function openTaskGoalModal(task) {
  const checklist = (task.goalChecklist || []).map((item) => item.text).join("\n");
  const checklistStatus = task.goalChecklist?.length ? `<section class="goal-checklist-status"><strong>Tiến độ checklist</strong><ul>${task.goalChecklist.map((item) => `<li><label><input type="checkbox" data-action="toggle-goal-item" data-id="${esc(task.id)}" data-goal-id="${esc(item.id)}" ${item.done ? "checked" : ""}><span class="${item.done ? "is-done" : ""}">${esc(item.text)}</span></label></li>`).join("")}</ul></section>` : "";
  const body = `<label>Mục tiêu<textarea name="goal" rows="3" maxlength="2000" placeholder="Kết quả dài hạn cần đạt">${esc(task.goal || "")}</textarea></label><label>Checklist nghiệm thu<textarea name="checklist" rows="6" maxlength="6000" placeholder="Mỗi dòng là một tiêu chí hoàn tất">${esc(checklist)}</textarea><small>Tối đa 20 mục, mỗi mục tối đa 300 ký tự. Agent sẽ nhận checklist ở các lượt sau.</small></label>${checklistStatus}`;
  showModal("Mục tiêu dài hạn", body, "Lưu mục tiêu", "task-goal");
  $(".modal").dataset.id = task.id;
}

export function openTaskPermissionsModal(task) {
  const current = task.permissionPreset || "workspace-write";
  const permOptions = [
    { value: "read-only", label: "Chỉ đọc workspace" },
    { value: "workspace-write", label: "Đọc và sửa workspace" },
    { value: "full-access", label: "Toàn quyền trên máy" },
  ];
  const matrix = ["codex", "claude", "antigravity"].map((provider) => `<tr><th>${esc(provider)}</th>${permOptions.map(({value}) => { const policy = effectiveCliPermissions(provider, value, "chat-initial", task.config?.codexTransport); return `<td>${esc(policy.supported ? policy.mode || `${policy.sandbox} · ${policy.approval}` : "Không hỗ trợ")}</td>`; }).join("")}</tr>`).join("");
  const body = `${homeSelectField("Quyền truy cập", "permissionPreset", "", permOptions, current)}<p class="form-note">Toàn quyền cho phép truy cập theo quyền tài khoản hệ điều hành. Provider API không chạy lệnh trên máy.</p><div class="form-note"><strong>Quyền thực tế theo bộ chạy</strong><div class="table-scroll-wrap orca-table-scroll"><table class="orca-data-table permission-matrix-table"><thead><tr><th>Provider</th><th>Chỉ đọc</th><th>Ghi workspace</th><th>Toàn quyền</th></tr></thead><tbody>${matrix}</tbody></table></div><p>Codex ${task.config?.codexTransport === "app-server" ? "App Server: on-request cho phép bạn duyệt yêu cầu lệnh hoặc tệp; khi toàn quyền sẽ không hỏi." : "exec: không hỏi duyệt từng lệnh; yêu cầu vượt sandbox sẽ bị từ chối."} Giai đoạn plan/review luôn dùng read-only, trừ khi bạn chọn toàn quyền.</p><p>Claude Code dùng permission mode, không khẳng định có sandbox hệ điều hành. Plan/review dùng plan. Ở chế độ nền hiện tại, yêu cầu cần tương tác không được tự cấp quyền.</p><p>Antigravity không hỗ trợ chỉ đọc trong bộ chạy hiện tại. Chưa bật điều khiển lượt chạy hoặc phê duyệt trực tiếp.</p><p>Phê duyệt kế hoạch của OpenSybau là bước riêng với phê duyệt từng lệnh của CLI.</p></div>`;
  showModal("Quyền của task", body, "Lưu quyền", "task-permissions");
  $(".modal").dataset.id = task.id;
}

export async function openTaskModal() {
  const { workspaces } = view.state;
  if (!providersForRole(view.connectors, "plan").length) {
    if (view.page !== "settings") view.navOriginPage = view.page;
    view.settingsSection = "cli";
    view.page = "settings";
    view.selected = null;
    render();
    showToast("Kết nối ít nhất một agent hoặc API rồi bạn có thể tạo task.");
    return;
  }
  if (!workspaces.length) return showWorkspaceModal();
  const wsOptions = workspaces.map((w) => ({ value: w.id, label: `${w.name} · ${w.path}` }));
  const depOptions = [
    { value: "", label: "Không phụ thuộc (Đợt 1)" },
    ...(view.state.tasks || []).filter((t) => !t.archived).slice(0, 25).map((t) => ({ value: t.id, label: `${t.code || "TASK"} · ${t.title.slice(0, 56)}` })),
  ];
  const hasBuild = providersForRole(view.connectors, "build").length > 0;
  const canPlanOnly = providersForRole(view.connectors, "plan").length > 0;
  const wfOptions = [
    { value: "codex-antigravity", label: "Pipeline · Kế hoạch → Triển khai → Đánh giá", disabled: !hasBuild },
    { value: "plan-only", label: "Chỉ lập kế hoạch", disabled: !canPlanOnly },
    { value: "chat-only", label: "Chat · một agent" },
  ];
  const permOptions = [
    { value: "workspace-write", label: "Đọc và sửa workspace" },
    { value: "read-only", label: "Chỉ đọc workspace" },
    { value: "full-access", label: "Toàn quyền trên máy" },
  ];
  const transportOptions = [
    { value: "auto", label: "Tự động (App Server khi cần duyệt lệnh)" },
    { value: "app-server", label: "App Server · duyệt lệnh trực tiếp" },
    { value: "exec", label: "CLI exec · hàng đợi nền" },
  ];
  const riskOptions = [
    { value: "S", label: "Phạm vi nhỏ" },
    { value: "M", label: "Phạm vi vừa" },
    { value: "L", label: "Phạm vi lớn" },
  ];
  const roundOptions = [
    { value: "1", label: "1 vòng" },
    { value: "2", label: "Tự sửa 2 vòng" },
    { value: "3", label: "Tự sửa 3 vòng" },
  ];
  const selectedSkillCount = Array.isArray(view.homeSelectedSkills) ? view.homeSelectedSkills.length : 0;
  const body = `${taskPresetToolsMarkup()}<label>Yêu cầu<textarea name="prompt" required minlength="6" maxlength="12000" rows="3" placeholder="Mô tả việc cần làm, phạm vi và điều kiện hoàn tất…"></textarea></label><div class="modal-grid-2">${homeSelectField("Dự án (Workspace)", "workspaceId", "required", wsOptions, view.homeWorkspaceId || workspaces[0]?.id)}${homeSelectField("Luồng", "workflow", "", wfOptions, hasBuild ? "codex-antigravity" : "plan-only")}</div><div class="modal-grid-2">${homeSelectField("Quyền", "permissionPreset", "", permOptions, "workspace-write")}${homeSelectField("Bộ chạy Codex", "codexTransport", "", transportOptions, view.homeCodexTransport || "auto")}</div><div class="modal-grid-2">${homeSelectField("Phạm vi thay đổi", "riskLevel", "", riskOptions, "M")}${homeSelectField("Vòng lặp tự sửa", "maxRounds", "", roundOptions, "2")}</div><div class="modal-grid-2"><label>Lệnh QA tự động<input name="qaCommand" placeholder="VD: npm test" autocomplete="off" spellcheck="false"></label>${homeSelectField("Phụ thuộc đợt", "dependsOnTaskId", "", depOptions, "")}</div><label>Mục tiêu dài hạn<input name="goal" maxlength="2000" placeholder="Không bắt buộc"></label><div class="agent-role-grid task-role-grid">${workflowRoles.map((role) => roleEditor(role.id)).join("")}</div><div class="chat-agent-role" hidden>${chatAgentEditor()}</div><section class="task-skill-auto" data-action="open-skill-picker" role="button" tabindex="0"><span class="task-skill-auto-icon">${icon("notebook-tabs", 16)}</span><div><strong>${selectedSkillCount ? `Đã chọn ${selectedSkillCount} kỹ năng cho task` : "Tự chọn skill phù hợp"}</strong><small>OpenSybau tìm skill liên quan hoặc dùng danh sách bạn chọn thủ công.</small></div><span class="task-skill-total">${view.skills.length} skill</span></section><label class="check-row"><input type="checkbox" name="planGate"><span><strong>Dừng lại chờ duyệt kế hoạch (Bước 2 · Duyệt kế hoạch)</strong><small>Tạm dừng sau khi AI lên kế hoạch để bạn xem qua trước khi AI viết code.</small></span></label><label class="check-row"><input type="checkbox" name="isolated" ${view.homeIsolated ? "checked" : ""}><span><strong>Tách Git worktree riêng</strong><small>Cần repo có commit. Khi bật, kết quả ở worktree và không tự nhập vào thư mục hiện tại.</small></span></label><div class="form-note" id="isolation-note"></div>`;
  showModal("Task mới", body, "Tạo và chạy");
  syncWorkflow();
  syncIsolation();
  syncTaskPresetControls($(".modal"));
}

export function showWorkspaceModal() {
  const isMobile = isMobileCompanionMode();
  const body = `<label>${isMobile ? "Đường dẫn thư mục dự án trên máy tính (PC)" : "Đường dẫn thư mục trên máy"}<input name="path" required placeholder="D:\\Projects\\my-app" autocomplete="off" spellcheck="false" data-workspace-path></label><div class="form-note">${isMobile ? "Nhập đường dẫn tuyệt đối của thư mục dự án nằm trên máy tính (PC) đang kết nối." : "Dán đường dẫn hoặc kéo thả một thư mục từ Explorer vào ô này. OpenSybau sẽ dùng đúng thư mục bạn chọn."}</div>`;
  showModal("Thêm workspace", body, "Kiểm tra và thêm");
}

export function sourceFolderRow(path, primary = false) {
  return `<div class="source-folder-row"><span>${icon("folder", 14)}</span><input name="sourceFolder" value="${esc(path)}" required autocomplete="off" spellcheck="false" placeholder="D:\\Projects\\another-app" aria-label="Đường dẫn thư mục nguồn"><button type="button" class="icon-button" data-action="remove-source-folder" title="${primary ? "Thư mục chính không thể gỡ" : "Gỡ thư mục này"}" aria-label="Gỡ thư mục này" ${primary ? "disabled" : ""}>${icon("x", 14)}</button></div>`;
}

export function showEditProjectModal(workspace) {
  const folders = workspace.sourceFolders?.length ? workspace.sourceFolders : [workspace.path];
  const body = `<label>Tên dự án<input name="name" value="${esc(workspace.name)}" maxlength="100" required autocomplete="off" spellcheck="false"></label><section class="project-sources"><strong>Thư mục nguồn</strong><div class="source-folder-list">${folders.map((path) => sourceFolderRow(path, path.toLowerCase() === workspace.path.toLowerCase())).join("")}</div><button type="button" class="button quiet small" data-action="add-source-folder">${icon("folder-plus", 14)} Thêm thư mục</button><p class="form-note">Task thường có quyền đọc/ghi các thư mục nguồn. Task tách worktree chỉ dùng workspace chính.</p></section>`;
  showModal("Sửa dự án", body, "Lưu thay đổi", "workspace-edit");
  $(".modal").dataset.id = workspace.id;
}

export function showProjectSectionModal(workspace) {
  const sections = [...new Set(view.state.workspaces.map((item) => item.section || "Projects"))];
  const options = sections.map((section) => `<option value="${esc(section)}">`).join("");
  const body = `<label>Tên section<input name="section" value="${esc(workspace.section || "Projects")}" maxlength="60" list="project-section-options" required autocomplete="off" spellcheck="false" placeholder="Projects"><datalist id="project-section-options">${options}</datalist></label><p class="form-note">Chọn section có sẵn hoặc nhập tên mới để tạo.</p>`;
  showModal("Chuyển section", body, "Lưu section", "workspace-section");
  $(".modal").dataset.id = workspace.id;
}

export function showMemoryModal(existingMemory = null) {
  const isEdit = Boolean(existingMemory && typeof existingMemory === "object" && existingMemory.id);
  const scopeOptions = [
    { value: "all", label: "Dùng chung mọi dự án" },
    ...(view.state?.workspaces || []).map((w) => ({ value: w.id, label: w.name })),
  ];
  const kindOptions = [
    { value: "lesson", label: "Bài học dự án (Lesson)" },
    { value: "pitfall", label: "Lỗi cần tránh (Pitfall)" },
    { value: "user-profile", label: "Quy tắc cá nhân · USER.md (Tier-1)" },
  ];
  const currentKind = existingMemory?.kind || "lesson";
  const currentScope = existingMemory?.workspaceId || "all";
  const isPinned = Boolean(existingMemory?.pinned || currentKind === "user-profile");

  const body = `<label>Tên ghi nhớ<input name="title" maxlength="120" required autocomplete="off" spellcheck="false" value="${esc(existingMemory?.title || "")}" placeholder="Ví dụ: Quy tắc kiến trúc hoặc cách chạy kiểm thử"></label>`
    + `<div class="modal-grid-2">${homeSelectField("Phân loại", "kind", "", kindOptions, currentKind)}${homeSelectField("Phạm vi", "workspaceId", "", scopeOptions, currentScope)}</div>`
    + contentFileImportField("content")
    + `<label>Nội dung<textarea name="content" maxlength="5000" rows="5" required placeholder="Quy tắc USER.md hoặc ghi chú đã kiểm chứng cho các phiên sau">${esc(existingMemory?.content || "")}</textarea></label>`
    + `<label class="check-row"><input type="checkbox" name="pinned" ${isPinned ? "checked" : ""}><span><strong>Ghim cố định vào đầu ngữ cảnh (Tier-1 USER.md)</strong><small>Ghi nhớ được ghim hoặc thuộc nhóm USER.md luôn được nạp ưu tiên cho mọi phiên làm việc phù hợp.</small></span></label>`
    + `<div class="form-note">Các bài học thông thường sẽ được nạp thông minh tối đa 3 mục khi từ khóa khớp yêu cầu.</div>`;

  showModal(isEdit ? "Chỉnh sửa ghi nhớ" : "Ghi nhớ mới", body, isEdit ? "Lưu thay đổi" : "Lưu ghi nhớ", isEdit ? "memory-edit" : "memory");
  if (isEdit && $(".modal")) {
    $(".modal").dataset.id = existingMemory.id;
  }
}

export function openStageDocModal(task, docId = "") {
  if (!task) return;
  const cleanId = docId === "impl" ? "implementation" : docId;
  const stepper = pipelineStepperData(task);
  const docs = stepper.stageDocuments || [];
  const activeDoc = docs.find((d) => d.id === cleanId) || docs.find((d) => d.available) || docs[0];
  if (!activeDoc) {
    showToast("Chưa có tài liệu cho giai đoạn này.");
    return;
  }
  const docSwitchMarkup = docs.length > 1
    ? `<div class="filter-pills" style="margin-bottom:10px">${docs.map((d) => `<button type="button" class="filter ${d.id === activeDoc.id ? "active" : ""}" data-action="open-stage-doc" data-id="${esc(task.id)}" data-doc="${esc(d.id)}" ${d.available ? "" : "disabled"}>${icon("file-text", 13)} <span>${esc(d.title)}</span></button>`).join("")}</div>`
    : "";
  const contentText = activeDoc.content || "Chưa có nội dung cho giai đoạn này.";
  const body = `<div class="stage-doc-inspector-modal">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:8px">
      ${docSwitchMarkup}
      <div style="display:flex;align-items:center;gap:6px;margin-left:auto">
        <button type="button" class="button quiet small" data-action="open-task-chat" data-id="${esc(task.id)}">${icon("message-square", 14)} <span>Mở trong Không gian Chat</span></button>
      </div>
    </div>
    <article class="markdown-body stage-doc-modal-markdown" style="max-height:62vh;overflow-y:auto;padding:12px;border-radius:10px;border:1px solid var(--border-subtle, rgba(128,128,128,0.18))">${renderMarkdown(contentText)}</article>
  </div>`;
  showModal(`${task.code || "TASK"} · ${activeDoc.title}`, body, "Đóng", "dismiss");
  const modal = $(".modal");
  if (modal) modal.classList.add("modal-wide");
}

export async function openSubagentDetailModal(taskId, subId = "") {
  const task = (view.state?.tasks || []).find((t) => t.id === taskId);
  if (!task) return;
  const detail = await ensureTaskSubagentsDetail(taskId);
  const subagents = detail?.subagents?.length ? detail.subagents : (task.subagents || []);
  if (!subagents.length) {
    showToast("Task này chưa ghi nhận phiên Subagent nào.");
    return;
  }
  const selectedSub = (subId && subagents.find((s) => s.id === subId)) || subagents[0];
  const statusLabels = { spawning: "Đang khởi tạo", running: "Đang chạy", waiting: "Đang chờ", completed: "Hoàn tất", done: "Hoàn tất", failed: "Lỗi", cancelled: "Đã dừng" };
  const selectorPills = subagents.length > 1
    ? `<div class="filter-pills" style="margin-bottom:10px;flex-wrap:wrap">${subagents.map((s) => `<button type="button" class="filter ${s.id === selectedSub.id ? "active" : ""}" data-action="inspect-subagent" data-id="${esc(taskId)}" data-sub-id="${esc(s.id)}">${icon("git-fork", 12)} <span data-localize-skip="true">${esc(s.role || s.agentType || s.id.slice(0, 8))}</span></button>`).join("")}</div>`
    : "";
  const filesList = Array.isArray(selectedSub.touchedFiles) && selectedSub.touchedFiles.length
    ? `<div class="form-note" style="margin-top:10px"><strong>Tệp đã chạm (${selectedSub.touchedFiles.length})</strong><div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${selectedSub.touchedFiles.map((f) => `<code>${esc(f)}</code>`).join("")}</div></div>`
    : "";
  const toolsList = Array.isArray(selectedSub.recentTools) && selectedSub.recentTools.length
    ? `<details class="orchestration-node-details" style="margin-top:10px"><summary>Nhật ký công cụ (${selectedSub.toolCallsCount || selectedSub.recentTools.length})</summary><div style="max-height:180px;overflow-y:auto">${selectedSub.recentTools.map((ev) => `<p><time>${fmtDate(ev.at)}</time> <code>${esc(ev.tool || ev.name || "tool")}</code> ${esc(ev.summary || ev.inputPreview || "")}</p>`).join("")}</div></details>`
    : "";
  const outputMd = selectedSub.result || selectedSub.summary || selectedSub.resultPreview || "";

  const body = `<div class="subagent-inspector-modal">
    ${selectorPills}
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <strong data-localize-skip="true">${esc(selectedSub.role || selectedSub.agentType || "Subagent")}</strong>
        <span class="badge neutral">${esc(statusLabels[selectedSub.status] || selectedSub.status || "Đã ghi nhận")}</span>
        ${selectedSub.model ? `<span class="workspace-meta-pill" data-localize-skip="true">${esc(selectedSub.model)}</span>` : ""}
        ${selectedSub.readOnly ? `<span class="workspace-meta-pill">Read-only</span>` : ""}
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <button type="button" class="button quiet small" data-action="promote-subagent" data-id="${esc(taskId)}" data-sub-id="${esc(selectedSub.id)}">${icon("git-branch", 13)} <span>Tách thành Worktree Task</span></button>
        ${view.page !== "chat" ? `<button type="button" class="button quiet small" data-action="open-task-chat" data-id="${esc(taskId)}">${icon("message-square", 13)} <span>Mở trong Chat</span></button>` : ""}
      </div>
    </div>
    ${selectedSub.prompt ? `<details class="orchestration-node-details" style="margin-bottom:10px"><summary>Chỉ dẫn giao cho Subagent</summary><pre style="white-space:pre-wrap;max-height:160px;overflow-y:auto">${esc(selectedSub.prompt)}</pre></details>` : ""}
    ${outputMd ? `<article class="markdown-body" style="max-height:42vh;overflow-y:auto;padding:12px;border-radius:10px;border:1px solid var(--border-subtle, rgba(128,128,128,0.18))">${renderMarkdown(outputMd)}</article>` : `<p class="form-note">Đang chờ kết quả phản hồi từ Subagent…</p>`}
    ${filesList}
    ${toolsList}
  </div>`;
  showModal(`${task.code || "TASK"} · Subagent`, body, "Đóng", "dismiss");
  const modal = $(".modal");
  if (modal) modal.classList.add("modal-wide");
}

export function openGithubCreatePrModal(taskId) {
  return openGhCreatePrModal(taskId, { showModal });
}

export function renderDiffStudioModal() {
  return renderDiffModalContent({ showModal });
}

export function showDiffModal(data, taskId = view.selected, preferredFile = "") {
  return openDiffStudioModal(data, taskId, preferredFile, { showModal });
}

export async function openArenaCompareModal(fanoutId) {
  return openFanoutCompareModal(fanoutId, { api, showModal });
}
