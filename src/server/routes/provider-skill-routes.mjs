import { promises as fs } from "node:fs";
import { basename, extname, isAbsolute, resolve, sep } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { configuredApiProviders, listProviderModels, normalizeUserApiProvider } from "../provider-registry.mjs";
import { workflowRoles } from "../../domain/agent-roles.js";
import { within } from "../fs-security.mjs";
import { defaultSkillScope, frontmatterValue, validateSkillContent } from "../skill-catalog.mjs";
import { buildConnectionInfoPayload, generateStrongAccessPassword } from "../network-pairing.mjs";
import { normalizeDirectoryInput } from "../cli-discovery.mjs";
import { normalizeTaskPresetProfile, validateAgentSelection } from "../task-prompts.mjs";

export async function handleProviderSkillRoutes(request, response, pathname, ctx) {
  const {
    host,
    port,
    secureTransport,
    isLoopbackBind,
    productionMode,
    allowedHosts,
    cliPathsFile,
    providerConfigFile,
    providerSecretsFile,
    connectionConfigFile,
    getState,
    getMemories,
    setMemories,
    getConnectionConfig,
    setConnectionConfig,
    getEffectiveAccessUsername,
    getEffectiveAccessPassword,
    isLoopbackClient,
    getBoundPort,
    isLanActive,
    syncLanCompanionServers,
    stateSnapshot,
    loadJson,
    persistJsonFile,
    persist,
    persistMemory,
    publish,
    json,
    readBody,
    safeError,
    run,
    isForbiddenSystemPath,
    cliDiscovery,
    providerQuotaService,
    skillCatalogService,
    taskRunner,
  } = ctx;

  const {
    getCliExecutables,
    setAgyExe,
    setClaudeCommand,
    invalidateModelCache,
    expireModelCache,
    refreshCliExecutables,
    openCliLoginTerminal,
    savedApiProviders,
    publicApiProvider,
    loadModels,
    validateCustomCliPath,
  } = cliDiscovery;
  const {
    invalidateSkillCatalogCache,
    loadSkillCatalog,
    createSkillFiles,
  } = skillCatalogService;
  const { pump } = taskRunner;
  const state = getState();

  if (request.method === "GET" && pathname === "/api/ping") {
    json(response, 200, {
      ok: true,
      app: "OpenSybau",
      name: "OpenSybau",
      hostname: hostname(),
      platform: process.platform,
      port: getBoundPort(),
      authRequired: Boolean(getEffectiveAccessPassword()),
      version: "0.3.3",
      mode: (!isLoopbackBind || isLanActive()) ? "network" : "loopback",
      ts: Date.now(),
    });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/connection-info") {
    const boundPort = getBoundPort();
    const connectors = await loadModels().catch(() => ({}));
    const activeWorktreesCount = state.tasks.filter((t) => t.isolated && !t.worktreeCleaned && !t.archived).length;
    const runningTasksCount = state.tasks.filter((t) => t.status === "running").length;
    const activePass = getEffectiveAccessPassword();
    json(response, 200, buildConnectionInfoPayload({
      host,
      port: boundPort,
      protocol: secureTransport ? "https" : "http",
      isLoopbackBind,
      lanActive: isLanActive(),
      productionMode,
      accessUsername: getEffectiveAccessUsername(),
      accessPassword: activePass,
      includePassword: isLoopbackClient(request),
      hasAccessPassword: Boolean(activePass),
      allowedHosts,
      version: "0.3.3",
      connectors,
      activeWorktreesCount,
      runningTasksCount,
    }));
    return true;
  }

  if (request.method === "POST" && pathname === "/api/connection-config") {
    if (!isLoopbackClient(request) && !secureTransport) {
      json(response, 403, { error: "Chỉ có thể đổi mật khẩu kết nối trực tiếp trên máy tính chủ." });
      return true;
    }
    const body = await readBody(request);
    const generateNew = Boolean(body.generate);
    const nextUsername = String(body.username ?? getEffectiveAccessUsername() ?? "opensybau").trim() || "opensybau";
    if (nextUsername.includes(":") || nextUsername.length > 64) {
      json(response, 400, { error: "Tên tài khoản không hợp lệ." });
      return true;
    }
    const nextPassword = generateNew
      ? generateStrongAccessPassword()
      : String(body.password ?? "").trim();
    if (nextPassword && nextPassword.length < 6) {
      json(response, 400, { error: "Mật khẩu cần tối thiểu 6 ký tự." });
      return true;
    }
    if (nextPassword.length > 256) {
      json(response, 400, { error: "Mật khẩu tối đa 256 ký tự." });
      return true;
    }
    const nextConfig = {
      username: nextUsername,
      password: nextPassword,
      remoteEnabled: Boolean(nextPassword),
      userConfigured: true,
      updatedAt: new Date().toISOString(),
    };
    setConnectionConfig(nextConfig);
    persistJsonFile(connectionConfigFile, getConnectionConfig());
    await syncLanCompanionServers();
    const boundPort = getBoundPort();
    const connectors = await loadModels().catch(() => ({}));
    const activeWorktreesCount = state.tasks.filter((t) => t.isolated && !t.worktreeCleaned && !t.archived).length;
    const runningTasksCount = state.tasks.filter((t) => t.status === "running").length;
    const activePass = getEffectiveAccessPassword();
    json(response, 200, buildConnectionInfoPayload({
      host,
      port: boundPort,
      protocol: secureTransport ? "https" : "http",
      isLoopbackBind,
      lanActive: isLanActive(),
      productionMode,
      accessUsername: getEffectiveAccessUsername(),
      accessPassword: activePass,
      includePassword: true,
      hasAccessPassword: Boolean(activePass),
      allowedHosts,
      version: "0.3.3",
      connectors,
      activeWorktreesCount,
      runningTasksCount,
    }));
    return true;
  }

  if (request.method === "GET" && pathname === "/api/state") {
    const snapshot = stateSnapshot.read();
    const unchanged = request.headers["if-none-match"]?.split(",").map((tag) => tag.trim()).includes(snapshot.etag);
    response.writeHead(unchanged ? 304 : 200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-cache",
      "ETag": snapshot.etag,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    });
    response.end(unchanged ? undefined : snapshot.body);
    return true;
  }

  if (request.method === "POST" && pathname === "/api/connectors/antigravity/path") {
    const body = await readBody(request);
    const requestedPath = String(body.path || "").trim();
    const baseName = basename(requestedPath).toLowerCase();
    if (!requestedPath || !isAbsolute(requestedPath) || process.platform === "win32" && !/^(?:agy|antigravity)[\w.-]*\.exe$/i.test(baseName)) {
      json(response, 400, { error: "Chọn đường dẫn tuyệt đối tới file agy.exe." });
      return true;
    }
    const executable = resolve(requestedPath);
    let stat;
    try { stat = await fs.stat(executable); }
    catch (error) { json(response, 404, { error: `Không đọc được file CLI đã chọn: ${safeError(error)}` }); return true; }
    if (!stat.isFile()) { json(response, 400, { error: "Đường dẫn đã chọn không phải là file CLI." }); return true; }
    const cliPathError = await validateCustomCliPath(executable);
    if (cliPathError) { json(response, 400, { error: cliPathError }); return true; }
    const version = await run(executable, ["--version"], { timeout: 10000, maxBuffer: 10000 });
    if (version.code !== 0) { json(response, 422, { error: `Không chạy được file đã chọn: ${safeError(version.stderr || version.stdout || "agy --version trả mã lỗi.")}` }); return true; }
    process.env.ANTIGRAVITY_CLI_PATH = executable;
    setAgyExe(executable);
    persistJsonFile(cliPathsFile, { ...loadJson(cliPathsFile, {}), antigravity: executable, antigravityManual: true });
    invalidateModelCache();
    const connectors = await loadModels(true);
    json(response, 200, { connector: connectors.antigravity });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/connectors/claude/path") {
    const body = await readBody(request);
    const requestedPath = String(body.path || "").trim();
    const extension = extname(requestedPath).toLowerCase();
    const baseName = basename(requestedPath).toLowerCase();
    const validClaudeName = extension === ".js"
      ? /^(?:claude(?:[-_.]cli)?|cli)\.js$/i.test(baseName)
      : process.platform === "win32" ? /^claude[\w.-]*\.exe$/i.test(baseName) : /^claude[\w.-]*$/i.test(baseName);
    if (!requestedPath || !isAbsolute(requestedPath) || (process.platform === "win32" && ![".exe", ".js"].includes(extension)) || !validClaudeName) {
      json(response, 400, { error: "Chọn đường dẫn tuyệt đối tới claude.exe hoặc cli.js." });
      return true;
    }
    const executable = resolve(requestedPath);
    let stat;
    try { stat = await fs.stat(executable); }
    catch (error) { json(response, 404, { error: `Không đọc được file CLI đã chọn: ${safeError(error)}` }); return true; }
    if (!stat.isFile()) { json(response, 400, { error: "Đường dẫn đã chọn không phải là file CLI." }); return true; }
    const cliPathError = await validateCustomCliPath(executable);
    if (cliPathError) { json(response, 400, { error: cliPathError }); return true; }
    const command = extension === ".js" ? { executable: process.execPath, prefixArgs: [executable] } : { executable, prefixArgs: [] };
    const version = await run(command.executable, [...command.prefixArgs, "--version"], { timeout: 15000, maxBuffer: 10000 });
    if (version.code !== 0) { json(response, 422, { error: `Không chạy được file đã chọn: ${safeError(version.stderr || version.stdout || "claude --version trả mã lỗi.")}` }); return true; }
    process.env.CLAUDE_CLI_PATH = executable;
    setClaudeCommand(command);
    persistJsonFile(cliPathsFile, { ...loadJson(cliPathsFile, {}), claude: executable, claudeManual: true });
    invalidateModelCache();
    const connectors = await loadModels(true);
    json(response, 200, { connector: connectors.claude });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/connectors") {
    const force = new URL(request.url, `http://${host}:${port}`).searchParams.has("refresh");
    if (force) providerQuotaService?.invalidateQuotaCache();
    json(response, 200, await loadModels(force));
    return true;
  }

  if (request.method === "GET" && pathname === "/api/quotas") {
    const force = new URL(request.url, `http://${host}:${port}`).searchParams.has("refresh");
    const quotas = providerQuotaService
      ? await providerQuotaService.loadQuotas(force)
      : { updatedAt: new Date().toISOString(), providers: {} };
    json(response, 200, quotas);
    return true;
  }

  const cliLoginMatch = pathname.match(/^\/api\/connectors\/(codex|antigravity|claude)\/login$/);
  if (request.method === "POST" && cliLoginMatch) {
    refreshCliExecutables(true);
    const { codexExe, agyExe, claudeCommand } = getCliExecutables();
    const id = cliLoginMatch[1];
    const login = id === "codex"
      ? { executable: codexExe, args: ["login"], versionArgs: ["--version"], label: "Codex CLI" }
      : id === "antigravity"
        ? { executable: agyExe, args: [], versionArgs: ["--version"], label: "Antigravity CLI" }
        : { executable: claudeCommand.executable, args: [...claudeCommand.prefixArgs, "auth", "login"], versionArgs: [...claudeCommand.prefixArgs, "--version"], label: "Claude Code" };
    if (!login.executable) { json(response, 409, { error: `${login.label} chưa được cài trên máy chạy OpenSybau. Mở hướng dẫn cài đặt trước rồi quét lại.` }); return true; }
    const installed = await run(login.executable, login.versionArgs, { timeout: 10000, maxBuffer: 10000 });
    if (installed.code !== 0) { json(response, 409, { error: `${login.label} chưa khởi chạy được. Hãy cài CLI hoặc kiểm tra PATH rồi quét lại.` }); return true; }
    try {
      await openCliLoginTerminal(login.executable, login.args, login.label);
      expireModelCache();
      json(response, 200, { ok: true, message: `Đã mở terminal ${login.label} trên máy chạy OpenSybau. Hoàn tất đăng nhập ở đó, sau đó quay lại và bấm Quét lại.` });
    } catch (error) { json(response, 501, { error: safeError(error) }); }
    return true;
  }

  if (request.method === "GET" && pathname === "/api/providers") {
    const connectors = await loadModels();
    const managed = savedApiProviders();
    let definitions = [];
    try { definitions = configuredApiProviders(process.env, managed); }
    catch {
      try { definitions = configuredApiProviders(process.env); } catch { }
      for (const item of managed) {
        try {
          const normalized = normalizeUserApiProvider(item);
          definitions.push({ runtime: normalized });
        } catch { }
      }
    }
    const managedIds = new Set(managed.map((item) => item.id));
    const providers = definitions.map(({ runtime: provider }) => publicApiProvider(provider, connectors[provider.id], managedIds.has(provider.id) ? "local" : "environment"));
    json(response, 200, { providers });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/providers/models") {
    const body = await readBody(request);
    const saved = body.useSavedKey === false ? null : savedApiProviders().find((item) => item.id === String(body.id || ""));
    let provider;
    try {
      provider = normalizeUserApiProvider({ ...body, id: body.id || "provider-check", name: body.name || "API provider", models: body.models || "provider-check", apiKey: body.apiKey || saved?.apiKey || "" });
    } catch (error) { json(response, 400, { error: safeError(error) }); return true; }
    if (provider.apiKey && !secureTransport && !isLoopbackClient(request)) { json(response, 403, { error: "Để gửi API key từ xa, hãy bật HTTPS. Hãy nhập key qua localhost hoặc cấu hình HTTPS trước." }); return true; }
    try {
      const models = await listProviderModels({ id: provider.id, name: provider.name, protocol: provider.protocol, endpoint: provider.baseUrl, apiKey: provider.apiKey });
      json(response, 200, { models });
    } catch (error) { json(response, 400, { error: safeError(error) }); }
    return true;
  }

  if (request.method === "POST" && pathname === "/api/providers/import-environment") {
    const body = await readBody(request);
    const id = String(body.id || "").trim().toLowerCase();
    const existing = loadJson(providerConfigFile, []);
    const secrets = loadJson(providerSecretsFile, {});
    if (!Array.isArray(existing) || !secrets || typeof secrets !== "object" || Array.isArray(secrets)) { json(response, 500, { error: "Cấu hình provider đã lưu không hợp lệ." }); return true; }
    if (existing.some((item) => item.id === id)) { json(response, 409, { error: "Provider này đã được quản lý trong OpenSybau." }); return true; }
    if (existing.length >= 20) { json(response, 400, { error: "Tối đa 20 provider được thêm trong giao diện." }); return true; }
    let source;
    try { source = configuredApiProviders(process.env).find((item) => item.runtime.id === id); }
    catch (error) { json(response, 409, { error: `Không thể đọc provider từ môi trường: ${safeError(error)}` }); return true; }
    if (!source) { json(response, 404, { error: "Không tìm thấy provider đã cấu hình trong môi trường." }); return true; }
    const provider = source.runtime;
    const metadata = { id: provider.id, name: provider.name, protocol: provider.protocol, baseUrl: provider.endpoint, models: provider.models, apiKeyRequired: provider.apiKeyRequired };
    const nextProviders = [...existing, metadata];
    const nextSecrets = { ...secrets };
    if (provider.apiKey) nextSecrets[id] = provider.apiKey;
    persistJsonFile(providerConfigFile, nextProviders);
    persistJsonFile(providerSecretsFile, nextSecrets);
    const connectors = await loadModels(true);
    publish("providers");
    json(response, 201, { provider: publicApiProvider({ ...metadata, apiKey: nextSecrets[id] || "" }, connectors[id], "local") });
    return true;
  }

  const providerMatch = pathname.match(/^\/api\/providers(?:\/([a-z][a-z0-9-]{1,39}))?$/);
  if (providerMatch && ["POST", "PUT", "DELETE"].includes(request.method)) {
    const existing = loadJson(providerConfigFile, []);
    const secrets = loadJson(providerSecretsFile, {});
    if (!Array.isArray(existing) || !secrets || typeof secrets !== "object" || Array.isArray(secrets)) { json(response, 500, { error: "Cấu hình provider đã lưu không hợp lệ." }); return true; }
    const pathId = providerMatch[1] || "";
    if (request.method === "DELETE") {
      if (!pathId) { json(response, 400, { error: "Thiếu ID provider cần xóa." }); return true; }
      if (!existing.some((item) => item.id === pathId)) { json(response, 404, { error: "Chỉ có thể xóa provider do OpenSybau quản lý." }); return true; }
      const inDefaults = Object.values(state.settings.defaults?.roles || {}).some((selection) => selection?.provider === pathId);
      const inActiveTask = state.tasks.some((task) => ["queued", "running"].includes(task.status) && (task.config?.chatProvider === pathId || Object.values(task.config?.roles || {}).some((selection) => selection?.provider === pathId)));
      if (inDefaults || inActiveTask) { json(response, 409, { error: "Provider đang được dùng làm mặc định hoặc trong task đang chạy. Hãy đổi định tuyến trước khi xóa." }); return true; }
      persistJsonFile(providerConfigFile, existing.filter((item) => item.id !== pathId));
      const nextSecrets = { ...secrets }; delete nextSecrets[pathId]; persistJsonFile(providerSecretsFile, nextSecrets);
      expireModelCache();
      await loadModels(true);
      publish("providers");
      json(response, 200, { ok: true });
      return true;
    }

    const body = await readBody(request);
    const id = pathId || String(body.id || "").trim().toLowerCase();
    let normalized;
    try { normalized = normalizeUserApiProvider({ ...body, id }); }
    catch (error) { json(response, 400, { error: safeError(error) }); return true; }
    const current = existing.find((item) => item.id === id);
    if (pathId && !current) { json(response, 404, { error: "Provider không tồn tại hoặc do môi trường quản lý." }); return true; }
    if (!pathId && existing.some((item) => item.id === id)) { json(response, 409, { error: "ID provider đã tồn tại." }); return true; }
    if (!pathId && existing.length >= 20) { json(response, 400, { error: "Tối đa 20 provider được thêm trong giao diện." }); return true; }
    let environmentIds;
    try { environmentIds = configuredApiProviders().map((item) => item.runtime.id); }
    catch (error) { json(response, 409, { error: `Cấu hình API trong .env đang lỗi nên chưa thể lưu provider: ${safeError(error)}` }); return true; }
    if (environmentIds.includes(id)) { json(response, 409, { error: "ID này đang được cấu hình trong môi trường (.env). Hãy chọn ID khác." }); return true; }
    const nextProviders = existing.filter((item) => item.id !== id);
    const metadata = { id: normalized.id, name: normalized.name, protocol: normalized.protocol, baseUrl: normalized.baseUrl, models: normalized.models, apiKeyRequired: normalized.apiKeyRequired };
    nextProviders.push(metadata);
    const nextSecrets = { ...secrets };
    if (body.clearApiKey === true) delete nextSecrets[id];
    else if (normalized.apiKey) {
      if (!secureTransport && !isLoopbackClient(request)) { json(response, 403, { error: "Để gửi API key từ xa, hãy bật HTTPS. Bạn vẫn có thể cấu hình key trực tiếp trên máy chủ qua localhost." }); return true; }
      nextSecrets[id] = normalized.apiKey;
    }
    persistJsonFile(providerConfigFile, nextProviders);
    persistJsonFile(providerSecretsFile, nextSecrets);
    expireModelCache();
    const connectors = await loadModels(true);
    publish("providers");
    json(response, pathId ? 200 : 201, { provider: publicApiProvider({ ...metadata, apiKey: nextSecrets[id] || "" }, connectors[id], "local") });
    return true;
  }

  if (request.method === "GET" && pathname === "/api/skills") {
    const params = new URL(request.url, `http://${host}:${port}`).searchParams;
    const skills = await loadSkillCatalog(params.get("workspaceId") || "", params.has("refresh"));
    json(response, 200, { skills: skills.map(({ id, name, description, source, sources, providers, files }) => ({ id, name, description, source, sources, providers, editable: files.some((file) => file.managed) })) });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/skills") {
    const body = await readBody(request);
    try {
      const result = await createSkillFiles(body.name, body.description, body.instructions, body.scope);
      invalidateSkillCatalogCache();
      publish("skills");
      json(response, 201, result);
    } catch (error) { json(response, 400, { error: safeError(error) }); }
    return true;
  }

  const skillMatch = pathname.match(/^\/api\/skills\/([a-f\d]{16})(?:\/(copy))?$/i);
  if (skillMatch) {
    const id = skillMatch[1];
    const action = skillMatch[2] || "";
    const params = new URL(request.url, `http://${host}:${port}`).searchParams;
    const skills = await loadSkillCatalog(params.get("workspaceId") || "");
    const skill = skills.find((item) => item.id === id);
    if (!skill) { json(response, 404, { error: "Skill không còn trong thư viện. Hãy quét lại danh mục." }); return true; }
    if (request.method === "GET" && !action) {
      json(response, 200, { skill: { id: skill.id, name: skill.name, description: skill.description, source: skill.source, sources: skill.sources, providers: skill.providers, editable: skill.files.some((file) => file.managed), content: skill.instruction } });
      return true;
    }
    if (request.method === "POST" && action === "copy") {
      const body = await readBody(request);
      const frontmatter = skill.instruction.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
      const instructions = frontmatter ? skill.instruction.slice(frontmatter[0].length).trim() : skill.instruction;
      const scope = body.scope || defaultSkillScope(skill.providers || []);
      try {
        const result = await createSkillFiles(`${skill.name} (bản tùy chỉnh)`, skill.description || `Bản tùy chỉnh của ${skill.name}`, instructions, scope);
        invalidateSkillCatalogCache();
        publish("skills");
        json(response, 201, result);
      } catch (error) { json(response, 400, { error: safeError(error) }); }
      return true;
    }
    if (request.method === "PATCH" && !action) {
      const body = await readBody(request);
      let content;
      try { content = validateSkillContent(body.content); } catch (error) { json(response, 400, { error: safeError(error) }); return true; }
      const editableFiles = skill.files.filter((file) => file.managed);
      if (!editableFiles.length) { json(response, 403, { error: "Skill plugin/built-in được quản lý bởi CLI. Sao chép nó thành skill cá nhân để chỉnh sửa." }); return true; }
      const previous = [];
      try {
        for (const entry of editableFiles) {
          const realRoot = await fs.realpath(entry.root);
          const realDirectory = await fs.realpath(entry.directory);
          if (!within(realRoot, realDirectory) || realDirectory === realRoot) throw new Error("Từ chối sửa đường dẫn skill nằm ngoài thư mục cá nhân.");
          const target = resolve(realDirectory, "SKILL.md");
          if (!(await fs.realpath(target)).toLowerCase().startsWith(`${realRoot}${sep}`.toLowerCase())) throw new Error("Đường dẫn SKILL.md đã thay đổi.");
          previous.push({ target, content: await fs.readFile(target, "utf8") });
          const temporary = resolve(realDirectory, `.SKILL-${randomUUID()}.tmp`);
          await fs.writeFile(temporary, content, "utf8");
          await fs.rename(temporary, target);
        }
      } catch (error) {
        for (const entry of previous) await fs.writeFile(entry.target, entry.content, "utf8").catch(() => {});
        json(response, 400, { error: safeError(error) });
        return true;
      }
      invalidateSkillCatalogCache();
      publish("skills");
      json(response, 200, { ok: true, name: frontmatterValue(content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)[1], "name") });
      return true;
    }
    if (request.method === "DELETE" && !action) {
      const editableFiles = skill.files.filter((file) => file.managed);
      if (!editableFiles.length) { json(response, 403, { error: "Skill plugin/built-in không thể xóa tại đây. Bạn có thể sao chép và quản lý bản cá nhân." }); return true; }
      try {
        for (const entry of editableFiles) {
          const realRoot = await fs.realpath(entry.root);
          const realDirectory = await fs.realpath(entry.directory);
          if (!within(realRoot, realDirectory) || realDirectory === realRoot || basename(realDirectory).toLowerCase() === "skills") throw new Error("Từ chối xóa thư mục gốc skill.");
        }
        for (const entry of editableFiles) await fs.rm(entry.directory, { recursive: true, force: false });
      } catch (error) { json(response, 400, { error: safeError(error) }); return true; }
      invalidateSkillCatalogCache();
      publish("skills");
      json(response, 200, { ok: true, removedSources: editableFiles.length, readonlySourcesRemain: skill.files.some((file) => !file.managed) });
      return true;
    }
  }

  if (pathname === "/api/task-presets" && request.method === "GET") {
    json(response, 200, { presets: state.settings.taskPresets });
    return true;
  }

  if (pathname === "/api/task-presets" && request.method === "POST") {
    const body = await readBody(request);
    const name = String(body.name || "").trim();
    if (!name || name.length > 80) { json(response, 400, { error: "Tên mẫu cần từ 1 đến 80 ký tự." }); return true; }
    let profile;
    try { profile = normalizeTaskPresetProfile(body.profile); }
    catch (error) { json(response, 400, { error: safeError(error) }); return true; }
    const id = String(body.id || "");
    let preset = id ? state.settings.taskPresets.find((item) => item.id === id) : null;
    if (id && !preset) { json(response, 404, { error: "Không tìm thấy mẫu tác vụ cần tạo phiên bản mới." }); return true; }
    const duplicateName = state.settings.taskPresets.find((item) => item.id !== id && String(item.name || "").toLocaleLowerCase() === name.toLocaleLowerCase());
    if (duplicateName) { json(response, 409, { error: "Tên mẫu này đã được dùng. Chọn tên khác hoặc chọn mẫu đó để lưu phiên bản mới." }); return true; }
    if (!preset && state.settings.taskPresets.length >= 50) { json(response, 409, { error: "Đã đạt giới hạn 50 mẫu tác vụ." }); return true; }
    const now = new Date().toISOString();
    if (!preset) {
      preset = { id: randomUUID(), name, currentVersion: 0, versions: [] };
      state.settings.taskPresets.push(preset);
    }
    const version = Math.max(0, ...preset.versions.map((item) => Number(item.version) || 0)) + 1;
    preset.name = name;
    preset.versions.push({ version, createdAt: now, profile });
    preset.versions = preset.versions.slice(-25);
    preset.currentVersion = version;
    persist(); publish("settings");
    json(response, 201, { preset });
    return true;
  }

  const taskPresetMatch = pathname.match(/^\/api\/task-presets\/([^/]+)$/);
  if (request.method === "DELETE" && taskPresetMatch) {
    const id = decodeURIComponent(taskPresetMatch[1]);
    const before = state.settings.taskPresets.length;
    state.settings.taskPresets = state.settings.taskPresets.filter((item) => item.id !== id);
    if (state.settings.taskPresets.length === before) { json(response, 404, { error: "Mẫu tác vụ không tồn tại." }); return true; }
    persist(); publish("settings");
    json(response, 200, { ok: true });
    return true;
  }

  if (request.method === "POST" && pathname === "/api/settings") {
    const body = await readBody(request);
    if (body.maxConcurrent !== undefined) {
      const next = Number(body.maxConcurrent);
      if (!Number.isInteger(next) || next < 1 || next > 8) { json(response, 400, { error: "Giới hạn song song phải từ 1 đến 8." }); return true; }
      state.settings.maxConcurrent = next;
    }
    if (body.defaults !== undefined) {
      const connectors = await loadModels();
      const defaults = body.defaults;
      if (defaults.roles !== undefined) {
        if (!defaults.roles || typeof defaults.roles !== "object" || Array.isArray(defaults.roles)) { json(response, 400, { error: "Cấu hình vai trò agent không hợp lệ." }); return true; }
        const roles = {};
        for (const role of workflowRoles) {
          const selection = defaults.roles[role.id];
          if (!selection) { json(response, 400, { error: `Thiếu cấu hình vai trò ${role.label}.` }); return true; }
          const normalized = { provider: String(selection.provider || ""), model: String(selection.model || ""), effort: String(selection.effort || "") };
          const error = validateAgentSelection(normalized, role.id, connectors);
          if (error) { json(response, 400, { error }); return true; }
          roles[role.id] = normalized;
        }
        state.settings.defaults.roles = roles;
        const codexRole = Object.values(roles).find((item) => item.provider === "codex");
        const agyRole = Object.values(roles).find((item) => item.provider === "antigravity");
        if (codexRole) { state.settings.defaults.codexModel = codexRole.model; state.settings.defaults.codexEffort = codexRole.effort; }
        if (agyRole) { state.settings.defaults.agyModel = agyRole.model; state.settings.defaults.agyEffort = agyRole.effort; }
      }
      const hasLegacyDefaults = defaults.codexModel !== undefined || defaults.agyModel !== undefined;
      if (hasLegacyDefaults) {
        const codex = connectors.codex.models.find((item) => item.id === defaults.codexModel);
        const agy = connectors.antigravity.models.find((item) => item.id === defaults.agyModel);
        if (defaults.codexModel !== undefined && (!codex || !codex.efforts.includes(defaults.codexEffort))) { json(response, 400, { error: "Model hoặc mức suy nghĩ Codex không được CLI hỗ trợ." }); return true; }
        if (defaults.agyModel !== undefined && (!agy || !agy.efforts.includes(defaults.agyEffort))) { json(response, 400, { error: "Model hoặc mức suy nghĩ Antigravity không được CLI hỗ trợ." }); return true; }
        state.settings.defaults = { ...state.settings.defaults, ...Object.fromEntries(["codexModel", "codexEffort", "agyModel", "agyEffort"].filter((key) => defaults[key] !== undefined).map((key) => [key, defaults[key]])) };
      }
    }
    if (body.vaultPath !== undefined) {
      const requested = normalizeDirectoryInput(body.vaultPath);
      if (!requested) state.settings.vaultPath = "";
      else {
        if (isForbiddenSystemPath(requested)) { json(response, 400, { error: "Không được chọn thư mục gốc ổ đĩa hoặc thư mục hệ thống nhạy cảm làm vault." }); return true; }
        let realPath;
        try { realPath = await fs.realpath(resolve(requested)); }
        catch (error) {
          if (error.code === "ENOENT" || error.code === "ENOTDIR") throw new Error(`Không tìm thấy thư mục vault “${requested}”. Hãy kiểm tra đường dẫn và chắc chắn thư mục còn tồn tại.`);
          throw error;
        }
        const stat = await fs.stat(realPath);
        if (!stat.isDirectory()) { json(response, 400, { error: "Đường dẫn vault phải là một thư mục có thật." }); return true; }
        if (isForbiddenSystemPath(realPath)) { json(response, 400, { error: "Không được chọn thư mục gốc ổ đĩa hoặc thư mục hệ thống nhạy cảm làm vault." }); return true; }
        state.settings.vaultPath = realPath;
      }
    }
    persist(); publish("settings"); pump();
    json(response, 200, state.settings);
    return true;
  }

  if (request.method === "POST" && pathname === "/api/memory") {
    const body = await readBody(request);
    const title = String(body.title || "").trim();
    const content = String(body.content || "").trim();
    if (!title || !content || title.length > 120 || content.length > 5000) { json(response, 400, { error: "Tên tối đa 120 ký tự, nội dung 1–5.000 ký tự." }); return true; }
    const memory = { id: randomUUID(), title, content, workspaceId: state.workspaces.some((w) => w.id === body.workspaceId) ? body.workspaceId : "all", createdAt: new Date().toISOString() };
    const memories = getMemories();
    memories.unshift(memory);
    persistMemory();
    publish("memory");
    json(response, 201, { memory });
    return true;
  }

  if (request.method === "DELETE" && pathname.startsWith("/api/memory/")) {
    const id = decodeURIComponent(pathname.slice("/api/memory/".length));
    setMemories(getMemories().filter((item) => item.id !== id));
    persistMemory();
    publish("memory");
    json(response, 200, { ok: true });
    return true;
  }

  return false;
}
