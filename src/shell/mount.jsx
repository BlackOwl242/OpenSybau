import { h, render } from "preact";
import { AppShell } from "./shell.jsx";

let snapshot = { page: "chat", state: null, skills: [], selected: null };
let pageMarkup = '<div class="loading">Đang đọc trạng thái Codex, Antigravity và workspace trên máy…</div>';
let rootElement;

export function mountWorkbench() {
  rootElement = document.querySelector("#root");
  render(<AppShell snapshot={snapshot} pageMarkup={pageMarkup} />, rootElement);
}

export function updateWorkbenchShell(nextSnapshot, nextMarkup) {
  snapshot = nextSnapshot;
  pageMarkup = nextMarkup;
  if (rootElement) render(<AppShell snapshot={snapshot} pageMarkup={pageMarkup} />, rootElement);
}
