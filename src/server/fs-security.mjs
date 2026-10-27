import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, extname, isAbsolute, parse, relative, resolve, sep } from "node:path";
import { inflateRawSync } from "node:zlib";

export const ignoredFileDirectories = new Set([
  ".git", ".obsidian", ".trash", "node_modules", ".runtime", "dist", "build",
  "release", "out", "target", "coverage", ".next", "vendor", "__pycache__",
  ".venv", "venv", ".cache", ".turbo", ".parcel-cache", ".gradle",
]);

export const textExtensions = new Set([
  ".md", ".mdx", ".markdown", ".txt", ".log", ".json", ".jsonc", ".yaml", ".yml",
  ".toml", ".xml", ".html", ".htm", ".css", ".scss", ".less", ".js", ".mjs", ".cjs",
  ".ts", ".tsx", ".jsx", ".vue", ".svelte", ".astro", ".py", ".go", ".rs", ".java",
  ".kt", ".c", ".h", ".cpp", ".hpp", ".cs", ".php", ".rb", ".swift", ".sql", ".sh",
  ".ps1", ".bat", ".cmd", ".env.example", ".diff", ".patch", ".csv", ".tsv", ".ini",
  ".conf", ".cfg", ".svg", ".prisma", ".graphql", ".gql",
]);

export const previewableBinaryExtensions = new Set([
  ".pdf", ".docx", ".doc", ".png", ".jpg", ".jpeg", ".gif", ".webp",
  ".ico", ".bmp", ".mp4", ".webm", ".mp3", ".wav",
]);

export function within(rootPath, candidate) {
  const a = process.platform === "win32" ? resolve(String(rootPath || "")).toLowerCase() : resolve(String(rootPath || ""));
  const b = process.platform === "win32" ? resolve(String(candidate || "")).toLowerCase() : resolve(String(candidate || ""));
  const rel = relative(a, b);
  return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function workspaceLockKey(rawPath) {
  const value = String(rawPath || "").trim();
  if (!value) return "";
  const resolved = resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function usesSharedCheckout(task) {
  return !task?.isolated
    || Boolean(task.worktreeCleaned)
    || (task.status !== "queued" && !task.worktreePath)
    || (Boolean(task.executionPath) && workspaceLockKey(task.executionPath) === workspaceLockKey(task.workspacePath));
}

export function isTaskEffectivelyIsolated(task) {
  return !usesSharedCheckout(task);
}

export function isForbiddenSystemPath(targetPath, runtimeDir = "") {
  if (!targetPath) return true;
  const resolved = resolve(String(targetPath));
  const norm = process.platform === "win32" ? resolved.toLowerCase() : resolved;
  const parsedRoot = process.platform === "win32" ? parse(resolved).root.toLowerCase() : parse(resolved).root;
  if (norm === parsedRoot || norm.replace(/[\\/]+$/, "") === parsedRoot.replace(/[\\/]+$/, "")) return true;
  const home = resolve(homedir());
  const homeNorm = process.platform === "win32" ? home.toLowerCase() : home;
  if (norm === homeNorm) return true;
  for (const sensitive of [".ssh", ".gnupg", ".aws", ".kube"]) {
    if (within(resolve(home, sensitive), resolved)) return true;
  }
  if (process.platform === "win32") {
    const sysRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
    if (within(sysRoot, resolved)) return true;
  } else {
    for (const sysDir of ["/etc", "/proc", "/sys", "/dev", "/boot", "/root"]) {
      if (within(sysDir, resolved)) return true;
    }
  }
  if (runtimeDir && process.env.WORKBENCH_ALLOW_TEMP_DATA_WORKSPACE !== "1" && within(runtimeDir, resolved)) {
    return true;
  }
  return false;
}

export function unquoteGitPath(raw = "") {
  let str = String(raw || "").trim();
  if (str.startsWith('"') && str.endsWith('"') && str.length >= 2) {
    str = str.slice(1, -1);
  }
  // Recover octal UTF-8 sequences that had backslashes converted into forward slashes (e.g. /341/273/207 -> \341\273\207)
  str = str.replace(/(?:\/[0-3][0-7]{2}){2,}/g, (match) => match.replaceAll("/", "\\"));
  if (str.includes("\\")) {
    str = str.replace(/(?:\\[0-3][0-7]{2})+/g, (match) => {
      const bytes = match
        .slice(1)
        .split("\\")
        .map((oct) => parseInt(oct, 8));
      return Buffer.from(bytes).toString("utf8");
    });
    str = str
      .replace(/\\"/g, '"')
      .replace(/\\t/g, "\t")
      .replace(/\\n/g, "\n");
  }
  return str;
}

export function safeRelativePath(value = "") {
  const input = unquoteGitPath(String(value).trim());
  if (isAbsolute(input) || /^[a-z]:/i.test(input) || /^(?:\\\\|\/)/.test(input)) throw new Error("Đường dẫn tệp không hợp lệ.");
  const segments = input.split(/[\\/]+/).filter((part) => part && part !== ".");
  if (segments.some((part) => part === ".." || part.includes(":"))) throw new Error("Đường dẫn tệp không hợp lệ.");
  return segments.join(sep);
}

export function resolveWorkspaceRelativePath(rootPath, relativePath = "") {
  let relativeValue = safeRelativePath(relativePath);
  if (!relativeValue || !rootPath) return relativeValue;
  const candidate = resolve(rootPath, relativeValue);
  if (!existsSync(candidate)) {
    const rootParts = resolve(rootPath).split(/[\\/]+/).filter(Boolean);
    const relParts = relativeValue.split(/[\\/]+/).filter(Boolean);
    for (let maxOverlap = Math.min(rootParts.length, relParts.length - 1); maxOverlap >= 1; maxOverlap--) {
      const rootTail = rootParts.slice(-maxOverlap).join("/").toLowerCase();
      const relHead = relParts.slice(0, maxOverlap).join("/").toLowerCase();
      if (rootTail === relHead) {
        const stripped = relParts.slice(maxOverlap).join(sep);
        if (stripped && existsSync(resolve(rootPath, stripped))) {
          return stripped;
        }
      }
    }
  }
  return relativeValue;
}

export async function resolveInside(rootPath, relativePath, mustBeFile = false) {
  const realRoot = await fs.realpath(rootPath);
  const relativeValue = resolveWorkspaceRelativePath(realRoot, relativePath);
  const candidate = resolve(realRoot, relativeValue || ".");
  if (!within(realRoot, candidate)) throw new Error("Đường dẫn nằm ngoài thư mục được kết nối.");
  const realTarget = await fs.realpath(candidate);
  if (!within(realRoot, realTarget)) throw new Error("Không cho phép đi theo liên kết ra ngoài thư mục được kết nối.");
  const stat = await fs.stat(realTarget);
  if (mustBeFile && !stat.isFile()) throw new Error("Đường dẫn này không phải tệp.");
  if (!mustBeFile && !stat.isDirectory()) throw new Error("Đường dẫn này không phải thư mục.");
  return { root: realRoot, target: realTarget, stat, relativePath: relativeValue };
}

export function decodeXmlEntities(str = "") {
  return String(str)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec) || 32))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16) || 32));
}

