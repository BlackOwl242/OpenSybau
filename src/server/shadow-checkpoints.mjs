import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { within } from "./fs-security.mjs";

const MAX_CHECKPOINTS_PER_TASK = 30;
const SHADOW_EXCLUDES = [
  ".git/",
  ".git",
  "node_modules/",
  ".runtime/",
  "dist/",
  "build/",
  "release/",
  "target/",
  ".next/",
  ".venv/",
  "venv/",
  "*.sqlite",
  "*.db",
].join("\n") + "\n";

async function ensureShadowRepo(task, gitFn) {
  const shadowDir = resolve(task.storagePath, "shadow.git");
  const shadowIndex = resolve(task.storagePath, "shadow.index");
  if (!existsSync(shadowDir)) {
    await fs.mkdir(shadowDir, { recursive: true });
    await gitFn(task.storagePath, ["init", "--bare", shadowDir]);
    await gitFn(task.storagePath, ["--git-dir", shadowDir, "config", "core.autocrlf", "false"]).catch(() => {});
    const infoDir = resolve(shadowDir, "info");
    await fs.mkdir(infoDir, { recursive: true });
    await fs.writeFile(resolve(infoDir, "exclude"), SHADOW_EXCLUDES, "utf8");
  } else {
    const excludeFile = resolve(shadowDir, "info", "exclude");
    if (!existsSync(excludeFile)) {
      await fs.mkdir(resolve(shadowDir, "info"), { recursive: true });
      await fs.writeFile(excludeFile, SHADOW_EXCLUDES, "utf8");
    }
  }
  return { shadowDir, shadowIndex };
}

function shadowGitEnv(shadowDir, cwd, shadowIndex) {
  return {
    ...process.env,
    GIT_DIR: shadowDir,
    GIT_WORK_TREE: cwd,
    GIT_INDEX_FILE: shadowIndex,
  };
}

/**
 * Capture an isolated per-turn snapshot in a task-private bare shadow Git repo
 * without touching the workspace's own `.git/` HEAD or index.
 */
