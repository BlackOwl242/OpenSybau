import { h } from "preact";
import { useEffect, useState } from "preact/hooks";
import { StableHtml } from "./components/StableHtml.jsx";
import { NavRail } from "./components/NavRail.jsx";
import { ContextSidebar } from "./components/ContextSidebar.jsx";
import { MobileNav } from "./components/MobileNav.jsx";
import { TopBar } from "./components/TopBar.jsx";
import { DesktopSetupDialog } from "./components/DesktopSetupDialog.jsx";
import { MobileOrcaHeader, MobileOrcaOverlay } from "./components/MobileOrcaShell.jsx";
import { pageLayouts, pageTitles } from "./navigation.js";
import { Icon } from "../shared/ui/Icon.jsx";
import { BrandLogo } from "../shared/ui/BrandLogo.jsx";
import { formatNumber } from "../shared/i18n.js";
import { THEMES, THEME_GROUPS, getThemeDefinition } from "../shared/themes.js";
import { compactChatTitle } from "../shared/chat-labels.js";
import { isMobileCompanionMode } from "../shared/remote-host.js";
import { findQuotaPeriod, quotaWindowsWithPeriods } from "../shared/quota-windows.js";

function computeWindowUsage(win) {
  if (!win || win.unavailable) return null;
  const rawUsed = win.usedPercent;
  const rawRem = win.remainingPercent;
  let usedPercent = null;
  if (rawUsed !== null && rawUsed !== undefined && rawUsed !== "" && Number.isFinite(Number(rawUsed))) {
    usedPercent = Math.max(0, Math.min(100, Number(rawUsed)));
  } else if (rawRem !== null && rawRem !== undefined && rawRem !== "" && Number.isFinite(Number(rawRem))) {
    usedPercent = Math.max(0, Math.min(100, 100 - Number(rawRem)));
  }
  if (usedPercent === null) return null;
  const remainingPercent = Math.max(0, Math.min(100, 100 - usedPercent));
  return { usedPercent, remainingPercent };
}

function quotaToneClasses(usedPercent) {
  const used = Number(usedPercent || 0);
  if (used >= 90) return "is-danger is-critical";
  if (used >= 70) return "is-warn is-warning";
  return "is-ok is-normal";
}

function formatQuotaWindowLabel(label, english) {
  const raw = String(label || "").toLowerCase();
  if (raw === "5h") return "5h";
  if (raw === "7d" || raw === "weekly") return english ? "7d" : "7 ngày";
  return label;
}

function formatQuotaReset(isoTime, english = false) {
  if (!isoTime) return "";
  const diffMs = Date.parse(isoTime) - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return english ? "now" : "sắp đặt lại";
  const totalMins = Math.max(1, Math.round(diffMs / 60_000));
  if (totalMins >= 1440) {
    const days = Math.floor(totalMins / 1440);
    const hours = Math.floor((totalMins % 1440) / 60);
    return english
      ? `${days}d${hours ? ` ${hours}h` : ""}`
      : `${days}n${hours ? ` ${hours}g` : ""}`;
  }
  if (totalMins >= 60) {
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return english
      ? `${hours}h${mins ? ` ${mins}m` : ""}`
      : `${hours}g${mins ? ` ${mins}p` : ""}`;
  }
  return english ? `${totalMins}m` : `${totalMins}p`;
}

