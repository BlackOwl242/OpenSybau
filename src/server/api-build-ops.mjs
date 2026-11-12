import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";
import {
  allowedTextFile,
  listRemoteContextFiles,
  redactRemoteSecrets,
  resolveInside,
  safeForRemoteContext,
} from "./fs-security.mjs";

export async function externalWorkspaceContext(task, stage, gitFn) {
  const cwd = task.executionPath || task.workspacePath;
  const files = await listRemoteContextFiles(cwd, 180, gitFn);
  const sections = [`Workspace file list (paths only; up to 180 entries):\n${files.map((path) => `- ${path}`).join("\n") || "No project file list is available."}`];
  const buildSnapshotHashes = new Map();
  if (stage === "review") {
    const diff = await gitFn(cwd, ["diff", "--no-ext-diff", "--unified=2", "--", ...files.filter((path) => safeForRemoteContext(path)).slice(0, 80)]);
    const snippets = [];
    for (const rel of files.filter((item) => safeForRemoteContext(item) && (item.endsWith(".md") || item.endsWith(".json") || /\.(?:[cm]?[jt]sx?)$|\.(?:ts|tsx)$/.test(item))).slice(0, 30)) {
      if (snippets.join("\n").length > 24_000) break;
      try {
        const candidate = resolve(cwd, rel);
        const lstat = await fs.lstat(candidate).catch(() => null);
        if (!lstat || !lstat.isFile() || lstat.isSymbolicLink()) continue;
        const resolved = await resolveInside(cwd, rel, true).catch(() => null);
        const full = resolved?.target;
        if (!full || !allowedTextFile(full)) continue;
        snippets.push(`--- ${rel} ---\n${redactRemoteSecrets((await fs.readFile(full, "utf8")).slice(0, 6000))}`);
      } catch {}
    }
    sections.push(`Current changes for remote review (truncated):\n${redactRemoteSecrets(String(diff.stdout || "No tracked diff available.").slice(0, 28_000))}`);
    if (snippets.length) sections.push(`Current file snapshots for remote review (includes untracked files when readable):\n${snippets.join("\n\n").slice(0, 24_000)}`);
  } else if (stage === "build") {
    const contextFiles = files.filter((path) => /(^|\/)(?:AGENTS\.md|README(?:\.[^/]*)?|package\.json|pyproject\.toml|Cargo\.toml|go\.mod)$/i.test(path)
      || /\.(?:[cm]?[jt]sx?|ts|tsx|css|html|json|ya?ml|md)$/i.test(path)).slice(0, 24);
    const snippets = [];
    let total = 0;
    for (const rel of contextFiles) {
      if (total >= 44_000) break;
      try {
        const candidate = resolve(cwd, rel);
        const lstat = await fs.lstat(candidate).catch(() => null);
        if (!lstat || !lstat.isFile() || lstat.isSymbolicLink() || lstat.size > 8_000) continue;
        const resolved = await resolveInside(cwd, rel, true).catch(() => null);
        const full = resolved?.target;
        if (!full || !allowedTextFile(full)) continue;
        const originalBytes = await fs.readFile(full);
        const original = originalBytes.toString("utf8");
        const content = redactRemoteSecrets(original);
        if (content !== original || content.includes("\uFFFD")) continue;
        const snippet = `--- ${rel} ---\n${content}`;
        if (total + snippet.length > 44_000) break;
        snippets.push(snippet);
        total += snippet.length;
        buildSnapshotHashes.set(rel.toLocaleLowerCase(), createHash("sha256").update(originalBytes).digest("hex"));
      } catch {}
    }
    if (snippets.length) sections.push(`Selected text files for implementation context (truncated; not a full workspace snapshot):\n${snippets.join("\n\n").slice(0, 48_000)}`);
  } else {
    const contextFiles = files.filter((path) => /(^|\/)(?:AGENTS\.md|README(?:\.[^/]*)?|package\.json|pyproject\.toml|Cargo\.toml|go\.mod)$/i.test(path)).slice(0, 12);
    const snippets = [];
    for (const rel of contextFiles) {
      if (snippets.join("\n").length > 24_000) break;
      try {
        const candidate = resolve(cwd, rel);
        const lstat = await fs.lstat(candidate).catch(() => null);
        if (!lstat || !lstat.isFile() || lstat.isSymbolicLink()) continue;
        const resolved = await resolveInside(cwd, rel, true).catch(() => null);
        const full = resolved?.target;
        if (!full || !allowedTextFile(full)) continue;
        snippets.push(`--- ${rel} ---\n${redactRemoteSecrets((await fs.readFile(full, "utf8")).slice(0, 7000))}`);
      } catch {}
    }
    if (snippets.length) sections.push(`Project instructions and manifests:\n${snippets.join("\n\n").slice(0, 24_000)}`);
  }
  return { text: `\n\nExternal provider context (shared outside this computer; obvious secret patterns were redacted):\n${sections.join("\n\n")}`, buildSnapshotHashes };
}

