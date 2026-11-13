import { h } from "preact";
import { Icon } from "../../shared/ui/Icon.jsx";
import { BrandLogo } from "../../shared/ui/BrandLogo.jsx";
import { pageTitles } from "../navigation.js";
import { chatNumber, compactChatTitle } from "../../shared/chat-labels.js";
import { formatNumber } from "../../shared/i18n.js";
import {
  getActiveRemoteHost,
  getSavedRemoteHosts,
  isAndroidApkRuntime,
  isMobileCompanionMode,
} from "../../shared/remote-host.js";
import { findQuotaPeriod } from "../../shared/quota-windows.js";

const REPO_COLORS = ["blue", "green", "orange", "violet"];

function repoColorFor(id = "") {
  const str = String(id || "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return REPO_COLORS[Math.abs(hash) % REPO_COLORS.length];
}

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

function formatQuotaResetShort(isoTime) {
  if (!isoTime) return "";
  const diffMs = Date.parse(isoTime) - Date.now();
  if (!Number.isFinite(diffMs) || diffMs <= 0) return "sắp đặt lại";
  const totalMins = Math.max(1, Math.round(diffMs / 60_000));
  if (totalMins >= 1440) {
    const days = Math.floor(totalMins / 1440);
    const hours = Math.floor((totalMins % 1440) / 60);
    return `${days}n${hours ? ` ${hours}g` : ""}`;
  }
  if (totalMins >= 60) {
    const hours = Math.floor(totalMins / 60);
    const mins = totalMins % 60;
    return `${hours}g${mins ? ` ${mins}p` : ""}`;
  }
  return `${totalMins}p`;
}

function resolveAttentionTasks(snapshot) {
  if (Array.isArray(snapshot?.attentionTasks)) return snapshot.attentionTasks;
  const tasks = (snapshot?.state?.tasks || []).filter((t) => !t.archived);
  return tasks.filter(
    (t) =>
      t.status === "awaiting_approval"
      || (Array.isArray(t.pendingApprovals) && t.pendingApprovals.length > 0)
      || t.status === "failed"
  );
}

function resolveTaskAgentName(task) {
  const raw = task?.config?.chatProvider || task?.config?.roles?.build?.provider || task?.config?.roles?.plan?.provider || "codex";
  if (raw === "claude") return "claude";
  if (raw === "antigravity") return "antigravity";
  if (raw === "codex") return "codex";
  return String(raw).replace(/^api:/, "");
}

function resolveTaskBranchLabel(task) {
  if (task?.worktreeBranch) return task.worktreeBranch;
  if (task?.worktreePath) return "worktree";
  if (task?.config?.workflow === "codex-antigravity") return "6-step";
  if (task?.config?.workflow === "plan-only") return "plan";
  return resolveTaskAgentName(task);
}

function resolveTaskPreviewLine(task) {
  const agent = resolveTaskAgentName(task);
  if (Array.isArray(task?.pendingApprovals) && task.pendingApprovals.length > 0) {
    const first = task.pendingApprovals[0];
    const summary = String(first?.command || first?.title || first?.tool || "chờ xác nhận quyền CLI")
      .replace(/\s+/g, " ")
      .trim();
    return `${agent} · ${summary.slice(0, 68)}`;
  }
  if (task?.status === "awaiting_approval") {
    return `${agent} · chờ duyệt kế hoạch…`;
  }
  if (task?.status === "failed" && task?.error) {
    return `error · ${String(task.error).replace(/\s+/g, " ").slice(0, 72)}`;
  }
  const events = task?.events || [];
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const text = String(ev?.detail || ev?.title || ev?.command || ev?.text || "").replace(/\s+/g, " ").trim();
    if (text) {
      if (ev.kind === "tool" || text.startsWith("$")) return text.slice(0, 76);
      return `${agent} · ${text.slice(0, 68)}`;
    }
  }
  const messages = task?.chatMessages || task?.messages || [];
  if (messages.length > 0) {
    const last = messages[messages.length - 1];
    const snippet = String(last?.content || "").replace(/\s+/g, " ").trim();
    if (snippet) return `${last.role === "user" ? "$ " : `${agent} · `}${snippet.slice(0, 68)}`;
  }
  const prompt = String(task?.prompt || "").replace(/\s+/g, " ").trim();
  return prompt ? `${agent} · ${prompt.slice(0, 68)}` : `${agent} · ready`;
}