function QuotaWindowRow({ win, english }) {
  if (!win || win.unavailable) {
    return (
      <div class="wb-quota-window-row">
        <div class="wb-quota-window-meta">
          <span class="wb-quota-window-label">
            <b>{win?.label === "5h" ? "5h" : english ? "7d" : "7 ngày"}</b>
          </span>
          <span class="wb-quota-unavailable">{english ? "No data" : "Chưa có dữ liệu"}</span>
        </div>
      </div>
    );
  }

  const usage = computeWindowUsage(win) || { usedPercent: 0, remainingPercent: 100 };
  const { usedPercent, remainingPercent } = usage;
  const toneClasses = quotaToneClasses(usedPercent);
  const resetLabel = formatQuotaReset(win.resetsAt, english);
  const summaryText = english
    ? `Used ${Math.round(usedPercent)}% · ${Math.round(remainingPercent)}% left`
    : `Đã dùng ${Math.round(usedPercent)}% · Còn ${Math.round(remainingPercent)}%`;

  return (
    <div class="wb-quota-window-row">
      <div class="wb-quota-window-meta">
        <span class="wb-quota-window-label">
          <b>{formatQuotaWindowLabel(win.label, english)}</b>
          {resetLabel ? <> · <small style={{ fontVariantNumeric: "tabular-nums" }}>{resetLabel}</small></> : null}
        </span>
        <strong
          class={`wb-quota-pct ${toneClasses}`}
          style={{ fontVariantNumeric: "tabular-nums" }}
          data-localize-skip="true"
        >
          {summaryText}
        </strong>
      </div>
      <div
        class="wb-quota-bar"
        role="progressbar"
        aria-valuenow={Math.round(usedPercent)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <i class={`wb-quota-fill ${toneClasses}`} style={{ width: `${usedPercent}%` }} />
      </div>
    </div>
  );
}

function StatusBar({ snapshot }) {
  const state = snapshot.state;
  const telemetry = state?.telemetry || {};
  const quotas = snapshot.quotas?.providers || snapshot.quotas || {};
  const quotasLoading = Boolean(snapshot.quotasLoading);
  const selectedId = snapshot.selectedTaskId || snapshot.selected;
  const task = selectedId ? state?.tasks?.find((item) => item.id === selectedId) : null;
  const workspace = task
    ? state?.workspaces?.find((item) => item.id === task.workspaceId)
    : state?.workspaces?.find((item) => item.id === (snapshot.selectedWorkspaceId || snapshot.homeWorkspaceId))
      || state?.workspaces?.[0]
      || null;
  const runningCount = Number(telemetry.runningCount || 0);
  const queuedCount = Number(telemetry.queuedCount || 0);
  const worktreeCount = Number(telemetry.worktreeCount || 0);
  const activeSubagentCount = Number(telemetry.activeSubagentCount || 0);
  const subagentRunsTotal = Number(telemetry.subagentRunsTotal || 0);
  const tokens5h = Number(telemetry.tokens5h || 0);
  const tokens7d = Number(telemetry.tokens7d || 0);
  const usageProviders = [
    ["codex", "Codex CLI", "Codex"],
    ["claude", "Claude Code", "Claude"],
    ["antigravity", "Antigravity", "AGY"],
  ];
  const connected = snapshot.streamConnected !== false;
  const english = snapshot.language === "en";

  const liveBadges = usageProviders
    .map(([id, fullName, shortName]) => {
      const q = quotas[id];
      const windows = q?.groups?.[0]?.windows || q?.windows || [];
      const win5h = findQuotaPeriod(windows, "5h");
      const weekly = findQuotaPeriod(windows, "7d");
      const u5 = computeWindowUsage(win5h);
      const u7 = computeWindowUsage(weekly);
      if ((!u5 && !u7) || q?.status !== "ok") return null;
      const primary = u5 || u7;
      const maxUsed = Math.max(u5?.usedPercent ?? 0, u7?.usedPercent ?? 0);
      const toneClasses = quotaToneClasses(maxUsed);

      const tipParts = [fullName];
      if (u5) {
        const r5 = formatQuotaReset(win5h?.resetsAt, english);
        tipParts.push(
          english
            ? `5h: Used ${Math.round(u5.usedPercent)}% · ${Math.round(u5.remainingPercent)}% left${r5 ? ` (resets ${r5})` : ""}`
            : `5h: Đã dùng ${Math.round(u5.usedPercent)}% · Còn ${Math.round(u5.remainingPercent)}%${r5 ? ` (đặt lại ${r5})` : ""}`
        );
      }
      if (u7) {
        const r7 = formatQuotaReset(weekly?.resetsAt, english);
        tipParts.push(
          english
            ? `7d: Used ${Math.round(u7.usedPercent)}% · ${Math.round(u7.remainingPercent)}% left${r7 ? ` (resets ${r7})` : ""}`
            : `7d: Đã dùng ${Math.round(u7.usedPercent)}% · Còn ${Math.round(u7.remainingPercent)}%${r7 ? ` (đặt lại ${r7})` : ""}`
        );
      }
      return {
        id,
        shortName,
        primaryUsed: primary.usedPercent,
        toneClasses,
        tooltip: tipParts.join(" · "),
      };
    })
    .filter(Boolean);

  return (
    <footer class="wb-statusbar" aria-label="Trạng thái hệ thống và hạn mức">
      <div class="wb-status-left">
        {!connected ? (
          <span class="wb-status-item wb-status-conn is-offline">
            <i class="wb-status-dot is-offline" />
            <span>Đang kết nối lại…</span>
          </span>
        ) : null}
        {workspace ? (
          <span class="wb-status-item" title={workspace.path}>
            <Icon name="folder-code" size={14} />
            <span data-localize-skip="true">{workspace.name}</span>
          </span>
        ) : null}
      </div>
      <div class="wb-status-right">
        <button type="button" class="wb-status-item wb-status-btn" data-page="tasks" title="Xem danh sách tác vụ">
          <span class={`wb-task-dot is-${runningCount > 0 ? "running" : queuedCount > 0 ? "queued" : "done"}`} />
          <span style={{ fontVariantNumeric: "tabular-nums" }}>
            {runningCount > 0 ? `${runningCount} agent đang chạy` : "0 đang chạy"}
            {queuedCount > 0 ? ` · ${queuedCount} chờ` : ""}
          </span>
        </button>
        {activeSubagentCount > 0 ? (
          <span class="wb-status-item is-subagent-live" title="Số Subagent đang hoạt động trên các CLI">
            <Icon name="waypoints" size={14} />
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{activeSubagentCount} subagent</span>
          </span>
        ) : null}
        {worktreeCount > 0 ? (
          <span class="wb-status-item" title="Số Git worktree cô lập đang mở">
            <Icon name="git-branch" size={14} />
            <span style={{ fontVariantNumeric: "tabular-nums" }}>{worktreeCount} worktree</span>
          </span>
        ) : null}
        {liveBadges.map((badge) => (
          <button
            type="button"
            class="wb-status-item wb-status-btn wb-status-quota-pill"
            key={badge.id}
            data-action="open-cli-settings"
            data-page="settings"
            data-settings-target="cli"
            data-provider={badge.id}
            title={badge.tooltip}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            <i class={`wb-quota-dot ${badge.toneClasses}`} />
            <span data-localize-skip="true">
              {badge.shortName} · {english ? `Used ${Math.round(badge.primaryUsed)}%` : `Đã dùng ${Math.round(badge.primaryUsed)}%`}
            </span>
          </button>
        ))}
        <details class="wb-status-usage">
          <summary
            class="wb-status-item wb-status-quota"
            style={{ fontVariantNumeric: "tabular-nums" }}
            title="Xem chi tiết hạn mức tài khoản Codex, Claude, Antigravity và lượng token sử dụng"
          >
            <span>5h: <strong>{formatNumber(tokens5h)}</strong> tok</span>
            <span class="wb-status-sep">·</span>
            <span>7d: <strong>{formatNumber(tokens7d)}</strong> tok</span>
          </summary>
          <div class="wb-usage-popover">
            <div class="wb-usage-popover-head">
              <strong>{english ? "Agent Quotas" : "Hạn mức Agent"}</strong>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <button
                  type="button"
                  class="wb-quota-refresh-btn"
                  data-action="open-cli-settings"
                  data-page="settings"
                  data-settings-target="cli"
                  title={english ? "Configure CLI & Quotas" : "Cấu hình CLI & Hạn mức"}
                >
                  <Icon name="settings-2" size={14} />
                  <span>CLI</span>
                </button>
                <button
                  type="button"
                  class="wb-quota-refresh-btn"
                  data-action="refresh-quotas"
                  disabled={quotasLoading}
                  title={english ? "Refresh quotas" : "Làm mới hạn mức"}
                >
                  <Icon name="refresh-cw" size={14} />
                  <span>{quotasLoading ? (english ? "Checking…" : "Đang tải…") : (english ? "Refresh" : "Làm mới")}</span>
                </button>
              </div>
            </div>
            <div class="wb-quota-card-list">
              {usageProviders.map(([id, name]) => {
                const q = quotas[id] || {};
                const hasGroups = Array.isArray(q.groups) && q.groups.length > 0;
                const hasWindows = Array.isArray(q.windows) && q.windows.length > 0;
                const isReady = hasGroups || hasWindows;
                return (
                  <section class={`wb-quota-card ${isReady ? "" : "is-compact"}`} key={id} data-quota-provider={id}>
                    <header class="wb-quota-card-head">
                      <button
                        type="button"
                        class="wb-quota-card-title"
                        data-action="open-cli-settings"
                        data-page="settings"
                        data-settings-target="cli"
                        data-provider={id}
                        style={{ background: "none", border: 0, padding: 0, cursor: "pointer", color: "inherit" }}
                      >
                        <span class={`wb-quota-dot ${isReady ? "is-ok is-normal" : "is-muted"}`} />
                        <strong>{name}</strong>
                        {q.planType ? <span class="wb-quota-plan-badge" data-localize-skip="true">{q.planType}</span> : null}
                      </button>
                      <span class="wb-quota-account" data-localize-skip="true">
                        {q.email || (!isReady ? (quotasLoading ? (english ? "Checking…" : "Đang kiểm tra…") : (english ? "Not connected" : "Chưa kết nối")) : "")}
                      </span>
                    </header>
                    {hasGroups ? (
                      <div class="wb-quota-groups">
                        {q.groups.map((group) => (
                          <div class="wb-quota-group" key={group.name}>
                            <div class="wb-quota-group-title" data-localize-skip="true">{group.name}</div>
                            <div class="wb-quota-grid">
                              {quotaWindowsWithPeriods(group.windows).map((win) => (
                                <QuotaWindowRow key={win.id} win={win} english={english} />
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : hasWindows ? (
                      <div class="wb-quota-grid">
                        {quotaWindowsWithPeriods(q.windows).map((win) => (
                          <QuotaWindowRow key={win.id} win={win} english={english} />
                        ))}
                      </div>
                    ) : null}
                  </section>
                );
              })}
            </div>
            {tokens5h > 0 || tokens7d > 0 || subagentRunsTotal > 0 ? (
              <footer class="wb-quota-popover-foot" style={{ fontVariantNumeric: "tabular-nums" }}>
                <span>OpenSybau Tokens{subagentRunsTotal > 0 ? ` · ${subagentRunsTotal} subagents` : ""}</span>
                <span>
                  5h: <b>{formatNumber(tokens5h)}</b> · 7d: <b>{formatNumber(tokens7d)}</b>
                </span>
              </footer>
            ) : null}
          </div>
        </details>
      </div>
    </footer>
  );
}

function WindowChrome({ snapshot, isMobileCompanion, sidebarCollapsed, mobileSidebarOpen, onToggleSidebar, onCloseSidebar }) {
  const desktop = typeof window !== "undefined" ? window.opensybauDesktop : null;
  const [updateState, setUpdateState] = useState(null);
  useEffect(() => {
    if (!desktop?.supportsAutoUpdate) return undefined;
    let active = true;
    const unsubscribe = desktop.onUpdateState((state) => {
      if (active) setUpdateState(state);
    });
    desktop
      .getUpdateState()
      .then((state) => {
        if (active) setUpdateState(state);
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [desktop]);

  const page = snapshot.page || "chat";
  const selectedId = snapshot.selectedTaskId || snapshot.selected;
  const task = page === "chat" && selectedId
    ? snapshot.state?.tasks?.find((item) => item.id === selectedId)
    : null;
  const workspace = task
    ? snapshot.state?.workspaces?.find((item) => item.id === task.workspaceId)
    : snapshot.state?.workspaces?.find((item) => item.id === (snapshot.selectedWorkspaceId || snapshot.homeWorkspaceId))
      || snapshot.state?.workspaces?.[0]
      || null;
  const mobileTitle = task ? compactChatTitle(task) : pageTitles[page] || "OpenSybau";
  const mobileSubtitle = workspace && ["chat", "tasks", "flows", "workspaces"].includes(page) ? workspace.name : "";
  const supportsDock = page === "chat" || page === "workspaces" || page === "skills" || (page === "knowledge" && Boolean(snapshot.state?.settings?.vaultPath));
  const dockOpen = Boolean(supportsDock && snapshot.chatDrawerOpen && snapshot.rightDockMarkup);

  const activeTheme = getThemeDefinition(snapshot.theme);
  const updateDownloaded = updateState?.status === "downloaded";
  const updateBusy = ["checking", "available", "downloading"].includes(updateState?.status);
  const updateLabel = updateDownloaded
    ? snapshot.language === "en"
      ? "Restart to update"
      : "Khởi động lại để cập nhật"
    : updateState?.status === "downloading"
      ? `${updateState.percent || 0}%`
      : updateBusy
        ? "..."
        : snapshot.language === "en"
          ? "Update"
          : "Cập nhật";

  return (
    <header
      class={`wb-window-chrome ${desktop ? "is-desktop" : "is-web"} ${isMobileCompanion ? "is-mobile-companion-hidden" : ""}`}
      style={isMobileCompanion ? { display: "none" } : undefined}
      aria-label="Thanh tiêu đề cửa sổ"
    >
      <div class="wb-window-chrome-left">
        <span class="wb-chrome-brand" aria-hidden="true">
          <BrandLogo clipId="wbChromeLogo" className="wb-chrome-brand-svg" size={16} />
        </span>
        <button type="button" class="wb-chrome-icon wb-desktop-nav-btn" onClick={() => window.history.back()} title="Quay lại" aria-label="Quay lại">
          <Icon name="arrow-left" size={14} />
        </button>
        <button type="button" class="wb-chrome-icon wb-desktop-nav-btn" onClick={() => window.history.forward()} title="Tiến tới" aria-label="Tiến tới">
          <Icon name="arrow-right" size={14} />
        </button>
        <button
          type="button"
          class={`wb-chrome-icon wb-sidebar-toggle-btn ${!sidebarCollapsed || mobileSidebarOpen ? "is-active" : ""}`}
          onClick={onToggleSidebar}
          title="Đóng/mở thanh bên trái"
          aria-label="Đóng/mở thanh bên trái"
        >
          <Icon name="sidebar-left" size={16} />
        </button>
        <div class="wb-mobile-chrome-title">
          <strong data-localize-skip={task ? "true" : undefined}>{mobileTitle}</strong>
          {mobileSubtitle ? <small data-localize-skip="true">{mobileSubtitle}</small> : null}
        </div>
      </div>
      <div class="wb-window-chrome-right">
        <button
          type="button"
          class="wb-chrome-icon wb-cmdk-btn"
          data-action="open-command-palette"
          title="Tìm kiếm & Lệnh nhanh (Ctrl+K)"
          aria-label="Tìm kiếm & Lệnh nhanh (Ctrl+K)"
        >
          <Icon name="search" size={16} />
        </button>
        {page === "chat" ? (
          <button
            type="button"
            class="wb-chrome-icon wb-mobile-only-btn"
            data-action="new-chat"
            style={isMobileCompanion ? { display: "none" } : undefined}
            title="Mở cuộc trò chuyện mới"
            aria-label="Mở cuộc trò chuyện mới"
          >
            <Icon name="plus" size={16} />
          </button>
        ) : null}
        <details
          class="codex-pop-menu is-down is-right wb-theme-menu"
          style={isMobileCompanion ? { display: "none" } : undefined}
        >
          <summary class="wb-chrome-pill wb-theme-trigger" title="Đổi chủ đề màu sắc (Theme)">
            <span
              class="wb-theme-dot"
              style={{
                backgroundColor: activeTheme.swatches[2] || activeTheme.swatches[0],
                width: "8px",
                height: "8px",
                borderRadius: "999px",
                display: "inline-block",
                flexShrink: 0,
              }}
            />
            <span class="wb-theme-trigger-label">{activeTheme.label}</span>
          </summary>
          <div class="codex-pop-card wb-theme-pop-card">
            {THEME_GROUPS.map((group) => {
              const groupThemes = THEMES.filter((item) => item.group === group.id);
              return (
                <div class="wb-theme-pop-group" key={group.id}>
                  <div class="codex-pop-title">{group.label}</div>
                  <div class="wb-theme-pop-grid">
                    {groupThemes.map((theme) => {
                      const isActive = theme.id === activeTheme.id;
                      return (
                        <button
                          key={theme.id}
                          type="button"
                          class={`codex-pop-item wb-theme-pop-item ${isActive ? "is-active is-selected" : ""}`}
                          data-action="pick-theme"
                          data-theme-id={theme.id}
                          title={theme.description}
                        >
                          <span class="wb-theme-swatch-mini" aria-hidden="true">
                            {theme.swatches.map((hex, index) => (
                              <i
                                key={index}
                                style={{
                                  backgroundColor: hex,
                                  display: "block",
                                  width: "100%",
                                  height: "100%",
                                  minWidth: "8px",
                                  minHeight: "20px",
                                }}
                              />
                            ))}
                          </span>
                          <span class="wb-theme-pop-copy">
                            <strong>{theme.label}</strong>
                            <small>{theme.badge}</small>
                          </span>
                          <span class="codex-pop-check wb-theme-pop-check">
                            {isActive ? <Icon name="check" size={14} /> : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
        <button class="wb-chrome-pill" type="button" data-action="toggle-language" title="Chuyển ngôn ngữ VI / EN">
          {snapshot.language === "en" ? "EN" : "VI"}
        </button>
        {supportsDock ? (
          <button
            type="button"
            class={`wb-chrome-icon wb-mobile-only-btn ${dockOpen ? "is-active" : ""}`}
            data-action="toggle-chat-drawer"
            onClick={(event) => {
              if (mobileSidebarOpen) {
                onCloseSidebar();
                if (dockOpen) event.stopPropagation();
              }
            }}
            title="Mở thanh công cụ bên phải"
            aria-label="Mở thanh công cụ bên phải"
          >
            <Icon name="sidebar-right" size={16} />
          </button>
        ) : null}
        {desktop?.supportsAutoUpdate ? (
          <button
            class={`wb-chrome-pill wb-update-btn ${updateDownloaded ? "is-ready" : ""}`}
            type="button"
            data-action={updateDownloaded ? "app-update-restart" : "app-update-check"}
            disabled={updateBusy}
            title={updateState?.status === "error" ? updateState.error : "Kiểm tra bản cập nhật mới"}
          >
            <Icon name={updateDownloaded ? "rotate-cw" : "download-cloud"} size={14} />
            <span>{updateLabel}</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}

export function AppShell({ snapshot, pageMarkup }) {
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => Boolean(snapshot?.sidebarCollapsed));
  const [bootSplashReady, setBootSplashReady] = useState(() => Boolean(snapshot?.state));

  useEffect(() => {
    if (typeof snapshot?.sidebarCollapsed === "boolean") {
      setSidebarCollapsed(snapshot.sidebarCollapsed);
    }
  }, [snapshot?.sidebarCollapsed]);

  useEffect(() => {
    if (snapshot?.state) {
      setBootSplashReady(true);
      return undefined;
    }
    const timer = setTimeout(() => setBootSplashReady(true), 120);
    return () => clearTimeout(timer);
  }, [Boolean(snapshot?.state)]);

  const isMobileCompanion = Boolean(snapshot?.isMobileCompanion ?? isMobileCompanionMode());
  const page = snapshot.page || "chat";
  const selectedId = snapshot.selectedTaskId || snapshot.selected;
  const hasStageTabs = (page === "chat" || page === "workspaces") && (snapshot.stageTabs?.length || 0) > 0;
  const isViewingFileTab = hasStageTabs && (snapshot.activeStageTabId !== "chat" || snapshot.stageSplit);
  const chatSplit = page === "chat" && Boolean(snapshot.chatSplitWorkspaceId);
  const home = page === "chat" && !selectedId && snapshot.mobileScreen !== "worktrees" && !isViewingFileTab && !chatSplit;

  const hasPageSidebarRaw = Boolean(snapshot.pageSidebarMarkup);
  const hasPageSidebar = hasPageSidebarRaw && !sidebarCollapsed;
  const hasContextSidebar = pageLayouts[page]?.sidebar === "context" && !hasPageSidebarRaw && !sidebarCollapsed;
  const hasRightDock = Boolean(snapshot.chatDrawerOpen && snapshot.rightDockMarkup);

  const mpSessionTab = snapshot.mpSessionTab || "chat";
  const hasMobileOverlay = isMobileCompanion
    && page === "chat"
    && Boolean(selectedId)
    && (mpSessionTab === "shell" || mpSessionTab === "terminal" || mpSessionTab === "plan")
    && (snapshot.activeStageTabId || "chat") === "chat";

  const splashDismissed = bootSplashReady || Boolean(snapshot?.state);

  const shellClasses = [
    "wb-app-shell",
    isMobileCompanion && "is-mobile-companion",
    hasMobileOverlay && "has-mp-overlay",
    hasContextSidebar && "has-context-sidebar",
    hasPageSidebar && "has-page-sidebar",
    hasContextSidebar && hasPageSidebar && "has-both-sidebars",
    hasRightDock && "has-right-dock",
    mobileSidebarOpen && "has-mobile-sidebar-open",
    sidebarCollapsed && "is-sidebar-collapsed",
  ]
    .filter(Boolean)
    .join(" ");

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [page, selectedId]);

  const rightDockScopeKey = `${page}:${snapshot.homeWorkspaceId || snapshot.selectedWorkspaceId || ""}:${selectedId || ""}:${snapshot.chatDrawerTab || ""}`;
  const mainStageScopeKey = `${page}:${snapshot.mobileScreen || "home"}:${snapshot.chatSplitWorkspaceId || selectedId || ""}`;

  return (
    <div class={shellClasses}>
      <div
        class={`wb-boot-splash ${splashDismissed ? "is-dismissed" : ""}`}
        style={splashDismissed ? { opacity: 0, pointerEvents: "none" } : { pointerEvents: "none" }}
        aria-hidden="true"
      >
        <div class="wb-boot-logo-stage">
          <BrandLogo clipId="wbSplashLogoClip" className="wb-boot-svg" size={64} />
        </div>
        <div class="wb-boot-copy">
          <strong class="wb-boot-title">OpenSybau</strong>
          <span class="wb-boot-subtitle">Đang khởi động không gian làm việc…</span>
        </div>
      </div>

      <WindowChrome
        snapshot={snapshot}
        isMobileCompanion={isMobileCompanion}
        sidebarCollapsed={sidebarCollapsed}
        mobileSidebarOpen={mobileSidebarOpen}
        onCloseSidebar={() => setMobileSidebarOpen(false)}
        onToggleSidebar={() => {
          if (window.matchMedia("(max-width: 740px)").matches) {
            setMobileSidebarOpen((prev) => !prev);
          } else {
            setSidebarCollapsed((prev) => {
              const next = !prev;
              try {
                localStorage.setItem("opensybau.sidebar-collapsed", next ? "1" : "0");
              } catch {}
              if (typeof window.__opensybauSetSidebarCollapsed === "function") {
                window.__opensybauSetSidebarCollapsed(next);
              }
              return next;
            });
          }
        }}
      />

      <NavRail page={page} snapshot={snapshot} />
      <ContextSidebar
        snapshot={snapshot}
        mobileOpen={mobileSidebarOpen}
        mobileOnly={!hasContextSidebar}
        onNavigate={() => setMobileSidebarOpen(false)}
      />
      {mobileSidebarOpen ? (
        <button
          class="wb-mobile-sidebar-backdrop"
          type="button"
          aria-label="Đóng danh sách workspace"
          onClick={() => setMobileSidebarOpen(false)}
        />
      ) : null}
      {hasPageSidebar && (
        <StableHtml
          as="aside"
          class="wb-page-sidebar"
          aria-label="Danh mục cài đặt"
          html={snapshot.pageSidebarMarkup}
          background={snapshot.backgroundUpdate}
          scope={page}
          scopeKey={page}
        />
      )}

      <main
        class={`wb-main ${home && !hasStageTabs ? "is-home-stage" : ""} ${hasStageTabs || chatSplit ? "has-stage-tabs" : ""} ${chatSplit ? "is-chat-split" : ""}`}
      >
        {isMobileCompanion ? <MobileOrcaHeader snapshot={snapshot} /> : null}
        <div class={`wb-workspace-split ${hasRightDock ? "has-right-dock" : ""}`}>
          <div class="wb-stage-column">
            {!isMobileCompanion ? <TopBar snapshot={snapshot} /> : null}
            <StableHtml
              id="content"
              class={`content wb-page-content ${home ? "is-home" : ""} ${(page === "chat" && selectedId) || isViewingFileTab || chatSplit ? "is-task-detail" : ""} ${isViewingFileTab ? "is-orca-tab-stage" : ""} ${(page === "knowledge" && snapshot.state?.settings?.vaultPath) || page === "skills" ? "is-knowledge-detail" : ""}`}
              html={pageMarkup}
              background={snapshot.backgroundUpdate}
              scope={mainStageScopeKey}
              scopeKey={mainStageScopeKey}
            />
            {isMobileCompanion ? <MobileOrcaOverlay snapshot={snapshot} /> : null}
          </div>
          {hasRightDock ? (
            <>
              <button
                class="wb-dock-backdrop"
                type="button"
                data-action="toggle-chat-drawer"
                aria-label="Đóng thanh bên phải"
              />
              <StableHtml
                as="aside"
                class="orca-right-dock"
                aria-label="Thanh công cụ mở rộng bên phải"
                html={snapshot.rightDockMarkup}
                background={snapshot.backgroundUpdate}
                scope={rightDockScopeKey}
                scopeKey={rightDockScopeKey}
              />
            </>
          ) : null}
        </div>
        <StatusBar snapshot={snapshot} />
      </main>

      <MobileNav page={page} snapshot={snapshot} />
      {snapshot.desktopSetupOpen && !isMobileCompanion && (
        <DesktopSetupDialog connectors={snapshot.connectors} installingProvider={snapshot.cliInstallProvider} />
      )}
    </div>
  );
}