function extractToolCallCandidates(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return [];
  const candidates = [];
  const stripped = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (stripped.startsWith("{") && stripped.endsWith("}")) {
    candidates.push(stripped);
  }
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let fenceMatch;
  while ((fenceMatch = fenceRegex.exec(text)) !== null) {
    const inner = fenceMatch[1].trim();
    if (inner.startsWith("{") && inner.endsWith("}")) {
      candidates.push(inner);
    }
  }
  if (text.includes("\"tool_call\"")) {
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] !== "{") continue;
      let depth = 0;
      let inString = false;
      let escaped = false;
      for (let j = i; j < text.length; j += 1) {
        const ch = text[j];
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          if (inString) escaped = true;
          continue;
        }
        if (ch === "\"") {
          inString = !inString;
          continue;
        }
        if (inString) continue;
        if (ch === "{") depth += 1;
        else if (ch === "}") {
          depth -= 1;
          if (depth === 0) {
            const slice = text.slice(i, j + 1);
            if (slice.includes("\"tool_call\"")) {
              candidates.push(slice);
            }
            i = j;
            break;
          }
        }
      }
    }
  }
  return candidates;
}

export function parseApiToolCall(responseText) {
  const candidates = extractToolCallCandidates(responseText);
  for (const candidate of candidates) {
    let parsed;
    try { parsed = JSON.parse(candidate); } catch { continue; }
    const call = parsed?.tool_call;
    if (!call || typeof call !== "object" || Array.isArray(call)) continue;
    const name = String(call.name || "").trim();
    if (!["read_file", "search_files", "list_files", "recall_sessions", "memory_save", "propose_skill_patch", "delegate_subagent"].includes(name)) continue;
    const args = call.args && typeof call.args === "object" && !Array.isArray(call.args) ? call.args : {};
    return { name, args };
  }
  return null;
}

