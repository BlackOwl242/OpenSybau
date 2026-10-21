import { $, esc, icon, view } from "../../shared/state.js";
import { connectorSupports, providerTitle, providersForRole, roleConfig, workflowRoles } from "../../domain/agent-roles.js";
import { localizeDom } from "../../shared/i18n.js";
import { api, refresh, showToast } from "./runtime.js";

export function applySkillFilter(input) {
  const catalog = input?.closest(".settings-card, .task-skill-picker, .skill-manager");
  if (!catalog) return;
  const query = input.value.trim().toLocaleLowerCase();
  let visible = 0;
  const entries = [...catalog.querySelectorAll("[data-skill-entry]")];
  entries.forEach((entry) => {
    const match = !query || (entry.dataset.skillSearch || "").includes(query);
    entry.hidden = !match;
    if (match) visible++;
  });
  const empty = catalog.querySelector(".skill-filter-empty");
  if (empty) empty.hidden = visible !== 0 || !query;
  const count = catalog.querySelector("[data-skill-result-count]");
  if (count) count.textContent = query ? `${visible}/${entries.length} skill` : `${entries.length} skill`;
}

export function taskProgress(task) {
  if (task.status === "queued") return "Trong hàng đợi";
  if (task.status === "failed") return task.error || "Tiến trình CLI thất bại";
  if (task.status === "cancelled") return "Tiến trình đã dừng";
  if (task.status === "done") return task.config?.workflow === "chat-only" ? "Hội thoại sẵn sàng" : task.phase === "done" ? "Luồng đã hoàn tất" : "Kế hoạch sẵn sàng";
  if (task.phase === "chat") return `${providerTitle(view.connectors, task.config?.chatProvider || "codex")} đang trả lời`;
  const roleId = task.phase === "implementation" ? "build" : task.phase;
  const configured = task.config?.roles?.[roleId] || roleConfig(task.config, roleId);
  const labels = { plan: "đang lập kế hoạch", build: "đang triển khai", review: "đang đánh giá" };
  return configured ? `${providerTitle(view.connectors, configured.provider)} ${labels[roleId] || "đang chạy"}` : "Đang chạy";
}

const effortLabelMap = {
  minimal: "Tối thiểu",
  low: "Thấp",
  medium: "Trung bình",
  standard: "Tiêu chuẩn",
  high: "Cao",
  xhigh: "Rất cao",
  max: "Tối đa",
  ultra: "Siêu cao",
};

export function formatEffortLabel(effort) {
  return effortLabelMap[String(effort || "").toLowerCase()] || effort || "Trung bình";
}

export function normalizedRoleSelection(roleId, overrides = {}) {
  const candidates = providersForRole(view.connectors, roleId);
  const saved = roleConfig(view.state?.settings?.defaults, roleId) || {};
  const provider = candidates.some(([id]) => id === overrides.provider) ? overrides.provider
    : candidates.some(([id]) => id === saved.provider) ? saved.provider : candidates[0]?.[0] || "";
  const connector = view.connectors?.[provider];
  const models = connector?.models || [];
  const model = models.find((item) => item.id === overrides.model) || models.find((item) => item.id === saved.model) || models[0];
  const choices = model?.efforts || [];
  const effort = choices.includes(overrides.effort) ? overrides.effort : choices.includes(saved.effort) ? saved.effort : choices.includes("medium") ? "medium" : choices[0] || "";
  return { provider, model: model?.id || "", effort, candidates };
}

export function rolePickerItems(roleId, field, options, selectedValue) {
  return options.map((option) => {
    const value = String(option.value ?? "");
    const label = String(option.label ?? value);
    const selected = value === selectedValue;
    return `<button type="button" class="codex-pop-item ${selected ? "is-selected" : ""}" data-action="pick-role-option" data-role-id="${esc(roleId)}" data-role-field="${esc(field)}" data-value="${esc(value)}"><span class="codex-pop-item-main"><span>${esc(label)}</span></span>${selected ? icon("check", 13) : ""}</button>`;
  }).join("");
}