export function extractZipEntryText(buf, targetEntry = "word/document.xml") {
  let offset = 0;
  while (offset + 30 <= buf.length) {
    if (buf.readUInt32LE(offset) !== 0x04034b50) {
      offset += 1;
      continue;
    }
    const method = buf.readUInt16LE(offset + 8);
    const compSize = buf.readUInt32LE(offset + 18);
    const nameLen = buf.readUInt16LE(offset + 26);
    const extraLen = buf.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const entryName = buf.subarray(nameStart, nameStart + nameLen).toString("utf8");
    if (entryName === targetEntry && compSize > 0 && dataStart + compSize <= buf.length) {
      const slice = buf.subarray(dataStart, dataStart + compSize);
      const raw = method === 8 ? inflateRawSync(slice) : method === 0 ? slice : null;
      return raw ? raw.toString("utf8") : "";
    }
    offset = dataStart + Math.max(1, compSize);
  }
  return "";
}

export function extractOfficeDocumentText(buf, ext) {
  if (ext === ".docx") {
    try {
      const xml = extractZipEntryText(buf, "word/document.xml");
      if (xml) {
        const paragraphs = [];
        for (const pMatch of xml.matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)) {
          const pBody = pMatch[1] || "";
          const runs = [];
          for (const tMatch of pBody.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:br\b[^>]*\/>/g)) {
            if (tMatch[0].startsWith("<w:tab")) runs.push("\t");
            else if (tMatch[0].startsWith("<w:br")) runs.push("\n");
            else runs.push(decodeXmlEntities(tMatch[1] || ""));
          }
          const line = runs.join("").trim();
          if (line) paragraphs.push(line);
        }
        if (paragraphs.length) return paragraphs.join("\n\n");
      }
    } catch {}
  }
  const utf16Chunks = [];
  let current = "";
  for (let i = 0; i + 1 < buf.length; i += 2) {
    const code = buf.readUInt16LE(i);
    if (code === 0x000d || code === 0x000a || code === 0x0009 || (code >= 0x0020 && code <= 0x024f) || (code >= 0x1e00 && code <= 0x1eff) || (code >= 0x2000 && code <= 0x206f)) {
      current += code === 0x000d ? "\n" : String.fromCharCode(code);
    } else {
      if (current.trim().length >= 24) utf16Chunks.push(current.trim());
      current = "";
    }
  }
  if (current.trim().length >= 24) utf16Chunks.push(current.trim());
  if (utf16Chunks.join("\n").length > 80) return utf16Chunks.join("\n\n");

  const utf8Str = buf.toString("utf8");
  const utf8Matches = utf8Str.match(/[\p{L}\p{N}\p{P}\p{Zs}\r\n\t]{24,}/gu) || [];
  return utf8Matches.map((s) => s.trim()).filter(Boolean).join("\n\n") || "Không tìm thấy nội dung văn bản thuần trong tệp tài liệu này.";
}

