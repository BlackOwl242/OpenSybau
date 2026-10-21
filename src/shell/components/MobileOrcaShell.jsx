import { h } from "preact";
import { Icon } from "../../shared/ui/Icon.jsx";
import { chatNumber, compactChatTitle } from "../../shared/chat-labels.js";
import { formatNumber } from "../../shared/i18n.js";
import { getActiveRemoteHost, getSavedRemoteHosts } from "../../shared/remote-host.js";

const REPO_COLORS = ["blue", "green", "orange", "violet"];

function repoColorFor(id = "") {
  const str = String(id || "");
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return REPO_COLORS[Math.abs(hash) % REPO_COLORS.length];
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
      lines.push({ type: "tool", tool: ev.stage || "Stage", arg: title || detail.slice(0, 72), sub: detail && title ? detail.slice(0, 78) : "" });
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
      qaSummary: (task.qaResult.passed || task.qaResult.status === "passed") ? "PASS (exit 0)" : `FAIL (exit ${task.qaResult.code ?? task.qaResult.exitCode ?? 1})`,
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
  if (!snapshot?.state) {
    return null;
  }
  const page = snapshot.page || "chat";
  const state = snapshot.state || {};
  const tasks = (state.tasks || []).filter((t) => !t.archived);
  const task = page === "chat" && snapshot.selected ? tasks.find((t) => t.id === snapshot.selected) : null;

  if (!task) {
    return null;
  }

  const agentName = resolveTaskAgentName(task);
  const sessionTab = snapshot.mpSessionTab || "chat";
  const stageTabs = snapshot.stageTabs || [];
  const activeStageTabId = snapshot.activeStageTabId || "chat";
  const artifactsCount = (task.artifacts || []).length;
  const dockOpen = Boolean(snapshot.chatDrawerOpen && snapshot.rightDockMarkup);

  return <div class="mp-session-chrome mp-mobile-only" aria-label="Thanh công cụ phiên AI">
    <div class="mp-session-tabbar">
      <button
        type="button"
        class="mp-session-tab"
        data-action="close-details"
        title="Quay lại danh sách phiên & khung tạo mới"
      >
        <Icon name="chevron-left" size={14} />
        <span>Tất cả phiên</span>
      </button>
      <button
        type="button"
        class={`mp-session-tab ${sessionTab === "chat" && activeStageTabId === "chat" ? "is-active" : ""}`}
        data-action="mp-session-tab"
        data-tab="chat"
      >
        <Icon name="message-circle" size={13} />
        <span data-localize-skip="true">{agentName}</span>
      </button>
      <button
        type="button"
        class={`mp-session-tab ${sessionTab === "terminal" && activeStageTabId === "chat" ? "is-active" : ""}`}
        data-action="mp-session-tab"
        data-tab="terminal"
      >
        <Icon name="square-terminal" size={13} />
        <span>shell</span>
      </button>
      <button
        type="button"
        class={`mp-session-tab ${sessionTab === "plan" && activeStageTabId === "chat" ? "is-active" : ""}`}
        data-action="mp-session-tab"
        data-tab="plan"
      >
        <Icon name="file" size={13} />
        <span>PLAN.md</span>
      </button>
      {stageTabs.map((tab) => <button
        key={tab.id}
        type="button"
        class={`mp-session-tab ${activeStageTabId === tab.id ? "is-active" : ""}`}
        data-action="mp-stage-file-tab"
        data-tab-id={tab.id}
      >
        <Icon name="file" size={13} />
        <span data-localize-skip="true">{tab.name}</span>
      </button>)}
      <button
        type="button"
        class="mp-session-tab"
        data-action="show-diff"
        data-id={task.id}
        title="Xem Diff & Review"
      >
        <Icon name="git-branch" size={13} />
        <span>Diff{artifactsCount ? ` (${artifactsCount})` : ""}</span>
      </button>
      <button
        type="button"
        class={`mp-session-tab ${dockOpen && snapshot.chatDrawerTab === "files" ? "is-active" : ""}`}
        data-action="mp-open-dock-tab"
        data-tab="files"
        title="Mở cây thư mục dự án"
      >
        <Icon name="folder" size={13} />
        <span>Tệp</span>
      </button>
      <button
        type="button"
        class="mp-session-tab-add"
        data-action="new-chat"
        title="Mở cuộc trò chuyện mới"
        aria-label="Mở cuộc trò chuyện mới"
      >
        <Icon name="plus" size={15} />
      </button>
    </div>
  </div>;
}

