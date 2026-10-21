import { esc, icon, view } from "../../shared/state.js";
import { ensureWorkspaceFileIndex, render, showToast } from "./runtime.js";

const contentImportExtensions = new Set([
  ".md", ".markdown", ".mdx", ".txt", ".text", ".rst", ".adoc", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".csv", ".tsv", ".xml", ".html", ".htm", ".log", ".diff", ".patch",
  ".css", ".scss", ".less", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".vue", ".svelte", ".astro", ".py", ".go", ".rs", ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".rb", ".swift", ".sql", ".sh", ".ps1", ".bat", ".cmd",
]);
const markdownContentExtensions = new Set([".md", ".markdown", ".mdx", ".txt", ".text", ".rst", ".adoc"]);
export const contentImportAccept = [...contentImportExtensions].join(",");

export function composerAttachmentKey(formOrInput) {
  const form = formOrInput?.matches?.("form") ? formOrInput : formOrInput?.closest("form");
  return form?.dataset.form === "task-chat" ? `task:${form.dataset.id}` : "home";
}

export function composerAttachmentsMarkup(key) {
  const files = view.composerAttachments?.[key] || [];
  if (!files.length) return "";
  return `<div class="composer-attachments" aria-label="Tệp đính kèm">${files.map((item) => `<div class="composer-attachment" title="${esc(item.path)}"><span class="composer-attachment-icon">${icon("file", 17)}</span><span class="composer-attachment-name">${esc(item.path)}</span><button type="button" data-action="remove-composer-attachment" data-scope="${esc(key)}" data-attachment-id="${esc(item.id)}" aria-label="Gỡ ${esc(item.path)}" title="Gỡ tệp">${icon("x", 14)}</button></div>`).join("")}</div>`;
}

export function clearComposerAttachments(form) {
  const key = composerAttachmentKey(form);
  if (view.composerAttachments?.[key]) delete view.composerAttachments[key];
}

export async function readComposerAttachments(form) {
  const files = view.composerAttachments?.[composerAttachmentKey(form)] || [];
  return Promise.all(files.map(async ({ file, path }) => {
    const content = await file.text();
    if (content.includes("\u0000")) throw new Error(`Tệp "${file.name}" là tệp nhị phân; chỉ gửi được nội dung văn bản.`);
    if (!content.trim()) throw new Error(`Tệp "${file.name}" đang trống.`);
    return { name: path, content };
  }));
}

export function composerAddMenu(target, taskId = "") {
  const extra = taskId
    ? `<button type="button" data-action="edit-task-goal" data-id="${esc(taskId)}">${icon("target", 16)}<span>Mục tiêu cuộc trò chuyện</span></button>`
    : `<button type="button" data-action="toggle-home-config">${icon("settings-2", 16)}<span>Agent và model</span></button>`;
  const fileImportOptions = [
    { label: "Tệp văn bản, Markdown, mã nguồn", icon: "file", attrs: `accept="${contentImportAccept}" multiple`, aria: "Chọn tệp văn bản hoặc Markdown" },
    { label: "Thư mục tệp văn bản", icon: "folder-open", attrs: "webkitdirectory multiple", aria: "Chọn thư mục tệp văn bản" },
  ].map((option) => `<label class="composer-file-option"><span class="composer-file-option-label">${icon(option.icon, 16)}<span>${option.label}</span></span><input type="file" ${option.attrs} data-content-file-import data-import-target="${target}" aria-label="${option.aria}"><small data-content-file-status aria-live="polite" hidden></small></label>`).join("");
  return `<details class="composer-add"><summary aria-label="Thêm tệp và tính năng" title="Thêm tệp và tính năng">${icon("plus", 18)}</summary><div class="composer-add-menu" role="group" aria-label="Thêm vào cuộc trò chuyện"><strong>Thêm vào cuộc trò chuyện</strong>${fileImportOptions}${extra}<button type="button" data-page="skills">${icon("notebook-tabs", 16)}<span>Kỹ năng</span></button><small>Tệp văn bản được gửi riêng kèm tin nhắn. Tối đa 20 tệp, tổng 1 MB.</small></div></details>`;
}

export function permissionModeIcon(mode, size = 16) {
  if (mode === "read-only") return icon("hand", size);
  if (mode === "workspace-write") return icon("square-terminal", size);
  return icon("shield-alert", size);
}

