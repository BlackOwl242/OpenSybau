const THEME_STORAGE_KEY = "opensybau.theme";
export const DEFAULT_THEME_ID = "obsidian";

export const THEME_GROUPS = [
  {
    id: "dark",
    label: "Tối nguyên bản",
    description: "Nền tối sâu, độ tương phản chuẩn cho phiên code dài.",
  },
  {
    id: "color",
    label: "Đa sắc Antigravity",
    description: "Bảng màu không gian đa sắc lấy cảm hứng từ Antigravity & IDE hiện đại.",
  },
  {
    id: "light",
    label: "Sáng thanh lịch",
    description: "Nền sáng dịu mắt, rõ nét khi làm việc ban ngày.",
  },
];

export const THEMES = [
  {
    id: "obsidian",
    group: "dark",
    scheme: "dark",
    label: "Obsidian Dark",
    badge: "Mặc định",
    description: "Than chì nguyên bản của OpenSybau",
    swatches: ["#101114", "#18191d", "#27272a", "#f4f4f5"],
    chromeBg: "#101114",
    chromeSymbol: "#d4d4d8",
  },
  {
    id: "carbon-oled",
    group: "dark",
    scheme: "dark",
    label: "Carbon OLED",
    badge: "Pure Black",
    description: "Đen tuyền tuyệt đối, viền bạc sắc nét",
    swatches: ["#050507", "#0c0d10", "#1f2026", "#fafafa"],
    chromeBg: "#050507",
    chromeSymbol: "#e4e4e7",
  },
  {
    id: "antigravity",
    group: "color",
    scheme: "dark",
    label: "Antigravity Cosmic",
    badge: "Indigo · Cyan",
    description: "Xanh vũ trụ sâu phối điểm nhấn Indigo & Electric Cyan",
    swatches: ["#0a0d18", "#12172b", "#6366f1", "#38bdf8"],
    chromeBg: "#0a0d18",
    chromeSymbol: "#e0e7ff",
  },
  {
    id: "tokyo-night",
    group: "color",
    scheme: "dark",
    label: "Tokyo Night",
    badge: "Blue · Lavender",
    description: "Đêm Tokyo hiện đại với sắc xanh neon và tím dịu",
    swatches: ["#16161e", "#1a1b26", "#7aa2f7", "#bb9af7"],
    chromeBg: "#16161e",
    chromeSymbol: "#c0caf5",
  },
  {
    id: "synthwave",
    group: "color",
    scheme: "dark",
    label: "Synthwave Pulse",
    badge: "Rose · Violet",
    description: "Tím đêm cyberpunk phối hồng neon rực rỡ",
    swatches: ["#12091e", "#1b102d", "#f43f5e", "#a855f7"],
    chromeBg: ["#12091e"][0],
    chromeSymbol: "#f5d0fe",
  },
  {
    id: "catppuccin",
    group: "color",
    scheme: "dark",
    label: "Catppuccin Mocha",
    badge: "Mauve · Peach",
    description: "Nâu mocha ấm áp kết hợp sắc tím pastel êm dịu",
    swatches: ["#181825", "#1e1e2e", "#cba6f7", "#fab387"],
    chromeBg: "#181825",
    chromeSymbol: "#cdd6f4",
  },
  {
    id: "emerald",
    group: "color",
    scheme: "dark",
    label: "Emerald Matrix",
    badge: "Emerald · Mint",
    description: "Xanh ngọc lục bảo đậm chất terminal cổ điển",
    swatches: ["#071310", "#0c1e18", "#10b981", "#34d399"],
    chromeBg: "#071310",
    chromeSymbol: "#d1fae5",
  },
  {
    id: "rose-pine",
    group: "color",
    scheme: "dark",
    label: "Rosé Pine",
    badge: "Rose · Iris",
    description: "Tím rượu vang trầm ấm cùng sắc hồng phấn tinh tế",
    swatches: ["#191724", "#1f1d2e", "#ebbcba", "#eb6f92"],
    chromeBg: "#191724",
    chromeSymbol: "#e0def4",
  },
  {
    id: "amber-forge",
    group: "color",
    scheme: "dark",
    label: "Amber Forge",
    badge: "Amber · Gold",
    description: "Hổ phách ấm nóng lấy cảm hứng từ đèn sợi đốt",
    swatches: ["#141009", "#1e170d", "#f59e0b", "#fb923c"],
    chromeBg: "#141009",
    chromeSymbol: "#fef3c7",
  },
  {
    id: "nordic",
    group: "color",
    scheme: "dark",
    label: "Nordic Aurora",
    badge: "Frost · Slate",
    description: "Xanh băng Bắc Cực thanh tĩnh, tập trung cao độ",
    swatches: ["#1b202b", "#242936", "#88c0d0", "#81a1c1"],
    chromeBg: "#1b202b",
    chromeSymbol: "#eceff4",
  },
  {
    id: "daylight",
    group: "light",
    scheme: "light",
    label: "Daylight Frost",
    badge: "Sáng chuẩn",
    description: "Trắng sương mai tinh khiết phối xanh dương sắc nét",
    swatches: ["#f8fafc", "#ffffff", "#2563eb", "#0f172a"],
    chromeBg: "#f8fafc",
    chromeSymbol: "#0f172a",
  },
  {
    id: "warm-stone",
    group: "light",
    scheme: "light",
    label: "Editorial Stone",
    badge: "Kem di sản",
    description: "Kem giấy ấm Bauhaus đồng điệu với logo OpenSybau gốc",
    swatches: ["#f5f0eb", "#faf7f2", "#18181b", "#c2410c"],
    chromeBg: "#f5f0eb",
    chromeSymbol: "#18181b",
  },
  {
    id: "sakura-light",
    group: "light",
    scheme: "light",
    label: "Sakura Daylight",
    badge: "Sáng hồng",
    description: "Trắng ánh đào nhẹ nhàng, điểm nhấn hồng ruby",
    swatches: ["#fdf7f9", "#ffffff", "#e11d48", "#27131d"],
    chromeBg: "#fdf7f9",
    chromeSymbol: "#27131d",
  },
];

const THEME_MAP = new Map(THEMES.map((theme) => [theme.id, theme]));

export function getThemeDefinition(themeId) {
  return THEME_MAP.get(String(themeId || "").trim()) || THEME_MAP.get(DEFAULT_THEME_ID);
}

export function getSavedThemeId() {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw && THEME_MAP.has(raw)) {
      return raw;
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_THEME_ID;
}

export function applyThemeToDom(themeId) {
  const theme = getThemeDefinition(themeId);
  if (typeof document !== "undefined" && document.documentElement) {
    const root = document.documentElement;
    root.dataset.theme = theme.id;
    root.dataset.colorScheme = theme.scheme;
    root.style.colorScheme = theme.scheme;

    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute("content", theme.chromeBg);
    }
    const metaColorScheme = document.querySelector('meta[name="color-scheme"]');
    if (metaColorScheme) {
      metaColorScheme.setAttribute("content", theme.scheme);
    }
  }

  if (typeof window !== "undefined" && window.opensybauDesktop?.setTheme) {
    window.opensybauDesktop
      .setTheme({
        id: theme.id,
        scheme: theme.scheme,
        bgColor: theme.chromeBg,
        symbolColor: theme.chromeSymbol,
      })
      .catch(() => {});
  }

  return theme;
}

export function setSavedThemeId(themeId) {
  const theme = getThemeDefinition(themeId);
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme.id);
  } catch {
    // ignore storage errors
  }
  return applyThemeToDom(theme.id);
}