export function customSelectControl(name, dataAttribute, options, selectedValue, { disabled = false, up = false, extraClass = "", ariaLabel = "Chọn", popId = "" } = {}) {
  const safeOptions = options.length ? options : [{ value: "", label: "—" }];
  const selected = safeOptions.find((option) => String(option.value) === String(selectedValue)) || safeOptions[0];
  const optionMarkup = safeOptions.map((option) => `<option value="${esc(option.value)}" ${String(option.value) === String(selectedValue) ? "selected" : ""} ${option.disabled ? "disabled" : ""}>${esc(option.label)}</option>`).join("");
  const items = safeOptions.map((option) => `<button type="button" class="codex-pop-item ${String(option.value) === String(selectedValue) ? "is-selected" : ""}" data-action="pick-home-select" data-select-name="${esc(name)}" data-value="${esc(option.value)}" ${option.disabled ? "disabled" : ""}><span class="codex-pop-item-main"><span>${esc(option.label)}</span></span>${String(option.value) === String(selectedValue) ? icon("check", 13) : ""}</button>`).join("");
  const nameAttr = name ? `name="${esc(name)}"` : "";
  const popAttr = popId ? `data-pop-id="${esc(popId)}"` : "";
  return `<div class="custom-select-wrap ${extraClass}"><select hidden ${nameAttr} ${dataAttribute} ${disabled ? "disabled" : ""}>${optionMarkup}</select><details class="codex-pop-menu ${up ? "is-up" : "is-down"} home-config-select" ${popAttr} ${disabled ? 'data-disabled="true"' : ""}><summary class="codex-inline-trigger" aria-label="${esc(ariaLabel)}: ${esc(selected?.label || "—")}" ${disabled ? 'aria-disabled="true" tabindex="-1"' : ""}><span>${esc(selected?.label || "—")}</span>${icon("chevron-down", 12)}</summary><div class="codex-pop-card home-config-select-card"><div class="codex-pop-scroll">${items}</div></div></details></div>`;
}

export function syncCustomSelect(select) {
  const wrap = select?.closest(".custom-select-wrap, .home-config-select-field");
  const picker = wrap?.querySelector("details.home-config-select");
  if (!select || !picker) return;
  const options = [...select.options].map((opt) => ({ value: opt.value, label: opt.textContent || opt.value, disabled: opt.disabled }));
  const selected = options.find((opt) => opt.value === select.value) || options[0];
  const label = selected?.label || "—";
  const trigger = picker.querySelector("summary");
  if (trigger) {
    trigger.querySelector("span")?.replaceChildren(document.createTextNode(label));
    trigger.setAttribute("aria-disabled", String(Boolean(select.disabled || !options.length)));
    trigger.tabIndex = select.disabled || !options.length ? -1 : 0;
  }
  picker.toggleAttribute("data-disabled", Boolean(select.disabled || !options.length));
  const scroll = picker.querySelector(".codex-pop-scroll");
  if (scroll) {
    scroll.innerHTML = options.map((opt) => `<button type="button" class="codex-pop-item ${opt.value === select.value ? "is-selected" : ""}" data-action="pick-home-select" data-select-name="${esc(select.name || "")}" data-value="${esc(opt.value)}" ${opt.disabled ? "disabled" : ""}><span class="codex-pop-item-main"><span>${esc(opt.label)}</span></span>${opt.value === select.value ? icon("check", 13) : ""}</button>`).join("");
  }
  localizeDom(picker, view.language);
}

