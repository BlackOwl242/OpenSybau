const THEME_COLORS_KEY = "opensybau.theme-colors.v1";

export const themeColorControls = [
  { group: "Nền và bề mặt", id: "page", label: "Nền trang", description: "Nền chính của các trang.", value: "#242526", vars: ["--wb-bg", "--wb-main", "--background"] },
  { group: "Nền và bề mặt", id: "rail", label: "Thanh biểu tượng", description: "Thanh điều hướng ngoài cùng.", value: "#171819", vars: ["--wb-rail"] },
  { group: "Nền và bề mặt", id: "sidebar", label: "Thanh bên", description: "Danh sách workspace và chat.", value: "#202122", vars: ["--wb-sidebar", "--sidebar"] },
  { group: "Nền và bề mặt", id: "surface", label: "Thẻ và panel", description: "Thẻ, khu vực nội dung và hộp thoại.", value: "#2b2c2e", vars: ["--wb-panel", "--wb-surface", "--card"] },
  { group: "Nền và bề mặt", id: "overlay", label: "Menu và vùng tiêu đề", description: "Dropdown, menu và vùng tiêu đề nổi.", value: "#292a2c", vars: ["--wb-panel-header", "--popover"] },
  { group: "Nền và bề mặt", id: "field", label: "Ô nhập và danh sách chọn", description: "Nền input, textarea và select.", value: "#202123", vars: ["--wb-field"] },
  { group: "Thành phần", id: "primary", label: "Nút chính", description: "Nút lưu, gửi và hành động chính.", value: "#365fc3", vars: ["--primary"] },
  { group: "Thành phần", id: "secondary", label: "Nút phụ", description: "Nền nút phụ và điều khiển.", value: "#303234", vars: ["--wb-control", "--secondary"] },
  { group: "Thành phần", id: "selection", label: "Hover và mục đang chọn", description: "Nền khi rê chuột hoặc chọn mục.", value: "#383a3d", vars: ["--wb-hover", "--muted", "--accent", "--sidebar-accent"] },
  { group: "Thành phần", id: "border", label: "Viền và đường phân cách", description: "Viền card, nút, input và đường kẻ.", value: "#3a3c3f", vars: ["--wb-line", "--border", "--sidebar-border"] },
  { group: "Thành phần", id: "highlight", label: "Màu biểu tượng và liên kết", description: "Icon, liên kết và điểm nhấn phụ.", value: "#9bbcff", vars: ["--wb-accent", "--sidebar-primary", "--chart-1"] },
  { group: "Chữ và trạng thái", id: "text", label: "Chữ chính", description: "Tiêu đề, nội dung và chữ trên điều khiển.", value: "#ececec", vars: ["--wb-ink", "--wb-ink-strong", "--foreground", "--card-foreground", "--popover-foreground", "--secondary-foreground", "--accent-foreground", "--sidebar-foreground"] },
  { group: "Chữ và trạng thái", id: "mutedText", label: "Chữ phụ", description: "Mô tả, nhãn và nội dung phụ.", value: "#a4a7ab", vars: ["--wb-muted", "--muted-foreground"] },
  { group: "Chữ và trạng thái", id: "success", label: "Trạng thái thành công", description: "Màu cho hoàn tất và sẵn sàng.", value: "#81c9a4", vars: ["--wb-green", "--chart-3"] },
  { group: "Chữ và trạng thái", id: "warning", label: "Trạng thái chờ", description: "Màu cho đang chờ và cần chú ý.", value: "#e0bd77", vars: ["--wb-amber", "--chart-4"] },
  { group: "Chữ và trạng thái", id: "error", label: "Trạng thái lỗi", description: "Màu cho lỗi và thao tác xóa.", value: "#f08b8b", vars: ["--wb-red", "--destructive", "--chart-5"] },
];

const validColor = (value) => /^#[\da-f]{6}$/i.test(String(value || ""));

export function defaultThemeColors() {
  return Object.fromEntries(themeColorControls.map(({ id, value }) => [id, value]));
}

export function readThemeColors() {
  const defaults = defaultThemeColors();
  try {
    const saved = JSON.parse(localStorage.getItem(THEME_COLORS_KEY) || "{}");
    for (const id of Object.keys(defaults)) {
      if (validColor(saved?.[id])) defaults[id] = saved[id].toLowerCase();
    }
  } catch {}
  return defaults;
}

function applyControlColor(id, color) {
  if (!validColor(color)) return false;
  const control = themeColorControls.find((item) => item.id === id);
  if (!control) return false;
  const normalized = color.toLowerCase();
  for (const variable of control.vars) document.documentElement.style.setProperty(variable, normalized);
  if (id === "primary") {
    document.documentElement.style.setProperty("--primary-foreground", contrastColor(normalized));
    document.documentElement.style.setProperty("--ring", normalized === control.value ? "#83aaff" : normalized);
  }
  if (id === "border") {
    document.documentElement.style.setProperty("--wb-border-subtle", `color-mix(in srgb, ${normalized} 96.5%, white)`);
    document.documentElement.style.setProperty("--wb-border-strong", `color-mix(in srgb, ${normalized} 93%, white)`);
    document.documentElement.style.setProperty("--input", "var(--wb-border-strong)");
  }
  if (id === "success") {
    if (normalized === control.value) {
      document.documentElement.style.removeProperty("--wb-green-soft");
      document.documentElement.style.removeProperty("--wb-green-raised");
    } else {
      document.documentElement.style.setProperty("--wb-green-soft", `color-mix(in srgb, ${normalized} 14%, #242526)`);
      document.documentElement.style.setProperty("--wb-green-raised", `color-mix(in srgb, ${normalized} 24%, #242526)`);
    }
  }
  if (id === "warning") {
    if (normalized === control.value) document.documentElement.style.removeProperty("--wb-amber-soft");
    else document.documentElement.style.setProperty("--wb-amber-soft", `color-mix(in srgb, ${normalized} 14%, #242526)`);
  }
  if (id === "error") {
    if (normalized === control.value) document.documentElement.style.removeProperty("--wb-red-soft");
    else document.documentElement.style.setProperty("--wb-red-soft", `color-mix(in srgb, ${normalized} 14%, #242526)`);
  }
  return true;
}

export function applyThemeColors(colors = readThemeColors()) {
  for (const [id, color] of Object.entries(colors)) applyControlColor(id, color);
}

export function applyThemeColor(id, color) {
  if (!applyControlColor(id, color)) return false;
  const colors = readThemeColors();
  colors[id] = color.toLowerCase();
  try { localStorage.setItem(THEME_COLORS_KEY, JSON.stringify(colors)); } catch {}
  return true;
}

export function resetThemeColor(id) {
  const control = themeColorControls.find((item) => item.id === id);
  if (!control) return false;
  const colors = readThemeColors();
  colors[id] = control.value;
  try { localStorage.setItem(THEME_COLORS_KEY, JSON.stringify(colors)); } catch {}
  applyControlColor(id, control.value);
  return true;
}

export function resetThemeColors() {
  const colors = defaultThemeColors();
  try { localStorage.removeItem(THEME_COLORS_KEY); } catch {}
  applyThemeColors(colors);
  return colors;
}

function contrastColor(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((channel) => Number.parseInt(channel, 16) / 255);
  const luminance = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  return luminance > 0.42 ? "#171819" : "#ffffff";
}
