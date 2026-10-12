export const navigation = [
  { id: "chat", label: "Chat", icon: "square-terminal", group: "work", sidebar: "context" },
  { id: "tasks", label: "Công việc", icon: "list-checks", group: "work", count: "tasks" },
  { id: "flows", label: "Luồng", icon: "workflow", group: "work", count: "running" },
  { id: "workspaces", label: "Dự án", icon: "folder-code", group: "work", count: "workspaces" },
  { id: "knowledge", label: "Tri thức", icon: "book-open-text", group: "library" },
  { id: "skills", label: "Kỹ năng", icon: "notebook-tabs", group: "library", count: "skills" },
  { id: "memory", label: "Bộ nhớ", icon: "brain", group: "library", count: "memory" },
  { id: "settings", label: "Cài đặt", icon: "settings-2", group: "system" },
];

export const pageTitles = Object.fromEntries(navigation.map((item) => [item.id, item.label]));
export const pageLayouts = Object.fromEntries(navigation.map((item) => [item.id, { sidebar: item.sidebar || "none" }]));
