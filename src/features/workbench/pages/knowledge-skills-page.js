import { esc, formatNumber, icon, view } from "../../../shared/state.js";
import { renderKnowledgeMarkdown, renderMarkdown } from "../markdown.js";
import { mountKnowledgeGraphCanvas as mountVaultKnowledgeGraphCanvas } from "../knowledge-graph.js";
import { api, ensureSubagentProfiles, markReplaceBrowserRoute, render } from "../runtime.js";

export function vaultNoteOptionsMenu(filePath, { showRead = false, showGraph = false, direction = "down" } = {}) {
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

export async function loadVaultDir(path = "", { keepPreview = false } = {}) {
  view.page = "knowledge";
  view.vaultDir = path;
  if (!keepPreview) {
    view.vaultPreview = null;
    view.vaultEditing = false;
    view.vaultEditingPath = "";
  }
  view.vaultEntries = [];
  render();
  const [data, graph] = await Promise.all([
    api(`/api/vault/files?path=${encodeURIComponent(path)}`),
    api("/api/vault/graph").catch(() => ({ nodes: [], edges: [] })),
  ]);
  if (view.page !== "knowledge" || view.vaultDir !== path) return;
  if (view.vaultDir !== data.path) markReplaceBrowserRoute(true);
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

export async function loadVaultPreview(path, { startEdit = false } = {}) {
  const file = await api(`/api/vault/file?path=${encodeURIComponent(path)}`);
  if (view.page !== "knowledge") return;
  view.vaultPreview = file;
  view.vaultEditing = Boolean(startEdit);
  view.vaultEditingPath = startEdit ? file.path : "";
  view.vaultDraft = file.content;
  render();
}

export async function loadVaultGraph() {
  const graph = await api("/api/vault/graph").catch(() => ({ nodes: [], edges: [] }));
  if (view.page !== "knowledge") return;
  view.vaultGraph = graph;
  render();
}

export function mountKnowledgeGraphCanvas() {
  return mountVaultKnowledgeGraphCanvas({ loadVaultPreview });
}

export function knowledgePage() {
  const vaultPath = view.state?.settings?.vaultPath || "";
  if (!vaultPath) return `<div class="page-head"><div><h1>Tri thức</h1><p>Kết nối vault để duyệt, chỉnh sửa ghi chú Markdown và xem đồ thị liên kết tri thức trực tiếp trên máy.</p></div></div><section class="empty-state knowledge-empty"><div class="empty-symbol">${icon("book-open-text", 18)}</div><strong>Chưa kết nối Obsidian vault</strong><p>OpenSybau chỉ đọc/ghi thư mục bạn chỉ định; nội dung không được đưa vào prompt tự động.</p><button class="button primary" data-action="connect-vault">${icon("plus", 15)} Kết nối vault</button></section>`;

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
    <header class="kb-stage-topbar is-knowledge-topbar">
      <div class="kb-topbar-left">
        <div class="kb-active-doc-info">
          <strong>${esc(activeFile ? activeFile.name : vaultName)}</strong>
          <small>${activeFile ? `${esc(activeFile.path)} · ${formatNumber(activeFile.size)} B` : `${nodes.length} ghi chú trong Vault`}</small>
        </div>
        <button type="button" class="button quiet small kb-mobile-drawer-btn" data-action="toggle-chat-drawer">${icon("folder-tree", 13)}<span>Cây ghi chú (${nodes.length})</span></button>
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

export async function ensureSkillDetail(id) {
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

export async function ensureSubagentProfileDetail(id) {
  if (!id) return null;
  view.subagentProfileDetailsCache ||= {};
  if (view.subagentProfileDetailsCache[id]) return view.subagentProfileDetailsCache[id];
  if (view.subagentProfileLoadingId === id) return null;
  view.subagentProfileLoadingId = id;
  const activeWsId = view.homeWorkspaceId || view.state?.workspaces?.[0]?.id || "";
  const qs = activeWsId ? `?workspaceId=${encodeURIComponent(activeWsId)}` : "";
  try {
    const { profile } = await api(`/api/subagent-profiles/${encodeURIComponent(id)}${qs}`);
    if (profile) {
      view.subagentProfileDetailsCache[id] = profile;
      if (view.page === "skills") render();
    }
    return profile;
  } catch {
    return null;
  } finally {
    if (view.subagentProfileLoadingId === id) view.subagentProfileLoadingId = "";
  }
}

function subagentSectionPage(allSkills, sectionTabsHtml) {
  const activeWs = (view.state?.workspaces || []).find((w) => w.id === view.homeWorkspaceId)
    || view.state?.workspaces?.[0]
    || null;
  const activeWsId = activeWs?.id || "";
  if (!view.subagentProfilesLoaded || view.subagentProfilesWorkspaceId !== activeWsId) {
    void ensureSubagentProfiles(activeWsId);
  }
  const allProfiles = view.subagentProfiles || [];
  const summary = allProfiles.find((p) => p.id === view.selectedSubagentProfileId) || allProfiles[0] || null;
  if (summary && view.selectedSubagentProfileId !== summary.id) {
    view.selectedSubagentProfileId = summary.id;
  }
  const detail = summary ? (view.subagentProfileDetailsCache?.[summary.id] || null) : null;
  if (summary && !detail) {
    void ensureSubagentProfileDetail(summary.id);
  }
  const activeProfile = detail || summary;
  const isEditing = Boolean(activeProfile?.editable && view.subagentProfileEditing && view.subagentProfileEditingId === activeProfile.id);
  const wsTrustBanner = activeWs && activeWs.trustedSkills === false
    ? `<div class="subagent-trust-callout">
        <div class="subagent-trust-copy">
          ${icon("shield-alert", 15)}
          <div>
            <strong>Hồ sơ cục bộ của dự án đang ở chế độ chưa tin cậy</strong>
            <small>Các hồ sơ trong <code>.agents/agents</code>, <code>.claude/agents</code> hoặc <code>.codex/config.toml</code> của dự án <span data-localize-skip="true">${esc(activeWs.name)}</span> sẽ không tự động biên dịch vào CLI cho tới khi bạn xác nhận tin cậy.</small>
          </div>
        </div>
        <button type="button" class="button quiet small" data-action="toggle-workspace-trust" data-id="${esc(activeWs.id)}">${icon("shield-check", 13)}<span>Tin cậy hồ sơ dự án</span></button>
      </div>`
    : "";

  const harnessLabels = { claude: "Claude Code", codex: "Codex CLI", antigravity: "Antigravity CLI" };
  let centerBodyHtml = "";

  if (isEditing && activeProfile) {
    centerBodyHtml = `<div class="vault-editor-wrap kb-editor-wrap">
      <textarea class="vault-editor-textarea" data-subagent-inline-editor spellcheck="false" placeholder="Nội dung Markdown hồ sơ Subagent…">${esc(view.subagentProfileDraft ?? detail?.content ?? "")}</textarea>
      <div class="vault-editor-foot">
        <small>Chỉnh sửa trực tiếp tệp Markdown của hồ sơ <strong data-localize-skip="true">${esc(activeProfile.name)}</strong>.</small>
        <div class="kb-editor-foot-actions">
          <button type="button" class="button quiet small" data-action="cancel-inline-subagent-edit">Hủy</button>
          <button type="button" class="button primary small" data-action="save-inline-subagent" data-id="${esc(activeProfile.id)}">${icon("check", 13)}<span>Lưu hồ sơ</span></button>
        </div>
      </div>
    </div>`;
  } else if (activeProfile) {
    const rawContent = detail?.content || "";
    const promptBody = detail?.prompt || "";
    const isCodexToml = activeProfile.format === "codex-toml";
    const harnesses = (activeProfile.harnesses || []).map((h) => harnessLabels[h] || h);
    const toolsList = Array.isArray(activeProfile.tools) ? activeProfile.tools : [];
    const disallowedList = Array.isArray(activeProfile.disallowedTools) ? activeProfile.disallowedTools : [];

    centerBodyHtml = `<div class="kb-doc-scroll">
      <div class="kb-doc-container is-full-stage">
        ${wsTrustBanner}
        <section class="minimal-stage-hero skill-stage-hero is-subagent-hero">
          <div class="minimal-stage-title">
            <span class="minimal-stage-icon">${icon("waypoints", 18)}</span>
            <div class="skill-hero-copy">
              <div class="skill-hero-title-row">
                <h1 data-localize-skip="true">${esc(activeProfile.name)}</h1>
                <span class="kb-tag-chip is-inline-badge">${activeProfile.editable ? "Quản lý cục bộ · Có thể sửa" : "Cấu hình CLI · Chỉ đọc"}</span>
                ${activeProfile.readOnly ? `<span class="kb-tag-chip is-inline-badge">${icon("shield-check", 11)}<span>Chỉ đọc mã nguồn</span></span>` : ""}
                ${activeProfile.workspaceScoped && !activeProfile.trusted ? `<span class="kb-tag-chip is-inline-badge">${icon("shield-alert", 11)}<span>Chưa tin cậy</span></span>` : ""}
              </div>
              <p data-localize-skip="true">${esc(activeProfile.description || activeProfile.source || "")}</p>
              <div class="subagent-meta-chips">
                <span class="kb-tag-chip">Model: <code data-localize-skip="true">${esc(activeProfile.model || "inherit")}</code></span>
                ${harnesses.map((label) => `<span class="kb-tag-chip" data-localize-skip="true">${esc(label)}</span>`).join("")}
                ${toolsList.length ? `<span class="kb-tag-chip">Công cụ: <code data-localize-skip="true">${esc(toolsList.join(", "))}</code></span>` : ""}
                ${disallowedList.length ? `<span class="kb-tag-chip">Chặn: <code data-localize-skip="true">${esc(disallowedList.join(", "))}</code></span>` : ""}
              </div>
            </div>
          </div>
        </section>
        <section class="settings-card skill-doc-card is-subagent-card">
          <header class="skill-doc-card-head">
            <div class="skill-doc-card-title">
              ${icon("file-text", 14)}
              <strong>${isCodexToml ? "config.toml" : `${esc(activeProfile.name)}.md`}</strong>
              ${activeProfile.source ? `<small data-localize-skip="true">${esc(activeProfile.source)}</small>` : ""}
            </div>
            <div class="skill-doc-card-actions">
              ${activeProfile.workspaceScoped && activeWs && activeWs.trustedSkills !== false
                ? `<button type="button" class="button quiet small" data-action="toggle-workspace-trust" data-id="${esc(activeWs.id)}">${icon("shield-alert", 13)}<span>Thu hồi tin cậy dự án</span></button>`
                : ""}
              ${activeProfile.editable
                ? `<button type="button" class="button quiet small" data-action="start-inline-subagent-edit" data-id="${esc(activeProfile.id)}">${icon("square-pen", 13)}<span>Sửa</span></button>
                   <button type="button" class="button quiet small" data-action="delete-subagent-profile" data-id="${esc(activeProfile.id)}">${icon("delete", 13)}<span>Xóa</span></button>`
                : `<button type="button" class="button quiet small" data-action="copy-subagent-profile" data-id="${esc(activeProfile.id)}">${icon("copy", 13)}<span>Sao chép thành Markdown</span></button>`}
            </div>
          </header>
          <div class="skill-doc-body">
            ${isCodexToml
              ? (rawContent ? `<pre class="subagent-toml-preview"><code data-localize-skip="true">${esc(rawContent)}</code></pre>` : `<p class="neural-muted">Đang tải cấu hình vai trò Codex…</p>`)
              : (rawContent || promptBody
                ? `<article class="markdown-preview kb-markdown-doc">${renderMarkdown(promptBody || rawContent)}</article>`
                : `<p class="neural-muted">Đang tải nội dung hồ sơ Subagent…</p>`)}
          </div>
        </section>
      </div>
    </div>`;
  } else {
    centerBodyHtml = `<div class="file-preview-empty kb-empty-stage">
      ${wsTrustBanner}
      ${icon("waypoints", 20)}
      <strong>Chưa có hồ sơ Subagent tùy chỉnh</strong>
      <p>Tạo hồ sơ vai trò chuyên biệt (ví dụ: <code>code-reviewer</code>, <code>security-auditor</code>, <code>test-runner</code>) để biên dịch vào Claude Code, Codex CLI và Antigravity CLI.</p>
      <div class="kb-empty-actions">
        <button type="button" class="button quiet small" data-action="scan-subagent-profiles">${icon("refresh-cw", 13)}<span>Quét lại danh mục</span></button>
        <button type="button" class="button primary small" data-action="new-subagent-profile">${icon("plus", 13)}<span>Tạo hồ sơ Subagent</span></button>
      </div>
    </div>`;
  }

  return `<section class="minimal-center-stage" aria-label="Không gian Hồ sơ Subagent">
    <header class="kb-stage-topbar is-skill-topbar">
      <div class="kb-topbar-left">
        <button type="button" class="button quiet small kb-mobile-drawer-btn" data-action="toggle-chat-drawer">${icon("waypoints", 13)}<span>Hồ sơ (${allProfiles.length})</span></button>
        <div class="kb-active-doc-info">
          <strong ${activeProfile ? 'data-localize-skip="true"' : ""}>${esc(activeProfile ? activeProfile.name : "Hồ sơ Subagent")}</strong>
          <small ${activeProfile ? 'data-localize-skip="true"' : ""}>${activeProfile ? esc(activeProfile.source || "Hồ sơ Subagent") : `${allProfiles.length} hồ sơ đã quét`}</small>
          ${activeProfile ? `<span class="kb-tag-chip is-inline-badge">${activeProfile.editable ? "Có thể sửa" : "Chỉ đọc"}</span>` : ""}
        </div>
      </div>
      <div class="kb-topbar-right">
        ${sectionTabsHtml}
        ${isEditing && activeProfile
          ? `<button type="button" class="button quiet small" data-action="cancel-inline-subagent-edit">Hủy</button>
             <button type="button" class="button primary small" data-action="save-inline-subagent" data-id="${esc(activeProfile.id)}">${icon("check", 13)}<span>Lưu</span></button>`
          : `<button type="button" class="button quiet small" data-action="scan-subagent-profiles" title="Quét lại danh mục hồ sơ Subagent">${icon("refresh-cw", 13)}<span>Quét lại</span></button>
             <button type="button" class="button primary small" data-action="new-subagent-profile">${icon("plus", 13)}<span>Tạo hồ sơ Subagent</span></button>`}
      </div>
    </header>
    <div class="kb-stage-body">
      ${centerBodyHtml}
    </div>
  </section>`;
}

export function skillPage() {
  const allSkills = view.skills || [];
  const allProfiles = view.subagentProfiles || [];
  const section = view.skillsSection === "subagents" ? "subagents" : "skills";
  const sectionTabsHtml = `<div class="vault-mode-tabs" role="tablist" aria-label="Chế độ xem Kỹ năng và Hồ sơ Subagent">
    <button type="button" class="vault-mode-tab ${section === "skills" ? "is-active" : ""}" data-action="skills-section" data-section="skills">${icon("notebook-tabs", 13)}<span>Kỹ năng (${allSkills.length})</span></button>
    <button type="button" class="vault-mode-tab ${section === "subagents" ? "is-active" : ""}" data-action="skills-section" data-section="subagents">${icon("waypoints", 13)}<span>Hồ sơ Subagent${view.subagentProfilesLoaded ? ` (${allProfiles.length})` : ""}</span></button>
  </div>`;

  if (section === "subagents") {
    return subagentSectionPage(allSkills, sectionTabsHtml);
  }

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
            <div class="skill-doc-card-actions">
              ${activeSkill.editable
                ? `<button type="button" class="button quiet small" data-action="start-inline-skill-edit" data-id="${esc(activeSkill.id)}">${icon("square-pen", 13)}<span>Sửa</span></button>
                   <button type="button" class="button quiet small" data-action="delete-skill" data-id="${esc(activeSkill.id)}">${icon("delete", 13)}<span>Xóa</span></button>`
                : `<button type="button" class="button quiet small" data-action="copy-skill" data-id="${esc(activeSkill.id)}">${icon("copy", 13)}<span>Sao chép để sửa</span></button>`}
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
    <header class="kb-stage-topbar is-skill-topbar">
      <div class="kb-topbar-left">
        <button type="button" class="button quiet small kb-mobile-drawer-btn" data-action="toggle-chat-drawer">${icon("notebook-tabs", 13)}<span>Danh sách (${allSkills.length})</span></button>
        <div class="kb-active-doc-info">
          <strong>${esc(activeSkill ? activeSkill.name : "Thư viện Kỹ năng")}</strong>
          <small>${activeSkill ? esc((activeSkill.sources || [activeSkill.source]).join(" · ")) : `${allSkills.length} skill cục bộ`}</small>
          ${activeSkill ? `<span class="kb-tag-chip is-inline-badge">${activeSkill.editable ? "Cá nhân · Có thể sửa" : "Plugin / CLI · Chỉ đọc"}</span>` : ""}
        </div>
      </div>
      <div class="kb-topbar-right">
        ${sectionTabsHtml}
        ${isEditing && activeSkill
          ? `<button type="button" class="button quiet small" data-action="cancel-inline-skill-edit">Hủy</button>
             <button type="button" class="button primary small" data-action="save-inline-skill" data-id="${esc(activeSkill.id)}">${icon("check", 13)}<span>Lưu</span></button>`
          : `<button type="button" class="button primary small" data-action="new-skill">${icon("plus", 13)}<span>Tạo skill</span></button>`}
      </div>
    </header>
    <div class="kb-stage-body">
      ${centerBodyHtml}
    </div>
  </section>`;
}
