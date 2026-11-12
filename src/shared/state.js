import { getLanguage, formatNumber } from "./i18n.js";
import { isMobileCompanionMode } from "./remote-host.js";
import { getSavedThemeId } from "./themes.js";
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
  theme: getSavedThemeId(),
  state: null,
  connectors: null,
  providers: [],
  skills: [],
  skillsLoaded: false,
  skillFilter: "",
  subagentProfiles: [],
  subagentProfilesLoaded: false,
  subagentProfilesWorkspaceId: "",
  skillsSection: "skills",
  selectedSubagentProfileId: "",
  subagentProfileDetailsCache: {},
  subagentProfileEditing: false,
  subagentProfileEditingId: "",
  subagentProfileDraft: "",
  homeSubagentPolicy: { mode: "auto", codexMultiAgentV2: false, sharedCheckoutReadOnly: true, profileIds: [] },
  taskSubagentDetailCache: {},
  dockSubagentFilter: "all",
  selectedDockSubagentId: "",
  settingsSupported: false,
  streamConnected: false,
  selected: null,
  chatSplitWorkspaceId: "",
  chatSplitTaskIds: [],
  chatSplitActiveTaskId: "",
  chatSplitPickerOpen: false,
  chatSplitCreateOpen: false,
  chatSplitCreateDraft: "",
  chatSplitDrafts: {},
  chatSplitReturnWorkspaceId: "",
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
  chatDraftsByTask: {},
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
  stageTabs: [],
  activeStageTabId: "chat",
  stageSplit: false,
  stageLineCommentTarget: null,
  stageHtmlInspectActive: false,
  stageHtmlSelectedElement: null,
  stageHtmlCommentProvider: "",
  stageHtmlCommentModel: "",
  stageHtmlCommentEffort: "",
  stageHtmlCommentDraft: "",
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
  settingsSection: "all",
  renderedPage: "",
  renderedSelection: "",
  desktopSetupOpen: !setupAlreadyDismissed() && !isMobileCompanionMode(),
  cliInstallProvider: "",
  waveRiskFilter: "all",
  waveCriticalOnly: false,
  homePlanGate: false,
  homeMaxRounds: 2,
  mobileScreen: "home",
  mpSessionTab: "chat",
  mpWlFilter: "all",
  mpWlRepo: "all",
  mpWlSearchOpen: false,
  mpWlSearchQuery: "",
};

export const statuses = {
  queued: "Đang chờ",
  running: "Đang chạy",
  awaiting_approval: "Chờ duyệt Plan",
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

export function setBoundedCache(obj, key, value, maxKeys = 60) {
  if (!obj || typeof obj !== "object" || !key) return value;
  if (Object.hasOwn(obj, key)) {
    delete obj[key];
  }
  obj[key] = value;
  const keys = Object.keys(obj);
  while (keys.length > maxKeys) {
    const oldest = keys.shift();
    if (oldest !== undefined) delete obj[oldest];
  }
  return value;
}