export function homeSelectField(label, name, dataAttribute, options, selectedValue, disabled = false) {
  const safeOptions = options.length ? options : [{ value: "", label: "—" }];
  const selected = safeOptions.find((option) => String(option.value) === String(selectedValue)) || safeOptions[0];
  const optionMarkup = safeOptions.map((option) => `<option value="${esc(option.value)}" ${String(option.value) === String(selectedValue) ? "selected" : ""} ${option.disabled ? "disabled" : ""}>${esc(option.label)}</option>`).join("");
  const items = safeOptions.map((option) => `<button type="button" class="codex-pop-item ${String(option.value) === String(selectedValue) ? "is-selected" : ""}" data-action="pick-home-select" data-select-name="${esc(name)}" data-value="${esc(option.value)}" ${option.disabled ? "disabled" : ""}><span class="codex-pop-item-main"><span>${esc(option.label)}</span></span>${String(option.value) === String(selectedValue) ? icon("check", 13) : ""}</button>`).join("");
  const nameAttr = name ? `name="${esc(name)}"` : "";
  return `<label class="home-config-select-field">${label}<select hidden ${nameAttr} ${dataAttribute} ${disabled ? "disabled" : ""}>${optionMarkup}</select><details class="codex-pop-menu is-down home-config-select" ${disabled ? 'data-disabled="true"' : ""}><summary class="codex-inline-trigger" aria-label="${label}: ${esc(selected?.label || "—")}" ${disabled ? 'aria-disabled="true" tabindex="-1"' : ""}><span>${esc(selected?.label || "—")}</span>${icon("chevron-down", 12)}</summary><div class="codex-pop-card home-config-select-card"><div class="codex-pop-scroll">${items}</div></div></details></label>`;
}

export function rolePickerField(roleId, field, label, heading, options, selectedValue, groupLabel = "") {
  const selected = options.find((option) => String(option.value ?? "") === selectedValue);
  const disabled = !options.length;
  const name = `${roleId}${field[0].toUpperCase()}${field.slice(1)}`;
  const optionMarkup = options.map((option) => `<option value="${esc(option.value)}" ${String(option.value) === selectedValue ? "selected" : ""}>${esc(option.label)}</option>`).join("");
  return `<label class="agent-role-picker-field"><span>${label}</span><select hidden name="${name}" data-role-${field}="${esc(roleId)}" ${disabled ? "disabled" : "required"}>${optionMarkup || `<option value="">${field === "effort" ? "Không áp dụng" : field === "model" ? "Chưa có model" : "Chưa có agent khả dụng"}</option>`}</select><details class="codex-pop-menu is-down is-right agent-role-picker" data-role-id="${esc(roleId)}" data-role-field="${esc(field)}" data-pop-id="role-${esc(roleId)}-${esc(field)}" ${disabled ? 'data-disabled="true"' : ""}><summary class="codex-inline-trigger is-model" aria-label="${label}: ${esc(selected?.label || (field === "effort" ? "Không áp dụng" : field === "model" ? "Chưa có model" : "Chưa có agent khả dụng"))}" ${disabled ? 'aria-disabled="true" tabindex="-1"' : ""}><span data-role-picker-label>${esc(selected?.label || (field === "effort" ? "Không áp dụng" : field === "model" ? "Chưa có model" : "Chưa có agent khả dụng"))}</span>${icon("chevron-down", 12)}</summary><div class="codex-pop-card is-model-list"><div class="codex-pop-head">${heading}</div><div class="codex-pop-scroll">${groupLabel ? `<div class="codex-pop-group-label" data-role-picker-group>${esc(groupLabel)}</div>` : ""}${rolePickerItems(roleId, field, options, selectedValue)}</div></div></details></label>`;
}

