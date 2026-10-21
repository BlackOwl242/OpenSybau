import { $, efforts, esc, icon, view } from "../../shared/state.js";
import { connectorSupports, providersForRole, roleConfig, workflowRoles } from "../../domain/agent-roles.js";
import {
  openArenaCompareModal as openFanoutCompareModal,
  renderDiffStudioModal as renderDiffModalContent,
  showDiffModal as openDiffStudioModal,
} from "./diff-studio.js";
import { api, render, showModal, showToast } from "./runtime.js";
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
  const body = `<div class="task-instruction-models">${homeSelectField("Agent", "provider", "data-chat-provider", providerOptions, provider, !providers.length)}${homeSelectField("Model", "model", "data-chat-model", modelOptions, model?.id || "", !model)}${homeSelectField("Mức suy nghĩ", "effort", "data-chat-effort", effortOptions, view.chatEffort, !effortOptions.length)}</div>`;
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
  const body = `${homeSelectField("Quyền truy cập", "permissionPreset", "", permOptions, current)}<p class="form-note">Toàn quyền tắt sandbox và bước duyệt của CLI cục bộ (Codex, Antigravity hoặc Claude Code), cho phép agent chạy lệnh và truy cập tệp ngoài workspace theo quyền tài khoản Windows của bạn. Chỉ chọn khi bạn tin cậy yêu cầu và nội dung trong workspace. Provider API vẫn không có quyền chạy lệnh trên máy.</p>`;
  showModal("Quyền của task", body, "Lưu quyền", "task-permissions");
  $(".modal").dataset.id = task.id;
}

export async function openTaskModal() {
  const { workspaces } = view.state;
  if (!providersForRole(view.connectors, "plan").length) {
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
  const body = `${taskPresetToolsMarkup()}<label>Yêu cầu<textarea name="prompt" required minlength="6" maxlength="12000" rows="3" placeholder="Mô tả việc cần làm, phạm vi và điều kiện hoàn tất…"></textarea></label><div class="modal-grid-2">${homeSelectField("Dự án (Workspace)", "workspaceId", "required", wsOptions, view.homeWorkspaceId || workspaces[0]?.id)}${homeSelectField("Luồng", "workflow", "", wfOptions, hasBuild ? "codex-antigravity" : "plan-only")}</div><div class="modal-grid-2">${homeSelectField("Quyền", "permissionPreset", "", permOptions, "workspace-write")}<label>Mục tiêu dài hạn<input name="goal" maxlength="2000" placeholder="Không bắt buộc"></label></div><div class="modal-grid-2">${homeSelectField("Phạm vi thay đổi", "riskLevel", "", riskOptions, "M")}${homeSelectField("Vòng lặp tự sửa", "maxRounds", "", roundOptions, "2")}</div><div class="modal-grid-2"><label>Lệnh QA tự động<input name="qaCommand" placeholder="VD: npm test" autocomplete="off" spellcheck="false"></label>${homeSelectField("Phụ thuộc đợt", "dependsOnTaskId", "", depOptions, "")}</div><div class="agent-role-grid task-role-grid">${workflowRoles.map((role) => roleEditor(role.id)).join("")}</div><div class="chat-agent-role" hidden>${chatAgentEditor()}</div><section class="task-skill-auto"><span class="task-skill-auto-icon">${icon("notebook-tabs", 16)}</span><div><strong>Tự chọn skill phù hợp</strong><small>OpenSybau tìm skill liên quan rồi gửi cho agent ở từng vai trò.</small></div><span class="task-skill-total">${view.skills.length} skill</span></section><label class="check-row"><input type="checkbox" name="planGate"><span><strong>Dừng lại chờ duyệt kế hoạch (Bước 2 · Duyệt kế hoạch)</strong><small>Tạm dừng sau khi AI lên kế hoạch để bạn xem qua trước khi AI viết code.</small></span></label><label class="check-row"><input type="checkbox" name="isolated"><span><strong>Tách Git worktree riêng</strong><small>Cần repo có commit. Khi bật, kết quả ở worktree và không tự nhập vào thư mục hiện tại.</small></span></label><div class="form-note" id="isolation-note"></div>`;
  showModal("Task mới", body, "Tạo và chạy");
  syncWorkflow();
  syncIsolation();
  syncTaskPresetControls($(".modal"));
}

export function showWorkspaceModal() {
  const body = `<label>Đường dẫn thư mục trên máy<input name="path" required placeholder="D:\\Projects\\my-app" autocomplete="off" spellcheck="false" data-workspace-path></label><div class="form-note">Dán đường dẫn hoặc kéo thả một thư mục từ Explorer vào ô này. OpenSybau sẽ dùng đúng thư mục bạn chọn.</div>`;
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

export function showMemoryModal() {
  const scopeOptions = [
    { value: "all", label: "Dùng chung" },
    ...(view.state.workspaces || []).map((w) => ({ value: w.id, label: w.name })),
  ];
  const body = '<label>Tên ghi nhớ<input name="title" maxlength="120" required autocomplete="off" spellcheck="false" placeholder="Ví dụ: Cách chạy kiểm thử dự án"></label>' + contentFileImportField("content") + '<label>Nội dung<textarea name="content" maxlength="5000" rows="4" required placeholder="Một ghi chú đã kiểm chứng, hữu ích cho các task sau"></textarea></label>' + homeSelectField("Phạm vi", "workspaceId", "", scopeOptions, "all") + '<div class="form-note">Mỗi task chỉ nạp tối đa 3 ghi chú có từ khóa khớp yêu cầu.</div>';
  showModal("Ghi nhớ mới", body, "Lưu ghi nhớ");
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
