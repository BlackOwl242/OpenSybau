import { spawn } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import {
  ignoredFileDirectories,
  readLocalTextFile,
  resolveInside,
  safeRelativePath,
  within,
} from "./fs-security.mjs";

export function normalizeVaultNoteRelativePath(relativePath) {
  let clean = safeRelativePath(relativePath).split(sep).join("/").replace(/^\/+|\/+$/g, "");
  if (!clean) throw new Error("Nhập tên tệp ghi chú Markdown.");
  if (!/\.(md|mdx|markdown)$/i.test(clean)) clean = `${clean}.md`;
  const parts = clean.split("/").filter(Boolean);
  for (const part of parts) {
    if (part === "." || part === ".." || /[<>:"|?*\u0000]/.test(part)) throw new Error("Tên tệp ghi chú chứa ký tự không hợp lệ.");
    if (ignoredFileDirectories.has(part.toLowerCase())) throw new Error("Không được ghi vào thư mục hệ thống của vault.");
  }
  return parts.join("/");
}

export async function writeVaultMarkdownFile(rootPath, relativePath, content, { createOnly = false } = {}) {
  if (typeof content !== "string" || Buffer.byteLength(content, "utf8") > 1_000_000) {
    throw new Error("Nội dung ghi chú tối đa 1 MB.");
  }
  const rel = normalizeVaultNoteRelativePath(relativePath);
  const realRoot = await fs.realpath(resolve(rootPath));
  const target = resolve(realRoot, rel);
  if (!within(realRoot, target) || target === realRoot) throw new Error("Đường dẫn tệp nằm ngoài Obsidian vault.");
  const parentDir = dirname(target);
  await fs.mkdir(parentDir, { recursive: true });
  const realParent = await fs.realpath(parentDir);
  if (!within(realRoot, realParent)) throw new Error("Thư mục đích không hợp lệ.");
  if (createOnly && existsSync(target)) throw new Error(`Ghi chú “${rel}” đã tồn tại.`);
  if (existsSync(target)) {
    const existingStat = await fs.lstat(target);
    if (existingStat.isSymbolicLink() || existingStat.isDirectory()) throw new Error("Không thể ghi đè thư mục hoặc symlink.");
  }
  await fs.writeFile(target, content, "utf8");
  return readLocalTextFile(realRoot, rel, true);
}

export async function deleteVaultMarkdownFile(rootPath, relativePath) {
  const rel = normalizeVaultNoteRelativePath(relativePath);
  const { target, stat } = await resolveInside(rootPath, rel, true);
  if (!stat.isFile() || !/\.(md|mdx|markdown)$/i.test(target)) throw new Error("Chỉ hỗ trợ xóa tệp ghi chú Markdown trong vault.");
  await fs.unlink(target);
  return { ok: true, path: rel };
}

export async function openObsidianUri(vaultPath, relativePath = "") {
  const cleanRel = String(relativePath || "").trim();
  const realVault = await fs.realpath(resolve(vaultPath));
  const fullPath = cleanRel ? (await resolveInside(realVault, cleanRel, true)).target : realVault;
  const uri = `obsidian://open?path=${encodeURIComponent(fullPath)}`;
  const [command, args] = process.platform === "win32"
    ? ["explorer.exe", [uri]]
    : process.platform === "darwin"
      ? ["open", [uri]]
      : ["xdg-open", [uri]];
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.once("spawn", () => { child.unref(); resolvePromise({ ok: true, uri }); });
    child.once("error", rejectPromise);
  });
}

