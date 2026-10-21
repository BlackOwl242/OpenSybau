import { $, esc, fmtDate, formatNumber, icon, statuses, tokenCount, view } from "../../../shared/state.js";
import { providerTitle, roleConfig } from "../../../domain/agent-roles.js";
import { renderMarkdown } from "../markdown.js";
import { dockFileIconName } from "../stage-viewer.js";
import { ensureWorkspaceFileIndex, render } from "../runtime.js";
import { formatEffortLabel, taskProgress } from "../ui-controls.js";
import { composerAddMenu, composerAttachmentsMarkup, composerPermissionMenuMarkup } from "../composer.js";
import { missionControlStepperMarkup } from "./flows-memory-page.js";

export function orderedConversationMessages(messages) {
  const users = messages.filter((message) => message.role === "user");
  const assistants = messages.filter((message) => message.role === "assistant");
  const used = new Set();
  const ordered = [];
  for (const user of users) {
    ordered.push(user);
    let reply = assistants.find((message) => message.replyToMessageId === user.id && !used.has(message.id));
    if (!reply) reply = assistants.find((message) => !message.replyToMessageId && !used.has(message.id));
    if (reply) {
      used.add(reply.id);
      ordered.push(reply);
    }
  }
  return [...ordered, ...assistants.filter((message) => !used.has(message.id))];
}

export function taskConversationPipelineStrip(task, busy) {
  const workflow = task.config?.workflow || "codex-antigravity";
  const artifactsCount = (task.artifacts || []).length;
  if (workflow !== "chat-only" || task.status === "awaiting_approval" || task.qaResult || (task.cycles || []).length > 0) {
    return missionControlStepperMarkup(task, { compact: true });
  }
  const lastEvent = (task.events || []).filter((e) => e.kind !== "output").at(-1) || (task.events || []).at(-1);
  if (workflow === "chat-only" && !busy && !artifactsCount && !task.isolated && !task.fanoutId) return "";
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
  return `<div class="chat-pipeline-strip ${busy ? "is-running" : ""}"><div class="chat-pipeline-stages">${worktreeChip}${activityText}</div><div class="chat-pipeline-actions">${applyWtBtn}${discardWtBtn}${diffBtn}${flowBtn}</div></div>`;
}

