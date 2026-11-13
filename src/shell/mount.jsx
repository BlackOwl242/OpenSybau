import { h, render } from "preact";
import { AppShell } from "./shell.jsx";
import { observeLocalization } from "../shared/i18n.js";
import { getSavedThemeId } from "../shared/themes.js";
import { brandLogoSvg } from "../shared/ui/icons.js";

const BOOT_LOADER_MARKUP = `<div class="loading wb-boot-loader" role="status" aria-live="polite">
  <div class="wb-boot-logo-stage" aria-hidden="true">
    ${brandLogoSvg("wbMountLogoClip", "wb-boot-svg")}
  </div>
  <div class="wb-boot-copy">
    <strong class="wb-boot-title">OpenSybau</strong>
    <span class="wb-boot-subtitle">Đang đọc trạng thái Codex, Claude, Antigravity và workspace trên máy…</span>
  </div>
</div>`;

let snapshot = { page: "chat", theme: getSavedThemeId(), state: null, skills: [], selected: null };
let pageMarkup = BOOT_LOADER_MARKUP;
let rootElement;

function dismissExternalBootSplash() {
  if (typeof document === "undefined") return;
  const externalSplash = document.getElementById("wb-boot-splash");
  if (externalSplash && (!rootElement || !rootElement.contains(externalSplash))) {
    externalSplash.classList.add("is-dismissed", "is-hidden");
    externalSplash.style.opacity = "0";
    externalSplash.style.pointerEvents = "none";
  }
}

export function mountWorkbench() {
  rootElement = document.querySelector("#root");
  render(<AppShell snapshot={snapshot} pageMarkup={pageMarkup} />, rootElement);
  dismissExternalBootSplash();
  observeLocalization(rootElement, {
    ignoreSelector: "#viewRoot, #content, .orca-right-dock, .wb-page-sidebar, [data-stable-html]",
    debounce: true,
  });
}

export function updateWorkbenchShell(nextSnapshot, nextMarkup) {
  snapshot = nextSnapshot;
  pageMarkup = nextMarkup;
  if (rootElement) {
    render(<AppShell snapshot={snapshot} pageMarkup={pageMarkup} />, rootElement);
    dismissExternalBootSplash();
  }
}