export function syncRolePicker(form, roleId, field) {
  const select = form?.querySelector(`[data-role-${field}="${roleId}"]`);
  const picker = form?.querySelector(`.agent-role-picker[data-role-id="${roleId}"][data-role-field="${field}"]`);
  if (!select || !picker) return;
  const options = [...select.options].map((option) => ({ value: option.value, label: field === "effort" ? formatEffortLabel(option.value || option.textContent) : option.textContent }));
  const selected = options.find((option) => option.value === select.value);
  const label = selected?.label || (field === "effort" ? "Không áp dụng" : field === "model" ? "Chưa có model" : "Chưa có agent khả dụng");
  picker.querySelector("[data-role-picker-label]").textContent = label;
  picker.querySelector("summary").setAttribute("aria-label", `${field === "effort" ? "Mức suy nghĩ" : field === "model" ? "Model" : "Agent"}: ${label}`);
  const group = field === "model" ? `<div class="codex-pop-group-label" data-role-picker-group>${esc(providerTitle(view.connectors, form.querySelector(`[data-role-provider="${roleId}"]`)?.value))}</div>` : "";
  picker.querySelector(".codex-pop-scroll").innerHTML = `${group}${rolePickerItems(roleId, field, options, select.value)}`;
  picker.toggleAttribute("data-disabled", select.disabled || !options.length);
  picker.querySelector("summary").setAttribute("aria-disabled", String(select.disabled || !options.length));
  picker.querySelector("summary").tabIndex = select.disabled || !options.length ? -1 : 0;
  localizeDom(picker, view.language);
}

export function syncRolePickers(form, roleId) {
  for (const field of ["provider", "model", "effort"]) syncRolePicker(form, roleId, field);
}

const roleStationBadgeMap = {
  plan: "Bước 1/6 · AI Lên kế hoạch",
  build: "Bước 3/6 · AI Viết code",
  review: "Bước 4/6 · AI Kiểm tra code",
};

export function roleEditor(roleId, overrides = {}) {
  const role = workflowRoles.find((item) => item.id === roleId);
  if (!role) return "";
  const selection = normalizedRoleSelection(roleId, overrides);
  const connector = view.connectors?.[selection.provider];
  const model = connector?.models?.find((item) => item.id === selection.model);
  const providerOptions = selection.candidates.map(([id, item]) => ({ value: id, label: item.name || id }));
  const modelOptions = (connector?.models || []).map((item) => ({ value: item.id, label: item.name || item.id }));
  const effortOptions = (model?.efforts || []).map((item) => ({ value: item, label: formatEffortLabel(item) }));
  const stationBadge = roleStationBadgeMap[roleId] || "";
  return `<section class="agent-role-card" data-role-card="${roleId}"><header><strong>${esc(role.label)}</strong>${stationBadge ? `<span class="role-station-badge is-${esc(roleId)}">${esc(stationBadge)}</span>` : ""}</header>${rolePickerField(roleId, "provider", "Agent", "Agent & Model", providerOptions, selection.provider)}${rolePickerField(roleId, "model", "Model", "Agent & Model", modelOptions, selection.model, providerTitle(view.connectors, selection.provider))}${rolePickerField(roleId, "effort", "Mức suy nghĩ", "Mức suy nghĩ", effortOptions, selection.effort)}</section>`;
}

export function taskPresetRefValue(id, version) {
  return id && version ? `${id}@${version}` : "";
}

export function parseTaskPresetRef(value) {
  const raw = String(value || "");
  const split = raw.lastIndexOf("@");
  if (split < 1) return null;
  const version = Number(raw.slice(split + 1));
  return Number.isSafeInteger(version) && version > 0 ? { id: raw.slice(0, split), version } : null;
}

export function taskPresetVersionOptionList() {
  const presets = view.state?.settings?.taskPresets || [];
  const versions = presets.flatMap((preset) => (preset.versions || []).map((entry) => ({
    value: taskPresetRefValue(preset.id, entry.version),
    label: `${preset.name} · v${entry.version}`,
  }))).sort((a, b) => a.label.localeCompare(b.label, view.language === "en" ? "en" : "vi"));
  return [{ value: "", label: "Không dùng mẫu" }, ...versions];
}

export function taskPresetVersionOptions(selected = "") {
  return taskPresetVersionOptionList().map((entry) => `<option value="${esc(entry.value)}" ${entry.value === selected ? "selected" : ""}>${esc(entry.label)}</option>`).join("");
}