export function composerPermissionMenuMarkup(currentPreset = "workspace-write", scope = "home", taskId = "") {
  const options = [
    {
      id: "read-only",
      pillLabel: "Chỉ đọc an toàn",
      title: "Chỉ đọc an toàn",
      desc: "Chỉ phân tích mã nguồn và trả lời, không tự ý sửa tệp trong dự án",
      tone: "default",
    },
    {
      id: "workspace-write",
      pillLabel: "Đọc & sửa dự án",
      title: "Đọc & sửa trong dự án",
      desc: "Cho phép đọc, chỉnh sửa tệp và chạy công cụ trong phạm vi workspace",
      tone: "default",
    },
    {
      id: "full-access",
      pillLabel: "Toàn quyền thực thi",
      title: "Toàn quyền thực thi",
      desc: "Tự động chạy lệnh, cài gói và thao tác tệp trên máy không giới hạn",
      tone: "danger-warn",
    },
  ];
  const current = options.find((item) => item.id === currentPreset) || options[1];
  const isConfig = scope === "home-config";
  const popId = scope === "task" ? "task-permission" : isConfig ? "home-config-permission" : "home-permission";
  const action = scope === "task" ? "pick-task-permission" : "pick-home-permission";
  return `<details class="codex-pop-menu ${isConfig ? "is-down is-wide" : "is-up"} codex-perm-menu ${isConfig ? "home-config-permission-menu" : ""}" data-pop-id="${popId}">
    <summary class="codex-perm-pill ${current.id === "full-access" ? "is-full-access" : ""}" title="Chọn quyền thực thi của Agent">
      ${permissionModeIcon(current.id, 15)}
      <span>${esc(current.pillLabel)}</span>
      ${icon("chevron-down", 12)}
    </summary>
    <div class="codex-pop-card is-permission-card" role="menu" aria-label="Quyền thực thi của Agent">
      <div class="codex-perm-header">
        <span class="codex-perm-title">Quyền thực thi của Agent</span>
      </div>
      <div class="codex-perm-list">
        ${options.map((opt) => {
          const isSelected = opt.id === current.id;
          return `<button type="button" class="codex-perm-option ${isSelected ? "is-selected" : ""} ${opt.tone === "danger-warn" ? "is-full-access" : ""}" data-action="${action}" data-permission="${opt.id}" ${taskId ? `data-id="${esc(taskId)}"` : ""}>
            <span class="codex-perm-option-icon">${permissionModeIcon(opt.id, 18)}</span>
            <span class="codex-perm-option-body">
              <strong>${esc(opt.title)}</strong>
              <small>${esc(opt.desc)}</small>
            </span>
            <span class="codex-perm-option-check">${isSelected ? icon("check", 15) : ""}</span>
          </button>`;
        }).join("")}
      </div>
    </div>
  </details>`;
}

export function contentFileImportField(target) {
  return '<label class="content-file-import">Thêm tệp nội dung<input type="file" accept="' + contentImportAccept + '" multiple data-content-file-import data-import-target="' + esc(target) + '"><small data-content-file-status>Chọn nhiều tệp văn bản cùng lúc, gồm Markdown (.md), TXT, JSON, YAML, CSV, HTML và mã nguồn. Tệp được nối vào nội dung, không lưu riêng.</small></label>';
}

export async function importIntoContentField(input, files) {
  const form = input.closest("form");
  const target = form?.querySelector('textarea[name="' + input.dataset.importTarget + '"]');
  const status = input.closest("label")?.querySelector("[data-content-file-status]");
  try {
    if (!target) throw new Error("Không tìm thấy ô nội dung để nhập tệp.");
    if (files.length > 20) throw new Error("Mỗi lần chỉ có thể nhập tối đa 20 tệp.");
    if (files.some((file) => file.size > 1_000_000) || files.reduce((total, file) => total + file.size, 0) > 1_000_000) throw new Error("Tổng dung lượng tệp mỗi lần nhập tối đa 1 MB.");
    const imported = await Promise.all(files.map(async (file) => {
      const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
      if (!contentImportExtensions.has(extension) || /^\.env(?:\.|$)/i.test(file.name)) throw new Error(`Không hỗ trợ tệp "${file.name}". Hãy chọn tệp văn bản hoặc Markdown.`);
      const content = await file.text();
      if (content.includes("\u0000")) throw new Error(`Tệp "${file.name}" có vẻ là tệp nhị phân; chỉ nhập được nội dung văn bản.`);
      if (!content.trim()) throw new Error(`Tệp "${file.name}" đang trống.`);
      const codeFence = String.fromCharCode(96).repeat(3);
      const path = file.webkitRelativePath || file.name;
      return markdownContentExtensions.has(extension)
        ? `### Nội dung từ tệp: ${path}\n\n${content.trim()}`
        : `### Nội dung từ tệp: ${path}\n\n${codeFence}${extension.slice(1)}\n${content.trim()}\n${codeFence}`;
    }));
    const previous = target.value.trimEnd();
    const next = previous ? previous + "\n\n" + imported.join("\n\n") : imported.join("\n\n");
    if (target.maxLength > 0 && next.length > target.maxLength) throw new Error(`Nội dung sau khi nhập vượt giới hạn ${target.maxLength.toLocaleString("vi-VN")} ký tự; nội dung hiện tại chưa bị thay đổi.`);
    target.value = next;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    if (status) { status.textContent = `Đã nhập ${files.length} tệp.`; status.hidden = false; }
    showToast(`Đã nhập ${files.length} tệp vào nội dung.`);
  } catch (error) {
    if (status) { status.textContent = error.message || "Không thể nhập tệp."; status.hidden = false; }
    showToast(error.message || "Không thể nhập tệp.");
  } finally {
    input.value = "";
  }
}