function buildTerminalLines(task, workspace) {
  if (!task) return [];
  const agent = resolveTaskAgentName(task);
  const wsName = workspace?.name || "workspace";
  const branch = resolveTaskBranchLabel(task);
  const lines = [
    {
      type: "cmd",
      host: "local@opensybau",
      path: `${wsName}/${branch}`,
      cmd: `${agent} "${String(task.prompt || task.title || "").replace(/\s+/g, " ").slice(0, 56)}"`,
    },
  ];

  const events = (task.events || []).slice(-20);
  for (const ev of events) {
    const title = String(ev.title || ev.toolName || "").trim();
    const detail = String(ev.detail || ev.command || ev.filePath || ev.text || "").replace(/\s+/g, " ").trim();
    if (ev.kind === "tool") {
      lines.push({ type: "tool", tool: title || "Tool", arg: detail.slice(0, 72) });
    } else if (ev.kind === "stage" || ev.kind === "handoff") {
      lines.push({
        type: "tool",
        tool: ev.stage || "Stage",
        arg: title || detail.slice(0, 72),
        sub: detail && title ? detail.slice(0, 78) : "",
      });
    } else if (ev.kind === "error") {
      lines.push({ type: "warn", text: detail || title });
    } else if (title || detail) {
      lines.push({ type: "comment", text: `${title}${detail ? ` · ${detail.slice(0, 68)}` : ""}` });
    }
  }

  if (task.qaResult) {
    lines.push({
      type: "tool",
      tool: "Bash",
      arg: task.qaResult.command || "npm test",
      qaOk: Boolean(task.qaResult.passed || task.qaResult.status === "passed"),
      qaSummary:
        task.qaResult.passed || task.qaResult.status === "passed"
          ? "PASS (exit 0)"
          : `FAIL (exit ${task.qaResult.code ?? task.qaResult.exitCode ?? 1})`,
    });
  }

  const messages = task.chatMessages || task.messages || [];
  const latestReply = [...messages].reverse().find((m) => m.role === "assistant" && m.content?.trim())
    || (task.output ? { content: task.output } : null);
  if (latestReply?.content) {
    const cleanLines = String(latestReply.content)
      .replace(/```[\s\S]*?```/g, "[code block]")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-4);
    if (cleanLines.length) {
      lines.push({ type: "reply", lines: cleanLines });
    }
  }

  return lines;
}

export function MobileOrcaHeader({ snapshot }) {
  const isMobileCompanion = Boolean(snapshot?.isMobileCompanion ?? isMobileCompanionMode());
  if (!isMobileCompanion || !snapshot?.state) {
    return null;
  }

  const page = snapshot.page || "chat";
  const state = snapshot.state || {};
  const tasks = (state.tasks || []).filter((t) => !t.archived);
  const workspaces = state.workspaces || [];
  const selectedId = snapshot.selectedTaskId || snapshot.selected;
  const task = page === "chat" && selectedId ? tasks.find((t) => t.id === selectedId) : null;

  const activeHost = getActiveRemoteHost();
  const isDisconnectedApk = isAndroidApkRuntime() && !activeHost?.url;
  const connected = !isDisconnectedApk && snapshot.streamConnected !== false;
  const shortHost = isDisconnectedApk
    ? "Ghép PC"
    : (activeHost?.name || snapshot.connectionInfo?.hostname || "PC");

  if (task) {
    const agentName = resolveTaskAgentName(task);
    const ws = workspaces.find((w) => w.id === task.workspaceId);
    const sessionTab = snapshot.mpSessionTab || "chat";
    const isShellTab = sessionTab === "shell" || sessionTab === "terminal";
    const stageTabs = snapshot.stageTabs || [];
    const activeStageTabId = snapshot.activeStageTabId || "chat";
    const artifactsCount = (task.artifacts || []).length;
    const dockOpen = Boolean(snapshot.chatDrawerOpen && snapshot.rightDockMarkup);

    return (
      <header class="mp-orca-header mp-session-chrome mp-mobile-only" aria-label="Thanh công cụ phiên AI">
        <div class="mp-orca-header-row">
          <button
            type="button"
            class="mp-orca-back-btn"
            data-action="close-details"
            title="Quay lại danh sách phiên"
            aria-label="Quay lại danh sách phiên"
          >
            <Icon name="arrow-left" size={16} />
          </button>
          <div class="mp-orca-title-group" style={{ minWidth: 0, flex: 1 }}>
            <strong class="mp-orca-title" data-localize-skip="true">{compactChatTitle(task)}</strong>
            <small class="mp-orca-subtitle" data-localize-skip="true">
              {ws?.name ? `${ws.name} · ` : ""}{resolveTaskBranchLabel(task)}
            </small>
          </div>
          <button
            type="button"
            class="mp-orca-conn-pill"
            data-action="mp-open-pair"
            title={connected ? `Đã kết nối: ${shortHost}` : "Cấu hình kết nối PC"}
          >
            <span class={`mp-status-dot ${connected ? "is-green" : "is-muted"}`} />
            <span data-localize-skip="true">{shortHost}</span>
          </button>
          <button
            type="button"
            class="mp-session-tab-add"
            data-action="new-chat"
            title="Mở cuộc trò chuyện mới"
            aria-label="Mở cuộc trò chuyện mới"
          >
            <Icon name="plus" size={16} />
          </button>
        </div>

        <div class="mp-session-tabbar">
          <button
            type="button"
            class={`mp-session-tab ${(sessionTab === "chat" || !sessionTab) && activeStageTabId === "chat" ? "is-active" : ""}`}
            data-action="mp-session-tab"
            data-tab="chat"
          >
            <Icon name="message-circle" size={14} />
            <span data-localize-skip="true">{agentName || "Chat"}</span>
          </button>
          <button
            type="button"
            class={`mp-session-tab ${isShellTab && activeStageTabId === "chat" ? "is-active" : ""}`}
            data-action="mp-session-tab"
            data-tab="shell"
          >
            <Icon name="terminal" size={14} />
            <span>Shell</span>
          </button>
          <button
            type="button"
            class={`mp-session-tab ${sessionTab === "plan" && activeStageTabId === "chat" ? "is-active" : ""}`}
            data-action="mp-session-tab"
            data-tab="plan"
          >
            <Icon name="file-text" size={14} />
            <span>PLAN.md</span>
          </button>
          {stageTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              class={`mp-session-tab ${activeStageTabId === tab.id ? "is-active" : ""}`}
              data-action="mp-stage-file-tab"
              data-tab-id={tab.id}
            >
              <Icon name="file" size={14} />
              <span data-localize-skip="true">{tab.name}</span>
            </button>
          ))}
          <button
            type="button"
            class="mp-session-tab"
            data-action="show-diff"
            data-id={task.id}
            title="Xem Diff & Review"
          >
            <Icon name="git-branch" size={14} />
            <span style={{ fontVariantNumeric: "tabular-nums" }}>
              Diff{artifactsCount ? ` (${artifactsCount})` : ""}
            </span>
          </button>
          <button
            type="button"
            class={`mp-session-tab ${dockOpen && snapshot.chatDrawerTab === "files" ? "is-active" : ""}`}
            data-action="mp-open-dock-tab"
            data-tab="files"
            title="Mở cây thư mục dự án"
          >
            <Icon name="folder" size={14} />
            <span>Tệp</span>
          </button>
        </div>
      </header>
    );
  }

  const isViewingWorktrees = page === "chat" && snapshot.mobileScreen === "worktrees";
  const activeWs = workspaces.find((w) => w.id === (snapshot.selectedWorkspaceId || snapshot.homeWorkspaceId)) || workspaces[0] || null;
  const supportsDock = page === "workspaces" || page === "skills" || (page === "knowledge" && Boolean(state.settings?.vaultPath));
  const dockOpen = Boolean(supportsDock && snapshot.chatDrawerOpen && snapshot.rightDockMarkup);
  const headerTitle = isViewingWorktrees ? "Git Worktrees" : (pageTitles[page] || "OpenSybau");

  return (
    <header class="mp-orca-header mp-mobile-only" aria-label="Thanh tiêu đề Companion">
      <div class="mp-orca-header-row">
        {isViewingWorktrees ? (
          <button
            type="button"
            class="mp-orca-back-btn"
            data-action="mp-close-worktrees"
            onClick={() => {
              if (typeof window !== "undefined" && typeof window.__opensybauNavigate === "function") {
                window.__opensybauNavigate("chat");
              }
            }}
            aria-label="Quay lại Trang chủ"
            title="Quay lại Trang chủ"
          >
            <Icon name="arrow-left" size={16} />
          </button>
        ) : (
          <span class="mp-orca-brand-mark" aria-hidden="true">
            <BrandLogo clipId="wbMobileTopLogo" className="wb-brand-svg" size={18} />
          </span>
        )}
        <div class="mp-orca-title-group" style={{ minWidth: 0, flex: 1 }}>
          <strong class="mp-orca-title">{headerTitle}</strong>
          {!isViewingWorktrees && activeWs && ["chat", "tasks", "flows", "workspaces"].includes(page) ? (
            <small class="mp-orca-subtitle" data-localize-skip="true">{activeWs.name}</small>
          ) : null}
        </div>
        <button
          type="button"
          class="mp-orca-conn-pill"
          data-action="mp-open-pair"
          title={connected ? `Đã kết nối: ${shortHost}` : "Ghép nối máy tính PC"}
        >
          <span class={`mp-status-dot ${connected ? "is-green" : "is-muted"}`} />
          <span data-localize-skip={isDisconnectedApk ? undefined : "true"}>{shortHost}</span>
        </button>
        <button
          type="button"
          class="mp-orca-icon-btn"
          data-action="open-command-palette"
          title="Tìm kiếm & Lệnh nhanh"
          aria-label="Tìm kiếm & Lệnh nhanh"
        >
          <Icon name="search" size={16} />
        </button>
        <button
          type="button"
          class="mp-orca-lang-btn"
          data-action="toggle-language"
          title="Chuyển ngôn ngữ VI / EN"
        >
          {snapshot.language === "en" ? "EN" : "VI"}
        </button>
        {supportsDock ? (
          <button
            type="button"
            class={`mp-orca-icon-btn ${dockOpen ? "is-active" : ""}`}
            data-action="toggle-chat-drawer"
            title="Mở thanh công cụ bên phải"
            aria-label="Mở thanh công cụ bên phải"
          >
            <Icon name="sidebar-right" size={16} />
          </button>
        ) : null}
      </div>
    </header>
  );
}

