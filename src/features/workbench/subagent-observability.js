// Detail requests and state snapshots can arrive in either order.
export function mergeSubagentDetail(summary, detail) {
  if (!detail) return { ...summary };
  const summaryTime = Date.parse(summary?.updatedAt || "") || 0;
  const detailTime = Date.parse(detail.updatedAt || "") || 0;
  return detailTime > summaryTime ? { ...summary, ...detail } : { ...detail, ...summary };
}

export function subagentEventTime(value, language = "vi") {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(language === "en" ? "en-US" : "vi-VN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).format(date);
}
