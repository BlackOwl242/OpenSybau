import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(__dirname, "../..");
const EXE_NAME = process.platform === "win32" ? "opensybau-core.exe" : "opensybau-core";

const CANDIDATE_BINARIES = [
  process.env.OPENSYBAU_RUST_CORE_BIN ? resolve(process.env.OPENSYBAU_RUST_CORE_BIN) : "",
  resolve(PROJECT_ROOT, "native/opensybau-core/target/release", EXE_NAME),
  resolve(PROJECT_ROOT, "native/opensybau-core/target/x86_64-pc-windows-gnullvm/release", EXE_NAME),
  resolve(PROJECT_ROOT, "native/opensybau-core/target/x86_64-pc-windows-gnu/release", EXE_NAME),
  resolve(PROJECT_ROOT, "native/opensybau-core/target/x86_64-pc-windows-msvc/release", EXE_NAME),
  resolve(PROJECT_ROOT, "native/opensybau-core/target/debug", EXE_NAME),
].filter(Boolean);

let cachedBinaryPath = null;
let cachedHealth = null;
let rustWorker = null;
let rustWorkerSeq = 0;
const pendingWorkerRequests = new Map();

const telemetry = {
  callsTotal: 0,
  callsByOp: {
    "parse-diff": 0,
    "vault-graph": 0,
    "rank-bm25": 0,
    "scan-files": 0,
    health: 0,
  },
};

export function resolveRustCoreBinary() {
  if (cachedBinaryPath && existsSync(cachedBinaryPath)) {
    return cachedBinaryPath;
  }
  for (const candidate of CANDIDATE_BINARIES) {
    if (existsSync(candidate)) {
      cachedBinaryPath = candidate;
      return candidate;
    }
  }
  cachedBinaryPath = null;
  return null;
}

export function getRustAcceleratorStatus() {
  const binPath = resolveRustCoreBinary();
  if (!binPath) {
    return {
      available: false,
      engine: "js-fallback",
      lang: "javascript",
      binaryPath: null,
      workerActive: false,
      callsTotal: telemetry.callsTotal,
      callsByOp: { ...telemetry.callsByOp },
    };
  }
  if (!cachedHealth) {
    try {
      const out = execFileSync(binPath, ["health"], {
        encoding: "utf8",
        timeout: 2500,
        windowsHide: true,
        shell: false,
      });
      cachedHealth = JSON.parse(out.trim());
    } catch {
      cachedHealth = { ok: true, engine: "opensybau-core", lang: "rust", version: "0.1.0" };
    }
  }
  return {
    available: true,
    engine: cachedHealth.engine || "opensybau-core",
    lang: cachedHealth.lang || "rust",
    version: cachedHealth.version || "0.1.0",
    threads: cachedHealth.threads || 1,
    binaryPath: binPath,
    workerActive: Boolean(rustWorker && !rustWorker.killed),
    callsTotal: telemetry.callsTotal,
    callsByOp: { ...telemetry.callsByOp },
  };
}

function recordOp(op) {
  telemetry.callsTotal += 1;
  if (op in telemetry.callsByOp) {
    telemetry.callsByOp[op] += 1;
  } else {
    telemetry.callsByOp[op] = 1;
  }
}

function ensureRustWorker() {
  if (rustWorker && !rustWorker.killed && rustWorker.stdin?.writable) {
    return rustWorker;
  }
  const binPath = resolveRustCoreBinary();
  if (!binPath) return null;

  try {
    const child = spawn(binPath, ["--worker"], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
      shell: false,
    });
    child.unref();
    child.stdin?.unref?.();
    child.stdout?.unref?.();

    const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
    rl.on("line", (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed);
        const pending = pendingWorkerRequests.get(msg.id);
        if (!pending) return;
        pendingWorkerRequests.delete(msg.id);
        clearTimeout(pending.timer);
        if (msg.ok) {
          pending.resolve(msg.result);
        } else {
          pending.reject(new Error(msg.error || "Rust worker error"));
        }
      } catch {}
    });

    const cleanup = () => {
      try { rl.close(); } catch {}
      if (rustWorker === child) rustWorker = null;
      for (const [, pending] of pendingWorkerRequests) {
        clearTimeout(pending.timer);
        pending.reject(new Error("Rust worker exited"));
      }
      pendingWorkerRequests.clear();
    };
    child.on("error", cleanup);
    child.on("exit", cleanup);

    rustWorker = child;
    return child;
  } catch {
    rustWorker = null;
    return null;
  }
}

export function shutdownRustAccelerator() {
  const worker = rustWorker;
  rustWorker = null;
  for (const [, pending] of pendingWorkerRequests) {
    clearTimeout(pending.timer);
    pending.reject(new Error("Rust worker stopped"));
  }
  pendingWorkerRequests.clear();
  if (worker && !worker.killed) {
    try { worker.stdin?.end?.(); } catch {}
    try { worker.kill(); } catch {}
  }
}

export function callRustWorker(op, payload = {}, timeoutMs = 6000) {
  const worker = ensureRustWorker();
  if (!worker) return Promise.reject(new Error("Rust worker unavailable"));
  recordOp(op);
  const id = ++rustWorkerSeq;
  return new Promise((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => {
      pendingWorkerRequests.delete(id);
      rejectPromise(new Error(`Rust worker timeout (${op})`));
    }, timeoutMs);
    timer.unref?.();
    pendingWorkerRequests.set(id, { resolve: resolvePromise, reject: rejectPromise, timer });
    try {
      worker.stdin.write(`${JSON.stringify({ id, op, ...payload })}\n`);
    } catch (err) {
      clearTimeout(timer);
      pendingWorkerRequests.delete(id);
      rejectPromise(err);
    }
  });
}

export function callRustSync(subcommand, args = [], stdinText = "", timeoutMs = 5000) {
  const binPath = resolveRustCoreBinary();
  if (!binPath) return null;
  recordOp(subcommand);
  try {
    const out = execFileSync(binPath, [subcommand, ...args], {
      input: stdinText,
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
      shell: false,
    });
    return JSON.parse(out);
  } catch {
    return null;
  }
}

export function rustParseDiffSync(diffText) {
  return callRustSync("parse-diff", [], String(diffText || ""));
}

export async function rustParseDiffAsync(diffText) {
  return callRustWorker("parse-diff", { diffText: String(diffText || "") });
}

export async function rustBuildVaultGraphAsync(rootPath) {
  return callRustWorker("vault-graph", { rootPath: String(rootPath || "") });
}

export function rustRankBm25Sync({ query, workspaceId = "", memories = [], limit = 4 }) {
  return callRustSync(
    "rank-bm25",
    [],
    JSON.stringify({ query, workspaceId, memories, limit })
  );
}

export async function rustScanWorkspaceFilesAsync(rootPath, maxFiles = 180) {
  const res = await callRustWorker("scan-files", {
    rootPath: String(rootPath || ""),
    maxFiles: Number(maxFiles) || 180,
  });
  return Array.isArray(res?.files) ? res.files : null;
}
