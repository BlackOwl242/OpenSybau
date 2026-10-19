import { $, efforts, esc, fmtDate, formatNumber, icon, statuses, tokenCount, view } from "../../shared/state.js";
import { orchestrationNodes } from "../../domain/task-flow.js";
import { connectorSupports, providerTitle, providersForRole, roleConfig, workflowRoles } from "../../domain/agent-roles.js";
import { cliConnectionStatus, cliProviderGuides } from "../../domain/provider-guides.js";
import { localizeDom, setLanguage, translateText } from "../../shared/i18n.js";
import { THEMES, THEME_GROUPS, applyThemeToDom, getThemeDefinition, setSavedThemeId } from "../../shared/themes.js";
import { updateWorkbenchShell } from "../../shell/mount.jsx";
import { readBrowserRoute, syncBrowserRoute } from "../../shell/router.js";
import { compactChatTitle } from "../../shared/chat-labels.js";
import { createStateLoader } from "../../shared/state-sync.js";

Object.assign(view, readBrowserRoute());
const compactLayout = window.matchMedia("(max-width: 1020px)");
if (compactLayout.matches) view.chatDrawerOpen = false;
compactLayout.addEventListener("change", ({ matches }) => {
  if (matches) {
    view.chatDrawerOpen = false;
    view.stageSplit = false;
    render();
  }
});
document.documentElement.lang = view.language;
applyThemeToDom(view.theme);
if (window.opensybauDesktop?.isDesktop) document.documentElement.classList.add("desktop-glass");
let browserRouteInitialized = false;
let replaceBrowserRoute = false;
let routeNeedsHydration = view.page === "knowledge" || view.page === "workspaces" && Boolean(view.selected);
let refreshPromise = null;
let refreshInFlight = null;
let refreshPending = false;
let refreshAgain = false;
let refreshConfiguration = false;
let refreshForeground = false;
let refreshTimer = null;
let lastSnapshotRefresh = 0;
const loadState = createStateLoader();
let lastConfigurationRefresh = 0;
let cliScanPromise = null;
let cliScanInProgress = false;
let activityChartCache = { key: "", buckets: null, total: 0 };

function syncLocation() {
  syncBrowserRoute(view, { replace: !browserRouteInitialized || replaceBrowserRoute });
  browserRouteInitialized = true;
  replaceBrowserRoute = false;
}

function normalizeRouteSelection() {
  if (!view.state) return;
  const selectedExists = view.page === "workspaces"
    ? view.state.workspaces.some((workspace) => workspace.id === view.selected)
    : ["chat", "flows"].includes(view.page) && view.state.tasks.some((task) => task.id === view.selected);
  if (view.selected && !selectedExists) {
    view.selected = null;
    view.workspaceDir = "";
    replaceBrowserRoute = true;
  }
}

async function hydrateRouteData() {
  if (!view.state) return;
  if (view.page === "workspaces" && view.selected) await loadWorkspaceDir(view.selected, view.workspaceDir);
  else if (view.page === "knowledge" && view.state.settings.vaultPath) await loadVaultDir(view.vaultDir);
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
  return data;
}
async function refreshSnapshot(includeConfiguration, background) {
  const statePromise = loadState();
  const configurationPromise = includeConfiguration
    ? Promise.all([api("/api/connectors"), api("/api/providers").catch(() => ({ providers: [] }))])
    : Promise.resolve(null);
  const [{ state, changed }, configuration] = await Promise.all([statePromise, configurationPromise]);
  lastSnapshotRefresh = Date.now();
  if (!changed && !configuration && background && view.skillsLoaded) return;
  const skills = view.skillsLoaded ? { skills: view.skills } : await api("/api/skills").catch(() => ({ skills: [] }));
  view.state = state;
  if (configuration) {
    view.connectors = configuration[0];
    view.providers = configuration[1].providers || [];
    lastConfigurationRefresh = Date.now();
  }
  view.skills = skills.skills || [];
  view.skillsLoaded = true;
  view.settingsSupported = Object.hasOwn(state.settings, "defaults");
  normalizeRouteSelection();
  render({ background });
  if (routeNeedsHydration) {
    routeNeedsHydration = false;
    hydrateRouteData().catch((error) => showToast(error.message));
  }
}
function refresh({ configuration = false, background = false } = {}) {
  refreshAgain = true;
  refreshForeground ||= !background;
  refreshConfiguration ||= configuration || !view.connectors;
  if (refreshInFlight) {
    refreshPending = true;
    return refreshInFlight;
  }
  refreshInFlight = refreshPromise = (async () => {
    try {
      while (refreshAgain) {
        refreshAgain = false;
        const includeConfiguration = refreshConfiguration;
        const foreground = refreshForeground;
        refreshConfiguration = false;
        refreshForeground = false;
        if (!foreground) {
          const wait = 600 - (Date.now() - lastSnapshotRefresh);
          if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        }
        await refreshSnapshot(includeConfiguration, !foreground);
      }
    } catch (error) {
      refreshAgain = false;
      showToast(error.message);
    }
  })().finally(() => {
    refreshInFlight = null;
    refreshPromise = null;
    if (refreshPending) {
      refreshPending = false;
      scheduleRefresh(80);
    }
  });
  return refreshInFlight;
}
function scheduleRefresh(delay = 160) {
  if (document.hidden) return;
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => { refreshTimer = null; void refresh({ background: true }); }, delay);
}
// SSE reloads only task state. CLI discovery can start several processes, so it runs on demand.
function applySkillFilter(input) {
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
function taskProgress(task) {
  if (task.status === "queued") return "Trong hàng đợi";
  if (task.status === "failed") return task.error || "Tiến trình CLI thất bại";
  if (task.status === "cancelled") return "Tiến trình đã dừng";
  if (task.status === "done") return task.config?.workflow === "chat-only" ? "Hội thoại sẵn sàng" : task.phase === "done" ? "Luồng đã hoàn tất" : "Kế hoạch sẵn sàng";
  if (task.phase === "chat") return `${providerTitle(view.connectors, task.config?.chatProvider || "codex")} đang trả lời`;
  const roleId = task.phase === "implementation" ? "build" : task.phase;
  const configured = task.config?.roles?.[roleId] || roleConfig(task.config, roleId);
  const labels = { plan: "đang lập kế hoạch", build: "đang triển khai", review: "đang review" };
  return configured ? `${providerTitle(view.connectors, configured.provider)} ${labels[roleId] || "đang chạy"}` : "Đang chạy";
}
function normalizedRoleSelection(roleId, overrides = {}) {
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
function rolePickerItems(roleId, field, options, selectedValue) {
  return options.map((option) => {
    const value = String(option.value ?? "");
    const label = String(option.label ?? value);
    const selected = value === selectedValue;
    return `<button type="button" class="codex-pop-item ${selected ? "is-selected" : ""}" data-action="pick-role-option" data-role-id="${esc(roleId)}" data-role-field="${esc(field)}" data-value="${esc(value)}"><span class="codex-pop-item-main"><span>${esc(label)}</span></span>${selected ? icon("check", 13) : ""}</button>`;
  }).join("");
}

function homeSelectField(label, name, dataAttribute, options, selectedValue, disabled = false) {
  const selected = options.find((option) => String(option.value) === String(selectedValue)) || options[0];
  const optionMarkup = options.map((option) => `<option value="${esc(option.value)}" ${String(option.value) === String(selectedValue) ? "selected" : ""} ${option.disabled ? "disabled" : ""}>${esc(option.label)}</option>`).join("");
  const items = options.map((option) => `<button type="button" class="codex-pop-item ${String(option.value) === String(selectedValue) ? "is-selected" : ""}" data-action="pick-home-select" data-select-name="${esc(name)}" data-value="${esc(option.value)}" ${option.disabled ? "disabled" : ""}><span class="codex-pop-item-main"><span>${esc(option.label)}</span></span>${String(option.value) === String(selectedValue) ? icon("check", 13) : ""}</button>`).join("");
  return `<label class="home-config-select-field">${label}<select hidden name="${esc(name)}" ${dataAttribute} ${disabled ? "disabled" : ""}>${optionMarkup}</select><details class="codex-pop-menu is-down home-config-select" ${disabled ? 'data-disabled="true"' : ""}><summary class="codex-inline-trigger" aria-label="${label}: ${esc(selected?.label || "—")}" ${disabled ? 'aria-disabled="true" tabindex="-1"' : ""}><span>${esc(selected?.label || "—")}</span>${icon("chevron-down", 12)}</summary><div class="codex-pop-card home-config-select-card"><div class="codex-pop-scroll">${items}</div></div></details></label>`;
}
function rolePickerField(roleId, field, label, heading, options, selectedValue, groupLabel = "") {
  const selected = options.find((option) => String(option.value ?? "") === selectedValue);
  const disabled = !options.length;
  const name = `${roleId}${field[0].toUpperCase()}${field.slice(1)}`;
  const optionMarkup = options.map((option) => `<option value="${esc(option.value)}" ${String(option.value) === selectedValue ? "selected" : ""}>${esc(option.label)}</option>`).join("");
  return `<label class="agent-role-picker-field"><span>${label}</span><select hidden name="${name}" data-role-${field}="${esc(roleId)}" ${disabled ? "disabled" : "required"}>${optionMarkup || `<option value="">${field === "effort" ? "Không áp dụng" : field === "model" ? "Chưa có model" : "Chưa có agent khả dụng"}</option>`}</select><details class="codex-pop-menu is-down is-right agent-role-picker" data-role-id="${esc(roleId)}" data-role-field="${esc(field)}" data-pop-id="role-${esc(roleId)}-${esc(field)}" ${disabled ? 'data-disabled="true"' : ""}><summary class="codex-inline-trigger is-model" aria-label="${label}: ${esc(selected?.label || (field === "effort" ? "Không áp dụng" : field === "model" ? "Chưa có model" : "Chưa có agent khả dụng"))}" ${disabled ? 'aria-disabled="true" tabindex="-1"' : ""}><span data-role-picker-label>${esc(selected?.label || (field === "effort" ? "Không áp dụng" : field === "model" ? "Chưa có model" : "Chưa có agent khả dụng"))}</span>${icon("chevron-down", 12)}</summary><div class="codex-pop-card is-model-list"><div class="codex-pop-head">${heading}</div><div class="codex-pop-scroll">${groupLabel ? `<div class="codex-pop-group-label" data-role-picker-group>${esc(groupLabel)}</div>` : ""}${rolePickerItems(roleId, field, options, selectedValue)}</div></div></details></label>`;
}
function syncRolePicker(form, roleId, field) {
  const select = form?.querySelector(`[data-role-${field}="${roleId}"]`);
  const picker = form?.querySelector(`.agent-role-picker[data-role-id="${roleId}"][data-role-field="${field}"]`);
  if (!select || !picker) return;
  const options = [...select.options].map((option) => ({ value: option.value, label: option.textContent }));
  const selected = options.find((option) => option.value === select.value);
  const label = selected?.label || (field === "effort" ? "Không áp dụng" : field === "model" ? "Chưa có model" : "Chưa có agent khả dụng");
  picker.querySelector("[data-role-picker-label]").textContent = label;
  picker.querySelector("summary").setAttribute("aria-label", `${field === "effort" ? "Mức suy nghĩ" : field === "model" ? "Model" : "Agent"}: ${label}`);
  const group = field === "model" ? `<div class="codex-pop-group-label" data-role-picker-group>${esc(providerTitle(view.connectors, form.querySelector(`[data-role-provider="${roleId}"]`)?.value))}</div>` : "";
  picker.querySelector(".codex-pop-scroll").innerHTML = `${group}${rolePickerItems(roleId, field, options, select.value)}`;
  picker.toggleAttribute("data-disabled", select.disabled || !options.length);
  picker.querySelector("summary").setAttribute("aria-disabled", String(select.disabled || !options.length));
  picker.querySelector("summary").tabIndex = select.disabled || !options.length ? -1 : 0;
}
function syncRolePickers(form, roleId) {
  for (const field of ["provider", "model", "effort"]) syncRolePicker(form, roleId, field);
}
function roleEditor(roleId, overrides = {}) {
  const role = workflowRoles.find((item) => item.id === roleId);
  if (!role) return "";
  const selection = normalizedRoleSelection(roleId, overrides);
  const connector = view.connectors?.[selection.provider];
  const model = connector?.models?.find((item) => item.id === selection.model);
  const providerOptions = selection.candidates.map(([id, item]) => ({ value: id, label: `${item.name || id}${item.kind === "api" ? " · API" : " · CLI"}` }));
  const modelOptions = (connector?.models || []).map((item) => ({ value: item.id, label: item.name || item.id }));
  const effortOptions = (model?.efforts || []).map((item) => ({ value: item, label: item }));
  const providerHint = connector?.kind === "api" ? roleId === "build" ? "API ngoài · trả nội dung tệp" : "API ngoài · gửi ngữ cảnh" : connector ? "Agent cục bộ" : "Chưa có provider sẵn sàng";
  return `<section class="agent-role-card" data-role-card="${roleId}"><header><strong>${role.label}</strong><small>${selection.candidates.length ? esc(providerHint) : "Chưa có provider sẵn sàng"}</small></header>${rolePickerField(roleId, "provider", "Agent", "Agent & Model", providerOptions, selection.provider)}${rolePickerField(roleId, "model", "Model", "Agent & Model", modelOptions, selection.model, providerTitle(view.connectors, selection.provider))}${rolePickerField(roleId, "effort", "Mức suy nghĩ", "Mức suy nghĩ", effortOptions, selection.effort)}</section>`;
}
function taskPresetRefValue(id, version) { return id && version ? `${id}@${version}` : ""; }
function parseTaskPresetRef(value) {
  const raw = String(value || "");
  const split = raw.lastIndexOf("@");
  if (split < 1) return null;
  const version = Number(raw.slice(split + 1));
  return Number.isSafeInteger(version) && version > 0 ? { id: raw.slice(0, split), version } : null;
}
function taskPresetVersionOptions(selected = "") {
  const presets = view.state?.settings?.taskPresets || [];
  const versions = presets.flatMap((preset) => (preset.versions || []).map((entry) => ({
    value: taskPresetRefValue(preset.id, entry.version),
    label: `${preset.name} · v${entry.version}`,
  }))).sort((a, b) => a.label.localeCompare(b.label, view.language === "en" ? "en" : "vi"));
  return `<option value="">Không dùng mẫu</option>${versions.map((entry) => `<option value="${esc(entry.value)}" ${entry.value === selected ? "selected" : ""}>${esc(entry.label)}</option>`).join("")}`;
}
function taskPresetToolsMarkup() {
  return `<section class="task-preset-tools" aria-label="Mẫu tác vụ"><header><strong>Mẫu tác vụ</strong><small>Lưu cấu hình luồng, quyền và agent/model theo từng phiên bản.</small></header><div class="task-preset-controls"><label>Mẫu đã lưu<select name="taskPresetVersion" data-task-preset-version>${taskPresetVersionOptions()}</select></label><label>Tên mẫu<input name="taskPresetName" maxlength="80" autocomplete="off" spellcheck="false" placeholder="Ví dụ: Review pull request"></label><div class="task-preset-actions"><button type="button" class="button quiet small" data-action="apply-task-preset" disabled>Áp dụng</button><button type="button" class="button quiet small" data-action="save-task-preset">Lưu phiên bản</button><button type="button" class="button quiet small" data-action="delete-task-preset" disabled>Xóa mẫu</button></div></div><small class="task-preset-note">Không lưu yêu cầu, workspace hoặc trạng thái Git. Chọn mẫu rồi bấm Áp dụng để nạp cấu hình.</small><input type="hidden" name="appliedPresetId"><input type="hidden" name="appliedPresetVersion"></section>`;
}
function taskPresetVersion(ref) {
  if (!ref) return null;
  const preset = (view.state?.settings?.taskPresets || []).find((item) => item.id === ref.id);
  const version = preset?.versions?.find((item) => Number(item.version) === Number(ref.version));
  return preset && version ? { preset, version } : null;
}
function syncTaskPresetControls(form) {
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
function readTaskPresetProfile(form) {
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
function applyTaskPreset(form) {
  const ref = parseTaskPresetRef(form?.querySelector("[data-task-preset-version]")?.value);
  const resolved = taskPresetVersion(ref);
  if (!resolved) throw new Error("Mẫu tác vụ không còn khả dụng. Hãy tải lại danh sách mẫu.");
  const { profile } = resolved.version;
  form.querySelector('[name="workflow"]').value = profile.workflow;
  form.querySelector('[name="permissionPreset"]').value = profile.permissionPreset;
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
      syncChatAgentFields(form);
      form.querySelector('[name="chatModel"]').value = profile.chatModel;
      syncEffortForModel(form, '[name="chatModel"]', '[name="chatEffort"]', '[name="chatProvider"]');
      form.querySelector('[name="chatEffort"]').value = profile.chatEffort;
    }
  }
  form.querySelector('[name="appliedPresetId"]').value = ref.id;
  form.querySelector('[name="appliedPresetVersion"]').value = String(ref.version);
  syncIsolation();
}
async function saveTaskPreset(form) {
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
  form.querySelector('[name="taskPresetName"]').value = saved.preset.name;
  form.querySelector('[name="appliedPresetId"]').value = saved.preset.id;
  form.querySelector('[name="appliedPresetVersion"]').value = String(saved.preset.currentVersion);
  syncTaskPresetControls(form);
  showToast(view.language === "en" ? "Saved " + saved.preset.name + " · v" + saved.preset.currentVersion + "." : "Đã lưu mẫu " + saved.preset.name + " · v" + saved.preset.currentVersion + ".");
}
async function deleteTaskPreset(form) {
  const ref = parseTaskPresetRef(form?.querySelector("[data-task-preset-version]")?.value);
  const selected = taskPresetVersion(ref);
  if (!selected) throw new Error("Chọn mẫu cần xóa trước.");
  if (!confirm("Xóa toàn bộ phiên bản của mẫu “" + selected.preset.name + "”? Các task đã tạo vẫn giữ bản ghi cấu hình.")) return;
  await api("/api/task-presets/" + encodeURIComponent(selected.preset.id), { method: "DELETE" });
  await refresh();
  const select = form.querySelector("[data-task-preset-version]");
  select.innerHTML = taskPresetVersionOptions();
  select.value = "";
  form.querySelector('[name="taskPresetName"]').value = "";
  form.querySelector('[name="appliedPresetId"]').value = "";
  form.querySelector('[name="appliedPresetVersion"]').value = "";
  syncTaskPresetControls(form);
  showToast(view.language === "en" ? "Task template deleted." : "Đã xóa mẫu tác vụ.");
}
function chatAgentEditor(overrides = {}) {
  const { candidates, provider, connector, models, model, effort } = normalizedChatSelection(overrides);
  const providerOptions = candidates.map(([id, item]) => ({ value: id, label: `${item.name || id}${item.kind === "api" ? " · API" : " · CLI"}` }));
  const modelOptions = models.map((item) => ({ value: item.id, label: item.name || item.id }));
  const effortOptions = (model?.efforts || []).map((item) => ({ value: item, label: item }));
  return `<section class="agent-role-card chat-agent-card"><header><strong>Agent hội thoại</strong><small>${connector?.kind === "api" ? "API bên ngoài · không có quyền workspace" : connector ? "Agent cục bộ" : "Chưa có provider sẵn sàng"}</small></header>${homeSelectField("Agent", "chatProvider", "data-chat-agent-provider", providerOptions, provider, !providerOptions.length)}${homeSelectField("Model", "chatModel", "data-chat-agent-model", modelOptions, model?.id || "", !modelOptions.length)}${homeSelectField("Mức suy nghĩ", "chatEffort", "data-chat-agent-effort", effortOptions, effort, !effortOptions.length)}</section>`;
}
function normalizedChatSelection(overrides = {}) {
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
function workflowSummary(task) {
  return workflowRoles.map((role) => providerTitle(view.connectors, task.config?.roles?.[role.id]?.provider || roleConfig(task.config, role.id)?.provider)).join(" → ");
}
function taskRow(task) {
  const workspace = view.state.workspaces.find((w) => w.id === task.workspaceId);
  const hasChatError = (task.chatMessages || []).some((message) => message.status === "failed");
  const roleId = task.phase === "implementation" ? "build" : task.phase;
  const provider = task.phase === "chat" ? providerTitle(view.connectors, task.chatQueue?.[0]?.provider || task.config.chatProvider || "codex") : providerTitle(view.connectors, task.config?.roles?.[roleId]?.provider || roleConfig(task.config, roleId)?.provider || "codex");
  return `<button class="task-row ${view.selected === task.id ? "selected" : ""}" data-task="${esc(task.id)}">
    <span class="task-state state-${esc(task.status)}"><i></i></span>
    <span class="task-primary"><strong>${esc(task.title)}</strong><small>${esc(workspace?.name || task.workspacePath)} <b>·</b> ${hasChatError ? "Có tin nhắn chat lỗi cần xem" : esc(taskProgress(task))}</small></span>
    <span class="task-agent">${task.status === "running" ? `<i class="spin"></i>${esc(provider)}` : task.status === "queued" ? "Queue" : esc(task.config.workflow === "chat-only" ? `Chat · ${providerTitle(view.connectors, task.config.chatProvider)}` : task.config.workflow === "plan-only" ? providerTitle(view.connectors, task.config?.roles?.plan?.provider || roleConfig(task.config, "plan")?.provider) : workflowSummary(task))}</span>
    <span class="task-date">${fmtDate(task.updatedAt)}</span>
    <span class="task-chevron">${icon("chevron-right", 16)}</span>
  </button>`;
}
function activityChart() {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const start = Math.floor(now / hour) * hour - 23 * hour;
  const tasks = view.state.tasks;
  const key = `${start}:${tasks.map((task) => `${task.id}:${task.events?.length || 0}:${task.events?.at(-1)?.at || ""}`).join("|")}`;
  if (activityChartCache.key !== key) {
    const buckets = Array.from({ length: 24 }, (_, index) => ({ start: start + index * hour, events: [0, 0, 0] }));
    let total = 0;
    for (const task of tasks) for (const event of task.events || []) {
      const at = Date.parse(event.at);
      const index = Math.floor((at - start) / hour);
      if (!Number.isFinite(at) || index < 0 || index >= buckets.length) continue;
      const kind = String(event.kind || "info").toLowerCase();
      const series = ["error", "warning"].includes(kind) ? 2 : kind === "success" ? 1 : 0;
      buckets[index].events[series]++;
      total++;
    }
    activityChartCache = { key, buckets, total };
  }
  const { buckets, total } = activityChartCache;
  const max = Math.max(1, ...buckets.map((bucket) => bucket.events.reduce((sum, value) => sum + value, 0)));
  const width = 960, height = 150, left = 15, right = 15, top = 12, baseline = 112;
  const slot = (width - left - right) / buckets.length;
  const barWidth = Math.min(20, slot * .58);
  const bars = buckets.map((bucket, index) => {
    const x = left + index * slot + (slot - barWidth) / 2;
    let y = baseline;
    const sum = bucket.events.reduce((a, b) => a + b, 0);
    const pieces = sum === 0 ? `<rect class="activity-zero" x="${x.toFixed(1)}" y="${(baseline - 2).toFixed(1)}" width="${barWidth.toFixed(1)}" height="2" rx="1"/>` : bucket.events.map((value, series) => {
      if (!value) return "";
      const barHeight = Math.max(2, value / max * (baseline - top));
      y -= barHeight;
      return `<rect class="activity-bar activity-bar-${series}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="2"/>`;
    }).join("");
    const label = new Intl.DateTimeFormat(view.language === "en" ? "en-US" : "vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date(bucket.start));
    const title = `${label}: ${sum} sự kiện · ${bucket.events[0]} cập nhật, ${bucket.events[1]} hoàn tất, ${bucket.events[2]} cảnh báo/lỗi`;
    const tick = index % 6 === 0 || index === 23 ? `<text class="activity-axis-label" x="${(x + barWidth / 2).toFixed(1)}" y="136" text-anchor="middle">${label}</text>` : "";
    return `<g role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>${pieces}${tick}</g>`;
  }).join("");
  const series = [["Cập nhật", 0], ["Hoàn tất", 1], ["Cảnh báo / lỗi", 2]];
  return `<section class="activity-card" aria-labelledby="activity-title"><header class="activity-header"><div><h2 id="activity-title">Hoạt động · 24 giờ</h2><p>${total} sự kiện · task thật</p></div><span class="stream-status ${view.streamConnected ? "connected" : "disconnected"}"><i></i>${view.streamConnected ? "Đang nhận cập nhật" : "Đang kết nối lại"}</span></header>
    <div class="activity-chart-wrap"><svg class="activity-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Biểu đồ sự kiện task theo giờ trong 24 giờ qua"><line class="activity-baseline" x1="${left}" y1="${baseline}" x2="${width - right}" y2="${baseline}"/>${bars}</svg></div><footer class="activity-legend">${series.map(([label, index]) => `<span><i class="activity-key activity-bar-${index}"></i>${label}</span>`).join("")}<small>Di chuột vào cột để xem số liệu theo giờ</small></footer>${total ? "" : `<p class="activity-empty">Chưa có sự kiện task trong 24 giờ qua.</p>`}
  </section>`;
}
function taskPage() {
  const all = view.state.tasks.filter((task) => !task.archived);
  const hasRecordedError = (task) => task.status === "failed" || (task.events || []).some((event) => event.kind === "error") || (task.chatMessages || []).some((message) => message.status === "failed");
  const visible = all.filter((task) => view.filter === "all" || (view.filter === "failed" ? hasRecordedError(task) : task.status === view.filter));
  const running = all.filter((task) => task.status === "running").length;
  const queued = all.filter((task) => task.status === "queued").length;
  const completed = all.filter((task) => task.status === "done").length;
  return `<div class="page-head"><div><div class="eyebrow">LOCAL TASKS</div><h1>Công việc</h1><p>Tạo việc thật trong repository bạn chọn, xem tiến độ và đầu ra trực tiếp.</p></div><button class="button primary" data-action="${view.state.workspaces.length ? "new-task" : "add-workspace"}">${icon("plus", 15)} ${view.state.workspaces.length ? "Tạo task" : "Thêm dự án"}</button></div>
  <div class="quick-stats"><div><small>Đang chạy</small><strong>${running}</strong></div><div><small>Đang chờ</small><strong>${queued}</strong></div><div><small>Hoàn tất</small><strong>${completed}</strong></div><div class="stats-note">Dữ liệu lấy từ task đã chạy trong OpenSybau này.</div></div>
  ${activityChart()}
  <div class="list-toolbar"><div class="filters">${[["all", "Tất cả"], ["running", "Đang chạy"], ["queued", "Chờ"], ["done", "Xong"], ["failed", "Lỗi"], ["cancelled", "Đã dừng"]].map(([key, label]) => `<button class="filter ${view.filter === key ? "active" : ""}" data-filter="${key}">${label}</button>`).join("")}</div><span>${all.length} task đã ghi trên máy này</span></div>
  <section class="task-list">${visible.length ? visible.map(taskRow).join("") : `<div class="empty-state"><div class="empty-symbol">${icon("folder-code", 18)}</div><strong>${all.length ? "Không có task trong bộ lọc này" : view.state.workspaces.length ? "Chưa có task nào được chạy" : "Thêm repository của bạn để bắt đầu"}</strong><p>${all.length ? "Chọn bộ lọc khác để xem task." : view.state.workspaces.length ? "Task tiếp theo sẽ chạy trong đúng workspace đã đăng ký và lịch sử sẽ được lưu cục bộ." : "OpenSybau chỉ chạy trong thư mục bạn chỉ định. Hãy thêm đường dẫn repository hoặc thư mục ứng dụng trước; thư mục cài đặt ứng dụng không được tự coi là dự án của bạn."}</p>${all.length ? "" : view.state.workspaces.length ? `<button class="button primary" data-action="new-task">${icon("plus", 15)} Tạo task đầu tiên</button>` : `<button class="button primary" data-action="add-workspace">${icon("plus", 15)} Thêm đường dẫn dự án</button>`}</div>`}</section>
  <div class="reality-note"><span class="live-dot"></span>Task chạy bằng provider bạn chọn; lịch sử và bản ghi được lưu cục bộ.</div>`;
}
function workspacePage() {
  const workspaces = view.state.workspaces;
  if (!workspaces.length) {
    return `<div class="page-head"><div><div class="eyebrow">PROJECT ROOTS</div><h1>Dự án</h1><p>Chỉ các đường dẫn bạn thêm mới được đưa vào bộ điều phối.</p></div><button class="button primary" data-action="add-workspace">${icon("plus", 15)} Thêm dự án</button></div>
    <section class="workspace-list"><div class="empty-state"><strong>Chưa có dự án</strong><p>Thêm đường dẫn repository hoặc thư mục làm việc trên máy.</p><button class="button primary" data-action="add-workspace">${icon("plus", 15)} Thêm dự án</button></div></section>`;
  }
  const activeWs = workspaces.find((item) => item.id === view.selected) || workspaces[0];
  if (activeWs && view.selected !== activeWs.id && !view.workspaceOverviewMode) {
    view.selected = activeWs.id;
    if (!view.workspaceEntries?.length && !view.workspaceLoadingId) {
      view.workspaceLoadingId = activeWs.id;
      void loadWorkspaceDir(activeWs.id, view.workspaceDir || "").finally(() => { view.workspaceLoadingId = ""; });
    }
  }
  if (activeWs && !view.workspaceOverviewMode) return projectDetailPage(activeWs);
  const status = (w) => w.runtime ? `${w.runtime.isGit ? `Git · ${w.runtime.branch || "nhánh detached"}` : "Thư mục thường"}${w.runtime.head ? " · Có commit" : w.runtime.isGit ? " · Chưa có commit" : ""}${w.runtime.dirty ? " · Có thay đổi chưa commit" : ""}` : "Sẽ kiểm tra khi chạy task";
  return `<div class="page-head"><div><div class="eyebrow">PROJECT ROOTS</div><h1>Dự án</h1><p>Chỉ các đường dẫn bạn thêm mới được đưa vào bộ điều phối.</p></div><button class="button primary" data-action="add-workspace">${icon("plus", 15)} Thêm dự án</button></div>
  <section class="workspace-list">${workspaces.map((w) => `<article class="workspace-card"><div class="workspace-card-icon">${icon("folder-code", 17)}</div><div class="workspace-card-main"><strong>${esc(w.name)}</strong><code>${esc(w.path)}</code><small>${esc(status(w))}</small></div><button class="button quiet small" data-action="open-workspace" data-id="${esc(w.id)}">Mở dự án ${icon("chevron-right", 14)}</button><button class="icon-button" data-action="remove-workspace" data-id="${esc(w.id)}" title="Gỡ workspace" aria-label="Gỡ workspace">${icon("x", 16)}</button></article>`).join("")}</section>
  <aside class="info-panel"><strong>Task chạy ở đâu?</strong><p>Chế độ thường sửa trực tiếp thư mục này và chỉ cho một task chạy trong cùng workspace tại một thời điểm. Chế độ Git worktree tạo nhánh riêng; cần repository đã có commit. Task trên các workspace khác nhau có thể chạy song song.</p></aside>`;
}
function breadcrumbButtons(path, action) {
  const parts = String(path || "").split("/").filter(Boolean);
  const crumbs = [`<button class="path-crumb" data-action="${action}" data-path="">Thư mục gốc</button>`];
  let current = "";
  parts.forEach((part, index) => { current = current ? `${current}/${part}` : part; crumbs.push(`<span aria-hidden="true">/</span><button class="path-crumb" data-action="${action}" data-path="${esc(current)}" ${index === parts.length - 1 ? "aria-current=page" : ""}>${esc(part)}</button>`); });
  return crumbs.join("");
}
function vaultNoteOptionsMenu(filePath, { showRead = false, showGraph = false, direction = "down" } = {}) {
  return `<details class="codex-pop-menu is-right is-${direction} vault-action-menu">
    <summary class="vault-more-btn" aria-label="Tùy chọn tệp" title="Tùy chọn tệp">${icon("ellipsis", 14)}</summary>
    <div class="codex-pop-card vault-action-pop">
      ${showRead ? `<button type="button" class="codex-pop-item" data-action="vault-open-from-graph" data-path="${esc(filePath)}"><span class="codex-pop-item-main">${icon("book-open-text", 14)}<span>Đọc ghi chú</span></span></button>` : ""}
      <button type="button" class="codex-pop-item" data-action="vault-edit-note" data-path="${esc(filePath)}"><span class="codex-pop-item-main">${icon("square-pen", 14)}<span>Chỉnh sửa ghi chú</span></span></button>
      ${showGraph ? `<button type="button" class="codex-pop-item" data-action="vault-focus-graph" data-path="${esc(filePath)}"><span class="codex-pop-item-main">${icon("waypoints", 14)}<span>Xem trên đồ thị</span></span></button>` : ""}
      <button type="button" class="codex-pop-item" data-action="open-obsidian" data-path="${esc(filePath)}"><span class="codex-pop-item-main">${icon("arrow-up-right", 14)}<span>Mở trong Obsidian</span></span></button>
      <div class="codex-pop-sep"></div>
      <button type="button" class="codex-pop-item is-danger" data-action="vault-delete-note" data-path="${esc(filePath)}"><span class="codex-pop-item-main">${icon("delete", 14)}<span>Xóa ghi chú</span></span></button>
    </div>
  </details>`;
}
function localFileRows(entries, action, filter = "") {
  const query = filter.toLocaleLowerCase();
  const visible = (entries || []).filter((entry) => {
    if (!query) return true;
    if (entry.name.toLocaleLowerCase().includes(query)) return true;
    if (action === "vault-file-action" && entry.type === "file") {
      const gNode = (view.vaultGraph?.nodes || []).find((n) => n.path === entry.path);
      if (gNode && (gNode.tags || []).some((t) => `#${t}`.toLocaleLowerCase().includes(query))) return true;
    }
    return false;
  });
  if (!visible.length) return `<li class="file-empty">${query ? "Không có tệp khớp bộ lọc." : "Thư mục trống."}</li>`;
  const isVault = action === "vault-file-action";
  const graphNodes = isVault ? (view.vaultGraph?.nodes || []) : [];
  return visible.map((entry, idx) => {
    const isSelected = isVault && entry.type === "file" && view.vaultPreview?.path === entry.path;
    if (isVault && entry.type === "file") {
      const gNode = graphNodes.find((n) => n.path === entry.path);
      const degree = gNode?.degree || 0;
      const popDir = visible.length > 4 && idx >= visible.length - 2 ? "up" : "down";
      return `<li data-file-entry class="vault-file-item ${isSelected ? "is-selected" : ""}"><button class="file-row file ${isSelected ? "is-selected" : ""}" data-action="${action}" data-path="${esc(entry.path)}" aria-label="Mở ${esc(entry.name)}"><span>${icon("file", 14)}</span><strong title="${esc(entry.name)}">${esc(entry.name.replace(/\.(md|mdx|markdown)$/i, ""))}</strong>${degree > 0 ? `<small class="kb-degree-pill" title="${degree} liên kết">${degree}</small>` : ""}</button>${vaultNoteOptionsMenu(entry.path, { showGraph: view.vaultViewMode !== "graph", showRead: view.vaultViewMode === "graph", direction: popDir })}</li>`;
    }
    return `<li data-file-entry><button class="file-row ${entry.type === "directory" ? "directory" : "file"}" data-action="${action}" data-path="${esc(entry.path)}" ${entry.type === "file" ? `aria-label="Mở ${esc(entry.name)}"` : "aria-expanded=false"}><span>${entry.type === "directory" ? icon("folder-code", 15) : icon("file", 15)}</span><strong title="${esc(entry.name)}">${esc(entry.name)}</strong>${entry.type === "file" ? `<small>${formatNumber(entry.size || 0)} B</small>` : icon("chevron-right", 14)}</button></li>`;
  }).join("");
}
function splitMarkdownTableRow(line) {
  const trimmed = String(line || "").trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim());
}
function isMarkdownTableDelimiter(line) {
  if (!line || !line.includes("-")) return false;
  const trimmed = String(line).trim();
  if (!trimmed.includes("|")) return false;
  const cells = splitMarkdownTableRow(trimmed);
  return cells.length >= 1 && cells.every((c) => /^:?-{2,}:?$/.test(c));
}
const markdownCache = new Map();
let markdownCacheSize = 0;
function renderMarkdown(source) {
  const key = String(source || "");
  if (markdownCache.has(key)) {
    const cached = markdownCache.get(key);
    markdownCache.delete(key);
    markdownCache.set(key, cached);
    return cached;
  }
  const html = buildMarkdown(key);
  const size = key.length + html.length;
  if (size <= 256_000) {
    while (markdownCache.size && (markdownCache.size >= 128 || markdownCacheSize + size > 2_000_000)) {
      const oldest = markdownCache.keys().next().value;
      markdownCacheSize -= oldest.length + markdownCache.get(oldest).length;
      markdownCache.delete(oldest);
    }
    markdownCache.set(key, html);
    markdownCacheSize += size;
  }
  return html;
}
function buildMarkdown(source) {
  const lines = String(source || "").split(/\r?\n/);
  const html = [];
  let paragraph = [], listType = "", codeLines = [], inCode = false, codeIndent = 0;
  const inline = (text) => esc(text).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>").replace(/\[([^\]]+)\]\(((?:https?:\/\/|obsidian:\/\/|#)[^ ")<>']+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  const flushParagraph = () => { if (paragraph.length) { html.push(`<p>${paragraph.map(inline).join("<br>")}</p>`); paragraph = []; } };
  const closeList = () => { if (listType) { html.push(`</${listType}>`); listType = ""; } };
  let headingIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenceMatch = line.match(/^(\s*)```/);
    if (fenceMatch) {
      flushParagraph(); closeList();
      if (inCode) {
        html.push(`<pre><code>${esc(codeLines.join("\n"))}</code></pre>`);
        codeLines = []; inCode = false; codeIndent = 0;
      } else {
        inCode = true;
        codeIndent = fenceMatch[1].length;
      }
      continue;
    }
    if (inCode) {
      codeLines.push(codeIndent > 0 ? line.replace(new RegExp(`^ {0,${codeIndent}}`), "") : line);
      continue;
    }
    if (!line.trim()) { flushParagraph(); continue; }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flushParagraph(); closeList(); html.push("<hr>"); continue; }
    if (line.includes("|") && i + 1 < lines.length && isMarkdownTableDelimiter(lines[i + 1])) {
      flushParagraph(); closeList();
      const headers = splitMarkdownTableRow(line);
      const aligns = splitMarkdownTableRow(lines[i + 1]).map((c) => {
        const align = (c.startsWith(":") && c.endsWith(":")) ? "center" : c.endsWith(":") ? "right" : "left";
        return ["left", "center", "right"].includes(align) ? align : "left";
      });
      i += 2;
      const bodyRows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes("|") && !/^\s*```/.test(lines[i]) && !/^(#{1,6})\s+/.test(lines[i])) {
        bodyRows.push(splitMarkdownTableRow(lines[i]));
        i++;
      }
      i--;
      const theadHtml = `<thead><tr>${headers.map((h, colIdx) => `<th${["left", "center", "right"].includes(aligns[colIdx]) && aligns[colIdx] !== "left" ? ` style="text-align:${aligns[colIdx]}"` : ""}>${inline(h)}</th>`).join("")}</tr></thead>`;
      const tbodyHtml = bodyRows.length
        ? `<tbody>${bodyRows.map((row) => `<tr>${headers.map((_, colIdx) => `<td${["left", "center", "right"].includes(aligns[colIdx]) && aligns[colIdx] !== "left" ? ` style="text-align:${aligns[colIdx]}"` : ""}>${inline(row[colIdx] ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>`
        : "";
      html.push(`<div class="md-table-wrap"><table class="md-table">${theadHtml}${tbodyHtml}</table></div>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (heading) { flushParagraph(); closeList(); const level = Math.min(heading[1].length, 4); html.push(`<h${level} data-kb-heading="${headingIdx++}">${inline(heading[2])}</h${level}>`); continue; }
    if (bullet || ordered) {
      flushParagraph();
      const nextType = bullet ? "ul" : "ol";
      if (listType !== nextType) { closeList(); listType = nextType; html.push(`<${listType}>`); }
      if (ordered) {
        html.push(`<li value="${Number(ordered[1])}">${inline(ordered[2])}</li>`);
      } else {
        html.push(`<li>${inline(bullet[1])}</li>`);
      }
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/); if (quote) { flushParagraph(); closeList(); html.push(`<blockquote>${inline(quote[1])}</blockquote>`); continue; }
    closeList(); paragraph.push(line);
  }
  flushParagraph(); closeList();
  if (inCode) html.push(`<pre><code>${esc(codeLines.join("\n"))}</code></pre>`);
  return html.join("") || `<p class="file-empty">Tệp Markdown đang trống.</p>`;
}
function extractMarkdownOutline(source) {
  const lines = String(source || "").split(/\r?\n/);
  const outline = [];
  let inCode = false;
  let idx = 0;
  for (const line of lines) {
    if (/^\s*```/.test(line)) { inCode = !inCode; continue; }
    if (inCode) continue;
    const m = line.match(/^(#{1,4})\s+(.+)$/);
    if (m) {
      outline.push({ index: idx++, level: m[1].length, text: m[2].replace(/[*_`~[\]]/g, "").trim() });
    }
  }
  return outline;
}
function renderKnowledgeMarkdown(source) {
  const baseHtml = renderMarkdown(source);
  return baseHtml.replace(/\[\[([^\]|#<>\r\n]+)(?:#[^\]|<>\r\n]*)?(?:\|([^\]<>\r\n]+))?\]\]/g, (_, target, alias) => {
    const label = (alias || target).trim();
    const cleanTarget = target.trim();
    return `<button type="button" class="vault-wikilink" data-action="vault-open-wikilink" data-target="${esc(cleanTarget)}" title="Mở liên kết tri thức: ${esc(cleanTarget)}">${icon("file", 12)}<span>${esc(label)}</span></button>`;
  });
}
function filePreviewMarkup(file, title = "Chọn một tệp để xem") {
  if (!file) return `<div class="file-preview-empty">${icon("file", 18)}<p>${title}</p></div>`;
  const markdown = [".md", ".mdx", ".markdown"].includes(file.extension);
  const body = markdown
    ? `<article class="markdown-preview">${renderMarkdown(file.content)}</article>`
    : `<pre class="code-preview"><code>${esc(file.content)}</code></pre>`;
  return `<header class="file-preview-head"><div><strong>${esc(file.name)}</strong><small>${markdown ? "Markdown" : file.extension || "Tệp văn bản"} · ${formatNumber(file.size)} B · ${fmtDate(file.modifiedAt)}</small></div></header>${body}`;
}
async function loadWorkspaceDir(workspaceId, path = "") {
  const workspace = view.state.workspaces.find((item) => item.id === workspaceId);
  if (!workspace) return;
  view.page = "workspaces"; view.selected = workspaceId; view.workspaceDir = path; view.filePreview = null; view.workspaceEntries = [];
  render();
  const data = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/files?path=${encodeURIComponent(path)}`);
  if (view.selected !== workspaceId || view.workspaceDir !== path) return;
  if (view.workspaceDir !== data.path) replaceBrowserRoute = true;
  view.workspaceDir = data.path; view.workspaceEntries = data.entries || []; render();
}
async function loadWorkspacePreview(workspaceId, path) {
  const file = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/file?path=${encodeURIComponent(path)}`);
  if (view.selected !== workspaceId) return;
  view.filePreview = file; render();
}
async function loadVaultDir(path = "", { keepPreview = false } = {}) {
  view.page = "knowledge"; view.vaultDir = path;
  if (!keepPreview) { view.vaultPreview = null; view.vaultEditing = false; view.vaultEditingPath = ""; }
  view.vaultEntries = [];
  render();
  const [data, graph] = await Promise.all([
    api(`/api/vault/files?path=${encodeURIComponent(path)}`),
    api("/api/vault/graph").catch(() => ({ nodes: [], edges: [] })),
  ]);
  if (view.page !== "knowledge" || view.vaultDir !== path) return;
  if (view.vaultDir !== data.path) replaceBrowserRoute = true;
  view.vaultDir = data.path;
  view.vaultEntries = data.entries || [];
  view.vaultGraph = graph;
  if (!view.vaultPreview) {
    const firstFile = view.vaultEntries.find((e) => e.type === "file") || graph?.nodes?.[0];
    if (firstFile?.path) {
      try {
        const file = await api(`/api/vault/file?path=${encodeURIComponent(firstFile.path)}`);
        if (view.page === "knowledge" && !view.vaultPreview) {
          view.vaultPreview = file;
          view.vaultDraft = file.content;
        }
      } catch {}
    }
  }
  render();
}
async function loadVaultPreview(path, { startEdit = false } = {}) {
  const file = await api(`/api/vault/file?path=${encodeURIComponent(path)}`);
  if (view.page !== "knowledge") return;
  view.vaultPreview = file;
  view.vaultEditing = Boolean(startEdit);
  view.vaultEditingPath = startEdit ? file.path : "";
  view.vaultDraft = file.content;
  render();
}
async function loadVaultGraph() {
  const graph = await api("/api/vault/graph").catch(() => ({ nodes: [], edges: [] }));
  if (view.page !== "knowledge") return;
  view.vaultGraph = graph;
  render();
}
function showNewVaultNoteModal() {
  const prefix = view.vaultDir ? `${view.vaultDir}/` : "";
  const today = new Date().toISOString().slice(0, 10);
  const body = `<label>Đường dẫn tệp ghi chú (.md)<input name="notePath" required maxlength="240" value="${esc(`${prefix}${today}.md`)}" placeholder="Ví dụ: kien-truc/he-thong.md"></label><label>Nội dung Markdown<textarea name="content" rows="6" spellcheck="false" placeholder="# Tiêu đề ghi chú\n\nNội dung ghi chú… Liên kết tới [[Ghi chú khác]] hoặc gắn #tag."># </textarea><small>Sử dụng cú pháp <code>[[Tên ghi chú]]</code> hoặc <code>#tag</code> để tạo liên kết trên đồ thị tri thức.</small></label>`;
  showModal("Ghi chú tri thức mới", body, "Tạo ghi chú", "vault-note-create");
}
let neuralGraphCleanup = null;
let mountedGraphCanvas = null;
let mountedGraphData = null;
function mountKnowledgeGraphCanvas() {
  const currentCanvas = view.page === "knowledge" && view.vaultViewMode === "graph" ? document.getElementById("vault-neural-canvas") : null;
  if (currentCanvas && currentCanvas === mountedGraphCanvas && view.vaultGraph === mountedGraphData) return;
  if (neuralGraphCleanup) { neuralGraphCleanup(); neuralGraphCleanup = null; }
  mountedGraphCanvas = null;
  mountedGraphData = null;
  if (view.page !== "knowledge" || view.vaultViewMode !== "graph") return;
  const canvas = document.getElementById("vault-neural-canvas");
  if (!canvas) return;
  const graph = view.vaultGraph || { nodes: [], edges: [] };
  if (!graph.nodes?.length) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  mountedGraphCanvas = canvas;
  mountedGraphData = view.vaultGraph;

  view.vaultGraphPositions ||= new Map();
  const simNodes = graph.nodes.map((n, i) => {
    const saved = view.vaultGraphPositions.get(n.id);
    const angle = (i / Math.max(1, graph.nodes.length)) * Math.PI * 2;
    const radius = 65 + (i % 3) * 35;
    return {
      ...n,
      x: saved ? saved.x : Math.cos(angle) * radius,
      y: saved ? saved.y : Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      radius: Math.min(9.5, 4.5 + Math.sqrt(n.degree || 0) * 1.6),
    };
  });
  const nodeById = new Map(simNodes.map((n) => [n.id, n]));
  const simEdges = (graph.edges || []).map((e) => ({
    ...e,
    sourceNode: nodeById.get(e.source),
    targetNode: nodeById.get(e.target),
  })).filter((e) => e.sourceNode && e.targetNode);

  let camX = 0;
  let camY = 0;
  let camZoom = 1;
  let hoveredNode = null;
  let draggedNode = null;
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let pointerMoved = false;
  let pulsePhase = 0;
  let rafId = 0;
  let cooling = 1.0;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const screenToWorld = (sx, sy) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (sx - rect.width / 2 - camX) / camZoom,
      y: (sy - rect.height / 2 - camY) / camZoom,
    };
  };

  const findNodeAt = (sx, sy) => {
    const { x, y } = screenToWorld(sx, sy);
    for (let i = simNodes.length - 1; i >= 0; i -= 1) {
      const n = simNodes[i];
      const hitRadius = (n.radius + 6) / Math.max(0.5, camZoom);
      const dx = x - n.x;
      const dy = y - n.y;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) return n;
    }
    return null;
  };

  const stepPhysics = () => {
    if (cooling < 0.01 && !draggedNode) return;
    const count = simNodes.length;
    for (let i = 0; i < count; i += 1) {
      const a = simNodes[i];
      a.vx -= a.x * 0.01 * cooling;
      a.vy -= a.y * 0.01 * cooling;
      for (let j = i + 1; j < count; j += 1) {
        const b = simNodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) { dx = (Math.random() - 0.5) * 2; dy = (Math.random() - 0.5) * 2; distSq = dx * dx + dy * dy; }
        const dist = Math.sqrt(distSq);
        const repulse = (1300 / (distSq + 100)) * cooling;
        const fx = (dx / dist) * repulse;
        const fy = (dy / dist) * repulse;
        a.vx -= fx; a.vy -= fy;
        b.vx += fx; b.vy += fy;
      }
    }
    for (const edge of simEdges) {
      const a = edge.sourceNode;
      const b = edge.targetNode;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const ideal = edge.kind === "link" ? 88 : edge.kind === "tag" ? 110 : 130;
      const strength = edge.kind === "link" ? 0.05 : edge.kind === "tag" ? 0.03 : 0.016;
      const force = (dist - ideal) * strength * cooling;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }
    for (const n of simNodes) {
      if (n === draggedNode) { n.vx = 0; n.vy = 0; continue; }
      n.vx *= 0.82;
      n.vy *= 0.82;
      n.x += Math.max(-10, Math.min(10, n.vx));
      n.y += Math.max(-10, Math.min(10, n.vy));
      view.vaultGraphPositions.set(n.id, { x: n.x, y: n.y });
    }
    if (!draggedNode) cooling *= 0.985;
  };

  const draw = () => {
    stepPhysics();
    pulsePhase = (pulsePhase + 0.006) % 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    ctx.clearRect(0, 0, w, h);

    const selectedId = view.vaultPreview?.path || "";
    const activeId = hoveredNode?.id || selectedId;
    const neighborIds = new Set();
    if (activeId) {
      neighborIds.add(activeId);
      for (const e of simEdges) {
        if (e.source === activeId) neighborIds.add(e.target);
        if (e.target === activeId) neighborIds.add(e.source);
      }
    }

    const lightScheme = document.documentElement?.dataset?.colorScheme === "light";
    ctx.save();
    ctx.translate(w / 2 + camX, h / 2 + camY);
    ctx.scale(camZoom, camZoom);

    for (let idx = 0; idx < simEdges.length; idx += 1) {
      const e = simEdges[idx];
      const a = e.sourceNode;
      const b = e.targetNode;
      const isHighlighted = activeId && (e.source === activeId || e.target === activeId);
      const isDimmed = activeId && !isHighlighted;

      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      if (isHighlighted) {
        ctx.strokeStyle = lightScheme ? "rgba(15, 23, 42, 0.52)" : "rgba(255, 255, 255, 0.58)";
        ctx.lineWidth = 1.35;
      } else {
        ctx.strokeStyle = isDimmed
          ? (lightScheme ? "rgba(15, 23, 42, 0.05)" : "rgba(255, 255, 255, 0.04)")
          : (lightScheme ? "rgba(15, 23, 42, 0.16)" : "rgba(255, 255, 255, 0.14)");
        ctx.lineWidth = 1;
      }
      ctx.stroke();

      if (isHighlighted || (!activeId && e.kind === "link")) {
        const t = (pulsePhase + (idx * 0.23)) % 1;
        const px = a.x + (b.x - a.x) * t;
        const py = a.y + (b.y - a.y) * t;
        ctx.beginPath();
        ctx.arc(px, py, isHighlighted ? 1.75 : 1.3, 0, Math.PI * 2);
        ctx.fillStyle = isHighlighted
          ? (lightScheme ? "#0f172a" : "#ffffff")
          : (lightScheme ? "rgba(15, 23, 42, 0.42)" : "rgba(255, 255, 255, 0.42)");
        ctx.fill();
      }
    }

    for (const n of simNodes) {
      const isSelected = n.id === selectedId;
      const isHovered = n === hoveredNode;
      const isNeighbor = neighborIds.has(n.id);
      const isDimmed = activeId && !isNeighbor;

      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.radius + 4, 0, Math.PI * 2);
        ctx.strokeStyle = lightScheme ? "rgba(15, 23, 42, 0.24)" : "rgba(255, 255, 255, 0.22)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(n.x, n.y, n.radius, 0, Math.PI * 2);
      if (isSelected || isHovered) {
        ctx.fillStyle = lightScheme ? "#0f172a" : "#ffffff";
        ctx.strokeStyle = lightScheme ? "#ffffff" : "#09090b";
        ctx.lineWidth = 1.5;
      } else if (isDimmed) {
        ctx.fillStyle = lightScheme ? "rgba(148, 163, 184, 0.28)" : "rgba(113, 113, 122, 0.24)";
        ctx.strokeStyle = lightScheme ? "rgba(15, 23, 42, 0.08)" : "rgba(255, 255, 255, 0.06)";
        ctx.lineWidth = 1;
      } else {
        ctx.fillStyle = lightScheme
          ? (n.degree > 1 ? "#334155" : "#64748b")
          : (n.degree > 1 ? "#d4d4d8" : "#71717a");
        ctx.strokeStyle = lightScheme ? "rgba(255, 255, 255, 0.9)" : "rgba(18, 19, 23, 0.9)";
        ctx.lineWidth = 1.25;
      }
      ctx.fill();
      ctx.stroke();

      if (!isDimmed || camZoom > 1.25) {
        ctx.font = `${isSelected || isHovered ? "600" : "500"} 11px "Nunito Sans Variable", "Segoe UI", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = isSelected || isHovered
          ? (lightScheme ? "#0f172a" : "#ffffff")
          : isDimmed
            ? (lightScheme ? "rgba(15, 23, 42, 0.24)" : "rgba(255, 255, 255, 0.2)")
            : (lightScheme ? "rgba(15, 23, 42, 0.82)" : "rgba(228, 228, 231, 0.78)");
        ctx.fillText(n.stem || n.name, n.x, n.y + n.radius + 5);
      }
    }

    ctx.restore();
    rafId = requestAnimationFrame(draw);
  };

  const onPointerDown = (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    pointerMoved = false;
    const hit = findNodeAt(sx, sy);
    if (hit) {
      draggedNode = hit;
      cooling = Math.max(cooling, 0.35);
    } else {
      isPanning = true;
      panStartX = e.clientX - camX;
      panStartY = e.clientY - camY;
    }
  };

  const onPointerMove = (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (draggedNode) {
      pointerMoved = true;
      const world = screenToWorld(sx, sy);
      draggedNode.x = world.x;
      draggedNode.y = world.y;
      view.vaultGraphPositions.set(draggedNode.id, { x: world.x, y: world.y });
      cooling = Math.max(cooling, 0.25);
      canvas.style.cursor = "grabbing";
      return;
    }
    if (isPanning) {
      pointerMoved = true;
      camX = e.clientX - panStartX;
      camY = e.clientY - panStartY;
      canvas.style.cursor = "grabbing";
      return;
    }
    hoveredNode = findNodeAt(sx, sy);
    canvas.style.cursor = hoveredNode ? "pointer" : "grab";
  };

  const onPointerUp = (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    if (draggedNode && !pointerMoved) {
      const targetPath = draggedNode.path;
      draggedNode = null;
      void loadVaultPreview(targetPath);
      return;
    }
    draggedNode = null;
    isPanning = false;
    hoveredNode = findNodeAt(sx, sy);
    canvas.style.cursor = hoveredNode ? "pointer" : "grab";
  };

  const onDblClick = (e) => {
    const rect = canvas.getBoundingClientRect();
    const hit = findNodeAt(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      view.vaultViewMode = "files";
      void loadVaultPreview(hit.path);
    }
  };

  const onWheel = (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.9;
    camZoom = Math.max(0.35, Math.min(2.8, camZoom * factor));
  };

  const onReset = () => {
    camX = 0; camY = 0; camZoom = 1; cooling = 0.8;
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("dblclick", onDblClick);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.dataset.resetReady = "1";
  canvas._resetCamera = onReset;

  rafId = requestAnimationFrame(draw);
  neuralGraphCleanup = () => {
    cancelAnimationFrame(rafId);
    ro.disconnect();
    canvas.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("dblclick", onDblClick);
    canvas.removeEventListener("wheel", onWheel);
  };
}
let cachedDockTreePaths = null;
let cachedDockTreeKey = "";
let cachedDockTreeRoot = null;

function sortDockTreeNode(node) {
  node.foldersList = [...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  node.files.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  for (const child of node.foldersList) sortDockTreeNode(child);
}

function buildDockFileTree(paths = []) {
  const key = `${paths.length}:${paths[0] || ""}:${paths[paths.length - 1] || ""}`;
  if (paths === cachedDockTreePaths && key === cachedDockTreeKey && cachedDockTreeRoot) {
    return cachedDockTreeRoot;
  }
  const root = { folders: new Map(), foldersList: [], files: [] };
  for (const rawPath of paths) {
    const norm = String(rawPath || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    if (!norm) continue;
    const parts = norm.split("/");
    let curr = root;
    let accum = "";
    for (let i = 0; i < parts.length - 1; i++) {
      const seg = parts[i];
      accum = accum ? `${accum}/${seg}` : seg;
      if (!curr.folders.has(seg)) {
        curr.folders.set(seg, { name: seg, path: accum, folders: new Map(), foldersList: [], files: [] });
      }
      curr = curr.folders.get(seg);
    }
    const fileName = parts[parts.length - 1];
    curr.files.push({ name: fileName, path: norm });
  }
  sortDockTreeNode(root);
  cachedDockTreePaths = paths;
  cachedDockTreeKey = key;
  cachedDockTreeRoot = root;
  return root;
}

function dockFileIconName(fileName = "") {
  const lower = String(fileName || "").toLowerCase();
  const ext = lower.includes(".") ? `.${lower.split(".").at(-1)}` : "";
  if (ext === ".html" || ext === ".htm") return "globe";
  if (ext === ".pdf" || ext === ".md" || ext === ".mdx" || ext === ".markdown") return "book-open-text";
  if ([".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp"].includes(ext)) return "image";
  if ([".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".py", ".go", ".rs", ".java", ".c", ".cpp", ".cs", ".css", ".scss", ".json", ".sql", ".sh", ".ps1"].includes(ext)) return "code-2";
  return "file-text";
}

function defaultFileTabMode(ext = "", preferredMode = "") {
  if (["preview", "code"].includes(preferredMode)) return preferredMode;
  const lower = String(ext || "").toLowerCase();
  if ([".html", ".htm", ".pdf", ".md", ".mdx", ".markdown", ".docx", ".doc", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp", ".mp4", ".webm", ".mp3", ".wav", ".csv", ".tsv", ".json"].includes(lower)) {
    return "preview";
  }
  return "code";
}

function canRichPreviewExtension(ext = "", kind = "text") {
  if (kind && kind !== "text") return true;
  const lower = String(ext || "").toLowerCase();
  return [".html", ".htm", ".pdf", ".md", ".mdx", ".markdown", ".docx", ".doc", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp", ".mp4", ".webm", ".mp3", ".wav", ".csv", ".tsv", ".json"].includes(lower);
}

async function openStageFileTab({ workspaceId = "", taskId = "", path = "", preferredMode = "" } = {}) {
  const cleanPath = String(path || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!cleanPath) return;
  const selectedTask = (taskId || view.selected) ? (view.state?.tasks || []).find((t) => t.id === (taskId || view.selected)) : null;
  const wsId = workspaceId
    || (view.page === "workspaces" && view.selected ? view.selected : "")
    || selectedTask?.workspaceId
    || view.homeWorkspaceId
    || view.state?.workspaces?.[0]?.id
    || "";
  if (!wsId) return;
  const tId = taskId || selectedTask?.id || "";
  const tabId = `${wsId}::${cleanPath}`;
  const name = cleanPath.split("/").at(-1) || cleanPath;
  const ext = name.includes(".") ? `.${name.split(".").at(-1).toLowerCase()}` : "";

  view.stageTabs ||= [];
  let tab = view.stageTabs.find((item) => item.id === tabId);
  if (!tab) {
    tab = {
      id: tabId,
      workspaceId: wsId,
      taskId: tId,
      path: cleanPath,
      name,
      ext,
      mode: defaultFileTabMode(ext, preferredMode),
      fileData: null,
      diffData: null,
      loading: true,
      error: "",
      loadedAt: Date.now(),
    };
    view.stageTabs.push(tab);
    if (view.stageTabs.length > 10) view.stageTabs.shift();
  } else {
    tab.taskId = tId || tab.taskId;
    if (preferredMode) tab.mode = preferredMode;
  }
  view.activeStageTabId = tab.id;
  view.stageLineCommentTarget = null;
  render();
  await reloadStageFileTab(tab.id);
}

async function reloadStageFileTab(tabId) {
  const tab = (view.stageTabs || []).find((item) => item.id === tabId);
  if (!tab) return;
  tab.loading = true;
  tab.error = "";
  render();
  try {
    const q = `path=${encodeURIComponent(tab.path)}${tab.taskId ? `&taskId=${encodeURIComponent(tab.taskId)}` : ""}`;
    const fileRes = await api(`/api/workspaces/${encodeURIComponent(tab.workspaceId)}/file?${q}`);
    tab.fileData = fileRes;
    tab.ext = fileRes.extension || tab.ext;
    tab.loadedAt = Date.now();
    tab.loading = false;
  } catch (error) {
    tab.error = error.message || "Không thể đọc tệp.";
    tab.loading = false;
  }
  render();
}

function renderCsvTableMarkup(content = "", delimiter = ",") {
  const rows = String(content || "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 200)
    .map((line) => line.split(delimiter).map((cell) => cell.trim().replace(/^"|"$/g, "")));
  if (!rows.length) return `<div class="orca-viewer-empty"><p>Tệp dữ liệu trống.</p></div>`;
  const header = rows[0] || [];
  const bodyRows = rows.slice(1);
  return `<div class="orca-table-scroll">
    <table class="orca-data-table">
      <thead>
        <tr>
          <th class="is-row-num">#</th>
          ${header.map((col) => `<th>${esc(col)}</th>`).join("")}
        </tr>
      </thead>
      <tbody>
        ${bodyRows.map((cols, idx) => `<tr>
          <td class="is-row-num">${idx + 1}</td>
          ${header.map((_, cIdx) => `<td>${esc(cols[cIdx] ?? "")}</td>`).join("")}
        </tr>`).join("")}
      </tbody>
    </table>
  </div>`;
}

function formatCompactBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(/\.0$/, "")} KB`;
  return `${(n / (1024 * 1024)).toFixed(1).replace(/\.0$/, "")} MB`;
}

function resolveHtmlCommentAgentSelection() {
  const activeTask = view.page === "chat" && view.selected ? (view.state?.tasks || []).find((t) => t.id === view.selected) : null;
  const wf = activeTask?.config?.workflow || "chat-only";
  const fallbackProvider = view.stageHtmlCommentProvider
    || view.chatProvider
    || (activeTask ? (wf === "chat-only" ? activeTask.config?.chatProvider : roleConfig(activeTask.config, "build")?.provider || roleConfig(activeTask.config, "plan")?.provider) : "")
    || view.homeChatProvider
    || view.state?.settings?.defaults?.chatProvider
    || "codex";

  const availableEntries = Object.entries(view.connectors || {}).filter(([, conn]) => conn?.available && conn?.capabilities?.chat);
  const chosenEntry = availableEntries.find(([id]) => id === fallbackProvider) || availableEntries[0] || ["codex", view.connectors?.codex || {}];
  const provider = chosenEntry[0];
  const conn = chosenEntry[1] || {};
  const models = conn.models?.length ? conn.models : [{ id: "", name: conn.name || providerTitle(view.connectors, provider), efforts: ["low", "medium", "high"] }];
  const fallbackModelId = view.stageHtmlCommentModel || view.chatModel || activeTask?.config?.chatModel || view.homeChatModel || models[0]?.id || "";
  const modelObj = models.find((m) => m.id === fallbackModelId) || models[0] || { id: "", name: provider, efforts: ["low", "medium", "high"] };
  const model = modelObj.id || "";
  const effortsList = modelObj.efforts?.length ? modelObj.efforts : ["low", "medium", "high"];
  const fallbackEffort = view.stageHtmlCommentEffort || view.chatEffort || activeTask?.config?.chatEffort || view.homeChatEffort || "medium";
  const effort = effortsList.includes(fallbackEffort) ? fallbackEffort : (effortsList.includes("medium") ? "medium" : effortsList[0] || "medium");

  const effortDisplay = { low: "Low", medium: "Medium", high: "High", minimal: "Min", standard: "Std", max: "Max", xhigh: "xHigh", ultra: "Ultra" };
  let activeAgentLabel = modelObj.name || modelObj.id || providerTitle(view.connectors, provider);
  const agentItemsMarkup = [];
  for (const [provId, c] of availableEntries) {
    const provName = providerTitle(view.connectors, provId);
    const provModels = c.models?.length ? c.models : [{ id: "", name: c.name || provName }];
    agentItemsMarkup.push(`<div class="codex-pop-group-label">${esc(provName)}</div>`);
    for (const m of provModels) {
      const val = `${provId}::${m.id || ""}`;
      const isSelected = provId === provider && (m.id || "") === model;
      const title = m.name || m.id || provName;
      if (isSelected) activeAgentLabel = title;
      agentItemsMarkup.push(`<button type="button" class="codex-pop-item ${isSelected ? "is-selected" : ""}" data-action="pick-html-comment-agent" data-agent="${esc(val)}">
        <span class="codex-pop-item-main"><span>${esc(title)}</span></span>
        ${isSelected ? icon("check", 13) : ""}
      </button>`);
    }
  }

  const effortItemsMarkup = effortsList.map((ef) => {
    const isSelected = ef === effort;
    return `<button type="button" class="codex-pop-item ${isSelected ? "is-selected" : ""}" data-action="pick-html-comment-effort" data-effort="${esc(ef)}">
      <span class="codex-pop-item-main"><span>${esc(effortDisplay[ef] || ef)}</span></span>
      ${isSelected ? icon("check", 13) : ""}
    </button>`;
  }).join("");

  return {
    provider,
    model,
    effort,
    activeAgentLabel,
    activeEffortLabel: effortDisplay[effort] || effort || "Medium",
    agentItemsMarkup: agentItemsMarkup.join(""),
    effortItemsMarkup,
  };
}

function renderHtmlElementCommentPopoverMarkup() {
  const el = view.stageHtmlSelectedElement;
  if (!el) return "";
  const {
    activeAgentLabel,
    activeEffortLabel,
    agentItemsMarkup,
    effortItemsMarkup,
  } = resolveHtmlCommentAgentSelection();
  const r = el.rect || {};
  const vw = r.viewportWidth || 800;
  const vh = r.viewportHeight || 600;
  const popWidth = 376;
  const popHeight = 196;
  let left = Math.max(12, Math.min((r.left || 24), Math.max(12, vw - popWidth - 16)));
  let top = (r.bottom || 80) + 10;
  if (top + popHeight > vh - 12 && (r.top || 0) > popHeight + 16) {
    top = Math.max(12, (r.top || 80) - popHeight - 10);
  } else {
    top = Math.max(12, Math.min(top, Math.max(12, vh - popHeight - 12)));
  }

  const selectorDisplay = el.selector || `<${el.tagName || "element"}>`;

  return `<div class="orca-element-comment-popover" style="top:${Math.round(top)}px;left:${Math.round(left)}px;">
    <header class="orca-el-pop-head">
      <div class="orca-el-pop-title">
        <span class="orca-el-tag">&lt;${esc(el.tagName || "div")}&gt;</span>
        <strong title="${esc(el.label || selectorDisplay)}">${esc(el.label || selectorDisplay)}</strong>
      </div>
      <button type="button" class="icon-button orca-el-pop-close" data-action="cancel-html-element-comment" title="Đóng khung nhận xét">${icon("x", 13)}</button>
    </header>
    <textarea class="orca-el-comment-input" data-html-element-comment-input rows="2" placeholder="Nhập nhận xét hoặc yêu cầu chỉnh sửa phần tử này cho Agent…">${esc(view.stageHtmlCommentDraft || "")}</textarea>
    <footer class="orca-el-pop-foot">
      <div class="codex-inline-model-bar orca-el-model-bar">
        <details class="codex-pop-menu is-up" data-pop-id="html-comment-model">
          <summary class="codex-inline-trigger is-model" title="Chọn Agent & Model xử lý">
            <span>${esc(activeAgentLabel)}</span>
            ${icon("chevron-down", 12)}
          </summary>
          <div class="codex-pop-card is-model-list">
            <div class="codex-pop-head">Agent & Model</div>
            <div class="codex-pop-scroll">${agentItemsMarkup}</div>
          </div>
        </details>
        <details class="codex-pop-menu is-up is-right" data-pop-id="html-comment-effort">
          <summary class="codex-inline-trigger is-effort" title="Mức suy luận">
            <span>${esc(activeEffortLabel)}</span>
            ${icon("chevron-down", 12)}
          </summary>
          <div class="codex-pop-card is-effort-list">
            <div class="codex-pop-head">Mức suy luận</div>
            <div class="codex-pop-scroll">${effortItemsMarkup}</div>
          </div>
        </details>
      </div>
      <div class="orca-el-pop-actions">
        <button type="button" class="button quiet small" data-action="cancel-html-element-comment">Hủy</button>
        <button type="button" class="button primary small" data-action="send-html-element-comment">${icon("arrow-up-right", 12)}<span>Gửi</span></button>
      </div>
    </footer>
  </div>`;
}

function positionHtmlCommentMenu(menu) {
  if (!menu) return;
  const rect = menu.getBoundingClientRect();
  const itemCount = menu.querySelectorAll(".codex-pop-item").length;
  const headingHeight = menu.querySelector(".codex-pop-head") ? 38 : 8;
  const rowHeight = menu.matches("[data-pop-id='html-comment-effort']") ? 34 : 36;
  const maxMenuHeight = Math.min(window.innerHeight * 0.48, 280);
  const preferredHeight = Math.min(maxMenuHeight, headingHeight + itemCount * rowHeight + 14);
  const spaceAbove = Math.max(0, rect.top - 10);
  const spaceBelow = Math.max(0, window.innerHeight - rect.bottom - 10);
  const opensDown = spaceBelow >= preferredHeight || spaceBelow >= spaceAbove;
  const availableHeight = (opensDown ? spaceBelow : spaceAbove) - 8;
  menu.classList.toggle("is-down", opensDown);
  menu.classList.toggle("is-up", !opensDown);
  menu.style.setProperty("--orca-menu-max-height", `${Math.max(96, Math.min(maxMenuHeight, availableHeight))}px`);
}

function ensureIframeInspectorBridge(iframe) {
  if (!iframe) return;
  try {
    const win = iframe.contentWindow;
    const doc = iframe.contentDocument || win?.document;
    if (!win || !doc) return;
    if (typeof win.__orcaSetInspectMode === "function") return;
    let active = false;
    let hoveredEl = null;
    let lockedEl = null;
    let box = null;

    function ensureBox() {
      if (box && (doc.body || doc.documentElement)?.contains(box)) return box;
      box = doc.createElement("div");
      box.id = "__orca_inspect_box__";
      box.setAttribute("data-orca-ignore", "1");
      Object.assign(box.style, {
        position: "fixed",
        pointerEvents: "none",
        zIndex: "2147483646",
        display: "none",
        boxSizing: "border-box",
        border: "1.5px solid rgba(24, 24, 27, 0.85)",
        borderRadius: "8px",
        background: "rgba(16, 185, 129, 0.04)",
        boxShadow: "0 0 0 1px rgba(255, 255, 255, 0.88), 0 4px 14px rgba(0, 0, 0, 0.16)",
        transition: "top 40ms ease-out, left 40ms ease-out, width 40ms ease-out, height 40ms ease-out",
      });
      (doc.body || doc.documentElement).appendChild(box);
      return box;
    }

    function updateBoxFor(el) {
      const overlay = ensureBox();
      if (!el || !active) {
        overlay.style.display = "none";
        return;
      }
      const r = el.getBoundingClientRect();
      if (!r || (r.width === 0 && r.height === 0)) {
        overlay.style.display = "none";
        return;
      }
      const pad = 4;
      overlay.style.display = "block";
      overlay.style.top = Math.max(0, r.top - pad) + "px";
      overlay.style.left = Math.max(0, r.left - pad) + "px";
      overlay.style.width = (r.width + pad * 2) + "px";
      overlay.style.height = (r.height + pad * 2) + "px";
    }

    function cssSelectorFor(el) {
      if (!el || el.nodeType !== 1) return "";
      if (el.id) return el.tagName.toLowerCase() + "#" + el.id;
      const parts = [];
      let cur = el;
      while (cur && cur.nodeType === 1 && cur !== doc.body && cur !== doc.documentElement && parts.length < 4) {
        let part = cur.tagName.toLowerCase();
        if (cur.id) {
          parts.unshift(part + "#" + cur.id);
          break;
        }
        const cls = typeof cur.className === "string"
          ? cur.className.trim().split(/\s+/).filter((c) => c && !c.startsWith("__orca")).slice(0, 2)
          : [];
        if (cls.length) part += "." + cls.join(".");
        parts.unshift(part);
        cur = cur.parentElement;
      }
      return parts.join(" > ");
    }

    function describeElement(el) {
      if (!el || el.nodeType !== 1) return null;
      const tag = el.tagName.toLowerCase();
      const selector = cssSelectorFor(el);
      const val = typeof el.value === "string" ? el.value.trim() : "";
      const placeholder = el.getAttribute?.("placeholder") || "";
      const aria = el.getAttribute?.("aria-label") || "";
      const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120);
      const labelText = [aria, text, val, placeholder].filter(Boolean)[0] || selector || ("<" + tag + ">");
      const clone = el.cloneNode(true);
      const outerHTML = (clone.outerHTML || "").replace(/\s+/g, " ").trim().slice(0, 320);
      const r = el.getBoundingClientRect();
      return {
        tagName: tag,
        selector,
        label: labelText.slice(0, 90),
        text: text.slice(0, 120),
        value: val.slice(0, 80),
        outerHTML,
        rect: {
          top: Math.round(r.top),
          left: Math.round(r.left),
          width: Math.round(r.width),
          height: Math.round(r.height),
          bottom: Math.round(r.bottom),
          right: Math.round(r.right),
          viewportWidth: win.innerWidth,
          viewportHeight: win.innerHeight,
        },
      };
    }

    function resolveInspectTarget(rawTarget) {
      if (!rawTarget || rawTarget.nodeType !== 1) return null;
      if (rawTarget.id === "__orca_inspect_box__" || rawTarget === doc.documentElement || rawTarget === doc.body) return null;
      if (["INPUT", "SELECT", "TEXTAREA"].includes(rawTarget.tagName)) {
        const parent = rawTarget.parentElement;
        if (parent && parent !== doc.body && parent.children.length <= 3) {
          const pr = parent.getBoundingClientRect();
          if (pr.height > 0 && pr.height <= 120 && pr.width <= 520) return parent;
        }
      }
      return rawTarget;
    }

    win.__orcaSetInspectMode = (nextActive, clearLocked = true) => {
      active = Boolean(nextActive);
      if (clearLocked || !active) lockedEl = null;
      hoveredEl = null;
      if (doc.documentElement) doc.documentElement.style.cursor = active ? "crosshair" : "";
      updateBoxFor(lockedEl || hoveredEl);
    };

    win.addEventListener("mousemove", (e) => {
      if (!active || lockedEl) return;
      const target = resolveInspectTarget(e.target);
      if (target !== hoveredEl) {
        hoveredEl = target;
        updateBoxFor(hoveredEl);
      }
    }, true);

    win.addEventListener("scroll", () => {
      if (active && (lockedEl || hoveredEl)) updateBoxFor(lockedEl || hoveredEl);
    }, true);

    win.addEventListener("resize", () => {
      if (active && (lockedEl || hoveredEl)) updateBoxFor(lockedEl || hoveredEl);
    }, true);

    win.addEventListener("click", (e) => {
      if (!active) return;
      const target = resolveInspectTarget(e.target) || (e.target?.nodeType === 1 ? e.target : null);
      if (!target || target === doc.body || target === doc.documentElement) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      lockedEl = target;
      updateBoxFor(lockedEl);
      const info = describeElement(lockedEl);
      if (info) {
        view.stageHtmlInspectActive = true;
        view.stageHtmlSelectedElement = info;
        syncHtmlInspectUi({ focusInput: true });
      }
    }, true);

    win.addEventListener("keydown", (e) => {
      if (active && e.key === "Escape") {
        if (view.stageHtmlSelectedElement) {
          view.stageHtmlSelectedElement = null;
          view.stageHtmlCommentDraft = "";
          syncHtmlInspectUi();
        } else if (view.stageHtmlInspectActive) {
          view.stageHtmlInspectActive = false;
          syncHtmlInspectUi();
        }
      }
    }, true);
  } catch {}
}

function syncHtmlInspectUi({ focusInput = false } = {}) {
  const active = Boolean(view.stageHtmlInspectActive);
  const selected = view.stageHtmlSelectedElement;
  document.querySelectorAll("[data-action='toggle-html-inspect']").forEach((btn) => {
    btn.classList.toggle("is-active", active);
  });
  const banner = document.querySelector("[data-html-inspect-banner]");
  if (banner) {
    banner.hidden = !active;
  }
  const layer = document.querySelector("[data-html-comment-layer]");
  if (layer) {
    if (active && selected) {
      layer.hidden = false;
      layer.innerHTML = renderHtmlElementCommentPopoverMarkup();
      localizeDom(layer, view.language);
      if (focusInput) {
        const input = layer.querySelector("[data-html-element-comment-input]");
        input?.focus();
      }
    } else {
      layer.hidden = true;
      layer.innerHTML = "";
    }
  }
  const iframe = document.querySelector(".orca-live-frame:not(.is-pdf)");
  if (iframe) {
    ensureIframeInspectorBridge(iframe);
    try {
      if (typeof iframe.contentWindow?.__orcaSetInspectMode === "function") {
        iframe.contentWindow.__orcaSetInspectMode(active, !selected);
      }
    } catch {}
    iframe.contentWindow?.postMessage({
      type: "orca-inspect:set-mode",
      active,
      clearSelection: !selected,
    }, "*");
  }
}

function renderStageFileViewer(tab) {
  if (!tab) return "";
  const file = tab.fileData;
  const ext = (file?.extension || tab.ext || "").toLowerCase();
  const kind = file?.kind || "text";
  const hasRichPreview = canRichPreviewExtension(ext, kind);
  const hasCodeView = kind === "text";
  let mode = tab.mode === "code" || tab.mode === "preview" ? tab.mode : defaultFileTabMode(ext);
  if (mode === "preview" && !hasRichPreview) mode = "code";
  if (mode === "code" && !hasCodeView) mode = "preview";

  const isWebBrowser = (ext === ".html" || ext === ".htm") && mode === "preview";
  const rawUrl = `/api/workspaces/${encodeURIComponent(tab.workspaceId)}/raw/${tab.path.split("/").map(encodeURIComponent).join("/")}?${tab.taskId ? `taskId=${encodeURIComponent(tab.taskId)}&` : ""}t=${tab.loadedAt || 0}`;
  const sizeBadge = file?.size !== undefined ? formatCompactBytes(file.size) : "";
  const totalLines = hasCodeView && file?.content ? String(file.content).split(/\r?\n/).length : 0;

  let bodyHtml = "";
  if (tab.loading && !file) {
    bodyHtml = `<div class="orca-viewer-empty">
      <span>${icon("refresh-cw", 18)}</span>
      <strong>Đang tải ${esc(tab.name)}…</strong>
      <small>${esc(tab.path)}</small>
    </div>`;
  } else if (tab.error) {
    bodyHtml = `<div class="orca-viewer-empty is-error">
      <strong>Không thể đọc tệp ${esc(tab.name)}</strong>
      <p>${esc(tab.error)}</p>
      <div class="orca-viewer-empty-actions">
        <button type="button" class="button quiet small" data-action="reload-stage-tab" data-tab-id="${esc(tab.id)}">${icon("refresh-cw", 13)}<span>Thử lại</span></button>
      </div>
    </div>`;
  } else if (mode === "preview") {
    if (ext === ".html" || ext === ".htm") {
      const hasPopover = Boolean(view.stageHtmlInspectActive && view.stageHtmlSelectedElement);
      bodyHtml = `<div class="orca-live-frame-wrap">
        <iframe class="orca-live-frame" src="${esc(rawUrl)}" title="Xem trực tiếp ${esc(tab.name)}" sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"></iframe>
        <div class="orca-element-comment-layer" data-html-comment-layer ${hasPopover ? "" : "hidden"}>
          ${hasPopover ? renderHtmlElementCommentPopoverMarkup() : ""}
        </div>
      </div>`;
    } else if (ext === ".pdf" || kind === "pdf") {
      bodyHtml = `<div class="orca-live-frame-wrap is-pdf">
        <iframe class="orca-live-frame is-pdf" src="${esc(rawUrl)}#toolbar=1&navpanes=1&view=FitH" title="Tài liệu PDF ${esc(tab.name)}"></iframe>
      </div>`;
    } else if (kind === "image" || [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico", ".bmp"].includes(ext)) {
      bodyHtml = `<div class="orca-media-stage is-image">
        <div class="orca-image-canvas">
          <img class="orca-image-preview" src="${esc(rawUrl)}" alt="${esc(tab.name)}" />
        </div>
      </div>`;
    } else if (kind === "media" || [".mp4", ".webm", ".mp3", ".wav"].includes(ext)) {
      const isAudio = ext === ".mp3" || ext === ".wav";
      bodyHtml = `<div class="orca-media-stage">
        ${isAudio
          ? `<audio controls src="${esc(rawUrl)}" class="orca-audio-player"></audio>`
          : `<video controls src="${esc(rawUrl)}" class="orca-video-player"></video>`}
        <div class="orca-media-caption">
          <strong>${esc(tab.name)}</strong>
          <small>${esc(tab.path)}${sizeBadge ? ` · ${esc(sizeBadge)}` : ""}</small>
        </div>
      </div>`;
    } else if ([".md", ".mdx", ".markdown", ".docx", ".doc"].includes(ext)) {
      bodyHtml = `<div class="orca-doc-scroll">
        <article class="markdown-preview orca-markdown-doc">${renderMarkdown(file?.content || "")}</article>
      </div>`;
    } else if (ext === ".csv" || ext === ".tsv") {
      bodyHtml = renderCsvTableMarkup(file?.content || "", ext === ".tsv" ? "\t" : ",");
    } else if (ext === ".json") {
      let formattedJson = file?.content || "";
      try {
        formattedJson = JSON.stringify(JSON.parse(formattedJson), null, 2);
      } catch {}
      const lines = formattedJson.split(/\r?\n/);
      bodyHtml = `<div class="orca-code-scroll">
        <div class="orca-code-lines">
          ${lines.map((line, idx) => `<div class="orca-code-row"><span class="orca-code-ln">${idx + 1}</span><code class="orca-code-text">${esc(line)}</code></div>`).join("")}
        </div>
      </div>`;
    }
  } else {
    const lines = String(file?.content || "").split(/\r?\n/);
    const commentTarget = view.stageLineCommentTarget;
    bodyHtml = `<div class="orca-code-scroll">
      <div class="orca-code-lines">
        ${lines.map((line, idx) => {
          const lineNum = idx + 1;
          const lineKey = `code:${tab.id}:${lineNum}`;
          const isCommenting = commentTarget?.key === lineKey;
          return `<div class="orca-code-row ${isCommenting ? "is-commenting" : ""}" data-action="open-stage-line-comment" data-key="${esc(lineKey)}" data-path="${esc(tab.path)}" data-line="${lineNum}" data-code="${esc(line)}">
            <span class="orca-code-ln">${lineNum}</span>
            <code class="orca-code-text">${esc(line)}</code>
            <span class="diff-comment-trigger">+ Nhận xét</span>
          </div>
          ${isCommenting ? `<div class="diff-comment-editor">
            <input type="text" data-stage-line-comment-input placeholder="Nhập yêu cầu cho Agent tại dòng ${lineNum} của ${esc(tab.name)}…" autocomplete="off">
            <button type="button" class="button primary small" data-action="send-stage-line-comment">${icon("arrow-up-right", 12)}<span>Gửi</span></button>
            <button type="button" class="button quiet small" data-action="cancel-stage-line-comment">Hủy</button>
          </div>` : ""}`;
        }).join("")}
      </div>
    </div>`;
  }

  const metaParts = [];
  if (totalLines > 0) metaParts.push(`${totalLines} dòng`);
  if (sizeBadge) metaParts.push(esc(sizeBadge));

  const leftToolbarMarkup = isWebBrowser
    ? `<div class="orca-viewer-nav is-web-browser">
        <button type="button" class="icon-button orca-viewer-icon" data-action="activate-stage-tab" data-tab-id="chat" title="Quay về cửa sổ Chat">${icon("arrow-left", 13)}</button>
        <button type="button" class="icon-button orca-viewer-icon" data-action="reload-stage-tab" data-tab-id="${esc(tab.id)}" title="Tải lại trang web">${icon("refresh-cw", 12)}</button>
        <div class="orca-viewer-address is-url-bar" title="${esc(tab.path)}">
          ${icon("globe", 12)}
          <span class="orca-address-host">localhost</span>
          <span class="orca-address-path">/${esc(tab.path)}</span>
        </div>
      </div>`
    : `<div class="orca-viewer-file-meta" title="${esc(tab.path)}">
        <span class="orca-meta-path">${esc(tab.path)}</span>
        ${metaParts.length ? `<small class="orca-meta-sub">${metaParts.join(" · ")}</small>` : ""}
      </div>`;

  const showModeSwitch = hasRichPreview && hasCodeView;
  const previewModeLabel = view.language === "en" ? "Preview" : "Xem trước";
  const codeModeLabel = view.language === "en" ? "Source code" : "Mã nguồn";

  return `<section class="orca-file-viewer" aria-label="Trình xem tệp ${esc(tab.name)}">
    <header class="orca-viewer-toolbar">
      ${leftToolbarMarkup}
      <div class="orca-viewer-actions">
        ${isWebBrowser ? `
          <button type="button" class="icon-button orca-viewer-icon orca-inspect-comment-btn ${view.stageHtmlInspectActive ? "is-active" : ""}" data-action="toggle-html-inspect" title="Nhấp vào phần tử để gửi nhận xét cho Agent">${icon("message-square-plus", 13)}</button>
        ` : ""}
        ${showModeSwitch ? `<div class="orca-mode-switch" role="tablist" aria-label="Chế độ xem tệp">
          <button type="button" role="tab" aria-selected="${mode === "preview"}" class="orca-mode-btn ${mode === "preview" ? "is-active" : ""}" data-action="stage-tab-mode" data-tab-id="${esc(tab.id)}" data-mode="preview" aria-label="${previewModeLabel}" title="${previewModeLabel}">${icon("eye", 15)}</button>
          <button type="button" role="tab" aria-selected="${mode === "code"}" class="orca-mode-btn ${mode === "code" ? "is-active" : ""}" data-action="stage-tab-mode" data-tab-id="${esc(tab.id)}" data-mode="code" aria-label="${codeModeLabel}" title="${codeModeLabel}">${icon("code-2", 15)}</button>
        </div>` : ""}
      </div>
    </header>
    ${isWebBrowser ? `<div class="orca-inspect-banner" data-html-inspect-banner ${view.stageHtmlInspectActive ? "" : "hidden"}>
      <span class="orca-inspect-banner-text" data-html-inspect-banner-text>Nhấp vào một phần tử trên trang để thêm nhận xét cho Agent.</span>
      <div class="orca-inspect-banner-right">
        <button type="button" class="orca-inspect-banner-close" data-action="close-html-inspect" title="Thoát chế độ chọn phần tử (Esc)">Esc</button>
      </div>
    </div>` : ""}
    <div class="orca-viewer-body">
      ${bodyHtml}
    </div>
  </section>`;
}

function wrapStageWithOrcaTabs(primaryMarkup) {
  const tabs = view.stageTabs || [];
  if (!tabs.length || !["chat", "workspaces"].includes(view.page)) return primaryMarkup;
  const activeTab = tabs.find((t) => t.id === view.activeStageTabId) || (view.stageSplit ? tabs[tabs.length - 1] : null);
  if (view.stageSplit && activeTab) {
    return `<div class="orca-stage-split-layout">
      <div class="orca-stage-pane is-primary">${primaryMarkup}</div>
      <div class="orca-stage-split-resizer" data-stage-split-resizer title="Kéo để thay đổi tỷ lệ giữa Chat và Trình xem tệp"></div>
      <div class="orca-stage-pane is-viewer">${renderStageFileViewer(activeTab)}</div>
    </div>`;
  }
  if (view.activeStageTabId !== "chat" && activeTab) {
    return renderStageFileViewer(activeTab);
  }
  return primaryMarkup;
}

function renderDockTreeLevel(node, depth, { collapsedSet, activePath, fileAction, workspaceId = "", taskId = "", showMention = false, showVaultMenu = false }) {
  const folders = node.foldersList || [...node.folders.values()];
  const files = node.files;
  let html = "";
  const padLeft = 10 + depth * 14;
  for (const folder of folders) {
    const isCollapsed = collapsedSet.has(folder.path);
    html += `<li class="orca-tree-item is-folder">
      <button type="button" class="orca-tree-row" style="padding-left:${padLeft}px" data-action="toggle-dock-folder" data-folder="${esc(folder.path)}" title="${esc(folder.path)}">
        <span class="orca-tree-caret ${isCollapsed ? "" : "is-open"}">${icon("chevron-right", 12)}</span>
        <span class="orca-tree-icon">${icon("folder", 14)}</span>
        <span class="orca-tree-label">${esc(folder.name)}</span>
      </button>
    </li>`;
    if (!isCollapsed) {
      html += renderDockTreeLevel(folder, depth + 1, { collapsedSet, activePath, fileAction, workspaceId, taskId, showMention, showVaultMenu });
    }
  }
  for (const file of files) {
    const isSelected = activePath && activePath === file.path;
    const fIcon = showVaultMenu ? "file-text" : dockFileIconName(file.name);
    html += `<li class="orca-tree-item is-file ${isSelected ? "is-selected" : ""}">
      <button type="button" class="orca-tree-row ${isSelected ? "is-selected" : ""}" style="padding-left:${padLeft + 16}px" data-action="${esc(fileAction)}" ${workspaceId ? `data-workspace-id="${esc(workspaceId)}"` : ""} ${taskId ? `data-id="${esc(taskId)}"` : ""} data-path="${esc(file.path)}" title="${esc(file.path)}">
        <span class="orca-tree-icon">${icon(fIcon, 14)}</span>
        <span class="orca-tree-label">${esc(file.name)}</span>
      </button>
      ${showMention ? `<button type="button" class="orca-tree-quick" data-action="mention-drawer-file" data-path="${esc(file.path)}" title="Chèn @${esc(file.path)} vào khung chat">@</button>` : ""}
      ${showVaultMenu ? vaultNoteOptionsMenu(file.path, { showRead: view.vaultViewMode === "graph", showGraph: view.vaultViewMode !== "graph", direction: "down" }) : ""}
    </li>`;
  }
  return html;
}

function pageSupportsRightDock(page = view.page) {
  if (page === "chat" || page === "workspaces" || page === "skills") return true;
  if (page === "knowledge") return Boolean(view.state?.settings?.vaultPath);
  return false;
}

function getRightDockTabsForPage(page = view.page, selectedTask = null) {
  if (page === "knowledge") {
    const tabs = [
      { id: "files", icon: "files", title: "Cây ghi chú Vault" },
      { id: "search", icon: "search", title: "Tìm ghi chú & #tag" },
      { id: "git", icon: "waypoints", title: "Liên kết hai chiều & Thẻ #tag" },
    ];
    if (view.vaultPreview?.content) {
      tabs.push({ id: "tasks", icon: "list-checks", title: "Mục lục ghi chú (Outline)" });
    }
    return tabs;
  }
  if (page === "skills") {
    return [
      { id: "files", icon: "files", title: "Danh mục Kỹ năng" },
      { id: "search", icon: "search", title: "Tìm kiếm kỹ năng" },
    ];
  }
  if (page === "workspaces") {
    return [
      { id: "files", icon: "files", title: "Cây thư mục dự án" },
      { id: "search", icon: "search", title: "Tìm kiếm tệp trong dự án" },
    ];
  }
  // page === "chat"
  if (selectedTask) {
    return [
      { id: "files", icon: "files", title: "Cây thư mục & Tệp" },
      { id: "search", icon: "search", title: "Tìm kiếm tệp" },
      { id: "git", icon: "git-branch", title: "Thay đổi (Changes) & Worktree" },
      { id: "tasks", icon: "list-checks", title: "Mục tiêu & Công cụ phiên" },
    ];
  }
  return [
    { id: "files", icon: "files", title: "Cây thư mục dự án" },
    { id: "search", icon: "search", title: "Tìm kiếm tệp" },
  ];
}

function orcaRightDockMarkup() {
  const page = view.page || "chat";
  if (!pageSupportsRightDock(page)) return "";
  const selectedTask = (page === "chat" && view.selected) ? (view.state?.tasks || []).find((t) => t.id === view.selected) : null;
  const availableTabs = getRightDockTabsForPage(page, selectedTask);
  const tab = availableTabs.some((t) => t.id === view.chatDrawerTab) ? view.chatDrawerTab : (availableTabs[0]?.id || "files");
  const filter = (view.chatDrawerFilter || "").trim().toLowerCase();
  const activeWsId = (page === "workspaces" && view.selected)
    ? view.selected
    : selectedTask?.workspaceId || view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || "";
  const activeWs = (view.state?.workspaces || []).find((w) => w.id === activeWsId) || null;

  if (!Array.isArray(view.collapsedDockFolders)) {
    view.collapsedDockFolders = null;
  }

  let subTitle = "Workspace";
  let subTooltip = "";
  let refreshAction = "refresh-dock-context";
  let moreMenuHtml = "";

  if (page === "knowledge") {
    const vaultPath = view.state?.settings?.vaultPath || "";
    subTitle = vaultPath ? (vaultPath.split(/[\\/]/).filter(Boolean).at(-1) || "Obsidian Vault") : "Obsidian Vault";
    subTooltip = vaultPath;
    refreshAction = "refresh-vault-files";
    moreMenuHtml = `<details class="codex-pop-menu is-right is-down">
      <summary class="icon-button orca-sub-btn" title="Tùy chọn Vault">${icon("ellipsis", 14)}</summary>
      <div class="codex-pop-card">
        <button type="button" class="codex-pop-item" data-action="vault-new-note"><span class="codex-pop-item-main">${icon("plus", 13)}<span>Ghi chú Markdown mới</span></span></button>
        <button type="button" class="codex-pop-item" data-action="open-obsidian" data-path="${esc(view.vaultPreview?.path || "")}"><span class="codex-pop-item-main">${icon("arrow-up-right", 13)}<span>Mở trong Obsidian</span></span></button>
        <button type="button" class="codex-pop-item" data-action="connect-vault"><span class="codex-pop-item-main">${icon("folder-open", 13)}<span>Đổi thư mục Vault…</span></span></button>
        <div class="codex-pop-sep"></div>
        <button type="button" class="codex-pop-item is-danger" data-action="disconnect-vault"><span class="codex-pop-item-main">${icon("x", 13)}<span>Ngắt kết nối Vault</span></span></button>
      </div>
    </details>`;
  } else if (page === "skills") {
    subTitle = `Kỹ năng (${(view.skills || []).length})`;
    subTooltip = "Thư viện Kỹ năng Agent";
    refreshAction = "scan-skills";
    moreMenuHtml = `<button type="button" class="icon-button orca-sub-btn" data-action="new-skill" title="Tạo skill mới">${icon("plus", 14)}</button>`;
  } else if (activeWs) {
    subTitle = activeWs.name;
    subTooltip = activeWs.path;
    refreshAction = "refresh-dock-context";
    const taskArtifactsCount = (selectedTask?.artifacts || []).length;
    moreMenuHtml = `<details class="codex-pop-menu is-right is-down">
      <summary class="icon-button orca-sub-btn" title="Tùy chọn dự án & phiên">${icon("ellipsis", 14)}</summary>
      <div class="codex-pop-card">
        ${selectedTask ? `
          <div class="codex-pop-head">Phiên trò chuyện</div>
          <button type="button" class="codex-pop-item" data-action="show-diff" data-id="${esc(selectedTask.id)}"><span class="codex-pop-item-main">${icon("file-text", 13)}<span>Diff & Review (${taskArtifactsCount})</span></span></button>
          <button type="button" class="codex-pop-item" data-action="open-task-flow" data-id="${esc(selectedTask.id)}"><span class="codex-pop-item-main">${icon("workflow", 13)}<span>Luồng điều phối</span></span></button>
          <button type="button" class="codex-pop-item" data-action="task-permissions" data-id="${esc(selectedTask.id)}"><span class="codex-pop-item-main">${icon("shield", 13)}<span>Quyền truy cập</span></span></button>
          <button type="button" class="codex-pop-item" data-action="edit-task-goal" data-id="${esc(selectedTask.id)}"><span class="codex-pop-item-main">${icon("target", 13)}<span>Mục tiêu & Checklist</span></span></button>
          <button type="button" class="codex-pop-item" data-action="task-instruction" data-id="${esc(selectedTask.id)}"><span class="codex-pop-item-main">${icon("settings-2", 13)}<span>Cấu hình Agent / Model</span></span></button>
          <button type="button" class="codex-pop-item" data-action="${selectedTask.archived ? "restore-task" : "archive-task"}" data-id="${esc(selectedTask.id)}"><span class="codex-pop-item-main">${icon("archive", 13)}<span>${selectedTask.archived ? "Khôi phục chat" : "Lưu trữ chat"}</span></span></button>
          <div class="codex-pop-sep"></div>
        ` : ""}
        <div class="codex-pop-head">Dự án</div>
        <button type="button" class="codex-pop-item" data-action="open-project-folder" data-id="${esc(activeWs.id)}"><span class="codex-pop-item-main">${icon("folder-open", 13)}<span>Mở trong Explorer</span></span></button>
        <button type="button" class="codex-pop-item" data-action="edit-project" data-id="${esc(activeWs.id)}"><span class="codex-pop-item-main">${icon("settings-2", 13)}<span>Sửa cấu hình dự án</span></span></button>
        <button type="button" class="codex-pop-item" data-action="add-workspace"><span class="codex-pop-item-main">${icon("folder-plus", 13)}<span>Thêm dự án mới…</span></span></button>
      </div>
    </details>`;
  }

  let bodyHtml = "";

  if (tab === "files") {
    if (page === "knowledge") {
      const vaultPath = view.state?.settings?.vaultPath || "";
      if (!vaultPath) {
        bodyHtml = `<div class="orca-dock-empty"><p>Chưa kết nối Obsidian Vault.</p><button type="button" class="button primary small" data-action="connect-vault">${icon("plus", 12)}<span>Kết nối Vault</span></button></div>`;
      } else {
        if (!view.vaultGraph && !view.vaultGraphLoading) {
          void loadVaultGraph();
        }
        const graphNodes = view.vaultGraph?.nodes || [];
        const paths = graphNodes.length
          ? graphNodes.map((n) => n.path)
          : (view.vaultEntries || []).filter((e) => e.type !== "directory").map((e) => e.path);
        const tree = buildDockFileTree(paths);
        if (view.collapsedDockFolders === null) {
          view.collapsedDockFolders = [];
        }
        const collapsedSet = new Set(view.collapsedDockFolders);
        const activePath = view.vaultPreview?.path || "";
        const rows = renderDockTreeLevel(tree, 0, {
          collapsedSet,
          activePath,
          fileAction: "vault-select-graph-node",
          showVaultMenu: true,
        });
        bodyHtml = `<ul class="orca-tree-list">${rows || `<li class="orca-dock-empty">Chưa có ghi chú Markdown.</li>`}</ul>`;
      }
    } else if (page === "skills") {
      const allSkills = view.skills || [];
      const groups = [
        ["personal", "Cá nhân", allSkills.filter((s) => s.editable)],
        ["codex", "Codex CLI", allSkills.filter((s) => !s.editable && (s.providers?.includes("codex") || (s.sources || []).join(" ").toLowerCase().includes("codex")))],
        ["antigravity", "Antigravity", allSkills.filter((s) => !s.editable && (s.providers?.includes("antigravity") || (s.sources || []).join(" ").toLowerCase().includes("antigravity")))],
        ["claude", "Claude Code", allSkills.filter((s) => !s.editable && (s.providers?.includes("claude") || (s.sources || []).join(" ").toLowerCase().includes("claude")))],
      ];
      const collapsedSet = new Set(view.collapsedDockFolders || []);
      bodyHtml = `<ul class="orca-tree-list">${groups.map(([key, label, items]) => {
        const folderKey = `skill:${key}`;
        const isCollapsed = collapsedSet.has(folderKey);
        return `<li class="orca-tree-item is-folder">
          <button type="button" class="orca-tree-row" style="padding-left:10px" data-action="toggle-dock-folder" data-folder="${esc(folderKey)}">
            <span class="orca-tree-caret ${isCollapsed ? "" : "is-open"}">${icon("chevron-right", 12)}</span>
            <span class="orca-tree-icon">${icon("folder", 14)}</span>
            <span class="orca-tree-label">${esc(label)}</span>
            <small class="orca-tree-badge">${items.length}</small>
          </button>
        </li>${isCollapsed ? "" : items.map((s) => `<li class="orca-tree-item is-file ${s.id === view.selectedSkillId ? "is-selected" : ""}">
          <button type="button" class="orca-tree-row ${s.id === view.selectedSkillId ? "is-selected" : ""}" style="padding-left:38px" data-action="select-skill" data-id="${esc(s.id)}" title="${esc(s.description || s.name)}">
            <span class="orca-tree-icon">${icon("file-text", 14)}</span>
            <span class="orca-tree-label">${esc(s.name)}</span>
          </button>
        </li>`).join("")}`;
      }).join("")}</ul>`;
    } else if (activeWs) {
      const allFiles = view.workspaceFileIndex?.[activeWs.id] || [];
      if (!view.workspaceFileIndex?.[activeWs.id]) {
        void ensureWorkspaceFileIndex(activeWs.id).then(() => render());
      }
      const tree = buildDockFileTree(allFiles);
      if (view.collapsedDockFolders === null && allFiles.length > 0) {
        const topFolders = (tree.foldersList || [...tree.folders.values()]).map((f) => f.path);
        view.collapsedDockFolders = topFolders.filter((p) => p !== "src");
      }
      const collapsedSet = new Set(view.collapsedDockFolders || []);
      const activeStageTab = (view.stageTabs || []).find((t) => t.id === view.activeStageTabId);
      const activePath = activeStageTab?.path || (page === "workspaces" ? (view.filePreview?.path || "") : (view.chatDrawerPreview?.path || ""));
      const fileAction = page === "workspaces" ? "dock-open-workspace-file" : "preview-drawer-file";
      const rows = renderDockTreeLevel(tree, 0, {
        collapsedSet,
        activePath,
        fileAction,
        workspaceId: activeWs.id,
        taskId: selectedTask?.id || "",
        showMention: page === "chat",
      });
      bodyHtml = `<ul class="orca-tree-list">${rows || `<li class="orca-dock-empty">Đang tải cây tệp dự án…</li>`}</ul>`;
    } else {
      bodyHtml = `<div class="orca-dock-empty"><p>Chưa có dự án nào được chọn.</p><button type="button" class="button primary small" data-action="add-workspace">${icon("plus", 12)}<span>Thêm dự án</span></button></div>`;
    }
  } else if (tab === "search") {
    let resultsHtml = "";
    const searchPlaceholder = page === "knowledge"
      ? "Tìm ghi chú hoặc #tag…"
      : page === "skills"
        ? "Tìm tên hoặc mô tả kỹ năng…"
        : "Tìm nhanh tên tệp trong dự án…";
    if (page === "knowledge") {
      const nodes = view.vaultGraph?.nodes || [];
      const matches = nodes.filter((n) => !filter || `${n.path} ${n.title || ""} ${(n.tags || []).join(" ")}`.toLowerCase().includes(filter)).slice(0, 80);
      resultsHtml = matches.length
        ? matches.map((n) => `<li class="orca-tree-item is-file"><button type="button" class="orca-tree-row" style="padding-left:12px" data-action="vault-select-graph-node" data-path="${esc(n.path)}"><span class="orca-tree-icon">${icon("file-text", 14)}</span><span class="orca-tree-label">${esc(n.title || n.name)}</span></button></li>`).join("")
        : `<li class="orca-dock-empty">Không có ghi chú khớp từ khóa.</li>`;
    } else if (page === "skills") {
      const matches = (view.skills || []).filter((s) => !filter || `${s.name} ${s.description}`.toLowerCase().includes(filter)).slice(0, 80);
      resultsHtml = matches.length
        ? matches.map((s) => `<li class="orca-tree-item is-file"><button type="button" class="orca-tree-row" style="padding-left:12px" data-action="select-skill" data-id="${esc(s.id)}"><span class="orca-tree-icon">${icon("file-text", 14)}</span><span class="orca-tree-label">${esc(s.name)}</span></button></li>`).join("")
        : `<li class="orca-dock-empty">Không có kỹ năng phù hợp.</li>`;
    } else {
      const allFiles = (activeWs && view.workspaceFileIndex?.[activeWs.id]) || [];
      const matches = allFiles.filter((f) => !filter || f.toLowerCase().includes(filter)).slice(0, 100);
      const fileAction = page === "workspaces" ? "dock-open-workspace-file" : "preview-drawer-file";
      resultsHtml = matches.length
        ? matches.map((f) => `<li class="orca-tree-item is-file"><button type="button" class="orca-tree-row" style="padding-left:12px" data-action="${fileAction}" data-workspace-id="${esc(activeWs?.id || "")}" data-id="${esc(selectedTask?.id || "")}" data-path="${esc(f)}"><span class="orca-tree-icon">${icon(dockFileIconName(f), 14)}</span><span class="orca-tree-label">${esc(f)}</span></button>${page === "chat" ? `<button type="button" class="orca-tree-quick" data-action="mention-drawer-file" data-path="${esc(f)}" title="Chèn @${esc(f)}">@</button>` : ""}</li>`).join("")
        : `<li class="orca-dock-empty">Không tìm thấy tệp phù hợp.</li>`;
    }
    bodyHtml = `<div class="orca-dock-search-wrap">
      <label class="orca-dock-search">
        ${icon("search", 13)}
        <input type="search" data-chat-drawer-filter value="${esc(view.chatDrawerFilter || "")}" placeholder="${esc(searchPlaceholder)}" autocomplete="off">
      </label>
    </div>
    <ul class="orca-tree-list">${resultsHtml}</ul>`;
  } else if (tab === "git") {
    if (page === "knowledge") {
      const graph = view.vaultGraph || { nodes: [], edges: [] };
      const activeFile = view.vaultPreview;
      const selectedNode = (graph.nodes || []).find((n) => n.path === activeFile?.path) || null;
      const connectedEdges = selectedNode ? (graph.edges || []).filter((e) => e.source === selectedNode.id || e.target === selectedNode.id) : [];
      const connectedNodes = selectedNode
        ? connectedEdges.map((e) => {
            const isOut = e.source === selectedNode.id;
            const otherId = isOut ? e.target : e.source;
            const node = (graph.nodes || []).find((n) => n.id === otherId);
            return node ? { node, kind: e.kind, direction: isOut ? "out" : "in" } : null;
          }).filter(Boolean)
        : [];
      const allTags = [...new Set((graph.nodes || []).flatMap((n) => n.tags || []))].slice(0, 20);
      bodyHtml = `<div class="orca-dock-pad">
        <div class="orca-section-label">LIÊN KẾT HAI CHIỀU (${connectedNodes.length})</div>
        ${connectedNodes.length
          ? `<ul class="orca-tree-list">${connectedNodes.map(({ node, direction }) => `<li class="orca-tree-item is-file"><button type="button" class="orca-tree-row" style="padding-left:10px" data-action="vault-select-graph-node" data-path="${esc(node.path)}"><span class="orca-tree-icon">${icon("file-text", 14)}</span><span class="orca-tree-label">${esc(node.title || node.name)}</span><small class="orca-tree-badge">${direction === "out" ? "→" : "←"}</small></button></li>`).join("")}</ul>`
          : `<p class="orca-muted-note">Chưa có liên kết <code>[[WikiLink]]</code> cho ghi chú này.</p>`}
        ${allTags.length ? `<div class="orca-section-label" style="margin-top:14px">THẺ CHỦ ĐỀ (#TAGS)</div>
        <div class="neural-tag-list">${allTags.map((t) => `<button type="button" class="kb-tag-chip" data-action="vault-filter-tag" data-tag="#${esc(t)}">#${esc(t)}</button>`).join("")}</div>` : ""}
      </div>`;
    } else {
      const artifacts = selectedTask?.artifacts || [];
      const taskBusy = selectedTask && ["running", "queued"].includes(selectedTask.status);
      const canManageWt = Boolean(selectedTask?.isolated && !taskBusy && !selectedTask.worktreeCleaned && !selectedTask.worktreeAppliedAt);
      const canMergeWt = Boolean(canManageWt && artifacts.length > 0);
      const isolatedTasks = (view.state?.tasks || []).filter((t) => t.workspaceId === activeWs?.id && t.isolated && !t.worktreeCleaned && !t.archived);
      const fanoutSiblings = selectedTask?.fanoutId ? (view.state?.tasks || []).filter((t) => t.fanoutId === selectedTask.fanoutId && !t.archived) : [];
      bodyHtml = `<div class="orca-dock-pad">
        ${selectedTask ? `<div class="orca-dock-actions-grid">
          ${selectedTask.status !== "queued" ? `<button type="button" class="button quiet small" data-action="show-diff" data-id="${esc(selectedTask.id)}">${icon("file-text", 13)}<span>Diff & Review (${artifacts.length})</span></button>` : ""}
          <button type="button" class="button quiet small" data-action="open-task-flow" data-id="${esc(selectedTask.id)}">${icon("workflow", 13)}<span>Luồng</span></button>
          ${canMergeWt ? `<button type="button" class="button primary small" data-action="apply-worktree" data-id="${esc(selectedTask.id)}">${icon("check", 13)}<span>Gộp vào dự án</span></button>` : ""}
          ${canManageWt ? `<button type="button" class="button quiet small" data-action="discard-worktree" data-id="${esc(selectedTask.id)}">${icon("delete", 13)}<span>Hủy worktree</span></button>` : ""}
        </div>` : ""}
        ${fanoutSiblings.length > 1 ? `<div class="orca-section-head" style="margin-top:8px">
          <span class="orca-section-label">ĐA LUỒNG (${fanoutSiblings.length})</span>
          <button type="button" class="button quiet small" data-action="compare-fanout" data-fanout-id="${esc(selectedTask.fanoutId)}">So sánh</button>
        </div>
        <ul class="orca-tree-list">${fanoutSiblings.map((t) => {
          const compName = t.fanoutCompetitor?.name || t.fanoutLabel || t.title;
          return `<li class="orca-tree-item is-file ${t.id === selectedTask.id ? "is-selected" : ""}"><button type="button" class="orca-tree-row ${t.id === selectedTask.id ? "is-selected" : ""}" style="padding-left:10px" data-task="${esc(t.id)}"><span class="wb-task-dot is-${esc(t.status || "done")}"></span><span class="orca-tree-label">${esc(compName)}</span><small class="orca-tree-badge">${(t.artifacts || []).length}</small></button></li>`;
        }).join("")}</ul>` : ""}
        <div class="orca-section-label" style="margin-top:8px">CHANGES (${artifacts.length})</div>
        ${artifacts.length
          ? `<ul class="orca-tree-list">${artifacts.map((filePath) => `<li class="orca-tree-item is-file"><button type="button" class="orca-tree-row" style="padding-left:10px" data-action="open-diff-file" data-id="${esc(selectedTask.id)}" data-path="${esc(filePath)}" title="${esc(filePath)}"><span class="orca-tree-icon">${icon("file-text", 14)}</span><span class="orca-tree-label">${esc(filePath)}</span><small class="orca-diff-dot">M</small></button></li>`).join("")}</ul>`
          : `<p class="orca-muted-note">${selectedTask ? "Chưa có tệp thay đổi nào trong phiên này." : "Chọn một cuộc trò chuyện để xem danh sách tệp thay đổi (Changes)."}</p>`}
        ${isolatedTasks.length ? `<div class="orca-section-label" style="margin-top:14px">WORKTREE CÔ LẬP (${isolatedTasks.length})</div>
        <ul class="orca-tree-list">${isolatedTasks.slice(0, 10).map((t) => `<li class="orca-tree-item is-file"><button type="button" class="orca-tree-row" style="padding-left:10px" data-task="${esc(t.id)}"><span class="orca-tree-icon">${icon("git-branch", 14)}</span><span class="orca-tree-label">${esc(t.title)}</span><small class="orca-tree-badge">${(t.artifacts || []).length}</small></button></li>`).join("")}</ul>` : ""}
      </div>`;
    }
  } else if (tab === "tasks") {
    if (page === "knowledge" && view.vaultPreview?.content) {
      const outline = extractMarkdownOutline(view.vaultPreview.content);
      bodyHtml = `<div class="orca-dock-pad">
        <div class="orca-section-label">MỤC LỤC GHI CHÚ (${outline.length})</div>
        ${outline.length
          ? `<ul class="orca-tree-list">${outline.map((item) => `<li class="orca-tree-item is-file"><button type="button" class="orca-tree-row" style="padding-left:${8 + (item.level - 1) * 10}px" data-action="vault-scroll-heading" data-heading-index="${item.index}"><span class="orca-tree-label">${esc(item.text)}</span></button></li>`).join("")}</ul>`
          : `<p class="orca-muted-note">Thêm tiêu đề <code># H1</code>, <code>## H2</code> để tạo mục lục tự động.</p>`}
      </div>`;
    } else if (selectedTask) {
      const checklist = selectedTask.goalChecklist || [];
      const totalUsage = Object.values(selectedTask.usage || {}).reduce((sum, item) => sum + tokenCount(item), 0);
      const taskBusy = ["running", "queued"].includes(selectedTask.status);
      const artifactsCount = (selectedTask.artifacts || []).length;
      const permLabel = selectedTask.permissionPreset === "read-only" ? "Chỉ đọc" : selectedTask.permissionPreset === "full-access" ? "Toàn quyền máy" : "Sửa workspace";
      bodyHtml = `<div class="orca-dock-pad">
        <div class="orca-section-label">THÔNG TIN & CÔNG CỤ PHIÊN</div>
        <p class="orca-muted-note">${esc(statuses[selectedTask.status] || selectedTask.status)} · ${fmtDate(selectedTask.createdAt)}${totalUsage ? ` · ${formatNumber(totalUsage)} tok` : ""} · ${esc(permLabel)}</p>
        <div class="orca-dock-actions-grid">
          ${selectedTask.status !== "queued" ? `<button type="button" class="button quiet small" data-action="show-diff" data-id="${esc(selectedTask.id)}">${icon("file-text", 13)}<span>Diff & Review (${artifactsCount})</span></button>` : ""}
          <button type="button" class="button quiet small" data-action="open-task-flow" data-id="${esc(selectedTask.id)}">${icon("workflow", 13)}<span>Luồng</span></button>
          <button type="button" class="button quiet small" data-action="task-permissions" data-id="${esc(selectedTask.id)}">${icon("shield", 13)}<span>Quyền</span></button>
          <button type="button" class="button quiet small" data-action="edit-task-goal" data-id="${esc(selectedTask.id)}">${icon("target", 13)}<span>Mục tiêu</span></button>
          <button type="button" class="button quiet small" data-action="open-folder" data-id="${esc(selectedTask.id)}">${icon("folder-open", 13)}<span>Mở thư mục</span></button>
          ${taskBusy ? `<button type="button" class="button danger small" data-action="stop-task" data-id="${esc(selectedTask.id)}">${icon("square", 12)}<span>Dừng</span></button>` : ""}
        </div>
        <div class="orca-section-head" style="margin-top:12px">
          <span class="orca-section-label">MỤC TIÊU & CHECKLIST (${checklist.length})</span>
          <button type="button" class="icon-button" data-action="edit-task-goal" data-id="${esc(selectedTask.id)}" title="Sửa mục tiêu">${icon("square-pen", 13)}</button>
        </div>
        ${selectedTask.goal ? `<p class="orca-goal-text">${esc(selectedTask.goal)}</p>` : ""}
        ${checklist.length
          ? `<ul class="orca-checklist">${checklist.map((item) => `<li><label><input type="checkbox" data-action="toggle-goal-item" data-id="${esc(selectedTask.id)}" data-goal-id="${esc(item.id)}" ${item.done ? "checked" : ""}><span class="${item.done ? "is-done" : ""}">${esc(item.text)}</span></label></li>`).join("")}</ul>`
          : `<p class="orca-muted-note">Chưa có checklist nghiệm thu.</p><button type="button" class="button quiet small" data-action="edit-task-goal" data-id="${esc(selectedTask.id)}">${icon("plus", 12)}<span>Thêm checklist</span></button>`}
      </div>`;
    }
  }

  return `<div class="orca-dock-resizer" data-right-dock-resizer title="Kéo để thay đổi độ rộng thanh bên phải"></div>
  <header class="orca-dock-topbar">
    <div class="orca-dock-tabs" role="tablist" aria-label="Công cụ thanh bên phải">
      ${availableTabs.map((item) => `<button type="button" class="orca-dock-tab ${tab === item.id ? "is-active" : ""}" data-action="right-dock-tab" data-tab="${esc(item.id)}" title="${esc(item.title)}">${icon(item.icon, 16)}</button>`).join("")}
    </div>
    <button type="button" class="icon-button orca-dock-toggle" data-action="toggle-chat-drawer" title="Đóng thanh bên phải">${icon("sidebar-right", 16)}</button>
  </header>
  <div class="orca-dock-subheader">
    <strong class="orca-dock-title" title="${esc(subTooltip || subTitle)}">${esc(subTitle)}</strong>
    <div class="orca-dock-subactions">
      <button type="button" class="icon-button orca-sub-btn" data-action="${refreshAction}" title="Làm mới">${icon("refresh-cw", 14)}</button>
      ${moreMenuHtml}
    </div>
  </div>
  <div class="orca-dock-body">
    ${bodyHtml}
  </div>`;
}

function projectDetailPage(workspace) {
  const activeFile = view.filePreview || null;
  const wsTasks = (view.state.tasks || []).filter((t) => t.workspaceId === workspace.id && !t.archived);
  const gitBranch = workspace.runtime?.isGit ? (workspace.runtime.branch || "HEAD") : "Chưa khởi tạo Git";
  if (!view.workspaceFileIndex?.[workspace.id]) {
    void ensureWorkspaceFileIndex(workspace.id).then(() => render());
  }

  const centerBodyHtml = activeFile ? `<div class="kb-doc-scroll">
    <div class="kb-doc-container">
      <div class="kb-doc-context-bar">
        <span class="kb-tag-chip">${esc(activeFile.path)}</span>
        <span class="kb-tag-chip">${formatNumber(activeFile.size)} B · ${fmtDate(activeFile.modifiedAt)}</span>
        <button type="button" class="kb-tag-chip" data-action="close-workspace-preview">Đóng xem tệp</button>
      </div>
      ${[".md", ".mdx", ".markdown"].includes(activeFile.extension)
        ? `<article class="markdown-preview kb-markdown-doc">${renderMarkdown(activeFile.content)}</article>`
        : `<pre class="code-preview"><code>${esc(activeFile.content)}</code></pre>`}
    </div>
  </div>` : `<div class="kb-doc-scroll">
    <div class="kb-doc-container">
      <section class="minimal-stage-hero">
        <div class="minimal-stage-title">
          <span class="minimal-stage-icon">${icon("folder-code", 20)}</span>
          <div>
            <h1>${esc(workspace.name)}</h1>
            <p>${esc(workspace.path)}</p>
          </div>
        </div>
        <div class="minimal-stage-actions">
          <button type="button" class="button primary small" data-action="new-chat" data-workspace-id="${esc(workspace.id)}">${icon("square-pen", 13)}<span>Chat mới</span></button>
          <button type="button" class="button quiet small" data-action="open-project-folder" data-id="${esc(workspace.id)}">${icon("folder-open", 13)}<span>Mở Explorer</span></button>
          <button type="button" class="button quiet small" data-action="edit-project" data-id="${esc(workspace.id)}">${icon("settings-2", 13)}<span>Cấu hình</span></button>
        </div>
      </section>
      ${wsTasks.length ? `<section class="minimal-section">
        <header class="minimal-section-head"><strong>Phiên làm việc trong dự án (${wsTasks.length})</strong></header>
        <div class="minimal-list">
          ${wsTasks.slice(0, 12).map((t) => `<button type="button" class="minimal-list-row" data-task="${esc(t.id)}">
            <span class="wb-task-dot is-${t.status || "done"}"></span>
            <strong>${esc(t.title)}</strong>
            <small>${esc(statuses[t.status] || t.status)} · ${fmtDate(t.updatedAt)}</small>
          </button>`).join("")}
        </div>
      </section>` : `<section class="empty-state"><strong>Chọn tệp ở thanh bên phải để đọc mã nguồn</strong><p>Cây thư mục dự án, tìm kiếm tệp và quản lý nhánh Git Worktree nằm gọn trong thanh công cụ bên phải.</p></section>`}
    </div>
  </div>`;

  return `<section class="minimal-center-stage" aria-label="Không gian Dự án">
    ${centerBodyHtml}
  </section>`;
}

function knowledgePage() {
  const vaultPath = view.state?.settings?.vaultPath || "";
  if (!vaultPath) return `<div class="page-head"><div><div class="eyebrow">OBSIDIAN · LOCAL VAULT</div><h1>Tri thức</h1><p>Kết nối vault để duyệt, chỉnh sửa ghi chú Markdown và xem đồ thị liên kết tri thức trực tiếp trên máy.</p></div><button class="button primary" data-action="connect-vault">${icon("plus", 15)} Kết nối vault</button></div><section class="empty-state knowledge-empty"><div class="empty-symbol">${icon("book-open-text", 18)}</div><strong>Chưa kết nối Obsidian vault</strong><p>OpenSybau chỉ đọc/ghi thư mục bạn chỉ định; nội dung không được đưa vào prompt tự động.</p><button class="button primary" data-action="connect-vault">${icon("plus", 15)} Kết nối vault</button></section>`;

  const mode = view.vaultViewMode || "files";
  const vaultName = vaultPath.split(/[\\/]/).filter(Boolean).at(-1) || "Obsidian Vault";
  const graph = view.vaultGraph || { nodes: [], edges: [] };
  const nodes = graph.nodes || [];
  const activeFile = view.vaultPreview || null;
  const selectedPath = activeFile?.path || "";
  const selectedNode = nodes.find((n) => n.path === selectedPath) || null;
  const isEditing = Boolean(mode === "files" && activeFile && view.vaultEditing && view.vaultEditingPath === activeFile.path);

  let centerBodyHtml = "";
  if (mode === "graph") {
    centerBodyHtml = `<div class="neural-canvas-wrap kb-graph-stage">
      <canvas id="vault-neural-canvas" class="neural-graph-canvas"></canvas>
      <div class="kb-graph-hud">
        <div class="kb-graph-legend">
          <span><i class="kb-dot is-selected"></i>Đang chọn</span>
          <span><i class="kb-dot is-hub"></i>Nút liên kết</span>
          <small>Kéo để xoay · Cuộn để thu phóng · Nhấp đúp để đọc</small>
        </div>
        <div class="kb-graph-controls">
          <button type="button" class="icon-button" data-action="neural-graph-reset" title="Căn giữa đồ thị">${icon("target", 14)}</button>
          <button type="button" class="icon-button" data-action="refresh-vault-graph" title="Làm mới đồ thị">${icon("refresh-cw", 14)}</button>
        </div>
      </div>
      ${nodes.length === 0 ? `<div class="neural-graph-empty"><strong>Chưa có ghi chú nào trong vault</strong><p>Tạo ghi chú Markdown mới và dùng <code>[[Tên ghi chú]]</code> hoặc <code>#tag</code> để xây dựng mạng tri thức.</p><button type="button" class="button primary small" data-action="vault-new-note">${icon("plus", 13)} Ghi chú mới</button></div>` : ""}
    </div>`;
  } else if (isEditing && activeFile) {
    centerBodyHtml = `<div class="vault-editor-wrap kb-editor-wrap">
      <textarea class="vault-editor-textarea" data-vault-editor spellcheck="false" placeholder="Nhập nội dung Markdown… Dùng [[Tên ghi chú]] để tạo liên kết và #tag để phân nhóm.">${esc(view.vaultDraft ?? activeFile.content)}</textarea>
      <div class="vault-editor-foot">
        <small>Hỗ trợ <code>[[Tên ghi chú]]</code> và <code>#tag</code> · Nhấn <code>Ctrl+S</code> để lưu nhanh.</small>
        <div class="kb-editor-foot-actions">
          <button type="button" class="button quiet small" data-action="vault-cancel-edit">Hủy</button>
          <button type="button" class="button primary small" data-action="vault-save-note" data-path="${esc(activeFile.path)}">${icon("check", 13)}<span>Lưu thay đổi</span></button>
        </div>
      </div>
    </div>`;
  } else if (activeFile) {
    const markdown = [".md", ".mdx", ".markdown"].includes(activeFile.extension);
    const noteTags = selectedNode?.tags || [];
    centerBodyHtml = `<div class="kb-doc-scroll" id="kb-doc-scroll">
      <div class="kb-doc-container">
        ${noteTags.length ? `<div class="kb-doc-context-bar">${noteTags.map((t) => `<button type="button" class="kb-tag-chip" data-action="vault-filter-tag" data-tag="#${esc(t)}">#${esc(t)}</button>`).join("")}</div>` : ""}
        ${markdown
          ? `<article class="markdown-preview kb-markdown-doc">${renderKnowledgeMarkdown(activeFile.content)}</article>`
          : `<pre class="code-preview"><code>${esc(activeFile.content)}</code></pre>`}
      </div>
    </div>`;
  } else {
    centerBodyHtml = `<div class="file-preview-empty kb-empty-stage">
      ${icon("book-open-text", 20)}
      <strong>Chọn ghi chú từ thanh bên phải</strong>
      <p>Duyệt cây thư mục ghi chú, tìm kiếm <code>[[WikiLink]]</code> ở thanh bên phải hoặc xem mạng đồ thị nơ-ron.</p>
      <div class="file-preview-empty-actions">
        <button type="button" class="button primary small" data-action="vault-new-note">${icon("plus", 13)} Ghi chú mới</button>
        <button type="button" class="button quiet small" data-action="vault-mode" data-mode="graph">${icon("waypoints", 13)} Xem đồ thị</button>
      </div>
    </div>`;
  }

  return `<section class="minimal-center-stage" aria-label="Không gian Tri thức">
    <header class="kb-stage-topbar">
      <div class="kb-topbar-left">
        <div class="kb-active-doc-info">
          <strong>${esc(activeFile ? activeFile.name : vaultName)}</strong>
          <small>${activeFile ? `${esc(activeFile.path)} · ${formatNumber(activeFile.size)} B` : `${nodes.length} ghi chú trong Vault`}</small>
        </div>
      </div>
      <div class="kb-topbar-right">
        <div class="vault-mode-tabs" role="tablist" aria-label="Chế độ xem Tri thức">
          <button type="button" class="vault-mode-tab ${mode === "files" ? "is-active" : ""}" data-action="vault-mode" data-mode="files">${icon("book-open-text", 13)}<span>Ghi chú</span></button>
          <button type="button" class="vault-mode-tab ${mode === "graph" ? "is-active" : ""}" data-action="vault-mode" data-mode="graph">${icon("waypoints", 13)}<span>Đồ thị${nodes.length ? ` (${nodes.length})` : ""}</span></button>
        </div>
        ${isEditing && activeFile ? `
          <button type="button" class="button quiet small" data-action="vault-cancel-edit">Hủy</button>
          <button type="button" class="button primary small" data-action="vault-save-note" data-path="${esc(activeFile.path)}">${icon("check", 13)}<span>Lưu</span></button>
        ` : activeFile ? `
          <button type="button" class="button quiet small" data-action="vault-edit-note" data-path="${esc(activeFile.path)}">${icon("square-pen", 13)}<span>Sửa</span></button>
          ${vaultNoteOptionsMenu(activeFile.path, { showRead: mode === "graph", showGraph: mode === "files", direction: "down" })}
        ` : `<button type="button" class="button primary small" data-action="vault-new-note">${icon("plus", 13)}<span>Ghi chú mới</span></button>`}
      </div>
    </header>
    <div class="kb-stage-body">
      ${centerBodyHtml}
    </div>
  </section>`;
}

async function ensureSkillDetail(id) {
  if (!id) return null;
  view.skillDetailsCache ||= {};
  if (view.skillDetailsCache[id]) return view.skillDetailsCache[id];
  if (view.skillLoadingId === id) return null;
  view.skillLoadingId = id;
  try {
    const { skill } = await api(`/api/skills/${encodeURIComponent(id)}`);
    if (skill) {
      view.skillDetailsCache[id] = skill;
      if (view.page === "skills") render();
    }
    return skill;
  } catch {
    return null;
  } finally {
    if (view.skillLoadingId === id) view.skillLoadingId = "";
  }
}

function skillPage() {
  const allSkills = view.skills || [];
  const activeSkillSummary = allSkills.find((s) => s.id === view.selectedSkillId) || allSkills[0] || null;
  if (activeSkillSummary && view.selectedSkillId !== activeSkillSummary.id) {
    view.selectedSkillId = activeSkillSummary.id;
  }
  const activeDetail = activeSkillSummary ? (view.skillDetailsCache?.[activeSkillSummary.id] || null) : null;
  if (activeSkillSummary && !activeDetail) {
    void ensureSkillDetail(activeSkillSummary.id);
  }
  const activeSkill = activeDetail || activeSkillSummary;
  const isEditing = Boolean(activeSkill?.editable && view.skillEditing && view.skillEditingId === activeSkill.id);

  let centerBodyHtml = "";
  if (isEditing && activeSkill) {
    centerBodyHtml = `<div class="vault-editor-wrap kb-editor-wrap">
      <textarea class="vault-editor-textarea" data-skill-inline-editor spellcheck="false" placeholder="Nội dung SKILL.md…">${esc(view.skillDraft ?? activeDetail?.content ?? "")}</textarea>
      <div class="vault-editor-foot">
        <small>Chỉnh sửa trực tiếp <code>SKILL.md</code> cục bộ của skill <strong>${esc(activeSkill.name)}</strong>.</small>
        <div class="kb-editor-foot-actions">
          <button type="button" class="button quiet small" data-action="cancel-inline-skill-edit">Hủy</button>
          <button type="button" class="button primary small" data-action="save-inline-skill" data-id="${esc(activeSkill.id)}">${icon("check", 13)}<span>Lưu SKILL.md</span></button>
        </div>
      </div>
    </div>`;
  } else if (activeSkill) {
    const rawContent = activeDetail?.content || "";
    const strippedBody = rawContent.trimStart().replace(/^(?:---[\r\n]+[\s\S]*?[\r\n]+---[\r\n\s]*)+/, "").trim();
    const skillSourceLabel = (activeSkill.sources || [activeSkill.source]).filter(Boolean).join(" · ");
    centerBodyHtml = `<div class="kb-doc-scroll">
      <div class="kb-doc-container is-full-stage">
        <section class="minimal-stage-hero skill-stage-hero">
          <div class="minimal-stage-title">
            <span class="minimal-stage-icon">${icon("notebook-tabs", 18)}</span>
            <div class="skill-hero-copy">
              <div class="skill-hero-title-row">
                <h1>${esc(activeSkill.name)}</h1>
                <span class="kb-tag-chip is-inline-badge">${activeSkill.editable ? "Cá nhân · Có thể sửa" : "Plugin / CLI · Chỉ đọc"}</span>
              </div>
              <p>${esc(activeSkill.description || skillSourceLabel)}</p>
            </div>
          </div>
        </section>
        <section class="settings-card skill-doc-card">
          <header class="skill-doc-card-head">
            <div class="skill-doc-card-title">
              ${icon("file-text", 14)}
              <strong>SKILL.md</strong>
              ${skillSourceLabel ? `<small>${esc(skillSourceLabel)}</small>` : ""}
            </div>
          </header>
          <div class="skill-doc-body">
            ${rawContent
              ? `<article class="markdown-preview kb-markdown-doc">${renderMarkdown(strippedBody || rawContent)}</article>`
              : `<p class="neural-muted">Đang tải nội dung SKILL.md…</p>`}
          </div>
        </section>
      </div>
    </div>`;
  } else {
    centerBodyHtml = `<div class="file-preview-empty kb-empty-stage">
      ${icon("notebook-tabs", 20)}
      <strong>Chọn kỹ năng từ thanh bên phải</strong>
      <p>Duyệt danh sách kỹ năng theo nhóm ở thanh bên phải để đọc hướng dẫn <code>SKILL.md</code> hoặc tạo kỹ năng mới.</p>
      <button type="button" class="button primary small" data-action="new-skill">${icon("plus", 13)}<span>Tạo skill</span></button>
    </div>`;
  }

  return `<section class="minimal-center-stage" aria-label="Không gian Kỹ năng">
    <header class="kb-stage-topbar">
      <div class="kb-topbar-left">
        <div class="kb-active-doc-info">
          <strong>${esc(activeSkill ? activeSkill.name : "Thư viện Kỹ năng")}</strong>
          <small>${activeSkill ? esc((activeSkill.sources || [activeSkill.source]).join(" · ")) : `${allSkills.length} skill cục bộ`}</small>
          ${activeSkill ? `<span class="kb-tag-chip is-inline-badge">${activeSkill.editable ? "Cá nhân · Có thể sửa" : "Plugin / CLI · Chỉ đọc"}</span>` : ""}
        </div>
      </div>
      <div class="kb-topbar-right">
        ${activeSkill ? (isEditing
          ? `<button type="button" class="button quiet small" data-action="cancel-inline-skill-edit">Hủy</button>
             <button type="button" class="button primary small" data-action="save-inline-skill" data-id="${esc(activeSkill.id)}">${icon("check", 13)}<span>Lưu</span></button>`
          : activeSkill.editable
            ? `<button type="button" class="button quiet small" data-action="start-inline-skill-edit" data-id="${esc(activeSkill.id)}">${icon("square-pen", 13)}<span>Sửa</span></button>
               <button type="button" class="button quiet small" data-action="delete-skill" data-id="${esc(activeSkill.id)}">${icon("delete", 13)}<span>Xóa</span></button>`
            : `<button type="button" class="button quiet small" data-action="copy-skill" data-id="${esc(activeSkill.id)}">${icon("copy", 13)}<span>Sao chép để sửa</span></button>`) : ""}
        <button type="button" class="button primary small" data-action="new-skill">${icon("plus", 13)}<span>Tạo skill</span></button>
      </div>
    </header>
    <div class="kb-stage-body">
      ${centerBodyHtml}
    </div>
  </section>`;
}
const contentImportExtensions = new Set([
  ".md", ".markdown", ".mdx", ".txt", ".text", ".rst", ".adoc", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".csv", ".tsv", ".xml", ".html", ".htm", ".log", ".diff", ".patch",
  ".css", ".scss", ".less", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx", ".vue", ".svelte", ".astro", ".py", ".go", ".rs", ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".rb", ".swift", ".sql", ".sh", ".ps1", ".bat", ".cmd",
]);
const markdownContentExtensions = new Set([".md", ".markdown", ".mdx", ".txt", ".text", ".rst", ".adoc"]);
const contentImportAccept = [...contentImportExtensions].join(",");
function composerAttachmentKey(formOrInput) {
  const form = formOrInput?.matches?.("form") ? formOrInput : formOrInput?.closest("form");
  return form?.dataset.form === "task-chat" ? `task:${form.dataset.id}` : "home";
}
function composerAttachmentsMarkup(key) {
  const files = view.composerAttachments?.[key] || [];
  if (!files.length) return "";
  return `<div class="composer-attachments" aria-label="Tệp đính kèm">${files.map((item) => `<div class="composer-attachment" title="${esc(item.path)}"><span class="composer-attachment-icon">${icon("file", 17)}</span><span class="composer-attachment-name">${esc(item.path)}</span><button type="button" data-action="remove-composer-attachment" data-scope="${esc(key)}" data-attachment-id="${esc(item.id)}" aria-label="Gỡ ${esc(item.path)}" title="Gỡ tệp">${icon("x", 14)}</button></div>`).join("")}</div>`;
}
function clearComposerAttachments(form) {
  const key = composerAttachmentKey(form);
  if (view.composerAttachments?.[key]) delete view.composerAttachments[key];
}
async function readComposerAttachments(form) {
  const files = view.composerAttachments?.[composerAttachmentKey(form)] || [];
  return Promise.all(files.map(async ({ file, path }) => {
    const extension = file.name.toLowerCase().match(/\.[^.]+$/)?.[0] || "";
    const content = await file.text();
    if (content.includes("\u0000")) throw new Error(`Tệp "${file.name}" là tệp nhị phân; chỉ gửi được nội dung văn bản.`);
    if (!content.trim()) throw new Error(`Tệp "${file.name}" đang trống.`);
    return { name: path, content };
  }));
}
function composerAddMenu(target, taskId = "") {
  const extra = taskId
    ? `<button type="button" data-action="edit-task-goal" data-id="${esc(taskId)}">${icon("target", 16)}<span>Mục tiêu cuộc trò chuyện</span></button>`
    : `<button type="button" data-action="toggle-home-config">${icon("settings-2", 16)}<span>Agent và model</span></button>`;
  const fileImportOptions = [
    { label: "Tệp văn bản, Markdown, mã nguồn", icon: "file", attrs: `accept="${contentImportAccept}" multiple`, aria: "Chọn tệp văn bản hoặc Markdown" },
    { label: "Thư mục tệp văn bản", icon: "folder-open", attrs: "webkitdirectory multiple", aria: "Chọn thư mục tệp văn bản" },
  ].map((option) => `<label class="composer-file-option"><span class="composer-file-option-label">${icon(option.icon, 16)}<span>${option.label}</span></span><input type="file" ${option.attrs} data-content-file-import data-import-target="${target}" aria-label="${option.aria}"><small data-content-file-status aria-live="polite" hidden></small></label>`).join("");
  return `<details class="composer-add"><summary aria-label="Thêm tệp và tính năng" title="Thêm tệp và tính năng">${icon("plus", 18)}</summary><div class="composer-add-menu" role="group" aria-label="Thêm vào cuộc trò chuyện"><strong>Thêm vào cuộc trò chuyện</strong>${fileImportOptions}${extra}<button type="button" data-page="skills">${icon("notebook-tabs", 16)}<span>Kỹ năng</span></button><small>Tệp văn bản được gửi riêng kèm tin nhắn. Tối đa 20 tệp, tổng 1 MB.</small></div></details>`;
}
function permissionModeIcon(mode, size = 16) {
  if (mode === "read-only") {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2"/><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>`;
  }
  if (mode === "workspace-write") {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 10 11 12 9 14"/><line x1="12.5" y1="14" x2="15" y2="14"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><line x1="12" y1="8" x2="12" y2="12.5"/><circle cx="12" cy="15.8" r="0.9" fill="currentColor" stroke="none"/></svg>`;
}
function composerPermissionMenuMarkup(currentPreset = "workspace-write", scope = "home", taskId = "") {
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
function contentFileImportField(target) {
  return '<label class="content-file-import">Thêm tệp nội dung<input type="file" accept="' + contentImportAccept + '" multiple data-content-file-import data-import-target="' + esc(target) + '"><small data-content-file-status>Chọn nhiều tệp văn bản cùng lúc, gồm Markdown (.md), TXT, JSON, YAML, CSV, HTML và mã nguồn. Tệp được nối vào nội dung, không lưu riêng.</small></label>';
}
async function importIntoContentField(input, files) {
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
  } catch (error) { if (status) { status.textContent = error.message || "Không thể nhập tệp."; status.hidden = false; } showToast(error.message || "Không thể nhập tệp."); }
  finally { input.value = ""; }
}
function importContentFiles(input) {
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
  } finally { input.value = ""; }
}
function showSkillCreateModal() {
  const body = '<label>Tên skill<input name="name" maxlength="100" required autocomplete="off" spellcheck="false" placeholder="Ví dụ: review-api"></label><label>Mô tả ngắn<input name="description" maxlength="500" required placeholder="Khi nào và cách nào nên dùng skill này"></label><label>Dùng cho<select name="scope"><option value="universal">OpenSybau · mọi agent, gồm API</option><option value="codex">Codex CLI</option><option value="antigravity">Antigravity CLI</option><option value="claude">Claude Code CLI</option><option value="all-cli">Tất cả CLI · Codex, Antigravity, Claude</option></select></label>' + contentFileImportField("instructions") + '<label>Hướng dẫn<textarea name="instructions" maxlength="98000" rows="9" placeholder="Quy trình, quy tắc và kết quả mong muốn…"></textarea></label><p class="form-note">OpenSybau lưu skill dùng chung trong dữ liệu riêng của ứng dụng và đưa hướng dẫn vào prompt của agent đã chọn, kể cả API. Chọn một CLI để cài skill trực tiếp vào thư mục cá nhân của CLI đó. OpenSybau không ghi đè skill trùng tên.</p>';
  showModal("Tạo skill", body, "Tạo skill", "skill-create");
}
function defaultSkillScope(providers = []) {
  if (providers.includes("*")) return "universal";
  const cliProviders = ["codex", "antigravity", "claude"].filter((provider) => providers.includes(provider));
  if (cliProviders.length === 3) return "all-cli";
  if (cliProviders.includes("codex") && cliProviders.includes("antigravity")) return "shared";
  if (cliProviders.length === 1) return cliProviders[0];
  return "universal";
}
async function showSkillView(id) {
  const { skill } = await api(`/api/skills/${encodeURIComponent(id)}`);
  const source = (skill.sources || [skill.source]).join(" · ");
  const actions = skill.editable ? `<button class="button" type="button" data-action="edit-skill" data-id="${esc(skill.id)}">Sửa skill</button>` : `<button class="button" type="button" data-action="copy-skill" data-id="${esc(skill.id)}">Sao chép để sửa</button>`;
  const body = `<div class="skill-view-meta"><strong>${esc(skill.name)}</strong><p>${esc(skill.description)}</p><small>${esc(source)}</small></div><pre class="skill-source"><code>${esc(skill.content)}</code></pre><div class="skill-view-actions">${actions}</div>`;
  showModal("Nội dung skill", body, "Đóng", "dismiss");
}
async function showSkillEdit(id) {
  const { skill } = await api(`/api/skills/${encodeURIComponent(id)}`);
  if (!skill.editable) throw new Error("Skill này chỉ đọc. Hãy sao chép thành skill cá nhân trước khi sửa.");
  const body = `<p class="form-note">${esc(skill.name)} · ${esc((skill.sources || [skill.source]).join(" · "))}</p><label>Toàn bộ nội dung SKILL.md<textarea name="content" rows="17" required spellcheck="false">${esc(skill.content)}</textarea></label>`;
  showModal("Sửa skill", body, "Lưu thay đổi", "skill-edit");
  $(".modal").dataset.id = skill.id;
}
function showVaultModal() {
  const current = view.state.settings.vaultPath || "";
  const body = `<label>Đường dẫn thư mục Obsidian vault<input name="vaultPath" required value="${esc(current)}" placeholder="D:\\Notes\\My Vault" autocomplete="off" spellcheck="false"></label><p class="form-note">OpenSybau chỉ đọc tệp Markdown bên trong thư mục này. Kết nối không tự đưa ghi chú vào ngữ cảnh task.</p>`;
  showModal(current ? "Đổi Obsidian vault" : "Kết nối Obsidian vault", body, "Kết nối", "vault");
}
function workflowNodes(task) {
  const nodes = orchestrationNodes(task);
  const labels = { complete: "Hoàn tất", active: "Đang chạy", queued: "Đang chờ", pending: "Chưa chạy", failed: "Lỗi", cancelled: "Đã dừng" };
  return nodes.map((node, index) => `<div class="workflow-step"><button class="workflow-node node-${esc(node.state)}" data-action="inspect-task" data-id="${esc(task.id)}" aria-label="${esc(node.title)} · ${labels[node.state] || "Chưa ghi nhận"}"><span class="workflow-node-mark">${icon(node.state === "complete" ? "check" : node.icon, 14)}</span><strong>${esc(node.title)}</strong><small>${esc(node.group)}</small><em>${labels[node.state] || "Chưa ghi nhận"}</em></button>${index < nodes.length - 1 ? `<span class="workflow-edge ${node.state === "complete" ? "edge-done" : ""}" aria-hidden="true">${icon("chevron-right", 16)}</span>` : ""}</div>`).join("");
}
function workflowPage() {
  if (view.selected && view.state.tasks.some((task) => task.id === view.selected)) return taskDetails();
  const tasks = view.state.tasks;
  const active = tasks.filter((task) => ["queued", "running"].includes(task.status));
  return `<div class="page-head"><div><div class="eyebrow">TASK ORCHESTRATION</div><h1>Luồng</h1><p>Xem sơ đồ từng bước, log hoạt động và đầu ra được ghi nhận cho mỗi cuộc trò chuyện.</p></div><button class="button primary" data-action="new-task">${icon("plus", 15)} Tạo task</button></div><div class="flow-summary"><div><small>Đang hoạt động</small><strong>${active.length}</strong></div><div><small>Có bản ghi</small><strong>${tasks.length}</strong></div><p>Chọn một luồng để xem chi tiết điều phối và đầu ra từng agent.</p></div>${tasks.length ? `<section class="workflow-board">${tasks.map((task) => `<article class="workflow-card"><header><button data-action="open-task-flow" data-id="${esc(task.id)}" class="workflow-task-title"><strong>${esc(task.title)}</strong><small>${esc(view.state.workspaces.find((workspace) => workspace.id === task.workspaceId)?.name || task.workspacePath)} · ${esc(taskProgress(task))}</small></button><span class="pill status-${esc(task.status)}"><i></i>${esc(statuses[task.status] || task.status)}</span></header><div class="workflow-lane">${workflowNodes(task)}</div><footer><span>${task.config.workflow === "chat-only" ? `Chat · ${esc(providerTitle(view.connectors, task.config.chatProvider))}` : task.config.workflow === "plan-only" ? `${esc(providerTitle(view.connectors, task.config?.roles?.plan?.provider || roleConfig(task.config, "plan")?.provider))} · chỉ lập kế hoạch` : esc(workflowSummary(task))}</span><button class="workflow-record-link" data-action="open-task-flow" data-id="${esc(task.id)}">${icon("workflow", 14)} Mở bản ghi</button><time>${fmtDate(task.updatedAt)}</time></footer></article>`).join("")}</section>` : `<section class="empty-state workflow-empty"><strong>Chưa có bản ghi luồng</strong><p>Bản ghi điều phối sẽ xuất hiện tại đây khi một cuộc trò chuyện hoặc task được tạo trong workspace.</p><button class="button primary" data-action="new-task">${icon("plus", 15)} Tạo task đầu tiên</button></section>`}`;
}
function memoryPage() {
  const notes = view.state?.memories || [];
  const workspaces = view.state?.workspaces || [];
  const scopeFilter = view.memoryWorkspaceFilter || "all";
  const sharedCount = notes.filter((m) => m.workspaceId === "all").length;
  const filteredNotes = notes.filter((m) => {
    if (scopeFilter === "all") return true;
    if (scopeFilter === "global") return m.workspaceId === "all";
    return m.workspaceId === scopeFilter;
  });

  return `<div class="page-head">
    <div>
      <div class="eyebrow">LOCAL MEMORY</div>
      <h1>Bộ nhớ</h1>
      <p>Ghi chú lưu trong máy này. Task chỉ nhận tối đa ba ghi chú có từ khóa phù hợp.</p>
    </div>
    <button class="button primary" data-action="new-memory">${icon("plus", 15)} Thêm ghi nhớ</button>
  </div>
  <div class="flow-summary">
    <div><small>Đang hiển thị</small><strong>${filteredNotes.length}</strong></div>
    <div><small>Tổng ghi nhớ</small><strong>${notes.length}</strong></div>
    <p>Mọi ghi nhớ đều bắt đầu từ nội dung bạn tự lưu. OpenSybau không bịa dữ liệu hoặc tự lấy toàn bộ vault vào prompt.</p>
  </div>
  <div class="list-toolbar">
    <div class="filters" role="tablist" aria-label="Phạm vi bộ nhớ">
      <button type="button" class="filter ${scopeFilter === "all" ? "active" : ""}" data-action="memory-scope-filter" data-scope="all">Tất cả (${notes.length})</button>
      <button type="button" class="filter ${scopeFilter === "global" ? "active" : ""}" data-action="memory-scope-filter" data-scope="global">Dùng chung (${sharedCount})</button>
      ${workspaces.map((ws) => {
        const count = notes.filter((m) => m.workspaceId === ws.id).length;
        return `<button type="button" class="filter ${scopeFilter === ws.id ? "active" : ""}" data-action="memory-scope-filter" data-scope="${esc(ws.id)}">${esc(ws.name)} (${count})</button>`;
      }).join("")}
    </div>
    <span>${notes.length} ghi nhớ đã lưu trên máy này</span>
  </div>
  ${filteredNotes.length ? `<section class="memory-list">
    ${filteredNotes.map((m) => `<article class="memory-card">
      <div>
        <strong>${esc(m.title)}</strong>
        <small>${m.workspaceId === "all" ? "Dùng chung" : esc(workspaces.find((w) => w.id === m.workspaceId)?.name || "Workspace đã gỡ")} · ${fmtDate(m.createdAt)}</small>
      </div>
      <p>${esc(m.content)}</p>
      <button class="icon-button" data-action="delete-memory" data-id="${esc(m.id)}" title="Xóa ghi nhớ" aria-label="Xóa ghi nhớ">${icon("x", 16)}</button>
    </article>`).join("")}
  </section>` : `<section class="empty-state">
    <div class="empty-symbol">${icon("brain", 18)}</div>
    <strong>Chưa có ghi nhớ lưu</strong>
    <p>Mọi ghi nhớ đều bắt đầu từ nội dung bạn tự lưu. OpenSybau không bịa dữ liệu hoặc tự lấy toàn bộ vault vào prompt.</p>
    <button class="button primary" data-action="new-memory">${icon("plus", 15)} Thêm ghi nhớ</button>
  </section>`}`;
}

function settingsPage() {
  const defaults = view.state?.settings?.defaults || {};
  const maxConcurrent = view.state?.settings?.maxConcurrent || 2;
  const canSaveRoles = workflowRoles.every((role) => providersForRole(view.connectors, role.id).length > 0);
  const apiSetup = (view.providers || []).map((provider) => `<div class="provider-setup-row"><span class="provider-status-dot ${provider.available ? "ready" : "missing"}"></span><div><strong>${esc(provider.name)} <span class="provider-protocol">${provider.managedBy === "local" ? "OpenSybau" : "Từ biến môi trường"}</span></strong><small>${provider.available ? `${provider.models.length} model · đã cấu hình${provider.apiKeyConfigured ? " · API key đã lưu" : ""}` : esc(provider.error || "Chưa đủ cấu hình")} · ${esc(provider.baseUrl)}</small></div><div class="provider-row-actions">${provider.managedBy === "local" ? `<button class="button quiet small" type="button" data-action="provider-edit" data-id="${esc(provider.id)}">Sửa</button><button class="button quiet small" type="button" data-action="provider-delete" data-id="${esc(provider.id)}">Xóa</button>` : `<button class="button quiet small" type="button" data-action="provider-import-env" data-id="${esc(provider.id)}">Quản lý trong app</button>`}</div></div>`).join("");
  const cliSetup = cliProviderGuides.map((agent) => {
    const connector = view.connectors?.[agent.id];
    const status = cliConnectionStatus(connector);
    const action = status.tone === "missing"
      ? window.opensybauDesktop?.supportsCliInstall
        ? `<button class="button quiet small" type="button" data-action="provider-cli-install" data-id="${esc(agent.id)}" ${view.cliInstallProvider ? "disabled" : ""}>${view.cliInstallProvider === agent.id ? "Đang cài đặt…" : "Cài CLI"}</button>`
        : `<a class="button quiet small" href="${esc(agent.url)}" target="_blank" rel="noreferrer">Hướng dẫn cài</a>`
      : status.action === "refresh"
        ? cliRefreshButton()
        : `<button class="button quiet small" type="button" data-action="provider-cli-login" data-id="${esc(agent.id)}">Mở terminal đăng nhập</button>`;
    const detail = status.tone === "ready"
      ? `${connector.models.length} model${connector.models.length === 1 ? "" : "s"}${connector.version && connector.version !== "unavailable" ? ` · ${connector.version}` : ""}`
      : status.tone === "missing" ? connector?.error || agent.installHelp : connector?.installed && connector?.error ? connector.error : agent.summary;
    return `<article class="cli-guide-row"><span class="cli-guide-icon">${icon("square-terminal", 16)}</span><div><strong>${esc(agent.name)} <span class="cli-guide-status ${esc(status.tone)}">${esc(status.label)}</span></strong><small>${esc(detail)}</small></div><div class="cli-guide-actions">${action}</div></article>`;
  }).join("");
  const noReadyConnector = !Object.values(view.connectors || {}).some((connector) => connector?.available && connector.capabilities?.plan);
  const readyCliCount = cliProviderGuides.filter((agent) => cliConnectionStatus(view.connectors?.[agent.id]).tone === "ready").length;
  const readyApiCount = (view.providers || []).filter((p) => p.available).length;
  const activeTheme = getThemeDefinition(view.theme);
  const themeGroupsHtml = THEME_GROUPS.map((group) => {
    const groupThemes = THEMES.filter((item) => item.group === group.id);
    const cardsHtml = groupThemes.map((theme) => {
      const isActive = theme.id === activeTheme.id;
      const [bgHex, panelHex, accentHex, inkHex] = theme.swatches;
      return `<button type="button" class="theme-gallery-item ${isActive ? "is-active" : ""}" data-action="pick-theme" data-theme-id="${esc(theme.id)}" aria-pressed="${isActive ? "true" : "false"}">
        <div class="theme-preview-window" style="background:${bgHex};--tp-bg:${bgHex};--tp-panel:${panelHex};--tp-accent:${accentHex};--tp-ink:${inkHex}">
          <span class="theme-preview-rail" style="background:${panelHex}"><i style="background:${accentHex}"></i><i style="background:${inkHex};opacity:.35"></i><i style="background:${inkHex};opacity:.22"></i></span>
          <span class="theme-preview-stage" style="background:${bgHex}">
            <em class="theme-preview-bar" style="background:${inkHex};opacity:.55"></em>
            <em class="theme-preview-bubble" style="background:${panelHex};border-color:${accentHex}55"></em>
            <em class="theme-preview-composer" style="background:${panelHex}"><b style="background:${accentHex}"></b></em>
          </span>
        </div>
        <div class="theme-gallery-meta">
          <div class="theme-gallery-title-row">
            <strong>${esc(theme.label)}</strong>
            <span class="theme-gallery-badge">${esc(theme.badge)}</span>
          </div>
          <small>${esc(theme.description)}</small>
          <div class="theme-gallery-swatches">
            ${theme.swatches.map((hex) => `<i style="background-color:${hex};display:inline-block;width:14px;height:14px;border-radius:999px" title="${hex}"></i>`).join("")}
            <span class="theme-gallery-check">${isActive ? icon("check", 13) : ""}</span>
          </div>
        </div>
      </button>`;
    }).join("");
    return `<div class="theme-gallery-group">
      <div class="theme-gallery-group-head">
        <strong>${esc(group.label)}</strong>
        <small>${esc(group.description)}</small>
      </div>
      <div class="theme-gallery-grid">${cardsHtml}</div>
    </div>`;
  }).join("");

  return `<div class="page-head">
    <div>
      <div class="eyebrow">SYSTEM & PROVIDERS</div>
      <h1>Cài đặt</h1>
      <p>Định tuyến model mặc định cho từng vai trò điều phối, kết nối Agent CLI cục bộ và quản lý nguồn API.</p>
    </div>
    <div class="page-head-actions">
      ${cliRefreshButton()}
      <button class="button primary" type="button" data-action="provider-add">${icon("plus", 15)} Thêm nguồn AI</button>
    </div>
  </div>
  <div class="quick-stats">
    <div><small>Agent CLI sẵn sàng</small><strong>${readyCliCount}/${cliProviderGuides.length}</strong></div>
    <div><small>Nguồn API / Local</small><strong>${readyApiCount}</strong></div>
    <div><small>Chạy đồng thời</small><strong>${maxConcurrent}</strong></div>
    <div class="stats-note">Khóa API và cấu hình điều phối chỉ lưu cục bộ trên máy này.</div>
  </div>
  <form class="settings-form" data-modal data-form="settings">
    <section class="settings-card theme-gallery-card" id="settings-theme">
      <header>
        <div>
          <h2>Giao diện & Chủ đề màu</h2>
          <p>Chuyển đổi tức thì giữa chủ đề Tối nguyên bản, Đa sắc Antigravity và Sáng thanh lịch. Bạn cũng có thể đổi nhanh trên thanh tiêu đề góc phải trên cùng.</p>
        </div>
        <span class="pill status-done"><i></i>${esc(activeTheme.label)}</span>
      </header>
      <div class="theme-gallery-groups">${themeGroupsHtml}</div>
    </section>
    <section class="settings-card" id="settings-roles"><header><div><h2>Ai ra lệnh, ai thực hiện</h2><p>Chọn model lập kế hoạch (ra lệnh), model triển khai (thực hiện) và model review. Mỗi task vẫn có thể dùng bộ model khác.</p></div></header>
        ${noReadyConnector ? `<div class="provider-connect-callout"><span class="provider-connect-icon">${icon("plug-zap", 17)}</span><div><strong>Chưa kết nối nguồn AI nào</strong><p>Thêm API/model local hoặc cài, đăng nhập CLI. Sau đó bạn có thể gán riêng model lập kế hoạch, triển khai và review.</p></div><div><button class="button primary small" type="button" data-action="provider-add">Kết nối API / model local</button><button class="button quiet small" type="button" data-action="provider-connect-cli">Kết nối CLI agent</button></div></div>` : ""}
      <div class="agent-role-grid settings-role-grid">${workflowRoles.map((role) => roleEditor(role.id, defaults.roles?.[role.id] || roleConfig(defaults, role.id))).join("")}</div>
      <div class="form-note">Khi chọn model API, yêu cầu và ngữ cảnh dự án tương ứng sẽ được gửi tới dịch vụ đó. Model CLI chạy cục bộ theo quyền của CLI.</div>
      ${view.settingsSupported ? "" : `<div class="feature-warning">Server đang chạy phiên bản cũ. Model vẫn chọn theo từng task; hãy khởi động lại server để bật lưu model mặc định và gắn skill.</div>`}
      <footer class="settings-actions"><button class="button primary" type="submit" ${view.settingsSupported && canSaveRoles ? "" : "disabled"}>Lưu định tuyến mặc định</button></footer>
    </section>
    <section class="settings-card cli-setup-card" id="cli-setup"><header><div><h2>Agent CLI</h2><p>OpenSybau tự dò Codex, Antigravity và Claude Code trên máy. Nếu CLI đã cài nhưng chưa đăng nhập, mở terminal đăng nhập ngay tại đây.</p></div>${cliRefreshButton()}</header><div class="cli-guide-list">${cliSetup}</div><p class="form-note">Terminal được mở trên máy đang chạy OpenSybau. Hoàn tất OAuth hoặc đăng nhập ở đó rồi chọn Quét lại; CLI không cần khai báo API key riêng.</p></section>
    <section class="settings-card provider-setup-card" id="settings-api"><header><div><h2>Nguồn API và model local</h2><p>Kết nối OpenAI/ChatGPT API, Google Gemini API, Claude API, Ollama, LM Studio hoặc endpoint tương thích.</p></div><button class="button primary small" type="button" data-action="provider-add">${icon("plus", 14)} Thêm nguồn</button></header><div class="provider-setup-list">${apiSetup || `<div class="provider-empty-state"><strong>Chưa có API hoặc model local</strong><p>Chọn cấu hình nhanh để nhập API key và model, hoặc kết nối Ollama/LM Studio. Bạn không cần API nếu dùng CLI.</p><button class="button quiet small" type="button" data-action="provider-add">${icon("plus", 13)} Thêm API hoặc model local</button></div>`}${view.connectors?.apiConfigurationError ? `<p class="provider-config-error">${esc(view.connectors.apiConfigurationError)}</p>` : ""}</div><details class="provider-env-help"><summary>Hướng dẫn kết nối cloud và model local</summary><p><strong>OpenAI / ChatGPT API:</strong> chọn cấu hình sẵn, nhập API key OpenAI rồi tải model. <strong>Google Gemini API:</strong> chọn Google Gemini, nhập key Google AI Studio rồi tải model. <strong>Claude API:</strong> chọn Claude API, nhập Anthropic key và model.</p><p><strong>Ollama:</strong> dùng endpoint <code>http://localhost:11434/v1</code> và ID từ <code>ollama list</code>. <strong>LM Studio:</strong> dùng endpoint <code>http://localhost:1234/v1</code>. Thường không cần API key.</p><p>API key được lưu trong thư mục dữ liệu riêng của OpenSybau, không hiển thị lại trong giao diện. Chỉ nhập key qua localhost hoặc HTTPS; provider API không có quyền chạy lệnh trong workspace.</p></details></section>
    <section class="settings-card concurrency-card" id="settings-concurrency"><header><div><h2>Tác vụ chạy đồng thời</h2><p>Giới hạn số task có thể chạy cùng lúc trên các workspace.</p></div></header>
      <div class="concurrency-setting"><span>Giới hạn hiện tại</span><div><button type="button" data-action="parallel-minus" aria-label="Giảm task chạy đồng thời">−</button><strong id="parallel-value">${maxConcurrent}</strong><button type="button" data-action="parallel-plus" aria-label="Tăng task chạy đồng thời">+</button></div></div>
    </section>
  </form>`;
}

function showApiProviderModal(provider = null) {
  const editing = Boolean(provider);
  const models = (provider?.models || []).map((model) => model.id).join("\n");
  const sourceChoice = editing ? "" : `<section class="provider-cli-entry"><span class="provider-connect-icon">${icon("square-terminal", 16)}</span><div><strong>Dùng Codex, Antigravity hoặc Claude CLI?</strong><p>OpenSybau tự dò CLI đã cài và đăng nhập qua terminal, không cần nhập API key.</p></div><button class="button quiet small" type="button" data-action="provider-connect-cli">Kết nối CLI</button></section>`;
  const body = `${sourceChoice}<div class="provider-presets" aria-label="Cấu hình nhanh"><div class="provider-presets-head"><span>Cấu hình nhanh</span><nav class="provider-key-links" aria-label="Tạo API key"><a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">OpenAI key</a><a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Gemini key</a><a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">Claude key</a></nav></div><div><button type="button" class="button quiet small" data-action="provider-preset" data-preset="openai">OpenAI / ChatGPT</button><button type="button" class="button quiet small" data-action="provider-preset" data-preset="gemini">Google Gemini</button><button type="button" class="button quiet small" data-action="provider-preset" data-preset="anthropic">Claude API</button><button type="button" class="button quiet small" data-action="provider-preset" data-preset="local">Model local / khác</button></div></div><div class="modal-grid-2"><label>Tên hiển thị<input name="name" required maxlength="80" autocomplete="off" spellcheck="false" value="${esc(provider?.name || "")}" placeholder="Ví dụ: Ollama · Qwen local"></label><label>Giao thức<select name="protocol"><option value="openai" ${provider?.protocol === "openai" ? "selected" : ""}>OpenAI Responses API</option><option value="gemini" ${provider?.protocol === "gemini" ? "selected" : ""}>Google Gemini API</option><option value="anthropic" ${provider?.protocol === "anthropic" ? "selected" : ""}>Anthropic Messages API</option><option value="openai-compatible" ${!provider || provider?.protocol === "openai-compatible" ? "selected" : ""}>OpenAI-compatible · Ollama, LM Studio…</option></select></label></div><label>API endpoint<input name="baseUrl" required maxlength="500" value="${esc(provider?.baseUrl || "")}" placeholder="http://localhost:11434/v1" autocomplete="url" spellcheck="false"><small>OpenAI-compatible: URL /v1 · Gemini: v1beta · HTTP chỉ dùng với localhost.</small></label><div class="provider-model-field"><label>Model ID<textarea name="models" required rows="3" spellcheck="false" placeholder="Chọn dịch vụ rồi bấm tải danh sách, hoặc nhập mỗi dòng một model ID">${esc(models)}</textarea></label><button class="button small" type="button" data-action="provider-discover-models">${icon("refresh-cw", 13)} Tải danh sách model</button></div>${editing ? `<input type="hidden" name="apiKeyRequired" value="${provider.apiKeyRequired ? "true" : "false"}">` : ""}<label>API key<input name="apiKey" type="password" maxlength="2048" autocomplete="new-password" spellcheck="false" placeholder="${editing && provider.apiKeyConfigured ? "Để trống để giữ key hiện tại" : "Nhập key của dịch vụ; model local có thể không cần"}"></label>${editing && provider.apiKeyConfigured ? `<label class="check-row"><input type="checkbox" name="clearApiKey" value="true"><span><strong>Xóa API key đã lưu</strong><small>Chỉ bật nếu muốn gỡ key khỏi cấu hình cục bộ.</small></span></label>` : ""}<p class="form-note">API key được lưu cục bộ trong thư mục dữ liệu riêng của OpenSybau; API OpenAI tính phí riêng với gói ChatGPT.</p>`;
  showModal(editing ? "Sửa nguồn AI" : "Thêm nguồn AI", body, editing ? "Lưu nguồn" : "Thêm nguồn", "api-provider");
  if (provider) $(".modal").dataset.id = provider.id;
}
function showCliProviderModal() {
  const rows = cliProviderGuides.map((agent) => {
    const connector = view.connectors?.[agent.id];
    const status = cliConnectionStatus(connector);
    const modelCount = connector?.models?.length || 0;
    const detail = status.tone === "ready"
      ? `${modelCount} model khả dụng${connector?.version && connector.version !== "unavailable" ? ` · ${connector.version}` : ""}`
      : status.tone === "missing" ? agent.installHelp : connector?.error || agent.summary;
    const primary = status.tone === "missing"
      ? window.opensybauDesktop?.supportsCliInstall
        ? `<button class="button quiet small" type="button" data-action="provider-cli-install" data-id="${esc(agent.id)}">Cài CLI</button>`
        : `<a class="button quiet small" href="${esc(agent.url)}" target="_blank" rel="noreferrer">Hướng dẫn cài</a>`
      : status.action === "refresh"
        ? cliRefreshButton(status.tone === "ready" ? "Đã kết nối · quét lại" : "Quét lại")
        : `<button class="button primary small" type="button" data-action="provider-cli-login" data-id="${esc(agent.id)}">${icon("square-terminal", 13)} ${status.tone === "needs-action" && connector?.authenticated ? "Mở CLI để kiểm tra" : "Bắt đầu đăng nhập"}</button>`;
    const docsUrl = status.tone === "missing" ? agent.url : agent.authUrl || agent.url;
    const instructions = status.tone === "missing"
      ? `<div class="cli-connect-login"><span>Cài đặt CLI</span><small>${esc(agent.installHelp)}</small></div>`
      : status.tone !== "ready" && status.action === "refresh"
        ? `<div class="cli-connect-login"><span>Kiểm tra kết nối CLI</span><small>CLI đã có trên máy. Bấm Quét lại để thử đọc danh sách model.</small></div>`
        : `<div class="cli-connect-login"><span>Cách đăng nhập</span><code>${esc(agent.loginCommand)}</code><small>${esc(agent.loginHelp)}</small></div>`;
    return `<article class="cli-connect-card ${esc(status.tone)}"><header><span class="cli-connect-mark">${icon("square-terminal", 17)}</span><div><h3>${esc(agent.name)}</h3><span class="cli-guide-status ${esc(status.tone)}">${esc(status.label)}</span></div></header><p>${esc(detail)}</p>${instructions}<footer>${primary}<a href="${esc(docsUrl)}" target="_blank" rel="noreferrer">Tài liệu chính thức</a></footer></article>`;
  }).join("");
  const body = `<div class="cli-connect-intro"><span class="provider-connect-icon">${icon("workflow", 17)}</span><div><strong>OpenSybau tự dò CLI trên máy chủ</strong><p>CLI đã cài sẽ tự kết nối. Bấm Quét lại nếu vừa cài hoặc đăng nhập.</p></div>${cliRefreshButton()}</div><div class="cli-connect-list">${rows}</div><p class="cli-connect-feedback" role="status" aria-live="polite" hidden></p><p class="form-note">CLI dùng tài khoản riêng, không cần API key. Nếu bạn dùng OpenSybau từ điện thoại, terminal sẽ mở trên máy chủ; hoàn tất đăng nhập tại máy đó rồi bấm Quét lại.</p>`;
  showModal("Thêm / kết nối CLI agent", body, "Xong", "dismiss");
  $(".modal-actions .button.quiet")?.remove();
}
function cliRefreshButton(label = "Quét lại") {
  const busy = cliScanInProgress;
  return `<button class="button quiet small" type="button" data-action="provider-cli-refresh" ${busy ? 'disabled aria-busy="true"' : ""}>${icon("refresh-cw", 13)} ${busy ? "Đang quét..." : label}</button>`;
}
function apiProviderId(name) {
  return String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}
function render({ background = false } = {}) {
  if (!view.state) return;
  syncLocation();
  const pages = { chat: chatPage, tasks: taskPage, flows: workflowPage, workspaces: workspacePage, knowledge: knowledgePage, skills: skillPage, memory: memoryPage, settings: settingsPage };
  const content = $("#content");
  const rightDockEl = document.querySelector(".orca-right-dock");
  const renderKey = `${view.page}:${view.selected || ""}`;
  const contentScroll = view.renderedPage === renderKey ? content.scrollTop : 0;

  const chatThreadScrolls = new Map();
  content?.querySelectorAll(".chat-thread")?.forEach((thread) => {
    const tId = thread.dataset.taskId || "";
    const key = thread.id || tId || "default";
    const atEnd = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 48;
    chatThreadScrolls.set(key, { top: thread.scrollTop, atEnd, taskId: tId });
  });
  const forceScrollAll = Boolean(view.forceChatScroll);
  view.forceChatScroll = false;

  const selectedTask = view.selected && view.state.tasks.some((task) => task.id === view.selected);
  const openPops = new Map();
  content?.querySelectorAll(".codex-pop-menu[open][data-pop-id]")?.forEach((el) => {
    openPops.set(el.dataset.popId, el.querySelector(".codex-pop-scroll")?.scrollTop || 0);
  });

  const activeEl = document.activeElement;
  let activeInputDescriptor = null;
  if (activeEl && activeEl.matches?.("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea") && (content?.contains(activeEl) || rightDockEl?.contains(activeEl))) {
    const composerForm = activeEl.closest(".chat-composer")
      ? ".chat-composer"
      : activeEl.closest(".home-composer")
        ? ".home-composer"
        : "";
    const composerTaskId = activeEl.closest(".chat-composer")?.dataset.id || activeEl.closest(".multi-chat-pane")?.dataset.taskId || "";
    let selector = "";
    if (activeEl.hasAttribute("data-chat-drawer-filter")) selector = "[data-chat-drawer-filter]";
    else if (activeEl.hasAttribute("data-vault-editor")) selector = "[data-vault-editor]";
    else if (activeEl.hasAttribute("data-skill-inline-editor")) selector = "[data-skill-inline-editor]";
    else if (activeEl.hasAttribute("data-stage-line-comment-input")) selector = "[data-stage-line-comment-input]";
    else if (activeEl.hasAttribute("data-html-element-comment-input")) selector = "[data-html-element-comment-input]";
    else if (activeEl.dataset?.fileFilter) selector = `[data-file-filter="${CSS.escape(activeEl.dataset.fileFilter)}"]`;
    else if (activeEl.dataset?.skillFilter) selector = `[data-skill-filter="${CSS.escape(activeEl.dataset.skillFilter)}"]`;
    else if (activeEl.id) selector = `#${CSS.escape(activeEl.id)}`;
    else if (activeEl.name) selector = `${activeEl.tagName.toLowerCase()}[name="${CSS.escape(activeEl.name)}"]`;
    activeInputDescriptor = {
      inDock: Boolean(rightDockEl?.contains(activeEl)),
      composerForm,
      composerTaskId,
      name: activeEl.name || "",
      selector,
      value: activeEl.value,
      selection: typeof activeEl.selectionStart === "number" ? [activeEl.selectionStart, activeEl.selectionEnd] : null,
    };
  }

  const rawPageMarkup = (pages[view.page] || taskPage)();
  const pageMarkup = wrapStageWithOrcaTabs(rawPageMarkup);
  const isRightDockOpen = pageSupportsRightDock(view.page) && (view.page === "chat" ? Boolean(view.chatDrawerOpen) : Boolean(view.homeDockOpen ?? view.chatDrawerOpen));
  const rightDockMarkup = isRightDockOpen ? orcaRightDockMarkup() : "";
  const searchResults = view.searchQuery ? homeSearchResults(view.searchQuery) : "";
  view.searchResults = searchResults;
  updateWorkbenchShell({ backgroundUpdate: background, page: view.page, language: view.language, theme: view.theme, state: view.state, connectors: view.connectors, desktopSetupOpen: view.desktopSetupOpen, cliInstallProvider: view.cliInstallProvider, skills: view.skills, selected: selectedTask ? view.selected : null, homeWorkspaceId: view.homeWorkspaceId, searchQuery: view.searchQuery, searchResults, collapsedWorkspaces: view.collapsedWorkspaces, collapsedFanouts: view.collapsedFanouts, projectMenuId: view.projectMenuId, taskMenuId: view.taskMenuId, streamConnected: view.streamConnected, chatDrawerOpen: view.chatDrawerOpen, rightDockMarkup, stageTabs: view.stageTabs || [], activeStageTabId: view.activeStageTabId || "chat", stageSplit: Boolean(view.stageSplit), chatSplitWorkspaceId: view.chatSplitWorkspaceId, chatSplitTaskIds: view.chatSplitTaskIds, chatSplitActiveTaskId: view.chatSplitActiveTaskId }, pageMarkup);
  localizeDom(document.querySelector("#root"), view.language);
  const overlay = $("#overlay");
  if (overlay && overlay.children.length > 0) {
    localizeDom(overlay, view.language);
  }
  const nextContent = $("#content");
  nextContent.scrollTop = contentScroll;
  view.renderedPage = renderKey;
  if (openPops.size) {
    for (const [popId, popScroll] of openPops) {
      const nextPop = $(`.codex-pop-menu[data-pop-id="${popId}"]`, nextContent);
      if (nextPop) {
        nextPop.open = true;
        const scroller = nextPop.querySelector(".codex-pop-scroll");
        if (scroller && popScroll) scroller.scrollTop = popScroll;
      }
    }
  }
  nextContent.querySelectorAll(".chat-thread").forEach((nextThread) => {
    const tId = nextThread.dataset.taskId || "";
    const key = nextThread.id || tId || "default";
    const prev = chatThreadScrolls.get(key);
    const taskChanged = prev && prev.taskId !== tId;
    const shouldScrollEnd = Boolean(forceScrollAll || !prev || taskChanged || prev.atEnd);
    nextThread.scrollTop = shouldScrollEnd ? nextThread.scrollHeight : prev.top;
  });
  updateChatOutline();
  if (activeInputDescriptor) {
    const scopeRoot = activeInputDescriptor.inDock ? document.querySelector(".orca-right-dock") : nextContent;
    let nextInput = null;
    if (activeInputDescriptor.composerForm && activeInputDescriptor.name) {
      const nextComposer = activeInputDescriptor.composerTaskId
        ? scopeRoot?.querySelector(`${activeInputDescriptor.composerForm}[data-id="${CSS.escape(activeInputDescriptor.composerTaskId)}"]`) || scopeRoot?.querySelector(`.multi-chat-pane[data-task-id="${CSS.escape(activeInputDescriptor.composerTaskId)}"] ${activeInputDescriptor.composerForm}`)
        : $(activeInputDescriptor.composerForm, scopeRoot);
      nextInput = nextComposer?.querySelector(`[name="${CSS.escape(activeInputDescriptor.name)}"]`);
    } else if (activeInputDescriptor.selector) {
      nextInput = scopeRoot?.querySelector(activeInputDescriptor.selector);
    }
    if (nextInput) {
      if (nextInput !== document.activeElement) {
        nextInput.focus({ preventScroll: true });
      }
      if (nextInput.matches(".chat-input, [data-home-prompt]")) {
        resizeComposerTextarea(nextInput);
      }
      if (activeInputDescriptor.selection && nextInput.setSelectionRange) {
        try { nextInput.setSelectionRange(...activeInputDescriptor.selection); } catch {}
      }
    }
  }
  if (view.page === "skills") applySkillFilter($("[data-skill-filter=library]", nextContent));
  mountKnowledgeGraphCanvas();
  if (overlay && !overlay.querySelector(".modal")) {
    overlay.innerHTML = "";
  }
  syncWorkflow();
}
async function ensureWorkspaceFileIndex(workspaceId) {
  if (!workspaceId) return [];
  if (Array.isArray(view.workspaceFileIndex?.[workspaceId])) return view.workspaceFileIndex[workspaceId];
  try {
    const res = await api(`/api/workspaces/${encodeURIComponent(workspaceId)}/file-index`);
    view.workspaceFileIndex ||= {};
    view.workspaceFileIndex[workspaceId] = res.files || [];
    return view.workspaceFileIndex[workspaceId];
  } catch {
    return [];
  }
}
function availableArenaCompetitors() {
  const entries = Object.entries(view.connectors || {}).filter(([, connector]) => connector?.available && (connector.capabilities?.build || connector.capabilities?.chat || connector.capabilities?.plan));
  if (!entries.length) {
    return ["codex", "antigravity", "claude"].map((id) => {
      const connector = view.connectors?.[id];
      const models = connector?.models || [];
      return {
        provider: id,
        name: providerTitle(view.connectors, id),
        models,
        model: models[0]?.id || "",
        effort: "medium",
        available: Boolean(connector?.available),
      };
    });
  }
  return entries.map(([id, connector]) => {
    const models = connector.models || [];
    const model = models[0]?.id || "";
    const effort = models[0]?.efforts?.includes("medium") ? "medium" : (models[0]?.efforts?.[0] || "medium");
    return { provider: id, name: connector.name || providerTitle(view.connectors, id), models, model, effort, available: true };
  });
}
function ensureHomeArenaSlots() {
  const candidates = availableArenaCompetitors();
  const primary = candidates[0] || { provider: "codex", model: "", effort: "medium", models: [] };
  if (!Array.isArray(view.homeArenaSlots) || view.homeArenaSlots.length < 2) {
    if (candidates.length >= 2) {
      view.homeArenaSlots = candidates.slice(0, Math.min(3, candidates.length)).map((c) => ({
        provider: c.provider,
        model: c.model,
        effort: c.effort,
      }));
    } else {
      view.homeArenaSlots = [
        { provider: primary.provider, model: primary.model, effort: primary.effort },
        { provider: primary.provider, model: primary.model, effort: primary.effort },
      ];
    }
  }
  view.homeArenaSlots = view.homeArenaSlots.slice(0, 8).map((slot) => {
    const cand = candidates.find((c) => c.provider === slot?.provider) || primary;
    const models = cand.models || [];
    const modelObj = models.find((m) => m.id === slot?.model) || models[0];
    const model = modelObj?.id || slot?.model || cand.model || "";
    const effortList = modelObj?.efforts?.length ? modelObj.efforts : efforts;
    const effort = effortList.includes(slot?.effort) ? slot.effort : (effortList.includes("medium") ? "medium" : (effortList[0] || "medium"));
    return { provider: cand.provider, model, effort };
  });
  return view.homeArenaSlots;
}
function chatPage() {
  if (view.chatSplitWorkspaceId) return multiChatPage();
  if (view.selected && view.state.tasks.some((task) => task.id === view.selected)) return taskConversationPage();
  const workspaces = view.state.workspaces;
  const roleSelections = Object.fromEntries(workflowRoles.map((role) => [role.id, normalizedRoleSelection(role.id, view.homeRoles?.[role.id])]));
  const pipelineReady = workflowRoles.every((role) => roleSelections[role.id].candidates.length > 0);
  const planReady = roleSelections.plan.candidates.length > 0;
  let workflow = view.homeWorkflow;
  if (workflow === "codex-antigravity" && !pipelineReady) workflow = planReady ? "plan-only" : "chat-only";
  const chatSelection = normalizedChatSelection({ provider: view.homeChatProvider, model: view.homeChatModel, effort: view.homeChatEffort });
  view.homeChatProvider = chatSelection.provider;
  view.homeChatModel = chatSelection.model?.id || "";
  view.homeChatEffort = chatSelection.effort;
  const activeWorkspaceId = workspaces.some((workspace) => workspace.id === view.homeWorkspaceId) ? view.homeWorkspaceId : workspaces[0]?.id || "";
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const isSplitCreation = Boolean(view.chatSplitReturnWorkspaceId);
  const canIsolateHome = Boolean(activeWorkspace?.runtime?.isGit && activeWorkspace?.runtime?.head);
  const arenaCandidates = availableArenaCompetitors();
  const arenaSlots = ensureHomeArenaSlots();
  const isArena = view.homeMode === "arena";
  const canRun = isArena
    ? Boolean(canIsolateHome && arenaSlots.length >= 2 && arenaCandidates.some((c) => c.available))
    : workflow === "chat-only" ? Boolean(chatSelection.connector?.available) : workflow === "plan-only" ? planReady : pipelineReady;
  const workflowOptions = `<option value="chat-only" ${workflow === "chat-only" ? "selected" : ""}>Chat · một agent</option><option value="codex-antigravity" ${workflow === "codex-antigravity" ? "selected" : ""} ${pipelineReady ? "" : "disabled"}>Pipeline · Kế hoạch → Triển khai → Review</option><option value="plan-only" ${workflow === "plan-only" ? "selected" : ""} ${planReady ? "" : "disabled"}>Chỉ lập kế hoạch</option>`;
  const chatProviders = Object.entries(view.connectors || {}).filter(([, connector]) => connectorSupports(connector, "chat"));
  const homeIsolated = Boolean((isArena || isSplitCreation || view.homeIsolated) && canIsolateHome);
  const homePermissionPreset = view.homePermissionPreset || "workspace-write";
  const compactAgentLabel = isArena
    ? `${arenaSlots.length} nhánh Worktree song song`
    : workflow === "chat-only"
      ? `${providerTitle(view.connectors, chatSelection.provider)}${chatSelection.model?.name ? ` · ${chatSelection.model.name}` : ""}`
      : workflow === "plan-only"
        ? `${providerTitle(view.connectors, roleSelections.plan.provider)}${roleSelections.plan.model ? ` · ${roleSelections.plan.model}` : ""}`
        : `Pipeline · ${providerTitle(view.connectors, roleSelections.build.provider)}`;
  const quickAgentItems = [];
  let activeAgentLabel = chatSelection.model?.name || chatSelection.model?.id || providerTitle(view.connectors, chatSelection.provider) || compactAgentLabel;
  for (const [provId, conn] of Object.entries(view.connectors || {})) {
    if (!conn?.available) continue;
    const provName = providerTitle(view.connectors, provId);
    const models = conn.models?.length ? conn.models : [{ id: "", name: conn.name || provName }];
    quickAgentItems.push(`<div class="codex-pop-group-label">${esc(provName)}</div>`);
    for (const m of models) {
      const val = `${provId}::${m.id || ""}`;
      const isSelected = provId === chatSelection.provider && (m.id || "") === (chatSelection.model?.id || "");
      const modelTitle = m.name || m.id || provName;
      if (isSelected) activeAgentLabel = modelTitle;
      quickAgentItems.push(`<button type="button" class="codex-pop-item ${isSelected ? "is-selected" : ""}" data-action="pick-home-agent" data-agent="${esc(val)}">
        <span class="codex-pop-item-main"><span>${esc(modelTitle)}</span></span>
        ${isSelected ? icon("check", 13) : ""}
      </button>`);
    }
  }
  const activeEfforts = chatSelection.model?.efforts?.length ? chatSelection.model.efforts : ["low", "medium", "high"];
  const effortDisplay = { low: "Low", medium: "Medium", high: "High", minimal: "Min", standard: "Std", max: "Max" };
  const homeModeOptions = [
    { id: "chat", label: "Chat", icon: "message-circle" },
    { id: "code", label: "Code", icon: "square-terminal", disabled: !pipelineReady },
    { id: "plan", label: "Kế hoạch", icon: "list-checks", disabled: !planReady },
    { id: "arena", label: "Đa luồng", icon: "git-branch", title: "Chạy đa luồng nhiều agent (cùng hoặc khác model) trên các Git worktree riêng" },
  ];
  const activeHomeMode = homeModeOptions.find((mode) => mode.id === view.homeMode) || homeModeOptions[0];
  const homeModeMenu = `<details class="codex-pop-menu is-up is-right home-mode-picker" data-pop-id="home-mode">
    <summary class="codex-rail-pill" title="Chế độ làm việc" aria-label="Chế độ làm việc" aria-haspopup="menu">${icon(activeHomeMode.icon, 14)}<span>${activeHomeMode.label}</span>${icon("chevron-down", 12)}</summary>
    <div class="codex-pop-card home-mode-popover" role="menu" aria-label="Chế độ làm việc"><div class="codex-pop-head">Chế độ làm việc</div>
      ${homeModeOptions.map((mode) => `<button type="button" role="menuitemradio" aria-checked="${mode.id === activeHomeMode.id}" class="codex-pop-item ${mode.id === activeHomeMode.id ? "is-selected" : ""}" data-home-mode="${mode.id}" ${mode.disabled ? "disabled title=\"Cần agent phù hợp để dùng chế độ này\"" : mode.title ? `title="${mode.title}"` : ""}><span class="codex-pop-item-main">${icon(mode.icon, 14)}<span>${mode.label}</span></span>${mode.id === activeHomeMode.id ? icon("check", 13) : ""}</button>`).join("")}
    </div>
  </details>`;

  const arenaStrip = isArena ? `<div class="home-arena-strip">
    <div class="home-arena-head">
      <div class="home-arena-title">
        <strong>${icon("git-branch", 14)}<span>Đa luồng Worktree (${arenaSlots.length} nhánh chạy song song)</span></strong>
        <small>${canIsolateHome ? "Chạy nhiều bản của cùng 1 model hoặc phối hợp nhiều hãng/model khác nhau." : "Workspace cần là Git repository đã có ít nhất 1 commit để tách nhánh Worktree."}</small>
      </div>
      <div class="home-arena-presets">
        <button type="button" class="arena-preset-btn" data-action="arena-preset" data-preset="same-2" title="Chạy 2 nhánh song song cùng dùng 1 model">2× Cùng model</button>
        <button type="button" class="arena-preset-btn" data-action="arena-preset" data-preset="same-3" title="Chạy 3 nhánh song song cùng dùng 1 model">3× Cùng model</button>
        ${arenaCandidates.length > 1 ? `<button type="button" class="arena-preset-btn" data-action="arena-preset" data-preset="all-providers" title="Mỗi hãng CLI 1 nhánh">Đa hãng</button>` : ""}
        <button type="button" class="arena-preset-btn is-primary" data-action="arena-add-slot" ${arenaSlots.length >= 8 ? "disabled" : ""} title="Thêm 1 nhánh Agent song song (tối đa 8)">${icon("plus", 12)}<span>Thêm nhánh</span></button>
      </div>
    </div>
    <div class="arena-slot-list">
      ${arenaSlots.map((slot, idx) => {
        const cand = arenaCandidates.find((c) => c.provider === slot.provider) || arenaCandidates[0];
        const models = cand?.models || [];
        const modelObj = models.find((m) => m.id === slot.model) || models[0];
        const slotEfforts = modelObj?.efforts?.length ? modelObj.efforts : ["low", "medium", "high"];
        return `<div class="arena-slot-row">
          <span class="arena-slot-badge">#${idx + 1}</span>
          <select class="arena-slot-select" data-arena-slot-provider="${idx}" aria-label="Agent nhánh ${idx + 1}">
            ${arenaCandidates.map((c) => `<option value="${esc(c.provider)}" ${c.provider === slot.provider ? "selected" : ""}>${esc(c.name)}</option>`).join("")}
          </select>
          <select class="arena-slot-select is-model" data-arena-slot-model="${idx}" aria-label="Model nhánh ${idx + 1}">
            ${models.length ? models.map((m) => `<option value="${esc(m.id)}" ${m.id === slot.model ? "selected" : ""}>${esc(m.name || m.id)}</option>`).join("") : `<option value="">Mặc định</option>`}
          </select>
          <select class="arena-slot-select is-effort" data-arena-slot-effort="${idx}" aria-label="Mức suy nghĩ nhánh ${idx + 1}">
            ${slotEfforts.map((ef) => `<option value="${esc(ef)}" ${ef === slot.effort ? "selected" : ""}>${esc(ef)}</option>`).join("")}
          </select>
          <button type="button" class="arena-slot-icon" data-action="arena-clone-slot" data-index="${idx}" ${arenaSlots.length >= 8 ? "disabled" : ""} title="Nhân bản thêm 1 nhánh giống hệt nhánh này">${icon("copy", 13)}</button>
          <button type="button" class="arena-slot-icon is-danger" data-action="arena-remove-slot" data-index="${idx}" ${arenaSlots.length <= 2 ? "disabled" : ""} title="Xóa nhánh này">${icon("x", 13)}</button>
        </div>`;
      }).join("")}
    </div>
  </div>` : "";

  const heroEmblem = `<div class="codex-hero-emblem" aria-hidden="true">
    <svg viewBox="0 0 64 64" width="30" height="30" fill="none">
      <circle cx="19.6" cy="19.8" r="6.8" fill="currentColor" />
      <circle cx="44.4" cy="44.2" r="6.8" fill="currentColor" />
      <path d="M29.8 24.2C29.8 23.45 30.22 22.76 30.89 22.43L48.72 13.51C49.91 12.92 51.2 13.78 51.2 15.11V24.9C51.2 25.65 50.78 26.34 50.11 26.67L35.09 34.18C34.55 34.45 34.2 35 34.2 35.61V39.8C34.2 40.55 33.78 41.24 33.11 41.57L15.28 50.49C14.09 51.08 12.8 50.22 12.8 48.89V39.1C12.8 38.35 13.22 37.66 13.89 37.33L28.91 29.82C29.45 29.55 29.8 29 29.8 28.39V24.2Z" fill="currentColor" />
    </svg>
  </div>`;

  return `<section class="command-home">
    <div class="command-stage">
      <div class="home-welcome">
        ${heroEmblem}
        <h1>${activeWorkspace ? `Bạn muốn xây dựng gì trong ${esc(activeWorkspace.name)}?` : "Bạn muốn xây dựng gì?"}</h1>
      </div>
      ${chatProviders.length ? "" : `<div class="provider-connect-callout home-provider-empty"><span class="provider-connect-icon">${icon("plug-zap", 17)}</span><div><strong>Chưa có agent sẵn sàng</strong><p>Kết nối API/model local hoặc cài và đăng nhập Codex, Claude Code hay Antigravity để bắt đầu.</p></div><div><button class="button primary small" type="button" data-action="desktop-open-settings">Mở cài đặt</button><button class="button quiet small" type="button" data-action="open-setup-assistant">Hướng dẫn</button></div></div>`}
      <div class="codex-composer-stack">
        <div class="codex-composer-rail">
          <div class="codex-rail-bar">
            <div class="codex-rail-left">
              ${workspaces.length ? `<details class="codex-pop-menu is-up" data-pop-id="home-workspace">
                <summary class="codex-rail-pill" title="Chọn dự án (Workspace)">
                  ${icon("folder", 14)}
                  <span>${esc(activeWorkspace?.name || "Chọn dự án")}</span>
                  ${icon("chevron-down", 12)}
                </summary>
                <div class="codex-pop-card">
                  <div class="codex-pop-head">Dự án (Workspace)</div>
                  ${workspaces.map((ws) => `<button type="button" class="codex-pop-item ${ws.id === activeWorkspaceId ? "is-selected" : ""}" data-action="pick-home-workspace" data-id="${esc(ws.id)}">
                    <span class="codex-pop-item-main">${icon("folder", 13)}<span>${esc(ws.name)}</span></span>
                    ${ws.id === activeWorkspaceId ? icon("check", 13) : ""}
                  </button>`).join("")}
                  <div class="codex-pop-sep"></div>
                  <button type="button" class="codex-pop-item" data-action="add-workspace">
                    <span class="codex-pop-item-main">${icon("folder-plus", 13)}<span>Thêm dự án mới…</span></span>
                  </button>
                </div>
              </details>` : `<button type="button" class="codex-rail-pill" data-action="add-workspace" title="Thêm thư mục dự án">
                ${icon("folder", 14)}
                <span>Chọn dự án</span>
              </button>`}
              <button type="button" class="codex-rail-pill ${homeIsolated ? "is-active" : ""}" data-action="toggle-home-isolated" ${!canIsolateHome || isArena ? "disabled" : ""} title="${canIsolateHome ? (homeIsolated ? "Đang chạy trên nhánh Git Worktree cô lập (bấm để chuyển về Máy tính này)" : "Đang chạy trực tiếp trên Máy tính này (bấm để tách nhánh Git Worktree)") : "Môi trường thực thi cục bộ"}">
                ${homeIsolated ? icon("git-branch", 14) : `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="2"/><line x1="2" y1="20" x2="22" y2="20"/></svg>`}
                <span>${homeIsolated ? "Git Worktree" : "Máy tính này"}</span>
              </button>
            </div>
            <div class="codex-rail-right">${homeModeMenu}</div>
          </div>
          ${arenaStrip}
        </div>
        <form class="home-composer" data-modal data-form="home-task">
          ${composerAttachmentsMarkup("home")}
          <div class="composer-input-wrap">
            <textarea name="prompt" data-home-prompt maxlength="50000" rows="1" placeholder="${isArena ? `Làm bất cứ điều gì trên ${arenaSlots.length} nhánh song song…` : "Làm bất cứ điều gì…"}">${esc(view.chatDraft)}</textarea>
            <div class="mention-popover" data-mention-popover hidden></div>
          </div>
          <footer class="home-composer-controls">
            <div class="composer-add-wrap">
              ${composerAddMenu("prompt")}
              ${composerPermissionMenuMarkup(homePermissionPreset, "home")}
            </div>
            <div class="home-composer-actions">
              ${!isArena && quickAgentItems.length ? `<div class="codex-inline-model-bar">
                <details class="codex-pop-menu is-up is-right" data-pop-id="home-model">
                  <summary class="codex-inline-trigger is-model" title="Chọn nhanh Agent & Model">
                    <span>${esc(activeAgentLabel)}</span>
                    ${icon("chevron-down", 12)}
                  </summary>
                  <div class="codex-pop-card is-model-list">
                    <div class="codex-pop-head">Agent & Model</div>
                    <div class="codex-pop-scroll">${quickAgentItems.join("")}</div>
                  </div>
                </details>
                <details class="codex-pop-menu is-up is-right" data-pop-id="home-effort">
                  <summary class="codex-inline-trigger is-effort" title="Mức suy luận (Reasoning Effort)">
                    <span>${esc(effortDisplay[chatSelection.effort] || chatSelection.effort || "Medium")}</span>
                    ${icon("chevron-down", 12)}
                  </summary>
                  <div class="codex-pop-card is-effort-list">
                    <div class="codex-pop-head">Mức suy luận</div>
                    <div class="codex-pop-scroll">
                      ${activeEfforts.map((ef) => `<button type="button" class="codex-pop-item ${ef === chatSelection.effort ? "is-selected" : ""}" data-action="pick-home-effort" data-effort="${esc(ef)}">
                        <span class="codex-pop-item-main"><span>${esc(effortDisplay[ef] || ef)}</span></span>
                        ${ef === chatSelection.effort ? icon("check", 13) : ""}
                      </button>`).join("")}
                    </div>
                  </div>
                </details>
              </div>` : `<button type="button" class="codex-footer-btn" data-action="toggle-home-config">${esc(compactAgentLabel)} ${icon("chevron-down", 12)}</button>`}
              <button class="home-submit" type="submit" aria-label="${isArena ? "Khởi chạy Đa luồng" : workflow === "chat-only" ? "Gửi tin nhắn" : "Chạy task"}" title="${isArena ? "Khởi chạy Đa luồng" : workflow === "chat-only" ? "Gửi tin nhắn" : "Chạy task"}" ${canRun || !workspaces.length ? "" : "disabled"}>${icon("arrow-up-right", 16)}</button>
            </div>
          </footer>
          <div class="composer-config-backdrop home-config-backdrop" ${view.homeConfigOpen ? "" : "hidden"}><section class="composer-config-dialog app-dialog-shell" role="dialog" aria-modal="true" aria-label="Cấu hình tác vụ"><header class="app-dialog-header"><div><small>OPENSYBAU</small><h2>Cấu hình tác vụ</h2></div><button type="button" class="icon-button" data-action="close-composer-config" aria-label="Đóng">${icon("x", 16)}</button></header><div class="app-dialog-content composer-config-content"><div class="composer-config-grid">${homeSelectField("Workspace", "workspaceId", "data-home-workspace required", workspaces.length ? workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name })) : [{ value: "", label: "Thêm workspace để bắt đầu" }], activeWorkspaceId, !workspaces.length || isSplitCreation)}${homeSelectField("Luồng", "workflow", "data-home-workflow", [{ value: "chat-only", label: "Chat · một agent" }, { value: "codex-antigravity", label: "Pipeline · Kế hoạch → Triển khai → Review", disabled: !pipelineReady }, { value: "plan-only", label: "Chỉ lập kế hoạch", disabled: !planReady }], workflow)}</div><div class="composer-config-grid home-security-grid"><div class="home-config-permission"><span>Quyền truy cập</span>${composerPermissionMenuMarkup(homePermissionPreset, "home-config")}<input type="hidden" name="permissionPreset" value="${esc(homePermissionPreset)}"></div><label class="check-row home-isolation-row"><input type="checkbox" name="isolated" data-home-isolated ${homeIsolated ? "checked" : ""} ${canIsolateHome && !isSplitCreation ? "" : "disabled"}><span><strong>Tách Git worktree riêng</strong><small>${isSplitCreation ? "Bắt buộc để mở trong khung chat song song" : canIsolateHome ? `Nhánh ${esc(activeWorkspace?.runtime?.branch || "HEAD")} · chạy song song an toàn` : "Cần Git repo có ít nhất 1 commit"}</small></span></label></div><div class="chat-agent-role" ${workflow === "chat-only" ? "" : "hidden"}>${chatAgentEditor({ provider: chatSelection.provider, model: chatSelection.model?.id, effort: chatSelection.effort })}</div><div class="agent-role-grid home-role-grid" ${workflow === "chat-only" ? "hidden" : ""}>${workflowRoles.map((role) => roleEditor(role.id, roleSelections[role.id])).join("")}</div></div><footer class="app-dialog-footer"><span>${icon("notebook-tabs", 14)} Skill tự chọn · ${view.skills.length} · Tối đa ${view.state.settings.maxConcurrent} task song song</span><button type="button" class="button primary" data-action="close-composer-config">Xong</button></footer></section></div>
        </form>
      </div>
    </div>
  </section>`;
}

function multiChatPage() {
  const workspace = view.state.workspaces.find((item) => item.id === view.chatSplitWorkspaceId);
  if (!workspace) { view.chatSplitWorkspaceId = ""; return chatPage(); }
  const en = view.language === "en";
  const taskIds = (view.chatSplitTaskIds || []).filter((id, index, all) => all.indexOf(id) === index);
  view.chatSplitTaskIds = taskIds;
  const tasks = taskIds.map((id) => view.state.tasks.find((task) => task.id === id)).filter((task) => task?.workspaceId === workspace.id);
  const candidates = view.state.tasks.filter((task) => task.workspaceId === workspace.id && task.isolated && !task.archived && !task.worktreeCleaned && !task.worktreeAppliedAt);
  const activeTask = tasks.find((task) => task.id === view.chatSplitActiveTaskId) || tasks[0];
  const createSelection = normalizedChatSelection({ provider: view.homeChatProvider || activeTask?.config?.chatProvider, model: view.homeChatModel || activeTask?.config?.chatModel, effort: view.homeChatEffort || activeTask?.config?.chatEffort });
  view.chatSplitSelections ||= {};
  const panes = tasks.map((task) => {
    const role = task.config?.workflow === "chat-only" ? task.config : task.config?.roles?.plan || {};
    const selection = view.chatSplitSelections[task.id] || {
      provider: task.config?.chatProvider || role.provider || "codex",
      model: task.config?.chatModel || role.model || "",
      effort: task.config?.chatEffort || role.effort || "medium",
    };
    const usableWorktree = task.isolated && !task.worktreeCleaned && !task.worktreeAppliedAt;
    return `<section class="multi-chat-pane ${(view.chatSplitActiveTaskId || tasks[0]?.id) === task.id ? "is-active" : ""}" data-task-id="${esc(task.id)}"><header><div><strong title="${esc(task.title)}">${esc(compactChatTitle(task))}</strong><small>${esc(statuses[task.status] || task.status || "")}</small></div><button type="button" class="icon-button" data-action="remove-chat-pane" data-id="${esc(task.id)}" aria-label="Đóng khung chat">${icon("x", 15)}</button></header>${taskConversationPage(task.id, { splitPane: true, selection, draft: view.chatSplitDrafts?.[task.id] || "", locked: !usableWorktree })}</section>`;
  }).join("");
  const picker = view.chatSplitPickerOpen ? `<div class="multi-chat-picker"><header><div><strong>${en ? "Add chat to panes" : "Thêm chat vào khung"}</strong><small>${esc(workspace.name)} · ${taskIds.length}/4 ${en ? "panes" : "khung"}</small></div><button type="button" class="icon-button" data-action="close-chat-picker" aria-label="${en ? "Close" : "Đóng"}">${icon("x", 14)}</button></header><div class="multi-chat-picker-list">${candidates.filter((task) => !taskIds.includes(task.id)).map((task) => `<button type="button" class="multi-chat-picker-item" data-action="add-chat-pane" data-id="${esc(task.id)}"><span class="multi-chat-picker-branch">${icon("git-branch", 14)}</span><span class="multi-chat-picker-title">${esc(compactChatTitle(task))}</span><small class="multi-chat-picker-status status-${esc(task.status)}">${esc(statuses[task.status] || task.status)}</small></button>`).join("") || `<p>${en ? "There are no other worktree chats in this project." : "Chưa có chat worktree nào khác trong project."}</p>`}</div>${taskIds.length < 4 ? `<button type="button" class="multi-chat-picker-create" data-action="create-split-chat" data-workspace-id="${esc(workspace.id)}">${icon("plus", 14)} ${en ? "Create parallel chat" : "Tạo chat song song mới"}</button>` : `<p class="multi-chat-picker-limit">${en ? "You have reached the 4 pane limit." : "Đã đạt tối đa 4 khung chat."}</p>`}</div>` : "";
  const createModal = view.chatSplitCreateOpen ? `<div class="composer-config-backdrop multi-chat-create-backdrop"><form class="home-composer composer-config-dialog app-dialog-shell multi-chat-create-form" data-modal data-form="home-task" data-split-chat-create="true" role="dialog" aria-modal="true" aria-label="${en ? "Create parallel chat" : "Tạo chat song song"}"><header class="app-dialog-header"><div><small>${en ? "PARALLEL CHAT" : "CHAT SONG SONG"}</small><h2>${en ? "Create chat in new pane" : "Tạo chat trong khung mới"}</h2></div><button type="button" class="icon-button" data-action="close-split-chat-create" aria-label="${en ? "Close" : "Đóng"}">${icon("x", 16)}</button></header><div class="app-dialog-content composer-config-content multi-chat-create-content"><input type="hidden" name="workspaceId" value="${esc(workspace.id)}"><input type="hidden" name="workflow" value="chat-only"><input type="hidden" name="isolated" value="true"><p class="multi-chat-create-description">${en ? "This chat will run on a separate Git worktree in" : "Chat mới sẽ chạy trên Git worktree riêng trong"} <strong>${esc(workspace.name)}</strong>.</p><label class="multi-chat-create-prompt">${en ? "Prompt" : "Yêu cầu"}<div class="multi-chat-create-input composer-input-wrap"><textarea class="chat-input" name="prompt" data-home-prompt minlength="6" maxlength="50000" rows="3" autofocus placeholder="${en ? "What should the agent do in this chat?" : "Bạn muốn agent làm gì trong đoạn chat mới?"}">${esc(view.chatSplitCreateDraft)}</textarea></div></label>${chatAgentEditor({ provider: createSelection.provider, model: createSelection.model?.id, effort: createSelection.effort })}<div class="home-config-permission"><span>${en ? "Access" : "Quyền truy cập"}</span>${composerPermissionMenuMarkup(view.homePermissionPreset || activeTask?.permissionPreset || "workspace-write", "home-config")}<input type="hidden" name="permissionPreset" value="${esc(view.homePermissionPreset || activeTask?.permissionPreset || "workspace-write")}" data-home-permission></div></div><footer class="app-dialog-footer multi-chat-create-footer"><button type="button" class="button quiet" data-action="close-split-chat-create">${en ? "Cancel" : "Hủy"}</button><button type="submit" class="button primary">${icon("arrow-up-right", 15)} ${en ? "Create chat pane" : "Tạo khung chat"}</button></footer></form></div>` : "";
  return `<section class="multi-chat-page">${picker}${createModal}<div class="multi-chat-grid ${tasks.length < 2 ? "is-single" : tasks.length === 3 ? "is-three" : tasks.length > 3 ? "is-four" : ""}">${panes || `<div class="multi-chat-start"><strong>Chưa có chat để chia khung</strong><p>Bấm dấu + trên thanh tab để mở chat.</p></div>`}</div></section>`;
}
function orderedConversationMessages(messages) {
  const users = messages.filter((message) => message.role === "user");
  const assistants = messages.filter((message) => message.role === "assistant");
  const used = new Set();
  const ordered = [];
  for (const user of users) {
    ordered.push(user);
    let reply = assistants.find((message) => message.replyToMessageId === user.id && !used.has(message.id));
    if (!reply) reply = assistants.find((message) => !message.replyToMessageId && !used.has(message.id));
    if (reply) { used.add(reply.id); ordered.push(reply); }
  }
  return [...ordered, ...assistants.filter((message) => !used.has(message.id))];
}
function taskConversationPipelineStrip(task, busy) {
  const workflow = task.config?.workflow || "codex-antigravity";
  const artifactsCount = (task.artifacts || []).length;
  const lastEvent = (task.events || []).filter((e) => e.kind !== "output").at(-1) || (task.events || []).at(-1);
  if (workflow === "chat-only" && !busy && !artifactsCount && !task.isolated && !task.fanoutId) return "";
  const stages = workflow === "chat-only" ? "" : (workflow === "plan-only" ? [{ id: "plan", label: "Kế hoạch", done: Boolean(task.plan) }] : [{ id: "plan", label: "Kế hoạch", done: Boolean(task.plan) }, { id: "build", label: "Triển khai", done: Boolean(task.implementation) }, { id: "review", label: "Review", done: Boolean(task.review) }]).map((stage) => `<span class="chat-stage-chip ${stage.done ? "is-done" : (busy && task.phase === stage.id ? "is-active" : "is-pending")}"><i></i>${stage.label}</span>`).join(`<span class="chat-stage-arrow">→</span>`);
  const worktreeChip = task.isolated
    ? `<span class="chat-worktree-chip ${task.worktreeAppliedAt ? "is-merged" : ""}" title="${esc(task.worktreePath || task.executionPath || "")}">${icon(task.worktreeAppliedAt ? "check" : "git-branch", 12)} ${task.worktreeAppliedAt ? "Đã gộp vào dự án" : task.worktreeCleaned ? "Worktree đã dọn" : esc(task.worktreeBranch || "Worktree cô lập")}</span>`
    : "";
  const activityText = busy && lastEvent?.text ? `<span class="chat-live-event" title="${esc(lastEvent.text)}"><i class="pulse-dot"></i>${esc(String(lastEvent.text).slice(0, 110))}</span>` : "";
  const canManageWorktree = Boolean(task.isolated && !busy && !task.worktreeCleaned && !task.worktreeAppliedAt);
  const applyWtBtn = canManageWorktree && artifactsCount > 0
    ? `<button type="button" class="button primary small" data-action="apply-worktree" data-id="${esc(task.id)}" title="Áp dụng thay đổi từ worktree cô lập này vào nhánh chính của dự án">${icon("check", 13)}<span>Gộp vào dự án</span></button>`
    : "";
  const discardWtBtn = canManageWorktree
    ? `<button type="button" class="button quiet small" data-action="discard-worktree" data-id="${esc(task.id)}" title="Hủy bỏ và xóa nhánh Git worktree cô lập này">${icon("delete", 13)}<span>Hủy worktree</span></button>`
    : "";
  const diffBtn = task.status !== "queued" ? `<button type="button" class="button quiet small" data-action="show-diff" data-id="${esc(task.id)}">${icon("file", 13)}<span>Diff & Review${artifactsCount ? ` (${artifactsCount})` : ""}</span></button>` : "";
  const flowBtn = `<button type="button" class="button quiet small" data-action="open-task-flow" data-id="${esc(task.id)}">${icon("workflow", 13)}<span>Luồng</span></button>`;
  const stopBtn = busy && workflow !== "chat-only" ? `<button type="button" class="button danger small" data-action="stop-task" data-id="${esc(task.id)}">${icon("square", 12)}<span>Dừng</span></button>` : "";
  return `<div class="chat-pipeline-strip ${busy ? "is-running" : ""}"><div class="chat-pipeline-stages">${stages}${worktreeChip}${activityText}</div><div class="chat-pipeline-actions">${applyWtBtn}${discardWtBtn}${diffBtn}${flowBtn}${stopBtn}</div></div>`;
}
function taskArenaBanner(task) {
  if (!task.fanoutId) return "";
  const siblings = (view.state?.tasks || []).filter((item) => item.fanoutId === task.fanoutId && !item.archived);
  if (siblings.length < 2) return "";
  return `<section class="arena-banner" aria-label="Đa luồng Agent">
    <header class="arena-banner-head">
      <div>
        <span class="arena-badge">${icon("git-branch", 12)} ĐA LUỒNG WORKTREE</span>
        <strong>${siblings.length} agent đang giải cùng yêu cầu trên nhánh cô lập</strong>
      </div>
      <button type="button" class="button primary small" data-action="compare-fanout" data-fanout-id="${esc(task.fanoutId)}">${icon("list-checks", 13)}<span>So sánh & Chọn bản thắng</span></button>
    </header>
    <div class="arena-competitor-tabs">
      ${siblings.map((item) => {
        const compName = item.fanoutCompetitor?.name || providerTitle(view.connectors, item.config?.roles?.build?.provider || item.config?.chatProvider || "codex");
        const filesCount = (item.artifacts || []).length;
        const tok = Object.values(item.usage || {}).reduce((s, u) => s + tokenCount(u), 0);
        return `<button type="button" class="arena-competitor-card ${item.id === task.id ? "is-active" : ""}" data-task="${esc(item.id)}">
          <span class="wb-task-dot is-${esc(item.status || "done")}"></span>
          <div class="arena-competitor-info">
            <strong>${esc(compName)}${item.worktreeAppliedAt ? " · ĐÃ CHỌN" : ""}</strong>
            <small>${esc(statuses[item.status] || item.status)} · ${filesCount} tệp sửa${tok ? ` · ${formatNumber(tok)} tok` : ""}</small>
          </div>
        </button>`;
      }).join("")}
    </div>
  </section>`;
}
function cleanToolCommandText(raw) {
  let text = String(raw || "").trim();
  if (!text) return "";
  text = text
    .replace(/^(?:"[^"]*(?:powershell|pwsh)(?:\.exe)?"|\S*(?:powershell|pwsh)(?:\.exe)?)\s+(?:-[a-zA-Z]+\s+)*-Command\s+/i, "")
    .replace(/^(?:"[^"]*cmd(?:\.exe)?"|\S*cmd(?:\.exe)?)\s+(?:\/[a-zA-Z]\s+)*\/c\s+/i, "")
    .trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, "\\").trim();
  }
  return text.replace(/\s+/g, " ");
}
function taskInlineToolStream(task) {
  const events = (task.events || []).filter((e) => ["tool", "stage", "handoff", "error"].includes(e.kind));
  const artifacts = task.artifacts || [];
  if (!events.length && !artifacts.length) return "";
  const recentTools = events.slice(-16);
  const running = task.status === "running";
  return `<details class="chat-tool-stream" ${running ? "open" : ""}>
    <summary class="chat-tool-stream-summary">
      <span class="chat-tool-stream-title">
        ${icon("square-terminal", 13)}
        <strong>Hoạt động công cụ</strong>
        <span class="chat-tool-stream-meta">${events.length} bước thực thi${artifacts.length ? ` · ${artifacts.length} tệp thay đổi` : ""}</span>
      </span>
      <span class="chat-tool-stream-chevron">${icon("chevron-right", 14)}</span>
    </summary>
    <div class="chat-tool-stream-body">
      <div class="chat-tool-list">
        ${recentTools.map((ev) => {
          const isErr = ev.kind === "error" || ev.status === "failed";
          const iconName = ev.filePath ? "file-text" : ev.kind === "stage" || ev.kind === "handoff" ? "workflow" : "square-terminal";
          const badge = ev.toolName || (ev.kind === "stage" ? "stage" : ev.kind === "handoff" ? "handoff" : "terminal");
          const rawText = ev.command || ev.filePath || ev.text || "";
          const displayCmd = cleanToolCommandText(rawText) || rawText;
          return `<div class="chat-tool-card ${isErr ? "is-error" : ""}">
            <span class="chat-tool-icon">${icon(iconName, 12)}</span>
            <span class="chat-tool-badge">${esc(badge)}</span>
            <code class="chat-tool-text" title="${esc(rawText)}">${esc(displayCmd)}</code>
            ${ev.exitCode !== undefined && ev.exitCode !== null ? `<span class="chat-tool-exit ${ev.exitCode === 0 ? "is-ok" : "is-fail"}">${ev.exitCode === 0 ? "✓" : `exit ${ev.exitCode}`}</span>` : ""}
          </div>`;
        }).join("")}
      </div>
      ${artifacts.length ? `<div class="chat-tool-artifacts">
        <span class="chat-tool-artifacts-label">${icon("files", 12)}<span>Tệp sửa đổi</span></span>
        <div class="chat-tool-artifact-list">
          ${artifacts.slice(0, 24).map((filePath) => {
            const norm = String(filePath || "").replaceAll("\\", "/");
            const base = norm.split("/").at(-1) || norm;
            const dir = norm.includes("/") ? norm.slice(0, norm.lastIndexOf("/")) : "";
            return `<button type="button" class="chat-artifact-pill" data-action="open-diff-file" data-id="${esc(task.id)}" data-path="${esc(filePath)}" title="Mở tệp ${esc(norm)}">${icon(dockFileIconName(base), 12)}<strong>${esc(base)}</strong>${dir ? `<small>${esc(dir)}</small>` : ""}</button>`;
          }).join("")}
        </div>
      </div>` : ""}
    </div>
  </details>`;
}
function chatContextDrawer(task) {
  if (!view.chatDrawerOpen) return "";
  const allFiles = view.workspaceFileIndex?.[task.workspaceId] || [];
  if (!view.workspaceFileIndex?.[task.workspaceId]) {
    void ensureWorkspaceFileIndex(task.workspaceId).then(() => render());
  }
  const artifacts = task.artifacts || [];
  const activeTab = view.chatDrawerTab || (artifacts.length ? "changed" : "files");
  const filter = (view.chatDrawerFilter || "").trim().toLowerCase();
  const visibleFiles = (activeTab === "changed" ? artifacts : allFiles)
    .filter((f) => !filter || f.toLowerCase().includes(filter))
    .slice(0, 180);
  const preview = view.chatDrawerPreview;
  return `<aside class="chat-context-drawer" aria-label="Cây thư mục và Tệp thay đổi">
    <header class="chat-drawer-head">
      <div class="chat-drawer-tabs">
        <button type="button" class="chat-drawer-tab ${activeTab === "changed" ? "is-active" : ""}" data-action="chat-drawer-tab" data-tab="changed">Tệp sửa (${artifacts.length})</button>
        <button type="button" class="chat-drawer-tab ${activeTab === "files" ? "is-active" : ""}" data-action="chat-drawer-tab" data-tab="files">Dự án (${allFiles.length})</button>
      </div>
      <button type="button" class="icon-button" data-action="toggle-chat-drawer" title="Đóng ngăn tệp">${icon("x", 15)}</button>
    </header>
    <label class="chat-drawer-search">
      ${icon("search", 14)}
      <input type="search" data-chat-drawer-filter value="${esc(view.chatDrawerFilter || "")}" placeholder="Lọc nhanh tên tệp…" autocomplete="off">
    </label>
    <ul class="chat-drawer-list">
      ${visibleFiles.length ? visibleFiles.map((filePath) => `<li class="chat-drawer-item">
        <button type="button" class="chat-drawer-file" data-action="${activeTab === "changed" ? "open-diff-file" : "preview-drawer-file"}" data-id="${esc(task.id)}" data-workspace-id="${esc(task.workspaceId)}" data-path="${esc(filePath)}" title="${esc(filePath)}">
          ${icon("file", 13)}
          <span>${esc(filePath)}</span>
        </button>
        <button type="button" class="chat-drawer-mention" data-action="mention-drawer-file" data-path="${esc(filePath)}" title="Chèn @${esc(filePath)} vào khung chat">@</button>
      </li>`).join("") : `<li class="chat-drawer-empty">${activeTab === "changed" ? "Chưa có tệp thay đổi nào trong task này." : "Không tìm thấy tệp phù hợp."}</li>`}
    </ul>
    ${preview ? `<section class="chat-drawer-preview">
      <header>
        <strong title="${esc(preview.path)}">${esc(preview.name || preview.path)}</strong>
        <div>
          <button type="button" class="button quiet small" data-action="mention-drawer-file" data-path="${esc(preview.path)}">Chèn @file</button>
          <button type="button" class="icon-button" data-action="close-drawer-preview">${icon("x", 13)}</button>
        </div>
      </header>
      <pre><code>${esc(preview.content || "")}</code></pre>
    </section>` : ""}
  </aside>`;
}
function plainChatExcerpt(value, maxLength = 220) {
  const excerpt = String(value || "")
    .replace(/```[\s\S]*?```/g, " Khối mã ")
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/[#>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return excerpt.length > maxLength ? `${excerpt.slice(0, maxLength).trimEnd()}…` : excerpt;
}

function chatDurationLabel(value) {
  const milliseconds = Math.max(0, Number(value) || 0);
  if (milliseconds < 1000) return `${milliseconds} ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.floor(seconds % 60)}s`;
}

function chatOutputTokenCount(usage) {
  return Number(usage?.output_tokens ?? usage?.completion_tokens ?? usage?.outputTokens) || 0;
}

function updateChatOutline() {
  const panes = [...document.querySelectorAll(".conversation-chat-pane")];
  for (const pane of panes) updateOneChatOutline(pane);
}
function updateOneChatOutline(pane) {
  const thread = $(".chat-thread", pane);
  const nav = $(".chat-outline-nav", pane);
  if (!thread || !nav) return;
  const answers = [...thread.querySelectorAll("[data-chat-answer-index]")];
  const threadRect = thread.getBoundingClientRect();
  const paneRect = nav.parentElement.getBoundingClientRect();
  const links = [...nav.querySelectorAll(".chat-outline-link")];
  const track = nav.querySelector(".chat-outline-track");
  const usableHeight = Math.max(80, thread.clientHeight - 32);
  const markerHeight = 8;
  // Short chats stay compact. As answers accumulate, increase the spacing
  // until the rail fills, then keep a natural rhythm and allow scrolling.
  const step = 8 + Math.max(0, links.length - 1) * 0.8;
  const contentHeight = links.length ? markerHeight + (links.length - 1) * step : 0;
  const isScrollable = contentHeight > usableHeight;
  const centeredOffset = isScrollable ? 0 : Math.max(0, (usableHeight - contentHeight) / 2);
  nav.style.top = `${threadRect.top - paneRect.top + 16}px`;
  nav.style.height = `${usableHeight}px`;
  if (track) {
    track.style.height = `${usableHeight}px`;
    track.classList.toggle("is-scrollable", isScrollable);
  }
  const anchor = threadRect.top + Math.min(100, thread.clientHeight * 0.25);
  let current = answers[0];
  for (const answer of answers) {
    if (answer.getBoundingClientRect().top <= anchor) current = answer;
    else break;
  }
  const currentIndex = Number(current?.dataset.chatAnswerIndex);
  for (const [index, link] of links.entries()) {
    link.style.top = `${centeredOffset + index * step}px`;
    const firstAnswer = Number(link.dataset.answerIndex);
    const lastAnswer = Number(link.dataset.answerEndIndex);
    const active = Number.isFinite(currentIndex) && currentIndex >= firstAnswer && currentIndex <= lastAnswer;
    link.classList.toggle("is-current", active);
    if (active) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}

let chatOutlineHoverTimer = 0;
let chatOutlineHoverTarget = null;

function animateChatOutlineWave(link) {
  if (window.matchMedia("(prefers-reduced-motion: reduce), (max-width: 740px), (hover: none)").matches) return;
  const track = link?.closest(".chat-outline-track");
  if (!track || typeof Element.prototype.animate !== "function") return;
  const links = [...track.querySelectorAll(".chat-outline-link")];
  const origin = links.indexOf(link);
  for (const [index, item] of links.entries()) {
    if (index > origin) continue;
    const dot = item.querySelector(".chat-outline-dot");
    if (!dot) continue;
    dot.getAnimations().forEach((animation) => animation.cancel());
    dot.animate([
      { transform: "scaleX(1)", opacity: 0.72 },
      { transform: "scaleX(1.45)", opacity: 0.95, offset: 0.45 },
      { transform: "scaleX(1)", opacity: 0.72 },
    ], { duration: 420, delay: Math.min(420, (origin - index) * 36), easing: "ease-out" });
  }
}

function hideChatOutlinePreview(nav = $(".chat-outline-nav")) {
  nav?.classList.remove("is-previewing");
  nav?.querySelector(".chat-outline-tooltip")?.setAttribute("aria-hidden", "true");
}

function showChatOutlinePreview(link) {
  if (!link || window.matchMedia("(max-width: 740px), (hover: none)").matches) return;
  const nav = link.closest(".chat-outline-nav");
  const tooltip = nav?.querySelector(".chat-outline-tooltip");
  const pane = nav?.closest(".conversation-chat-pane");
  if (!tooltip || !pane) return;
  tooltip.innerHTML = link.querySelector(".chat-outline-preview")?.innerHTML || "";
  const navRect = nav.getBoundingClientRect();
  const paneRect = pane.getBoundingClientRect();
  const linkRect = link.getBoundingClientRect();
  const height = tooltip.offsetHeight;
  const top = Math.max(paneRect.top + 8, Math.min(linkRect.top + linkRect.height / 2 - height / 2, paneRect.bottom - height - 8));
  tooltip.style.top = `${top - navRect.top}px`;
  tooltip.setAttribute("aria-hidden", "false");
  nav.classList.add("is-previewing");
}

let chatOutlineFrame = 0;
document.addEventListener("scroll", (event) => {
  if (!event.target?.matches?.(".chat-thread")) return;
  hideChatOutlinePreview();
  if (chatOutlineFrame) return;
  chatOutlineFrame = requestAnimationFrame(() => { chatOutlineFrame = 0; updateChatOutline(); });
}, true);
window.addEventListener("resize", updateChatOutline);
document.addEventListener("pointerover", (event) => {
  const link = event.target.closest?.(".chat-outline-link");
  if (!link || event.pointerType !== "mouse" || link.contains(event.relatedTarget)) return;
  showChatOutlinePreview(link);
  clearTimeout(chatOutlineHoverTimer);
  chatOutlineHoverTarget = link;
  chatOutlineHoverTimer = window.setTimeout(() => {
    chatOutlineHoverTimer = 0;
    if (chatOutlineHoverTarget === link && link.matches(":hover")) animateChatOutlineWave(link);
  }, 320);
});
document.addEventListener("focusin", (event) => showChatOutlinePreview(event.target.closest?.(".chat-outline-link")));
document.addEventListener("pointerout", (event) => {
  const link = event.target.closest?.(".chat-outline-link");
  if (link && !link.contains(event.relatedTarget) && chatOutlineHoverTarget === link) {
    clearTimeout(chatOutlineHoverTimer);
    chatOutlineHoverTimer = 0;
    chatOutlineHoverTarget = null;
  }
  const nav = event.target.closest?.(".chat-outline-nav");
  if (nav && !nav.contains(event.relatedTarget)) hideChatOutlinePreview(nav);
});
document.addEventListener("focusout", (event) => {
  const nav = event.target.closest?.(".chat-outline-nav");
  if (nav && !nav.contains(event.relatedTarget)) hideChatOutlinePreview(nav);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const nav = $(".chat-outline-nav");
  hideChatOutlinePreview(nav);
  nav?.classList.remove("is-open");
  $(".wb-mobile-outline-toggle")?.setAttribute("aria-expanded", "false");
});
document.addEventListener("click", (event) => {
  const nav = $(".chat-outline-nav.is-open");
  if (!nav || nav.contains(event.target) || event.target.closest?.('[data-action="toggle-chat-outline"]')) return;
  nav.classList.remove("is-open");
  $(".wb-mobile-outline-toggle")?.setAttribute("aria-expanded", "false");
});

function taskConversationPage(taskId = view.selected, options = {}) {
  const task = view.state.tasks.find((item) => item.id === taskId);
  if (!task) return "";
  const workflow = task.config?.workflow || "codex-antigravity";
  const planRole = roleConfig(task.config, "plan");
  const buildRole = roleConfig(task.config, "build");
  const reviewRole = roleConfig(task.config, "review");
  const messages = task.chatMessages || [];
  const hasInitialMessage = messages.some((message) => message.role === "user" && message.initialChat);
  const transcript = [];
  if (!hasInitialMessage && (task.prompt || task.attachments?.length)) transcript.push({ role: "user", provider: "user", content: task.prompt, attachments: (task.attachments || []).map(({ name }) => ({ name })), createdAt: task.createdAt });
  if (workflow !== "chat-only") {
    const latestStageMetric = (stage) => [...(task.stageMetrics || [])].reverse().find((metric) => metric.stage === stage);
    const pipelineStages = [
      ["plan", task.plan, planRole],
      ...(workflow === "plan-only" ? [] : [["build", task.implementation, buildRole], ["review", task.review, reviewRole]]),
    ].filter(([, content]) => content);
    const pipelineMetrics = pipelineStages.map(([stage]) => latestStageMetric(stage)).filter(Boolean);
    const measuredPipelineDuration = pipelineMetrics.reduce((sum, metric) => sum + (Number(metric.durationMs) || 0), 0);
    const legacyPipelineDuration = Math.max(0, (Date.parse(task.completedAt || task.updatedAt || "") || 0) - (Date.parse(task.startedAt || task.createdAt || "") || 0));
    const hasAllPipelineMetrics = pipelineStages.length > 0 && pipelineStages.every(([stage]) => Boolean(latestStageMetric(stage)));
    const pipelineDurationMs = hasAllPipelineMetrics ? measuredPipelineDuration : legacyPipelineDuration;
    const hasAllPipelineOutputCounts = hasAllPipelineMetrics && pipelineStages.every(([stage]) => {
      const usage = latestStageMetric(stage)?.usage;
      return usage && (usage.output_tokens !== undefined || usage.completion_tokens !== undefined || usage.outputTokens !== undefined);
    });
    const pipelineOutputTokens = hasAllPipelineOutputCounts ? pipelineMetrics.reduce((sum, metric) => sum + chatOutputTokenCount(metric.usage), 0) : 0;
    const finalPipelineStage = pipelineStages.at(-1)?.[0];
    for (const [stage, content, role] of pipelineStages) {
      const metric = latestStageMetric(stage);
      const isFinalStage = stage === finalPipelineStage;
      transcript.push({
        role: "assistant", pipelineStage: true, pipelineGroup: true, pipelineTotal: isFinalStage, stage,
        provider: role.provider, label: `${({ plan: "Kế hoạch", build: "Triển khai", review: "Review" })[stage]} · ${providerTitle(view.connectors, role.provider)}`,
        model: role.model, effort: role.effort, content,
        durationMs: isFinalStage && pipelineDurationMs ? pipelineDurationMs : metric?.durationMs,
        usage: isFinalStage && pipelineOutputTokens ? { output_tokens: pipelineOutputTokens } : metric?.usage,
        createdAt: stage === "plan" ? task.createdAt : task.updatedAt,
      });
    }
  }
  transcript.push(...orderedConversationMessages(messages));
  const outlineItems = [];
  let currentQuestion = plainChatExcerpt(task.prompt || "");
  let matchedInitialQuestion = false;
  let activeOutlineItem = null;
  let pipelineOutlineItem = null;
  transcript.forEach((message, answerIndex) => {
    if (message.role === "user") {
      if (workflow !== "chat-only" && !matchedInitialQuestion && message.initialChat) {
        matchedInitialQuestion = true;
        return;
      }
      currentQuestion = plainChatExcerpt(message.content || "Tệp đính kèm");
      activeOutlineItem = null;
      return;
    }
    if (message.role === "assistant" && message.content) {
      let item;
      if (message.pipelineGroup) {
        item = pipelineOutlineItem;
        if (!item) {
          item = { answerIndex, answerEndIndex: answerIndex, title: currentQuestion || "Câu trả lời", summary: "" };
          outlineItems.push(item);
          pipelineOutlineItem = item;
        }
      } else {
        item = activeOutlineItem;
        if (!item) {
          item = { answerIndex, answerEndIndex: answerIndex, title: plainChatExcerpt(message.label || currentQuestion || "Câu trả lời"), summary: "" };
          outlineItems.push(item);
          activeOutlineItem = item;
        }
      }
      item.answerEndIndex = answerIndex;
      item.summary = plainChatExcerpt([item.summary, message.content].filter(Boolean).join(" "));
    }
  });
  const visibleOutlineItems = outlineItems.filter((item) => item.answerIndex !== null);
  const outlineLabel = view.language === "en" ? "Answer summary and navigation" : "Tóm tắt và điều hướng câu trả lời";
  const outlineMarkup = visibleOutlineItems.length ? `<nav class="chat-outline-nav" aria-label="${outlineLabel}"><div class="chat-outline-track">${visibleOutlineItems.map((item, index) => {
    const answerTitle = item.title || (view.language === "en" ? `Answer ${index + 1}` : `Câu trả lời ${index + 1}`);
    const answerLabel = view.language === "en" ? `Go to answer ${index + 1}` : `Đến câu trả lời ${index + 1}`;
    const emptySummary = view.language === "en" ? "No answer summary yet." : "Chưa có nội dung tóm tắt.";
    return `<button type="button" class="chat-outline-link" data-action="jump-chat-answer" data-answer-index="${item.answerIndex}" data-answer-end-index="${item.answerEndIndex}" aria-label="${answerLabel}: ${esc(answerTitle)}" title="${answerLabel}"><span class="chat-outline-dot" aria-hidden="true"></span><span class="chat-outline-preview"><strong>${esc(answerTitle)}</strong><span>${esc(item.summary || emptySummary)}</span></span></button>`;
  }).join("")}</div><div class="chat-outline-tooltip chat-outline-preview" role="tooltip" aria-hidden="true"></div></nav>` : "";
  const busy = ["queued", "running"].includes(task.status);
  const provider = options.selection?.provider || view.chatProvider || (workflow === "chat-only" ? task.config.chatProvider : planRole.provider) || "codex";
  const models = view.connectors?.[provider]?.models || [];
  const modelId = (options.selection ? options.selection.model : view.chatModel) || (workflow === "chat-only" ? task.config.chatModel : planRole.model) || models[0]?.id || "";
  const model = models.find((item) => item.id === modelId) || models[0];
  const effort = (options.selection ? options.selection.effort : view.chatEffort) || (workflow === "chat-only" ? task.config.chatEffort : planRole.effort) || model?.efforts?.find((item) => item === "medium") || model?.efforts?.[0] || "";
  const canSend = Boolean(model && view.connectors?.[provider]?.available && view.connectors?.[provider]?.capabilities?.chat && (provider !== "codex" || view.connectors?.codex?.authenticated));
  const queuedTurns = task.chatQueue || [];
  const hasActiveChatMessage = messages.some((message) => message.role === "user" && message.status === "running");
  const queueSummary = `${hasActiveChatMessage ? (view.language === "en" ? "Agent is replying" : "Agent đang trả lời") : ""}${queuedTurns.length ? `${hasActiveChatMessage ? " · " : ""}${view.language === "en" ? `${queuedTurns.length} queued` : `${queuedTurns.length} tin đang chờ`}` : ""}`;
  const totalUsage = Object.values(task.usage || {}).reduce((sum, item) => sum + tokenCount(item), 0);
  let currentTranscriptUser = null;
  const latestAssistantMessage = [...messages].reverse().find((item) => item.role === "assistant");
  const transcriptHtml = transcript.length ? transcript.map((message, messageIndex) => {
    const isUser = message.role === "user";
    if (isUser) currentTranscriptUser = message;
    const sender = isUser ? "Bạn" : message.label || providerTitle(view.connectors, message.provider);
    const modelLabel = [message.model, message.effort].filter(Boolean).join(" · ");
    const queuePosition = message.status === "queued" ? queuedTurns.findIndex((turn) => turn.messageId === message.id) : -1;
    const pending = message.status === "queued" ? queuePosition >= 0 ? (view.language === "en" ? `Queued · ${queuePosition + 1}/${queuedTurns.length}` : `Trong hàng đợi · ${queuePosition + 1}/${queuedTurns.length}`) : (view.language === "en" ? "Queued" : "Đang chờ") : message.status === "running" ? (view.language === "en" ? "Agent is replying" : "Đang xử lý") : message.status === "failed" ? (view.language === "en" ? "Failed" : "Lỗi") : "";
    const content = message.content ? renderMarkdown(message.content) : "";
    const forkButton = isUser && message.id && (!message.status || message.status === "done") ? `<button type="button" class="chat-fork-button" data-action="fork-chat" data-id="${esc(task.id)}" data-message-id="${esc(message.id)}" title="Tạo nhánh hội thoại từ đây; workspace vẫn dùng chung">${icon("git-branch", 12)}<span>Tạo nhánh</span></button>` : "";
    const messageError = message.status === "failed" ? `<button type="button" class="chat-message-error" data-action="view-error-details" data-error="${esc(message.error || "Không nhận được phản hồi từ agent.")}">Xem nguyên nhân lỗi</button>` : "";
    const messageAttachments = message.attachments?.length ? `<div class="chat-message-attachments">${message.attachments.map((file) => `<span class="chat-message-attachment">${icon("file", 14)}<span title="${esc(file.name)}">${esc(file.name)}</span></span>`).join("")}</div>` : "";
    const isLatestSavedReply = message.role === "assistant" && message.id && message.id === latestAssistantMessage?.id;
    const taskUsageTime = Date.parse(task.updatedAt || "");
    const replyTime = Date.parse(message.createdAt || "");
    const latestTaskUsage = isLatestSavedReply && task.usage?.[message.provider] && taskUsageTime && replyTime && Math.abs(taskUsageTime - replyTime) <= 120_000
      ? task.usage[message.provider]
      : null;
    const messageUsage = message.usage || latestTaskUsage;
    const outputTokens = chatOutputTokenCount(messageUsage);
    const repliedTo = message.role === "assistant"
      ? messages.find((item) => item.id === message.replyToMessageId) || currentTranscriptUser
      : null;
    const fallbackDuration = message.role === "assistant" && message.createdAt
      ? Math.max(0, Date.parse(message.createdAt) - Date.parse(repliedTo?.createdAt || task.startedAt || task.createdAt || message.createdAt))
      : 0;
    const responseDuration = Number(message.durationMs) || fallbackDuration;
    const displayDuration = message.pipelineStage && !message.pipelineTotal ? 0 : responseDuration;
    const responseMeta = message.role === "assistant" && message.status !== "running" && (displayDuration || outputTokens)
      ? `<div class="chat-response-meta"><span>${message.pipelineStage ? (view.language === "en" ? "Pipeline time" : "Thời gian luồng") : (view.language === "en" ? "Response time" : "Thời gian trả lời")}: ${chatDurationLabel(displayDuration)}</span><span aria-hidden="true">·</span><span title="${latestTaskUsage ? (view.language === "en" ? "Recovered from the latest saved CLI usage record for this reply." : "Khôi phục từ bản ghi usage CLI gần nhất khớp thời điểm trả lời.") : ""}">${outputTokens ? `${formatNumber(outputTokens)} ${view.language === "en" ? "tokens" : "token"}` : `— ${view.language === "en" ? "tokens" : "token"}`}</span></div>`
      : "";
    if (isUser) {
      return `<article class="chat-message from-user" data-key="user-msg-${esc(message.id || messageIndex)}"><div class="user-bubble-card"><div class="chat-message-content user-message-content">${content}${messageAttachments}</div></div>${(forkButton || pending || messageError) ? `<div class="user-message-meta ${pending || messageError ? "is-visible" : ""}">${pending ? `<span class="chat-message-status">${esc(pending)}</span>` : ""}${messageError}${forkButton}</div>` : ""}</article>`;
    }
    return `<article class="chat-message from-agent" id="chat-answer-${options.splitPane ? `${esc(task.id)}-` : ""}${messageIndex}" data-key="assistant-msg-${esc(message.id || messageIndex)}" data-chat-answer-index="${messageIndex}"><header><strong>${esc(sender)}</strong><small>${esc(modelLabel || pending || fmtDate(message.createdAt))}</small></header><div class="chat-message-content agent-message-content">${content}${messageAttachments}${pending ? `<span class="chat-message-status">${esc(pending)}</span>` : ""}${messageError}${responseMeta}</div></article>`;
  }).join("") : `<div class="chat-empty-note">Cuộc trò chuyện này chưa có nội dung hiển thị. Gửi tin nhắn để tiếp tục với agent trong workspace.</div>`;
  const effortDisplay = { low: "Low", medium: "Medium", high: "High", minimal: "Min", standard: "Std", max: "Max" };
  const activeEfforts = model?.efforts?.length ? model.efforts : ["low", "medium", "high"];
  const taskAgentItems = [];
  let activeTaskModelLabel = model?.name || model?.id || providerTitle(view.connectors, provider);
  for (const [provId, conn] of Object.entries(view.connectors || {})) {
    if (!conn?.available || !conn?.capabilities?.chat) continue;
    const provName = providerTitle(view.connectors, provId);
    const provModels = conn.models?.length ? conn.models : [{ id: "", name: conn.name || provName }];
    taskAgentItems.push(`<div class="codex-pop-group-label">${esc(provName)}</div>`);
    for (const m of provModels) {
      const val = `${provId}::${m.id || ""}`;
      const isSelected = provId === provider && (m.id || "") === (model?.id || "");
      const modelTitle = m.name || m.id || provName;
      if (isSelected) activeTaskModelLabel = modelTitle;
      taskAgentItems.push(`<button type="button" class="codex-pop-item ${isSelected ? "is-selected" : ""}" data-action="pick-task-chat-agent" data-id="${esc(task.id)}" data-agent="${esc(val)}">
        <span class="codex-pop-item-main"><span>${esc(modelTitle)}</span></span>
        ${isSelected ? icon("check", 13) : ""}
      </button>`);
    }
  }
  const threadId = options.splitPane ? `chat-thread-${esc(task.id)}` : "chat-thread";
  const composerMarkup = options.locked
    ? `<div class="multi-chat-locked">Chat này chưa có worktree riêng để chạy song song an toàn. Tạo chat mới với “Tách Git worktree riêng”.</div>`
    : `<form class="chat-composer" data-modal data-form="task-chat" data-id="${esc(task.id)}">${composerAttachmentsMarkup(`task:${task.id}`)}<div class="composer-input-wrap"><textarea name="message" class="chat-input" maxlength="50000" rows="1" placeholder="${queuedTurns.length || hasActiveChatMessage ? (view.language === "en" ? "Send another message; it will wait in the queue…" : "Gửi tin nhắn tiếp theo; agent sẽ xử lý theo hàng đợi…") : "Nhắn tiếp trong cuộc trò chuyện này…"}">${esc(options.draft ?? view.chatDraft)}</textarea><div class="mention-popover" data-mention-popover hidden></div></div><input type="hidden" name="provider" value="${esc(provider)}"><input type="hidden" name="model" value="${esc(model?.id || "")}"><input type="hidden" name="effort" value="${esc(effort)}"><footer class="chat-composer-controls"><div class="composer-add-wrap">${composerAddMenu("message", task.id)}${composerPermissionMenuMarkup(task.permissionPreset || "workspace-write", "task", task.id)}</div><div class="home-composer-actions"><div class="codex-inline-model-bar"><details class="codex-pop-menu is-up is-right" data-pop-id="task-model-${esc(task.id)}"><summary class="codex-inline-trigger is-model" title="Chọn Agent & Model"><span>${esc(activeTaskModelLabel)}</span>${icon("chevron-down", 12)}</summary><div class="codex-pop-card is-model-list"><div class="codex-pop-head">Agent & Model</div><div class="codex-pop-scroll">${taskAgentItems.join("")}</div></div></details><details class="codex-pop-menu is-up is-right" data-pop-id="task-effort-${esc(task.id)}"><summary class="codex-inline-trigger is-effort" title="Mức suy luận"><span>${esc(effortDisplay[effort] || effort || "Medium")}</span>${icon("chevron-down", 12)}</summary><div class="codex-pop-card is-effort-list"><div class="codex-pop-head">Mức suy luận</div><div class="codex-pop-scroll">${activeEfforts.map((ef) => `<button type="button" class="codex-pop-item ${ef === effort ? "is-selected" : ""}" data-action="pick-task-chat-effort" data-id="${esc(task.id)}" data-effort="${esc(ef)}"><span class="codex-pop-item-main"><span>${esc(effortDisplay[ef] || ef)}</span></span>${ef === effort ? icon("check", 13) : ""}</button>`).join("")}</div></div></details></div>${busy ? `<button class="button primary chat-send-button chat-stop-button" type="button" data-action="stop-task" data-id="${esc(task.id)}" aria-label="${view.language === "en" ? "Stop" : "Dừng"}" title="${view.language === "en" ? "Stop task" : "Dừng tác vụ"}">${icon("square", 13)}</button>` : `<button class="button primary chat-send-button" type="submit" aria-label="${view.language === "en" ? "Send message to queue" : "Gửi tin nhắn vào hàng đợi"}" title="${view.language === "en" ? "Send message to queue" : "Gửi tin nhắn vào hàng đợi"}" ${canSend ? "" : "disabled"}>${icon("arrow-up-right", 16)}</button>`}</div></footer></form>`;
  return `<section class="task-conversation-page is-unified-chat ${options.splitPane ? "is-split-pane" : ""}" aria-label="Cuộc trò chuyện">
      <section class="task-chat-pane conversation-chat-pane">
        ${outlineMarkup}
        <div class="chat-thread" id="${threadId}" data-task-id="${esc(task.id)}" aria-live="polite">
          <div class="chat-thread-stream">
            ${transcriptHtml}
            ${taskInlineToolStream(task)}
            ${busy && !messages.some((message) => message.status === "running") ? `<div class="chat-empty-note">${esc(taskProgress(task))}…</div>` : ""}
          </div>
        </div>
        ${composerMarkup}
      </section>
  </section>`;
}
function homeAgentCard(name, connector, ready) {
  const status = ready ? "Sẵn sàng" : connector?.error ? "Cần kiểm tra CLI" : "Chưa khả dụng";
  const detail = connector?.models?.length ? `${connector.models.length} model · ${connector.version || "CLI"}` : connector?.version || "CLI chưa trả danh sách model";
  return `<div class="home-agent-card"><span class="home-agent-icon">${icon("square-terminal", 15)}</span><span><strong>${esc(name)}</strong><small>${esc(detail)}</small></span><span class="home-agent-status ${ready ? "ready" : "unavailable"}"><i></i>${status}</span></div>`;
}
function homeSearchResults(query) {
  const normalized = String(query || "").trim().toLocaleLowerCase();
  if (!normalized) return "";
  const tasks = view.state.tasks.filter((task) => {
    const messages = (task.chatMessages || []).map((message) => message.content || "").join(" ");
    return `${task.title} ${task.workspacePath} ${messages}`.toLocaleLowerCase().includes(normalized);
  }).slice(0, 8);
  const workspaces = view.state.workspaces.filter((workspace) => `${workspace.name} ${workspace.path}`.toLocaleLowerCase().includes(normalized)).slice(0, 3);
  if (!tasks.length && !workspaces.length) return `<div class="home-search-empty">Không có task hoặc workspace phù hợp.</div>`;
  return `<div class="home-search-section">Workspace</div>${workspaces.map((workspace) => `<button data-workspace="${esc(workspace.id)}">${icon("folder-code", 15)}<span><strong>${esc(workspace.name)}</strong><small>Dự án</small></span></button>`).join("")}<div class="home-search-section">Task và chat</div>${tasks.map((task) => `<button data-task="${esc(task.id)}">${icon(task.config?.workflow === "chat-only" ? "square-terminal" : "workflow", 15)}<span><strong>${esc(task.title)}</strong><small>${esc(view.state.workspaces.find((workspace) => workspace.id === task.workspaceId)?.name || task.workspacePath)}</small></span></button>`).join("")}`;
}
function clearSidebarSearch() {
  view.searchQuery = "";
  view.searchResults = "";
  const input = $("[data-home-search]");
  if (input) input.value = "";
  const results = $("[data-home-search-results]");
  if (results) { results.innerHTML = ""; results.hidden = true; }
}
function chatHomeCard(task) {
  const workspace = view.state.workspaces.find((item) => item.id === task.workspaceId);
  return `<button class="chat-home-card" data-task="${esc(task.id)}"><span class="task-state state-${esc(task.status)}"><i></i></span><span><strong>${esc(task.title)}</strong><small>${esc(workspace?.name || task.workspacePath)} · ${esc(taskProgress(task))}</small></span><time>${fmtDate(task.updatedAt)}</time>${icon("chevron-right", 15)}</button>`;
}
function orchestrationNodeHtml(node, index, count) {
  const stateLabel = { complete: "Hoàn tất", active: "Đang chạy", queued: "Đang chờ", pending: "Chưa chạy", failed: "Lỗi", cancelled: "Đã dừng" }[node.state] || "Chưa ghi nhận";
  const stateIcon = node.state === "complete" ? "check" : node.state === "active" ? "refresh-cw" : node.state === "failed" || node.state === "cancelled" ? "x" : node.icon;
  const extra = node.events?.length ? `<details class="orchestration-node-details"><summary>${node.events.length} sự kiện công cụ quan sát được</summary><div>${node.events.map((event) => `<p><time>${fmtDate(event.at)}</time>${esc(event.text)}</p>`).join("")}</div></details>` : node.output ? `<details class="orchestration-node-details"><summary>Xem đầu ra stage</summary><pre>${esc(node.output)}</pre></details>` : node.files?.length ? `<details class="orchestration-node-details"><summary>Xem ${node.files.length} tệp thay đổi</summary><div>${node.files.map((file) => `<code>${esc(file)}</code>`).join("")}</div></details>` : "";
  return `<article class="orchestration-node state-${esc(node.state)}" data-node="${esc(node.id)}"><div class="orchestration-rail"><span>${icon(stateIcon, 16)}</span>${index < count - 1 ? "<i></i>" : ""}</div><div class="orchestration-node-card"><header><small>${esc(node.group)}</small><span>${stateLabel}</span></header><div class="orchestration-node-main"><span class="orchestration-node-icon">${icon(node.icon, 17)}</span><div><h3>${esc(node.title)}</h3><p>${esc(node.detail)}</p></div></div>${extra}</div></article>`;
}
function openTaskInstructionModal(task) {
  const defaultRole = roleConfig(task.config, "plan");
  const provider = view.chatProvider || (task.config.workflow === "chat-only" ? task.config.chatProvider : defaultRole.provider) || "codex";
  view.chatProvider = provider;
  const models = view.connectors?.[provider]?.models || [];
  const selected = view.chatModel || (task.config.workflow === "chat-only" ? task.config.chatModel : defaultRole.model) || models[0]?.id || "";
  const model = models.find((item) => item.id === selected) || models[0];
  view.chatModel = model?.id || "";
  view.chatEffort = view.chatEffort || (task.config.workflow === "chat-only" ? task.config.chatEffort : defaultRole.effort) || model?.efforts?.find((effort) => effort === "medium") || model?.efforts?.[0] || "";
  const providers = Object.entries(view.connectors || {}).filter(([, connector]) => connectorSupports(connector, "chat"));
  const options = models.map((item) => `<option value="${esc(item.id)}" ${item.id === model?.id ? "selected" : ""}>${esc(item.name)}</option>`).join("");
  const effortOptions = (model?.efforts || efforts).map((effort) => `<option value="${esc(effort)}" ${effort === view.chatEffort ? "selected" : ""}>${esc(effort)}</option>`).join("");
  const body = `<div class="task-instruction-models"><label>Agent<select name="provider" data-chat-provider>${providers.map(([id, connector]) => `<option value="${esc(id)}" ${provider === id ? "selected" : ""}>${esc(connector.name || id)}${connector.kind === "api" ? " · API" : " · CLI"}</option>`).join("") || `<option value="">Chưa có agent khả dụng</option>`}</select></label><label>Model<select name="model" data-chat-model ${model ? "" : "disabled"}>${options || `<option value="">Chưa có model khả dụng</option>`}</select></label><label>Mức suy nghĩ<select name="effort" data-chat-effort>${effortOptions}</select></label></div>`;
  showModal("Cấu hình lượt chat", body, "Áp dụng", "task-chat-config");
  $(".modal").dataset.id = task.id;
  $(".modal").classList.add("task-chat-config-modal");
}
function openTaskGoalModal(task) {
  const checklist = (task.goalChecklist || []).map((item) => item.text).join("\n");
  const checklistStatus = task.goalChecklist?.length ? `<section class="goal-checklist-status"><strong>Tiến độ checklist</strong><ul>${task.goalChecklist.map((item) => `<li><label><input type="checkbox" data-action="toggle-goal-item" data-id="${esc(task.id)}" data-goal-id="${esc(item.id)}" ${item.done ? "checked" : ""}><span class="${item.done ? "is-done" : ""}">${esc(item.text)}</span></label></li>`).join("")}</ul></section>` : "";
  const body = `<label>Mục tiêu<textarea name="goal" rows="3" maxlength="2000" placeholder="Kết quả dài hạn cần đạt">${esc(task.goal || "")}</textarea></label><label>Checklist nghiệm thu<textarea name="checklist" rows="6" maxlength="6000" placeholder="Mỗi dòng là một tiêu chí hoàn tất">${esc(checklist)}</textarea><small>Tối đa 20 mục, mỗi mục tối đa 300 ký tự. Agent sẽ nhận checklist ở các lượt sau.</small></label>${checklistStatus}`;
  showModal("Mục tiêu dài hạn", body, "Lưu mục tiêu", "task-goal");
  $(".modal").dataset.id = task.id;
}
function openTaskPermissionsModal(task) {
  const current = task.permissionPreset || "workspace-write";
  const body = `<label>Quyền truy cập<select name="permissionPreset"><option value="read-only" ${current === "read-only" ? "selected" : ""}>Chỉ đọc workspace</option><option value="workspace-write" ${current === "workspace-write" ? "selected" : ""}>Đọc và sửa workspace</option><option value="full-access" ${current === "full-access" ? "selected" : ""}>Toàn quyền trên máy</option></select><small>Toàn quyền tắt sandbox và bước duyệt của CLI cục bộ (Codex, Antigravity hoặc Claude Code), cho phép agent chạy lệnh và truy cập tệp ngoài workspace theo quyền tài khoản Windows của bạn. Chỉ chọn khi bạn tin cậy yêu cầu và nội dung trong workspace. Provider API vẫn không có quyền chạy lệnh trên máy.</small></label>`;
  showModal("Quyền của task", body, "Lưu quyền", "task-permissions");
  $(".modal").dataset.id = task.id;
}
function taskDetails() {
  const task = view.state.tasks.find((item) => item.id === view.selected);
  if (!task) return "";
  const workspace = view.state.workspaces.find((w) => w.id === task.workspaceId);
  const usage = Object.values(task.usage || {}).reduce((sum, providerUsage) => sum + tokenCount(providerUsage), 0);
  const events = task.events || [];
  const busy = ["queued", "running"].includes(task.status);
  const nodes = orchestrationNodes(task);
  const eventLabels = { stage: "AGENT", handoff: "HANDOFF", tool: "TOOL", output: "OUTPUT", chat: "MESSAGE", memory: "MEMORY", error: "ERROR", success: "DONE", warning: "NOTE" };
  const sortedEvents = [...events].slice(-150).reverse();
  const stages = [
    [`Kế hoạch · ${providerTitle(view.connectors, roleConfig(task.config, "plan").provider)}`, task.plan],
    [`Triển khai · ${providerTitle(view.connectors, roleConfig(task.config, "build").provider)}`, task.implementation],
    [`Review · ${providerTitle(view.connectors, roleConfig(task.config, "review").provider)}`, task.review],
  ].filter(([, output]) => output);
  const replayStages = task.config.workflow === "plan-only" ? [["plan", "Kế hoạch"]] : [["plan", "Kế hoạch"], ["build", "Triển khai"], ["review", "Review"]];
  const defaultReplayStage = task.status === "done"
    ? replayStages.at(-1)[0]
    : replayStages.some(([id]) => id === task.failedPhase) ? task.failedPhase
      : task.plan ? task.implementation ? "review" : "build" : "plan";
  const canRerun = !busy && !task.processRunning;
  const presetBadge = task.presetRef?.name ? `<span class="pill">${esc(translateText("Nguồn mẫu", view.language))}: ${esc(task.presetRef.name)} · v${Number(task.presetRef.version) || 1}</span>` : "";
  const replayControls = canRerun && task.config.workflow !== "chat-only"
    ? `<div class="stage-rerun-controls"><label>Chạy lại từ<select data-rerun-stage>${replayStages.map(([id, label]) => `<option value="${esc(id)}" ${id === defaultReplayStage ? "selected" : ""}>${esc(label)}</option>`).join("")}</select></label><button class="button primary" data-action="rerun-stage" data-id="${esc(task.id)}">Chạy lại</button></div>`
    : canRerun && task.config.workflow === "chat-only" && ["failed", "cancelled"].includes(task.status)
      ? `<button class="button primary" data-action="rerun-task" data-id="${esc(task.id)}">Chạy lại chat</button>`
      : "";
  const stageRunHistory = (task.stageRunHistory || []).length ? `<section class="orchestration-stage-history"><strong>Lịch sử chạy lại</strong>${[...(task.stageRunHistory || [])].reverse().map((attempt) => {
    const stageLabel = { plan: "Kế hoạch", build: "Triển khai", review: "Review", chat: "Chat" }[attempt.stage] || attempt.stage;
    const statusLabel = { queued: "Trong hàng đợi", running: "Đang chạy", done: "Hoàn tất", failed: "Lỗi", cancelled: "Đã dừng" }[attempt.status] || "Đã ghi nhận";
    const outputRows = Object.entries(attempt.previousOutputs || {}).map(([stage, snapshot]) => {
      const label = { plan: "Kế hoạch trước đó", build: "Triển khai trước đó", review: "Review trước đó" }[stage] || stage;
      return `<details><summary>${esc(label)}</summary><pre>${esc(snapshot.text || "")}${snapshot.truncated ? "\n\n… phần cuối đã được rút gọn trong lịch sử." : ""}</pre></details>`;
    }).join("");
    const previousArtifacts = attempt.previousArtifacts?.length ? `<div class="stage-history-files"><small>${esc(translateText("Tệp từ lần chạy trước", view.language))}</small>${attempt.previousArtifacts.slice(0, 30).map((file) => `<code>${esc(file)}</code>`).join("")}</div>` : "";
    return `<details class="stage-history-entry"><summary>${esc(stageLabel)} · ${esc(statusLabel)} · ${fmtDate(attempt.requestedAt)}</summary>${attempt.error ? `<p class="stage-history-error">${esc(attempt.error)}</p>` : ""}${outputRows || "<p>Không có đầu ra cũ cho giai đoạn này.</p>"}${previousArtifacts}</details>`;
  }).join("")}</section>` : "";
  return `<section class="task-orchestration-page" aria-label="Điều phối task">
    <header class="conversation-top"><div class="conversation-context"><span class="conversation-repo">${icon("folder-code", 15)} ${esc(workspace?.name || task.workspacePath)}</span><span class="conversation-separator">/</span><span class="conversation-task-id">${esc(task.id)}</span></div><div class="detail-head-actions"><button class="button quiet small" data-action="back-chat" data-id="${esc(task.id)}">${icon("arrow-left", 14)} Cuộc trò chuyện</button><button class="button quiet small" data-action="open-folder" data-id="${esc(task.id)}">${icon("folder-code", 14)} Mở workspace</button><button class="button quiet small" data-action="task-instruction" data-id="${esc(task.id)}">${icon("arrow-up-right", 14)} Gửi chỉ dẫn</button><button class="button quiet small" data-action="new-task">${icon("plus", 14)} Task mới</button></div></header>
    <div class="detail-title-row"><div><h2>${esc(task.title)}</h2><div class="detail-meta"><span class="pill status-${esc(task.status)}"><i></i>${esc(statuses[task.status] || task.status)}</span>${presetBadge}<span>${fmtDate(task.createdAt)}</span>${usage ? `<span>${formatNumber(usage)} tokens</span>` : ""}<span>${formatNumber(events.length)} sự kiện · ${formatNumber(nodes.length)} node</span></div></div></div>
    ${task.skills?.length ? `<div class="skill-used">${icon("notebook-tabs", 14)} Skill đã chọn: ${task.skills.map((skill) => esc(skill.name)).join(" · ")}</div>` : ""}
    <div class="orchestration-layout"><section class="orchestration-canvas"><header class="orchestration-canvas-head"><div><small>LUỒNG THỰC THI · ${esc(task.config.workflow === "chat-only" ? "CHAT" : task.config.workflow === "plan-only" ? "PLAN ONLY" : "CODE PIPELINE")}</small><h3>${busy ? "Điều phối đang hoạt động" : "Bản ghi điều phối"}</h3></div><span class="activity-live ${busy ? "is-live" : ""}"><i></i>${busy ? "Đang chạy" : "Đã lưu"}</span></header><div class="orchestration-flow">${nodes.map((node, index) => orchestrationNodeHtml(node, index, nodes.length)).join("")}</div></section>
      <aside class="orchestration-activity"><header class="orchestration-activity-head"><div><small>EVENT LOG</small><h3>Điều phối & hoạt động</h3></div><span>${events.length} sự kiện</span></header><div class="orchestration-activity-note">${icon("workflow", 14)} Chỉ hiện hoạt động, handoff, đầu ra và công cụ được CLI ghi nhận. Suy luận nội bộ của model không được cung cấp.</div><div class="orchestration-event-list" id="agent-activity-feed">${sortedEvents.length ? sortedEvents.map((item) => { const text = String(item.text || ""); const longOutput = item.kind === "output" && text.length > 320; return `<article class="orchestration-event kind-${esc(item.kind)}"><span class="orchestration-event-mark">${icon(({ stage: "square-terminal", handoff: "workflow", tool: "settings-2", output: "file", chat: "book-open-text", memory: "brain", error: "circle-question-mark", success: "check", warning: "circle-question-mark" })[item.kind] || "workflow", 14)}</span><div><header><strong>${esc(eventLabels[item.kind] || "EVENT")}</strong><time>${fmtDate(item.at)}</time>${item.kind === "error" ? `<button type="button" class="event-error-open" data-action="view-error-details" data-error="${esc(text)}">Xem lỗi</button>` : ""}</header>${longOutput ? `<p>${esc(text.slice(0, 280))}…</p><details class="orchestration-event-details"><summary>Xem đầu ra đầy đủ</summary><pre>${esc(text)}</pre></details>` : `<p>${esc(text)}</p>`}</div></article>`; }).join("") : `<p class="orchestration-activity-empty">Các sự kiện sẽ xuất hiện khi task được chạy.</p>`}</div>${stages.length ? `<section class="orchestration-stage-results"><strong>Đầu ra agent</strong>${stages.map(([label, output]) => `<details><summary>${esc(label)}</summary><pre>${esc(output)}</pre></details>`).join("")}</section>` : ""}${(task.artifacts || []).length ? `<section class="orchestration-artifacts"><strong>${icon("file", 14)} Tệp thay đổi · ${task.artifacts.length}</strong>${task.artifacts.slice(0, 20).map((file) => `<div>${icon("file", 13)}<code>${esc(file)}</code></div>`).join("")}</section>` : ""}${stageRunHistory}</aside></div>
    <footer class="detail-actions">${task.status === "running" || task.status === "queued" ? `<button class="button danger" data-action="stop-task" data-id="${esc(task.id)}">${icon("square", 13)} Dừng task</button>` : replayControls}${task.status !== "queued" ? `<button class="button quiet" data-action="show-diff" data-id="${esc(task.id)}">Xem diff</button>` : ""}</footer>
  </section>`;
}
function showModal(title, body, submitLabel, formType = "") {
  const inferred = title === "Task mới" ? "task" : title === "Thêm workspace" ? "workspace" : title === "Ghi nhớ mới" ? "memory" : "dismiss";
  const type = formType || inferred;
  $("#overlay").innerHTML = `<div class="modal-backdrop" data-action="close-modal"><form class="modal app-dialog-shell" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-form="${type}" data-modal><header class="modal-head app-dialog-header"><h2 id="modal-title">${esc(title)}</h2><button type="button" class="icon-button" data-action="close-modal" aria-label="Đóng">${icon("x", 16)}</button></header><div class="modal-body app-dialog-content">${body}</div><footer class="modal-actions app-dialog-footer">${type === "dismiss" ? "" : `<button type="button" class="button quiet" data-action="close-modal">Hủy</button>`}<button class="button primary" type="submit">${esc(submitLabel)}</button></footer></form></div>`;
  localizeDom($("#overlay"), view.language);
  $(".modal input, .modal textarea, .modal select")?.focus();
}
function showErrorDetails(text) {
  const details = String(text || "Không có thông tin lỗi chi tiết.");
  showModal("Chi tiết lỗi", `<div class="error-detail-content"><p>Nguyên nhân được trả về từ agent hoặc tiến trình:</p><pre>${esc(details)}</pre></div>`, "Đóng");
  const form = $("#overlay .modal");
  if (form) form.dataset.form = "dismiss";
}
async function openTaskModal() {
  const { workspaces } = view.state;
  if (!providersForRole(view.connectors, "plan").length) { view.page = "settings"; view.selected = null; render(); showToast("Kết nối ít nhất một agent hoặc API rồi bạn có thể tạo task."); return; }
  if (!workspaces.length) return showWorkspaceModal();
  const options = workspaces.map((w) => `<option value="${esc(w.id)}">${esc(w.name)} · ${esc(w.path)}</option>`).join("");
  const hasBuild = providersForRole(view.connectors, "build").length > 0;
  const canPlanOnly = providersForRole(view.connectors, "plan").length > 0;
  const body = `${taskPresetToolsMarkup()}<label>Yêu cầu<textarea name="prompt" required minlength="6" maxlength="12000" rows="3" placeholder="Mô tả việc cần làm, phạm vi và điều kiện hoàn tất…"></textarea></label><div class="modal-grid-2"><label>Workspace<select name="workspaceId" required>${options}</select></label><label>Luồng<select name="workflow"><option value="codex-antigravity" ${hasBuild ? "selected" : "disabled"}>Pipeline · Kế hoạch → Triển khai → Review</option><option value="plan-only" ${hasBuild ? "" : "selected"} ${canPlanOnly ? "" : "disabled"}>Chỉ lập kế hoạch</option><option value="chat-only">Chat · một agent</option></select></label></div><div class="modal-grid-2"><label>Quyền<select name="permissionPreset"><option value="workspace-write" selected>Đọc và sửa workspace</option><option value="read-only">Chỉ đọc workspace</option><option value="full-access">Toàn quyền trên máy</option></select></label><label>Mục tiêu dài hạn<input name="goal" maxlength="2000" placeholder="Không bắt buộc"></label></div><div class="agent-role-grid task-role-grid">${workflowRoles.map((role) => roleEditor(role.id)).join("")}</div><div class="chat-agent-role" hidden>${chatAgentEditor()}</div><section class="task-skill-auto"><span class="task-skill-auto-icon">${icon("notebook-tabs", 16)}</span><div><strong>Tự chọn skill phù hợp</strong><small>OpenSybau tìm skill liên quan rồi gửi cho agent ở từng vai trò.</small></div><span class="task-skill-total">${view.skills.length} skill</span></section><label class="check-row"><input type="checkbox" name="isolated"><span><strong>Tách Git worktree riêng</strong><small>Cần repo có commit. Khi bật, kết quả ở worktree và không tự nhập vào thư mục hiện tại.</small></span></label><div class="form-note" id="isolation-note"></div>`;
  showModal("Task mới", body, "Tạo và chạy");
  syncWorkflow(); syncIsolation(); syncTaskPresetControls($(".modal"));
}
function syncWorkflow() {
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
function syncProviderModelControls(form, provider, modelSelector, effortSelector) {
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
  const effortsForModel = selectedModel?.efforts || [];
  const preferredEffort = (isHomeChat && view.homeChatEffort ? view.homeChatEffort : "") || effortSelect.value;
  const selectedEffort = effortsForModel.includes(preferredEffort) ? preferredEffort : (effortsForModel.includes("medium") ? "medium" : effortsForModel[0] || "");
  effortSelect.innerHTML = effortsForModel.map((effort) => `<option value="${esc(effort)}" ${effort === selectedEffort ? "selected" : ""}>${esc(effort)}</option>`).join("") || `<option value="">Không áp dụng</option>`;
  if (selectedEffort) effortSelect.value = selectedEffort;
  effortSelect.disabled = !effortsForModel.length;
}
function syncEffortForModel(form, modelSelector, effortSelector, providerSelector) {
  const modelId = form?.querySelector(modelSelector)?.value;
  const provider = form?.querySelector(providerSelector)?.value;
  const model = view.connectors?.[provider]?.models?.find((item) => item.id === modelId);
  const effortSelect = form?.querySelector(effortSelector);
  if (!effortSelect || !model) return;
  const options = model.efforts || [];
  const preferredEffort = effortSelect.value;
  const selectedEffort = options.includes(preferredEffort) ? preferredEffort : (options.includes("medium") ? "medium" : options[0] || "");
  effortSelect.innerHTML = options.map((effort) => `<option value="${esc(effort)}" ${effort === selectedEffort ? "selected" : ""}>${esc(effort)}</option>`).join("") || `<option value="">Không áp dụng</option>`;
  if (selectedEffort) effortSelect.value = selectedEffort;
  effortSelect.disabled = !options.length;
}
function syncRoleProvider(form, roleId) {
  const provider = form?.querySelector(`[data-role-provider="${roleId}"]`)?.value || "";
  syncProviderModelControls(form, provider, `[data-role-model="${roleId}"]`, `[data-role-effort="${roleId}"]`);
}
function syncChatAgentFields(form) {
  const provider = form?.querySelector("[data-chat-agent-provider]")?.value || "";
  syncProviderModelControls(form, provider, "[data-chat-agent-model]", "[data-chat-agent-effort]");
}
function syncIsolation() {
  const workspaceId = $(".modal select[name=workspaceId]")?.value;
  const workspace = view.state.workspaces.find((w) => w.id === workspaceId);
  const check = $(".modal input[name=isolated]"); const note = $("#isolation-note");
  if (!check || !workspace) return;
  const runtime = workspace.runtime;
  const canIsolate = runtime?.isGit && runtime?.head;
  check.disabled = !canIsolate;
  if (!canIsolate) { check.checked = false; note.textContent = "Workspace này chưa có commit Git; chạy tuần tự trên thư mục hiện tại."; }
  else note.textContent = runtime.dirty ? "Worktree mới bắt đầu từ commit hiện tại; thay đổi chưa commit ở workspace gốc không được sao chép." : `Worktree mới từ nhánh ${runtime.branch || "hiện tại"}.`;
}
function showWorkspaceModal() {
  const body = `<label>Đường dẫn thư mục trên máy<input name="path" required placeholder="D:\\Projects\\my-app" autocomplete="off" spellcheck="false" data-workspace-path></label><div class="form-note">Dán đường dẫn hoặc kéo thả một thư mục từ Explorer vào ô này. OpenSybau sẽ dùng đúng thư mục bạn chọn.</div>`;
  showModal("Thêm workspace", body, "Kiểm tra và thêm");
}
function sourceFolderRow(path, primary = false) {
  return `<div class="source-folder-row"><span>${icon("folder", 14)}</span><input name="sourceFolder" value="${esc(path)}" required autocomplete="off" spellcheck="false" placeholder="D:\\Projects\\another-app" aria-label="Đường dẫn thư mục nguồn"><button type="button" class="icon-button" data-action="remove-source-folder" title="${primary ? "Thư mục chính không thể gỡ" : "Gỡ thư mục này"}" aria-label="Gỡ thư mục này" ${primary ? "disabled" : ""}>${icon("x", 14)}</button></div>`;
}
function showEditProjectModal(workspace) {
  const folders = workspace.sourceFolders?.length ? workspace.sourceFolders : [workspace.path];
  const body = `<label>Tên dự án<input name="name" value="${esc(workspace.name)}" maxlength="100" required autocomplete="off" spellcheck="false"></label><section class="project-sources"><strong>Thư mục nguồn</strong><div class="source-folder-list">${folders.map((path) => sourceFolderRow(path, path.toLowerCase() === workspace.path.toLowerCase())).join("")}</div><button type="button" class="button quiet small" data-action="add-source-folder">${icon("folder-plus", 14)} Thêm thư mục</button><p class="form-note">Task thường có quyền đọc/ghi các thư mục nguồn. Task tách worktree chỉ dùng workspace chính.</p></section>`;
  showModal("Sửa dự án", body, "Lưu thay đổi", "workspace-edit");
  $(".modal").dataset.id = workspace.id;
}
function showProjectSectionModal(workspace) {
  const sections = [...new Set(view.state.workspaces.map((item) => item.section || "Projects"))];
  const options = sections.map((section) => `<option value="${esc(section)}">`).join("");
  const body = `<label>Tên section<input name="section" value="${esc(workspace.section || "Projects")}" maxlength="60" list="project-section-options" required autocomplete="off" spellcheck="false" placeholder="Projects"><datalist id="project-section-options">${options}</datalist></label><p class="form-note">Chọn section có sẵn hoặc nhập tên mới để tạo.</p>`;
  showModal("Chuyển section", body, "Lưu section", "workspace-section");
  $(".modal").dataset.id = workspace.id;
}
function showMemoryModal() {
  const options = '<option value="all">Dùng chung</option>' + view.state.workspaces.map((w) => '<option value="' + esc(w.id) + '">' + esc(w.name) + '</option>').join("");
  const body = '<label>Tên ghi nhớ<input name="title" maxlength="120" required autocomplete="off" spellcheck="false" placeholder="Ví dụ: Cách chạy kiểm thử dự án"></label>' + contentFileImportField("content") + '<label>Nội dung<textarea name="content" maxlength="5000" rows="4" required placeholder="Một ghi chú đã kiểm chứng, hữu ích cho các task sau"></textarea></label><label>Phạm vi<select name="workspaceId">' + options + '</select></label><div class="form-note">Mỗi task chỉ nạp tối đa 3 ghi chú có từ khóa khớp yêu cầu.</div>';
  showModal("Ghi nhớ mới", body, "Lưu ghi nhớ");
}
function renderDiffStudioModal() {
  const data = view.diffStudioData;
  if (!data) return;
  const prevHunkScroll = document.querySelector("#overlay .diff-hunk-list")?.scrollTop || 0;
  const prevFileScroll = document.querySelector("#overlay .diff-file-list")?.scrollTop || 0;
  const taskId = view.diffStudioTaskId || view.selected || "";
  const files = data.files || [];
  const annotations = view.diffAnnotations?.[taskId] || [];
  const annotationMap = new Map();
  const fileCommentCounts = new Map();
  for (const ann of annotations) {
    const p = ann.path || "";
    fileCommentCounts.set(p, (fileCommentCounts.get(p) || 0) + 1);
    const sideKey = `${p}::${ann.side || "any"}::${ann.line}`;
    const list = annotationMap.get(sideKey);
    if (list) list.push(ann);
    else annotationMap.set(sideKey, [ann]);
  }
  const totalAdd = files.reduce((sum, f) => sum + (f.additions || 0), 0);
  const totalDel = files.reduce((sum, f) => sum + (f.deletions || 0), 0);
  const selectedFile = files.find((f) => f.path === view.diffSelectedFile) || files[0] || null;
  if (selectedFile && view.diffSelectedFile !== selectedFile.path) view.diffSelectedFile = selectedFile.path;
  const wt = data.worktree;
  const canApplyWt = Boolean(wt && !wt.cleaned && !wt.appliedAt && files.length > 0 && taskId);
  const canDiscardWt = Boolean(wt && !wt.cleaned && !wt.appliedAt && taskId);

  const toolbarHtml = `<div class="diff-studio-toolbar">
    <div class="diff-location">
      <small>${wt ? `WORKTREE · ${esc(wt.branch || "isolated")}` : "THƯ MỤC"}</small>
      <code>${esc(data.path || "")}</code>
      ${files.length ? `<span class="diff-totals"><em class="is-add">+${totalAdd}</em><em class="is-del">-${totalDel}</em> · ${files.length} tệp</span>` : ""}
    </div>
    <div class="diff-studio-actions">
      ${wt?.appliedAt ? `<span class="chat-worktree-chip is-merged">${icon("check", 12)} Đã gộp vào nhánh chính</span>` : ""}
      ${canApplyWt ? `<button type="button" class="button primary small" data-action="apply-worktree" data-id="${esc(taskId)}">${icon("check", 13)}<span>Gộp Worktree vào dự án</span></button>` : ""}
      ${canDiscardWt ? `<button type="button" class="button quiet small" data-action="discard-worktree" data-id="${esc(taskId)}">${icon("delete", 13)}<span>Hủy Worktree</span></button>` : ""}
    </div>
  </div>`;

  let contentHtml = "";
  if (!files.length) {
    const rawDiff = String(data.diff || "Không có thay đổi được Git theo dõi.");
    const formattedLines = rawDiff.split(/\r?\n/).map((line) => {
      const cls = line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ") ? "diff-line diff-line-meta" : line.startsWith("@@") ? "diff-line diff-line-hunk" : line.startsWith("+") ? "diff-line diff-line-add" : line.startsWith("-") ? "diff-line diff-line-del" : "diff-line";
      return `<span class="${cls}">${esc(line) || " "}</span>`;
    }).join("\n");
    contentHtml = data.diff ? `<pre class="diff-content">${formattedLines}</pre>` : `<p class="diff-empty-state">Không có thay đổi được Git theo dõi.</p>`;
  } else {
    const sidebarHtml = files.map((file) => {
      const fileComments = fileCommentCounts.get(file.path) || 0;
      const statusChar = file.status === "added" ? "A" : file.status === "deleted" ? "D" : file.status === "renamed" ? "R" : "M";
      return `<button type="button" class="diff-file-item ${file.path === selectedFile?.path ? "is-active" : ""}" data-action="select-diff-file" data-path="${esc(file.path)}" title="${esc(file.path)}">
        <span class="diff-file-status is-${esc(file.status || "modified")}">${statusChar}</span>
        <span class="diff-file-name">${esc(file.path)}</span>
        ${fileComments ? `<span class="diff-file-comment-count">${fileComments}</span>` : ""}
        <span class="diff-file-stats"><em class="is-add">+${file.additions}</em><em class="is-del">-${file.deletions}</em></span>
      </button>`;
    }).join("");

    const hunksHtml = (selectedFile?.hunks || []).map((hunk) => {
      const linesHtml = (hunk.lines || []).map((line, idx) => {
        const lineNo = line.newLine ?? line.oldLine ?? (idx + 1);
        const side = line.type === "del" ? "old" : "new";
        const lineKey = `${selectedFile.path}:${lineNo}:${line.type}`;
        const lineAnns = annotationMap.get(`${selectedFile.path}::${side}::${lineNo}`) || annotationMap.get(`${selectedFile.path}::any::${lineNo}`) || [];
        const isEditing = view.diffAnnotationTarget && view.diffAnnotationTarget.key === lineKey;
        const cls = line.type === "add" ? "diff-row-add" : line.type === "del" ? "diff-row-del" : "diff-row-ctx";
        const prefix = line.type === "add" ? "+" : line.type === "del" ? "-" : " ";
        return `<div class="diff-row-group">
          <div class="diff-row ${cls} diff-line-annotatable" data-action="open-diff-comment" data-key="${esc(lineKey)}" data-path="${esc(selectedFile.path)}" data-side="${side}" data-line="${esc(lineNo)}" data-code="${esc(line.text)}" title="Nhấn để thêm nhận xét review tại dòng ${lineNo}">
            <span class="diff-ln">${line.oldLine ?? ""}</span>
            <span class="diff-ln">${line.newLine ?? ""}</span>
            <span class="diff-sign">${prefix}<i class="diff-add-comment-icon">+</i></span>
            <code class="diff-code">${esc(line.text) || " "}</code>
          </div>
          ${lineAnns.map((ann) => `<div class="diff-inline-annotation">
            <div class="diff-annotation-head"><strong>Nhận xét dòng ${esc(ann.line)}</strong><button type="button" class="icon-button" data-action="remove-diff-comment" data-comment-id="${esc(ann.id)}" title="Xóa nhận xét">${icon("x", 13)}</button></div>
            <p>${esc(ann.comment)}</p>
          </div>`).join("")}
          ${isEditing ? `<div class="diff-inline-editor">
            <textarea data-diff-comment-input rows="2" placeholder="Nhập yêu cầu chỉnh sửa hoặc nhận xét cho dòng ${lineNo}…"></textarea>
            <div class="diff-inline-editor-actions">
              <button type="button" class="button quiet small" data-action="cancel-diff-comment">Hủy</button>
              <button type="button" class="button primary small" data-action="save-diff-comment">Lưu nhận xét</button>
            </div>
          </div>` : ""}
        </div>`;
      }).join("");
      return `<div class="diff-hunk-block"><div class="diff-hunk-header">${esc(hunk.header)}</div>${linesHtml}</div>`;
    }).join("");

    contentHtml = `<div class="diff-studio-layout">
      <aside class="diff-file-list" aria-label="Danh sách tệp thay đổi">${sidebarHtml}</aside>
      <section class="diff-viewer-pane">
        <header class="diff-viewer-head">
          <strong>${esc(selectedFile?.path || "")}</strong>
          <small>Nhấn vào dòng bất kỳ để gắn nhận xét cho Agent sửa</small>
        </header>
        <div class="diff-hunk-list">${hunksHtml || `<p class="diff-empty-file">Tệp nhị phân hoặc không có dòng thay đổi văn bản.</p>`}</div>
      </section>
    </div>`;
  }

  const body = `${toolbarHtml}${contentHtml}`;
  showModal("Diff Review Studio", body, "Đóng", "dismiss");
  const modal = $("#overlay .modal");
  modal?.classList.add("diff-studio-modal");
  modal?.classList.toggle("is-empty", !files.length && !data.diff);
  if (annotations.length && taskId) {
    const footer = $("#overlay .modal-actions");
    footer?.insertAdjacentHTML("afterbegin", `<button type="button" class="button primary" data-action="submit-diff-review" data-id="${esc(taskId)}">${icon("arrow-up-right", 14)} Gửi ${annotations.length} nhận xét cho Agent sửa</button>`);
  }
  const nextHunkList = document.querySelector("#overlay .diff-hunk-list");
  if (nextHunkList && prevHunkScroll) nextHunkList.scrollTop = prevHunkScroll;
  const nextFileList = document.querySelector("#overlay .diff-file-list");
  if (nextFileList && prevFileScroll) nextFileList.scrollTop = prevFileScroll;
  $("[data-diff-comment-input]")?.focus();
}
function showDiffModal(data, taskId = view.selected, preferredFile = "") {
  view.diffStudioData = data;
  view.diffStudioTaskId = taskId || view.selected || "";
  const files = data?.files || [];
  view.diffSelectedFile = preferredFile && files.some((f) => f.path === preferredFile) ? preferredFile : (files[0]?.path || "");
  view.diffAnnotationTarget = null;
  renderDiffStudioModal();
}
async function openArenaCompareModal(fanoutId) {
  const siblings = (view.state?.tasks || []).filter((item) => item.fanoutId === fanoutId && !item.archived);
  if (!siblings.length) return;
  showModal("Đa luồng Agent · Đang tải Diff…", `<p class="form-note">Đang thu thập kết quả và diff từ ${siblings.length} Git worktree…</p>`, "Đóng", "dismiss");
  const diffs = await Promise.all(siblings.map((t) => api(`/api/tasks/${encodeURIComponent(t.id)}/diff`).catch(() => ({ files: [], diff: "" }))));
  const cardsHtml = siblings.map((item, idx) => {
    const diffData = diffs[idx] || { files: [] };
    const files = diffData.files || [];
    const adds = files.reduce((s, f) => s + (f.additions || 0), 0);
    const dels = files.reduce((s, f) => s + (f.deletions || 0), 0);
    const modelName = item.fanoutCompetitor?.model || item.config?.roles?.build?.model || item.config?.chatModel || "";
    const rawName = item.fanoutCompetitor?.name || providerTitle(view.connectors, item.config?.roles?.build?.provider || item.config?.chatProvider || "codex");
    const compName = modelName && rawName.endsWith(` (${modelName})`) ? rawName.slice(0, -modelName.length - 3) : rawName;
    const tok = Object.values(item.usage || {}).reduce((s, u) => s + tokenCount(u), 0);
    const summaryText = String(item.implementation || item.review || item.plan || item.chatMessages?.filter((m) => m.role === "assistant").at(-1)?.content || "").slice(0, 800);
    const emptySummary = item.status === "failed" ? "Lượt chạy thất bại. Mở chat để xem nguyên nhân." : ["running", "queued"].includes(item.status) ? "Agent đang xử lý, kết quả sẽ xuất hiện khi hoàn tất." : "Chưa có nội dung trả lời.";
    const canPick = Boolean(item.isolated && !["running", "queued"].includes(item.status) && !item.worktreeCleaned && !item.worktreeAppliedAt && files.length > 0);
    return `<article class="arena-compare-card ${item.worktreeAppliedAt ? "is-winner" : ""}">
      <header>
        <div class="arena-compare-identity"><h3>${esc(compName)}</h3>${modelName && modelName !== compName ? `<p>${esc(modelName)}</p>` : ""}</div>
        <span class="arena-compare-status is-${esc(item.status)}"><i class="wb-task-dot is-${esc(item.status)}"></i>${esc(statuses[item.status] || item.status)}</span>
      </header>
      <dl class="arena-compare-stats"><div><dt>Tệp thay đổi</dt><dd>${formatNumber(files.length)}</dd></div><div><dt>Thêm / xoá</dt><dd><span class="is-add">+${formatNumber(adds)}</span> / <span class="is-del">−${formatNumber(dels)}</span></dd></div><div><dt>Token</dt><dd>${formatNumber(tok)}</dd></div></dl>
      <div class="arena-compare-excerpt ${summaryText ? "" : "is-empty"}">${summaryText ? renderMarkdown(summaryText) : `<p>${esc(emptySummary)}</p>`}</div>
      ${files.length ? `<ul class="arena-compare-files">${files.slice(0, 8).map((f) => `<li><code>${esc(f.path)}</code><span>+${f.additions} / −${f.deletions}</span></li>`).join("")}</ul>` : ""}
      <footer>
        <button type="button" class="button quiet small" data-action="show-diff" data-id="${esc(item.id)}">${icon("file", 13)} Xem Diff</button>
        <button type="button" class="button quiet small" data-task="${esc(item.id)}">Mở Chat</button>
        ${item.worktreeAppliedAt ? `<span class="arena-compare-merged">${icon("check", 12)} Đã gộp vào dự án</span>` : canPick ? `<button type="button" class="button primary small" data-action="pick-arena-winner" data-id="${esc(item.id)}">${icon("check", 13)} Chọn & Gộp vào dự án</button>` : ""}
      </footer>
    </article>`;
  }).join("");
  showModal("So sánh các nhánh song song", `<div class="arena-compare-grid">${cardsHtml}</div>`, "Đóng", "dismiss");
  $("#overlay .modal")?.classList.add("arena-compare-modal");
}
function closeOverlay() { $("#overlay").innerHTML = ""; }
function showToast(message) {
  const toast = $("#toast"); toast.textContent = translateText(message, view.language); toast.classList.add("visible");
  clearTimeout(view.toastTimer); view.toastTimer = setTimeout(() => toast.classList.remove("visible"), 3500);
}
function scanCliProviders(button, { openModal = false } = {}) {
  if (cliScanPromise) {
    showToast("Đang quét CLI, vui lòng đợi kết quả.");
    return cliScanPromise;
  }
  cliScanInProgress = true;
  const previousLabel = button?.innerHTML;
  if (button) {
    button.disabled = true;
    button.innerHTML = `${icon("refresh-cw", 13)} Đang quét...`;
  }
  showToast("Đang quét Codex, Antigravity và Claude Code...");
  cliScanPromise = (async () => {
    try {
      view.connectors = await api("/api/connectors?refresh=1");
      cliScanInProgress = false;
      await refresh();
      if (openModal) showCliProviderModal();
      showToast("Đã quét lại Codex, Antigravity và Claude Code trên máy chạy OpenSybau.");
    } catch (error) {
      cliScanInProgress = false;
      render();
      showToast(`Quét CLI thất bại: ${error.message}`);
    } finally {
      cliScanInProgress = false;
      cliScanPromise = null;
      if (button?.isConnected) {
        button.disabled = false;
        button.innerHTML = previousLabel;
      }
    }
  })();
  return cliScanPromise;
}
async function handleSubmit(event) {
  const form = event.target.closest("[data-modal]");
  if (!form) return;
  event.preventDefault();
  const isTaskChat = form.dataset.form === "task-chat";
  if (form.dataset.submitting === "true" || (view.busy && !isTaskChat)) return;
  if (form.dataset.form === "home-task" && !view.state?.workspaces?.length) { showWorkspaceModal(); showToast("Chọn thư mục dự án (Workspace) trước khi bắt đầu."); return; }
  if (!isTaskChat) view.busy = true;
  if (isTaskChat) form.dataset.submitting = "true";
  const submit = $("[type=submit]", form); const isIconSubmit = Boolean(submit?.classList.contains("home-submit") || submit?.classList.contains("chat-send-button")); if (submit) { submit.disabled = true; if (!isIconSubmit) submit.textContent = "Đang xử lý…"; }
  const data = new FormData(form); const object = Object.fromEntries(data.entries());
  try {
    if (["home-task", "task-chat"].includes(form.dataset.form)) {
      const field = form.dataset.form === "task-chat" ? "message" : "prompt";
      const typedText = String(object[field] || "").trim();
      const attachments = view.composerAttachments?.[composerAttachmentKey(form)] || [];
      if (typedText.length < 6 && !attachments.length) throw new Error("Nhập ít nhất 6 ký tự hoặc đính kèm tệp trước khi gửi.");
      object.attachments = await readComposerAttachments(form);
    }
    if (form.dataset.form === "workspace") {
      await api("/api/workspaces", { method: "POST", body: JSON.stringify({ path: object.path }) });
      showToast("Đã kiểm tra và thêm workspace thật.");
    } else if (form.dataset.form === "workspace-edit") {
      const sourceFolders = data.getAll("sourceFolder").map((path) => String(path).trim()).filter(Boolean);
      await api(`/api/workspaces/${encodeURIComponent(form.dataset.id)}`, { method: "PATCH", body: JSON.stringify({ name: object.name, sourceFolders }) });
      view.projectMenuId = "";
      showToast("Đã cập nhật tên và thư mục nguồn của dự án.");
    } else if (form.dataset.form === "workspace-section") {
      await api(`/api/workspaces/${encodeURIComponent(form.dataset.id)}`, { method: "PATCH", body: JSON.stringify({ section: object.section }) });
      view.projectMenuId = "";
      showToast("Đã chuyển dự án sang section.");
    } else if (form.dataset.form === "task-rename") {
      await api(`/api/tasks/${encodeURIComponent(form.dataset.id)}`, { method: "PATCH", body: JSON.stringify({ title: object.title }) });
      view.taskMenuId = "";
      showToast("Đã đổi tên chat.");
    } else if (form.dataset.form === "task") {
      const { taskPresetVersion, taskPresetName, appliedPresetId, appliedPresetVersion, ...taskInput } = object;
      const presetRef = appliedPresetId && appliedPresetVersion ? { id: appliedPresetId, version: Number(appliedPresetVersion) } : null;
      const task = await api("/api/tasks", { method: "POST", body: JSON.stringify({ ...taskInput, ...(presetRef ? { presetRef } : {}), isolated: data.has("isolated") }) });
      view.selected = task.task.id; view.page = "chat"; view.chatProvider = task.task.config.chatProvider || task.task.config.roles?.plan?.provider || "codex"; view.chatModel = task.task.config.workflow === "chat-only" ? task.task.config.chatModel : task.task.config.roles?.plan?.model || ""; view.chatEffort = task.task.config.workflow === "chat-only" ? task.task.config.chatEffort : task.task.config.roles?.plan?.effort || ""; view.chatDraft = ""; showToast("Task thật đã vào hàng đợi.");
    } else if (form.dataset.form === "home-task") {
      if (view.homeMode === "arena") {
        const slots = ensureHomeArenaSlots();
        const competitors = slots.map((slot, idx) => ({
          provider: slot.provider,
          model: slot.model,
          effort: slot.effort,
          label: `#${idx + 1} ${providerTitle(view.connectors, slot.provider)}${slot.model ? ` (${slot.model})` : ""}`,
        }));
        const rawPerm = view.homePermissionPreset || object.permissionPreset || "workspace-write";
        const permissionPreset = rawPerm === "read-only" ? "workspace-write" : rawPerm;
        const result = await api("/api/tasks/fanout", {
          method: "POST",
          body: JSON.stringify({
            workspaceId: object.workspaceId || view.homeWorkspaceId || view.state.workspaces[0]?.id,
            prompt: String(object.prompt || "").trim(),
            attachments: object.attachments,
            permissionPreset,
            workflow: "codex-antigravity",
            competitors,
          }),
        });
        const firstTask = result.tasks?.[0];
        if (firstTask) {
          view.selected = firstTask.id;
          view.page = "chat";
          view.chatDraft = "";
          const liveInput = form.querySelector("textarea[name=prompt], textarea[name=message]");
          if (liveInput) { liveInput.value = ""; resizeComposerTextarea(liveInput); }
          clearComposerAttachments(form);
        }
        showToast(`Đã khởi chạy Đa luồng với ${result.tasks?.length || competitors.length} nhánh Git worktree song song!`);
      } else {
        const workflow = object.workflow || view.homeWorkflow || "chat-only";
        const isSplitForm = form.dataset.splitChatCreate === "true";
        const chatSelection = normalizedChatSelection({
          provider: (!isSplitForm && view.homeChatProvider) || object.chatProvider,
          model: (!isSplitForm && view.homeChatModel) || object.chatModel,
          effort: (!isSplitForm && view.homeChatEffort) || object.chatEffort,
        });
        const payload = {
          ...object,
          chatProvider: object.chatProvider || chatSelection.provider,
          chatModel: (!isSplitForm && view.homeChatModel && (!object.chatProvider || object.chatProvider === view.homeChatProvider)) ? view.homeChatModel : (object.chatModel || chatSelection.model?.id || ""),
          chatEffort: (!isSplitForm && view.homeChatEffort && (!object.chatProvider || object.chatProvider === view.homeChatProvider)) ? view.homeChatEffort : (object.chatEffort || chatSelection.effort || ""),
          workspaceId: view.chatSplitReturnWorkspaceId || object.workspaceId || view.homeWorkspaceId || view.state.workspaces[0]?.id,
          prompt: String(object.prompt || "").trim(),
          workflow,
          isolated: Boolean(view.chatSplitReturnWorkspaceId) || data.has("isolated") || Boolean(view.homeIsolated),
          permissionPreset: view.homePermissionPreset || object.permissionPreset || "workspace-write",
        };
        const task = await api("/api/tasks", { method: "POST", body: JSON.stringify(payload) });
        const splitWorkspaceId = view.chatSplitReturnWorkspaceId;
        const returnToSplit = Boolean(splitWorkspaceId && (splitWorkspaceId === task.task.workspaceId || form.dataset.splitChatCreate === "true"));
        const resolvedProvider = workflow === "chat-only" ? task.task.config.chatProvider : task.task.config.roles?.plan?.provider || task.task.config.chatProvider || "codex";
        const resolvedModel = workflow === "chat-only" ? task.task.config.chatModel : task.task.config.roles?.plan?.model || task.task.config.chatModel || "";
        const resolvedEffort = workflow === "chat-only" ? task.task.config.chatEffort : task.task.config.roles?.plan?.effort || task.task.config.chatEffort || "";
        view.selected = task.task.id; view.page = "chat"; view.chatProvider = resolvedProvider; view.chatModel = resolvedModel; view.chatEffort = resolvedEffort; view.homeChatProvider = resolvedProvider; view.homeChatModel = resolvedModel; view.homeChatEffort = resolvedEffort; view.chatDraft = "";
        const liveInput = form.querySelector("textarea[name=prompt], textarea[name=message]");
        if (liveInput) { liveInput.value = ""; resizeComposerTextarea(liveInput); }
        clearComposerAttachments(form);
        if (returnToSplit) {
          view.state.tasks = [task.task, ...(view.state.tasks || []).filter((existing) => existing.id !== task.task.id)];
          view.chatSplitWorkspaceId = splitWorkspaceId;
          view.chatSplitTaskIds = [...new Set([...(view.chatSplitTaskIds || []), task.task.id])].slice(-4);
          view.chatSplitActiveTaskId = task.task.id;
          view.selected = null;
          view.chatSplitReturnWorkspaceId = "";
          view.chatSplitCreateOpen = false;
          view.chatSplitCreateDraft = "";
          view.chatSplitPickerOpen = false;
        }
        showToast(workflow === "chat-only" ? "Đã gửi tin nhắn cho agent." : "Task thật đã vào hàng đợi.");
      }
    } else if (form.dataset.form === "settings") {
      const roles = Object.fromEntries(workflowRoles.map((role) => [role.id, { provider: object[`${role.id}Provider`], model: object[`${role.id}Model`], effort: object[`${role.id}Effort`] }]));
      await api("/api/settings", { method: "POST", body: JSON.stringify({ defaults: { roles } }) });
      showToast("Đã lưu định tuyến agent mặc định trên máy.");
    } else if (form.dataset.form === "api-provider") {
      const id = form.dataset.id || apiProviderId(object.name);
      if (!id) throw new Error("Tên nguồn cần tạo được ID gồm chữ hoặc số.");
      await api(form.dataset.id ? `/api/providers/${encodeURIComponent(id)}` : "/api/providers", {
        method: form.dataset.id ? "PUT" : "POST",
        body: JSON.stringify({ ...object, ...(object.apiKeyRequired === undefined ? {} : { apiKeyRequired: object.apiKeyRequired === "true" }), id, clearApiKey: data.has("clearApiKey") }),
      });
      showToast("Đã lưu nguồn AI. API key chỉ được giữ trên máy này.");
    } else if (form.dataset.form === "task-chat") {
      view.forceChatScroll = true;
      const taskId = form.dataset.id;
      const splitSel = form.closest(".multi-chat-pane") ? view.chatSplitSelections?.[taskId] : null;
      const provider = splitSel?.provider || object.provider || view.chatProvider;
      const model = splitSel?.model || object.model || view.chatModel;
      const effort = splitSel?.effort || object.effort || view.chatEffort;
      if (!form.closest(".multi-chat-pane")) {
        view.chatProvider = provider;
        view.chatModel = model;
        view.chatEffort = effort;
        view.homeChatProvider = provider;
        view.homeChatModel = model;
        view.homeChatEffort = effort;
      }
      const targetTask = view.state?.tasks?.find((item) => item.id === taskId);
      if (targetTask?.config) {
        targetTask.config.chatProvider = provider;
        targetTask.config.chatModel = model;
        targetTask.config.chatEffort = effort;
      }
      const result = await api(`/api/tasks/${encodeURIComponent(taskId)}/chat`, { method: "POST", body: JSON.stringify({ message: object.message, attachments: object.attachments, provider, model, effort }) });
      view.chatDraft = "";
      if (view.chatSplitDrafts) delete view.chatSplitDrafts[taskId];
      const liveInput = form.querySelector("textarea[name=message], textarea[name=prompt]");
      if (liveInput) { liveInput.value = ""; resizeComposerTextarea(liveInput); }
      clearComposerAttachments(form);
      showToast(view.language === "en" ? `Added to chat queue · position ${result.queuedPosition || 1}.` : `Đã thêm vào hàng đợi chat · vị trí ${result.queuedPosition || 1}.`);
    } else if (form.dataset.form === "task-chat-config") {
      view.chatProvider = object.provider;
      view.chatModel = object.model;
      view.chatEffort = object.effort;
      showToast("Đã áp dụng agent và model cho tin nhắn tiếp theo.");
    } else if (form.dataset.form === "task-goal") {
      const checklist = String(object.checklist || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      await api("/api/tasks/" + encodeURIComponent(form.dataset.id) + "/goal", { method: "POST", body: JSON.stringify({ goal: object.goal, checklist }) });
      showToast("Đã lưu mục tiêu và checklist cho các lượt chat tiếp theo.");
    } else if (form.dataset.form === "task-permissions") {
      await api("/api/tasks/" + encodeURIComponent(form.dataset.id), { method: "PATCH", body: JSON.stringify({ permissionPreset: object.permissionPreset }) });
      showToast("Đã cập nhật preset quyền của task.");
    } else if (form.dataset.form === "memory") {
      await api("/api/memory", { method: "POST", body: JSON.stringify(object) }); showToast("Đã lưu ghi nhớ trên máy.");
    } else if (form.dataset.form === "skill-create") {
      await api("/api/skills", { method: "POST", body: JSON.stringify(object) });
      view.skillsLoaded = false; view.page = "skills"; showToast("Đã tạo skill trên máy.");
    } else if (form.dataset.form === "skill-edit") {
      await api(`/api/skills/${encodeURIComponent(form.dataset.id)}`, { method: "PATCH", body: JSON.stringify({ content: object.content }) });
      view.skillsLoaded = false; view.page = "skills"; showToast("Đã cập nhật SKILL.md.");
    } else if (form.dataset.form === "vault") {
      await api("/api/settings", { method: "POST", body: JSON.stringify({ vaultPath: object.vaultPath }) });
      view.page = "knowledge"; view.vaultDir = ""; view.vaultPreview = null; showToast("Đã kết nối Obsidian vault.");
    } else if (form.dataset.form === "vault-note-create") {
      const created = await api("/api/vault/file", { method: "POST", body: JSON.stringify({ path: object.notePath, content: object.content, createOnly: true }) });
      $("#overlay").innerHTML = "";
      view.page = "knowledge";
      const folder = created.path.includes("/") ? created.path.slice(0, created.path.lastIndexOf("/")) : "";
      await loadVaultDir(folder, { keepPreview: true });
      view.vaultPreview = created;
      view.vaultEditing = false;
      view.vaultEditingPath = "";
      render();
      showToast("Đã tạo ghi chú tri thức mới.");
      return;
    } else if (form.dataset.form === "dismiss") {
      // Informational modal; its primary action only closes the dialog.
    } else {
      return;
    }
    $("#overlay").innerHTML = "";
    if (form.dataset.splitChatCreate === "true") render();
    else await refresh({ configuration: form.dataset.form === "api-provider" });
    if (view.page === "knowledge" && view.state.settings.vaultPath) await loadVaultDir("");
    if (view.page === "skills" && !view.skillsLoaded) {
      const result = await api("/api/skills"); view.skills = result.skills || []; view.skillsLoaded = true; render();
    }
  } catch (error) { if (form.dataset.form === "task-chat") view.forceChatScroll = false; showToast(error.message); if (submit) { submit.disabled = false; if (!isIconSubmit) submit.textContent = "Thử lại"; } }
  finally { if (isTaskChat) delete form.dataset.submitting; else view.busy = false; }
}
async function handleWorkbenchClick(event) {
  const clickedPop = event.target.closest?.(".codex-pop-menu, .composer-add");
  document.querySelectorAll(".codex-pop-menu[open], .composer-add[open]").forEach((menu) => { if (menu !== clickedPop) menu.open = false; });
  const popSummary = event.target.closest?.(".codex-pop-menu > summary");
  if (popSummary) {
    const menu = popSummary.parentElement;
    if (menu.closest(".codex-rail-bar, .home-composer-controls, .chat-composer-controls")) {
      menu.classList.add("is-up");
      menu.classList.remove("is-down");
    } else if (!menu.matches(".agent-role-picker[data-role-field='model']") && !menu.querySelector(".codex-pop-card.is-effort-list")) {
      menu.classList.add("is-down");
      menu.classList.remove("is-up");
    }
    requestAnimationFrame(() => {
      const scroller = menu.querySelector(".codex-pop-scroll");
      const selected = scroller?.querySelector(".codex-pop-item.is-selected, [aria-selected='true']");
      if (!scroller || !selected) return;
      const itemTop = selected.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const itemBottom = itemTop + selected.offsetHeight;
      if (itemTop < scroller.scrollTop) scroller.scrollTop = itemTop;
      else if (itemBottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = itemBottom - scroller.clientHeight;
    });
  }
  const rolePickerSummary = event.target.closest?.(".agent-role-picker[data-role-field='model'] > summary");
  if (rolePickerSummary) {
    const menu = rolePickerSummary.parentElement;
    let triggerRect = rolePickerSummary.getBoundingClientRect();
    let clipBounds = { top: 0, bottom: window.innerHeight };
    let scrollContainer = null;
    for (let parent = menu.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const overflowY = getComputedStyle(parent).overflowY;
      if (["auto", "scroll"].includes(overflowY) && parent.scrollHeight > parent.clientHeight) {
        scrollContainer = parent;
        const bounds = parent.getBoundingClientRect();
        clipBounds = { top: Math.max(0, bounds.top), bottom: Math.min(window.innerHeight, bounds.bottom) };
        break;
      }
    }
    const optionCount = menu.querySelectorAll(".codex-pop-item").length;
    const hasGroup = Boolean(menu.querySelector("[data-role-picker-group]"));
    const fullHeight = Math.min(236, optionCount * 33 + (hasGroup ? 23 : 0)) + 52;
    let spaceBelow = Math.max(0, clipBounds.bottom - triggerRect.bottom - 10);
    const preferredDownSpace = Math.min(fullHeight, 212);
    if (spaceBelow < preferredDownSpace && scrollContainer) {
      const remainingScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop;
      const scrollBy = Math.min(preferredDownSpace - spaceBelow, Math.max(0, remainingScroll));
      if (scrollBy > 0) {
        scrollContainer.scrollTop += scrollBy;
        triggerRect = rolePickerSummary.getBoundingClientRect();
        const bounds = scrollContainer.getBoundingClientRect();
        clipBounds = { top: Math.max(0, bounds.top), bottom: Math.min(window.innerHeight, bounds.bottom) };
        spaceBelow = Math.max(0, clipBounds.bottom - triggerRect.bottom - 10);
      }
    }
    const spaceAbove = Math.max(0, triggerRect.top - clipBounds.top - 10);
    const opensDown = spaceBelow >= preferredDownSpace || spaceBelow >= spaceAbove;
    const availableSpace = opensDown ? spaceBelow : spaceAbove;
    const listHeight = Math.max(64, Math.min(236, availableSpace - 52));
    menu.classList.toggle("is-down", opensDown);
    menu.classList.toggle("is-up", !opensDown);
    menu.style.setProperty("--role-picker-list-height", `${listHeight}px`);
  }
  const htmlCommentSummary = event.target.closest?.(".orca-el-model-bar .codex-pop-menu > summary");
  if (htmlCommentSummary) positionHtmlCommentMenu(htmlCommentSummary.parentElement);
  if (event.target.matches?.(".home-config-backdrop")) { view.homeConfigOpen = false; render(); return; }
  if (event.target.matches?.(".task-chat-config-backdrop")) { view.chatConfigOpen = false; render(); return; }
  const page = event.target.closest("[data-page]");
  if (page) {
    event.preventDefault(); closeOverlay(); view.projectMenuId = ""; view.page = page.dataset.page; if (view.page !== "chat" && view.page !== "workspaces") view.selected = null; view.filePreview = null; render();
    if (view.page === "settings") void refresh({ configuration: true });
    try {
      if (view.page === "knowledge" && view.state.settings.vaultPath) await loadVaultDir("");
      if (view.page === "skills") { const result = await api("/api/skills"); view.skills = result.skills || []; view.skillsLoaded = true; render(); }
    } catch (error) { showToast(error.message); }
    return;
  }
  const task = event.target.closest("[data-task]");
  if (task) {
    const selectedTask = view.state.tasks.find((item) => item.id === task.dataset.task);
    clearSidebarSearch();
    view.selected = task.dataset.task; view.page = "chat"; view.projectMenuId = ""; view.taskMenuId = "";
    if (!view.stageSplit) view.activeStageTabId = "chat";
    view.homeWorkspaceId = selectedTask?.workspaceId || view.homeWorkspaceId;
    view.chatProvider = selectedTask?.config.workflow === "chat-only" ? selectedTask.config.chatProvider || "codex" : selectedTask?.config?.chatProvider || roleConfig(selectedTask?.config, "plan").provider || "codex";
    view.chatModel = selectedTask?.config.workflow === "chat-only" ? selectedTask.config.chatModel || "" : selectedTask?.config?.chatModel || roleConfig(selectedTask?.config, "plan").model || "";
    view.chatEffort = selectedTask?.config.workflow === "chat-only" ? selectedTask.config.chatEffort || "" : selectedTask?.config?.chatEffort || roleConfig(selectedTask?.config, "plan").effort || "";
    view.chatDraft = ""; render(); return;
  }
  const homeMode = event.target.closest("[data-home-mode]");
  if (homeMode) {
    homeMode.closest(".home-mode-picker")?.removeAttribute("open");
    view.homeMode = homeMode.dataset.homeMode;
    if (view.homeMode === "chat") view.homeWorkflow = "chat-only";
    if (view.homeMode === "plan") view.homeWorkflow = "plan-only";
    if (view.homeMode === "code") view.homeWorkflow = "codex-antigravity";
    render();
    if (view.homeMode === "chat") $("[data-home-prompt]")?.focus({ preventScroll: true });
    return;
  }
  const workspace = event.target.closest("[data-workspace]");
  if (workspace) { clearSidebarSearch(); await loadWorkspaceDir(workspace.dataset.workspace, "").catch((error) => showToast(error.message)); return; }
  const filter = event.target.closest("[data-filter]");
  if (filter) { view.filter = filter.dataset.filter; render(); return; }
  const button = event.target.closest("[data-action]");
  if (!button) {
    if (view.projectMenuId && !event.target.closest(".wb-project-group")) { view.projectMenuId = ""; render(); }
    if (view.taskMenuId && !event.target.closest(".wb-task-item")) { view.taskMenuId = ""; render(); }
    return;
  }
  const action = button.dataset.action; const id = button.dataset.id;
  button.closest(".codex-pop-menu")?.removeAttribute("open");
  if (action === "jump-chat-answer") {
    const pane = button.closest(".conversation-chat-pane");
    const taskId = pane?.querySelector(".chat-thread")?.dataset.taskId;
    const answerId = taskId && pane.closest(".multi-chat-pane") ? `chat-answer-${taskId}-${Number(button.dataset.answerIndex)}` : `chat-answer-${Number(button.dataset.answerIndex)}`;
    const answer = $(`#${CSS.escape(answerId)}`, pane || document);
    answer?.scrollIntoView({ behavior: "smooth", block: "start" });
    button.closest(".chat-outline-nav")?.classList.remove("is-open");
    $(".wb-mobile-outline-toggle")?.setAttribute("aria-expanded", "false");
    return;
  }
  if (action === "toggle-chat-outline") {
    const nav = button.closest(".chat-outline-nav") || $(".chat-outline-nav");
    const isOpen = nav?.classList.toggle("is-open");
    button.setAttribute("aria-expanded", String(Boolean(isOpen)));
    return;
  }
  if (action === "pick-home-select") {
    const select = button.closest("label")?.querySelector("select");
    const value = button.dataset.value || "";
    if (select && !select.disabled && [...select.options].some((option) => option.value === value && !option.disabled)) {
      select.value = value;
      const picker = button.closest("details");
      const label = button.querySelector(".codex-pop-item-main span")?.textContent || "";
      const trigger = picker?.querySelector("summary");
      if (trigger && label) {
        trigger.querySelector("span")?.replaceChildren(document.createTextNode(label));
        trigger.setAttribute("aria-label", `${button.closest("label")?.childNodes[0]?.textContent?.trim() || "Chọn"}: ${label}`);
        picker.querySelectorAll(".codex-pop-item").forEach((item) => {
          const isSelected = item === button;
          item.classList.toggle("is-selected", isSelected);
          item.querySelector("svg")?.remove();
          if (isSelected) item.insertAdjacentHTML("beforeend", icon("check", 13));
        });
      }
      picker?.removeAttribute("open");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return;
  }
  if (action === "pick-home-workspace") {
    view.homeWorkspaceId = id;
    render();
    return;
  }
  if (action === "pick-role-option") {
    const roleId = button.dataset.roleId;
    const field = button.dataset.roleField;
    const form = button.closest("form");
    const select = form?.querySelector(`[data-role-${field}="${roleId}"]`);
    const value = button.dataset.value || "";
    if (select && !select.disabled && [...select.options].some((option) => option.value === value)) {
      select.value = value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return;
  }
  if (action === "pick-home-agent") {
    const [prov, mod] = String(button.dataset.agent || "").split("::");
    if (prov) {
      view.homeChatProvider = prov;
      view.homeChatModel = mod || "";
      const conn = view.connectors?.[prov];
      const modelObj = conn?.models?.find((m) => m.id === mod) || conn?.models?.[0];
      const nextEffort = modelObj?.efforts?.includes(view.homeChatEffort)
        ? view.homeChatEffort
        : (modelObj?.efforts?.includes("medium") ? "medium" : modelObj?.efforts?.[0] || "medium");
      view.homeChatEffort = nextEffort;
      view.chatProvider = prov;
      view.chatModel = mod || "";
      view.chatEffort = nextEffort;
      if (view.homeRoles) {
        view.homeRoles.plan = { provider: prov, model: mod || "", effort: nextEffort };
        view.homeRoles.build = { provider: prov, model: mod || "", effort: nextEffort };
        view.homeRoles.review = { provider: prov, model: mod || "", effort: nextEffort };
      }
      render();
    }
    return;
  }
  if (action === "pick-home-effort") {
    const nextEffort = button.dataset.effort || "medium";
    view.homeChatEffort = nextEffort;
    view.chatEffort = nextEffort;
    if (view.homeRoles) {
      if (view.homeRoles.plan) view.homeRoles.plan.effort = nextEffort;
      if (view.homeRoles.build) view.homeRoles.build.effort = nextEffort;
      if (view.homeRoles.review) view.homeRoles.review.effort = nextEffort;
    }
    render();
    return;
  }
  if (action === "pick-task-chat-agent") {
    const [prov, mod] = String(button.dataset.agent || "").split("::");
    if (prov) {
      const taskId = button.dataset.id || button.closest("form")?.dataset.id;
      const targetTask = taskId ? view.state?.tasks?.find((item) => item.id === taskId) : null;
      if (button.closest(".multi-chat-pane") && taskId) {
        view.chatSplitSelections ||= {};
        const current = view.chatSplitSelections[taskId] || {};
        const conn = view.connectors?.[prov];
        const modelObj = conn?.models?.find((m) => m.id === mod) || conn?.models?.[0];
        const effort = modelObj?.efforts?.includes(current.effort) ? current.effort : (modelObj?.efforts?.includes("medium") ? "medium" : modelObj?.efforts?.[0] || "medium");
        view.chatSplitSelections[taskId] = { provider: prov, model: mod || "", effort };
        if (targetTask?.config) {
          targetTask.config.chatProvider = prov;
          targetTask.config.chatModel = mod || "";
          targetTask.config.chatEffort = effort;
        }
        render();
        return;
      }
      view.chatProvider = prov;
      view.chatModel = mod || "";
      const conn = view.connectors?.[prov];
      const modelObj = conn?.models?.find((m) => m.id === mod) || conn?.models?.[0];
      view.chatEffort = modelObj?.efforts?.includes(view.chatEffort)
        ? view.chatEffort
        : (modelObj?.efforts?.includes("medium") ? "medium" : modelObj?.efforts?.[0] || "medium");
      view.homeChatProvider = prov;
      view.homeChatModel = mod || "";
      view.homeChatEffort = view.chatEffort;
      if (targetTask?.config) {
        targetTask.config.chatProvider = prov;
        targetTask.config.chatModel = mod || "";
        targetTask.config.chatEffort = view.chatEffort;
      }
      render();
    }
    return;
  }
  if (action === "pick-task-chat-effort") {
    const taskId = button.dataset.id || button.closest("form")?.dataset.id;
    const targetTask = taskId ? view.state?.tasks?.find((item) => item.id === taskId) : null;
    const nextEffort = button.dataset.effort || "medium";
    if (button.closest(".multi-chat-pane") && taskId) {
      view.chatSplitSelections ||= {};
      const current = view.chatSplitSelections[taskId] || {};
      view.chatSplitSelections[taskId] = { ...current, effort: nextEffort };
      if (targetTask?.config) targetTask.config.chatEffort = nextEffort;
      render();
      return;
    }
    view.chatEffort = nextEffort;
    view.homeChatEffort = nextEffort;
    if (targetTask?.config) targetTask.config.chatEffort = nextEffort;
    render();
    return;
  }
  if (action === "toggle-home-isolated") {
    view.homeIsolated = !view.homeIsolated;
    render();
    return;
  }
  if (action === "pick-home-permission") {
    const next = button.dataset.permission || "workspace-write";
    view.homePermissionPreset = next;
    render();
    return;
  }
  if (action === "pick-task-permission") {
    const next = button.dataset.permission || "workspace-write";
    if (id) {
      const targetTask = view.state?.tasks?.find((item) => item.id === id);
      if (targetTask) targetTask.permissionPreset = next;
      render();
      void api(`/api/tasks/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ permissionPreset: next }) })
        .then(() => refresh())
        .catch((error) => showToast(error.message));
    }
    return;
  }
  if (action === "cycle-home-permission") {
    const order = ["workspace-write", "full-access", "read-only"];
    const curr = view.homePermissionPreset || "workspace-write";
    const next = order[(order.indexOf(curr) + 1) % order.length];
    view.homePermissionPreset = next;
    render();
    return;
  }
  if (action === "arena-add-slot") {
    const slots = ensureHomeArenaSlots();
    if (slots.length >= 8) { showToast("Đa luồng hỗ trợ tối đa 8 nhánh Git worktree song song."); return; }
    const last = slots[slots.length - 1] || { provider: "codex", model: "", effort: "medium" };
    view.homeArenaSlots = [...slots, { ...last }];
    render();
    return;
  }
  if (action === "arena-clone-slot") {
    const slots = ensureHomeArenaSlots();
    if (slots.length >= 8) { showToast("Đa luồng hỗ trợ tối đa 8 nhánh Git worktree song song."); return; }
    const idx = Number(button.dataset.index || 0);
    const source = slots[idx] || slots[0];
    const next = [...slots];
    next.splice(idx + 1, 0, { ...source });
    view.homeArenaSlots = next;
    render();
    return;
  }
  if (action === "arena-remove-slot") {
    const slots = ensureHomeArenaSlots();
    if (slots.length <= 2) { showToast("Đa luồng cần ít nhất 2 nhánh để chạy song song."); return; }
    const idx = Number(button.dataset.index || 0);
    view.homeArenaSlots = slots.filter((_, i) => i !== idx);
    render();
    return;
  }
  if (action === "arena-preset") {
    const preset = button.dataset.preset;
    const candidates = availableArenaCompetitors();
    const slots = ensureHomeArenaSlots();
    const base = slots[0] || candidates[0] || { provider: "codex", model: "", effort: "medium" };
    if (preset === "same-2") {
      view.homeArenaSlots = [{ ...base }, { ...base }];
    } else if (preset === "same-3") {
      view.homeArenaSlots = [{ ...base }, { ...base }, { ...base }];
    } else if (preset === "all-providers") {
      view.homeArenaSlots = candidates.length >= 2
        ? candidates.slice(0, 8).map((c) => ({ provider: c.provider, model: c.model, effort: c.effort }))
        : [{ ...base }, { ...base }];
    }
    render();
    return;
  }
  if (action === "remove-composer-attachment") {
    const scope = button.dataset.scope;
    const items = view.composerAttachments?.[scope] || [];
    view.composerAttachments[scope] = items.filter((item) => item.id !== button.dataset.attachmentId);
    if (!view.composerAttachments[scope].length) delete view.composerAttachments[scope];
    if (scope === "home") view.chatDraft = $(".home-composer [name=prompt]")?.value || "";
    else if (scope.startsWith("task:")) view.chatDraft = $(`.chat-composer[data-id="${CSS.escape(scope.slice(5))}"] [name=message]`)?.value || "";
    render();
    return;
  }
  if (action === "view-error-details") { showErrorDetails(button.dataset.error); return; }
  if (!button.closest(".wb-project-group") && view.projectMenuId) { view.projectMenuId = ""; render(); }
  if (!button.closest(".wb-task-item") && view.taskMenuId) view.taskMenuId = "";
  try {
    if (action === "apply-task-preset") {
      applyTaskPreset(button.closest("form[data-form=task]"));
      showToast(view.language === "en" ? "Task template applied. Review its settings before creating the task." : "Đã áp dụng mẫu. Hãy kiểm tra cấu hình trước khi tạo task.");
      return;
    }
    if (action === "save-task-preset") { await saveTaskPreset(button.closest("form[data-form=task]")); return; }
    if (action === "delete-task-preset") { await deleteTaskPreset(button.closest("form[data-form=task]")); return; }
    if (action === "toggle-language") {
      view.language = setLanguage(view.language === "en" ? "vi" : "en");
      render();
      showToast(view.language === "en" ? "Đã chuyển giao diện sang tiếng Anh." : "Đã chuyển giao diện sang tiếng Việt.");
      return;
    }
    if (action === "pick-theme") {
      const themeId = button.dataset.themeId || "";
      const applied = setSavedThemeId(themeId);
      view.theme = applied.id;
      document.querySelectorAll(".wb-theme-menu[open]").forEach((menu) => { menu.open = false; });
      render();
      showToast(view.language === "en" ? `Switched theme to ${applied.label}.` : `Đã chuyển sang chủ đề ${applied.label}.`);
      return;
    }
    if (action === "dismiss-desktop-setup") { view.desktopSetupOpen = false; try { localStorage.setItem("opensybau.setup-v3", "done"); localStorage.setItem("opensybau.desktop-setup-v2", "done"); } catch {} render(); return; }
    if (action === "desktop-open-settings") { view.desktopSetupOpen = false; view.page = "settings"; view.selected = null; try { localStorage.setItem("opensybau.setup-v3", "done"); localStorage.setItem("opensybau.desktop-setup-v2", "done"); } catch {} render(); return; }
    if (action === "open-setup-assistant") { view.desktopSetupOpen = true; render(); return; }
    if (action === "app-update-check") {
      const state = await window.opensybauDesktop?.checkForUpdates();
      if (state?.status === "not-available") showToast(view.language === "en" ? "You are using the latest version." : "Bạn đang dùng phiên bản mới nhất.");
      else if (state?.status === "error") showToast(state.error || (view.language === "en" ? "Could not check for updates." : "Không kiểm tra được cập nhật."));
      else showToast(view.language === "en" ? "Checking for updates…" : "Đang kiểm tra cập nhật…");
      return;
    }
    if (action === "app-update-restart") { await window.opensybauDesktop?.restartToUpdate(); return; }
    if (action === "open-chat-split") {
      view.chatSplitReturnWorkspaceId = "";
      const workspaceId = button.dataset.workspaceId || "";
      view.chatSplitWorkspaceId = workspaceId;
      const isolatedChats = view.state.tasks.filter((task) => task.workspaceId === workspaceId && task.isolated && !task.archived && !task.worktreeCleaned && !task.worktreeAppliedAt).sort((a, b) => Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt));
      const requestedTask = isolatedChats.find((task) => task.id === button.dataset.taskId);
      view.chatSplitTaskIds = [...new Set([requestedTask?.id, ...isolatedChats.map((task) => task.id)].filter(Boolean))].slice(0, 2);
      view.chatSplitActiveTaskId = view.chatSplitTaskIds[0] || "";
      view.chatSplitPickerOpen = false; view.chatSplitCreateOpen = false; view.page = "chat"; view.selected = null; view.activeStageTabId = "chat"; view.stageSplit = false; view.chatDrawerOpen = false; clearSidebarSearch(); render(); return;
    }
    if (action === "create-split-chat") { if ((view.chatSplitTaskIds || []).length >= 4) { showToast("Đã đạt giới hạn 4 khung chat."); return; } const active = view.state.tasks.find((task) => task.id === view.chatSplitActiveTaskId); view.chatSplitReturnWorkspaceId = button.dataset.workspaceId || view.chatSplitWorkspaceId; view.homeWorkspaceId = view.chatSplitReturnWorkspaceId; view.homeChatProvider = active?.config?.chatProvider || view.homeChatProvider; view.homeChatModel = active?.config?.chatModel || view.homeChatModel; view.homeChatEffort = active?.config?.chatEffort || view.homeChatEffort; view.homePermissionPreset = active?.permissionPreset || view.homePermissionPreset || "workspace-write"; view.chatSplitCreateDraft = ""; view.homeMode = "chat"; view.chatSplitCreateOpen = true; view.chatSplitPickerOpen = false; render(); return; }
    if (action === "close-split-chat-create") { view.chatSplitCreateOpen = false; view.chatSplitCreateDraft = ""; view.chatSplitReturnWorkspaceId = ""; render(); return; }
    if (action === "exit-chat-split") { view.selected = view.chatSplitActiveTaskId || view.chatSplitTaskIds[0] || null; view.chatSplitWorkspaceId = ""; view.chatSplitTaskIds = []; view.chatSplitCreateOpen = false; view.chatSplitReturnWorkspaceId = ""; view.activeStageTabId = "chat"; view.stageSplit = false; render(); return; }
    if (action === "focus-chat-pane") { view.chatSplitActiveTaskId = id; view.activeStageTabId = "chat"; render(); return; }
    if (action === "toggle-chat-picker") { view.chatSplitPickerOpen = !view.chatSplitPickerOpen; render(); return; }
    if (action === "close-chat-picker") { view.chatSplitPickerOpen = false; render(); return; }
    if (action === "add-chat-pane") { if (!view.chatSplitTaskIds.includes(id) && view.chatSplitTaskIds.length < 4) view.chatSplitTaskIds.push(id); view.chatSplitPickerOpen = false; render(); return; }
    if (action === "remove-chat-pane") { view.chatSplitTaskIds = view.chatSplitTaskIds.filter((taskId) => taskId !== id); if (view.chatSplitActiveTaskId === id) view.chatSplitActiveTaskId = view.chatSplitTaskIds[0] || ""; render(); return; }
    if (action === "new-chat") { view.chatSplitWorkspaceId = ""; view.chatSplitCreateOpen = false; view.chatSplitReturnWorkspaceId = ""; view.page = "chat"; view.selected = null; view.activeStageTabId = "chat"; view.stageSplit = false; view.chatDraft = ""; view.homeWorkspaceId = button.dataset.workspaceId || view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || ""; view.homeMode = "chat"; view.homeWorkflow = "chat-only"; clearSidebarSearch(); view.homeConfigOpen = false; closeOverlay(); render(); }
    if (action === "refresh") { await scanCliProviders(button); }
    if (action === "scan-skills") {
      button.disabled = true;
      const result = await api("/api/skills?refresh=1");
      view.skills = result.skills || []; view.skillsLoaded = true; render();
      showToast(`Đã quét ${view.skills.length} skill từ thư mục cài đặt hiện tại.`);
    }
    if (action === "new-task") await openTaskModal();
    if (action === "toggle-workspace") {
      view.projectMenuId = "";
      const collapsed = new Set(view.collapsedWorkspaces);
      collapsed.has(id) ? collapsed.delete(id) : collapsed.add(id);
      view.collapsedWorkspaces = [...collapsed];
      try { localStorage.setItem("workbench.collapsed-workspaces", JSON.stringify(view.collapsedWorkspaces)); } catch {}
      render();
    }
    if (action === "toggle-project-menu") { view.projectMenuId = view.projectMenuId === id ? "" : id; render(); return; }
    if (action === "toggle-task-menu") { const key = button.dataset.key || id; view.taskMenuId = view.taskMenuId === key ? "" : key; render(); return; }
    if (action === "rename-task") {
      const task = view.state.tasks.find((item) => item.id === id);
      view.taskMenuId = "";
      if (task) {
        showModal("Đổi tên chat", `<label>Tên chat<input name="title" value="${esc(task.title)}" maxlength="120" required autocomplete="off" spellcheck="false"></label>`, "Lưu tên", "task-rename");
        $(".modal").dataset.id = task.id;
      }
      return;
    }
    if (action === "copy-task-prompt") {
      const task = view.state.tasks.find((item) => item.id === id);
      if (task?.prompt) { await navigator.clipboard.writeText(task.prompt); showToast("Đã sao chép yêu cầu ban đầu."); }
      else showToast("Chat này chưa có yêu cầu để sao chép.");
      view.taskMenuId = ""; render(); return;
    }
    if (action === "edit-project") {
      const workspace = view.state.workspaces.find((item) => item.id === id);
      view.projectMenuId = "";
      if (workspace) showEditProjectModal(workspace);
      return;
    }
    if (action === "edit-project-section") {
      const workspace = view.state.workspaces.find((item) => item.id === id);
      view.projectMenuId = "";
      if (workspace) showProjectSectionModal(workspace);
      return;
    }
    if (action === "add-source-folder") {
      const list = button.closest(".modal")?.querySelector(".source-folder-list");
      list?.insertAdjacentHTML("beforeend", sourceFolderRow(""));
      list?.querySelector(".source-folder-row:last-child input")?.focus();
      return;
    }
    if (action === "remove-source-folder") { if (!button.disabled) button.closest(".source-folder-row")?.remove(); return; }
    if (action === "toggle-home-config") { view.homeConfigOpen = !view.homeConfigOpen; render(); }
    if (action === "toggle-chat-config") { view.chatConfigOpen = !view.chatConfigOpen; render(); }
    if (action === "close-composer-config") { view.homeConfigOpen = false; view.chatConfigOpen = false; render(); }
    if (action === "add-workspace") showWorkspaceModal();
    if (action === "new-memory") showMemoryModal();
    if (action === "new-skill") showSkillCreateModal();
    if (action === "provider-add") showApiProviderModal();
    if (action === "provider-connect-cli") { showCliProviderModal(); return; }
    if (action === "provider-cli-refresh") {
      await scanCliProviders(button, { openModal: Boolean(button.closest("#overlay")) });
      return;
    }
    if (action === "provider-cli-install") {
      const install = window.opensybauDesktop?.installCli;
      if (!install || view.cliInstallProvider) return;
      const buttonLabel = button.innerHTML;
      button.disabled = true;
      button.textContent = "Đang cài đặt…";
      view.cliInstallProvider = id;
      render();
      try {
        const result = await install(id, view.language);
        if (result?.cancelled) return;
        if (!result?.ok) throw new Error("Trình cài đặt chưa hoàn tất.");
        await scanCliProviders();
      } catch (error) {
        showToast(`Cài CLI thất bại: ${error.message}`);
      } finally {
        view.cliInstallProvider = "";
        if (button.isConnected) { button.disabled = false; button.innerHTML = buttonLabel; }
        render();
      }
      return;
    }
    if (action === "provider-cli-login") {
      const label = button.innerHTML;
      button.disabled = true;
      button.textContent = "Đang mở terminal…";
      try {
        const result = await api(`/api/connectors/${encodeURIComponent(id)}/login`, { method: "POST" });
        const feedback = $(".cli-connect-feedback", button.closest(".modal"));
        if (feedback) { feedback.textContent = result.message; feedback.hidden = false; }
        showToast(result.message);
      } finally { button.disabled = false; button.innerHTML = label; }
      return;
    }
    if (action === "provider-preset") {
      const form = button.closest(".modal");
      const presets = {
        openai: { name: "OpenAI / ChatGPT API", protocol: "openai", baseUrl: "https://api.openai.com/v1" },
        gemini: { name: "Google Gemini API", protocol: "gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
        anthropic: { name: "Claude API", protocol: "anthropic", baseUrl: "https://api.anthropic.com/v1" },
        local: { name: "", protocol: "openai-compatible", baseUrl: "http://localhost:11434/v1" },
      };
      const preset = presets[button.dataset.preset];
      if (form && preset) {
        for (const [field, value] of Object.entries(preset)) form.querySelector(`[name="${field}"]`).value = value;
        if (preset.name) form.querySelector('[name="name"]').focus();
      }
      return;
    }
    if (action === "provider-edit") {
      const provider = view.providers.find((item) => item.id === id && item.managedBy === "local");
      if (provider) showApiProviderModal(provider);
    }
    if (action === "provider-import-env") {
      button.disabled = true;
      try {
        await api("/api/providers/import-environment", { method: "POST", body: JSON.stringify({ id }) });
        await refresh();
        showToast("Đã chuyển provider và API key vào cấu hình OpenSybau. Bản trong .env gốc vẫn được giữ lại.");
      } finally { button.disabled = false; }
      return;
    }
    if (action === "provider-discover-models") {
      const form = button.closest(".modal");
      const data = new FormData(form);
      const fields = Object.fromEntries(data.entries());
      const id = form.dataset.id || apiProviderId(fields.name) || "provider-check";
      button.disabled = true;
      const label = button.innerHTML;
      button.textContent = "Đang tải…";
      try {
        const result = await api("/api/providers/models", { method: "POST", body: JSON.stringify({ ...fields, id, models: fields.models || "provider-check", useSavedKey: !data.has("clearApiKey") }) });
        form.querySelector('[name="models"]').value = result.models.map((model) => model.id).join("\n");
        showToast(`Đã tải ${result.models.length} model từ endpoint.`);
      } catch (error) { showToast(error.message); }
      finally { button.disabled = false; button.innerHTML = label; }
      return;
    }
    if (action === "provider-delete") {
      const provider = view.providers.find((item) => item.id === id && item.managedBy === "local");
      if (provider && confirm(`Xóa nguồn “${provider.name}” khỏi OpenSybau? API key đã lưu cũng sẽ bị xóa.`)) {
        await api(`/api/providers/${encodeURIComponent(id)}`, { method: "DELETE" });
        await refresh({ configuration: true }); showToast("Đã xóa nguồn AI.");
      }
    }
    if (action === "connect-vault") showVaultModal();
    if (action === "disconnect-vault") { if (confirm("Ngắt vault khỏi OpenSybau? Ghi chú trên máy không bị thay đổi.")) { await api("/api/settings", { method: "POST", body: JSON.stringify({ vaultPath: "" }) }); view.vaultEntries = []; view.vaultPreview = null; await refresh(); } }
    if (action === "close-modal") { if (event.target === button || button.tagName === "BUTTON") closeOverlay(); }
    if (action === "close-details") { view.selected = null; view.page = "chat"; render(); }
    if (action === "parallel-plus" || action === "parallel-minus") {
      const current = view.state.settings.maxConcurrent; const maxConcurrent = Math.max(1, Math.min(8, current + (action === "parallel-plus" ? 1 : -1)));
      await api("/api/settings", { method: "POST", body: JSON.stringify({ maxConcurrent }) }); await refresh();
    }
    if (action === "stop-task") { await api(`/api/tasks/${encodeURIComponent(id)}/stop`, { method: "POST" }); showToast("Đã gửi lệnh dừng."); await refresh(); }
    if (action === "rerun-task") { await api(`/api/tasks/${encodeURIComponent(id)}/run`, { method: "POST" }); showToast("Task được đưa lại vào hàng đợi."); await refresh(); }
    if (action === "rerun-stage") {
      const stage = button.closest(".stage-rerun-controls")?.querySelector("[data-rerun-stage]")?.value || "";
      await api(`/api/tasks/${encodeURIComponent(id)}/run`, { method: "POST", body: JSON.stringify({ stage }) });
      showToast(view.language === "en" ? "Task queued from the selected stage." : "Task đã vào hàng đợi từ giai đoạn đã chọn.");
      await refresh();
    }
    if (action === "show-diff") { const data = await api(`/api/tasks/${encodeURIComponent(id)}/diff`); showDiffModal(data, id); return; }
    if (action === "open-diff-file") {
      const targetTask = view.state.tasks.find((item) => item.id === (id || view.selected));
      await openStageFileTab({
        workspaceId: button.dataset.workspaceId || targetTask?.workspaceId || "",
        taskId: id || view.selected || "",
        path: button.dataset.path || "",
      });
      return;
    }
    if (action === "activate-stage-tab") {
      if (event.target.closest?.("[data-action='close-stage-tab']")) return;
      const tabId = button.dataset.tabId || "chat";
      view.activeStageTabId = tabId;
      view.stageLineCommentTarget = null;
      render();
      return;
    }
    if (action === "close-stage-tab") {
      event.stopPropagation();
      const tabId = button.dataset.tabId || "";
      view.stageTabs = (view.stageTabs || []).filter((item) => item.id !== tabId);
      if (!view.stageTabs.length) {
        view.activeStageTabId = "chat";
        view.stageSplit = false;
      } else if (view.activeStageTabId === tabId) {
        view.activeStageTabId = view.stageTabs[view.stageTabs.length - 1].id;
      }
      view.stageLineCommentTarget = null;
      render();
      return;
    }
    if (action === "toggle-stage-split") {
      view.stageSplit = !view.stageSplit;
      if (view.stageSplit && view.activeStageTabId === "chat" && view.stageTabs?.length) {
        view.activeStageTabId = view.stageTabs[view.stageTabs.length - 1].id;
      }
      render();
      return;
    }
    if (action === "stage-tab-mode") {
      const tabId = button.dataset.tabId || view.activeStageTabId;
      const tab = (view.stageTabs || []).find((item) => item.id === tabId);
      if (tab && button.dataset.mode) {
        tab.mode = button.dataset.mode;
        view.stageLineCommentTarget = null;
        render();
      }
      return;
    }
    if (action === "reload-stage-tab") {
      const tabId = button.dataset.tabId || view.activeStageTabId;
      if (tabId && tabId !== "chat") {
        await reloadStageFileTab(tabId);
        showToast("Đã làm mới nội dung tệp.");
      }
      return;
    }
    if (action === "open-stage-line-comment") {
      view.stageLineCommentTarget = {
        key: button.dataset.key || "",
        path: button.dataset.path || "",
        line: button.dataset.line || "1",
        code: button.dataset.code || "",
      };
      render();
      $("[data-stage-line-comment-input]")?.focus();
      return;
    }
    if (action === "cancel-stage-line-comment") {
      view.stageLineCommentTarget = null;
      render();
      return;
    }
    if (action === "send-stage-line-comment") {
      const comment = String($("[data-stage-line-comment-input]")?.value || "").trim();
      const target = view.stageLineCommentTarget;
      if (!comment || !target) { showToast("Nhập nội dung nhận xét cho dòng này trước khi gửi."); return; }
      const snippet = `Tại tệp @${target.path} (Dòng ${target.line}: \`${String(target.code || "").trim().slice(0, 120)}\`): ${comment}`;
      view.stageLineCommentTarget = null;
      const activeTask = view.page === "chat" && view.selected ? view.state.tasks.find((t) => t.id === view.selected) : null;
      if (activeTask && String(snippet).length >= 6) {
        const wf = activeTask.config?.workflow || "codex-antigravity";
        const provider = view.chatProvider || (wf === "chat-only" ? activeTask.config?.chatProvider : roleConfig(activeTask.config, "build")?.provider || roleConfig(activeTask.config, "plan")?.provider) || "codex";
        const models = view.connectors?.[provider]?.models || [];
        const model = view.chatModel || models[0]?.id || "";
        const effort = view.chatEffort || "medium";
        await api(`/api/tasks/${encodeURIComponent(activeTask.id)}/chat`, {
          method: "POST",
          body: JSON.stringify({ message: snippet, provider, model, effort }),
        });
        view.stageSplit = true;
        await refresh();
        showToast(`Đã gửi nhận xét dòng ${target.line} của ${target.path} cho Agent!`);
      } else {
        view.page = "chat";
        view.stageSplit = true;
        view.chatDraft = view.chatDraft ? `${view.chatDraft}\n${snippet}` : snippet;
        render();
        const textarea = $(".chat-input") || $("[data-home-prompt]");
        textarea?.focus();
        showToast("Đã chèn nhận xét dòng vào khung Chat.");
      }
      return;
    }
    if (action === "toggle-html-inspect") {
      view.stageHtmlInspectActive = !view.stageHtmlInspectActive;
      if (!view.stageHtmlInspectActive) {
        view.stageHtmlSelectedElement = null;
        view.stageHtmlCommentDraft = "";
      }
      syncHtmlInspectUi();
      return;
    }
    if (action === "close-html-inspect") {
      view.stageHtmlInspectActive = false;
      view.stageHtmlSelectedElement = null;
      view.stageHtmlCommentDraft = "";
      syncHtmlInspectUi();
      return;
    }
    if (action === "cancel-html-element-comment") {
      view.stageHtmlSelectedElement = null;
      view.stageHtmlCommentDraft = "";
      syncHtmlInspectUi();
      return;
    }
    if (action === "pick-html-comment-agent") {
      const [prov, mod] = String(button.dataset.agent || "").split("::");
      if (prov) {
        view.stageHtmlCommentProvider = prov;
        view.stageHtmlCommentModel = mod || "";
        const conn = view.connectors?.[prov];
        const modelObj = conn?.models?.find((m) => m.id === mod) || conn?.models?.[0];
        view.stageHtmlCommentEffort = modelObj?.efforts?.includes(view.stageHtmlCommentEffort)
          ? view.stageHtmlCommentEffort
          : (modelObj?.efforts?.includes("medium") ? "medium" : modelObj?.efforts?.[0] || "medium");
        view.stageHtmlCommentDraft = String($("[data-html-element-comment-input]")?.value ?? view.stageHtmlCommentDraft ?? "");
        syncHtmlInspectUi();
      }
      return;
    }
    if (action === "pick-html-comment-effort") {
      view.stageHtmlCommentEffort = button.dataset.effort || "medium";
      view.stageHtmlCommentDraft = String($("[data-html-element-comment-input]")?.value ?? view.stageHtmlCommentDraft ?? "");
      syncHtmlInspectUi();
      return;
    }
    if (action === "send-html-element-comment") {
      const comment = String($("[data-html-element-comment-input]")?.value || view.stageHtmlCommentDraft || "").trim();
      const el = view.stageHtmlSelectedElement;
      if (!comment || !el) {
        showToast("Nhập nội dung nhận xét cho phần tử HTML này trước khi gửi.");
        return;
      }
      const fallback = resolveHtmlCommentAgentSelection();
      const provider = fallback.provider || "codex";
      const model = fallback.model || "";
      const effort = fallback.effort || "medium";
      view.stageHtmlCommentProvider = provider;
      view.stageHtmlCommentModel = model;
      view.stageHtmlCommentEffort = effort;
      view.chatProvider = provider;
      view.chatModel = model;
      view.chatEffort = effort;

      const activeTab = (view.stageTabs || []).find((t) => t.id === view.activeStageTabId) || (view.stageSplit ? (view.stageTabs || []).at(-1) : null);
      const filePath = activeTab?.path || "index.html";
      const selectorText = el.selector ? `\`${el.selector}\`` : `\`<${el.tagName || "element"}>\``;
      const labelText = el.label ? ` ("${el.label}")` : "";
      const htmlBlock = el.outerHTML ? `\n\`\`\`html\n${el.outerHTML}\n\`\`\`\n` : "\n";
      const snippet = `Tại tệp @${filePath} — Phần tử ${selectorText}${labelText}:${htmlBlock}Yêu cầu chỉnh sửa: ${comment}`;

      view.stageHtmlSelectedElement = null;
      view.stageHtmlCommentDraft = "";
      syncHtmlInspectUi();

      const activeTask = view.page === "chat" && view.selected ? (view.state?.tasks || []).find((t) => t.id === view.selected) : null;
      if (activeTask) {
        await api(`/api/tasks/${encodeURIComponent(activeTask.id)}/chat`, {
          method: "POST",
          body: JSON.stringify({ message: snippet, provider, model, effort }),
        });
        view.stageSplit = true;
        await refresh();
        showToast(`Đã gửi nhận xét phần tử <${el.tagName}> cho ${providerTitle(view.connectors, provider)}!`);
      } else {
        const wsId = activeTab?.workspaceId || view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || "";
        if (wsId) {
          const created = await api("/api/tasks", {
            method: "POST",
            body: JSON.stringify({
              title: `${filePath} · ${comment.slice(0, 56)}`,
              prompt: snippet,
              workspaceId: wsId,
              workflow: "chat-only",
              permissionPreset: view.homePermissionPreset || "workspace-write",
              chatProvider: provider,
              chatModel: model,
              chatEffort: effort,
            }),
          });
          view.page = "chat";
          view.selected = created.task.id;
          view.stageSplit = true;
          await refresh();
          showToast(`Đã tạo tác vụ mới và gửi phần tử <${el.tagName}> cho ${providerTitle(view.connectors, provider)}!`);
        } else {
          view.page = "chat";
          view.stageSplit = true;
          view.chatDraft = view.chatDraft ? `${view.chatDraft}\n\n${snippet}` : snippet;
          render();
          showToast("Đã chèn nhận xét phần tử HTML vào khung Chat.");
        }
      }
      return;
    }
    if (action === "select-diff-file") { view.diffSelectedFile = button.dataset.path || ""; view.diffAnnotationTarget = null; renderDiffStudioModal(); return; }
    if (action === "open-diff-comment") {
      view.diffAnnotationTarget = { key: button.dataset.key, path: button.dataset.path, line: button.dataset.line, side: button.dataset.side || "", code: button.dataset.code || "" };
      renderDiffStudioModal();
      return;
    }
    if (action === "cancel-diff-comment") { view.diffAnnotationTarget = null; renderDiffStudioModal(); return; }
    if (action === "save-diff-comment") {
      const comment = String($("[data-diff-comment-input]")?.value || "").trim();
      const target = view.diffAnnotationTarget;
      const tId = view.diffStudioTaskId || view.selected || "";
      if (!comment || !target || !tId) { showToast("Nhập nội dung nhận xét trước khi lưu."); return; }
      view.diffAnnotations ||= {};
      view.diffAnnotations[tId] ||= [];
      view.diffAnnotations[tId].push({ id: crypto.randomUUID(), path: target.path, line: target.line, side: target.side || "", code: target.code, comment });
      view.diffAnnotationTarget = null;
      renderDiffStudioModal();
      return;
    }
    if (action === "remove-diff-comment") {
      const tId = view.diffStudioTaskId || view.selected || "";
      if (view.diffAnnotations?.[tId]) {
        view.diffAnnotations[tId] = view.diffAnnotations[tId].filter((a) => a.id !== button.dataset.commentId);
      }
      renderDiffStudioModal();
      return;
    }
    if (action === "submit-diff-review") {
      const anns = view.diffAnnotations?.[id] || [];
      if (!anns.length) return;
      const task = view.state.tasks.find((item) => item.id === id);
      const wf = task?.config?.workflow || "codex-antigravity";
      const provider = view.chatProvider || (wf === "chat-only" ? task?.config?.chatProvider : roleConfig(task?.config, "build")?.provider || roleConfig(task?.config, "plan")?.provider) || "codex";
      const models = view.connectors?.[provider]?.models || [];
      const model = view.chatModel || models[0]?.id || "";
      const effort = view.chatEffort || "medium";
      const reviewLines = [
        "Hãy chỉnh sửa mã nguồn theo các nhận xét review trên diff dưới đây:",
        "",
        ...anns.map((ann, idx) => `${idx + 1}. **Tệp \`${ann.path}\` (Dòng ${ann.line})**:\n   - Dòng hiện tại: \`${String(ann.code || "").trim()}\`\n   - Yêu cầu sửa: ${ann.comment}`),
      ].join("\n");
      await api(`/api/tasks/${encodeURIComponent(id)}/chat`, {
        method: "POST",
        body: JSON.stringify({ message: reviewLines, provider, model, effort }),
      });
      delete view.diffAnnotations[id];
      closeOverlay();
      view.selected = id;
      view.page = "chat";
      await refresh();
      showToast(`Đã gửi ${anns.length} nhận xét diff cho Agent xử lý!`);
      return;
    }
    if (action === "apply-worktree" || action === "pick-arena-winner") {
      const task = view.state.tasks.find((item) => item.id === id);
      if (!confirm(`Áp dụng toàn bộ thay đổi từ nhánh worktree của “${task?.title || id}” vào thư mục dự án chính?`)) return;
      const res = await api(`/api/tasks/${encodeURIComponent(id)}/apply-worktree`, { method: "POST", body: JSON.stringify({ cleanup: false }) });
      closeOverlay();
      view.selected = id;
      view.page = "chat";
      await refresh();
      const count = (res.appliedFiles || res.task?.appliedFiles || []).length;
      showToast(`Đã gộp ${count} tệp từ worktree vào dự án chính!`);
      return;
    }
    if (action === "discard-worktree") {
      const task = view.state.tasks.find((item) => item.id === id);
      if (!confirm(`Hủy bỏ và xóa thư mục Git worktree cô lập của “${task?.title || id}”? Lịch sử trò chuyện vẫn được giữ lại.`)) return;
      await api(`/api/tasks/${encodeURIComponent(id)}/discard-worktree`, { method: "POST" });
      closeOverlay();
      await refresh();
      showToast("Đã dọn dẹp Git worktree cô lập.");
      return;
    }
    if (action === "compare-fanout") {
      await openArenaCompareModal(button.dataset.fanoutId || "");
      return;
    }
    if (action === "toggle-chat-drawer") {
      view.chatDrawerOpen = !view.chatDrawerOpen;
      const task = view.state.tasks.find((item) => item.id === (id || view.selected));
      if (view.chatDrawerOpen && task?.workspaceId) {
        void ensureWorkspaceFileIndex(task.workspaceId).then(() => render());
      }
      render();
      return;
    }
    if (action === "chat-drawer-tab" || action === "right-dock-tab") {
      view.chatDrawerTab = button.dataset.tab || "files";
      render();
      return;
    }
    if (action === "toggle-dock-folder") {
      const folderPath = button.dataset.folder || "";
      if (folderPath) {
        const set = new Set(view.collapsedDockFolders || []);
        if (set.has(folderPath)) set.delete(folderPath);
        else set.add(folderPath);
        view.collapsedDockFolders = [...set];
        render();
      }
      return;
    }
    if (action === "toggle-fanout-group") {
      const fid = button.dataset.fanoutId || id || "";
      if (fid) {
        const set = new Set(view.collapsedFanouts || []);
        if (set.has(fid)) set.delete(fid);
        else set.add(fid);
        view.collapsedFanouts = [...set];
        try { localStorage.setItem("workbench.collapsed-fanouts", JSON.stringify(view.collapsedFanouts)); } catch {}
        render();
      }
      return;
    }
    if (action === "dock-open-workspace-file" || action === "preview-drawer-file") {
      const wsId = button.dataset.workspaceId
        || (view.page === "workspaces" && view.selected ? view.selected : "")
        || view.state.tasks.find((item) => item.id === (id || view.selected))?.workspaceId
        || view.homeWorkspaceId
        || view.state?.workspaces?.[0]?.id;
      if (wsId && button.dataset.path) {
        await openStageFileTab({
          workspaceId: wsId,
          taskId: id || (view.page === "chat" ? view.selected : "") || "",
          path: button.dataset.path,
        });
      }
      return;
    }
    if (action === "close-workspace-preview" || action === "close-drawer-preview") {
      view.filePreview = null;
      view.chatDrawerPreview = null;
      view.activeStageTabId = "chat";
      render();
      return;
    }
    if (action === "refresh-dock-context") {
      const selectedTask = view.selected ? (view.state?.tasks || []).find((t) => t.id === view.selected) : null;
      const wsId = (view.page === "workspaces" && view.selected)
        ? view.selected
        : selectedTask?.workspaceId || view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || "";
      if (wsId) {
        if (view.workspaceFileIndex) delete view.workspaceFileIndex[wsId];
        await ensureWorkspaceFileIndex(wsId);
        render();
        showToast("Đã làm mới cây thư mục dự án.");
      }
      return;
    }
    if (action === "select-skill") {
      view.selectedSkillId = id || "";
      view.skillEditing = false;
      view.skillEditingId = "";
      if (view.selectedSkillId) void ensureSkillDetail(view.selectedSkillId);
      render();
      return;
    }
    if (action === "start-inline-skill-edit") {
      const detail = await ensureSkillDetail(id);
      if (detail) {
        view.selectedSkillId = id;
        view.skillEditing = true;
        view.skillEditingId = id;
        view.skillDraft = detail.content || "";
        render();
      }
      return;
    }
    if (action === "cancel-inline-skill-edit") {
      view.skillEditing = false;
      view.skillEditingId = "";
      view.skillDraft = "";
      render();
      return;
    }
    if (action === "save-inline-skill") {
      const editorEl = document.querySelector("[data-skill-inline-editor]");
      const content = editorEl ? editorEl.value : (view.skillDraft ?? "");
      if (id && content.trim()) {
        await api(`/api/skills/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ content }) });
        if (view.skillDetailsCache) delete view.skillDetailsCache[id];
        view.skillEditing = false;
        view.skillEditingId = "";
        await ensureSkillDetail(id);
        render();
        showToast("Đã lưu thay đổi SKILL.md.");
      }
      return;
    }
    if (action === "memory-scope-filter") {
      view.memoryWorkspaceFilter = button.dataset.scope || "all";
      render();
      return;
    }
    if (action === "settings-scroll-section") {
      const secId = button.dataset.section || "";
      const secEl = secId ? document.getElementById(secId) : null;
      secEl?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (action === "mention-drawer-file") {
      const path = button.dataset.path || "";
      if (!path) return;
      let textarea = $(".chat-input") || $("[data-home-prompt]");
      if (!textarea) {
        view.page = "chat";
        if ((view.stageTabs || []).length > 0 && view.activeStageTabId !== "chat") {
          view.stageSplit = true;
        } else {
          view.activeStageTabId = "chat";
        }
        render();
        textarea = $(".chat-input") || $("[data-home-prompt]");
      }
      if (textarea) {
        const prefix = textarea.value && !/\s$/.test(textarea.value) ? " " : "";
        textarea.value = `${textarea.value}${prefix}@${path} `;
        view.chatDraft = textarea.value;
        textarea.focus();
      }
      return;
    }
    if (action === "insert-file-mention") {
      const path = button.dataset.path || "";
      const menu = view.mentionMenu;
      const textarea = $(".chat-input") || $("[data-home-prompt]");
      if (textarea && path && menu) {
        const before = textarea.value.slice(0, menu.startPos);
        const after = textarea.value.slice(menu.endPos);
        textarea.value = `${before}@${path} ${after}`;
        view.chatDraft = textarea.value;
        view.mentionMenu = null;
        const pop = textarea.closest(".composer-input-wrap")?.querySelector("[data-mention-popover]");
        if (pop) { pop.hidden = true; pop.innerHTML = ""; }
        textarea.focus();
        const cursor = before.length + path.length + 2;
        textarea.setSelectionRange?.(cursor, cursor);
      }
      return;
    }
    if (action === "open-folder") { await api(`/api/tasks/${encodeURIComponent(id)}/open`, { method: "POST" }); showToast("Đã mở thư mục dự án trong Explorer."); }
    if (action === "open-project-folder") { await api(`/api/workspaces/${encodeURIComponent(id)}/open`, { method: "POST" }); showToast("Đã mở thư mục dự án trong Explorer."); }
    if (action === "toggle-project-pin") {
      const workspace = view.state.workspaces.find((item) => item.id === id);
      if (workspace) { await api(`/api/workspaces/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ pinned: !workspace.pinned }) }); view.projectMenuId = ""; await refresh(); }
    }
    if (action === "archive-workspace-chats") {
      const result = await api(`/api/workspaces/${encodeURIComponent(id)}/archive-chats`, { method: "POST" });
      view.projectMenuId = ""; await refresh(); showToast(`${result.archived} chat đã chuyển vào Đã lưu trữ.`);
    }
    if (action === "toggle-task-pin") {
      const task = view.state.tasks.find((item) => item.id === id);
      if (task) { await api(`/api/tasks/${encodeURIComponent(id)}/pin`, { method: "POST", body: JSON.stringify({ pinned: !task.pinned }) }); view.taskMenuId = ""; await refresh(); }
    }
    if (action === "archive-task" || action === "restore-task") {
      await api(`/api/tasks/${encodeURIComponent(id)}/archive`, { method: "POST", body: JSON.stringify({ archived: action === "archive-task" }) });
      view.taskMenuId = ""; await refresh(); showToast(action === "archive-task" ? "Đã lưu trữ chat." : "Đã khôi phục chat.");
    }
    if (action === "delete-chat") {
      const task = view.state.tasks.find((item) => item.id === id);
      if (!task || ["queued", "running"].includes(task.status)) { showToast("Hãy dừng chat trước khi xóa."); return; }
      if (!confirm(`Xóa vĩnh viễn chat “${task.title}”? Lịch sử chat và bản ghi task sẽ bị xóa; thư mục workspace không bị ảnh hưởng.`)) return;
      if (!task.archived) await api(`/api/tasks/${encodeURIComponent(id)}/archive`, { method: "POST", body: JSON.stringify({ archived: true }) });
      await api(`/api/tasks/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (view.selected === id) { view.selected = null; view.page = "chat"; }
      view.taskMenuId = "";
      await refresh();
      showToast("Đã xóa chat vĩnh viễn.");
    }
    if (action === "edit-task-goal") { const task = view.state.tasks.find((item) => item.id === id); if (task) openTaskGoalModal(task); return; }
    if (action === "task-permissions") { const task = view.state.tasks.find((item) => item.id === id); if (task) openTaskPermissionsModal(task); return; }
    if (action === "toggle-goal-item") {
      const itemId = button.dataset.goalId;
      const task = view.state.tasks.find((entry) => entry.id === id);
      const item = task?.goalChecklist?.find((entry) => entry.id === itemId);
      if (item) {
        const result = await api("/api/tasks/" + encodeURIComponent(id) + "/checklist", { method: "POST", body: JSON.stringify({ id: itemId, done: button.checked }) });
        task.goalChecklist = result.task.goalChecklist;
        button.nextElementSibling?.classList.toggle("is-done", button.checked);
      }
      return;
    }
    if (action === "fork-chat") {
      const source = view.state.tasks.find((item) => item.id === id);
      if (source) {
        const result = await api("/api/tasks/" + encodeURIComponent(id) + "/fork", { method: "POST", body: JSON.stringify({ messageId: button.dataset.messageId }) });
        view.selected = result.task.id; view.page = "chat"; view.chatDraft = "";
        view.chatProvider = result.task.config.chatProvider || source.config?.roles?.plan?.provider || "codex";
        view.chatModel = result.task.config.chatModel || source.config?.roles?.plan?.model || "";
        view.chatEffort = result.task.config.chatEffort || source.config?.roles?.plan?.effort || "";
        await refresh(); showToast("Đã tạo nhánh chat tại lượt này. Chat gốc vẫn được giữ nguyên.");
      }
      return;
    }
    if (action === "task-instruction") { const task = view.state.tasks.find((item) => item.id === id); if (task) openTaskInstructionModal(task); }
    if (action === "inspect-task" || action === "open-task-flow") { view.selected = id; view.page = "flows"; render(); }
    if (action === "back-flows") { view.selected = null; view.page = "flows"; render(); }
    if (action === "back-chat") { view.selected = id; view.page = "chat"; render(); }
    if (action === "open-workspace") await loadWorkspaceDir(id, "");
    if (action === "back-projects") { view.selected = null; view.page = "workspaces"; render(); }
    if (action === "workspace-dir") await loadWorkspaceDir(view.selected, button.dataset.path || "");
    if (action === "workspace-up") { const parent = view.workspaceDir.split("/").filter(Boolean).slice(0, -1).join("/"); await loadWorkspaceDir(view.selected, parent); }
    if (action === "workspace-file-action") {
      const entry = view.workspaceEntries.find((item) => item.path === button.dataset.path);
      if (entry?.type === "directory") await loadWorkspaceDir(view.selected, entry.path);
      else if (entry) await loadWorkspacePreview(view.selected, entry.path);
    }
    if (action === "refresh-project-files") await loadWorkspaceDir(view.selected, view.workspaceDir);
    if (action === "vault-dir") await loadVaultDir(button.dataset.path || "");
    if (action === "vault-up") { const parent = view.vaultDir.split("/").filter(Boolean).slice(0, -1).join("/"); await loadVaultDir(parent); }
    if (action === "vault-file-action") {
      const entry = view.vaultEntries.find((item) => item.path === button.dataset.path);
      if (entry?.type === "directory") await loadVaultDir(entry.path);
      else if (entry) await loadVaultPreview(entry.path);
    }
    if (action === "refresh-vault-files") await loadVaultDir(view.vaultDir, { keepPreview: true });
    if (action === "toggle-vault-left") {
      view.vaultLeftOpen = view.vaultLeftOpen === false ? true : false;
      render();
      return;
    }
    if (action === "toggle-vault-right") {
      view.vaultRightOpen = view.vaultRightOpen === false ? true : false;
      render();
      return;
    }
    if (action === "vault-filter-tag") {
      const tag = button.dataset.tag || "";
      view.vaultFilter = view.vaultFilter === tag ? "" : tag;
      if (view.vaultLeftOpen === false) view.vaultLeftOpen = true;
      render();
      return;
    }
    if (action === "vault-scroll-heading") {
      const idx = button.dataset.headingIndex;
      const headingEl = document.querySelector(`[data-kb-heading="${CSS.escape(String(idx))}"]`);
      headingEl?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (action === "vault-mode") {
      view.vaultViewMode = button.dataset.mode || "files";
      if (view.vaultViewMode === "graph" && !view.vaultGraph) await loadVaultGraph();
      else render();
    }
    if (action === "refresh-vault-graph") await loadVaultGraph();
    if (action === "neural-graph-reset") {
      const canvas = document.getElementById("vault-neural-canvas");
      if (canvas?._resetCamera) canvas._resetCamera();
    }
    if (action === "vault-select-graph-node") {
      if (button.dataset.path) await loadVaultPreview(button.dataset.path);
    }
    if (action === "vault-open-from-graph") {
      view.vaultViewMode = "files";
      if (button.dataset.path) await loadVaultPreview(button.dataset.path);
      else render();
    }
    if (action === "vault-focus-graph") {
      view.vaultViewMode = "graph";
      if (button.dataset.path) await loadVaultPreview(button.dataset.path);
      if (!view.vaultGraph) await loadVaultGraph();
      else render();
    }
    if (action === "vault-edit-from-graph") {
      view.vaultViewMode = "files";
      if (button.dataset.path) await loadVaultPreview(button.dataset.path, { startEdit: true });
    }
    if (action === "vault-new-note") showNewVaultNoteModal();
    if (action === "vault-edit-note") {
      view.vaultViewMode = "files";
      const path = button.dataset.path || view.vaultPreview?.path;
      if (path) await loadVaultPreview(path, { startEdit: true });
    }
    if (action === "vault-cancel-edit") {
      view.vaultEditing = false;
      view.vaultEditingPath = "";
      view.vaultDraft = view.vaultPreview?.content || "";
      render();
    }
    if (action === "vault-save-note") {
      const path = button.dataset.path || view.vaultEditingPath || view.vaultPreview?.path;
      const editorEl = document.querySelector("[data-vault-editor]");
      const content = editorEl ? editorEl.value : (view.vaultDraft ?? "");
      if (path) {
        const saved = await api("/api/vault/file", { method: "PUT", body: JSON.stringify({ path, content }) });
        view.vaultPreview = saved;
        view.vaultEditing = false;
        view.vaultEditingPath = "";
        view.vaultDraft = saved.content;
        await loadVaultDir(view.vaultDir, { keepPreview: true });
        showToast("Đã lưu ghi chú tri thức.");
      }
    }
    if (action === "vault-delete-note") {
      const path = button.dataset.path || view.vaultPreview?.path;
      if (path && confirm(`Xóa vĩnh viễn tệp ghi chú “${path}” khỏi Obsidian vault?`)) {
        await api(`/api/vault/file?path=${encodeURIComponent(path)}`, { method: "DELETE" });
        if (view.vaultPreview?.path === path) {
          view.vaultPreview = null;
          view.vaultEditing = false;
          view.vaultEditingPath = "";
        }
        await loadVaultDir(view.vaultDir, { keepPreview: true });
        showToast("Đã xóa tệp ghi chú khỏi vault.");
      }
    }
    if (action === "vault-open-wikilink") {
      const target = (button.dataset.target || "").trim();
      if (target) {
        const nodes = view.vaultGraph?.nodes || [];
        const lower = target.toLowerCase().replace(/\.(md|mdx|markdown)$/i, "");
        const match = nodes.find((n) => n.path.toLowerCase() === target.toLowerCase() || n.path.replace(/\.(md|mdx|markdown)$/i, "").toLowerCase() === lower || n.stem.toLowerCase() === lower.split("/").at(-1));
        if (match) {
          await loadVaultPreview(match.path);
        } else {
          const candidatePath = /\.(md|mdx|markdown)$/i.test(target) ? target : `${target}.md`;
          try {
            await loadVaultPreview(candidatePath);
          } catch {
            if (confirm(`Ghi chú “${candidatePath}” chưa tồn tại. Tạo mới ngay?`)) {
              const created = await api("/api/vault/file", { method: "POST", body: JSON.stringify({ path: candidatePath, content: `# ${target.replace(/\.(md|mdx|markdown)$/i, "")}\n\n`, createOnly: true }) });
              await loadVaultDir(view.vaultDir, { keepPreview: true });
              view.vaultPreview = created;
              view.vaultEditing = true;
              view.vaultEditingPath = created.path;
              view.vaultDraft = created.content;
              render();
            }
          }
        }
      }
    }
    if (action === "open-obsidian") {
      await api("/api/vault/open-obsidian", { method: "POST", body: JSON.stringify({ path: button.dataset.path || view.vaultPreview?.path || "" }) });
      showToast("Đang mở trong ứng dụng Obsidian…");
    }
    if (action === "view-skill") await showSkillView(id);
    if (action === "edit-skill") await showSkillEdit(id);
    if (action === "copy-skill") {
      const skill = view.skills.find((item) => item.id === id);
      const scope = defaultSkillScope(skill?.providers || []);
      await api(`/api/skills/${encodeURIComponent(id)}/copy`, { method: "POST", body: JSON.stringify({ scope }) });
      closeOverlay();
      view.skillsLoaded = false; await refresh();
      const result = await api("/api/skills"); view.skills = result.skills || []; view.skillsLoaded = true; render();
      showToast("Đã sao chép thành skill cá nhân để chỉnh sửa.");
    }
    if (action === "delete-skill") {
      const skill = view.skills.find((item) => item.id === id);
      if (confirm(`Xóa skill “${skill?.name || id}” khỏi thư mục cá nhân? Nếu có bản plugin trùng, bản plugin vẫn được giữ.`)) {
        const result = await api(`/api/skills/${encodeURIComponent(id)}`, { method: "DELETE" });
        closeOverlay();
        view.skillsLoaded = false; await refresh();
        const catalog = await api("/api/skills"); view.skills = catalog.skills || []; view.skillsLoaded = true; render();
        showToast(result.readonlySourcesRemain ? "Đã xóa bản cá nhân; bản plugin chỉ đọc vẫn còn." : "Đã xóa skill cá nhân.");
      }
    }
    if (action === "remove-workspace") { if (confirm("Gỡ dự án khỏi OpenSybau? Thư mục và tệp trên máy sẽ không bị xóa.")) { await api(`/api/workspaces/${encodeURIComponent(id)}`, { method: "DELETE" }); view.projectMenuId = ""; if (view.page === "workspaces" && view.selected === id) { view.selected = null; view.workspaceDir = ""; view.workspaceEntries = []; view.filePreview = null; } await refresh(); } }
    if (action === "delete-memory") { if (confirm("Xóa ghi nhớ này?")) { await api(`/api/memory/${encodeURIComponent(id)}`, { method: "DELETE" }); await refresh(); } }
  } catch (error) { showToast(error.message); }
}
function resizeComposerTextarea(textarea) {
  if (!textarea) return;
  if (!textarea.value) {
    textarea.style.height = "28px";
    return;
  }
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(200, Math.max(28, textarea.scrollHeight))}px`;
}

async function updateComposerMentionMenu(textarea) {
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
const activeButtonActions = new WeakSet();
const lastButtonActionAt = new WeakMap();
document.addEventListener("click", async (event) => {
  const button = event.target.closest?.("button, [data-action='open-diff-comment']");
  if (!button) return handleWorkbenchClick(event);
  const now = Date.now();
  const lastActionAt = lastButtonActionAt.get(button) || 0;
  if (activeButtonActions.has(button) || now - lastActionAt < 250) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  activeButtonActions.add(button);
  lastButtonActionAt.set(button, now);
  button.setAttribute("aria-busy", "true");
  try { await handleWorkbenchClick(event); }
  finally {
    activeButtonActions.delete(button);
    if (button.isConnected) button.removeAttribute("aria-busy");
  }
});
document.addEventListener("submit", handleSubmit);
document.addEventListener("dragover", (event) => {
  if (event.target.closest?.("[data-workspace-path]")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }
});
document.addEventListener("drop", (event) => {
  const input = event.target.closest?.("[data-workspace-path]");
  if (!input) return;
  event.preventDefault();
  const filePath = event.dataTransfer?.files?.[0]?.path;
  let droppedPath = filePath || event.dataTransfer?.getData("text/uri-list")?.split(/\r?\n/).find((line) => line && !line.startsWith("#")) || event.dataTransfer?.getData("text/plain");
  if (droppedPath?.startsWith("file:")) {
    try {
      const url = new URL(droppedPath);
      droppedPath = url.hostname ? `\\\\${url.hostname}${decodeURIComponent(url.pathname).replaceAll("/", "\\")}` : decodeURIComponent(url.pathname).replace(/^\/(\w:)/, "$1").replaceAll("/", "\\");
    } catch {}
  }
  input.value = String(droppedPath || "").trim().replace(/^(["'])(.*)\1$/, "$2");
  input.dispatchEvent(new Event("input", { bubbles: true }));
});
document.addEventListener("input", (event) => {
  const chatInput = event.target.closest(".chat-input");
  if (chatInput) {
    const splitTaskId = chatInput.closest(".multi-chat-pane")?.dataset.taskId;
    if (splitTaskId) { view.chatSplitDrafts ||= {}; view.chatSplitDrafts[splitTaskId] = chatInput.value; }
    else view.chatDraft = chatInput.value;
    resizeComposerTextarea(chatInput);
    void updateComposerMentionMenu(chatInput);
    return;
  }
  const homePrompt = event.target.closest("[data-home-prompt]");
  if (homePrompt) {
    if (homePrompt.closest("[data-split-chat-create]")) view.chatSplitCreateDraft = homePrompt.value;
    else view.chatDraft = homePrompt.value;
    resizeComposerTextarea(homePrompt);
    void updateComposerMentionMenu(homePrompt);
    return;
  }
  const drawerFilter = event.target.closest("[data-chat-drawer-filter]");
  if (drawerFilter) {
    view.chatDrawerFilter = drawerFilter.value;
    const pos = drawerFilter.selectionStart;
    render();
    const nextFilter = $("[data-chat-drawer-filter]");
    nextFilter?.focus();
    if (typeof pos === "number") nextFilter?.setSelectionRange(pos, pos);
    return;
  }
  const homeSearch = event.target.closest("[data-home-search]");
  if (homeSearch) {
    view.searchQuery = homeSearch.value;
    view.searchResults = homeSearchResults(view.searchQuery);
    const results = $("[data-home-search-results]");
    if (results) { results.innerHTML = view.searchResults; results.hidden = !view.searchQuery.trim(); localizeDom(results, view.language); }
    return;
  }
  const fileInput = event.target.closest("[data-file-filter]");
  if (fileInput) {
    if (fileInput.dataset.fileFilter === "vault") view.vaultFilter = fileInput.value;
    const query = fileInput.value.trim().toLocaleLowerCase();
    const list = fileInput.closest(".file-browser")?.querySelector(".file-list");
    list?.querySelectorAll("[data-file-entry]").forEach((entry) => { entry.hidden = !entry.textContent.toLocaleLowerCase().includes(query); });
    return;
  }
  const vaultEditor = event.target.closest("[data-vault-editor]");
  if (vaultEditor) {
    view.vaultDraft = vaultEditor.value;
    return;
  }
  const skillEditor = event.target.closest("[data-skill-inline-editor]");
  if (skillEditor) {
    view.skillDraft = skillEditor.value;
    return;
  }
  const input = event.target.closest("[data-skill-filter]");
  if (!input) return;
  if (input.dataset.skillFilter === "library") view.skillFilter = input.value;
  applySkillFilter(input);
});
document.addEventListener("change", (event) => {
  if (event.target.matches("[data-home-quick-agent]")) {
    const [prov, mod] = String(event.target.value || "").split("::");
    if (prov) {
      view.homeChatProvider = prov;
      view.homeChatModel = mod || "";
      const conn = view.connectors?.[prov];
      const modelObj = conn?.models?.find((m) => m.id === mod) || conn?.models?.[0];
      const nextEffort = modelObj?.efforts?.includes(view.homeChatEffort)
        ? view.homeChatEffort
        : (modelObj?.efforts?.includes("medium") ? "medium" : modelObj?.efforts?.[0] || "medium");
      view.homeChatEffort = nextEffort;
      if (view.homeRoles) {
        view.homeRoles.plan = { provider: prov, model: mod || "", effort: nextEffort };
        view.homeRoles.build = { provider: prov, model: mod || "", effort: nextEffort };
      }
      render();
    }
    return;
  }
  if (event.target.matches("[data-home-quick-effort]")) {
    const nextEffort = event.target.value;
    view.homeChatEffort = nextEffort;
    if (view.homeRoles) {
      if (view.homeRoles.plan) view.homeRoles.plan.effort = nextEffort;
      if (view.homeRoles.build) view.homeRoles.build.effort = nextEffort;
    }
    render();
    return;
  }
  if (event.target.matches("[data-arena-slot-provider]")) {
    const idx = Number(event.target.dataset.arenaSlotProvider || 0);
    const slots = ensureHomeArenaSlots();
    if (slots[idx]) {
      const cand = availableArenaCompetitors().find((c) => c.provider === event.target.value);
      slots[idx].provider = event.target.value;
      slots[idx].model = cand?.model || "";
      slots[idx].effort = cand?.effort || "medium";
      view.homeArenaSlots = [...slots];
      render();
    }
    return;
  }
  if (event.target.matches("[data-arena-slot-model]")) {
    const idx = Number(event.target.dataset.arenaSlotModel || 0);
    const slots = ensureHomeArenaSlots();
    if (slots[idx]) {
      slots[idx].model = event.target.value;
      view.homeArenaSlots = [...slots];
      render();
    }
    return;
  }
  if (event.target.matches("[data-arena-slot-effort]")) {
    const idx = Number(event.target.dataset.arenaSlotEffort || 0);
    const slots = ensureHomeArenaSlots();
    if (slots[idx]) {
      slots[idx].effort = event.target.value;
      view.homeArenaSlots = [...slots];
      render();
    }
    return;
  }
  if (event.target.matches("[data-content-file-import]")) { void importContentFiles(event.target); return; }
  if (event.target.matches("[data-task-preset-version]")) syncTaskPresetControls(event.target.closest("form"));
  if (event.target.matches("select[name=workflow], select[name=workspaceId]")) { syncWorkflow(); syncIsolation(); }
  if (event.target.matches(".home-composer select[name=workflow]")) {
    view.homeWorkflow = event.target.value;
    view.homeMode = event.target.value === "chat-only" ? "chat" : event.target.value === "plan-only" ? "plan" : "code";
    render();
  }
  if (event.target.matches("[data-role-provider]")) {
    const roleId = event.target.dataset.roleProvider;
    const form = event.target.closest("form");
    syncRoleProvider(form, roleId);
    syncRolePickers(form, roleId);
    if (form?.classList.contains("home-composer")) {
      view.homeRoles[roleId] = { provider: event.target.value, model: form.querySelector(`[data-role-model="${roleId}"]`)?.value || "", effort: form.querySelector(`[data-role-effort="${roleId}"]`)?.value || "" };
      render();
    }
  }
  if (event.target.matches("[data-role-model]")) {
    const roleId = event.target.dataset.roleModel;
    const form = event.target.closest("form");
    syncEffortForModel(form, `[data-role-model="${roleId}"]`, `[data-role-effort="${roleId}"]`, `[data-role-provider="${roleId}"]`);
    syncRolePickers(form, roleId);
    if (form?.classList.contains("home-composer")) {
      view.homeRoles[roleId] = { provider: form.querySelector(`[data-role-provider="${roleId}"]`)?.value || "", model: event.target.value, effort: form.querySelector(`[data-role-effort="${roleId}"]`)?.value || "" };
      render();
    }
  }
  if (event.target.matches("[data-role-effort]")) {
    const roleId = event.target.dataset.roleEffort;
    const form = event.target.closest("form");
    syncRolePicker(form, roleId, "effort");
    if (form?.classList.contains("home-composer")) view.homeRoles[roleId] = { provider: form.querySelector(`[data-role-provider="${roleId}"]`)?.value || "", model: form.querySelector(`[data-role-model="${roleId}"]`)?.value || "", effort: event.target.value };
  }
  if (event.target.matches("[data-chat-agent-provider]")) {
    const form = event.target.closest("form");
    syncChatAgentFields(form);
    if (form?.classList.contains("home-composer")) {
      view.homeChatProvider = event.target.value;
      view.homeChatModel = form.querySelector("[data-chat-agent-model]")?.value || "";
      view.homeChatEffort = form.querySelector("[data-chat-agent-effort]")?.value || "";
      render();
    }
  }
  if (event.target.matches("[data-chat-agent-model]")) {
    const form = event.target.closest("form");
    syncEffortForModel(form, "[data-chat-agent-model]", "[data-chat-agent-effort]", "[data-chat-agent-provider]");
    if (form?.classList.contains("home-composer")) {
      view.homeChatModel = event.target.value;
      view.homeChatEffort = form.querySelector("[data-chat-agent-effort]")?.value || "";
      render();
    }
  }
  if (event.target.matches("[data-chat-agent-effort]")) view.homeChatEffort = event.target.value;
  if (event.target.matches("[data-home-workspace]")) { view.homeWorkspaceId = event.target.value; render(); }
  if (event.target.matches("[data-home-permission]")) { view.homePermissionPreset = event.target.value; }
  if (event.target.matches("[data-home-isolated]")) { view.homeIsolated = Boolean(event.target.checked); render(); }
  if (event.target.matches("[data-chat-provider]")) {
    view.chatProvider = event.target.value;
    view.chatModel = "";
    view.chatEffort = "";
    const task = view.state.tasks.find((item) => item.id === $(".task-chat-config-modal")?.dataset.id);
    if (task) openTaskInstructionModal(task); else render();
  }
  if (event.target.matches("[data-chat-model]")) {
    view.chatModel = event.target.value;
    const models = view.connectors?.[view.chatProvider]?.models || [];
    const model = models.find((item) => item.id === view.chatModel);
    view.chatEffort = model?.efforts?.includes("medium") ? "medium" : model?.efforts?.[0] || "";
    const task = view.state.tasks.find((item) => item.id === $(".task-chat-config-modal")?.dataset.id);
    if (task) openTaskInstructionModal(task); else render();
  }
  if (event.target.matches("[data-chat-effort]")) { view.chatEffort = event.target.value; }
  if (event.target.matches("[data-html-comment-agent]")) {
    const val = String(event.target.value || "");
    const [prov, mod] = val.includes("::") ? val.split("::") : [val, ""];
    view.stageHtmlCommentProvider = prov || "";
    view.stageHtmlCommentModel = mod || "";
    view.stageHtmlCommentDraft = String($("[data-html-element-comment-input]")?.value || view.stageHtmlCommentDraft || "");
    syncHtmlInspectUi();
  }
  if (event.target.matches("[data-html-comment-effort]")) {
    view.stageHtmlCommentEffort = event.target.value;
  }
});
document.addEventListener("input", (event) => {
  if (event.target.matches?.("[data-html-element-comment-input]")) {
    view.stageHtmlCommentDraft = event.target.value;
  }
});
window.addEventListener("message", (event) => {
  const frame = document.querySelector(".orca-live-frame");
  if (!frame || event.source !== frame.contentWindow) return;
  const data = event?.data;
  if (!data || typeof data !== "object") return;
  if (data.type === "orca-inspect:ready") {
    syncHtmlInspectUi();
  } else if (data.type === "orca-inspect:selected" && data.element) {
    view.stageHtmlInspectActive = true;
    view.stageHtmlSelectedElement = data.element;
    syncHtmlInspectUi({ focusInput: true });
  } else if (data.type === "orca-inspect:escape") {
    if (view.stageHtmlSelectedElement) {
      view.stageHtmlSelectedElement = null;
      view.stageHtmlCommentDraft = "";
      syncHtmlInspectUi();
    } else if (view.stageHtmlInspectActive) {
      view.stageHtmlInspectActive = false;
      syncHtmlInspectUi();
    }
  }
});
document.addEventListener("load", (event) => {
  if (event.target?.matches?.(".orca-live-frame:not(.is-pdf)")) {
    syncHtmlInspectUi();
  }
}, true);
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s" && view.page === "knowledge" && view.vaultEditing) {
    event.preventDefault();
    document.querySelector("[data-action='vault-save-note']")?.click();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault(); view.page = "chat"; view.selected = null; view.chatDraft = ""; render(); $(`[data-home-prompt]`)?.focus({ preventScroll: true }); return;
  }
  const activePopover = event.target.closest?.(".composer-input-wrap")?.querySelector("[data-mention-popover]:not([hidden])");
  if (activePopover && (event.key === "Tab" || event.key === "Enter") && !event.shiftKey) {
    const firstBtn = activePopover.querySelector("[data-action='insert-file-mention']");
    if (firstBtn) { event.preventDefault(); firstBtn.click(); return; }
  }
  if (activePopover && event.key === "Escape") {
    event.preventDefault();
    activePopover.hidden = true;
    view.mentionMenu = null;
    return;
  }
  const search = event.target.matches?.("[data-home-search]") ? event.target : null;
  if (search && event.key === "Enter") {
    event.preventDefault();
    document.querySelector("[data-home-search-results] button")?.click();
    return;
  }
  if (search && event.key === "Escape") {
    event.preventDefault();
    view.searchQuery = "";
    view.searchResults = "";
    search.value = "";
    const results = $("[data-home-search-results]");
    if (results) { results.hidden = true; results.innerHTML = ""; }
    return;
  }
  if (event.key === "Escape") {
    if (view.stageHtmlSelectedElement) {
      view.stageHtmlSelectedElement = null;
      view.stageHtmlCommentDraft = "";
      syncHtmlInspectUi();
      return;
    }
    if (view.stageHtmlInspectActive) {
      view.stageHtmlInspectActive = false;
      syncHtmlInspectUi();
      return;
    }
    closeOverlay();
  }
  if (event.key === "Enter" && !event.shiftKey && event.target.matches?.("[data-html-element-comment-input]")) {
    event.preventDefault();
    document.querySelector("[data-action='send-html-element-comment']")?.click();
    return;
  }
  if (event.key === "Enter" && event.target.matches?.("[data-stage-line-comment-input]")) {
    event.preventDefault();
    document.querySelector("[data-action='send-stage-line-comment']")?.click();
    return;
  }
  if (event.key === "Enter" && !event.shiftKey && event.target.matches?.(".chat-input, [data-home-prompt]")) { event.preventDefault(); event.target.closest("form")?.requestSubmit(); }
});
window.addEventListener("popstate", () => {
  Object.assign(view, readBrowserRoute());
  view.chatDraft = "";
  view.projectMenuId = "";
  view.filePreview = null;
  view.vaultPreview = null;
  view.workspaceEntries = [];
  view.vaultEntries = [];
  view.renderedPage = "";
  routeNeedsHydration = view.page === "knowledge" || (view.page === "workspaces" && Boolean(view.selected));
  closeOverlay();
  normalizeRouteSelection();
  const selectedTask = view.state?.tasks.find((task) => task.id === view.selected);
  if (selectedTask && view.page === "chat") {
    view.homeWorkspaceId = selectedTask.workspaceId;
    view.chatProvider = selectedTask.config?.workflow === "chat-only" ? selectedTask.config.chatProvider || "codex" : roleConfig(selectedTask.config, "plan").provider || "codex";
    view.chatModel = selectedTask.config?.workflow === "chat-only" ? selectedTask.config.chatModel || "" : roleConfig(selectedTask.config, "plan").model || "";
    view.chatEffort = selectedTask.config?.workflow === "chat-only" ? selectedTask.config.chatEffort || "" : roleConfig(selectedTask.config, "plan").effort || "";
  }
  render();
  if (view.state && routeNeedsHydration) {
    routeNeedsHydration = false;
    hydrateRouteData().catch((error) => showToast(error.message));
  }
});
const events = new EventSource("/__events");
events.addEventListener("update", () => scheduleRefresh(220));
events.addEventListener("open", () => {
  const changed = !view.streamConnected;
  view.streamConnected = true;
  if (changed && ["tasks", "chat"].includes(view.page)) render({ background: true });
  if (view.state) scheduleRefresh(0);
});
events.addEventListener("error", () => {
  if (!view.streamConnected) return;
  view.streamConnected = false;
  if (["tasks", "chat"].includes(view.page)) render({ background: true });
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleRefresh(80); });

(() => {
  try {
    const savedWidth = Number(localStorage.getItem("opensybau.right-dock-width"));
    if (savedWidth >= 220 && savedWidth <= 620) {
      document.documentElement.style.setProperty("--right-dock-width", `${savedWidth}px`);
    }
    const savedSplit = Number(localStorage.getItem("opensybau.stage-split-ratio"));
    if (savedSplit >= 28 && savedSplit <= 72) {
      document.documentElement.style.setProperty("--stage-split-ratio", `${savedSplit}%`);
    }
  } catch {}

  let resizingDock = false;
  let resizingSplit = false;
  document.addEventListener("pointerdown", (event) => {
    const dockHandle = event.target.closest?.("[data-right-dock-resizer]");
    if (dockHandle) {
      event.preventDefault();
      resizingDock = true;
      document.body.classList.add("is-resizing-dock");
      return;
    }
    const splitHandle = event.target.closest?.("[data-stage-split-resizer]");
    if (splitHandle) {
      event.preventDefault();
      resizingSplit = true;
      document.body.classList.add("is-resizing-dock");
    }
  });
  window.addEventListener("pointermove", (event) => {
    if (resizingDock) {
      const nextWidth = Math.max(220, Math.min(620, Math.round(window.innerWidth - event.clientX)));
      document.documentElement.style.setProperty("--right-dock-width", `${nextWidth}px`);
      return;
    }
    if (resizingSplit) {
      const splitContainer = document.querySelector(".orca-stage-split-layout");
      if (!splitContainer) return;
      const rect = splitContainer.getBoundingClientRect();
      if (rect.width <= 100) return;
      const pct = Math.max(28, Math.min(72, Math.round(((event.clientX - rect.left) / rect.width) * 100)));
      document.documentElement.style.setProperty("--stage-split-ratio", `${pct}%`);
    }
  });
  window.addEventListener("pointerup", () => {
    if (resizingDock) {
      resizingDock = false;
      document.body.classList.remove("is-resizing-dock");
      try {
        const raw = document.documentElement.style.getPropertyValue("--right-dock-width");
        const px = parseInt(raw, 10);
        if (px >= 220 && px <= 620) localStorage.setItem("opensybau.right-dock-width", String(px));
      } catch {}
    }
    if (resizingSplit) {
      resizingSplit = false;
      document.body.classList.remove("is-resizing-dock");
      try {
        const raw = document.documentElement.style.getPropertyValue("--stage-split-ratio");
        const pct = parseInt(raw, 10);
        if (pct >= 28 && pct <= 72) localStorage.setItem("opensybau.stage-split-ratio", String(pct));
      } catch {}
    }
  });
})();

refresh({ configuration: true });
setInterval(() => {
  if (document.hidden) return;
  if (!view.streamConnected || Date.now() - lastSnapshotRefresh >= 60_000) scheduleRefresh(0);
  if (view.page === "settings" && Date.now() - lastConfigurationRefresh > 300_000) void refresh({ configuration: true, background: true });
}, 30_000);

