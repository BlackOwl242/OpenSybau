(function () {
  var BOOT_THEMES = {
    "obsidian": { bg: "#18191b", chrome: "#101114", panel: "#262729", fg: "#fafafa", muted: "#9898a2", border: "rgba(255,255,255,0.08)", light: false },
    "carbon-oled": { bg: "#050608", chrome: "#050608", panel: "#0c0e14", fg: "#ffffff", muted: "#9ca3af", border: "rgba(255,255,255,0.09)", light: false },
    "antigravity": { bg: "#090d1a", chrome: "#0a0d18", panel: "#10172c", fg: "#f8fafc", muted: "#94a3b8", border: "rgba(129,140,248,0.16)", light: false },
    "tokyo-night": { bg: "#1a1b26", chrome: "#16161e", panel: "#1f2335", fg: "#e2e8f0", muted: "#7aa2f7", border: "rgba(169,177,214,0.14)", light: false },
    "synthwave": { bg: "#11081d", chrome: "#12091e", panel: "#1b0e2e", fg: "#fdf4ff", muted: "#c084fc", border: "rgba(216,180,254,0.15)", light: false },
    "catppuccin": { bg: "#1e1e2e", chrome: "#181825", panel: "#252538", fg: "#f5e0dc", muted: "#a6adc8", border: "rgba(205,214,244,0.13)", light: false },
    "emerald": { bg: "#06120e", chrome: "#071310", panel: "#0b1e18", fg: "#ecfdf5", muted: "#6ee7b7", border: "rgba(110,231,183,0.15)", light: false },
    "rose-pine": { bg: "#1f1d2e", chrome: "#191724", panel: "#26233a", fg: "#fffaf3", muted: "#908caa", border: "rgba(224,222,244,0.13)", light: false },
    "amber-forge": { bg: "#130f08", chrome: "#141009", panel: "#1e170d", fg: "#fffbeb", muted: "#d6b88a", border: "rgba(253,230,138,0.14)", light: false },
    "nordic": { bg: "#242936", chrome: "#1b202b", panel: "#2b3140", fg: "#eceff4", muted: "#9aa5b8", border: "rgba(216,222,233,0.14)", light: false },
    "daylight": { bg: "#ffffff", chrome: "#f8fafc", panel: "#f8fafc", fg: "#0f172a", muted: "#475569", border: "rgba(15,23,42,0.11)", light: true },
    "warm-stone": { bg: "#faf7f2", chrome: "#f5f0eb", panel: "#f4efe6", fg: "#141413", muted: "#57534e", border: "rgba(28,25,23,0.12)", light: true },
    "sakura-light": { bg: "#fffbfc", chrome: "#fdf7f9", panel: "#fcf2f6", fg: "#27101a", muted: "#754658", border: "rgba(136,19,55,0.12)", light: true },
    "paper-ink": { bg: "#faf8f5", chrome: "#f5f2ed", panel: "#f3efe8", fg: "#18181b", muted: "#52525b", border: "rgba(24,24,27,0.12)", light: true },
    "alabaster": { bg: "#fafafa", chrome: "#f4f4f5", panel: "#f4f4f5", fg: "#09090b", muted: "#52525b", border: "rgba(9,9,11,0.1)", light: true },
    "warm-linen": { bg: "#faf7f2", chrome: "#f5f0eb", panel: "#f4efe6", fg: "#1c1917", muted: "#57534e", border: "rgba(28,25,23,0.12)", light: true }
  };
  var themeId = "obsidian";
  try {
    var saved = localStorage.getItem("opensybau.theme.v2") || localStorage.getItem("opensybau.theme");
    if (
      saved === "carbon-oled" &&
      localStorage.getItem("opensybau.mobile-oled-default.v1") === "1" &&
      !localStorage.getItem("opensybau.mobile-obsidian-default.v2")
    ) {
      localStorage.setItem("opensybau.mobile-obsidian-default.v2", "1");
      localStorage.setItem("opensybau.theme", "obsidian");
      saved = "obsidian";
    }
    if (saved && BOOT_THEMES[saved]) {
      themeId = saved;
    }
  } catch (_err) {}
  var entry = BOOT_THEMES[themeId] || BOOT_THEMES["obsidian"];
  var scheme = entry.light ? "light" : "dark";
  var root = document.documentElement;
  root.dataset.theme = themeId;
  root.dataset.wbTheme = themeId;
  root.dataset.colorScheme = scheme;
  root.dataset.wbScheme = scheme;
  root.style.colorScheme = scheme;
  root.style.setProperty("--wb-boot-bg", entry.bg);
  root.style.setProperty("--wb-boot-fg", entry.fg);
  root.style.setProperty("--wb-boot-panel", entry.panel);
  root.style.setProperty("--wb-boot-muted", entry.muted);
  root.style.setProperty("--wb-boot-border", entry.border);
  var metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.setAttribute("content", entry.chrome);
  var metaScheme = document.querySelector('meta[name="color-scheme"]');
  if (metaScheme) metaScheme.setAttribute("content", scheme);
  try {
    if (window.opensybauAndroid && typeof window.opensybauAndroid.setSystemBarTheme === "function") {
      window.opensybauAndroid.setSystemBarTheme(entry.chrome, Boolean(entry.light));
    }
  } catch (_bridgeErr) {}
})();