export function taskArenaBanner(task) {
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

export function cleanToolCommandText(raw) {
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

export function taskInlineToolStream(task) {
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

export function chatContextDrawer(task) {
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

export function plainChatExcerpt(value, maxLength = 220) {
  const excerpt = String(value || "")
    .replace(/```[\s\S]*?```/g, " Khối mã ")
    .replace(/!?\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/[#>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return excerpt.length > maxLength ? `${excerpt.slice(0, maxLength).trimEnd()}…` : excerpt;
}

export function chatDurationLabel(value) {
  const milliseconds = Math.max(0, Number(value) || 0);
  if (milliseconds < 1000) return `${milliseconds} ms`;
  const seconds = milliseconds / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.floor(seconds % 60)}s`;
}

export function chatOutputTokenCount(usage) {
  return Number(usage?.output_tokens ?? usage?.completion_tokens ?? usage?.outputTokens) || 0;
}

export function updateChatOutline() {
  const panes = [...document.querySelectorAll(".conversation-chat-pane")];
  for (const pane of panes) updateOneChatOutline(pane);
}

export function updateOneChatOutline(pane) {
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
let chatOutlineFrame = 0;

export function animateChatOutlineWave(link) {
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

export function hideChatOutlinePreview(nav = $(".chat-outline-nav")) {
  nav?.classList.remove("is-previewing");
  nav?.querySelector(".chat-outline-tooltip")?.setAttribute("aria-hidden", "true");
}

export function showChatOutlinePreview(link) {
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

export function attachChatOutlineListeners() {
  document.addEventListener("scroll", (event) => {
    if (!event.target?.matches?.(".chat-thread")) return;
    hideChatOutlinePreview();
    if (chatOutlineFrame) return;
    chatOutlineFrame = requestAnimationFrame(() => {
      chatOutlineFrame = 0;
      updateChatOutline();
    });
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
}

export function taskConversationPage(taskId = view.selected, options = {}) {
  const task = view.state.tasks.find((item) => item.id === taskId);
  if (!task) return "";
  const workflow = task.config?.workflow || "codex-antigravity";
  const planRole = roleConfig(task.config, "plan");
  const buildRole = roleConfig(task.config, "build");
  const reviewRole = roleConfig(task.config, "review");
  const messages = task.chatMessages || [];
  const hasInitialMessage = messages.some((message) => message.role === "user" && message.initialChat);
  const transcript = [];
  if (!hasInitialMessage && (task.prompt || task.attachments?.length)) {
    transcript.push({ role: "user", provider: "user", content: task.prompt, attachments: (task.attachments || []).map(({ name }) => ({ name })), createdAt: task.createdAt });
  }
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
    : `<form class="chat-composer" data-modal data-form="task-chat" data-id="${esc(task.id)}">${composerAttachmentsMarkup(`task:${task.id}`)}<div class="composer-input-wrap"><textarea name="message" class="chat-input" maxlength="50000" rows="1" placeholder="${queuedTurns.length || hasActiveChatMessage ? (view.language === "en" ? "Send another message; it will wait in the queue…" : "Gửi tin nhắn tiếp theo; agent sẽ xử lý theo hàng đợi…") : "Nhắn tiếp trong cuộc trò chuyện này…"}">${esc(options.draft ?? view.chatDraft)}</textarea><div class="mention-popover" data-mention-popover hidden></div></div><input type="hidden" name="provider" value="${esc(provider)}"><input type="hidden" name="model" value="${esc(model?.id || "")}"><input type="hidden" name="effort" value="${esc(effort)}"><footer class="chat-composer-controls"><div class="composer-add-wrap">${composerAddMenu("message", task.id)}${composerPermissionMenuMarkup(task.permissionPreset || "workspace-write", "task", task.id)}</div><div class="home-composer-actions"><div class="codex-inline-model-bar"><details class="codex-pop-menu is-up is-right" data-pop-id="task-model-${esc(task.id)}"><summary class="codex-inline-trigger is-model" title="Chọn Agent & Model"><span>${esc(activeTaskModelLabel)}</span>${icon("chevron-down", 12)}</summary><div class="codex-pop-card is-model-list"><div class="codex-pop-head">Agent & Model</div><div class="codex-pop-scroll">${taskAgentItems.join("")}</div></div></details><details class="codex-pop-menu is-up is-right" data-pop-id="task-effort-${esc(task.id)}"><summary class="codex-inline-trigger is-effort" title="Mức suy luận"><span>${esc(formatEffortLabel(effort))}</span>${icon("chevron-down", 12)}</summary><div class="codex-pop-card is-effort-list"><div class="codex-pop-head">Mức suy luận</div><div class="codex-pop-scroll">${activeEfforts.map((ef) => `<button type="button" class="codex-pop-item ${ef === effort ? "is-selected" : ""}" data-action="pick-task-chat-effort" data-id="${esc(task.id)}" data-effort="${esc(ef)}"><span class="codex-pop-item-main"><span>${esc(formatEffortLabel(ef))}</span></span>${ef === effort ? icon("check", 13) : ""}</button>`).join("")}</div></div></details></div>${busy ? `<button class="button primary chat-send-button chat-stop-button" type="button" data-action="stop-task" data-id="${esc(task.id)}" aria-label="${view.language === "en" ? "Stop" : "Dừng"}" title="${view.language === "en" ? "Stop task" : "Dừng tác vụ"}">${icon("square", 13)}</button>` : `<button class="button primary chat-send-button" type="submit" aria-label="${view.language === "en" ? "Send message to queue" : "Gửi tin nhắn vào hàng đợi"}" title="${view.language === "en" ? "Send message to queue" : "Gửi tin nhắn vào hàng đợi"}" ${canSend ? "" : "disabled"}>${icon("arrow-up-right", 16)}</button>`}</div></footer></form>`;
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