export function MobileOrcaOverlay({ snapshot }) {
  if (!snapshot?.state) {
    return null;
  }
  const page = snapshot.page || "chat";
  const state = snapshot.state || {};
  const tasks = (state.tasks || []).filter((t) => !t.archived);
  const workspaces = state.workspaces || [];
  const telemetry = state.telemetry || {};
  const activeHost = getActiveRemoteHost();
  const savedHosts = getSavedRemoteHosts();
  const hostName = activeHost?.name || snapshot.connectionInfo?.hostname || "Máy tính này";
  const connected = snapshot.streamConnected !== false;
  const tokens7d = Number(telemetry.tokens7d || 0);

  const hasStageTabs = (page === "chat" || page === "workspaces") && (snapshot.stageTabs?.length || 0) > 0;
  const isViewingFileTab = hasStageTabs && (snapshot.activeStageTabId !== "chat" || snapshot.stageSplit);
  const chatSplit = page === "chat" && Boolean(snapshot.chatSplitWorkspaceId);
  const isHomeChat = page === "chat" && !snapshot.selected && !isViewingFileTab && !chatSplit;

  // 1. On Home Chat screen: render Orca Mobile Companion Deck right below the AI Composer
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

    const filtered = tasks.filter((t) => {
      if (wlRepo !== "all" && t.workspaceId !== wlRepo) return false;
      if (wlFilter === "running" && !["running", "queued"].includes(t.status)) return false;
      if (wlFilter === "attention" && !["awaiting_approval", "failed"].includes(t.status)) return false;
      if (wlFilter === "done" && t.status !== "done") return false;
      if (q) {
        const ws = workspaces.find((w) => w.id === t.workspaceId);
        const hay = `${t.title || ""} ${t.prompt || ""} ${ws?.name || ""}`.toLocaleLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

    const pinned = filtered.filter((t) => t.pinned);
    const active = filtered.filter((t) => !t.pinned);
    const latestTask = filtered[0] || null;
    const latestWs = latestTask ? workspaces.find((w) => w.id === latestTask.workspaceId) : workspaces[0] || null;
    const disconnectedHosts = savedHosts.filter((item) => !activeHost?.url || item.url.toLowerCase() !== activeHost.url.toLowerCase());

    const usageRows = [
      { id: "claude", email: snapshot.connectors?.claude?.available ? `claude · ${snapshot.connectors.claude.models?.length || 0} model` : "claude · chưa kết nối", color: "#D97757" },
      { id: "codex", email: snapshot.connectors?.codex?.available ? `codex · ${snapshot.connectors.codex.models?.length || 0} model` : "codex · chưa kết nối", color: "#10a37f" },
      { id: "antigravity", email: snapshot.connectors?.antigravity?.available ? `agy · ${snapshot.connectors.antigravity.models?.length || 0} model` : "agy · chưa kết nối", color: "#6366f1" },
    ];

    const renderRow = (item, idx) => {
      const ws = workspaces.find((w) => w.id === item.workspaceId);
      const isSpin = ["running", "queued"].includes(item.status);
      const dotClass = item.status === "failed" || item.status === "awaiting_approval"
        ? "is-red"
        : item.status === "done"
          ? "is-green"
          : "is-muted";
      const msgs = item.chatMessages || item.messages || [];
      const turnCount = Math.max(1, msgs.length || 1);
      return <button
        key={item.id}
        type="button"
        class="mp-wl-row"
        data-task={item.id}
      >
        <div class="mp-wl-indicator">
          {isSpin ? <div class="mp-wl-spinner" /> : <div class={`mp-wl-dot ${dotClass}`} />}
        </div>
        <div class="mp-wl-main">
          <div class="mp-wl-name-row">
            <div class="mp-wl-name" data-localize-skip="true">{compactChatTitle(item)}</div>
            <div class="mp-wl-pr" data-localize-skip="true">
              <Icon name="git-pull-request" size={10} />
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
        <div class="mp-wl-tcount">{turnCount}</div>
      </button>;
    };

    return <section class="mp-home-companion mp-mobile-only" aria-label="Bảng điều khiển di động Orca">
      {latestTask ? <button type="button" class="mp-resume-card" data-task={latestTask.id}>
        <div class="mp-resume-icon">
          <Icon name="square-terminal" size={17} />
        </div>
        <div class="mp-host-main">
          <div class="mp-resume-title" data-localize-skip="true">{compactChatTitle(latestTask)}</div>
          <div class="mp-resume-sub">
            <span class={`mp-repo-dot is-${repoColorFor(latestTask.workspaceId)}`} />
            <span data-localize-skip="true">{latestWs?.name || "workspace"} · {resolveTaskBranchLabel(latestTask)}</span>
          </div>
        </div>
        <div class="mp-chevron-right">
          <Icon name="chevron-right" size={16} />
        </div>
      </button> : null}

      <div class="mp-wl-card">
        <div class="mp-wl-toolbar">
          <span class="mp-wl-card-title">Phiên &amp; Worktree ({filtered.length})</span>
          {tasks.length > 0 ? <>
            <button type="button" class={`mp-wl-chip ${wlFilter !== "all" ? "is-active" : ""}`} data-action="mp-cycle-wl-filter">
              <Icon name="funnel" size={11} />
              <span>{filterLabels[wlFilter] || "Lọc"}</span>
            </button>
            {workspaces.length > 1 ? <button type="button" class={`mp-wl-chip ${wlRepo !== "all" ? "is-active" : ""}`} data-action="mp-cycle-wl-repo">
              <Icon name="layers" size={11} />
              <span data-localize-skip={selectedWs ? "true" : undefined}>{selectedWs ? selectedWs.name : "Tất cả"}</span>
            </button> : null}
          </> : null}
          <span class="mp-wl-spacer" />
          <button type="button" class="mp-wl-icon-btn" data-action="add-workspace" title="Thêm dự án" aria-label="Thêm dự án">
            <Icon name="folder-plus" size={14} />
          </button>
          {tasks.length > 0 ? <button type="button" class={`mp-wl-icon-btn ${wlSearchOpen ? "is-active" : ""}`} data-action="mp-toggle-wl-search" title="Tìm kiếm phiên" aria-label="Tìm kiếm phiên">
            <Icon name="search" size={14} />
          </button> : null}
        </div>
        {wlSearchOpen ? <div class="mp-wl-search-row">
          <Icon name="search" size={13} />
          <input
            type="text"
            data-mp-wl-search
            value={snapshot.mpWlSearchQuery || ""}
            placeholder="Tìm phiên hoặc nhánh…"
            autoComplete="off"
          />
          {snapshot.mpWlSearchQuery ? <button type="button" class="mp-wl-icon-btn" data-action="mp-clear-wl-search" aria-label="Xóa"><Icon name="x" size={13} /></button> : null}
        </div> : null}

        {pinned.length > 0 ? <>
          <div class="mp-wl-section">
            <Icon name="pin" size={11} />
            <span>Đã ghim</span>
            <span class="mp-wl-section-count">{pinned.length}</span>
          </div>
          <div class="mp-wl-list">
            {pinned.slice(0, 6).map((item, idx) => <>
              {idx > 0 ? <div class="mp-wl-sep" /> : null}
              {renderRow(item, idx)}
            </>)}
          </div>
        </> : null}

        {active.length > 0 ? <>
          <div class="mp-wl-list">
            {active.slice(0, 12).map((item, idx) => <>
              {idx > 0 ? <div class="mp-wl-sep" /> : null}
              {renderRow(item, idx)}
            </>)}
          </div>
        </> : (pinned.length === 0 ? <div class="mp-wl-empty-row">
          <div class="mp-wl-empty-text">
            <strong>{workspaces.length ? `Sẵn sàng trên ${workspaces[0].name}` : "Chưa có thư mục dự án"}</strong>
            <span>{workspaces.length ? "Chọn gợi ý phía trên hoặc nhập yêu cầu để bắt đầu phiên mới." : "Thêm thư mục dự án trên máy để AI đọc hiểu và viết code."}</span>
          </div>
          {!workspaces.length ? <button type="button" class="button primary small" data-action="add-workspace">
            <Icon name="plus" size={13} />
            <span>Thêm dự án</span>
          </button> : null}
        </div> : null)}
      </div>

      <div class="mp-runtime-card">
        <div class="mp-runtime-head">
          <div class="mp-host-icon">
            <Icon name="monitor" size={16} />
          </div>
          <div class="mp-host-main">
            <div class="mp-host-name" data-localize-skip="true">{hostName}</div>
            <div class="mp-host-meta">
              <span class={`mp-status-dot ${connected ? "is-green" : "is-muted"}`} />
              <span>{connected ? "Đã kết nối" : "Đang kết nối lại"} · {workspaces.length} dự án · {formatNumber(tokens7d)} tok (7d)</span>
            </div>
          </div>
          <button type="button" class="button quiet small mp-pair-btn" data-action="mp-open-pair">
            <Icon name="qr-code" size={13} />
            <span>Ghép nối PC</span>
          </button>
        </div>

        {disconnectedHosts.slice(0, 2).map((host) => <button
          key={host.id}
          type="button"
          class="mp-saved-host-row"
          data-action="connect-saved-host"
          data-id={host.id}
        >
          <span class="mp-status-dot is-muted" />
          <span class="mp-saved-host-name" data-localize-skip="true">{host.name || host.url}</span>
          <span class="mp-saved-host-action">Kết nối</span>
        </button>)}

        <div class="mp-agent-pills-row">
          {usageRows.map((row) => {
            const avail = Boolean(snapshot.connectors?.[row.id]?.available);
            const count = snapshot.connectors?.[row.id]?.models?.length || 0;
            const pUsage = telemetry.byProvider?.[row.id] || {};
            const tok7d = Number(pUsage.tokens7d || 0);
            return <button
              type="button"
              class={`mp-agent-status-pill ${avail ? "is-ready" : "is-missing"}`}
              key={row.id}
              data-page="settings"
              title={row.email}
            >
              <span class={`mp-status-dot ${avail ? "is-green" : "is-muted"}`} />
              <strong data-localize-skip="true">{row.id === "antigravity" ? "Antigravity" : row.id === "claude" ? "Claude" : "Codex"}</strong>
              <small>{avail ? (tok7d > 0 ? `${formatNumber(tok7d)} tok` : `${count} model`) : "Chưa kết nối"}</small>
            </button>;
          })}
        </div>
      </div>
    </section>;
  }

  // 2. On Active Session Screen: Terminal ("shell") subtab or PLAN.md ("plan") subtab
  const task = page === "chat" && snapshot.selected ? tasks.find((t) => t.id === snapshot.selected) : null;
  if (task && snapshot.mpSessionTab === "terminal" && (snapshot.activeStageTabId || "chat") === "chat") {
    const ws = workspaces.find((w) => w.id === task.workspaceId);
    const termLines = buildTerminalLines(task, ws);
    return <div class="mp-device-screen mp-screen-terminal mp-mobile-only" aria-label="Terminal phiên AI">
      <div class="mp-terminal">
        {termLines.map((line, index) => {
          if (line.type === "cmd") {
            return <span class="mp-term-line" key={index}>
              <span class="mp-term-prompt" data-localize-skip="true">{line.host}</span>{" "}
              <span class="mp-term-dim" data-localize-skip="true">{line.path}</span>{" "}
              <span class="mp-term-prompt">$</span>{" "}
              <span class="mp-term-cmd" data-localize-skip="true">{line.cmd}</span>
            </span>;
          }
          if (line.type === "tool") {
            return <div key={index} class="mp-term-group">
              <span class="mp-term-line">
                <span class="mp-term-tool">●</span>{" "}
                <span class="mp-term-mid" data-localize-skip="true">{line.tool}</span>{" "}
                <span class="mp-term-dim" data-localize-skip="true">{line.arg}</span>
              </span>
              {line.sub ? <span class="mp-term-line">{"  "}<span class="mp-term-comment" data-localize-skip="true">⎿ {line.sub}</span></span> : null}
              {line.qaSummary ? <span class="mp-term-line">
                {"  "}<span class="mp-term-comment">⎿ </span>
                <span class={line.qaOk ? "mp-term-ok" : "mp-term-warn"} data-localize-skip="true">{line.qaSummary}</span>
              </span> : null}
            </div>;
          }
          if (line.type === "warn") {
            return <span class="mp-term-line" key={index}>
              <span class="mp-term-warn">●</span>{" "}
              <span class="mp-term-comment" data-localize-skip="true">{line.text}</span>
            </span>;
          }
          if (line.type === "reply") {
            return <div key={index} class="mp-term-group">
              {line.lines.map((rl, rIdx) => <span class="mp-term-line" key={rIdx}>
                <span class="mp-term-mid" data-localize-skip="true">{rl}</span>
              </span>)}
            </div>;
          }
          return <span class="mp-term-line" key={index}>
            <span class="mp-term-comment" data-localize-skip="true">⎿ {line.text}</span>
          </span>;
        })}
        <span class="mp-term-line">
          <span class="mp-term-prompt">›</span> <span class="mp-term-cursor" />
        </span>
      </div>
      <div class="mp-accessory-bar">
        <div class="mp-accessory-content">
          <button type="button" class="mp-accessory-key is-icon" data-action="mp-session-tab" data-tab="chat" title="Chuyển sang khung Chat">
            <Icon name="message-circle" size={14} />
          </button>
          <button type="button" class="mp-accessory-key" data-action="mp-paste-terminal">Paste</button>
          <button type="button" class="mp-accessory-key" data-action="run-task-qa" data-id={task.id}>Test QA</button>
          {task.status === "awaiting_approval" ? <button type="button" class="mp-accessory-key is-accent" data-action="approve-plan-gate" data-id={task.id}>Duyệt Plan</button> : null}
          {["running", "queued"].includes(task.status) ? <button type="button" class="mp-accessory-key is-danger" data-action="stop-task" data-id={task.id}>Ctrl+C</button> : null}
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
          <Icon name="arrow-up" size={17} />
        </button>
      </form>
    </div>;
  }

  if (task && snapshot.mpSessionTab === "plan" && (snapshot.activeStageTabId || "chat") === "chat") {
    const planText = task.plan || task.stageOutputs?.plan || task.prompt || "Chưa có nội dung kế hoạch (PLAN.md).";
    const checklist = task.goalChecklist || [];
    return <div class="mp-device-screen mp-screen-plan mp-mobile-only" aria-label="Kế hoạch phiên AI">
      <div class="mp-scroll-region mp-plan-scroll">
        <div class="mp-plan-card">
          <div class="mp-plan-card-head">
            <Icon name="file" size={15} />
            <strong>PLAN.md</strong>
            <span class="mp-wl-branch" data-localize-skip="true">{resolveTaskBranchLabel(task)}</span>
            <button type="button" class="button quiet small" style={{ marginLeft: "auto" }} data-action="edit-task-goal" data-id={task.id}>
              Mục tiêu &amp; Checklist
            </button>
          </div>
          {task.status === "awaiting_approval" ? <div class="mp-plan-gate-bar">
            <span>Phiên đang chờ duyệt kế hoạch trước khi triển khai code.</span>
            <button type="button" class="button primary small" data-action="approve-plan-gate" data-id={task.id}>
              <Icon name="check" size={14} /> Duyệt kế hoạch (GO)
            </button>
          </div> : null}
          {checklist.length > 0 ? <div class="mp-plan-checklist">
            {checklist.map((entry) => <label class="mp-plan-check-row" key={entry.id}>
              <input
                type="checkbox"
                checked={Boolean(entry.done)}
                data-action="toggle-goal-item"
                data-id={task.id}
                data-goal-id={entry.id}
              />
              <span class={entry.done ? "is-done" : ""} data-localize-skip="true">{entry.text}</span>
            </label>)}
          </div> : null}
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
          <Icon name="arrow-up" size={17} />
        </button>
      </form>
    </div>;
  }

  return null;
}
