import { pipelineStepperData } from "./task-flow.js";
import { roleConfig } from "./agent-roles.js";

// A catalog of persisted run outputs, never a filesystem crawler or a claim of creation.
export function taskArtifactCatalog(task) {
  if (!task) return [];
  const shared = { taskId: task.id, workspaceId: task.workspaceId, workspace: task.executionPath || task.worktreePath || task.workspacePath || "", origin: task.origin || "local" };
  const entries = pipelineStepperData(task).stageDocuments.filter((doc) => doc.ready).map((doc) => ({
    ...shared, id: `document:${doc.id}`, kind: "document", docId: doc.id, title: doc.title, updatedAt: doc.updatedAt,
    source: doc.id === "spec" ? "user" : doc.id === "qa" ? "opensybau:qa" : roleConfig(task.config || {}, doc.id === "implementation" ? "build" : doc.id).provider,
  }));
  const paths = [...new Set((task.artifacts || []).filter((path) => typeof path === "string" && path))];
  if (paths.length) entries.push({ ...shared, id: "diff", kind: "diff", title: "Diff & Review", source: "git", updatedAt: task.updatedAt });
  for (const path of paths) {
    const parts = path.replaceAll("\\", "/").split("/");
    const safe = !/^(?:[a-z]:|[\\/])/i.test(path) && !parts.some((part) => part === ".." || part === ".git" || part.includes(":")) && !/^\.env|^(?:id_rsa|id_ed25519|\.npmrc|\.netrc)$|\.(?:pem|key|p12|pfx)$/i.test(parts.at(-1));
    entries.push({ ...shared, id: `file:${path}`, kind: "file", title: path, path, source: "git:changed-file", updatedAt: task.updatedAt, safe });
  }
  return entries;
}