export function importContentFiles(input) {
  const selected = [...(input.files || [])];
  const files = input.hasAttribute("webkitdirectory")
    ? selected.filter((file) => contentImportExtensions.has(file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || "") && !/^\.env(?:\.|$)/i.test(file.name))
    : selected;
  if (selected.length && !files.length) { showToast("Thư mục không có tệp văn bản hoặc Markdown được hỗ trợ."); input.value = ""; return; }
  if (!files.length) return;
  const form = input.closest("form");
  if (!form || !["home-task", "task-chat"].includes(form.dataset.form)) { void importIntoContentField(input, files); return; }
  const key = composerAttachmentKey(form);
  const current = view.composerAttachments?.[key] || [];
  try {
    if (!form) throw new Error("Không tìm thấy khung chat để gắn tệp.");
    if (current.length + files.length > 20) throw new Error("Mỗi khung chat chỉ hỗ trợ tối đa 20 tệp đính kèm.");
    const totalBytes = [...current.map((item) => item.file.size), ...files.map((file) => file.size)].reduce((sum, size) => sum + size, 0);
    if (files.some((file) => file.size > 1_000_000) || totalBytes > 1_000_000) throw new Error("Tổng dung lượng tệp đính kèm tối đa 1 MB.");
    for (const file of files) {
      const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
      if (!contentImportExtensions.has(extension) || /^\.env(?:\.|$)/i.test(file.name)) throw new Error('Không hỗ trợ tệp "' + file.name + '". Hãy chọn tệp văn bản hoặc Markdown.');
    }
    view.composerAttachments ||= {};
    view.composerAttachments[key] = [...current, ...files.map((file) => ({ id: crypto.randomUUID(), file, path: file.webkitRelativePath || file.name }))];
    input.closest(".composer-add")?.removeAttribute("open");
    render();
    showToast(`Đã đính kèm ${files.length} tệp vào cuộc trò chuyện.`);
  } catch (error) {
    showToast(error.message || "Không thể nhập tệp.");
  } finally {
    input.value = "";
  }
}

export function resizeComposerTextarea(textarea) {
  if (!textarea) return;
  if (!textarea.value) {
    textarea.style.height = "28px";
    return;
  }
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(200, Math.max(28, textarea.scrollHeight))}px`;
}

export async function updateComposerMentionMenu(textarea) {
  const wrap = textarea.closest(".composer-input-wrap");
  const pop = wrap?.querySelector("[data-mention-popover]");
  if (!pop) return;
  const cursor = textarea.selectionStart ?? textarea.value.length;
  const before = textarea.value.slice(0, cursor);
  const match = before.match(/(?:^|\s)@([^\s@]*)$/);
  if (!match) {
    view.mentionMenu = null;
    pop.hidden = true;
    pop.innerHTML = "";
    return;
  }
  const query = match[1].toLowerCase();
  const startPos = cursor - match[1].length - 1;
  const task = view.selected ? view.state?.tasks?.find((t) => t.id === view.selected) : null;
  const wsId = task?.workspaceId || view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || "";
  const files = await ensureWorkspaceFileIndex(wsId);
  const matches = files.filter((f) => !query || f.toLowerCase().includes(query)).slice(0, 8);
  if (!matches.length) {
    view.mentionMenu = null;
    pop.hidden = true;
    pop.innerHTML = "";
    return;
  }
  view.mentionMenu = { query, items: matches, startPos, endPos: cursor };
  pop.innerHTML = `<div class="mention-popover-head">Chèn tệp dự án (@file)</div>${matches.map((f, idx) => `<button type="button" class="mention-option ${idx === 0 ? "is-active" : ""}" data-action="insert-file-mention" data-path="${esc(f)}">${icon("file", 13)}<span>${esc(f)}</span></button>`).join("")}`;
  pop.hidden = false;
}
