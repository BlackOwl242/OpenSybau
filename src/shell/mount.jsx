import { h, render } from "preact";
import { AppShell } from "./shell.jsx";
import { observeLocalization } from "../shared/i18n.js";
import { getSavedThemeId } from "../shared/themes.js";

const BOOT_LOADER_MARKUP = `<div class="loading wb-boot-loader" role="status" aria-live="polite">
  <div class="wb-boot-logo-stage" aria-hidden="true">
    <svg class="wb-boot-svg" viewBox="0 0 64 64" fill="none">
      <circle class="dot-tl" cx="19.6" cy="19.8" r="6.8" fill="currentColor" />
      <circle class="dot-br" cx="44.4" cy="44.2" r="6.8" fill="currentColor" />
      <path class="wing-top" d="M29.8 24.2C29.8 23.45 30.22 22.76 30.89 22.43L48.72 13.51C49.91 12.92 51.2 13.78 51.2 15.11V24.9C51.2 25.65 50.78 26.34 50.11 26.67L35.09 34.18C34.55 34.45 34.2 35 34.2 35.61L29.8 28.39V24.2Z" fill="currentColor" />
      <path class="wing-bot" d="M29.8 28.39L34.2 35.61V39.8C34.2 40.55 33.78 41.24 33.11 41.57L15.28 50.49C14.09 51.08 12.8 50.22 12.8 48.89V39.1C12.8 38.35 13.22 37.66 13.89 37.33L28.91 29.82C29.45 29.55 29.8 29 29.8 28.39Z" fill="currentColor" />
    </svg>
  </div>
  <div class="wb-boot-copy">
    <strong class="wb-boot-title">OpenSybau</strong>
    <span class="wb-boot-subtitle">Đang đọc trạng thái Codex, Antigravity và workspace trên máy…</span>
  </div>
</div>`;

let snapshot = { page: "chat", theme: getSavedThemeId(), state: null, skills: [], selected: null };
let pageMarkup = BOOT_LOADER_MARKUP;
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
