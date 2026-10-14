import { getLanguage, formatNumber } from "./i18n.js";
import { iconSvg } from "./ui/icons.js";

function readCollapsedWorkspaces() {
  try {
    const value = JSON.parse(localStorage.getItem("workbench.collapsed-workspaces") || "[]");
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function setupAlreadyDismissed() {
  try {
    return localStorage.getItem("opensybau.setup-v3") === "done" || localStorage.getItem("opensybau.desktop-setup-v2") === "done";
  } catch { return false; }
}

export const view = {
  page: "chat",
  language: getLanguage(),
  state: null,
  connectors: null,
  providers: [],
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
  composerAttachments: {},
  chatConfigOpen: false,
  homeMode: "chat",
  homeWorkflow: "chat-only",
  homeChatProvider: "codex",
  homeChatModel: "",
  homeChatEffort: "",
  homeRoles: {},
  homeWorkspaceId: "",
  homeConfigOpen: false,
  homeArenaProviders: ["codex", "antigravity", "claude"],
  homeArenaSlots: [],
  chatDrawerOpen: true,
  chatDrawerTab: "",
  chatDrawerFilter: "",
  chatDrawerPreview: null,
  workspaceFileIndex: {},
  diffStudioData: null,
  diffStudioTaskId: "",
  diffSelectedFile: "",
  diffAnnotationTarget: null,
  diffAnnotations: {},
  mentionMenu: null,
  searchQuery: "",
  collapsedWorkspaces: readCollapsedWorkspaces(),
  collapsedFanouts: [],
  projectMenuId: "",
  taskMenuId: "",
  selectedSkillId: "",
  skillSourceFilter: "all",
  skillEditing: false,
  skillDraft: "",
  memoryWorkspaceFilter: "all",
  memoryTestPrompt: "",
  settingsSection: "roles",
  renderedPage: "",
  renderedSelection: "",
  desktopSetupOpen: !setupAlreadyDismissed(),
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
  return iconSvg(name, size);
}

export const esc = (value = "") => String(value).replace(/[&<>"']/g, (character) => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
})[character]);

export const fmtDate = (value) => value
  ? new Intl.DateTimeFormat(view.language === "en" ? "en-US" : "vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value))
  : "—";

export { formatNumber };

export function tokenCount(usage) {
  if (!usage || typeof usage !== "object") return 0;
  return Number(usage.total_tokens ?? ((usage.input_tokens || usage.prompt_tokens || 0) + (usage.output_tokens || usage.completion_tokens || 0))) || 0;
}
