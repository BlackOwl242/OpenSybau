import { efforts, esc, icon, statuses, view } from "../../../shared/state.js";
import { connectorSupports, providerTitle, workflowRoles } from "../../../domain/agent-roles.js";
import { compactChatTitle } from "../../../shared/chat-labels.js";
import { getActiveRemoteHost, isMobileCompanionMode } from "../../../shared/remote-host.js";
import {
  chatAgentEditor,
  customSelectControl,
  formatEffortLabel,
  homeSelectField,
  normalizedChatSelection,
  normalizedRoleSelection,
  roleEditor,
} from "../ui-controls.js";
import {
  composerAddMenu,
  composerAttachmentsMarkup,
  composerPermissionMenuMarkup,
} from "../composer.js";
import { taskConversationPage } from "./chat-conversation.js";

export function availableArenaCompetitors() {
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

export function ensureHomeArenaSlots() {
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

export function chatPage() {
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
  const homeModeOptions = [
    { id: "chat", label: "Trò chuyện", icon: "message-circle" },
    { id: "code", label: "Viết code", icon: "square-terminal", disabled: !pipelineReady },
    { id: "plan", label: "Kế hoạch", icon: "list-checks", disabled: !planReady },
    { id: "arena", label: "Đa luồng", icon: "git-branch", title: "Chạy đa luồng nhiều agent (cùng hoặc khác model) trên các Git worktree riêng" },
  ];
  const activeHomeMode = homeModeOptions.find((mode) => mode.id === view.homeMode) || homeModeOptions[0];
  const homeModeMenu = `<details class="codex-pop-menu is-up is-right home-mode-picker" data-pop-id="home-mode">
    <summary class="codex-rail-pill" title="Chế độ làm việc" aria-label="Chế độ làm việc" aria-haspopup="menu">${icon(activeHomeMode.icon, 14)}<span data-localize-skip="true">${activeHomeMode.label}</span>${icon("chevron-down", 12)}</summary>
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
        const provOptions = arenaCandidates.map((c) => ({ value: c.provider, label: c.name }));
        const modOptions = models.length ? models.map((m) => ({ value: m.id, label: m.name || m.id })) : [{ value: "", label: "Mặc định" }];
        const effOptions = slotEfforts.map((ef) => ({ value: ef, label: formatEffortLabel(ef) }));
        return `<div class="arena-slot-row">
          <span class="arena-slot-badge">#${idx + 1}</span>
          ${customSelectControl(`arenaProvider${idx}`, `data-arena-slot-provider="${idx}"`, provOptions, slot.provider, { extraClass: "arena-slot-picker", ariaLabel: `Agent nhánh ${idx + 1}`, popId: `arena-prov-${idx}` })}
          ${customSelectControl(`arenaModel${idx}`, `data-arena-slot-model="${idx}"`, modOptions, slot.model || modOptions[0]?.value || "", { extraClass: "arena-slot-picker is-model", ariaLabel: `Model nhánh ${idx + 1}`, popId: `arena-mod-${idx}` })}
          ${customSelectControl(`arenaEffort${idx}`, `data-arena-slot-effort="${idx}"`, effOptions, slot.effort, { extraClass: "arena-slot-picker is-effort", ariaLabel: `Mức suy nghĩ nhánh ${idx + 1}`, popId: `arena-eff-${idx}` })}
          <button type="button" class="arena-slot-icon" data-action="arena-clone-slot" data-index="${idx}" ${arenaSlots.length >= 8 ? "disabled" : ""} title="Nhân bản thêm 1 nhánh giống hệt nhánh này">${icon("copy", 13)}</button>
          <button type="button" class="arena-slot-icon is-danger" data-action="arena-remove-slot" data-index="${idx}" ${arenaSlots.length <= 2 ? "disabled" : ""} title="Xóa nhánh này">${icon("x", 13)}</button>
        </div>`;
      }).join("")}
    </div>
  </div>` : "";

  const heroEmblem = `<div class="codex-hero-emblem" aria-hidden="true">
    <svg class="wb-hero-svg" viewBox="0 0 64 64" width="30" height="30" fill="none">
      <defs>
        <clipPath id="wbHeroLogoClip">
          <circle cx="19.6" cy="19.8" r="6.8" />
          <circle cx="44.4" cy="44.2" r="6.8" />
          <path d="M29.8 24.2C29.8 23.45 30.22 22.76 30.89 22.43L48.72 13.51C49.91 12.92 51.2 13.78 51.2 15.11V24.9C51.2 25.65 50.78 26.34 50.11 26.67L35.09 34.18C34.55 34.45 34.2 35 34.2 35.61V39.8C34.2 40.55 33.78 41.24 33.11 41.57L15.28 50.49C14.09 51.08 12.8 50.22 12.8 48.89V39.1C12.8 38.35 13.22 37.66 13.89 37.33L28.91 29.82C29.45 29.55 29.8 29 29.8 28.39V24.2Z" />
        </clipPath>
      </defs>
      <g class="wireframe">
        <circle cx="19.6" cy="19.8" r="6.1" />
        <circle cx="44.4" cy="44.2" r="6.1" />
        <path d="M29.8 24.2C29.8 23.45 30.22 22.76 30.89 22.43L48.72 13.51C49.91 12.92 51.2 13.78 51.2 15.11V24.9C51.2 25.65 50.78 26.34 50.11 26.67L35.09 34.18C34.55 34.45 34.2 35 34.2 35.61V39.8C34.2 40.55 33.78 41.24 33.11 41.57L15.28 50.49C14.09 51.08 12.8 50.22 12.8 48.89V39.1C12.8 38.35 13.22 37.66 13.89 37.33L28.91 29.82C29.45 29.55 29.8 29 29.8 28.39V24.2Z" />
      </g>
      <g clip-path="url(#wbHeroLogoClip)">
        <rect class="solid-fill-rect" x="-10" y="-10" width="84" height="84" fill="currentColor" />
      </g>
    </svg>
  </div>`;

  const isMobile = isMobileCompanionMode();
  const mobileDisconnected = isMobile && !getActiveRemoteHost()?.url;

  return `<section class="command-home">
    <div class="command-stage">
      <div class="home-welcome">
        ${heroEmblem}
        <h1>${activeWorkspace ? `Bạn muốn xây dựng gì trong ${esc(activeWorkspace.name)}?` : "Bạn muốn xây dựng gì?"}</h1>
      </div>
      ${chatProviders.length
        ? ""
        : mobileDisconnected
          ? `<div class="provider-connect-callout home-provider-empty"><span class="provider-connect-icon">${icon("laptop", 17)}</span><div><strong>Chưa kết nối với máy tính (PC)</strong><p>Điện thoại hoạt động như thiết bị điều khiển từ xa. Hãy ghép nối với OpenSybau trên máy tính qua cùng mạng Wi-Fi để bắt đầu.</p></div><div><button class="button primary small" type="button" data-action="mp-open-pair">Kết nối máy tính ngay</button></div></div>`
          : `<div class="provider-connect-callout home-provider-empty"><span class="provider-connect-icon">${icon("plug-zap", 17)}</span><div><strong>Chưa có agent sẵn sàng</strong><p>Kết nối API/model local hoặc cài và đăng nhập Codex, Claude Code hay Antigravity để bắt đầu.</p></div><div><button class="button primary small" type="button" data-action="desktop-open-settings">Mở cài đặt</button><button class="button quiet small" type="button" data-action="open-setup-assistant">Hướng dẫn</button></div></div>`}
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
              <button type="button" class="codex-rail-pill is-exec-env ${homeIsolated ? "is-active" : ""}" data-action="toggle-home-isolated" ${!canIsolateHome || isArena ? "disabled" : ""} title="${canIsolateHome ? (homeIsolated ? "Đang chạy trên nhánh Git Worktree cô lập (bấm để chuyển về chạy trực tiếp trên PC)" : "Đang chạy trực tiếp trên thư mục dự án PC (bấm để tách nhánh Git Worktree)") : "Môi trường thực thi trên máy tính PC"}">
                ${homeIsolated ? icon("git-branch", 14) : icon("laptop", 14)}
                <span>${homeIsolated ? "Git Worktree" : (isMobile ? "Trực tiếp trên PC" : "Máy tính này")}</span>
              </button>
              ${workflow !== "chat-only" && !isArena ? `<button type="button" class="codex-rail-pill ${view.homePlanGate ? "is-active" : ""}" data-action="toggle-home-plan-gate" title="Cổng duyệt kế hoạch (Trạm 2): Tạm dừng sau bước Lập kế hoạch để bạn duyệt trước khi Agent sửa code">
                ${icon("shield-check", 13)}
                <span>Duyệt kế hoạch: ${view.homePlanGate ? "Bật" : "Tự động"}</span>
              </button>` : ""}
              ${workflow === "codex-antigravity" && !isArena ? `<button type="button" class="codex-rail-pill ${(view.homeMaxRounds || 2) > 1 ? "is-active" : ""}" data-action="cycle-home-max-rounds" title="Số vòng tự động sửa lỗi (Triển khai ↔ Đánh giá) tối đa khi phát hiện lỗi">
                ${icon("refresh-cw", 13)}
                <span>Vòng sửa: ${view.homeMaxRounds || 2}</span>
              </button>` : ""}
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
                  <summary class="codex-inline-trigger is-effort" title="Mức suy luận">
                    <span>${esc(formatEffortLabel(chatSelection.effort))}</span>
                    ${icon("chevron-down", 12)}
                  </summary>
                  <div class="codex-pop-card is-effort-list">
                    <div class="codex-pop-head">Mức suy luận</div>
                    <div class="codex-pop-scroll">
                      ${activeEfforts.map((ef) => `<button type="button" class="codex-pop-item ${ef === chatSelection.effort ? "is-selected" : ""}" data-action="pick-home-effort" data-effort="${esc(ef)}">
                        <span class="codex-pop-item-main"><span>${esc(formatEffortLabel(ef))}</span></span>
                        ${ef === chatSelection.effort ? icon("check", 13) : ""}
                      </button>`).join("")}
                    </div>
                  </div>
                </details>
              </div>` : `<button type="button" class="codex-footer-btn" data-action="toggle-home-config">${esc(compactAgentLabel)} ${icon("chevron-down", 12)}</button>`}
              <button class="home-submit" type="submit" aria-label="${isArena ? "Khởi chạy Đa luồng" : workflow === "chat-only" ? "Gửi tin nhắn" : "Chạy task"}" title="${isArena ? "Khởi chạy Đa luồng" : workflow === "chat-only" ? "Gửi tin nhắn" : "Chạy task"}" ${canRun || !workspaces.length ? "" : "disabled"}>${icon("arrow-up-right", 16)}</button>
            </div>
          </footer>
          <div class="composer-config-backdrop home-config-backdrop" ${view.homeConfigOpen ? "" : "hidden"}><section class="composer-config-dialog app-dialog-shell" role="dialog" aria-modal="true" aria-label="Cấu hình tác vụ"><header class="app-dialog-header"><div><small>OPENSYBAU</small><h2>Cấu hình tác vụ</h2></div><button type="button" class="icon-button app-dialog-close" data-action="close-composer-config" aria-label="Đóng" title="Đóng">${icon("x", 16)}</button></header><div class="app-dialog-content composer-config-content"><div class="composer-config-grid">${homeSelectField("Workspace", "workspaceId", "data-home-workspace required", workspaces.length ? workspaces.map((workspace) => ({ value: workspace.id, label: workspace.name })) : [{ value: "", label: "Thêm workspace để bắt đầu" }], activeWorkspaceId, !workspaces.length || isSplitCreation)}${homeSelectField("Luồng", "workflow", "data-home-workflow", [{ value: "chat-only", label: "Chat · một agent" }, { value: "codex-antigravity", label: "Pipeline · Kế hoạch → Triển khai → Review", disabled: !pipelineReady }, { value: "plan-only", label: "Chỉ lập kế hoạch", disabled: !planReady }], workflow)}</div><div class="composer-config-grid home-security-grid"><div class="home-config-permission"><span>Quyền truy cập</span>${composerPermissionMenuMarkup(homePermissionPreset, "home-config")}<input type="hidden" name="permissionPreset" value="${esc(homePermissionPreset)}"></div><label class="check-row home-isolation-row"><input type="checkbox" name="isolated" data-home-isolated ${homeIsolated ? "checked" : ""} ${canIsolateHome && !isSplitCreation ? "" : "disabled"}><span><strong>Tách Git worktree riêng</strong><small>${isSplitCreation ? "Bắt buộc để mở trong khung chat song song" : canIsolateHome ? `Nhánh ${esc(activeWorkspace?.runtime?.branch || "HEAD")} · chạy song song an toàn` : "Cần Git repo có ít nhất 1 commit"}</small></span></label></div><div class="chat-agent-role" ${workflow === "chat-only" ? "" : "hidden"}>${chatAgentEditor({ provider: chatSelection.provider, model: chatSelection.model?.id, effort: chatSelection.effort })}</div><div class="agent-role-grid home-role-grid" ${workflow === "chat-only" ? "hidden" : ""}>${workflowRoles.map((role) => roleEditor(role.id, roleSelections[role.id])).join("")}</div></div><footer class="app-dialog-footer"><span>${icon("notebook-tabs", 14)} Skill tự chọn · ${view.skills.length} · Tối đa ${view.state.settings.maxConcurrent} task song song</span><button type="button" class="button primary" data-action="close-composer-config">Xong</button></footer></section></div>
        </form>
        <div class="home-quick-prompts" aria-label="Gợi ý bắt đầu nhanh">
          <button type="button" class="home-quick-prompt-chip" data-action="fill-home-prompt" data-prompt="Kiểm tra lỗi toàn bộ dự án, chạy test và đề xuất cách khắc phục">${icon("shield-check", 13)}<span>Kiểm tra lỗi & test</span></button>
          <button type="button" class="home-quick-prompt-chip" data-action="fill-home-prompt" data-prompt="Phân tích cấu trúc thư mục, luồng dữ liệu và tóm tắt kiến trúc chính của dự án">${icon("layers", 13)}<span>Tóm tắt kiến trúc</span></button>
          <button type="button" class="home-quick-prompt-chip" data-action="fill-home-prompt" data-prompt="Lên kế hoạch triển khai tính năng mới kèm các bước kiểm thử">${icon("list-checks", 13)}<span>Lên kế hoạch</span></button>
          <button type="button" class="home-quick-prompt-chip" data-action="fill-home-prompt" data-prompt="Kiểm tra git status, git diff hiện tại và đánh giá rủi ro trước khi commit">${icon("git-branch", 13)}<span>Review Git diff</span></button>
        </div>
      </div>
    </div>
  </section>`;
}

export function multiChatPage() {
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
  const createModal = view.chatSplitCreateOpen ? `<div class="composer-config-backdrop multi-chat-create-backdrop"><form class="home-composer composer-config-dialog app-dialog-shell multi-chat-create-form" data-modal data-form="home-task" data-split-chat-create="true" role="dialog" aria-modal="true" aria-label="${en ? "Create parallel chat" : "Tạo chat song song"}"><header class="app-dialog-header"><div><small>${en ? "PARALLEL CHAT" : "CHAT SONG SONG"}</small><h2>${en ? "Create chat in new pane" : "Tạo chat trong khung mới"}</h2></div><button type="button" class="icon-button app-dialog-close" data-action="close-split-chat-create" aria-label="${en ? "Close" : "Đóng"}" title="${en ? "Close" : "Đóng"}">${icon("x", 16)}</button></header><div class="app-dialog-content composer-config-content multi-chat-create-content"><input type="hidden" name="workspaceId" value="${esc(workspace.id)}"><input type="hidden" name="workflow" value="chat-only"><input type="hidden" name="isolated" value="true"><p class="multi-chat-create-description">${en ? "This chat will run on a separate Git worktree in" : "Chat mới sẽ chạy trên Git worktree riêng trong"} <strong>${esc(workspace.name)}</strong>.</p><label class="multi-chat-create-prompt">${en ? "Prompt" : "Yêu cầu"}<div class="multi-chat-create-input composer-input-wrap"><textarea class="chat-input" name="prompt" data-home-prompt minlength="6" maxlength="50000" rows="3" autofocus placeholder="${en ? "What should the agent do in this chat?" : "Bạn muốn agent làm gì trong đoạn chat mới?"}">${esc(view.chatSplitCreateDraft)}</textarea></div></label>${chatAgentEditor({ provider: createSelection.provider, model: createSelection.model?.id, effort: createSelection.effort })}<div class="home-config-permission"><span>${en ? "Access" : "Quyền truy cập"}</span>${composerPermissionMenuMarkup(view.homePermissionPreset || activeTask?.permissionPreset || "workspace-write", "home-config")}<input type="hidden" name="permissionPreset" value="${esc(view.homePermissionPreset || activeTask?.permissionPreset || "workspace-write")}" data-home-permission></div></div><footer class="app-dialog-footer multi-chat-create-footer"><button type="button" class="button quiet" data-action="close-split-chat-create">${en ? "Cancel" : "Hủy"}</button><button type="submit" class="button primary">${icon("arrow-up-right", 15)} ${en ? "Create chat pane" : "Tạo khung chat"}</button></footer></form></div>` : "";
  return `<section class="multi-chat-page">${picker}${createModal}<div class="multi-chat-grid ${tasks.length < 2 ? "is-single" : tasks.length === 3 ? "is-three" : tasks.length > 3 ? "is-four" : ""}">${panes || `<div class="multi-chat-start"><strong>Chưa có chat để chia khung</strong><p>Bấm dấu + trên thanh tab để mở chat.</p></div>`}</div></section>`;
}

export function homeSearchResults(query) {
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

export function clearSidebarSearch() {
  view.searchQuery = "";
  view.searchResults = "";
  view.sidebarSearchOpen = false;
  document.querySelectorAll("[data-home-search]").forEach((input) => { input.value = ""; });
  document.querySelectorAll("[data-home-search-results]").forEach((results) => { results.innerHTML = ""; results.hidden = true; });
}
