export const navigation = [
  { id: "chat", label: "Chat", icon: "square-terminal", group: "work", sidebar: "context" },
  { id: "tasks", label: "Công việc", icon: "list-checks", group: "work", count: "tasks", sidebar: "context" },
  { id: "flows", label: "Luồng", icon: "workflow", group: "work", count: "running", sidebar: "context" },
  { id: "workspaces", label: "Dự án", icon: "folder-code", group: "work", count: "workspaces", sidebar: "context" },
  { id: "knowledge", label: "Tri thức", icon: "book-open-text", group: "library", sidebar: "context" },
  { id: "skills", label: "Kỹ năng", icon: "notebook-tabs", group: "library", count: "skills", sidebar: "context" },
  { id: "memory", label: "Bộ nhớ", icon: "brain", group: "library", count: "memory", sidebar: "context" },
  { id: "settings", label: "Cài đặt", icon: "settings-2", group: "system", sidebar: "none" },
];

export const pageTitles = Object.fromEntries(navigation.map((item) => [item.id, item.label]));
export const pageLayouts = Object.fromEntries(navigation.map((item) => [item.id, { sidebar: item.sidebar || "none" }]));