export function allowedTextFile(name) {
  const base = basename(String(name || ""));
  if (/^\.env(?:\.|$)/i.test(base) && !/^\.env\.example$/i.test(base)) return false;
  const ext = extname(base).toLowerCase();
  return textExtensions.has(ext) || previewableBinaryExtensions.has(ext) || /^\.env\.example$/i.test(base);
}

export function isEditableWorkspaceTextFile(name) {
  const base = basename(String(name || ""));
  if (/^\.env(?:\.|$)/i.test(base) && !/^\.env\.example$/i.test(base)) return false;
  const ext = extname(base).toLowerCase();
  if (previewableBinaryExtensions.has(ext)) return false;
  return textExtensions.has(ext) || /^\.env\.example$/i.test(base);
}

export async function listLocalFiles(rootPath, relativePath = "", markdownOnly = false) {
  const resolvedPath = await resolveInside(rootPath, relativePath, false);
  const entries = await fs.readdir(resolvedPath.target, { withFileTypes: true });
  const candidates = entries.filter((entry) => {
    if (entry.isSymbolicLink() || (entry.isDirectory() && ignoredFileDirectories.has(entry.name.toLowerCase()))) return false;
    const isDirectory = entry.isDirectory();
    if (!isDirectory && (!entry.isFile() || (markdownOnly ? !/\.(md|mdx|markdown)$/i.test(entry.name) : !allowedTextFile(entry.name)))) return false;
    return true;
  });
  const stats = await Promise.all(candidates.map(async (entry) => {
    const isDirectory = entry.isDirectory();
    const absolute = resolve(resolvedPath.target, entry.name);
    try {
      const stat = await fs.stat(absolute);
      const rel = relative(resolvedPath.root, absolute).split(sep).join("/");
      return { name: entry.name, path: rel, type: isDirectory ? "directory" : "file", size: isDirectory ? null : stat.size, modifiedAt: stat.mtime.toISOString() };
    } catch { return null; }
  }));
  const visible = stats.filter(Boolean);
  visible.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name, "vi") : a.type === "directory" ? -1 : 1);
  return { path: safeRelativePath(relativePath).split(sep).join("/"), entries: visible.slice(0, 500), truncated: visible.length > 500 };
}

export async function readLocalTextFile(rootPath, relativePath, markdownOnly = false) {
  const { target, stat, relativePath: resolvedRel } = await resolveInside(rootPath, relativePath, true);
  const ext = extname(target).toLowerCase();
  const relClean = (resolvedRel || safeRelativePath(relativePath)).split(sep).join("/");
  if (!markdownOnly && (ext === ".docx" || ext === ".doc")) {
    if (stat.size > 25_000_000) throw new Error("Tệp tài liệu lớn hơn 25 MB; hãy mở bằng Word trên máy.");
    const buf = await fs.readFile(target);
    const content = extractOfficeDocumentText(buf, ext);
    return { path: relClean, name: basename(target), content, kind: "text", size: stat.size, modifiedAt: stat.mtime.toISOString(), extension: ext };
  }
  if (!markdownOnly && previewableBinaryExtensions.has(ext)) {
    if (stat.size > 50_000_000) throw new Error("Tệp lớn hơn 50 MB; hãy mở bằng ứng dụng trên máy.");
    const kind = ext === ".pdf" ? "pdf" : /\.(png|jpe?g|gif|webp|ico|bmp)$/i.test(ext) ? "image" : "media";
    return { path: relClean, name: basename(target), content: "", kind, size: stat.size, modifiedAt: stat.mtime.toISOString(), extension: ext };
  }
  if (stat.size > 8_000_000) throw new Error("Tệp lớn hơn 8 MB; hãy mở bằng editor trên máy.");
  if (!allowedTextFile(basename(target)) || (markdownOnly && !/\.(md|mdx|markdown)$/i.test(target))) throw new Error("OpenSybau chỉ xem tệp văn bản và Markdown được hỗ trợ.");
  const content = await fs.readFile(target, "utf8");
  return { path: relClean, name: basename(target), content, kind: "text", size: stat.size, modifiedAt: stat.mtime.toISOString(), extension: ext };
}