export function taskPresetToolsMarkup() {
  return `<section class="task-preset-tools" aria-label="Mẫu tác vụ"><header><strong>Mẫu tác vụ</strong><small>Lưu cấu hình luồng, quyền và agent/model theo từng phiên bản.</small></header><div class="task-preset-controls">${homeSelectField("Mẫu đã lưu", "taskPresetVersion", "data-task-preset-version", taskPresetVersionOptionList(), "")}<label>Tên mẫu<input name="taskPresetName" maxlength="80" autocomplete="off" spellcheck="false" placeholder="Ví dụ: Review pull request"></label><div class="task-preset-actions"><button type="button" class="button quiet small" data-action="apply-task-preset" disabled>Áp dụng</button><button type="button" class="button quiet small" data-action="save-task-preset">Lưu phiên bản</button><button type="button" class="button quiet small" data-action="delete-task-preset" disabled>Xóa mẫu</button></div></div><small class="task-preset-note">Không lưu yêu cầu, workspace hoặc trạng thái Git. Chọn mẫu rồi bấm Áp dụng để nạp cấu hình.</small><input type="hidden" name="appliedPresetId"><input type="hidden" name="appliedPresetVersion"></section>`;
}

export function taskPresetVersion(ref) {
  if (!ref) return null;
  const preset = (view.state?.settings?.taskPresets || []).find((item) => item.id === ref.id);
  const version = preset?.versions?.find((item) => Number(item.version) === Number(ref.version));
  return preset && version ? { preset, version } : null;
}

export function syncTaskPresetControls(form) {
  const select = form?.querySelector("[data-task-preset-version]");
  const ref = parseTaskPresetRef(select?.value);
  const resolved = taskPresetVersion(ref);
  const name = form?.querySelector("[name=taskPresetName]");
  const apply = form?.querySelector('[data-action="apply-task-preset"]');
  const remove = form?.querySelector('[data-action="delete-task-preset"]');
  if (resolved && name) name.value = resolved.preset.name;
  if (apply) apply.disabled = !resolved;
  if (remove) remove.disabled = !resolved;
}

export function readTaskPresetProfile(form) {
  const workflow = form.querySelector('[name="workflow"]')?.value || "codex-antigravity";
  const roles = Object.fromEntries(workflowRoles.map((role) => [role.id, {
    provider: form.querySelector(`[name="${role.id}Provider"]`)?.value || "",
    model: form.querySelector(`[name="${role.id}Model"]`)?.value || "",
    effort: form.querySelector(`[name="${role.id}Effort"]`)?.value || "",
  }]));
  return {
    workflow,
    permissionPreset: form.querySelector('[name="permissionPreset"]')?.value || "workspace-write",
    roles,
    chatProvider: form.querySelector('[name="chatProvider"]')?.value || "",
    chatModel: form.querySelector('[name="chatModel"]')?.value || "",
    chatEffort: form.querySelector('[name="chatEffort"]')?.value || "",
  };
}

