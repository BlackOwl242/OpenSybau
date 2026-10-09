function readCollapsedWorkspaces() {
  try {
    const value = JSON.parse(localStorage.getItem("workbench.collapsed-workspaces") || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

export const view = {
  page: "chat",
  state: null,
  connectors: null,
  skills: [],
  skillsLoaded: false,
  skillFilter: "",
  settingsSupported: false,
  streamConnected: false,
  selected: null,
  filter: "all",
  busy: false,
  toastTimer: null,
  workspaceDir: "",
  workspaceEntries: [],
  filePreview: null,
  vaultDir: "",
  vaultEntries: [],
  vaultPreview: null,
  chatProvider: "codex",
  chatModel: "",
  chatEffort: "",
  chatDraft: "",
  chatConfigOpen: false,
  homeMode: "chat",
  homeWorkflow: "chat-only",
  homeChatProvider: "codex",
  homeChatModel: "",
  homeChatEffort: "",
  homeRoles: {},
  homeWorkspaceId: "",
  homeConfigOpen: false,
  searchQuery: "",
  collapsedWorkspaces: readCollapsedWorkspaces(),
  projectMenuId: "",
  renderedPage: "",
  renderedSelection: "",
};

export const statuses = {
  queued: "Đang chờ",
  running: "Đang chạy",
  done: "Hoàn tất",
  failed: "Lỗi",
  cancelled: "Đã dừng",
};

export const efforts = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

export const $ = (selector, root = document) => root.querySelector(selector);

export function icon(name, size = 16) {
  return window.LucideIcons.toSvg(name, size);
}

export const esc = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character]);

export const fmtDate = (value) => value
  ? new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
  : "—";

export function tokenCount(usage) {
  if (!usage || typeof usage !== "object") return 0;
  return Number(usage.total_tokens ?? ((usage.input_tokens || usage.prompt_tokens || 0) + (usage.output_tokens || usage.completion_tokens || 0))) || 0;
}
