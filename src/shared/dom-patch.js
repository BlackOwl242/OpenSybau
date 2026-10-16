import morphdom from "morphdom";

function nodeKey(node) {
  if (node.nodeType !== 1) return undefined;
  if (node.getAttribute("id")) return node.getAttribute("id");
  const pane = node.closest(".multi-chat-pane")?.dataset.taskId || "";
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
  const scroll = [...element.querySelectorAll(".chat-thread, .codex-pop-scroll, .multi-chat-picker-list")]
    .map((node) => ({ node, top: node.scrollTop, end: node.matches(".chat-thread") && node.scrollHeight - node.scrollTop - node.clientHeight < 48 }));
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
      if (background && from.matches("input:not([type=hidden]), textarea, select")) return false;
      // Canvas state and dimensions are managed by its renderer.
      if (from.tagName === "CANVAS") return false;
      if (from.matches("input, textarea, select")) return true;
      return !from.isEqualNode(to) || (!background && Boolean(from.querySelector("input, textarea, select")));
    },
  });
  for (const { node, top, end } of scroll) {
    if (node.isConnected) node.scrollTop = end ? node.scrollHeight : top;
  }
  if (focused?.isConnected && element.contains(focused)) {
    if (element.ownerDocument.activeElement !== focused) focused.focus({ preventScroll: true });
    if (selection) focused.setSelectionRange(...selection);
  }
}