export async function createShadowCheckpoint(task, cwd, options = {}, { git }) {
  if (!task?.storagePath || !cwd || !existsSync(cwd)) return null;
  const { label = "Checkpoint", stage = "chat", turnId = "", messageId = "", force = false } = options;
  const { shadowDir, shadowIndex } = await ensureShadowRepo(task, git);
  const env = shadowGitEnv(shadowDir, cwd, shadowIndex);

  await git(cwd, ["add", "-A", "--", "."], { env, timeoutMs: 25_000 });
  const treeRes = await git(cwd, ["write-tree"], { env, timeoutMs: 15_000 });
  if (treeRes.code !== 0) return null;
  const tree = String(treeRes.stdout || "").trim();
  if (!/^[0-9a-f]{40,64}$/i.test(tree)) return null;

  task.checkpoints ||= [];
  const prev = task.checkpoints.at(-1) || null;
  if (!force && prev && prev.tree === tree) {
    return prev;
  }

  const headRef = await git(cwd, ["rev-parse", "--verify", "refs/heads/checkpoints"], { env, timeoutMs: 10_000 });
  const parentCommit = headRef.code === 0 ? String(headRef.stdout || "").trim() : "";
  const commitArgs = ["commit-tree", tree, ...(parentCommit ? ["-p", parentCommit] : []), "-m", `${stage}: ${label}`];
  const commitEnv = {
    ...env,
    GIT_AUTHOR_NAME: "OpenSybau",
    GIT_AUTHOR_EMAIL: "opensybau@local",
    GIT_COMMITTER_NAME: "OpenSybau",
    GIT_COMMITTER_EMAIL: "opensybau@local",
  };
  const commitRes = await git(cwd, commitArgs, { env: commitEnv, timeoutMs: 15_000 });
  if (commitRes.code !== 0) return null;
  const commit = String(commitRes.stdout || "").trim();
  if (!/^[0-9a-f]{40,64}$/i.test(commit)) return null;

  await git(cwd, ["update-ref", "refs/heads/checkpoints", commit], { env, timeoutMs: 10_000 });

  let files = [];
  if (parentCommit) {
    const namesRes = await git(cwd, ["diff-tree", "--no-commit-id", "--name-only", "-r", parentCommit, commit], { env, timeoutMs: 15_000 });
    if (namesRes.code === 0) {
      files = String(namesRes.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
  } else {
    const lsRes = await git(cwd, ["ls-tree", "-r", "--name-only", commit], { env, timeoutMs: 15_000 });
    if (lsRes.code === 0) {
      files = String(lsRes.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 80);
    }
  }

  const checkpoint = {
    id: `cp-${randomUUID().slice(0, 8)}`,
    commit,
    tree,
    parentCommit: parentCommit || null,
    label: String(label || stage).slice(0, 140),
    stage: String(stage || "chat"),
    turnId: String(turnId || ""),
    messageId: String(messageId || ""),
    files: files.slice(0, 60),
    fileCount: files.length,
    createdAt: new Date().toISOString(),
  };
  task.checkpoints = [...task.checkpoints, checkpoint].slice(-MAX_CHECKPOINTS_PER_TASK);
  return checkpoint;
}

/**
 * Inspect the diff of a shadow checkpoint against either its parent commit or the live workspace tree.
 */
export async function getShadowCheckpointDiff(task, cwd, checkpointId, { vsWorkingTree = false, git }) {
  const checkpoint = (task?.checkpoints || []).find((cp) => cp.id === checkpointId);
  if (!checkpoint) throw new Error("Không tìm thấy checkpoint được yêu cầu.");
  const { shadowDir, shadowIndex } = await ensureShadowRepo(task, git);
  const env = shadowGitEnv(shadowDir, cwd, shadowIndex);
  if (vsWorkingTree) {
    await git(cwd, ["add", "-A", "--", "."], { env, timeoutMs: 25_000 });
    const liveTreeRes = await git(cwd, ["write-tree"], { env, timeoutMs: 15_000 });
    const liveTree = String(liveTreeRes.stdout || "").trim();
    if (!liveTree) return { checkpoint, diff: "" };
    const diffRes = await git(cwd, ["diff", checkpoint.tree, liveTree], { env, timeoutMs: 25_000, maxBuffer: 5_000_000 });
    return { checkpoint, diff: String(diffRes.stdout || "") };
  }
  const diffRes = checkpoint.parentCommit
    ? await git(cwd, ["diff", checkpoint.parentCommit, checkpoint.commit], { env, timeoutMs: 25_000, maxBuffer: 5_000_000 })
    : await git(cwd, ["show", "--stat", checkpoint.commit], { env, timeoutMs: 15_000, maxBuffer: 2_000_000 });
  return { checkpoint, diff: String(diffRes.stdout || "") };
}

/**
 * Rewind workspace files back to a saved shadow checkpoint, removing files created afterwards.
 */
export async function rewindToShadowCheckpoint(task, cwd, checkpointId, { mode = "files-only", git } = {}) {
  const checkpoints = Array.isArray(task?.checkpoints) ? task.checkpoints : [];
  const cpIndex = checkpoints.findIndex((cp) => cp.id === checkpointId);
  if (cpIndex < 0) throw new Error("Không tìm thấy checkpoint để khôi phục.");
  const checkpoint = checkpoints[cpIndex];
  const { shadowDir, shadowIndex } = await ensureShadowRepo(task, git);
  const env = shadowGitEnv(shadowDir, cwd, shadowIndex);
  const realCwd = await fs.realpath(cwd);

  await git(cwd, ["add", "-A", "--", "."], { env, timeoutMs: 25_000 });
  const curTreeRes = await git(cwd, ["write-tree"], { env, timeoutMs: 15_000 });
  const curTree = String(curTreeRes.stdout || "").trim();

  const curLsRes = curTree ? await git(cwd, ["ls-tree", "-r", "--name-only", curTree], { env, timeoutMs: 15_000 }) : { stdout: "" };
  const targetLsRes = await git(cwd, ["ls-tree", "-r", "--name-only", checkpoint.tree], { env, timeoutMs: 15_000 });
  const currentSet = new Set(String(curLsRes.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
  const targetList = String(targetLsRes.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const targetSet = new Set(targetList);

  const removedFiles = [];
  for (const rel of currentSet) {
    if (targetSet.has(rel)) continue;
    const candidate = resolve(realCwd, rel);
    if (!within(realCwd, candidate)) continue;
    if (candidate === realCwd) continue;
    try {
      await fs.rm(candidate, { force: true });
      removedFiles.push(rel);
    } catch {}
  }

  const checkoutRes = await git(cwd, ["checkout", checkpoint.tree, "--", "."], { env, timeoutMs: 30_000 });
  if (checkoutRes.code !== 0) {
    throw new Error(`Không thể khôi phục tệp từ checkpoint: ${(checkoutRes.stderr || checkoutRes.stdout || "").trim().slice(0, 300)}`);
  }

  const restoredDiffRes = curTree
    ? await git(cwd, ["diff-tree", "--no-commit-id", "--name-only", "-r", curTree, checkpoint.tree], { env, timeoutMs: 15_000 })
    : { stdout: "" };
  const restoredFiles = String(restoredDiffRes.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);

  let trimmedChatCount = 0;
  if (mode === "files-and-chat" && Array.isArray(task.chatMessages)) {
    const beforeLen = task.chatMessages.length;
    if (checkpoint.messageId) {
      const msgIdx = task.chatMessages.findIndex((m) => m.id === checkpoint.messageId);
      if (msgIdx >= 0) {
        task.chatMessages = task.chatMessages.slice(0, msgIdx);
        trimmedChatCount = beforeLen - task.chatMessages.length;
      }
    } else if (checkpoint.createdAt) {
      const cutoff = Date.parse(checkpoint.createdAt);
      if (Number.isFinite(cutoff)) {
        task.chatMessages = task.chatMessages.filter((m) => Date.parse(m.createdAt || "") <= cutoff);
        trimmedChatCount = beforeLen - task.chatMessages.length;
      }
    }
  }

  // Record a safety rewind point so user can even see when rewind occurred
  task.updatedAt = new Date().toISOString();
  return {
    checkpoint,
    restoredFiles,
    removedFiles,
    trimmedChatCount,
    relativeDir: relative(realCwd, dirname(shadowDir)).split(sep).join("/"),
  };
}
