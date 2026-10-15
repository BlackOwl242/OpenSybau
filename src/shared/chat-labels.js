export function chatNumber(task, fallback = 1) {
  return String(task?.title || "").match(/^\[#(\d+)\b/)?.[1] || String(fallback);
}

export function compactChatTitle(task) {
  const title = String(task?.title || "");
  const preview = title.replace(/^\[#\d+\s+[^\]]+\]\s*/, "").trim();
  return task?.fanoutId ? [`#${chatNumber(task)}`, preview].filter(Boolean).join(" ") : title;
}
