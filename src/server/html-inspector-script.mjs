export const ORCA_INSPECTOR_SCRIPT = `<script data-orca-inspector="1">
(() => {
  if (window.__orcaInspectorInstalled) return;
  window.__orcaInspectorInstalled = true;
  let active = false;
  let hoveredEl = null;
  let lockedEl = null;
  let box = null;

  function ensureBox() {
    if (box && (document.body || document.documentElement)?.contains(box)) return box;
    box = document.createElement("div");
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
    (document.body || document.documentElement).appendChild(box);
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
    while (cur && cur.nodeType === 1 && cur !== document.body && cur !== document.documentElement && parts.length < 4) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        parts.unshift(part + "#" + cur.id);
        break;
      }
      const cls = typeof cur.className === "string"
        ? cur.className.trim().split(/\\s+/).filter((c) => c && !c.startsWith("__orca")).slice(0, 2)
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
    const text = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120);
    const labelText = [aria, text, val, placeholder].filter(Boolean)[0] || selector || ("<" + tag + ">");
    const clone = el.cloneNode(true);
    const outerHTML = (clone.outerHTML || "").replace(/\\s+/g, " ").trim().slice(0, 320);
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
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      },
    };
  }

  function resolveInspectTarget(rawTarget) {
    if (!rawTarget || rawTarget.nodeType !== 1) return null;
    if (rawTarget.id === "__orca_inspect_box__" || rawTarget === document.documentElement || rawTarget === document.body) return null;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(rawTarget.tagName)) {
      const parent = rawTarget.parentElement;
      if (parent && parent !== document.body && parent.children.length <= 3) {
        const pr = parent.getBoundingClientRect();
        if (pr.height > 0 && pr.height <= 120 && pr.width <= 520) return parent;
      }
    }
    return rawTarget;
  }

  function setMode(nextActive, clearLocked = true) {
    active = Boolean(nextActive);
    if (clearLocked || !active) lockedEl = null;
    hoveredEl = null;
    document.documentElement.style.cursor = active ? "crosshair" : "";
    updateBoxFor(lockedEl || hoveredEl);
  }

  window.__orcaSetInspectMode = setMode;

  window.addEventListener("mousemove", (e) => {
    if (!active || lockedEl) return;
    const target = resolveInspectTarget(e.target);
    if (target !== hoveredEl) {
      hoveredEl = target;
      updateBoxFor(hoveredEl);
    }
  }, true);

  window.addEventListener("scroll", () => {
    if (active && (lockedEl || hoveredEl)) updateBoxFor(lockedEl || hoveredEl);
  }, true);

  window.addEventListener("resize", () => {
    if (active && (lockedEl || hoveredEl)) updateBoxFor(lockedEl || hoveredEl);
  }, true);

  window.addEventListener("click", (e) => {
    if (!active) return;
    const target = resolveInspectTarget(e.target) || (e.target?.nodeType === 1 ? e.target : null);
    if (!target || target === document.body || target === document.documentElement) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    lockedEl = target;
    updateBoxFor(lockedEl);
    const info = describeElement(lockedEl);
    if (info) {
      window.parent?.postMessage({ type: "orca-inspect:selected", element: info }, "*");
    }
  }, true);

  window.addEventListener("keydown", (e) => {
    if (active && e.key === "Escape") {
      window.parent?.postMessage({ type: "orca-inspect:escape" }, "*");
    }
  }, true);

  window.addEventListener("message", (e) => {
    const data = e?.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "orca-inspect:set-mode") {
      setMode(Boolean(data.active), data.clearSelection !== false);
    } else if (data.type === "orca-inspect:clear-selection") {
      lockedEl = null;
      updateBoxFor(hoveredEl);
    } else if (data.type === "orca-inspect:hover-selector" && data.selector) {
      active = true;
      const el = document.querySelector(data.selector);
      if (el) {
        hoveredEl = el;
        updateBoxFor(el);
      }
    } else if (data.type === "orca-inspect:select-selector" && data.selector) {
      active = true;
      const el = document.querySelector(data.selector);
      if (el) {
        lockedEl = el;
        updateBoxFor(el);
        const info = describeElement(el);
        if (info) window.parent?.postMessage({ type: "orca-inspect:selected", element: info }, "*");
      }
    }
  });

  function notifyReady() {
    window.parent?.postMessage({ type: "orca-inspect:ready" }, "*");
  }
  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", notifyReady);
  } else {
    notifyReady();
  }
  window.addEventListener("load", notifyReady);
})();
</script>`;

export function injectOrcaInspectorHtml(htmlBufferOrString) {
  const htmlStr = Buffer.isBuffer(htmlBufferOrString)
    ? htmlBufferOrString.toString("utf8")
    : String(htmlBufferOrString || "");
  const injectedHtml = /<\/body>/i.test(htmlStr)
    ? htmlStr.replace(/<\/body>/i, `${ORCA_INSPECTOR_SCRIPT}</body>`)
    : `${htmlStr}\n${ORCA_INSPECTOR_SCRIPT}`;
  return Buffer.from(injectedHtml, "utf8");
}
