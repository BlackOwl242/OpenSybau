import { mountWorkbench } from "./shell/mount.jsx";
import "@fontsource-variable/nunito-sans";
import "./styles/feature-views.css";
import "./styles/legacy-dark-theme.css";
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/preset-theme.css";
import { applyThemeColors } from "./shared/theme.js";

applyThemeColors();
mountWorkbench();
import("./features/workbench/controller.js").catch((error) => {
  const root = document.querySelector("#root");
  if (root) root.innerHTML = `<main class="boot-screen boot-error">Không thể tải OpenSybau: ${String(error?.message || error)}</main>`;
});
