import { createHash } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, resolve, sep } from "node:path";
import { within } from "./fs-security.mjs";
import { frontmatterValue, slugSkill } from "./skill-catalog.mjs";
import { normalizeSubagentPolicy } from "./subagent-tracker.mjs";

const SUBAGENT_CACHE_TTL_MS = 60_000;
const READ_ONLY_CLAUDE_TOOLS = ["Read", "Grep", "Glob", "LS"];

export function subagentProfileId(filePath, extra = "") {
  return createHash("sha256")
    .update(`${String(filePath || "").toLowerCase()}::${String(extra || "").toLowerCase()}`)
    .digest("hex")
    .slice(0, 16);
}

export function frontmatterList(frontmatter = "", key = "") {
  const lines = String(frontmatter || "").split(/\r?\n/);
  const idx = lines.findIndex((line) => new RegExp(`^${key}:\\s*`, "i").test(line));
  if (idx < 0) return [];
  const inline = lines[idx].slice(lines[idx].indexOf(":") + 1).trim();
  if (inline.startsWith("[") && inline.endsWith("]")) {
    return inline
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  if (inline) {
    return inline
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  const items = [];
  for (const nextLine of lines.slice(idx + 1)) {
    const trimmed = nextLine.trim();
    if (!trimmed) continue;
    if (/^\s*-\s+/.test(nextLine)) {
      items.push(trimmed.replace(/^-\s+/, "").replace(/^["']|["']$/g, "").trim());
    } else if (!/^\s/.test(nextLine)) {
      break;
    }
  }
  return items.filter(Boolean);
}

export function validateSubagentContent(content) {
  if (typeof content !== "string" || !content.trim() || content.length > 100_000) {
    throw new Error("Nội dung hồ sơ subagent phải từ 1 đến 100.000 ký tự.");
  }
  const match = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    throw new Error("Hồ sơ subagent cần YAML frontmatter (--- ... ---) ở đầu tệp.");
  }
  const fm = match[1];
  const name = frontmatterValue(fm, "name");
  const description = frontmatterValue(fm, "description");
  if (!name) throw new Error("Hồ sơ subagent cần trường name: trong YAML frontmatter.");
  if (!description) throw new Error("Hồ sơ subagent cần trường description: trong YAML frontmatter để điều phối viên biết khi nào gọi.");
  return content.endsWith("\n") ? content : `${content}\n`;
}

export function stripTomlCommentOutsideQuotes(line = "") {
  const str = String(line || "");
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\" && inDouble) {
      escaped = true;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === "#" && !inSingle && !inDouble) {
      return str.slice(0, i);
    }
  }
  return str;
}

export function parseCodexAgentsToml(rawToml = "") {
  const text = String(rawToml || "");
  if (!text.trim()) return [];
  const results = [];
  const lines = text.split(/\r?\n/);
  let currentAgent = null;

  for (const rawLine of lines) {
    const line = stripTomlCommentOutsideQuotes(rawLine).trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      const section = sectionMatch[1].trim();
      const agentMatch = section.match(/^agents\.([A-Za-z0-9_-]+)$/);
      if (agentMatch) {
        currentAgent = {
          name: agentMatch[1],
          description: "",
          model: "inherit",
          configFile: "",
        };
        results.push(currentAgent);
      } else {
        currentAgent = null;
      }
      continue;
    }
    if (!currentAgent) continue;
    const kv = line.match(/^([A-Za-z0-9_]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1];
    const val = kv[2].trim().replace(/^["']|["']$/g, "");
    if (key === "description") currentAgent.description = val;
    else if (key === "model") currentAgent.model = val;
    else if (key === "config_file") currentAgent.configFile = val;
  }

  return results.filter((item) => item.name);
}

const DISCOVERED_AUTO_SCOPES = new Set([
  "global",
  "workspace",
  "claude-personal",
  "agy-personal",
  "agy-cli-personal",
  "workspace-claude",
  "workspace-gemini",
  "codex-toml",
  "workspace-codex-toml",
]);

export function selectTaskSubagents(catalog = [], options = {}) {
  const provider = String(options.provider || "").trim();
  const policy = normalizeSubagentPolicy(options.policy || options.task?.subagentPolicy);
  if (policy.mode === "disabled") return [];
  const trustedCompatible = (Array.isArray(catalog) ? catalog : []).filter(
    (item) =>
      item &&
      item.trusted !== false &&
      (item.format === "markdown" || item.format === "codex-toml") &&
      (!provider || (Array.isArray(item.harnesses) && item.harnesses.includes(provider)))
  );
  let selectedProfiles = [];
  if (policy.profileIds.length > 0) {
    const wanted = new Set(policy.profileIds);
    selectedProfiles = trustedCompatible.filter((item) => wanted.has(item.id));
  } else {
    selectedProfiles = trustedCompatible.filter(
      (item) => !item.scopeId || DISCOVERED_AUTO_SCOPES.has(item.scopeId)
    );
  }
  return selectedProfiles.slice(0, 12);
}

export function buildClaudeAgentsCliJson(selectedProfiles = [], { clampReadOnly = false, readOnly = false } = {}) {
  const effectiveClamp = Boolean(clampReadOnly || readOnly);
  const agentsObj = {};
  for (const prof of Array.isArray(selectedProfiles) ? selectedProfiles : []) {
    if (!prof?.name) continue;
    const isProfileReadOnly = Boolean(effectiveClamp || prof.readOnly);
    const basePrompt = String(prof.prompt || prof.description || "").slice(0, 15_500);
    const readOnlyNote = isProfileReadOnly
      ? `\n\n[Read-Only Constraint]: This subagent is strictly read-only. Only use read/search/inspection tools (${READ_ONLY_CLAUDE_TOOLS.join(", ")}); never edit, write, or delete files or execute mutating commands.`
      : "";
    const entry = {
      description: String(prof.description || `Specialized ${prof.name} subagent`).slice(0, 600),
      prompt: `${basePrompt}${readOnlyNote}`.trim().slice(0, 16_000),
    };
    if (prof.model && prof.model !== "inherit") {
      entry.model = prof.model;
    }
    if (isProfileReadOnly) {
      entry.tools = [...READ_ONLY_CLAUDE_TOOLS];
      entry.disallowedTools = ["Write", "Edit", "MultiEdit", "Bash", "NotebookEdit"];
    } else if (prof.tools?.length) {
      entry.tools = prof.tools;
    }
    if (!isProfileReadOnly && prof.disallowedTools?.length) {
      entry.disallowedTools = prof.disallowedTools;
    }
    agentsObj[prof.name] = entry;
  }
  return JSON.stringify(agentsObj);
}

export function buildSubagentPromptInstructions(selectedProfiles = [], { provider = "", policy = null, clampReadOnly = false, readOnly = false } = {}) {
  const normalizedPolicy = normalizeSubagentPolicy(policy);
  const effectiveReadOnly = Boolean(clampReadOnly || readOnly);
  const profiles = Array.isArray(selectedProfiles) ? selectedProfiles : [];
  const promptLines = [];
  if (profiles.length > 0 && (!provider || provider === "codex" || provider === "antigravity" || provider === "claude")) {
    promptLines.push("Available specialized subagent roles for delegation when parallel exploration or isolated review helps:");
    for (const prof of profiles) {
      const profReadOnly = Boolean(prof.readOnly || effectiveReadOnly);
      promptLines.push(`- ${prof.name} (${profReadOnly ? "read-only" : "standard"}): ${prof.description}`);
    }
  }
  if (effectiveReadOnly) {
    promptLines.push(
      `Safety constraint (read-only tool clamping): Any spawned subagents MUST stay strictly read-only (allowed read/inspection tools only: ${READ_ONLY_CLAUDE_TOOLS.join(", ")}, view_file, grep_search, find_by_name; no file writes, edits, patches, or mutating shell commands). Perform file edits sequentially in the primary coordinator only.`
    );
  } else if (profiles.some((p) => p?.readOnly)) {
    promptLines.push(
      `Read-only tool clamping: Subagent profiles marked (read-only) are restricted to read/search/inspection tools (${READ_ONLY_CLAUDE_TOOLS.join(", ")}) and MUST NOT modify files or execute mutating commands.`
    );
  }
  return promptLines.length
    ? `\n\n<subagent_policy mode="${normalizedPolicy.mode}" shared_checkout_readonly="${effectiveReadOnly}">\n${promptLines.join("\n")}\n</subagent_policy>`
    : "";
}

export function createSubagentCatalogService({
  runtime,
  getWorkspaces,
}) {
  const catalogCache = new Map();

  function invalidateSubagentCatalogCache() {
    catalogCache.clear();
  }

  function buildMarkdownRoots(workspace = null) {
    const claudeHome = resolve(homedir(), ".claude");
    const geminiHome = resolve(homedir(), ".gemini");
    const roots = [
      {
        scopeId: "global",
        path: resolve(runtime, "subagents"),
        source: "OpenSybau · mọi CLI",
        harnesses: ["claude", "codex", "antigravity"],
        managed: true,
        workspaceScoped: false,
        trusted: true,
      },
      {
        scopeId: "claude-personal",
        path: resolve(claudeHome, "agents"),
        source: "Claude Code · cá nhân",
        harnesses: ["claude"],
        managed: true,
        workspaceScoped: false,
        trusted: true,
      },
      {
        scopeId: "agy-personal",
        path: resolve(geminiHome, "config", "agents"),
        source: "Antigravity · cá nhân",
        harnesses: ["antigravity"],
        managed: true,
        workspaceScoped: false,
        trusted: true,
      },
      {
        scopeId: "agy-cli-personal",
        path: resolve(geminiHome, "antigravity-cli", "agents"),
        source: "Antigravity CLI · cá nhân",
        harnesses: ["antigravity"],
        managed: true,
        workspaceScoped: false,
        trusted: true,
      },
    ];
    if (workspace?.path) {
      const wsTrusted = workspace.trustedSkills !== false;
      roots.push(
        {
          scopeId: "workspace",
          path: resolve(workspace.path, ".agents", "agents"),
          source: `Workspace · ${workspace.name}`,
          harnesses: ["claude", "codex", "antigravity"],
          managed: true,
          workspaceScoped: true,
          workspaceId: workspace.id,
          trusted: wsTrusted,
        },
        {
          scopeId: "workspace-claude",
          path: resolve(workspace.path, ".claude", "agents"),
          source: `Workspace · ${workspace.name} (Claude Code)`,
          harnesses: ["claude"],
          managed: true,
          workspaceScoped: true,
          workspaceId: workspace.id,
          trusted: wsTrusted,
        },
        {
          scopeId: "workspace-gemini",
          path: resolve(workspace.path, ".gemini", "agents"),
          source: `Workspace · ${workspace.name} (Antigravity)`,
          harnesses: ["antigravity"],
          managed: true,
          workspaceScoped: true,
          workspaceId: workspace.id,
          trusted: wsTrusted,
        }
      );
    }
    return roots;
  }

  async function loadSubagentCatalog(workspaceId = "", force = false) {
    const workspaces = getWorkspaces() || [];
    const workspace = workspaces.find((item) => item.id === workspaceId) || null;
    const trustFlag = workspace ? (workspace.trustedSkills !== false ? "trusted" : "untrusted") : "global";
    const cacheKey = workspace ? `${resolve(workspace.path).toLowerCase()}::${trustFlag}` : "__global__";
    const cached = catalogCache.get(cacheKey);
    if (!force && cached && Date.now() < cached.expiresAt) return cached.items;

    const items = [];
    const seenIds = new Set();
    const mdRoots = buildMarkdownRoots(workspace);

    for (const rootInfo of mdRoots) {
      let realRoot;
      try {
        realRoot = await fs.realpath(rootInfo.path);
      } catch {
        continue;
      }
      let entries;
      try {
        entries = await fs.readdir(realRoot, { withFileTypes: true });
      } catch {
        continue;
      }

      const candidateFiles = [];
      for (const entry of entries) {
        if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
          candidateFiles.push(resolve(realRoot, entry.name));
        } else if (entry.isDirectory() && !entry.name.startsWith(".")) {
          const nested = resolve(realRoot, entry.name, "AGENT.md");
          if (existsSync(nested)) candidateFiles.push(nested);
        }
      }

      for (const candidate of candidateFiles.slice(0, 200)) {
        try {
          const realFile = await fs.realpath(candidate);
          if (!within(realRoot, realFile) || realFile === realRoot) continue;
          const st = await fs.stat(realFile);
          if (!st.isFile() || st.size > 100_000) continue;
          const content = await fs.readFile(realFile, "utf8");
          const fmMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
          const fm = fmMatch?.[1] || "";
          const promptBody = fmMatch ? content.slice(fmMatch[0].length).trim() : content.trim();
          const fallbackSlug = slugSkill(basename(realFile, extname(realFile)));
          const name = slugSkill(frontmatterValue(fm, "name") || fallbackSlug);
          const description = frontmatterValue(fm, "description") || promptBody.split(/\r?\n/)[0]?.slice(0, 200) || "Subagent tùy chỉnh";
          const model = frontmatterValue(fm, "model") || "inherit";
          const tools = frontmatterList(fm, "tools");
          const disallowedTools = [
            ...frontmatterList(fm, "disallowedTools"),
            ...frontmatterList(fm, "disallowed-tools"),
          ];
          const declaredHarnesses = frontmatterList(fm, "harnesses")
            .map((h) => h.toLowerCase())
            .filter((h) => ["claude", "codex", "antigravity"].includes(h));
          const harnesses = declaredHarnesses.length ? declaredHarnesses : [...rootInfo.harnesses];
          const readOnlyAttr = frontmatterValue(fm, "readonly") || frontmatterValue(fm, "readOnly");
          const readOnly = /^(?:true|1|yes)$/i.test(readOnlyAttr)
            || (tools.length > 0 && tools.every((t) => /^(?:read|grep|glob|ls|view_file|find_by_name|grep_search|search_files|list_files)$/i.test(t)));

          const id = subagentProfileId(realFile);
          if (seenIds.has(id)) continue;
          seenIds.add(id);

          items.push({
            id,
            name,
            title: frontmatterValue(fm, "title") || name,
            description,
            model,
            tools,
            disallowedTools,
            readOnly,
            harnesses,
            scopeId: rootInfo.scopeId,
            source: rootInfo.source,
            filePath: realFile,
            managed: Boolean(rootInfo.managed),
            workspaceScoped: Boolean(rootInfo.workspaceScoped),
            workspaceId: rootInfo.workspaceId || "",
            trusted: Boolean(rootInfo.trusted),
            format: "markdown",
            prompt: promptBody,
            rawContent: content,
          });
        } catch {}
      }
    }

    const codexHome = resolve(process.env.CODEX_HOME || resolve(homedir(), ".codex"));
    const tomlSources = [
      {
        file: resolve(codexHome, "config.toml"),
        source: "Codex · config.toml cá nhân",
        workspaceScoped: false,
        workspaceId: "",
        trusted: true,
      },
      ...(workspace?.path
        ? [{
            file: resolve(workspace.path, ".codex", "config.toml"),
            source: `Workspace · ${workspace.name} (.codex/config.toml)`,
            workspaceScoped: true,
            workspaceId: workspace.id,
            trusted: workspace.trustedSkills !== false,
          }]
        : []),
    ];

    for (const tomlSrc of tomlSources) {
      try {
        if (!existsSync(tomlSrc.file)) continue;
        const realToml = await fs.realpath(tomlSrc.file);
        const st = await fs.stat(realToml);
        if (!st.isFile() || st.size > 250_000) continue;
        const rawToml = await fs.readFile(realToml, "utf8");
        const parsedAgents = parseCodexAgentsToml(rawToml);
        for (const ag of parsedAgents) {
          const id = subagentProfileId(realToml, ag.name);
          if (seenIds.has(id)) continue;
          seenIds.add(id);
          items.push({
            id,
            name: slugSkill(ag.name),
            title: ag.name,
            description: ag.description || `Vai trò Codex [agents.${ag.name}]`,
            model: ag.model || "inherit",
            tools: [],
            disallowedTools: [],
            readOnly: false,
            harnesses: ["codex"],
            scopeId: tomlSrc.workspaceScoped ? "workspace-codex-toml" : "codex-toml",
            source: tomlSrc.source,
            filePath: realToml,
            managed: false,
            workspaceScoped: tomlSrc.workspaceScoped,
            workspaceId: tomlSrc.workspaceId,
            trusted: tomlSrc.trusted,
            format: "codex-toml",
            prompt: ag.configFile ? `Tệp cấu hình vai trò Codex: ${ag.configFile}` : "",
            rawContent: `[agents.${ag.name}]\ndescription = ${JSON.stringify(ag.description || "")}${ag.model && ag.model !== "inherit" ? `\nmodel = ${JSON.stringify(ag.model)}` : ""}${ag.configFile ? `\nconfig_file = ${JSON.stringify(ag.configFile)}` : ""}\n`,
          });
        }
      } catch {}
    }

    items.sort((a, b) => a.name.localeCompare(b.name));
    catalogCache.set(cacheKey, { items, expiresAt: Date.now() + SUBAGENT_CACHE_TTL_MS });
    return items;
  }

  function resolveWritableScopeRoot(scopeId = "global", workspaceId = "") {
    const workspaces = getWorkspaces() || [];
    const workspace = workspaces.find((w) => w.id === workspaceId) || null;
    if (scopeId === "workspace" || scopeId === "workspace-claude" || scopeId === "workspace-gemini") {
      if (!workspace?.path) throw new Error("Hãy chọn dự án (workspace) hợp lệ để lưu hồ sơ subagent cấp dự án.");
      if (scopeId === "workspace-claude") return resolve(workspace.path, ".claude", "agents");
      if (scopeId === "workspace-gemini") return resolve(workspace.path, ".gemini", "agents");
      return resolve(workspace.path, ".agents", "agents");
    }
    if (scopeId === "claude-personal") {
      return resolve(homedir(), ".claude", "agents");
    }
    if (scopeId === "agy-personal") {
      return resolve(homedir(), ".gemini", "config", "agents");
    }
    return resolve(runtime, "subagents");
  }

  async function saveSubagentProfile({ id = "", scopeId = "global", workspaceId = "", content = "", workspaces: optionWorkspaces = null }) {
    const normalizedContent = validateSubagentContent(content);
    const fmMatch = normalizedContent.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
    const fm = fmMatch?.[1] || "";
    const slug = slugSkill(frontmatterValue(fm, "name"));

    let targetFile = "";
    let effectiveWorkspaceId = workspaceId;
    if (id) {
      const existingList = await loadSubagentCatalog(workspaceId, true);
      let existing = existingList.find((item) => item.id === id);
      if (!existing && !workspaceId) {
        const workspaces = Array.isArray(optionWorkspaces) ? optionWorkspaces : (getWorkspaces?.() || []);
        for (const ws of workspaces) {
          if (!ws?.id) continue;
          const wsList = await loadSubagentCatalog(ws.id, true);
          existing = wsList.find((item) => item.id === id);
          if (existing) {
            effectiveWorkspaceId = ws.id;
            break;
          }
        }
      }
      if (!existing) throw new Error("Không tìm thấy hồ sơ subagent cần cập nhật.");
      if (!existing.managed || existing.format !== "markdown") {
        throw new Error("Hồ sơ này thuộc cấu hình ngoài (chỉ đọc); hãy chỉnh sửa trực tiếp tệp gốc hoặc tạo hồ sơ mới.");
      }
      targetFile = existing.filePath;
    } else {
      const rootDir = resolveWritableScopeRoot(scopeId, workspaceId);
      await fs.mkdir(rootDir, { recursive: true });
      const realRoot = await fs.realpath(rootDir);
      const candidate = resolve(realRoot, `${slug}.md`);
      if (!within(realRoot, candidate) || candidate === realRoot) {
        throw new Error("Đường dẫn tệp hồ sơ subagent không hợp lệ.");
      }
      if (existsSync(candidate)) {
        throw new Error(`Hồ sơ "${slug}.md" đã tồn tại trong phạm vi đã chọn.`);
      }
      targetFile = candidate;
    }

    const tmpFile = `${targetFile}.tmp`;
    await fs.writeFile(tmpFile, normalizedContent, { encoding: "utf8", mode: 0o600 });
    try {
      await fs.rename(tmpFile, targetFile);
    } catch {
      await fs.writeFile(targetFile, normalizedContent, { encoding: "utf8", mode: 0o600 });
      await fs.rm(tmpFile, { force: true }).catch(() => {});
    }

    invalidateSubagentCatalogCache();
    const refreshed = await loadSubagentCatalog(effectiveWorkspaceId, true);
    const realSaved = await fs.realpath(targetFile).catch(() => targetFile);
    const savedId = subagentProfileId(realSaved);
    return refreshed.find((item) => item.id === savedId) || refreshed.find((item) => item.name === slug) || null;
  }

  async function deleteSubagentProfile(options = {}) {
    const { id, workspaceId = "", workspaces: optionWorkspaces = null } = options;
    const workspaces = Array.isArray(optionWorkspaces) ? optionWorkspaces : (getWorkspaces?.() || []);
    const list = await loadSubagentCatalog(workspaceId, true);
    let target = list.find((item) => item.id === id);
    if (!target && !workspaceId) {
      for (const ws of workspaces) {
        if (!ws?.id) continue;
        const wsList = await loadSubagentCatalog(ws.id, true);
        target = wsList.find((item) => item.id === id);
        if (target) break;
      }
    }
    if (!target) throw new Error("Không tìm thấy hồ sơ subagent để xóa.");
    if (!target.managed || target.format !== "markdown") {
      throw new Error("Chỉ có thể xóa các hồ sơ Markdown do người dùng tạo.");
    }
    const workspace = workspaces.find((w) => w.id === (target.workspaceId || workspaceId)) || null;
    const allowedRoots = [
      ...buildMarkdownRoots(workspace),
      ...(!workspace ? workspaces.flatMap((ws) => buildMarkdownRoots(ws)) : []),
    ].filter((r) => r.managed).map((r) => r.path);
    const realTarget = await fs.realpath(target.filePath);
    let insideAllowed = false;
    for (const r of allowedRoots) {
      try {
        const realR = await fs.realpath(r);
        if (within(realR, realTarget) && realTarget !== realR) {
          insideAllowed = true;
          break;
        }
      } catch {}
    }
    if (!insideAllowed) throw new Error("Tệp nằm ngoài thư mục quản lý cho phép.");
    await fs.rm(realTarget, { force: true });
    invalidateSubagentCatalogCache();
    return { deletedId: id, name: target.name };
  }

  async function resolveStageSubagentExecution({
    task,
    provider,
    workspaceId = "",
    usesSharedWorkspaceCheckout = false,
  }) {
    const policy = normalizeSubagentPolicy(task?.subagentPolicy);
    if (policy.mode === "disabled") {
      return {
        policy,
        disabled: true,
        selectedProfiles: [],
        claudeArgs: ["--disallowedTools", "Task,Agent"],
        codexArgs: ["--disable", "multi_agent", "--disable", "multi_agent_v2"],
        promptAppendix: "\n\n<subagent_policy mode=\"disabled\">\nSubagent delegation is disabled for this run. Execute the task directly in this session without spawning subagents.\n</subagent_policy>",
      };
    }

    const catalog = await loadSubagentCatalog(workspaceId || task?.workspaceId || "");
    const selectedProfiles = selectTaskSubagents(catalog, { task, provider, policy });

    const clampReadOnly = Boolean(
      task?.permissionPreset === "read-only" || (usesSharedWorkspaceCheckout && policy.sharedCheckoutReadOnly)
    );

    const claudeArgs = [];
    if (provider === "claude" && selectedProfiles.length > 0) {
      claudeArgs.push("--agents", buildClaudeAgentsCliJson(selectedProfiles, { clampReadOnly, readOnly: clampReadOnly }));
    }

    const codexArgs = [];
    if (provider === "codex") {
      if (policy.mode === "enabled") {
        codexArgs.push("--enable", "multi_agent");
      }
      if (policy.codexMultiAgentV2) {
        codexArgs.push("--enable", "multi_agent_v2");
      }
    }

    const promptAppendix = (provider === "codex" || provider === "antigravity" || clampReadOnly)
      ? buildSubagentPromptInstructions(
          provider === "codex" || provider === "antigravity" ? selectedProfiles : [],
          { provider, policy, clampReadOnly, readOnly: clampReadOnly }
        )
      : "";

    return {
      policy,
      disabled: false,
      clampReadOnly,
      selectedProfiles: selectedProfiles.map(({ id, name, description, harnesses, source, readOnly, scopeId, format }) => ({
        id,
        name,
        description,
        harnesses,
        source,
        scopeId,
        format,
        readOnly: Boolean(readOnly || clampReadOnly),
      })),
      claudeArgs,
      codexArgs,
      promptAppendix,
    };
  }

  return {
    invalidateSubagentCatalogCache,
    loadSubagentCatalog,
    saveSubagentProfile,
    deleteSubagentProfile,
    selectTaskSubagents,
    buildClaudeAgentsCliJson,
    buildSubagentPromptInstructions,
    resolveStageSubagentExecution,
  };
}
