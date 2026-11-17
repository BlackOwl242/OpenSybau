import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { createServer as createNetServer } from "node:net";
import { basename, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { within } from "./fs-security.mjs";

const allocatedPorts = new Set();

function isPortAvailable(port) {
  return new Promise((resolvePromise) => {
    const probe = createNetServer();
    probe.unref?.();
    probe.once("error", () => resolvePromise(false));
    probe.listen({ port, host: "127.0.0.1", exclusive: true }, () => {
      probe.close(() => resolvePromise(true));
    });
  });
}

/**
 * Allocate an isolated `$OPENSYBAU_PORT` per concurrent worktree so multiple
 * background tasks can start independent dev servers without port collisions.
 */
export async function allocateWorktreePort(minPort = 42100, maxPort = 42999) {
  for (let p = minPort; p <= maxPort; p += 1) {
    if (allocatedPorts.has(p)) continue;
    if (await isPortAvailable(p)) {
      allocatedPorts.add(p);
      return p;
    }
  }
  return 0;
}

export function releaseWorktreePort(port) {
  if (Number.isInteger(Number(port))) allocatedPorts.delete(Number(port));
}

/**
 * Validate `.opensybau/worktree.json` lifecycle commands cleanly without shell interpolation.
 */
export function parseSafeWorktreeHookSpec(rawSpec) {
  if (!rawSpec) return null;
  if (Array.isArray(rawSpec) && rawSpec.length > 0) {
    const exe = String(rawSpec[0] || "").trim();
    const args = rawSpec.slice(1).map(String);
    if (!exe || /[;&|`$<>]/.test(exe) || /^(?:cmd|powershell|pwsh|sh|bash)(?:\.exe)?$/i.test(basename(exe))) {
      return null;
    }
    return { exe, args };
  }
  if (typeof rawSpec === "string") {
    const parts = rawSpec.trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return null;
    const allowed = new Set(["npm", "npx", "pnpm", "yarn", "node", "git"]);
    if (!allowed.has(parts[0].toLowerCase()) || parts.some((p) => /[;&|`$<>]/.test(p))) return null;
    return { exe: parts[0], args: parts.slice(1) };
  }
  return null;
}

/**
 * Pre-warmed Worktree Pool + Port Allocator + Archive Lifecycle hooks.
 */
export function createWorktreePoolManager({ worktreeDir, git, run }) {
  const warmSpareByRepo = new Map();

  async function acquirePrewarmedWorktree(repoRoot, baseHead = "HEAD") {
    const queue = warmSpareByRepo.get(repoRoot);
    while (queue?.length) {
      const candidate = queue.shift();
      if (existsSync(candidate.path) && within(worktreeDir, candidate.path)) {
        await git(candidate.path, ["reset", "--hard", baseHead]).catch(() => {});
        await git(candidate.path, ["clean", "-fd"]).catch(() => {});
        return candidate;
      }
    }
    return null;
  }

  async function prewarmWorktree(repoRoot, branchPrefix = "opensybau/warm") {
    if (!repoRoot || !existsSync(repoRoot) || !worktreeDir) return null;
    const existing = warmSpareByRepo.get(repoRoot) || [];
    if (existing.length >= 1) return existing[0];
    const warmId = randomUUID().slice(0, 8);
    const warmPath = resolve(worktreeDir, `warm-${warmId}`);
    const warmBranch = `${branchPrefix}-${warmId}`;
    await fs.mkdir(worktreeDir, { recursive: true });
    const res = await git(repoRoot, ["worktree", "add", "-b", warmBranch, warmPath, "HEAD"]);
    if (res.code !== 0) return null;
    const entry = { path: warmPath, branch: warmBranch, createdAt: Date.now() };
    warmSpareByRepo.set(repoRoot, [entry]);
    return entry;
  }

  async function runWorktreeHook(task, cwd, hookKey = "setup", { trusted = false } = {}) {
    if (!trusted || !cwd || !existsSync(cwd)) return { ran: false, reason: "untrusted-or-missing" };
    const cfgPath = resolve(cwd, ".opensybau", "worktree.json");
    if (!existsSync(cfgPath)) return { ran: false, reason: "no-config" };
    let cfg;
    try {
      const lstat = await fs.lstat(cfgPath);
      if (lstat.isSymbolicLink() || !lstat.isFile()) return { ran: false, reason: "unsafe-symlink" };
      cfg = JSON.parse(await fs.readFile(cfgPath, "utf8"));
    } catch {
      return { ran: false, reason: "invalid-json" };
    }
    const spec = parseSafeWorktreeHookSpec(cfg?.[hookKey]);
    if (!spec) return { ran: false, reason: "unsafe-or-empty-hook" };
    const port = task?.worktreePort || (await allocateWorktreePort());
    if (task && port) task.worktreePort = port;
    const env = { ...process.env, ...(port ? { OPENSYBAU_PORT: String(port) } : {}) };
    const exe = process.platform === "win32" && ["npm", "npx", "pnpm", "yarn"].includes(spec.exe.toLowerCase())
      ? `${spec.exe}.cmd`
      : spec.exe;
    const res = await run(exe, spec.args, { cwd, env, timeout: 60_000, maxBuffer: 500_000 });
    return { ran: true, code: res.code, port, stdout: String(res.stdout || "").slice(-1500), stderr: String(res.stderr || "").slice(-1500) };
  }

  async function cleanupWarmPool(repoRoot = "") {
    const entries = repoRoot ? [[repoRoot, warmSpareByRepo.get(repoRoot) || []]] : [...warmSpareByRepo.entries()];
    for (const [root, list] of entries) {
      for (const item of list) {
        await git(root, ["worktree", "remove", "--force", item.path]).catch(() => {});
        await git(root, ["branch", "-D", item.branch]).catch(() => {});
        await fs.rm(item.path, { recursive: true, force: true }).catch(() => {});
      }
      warmSpareByRepo.delete(root);
    }
  }

  return {
    allocateWorktreePort,
    releaseWorktreePort,
    acquirePrewarmedWorktree,
    prewarmWorktree,
    runWorktreeHook,
    cleanupWarmPool,
  };
}
