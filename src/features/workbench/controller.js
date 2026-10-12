import { $, efforts, esc, fmtDate, formatNumber, icon, statuses, tokenCount, view } from "../../shared/state.js";
import { orchestrationNodes } from "../../domain/task-flow.js";
import { connectorSupports, providerTitle, providersForRole, roleConfig, workflowRoles } from "../../domain/agent-roles.js";
import { cliConnectionStatus, cliProviderGuides } from "../../domain/provider-guides.js";
import { localizeDom, setLanguage, translateText } from "../../shared/i18n.js";
import { updateWorkbenchShell } from "../../shell/mount.jsx";
import { readBrowserRoute, syncBrowserRoute } from "../../shell/router.js";
import { applyThemeColor, readThemeColors, resetThemeColor, resetThemeColors, themeColorControls } from "../../shared/theme.js";

Object.assign(view, readBrowserRoute());
document.documentElement.lang = view.language;
let browserRouteInitialized = false;
let replaceBrowserRoute = false;
let routeNeedsHydration = view.page === "knowledge" || view.page === "workspaces" && Boolean(view.selected);
let refreshPromise = null;
let refreshAgain = false;
let refreshConfiguration = false;
let refreshTimer = null;
let lastConfigurationRefresh = 0;
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
async function refreshSnapshot(includeConfiguration) {
  const statePromise = api("/api/state");
  const configurationPromise = includeConfiguration
    ? Promise.all([api("/api/connectors"), api("/api/providers").catch(() => ({ providers: [] }))])
    : Promise.resolve(null);
  const [state, configuration] = await Promise.all([statePromise, configurationPromise]);
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
  render();
  if (routeNeedsHydration) {
    routeNeedsHydration = false;
    hydrateRouteData().catch((error) => showToast(error.message));
  }
}
function refresh({ configuration = false } = {}) {
  refreshAgain = true;
  refreshConfiguration ||= configuration || !view.connectors;
  if (refreshPromise) return refreshPromise;
  refreshPromise = (async () => {
    try {
      while (refreshAgain) {
        refreshAgain = false;
        const includeConfiguration = refreshConfiguration;
        refreshConfiguration = false;
        await refreshSnapshot(includeConfiguration);
      }
    } catch (error) {
      refreshAgain = false;
      showToast(error.message);
    }
  })().finally(() => { refreshPromise = null; });
  return refreshPromise;
}
function scheduleRefresh(delay = 160) {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => { refreshTimer = null; void refresh(); }, delay);
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
function roleEditor(roleId, overrides = {}) {
  const role = workflowRoles.find((item) => item.id === roleId);
  if (!role) return "";
  const selection = normalizedRoleSelection(roleId, overrides);
  const connector = view.connectors?.[selection.provider];
  const model = connector?.models?.find((item) => item.id === selection.model);
  const providerOptions = selection.candidates.map(([id, item]) => `<option value="${esc(id)}" ${id === selection.provider ? "selected" : ""}>${esc(item.name || id)}${item.kind === "api" ? " · API" : " · CLI"}</option>`).join("");
  const modelOptions = (connector?.models || []).map((item) => `<option value="${esc(item.id)}" ${item.id === selection.model ? "selected" : ""}>${esc(item.name)}</option>`).join("");
  const effortOptions = (model?.efforts || []).map((item) => `<option value="${esc(item)}" ${item === selection.effort ? "selected" : ""}>${esc(item)}</option>`).join("");
  const providerHint = connector?.kind === "api" ? roleId === "build" ? "API ngoài · trả nội dung tệp" : "API ngoài · gửi ngữ cảnh" : connector ? "Agent cục bộ" : "Chưa có provider sẵn sàng";
  return `<section class="agent-role-card" data-role-card="${roleId}"><header><strong>${role.label}</strong><small>${selection.candidates.length ? esc(providerHint) : "Chưa có provider sẵn sàng"}</small></header><label>Agent<select name="${roleId}Provider" data-role-provider="${roleId}" ${providerOptions ? "required" : "disabled"}>${providerOptions || `<option value="">Chưa có agent khả dụng</option>`}</select></label><label>Model<select name="${roleId}Model" data-role-model="${roleId}" ${modelOptions ? "required" : "disabled"}>${modelOptions || `<option value="">Chưa có model</option>`}</select></label><label>Mức suy nghĩ<select name="${roleId}Effort" data-role-effort="${roleId}" ${effortOptions ? "required" : "disabled"}>${effortOptions || `<option value="">Không áp dụng</option>`}</select></label></section>`;
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
  return `<section class="task-preset-tools" aria-label="Mẫu tác vụ"><header><strong>Mẫu tác vụ</strong><small>Lưu cấu hình luồng, quyền và agent/model theo từng phiên bản.</small></header><div class="task-preset-controls"><label>Mẫu đã lưu<select name="taskPresetVersion" data-task-preset-version>${taskPresetVersionOptions()}</select></label><label>Tên mẫu<input name="taskPresetName" maxlength="80" autocomplete="off" placeholder="Ví dụ: Review pull request"></label><div class="task-preset-actions"><button type="button" class="button quiet small" data-action="apply-task-preset" disabled>Áp dụng</button><button type="button" class="button quiet small" data-action="save-task-preset">Lưu phiên bản</button><button type="button" class="button quiet small" data-action="delete-task-preset" disabled>Xóa mẫu</button></div></div><small class="task-preset-note">Không lưu yêu cầu, workspace hoặc trạng thái Git. Chọn mẫu rồi bấm Áp dụng để nạp cấu hình.</small><input type="hidden" name="appliedPresetId"><input type="hidden" name="appliedPresetVersion"></section>`;
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
  return `<section class="agent-role-card chat-agent-card"><header><strong>Agent hội thoại</strong><small>${connector?.kind === "api" ? "API bên ngoài · không có quyền workspace" : connector ? "Agent cục bộ" : "Chưa có provider sẵn sàng"}</small></header><label>Agent<select name="chatProvider" data-chat-agent-provider ${candidates.length ? "required" : "disabled"}>${candidates.map(([id, item]) => `<option value="${esc(id)}" ${id === provider ? "selected" : ""}>${esc(item.name || id)}${item.kind === "api" ? " · API" : " · CLI"}</option>`).join("") || `<option value="">Chưa có agent khả dụng</option>`}</select></label><label>Model<select name="chatModel" data-chat-agent-model ${model ? "required" : "disabled"}>${models.map((item) => `<option value="${esc(item.id)}" ${item.id === model?.id ? "selected" : ""}>${esc(item.name)}</option>`).join("") || `<option value="">Chưa có model</option>`}</select></label><label>Mức suy nghĩ<select name="chatEffort" data-chat-agent-effort ${model ? "required" : "disabled"}>${(model?.efforts || []).map((item) => `<option value="${esc(item)}" ${item === effort ? "selected" : ""}>${esc(item)}</option>`).join("") || `<option value="">Không áp dụng</option>`}</select></label></section>`;
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
  const roleId = task.phase === "implementation" ? "build" : task.phase;
  const provider = task.phase === "chat" ? providerTitle(view.connectors, task.chatQueue?.[0]?.provider || task.config.chatProvider || "codex") : providerTitle(view.connectors, task.config?.roles?.[roleId]?.provider || roleConfig(task.config, roleId)?.provider || "codex");
  return `<button class="task-row ${view.selected === task.id ? "selected" : ""}" data-task="${task.id}">
    <span class="task-state state-${task.status}"><i></i></span>
    <span class="task-primary"><strong>${esc(task.title)}</strong><small>${esc(workspace?.name || task.workspacePath)} <b>·</b> ${esc(taskProgress(task))}</small></span>
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
  const visible = all.filter((task) => view.filter === "all" || task.status === view.filter);
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
  if (view.selected) {
    const workspace = workspaces.find((item) => item.id === view.selected);
    if (workspace) return projectDetailPage(workspace);
  }
  const status = (w) => w.runtime ? `${w.runtime.isGit ? `Git · ${w.runtime.branch || "nhánh detached"}` : "Thư mục thường"}${w.runtime.head ? " · Có commit" : w.runtime.isGit ? " · Chưa có commit" : ""}${w.runtime.dirty ? " · Có thay đổi chưa commit" : ""}` : "Sẽ kiểm tra khi chạy task";
  return `<div class="page-head"><div><div class="eyebrow">PROJECT ROOTS</div><h1>Dự án</h1><p>Chỉ các đường dẫn bạn thêm mới được đưa vào bộ điều phối.</p></div><button class="button primary" data-action="add-workspace">${icon("plus", 15)} Thêm dự án</button></div>
  <section class="workspace-list">${workspaces.length ? workspaces.map((w) => `<article class="workspace-card"><div class="workspace-card-icon">${icon("folder-code", 17)}</div><div class="workspace-card-main"><strong>${esc(w.name)}</strong><code>${esc(w.path)}</code><small>${esc(status(w))}</small></div><button class="button quiet small" data-action="open-workspace" data-id="${w.id}">Mở dự án ${icon("chevron-right", 14)}</button><button class="icon-button" data-action="remove-workspace" data-id="${w.id}" title="Gỡ workspace" aria-label="Gỡ workspace">${icon("x", 16)}</button></article>`).join("") : `<div class="empty-state"><strong>Chưa có dự án</strong><p>Thêm đường dẫn repository hoặc thư mục làm việc trên máy.</p><button class="button primary" data-action="add-workspace">${icon("plus", 15)} Thêm dự án</button></div>`}</section>
  <aside class="info-panel"><strong>Task chạy ở đâu?</strong><p>Chế độ thường sửa trực tiếp thư mục này và chỉ cho một task chạy trong cùng workspace tại một thời điểm. Chế độ Git worktree tạo nhánh riêng; cần repository đã có commit. Task trên các workspace khác nhau có thể chạy song song.</p></aside>`;
}
function breadcrumbButtons(path, action) {
  const parts = String(path || "").split("/").filter(Boolean);
  const crumbs = [`<button class="path-crumb" data-action="${action}" data-path="">Thư mục gốc</button>`];
  let current = "";
  parts.forEach((part, index) => { current = current ? `${current}/${part}` : part; crumbs.push(`<span aria-hidden="true">/</span><button class="path-crumb" data-action="${action}" data-path="${esc(current)}" ${index === parts.length - 1 ? "aria-current=page" : ""}>${esc(part)}</button>`); });
  return crumbs.join("");
}
function localFileRows(entries, action, filter = "") {
  const query = filter.toLocaleLowerCase();
  const visible = (entries || []).filter((entry) => !query || entry.name.toLocaleLowerCase().includes(query));
  if (!visible.length) return `<li class="file-empty">${query ? "Không có tệp khớp bộ lọc." : "Thư mục trống."}</li>`;
  return visible.map((entry) => `<li data-file-entry><button class="file-row ${entry.type === "directory" ? "directory" : "file"}" data-action="${action}" data-path="${esc(entry.path)}" ${entry.type === "file" ? `aria-label="Mở ${esc(entry.name)}"` : "aria-expanded=false"}><span>${entry.type === "directory" ? icon("folder-code", 16) : icon("file", 16)}</span><strong title="${esc(entry.name)}">${esc(entry.name)}</strong>${entry.type === "file" ? `<small>${formatNumber(entry.size || 0)} B</small>` : icon("chevron-right", 14)}</button></li>`).join("");
}
function renderMarkdown(source) {
  const lines = String(source || "").split(/\r?\n/);
  const html = [];
  let paragraph = [], listType = "", codeLines = [], inCode = false;
  const inline = (text) => esc(text).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>").replace(/\[([^\]]+)\]\((https?:\/\/[^ )]+|obsidian:\/\/[^ )]+|#[^ )]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  const flushParagraph = () => { if (paragraph.length) { html.push(`<p>${paragraph.map(inline).join("<br>")}</p>`); paragraph = []; } };
  const closeList = () => { if (listType) { html.push(`</${listType}>`); listType = ""; } };
  for (const line of lines) {
    if (/^\s*```/.test(line)) { flushParagraph(); closeList(); if (inCode) { html.push(`<pre><code>${esc(codeLines.join("\n"))}</code></pre>`); codeLines = []; inCode = false; } else inCode = true; continue; }
    if (inCode) { codeLines.push(line); continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (!line.trim()) { flushParagraph(); closeList(); continue; }
    if (heading) { flushParagraph(); closeList(); const level = Math.min(heading[1].length, 4); html.push(`<h${level}>${inline(heading[2])}</h${level}>`); continue; }
    if (bullet || ordered) { flushParagraph(); const nextType = bullet ? "ul" : "ol"; if (listType !== nextType) { closeList(); listType = nextType; html.push(`<${listType}>`); } html.push(`<li>${inline((bullet || ordered)[1])}</li>`); continue; }
    const quote = line.match(/^>\s?(.*)$/); if (quote) { flushParagraph(); closeList(); html.push(`<blockquote>${inline(quote[1])}</blockquote>`); continue; }
    closeList(); paragraph.push(line);
  }
  flushParagraph(); closeList();
  if (inCode) html.push(`<pre><code>${esc(codeLines.join("\n"))}</code></pre>`);
  return html.join("") || `<p class="file-empty">Tệp Markdown đang trống.</p>`;
}
function filePreviewMarkup(file, title = "Chọn một tệp để xem") {
  if (!file) return `<div class="file-preview-empty">${icon("file", 19)}<p>${title}</p></div>`;
  const markdown = [".md", ".mdx", ".markdown"].includes(file.extension);
  const body = markdown ? `<article class="markdown-preview">${renderMarkdown(file.content)}</article>` : `<pre class="code-preview"><code>${esc(file.content)}</code></pre>`;
  return `<header class="file-preview-head"><div><strong>${esc(file.name)}</strong><small>${markdown ? "Markdown" : file.extension || "Tệp văn bản"} · ${formatNumber(file.size)} B · ${fmtDate(file.modifiedAt)}</small></div>${view.page === "knowledge" ? `<button class="button quiet small" data-action="open-obsidian" data-path="${esc(file.path)}">Mở trong Obsidian ${icon("arrow-up-right", 14)}</button>` : ""}</header>${body}`;
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
async function loadVaultDir(path = "") {
  view.page = "knowledge"; view.vaultDir = path; view.vaultPreview = null; view.vaultEntries = [];
  render();
  const data = await api(`/api/vault/files?path=${encodeURIComponent(path)}`);
  if (view.page !== "knowledge" || view.vaultDir !== path) return;
  if (view.vaultDir !== data.path) replaceBrowserRoute = true;
  view.vaultDir = data.path; view.vaultEntries = data.entries || []; render();
}
async function loadVaultPreview(path) {
  const file = await api(`/api/vault/file?path=${encodeURIComponent(path)}`);
  if (view.page !== "knowledge") return;
  view.vaultPreview = file; render();
}
function projectDetailPage(workspace) {
  const dirs = view.workspaceDir.split("/").filter(Boolean);
  return `<div class="page-head"><div><div class="eyebrow">PROJECT FILES</div><h1>${esc(workspace.name)}</h1><p>${esc(workspace.path)}</p></div><div class="page-head-actions"><button class="button quiet" data-action="back-projects">${icon("arrow-left", 15)} Danh sách dự án</button><button class="button primary" data-action="new-task">${icon("plus", 15)} Tạo task</button></div></div>
  <section class="file-workbench"><aside class="file-browser"><header><strong>Tệp dự án</strong><button class="icon-button" data-action="refresh-project-files" title="Tải lại tệp">${icon("refresh-cw", 15)}</button></header><label class="skill-search"><span>${icon("search", 15)}</span><input type="search" data-file-filter="workspace" placeholder="Lọc tệp trong thư mục này…" autocomplete="off"></label><nav class="file-breadcrumbs">${breadcrumbButtons(view.workspaceDir, "workspace-dir")}</nav><ul class="file-list">${view.workspaceDir ? `<li><button class="file-row parent" data-action="workspace-up"><span>${icon("chevron-right", 14)}</span><strong>Thư mục cha</strong></button></li>` : ""}${localFileRows(view.workspaceEntries, "workspace-file-action", view.fileFilter || "")}</ul>${view.workspaceEntries.length >= 500 ? `<p class="form-note">Đã giới hạn 500 mục; lọc tên hoặc mở thư mục con.</p>` : ""}</aside><section class="file-preview">${filePreviewMarkup(view.filePreview, "Chọn tệp code hoặc Markdown để xem nội dung")}</section></section>`;
}
function knowledgePage() {
  const vaultPath = view.state.settings.vaultPath || "";
  if (!vaultPath) return `<div class="page-head"><div><div class="eyebrow">OBSIDIAN · LOCAL VAULT</div><h1>Tri thức</h1><p>Kết nối vault để duyệt và đọc ghi chú Markdown trực tiếp trên máy.</p></div></div><section class="empty-state knowledge-empty"><strong>Chưa kết nối Obsidian vault</strong><p>OpenSybau chỉ đọc thư mục bạn chỉ định; nội dung không được đưa vào prompt tự động.</p><button class="button primary" data-action="connect-vault">${icon("plus", 15)} Kết nối vault</button></section>`;
  return `<div class="page-head"><div><div class="eyebrow">OBSIDIAN · LOCAL VAULT</div><h1>Tri thức</h1><p title="${esc(vaultPath)}">${esc(vaultPath)}</p></div><div class="page-head-actions"><button class="button quiet" data-action="disconnect-vault">Ngắt vault</button><button class="button" data-action="connect-vault">Đổi vault</button></div></div>
  <section class="file-workbench knowledge-workbench"><aside class="file-browser"><header><strong>Ghi chú</strong><button class="icon-button" data-action="refresh-vault-files" title="Tải lại ghi chú">${icon("refresh-cw", 15)}</button></header><label class="skill-search"><span>${icon("search", 15)}</span><input type="search" data-file-filter="vault" placeholder="Tìm ghi chú trong thư mục này…" autocomplete="off"></label><nav class="file-breadcrumbs">${breadcrumbButtons(view.vaultDir, "vault-dir")}</nav><ul class="file-list">${view.vaultDir ? `<li><button class="file-row parent" data-action="vault-up"><span>${icon("chevron-right", 14)}</span><strong>Thư mục cha</strong></button></li>` : ""}${localFileRows(view.vaultEntries, "vault-file-action", view.vaultFilter || "")}</ul></aside><section class="file-preview">${filePreviewMarkup(view.vaultPreview, "Chọn ghi chú để đọc · không nạp tự động vào AI")}</section></section>`;
}
function skillPage() {
  const sources = new Set(view.skills.flatMap((skill) => skill.sources || [skill.source])).size;
  const entries = view.skills.map((skill) => {
    const source = (skill.sources || [skill.source]).join(" · ");
    const search = `${skill.id} ${skill.name} ${skill.description} ${source} ${(skill.providers || []).join(" ")}`.toLocaleLowerCase();
    const action = skill.editable ? `<button class="button quiet small" data-action="edit-skill" data-id="${skill.id}">Sửa</button><button class="button danger small" data-action="delete-skill" data-id="${skill.id}">Xóa</button>` : `<button class="button quiet small" data-action="copy-skill" data-id="${skill.id}">Sao chép để sửa</button>`;
    return `<article class="skill-manager-row" data-skill-entry data-skill-search="${esc(search)}"><div class="skill-manager-main"><strong>${esc(skill.name)}</strong><p title="${esc(skill.description)}">${esc(skill.description)}</p><small>${esc(source)} · ${skill.editable ? "Có thể chỉnh sửa" : "Chỉ đọc từ plugin/CLI"}</small></div><div class="skill-manager-actions"><button class="button small" data-action="view-skill" data-id="${skill.id}">Xem</button>${action}</div></article>`;
  }).join("");
  return `<div class="page-head"><div><div class="eyebrow">SKILL LIBRARY · LOCAL</div><h1>Kỹ năng</h1><p>Xem, tạo và quản lý hướng dẫn cho đúng CLI; không sửa trực tiếp file do plugin sở hữu.</p></div><button class="button primary" data-action="new-skill">${icon("plus", 15)} Tạo skill</button></div><section class="settings-card skill-manager"><header><div><h2>${view.skills.length} skill · ${sources} nguồn</h2><p>Skill cá nhân cho phép sửa/xóa. Skill plugin và tích hợp sẵn có thể sao chép thành bản cá nhân.</p></div><button class="button" data-action="scan-skills">${icon("refresh-cw", 14)} Quét lại</button></header><label class="skill-search"><span>${icon("search", 15)}</span><input type="search" data-skill-filter="library" value="${esc(view.skillFilter)}" placeholder="Tìm theo tên, mô tả, ID, Codex hoặc Antigravity…" autocomplete="off"><small data-skill-result-count>${view.skills.length} skill</small></label><div class="skill-manager-list">${entries || `<p class="settings-empty">Chưa tìm thấy skill. Quét lại sau khi cài skill cá nhân.</p>`}</div><p class="skill-filter-empty" hidden>Không tìm thấy skill khớp nội dung tìm kiếm.</p></section>`;
}
function showSkillCreateModal() {
  const body = `<label>Tên skill<input name="name" maxlength="100" required placeholder="Ví dụ: review-api"></label><label>Mô tả ngắn<input name="description" maxlength="500" required placeholder="Khi nào và cách nào nên dùng skill này"></label><label>Dùng cho<select name="scope"><option value="shared">Codex và Antigravity</option><option value="codex">Chỉ Codex</option><option value="antigravity">Chỉ Antigravity</option></select></label><label>Hướng dẫn<textarea name="instructions" rows="9" placeholder="Quy trình, quy tắc và kết quả mong muốn…"></textarea></label><p class="form-note">Skill được lưu thành SKILL.md trong thư mục cá nhân của CLI. OpenSybau không ghi đè skill trùng tên.</p>`;
  showModal("Tạo skill", body, "Tạo skill", "skill-create");
}
async function showSkillView(id) {
  const { skill } = await api(`/api/skills/${encodeURIComponent(id)}`);
  const source = (skill.sources || [skill.source]).join(" · ");
  const actions = skill.editable ? `<button class="button" type="button" data-action="edit-skill" data-id="${skill.id}">Sửa skill</button>` : `<button class="button" type="button" data-action="copy-skill" data-id="${skill.id}">Sao chép để sửa</button>`;
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
  const body = `<label>Đường dẫn thư mục Obsidian vault<input name="vaultPath" required value="${esc(current)}" placeholder="D:\\Notes\\My Vault" autocomplete="off"></label><p class="form-note">OpenSybau chỉ đọc tệp Markdown bên trong thư mục này. Kết nối không tự đưa ghi chú vào ngữ cảnh task.</p>`;
  showModal(current ? "Đổi Obsidian vault" : "Kết nối Obsidian vault", body, "Kết nối", "vault");
}
function workflowNodes(task) {
  const nodes = orchestrationNodes(task);
  const labels = { complete: "Hoàn tất", active: "Đang chạy", queued: "Đang chờ", pending: "Chưa chạy", failed: "Lỗi", cancelled: "Đã dừng" };
  return nodes.map((node, index) => `<div class="workflow-step"><button class="workflow-node node-${node.state}" data-action="inspect-task" data-id="${task.id}" aria-label="${esc(node.title)} · ${labels[node.state] || "Chưa ghi nhận"}"><span class="workflow-node-mark">${icon(node.state === "complete" ? "check" : node.icon, 14)}</span><strong>${esc(node.title)}</strong><small>${esc(node.group)}</small><em>${labels[node.state] || "Chưa ghi nhận"}</em></button>${index < nodes.length - 1 ? `<span class="workflow-edge ${node.state === "complete" ? "edge-done" : ""}" aria-hidden="true">${icon("chevron-right", 16)}</span>` : ""}</div>`).join("");
}
function workflowPage() {
  if (view.selected && view.state.tasks.some((task) => task.id === view.selected)) return taskDetails();
  const tasks = view.state.tasks;
  const active = tasks.filter((task) => ["queued", "running"].includes(task.status));
  return `<div class="page-head"><div><div class="eyebrow">TASK ORCHESTRATION</div><h1>Luồng</h1><p>Xem sơ đồ từng bước, log hoạt động và đầu ra được ghi nhận cho mỗi cuộc trò chuyện.</p></div><button class="button primary" data-action="new-task">${icon("plus", 15)} Tạo task</button></div><div class="flow-summary"><div><small>Đang hoạt động</small><strong>${active.length}</strong></div><div><small>Có bản ghi</small><strong>${tasks.length}</strong></div><p>Chọn một luồng để xem chi tiết điều phối và đầu ra từng agent.</p></div>${tasks.length ? `<section class="workflow-board">${tasks.map((task) => `<article class="workflow-card"><header><button data-action="open-task-flow" data-id="${task.id}" class="workflow-task-title"><strong>${esc(task.title)}</strong><small>${esc(view.state.workspaces.find((workspace) => workspace.id === task.workspaceId)?.name || task.workspacePath)} · ${esc(taskProgress(task))}</small></button><span class="pill status-${task.status}"><i></i>${statuses[task.status]}</span></header><div class="workflow-lane">${workflowNodes(task)}</div><footer><span>${task.config.workflow === "chat-only" ? `Chat · ${providerTitle(view.connectors, task.config.chatProvider)}` : task.config.workflow === "plan-only" ? `${providerTitle(view.connectors, task.config?.roles?.plan?.provider || roleConfig(task.config, "plan")?.provider)} · chỉ lập kế hoạch` : workflowSummary(task)}</span><button class="workflow-record-link" data-action="open-task-flow" data-id="${task.id}">${icon("workflow", 14)} Mở bản ghi</button><time>${fmtDate(task.updatedAt)}</time></footer></article>`).join("")}</section>` : `<section class="empty-state workflow-empty"><strong>Chưa có bản ghi luồng</strong><p>Bản ghi điều phối sẽ xuất hiện tại đây khi một cuộc trò chuyện hoặc task được tạo trong workspace.</p><button class="button primary" data-action="new-task">${icon("plus", 15)} Tạo task đầu tiên</button></section>`}`;
}
function memoryPage() {
  const notes = view.state.memories;
  return `<div class="page-head"><div><div class="eyebrow">LOCAL MEMORY</div><h1>Bộ nhớ</h1><p>Ghi chú lưu trong máy này. Task chỉ nhận tối đa ba ghi chú có từ khóa phù hợp.</p></div><button class="button primary" data-action="new-memory">${icon("plus", 15)} Thêm ghi nhớ</button></div>
  <section class="memory-list">${notes.length ? notes.map((m) => `<article class="memory-card"><div><strong>${esc(m.title)}</strong><small>${m.workspaceId === "all" ? "Dùng chung" : esc(view.state.workspaces.find((w) => w.id === m.workspaceId)?.name || "Workspace đã gỡ")} · ${fmtDate(m.createdAt)}</small></div><p>${esc(m.content)}</p><button class="icon-button" data-action="delete-memory" data-id="${m.id}" title="Xóa ghi nhớ" aria-label="Xóa ghi nhớ">${icon("x", 16)}</button></article>`).join("") : `<div class="empty-state"><div class="empty-symbol">${icon("brain", 18)}</div><strong>Chưa có ghi nhớ lưu</strong><p>Mọi ghi nhớ đều bắt đầu từ nội dung bạn tự lưu. OpenSybau không bịa dữ liệu hoặc tự lấy toàn bộ vault vào prompt.</p><button class="button primary" data-action="new-memory">${icon("plus", 15)} Thêm ghi nhớ</button></div>`}</section>`;
}
function settingsPage() {
  const defaults = view.state.settings.defaults || {};
  const canSaveRoles = workflowRoles.every((role) => providersForRole(view.connectors, role.id).length > 0);
  const apiSetup = (view.providers || []).map((provider) => `<div class="provider-setup-row"><span class="provider-status-dot ${provider.available ? "ready" : "missing"}"></span><div><strong>${esc(provider.name)} <span class="provider-protocol">${provider.managedBy === "local" ? "OpenSybau" : "Từ biến môi trường"}</span></strong><small>${provider.available ? `${provider.models.length} model · đã cấu hình${provider.apiKeyConfigured ? " · API key đã lưu" : ""}` : esc(provider.error || "Chưa đủ cấu hình")} · ${esc(provider.baseUrl)}</small></div><div class="provider-row-actions">${provider.managedBy === "local" ? `<button class="button quiet small" type="button" data-action="provider-edit" data-id="${esc(provider.id)}">Sửa</button><button class="button quiet small" type="button" data-action="provider-delete" data-id="${esc(provider.id)}">Xóa</button>` : `<button class="button quiet small" type="button" data-action="provider-import-env" data-id="${esc(provider.id)}">Quản lý trong app</button>`}</div></div>`).join("");
  const cliSetup = cliProviderGuides.map((agent) => {
    const connector = view.connectors?.[agent.id];
    const status = cliConnectionStatus(connector);
    const action = status.tone === "missing"
      ? `<a class="button quiet small" href="${agent.url}" target="_blank" rel="noreferrer">Hướng dẫn cài</a>`
      : status.tone === "ready"
        ? `<button class="button quiet small" type="button" data-action="provider-cli-refresh">${icon("refresh-cw", 13)} Quét lại</button>`
        : `<button class="button quiet small" type="button" data-action="provider-cli-login" data-id="${agent.id}">Mở terminal đăng nhập</button>`;
    const detail = status.tone === "ready"
      ? `${connector.models.length} model${connector.models.length === 1 ? "" : "s"}${connector.version && connector.version !== "unavailable" ? ` · ${connector.version}` : ""}`
      : status.tone === "missing" ? agent.installHelp : connector?.installed && connector?.error ? connector.error : agent.summary;
    return `<article class="cli-guide-row"><span class="cli-guide-icon">${icon("square-terminal", 16)}</span><div><strong>${esc(agent.name)} <span class="cli-guide-status ${status.tone}">${status.label}</span></strong><small>${esc(detail)}</small></div>${action}</article>`;
  }).join("");
  const noReadyConnector = !Object.values(view.connectors || {}).some((connector) => connector?.available && connector.capabilities?.plan);
  return `<div class="page-head"><div><div class="eyebrow">PREFERENCES & MODELS</div><h1>Cài đặt</h1><p>Chọn model mặc định cho từng vai trò và kết nối nguồn AI dùng chung cho các task.</p></div></div>
  <form class="settings-form" data-modal data-form="settings">
    <section class="settings-card"><header><div><h2>Ai ra lệnh, ai thực hiện</h2><p>Chọn model lập kế hoạch (ra lệnh), model triển khai (thực hiện) và model review. Mỗi task vẫn có thể dùng bộ model khác.</p></div></header>
        ${noReadyConnector ? `<div class="provider-connect-callout"><span class="provider-connect-icon">${icon("plug-zap", 17)}</span><div><strong>Chưa kết nối nguồn AI nào</strong><p>Thêm API/model local hoặc cài, đăng nhập CLI. Sau đó bạn có thể gán riêng model lập kế hoạch, triển khai và review.</p></div><div><button class="button primary small" type="button" data-action="provider-add">Kết nối API / model local</button><button class="button quiet small" type="button" data-action="provider-connect-cli">Kết nối CLI agent</button></div></div>` : ""}
      <div class="agent-role-grid settings-role-grid">${workflowRoles.map((role) => roleEditor(role.id, defaults.roles?.[role.id] || roleConfig(defaults, role.id))).join("")}</div>
      <div class="form-note">Khi chọn model API, yêu cầu và ngữ cảnh dự án tương ứng sẽ được gửi tới dịch vụ đó. Model CLI chạy cục bộ theo quyền của CLI.</div>
      ${view.settingsSupported ? "" : `<div class="feature-warning">Server đang chạy phiên bản cũ. Model vẫn chọn theo từng task; hãy khởi động lại server để bật lưu model mặc định và gắn skill.</div>`}
      <footer class="settings-actions"><button class="button primary" type="submit" ${view.settingsSupported && canSaveRoles ? "" : "disabled"}>Lưu định tuyến mặc định</button></footer>
    </section>
    <section class="settings-card cli-setup-card" id="cli-setup"><header><div><h2>Agent CLI</h2><p>OpenSybau tự dò Codex, Antigravity và Claude Code trên máy. Nếu CLI đã cài nhưng chưa đăng nhập, mở terminal đăng nhập ngay tại đây.</p></div><button class="button quiet small" type="button" data-action="provider-cli-refresh">${icon("refresh-cw", 13)} Quét lại</button></header><div class="cli-guide-list">${cliSetup}</div><p class="form-note">Terminal được mở trên máy đang chạy OpenSybau. Hoàn tất OAuth hoặc đăng nhập ở đó rồi chọn Quét lại; CLI không cần khai báo API key riêng.</p></section>
    <section class="settings-card provider-setup-card"><header><div><h2>Nguồn API và model local</h2><p>Kết nối OpenAI/ChatGPT API, Google Gemini API, Claude API, Ollama, LM Studio hoặc endpoint tương thích.</p></div><button class="button primary small" type="button" data-action="provider-add">${icon("plus", 14)} Thêm nguồn</button></header><div class="provider-setup-list">${apiSetup || `<div class="provider-empty-state"><strong>Chưa có API hoặc model local</strong><p>Chọn cấu hình nhanh để nhập API key và model, hoặc kết nối Ollama/LM Studio. Bạn không cần API nếu dùng CLI.</p><button class="button quiet small" type="button" data-action="provider-add">${icon("plus", 13)} Thêm API hoặc model local</button></div>`}${view.connectors?.apiConfigurationError ? `<p class="provider-config-error">${esc(view.connectors.apiConfigurationError)}</p>` : ""}</div><details class="provider-env-help"><summary>Hướng dẫn kết nối cloud và model local</summary><p><strong>OpenAI / ChatGPT API:</strong> chọn cấu hình sẵn, nhập API key OpenAI rồi tải model. <strong>Google Gemini API:</strong> chọn Google Gemini, nhập key Google AI Studio rồi tải model. <strong>Claude API:</strong> chọn Claude API, nhập Anthropic key và model.</p><p><strong>Ollama:</strong> dùng endpoint <code>http://localhost:11434/v1</code> và ID từ <code>ollama list</code>. <strong>LM Studio:</strong> dùng endpoint <code>http://localhost:1234/v1</code>. Thường không cần API key.</p><p>API key được lưu trong thư mục dữ liệu riêng của OpenSybau, không hiển thị lại trong giao diện. Chỉ nhập key qua localhost hoặc HTTPS; provider API không có quyền chạy lệnh trong workspace.</p></details></section>
    <section class="settings-card concurrency-card"><header><div><h2>Tác vụ chạy đồng thời</h2><p>Giới hạn số task có thể chạy cùng lúc trên các workspace.</p></div></header>
      <div class="concurrency-setting"><span>Giới hạn hiện tại</span><div><button type="button" data-action="parallel-minus" aria-label="Giảm task chạy đồng thời">−</button><strong id="parallel-value">${view.state.settings.maxConcurrent || 2}</strong><button type="button" data-action="parallel-plus" aria-label="Tăng task chạy đồng thời">+</button></div></div>
    </section>
  </form>`;
}

function designSystemPage() {
  const colors = readThemeColors();
  const groups = [...new Set(themeColorControls.map((control) => control.group))];
  const controls = groups.map((group) => `<section class="settings-card appearance-color-group"><header><div><h2>${esc(group)}</h2></div></header><div class="appearance-color-list">${themeColorControls.filter((control) => control.group === group).map((control) => `<div class="appearance-color-row" data-theme-row="${control.id}"><label for="theme-color-${control.id}"><strong>${esc(control.label)}</strong><small>${esc(control.description)}</small></label><div class="appearance-color-fields"><input id="theme-color-${control.id}" class="appearance-color-picker" type="color" value="${colors[control.id]}" data-theme-color="${control.id}" aria-label="Chọn màu: ${esc(control.label)}"><input class="appearance-color-hex" type="text" value="${colors[control.id]}" maxlength="7" pattern="#[0-9a-fA-F]{6}" spellcheck="false" autocomplete="off" data-theme-color="${control.id}" aria-label="Mã màu: ${esc(control.label)}"><button class="icon-button appearance-color-reset" type="button" data-action="reset-theme-color" data-theme-color="${control.id}" aria-label="Khôi phục màu mặc định: ${esc(control.label)}" title="Khôi phục mặc định">${icon("rotate-cw", 14)}</button></div></div>`).join("")}</div></section>`).join("");
  return `<div class="page-head appearance-page-head"><div><div class="eyebrow">OPENSYBAU · GIAO DIỆN</div><h1>Giao diện</h1><p>Tùy chỉnh màu của từng thành phần. Thay đổi được áp dụng ngay và lưu trên máy này.</p></div><button class="button quiet" type="button" data-action="reset-theme-colors">Khôi phục mặc định</button></div>
    <div class="appearance-settings"><section class="settings-card appearance-preview"><header><div><h2>Xem trước</h2><p>Thay đổi màu để xem giao diện cập nhật ngay.</p></div></header><div class="appearance-preview-surface"><div class="appearance-preview-heading"><span class="appearance-preview-mark">${icon("workflow", 16)}</span><span><strong>Workspace mẫu</strong><small>Thẻ và trạng thái giao diện</small></span><span class="pill status-done"><i></i>Sẵn sàng</span></div><div class="appearance-preview-body"><strong>Nội dung hiển thị</strong><p>Chữ chính, chữ phụ, viền và màu nền được dùng xuyên suốt ứng dụng.</p><input value="Ô nhập mẫu" readonly aria-label="Ví dụ ô nhập"><div><button class="button quiet small" type="button">Nút phụ</button><button class="button primary small" type="button">Nút chính</button></div></div></div></section><div class="appearance-color-grid">${controls}</div></div>`;
}

function syncThemeColorRow(id, color = readThemeColors()[id]) {
  const row = document.querySelector(`[data-theme-row="${CSS.escape(id)}"]`);
  if (!row) return;
  row.querySelectorAll("[data-theme-color]").forEach((input) => { input.value = color; });
}

function updateThemeColorInput(input) {
  const id = input.dataset.themeColor;
  if (!themeColorControls.some((control) => control.id === id)) return false;
  let color = input.value.trim();
  if (!color.startsWith("#") && /^[\da-f]{6}$/i.test(color)) color = `#${color}`;
  if (!/^#[\da-f]{6}$/i.test(color) || !applyThemeColor(id, color)) return true;
  syncThemeColorRow(id, color.toLowerCase());
  return true;
}

function showApiProviderModal(provider = null) {
  const editing = Boolean(provider);
  const models = (provider?.models || []).map((model) => model.id).join("\n");
  const sourceChoice = editing ? "" : `<section class="provider-cli-entry"><span class="provider-connect-icon">${icon("square-terminal", 17)}</span><div><strong>Thêm Codex, Antigravity hoặc Claude CLI</strong><p>OpenSybau tự dò công cụ đã cài. Nếu chưa đăng nhập, ứng dụng mở terminal giúp bạn; không cần API key hay endpoint.</p></div><button class="button quiet small" type="button" data-action="provider-connect-cli">Thêm / kết nối CLI</button></section>`;
  const body = `${sourceChoice}<div class="provider-presets" aria-label="Cấu hình nhanh"><span>Chọn dịch vụ API hoặc model local</span><div><button type="button" class="button quiet small" data-action="provider-preset" data-preset="openai">OpenAI / ChatGPT</button><button type="button" class="button quiet small" data-action="provider-preset" data-preset="gemini">Google Gemini</button><button type="button" class="button quiet small" data-action="provider-preset" data-preset="anthropic">Claude API</button><button type="button" class="button quiet small" data-action="provider-preset" data-preset="local">Model local / khác</button></div><nav class="provider-key-links" aria-label="Tạo API key"><a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">Tạo OpenAI key</a><a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Tạo Gemini key</a><a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">Tạo Claude key</a></nav></div><label>Tên hiển thị<input name="name" required maxlength="80" value="${esc(provider?.name || "")}" placeholder="Ví dụ: Ollama · Qwen local"></label><label>Giao thức<select name="protocol"><option value="openai" ${provider?.protocol === "openai" ? "selected" : ""}>OpenAI Responses API</option><option value="gemini" ${provider?.protocol === "gemini" ? "selected" : ""}>Google Gemini API</option><option value="anthropic" ${provider?.protocol === "anthropic" ? "selected" : ""}>Anthropic Messages API</option><option value="openai-compatible" ${!provider || provider?.protocol === "openai-compatible" ? "selected" : ""}>OpenAI-compatible · Ollama, LM Studio…</option></select></label><label>API endpoint<input name="baseUrl" required maxlength="500" value="${esc(provider?.baseUrl || "")}" placeholder="http://localhost:11434/v1" autocomplete="url"><small>OpenAI-compatible: URL /v1 · Gemini: v1beta · HTTP chỉ dùng với localhost.</small></label><div class="provider-model-field"><label>Model ID<textarea name="models" required rows="4" spellcheck="false" placeholder="Chọn dịch vụ rồi bấm tải danh sách, hoặc nhập model ID">${esc(models)}</textarea><small>Mỗi dòng một ID chính xác. Danh sách chỉ gồm model được dịch vụ trả về cho key của bạn.</small></label><button class="button small" type="button" data-action="provider-discover-models">${icon("refresh-cw", 13)} Tải danh sách model</button></div>${editing ? `<input type="hidden" name="apiKeyRequired" value="${provider.apiKeyRequired ? "true" : "false"}">` : ""}<label>API key<input name="apiKey" type="password" maxlength="2048" autocomplete="new-password" placeholder="${editing && provider.apiKeyConfigured ? "Để trống để giữ key hiện tại" : "Nhập key của dịch vụ; model local có thể không cần"}"></label>${editing && provider.apiKeyConfigured ? `<label class="check-row"><input type="checkbox" name="clearApiKey" value="true"><span><strong>Xóa API key đã lưu</strong><small>Chỉ bật nếu muốn gỡ key khỏi cấu hình cục bộ.</small></span></label>` : ""}<p class="form-note">Đây là luồng API. CLI là kết nối riêng: OpenSybau tự dò và dùng phiên đăng nhập cục bộ của Codex, Antigravity hoặc Claude Code. API key được lưu trong thư mục dữ liệu OpenSybau; API OpenAI tính phí riêng với gói ChatGPT.</p>`;
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
      ? `<a class="button quiet small" href="${agent.url}" target="_blank" rel="noreferrer">Hướng dẫn cài</a>`
      : status.tone === "ready"
        ? `<button class="button quiet small" type="button" data-action="provider-cli-refresh">${icon("refresh-cw", 13)} Đã kết nối · quét lại</button>`
        : `<button class="button primary small" type="button" data-action="provider-cli-login" data-id="${agent.id}">${icon("square-terminal", 13)} ${status.tone === "needs-action" && connector?.authenticated ? "Mở CLI để kiểm tra" : "Bắt đầu đăng nhập"}</button>`;
    const docsUrl = status.tone === "missing" ? agent.url : agent.authUrl || agent.url;
    const instructions = status.tone === "missing"
      ? `<div class="cli-connect-login"><span>Cài đặt CLI</span><small>${esc(agent.installHelp)}</small></div>`
      : `<div class="cli-connect-login"><span>Cách đăng nhập</span><code>${esc(agent.loginCommand)}</code><small>${esc(agent.loginHelp)}</small></div>`;
    return `<article class="cli-connect-card ${status.tone}"><header><span class="cli-connect-mark">${icon("square-terminal", 17)}</span><div><h3>${esc(agent.name)}</h3><span class="cli-guide-status ${status.tone}">${esc(status.label)}</span></div></header><p>${esc(detail)}</p>${instructions}<footer>${primary}<a href="${docsUrl}" target="_blank" rel="noreferrer">Tài liệu chính thức</a></footer></article>`;
  }).join("");
  const body = `<div class="cli-connect-intro"><span class="provider-connect-icon">${icon("workflow", 17)}</span><div><strong>OpenSybau tự dò CLI trên máy chủ</strong><p>CLI đã cài và đăng nhập sẽ tự xuất hiện trong danh sách nguồn AI, không cần thêm endpoint. Nếu chưa cài, mở hướng dẫn của hãng rồi quét lại; nếu chưa đăng nhập, bấm Bắt đầu đăng nhập để mở terminal.</p></div><button class="button quiet small" type="button" data-action="provider-cli-refresh">${icon("refresh-cw", 13)} Quét lại</button></div><div class="cli-connect-list">${rows}</div><p class="cli-connect-feedback" role="status" aria-live="polite" hidden></p><p class="form-note">CLI dùng tài khoản riêng, không cần API key. Nếu bạn dùng OpenSybau từ điện thoại, terminal sẽ mở trên máy chủ; hoàn tất đăng nhập tại máy đó rồi bấm Quét lại.</p>`;
  showModal("Thêm / kết nối CLI agent", body, "Xong", "dismiss");
  $(".modal-actions .button.quiet")?.remove();
}
function apiProviderId(name) {
  return String(name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}
function render() {
  if (!view.state) return;
  syncLocation();
  const pages = { chat: chatPage, tasks: taskPage, flows: workflowPage, workspaces: workspacePage, knowledge: knowledgePage, skills: skillPage, memory: memoryPage, settings: settingsPage, "design-system": designSystemPage };
  const content = $("#content");
  const renderKey = `${view.page}:${view.selected || ""}`;
  const contentScroll = view.renderedPage === renderKey ? content.scrollTop : 0;
  const previousChat = $("#chat-thread", content);
  const chatAtEnd = previousChat && previousChat.scrollHeight - previousChat.scrollTop - previousChat.clientHeight < 48;
  const chatScroll = previousChat?.scrollTop || 0;
  const chatTaskChanged = previousChat && previousChat.dataset.taskId !== String(view.selected || "");
  const shouldScrollChatToEnd = Boolean(view.forceChatScroll || !previousChat || chatTaskChanged || chatAtEnd);
  view.forceChatScroll = false;
  const activeComposer = document.activeElement?.closest?.(".chat-composer") ? document.activeElement.name : "";
  const previousSelection = activeComposer === "message" ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
  const selectedTask = view.selected && view.state.tasks.some((task) => task.id === view.selected);
  const pageMarkup = (pages[view.page] || taskPage)();
  updateWorkbenchShell({ page: view.page, language: view.language, state: view.state, connectors: view.connectors, desktopSetupOpen: view.desktopSetupOpen, skills: view.skills, selected: selectedTask ? view.selected : null, homeWorkspaceId: view.homeWorkspaceId, searchQuery: view.searchQuery, searchResults: homeSearchResults(view.searchQuery), collapsedWorkspaces: view.collapsedWorkspaces, projectMenuId: view.projectMenuId, taskMenuId: view.taskMenuId }, pageMarkup);
  localizeDom(document.querySelector("#root"), view.language);
  localizeDom(document.querySelector("#overlay"), view.language);
  const nextContent = $("#content");
  nextContent.scrollTop = contentScroll;
  view.renderedPage = renderKey;
  const nextChat = $("#chat-thread", nextContent);
  if (nextChat) nextChat.scrollTop = shouldScrollChatToEnd ? nextChat.scrollHeight : chatScroll;
  if (activeComposer) {
    const nextInput = $(`.chat-composer [name="${activeComposer}"]`, nextContent);
    nextInput?.focus({ preventScroll: true });
    if (previousSelection && nextInput?.setSelectionRange) nextInput.setSelectionRange(...previousSelection);
  }
  if (view.page === "skills") applySkillFilter($("[data-skill-filter=library]", nextContent));
  const overlay = $("#overlay");
  if (!overlay.querySelector(".modal")) {
    overlay.innerHTML = "";
  }
  syncWorkflow();
}
function chatPage() {
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
  const canRun = workflow === "chat-only" ? Boolean(chatSelection.connector?.available) : workflow === "plan-only" ? planReady : pipelineReady;
  const workflowOptions = `<option value="chat-only" ${workflow === "chat-only" ? "selected" : ""}>Chat · một agent</option><option value="codex-antigravity" ${workflow === "codex-antigravity" ? "selected" : ""} ${pipelineReady ? "" : "disabled"}>Pipeline · Kế hoạch → Triển khai → Review</option><option value="plan-only" ${workflow === "plan-only" ? "selected" : ""} ${planReady ? "" : "disabled"}>Chỉ lập kế hoạch</option>`;
  const pipelineLabel = workflowRoles.map((role) => providerTitle(view.connectors, roleSelections[role.id].provider)).join(" → ");
  const workflowLabel = workflow === "chat-only" ? `Chat · ${providerTitle(view.connectors, chatSelection.provider)}` : workflow === "plan-only" ? `${providerTitle(view.connectors, roleSelections.plan.provider)} · lập kế hoạch` : pipelineLabel;
  const activeWorkspaceId = workspaces.some((workspace) => workspace.id === view.homeWorkspaceId) ? view.homeWorkspaceId : workspaces[0]?.id || "";
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const chatProviders = Object.entries(view.connectors || {}).filter(([, connector]) => connectorSupports(connector, "chat"));
  const homeModelSummary = workflow === "chat-only" ? chatSelection.model?.name || "Chưa có model" : workflow === "plan-only" ? roleSelections.plan.model || "Chưa có model" : workflowRoles.map((role) => roleSelections[role.id].model || "Chưa có model").join(" · ");
  const homeConfigSummary = `${activeWorkspace?.name || "Chọn workspace"} · ${workflowLabel} · ${homeModelSummary}`;
  return `<section class="command-home">
    <div class="command-stage"><div class="home-welcome"><p class="home-kicker">OPENSYBAU · ${esc(activeWorkspace?.name || "CHỌN WORKSPACE")}</p><h1>${activeWorkspace ? `Bạn muốn làm gì trong ${esc(activeWorkspace.name)}?` : "Bạn muốn làm gì?"}</h1><p class="home-subtitle">Bắt đầu một cuộc trò chuyện hoặc giao việc cho các agent đang chạy trên máy.</p></div>
      ${chatProviders.length ? "" : `<div class="provider-connect-callout home-provider-empty"><span class="provider-connect-icon">${icon("plug-zap", 17)}</span><div><strong>Chưa có agent sẵn sàng</strong><p>Kết nối API/model local hoặc cài và đăng nhập Codex, Claude Code hay Antigravity để bắt đầu.</p></div><div><button class="button primary small" type="button" data-action="desktop-open-settings">Mở cài đặt</button><button class="button quiet small" type="button" data-action="open-setup-assistant">Hướng dẫn</button></div></div>`}
      <div class="home-mode-switch" role="tablist" aria-label="Chế độ làm việc"><button type="button" class="home-mode-tab ${view.homeMode === "chat" ? "active" : ""}" data-home-mode="chat">Chat</button><button type="button" class="home-mode-tab ${view.homeMode === "code" ? "active" : ""}" data-home-mode="code" ${pipelineReady ? "" : "disabled title=\"Cần agent có quyền làm việc trên workspace\""}>Code</button><button type="button" class="home-mode-tab ${view.homeMode === "plan" ? "active" : ""}" data-home-mode="plan" ${planReady ? "" : "disabled"}>Lập kế hoạch</button><button type="button" class="home-mode-link" data-page="tasks">${view.state.tasks.length} task</button></div>
      <form class="home-composer" data-modal data-form="home-task">
        <textarea name="prompt" data-home-prompt required minlength="6" maxlength="12000" rows="3" placeholder="${workflow === "chat-only" ? `Nhắn ${providerTitle(view.connectors, chatSelection.provider)}…` : workflow === "plan-only" ? "Mô tả vấn đề cần phân tích và lập kế hoạch…" : "Mô tả thay đổi cần triển khai trong workspace…"}">${esc(view.chatDraft)}</textarea>
        <footer class="home-composer-controls"><span class="auto-skill-chip">${icon("notebook-tabs", 14)} Tự chọn skill · ${view.skills.length}</span><div class="home-composer-actions"><button type="button" class="home-composer-settings" data-action="toggle-home-config" aria-label="Cấu hình workspace, agent và model" aria-expanded="${view.homeConfigOpen}" title="Workspace, agent, model và mức suy nghĩ">${icon("settings-2", 15)}<span>${esc(homeConfigSummary)}</span>${icon("chevron-down", 14)}</button><button class="home-submit" type="submit" aria-label="${workflow === "chat-only" ? "Gửi tin nhắn" : "Chạy task"}" title="${workflow === "chat-only" ? "Gửi tin nhắn" : "Chạy task"}" ${workspaces.length && canRun ? "" : "disabled"}>${icon("arrow-up-right", 17)}</button></div></footer>
        <div class="composer-config-backdrop home-config-backdrop" ${view.homeConfigOpen ? "" : "hidden"}><section class="composer-config-dialog app-dialog-shell" role="dialog" aria-modal="true" aria-label="Cấu hình tác vụ"><header class="app-dialog-header"><div><small>OPENSYBAU</small><h2>Cấu hình tác vụ</h2></div><button type="button" class="icon-button" data-action="close-composer-config" aria-label="Đóng">${icon("x", 16)}</button></header><div class="app-dialog-content composer-config-content"><div class="composer-config-grid"><label>Workspace<select name="workspaceId" data-home-workspace required ${workspaces.length ? "" : "disabled"}>${workspaces.length ? workspaces.map((workspace) => `<option value="${workspace.id}" ${workspace.id === activeWorkspaceId ? "selected" : ""}>${esc(workspace.name)}</option>`).join("") : `<option value="">Thêm workspace để bắt đầu</option>`}</select></label><label>Luồng<select name="workflow" data-home-workflow>${workflowOptions}</select></label></div><div class="chat-agent-role" ${workflow === "chat-only" ? "" : "hidden"}>${chatAgentEditor({ provider: chatSelection.provider, model: chatSelection.model?.id, effort: chatSelection.effort })}</div><div class="agent-role-grid home-role-grid" ${workflow === "chat-only" ? "hidden" : ""}>${workflowRoles.map((role) => roleEditor(role.id, roleSelections[role.id])).join("")}</div></div><footer class="app-dialog-footer"><span>${icon("notebook-tabs", 14)} Skill tự chọn · ${view.skills.length} · Tối đa ${view.state.settings.maxConcurrent} task song song</span><button type="button" class="button primary" data-action="close-composer-config">Xong</button></footer></section></div>
      </form>
      ${!workspaces.length ? `<button class="home-add-workspace" data-action="add-workspace">${icon("plus", 15)} Thêm workspace để bắt đầu</button>` : ""}
    </div>
  </section>`;
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
function taskConversationPage() {
  const task = view.state.tasks.find((item) => item.id === view.selected);
  if (!task) return "";
  const workflow = task.config?.workflow || "codex-antigravity";
  const planRole = roleConfig(task.config, "plan");
  const buildRole = roleConfig(task.config, "build");
  const reviewRole = roleConfig(task.config, "review");
  const messages = task.chatMessages || [];
  const hasInitialMessage = messages.some((message) => message.role === "user" && message.initialChat);
  const transcript = [];
  if (!hasInitialMessage && task.prompt) transcript.push({ role: "user", provider: "user", content: task.prompt, createdAt: task.createdAt });
  if (workflow !== "chat-only") {
    if (task.plan) transcript.push({ role: "assistant", provider: planRole.provider, label: `Kế hoạch · ${providerTitle(view.connectors, planRole.provider)}`, model: planRole.model, effort: planRole.effort, content: task.plan, createdAt: task.createdAt });
    if (task.implementation) transcript.push({ role: "assistant", provider: buildRole.provider, label: `Triển khai · ${providerTitle(view.connectors, buildRole.provider)}`, model: buildRole.model, effort: buildRole.effort, content: task.implementation, createdAt: task.updatedAt });
    if (task.review) transcript.push({ role: "assistant", provider: reviewRole.provider, label: `Review · ${providerTitle(view.connectors, reviewRole.provider)}`, model: reviewRole.model, effort: reviewRole.effort, content: task.review, createdAt: task.updatedAt });
  }
  transcript.push(...orderedConversationMessages(messages));
  const busy = ["queued", "running"].includes(task.status);
  const provider = view.chatProvider || (workflow === "chat-only" ? task.config.chatProvider : planRole.provider) || "codex";
  const models = view.connectors?.[provider]?.models || [];
  const modelId = view.chatModel || (workflow === "chat-only" ? task.config.chatModel : planRole.model) || models[0]?.id || "";
  const model = models.find((item) => item.id === modelId) || models[0];
  const effort = view.chatEffort || (workflow === "chat-only" ? task.config.chatEffort : planRole.effort) || model?.efforts?.find((item) => item === "medium") || model?.efforts?.[0] || "";
  const canSend = Boolean(model && view.connectors?.[provider]?.available && view.connectors?.[provider]?.capabilities?.chat && (provider !== "codex" || view.connectors?.codex?.authenticated));
  const queuedTurns = task.chatQueue || [];
  const hasActiveChatMessage = messages.some((message) => message.role === "user" && message.status === "running");
  const queueSummary = `${hasActiveChatMessage ? (view.language === "en" ? "Agent is replying" : "Agent đang trả lời") : ""}${queuedTurns.length ? `${hasActiveChatMessage ? " · " : ""}${view.language === "en" ? `${queuedTurns.length} queued` : `${queuedTurns.length} tin đang chờ`}` : ""}`;
  const totalUsage = Object.values(task.usage || {}).reduce((sum, item) => sum + tokenCount(item), 0);
  const transcriptHtml = transcript.length ? transcript.map((message) => {
    const isUser = message.role === "user";
    const sender = isUser ? "Bạn" : message.label || providerTitle(view.connectors, message.provider);
    const modelLabel = [message.model, message.effort].filter(Boolean).join(" · ");
    const queuePosition = message.status === "queued" ? queuedTurns.findIndex((turn) => turn.messageId === message.id) : -1;
    const pending = message.status === "queued" ? queuePosition >= 0 ? (view.language === "en" ? `Queued · ${queuePosition + 1}/${queuedTurns.length}` : `Trong hàng đợi · ${queuePosition + 1}/${queuedTurns.length}`) : (view.language === "en" ? "Queued" : "Đang chờ") : message.status === "running" ? (view.language === "en" ? "Agent is replying" : "Đang xử lý") : message.status === "failed" ? (view.language === "en" ? "Failed" : "Lỗi") : "";
    const content = message.content ? renderMarkdown(message.content) : "";
    const forkButton = isUser && message.id && (!message.status || message.status === "done") ? `<button type="button" class="chat-fork-button" data-action="fork-chat" data-id="${task.id}" data-message-id="${esc(message.id)}" title="Tạo nhánh hội thoại từ đây; workspace vẫn dùng chung">${icon("git-branch", 12)} Fork</button>` : "";
    return `<article class="chat-message ${isUser ? "from-user" : "from-agent"}"><header><strong>${esc(sender)}</strong><small>${esc(modelLabel || pending || fmtDate(message.createdAt))}</small>${forkButton}</header><div class="chat-message-content ${isUser ? "user-message-content" : "agent-message-content"}">${content}${pending ? `<span class="chat-message-status">${esc(pending)}</span>` : ""}</div></article>`;
  }).join("") : `<div class="chat-empty-note">Cuộc trò chuyện này chưa có nội dung hiển thị. Gửi tin nhắn để tiếp tục với agent trong workspace.</div>`;
  const composerConfig = `${providerTitle(view.connectors, provider)}${model?.name ? ` · ${model.name}` : ""}${effort ? ` · ${effort}` : ""}`;
  return `<section class="task-conversation-page" aria-label="Cuộc trò chuyện">
    <section class="task-chat-pane conversation-chat-pane"><header class="pane-heading"><div><strong>Trò chuyện</strong><small>${statuses[task.status]} · ${fmtDate(task.createdAt)}${totalUsage ? ` · ${formatNumber(totalUsage)} tokens` : ""}${busy ? ` · ${taskProgress(task)}` : ` · ${workflow === "chat-only" ? "Chat" : "Task"}`} · ${task.permissionPreset === "read-only" ? "Chỉ đọc" : "Sửa workspace"}</small></div><span class="chat-pane-meta">${queueSummary ? `<span class="chat-queue-summary">${icon("list-checks", 13)}${esc(queueSummary)}</span>` : ""}<button type="button" class="button quiet small" data-action="task-permissions" data-id="${task.id}" aria-label="${view.language === "en" ? "Permissions" : "Quyền"}" title="${view.language === "en" ? "Permissions" : "Quyền"}">${icon("shield", 13)}<span>${view.language === "en" ? "Permissions" : "Quyền"}</span></button><button type="button" class="button quiet small chat-goal-button" data-action="edit-task-goal" data-id="${task.id}" aria-label="${view.language === "en" ? "Goal" : "Mục tiêu"}" title="${task.goal ? esc(task.goal) : (view.language === "en" ? "Add a long-term goal" : "Thêm mục tiêu dài hạn")}">${icon("target", 13)}<span>${view.language === "en" ? "Goal" : "Mục tiêu"}</span></button><span class="chat-message-count">${icon("book-open-text", 14)} ${formatNumber(transcript.length)} ${view.language === "en" ? "messages" : "tin nhắn"}</span></span></header>
      <div class="chat-thread" id="chat-thread" data-task-id="${esc(task.id)}" aria-live="polite">${transcriptHtml}${busy && !messages.some((message) => message.status === "running") ? `<div class="chat-empty-note">${esc(taskProgress(task))}…</div>` : ""}</div>
      <form class="chat-composer" data-modal data-form="task-chat" data-id="${task.id}"><textarea name="message" class="chat-input" maxlength="8000" rows="3" required placeholder="${queuedTurns.length || hasActiveChatMessage ? (view.language === "en" ? "Send another message; it will wait in the queue…" : "Gửi tin nhắn tiếp theo; agent sẽ xử lý theo hàng đợi…") : "Nhắn tiếp trong cuộc trò chuyện này…"}">${esc(view.chatDraft)}</textarea><input type="hidden" name="provider" value="${esc(provider)}"><input type="hidden" name="model" value="${esc(model?.id || "")}"><input type="hidden" name="effort" value="${esc(effort)}"><footer class="chat-composer-controls"><button type="button" class="chat-config-trigger" data-action="task-instruction" data-id="${task.id}" title="Đổi agent, model hoặc mức suy nghĩ">${icon("settings-2", 14)}<span>${esc(composerConfig)}</span></button><button class="button primary chat-send-button" type="submit" aria-label="${view.language === "en" ? "Send message to queue" : "Gửi tin nhắn vào hàng đợi"}" title="${view.language === "en" ? "Send message to queue" : "Gửi tin nhắn vào hàng đợi"}" ${canSend ? "" : "disabled"}>${icon("arrow-up-right", 16)}</button></footer></form>
    </section>
  </section>`;
}
function homeAgentCard(name, connector, ready) {
  const status = ready ? "Sẵn sàng" : connector?.error ? "Cần kiểm tra CLI" : "Chưa khả dụng";
  const detail = connector?.models?.length ? `${connector.models.length} model · ${connector.version || "CLI"}` : connector?.version || "CLI chưa trả danh sách model";
  return `<div class="home-agent-card"><span class="home-agent-icon">${icon("square-terminal", 15)}</span><span><strong>${name}</strong><small>${esc(detail)}</small></span><span class="home-agent-status ${ready ? "ready" : "unavailable"}"><i></i>${status}</span></div>`;
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
  return `<div class="home-search-section">Workspace</div>${workspaces.map((workspace) => `<button data-workspace="${workspace.id}">${icon("folder-code", 15)}<span><strong>${esc(workspace.name)}</strong><small>Dự án</small></span></button>`).join("")}<div class="home-search-section">Task và chat</div>${tasks.map((task) => `<button data-task="${task.id}">${icon(task.config?.workflow === "chat-only" ? "square-terminal" : "workflow", 15)}<span><strong>${esc(task.title)}</strong><small>${esc(view.state.workspaces.find((workspace) => workspace.id === task.workspaceId)?.name || task.workspacePath)}</small></span></button>`).join("")}`;
}
function clearSidebarSearch() {
  view.searchQuery = "";
  const input = $("[data-home-search]");
  if (input) input.value = "";
  const results = $("[data-home-search-results]");
  if (results) { results.innerHTML = ""; results.hidden = true; }
}
function chatHomeCard(task) {
  const workspace = view.state.workspaces.find((item) => item.id === task.workspaceId);
  return `<button class="chat-home-card" data-task="${task.id}"><span class="task-state state-${task.status}"><i></i></span><span><strong>${esc(task.title)}</strong><small>${esc(workspace?.name || task.workspacePath)} · ${esc(taskProgress(task))}</small></span><time>${fmtDate(task.updatedAt)}</time>${icon("chevron-right", 15)}</button>`;
}
function orchestrationNodeHtml(node, index, count) {
  const stateLabel = { complete: "Hoàn tất", active: "Đang chạy", queued: "Đang chờ", pending: "Chưa chạy", failed: "Lỗi", cancelled: "Đã dừng" }[node.state] || "Chưa ghi nhận";
  const stateIcon = node.state === "complete" ? "check" : node.state === "active" ? "refresh-cw" : node.state === "failed" || node.state === "cancelled" ? "x" : node.icon;
  const extra = node.events?.length ? `<details class="orchestration-node-details"><summary>${node.events.length} sự kiện công cụ quan sát được</summary><div>${node.events.map((event) => `<p><time>${fmtDate(event.at)}</time>${esc(event.text)}</p>`).join("")}</div></details>` : node.output ? `<details class="orchestration-node-details"><summary>Xem đầu ra stage</summary><pre>${esc(node.output)}</pre></details>` : node.files?.length ? `<details class="orchestration-node-details"><summary>Xem ${node.files.length} tệp thay đổi</summary><div>${node.files.map((file) => `<code>${esc(file)}</code>`).join("")}</div></details>` : "";
  return `<article class="orchestration-node state-${node.state}" data-node="${node.id}"><div class="orchestration-rail"><span>${icon(stateIcon, 16)}</span>${index < count - 1 ? "<i></i>" : ""}</div><div class="orchestration-node-card"><header><small>${esc(node.group)}</small><span>${stateLabel}</span></header><div class="orchestration-node-main"><span class="orchestration-node-icon">${icon(node.icon, 17)}</span><div><h3>${esc(node.title)}</h3><p>${esc(node.detail)}</p></div></div>${extra}</div></article>`;
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
  const body = `<label>Preset quyền<select name="permissionPreset"><option value="read-only" ${current === "read-only" ? "selected" : ""}>Chỉ đọc workspace</option><option value="workspace-write" ${current === "workspace-write" ? "selected" : ""}>Được sửa workspace</option></select><small>Chỉ đọc được ánh xạ sang sandbox read-only của Codex và plan mode của Claude. Antigravity CLI chưa có chế độ chỉ đọc cho lần chạy nền nên bị chặn; API không được ghi tệp trong preset này. Không áp dụng “hỏi trước” vì OpenSybau chưa nhận và chuyển tiếp yêu cầu duyệt CLI.</small></label>`;
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
    ? `<div class="stage-rerun-controls"><label>Chạy lại từ<select data-rerun-stage>${replayStages.map(([id, label]) => `<option value="${id}" ${id === defaultReplayStage ? "selected" : ""}>${label}</option>`).join("")}</select></label><button class="button primary" data-action="rerun-stage" data-id="${task.id}">Chạy lại</button></div>`
    : canRerun && task.config.workflow === "chat-only" && ["failed", "cancelled"].includes(task.status)
      ? `<button class="button primary" data-action="rerun-task" data-id="${task.id}">Chạy lại chat</button>`
      : "";
  const stageRunHistory = (task.stageRunHistory || []).length ? `<section class="orchestration-stage-history"><strong>Lịch sử chạy lại</strong>${[...(task.stageRunHistory || [])].reverse().map((attempt) => {
    const stageLabel = { plan: "Kế hoạch", build: "Triển khai", review: "Review", chat: "Chat" }[attempt.stage] || attempt.stage;
    const statusLabel = { queued: "Trong hàng đợi", running: "Đang chạy", done: "Hoàn tất", failed: "Lỗi", cancelled: "Đã dừng" }[attempt.status] || "Đã ghi nhận";
    const outputRows = Object.entries(attempt.previousOutputs || {}).map(([stage, snapshot]) => {
      const label = { plan: "Kế hoạch trước đó", build: "Triển khai trước đó", review: "Review trước đó" }[stage] || stage;
      return `<details><summary>${label}</summary><pre>${esc(snapshot.text || "")}${snapshot.truncated ? "\n\n… phần cuối đã được rút gọn trong lịch sử." : ""}</pre></details>`;
    }).join("");
    const previousArtifacts = attempt.previousArtifacts?.length ? `<div class="stage-history-files"><small>${esc(translateText("Tệp từ lần chạy trước", view.language))}</small>${attempt.previousArtifacts.slice(0, 30).map((file) => `<code>${esc(file)}</code>`).join("")}</div>` : "";
    return `<details class="stage-history-entry"><summary>${esc(stageLabel)} · ${esc(statusLabel)} · ${fmtDate(attempt.requestedAt)}</summary>${attempt.error ? `<p class="stage-history-error">${esc(attempt.error)}</p>` : ""}${outputRows || "<p>Không có đầu ra cũ cho giai đoạn này.</p>"}${previousArtifacts}</details>`;
  }).join("")}</section>` : "";
  return `<section class="task-orchestration-page" aria-label="Điều phối task">
    <header class="conversation-top"><div class="conversation-context"><span class="conversation-repo">${icon("folder-code", 15)} ${esc(workspace?.name || task.workspacePath)}</span><span class="conversation-separator">/</span><span class="conversation-task-id">${esc(task.id)}</span></div><div class="detail-head-actions"><button class="button quiet small" data-action="back-chat" data-id="${task.id}">${icon("arrow-left", 14)} Cuộc trò chuyện</button><button class="button quiet small" data-action="open-folder" data-id="${task.id}">${icon("folder-code", 14)} Mở workspace</button><button class="button quiet small" data-action="task-instruction" data-id="${task.id}">${icon("arrow-up-right", 14)} Gửi chỉ dẫn</button><button class="button quiet small" data-action="new-task">${icon("plus", 14)} Task mới</button></div></header>
    <div class="detail-title-row"><div><h2>${esc(task.title)}</h2><div class="detail-meta"><span class="pill status-${task.status}"><i></i>${statuses[task.status]}</span>${presetBadge}<span>${fmtDate(task.createdAt)}</span>${usage ? `<span>${formatNumber(usage)} tokens</span>` : ""}<span>${formatNumber(events.length)} sự kiện · ${formatNumber(nodes.length)} node</span></div></div></div>
    ${task.skills?.length ? `<div class="skill-used">${icon("notebook-tabs", 14)} Skill đã chọn: ${task.skills.map((skill) => esc(skill.name)).join(" · ")}</div>` : ""}
    <div class="orchestration-layout"><section class="orchestration-canvas"><header class="orchestration-canvas-head"><div><small>LUỒNG THỰC THI · ${esc(task.config.workflow === "chat-only" ? "CHAT" : task.config.workflow === "plan-only" ? "PLAN ONLY" : "CODE PIPELINE")}</small><h3>${busy ? "Điều phối đang hoạt động" : "Bản ghi điều phối"}</h3></div><span class="activity-live ${busy ? "is-live" : ""}"><i></i>${busy ? "Đang chạy" : "Đã lưu"}</span></header><div class="orchestration-flow">${nodes.map((node, index) => orchestrationNodeHtml(node, index, nodes.length)).join("")}</div></section>
      <aside class="orchestration-activity"><header class="orchestration-activity-head"><div><small>EVENT LOG</small><h3>Điều phối & hoạt động</h3></div><span>${events.length} sự kiện</span></header><div class="orchestration-activity-note">${icon("workflow", 14)} Chỉ hiện hoạt động, handoff, đầu ra và công cụ được CLI ghi nhận. Suy luận nội bộ của model không được cung cấp.</div><div class="orchestration-event-list" id="agent-activity-feed">${sortedEvents.length ? sortedEvents.map((item) => { const text = String(item.text || ""); const longOutput = item.kind === "output" && text.length > 320; return `<article class="orchestration-event kind-${esc(item.kind)}"><span class="orchestration-event-mark">${icon(({ stage: "square-terminal", handoff: "workflow", tool: "settings-2", output: "file", chat: "book-open-text", memory: "brain", error: "circle-question-mark", success: "check", warning: "circle-question-mark" })[item.kind] || "workflow", 14)}</span><div><header><strong>${esc(eventLabels[item.kind] || "EVENT")}</strong><time>${fmtDate(item.at)}</time></header>${longOutput ? `<p>${esc(text.slice(0, 280))}…</p><details class="orchestration-event-details"><summary>Xem đầu ra đầy đủ</summary><pre>${esc(text)}</pre></details>` : `<p>${esc(text)}</p>`}</div></article>`; }).join("") : `<p class="orchestration-activity-empty">Các sự kiện sẽ xuất hiện khi task được chạy.</p>`}</div>${stages.length ? `<section class="orchestration-stage-results"><strong>Đầu ra agent</strong>${stages.map(([label, output]) => `<details><summary>${esc(label)}</summary><pre>${esc(output)}</pre></details>`).join("")}</section>` : ""}${(task.artifacts || []).length ? `<section class="orchestration-artifacts"><strong>${icon("file", 14)} Tệp thay đổi · ${task.artifacts.length}</strong>${task.artifacts.slice(0, 20).map((file) => `<div>${icon("file", 13)}<code>${esc(file)}</code></div>`).join("")}</section>` : ""}${stageRunHistory}</aside></div>
    <footer class="detail-actions">${task.status === "running" || task.status === "queued" ? `<button class="button danger" data-action="stop-task" data-id="${task.id}">${icon("square", 13)} Dừng task</button>` : replayControls}${task.status !== "queued" ? `<button class="button quiet" data-action="show-diff" data-id="${task.id}">Xem diff</button>` : ""}</footer>
  </section>`;
}
function showModal(title, body, submitLabel, formType = "") {
  const inferred = title === "Task mới" ? "task" : title === "Thêm workspace" ? "workspace" : title === "Ghi nhớ mới" ? "memory" : "dismiss";
  const type = formType || inferred;
  $("#overlay").innerHTML = `<div class="modal-backdrop" data-action="close-modal"><form class="modal app-dialog-shell" data-form="${type}" data-modal><header class="modal-head app-dialog-header"><div><small>OPENSYBAU · LOCAL</small><h2>${title}</h2></div><button type="button" class="icon-button" data-action="close-modal" aria-label="Đóng">${icon("x", 16)}</button></header><div class="modal-body app-dialog-content">${body}</div><footer class="modal-actions app-dialog-footer"><button type="button" class="button quiet" data-action="close-modal">Hủy</button><button class="button primary" type="submit">${submitLabel}</button></footer></form></div>`;
  localizeDom($("#overlay"), view.language);
  $(".modal input, .modal textarea, .modal select")?.focus();
}
async function openTaskModal() {
  const { workspaces } = view.state;
  if (!providersForRole(view.connectors, "plan").length) { view.page = "settings"; view.selected = null; render(); showToast("Kết nối ít nhất một agent hoặc API rồi bạn có thể tạo task."); return; }
  if (!workspaces.length) return showWorkspaceModal();
  const options = workspaces.map((w) => `<option value="${w.id}">${esc(w.name)} · ${esc(w.path)}</option>`).join("");
  const hasBuild = providersForRole(view.connectors, "build").length > 0;
  const canPlanOnly = providersForRole(view.connectors, "plan").length > 0;
  const body = `${taskPresetToolsMarkup()}<label>Yêu cầu<textarea name="prompt" required minlength="6" maxlength="12000" rows="5" placeholder="Mô tả việc cần làm, phạm vi và điều kiện hoàn tất…"></textarea><small>Nếu chọn provider API, yêu cầu và ngữ cảnh dự án tương ứng sẽ được gửi tới endpoint đã cấu hình.</small></label><label>Mục tiêu dài hạn<input name="goal" maxlength="2000" placeholder="Không bắt buộc"></label><label>Quyền<select name="permissionPreset"><option value="workspace-write" selected>Được sửa workspace</option><option value="read-only">Chỉ đọc workspace</option></select><small>Chỉ đọc không chạy stage triển khai; Antigravity CLI bị chặn vì chưa có chế độ chỉ đọc riêng cho lần chạy nền.</small></label><label>Workspace<select name="workspaceId" required>${options}</select></label><label>Luồng<select name="workflow"><option value="codex-antigravity" ${hasBuild ? "selected" : "disabled"}>Pipeline · Kế hoạch → Triển khai → Review</option><option value="plan-only" ${hasBuild ? "" : "selected"} ${canPlanOnly ? "" : "disabled"}>Chỉ lập kế hoạch</option><option value="chat-only">Chat · một agent</option></select></label><div class="agent-role-grid task-role-grid">${workflowRoles.map((role) => roleEditor(role.id)).join("")}</div><div class="chat-agent-role" hidden>${chatAgentEditor()}</div><section class="task-skill-auto"><span class="task-skill-auto-icon">${icon("notebook-tabs", 17)}</span><div><strong>Tự chọn skill phù hợp</strong><small>OpenSybau tìm skill liên quan rồi gửi cho agent ở từng vai trò. Skill có thể được gửi tới API provider nếu bạn chọn agent API.</small></div><span class="task-skill-total">${view.skills.length} skill</span></section><label class="check-row"><input type="checkbox" name="isolated"><span><strong>Tách Git worktree riêng</strong><small>Cần repo có commit. Khi bật, kết quả ở worktree và không tự nhập vào thư mục hiện tại.</small></span></label><div class="form-note" id="isolation-note"></div>`;
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
  modelSelect.innerHTML = models.map((model) => `<option value="${esc(model.id)}">${esc(model.name)}</option>`).join("") || `<option value="">Chưa có model</option>`;
  modelSelect.disabled = !models.length;
  const effortsForModel = models[0]?.efforts || [];
  effortSelect.innerHTML = effortsForModel.map((effort) => `<option value="${esc(effort)}">${esc(effort)}</option>`).join("") || `<option value="">Không áp dụng</option>`;
  effortSelect.disabled = !effortsForModel.length;
}
function syncEffortForModel(form, modelSelector, effortSelector, providerSelector) {
  const modelId = form?.querySelector(modelSelector)?.value;
  const provider = form?.querySelector(providerSelector)?.value;
  const model = view.connectors?.[provider]?.models?.find((item) => item.id === modelId);
  const effortSelect = form?.querySelector(effortSelector);
  if (!effortSelect || !model) return;
  const options = model.efforts || [];
  effortSelect.innerHTML = options.map((effort) => `<option value="${esc(effort)}">${esc(effort)}</option>`).join("") || `<option value="">Không áp dụng</option>`;
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
  const body = `<label>Đường dẫn thư mục trên máy<input name="path" required placeholder="D:\\Projects\\my-app" autocomplete="off" spellcheck="false"></label><div class="form-note">Dán đường dẫn thư mục thật từ Explorer; dấu ngoặc kép ngoài cùng sẽ được tự bỏ. Workspace được lưu cục bộ.</div>`;
  showModal("Thêm workspace", body, "Kiểm tra và thêm");
}
function sourceFolderRow(path, primary = false) {
  return `<div class="source-folder-row"><span>${icon("folder", 14)}</span><input name="sourceFolder" value="${esc(path)}" required autocomplete="off" spellcheck="false" placeholder="D:\\Projects\\another-app" aria-label="Đường dẫn thư mục nguồn"><button type="button" class="icon-button" data-action="remove-source-folder" title="${primary ? "Thư mục chính không thể gỡ" : "Gỡ thư mục này"}" aria-label="Gỡ thư mục này" ${primary ? "disabled" : ""}>${icon("x", 14)}</button></div>`;
}
function showEditProjectModal(workspace) {
  const folders = workspace.sourceFolders?.length ? workspace.sourceFolders : [workspace.path];
  const body = `<label>Tên dự án<input name="name" value="${esc(workspace.name)}" maxlength="100" required autocomplete="off"></label><section class="project-sources"><strong>Thư mục nguồn</strong><div class="source-folder-list">${folders.map((path) => sourceFolderRow(path, path.toLowerCase() === workspace.path.toLowerCase())).join("")}</div><button type="button" class="button quiet small" data-action="add-source-folder">${icon("folder-plus", 14)} Thêm thư mục</button><p class="form-note">Task thường có quyền đọc/ghi các thư mục nguồn. Task tách worktree chỉ dùng workspace chính.</p></section>`;
  showModal("Sửa dự án", body, "Lưu thay đổi", "workspace-edit");
  $(".modal").dataset.id = workspace.id;
}
function showProjectSectionModal(workspace) {
  const sections = [...new Set(view.state.workspaces.map((item) => item.section || "Projects"))];
  const options = sections.map((section) => `<option value="${esc(section)}">`).join("");
  const body = `<label>Tên section<input name="section" value="${esc(workspace.section || "Projects")}" maxlength="60" list="project-section-options" required autocomplete="off" placeholder="Projects"><datalist id="project-section-options">${options}</datalist></label><p class="form-note">Chọn section có sẵn hoặc nhập tên mới để tạo.</p>`;
  showModal("Chuyển section", body, "Lưu section", "workspace-section");
  $(".modal").dataset.id = workspace.id;
}
function showMemoryModal() {
  const options = `<option value="all">Dùng chung</option>${view.state.workspaces.map((w) => `<option value="${w.id}">${esc(w.name)}</option>`).join("")}`;
  const body = `<label>Tên ghi nhớ<input name="title" maxlength="120" required placeholder="Ví dụ: Cách chạy kiểm thử dự án"></label><label>Nội dung<textarea name="content" maxlength="5000" rows="4" required placeholder="Một ghi chú đã kiểm chứng, hữu ích cho các task sau"></textarea></label><label>Phạm vi<select name="workspaceId">${options}</select></label><div class="form-note">Mỗi task chỉ nạp tối đa 3 ghi chú có từ khóa khớp yêu cầu.</div>`;
  showModal("Ghi nhớ mới", body, "Lưu ghi nhớ");
}
function showDiffModal(data) {
  const body = `<div class="diff-location"><small>THƯ MỤC</small><code>${esc(data.path || "")}</code></div><pre class="diff-content">${esc(data.diff || "Không có thay đổi được Git theo dõi.")}</pre>`;
  showModal("Diff của task", body, "Đóng");
  $(".modal [data-action=close-modal]")?.addEventListener("click", closeOverlay, { once: true });
  $(".modal-actions .primary").addEventListener("click", (event) => { event.preventDefault(); closeOverlay(); }, { once: true });
}
function closeOverlay() { $("#overlay").innerHTML = ""; }
function showToast(message) {
  const toast = $("#toast"); toast.textContent = translateText(message, view.language); toast.classList.add("visible");
  clearTimeout(view.toastTimer); view.toastTimer = setTimeout(() => toast.classList.remove("visible"), 3500);
}
async function handleSubmit(event) {
  const form = event.target.closest("[data-modal]");
  if (!form) return;
  event.preventDefault(); if (view.busy) return;
  view.busy = true; const submit = $("[type=submit]", form); submit.disabled = true; submit.textContent = "Đang xử lý…";
  const data = new FormData(form); const object = Object.fromEntries(data.entries());
  try {
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
      view.selected = task.task.id; view.page = "chat"; view.chatProvider = task.task.config.chatProvider || task.task.config.roles?.plan?.provider || "codex"; view.chatModel = task.task.config.workflow === "chat-only" ? task.task.config.chatModel : ""; view.chatEffort = task.task.config.workflow === "chat-only" ? task.task.config.chatEffort : ""; view.chatDraft = ""; showToast("Task thật đã vào hàng đợi.");
    } else if (form.dataset.form === "home-task") {
      const workflow = object.workflow || "chat-only";
      const payload = { ...object, workflow, isolated: false };
      const task = await api("/api/tasks", { method: "POST", body: JSON.stringify(payload) });
      view.selected = task.task.id; view.page = "chat"; view.chatProvider = workflow === "chat-only" ? task.task.config.chatProvider : task.task.config.roles?.plan?.provider || "codex"; view.chatModel = workflow === "chat-only" ? task.task.config.chatModel : ""; view.chatEffort = workflow === "chat-only" ? task.task.config.chatEffort : ""; view.chatDraft = ""; showToast(workflow === "chat-only" ? "Đã gửi tin nhắn cho agent." : "Task thật đã vào hàng đợi.");
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
      const result = await api(`/api/tasks/${encodeURIComponent(form.dataset.id)}/chat`, { method: "POST", body: JSON.stringify({ message: object.message, provider: object.provider, model: object.model, effort: object.effort }) });
      view.chatDraft = "";
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
    } else if (form.dataset.form === "dismiss") {
      // Informational modal; its primary action only closes the dialog.
    } else {
      return;
    }
    $("#overlay").innerHTML = "";
    await refresh({ configuration: form.dataset.form === "api-provider" });
    if (view.page === "knowledge" && view.state.settings.vaultPath) await loadVaultDir("");
    if (view.page === "skills" && !view.skillsLoaded) {
      const result = await api("/api/skills"); view.skills = result.skills || []; view.skillsLoaded = true; render();
    }
  } catch (error) { if (form.dataset.form === "task-chat") view.forceChatScroll = false; showToast(error.message); submit.disabled = false; submit.textContent = "Thử lại"; }
  finally { view.busy = false; }
}
async function handleWorkbenchClick(event) {
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
    view.homeWorkspaceId = selectedTask?.workspaceId || view.homeWorkspaceId;
    view.chatProvider = selectedTask?.config.workflow === "chat-only" ? selectedTask.config.chatProvider || "codex" : "codex";
    view.chatModel = selectedTask?.config.workflow === "chat-only" ? selectedTask.config.chatModel || "" : "";
    view.chatEffort = selectedTask?.config.workflow === "chat-only" ? selectedTask.config.chatEffort || "" : "";
    view.chatDraft = ""; render(); return;
  }
  const homeMode = event.target.closest("[data-home-mode]");
  if (homeMode) {
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
  if (!button.closest(".wb-project-group") && view.projectMenuId) { view.projectMenuId = ""; render(); }
  if (!button.closest(".wb-task-item") && view.taskMenuId) view.taskMenuId = "";
  try {
    if (action === "reset-theme-color") {
      const colorId = button.dataset.themeColor;
      if (resetThemeColor(colorId)) syncThemeColorRow(colorId);
      return;
    }
    if (action === "reset-theme-colors") {
      resetThemeColors();
      themeColorControls.forEach(({ id: colorId }) => syncThemeColorRow(colorId));
      showToast("Đã khôi phục màu giao diện mặc định.");
      return;
    }
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
    if (action === "new-chat") { view.page = "chat"; view.selected = null; view.chatDraft = ""; view.homeWorkspaceId = button.dataset.workspaceId || view.homeWorkspaceId || view.state.workspaces[0]?.id || ""; view.homeMode = "chat"; view.homeWorkflow = "chat-only"; clearSidebarSearch(); view.homeConfigOpen = false; closeOverlay(); render(); }
    if (action === "refresh") { await api("/api/connectors?refresh=1"); await refresh({ configuration: true }); showToast("Đã đọc lại trạng thái CLI."); }
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
        showModal("Đổi tên chat", `<label>Tên chat<input name="title" value="${esc(task.title)}" maxlength="120" required autocomplete="off"></label>`, "Lưu tên", "task-rename");
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
      view.connectors = await api("/api/connectors?refresh=1");
      await refresh({ configuration: true });
      showCliProviderModal();
      showToast("Đã quét lại Codex, Antigravity và Claude Code trên máy chạy OpenSybau.");
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
    if (action === "show-diff") { const data = await api(`/api/tasks/${encodeURIComponent(id)}/diff`); showDiffModal(data); }
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
    if (action === "refresh-vault-files") await loadVaultDir(view.vaultDir);
    if (action === "open-obsidian") {
      const vaultPath = view.state.settings.vaultPath || "";
      const vaultName = vaultPath.split(/[\\/]/).filter(Boolean).at(-1) || "";
      const uri = `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(button.dataset.path || "")}`;
      window.location.href = uri;
    }
    if (action === "view-skill") await showSkillView(id);
    if (action === "edit-skill") await showSkillEdit(id);
    if (action === "copy-skill") {
      const skill = view.skills.find((item) => item.id === id);
      const scope = skill?.providers?.length > 1 ? "shared" : skill?.providers?.[0] || "shared";
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
const activeButtonActions = new WeakSet();
const lastButtonActionAt = new WeakMap();
document.addEventListener("click", async (event) => {
  const button = event.target.closest?.("button");
  if (!button) return handleWorkbenchClick(event);
  const now = Date.now();
  const lastActionAt = lastButtonActionAt.get(button) || 0;
  if (activeButtonActions.has(button) || now - lastActionAt < 400) {
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
document.addEventListener("input", (event) => {
  const themeColorInput = event.target.closest("[data-theme-color]");
  if (themeColorInput) { updateThemeColorInput(themeColorInput); return; }
  const chatInput = event.target.closest(".chat-input");
  if (chatInput) { view.chatDraft = chatInput.value; return; }
  const homePrompt = event.target.closest("[data-home-prompt]");
  if (homePrompt) { view.chatDraft = homePrompt.value; return; }
  const homeSearch = event.target.closest("[data-home-search]");
  if (homeSearch) {
    view.searchQuery = homeSearch.value;
    const results = $("[data-home-search-results]");
    if (results) { results.innerHTML = homeSearchResults(view.searchQuery); results.hidden = !view.searchQuery.trim(); localizeDom(results, view.language); }
    return;
  }
  const fileInput = event.target.closest("[data-file-filter]");
  if (fileInput) {
    const query = fileInput.value.trim().toLocaleLowerCase();
    const list = fileInput.closest(".file-browser")?.querySelector(".file-list");
    list?.querySelectorAll("[data-file-entry]").forEach((entry) => { entry.hidden = !entry.textContent.toLocaleLowerCase().includes(query); });
    return;
  }
  const input = event.target.closest("[data-skill-filter]");
  if (!input) return;
  if (input.dataset.skillFilter === "library") view.skillFilter = input.value;
  applySkillFilter(input);
});
document.addEventListener("change", (event) => {
  if (event.target.matches(".appearance-color-hex")) {
    if (!/^#[\da-f]{6}$/i.test(event.target.value.trim())) syncThemeColorRow(event.target.dataset.themeColor);
    else updateThemeColorInput(event.target);
    return;
  }
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
    if (form?.classList.contains("home-composer")) {
      view.homeRoles[roleId] = { provider: event.target.value, model: form.querySelector(`[data-role-model="${roleId}"]`)?.value || "", effort: form.querySelector(`[data-role-effort="${roleId}"]`)?.value || "" };
      render();
    }
  }
  if (event.target.matches("[data-role-model]")) {
    const roleId = event.target.dataset.roleModel;
    const form = event.target.closest("form");
    syncEffortForModel(form, `[data-role-model="${roleId}"]`, `[data-role-effort="${roleId}"]`, `[data-role-provider="${roleId}"]`);
    if (form?.classList.contains("home-composer")) {
      view.homeRoles[roleId] = { provider: form.querySelector(`[data-role-provider="${roleId}"]`)?.value || "", model: event.target.value, effort: form.querySelector(`[data-role-effort="${roleId}"]`)?.value || "" };
      render();
    }
  }
  if (event.target.matches("[data-role-effort]")) {
    const roleId = event.target.dataset.roleEffort;
    const form = event.target.closest("form");
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
});
document.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault(); view.page = "chat"; view.selected = null; view.chatDraft = ""; render(); $(`[data-home-prompt]`)?.focus({ preventScroll: true }); return;
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
    search.value = "";
    const results = $("[data-home-search-results]");
    if (results) { results.hidden = true; results.innerHTML = ""; }
    return;
  }
  if (event.key === "Escape") closeOverlay();
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
    view.chatProvider = selectedTask.config?.workflow === "chat-only" ? selectedTask.config.chatProvider || "codex" : "codex";
    view.chatModel = selectedTask.config?.workflow === "chat-only" ? selectedTask.config.chatModel || "" : "";
    view.chatEffort = selectedTask.config?.workflow === "chat-only" ? selectedTask.config.chatEffort || "" : "";
  }
  render();
  if (view.state && routeNeedsHydration) {
    routeNeedsHydration = false;
    hydrateRouteData().catch((error) => showToast(error.message));
  }
});
const events = new EventSource("/__events");
events.addEventListener("update", () => scheduleRefresh(220));
events.addEventListener("reload", () => location.reload());
events.addEventListener("open", () => { view.streamConnected = true; if (["tasks", "chat"].includes(view.page)) render(); scheduleRefresh(0); });
events.addEventListener("error", () => { view.streamConnected = false; if (["tasks", "chat"].includes(view.page)) render(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) scheduleRefresh(80); });
refresh({ configuration: true });
setInterval(() => {
  if (document.hidden) return;
  scheduleRefresh(0);
  if (view.page === "settings" && Date.now() - lastConfigurationRefresh > 300_000) void refresh({ configuration: true });
}, 30_000);
