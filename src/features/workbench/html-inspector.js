import { esc, icon, view } from "../../shared/state.js";
import { providerTitle, roleConfig } from "../../domain/agent-roles.js";
import { localizeDom } from "../../shared/i18n.js";

const defaultEffortLabelMap = {
  minimal: "Tối thiểu",
  low: "Thấp",
  medium: "Trung bình",
  standard: "Tiêu chuẩn",
  high: "Cao",
  xhigh: "Rất cao",
  max: "Tối đa",
  ultra: "Siêu cao",
};

function formatEffort(effort, formatEffortLabel) {
  if (typeof formatEffortLabel === "function") return formatEffortLabel(effort);
  return defaultEffortLabelMap[String(effort || "").toLowerCase()] || effort || "Trung bình";
}

export function resolveHtmlCommentAgentSelection({ formatEffortLabel } = {}) {
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
      <span class="codex-pop-item-main"><span>${esc(formatEffort(ef, formatEffortLabel))}</span></span>
      ${isSelected ? icon("check", 13) : ""}
    </button>`;
  }).join("");

  return {
    provider,
    model,
    effort,
    activeAgentLabel,
    activeEffortLabel: formatEffort(effort, formatEffortLabel),
    agentItemsMarkup: agentItemsMarkup.join(""),
    effortItemsMarkup,
  };
}

export function renderHtmlElementCommentPopoverMarkup({ formatEffortLabel } = {}) {
  const el = view.stageHtmlSelectedElement;
  if (!el) return "";
  const {
    activeAgentLabel,
    activeEffortLabel,
    agentItemsMarkup,
    effortItemsMarkup,
  } = resolveHtmlCommentAgentSelection({ formatEffortLabel });
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

export function positionHtmlCommentMenu(menu) {
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

export function ensureIframeInspectorBridge(iframe, { formatEffortLabel } = {}) {
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
        transition: "opacity 90ms ease-out, transform 90ms ease-out",
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
        syncHtmlInspectUi({ focusInput: true, formatEffortLabel });
      }
    }, true);

    win.addEventListener("keydown", (e) => {
      if (active && e.key === "Escape") {
        if (view.stageHtmlSelectedElement) {
          view.stageHtmlSelectedElement = null;
          view.stageHtmlCommentDraft = "";
          syncHtmlInspectUi({ formatEffortLabel });
        } else if (view.stageHtmlInspectActive) {
          view.stageHtmlInspectActive = false;
          syncHtmlInspectUi({ formatEffortLabel });
        }
      }
    }, true);
  } catch {}
}

export function syncHtmlInspectUi({ focusInput = false, formatEffortLabel } = {}) {
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
      layer.innerHTML = renderHtmlElementCommentPopoverMarkup({ formatEffortLabel });
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
    ensureIframeInspectorBridge(iframe, { formatEffortLabel });
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