export function applyTaskPreset(form) {
  const ref = parseTaskPresetRef(form?.querySelector("[data-task-preset-version]")?.value);
  const resolved = taskPresetVersion(ref);
  if (!resolved) throw new Error("Mẫu tác vụ không còn khả dụng. Hãy tải lại danh sách mẫu.");
  const { profile } = resolved.version;
  const wfSelect = form.querySelector('[name="workflow"]');
  const permSelect = form.querySelector('[name="permissionPreset"]');
  if (wfSelect) { wfSelect.value = profile.workflow; syncCustomSelect(wfSelect); }
  if (permSelect) { permSelect.value = profile.permissionPreset; syncCustomSelect(permSelect); }
  syncWorkflow();
  for (const role of workflowRoles) {
    const selection = profile.roles?.[role.id];
    if (!selection) continue;
    const provider = form.querySelector(`[name="${role.id}Provider"]`);
    const model = form.querySelector(`[name="${role.id}Model"]`);
    const effort = form.querySelector(`[name="${role.id}Effort"]`);
    if (!provider || !model || !effort) continue;
    provider.value = selection.provider;
    syncRoleProvider(form, role.id);
    model.value = selection.model;
    syncEffortForModel(form, `[name="${role.id}Model"]`, `[name="${role.id}Effort"]`, `[name="${role.id}Provider"]`);
    effort.value = selection.effort;
  }
  for (const role of workflowRoles) syncRolePickers(form, role.id);
  if (profile.workflow === "chat-only") {
    const provider = form.querySelector('[name="chatProvider"]');
    if (provider) {
      provider.value = profile.chatProvider;
      syncCustomSelect(provider);
      syncChatAgentFields(form);
      const chatMod = form.querySelector('[name="chatModel"]');
      const chatEff = form.querySelector('[name="chatEffort"]');
      if (chatMod) { chatMod.value = profile.chatModel; syncCustomSelect(chatMod); }
      syncEffortForModel(form, '[name="chatModel"]', '[name="chatEffort"]', '[name="chatProvider"]');
      if (chatEff) { chatEff.value = profile.chatEffort; syncCustomSelect(chatEff); }
    }
  }
  form.querySelector('[name="appliedPresetId"]').value = ref.id;
  form.querySelector('[name="appliedPresetVersion"]').value = String(ref.version);
  syncIsolation();
}

export async function saveTaskPreset(form) {
  const name = String(form?.querySelector('[name="taskPresetName"]')?.value || "").trim();
  if (!name) throw new Error("Nhập tên mẫu trước khi lưu.");
  const selectedRef = parseTaskPresetRef(form.querySelector("[data-task-preset-version]")?.value);
  const selected = taskPresetVersion(selectedRef);
  const id = selected && selected.preset.name.toLocaleLowerCase() === name.toLocaleLowerCase() ? selected.preset.id : "";
  const saved = await api("/api/task-presets", {
    method: "POST",
    body: JSON.stringify({ id, name, profile: readTaskPresetProfile(form) }),
  });
  await refresh();
  const newRef = taskPresetRefValue(saved.preset.id, saved.preset.currentVersion);
  const select = form.querySelector("[data-task-preset-version]");
  select.innerHTML = taskPresetVersionOptions(newRef);
  select.value = newRef;
  syncCustomSelect(select);
  form.querySelector('[name="taskPresetName"]').value = saved.preset.name;
  form.querySelector('[name="appliedPresetId"]').value = saved.preset.id;
  form.querySelector('[name="appliedPresetVersion"]').value = String(saved.preset.currentVersion);
  syncTaskPresetControls(form);
  showToast(view.language === "en" ? "Saved " + saved.preset.name + " · v" + saved.preset.currentVersion + "." : "Đã lưu mẫu " + saved.preset.name + " · v" + saved.preset.currentVersion + ".");
}

export async function deleteTaskPreset(form) {
  const ref = parseTaskPresetRef(form?.querySelector("[data-task-preset-version]")?.value);
  const selected = taskPresetVersion(ref);
  if (!selected) throw new Error("Chọn mẫu cần xóa trước.");
  if (!confirm("Xóa toàn bộ phiên bản của mẫu “" + selected.preset.name + "”? Các task đã tạo vẫn giữ bản ghi cấu hình.")) return;
  await api("/api/task-presets/" + encodeURIComponent(selected.preset.id), { method: "DELETE" });
  await refresh();
  const select = form.querySelector("[data-task-preset-version]");
  select.innerHTML = taskPresetVersionOptions();
  select.value = "";
  syncCustomSelect(select);
  form.querySelector('[name="taskPresetName"]').value = "";
  form.querySelector('[name="appliedPresetId"]').value = "";
  form.querySelector('[name="appliedPresetVersion"]').value = "";
  syncTaskPresetControls(form);
  showToast(view.language === "en" ? "Task template deleted." : "Đã xóa mẫu tác vụ.");
}