export async function writeLocalWorkspaceTextFile(rootPath, relativePath, content) {
  if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > 2_000_000) {
    throw new Error("Nội dung tệp tối đa 2 MB.");
  }
  const relClean = safeRelativePath(relativePath).split(sep).join("/");
  if (!relClean) throw new Error("Đường dẫn tệp không hợp lệ.");
  const parts = relClean.split("/").filter(Boolean);
  for (const part of parts) {
    if (ignoredFileDirectories.has(part.toLowerCase())) {
      throw new Error("Không được phép chỉnh sửa tệp trong thư mục hệ thống hoặc thư viện phụ thuộc.");
    }
  }
  const fileName = basename(relClean);
  if (!isEditableWorkspaceTextFile(fileName)) {
    throw new Error("Chỉ hỗ trợ chỉnh sửa các tệp mã nguồn và văn bản được cho phép.");
  }
  const { root, target } = await resolveInside(rootPath, relativePath, true);
  const lstat = await fs.lstat(target);
  if (lstat.isSymbolicLink() || !lstat.isFile()) {
    throw new Error("Không được phép ghi đè liên kết tượng trưng hoặc thư mục.");
  }
  await fs.writeFile(target, content, "utf8");
  return readLocalTextFile(root, relClean, false);
}

export function safeForRemoteContext(path) {
  const normalized = String(path || "").replace(/\\/g, "/");
  return normalized && !/[\0\r\n]/.test(normalized) && !/(^|\/)(?:\.git|\.runtime|\.ssh|\.aws|node_modules|dist|build|release|out|target|coverage|\.next|\.venv|venv|\.cache|\.turbo)(\/|$)/i.test(normalized)
    && !/(^|\/)(?:\.env(?:\..*)?|\.npmrc|\.netrc|\.pypirc|\.git-credentials|[^/]*(?:secret|credential|token|private[-_.]?key)[^/]*|id_rsa|id_ed25519)(?:$|\/)/i.test(normalized)
    && !/\.(?:pem|p12|pfx|key|sqlite|db)$/i.test(normalized);
}

export function redactRemoteSecrets(value) {
  return String(value || "")
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, "[redacted private key]")
    .replace(/\b(?:sk-ant-[A-Za-z0-9_-]{12,}|sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,})\b/g, "[redacted secret]")
    .replace(/((?:api[_-]?key|access[_-]?token|client[_-]?secret|password|passwd)\s*[:=]\s*)(["']?)[^\s"'`,;]+/gi, "$1[redacted secret]")
    .replace(/(\bBearer\s+)[A-Za-z0-9._~+/-]{16,}/gi, "$1[redacted token]");
}

export async function listRemoteContextFiles(cwd, maxFiles = 180, gitFn = null) {
  if (typeof gitFn === "function") {
    const result = await gitFn(cwd, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
    if (result.code === 0) {
      const paths = [...new Set(result.stdout.split("\0").map((path) => unquoteGitPath(path.trim())).filter(safeForRemoteContext))];
      if (paths.length) return paths.slice(0, maxFiles);
    }
  }
  const paths = [];
  const ignored = new Set([".git", ".runtime", "node_modules", "dist", "build", "release", "out", "target", "coverage", ".next", ".venv", "venv", ".cache", ".turbo"]);
  async function walk(directory, relativeDir = "", depth = 0) {
    if (depth > 9 || paths.length >= maxFiles) return;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (paths.length >= maxFiles) return;
      if (entry.isSymbolicLink() || entry.name === "." || entry.name === "..") continue;
      const path = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (!safeForRemoteContext(path)) continue;
      if (entry.isDirectory()) {
        if (!ignored.has(entry.name.toLowerCase())) await walk(resolve(directory, entry.name), path, depth + 1);
      } else if (entry.isFile()) paths.push(path);
    }
  }
  await walk(cwd);
  return paths;
}
