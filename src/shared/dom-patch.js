import morphdom from "morphdom";

const SCROLL_SELECTOR = ".chat-thread, .codex-pop-scroll, .multi-chat-picker-list, .orca-dock-body, .orca-code-scroll, .orca-doc-scroll, .orca-diff-scroll, .orca-table-scroll, .kb-doc-scroll, .kb-file-list, .kb-inspector-scroll, .chat-tool-stream-body, .orchestration-event-list, .wb-side-scroll, .diff-hunk-list, .diff-file-list";

const scrollKey = (el, idx) => el.id || el.dataset?.key || el.dataset?.scrollKey || `${el.className}::${idx}`;

function nodeKey(node) {
  if (node.nodeType !== 1) return undefined;
  const pane = node.closest(".multi-chat-pane")?.dataset.taskId || "";
  if (node.dataset?.key) return pane ? `${pane}:${node.dataset.key}` : node.dataset.key;
  if (node.getAttribute("id")) return node.getAttribute("id");
  if (node.matches(".multi-chat-pane")) return `pane:${pane}`;
  if (node.dataset.popId) return `pop:${pane}:${node.dataset.popId}`;
  if (node.matches("form[data-form]")) return `form:${pane}:${node.dataset.form}:${node.dataset.id || ""}`;
  if (node.matches("iframe[src]")) return `frame:${pane}:${node.getAttribute("src")}`;
  return undefined;
}

// Patch the existing nodes rather than replacing innerHTML. This keeps iframe
// documents, scroll containers, focus, and native dropdown state alive.
export function patchHtml(element, html, { background = false } = {}) {
  const target = element.cloneNode(false);
  target.innerHTML = html;
  const scrollMap = new Map();
  [...element.querySelectorAll(SCROLL_SELECTOR)].forEach((el, idx) => {
    const entry = {
      top: el.scrollTop,
      left: el.scrollLeft,
      end: el.matches(".chat-thread") && el.scrollHeight - el.scrollTop - el.clientHeight < 48,
    };
    scrollMap.set(scrollKey(el, idx), entry);
    if (el.className && !scrollMap.has(el.className)) scrollMap.set(el.className, entry);
  });
  const focused = element.ownerDocument.activeElement;
  const selection = focused && typeof focused.selectionStart === "number"
    ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] : null;
  morphdom(element, target, {
    childrenOnly: true,
    getNodeKey: nodeKey,
    addChild(parent, child) {
      if (child.isConnected && parent.isConnected && typeof parent.moveBefore === "function") parent.moveBefore(child, null);
      else parent.appendChild(child);
    },
    onBeforeElUpdated(from, to) {
      if (background && from.matches(".multi-chat-create-form")) return false;
      if (from.tagName === "DETAILS") to.toggleAttribute("open", from.open);
      if ((background || from === document.activeElement) && from.matches("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea, select")) {
        return false;
      }
      // Canvas state and dimensions are managed by its renderer.
      if (from.tagName === "CANVAS") return false;
      if (from.matches("input, textarea, select")) return true;
      return !from.isEqualNode(to) || (!background && Boolean(from.querySelector("input, textarea, select")));
    },
  });
  [...element.querySelectorAll(SCROLL_SELECTOR)].forEach((el, idx) => {
    const saved = scrollMap.get(scrollKey(el, idx)) || (el.className ? scrollMap.get(el.className) : null);
    if (!saved) return;
    el.scrollTop = saved.end ? el.scrollHeight : saved.top;
    el.scrollLeft = saved.left;
  });
  if (focused?.isConnected && element.contains(focused)) {
    if (element.ownerDocument.activeElement !== focused) focused.focus({ preventScroll: true });
    if (selection) focused.setSelectionRange(...selection);
  }
}

