export function trackCommand(task, { id, source, command, status, output, parentId = null, background = false, exitCode = null }) {
  if (!id || !source) return;
  task.commandActivities ||= [];
  let activity = task.commandActivities.find((item) => item.id === `${source}:${id}`);
  if (!activity) {
    activity = { id: `${source}:${id}`, source, parentId, command: String(command || "").slice(0, 1000), startedAt: new Date().toISOString(), background, cancellable: false };
    task.commandActivities.push(activity);
  }
  activity.status = status;
  activity.updatedAt = new Date().toISOString();
  task.updatedAt = activity.updatedAt;
  if (output !== undefined) activity.output = String(output).slice(-16000);
  if (exitCode !== null) activity.exitCode = exitCode;
  if (["completed", "failed", "cancelled"].includes(status)) activity.completedAt = activity.updatedAt;
  // Keep live commands; retain a bounded tail of completed command metadata.
  while (task.commandActivities.length > 200) {
    const index = task.commandActivities.findIndex((item) => item.status !== "running");
    if (index < 0) break;
    task.commandActivities.splice(index, 1);
  }
}

export function interruptCommandActivities(task) {
  for (const item of task.commandActivities || []) if (item.status === "running") item.status = "unknown";
}