export async function buildVaultKnowledgeGraph(rootPath) {
  const realRoot = await fs.realpath(resolve(rootPath));
  const noteFiles = [];
  async function walk(dir) {
    if (noteFiles.length >= 400) return;
    let entries = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (noteFiles.length >= 400) break;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (ignoredFileDirectories.has(entry.name.toLowerCase())) continue;
        await walk(resolve(dir, entry.name));
      } else if (entry.isFile() && /\.(md|mdx|markdown)$/i.test(entry.name)) {
        const abs = resolve(dir, entry.name);
        try {
          const stat = await fs.stat(abs);
          if (stat.size <= 512_000) {
            const rel = relative(realRoot, abs).split(sep).join("/");
            noteFiles.push({ abs, path: rel, name: entry.name, size: stat.size, modifiedAt: stat.mtime.toISOString() });
          }
        } catch {}
      }
    }
  }
  await walk(realRoot);
  const nodes = [];
  const byStem = new Map();
  const byPath = new Map();
  const rawLinks = new Map();
  const tagMap = new Map();
  const folderMap = new Map();
  for (const file of noteFiles) {
    let content = "";
    try { content = await fs.readFile(file.abs, "utf8"); } catch {}
    const stem = file.name.replace(/\.(md|mdx|markdown)$/i, "");
    const folder = file.path.includes("/") ? file.path.slice(0, file.path.lastIndexOf("/")) : "";
    const headingMatch = content.match(/^#\s+(.+)$/m);
    const title = (headingMatch ? headingMatch[1].trim() : stem) || stem;
    const links = new Set();
    const wikiRegex = /\[\[([^\]|#\r\n]+)(?:#[^\]|\r\n]*)?(?:\|[^\]\r\n]*)?\]\]/g;
    let match;
    while ((match = wikiRegex.exec(content)) !== null) {
      const target = match[1].trim().replace(/\\/g, "/");
      if (target) links.add(target);
    }
    const mdLinkRegex = /\[[^\]]+\]\((?!https?:\/\/|obsidian:\/\/|mailto:|#)([^)#?\s]+)\)/g;
    while ((match = mdLinkRegex.exec(content)) !== null) {
      const target = decodeURIComponent(match[1].trim()).replace(/\\/g, "/").replace(/^\.\//, "");
      if (target) links.add(target);
    }
    const tags = new Set();
    const stripped = content.replace(/```[\s\S]*?```/g, "");
    const tagRegex = /(?:^|\s)#([a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF/-]{2,40})/g;
    while ((match = tagRegex.exec(stripped)) !== null) {
      tags.add(match[1].toLowerCase());
    }
    const fmMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    if (fmMatch) {
      const tagsLine = fmMatch[1].match(/^tags:\s*\[([^\]]*)\]/m);
      if (tagsLine) {
        tagsLine[1].split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "").toLowerCase()).filter(Boolean).forEach((t) => tags.add(t));
      }
    }
    const excerpt = stripped.replace(/^---[\s\S]*?---/, "").replace(/^[#>*\-\d.]+\s*/gm, "").trim().slice(0, 180);
    const node = { id: file.path, path: file.path, name: file.name, stem, title, folder, size: file.size, modifiedAt: file.modifiedAt, tags: [...tags], excerpt, degree: 0 };
    nodes.push(node);
    byPath.set(file.path.toLowerCase(), node);
    byPath.set(file.path.replace(/\.(md|mdx|markdown)$/i, "").toLowerCase(), node);
    if (!byStem.has(stem.toLowerCase())) byStem.set(stem.toLowerCase(), node);
    rawLinks.set(node.id, [...links]);
    for (const tag of tags) {
      if (!tagMap.has(tag)) tagMap.set(tag, []);
      tagMap.get(tag).push(node.id);
    }
    if (!folderMap.has(folder)) folderMap.set(folder, []);
    folderMap.get(folder).push(node.id);
  }
  const edges = [];
  const edgeKeys = new Set();
  const addEdge = (source, target, kind, label = "") => {
    if (!source || !target || source === target) return;
    const [a, b] = source < target ? [source, target] : [target, source];
    const key = `${a}::${b}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    edges.push({ source, target, kind, label });
  };
  for (const node of nodes) {
    const targets = rawLinks.get(node.id) || [];
    for (const raw of targets) {
      const key = raw.toLowerCase().replace(/\.(md|mdx|markdown)$/i, "");
      const targetNode = byPath.get(raw.toLowerCase()) || byPath.get(key) || byStem.get(key.split("/").at(-1));
      if (targetNode) addEdge(node.id, targetNode.id, "link", "[[link]]");
    }
  }
  for (const [tag, ids] of tagMap.entries()) {
    if (ids.length < 2 || ids.length > 25) continue;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        addEdge(ids[i], ids[j], "tag", `#${tag}`);
      }
    }
  }
  for (const [folder, ids] of folderMap.entries()) {
    if (ids.length < 2 || ids.length > 18) continue;
    for (let i = 0; i < ids.length - 1; i += 1) {
      addEdge(ids[i], ids[i + 1], "folder", folder || "root");
    }
  }
  const degreeMap = new Map(nodes.map((n) => [n.id, 0]));
  for (const edge of edges) {
    degreeMap.set(edge.source, (degreeMap.get(edge.source) || 0) + (edge.kind === "link" ? 2 : 1));
    degreeMap.set(edge.target, (degreeMap.get(edge.target) || 0) + (edge.kind === "link" ? 2 : 1));
  }
  for (const node of nodes) node.degree = degreeMap.get(node.id) || 0;
  return { nodes, edges };
}