export async function executeApiWorkspaceTool(cwdOrTask, toolCallOrCwd, optionsOrToolCall = {}, maybeOptions = {}) {
  let task = null;
  let cwd = cwdOrTask;
  let toolCall = toolCallOrCwd;
  let options = optionsOrToolCall || {};
  if (cwdOrTask && typeof cwdOrTask === "object") {
    task = cwdOrTask;
    cwd = toolCallOrCwd;
    toolCall = optionsOrToolCall;
    options = maybeOptions || {};
  }
  const { gitFn = null, buildSnapshotHashes = null } = options;
  const { name, args = {} } = toolCall || {};
  if (name === "list_files") {
    const prefix = String(args.directory || args.path || "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    const allFiles = await listRemoteContextFiles(cwd, 200, gitFn);
    const filtered = prefix ? allFiles.filter((f) => f.toLowerCase().startsWith(prefix.toLowerCase())) : allFiles;
    return {
      ok: true,
      summary: `list_files(${prefix || "."}) -> ${filtered.length} files`,
      output: filtered.slice(0, 150).join("\n") || "No matching files found.",
    };
  }
  if (name === "read_file") {
    const rawPath = String(args.path || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
    if (!rawPath || !safeForRemoteContext(rawPath)) {
      return { ok: false, summary: `read_file(${rawPath || "?"}) blocked`, output: "Error: Path is protected or invalid." };
    }
    try {
      const resolved = await resolveInside(cwd, rawPath, true);
      if (!resolved?.target || !resolved.stat?.isFile() || !allowedTextFile(resolved.target)) {
        return { ok: false, summary: `read_file(${rawPath}) rejected`, output: "Error: Target is not a readable text file." };
      }
      if (resolved.stat.size > 250_000) {
        return { ok: false, summary: `read_file(${rawPath}) too large`, output: "Error: File exceeds 250 KB limit." };
      }
      const rawBytes = await fs.readFile(resolved.target);
      const original = rawBytes.toString("utf8");
      const redacted = redactRemoteSecrets(original);
      const lines = redacted.split(/\r?\n/);
      const startLine = Math.max(1, Number(args.startLine) || 1);
      const endLine = Math.min(lines.length, Math.max(startLine, Number(args.endLine) || (startLine + 249)));
      if (redacted === original && !original.includes("\uFFFD")) {
        const digest = createHash("sha256").update(rawBytes).digest("hex");
        const key = rawPath.toLocaleLowerCase();
        const isFullRead = startLine === 1 && endLine >= lines.length;
        const existingHash = buildSnapshotHashes instanceof Map
          ? buildSnapshotHashes.get(key)
          : (task?.buildSnapshotHashes?.[key]);
        const recordedHash = (isFullRead || existingHash === digest) ? digest : `partial:${digest}`;
        if (buildSnapshotHashes instanceof Map) buildSnapshotHashes.set(key, recordedHash);
        if (task && typeof task === "object") {
          task.buildSnapshotHashes ||= {};
          task.buildSnapshotHashes[key] = recordedHash;
        }
      }
      const sliced = lines
        .slice(startLine - 1, endLine)
        .map((line, idx) => `${startLine + idx}: ${line}`)
        .join("\n")
        .slice(0, 12_000);
      return {
        ok: true,
        summary: `read_file(${rawPath}:${startLine}-${endLine})`,
        output: `--- ${rawPath} (lines ${startLine}-${endLine} of ${lines.length}) ---\n${sliced}`,
      };
    } catch (err) {
      return { ok: false, summary: `read_file(${rawPath}) failed`, output: `Error reading file: ${err?.message || "not found"}` };
    }
  }
  if (name === "search_files") {
    const query = String(args.query || "").trim();
    if (!query || query.length < 2) {
      return { ok: false, summary: "search_files() invalid query", output: "Error: Provide a search query of at least 2 characters." };
    }
    const maxResults = Math.max(1, Math.min(30, Number(args.maxResults) || 20));
    const files = await listRemoteContextFiles(cwd, 180, gitFn);
    const needle = query.toLowerCase();
    const matches = [];
    for (const rel of files) {
      if (matches.length >= maxResults) break;
      if (!safeForRemoteContext(rel)) continue;
      try {
        const resolved = await resolveInside(cwd, rel, true).catch(() => null);
        if (!resolved?.target || !resolved.stat?.isFile() || resolved.stat.size > 150_000 || !allowedTextFile(resolved.target)) continue;
        const content = redactRemoteSecrets(await fs.readFile(resolved.target, "utf8"));
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          if (lines[i].toLowerCase().includes(needle)) {
            matches.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 180)}`);
            if (matches.length >= maxResults) break;
          }
        }
      } catch {}
    }
    return {
      ok: true,
      summary: `search_files("${query.slice(0, 40)}") -> ${matches.length} matches`,
      output: matches.length ? matches.join("\n") : `No matches found for "${query}".`,
    };
  }
  if (name === "recall_sessions") {
    const query = String(args.query || "").trim();
    if (!query) return { ok: false, summary: "recall_sessions() missing query", output: "Error: Provide a search query." };
    const results = typeof options.searchWorkbenchFn === "function"
      ? options.searchWorkbenchFn(query, { limit: 8 })
      : [];
    const formatted = Array.isArray(results) && results.length
      ? results.map((r, idx) => `${idx + 1}. [${r.scope || "task"}] ${r.title || r.id}: ${String(r.snippet || "").slice(0, 200)}`).join("\n")
      : `No historical sessions matched "${query}".`;
    return {
      ok: true,
      summary: `recall_sessions("${query.slice(0, 40)}") -> ${Array.isArray(results) ? results.length : 0} hits`,
      output: formatted,
    };
  }
  if (name === "memory_save") {
    const title = String(args.title || "Agent lesson").trim().slice(0, 120);
    const content = redactRemoteSecrets(String(args.content || "").trim().slice(0, 1200));
    if (!content) return { ok: false, summary: "memory_save() empty", output: "Error: Memory content is required." };
    if (task && typeof task === "object") {
      task.proposedMemories ||= [];
      task.proposedMemories.push({ title, content, kind: String(args.kind || "lesson"), createdAt: new Date().toISOString() });
    }
    return { ok: true, summary: `memory_save("${title}")`, output: `Saved lesson "${title}" to task memory buffer.` };
  }
  if (name === "propose_skill_patch") {
    const skillName = String(args.name || "custom-skill").trim().slice(0, 80);
    const description = String(args.description || "").trim().slice(0, 240);
    const instructions = redactRemoteSecrets(String(args.instructions || args.content || "").trim().slice(0, 4000));
    if (!instructions) return { ok: false, summary: "propose_skill_patch() empty", output: "Error: Skill instructions are required." };
    if (task && typeof task === "object") {
      task.proposedSkills ||= [];
      task.proposedSkills.push({ name: skillName, description, instructions, createdAt: new Date().toISOString() });
    }
    return { ok: true, summary: `propose_skill_patch("${skillName}")`, output: `Proposed skill patch "${skillName}" recorded for user review.` };
  }
  if (name === "delegate_subagent") {
    const role = String(args.role || "subagent").trim().slice(0, 80);
    const prompt = String(args.prompt || "").trim().slice(0, 2000);
    if (!prompt) return { ok: false, summary: "delegate_subagent() missing prompt", output: "Error: Subagent prompt is required." };
    if (task && typeof task === "object") {
      task.delegatedSubagents ||= [];
      task.delegatedSubagents.push({ role, prompt, createdAt: new Date().toISOString() });
    }
    return { ok: true, summary: `delegate_subagent("${role}")`, output: `Recorded subagent delegation "${role}" for execution.` };
  }
  return { ok: false, summary: `unknown tool ${name}`, output: "Error: Unsupported tool." };
}

export function parseApiBuildOperations(responseText) {
  const source = String(responseText || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("API implementation must return the requested JSON file operations; no files were applied.");
  let result;
  try { result = JSON.parse(source.slice(start, end + 1)); }
  catch { throw new Error("API implementation returned invalid JSON; no files were applied."); }
  const hasPatches = Array.isArray(result?.patches);
  if (!result || typeof result !== "object" || Array.isArray(result) || (!Array.isArray(result.files) && !hasPatches) || (!Array.isArray(result.deletePaths) && !hasPatches)) {
    throw new Error("API implementation JSON must include files and deletePaths arrays; no files were applied.");
  }
  const files = Array.isArray(result.files) ? result.files : [];
  const patches = hasPatches ? result.patches : [];
  const deletePaths = Array.isArray(result.deletePaths) ? result.deletePaths : [];
  if (files.length > 40 || patches.length > 40 || deletePaths.length > 40) throw new Error("API implementation returned too many file operations; limit is 40 files per task.");
  let total = 0;
  for (const item of files) {
    if (!item || typeof item.path !== "string" || typeof item.content !== "string") throw new Error("API implementation contains a malformed file operation; no files were applied.");
    if (item.content.includes("\0")) throw new Error("API implementation returned binary data; no files were applied.");
    total += Buffer.byteLength(item.content, "utf8");
    if (total > 1_000_000) throw new Error("API implementation exceeds the 1 MB total write limit; no files were applied.");
  }
  for (const patch of patches) {
    if (!patch || typeof patch.path !== "string" || !Array.isArray(patch.edits) || !patch.edits.length) {
      throw new Error("API implementation contains a malformed patch operation; no files were applied.");
    }
    for (const edit of patch.edits) {
      if (!edit || typeof edit.search !== "string" || !edit.search || typeof edit.replace !== "string") {
        throw new Error("API implementation patch edit must include non-empty search and replace strings; no files were applied.");
      }
      if (edit.search.includes("\0") || edit.replace.includes("\0")) throw new Error("API implementation returned binary data in patch; no files were applied.");
      total += Buffer.byteLength(edit.replace, "utf8");
      if (total > 1_000_000) throw new Error("API implementation exceeds the 1 MB total write limit; no files were applied.");
    }
  }
  return { summary: String(result.summary || "API implementation completed.").slice(0, 3000), files, patches, deletePaths };
}

export async function apiBuildTarget(rootPath, rawPath, buildSnapshotHashes, optionsOrIsPatch = false) {
  const isPatch = typeof optionsOrIsPatch === "boolean" ? optionsOrIsPatch : Boolean(optionsOrIsPatch?.isPatch);
  const normalized = rawPath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  const name = basename(normalized);
  const plainTextFile = allowedTextFile(name) || ["Dockerfile", "Makefile", "Justfile", "Procfile", "Gemfile", "Rakefile", "LICENSE", ".editorconfig", ".gitignore"].includes(name);
  const invalidSegment = (part) => !part || part === "." || part === ".." || part.includes(":") || /[. ]$/.test(part) || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(part);
  if (!normalized || normalized.length > 300 || normalized.includes("\0") || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || parts.some(invalidSegment) || !safeForRemoteContext(normalized) || !plainTextFile) {
    throw new Error(`API implementation requested a protected or invalid workspace path: ${rawPath}`);
  }
  const rootPathReal = await fs.realpath(rootPath);
  const target = resolve(rootPathReal, ...parts);
  const relativeTarget = relative(rootPathReal, target);
  if (!relativeTarget || relativeTarget === ".." || relativeTarget.startsWith(`..${sep}`) || isAbsolute(relativeTarget)) throw new Error(`API implementation path is outside the workspace: ${rawPath}`);
  let cursor = rootPathReal;
  for (const part of parts.slice(0, -1)) {
    cursor = resolve(cursor, part);
    try {
      const stat = await fs.lstat(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`API implementation cannot write through a symlink or non-folder path: ${rawPath}`);
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  try {
    const stat = await fs.lstat(target);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`API implementation target must be a regular file: ${rawPath}`);
    const rel = normalized.toLocaleLowerCase();
    const expectedHash = buildSnapshotHashes instanceof Map
      ? buildSnapshotHashes.get(rel)
      : (buildSnapshotHashes?.expectedFileHashes?.[rel] || buildSnapshotHashes?.[rel]);
    const isPartialHash = typeof expectedHash === "string" && expectedHash.startsWith("partial:");
    const cleanExpectedHash = isPartialHash ? expectedHash.slice("partial:".length) : expectedHash;
    const currentDigest = createHash("sha256").update(await fs.readFile(target)).digest("hex");
    if (!isPatch) {
      if (!expectedHash) throw new Error(`API implementation cannot replace a file whose full contents were not supplied as context: ${rawPath}`);
      if (isPartialHash && stat.size > 8_192) {
        throw new Error(`API implementation cannot replace a partially-read file larger than 8 KB without using patches: ${rawPath}`);
      }
      if (currentDigest !== cleanExpectedHash) throw new Error(`Workspace file changed while the API was working; refusing to overwrite it: ${rawPath}`);
    } else {
      if (cleanExpectedHash && currentDigest !== cleanExpectedHash) {
        throw new Error(`Workspace file changed while the API was working; refusing to patch it: ${rawPath}`);
      }
      if (buildSnapshotHashes instanceof Map) {
        buildSnapshotHashes.set(rel, currentDigest);
      } else if (buildSnapshotHashes && typeof buildSnapshotHashes === "object") {
        if (buildSnapshotHashes.expectedFileHashes && typeof buildSnapshotHashes.expectedFileHashes === "object") {
          buildSnapshotHashes.expectedFileHashes[rel] = currentDigest;
        } else {
          buildSnapshotHashes[rel] = currentDigest;
        }
      }
    }
  } catch (error) {
    if (error.code === "ENOENT" && isPatch && typeof optionsOrIsPatch === "object" && optionsOrIsPatch?.isPatch) {
      throw new Error(`API patch target does not exist: ${rawPath}`);
    }
    if (error.code !== "ENOENT") throw error;
  }
  return target;
}

export async function applyApiBuildResult(cwd, responseText, buildSnapshotHashes) {
  const operations = parseApiBuildOperations(responseText);
  const seen = new Set();
  const writes = [];
  const patches = [];
  const deletes = [];
  for (const item of operations.files) {
    const key = item.path.replace(/\\/g, "/").toLocaleLowerCase();
    if (seen.has(key)) throw new Error(`API implementation returned a duplicate path: ${item.path}`);
    seen.add(key);
    writes.push({ path: item.path, target: await apiBuildTarget(cwd, item.path, buildSnapshotHashes), content: item.content });
  }
  for (const patch of operations.patches || []) {
    const key = patch.path.replace(/\\/g, "/").toLocaleLowerCase();
    if (seen.has(key)) throw new Error(`API implementation returned a duplicate path: ${patch.path}`);
    seen.add(key);
    const target = await apiBuildTarget(cwd, patch.path, buildSnapshotHashes, { isPatch: true });
    let nextContent = await fs.readFile(target, "utf8");
    for (const edit of patch.edits) {
      let matchedSearch = edit.search;
      let matchedReplace = edit.replace;
      if (!nextContent.includes(matchedSearch) && nextContent.includes("\r\n")) {
        const crlfSearch = edit.search.replace(/\r?\n/g, "\r\n");
        if (nextContent.includes(crlfSearch)) {
          matchedSearch = crlfSearch;
          matchedReplace = edit.replace.replace(/\r?\n/g, "\r\n");
        }
      } else if (!nextContent.includes(matchedSearch) && edit.search.includes("\r\n")) {
        const lfSearch = edit.search.replace(/\r\n/g, "\n");
        if (nextContent.includes(lfSearch)) {
          matchedSearch = lfSearch;
          matchedReplace = edit.replace.replace(/\r\n/g, "\n");
        }
      }
      if (!nextContent.includes(matchedSearch)) {
        throw new Error(`API patch search block did not match existing file content in: ${patch.path}`);
      }
      if (nextContent.indexOf(matchedSearch) !== nextContent.lastIndexOf(matchedSearch)) {
        throw new Error(`API patch search block is ambiguous and matches multiple locations in: ${patch.path}`);
      }
      nextContent = nextContent.replace(matchedSearch, () => matchedReplace);
    }
    patches.push({ path: patch.path, target, content: nextContent });
  }
  for (const item of operations.deletePaths) {
    if (typeof item !== "string") throw new Error("API implementation contains an invalid delete path.");
    const key = item.replace(/\\/g, "/").toLocaleLowerCase();
    if (seen.has(key)) throw new Error(`API implementation returned a duplicate path: ${item}`);
    seen.add(key);
    deletes.push({ path: item, target: await apiBuildTarget(cwd, item, buildSnapshotHashes, true) });
  }
  const changed = [];
  for (const item of deletes) {
    try { await fs.rm(item.target); changed.push(`Deleted ${item.path}`); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  for (const item of writes) {
    await fs.mkdir(dirname(item.target), { recursive: true });
    await fs.writeFile(item.target, item.content, "utf8");
    changed.push(`Updated ${item.path}`);
  }
  for (const item of patches) {
    await fs.writeFile(item.target, item.content, "utf8");
    changed.push(`Patched ${item.path}`);
  }
  return `${operations.summary}${changed.length ? `\n\n${changed.join("\n")}` : "\n\nNo workspace files were changed."}`;
}
