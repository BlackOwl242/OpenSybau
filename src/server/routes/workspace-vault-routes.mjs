import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { basename, extname, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import {
  allowedTextFile,
  listLocalFiles,
  readLocalTextFile,
  resolveInside,
  resolveWorkspaceRelativePath,
  safeRelativePath,
  unquoteGitPath,
  writeLocalWorkspaceTextFile,
} from "../fs-security.mjs";
import {
  buildVaultKnowledgeGraph,
  deleteVaultMarkdownFile,
  openObsidianUri,
  writeVaultMarkdownFile,
} from "../vault-service.mjs";
import { parseUnifiedDiffFiles } from "../diff-parser.mjs";
import { injectOrcaInspectorHtml } from "../html-inspector-script.mjs";
import { listWorkspaceGithubIssues } from "../github-cli.mjs";
import { normalizeDirectoryInput } from "../cli-discovery.mjs";

const RAW_MIME_MAP = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".cjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

export async function handleWorkspaceVaultRoutes(request, response, pathname, ctx) {
  const {
    host,
    port,
    getState,
    persist,
    publish,
    schedulePublish,
    json,
    readBody,
    safeError,
    run,
    git,
    openFolder,
    isForbiddenSystemPath,
    cliDiscovery,
    skillCatalogService,
    promptService,
  } = ctx;

  const { inspectWorkspace } = cliDiscovery;
  const { listRemoteContextFiles } = promptService;
  const state = getState();

  const workspaceFileMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/(files|file|file-index|raw|file-diff|github|git-status|git-stage)(?:\/(.*))?$/);
  if (workspaceFileMatch) {
    const workspace = state.workspaces.find((item) => item.id === decodeURIComponent(workspaceFileMatch[1]));
    if (!workspace) { json(response, 404, { error: "Workspace không tồn tại." }); return true; }
    const params = new URL(request.url, `http://${host}:${port}`).searchParams;
    const taskId = params.get("taskId") || "";
    const taskForRoot = taskId ? state.tasks.find((t) => t.id === taskId && t.workspaceId === workspace.id) : null;
    const taskCandidateRoot = taskForRoot?.executionPath || taskForRoot?.worktreePath || "";
    const baseRoot = taskCandidateRoot && existsSync(taskCandidateRoot) ? taskCandidateRoot : workspace.path;
    const rawSubpath = workspaceFileMatch[3] ? decodeURIComponent(workspaceFileMatch[3]) : (params.get("path") || "");
    if (request.method === "GET" && workspaceFileMatch[2] === "files") {
      json(response, 200, await listLocalFiles(baseRoot, params.get("path") || ""));
      return true;
    }
    if (request.method === "GET" && workspaceFileMatch[2] === "file") {
      json(response, 200, await readLocalTextFile(baseRoot, params.get("path") || ""));
      return true;
    }
    if (request.method === "GET" && workspaceFileMatch[2] === "git-status") {
      try {
        const [statusRes, branchListRes, headRes, prefixRes] = await Promise.all([
          git(baseRoot, ["status", "--porcelain=v1", "-uall", "--", "."]).catch(() => ({ stdout: "" })),
          git(baseRoot, ["branch", "--format=%(refname:short)"]).catch(() => ({ stdout: "" })),
          git(baseRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => ({ stdout: "" })),
          git(baseRoot, ["rev-parse", "--show-prefix"]).catch(() => ({ stdout: "" })),
        ]);
        const repoPrefix = unquoteGitPath(String(prefixRes.stdout || "").trim())
          .replaceAll("\\", "/")
          .replace(/^\/+|\/+$/g, "");
        const currentBranch = String(headRes.stdout || "").trim() || "main";
        const branches = [...new Set(
          String(branchListRes.stdout || "")
            .split(/\r?\n/)
            .map((b) => b.trim())
            .filter(Boolean),
        )];
        if (currentBranch && !branches.includes(currentBranch)) branches.unshift(currentBranch);
        const changedFiles = [];
        const rawLines = String(statusRes.stdout || "").split(/\r?\n/);
        for (const rawLine of rawLines) {
          if (!rawLine || rawLine.length < 4) continue;
          const indexStatus = rawLine[0] || " ";
          const workTreeStatus = rawLine[1] || " ";
          let filePath = rawLine.slice(3).trim();
          if (filePath.includes(" -> ")) {
            filePath = filePath.split(" -> ").at(-1).trim();
          }
          filePath = unquoteGitPath(filePath).replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
          if (repoPrefix) {
            const prefixSlash = `${repoPrefix}/`;
            if (filePath.toLowerCase().startsWith(prefixSlash.toLowerCase())) {
              filePath = filePath.slice(prefixSlash.length).replace(/^\/+/, "");
            } else {
              continue;
            }
          }
          if (!filePath) continue;
          try {
            filePath = resolveWorkspaceRelativePath(baseRoot, filePath).split(sep).join("/");
          } catch {}
          if (!filePath) continue;
          const staged = indexStatus !== " " && indexStatus !== "?";
          const unstaged = workTreeStatus !== " ";
          let statusKind = "modified";
          let badge = "M↓";
          if (indexStatus === "?" || indexStatus === "A") {
            statusKind = "added";
            badge = indexStatus === "?" ? "M↓" : "A";
          } else if (workTreeStatus === "D" || indexStatus === "D") {
            statusKind = "deleted";
            badge = "D";
          }
          changedFiles.push({
            path: filePath,
            indexStatus,
            workTreeStatus,
            staged,
            unstaged,
            badge,
            statusKind,
          });
        }
        json(response, 200, { currentBranch, branches, changedFiles });
      } catch (error) {
        json(response, 200, { currentBranch: "main", branches: ["main"], changedFiles: [], error: safeError(error) });
      }
      return true;
    }
    if (request.method === "POST" && workspaceFileMatch[2] === "git-stage") {
      try {
        const body = await readBody(request);
        const stageAction = String(body.action || "stage").trim();
        const bodyTaskId = String(body.taskId || taskId || "").trim();
        const targetTask = bodyTaskId ? state.tasks.find((t) => t.id === bodyTaskId && t.workspaceId === workspace.id) : null;
        const targetRoot = (targetTask?.executionPath || targetTask?.worktreePath) && existsSync(targetTask.executionPath || targetTask.worktreePath)
          ? (targetTask.executionPath || targetTask.worktreePath)
          : baseRoot;
        if (stageAction === "stage-all") {
          await git(targetRoot, ["add", "-A", "--", "."]);
        } else if (stageAction === "unstage-all") {
          await git(targetRoot, ["restore", "--staged", "."]).catch(() => git(targetRoot, ["reset", "HEAD", "--", "."]));
        } else {
          const relPath = resolveWorkspaceRelativePath(targetRoot, body.path || "").split(sep).join("/");
          if (!relPath) { json(response, 400, { error: "Thiếu đường dẫn tệp." }); return true; }
          if (stageAction === "unstage") {
            await git(targetRoot, ["restore", "--staged", "--", relPath]).catch(() => git(targetRoot, ["reset", "HEAD", "--", relPath]));
          } else {
            await git(targetRoot, ["add", "--", relPath]);
          }
        }
        json(response, 200, { ok: true });
      } catch (error) {
        json(response, 400, { error: safeError(error) });
      }
      return true;
    }
    if (request.method === "PUT" && workspaceFileMatch[2] === "file") {
      const body = await readBody(request);
      const bodyTaskId = String(body.taskId || taskId || "").trim();
      const targetTask = bodyTaskId ? state.tasks.find((t) => t.id === bodyTaskId && t.workspaceId === workspace.id) : null;
      const targetRoot = (targetTask?.executionPath || targetTask?.worktreePath) && existsSync(targetTask.executionPath || targetTask.worktreePath)
        ? (targetTask.executionPath || targetTask.worktreePath)
        : baseRoot;
      try {
        const saved = await writeLocalWorkspaceTextFile(targetRoot, body.path || params.get("path") || "", body.content);
        if (targetTask) {
          targetTask.artifacts = [...new Set([...(targetTask.artifacts || []), saved.path])];
          targetTask.updatedAt = new Date().toISOString();
          persist();
        }
        schedulePublish("task", 120);
        json(response, 200, saved);
      } catch (error) {
        json(response, 400, { error: safeError(error) });
      }
      return true;
    }
    if (request.method === "GET" && workspaceFileMatch[2] === "github") {
      try {
        const ghData = await listWorkspaceGithubIssues(baseRoot, run);
        json(response, 200, ghData);
      } catch (error) {
        json(response, 400, { error: safeError(error) });
      }
      return true;
    }
    if (request.method === "GET" && workspaceFileMatch[2] === "file-index") {
      json(response, 200, { files: await listRemoteContextFiles(baseRoot, 600) });
      return true;
    }
    if (request.method === "GET" && workspaceFileMatch[2] === "raw") {
      try {
        const { target, stat } = await resolveInside(baseRoot, rawSubpath, true);
        const fileName = basename(target);
        if (/^\.env(?:\.|$)/i.test(fileName) && !/^\.env\.example$/i.test(fileName)) {
          json(response, 403, { error: "Từ chối truy cập tệp môi trường .env." });
          return true;
        }
        if (stat.size > 50_000_000) { json(response, 413, { error: "Tệp quá lớn để xem trực tiếp." }); return true; }
        const ext = extname(target).toLowerCase();
        const mime = RAW_MIME_MAP[ext] || "text/plain; charset=utf-8";
        const buf = await fs.readFile(target);
        if (ext === ".html" || ext === ".htm") {
          const outBuf = injectOrcaInspectorHtml(buf);
          response.writeHead(200, {
            "Content-Type": mime,
            "Content-Length": outBuf.byteLength,
            "Content-Disposition": "inline",
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "sandbox allow-scripts allow-forms allow-modals allow-popups; default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https: http:;",
          });
          response.end(outBuf);
          return true;
        }
        const rawCsp = (ext === ".svg" || ext === ".xml")
          ? { "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data: blob: 'self'" }
          : {};
        response.writeHead(200, {
          "Content-Type": mime,
          "Content-Length": buf.byteLength,
          "Content-Disposition": "inline",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
          ...rawCsp,
        });
        response.end(buf);
      } catch (error) {
        json(response, 400, { error: safeError(error) });
      }
      return true;
    }
    if (request.method === "GET" && workspaceFileMatch[2] === "file-diff") {
      try {
        if (params.get("all") === "1") {
          const baseParam = String(params.get("base") || "head").trim();
          let diffArgs = ["diff", "--relative", "--no-ext-diff", "--no-color", "HEAD"];
          if (baseParam === "unstaged") {
            diffArgs = ["diff", "--relative", "--no-ext-diff", "--no-color"];
          } else if (baseParam.startsWith("branch:")) {
            const branchRef = baseParam.slice("branch:".length).trim();
            if (/^[\w./-]+$/.test(branchRef) && !branchRef.includes("..") && !branchRef.startsWith("-")) {
              diffArgs = ["diff", "--relative", "--no-ext-diff", "--no-color", branchRef];
            }
          } else if (taskForRoot?.isolated && taskForRoot?.worktreeBaseHead) {
            diffArgs = ["diff", "--relative", "--no-ext-diff", "--no-color", taskForRoot.worktreeBaseHead];
          }
          const res = await git(baseRoot, diffArgs).catch(() => ({ stdout: "" }));
          let diff = res.stdout || "";
          const untracked = await git(baseRoot, ["ls-files", "--others", "--exclude-standard"]).catch(() => ({ stdout: "" }));
          for (const rawUFile of String(untracked.stdout || "").split(/\r?\n/).map((s) => unquoteGitPath(s.trim())).filter(Boolean).slice(0, 25)) {
            const uFile = resolveWorkspaceRelativePath(baseRoot, rawUFile).split(sep).join("/");
            if (!allowedTextFile(uFile)) continue;
            const candidate = resolve(baseRoot, uFile);
            const lstat = await fs.lstat(candidate).catch(() => null);
            if (lstat && lstat.isFile() && !lstat.isSymbolicLink() && lstat.size <= 200_000) {
              const content = await fs.readFile(candidate, "utf8").catch(() => "");
              const lines = content.split(/\r?\n/);
              diff += `\ndiff --git a/${uFile} b/${uFile}\n--- /dev/null\n+++ b/${uFile}\n@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;
            }
          }
          json(response, 200, { path: "", base: baseParam, diff, files: parseUnifiedDiffFiles(diff) });
          return true;
        }
        const relPath = resolveWorkspaceRelativePath(baseRoot, params.get("path") || "").split(sep).join("/");
        if (!relPath) { json(response, 400, { error: "Thiếu đường dẫn tệp." }); return true; }
        if (!allowedTextFile(relPath)) { json(response, 403, { error: "Không được phép đọc tệp nhạy cảm này." }); return true; }
        const requestedBase = String(params.get("base") || "unstaged").trim();
        let effectiveBase = requestedBase;
        let baseRef = "";
        if (requestedBase === "head") {
          baseRef = "HEAD";
        } else if (requestedBase.startsWith("branch:")) {
          const cand = requestedBase.slice("branch:".length).trim();
          if (/^[\w./-]+$/.test(cand) && !cand.includes("..") && !cand.startsWith("-")) {
            baseRef = cand;
          } else {
            effectiveBase = "unstaged";
          }
        }
        const diffArgs = baseRef
          ? ["diff", "--relative", "--no-ext-diff", "--no-color", baseRef, "--", relPath]
          : ["diff", "--relative", "--no-ext-diff", "--no-color", "--", relPath];
        let res = await git(baseRoot, diffArgs);
        let diff = res.stdout || "";
        if (!diff.trim() && !baseRef) {
          const fallbackRef = (taskForRoot?.isolated && taskForRoot?.worktreeBaseHead) ? taskForRoot.worktreeBaseHead : "HEAD";
          const headRes = await git(baseRoot, ["diff", "--relative", "--no-ext-diff", "--no-color", fallbackRef, "--", relPath]).catch(() => ({ stdout: "" }));
          if ((headRes.stdout || "").trim()) {
            diff = headRes.stdout;
            baseRef = fallbackRef;
          }
        }
        let newContent = "";
        const candidate = resolve(baseRoot, relPath);
        const lstat = await fs.lstat(candidate).catch(() => null);
        if (lstat && lstat.isFile() && !lstat.isSymbolicLink() && lstat.size <= 400_000) {
          const { target, stat } = await resolveInside(baseRoot, relPath, true);
          if (stat.isFile() && stat.size <= 400_000 && allowedTextFile(target)) {
            newContent = await fs.readFile(target, "utf8");
          }
        }
        if (!diff.trim() && newContent) {
          const untracked = await git(baseRoot, ["ls-files", "--others", "--exclude-standard", "--", relPath]);
          if ((untracked.stdout || "").trim()) {
            const lines = newContent.split(/\r?\n/);
            diff = `diff --git a/${relPath} b/${relPath}\n--- /dev/null\n+++ b/${relPath}\n@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => `+${l}`).join("\n") + "\n";
          }
        }
        let oldContent = "";
        const showSpecRel = baseRef ? `${baseRef}:./${relPath}` : `:./${relPath}`;
        let showRes = await git(baseRoot, ["show", showSpecRel]).catch(() => ({ code: 1, stdout: "" }));
        if (showRes.code !== 0) {
          const showSpecRoot = baseRef ? `${baseRef}:${relPath}` : `:${relPath}`;
          showRes = await git(baseRoot, ["show", showSpecRoot]).catch(() => ({ code: 1, stdout: "" }));
        }
        if (showRes.code === 0 && typeof showRes.stdout === "string") {
          oldContent = showRes.stdout;
        }
        json(response, 200, {
          path: relPath,
          base: effectiveBase,
          oldContent,
          newContent,
          diff,
          files: parseUnifiedDiffFiles(diff),
        });
      } catch (error) {
        json(response, 400, { error: safeError(error) });
      }
      return true;
    }
  }

  if (request.method === "GET" && pathname === "/api/vault/files") {
    if (!state.settings.vaultPath) { json(response, 404, { error: "Chưa kết nối Obsidian vault." }); return true; }
    const params = new URL(request.url, `http://${host}:${port}`).searchParams;
    json(response, 200, await listLocalFiles(state.settings.vaultPath, params.get("path") || "", true));
    return true;
  }

  if (request.method === "GET" && pathname === "/api/vault/file") {
    if (!state.settings.vaultPath) { json(response, 404, { error: "Chưa kết nối Obsidian vault." }); return true; }
    const params = new URL(request.url, `http://${host}:${port}`).searchParams;
    json(response, 200, await readLocalTextFile(state.settings.vaultPath, params.get("path") || "", true));
    return true;
  }

  if ((request.method === "POST" || request.method === "PUT") && pathname === "/api/vault/file") {
    if (!state.settings.vaultPath) { json(response, 404, { error: "Chưa kết nối Obsidian vault." }); return true; }
    const body = await readBody(request);
    const file = await writeVaultMarkdownFile(state.settings.vaultPath, body.path || "", String(body.content ?? ""), { createOnly: Boolean(body.createOnly) });
    publish("vault");
    json(response, 200, file);
    return true;
  }

  if (request.method === "DELETE" && pathname === "/api/vault/file") {
    if (!state.settings.vaultPath) { json(response, 404, { error: "Chưa kết nối Obsidian vault." }); return true; }
    const params = new URL(request.url, `http://${host}:${port}`).searchParams;
    const body = params.get("path") ? { path: params.get("path") } : await readBody(request).catch(() => ({}));
    const deleted = await deleteVaultMarkdownFile(state.settings.vaultPath, body.path || "");
    publish("vault");
    json(response, 200, deleted);
    return true;
  }

  if (request.method === "POST" && pathname === "/api/vault/open-obsidian") {
    if (!state.settings.vaultPath) { json(response, 404, { error: "Chưa kết nối Obsidian vault." }); return true; }
    const body = await readBody(request).catch(() => ({}));
    try {
      const opened = await openObsidianUri(state.settings.vaultPath, body.path || "");
      json(response, 200, opened);
    } catch (error) {
      json(response, 400, { error: safeError(error) });
    }
    return true;
  }

  if (request.method === "GET" && pathname === "/api/vault/graph") {
    if (!state.settings.vaultPath) { json(response, 404, { error: "Chưa kết nối Obsidian vault." }); return true; }
    json(response, 200, await buildVaultKnowledgeGraph(state.settings.vaultPath));
    return true;
  }

  if (request.method === "POST" && pathname === "/api/workspaces") {
    const body = await readBody(request);
    const requestedPath = normalizeDirectoryInput(body.path);
    if (typeof body.path !== "string" || !requestedPath) { json(response, 400, { error: "Nhập đường dẫn thư mục dự án." }); return true; }
    if (isForbiddenSystemPath(requestedPath)) { json(response, 400, { error: "Không được đăng ký thư mục gốc ổ đĩa hoặc thư mục hệ thống nhạy cảm làm workspace." }); return true; }
    const info = await inspectWorkspace(requestedPath);
    if (isForbiddenSystemPath(info.path)) { json(response, 400, { error: "Không được đăng ký thư mục gốc ổ đĩa hoặc thư mục hệ thống nhạy cảm làm workspace." }); return true; }
    const existing = state.workspaces.find((w) => w.path.toLowerCase() === info.path.toLowerCase());
    if (existing) { json(response, 200, { workspace: existing }); return true; }
    const workspace = {
      id: randomUUID(),
      name: basename(info.path) || info.path,
      path: info.path,
      sourceFolders: [info.path],
      pinned: false,
      trustedSkills: body.trustedSkills !== undefined ? Boolean(body.trustedSkills) : true,
      section: "Projects",
      addedAt: new Date().toISOString(),
      runtime: info,
    };
    state.workspaces.push(workspace); persist(); publish("workspace");
    json(response, 201, { workspace });
    return true;
  }

  const workspaceRoute = pathname.match(/^\/api\/workspaces\/([^/]+)(?:\/(open|archive-chats|trust-skills))?$/);
  if (workspaceRoute && request.method !== "DELETE") {
    const id = decodeURIComponent(workspaceRoute[1]);
    const action = workspaceRoute[2] || "";
    const workspace = state.workspaces.find((item) => item.id === id);
    if (!workspace) { json(response, 404, { error: "Dự án không tồn tại." }); return true; }
    if (request.method === "PATCH" && !action) {
      const body = await readBody(request);
      if (body.name !== undefined) {
        const name = String(body.name || "").trim();
        if (!name || name.length > 100) { json(response, 400, { error: "Tên dự án cần từ 1 đến 100 ký tự." }); return true; }
        workspace.name = name;
      }
      if (body.section !== undefined) {
        const section = String(body.section || "Projects").trim() || "Projects";
        if (section.length > 60) { json(response, 400, { error: "Tên section tối đa 60 ký tự." }); return true; }
        workspace.section = section;
      }
      if (body.pinned !== undefined) workspace.pinned = Boolean(body.pinned);
      if (body.trustedSkills !== undefined) {
        workspace.trustedSkills = Boolean(body.trustedSkills);
        skillCatalogService?.invalidateSkillCatalogCache();
      }
      if (body.sourceFolders !== undefined) {
        if (!Array.isArray(body.sourceFolders)) { json(response, 400, { error: "Danh sách thư mục nguồn không hợp lệ." }); return true; }
        const folders = [];
        for (const rawPath of body.sourceFolders) {
          const requested = normalizeDirectoryInput(rawPath);
          if (!requested) continue;
          if (isForbiddenSystemPath(requested)) { json(response, 400, { error: `Không được phép gắn thư mục gốc hoặc thư mục hệ thống nhạy cảm: “${requested}”.` }); return true; }
          let realPath;
          try { realPath = await fs.realpath(requested); }
          catch (error) {
            if (error.code === "ENOENT" || error.code === "ENOTDIR") throw new Error(`Không tìm thấy thư mục nguồn “${requested}”. Hãy kiểm tra đường dẫn.`);
            throw error;
          }
          if (!(await fs.stat(realPath)).isDirectory()) throw new Error(`Đường dẫn nguồn không phải thư mục: “${requested}”.`);
          if (isForbiddenSystemPath(realPath)) { json(response, 400, { error: `Không được phép gắn thư mục gốc hoặc thư mục hệ thống nhạy cảm: “${requested}”.` }); return true; }
          folders.push(realPath);
        }
        const uniqueFolders = new Map([[workspace.path.toLowerCase(), workspace.path]]);
        for (const folder of folders) if (!uniqueFolders.has(folder.toLowerCase())) uniqueFolders.set(folder.toLowerCase(), folder);
        workspace.sourceFolders = [...uniqueFolders.values()];
      }
      persist(); publish("workspace");
      json(response, 200, { workspace });
      return true;
    }
    if (request.method === "POST" && action === "open") {
      if (!existsSync(workspace.path)) { json(response, 404, { error: "Không tìm thấy thư mục dự án để mở." }); return true; }
      await openFolder(workspace.path);
      json(response, 200, { ok: true });
      return true;
    }
    if (request.method === "POST" && action === "archive-chats") {
      const affected = state.tasks.filter((task) => task.workspaceId === id && !task.archived);
      for (const task of affected) task.archived = true;
      persist(); publish("tasks");
      json(response, 200, { archived: affected.length });
      return true;
    }
    if (request.method === "POST" && action === "trust-skills") {
      const body = await readBody(request).catch(() => ({}));
      workspace.trustedSkills = body.trusted !== undefined ? Boolean(body.trusted) : true;
      skillCatalogService?.invalidateSkillCatalogCache();
      persist();
      publish("workspace");
      publish("skills");
      json(response, 200, { ok: true, workspace });
      return true;
    }
  }

  if (request.method === "DELETE" && pathname.startsWith("/api/workspaces/")) {
    const id = decodeURIComponent(pathname.slice("/api/workspaces/".length));
    if (state.tasks.some((t) => t.workspaceId === id && ["queued", "running"].includes(t.status))) { json(response, 409, { error: "Không thể xóa workspace đang có task hoạt động." }); return true; }
    for (const task of state.tasks) if (task.workspaceId === id) task.archived = true;
    state.workspaces = state.workspaces.filter((w) => w.id !== id);
    persist(); publish("workspace");
    json(response, 200, { ok: true });
    return true;
  }

  return false;
}
