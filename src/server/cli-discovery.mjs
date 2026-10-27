import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import { delimiter, dirname, isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import { clearExecutableCache, configuredApiProviders, findClaudeCode } from "./provider-registry.mjs";
import { cliIsInstalled } from "./cli-status.mjs";
import { findAntigravityCli, parseWindowsRegisteredEnvironmentValue, probeAntigravityCli } from "./antigravity-cli.mjs";
import { within } from "./fs-security.mjs";

const CLI_CACHE_TTL_MS = 60_000;

export function normalizeDirectoryInput(value) {
  const input = String(value || "").trim();
  if (input.length >= 2 && ((input.startsWith('"') && input.endsWith('"')) || (input.startsWith("'") && input.endsWith("'")))) {
    return input.slice(1, -1).trim();
  }
  return input;
}

function powershellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function createCliDiscoveryService({
  cliPathsFile,
  providerConfigFile,
  providerSecretsFile,
  getWorkspaces,
  loadJson,
  persistJsonFile,
  run,
  git,
  safeError,
}) {
  let codexExe = "";
  let agyExe = "";
  let claudeCommand = { executable: "", prefixArgs: [] };
  let claudeExe = "";
  let modelCache;
  let modelCacheUntil = 0;
  let modelLoadPromise = null;
  let apiProviderRuntime = new Map();

  const regEnvCache = new Map();
  const pathExeCache = new Map();
  let lastCliRefreshAt = 0;

  function readRegisteredEnvironmentValue(name, force = false) {
    if (process.platform !== "win32") return "";
    const now = Date.now();
    const cached = regEnvCache.get(name);
    if (!force && cached && now < cached.until) return cached.value;
    let resolved = "";
    for (const key of ["HKCU\\Environment", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"]) {
      const result = spawnSync("reg.exe", ["query", key, "/v", name], { cwd: homedir(), encoding: "utf8", windowsHide: true, timeout: 5000 });
      const registered = parseWindowsRegisteredEnvironmentValue(result.stdout, name);
      if (registered) {
        resolved = registered.replace(/%([^%]+)%/g, (_, variable) => process.env[variable] || `%${variable}%`);
        break;
      }
    }
    regEnvCache.set(name, { value: resolved, until: now + CLI_CACHE_TTL_MS });
    return resolved;
  }

  function findOnPath(name, force = false) {
    const now = Date.now();
    const cached = pathExeCache.get(name);
    if (!force && cached && now < cached.until) return cached.value;
    const locator = process.platform === "win32" ? "where.exe" : "which";
    const result = spawnSync(locator, [name], { cwd: homedir(), encoding: "utf8", windowsHide: true, timeout: 5000 });
    const value = (result.stdout || "").split(/\r?\n/).map((item) => item.trim()).find((item) => item && existsSync(item)) || "";
    pathExeCache.set(name, { value, until: now + CLI_CACHE_TTL_MS });
    return value;
  }

  function findCodex() {
    if (process.env.CODEX_CLI_PATH) return resolve(process.env.CODEX_CLI_PATH);
    if (process.platform === "win32") {
      const profile = process.env.USERPROFILE || homedir();
      const localAppData = process.env.LOCALAPPDATA || resolve(profile, "AppData/Local");
      const appData = process.env.APPDATA || resolve(profile, "AppData/Roaming");
      const standaloneCandidates = [
        resolve(localAppData, "Programs/OpenAI/Codex/bin/codex.exe"),
        resolve(profile, ".codex/packages/standalone/current/bin/codex.exe"),
        resolve(profile, ".codex/packages/standalone/current/codex.exe"),
        resolve(appData, "npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe"),
        resolve(localAppData, "npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe"),
      ];
      const direct = standaloneCandidates.find((candidate) => existsSync(candidate));
      if (direct) return direct;
      const shim = findOnPath("codex.cmd");
      if (shim) {
        const stable = resolve(dirname(shim), "node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe");
        if (existsSync(stable)) return stable;
      }
      return findOnPath("codex.exe") || "codex.exe";
    }
    const localInstall = resolve(homedir(), ".local/bin/codex");
    if (process.platform === "linux" && existsSync(localInstall)) return localInstall;
    return findOnPath("codex") || "codex";
  }

  function findAntigravity() {
    const savedPaths = loadJson(cliPathsFile, {});
    const cachedPath = savedPaths?.antigravity;
    if (cachedPath && existsSync(resolve(cachedPath))) return resolve(cachedPath);
    const inheritedPath = process.env.ANTIGRAVITY_CLI_PATH || "";
    const configuredPath = inheritedPath && existsSync(resolve(inheritedPath))
      ? inheritedPath
      : readRegisteredEnvironmentValue("ANTIGRAVITY_CLI_PATH") || inheritedPath;
    return findAntigravityCli({
      env: { ...process.env, ANTIGRAVITY_CLI_PATH: configuredPath },
      cachedPath,
      findOnPath,
    });
  }

  function refreshWindowsPath(force = false) {
    if (process.platform !== "win32") return;
    const now = Date.now();
    if (!force && lastCliRefreshAt && now - lastCliRefreshAt < CLI_CACHE_TTL_MS) return;
    const keys = ["HKCU\\Environment", "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment"];
    const registered = keys.map((key) => {
      const result = spawnSync("reg.exe", ["query", key, "/v", "Path"], { cwd: homedir(), encoding: "utf8", windowsHide: true, timeout: 5000 });
      const line = (result.stdout || "").split(/\r?\n/).find((item) => /^\s*Path\s+REG_(?:EXPAND_)?SZ\s+/i.test(item));
      return line ? line.replace(/^\s*Path\s+REG_(?:EXPAND_)?SZ\s+/i, "").trim() : "";
    }).filter(Boolean);
    const paths = registered.flatMap((value) => value.split(delimiter));
    paths.push(...String(process.env.PATH || "").split(delimiter));
    const unique = [...new Map(paths.map((item) => [item.trim().replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`).toLowerCase(), item.trim().replace(/%([^%]+)%/g, (_, name) => process.env[name] || `%${name}%`)]).filter(([key]) => key)).values()];
    if (unique.length) process.env.PATH = unique.join(delimiter);
  }

  function refreshCliExecutables(force = false) {
    const now = Date.now();
    if (!force && lastCliRefreshAt && now - lastCliRefreshAt < CLI_CACHE_TTL_MS) return;
    if (force) {
      regEnvCache.clear();
      pathExeCache.clear();
      clearExecutableCache();
    }
    refreshWindowsPath(force);
    lastCliRefreshAt = Date.now();
    codexExe = findCodex();
    agyExe = findAntigravity();
    claudeCommand = findClaudeCode();
    claudeExe = claudeCommand.executable;
  }

  function openCliLoginTerminal(executable, args, title) {
    if (process.platform === "linux") {
      const candidates = [
        { names: ["x-terminal-emulator", "xterm"], args: (command) => ["-e", ...command] },
        { names: ["gnome-terminal"], args: (command) => ["--wait", "--", ...command] },
        { names: ["konsole"], args: (command) => ["--separate", "-e", ...command] },
      ];
      const terminal = candidates.flatMap((candidate) => candidate.names.map((name) => ({ candidate, name, path: findOnPath(name) }))).find((item) => item.path);
      if (!terminal) throw new Error("Không tìm thấy ứng dụng terminal. Cài xterm, GNOME Terminal hoặc Konsole rồi thử lại.");
      const command = executable === process.execPath
        ? [findOnPath("node") || "node", ...args]
        : [executable, ...args];
      const launcherArgs = terminal.candidate.args(command);
      return new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(terminal.path, launcherArgs, { cwd: homedir(), detached: true, stdio: "ignore", windowsHide: true });
        child.once("spawn", () => { child.unref(); resolvePromise(); });
        child.once("error", rejectPromise);
      });
    }
    if (process.platform !== "win32") throw new Error("Tự mở terminal đăng nhập hiện được hỗ trợ trên Windows và Linux.");
    const windowsRoot = process.env.WINDIR || "C:\\Windows";
    const powershell = resolve(windowsRoot, "System32/WindowsPowerShell/v1.0/powershell.exe");
    if (!existsSync(powershell)) throw new Error("Không tìm thấy Windows PowerShell. Hãy mở PowerShell thủ công và chạy lệnh đăng nhập trong hướng dẫn.");
    const runWithElectronNode = executable === process.execPath;
    const invocation = [executable, ...args].map(powershellLiteral).join(" ");
    const script = [
      `$Host.UI.RawUI.WindowTitle = ${powershellLiteral(`OpenSybau · ${title}`)}`,
      `Set-Location -LiteralPath ${powershellLiteral(homedir())}`,
      "try { (New-Object -ComObject WScript.Shell).AppActivate($PID) | Out-Null } catch {}",
      "$uPath = [Environment]::GetEnvironmentVariable('Path', 'User'); $mPath = [Environment]::GetEnvironmentVariable('Path', 'Machine'); if ($uPath -or $mPath) { $env:Path = (@($uPath, $mPath, $env:Path) | Where-Object { $_ }) -join ';' }",
      runWithElectronNode ? "$env:ELECTRON_RUN_AS_NODE = '1'" : "",
      `Write-Host ${powershellLiteral(`=== OpenSybau · Đăng nhập ${title} ===`)} -ForegroundColor Cyan`,
      `Write-Host ${powershellLiteral(`Đang mở ${title}. Hoàn tất đăng nhập trong cửa sổ này hoặc trên trình duyệt vừa mở.`)}`,
      "Write-Host ''",
      `& ${invocation}`,
      "if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { Write-Host ('CLI kết thúc với mã ' + $LASTEXITCODE) -ForegroundColor Yellow }",
      "Write-Host ''",
      "Write-Host 'Hoàn tất! OpenSybau sẽ tự động nhận diện hoặc bạn có thể bấm Quét lại.' -ForegroundColor Cyan",
    ].filter(Boolean).join("; ");
    const encoded = Buffer.from(script, "utf16le").toString("base64");
    const launchCmd = `Start-Process -FilePath ${powershellLiteral(powershell)} -ArgumentList @('-NoProfile', '-NoExit', '-EncodedCommand', ${powershellLiteral(encoded)}) -WorkingDirectory ${powershellLiteral(homedir())} -WindowStyle Normal`;
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", launchCmd], {
        cwd: homedir(), detached: true, stdio: "ignore", windowsHide: true, env: process.env,
      });
      child.once("error", rejectPromise);
      child.once("close", (code) => {
        if (code === 0) resolvePromise();
        else rejectPromise(new Error(`Không thể mở cửa sổ PowerShell đăng nhập (mã ${code ?? "unknown"}).`));
      });
    });
  }

  async function inspectWorkspace(path) {
    const requested = normalizeDirectoryInput(path);
    let realPath;
    try { realPath = await fs.realpath(requested); }
    catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") throw new Error(`Không tìm thấy thư mục “${requested}”. Hãy kiểm tra đường dẫn và chắc chắn thư mục còn tồn tại.`);
      throw error;
    }
    const stat = await fs.stat(realPath);
    if (!stat.isDirectory()) throw new Error("Đường dẫn workspace phải trỏ tới một thư mục.");
    const repo = await git(realPath, ["rev-parse", "--show-toplevel"]);
    if (repo.code !== 0) return { path: realPath, gitRoot: null, isGit: false, branch: null, head: false, dirty: null };
    const repoPath = (repo.stdout || "").trim();
    const [branch, head, status] = await Promise.all([
      git(repoPath, ["branch", "--show-current"]),
      git(repoPath, ["rev-parse", "--verify", "HEAD"]),
      git(repoPath, ["status", "--short"]),
    ]);
    return { path: realPath, gitRoot: repoPath, isGit: true, branch: (branch.stdout || "").trim(), head: head.code === 0, dirty: Boolean((status.stdout || "").trim()) };
  }

  function savedApiProviders() {
    const entries = loadJson(providerConfigFile, []);
    const secrets = loadJson(providerSecretsFile, {});
    if (!Array.isArray(entries)) throw new Error("Danh sách provider đã lưu không hợp lệ.");
    return entries.map((entry) => ({ ...entry, apiKey: String(secrets?.[entry.id] || "") }));
  }

  function publicApiProvider(provider, connector, managedBy) {
    return {
      id: provider.id, name: provider.name, protocol: provider.protocol, baseUrl: provider.baseUrl || provider.endpoint || "",
      models: provider.models.map((model) => ({ ...model })), managedBy, apiKeyRequired: Boolean(provider.apiKeyRequired),
      apiKeyConfigured: Boolean(provider.apiKey), available: Boolean(connector?.available),
      error: connector?.error || null,
    };
  }

  async function loadModelsUncached() {
    const [codex, agy, codexLogin, claude] = await Promise.all([
      run(codexExe, ["debug", "models"], { timeout: 30000, maxBuffer: 32_000_000 }),
      probeAntigravityCli({ resolveExecutable: () => findAntigravity(), run }),
      run(codexExe, ["login", "status"], { timeout: 10000, maxBuffer: 10000 }),
      claudeExe ? run(claudeExe, [...claudeCommand.prefixArgs, "--version"], { timeout: 10000, maxBuffer: 10000 }) : Promise.resolve({ code: -1, stdout: "", stderr: "Claude Code CLI not found" }),
    ]);
    const claudeAuth = claude.code === 0
      ? await run(claudeExe, [...claudeCommand.prefixArgs, "auth", "status"], { timeout: 10000, maxBuffer: 10000 })
      : { code: -1, stdout: "", stderr: "Claude Code CLI not found" };
    let codexModels = [];
    if (codex.code === 0) {
      try {
        const data = JSON.parse(codex.stdout);
        codexModels = (data.models || []).filter((m) => m.slug && m.visibility !== "hide" && m.visibility !== "hidden").map((m) => ({ id: m.slug, name: m.display_name || m.slug, efforts: (m.supported_reasoning_levels || []).map((e) => e.effort).filter(Boolean) }));
      } catch { }
    }
    agyExe = agy.executable;
    if (agy.installed && agy.version !== "unavailable" && isAbsolute(agyExe)) {
      try { persistJsonFile(cliPathsFile, { ...loadJson(cliPathsFile, {}), antigravity: agyExe }); }
      catch (error) { console.warn("Could not save the detected Antigravity CLI path:", safeError(error)); }
    }
    const agyModels = agy.models;
    const codexAvailable = codex.code === 0 && codexLogin.code === 0 && codexModels.length > 0;
    const agyAvailable = agy.available;
    const claudeAuthenticated = claudeAuth.code === 0 || Boolean(process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN);
    const claudeAvailable = claude.code === 0 && claudeAuthenticated;
    const claudeModels = claude.code === 0 ? [
      { id: "sonnet", name: "Claude Sonnet · latest", efforts: ["standard"] },
      { id: "opus", name: "Claude Opus · latest", efforts: ["standard"] },
      { id: "haiku", name: "Claude Haiku · latest", efforts: ["standard"] },
    ] : [];
    const apiDefinitions = [];
    let apiConfigurationError = null;
    try { apiDefinitions.push(...configuredApiProviders(process.env, savedApiProviders())); }
    catch (error) { apiConfigurationError = safeError(error); }
    apiProviderRuntime = new Map(apiDefinitions.filter((definition) => definition.connector.available).map((definition) => [definition.runtime.id, definition.runtime]));
    modelCache = {
      codex: { name: "Codex CLI", kind: "cli", executable: codexExe, available: codexAvailable, authenticated: codexLogin.code === 0, capabilities: { chat: true, plan: true, build: true, review: true }, version: null, error: codexAvailable ? null : safeError(codex.stderr || codexLogin.stderr || "Codex CLI chưa đăng nhập hoặc chưa trả danh sách model."), models: codexModels },
      antigravity: { name: "Antigravity CLI", kind: "cli", executable: agyExe, installed: agy.installed, available: agyAvailable, authenticated: agy.authenticated, capabilities: { chat: true, plan: true, build: true, review: true }, version: agy.version, error: agy.error ? safeError(agy.error) : null, models: agyModels },
      claude: { name: "Claude Code", kind: "cli", executable: claudeExe || null, available: claudeAvailable, authenticated: claude.code === 0 ? claudeAuthenticated : false, capabilities: { chat: true, plan: true, build: true, review: true }, version: claude.code === 0 ? claude.stdout.trim() : null, error: claude.code !== 0 ? "Cài Claude Code CLI và đặt CLAUDE_CLI_PATH nếu chưa có trên PATH." : !claudeAuthenticated ? "Claude Code chưa đăng nhập. Mở terminal và chạy claude auth login." : null, models: claudeModels },
      ...Object.fromEntries(apiDefinitions.map((definition) => [definition.runtime.id, definition.connector])),
      apiConfigurationError,
    };
    const codexVersion = await run(codexExe, ["--version"], { timeout: 10000 });
    modelCache.codex.installed = cliIsInstalled(codexExe, codexVersion.code);
    modelCache.claude.installed = cliIsInstalled(claudeExe, claude.code);
    modelCache.codex.version = codexVersion.code === 0 ? codexVersion.stdout.trim() : "unavailable";
    modelCacheUntil = Date.now() + (agy.installed && !agy.available && agy.authenticated !== false ? 5000 : 60_000);
    return modelCache;
  }

  async function loadModels(force = false) {
    if (!force && modelCache && Date.now() < modelCacheUntil) return modelCache;
    if (modelLoadPromise) {
      const pending = modelLoadPromise;
      if (!force) return pending;
      await pending.catch(() => {});
      if (modelLoadPromise) return modelLoadPromise;
    }
    if (force) refreshCliExecutables(true);
    modelLoadPromise = loadModelsUncached();
    try { return await modelLoadPromise; }
    finally { modelLoadPromise = null; }
  }

  async function validateCustomCliPath(executablePath) {
    const resolvedPath = await fs.realpath(resolve(executablePath)).catch(() => resolve(executablePath));
    for (const ws of getWorkspaces() || []) {
      if (!ws?.path) continue;
      const wsResolved = await fs.realpath(resolve(ws.path)).catch(() => resolve(ws.path));
      if (within(wsResolved, resolvedPath)) {
        return "Không được chọn tệp thực thi nằm trong thư mục dự án (workspace) để tránh thực thi mã không tin cậy.";
      }
    }
    return "";
  }

  refreshCliExecutables(true);

  return {
    getCliExecutables: () => ({ codexExe, agyExe, claudeCommand, claudeExe }),
    setAgyExe: (exe) => { agyExe = exe; },
    setClaudeCommand: (cmd) => { claudeCommand = cmd; claudeExe = cmd.executable; },
    invalidateModelCache: () => { modelCache = null; modelCacheUntil = 0; },
    expireModelCache: () => { modelCacheUntil = 0; },
    hasApiProvider: (provider) => apiProviderRuntime.has(provider),
    getApiProviderRuntime: (provider) => apiProviderRuntime.get(provider),
    refreshCliExecutables,
    openCliLoginTerminal,
    normalizeDirectoryInput,
    inspectWorkspace,
    savedApiProviders,
    publicApiProvider,
    loadModels,
    validateCustomCliPath,
  };
}