export function chatAgentEditor(overrides = {}) {
  const { candidates, provider, connector, models, model, effort } = normalizedChatSelection(overrides);
  const providerOptions = candidates.map(([id, item]) => ({ value: id, label: `${item.name || id}${item.kind === "api" ? " · API" : " · CLI"}` }));
  const modelOptions = models.map((item) => ({ value: item.id, label: item.name || item.id }));
  const effortOptions = (model?.efforts || []).map((item) => ({ value: item, label: formatEffortLabel(item) }));
  return `<section class="agent-role-card chat-agent-card"><header><strong>Agent hội thoại</strong><span class="role-station-badge">${connector?.kind === "api" ? "Nguồn API" : connector ? "CLI cục bộ" : "Chưa kết nối"}</span></header>${homeSelectField("Agent", "chatProvider", "data-chat-agent-provider", providerOptions, provider, !providerOptions.length)}${homeSelectField("Model", "chatModel", "data-chat-agent-model", modelOptions, model?.id || "", !modelOptions.length)}${homeSelectField("Mức suy nghĩ", "chatEffort", "data-chat-agent-effort", effortOptions, effort, !effortOptions.length)}</section>`;
}

export function normalizedChatSelection(overrides = {}) {
  const candidates = Object.entries(view.connectors || {}).filter(([, connector]) => connectorSupports(connector, "chat"));
  const saved = view.state?.settings?.defaults || {};
  const provider = candidates.some(([id]) => id === overrides.provider) ? overrides.provider
    : candidates.some(([id]) => id === saved.chatProvider) ? saved.chatProvider : candidates[0]?.[0] || "";
  const connector = view.connectors?.[provider];
  const models = connector?.models || [];
  const model = models.find((item) => item.id === overrides.model) || models.find((item) => item.id === saved.chatModel) || models[0];
  const effort = model?.efforts?.includes(overrides.effort) ? overrides.effort : model?.efforts?.includes(saved.chatEffort) ? saved.chatEffort : model?.efforts?.includes("medium") ? "medium" : model?.efforts?.[0] || "";
  return { candidates, provider, connector, models, model, effort };
}

export function workflowSummary(task) {
  return workflowRoles.map((role) => providerTitle(view.connectors, task.config?.roles?.[role.id]?.provider || roleConfig(task.config, role.id)?.provider)).join(" → ");
}

export function syncWorkflow() {
  const select = $(".modal select[name=workflow], .home-composer select[name=workflow]");
  if (!select) return;
  const form = select.closest("form");
  const roles = form?.querySelector(".agent-role-grid");
  const chat = form?.querySelector(".chat-agent-role");
  if (roles) roles.hidden = select.value === "chat-only";
  if (chat) chat.hidden = select.value !== "chat-only";
  for (const role of workflowRoles) {
    const card = form?.querySelector(`[data-role-card="${role.id}"]`);
    if (card) {
      const visible = select.value !== "chat-only" && (select.value !== "plan-only" || role.id === "plan");
      card.hidden = !visible;
      card.querySelectorAll("select").forEach((input) => { input.disabled = !visible || !card.querySelector(`[data-role-model="${role.id}"]`)?.options.length; });
      syncRolePickers(form, role.id);
    }
  }
  if (select.value === "chat-only") syncChatAgentFields(form);
}

