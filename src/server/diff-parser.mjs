import { createHash } from "node:crypto";
import { isMainThread, parentPort, Worker } from "node:worker_threads";
import { unquoteGitPath } from "./fs-security.mjs";
import { rustParseDiffAsync, rustParseDiffSync } from "./rust-accelerator.mjs";

const DIFF_PARSE_CACHE_MAX = 24;
const diffParseCache = new Map();

function storeDiffCache(cacheKey, result) {
  if (!cacheKey) return result;
  if (diffParseCache.size >= DIFF_PARSE_CACHE_MAX) {
    const oldestKey = diffParseCache.keys().next().value;
    if (oldestKey !== undefined) diffParseCache.delete(oldestKey);
  }
  diffParseCache.set(cacheKey, result);
  return result;
}

function cleanDiffHeaderPath(raw = "", prefix = "") {
  let str = unquoteGitPath(String(raw || "").trim());
  if (prefix && str.startsWith(prefix)) str = str.slice(prefix.length);
  return str.replaceAll("\\", "/").replace(/^\/+/, "");
}

export function parseUnifiedDiffFiles(diffText) {
  const raw = String(diffText || "");
  if (!raw.trim() || (!raw.includes("---") && !raw.includes("diff --git"))) return [];
  const cacheKey = raw.length <= 262_144
    ? `${raw.length}:${createHash("sha1").update(raw).digest("base64")}`
    : "";
  if (cacheKey && diffParseCache.has(cacheKey)) {
    return diffParseCache.get(cacheKey);
  }
  if (isMainThread && raw.length >= 4_096) {
    const rustFiles = rustParseDiffSync(raw);
    if (Array.isArray(rustFiles)) {
      return storeDiffCache(cacheKey, rustFiles);
    }
  }
  const lines = raw.split(/\r?\n/);
  const files = [];
  let current = null;
  let hunk = null;
  let oldLine = 1;
  let newLine = 1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("diff --git ")) {
      if (current && (current.hunks.length || current.additions || current.deletions)) files.push(current);
      const match = line.match(/^diff --git "?a\/(.+?)"? "?b\/(.+?)"?$/);
      const oldP = cleanDiffHeaderPath(match?.[1] || "");
      const newP = cleanDiffHeaderPath(match?.[2] || "file");
      current = { path: newP || "file", oldPath: oldP, status: "modified", additions: 0, deletions: 0, hunks: [] };
      hunk = null;
      continue;
    }
    if (line.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
      const oldRaw = cleanDiffHeaderPath(line.slice(4), "a/");
      const newRaw = cleanDiffHeaderPath(lines[i + 1].slice(4), "b/");
      if (!current || current.hunks.length > 0) {
        if (current) files.push(current);
        current = { path: newRaw !== "dev/null" && newRaw !== "/dev/null" ? newRaw : oldRaw, oldPath: oldRaw, status: "modified", additions: 0, deletions: 0, hunks: [] };
      } else {
        current.oldPath = oldRaw;
        current.path = newRaw !== "dev/null" && newRaw !== "/dev/null" ? newRaw : oldRaw;
      }
      current.status = (oldRaw === "dev/null" || oldRaw === "/dev/null") ? "added" : (newRaw === "dev/null" || newRaw === "/dev/null") ? "deleted" : "modified";
      hunk = null;
      i += 1;
      continue;
    }
    if (line.startsWith("@@ ")) {
      const m = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/);
      oldLine = m ? Number(m[1]) : 1;
      newLine = m ? Number(m[2]) : 1;
      if (!current) current = { path: "changes", oldPath: "changes", status: "modified", additions: 0, deletions: 0, hunks: [] };
      hunk = { header: line, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (!hunk || !current) continue;
    if (line.startsWith("\\ No newline")) continue;
    if (line.startsWith("+")) {
      hunk.lines.push({ type: "add", oldLine: null, newLine: newLine++, text: line.slice(1) });
      current.additions += 1;
    } else if (line.startsWith("-")) {
      hunk.lines.push({ type: "del", oldLine: oldLine++, newLine: null, text: line.slice(1) });
      current.deletions += 1;
    } else if (line.startsWith(" ") || line === "") {
      hunk.lines.push({ type: "ctx", oldLine: oldLine++, newLine: newLine++, text: line.startsWith(" ") ? line.slice(1) : "" });
    }
  }
  if (current && (current.hunks.length || current.additions || current.deletions)) files.push(current);
  const result = files.slice(0, 60);
  if (cacheKey) {
    if (diffParseCache.size >= DIFF_PARSE_CACHE_MAX) {
      const oldestKey = diffParseCache.keys().next().value;
      if (oldestKey !== undefined) diffParseCache.delete(oldestKey);
    }
    diffParseCache.set(cacheKey, result);
  }
  return result;
}

if (!isMainThread && parentPort) {
  parentPort.on("message", ({ id, diffText }) => {
    try {
      const files = parseUnifiedDiffFiles(diffText);
      parentPort.postMessage({ id, ok: true, files });
    } catch (err) {
      parentPort.postMessage({ id, ok: false, error: err?.message || String(err) });
    }
  });
}

let diffWorker = null;
let diffWorkerSeq = 0;
const pendingWorkerJobs = new Map();

function ensureDiffWorker() {
  if (diffWorker) return diffWorker;
  try {
    diffWorker = new Worker(new URL(import.meta.url));
    diffWorker.unref();
    diffWorker.on("message", ({ id, ok, files }) => {
      const job = pendingWorkerJobs.get(id);
      if (!job) return;
      pendingWorkerJobs.delete(id);
      job.resolve(ok && Array.isArray(files) ? files : []);
    });
    diffWorker.on("error", () => {
      diffWorker = null;
      for (const [, job] of pendingWorkerJobs) job.resolve(parseUnifiedDiffFiles(job.diffText));
      pendingWorkerJobs.clear();
    });
  } catch {
    diffWorker = null;
  }
  return diffWorker;
}

export async function parseUnifiedDiffFilesAsync(diffText) {
  const raw = String(diffText || "");
  if (!raw.trim() || (!raw.includes("---") && !raw.includes("diff --git"))) return [];
  const cacheKey = raw.length <= 262_144
    ? `${raw.length}:${createHash("sha1").update(raw).digest("base64")}`
    : "";
  if (cacheKey && diffParseCache.has(cacheKey)) {
    return diffParseCache.get(cacheKey);
  }
  try {
    const rustFiles = await rustParseDiffAsync(raw);
    if (Array.isArray(rustFiles)) {
      return storeDiffCache(cacheKey, rustFiles);
    }
  } catch {}
  if (raw.length < 65_536) return parseUnifiedDiffFiles(raw);
  const worker = ensureDiffWorker();
  if (!worker) return parseUnifiedDiffFiles(raw);
  const id = ++diffWorkerSeq;
  return new Promise((resolvePromise) => {
    pendingWorkerJobs.set(id, { resolve: resolvePromise, diffText: raw });
    worker.postMessage({ id, diffText: raw });
  });
}
