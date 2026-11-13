import { mountWorkbench } from "./shell/mount.jsx";
import { applyThemeToDom, getSavedThemeId } from "./shared/themes.js";
import "@fontsource-variable/nunito-sans";
import "./styles/feature-views.css";
import "./styles/legacy-dark-theme.css";
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/preset-theme.css";
import { isMobileCompanionMode } from "./shared/remote-host.js";

function syncDeviceLayout() {
  const mobileCompanion = isMobileCompanionMode();
  document.documentElement.classList.toggle("mobile-companion", mobileCompanion);
  document.documentElement.classList.toggle("desktop-runtime", Boolean(window.opensybauDesktop?.isDesktop));
}
syncDeviceLayout();
window.addEventListener("resize", syncDeviceLayout, { passive: true });
window.addEventListener("orientationchange", syncDeviceLayout, { passive: true });

try { localStorage.removeItem("opensybau.theme-colors.v1"); } catch {}
applyThemeToDom(getSavedThemeId());
mountWorkbench();
import("./features/workbench/controller.js").catch((error) => {
  for (const splash of document.querySelectorAll("#wb-boot-splash, .wb-boot-splash")) {
    splash.classList.add("is-dismissed");
    splash.style.opacity = "0";
    splash.style.pointerEvents = "none";
  }
  const root = document.querySelector("#root");
  if (root) root.innerHTML = `<main class="boot-screen boot-error">Không thể tải OpenSybau: ${String(error?.message || error)}</main>`;
});