export function syncProviderModelControls(form, provider, modelSelector, effortSelector) {
  const connector = view.connectors?.[provider];
  const modelSelect = form?.querySelector(modelSelector);
  const effortSelect = form?.querySelector(effortSelector);
  if (!modelSelect || !effortSelect) return;
  const models = connector?.models || [];
  const isHomeChat = Boolean(form?.classList.contains("home-composer") && !form.dataset.splitChatCreate && modelSelector === "[data-chat-agent-model]" && (!view.homeChatProvider || view.homeChatProvider === provider));
  const preferredModel = (isHomeChat && view.homeChatModel ? view.homeChatModel : "") || modelSelect.value;
  const selectedModel = models.find((item) => item.id === preferredModel) || models[0];
  modelSelect.innerHTML = models.map((model) => `<option value="${esc(model.id)}" ${model.id === selectedModel?.id ? "selected" : ""}>${esc(model.name)}</option>`).join("") || `<option value="">Chưa có model</option>`;
  if (selectedModel) modelSelect.value = selectedModel.id;
  modelSelect.disabled = !models.length;
  syncCustomSelect(modelSelect);
  const effortsForModel = selectedModel?.efforts || [];
  const preferredEffort = (isHomeChat && view.homeChatEffort ? view.homeChatEffort : "") || effortSelect.value;
  const selectedEffort = effortsForModel.includes(preferredEffort) ? preferredEffort : (effortsForModel.includes("medium") ? "medium" : effortsForModel[0] || "");
  effortSelect.innerHTML = effortsForModel.map((effort) => `<option value="${esc(effort)}" ${effort === selectedEffort ? "selected" : ""}>${esc(formatEffortLabel(effort))}</option>`).join("") || `<option value="">Không áp dụng</option>`;
  if (selectedEffort) effortSelect.value = selectedEffort;
  effortSelect.disabled = !effortsForModel.length;
  syncCustomSelect(effortSelect);
}

export function syncEffortForModel(form, modelSelector, effortSelector, providerSelector) {
  const modelId = form?.querySelector(modelSelector)?.value;
  const provider = form?.querySelector(providerSelector)?.value;
  const model = view.connectors?.[provider]?.models?.find((item) => item.id === modelId);
  const effortSelect = form?.querySelector(effortSelector);
  if (!effortSelect || !model) return;
  const options = model.efforts || [];
  const preferredEffort = effortSelect.value;
  const selectedEffort = options.includes(preferredEffort) ? preferredEffort : (options.includes("medium") ? "medium" : options[0] || "");
  effortSelect.innerHTML = options.map((effort) => `<option value="${esc(effort)}" ${effort === selectedEffort ? "selected" : ""}>${esc(formatEffortLabel(effort))}</option>`).join("") || `<option value="">Không áp dụng</option>`;
  if (selectedEffort) effortSelect.value = selectedEffort;
  effortSelect.disabled = !options.length;
  syncCustomSelect(effortSelect);
}

export function syncRoleProvider(form, roleId) {
  const provider = form?.querySelector(`[data-role-provider="${roleId}"]`)?.value || "";
  syncProviderModelControls(form, provider, `[data-role-model="${roleId}"]`, `[data-role-effort="${roleId}"]`);
}

export function syncChatAgentFields(form) {
  const provider = form?.querySelector("[data-chat-agent-provider]")?.value || "";
  syncProviderModelControls(form, provider, "[data-chat-agent-model]", "[data-chat-agent-effort]");
}

export function syncIsolation() {
  const workspaceId = $(".modal select[name=workspaceId]")?.value;
  const workspace = view.state?.workspaces?.find((w) => w.id === workspaceId);
  const check = $(".modal input[name=isolated]");
  const note = $("#isolation-note");
  if (!check || !workspace) return;
  const runtime = workspace.runtime;
  const canIsolate = runtime?.isGit && runtime?.head;
  check.disabled = !canIsolate;
  if (!canIsolate) {
    check.checked = false;
    note.textContent = "Workspace này chưa có commit Git; chạy tuần tự trên thư mục hiện tại.";
  } else {
    note.textContent = runtime.dirty
      ? "Worktree mới bắt đầu từ commit hiện tại; thay đổi chưa commit ở workspace gốc không được sao chép."
      : `Worktree mới từ nhánh ${runtime.branch || "hiện tại"}.`;
  }
}
