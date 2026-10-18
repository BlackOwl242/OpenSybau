import { h, render } from "preact";
import { AppShell } from "./shell.jsx";
import { observeLocalization } from "../shared/i18n.js";
import { getSavedThemeId } from "../shared/themes.js";

let snapshot = { page: "chat", theme: getSavedThemeId(), state: null, skills: [], selected: null };
let pageMarkup = '<div class="loading">Đang đọc trạng thái Codex, Antigravity và workspace trên máy…</div>';
let rootElement;

export function mountWorkbench() {
  rootElement = document.querySelector("#root");
  render(<AppShell snapshot={snapshot} pageMarkup={pageMarkup} />, rootElement);
  observeLocalization(rootElement);
}

export function updateWorkbenchShell(nextSnapshot, nextMarkup) {
  snapshot = nextSnapshot;
  pageMarkup = nextMarkup;
  if (rootElement) render(<AppShell snapshot={snapshot} pageMarkup={pageMarkup} />, rootElement);
}
