// A provider may report just one window, or report the weekly window first.
export function quotaWindowKind(win) {
  const minutes = Number(win?.windowMinutes);
  if (minutes === 300) return "5h";
  if (minutes === 10080) return "7d";
  const label = String(win?.label || win?.window || "").trim().toLowerCase();
  if (label === "5h") return "5h";
  if (label === "7d" || label === "weekly") return "7d";
  return "";
}

export function findQuotaPeriod(windows = [], kind) {
  return windows.find((win) => {
    const label = String(win?.label || win?.window || "").toLowerCase();
    return quotaWindowKind(win) === kind && (label === kind || (kind === "7d" && label === "weekly"));
  });
}

export function quotaWindowsWithPeriods(windows = []) {
  const result = Array.isArray(windows) ? [...windows] : [];
  if (!findQuotaPeriod(result, "5h")) result.unshift({ id: "5h-unavailable", label: "5h", unavailable: true });
  if (!findQuotaPeriod(result, "7d")) result.push({ id: "weekly-unavailable", label: "7d", unavailable: true });
  return result;
}