export function MobileOrcaOverlay({ snapshot }) {
  const isMobileCompanion = Boolean(snapshot?.isMobileCompanion ?? isMobileCompanionMode());
  if (!isMobileCompanion || !snapshot?.state) {
    return null;
  }

  const page = snapshot.page || "chat";
  const state = snapshot.state || {};
  const tasks = (state.tasks || []).filter((t) => !t.archived);
  const workspaces = state.workspaces || [];
  const telemetry = state.telemetry || {};
  const activeHost = getActiveRemoteHost();
  const savedHosts = getSavedRemoteHosts();
  const isDisconnectedApk = isAndroidApkRuntime() && !activeHost?.url;
  const hostName = activeHost?.name || snapshot.connectionInfo?.hostname || (isDisconnectedApk ? "Chưa kết nối máy tính (PC)" : "Máy tính PC");
  const connected = !isDisconnectedApk && snapshot.streamConnected !== false;
  const tokens7d = Number(telemetry.tokens7d || 0);

  const selectedId = snapshot.selectedTaskId || snapshot.selected;
  const hasStageTabs = (page === "chat" || page === "workspaces") && (snapshot.stageTabs?.length || 0) > 0;
  const isViewingFileTab = hasStageTabs && (snapshot.activeStageTabId !== "chat" || snapshot.stageSplit);
  const chatSplit = page === "chat" && Boolean(snapshot.chatSplitWorkspaceId);
  const isHomeChat = page === "chat"
    && !selectedId
    && snapshot.mobileScreen !== "worktrees"
    && !isViewingFileTab
    && !chatSplit;

  // 1. On Home Chat screen: render Mobile Companion Triage Inbox + Sessions + Quota Deck
  if (isHomeChat) {
    const wlFilter = snapshot.mpWlFilter || "all";
    const wlRepo = snapshot.mpWlRepo || "all";
    const wlSearchOpen = Boolean(snapshot.mpWlSearchOpen);
    const q = String(snapshot.mpWlSearchQuery || "").trim().toLocaleLowerCase();
    const filterLabels = {
      all: "Lọc: Tất cả",
      running: "Đang chạy",
      attention: "Cần duyệt",
      done: "Hoàn tất",
    };
    const selectedWs = workspaces.find((w) => w.id === wlRepo);
    const attentionTasks = resolveAttentionTasks(snapshot);
    const attentionIds = new Set(attentionTasks.map((t) => t.id));

    const filtered = tasks
      .filter((t) => {
        if (wlRepo !== "all" && t.workspaceId !== wlRepo) return false;
        if (wlFilter === "running" && !["running", "queued"].includes(t.status)) return false;
        if (
          wlFilter === "attention"
          && !["awaiting_approval", "failed"].includes(t.status)
          && !(Array.isArray(t.pendingApprovals) && t.pendingApprovals.length > 0)
        ) {
          return false;
        }
        if (wlFilter === "done" && t.status !== "done") return false;
        if (q) {
          const ws = workspaces.find((w) => w.id === t.workspaceId);
          const hay = `${t.title || ""} ${t.prompt || ""} ${ws?.name || ""}`.toLocaleLowerCase();
          if (!hay.includes(q)) return false;
        }
        return true;
      })
      .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

    const pinned = filtered.filter((t) => t.pinned);
    const active = filtered.filter((t) => !t.pinned);
    const latestTask = filtered.find((t) => !attentionIds.has(t.id)) || filtered[0] || null;
    const latestWs = latestTask ? workspaces.find((w) => w.id === latestTask.workspaceId) : workspaces[0] || null;
    const disconnectedHosts = savedHosts.filter(
      (item) => !activeHost?.url || item.url.toLowerCase() !== activeHost.url.toLowerCase()
    );

    const usageProviders = [
      { id: "codex", label: "Codex" },
      { id: "claude", label: "Claude" },
      { id: "antigravity", label: "Antigravity" },
    ];

    const renderRow = (item, idx) => {
      const ws = workspaces.find((w) => w.id === item.workspaceId);
      const isSpin = ["running", "queued"].includes(item.status);
      const hasPendingCli = Array.isArray(item.pendingApprovals) && item.pendingApprovals.length > 0;
      const dotClass = item.status === "failed" || item.status === "awaiting_approval" || hasPendingCli
        ? "is-red"
        : item.status === "done"
          ? "is-green"
          : "is-muted";
      const msgs = item.chatMessages || item.messages || [];
      const turnCount = Math.max(1, msgs.length || 1);
      return (
        <button key={item.id} type="button" class="mp-wl-row" data-task={item.id}>
          <div class="mp-wl-indicator">
            {isSpin ? <div class="mp-wl-spinner" /> : <div class={`mp-wl-dot ${dotClass}`} />}
          </div>
          <div class="mp-wl-main">
            <div class="mp-wl-name-row">
              <div class="mp-wl-name" data-localize-skip="true">{compactChatTitle(item)}</div>
              <div class="mp-wl-pr" data-localize-skip="true" style={{ fontVariantNumeric: "tabular-nums" }}>
                <Icon name="git-pull-request" size={14} />
                <span>#{chatNumber(item, idx + 1)}</span>
              </div>
            </div>
            <div class="mp-wl-meta-row">
              <span class={`mp-repo-dot is-${repoColorFor(item.workspaceId)}`} />
              <span data-localize-skip="true">{ws?.name || "workspace"}</span>
              <span class="mp-wl-branch" data-localize-skip="true">{resolveTaskBranchLabel(item)}</span>
            </div>
            <div class="mp-wl-preview" data-localize-skip="true">{resolveTaskPreviewLine(item)}</div>
          </div>
          <div class="mp-wl-tcount" style={{ fontVariantNumeric: "tabular-nums" }}>{turnCount}</div>
        </button>
      );
    };

    return (
      <section class="mp-home-companion mp-mobile-only" aria-label="Bảng điều khiển di động OpenSybau">
        {attentionTasks.length > 0 ? (
          <div class="mp-inbox-section" aria-label="Cần xử lý ngay">
            <div class="mp-inbox-head">
              <span class="mp-inbox-heading">
                <Icon name="bell" size={14} />
                <strong>Cần xử lý ngay</strong>
              </span>
              <span class="mp-inbox-count" style={{ fontVariantNumeric: "tabular-nums" }}>
                {attentionTasks.length}
              </span>
            </div>
            <div class="mp-inbox-list">
              {attentionTasks.map((t) => {
                const ws = workspaces.find((w) => w.id === t.workspaceId);
                const approvals = Array.isArray(t.pendingApprovals) ? t.pendingApprovals : [];
                if (approvals.length > 0) {
                  return approvals.map((a) => {
                    const cmdSummary = String(
                      a?.command || a?.title || a?.tool || a?.summary || a?.reason || "Yêu cầu quyền thực thi CLI"
                    )
                      .replace(/\s+/g, " ")
                      .trim();
                    return (
                      <article class="mp-inbox-card is-approval" key={`cli-app:${t.id}:${a.id || cmdSummary}`}>
                        <div class="mp-inbox-card-top">
                          <span class="mp-inbox-tag is-warn">
                            <Icon name="shield-alert" size={14} />
                            <span>Quyền CLI</span>
                          </span>
                          <strong class="mp-inbox-task-title" data-localize-skip="true">{compactChatTitle(t)}</strong>
                        </div>
                        {ws ? (
                          <div class="mp-inbox-meta" data-localize-skip="true">
                            {ws.name} · {resolveTaskBranchLabel(t)}
                          </div>
                        ) : null}
                        <code class="mp-inbox-cmd" data-localize-skip="true">{cmdSummary}</code>
                        <div class="mp-inbox-actions">
                          <button
                            type="button"
                            class="button primary small mp-inbox-btn"
                            data-action="resolve-cli-approval"
                            data-task-id={t.id}
                            data-approval-id={a.id}
                            data-decision="accept"
                          >
                            <Icon name="check" size={14} />
                            <span>Cho phép</span>
                          </button>
                          <button
                            type="button"
                            class="button quiet small mp-inbox-btn is-danger"
                            data-action="resolve-cli-approval"
                            data-task-id={t.id}
                            data-approval-id={a.id}
                            data-decision="decline"
                          >
                            <Icon name="x" size={14} />
                            <span>Từ chối</span>
                          </button>
                          <button type="button" class="button quiet small mp-inbox-btn" data-task={t.id}>
                            <span>Mở phiên</span>
                          </button>
                        </div>
                      </article>
                    );
                  });
                }

                if (t.status === "awaiting_approval") {
                  const planSnippet = String(t.plan || t.stageOutputs?.plan || t.prompt || "Kế hoạch đang chờ phê duyệt")
                    .replace(/\s+/g, " ")
                    .trim()
                    .slice(0, 120);
                  return (
                    <article class="mp-inbox-card is-plan" key={`plan-app:${t.id}`}>
                      <div class="mp-inbox-card-top">
                        <span class="mp-inbox-tag is-warn">
                          <Icon name="clock" size={14} />
                          <span>Chờ duyệt Plan</span>
                        </span>
                        <strong class="mp-inbox-task-title" data-localize-skip="true">{compactChatTitle(t)}</strong>
                      </div>
                      {ws ? (
                        <div class="mp-inbox-meta" data-localize-skip="true">
                          {ws.name} · {resolveTaskBranchLabel(t)}
                        </div>
                      ) : null}
                      <p class="mp-inbox-summary" data-localize-skip="true">{planSnippet}</p>
                      <div class="mp-inbox-actions">
                        <button
                          type="button"
                          class="button primary small mp-inbox-btn"
                          data-action="approve-plan"
                          data-id={t.id}
                        >
                          <Icon name="check" size={14} />
                          <span>Duyệt PLAN.md</span>
                        </button>
                        <button type="button" class="button quiet small mp-inbox-btn" data-task={t.id}>
                          <Icon name="arrow-up-right" size={14} />
                          <span>Mở phiên</span>
                        </button>
                      </div>
                    </article>
                  );
                }

                const errSnippet = String(t.error || resolveTaskPreviewLine(t)).replace(/\s+/g, " ").trim().slice(0, 120);
                return (
                  <article class="mp-inbox-card is-failed" key={`failed:${t.id}`}>
                    <div class="mp-inbox-card-top">
                      <span class="mp-inbox-tag is-danger">
                        <Icon name="alert-triangle" size={14} />
                        <span>Thất bại</span>
                      </span>
                      <strong class="mp-inbox-task-title" data-localize-skip="true">{compactChatTitle(t)}</strong>
                    </div>
                    {ws ? (
                      <div class="mp-inbox-meta" data-localize-skip="true">
                        {ws.name} · {resolveTaskBranchLabel(t)}
                      </div>
                    ) : null}
                    <p class="mp-inbox-summary" data-localize-skip="true">{errSnippet}</p>
                    <div class="mp-inbox-actions">
                      <button type="button" class="button quiet small mp-inbox-btn is-danger" data-task={t.id}>
                        <Icon name="alert-triangle" size={14} />
                        <span>Xem lỗi</span>
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        ) : null}

        {latestTask && !attentionIds.has(latestTask.id) ? (
          <button type="button" class="mp-resume-card" data-task={latestTask.id}>
            <div class="mp-resume-icon">
              <Icon name="square-terminal" size={16} />
            </div>
            <div class="mp-host-main">
              <div class="mp-resume-title" data-localize-skip="true">{compactChatTitle(latestTask)}</div>
              <div class="mp-resume-sub">
                <span class={`mp-repo-dot is-${repoColorFor(latestTask.workspaceId)}`} />
                <span data-localize-skip="true">
                  {latestWs?.name || "workspace"} · {resolveTaskBranchLabel(latestTask)}
                </span>
              </div>
            </div>
            <div class="mp-chevron-right">
              <Icon name="chevron-right" size={16} />
            </div>
          </button>
        ) : null}

        <div class="mp-wl-card">
          <div class="mp-wl-toolbar">
            <span class="mp-wl-card-title" style={{ fontVariantNumeric: "tabular-nums" }}>
              Phiên &amp; Worktree ({filtered.length})
            </span>
            {tasks.length > 0 ? (
              <>
                <button
                  type="button"
                  class={`mp-wl-chip ${wlFilter !== "all" ? "is-active" : ""}`}
                  data-action="mp-cycle-wl-filter"
                >
                  <Icon name="funnel" size={14} />
                  <span>{filterLabels[wlFilter] || "Lọc"}</span>
                </button>
                {workspaces.length > 1 ? (
                  <button
                    type="button"
                    class={`mp-wl-chip ${wlRepo !== "all" ? "is-active" : ""}`}
                    data-action="mp-cycle-wl-repo"
                  >
                    <Icon name="layers" size={14} />
                    <span data-localize-skip={selectedWs ? "true" : undefined}>
                      {selectedWs ? selectedWs.name : "Tất cả"}
                    </span>
                  </button>
                ) : null}
              </>
            ) : null}
            <span class="mp-wl-spacer" />
            {Number(telemetry.worktreeCount || 0) > 0 ? (
              <button
                type="button"
                class="mp-wl-icon-btn"
                data-action="mp-open-worktrees"
                title="Quản lý Git Worktree"
                aria-label="Quản lý Git Worktree"
              >
                <Icon name="git-branch" size={14} />
              </button>
            ) : null}
            <button
              type="button"
              class="mp-wl-icon-btn"
              data-action="add-workspace"
              title="Thêm dự án"
              aria-label="Thêm dự án"
            >
              <Icon name="folder-plus" size={14} />
            </button>
            {tasks.length > 0 ? (
              <button
                type="button"
                class={`mp-wl-icon-btn ${wlSearchOpen ? "is-active" : ""}`}
                data-action="mp-toggle-wl-search"
                title="Tìm kiếm phiên"
                aria-label="Tìm kiếm phiên"
              >
                <Icon name="search" size={14} />
              </button>
            ) : null}
          </div>
          {wlSearchOpen ? (
            <div class="mp-wl-search-row">
              <Icon name="search" size={14} />
              <input
                type="text"
                data-mp-wl-search
                value={snapshot.mpWlSearchQuery || ""}
                placeholder="Tìm phiên hoặc nhánh…"
                autoComplete="off"
              />
              {snapshot.mpWlSearchQuery ? (
                <button type="button" class="mp-wl-icon-btn" data-action="mp-clear-wl-search" aria-label="Xóa">
                  <Icon name="x" size={14} />
                </button>
              ) : null}
            </div>
          ) : null}

          {pinned.length > 0 ? (
            <>
              <div class="mp-wl-section">
                <Icon name="pin" size={14} />
                <span>Đã ghim</span>
                <span class="mp-wl-section-count" style={{ fontVariantNumeric: "tabular-nums" }}>{pinned.length}</span>
              </div>
              <div class="mp-wl-list">
                {pinned.slice(0, 6).map((item, idx) => (
                  <>
                    {idx > 0 ? <div class="mp-wl-sep" /> : null}
                    {renderRow(item, idx)}
                  </>
                ))}
              </div>
            </>
          ) : null}

          {active.length > 0 ? (
            <div class="mp-wl-list">
              {active.slice(0, 12).map((item, idx) => (
                <>
                  {idx > 0 ? <div class="mp-wl-sep" /> : null}
                  {renderRow(item, idx)}
                </>
              ))}
            </div>
          ) : pinned.length === 0 ? (
            <div class="mp-wl-empty-row">
              <div class="mp-wl-empty-text">
                <strong>
                  {isDisconnectedApk
                    ? "Chưa kết nối với máy tính (PC)"
                    : workspaces.length
                      ? `Sẵn sàng trên ${workspaces[0].name}`
                      : "Chưa có thư mục dự án trên PC"}
                </strong>
                <span>
                  {isDisconnectedApk
                    ? "Ghép nối điện thoại với OpenSybau trên máy tính qua cùng mạng Wi-Fi để xem dự án và điều khiển AI."
                    : workspaces.length
                      ? "Chọn gợi ý phía trên hoặc nhập yêu cầu để bắt đầu phiên mới."
                      : "Thêm thư mục dự án nằm trên máy tính (PC) để AI đọc hiểu và viết code."}
                </span>
              </div>
              {isDisconnectedApk ? (
                <button type="button" class="button primary small" data-action="mp-open-pair">
                  <Icon name="qr-code" size={14} />
                  <span>Ghép nối PC</span>
                </button>
              ) : !workspaces.length ? (
                <button type="button" class="button primary small" data-action="add-workspace">
                  <Icon name="plus" size={14} />
                  <span>Thêm dự án</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div class="mp-runtime-card">
          <div class="mp-runtime-head">
            <div class="mp-host-icon">
              <BrandLogo clipId="wbMobileRuntimeLogo" className="wb-brand-svg" size={18} />
            </div>
            <div class="mp-host-main" style={{ minWidth: 0 }}>
              <div class="mp-host-name" data-localize-skip={isDisconnectedApk ? undefined : "true"}>
                {hostName}
              </div>
              <div class="mp-host-meta" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px 6px" }}>
                <span class={`mp-status-dot ${connected ? "is-green" : "is-muted"}`} />
                <span>
                  {isDisconnectedApk
                    ? "Chưa kết nối · Cùng Wi-Fi"
                    : `${connected ? "Đã kết nối" : "Đang kết nối lại"} · ${workspaces.length} dự án`}
                </span>
                {!isDisconnectedApk ? (
                  <span
                    class="mp-tok-pill"
                    style={{ whiteSpace: "nowrap", flexShrink: 0, fontVariantNumeric: "tabular-nums" }}
                    data-localize-skip="true"
                  >
                    · {formatNumber(tokens7d)} tok (7d)
                  </span>
                ) : null}
              </div>
            </div>
            <button type="button" class="button quiet small mp-pair-btn" data-action="mp-open-pair">
              <Icon name="qr-code" size={14} />
              <span>Ghép nối PC</span>
            </button>
          </div>

          {disconnectedHosts.slice(0, 2).map((host) => (
            <button
              key={host.id}
              type="button"
              class="mp-saved-host-row"
              data-action="connect-saved-host"
              data-id={host.id}
            >
              <span class="mp-status-dot is-muted" />
              <span class="mp-saved-host-name" data-localize-skip="true">{host.name || host.url}</span>
              <span class="mp-saved-host-action">Kết nối</span>
            </button>
          ))}

          <div class="mp-agent-pills-row">
            {usageProviders.map((row) => {
              const connector = snapshot.connectors?.[row.id];
              const avail = !isDisconnectedApk && Boolean(connector?.available);
              const count = connector?.models?.length || 0;
              const pUsage = telemetry.byProvider?.[row.id] || {};
              const tok7d = Number(pUsage.tokens7d || 0);
              const quota = snapshot.quotas?.[row.id] || snapshot.quotas?.providers?.[row.id];
              const wins = quota?.groups?.[0]?.windows || quota?.windows || [];
              const firstWin = findQuotaPeriod(wins, "5h");
              const secondWin = findQuotaPeriod(wins, "7d");
              const usage5h = computeWindowUsage(firstWin);
              const usage7d = computeWindowUsage(secondWin);
              const primaryUsage = usage5h || usage7d;
              const maxUsed = Math.max(usage5h?.usedPercent ?? 0, usage7d?.usedPercent ?? 0);
              const barTone = primaryUsage ? quotaToneClasses(maxUsed) : "is-ok is-normal";

              const tooltipParts = [];
              if (quota?.email) tooltipParts.push(quota.email);
              if (usage5h) {
                const r5 = formatQuotaResetShort(firstWin?.resetsAt);
                tooltipParts.push(
                  `5h: Đã dùng ${Math.round(usage5h.usedPercent)}% · Còn ${Math.round(usage5h.remainingPercent)}%${r5 ? ` (đặt lại ${r5})` : ""}`
                );
              }
              if (usage7d) {
                const r7 = formatQuotaResetShort(secondWin?.resetsAt);
                tooltipParts.push(
                  `7d: Đã dùng ${Math.round(usage7d.usedPercent)}% · Còn ${Math.round(usage7d.remainingPercent)}%${r7 ? ` (đặt lại ${r7})` : ""}`
                );
              }
              const tooltip = tooltipParts.join(" | ") || `${row.label} CLI`;

              return (
                <button
                  type="button"
                  class={`mp-agent-status-pill ${avail ? "is-ready" : "is-missing"}`}
                  key={row.id}
                  data-action="open-cli-settings"
                  data-page="settings"
                  data-settings-target="cli"
                  data-provider={row.id}
                  title={tooltip}
                >
                  <div class="mp-agent-pill-top">
                    <span class={`mp-status-dot ${avail ? "is-green" : "is-muted"}`} />
                    <strong data-localize-skip="true">{row.label}</strong>
                  </div>
                  <small data-localize-skip="true" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {avail
                      ? primaryUsage
                        ? `Đã dùng ${Math.round(primaryUsage.usedPercent)}%`
                        : tok7d > 0
                          ? `${formatNumber(tok7d)} tok`
                          : `${count} model`
                      : "Chưa kết nối"}
                  </small>
                  <span
                    class="mp-agent-quota-bar"
                    role="progressbar"
                    aria-valuenow={avail && primaryUsage ? Math.round(primaryUsage.usedPercent) : 0}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span
                      class={`mp-agent-quota-fill ${barTone}`}
                      style={{ width: `${avail && primaryUsage ? primaryUsage.usedPercent : 0}%` }}
                    />
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>
    );
  }

  // 2. On Active Session Screen: Shell ("shell" / "terminal") subtab or PLAN.md ("plan") subtab
  const task = page === "chat" && selectedId ? tasks.find((t) => t.id === selectedId) : null;
  const sessionTab = snapshot.mpSessionTab || "chat";
  const isShellTab = sessionTab === "shell" || sessionTab === "terminal";

  if (task && isShellTab && (snapshot.activeStageTabId || "chat") === "chat") {
    const ws = workspaces.find((w) => w.id === task.workspaceId);
    const termLines = buildTerminalLines(task, ws);
    return (
      <div class="mp-device-screen mp-screen-terminal mp-mobile-only" aria-label="Terminal phiên AI">
        <div class="mp-terminal">
          {termLines.map((line, index) => {
            if (line.type === "cmd") {
              return (
                <span class="mp-term-line" key={index}>
                  <span class="mp-term-prompt" data-localize-skip="true">{line.host}</span>{" "}
                  <span class="mp-term-dim" data-localize-skip="true">{line.path}</span>{" "}
                  <span class="mp-term-prompt">$</span>{" "}
                  <span class="mp-term-cmd" data-localize-skip="true">{line.cmd}</span>
                </span>
              );
            }
            if (line.type === "tool") {
              return (
                <div key={index} class="mp-term-group">
                  <span class="mp-term-line">
                    <span class="mp-term-tool">&gt;</span>{" "}
                    <span class="mp-term-mid" data-localize-skip="true">{line.tool}</span>{" "}
                    <span class="mp-term-dim" data-localize-skip="true">{line.arg}</span>
                  </span>
                  {line.sub ? (
                    <span class="mp-term-line">
                      {"  "}
                      <span class="mp-term-comment" data-localize-skip="true">⎿ {line.sub}</span>
                    </span>
                  ) : null}
                  {line.qaSummary ? (
                    <span class="mp-term-line">
                      {"  "}
                      <span class="mp-term-comment">⎿ </span>
                      <span class={line.qaOk ? "mp-term-ok" : "mp-term-warn"} data-localize-skip="true">
                        {line.qaSummary}
                      </span>
                    </span>
                  ) : null}
                </div>
              );
            }
            if (line.type === "warn") {
              return (
                <span class="mp-term-line" key={index}>
                  <span class="mp-term-warn">!</span>{" "}
                  <span class="mp-term-comment" data-localize-skip="true">{line.text}</span>
                </span>
              );
            }
            if (line.type === "reply") {
              return (
                <div key={index} class="mp-term-group">
                  {line.lines.map((rl, rIdx) => (
                    <span class="mp-term-line" key={rIdx}>
                      <span class="mp-term-mid" data-localize-skip="true">{rl}</span>
                    </span>
                  ))}
                </div>
              );
            }
            return (
              <span class="mp-term-line" key={index}>
                <span class="mp-term-comment" data-localize-skip="true">⎿ {line.text}</span>
              </span>
            );
          })}
          <span class="mp-term-line">
            <span class="mp-term-prompt">&gt;</span> <span class="mp-term-cursor" />
          </span>
        </div>
        <div class="mp-accessory-bar">
          <div class="mp-accessory-content">
            <button type="button" class="mp-accessory-key is-icon" data-action="mp-session-tab" data-tab="chat" title="Chuyển sang khung Chat">
              <Icon name="message-circle" size={14} />
            </button>
            <button type="button" class="mp-accessory-key" data-action="mp-paste-terminal">Paste</button>
            <button type="button" class="mp-accessory-key" data-action="run-task-qa" data-id={task.id}>Test QA</button>
            {task.status === "awaiting_approval" ? (
              <button type="button" class="mp-accessory-key is-accent" data-action="approve-plan" data-id={task.id}>
                Duyệt Plan
              </button>
            ) : null}
            {["running", "queued"].includes(task.status) ? (
              <button type="button" class="mp-accessory-key is-danger" data-action="stop-task" data-id={task.id}>
                Ctrl+C
              </button>
            ) : null}
            <button type="button" class="mp-accessory-key" data-action="show-diff" data-id={task.id}>Diff</button>
            <button type="button" class="mp-accessory-key" data-action="mp-open-dock-tab" data-tab="files">Files</button>
          </div>
        </div>
        <form class="mp-input-bar" data-modal data-form="task-chat" data-id={task.id}>
          <input
            type="text"
            name="message"
            class="mp-text-input"
            placeholder="Nhập chỉ dẫn hoặc lệnh tiếp theo…"
            autoComplete="off"
          />
          <button type="submit" class="mp-round-button is-send chat-send-button" aria-label="Gửi">
            <Icon name="arrow-up" size={16} />
          </button>
        </form>
      </div>
    );
  }

  if (task && sessionTab === "plan" && (snapshot.activeStageTabId || "chat") === "chat") {
    const planText = task.plan || task.stageOutputs?.plan || task.prompt || "Chưa có nội dung kế hoạch (PLAN.md).";
    const checklist = task.goalChecklist || [];
    return (
      <div class="mp-device-screen mp-screen-plan mp-mobile-only" aria-label="Kế hoạch phiên AI">
        <div class="mp-scroll-region mp-plan-scroll">
          <div class="mp-plan-card">
            <div class="mp-plan-card-head">
              <Icon name="file-text" size={16} />
              <strong>PLAN.md</strong>
              <span class="mp-wl-branch" data-localize-skip="true">{resolveTaskBranchLabel(task)}</span>
              <button type="button" class="button quiet small" style={{ marginLeft: "auto" }} data-action="edit-task-goal" data-id={task.id}>
                Mục tiêu &amp; Checklist
              </button>
            </div>
            {task.status === "awaiting_approval" ? (
              <div class="mp-plan-gate-bar">
                <span>Phiên đang chờ duyệt kế hoạch trước khi triển khai code.</span>
                <button type="button" class="button primary small" data-action="approve-plan" data-id={task.id}>
                  <Icon name="check" size={14} /> Duyệt PLAN.md
                </button>
              </div>
            ) : null}
            {checklist.length > 0 ? (
              <div class="mp-plan-checklist">
                {checklist.map((entry) => (
                  <label class="mp-plan-check-row" key={entry.id}>
                    <input
                      type="checkbox"
                      checked={Boolean(entry.done)}
                      data-action="toggle-goal-item"
                      data-id={task.id}
                      data-goal-id={entry.id}
                    />
                    <span class={entry.done ? "is-done" : ""} data-localize-skip="true">{entry.text}</span>
                  </label>
                ))}
              </div>
            ) : null}
            <pre class="mp-plan-pre" data-localize-skip="true">{planText}</pre>
          </div>
        </div>
        <form class="mp-input-bar" data-modal data-form="task-chat" data-id={task.id}>
          <input
            type="text"
            name="message"
            class="mp-text-input"
            placeholder="Góp ý hoặc bổ sung cho kế hoạch…"
            autoComplete="off"
          />
          <button type="submit" class="mp-round-button is-send chat-send-button" aria-label="Gửi">
            <Icon name="arrow-up" size={16} />
          </button>
        </form>
      </div>
    );
  }

  return null;
}
