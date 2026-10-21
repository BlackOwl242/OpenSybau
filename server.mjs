import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import { basename, delimiter, dirname, extname, isAbsolute, relative, resolve, sep } from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { completeWithApi, configuredApiProviders, findClaudeCode, listProviderModels, normalizeUserApiProvider, providerLabel } from "./src/server/provider-registry.mjs";
import { cliIsInstalled } from "./src/server/cli-status.mjs";
import { findAntigravityCli, parseWindowsRegisteredEnvironmentValue, probeAntigravityCli } from "./src/server/antigravity-cli.mjs";
import { roleConfig, workflowRoles } from "./src/domain/agent-roles.js";
import { estimateTaskCostUsd, parseReviewFindings } from "./src/domain/task-flow.js";
import { createStateSnapshot } from "./src/server/state-snapshot.mjs";
import {
  allowedTextFile,
  isForbiddenSystemPath as checkForbiddenSystemPath,
  isTaskEffectivelyIsolated,
  listLocalFiles,
  listRemoteContextFiles as listRemoteContextFilesBase,
  readLocalTextFile,
  redactRemoteSecrets,
  resolveInside,
  safeForRemoteContext,
  safeRelativePath,
  usesSharedCheckout,
  within,
  workspaceLockKey,
  writeLocalWorkspaceTextFile,
} from "./src/server/fs-security.mjs";
import {
  buildVaultKnowledgeGraph,
  deleteVaultMarkdownFile,
  normalizeVaultNoteRelativePath,
  openObsidianUri,
  writeVaultMarkdownFile,
} from "./src/server/vault-service.mjs";
import {
  autoDistillTaskMemory as distillTaskMemory,
  buildTelemetrySummary as computeTelemetrySummary,
  relevantMemory as queryRelevantMemory,
  tokenize,
  tokenizeTerms,
} from "./src/server/memory-bm25.mjs";
import {
  createSkillCatalogService,
  defaultSkillScope,
  frontmatterValue,
  parseSkillSelection,
  skillId,
  slugSkill,
  validateSkillContent,
} from "./src/server/skill-catalog.mjs";
import { parseUnifiedDiffFiles } from "./src/server/diff-parser.mjs";
import { injectOrcaInspectorHtml } from "./src/server/html-inspector-script.mjs";
import {
  apiBuildTarget,
  applyApiBuildResult,
  externalWorkspaceContext as buildExternalWorkspaceContext,
  parseApiBuildOperations,
} from "./src/server/api-build-ops.mjs";
import {
  createTaskGithubPullRequest,
  listWorkspaceGithubIssues,
} from "./src/server/github-cli.mjs";
import { buildConnectionInfoPayload, discoverLanAddresses, generateStrongAccessPassword } from "./src/server/network-pairing.mjs";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)));
const host = process.env.WORKBENCH_HOST || "127.0.0.1";
const port = Number(String(process.env.WORKBENCH_PORT ?? "").trim() || 4173);
const runtime = resolve(root, process.env.WORKBENCH_DATA_DIR || ".runtime");
const taskDir = resolve(runtime, "tasks");
const worktreeDir = resolve(runtime, "worktrees");
const stateFile = resolve(runtime, "state.json");
const memoryFile = resolve(runtime, "memory.json");
const providerConfigFile = resolve(runtime, "providers.json");
const providerSecretsFile = resolve(runtime, "provider-secrets.json");
const cliPathsFile = resolve(runtime, "cli-paths.json");
const connectionConfigFile = resolve(runtime, "connection-config.json");
const clients = new Set();
const pendingClientUpdates = new WeakSet();
const running = new Map();
const busyWorkspaces = new Set();
const isolatedWorkspaces = new Map();
const contentTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
let codexExe = "";
let agyExe = "";
let claudeCommand = { executable: "", prefixArgs: [] };
let claudeExe = "";
const accessUsername = process.env.WORKBENCH_ACCESS_USERNAME || "opensybau";
const accessPassword = process.env.WORKBENCH_ACCESS_PASSWORD || "";
const isLoopbackBind = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host.toLowerCase());
const allowedHosts = new Set([
  ...(isLoopbackBind ? [`${host}:${port}`, `localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`] : []),
  ...String(process.env.WORKBENCH_ALLOWED_HOSTS || "").split(",").map((item) => item.trim().toLowerCase()).filter(Boolean),
]);
const tlsCert = process.env.WORKBENCH_TLS_CERT || "";
const tlsKey = process.env.WORKBENCH_TLS_KEY || "";
const secureTransport = Boolean(tlsCert && tlsKey);
let modelCache;
let modelCacheUntil = 0;
let modelLoadPromise = null;
let apiProviderRuntime = new Map();
let schedulerActive = false;
let shuttingDown = false;
let pumpTimer;
let persistTimer = null;
let publishTimer = null;
let pendingPublishType = null;
const gitRepoLocks = new Map();
const stateSnapshot = createStateSnapshot(publicState);

async function withGitRepoLock(repoKey, fn) {
  const key = String(repoKey || "").toLowerCase();
  const prev = gitRepoLocks.get(key) || Promise.resolve();
  let release;
  const next = new Promise((resolvePromise) => { release = resolvePromise; });
  gitRepoLocks.set(key, prev.then(() => next));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (gitRepoLocks.get(key) === next) gitRepoLocks.delete(key);
  }
}

mkdirSync(taskDir, { recursive: true });
mkdirSync(worktreeDir, { recursive: true });

if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("WORKBENCH_PORT must be a valid TCP port (0–65535).");
if (Boolean(tlsCert) !== Boolean(tlsKey)) throw new Error("Set both WORKBENCH_TLS_CERT and WORKBENCH_TLS_KEY to enable HTTPS.");
if (!isLoopbackBind && process.env.WORKBENCH_MODE !== "production") throw new Error("Network access is only allowed in production mode. Run npm run build, then npm start.");
if (!isLoopbackBind && accessPassword.length < 16) throw new Error("Network access requires WORKBENCH_ACCESS_PASSWORD with at least 16 characters.");
if (!isLoopbackBind && !allowedHosts.size) throw new Error("Network access requires an explicit WORKBENCH_ALLOWED_HOSTS allowlist.");
if (accessUsername.includes(":")) throw new Error("WORKBENCH_ACCESS_USERNAME cannot contain a colon.");

function findCodex() {
  if (process.env.CODEX_CLI_PATH) return resolve(process.env.CODEX_CLI_PATH);
  if (process.platform === "win32") {
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
  // A previously discovered path is already a verified install location. Use it
  // before stale inherited PATH/.env values, whether it was chosen manually or
  // cached by an earlier automatic scan.
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

const regEnvCache = new Map();
const pathExeCache = new Map();
let lastCliRefreshAt = 0;
const CLI_CACHE_TTL_MS = 60_000;

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
  if (force && now - lastCliRefreshAt > 3000) {
    regEnvCache.clear();
    pathExeCache.clear();
  }
  refreshWindowsPath(force);
  lastCliRefreshAt = Date.now();
  codexExe = findCodex();
  agyExe = findAntigravity();
  claudeCommand = findClaudeCode();
  claudeExe = claudeCommand.executable;
}

refreshCliExecutables(true);

function initialState() {
  return {
    version: 1,
    settings: { maxConcurrent: 2, defaults: {}, vaultPath: "", taskPresets: [] },
    workspaces: [],
    tasks: [],
  };
}

function loadJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return fallback; }
}

let connectionConfig = loadJson(connectionConfigFile, {});
if (!connectionConfig || typeof connectionConfig !== "object" || Array.isArray(connectionConfig)) connectionConfig = {};
function getEffectiveAccessUsername() {
  return String(process.env.WORKBENCH_ACCESS_USERNAME || connectionConfig?.username || "opensybau").trim() || "opensybau";
}
function getEffectiveAccessPassword() {
  return String(process.env.WORKBENCH_ACCESS_PASSWORD || connectionConfig?.password || "");
}
let state = loadJson(stateFile, initialState());
state.settings ||= { maxConcurrent: 2 };
state.settings.defaults ||= {};
state.settings.vaultPath ||= "";
state.settings.maxConcurrent ||= 2;
state.settings.taskPresets = Array.isArray(state.settings.taskPresets) ? state.settings.taskPresets : [];
state.workspaces ||= [];
state.tasks ||= [];
for (const workspace of state.workspaces) {
  workspace.pinned = Boolean(workspace.pinned);
  workspace.section ||= "Projects";
  workspace.sourceFolders = Array.isArray(workspace.sourceFolders) && workspace.sourceFolders.length ? workspace.sourceFolders : [workspace.path];
  if (!workspace.sourceFolders.some((path) => String(path).toLowerCase() === String(workspace.path).toLowerCase())) workspace.sourceFolders.unshift(workspace.path);
}
for (const task of state.tasks) {
  task.pinned = Boolean(task.pinned);
  task.archived = Boolean(task.archived);
  if (task.status === "running") {
    task.status = "failed";
    task.phase = "failed";
    task.error = "OpenSybau đã dừng khi tiến trình đang chạy. Kiểm tra workspace trước khi chạy lại.";
    if (task.activeStageRunId) finishStageRerun(task, "failed", task.error);
    task.updatedAt = new Date().toISOString();
  }
  if (task.status !== "queued") {
    const interruptedCount = failQueuedChatTurns(task, true);
    if (interruptedCount) {
      const interruptedAt = new Date().toISOString();
      task.events = [...(task.events || []), { at: interruptedAt, kind: "warning", text: "Tin nhắn chat chưa hoàn tất khi OpenSybau dừng; hãy gửi lại nếu vẫn cần." }].slice(-250);
      task.updatedAt = interruptedAt;
    }
  }
}
let memories = loadJson(memoryFile, []);
function persistJsonFile(filePath, value, options = { encoding: "utf8", mode: 0o600 }) {
  const serialized = JSON.stringify(value, null, 2);
  const temporary = `${filePath}.tmp`;
  writeFileSync(temporary, serialized, options);
  try {
    renameSync(temporary, filePath);
  } catch (error) {
    if (error?.code === "EPERM" || error?.code === "EACCES") {
      writeFileSync(filePath, serialized, options);
      try { rmSync(temporary, { force: true }); } catch {}
    } else {
      try { rmSync(temporary, { force: true }); } catch {}
      throw error;
    }
  }
}
function persist() {
  stateSnapshot.invalidate();
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  persistJsonFile(stateFile, state, "utf8");
}
function schedulePersist(delayMs = 750) {
  stateSnapshot.invalidate();
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try { persist(); } catch { }
  }, delayMs);
  persistTimer.unref?.();
}
function persistMemory() {
  stateSnapshot.invalidate();
  persistJsonFile(memoryFile, memories, "utf8");
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
function isLoopbackClient(request) {
  const address = String(request.socket?.remoteAddress || "").toLowerCase().replace(/^::ffff:/, "");
  return address === "::1" || address === "127.0.0.1" || address.startsWith("127.");
}
function publish(type = "state") {
  stateSnapshot.invalidate();
  if (publishTimer) {
    clearTimeout(publishTimer);
    publishTimer = null;
    pendingPublishType = null;
  }
  const payload = JSON.stringify({ type });
  for (const client of clients) {
    if (client.destroyed || client.writableEnded) { clients.delete(client); continue; }
    if (client.writableNeedDrain) {
      if (!pendingClientUpdates.has(client)) {
        pendingClientUpdates.add(client);
        client.once("drain", () => {
          pendingClientUpdates.delete(client);
          if (!client.destroyed && !client.writableEnded) client.write('event: update\ndata: {"type":"state"}\n\n');
        });
      }
      continue;
    }
    client.write(`event: update\ndata: ${payload}\n\n`);
  }
}
function schedulePublish(type = "task", delayMs = 250) {
  stateSnapshot.invalidate();
  pendingPublishType = type;
  if (publishTimer) return;
  publishTimer = setTimeout(() => {
    const nextType = pendingPublishType || type;
    publishTimer = null;
    pendingPublishType = null;
    publish(nextType);
  }, delayMs);
  publishTimer.unref?.();
}
function record(task, text, kind = "info", meta = null) {
  const at = new Date().toISOString();
  task.events ||= [];
  const last = task.events.at(-1);
  if (kind === "output" && last?.kind === "output" && !meta) {
    last.at = at;
    last.text = `${last.text || ""}${String(text)}`.slice(-1500);
    task.updatedAt = at;
    schedulePersist();
    schedulePublish("task");
    return;
  }
  const line = { at, text: String(text).slice(0, 8000), kind, ...(meta && typeof meta === "object" ? meta : {}) };
  task.events = [...task.events, line].slice(-250);
  task.updatedAt = line.at;
  if (kind === "output" || kind === "tool") {
    schedulePersist();
    schedulePublish("task");
  } else {
    schedulePersist(60);
    publish("task");
  }
}
function finishStageRerun(task, status, error = "") {
  const attempt = (task.stageRunHistory || []).find((item) => item.id === task.activeStageRunId);
  if (attempt) {
    attempt.status = status;
    attempt.completedAt = new Date().toISOString();
    if (error) attempt.error = String(error).slice(0, 8000);
  }
  task.activeStageRunId = null;
}
function failQueuedChatTurns(task, includeRunning = false) {
  const queuedMessageIds = new Set((task.chatQueue || []).map((turn) => turn.messageId));
  let failedCount = 0;
  for (const message of task.chatMessages || []) {
    if ((message.status === "queued" && queuedMessageIds.has(message.id)) || (includeRunning && message.status === "running")) {
      message.status = "failed";
      failedCount += 1;
    }
  }
  task.chatQueue = [];
  task.chatResumeState = null;
  return failedCount;
}
function assertTaskActive(task) {
  const runInfo = running.get(task.id);
  if (shuttingDown || runInfo?.stopped) throw new Error(shuttingDown ? "OpenSybau is shutting down." : "Stopped by user");
}
function json(response, status, value) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
  });
  response.end(JSON.stringify(value));
}
function safeError(error) {
  return String(error?.message || error || "Unknown error").slice(0, 8000);
}
function killTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
    killer.unref();
  } else child.kill("SIGTERM");
  try {
    child.stdout?.destroy();
    child.stderr?.destroy();
  } catch {}
}
async function readBody(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 1_000_000) {
      const err = new Error("Request body too large");
      err.statusCode = 413;
      throw err;
    }
  }
  if (!body) return {};
  const contentType = String(request.headers?.["content-type"] || "").toLowerCase();
  if (contentType && !contentType.includes("application/json")) {
    const err = new Error("Content-Type must be application/json");
    err.statusCode = 415;
    throw err;
  }
  try {
    return JSON.parse(body);
  } catch {
    const err = new Error("Invalid JSON request body");
    err.statusCode = 400;
    throw err;
  }
}
function run(exe, args, options = {}) {
  return new Promise((resolvePromise) => {
    // In an Electron production build, `root` can be inside app.asar and is not
    // a valid process working directory for external CLIs. Run probes from home.
    const childEnv = { ...process.env, NO_COLOR: "1", ...(exe === process.execPath ? { ELECTRON_RUN_AS_NODE: "1" } : {}) };
    if (exe !== process.execPath) delete childEnv.ELECTRON_RUN_AS_NODE;
    const child = spawn(exe, args, { cwd: options.cwd || homedir(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: childEnv });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const limit = options.maxBuffer || 2_000_000;
    child.stdout.on("error", () => {});
    child.stderr.on("error", () => {});
    child.stdout.on("data", (chunk) => { if (stdout.length < limit) stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { if (stderr.length < limit) stderr += chunk.toString(); });
    const timer = options.timeout ? setTimeout(() => {
      timedOut = true;
      killTree(child);
      child.stdout?.destroy();
      child.stderr?.destroy();
    }, options.timeout) : null;
    child.on("error", (error) => { if (timer) clearTimeout(timer); resolvePromise({ code: -1, stdout, stderr: stderr || error.message, timedOut }); });
    child.on("close", (code) => { if (timer) clearTimeout(timer); resolvePromise({ code: code ?? -1, stdout, stderr, timedOut }); });
  });
}
async function git(cwd, args) {
  return run(process.platform === "win32" ? "git.exe" : "git", args, { cwd, timeout: 10000, maxBuffer: 500000 });
}
function openFolder(path) {
  const [command, args] = process.platform === "win32"
    ? ["explorer.exe", [path]]
    : process.platform === "darwin"
      ? ["open", [path]]
      : ["xdg-open", [path]];
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: false });
    child.once("spawn", () => { child.unref(); resolvePromise(); });
    child.once("error", rejectPromise);
  });
}
function powershellLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
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
  const invocation = [executable, ...args].map(powershellLiteral).join(" ");
  const script = [
    `$Host.UI.RawUI.WindowTitle = ${powershellLiteral(`OpenSybau · ${title}`)}`,
    `Set-Location -LiteralPath ${powershellLiteral(homedir())}`,
    `Write-Host ${powershellLiteral(`Đang mở ${title}. Hoàn tất đăng nhập trong cửa sổ này.`)}`,
    `& ${invocation}`,
    "if ($LASTEXITCODE -and $LASTEXITCODE -ne 0) { Write-Host ('CLI kết thúc với mã ' + $LASTEXITCODE) -ForegroundColor Yellow }",
    "Write-Host 'Quay lại OpenSybau và chọn Quét lại để cập nhật trạng thái.' -ForegroundColor Cyan",
  ].join("; ");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const windowsTerminal = findOnPath("wt.exe");
  const launcher = windowsTerminal || resolve(windowsRoot, "System32/cmd.exe");
  const launcherArgs = windowsTerminal
    ? ["-w", "new", powershell, "-NoProfile", "-NoExit", "-EncodedCommand", encoded]
    : ["/d", "/s", "/c", `start "" "${powershell}" -NoProfile -NoExit -EncodedCommand ${encoded}`];
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(launcher, launcherArgs, {
      cwd: homedir(), detached: true, stdio: "ignore", windowsHide: !windowsTerminal, env: process.env,
    });
    child.once("spawn", () => { child.unref(); resolvePromise(); });
    child.once("error", rejectPromise);
  });
}
function matchesCredential(input, expected) {
  const inputHash = createHash("sha256").update(input).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(inputHash, expectedHash);
}
function hasValidAccess(request) {
  // Development and the local operator of a LAN server should not need to enter
  // the shared password. Keep auth enabled for production loopback servers,
  // which may be exposed through a reverse proxy, when WORKBENCH_ACCESS_PASSWORD is set.
  const requestHost = String(request.headers.host || "").toLowerCase();
  const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\]|::1)(?::\d{1,5})?$/.test(requestHost);
  if (isLoopbackClient(request) && (!accessPassword || process.env.WORKBENCH_MODE !== "production" || (!isLoopbackBind && localHost))) return true;
  const activePassword = getEffectiveAccessPassword();
  if (!activePassword) return isLoopbackBind && isLoopbackClient(request);
  const match = String(request.headers.authorization || "").match(/^Basic\s+([A-Za-z0-9+/]+=*)$/i);
  if (!match) return false;
  let value;
  try { value = Buffer.from(match[1], "base64").toString("utf8"); } catch { return false; }
  const separator = value.indexOf(":");
  if (separator < 0) return false;
  const userOk = matchesCredential(value.slice(0, separator), getEffectiveAccessUsername());
  const passOk = matchesCredential(value.slice(separator + 1), activePassword);
  return userOk && passOk;
}
function normalizeDirectoryInput(value) {
  const input = String(value || "").trim();
  if (input.length >= 2 && ((input.startsWith('"') && input.endsWith('"')) || (input.startsWith("'") && input.endsWith("'")))) return input.slice(1, -1).trim();
  return input;
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
async function loadModels(force = false) {
  if (!force && modelCache && Date.now() < modelCacheUntil) return modelCache;
  if (modelLoadPromise) {
    const pending = modelLoadPromise;
    if (!force) return pending;
    await pending.catch(() => {});
    if (modelLoadPromise) return modelLoadPromise;
  }
  if (force) refreshCliExecutables();
  modelLoadPromise = loadModelsUncached();
  try { return await modelLoadPromise; }
  finally { modelLoadPromise = null; }
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
const {
  invalidateSkillCatalogCache,
  loadSkillCatalog,
  resolveSelectedSkills,
  rankSkillCandidatesScored,
  rankSkillCandidates,
  skillProviderCompatible,
  skillSelectionPrompt,
  stageAntigravitySkillBundles,
  stageAntigravitySkills,
  skillRoots,
  createSkillFiles,
  skillInstructions,
} = createSkillCatalogService({
  runtime,
  getWorkspaces: () => state.workspaces,
  hasApiProvider: (provider) => apiProviderRuntime.has(provider),
  stageSelection: (task, stage) => stageSelection(task, stage),
  publicProviderName: (provider) => publicProviderName(provider),
  workflowRoles,
});

function isForbiddenSystemPath(targetPath) {
  return checkForbiddenSystemPath(targetPath, runtime);
}

async function validateCustomCliPath(executablePath) {
  const resolvedPath = await fs.realpath(resolve(executablePath)).catch(() => resolve(executablePath));
  for (const ws of state.workspaces || []) {
    if (!ws?.path) continue;
    const wsResolved = await fs.realpath(resolve(ws.path)).catch(() => resolve(ws.path));
    if (within(wsResolved, resolvedPath)) {
      return "Không được chọn tệp thực thi nằm trong thư mục dự án (workspace) để tránh thực thi mã không tin cậy.";
    }
  }
  return "";
}

function buildTelemetrySummary() {
  return computeTelemetrySummary(state.tasks, running.size);
}

function publicState() {
  return {
    frontendVersion: "preact-vite",
    settings: state.settings,
    workspaces: state.workspaces.map((w) => ({ ...w, status: w.runtime || null })),
    tasks: state.tasks.map((task) => {
      const { _currentStageUsage, ...publicTask } = task;
      return {
        ...publicTask,
        attachments: task.attachments?.length ? task.attachments.map(({ name }) => ({ name })) : task.attachments,
        chatMessages: task.chatMessages?.length
          ? task.chatMessages.map((msg) => (msg.attachments?.length ? { ...msg, attachments: msg.attachments.map(({ name }) => ({ name })) } : msg))
          : task.chatMessages,
        processRunning: running.has(task.id),
      };
    }),
    memories,
    memoryCount: memories.length,
    telemetry: buildTelemetrySummary(),
    serverTime: new Date().toISOString(),
  };
}

function relevantMemory(task, workspace) {
  return queryRelevantMemory(task, workspace, memories);
}

function autoDistillTaskMemory(task, workspace) {
  return distillTaskMemory(task, workspace, memories, persistMemory);
}
function areTaskDependenciesMet(task) {
  const deps = Array.isArray(task?.dependsOn) ? task.dependsOn : [];
  if (!deps.length) return true;
  for (const depRef of deps) {
    const ref = String(depRef || "").trim();
    if (!ref) continue;
    const parent = state.tasks.find(
      (item) => item.id === ref || (item.code && String(item.code).toUpperCase() === ref.toUpperCase())
    );
    if (parent && parent.id !== task.id && parent.status !== "done") {
      return false;
    }
  }
  return true;
}
function recordTaskCycle(task, cycleInput) {
  task.cycles ||= [];
  task.costUsd = estimateTaskCostUsd(task.usage);
  const entry = {
    id: cycleInput.id || `cycle-${randomUUID().slice(0, 8)}`,
    round: Number(cycleInput.round || task.currentRound || 1),
    stage: String(cycleInput.stage || "build"),
    title: String(cycleInput.title || `Round ${Number(cycleInput.round || 1)} · ${cycleInput.stage || "stage"}`),
    provider: String(cycleInput.provider || "Agent"),
    model: String(cycleInput.model || ""),
    status: String(cycleInput.status || "clean"),
    badge: String(cycleInput.badge || "clean"),
    blocking: Number(cycleInput.blocking || 0),
    advisory: Number(cycleInput.advisory || 0),
    turns: Math.max(1, Number(cycleInput.turns || 1)),
    durationMs: Math.max(0, Number(cycleInput.durationMs || 0)),
    durationMin: Math.max(1, Math.round(Math.max(1000, Number(cycleInput.durationMs || 1000)) / 60000)),
    costUsd: Number(cycleInput.costUsd ?? task.costUsd ?? 0),
    summary: String(cycleInput.summary || "").slice(0, 1200),
    completedAt: new Date().toISOString(),
  };
  const existingIdx = task.cycles.findIndex((item) => item.id === entry.id || (item.round === entry.round && item.stage === entry.stage));
  if (existingIdx >= 0) task.cycles[existingIdx] = entry;
  else task.cycles.push(entry);
  task.cycles = task.cycles.slice(-24);
}
async function resolveSafeExecCommand(rawCommand, cwd) {
  const cmd = String(rawCommand || "npm test").trim();
  const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
  const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";
  const presets = {
    "npm test": { executable: npmBin, args: ["test"], label: "npm test" },
    "npm run build": { executable: npmBin, args: ["run", "build"], label: "npm run build" },
    "npm run lint": { executable: npmBin, args: ["run", "lint"], label: "npm run lint" },
    "npm run check": { executable: npmBin, args: ["run", "check"], label: "npm run check" },
    "npm run typecheck": { executable: npmBin, args: ["run", "typecheck"], label: "npm run typecheck" },
    "node --test": { executable: process.execPath, args: ["--test"], label: "node --test" },
    "pytest": { executable: process.platform === "win32" ? "pytest.exe" : "pytest", args: ["-q"], label: "pytest -q" },
    "cargo test": { executable: process.platform === "win32" ? "cargo.exe" : "cargo", args: ["test"], label: "cargo test" },
    "go test ./...": { executable: process.platform === "win32" ? "go.exe" : "go", args: ["test", "./..."], label: "go test ./..." },
    "git status": { executable: "git", args: ["status", "--short", "--branch"], label: "git status --short --branch" },
    "git status --short": { executable: "git", args: ["status", "--short"], label: "git status --short" },
    "git log": { executable: "git", args: ["log", "-n", "8", "--oneline", "--decorate"], label: "git log -n 8 --oneline" },
    "git diff --stat": { executable: "git", args: ["diff", "--stat"], label: "git diff --stat" },
    "vitest run": { executable: npxBin, args: ["--no-install", "vitest", "run"], label: "npx vitest run" },
  };
  if (presets[cmd]) return presets[cmd];
  const npmRunMatch = cmd.match(/^npm\s+run\s+([\w:.-]{1,64})$/);
  if (npmRunMatch) {
    const scriptName = npmRunMatch[1];
    try {
      const pkgRaw = await fs.readFile(resolve(cwd, "package.json"), "utf8");
      const pkg = JSON.parse(pkgRaw);
      if (pkg?.scripts && Object.prototype.hasOwnProperty.call(pkg.scripts, scriptName)) {
        return { executable: npmBin, args: ["run", scriptName], label: `npm run ${scriptName}` };
      }
    } catch { }
    throw new Error(`Script "${scriptName}" không tồn tại trong package.json của workspace.`);
  }
  throw new Error("Chỉ cho phép chạy các lệnh kiểm thử/build chuẩn trong danh sách an toàn hoặc script có trong package.json.");
}
async function runTaskQaCheck(task, cwd, rawCommand = "") {
  const targetCwd = cwd || task.executionPath || task.workspacePath;
  if (!targetCwd || !existsSync(targetCwd)) throw new Error("Thư mục thực thi của task không tồn tại.");
  let commandToRun = String(rawCommand || task.qaCommand || "").trim();
  if (!commandToRun) {
    try {
      const pkg = JSON.parse(await fs.readFile(resolve(targetCwd, "package.json"), "utf8"));
      if (pkg?.scripts?.test) commandToRun = "npm test";
      else if (pkg?.scripts?.check) commandToRun = "npm run check";
      else if (pkg?.scripts?.build) commandToRun = "npm run build";
    } catch { }
  }
  if (!commandToRun) commandToRun = "git status";
  const resolved = await resolveSafeExecCommand(commandToRun, targetCwd);
  const startedAt = Date.now();
  record(task, `Đang chạy kiểm tra QA / Terminal · ${resolved.label}`, "tool", {
    toolName: "qa-runner",
    command: resolved.label,
    status: "running",
  });
  const res = await run(resolved.executable, resolved.args, { cwd: targetCwd, timeout: 90_000, maxBuffer: 500_000 });
  const durationMs = Date.now() - startedAt;
  const combinedOutput = `${res.stdout || ""}${res.stderr ? `\n${res.stderr}` : ""}`.trim().slice(-16_000);
  const passed = res.code === 0;
  const qaResult = {
    command: resolved.label,
    status: passed ? "passed" : "failed",
    code: res.code,
    exitCode: res.code,
    durationMs,
    durationSec: Math.max(1, Math.round(durationMs / 1000)),
    summary: passed ? `${resolved.label} · PASS (${(durationMs / 1000).toFixed(1)}s)` : `${resolved.label} · FAIL (mã ${res.code})`,
    output: combinedOutput || (passed ? "Hoàn tất thành công (mã thoát 0)." : `Lệnh trả về mã lỗi ${res.code}.`),
    completedAt: new Date().toISOString(),
  };
  task.qaResult = qaResult;
  task.terminalHistory ||= [];
  task.terminalHistory.unshift({
    id: `term-${randomUUID().slice(0, 8)}`,
    ...qaResult,
  });
  task.terminalHistory = task.terminalHistory.slice(0, 20);
  record(task, `Hoàn tất ${resolved.label} · ${passed ? "PASSED" : `FAILED (code ${res.code})`}`, passed ? "success" : "warning", {
    toolName: "qa-runner",
    command: resolved.label,
    exitCode: res.code,
    detail: qaResult.output.slice(0, 600),
    status: "done",
  });
  return qaResult;
}
function projectSourceFolders(task, workspace) {
  if (!usesSharedCheckout(task)) return [task.executionPath || task.workspacePath || workspace?.path].filter(Boolean);
  const folders = workspace?.sourceFolders?.length ? workspace.sourceFolders : [workspace?.path];
  return [...new Set(folders.filter(Boolean))];
}
function additionalWritableProjectDirs(task, cwd) {
  if (!usesSharedCheckout(task)) return [];
  const workspace = state.workspaces.find((item) => item.id === task.workspaceId);
  return projectSourceFolders(task, workspace).filter((directory) => directory.toLowerCase() !== String(cwd).toLowerCase() && !isForbiddenSystemPath(directory));
}
function roleLabel(role) { return workflowRoles.find((item) => item.id === role)?.label || role; }
function stageSelection(task, stage) {
  return roleConfig(task.config, stage) || { provider: "codex", model: task.config.codexModel, effort: task.config.codexEffort };
}
function normalizeTaskPresetProfile(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Cấu hình mẫu tác vụ không hợp lệ.");
  const workflow = String(input.workflow || "");
  if (!["chat-only", "plan-only", "codex-antigravity"].includes(workflow)) throw new Error("Luồng trong mẫu tác vụ không hợp lệ.");
  const permissionPreset = String(input.permissionPreset || "workspace-write");
  if (!["read-only", "workspace-write", "full-access"].includes(permissionPreset)) throw new Error("Preset quyền trong mẫu không hợp lệ.");
  const selection = (value, label) => {
    const provider = String(value?.provider || "").trim();
    const model = String(value?.model || "").trim();
    const effort = String(value?.effort || "").trim();
    if (!/^[a-z][a-z0-9-]{1,39}$/.test(provider) || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(model) || !/^[A-Za-z][A-Za-z0-9-]{0,29}$/.test(effort)) {
      throw new Error(`Cấu hình ${label} trong mẫu tác vụ không hợp lệ.`);
    }
    return { provider, model, effort };
  };
  const roles = {};
  if (workflow === "plan-only" || workflow === "codex-antigravity") {
    for (const role of workflowRoles) {
      if (workflow === "plan-only" && role.id !== "plan") continue;
      roles[role.id] = selection(input.roles?.[role.id], role.label);
    }
  }
  if (workflow === "chat-only") {
    const chat = selection({ provider: input.chatProvider, model: input.chatModel, effort: input.chatEffort }, "chat");
    return { workflow, permissionPreset, roles, chatProvider: chat.provider, chatModel: chat.model, chatEffort: chat.effort };
  }
  return { workflow, permissionPreset, roles };
}
function supportedRerunStages(task) {
  if (task.config?.workflow === "chat-only") return ["chat"];
  return task.config?.workflow === "plan-only" ? ["plan"] : ["plan", "build", "review"];
}
function inferredRerunStage(task) {
  if (task.config?.workflow === "chat-only") return "chat";
  return task.failedPhase || (task.implementation?.startsWith("Antigravity hoàn tất (CLI trả mã 0)") ? "build" : task.plan ? task.implementation ? "review" : "build" : "plan");
}
function stageOutputSnapshot(value) {
  const text = String(value || "");
  const limit = 40_000;
  return { text: text.slice(0, limit), truncated: text.length > limit };
}
function createStageRerunSnapshot(task, stage, now) {
  const order = task.config?.workflow === "chat-only" ? ["chat"] : task.config?.workflow === "plan-only" ? ["plan"] : ["plan", "build", "review"];
  const start = Math.max(0, order.indexOf(stage));
  const affected = new Set(order.slice(start));
  const previousOutputs = {};
  if (affected.has("plan") && task.plan) previousOutputs.plan = stageOutputSnapshot(task.plan);
  if (affected.has("build") && task.implementation) previousOutputs.build = stageOutputSnapshot(task.implementation);
  if (affected.has("review") && task.review) previousOutputs.review = stageOutputSnapshot(task.review);
  return {
    id: randomUUID(), stage, status: "queued", requestedAt: now,
    previousOutputs,
    previousArtifacts: (task.artifacts || []).slice(0, 100),
    previousExecutionPath: task.executionPath || "",
  };
}
function requestedRole(body, roleId, connectors) {
  const defaults = state.settings.defaults || {};
  const saved = defaults.roles?.[roleId] || roleConfig(defaults, roleId);
  const submitted = body.roles?.[roleId] || {};
  const provider = String(submitted.provider || body[`${roleId}Provider`] || saved?.provider || "");
  const connector = connectors[provider];
  const model = String(submitted.model || body[`${roleId}Model`] || saved?.model || connector?.models?.[0]?.id || "");
  const modelInfo = connector?.models?.find((item) => item.id === model);
  const effort = String(submitted.effort || body[`${roleId}Effort`] || saved?.effort || modelInfo?.efforts?.find((item) => item === "medium") || modelInfo?.efforts?.[0] || "");
  return { provider, model, effort };
}
function validateAgentSelection(selection, capability, connectors) {
  const connector = connectors[selection.provider];
  if (!connector?.available || !connector.capabilities?.[capability]) return `${publicProviderName(selection.provider)} chưa sẵn sàng hoặc không hỗ trợ vai trò ${roleLabel(capability)}.`;
  if (selection.provider === "codex" && !connector.authenticated) return "Codex CLI chưa đăng nhập.";
  const model = connector.models.find((item) => item.id === selection.model);
  if (!model || !model.efforts.includes(selection.effort)) return `Model hoặc mức suy nghĩ không hợp lệ cho ${publicProviderName(selection.provider)}.`;
  return "";
}
function publicProviderName(provider) { return providerLabel(provider); }
async function listRemoteContextFiles(cwd, maxFiles = 180) {
  return listRemoteContextFilesBase(cwd, maxFiles, git);
}
async function externalWorkspaceContext(task, stage) {
  return buildExternalWorkspaceContext(task, stage, git);
}
function makePrompt(task, stage, plan, memory, workspace, skillInstructionsList = [], roundInfo = null) {
  const memoryText = memory.length ? `\n\nRelevant local memory (only matching notes):\n${memory.map((m) => `- ${m.title}: ${m.content}`).join("\n").slice(0, 4500)}` : "";
  const provider = stageSelection(task, stage).provider;
  const applicableSkills = skillInstructionsList.filter((skill) => skillProviderCompatible(provider, skill.providers || ["codex", "antigravity"]));
  const skillText = applicableSkills.length ? `\n\nSelected skills for ${provider} (follow only when relevant to the user's request):\n${applicableSkills.map((skill) => `<skill name="${skill.name}">\n${skill.instruction}${skill.runtimeDirectory ? `\n\nSupporting files for this skill are available in the task copy at: ${skill.runtimeDirectory}. Read referenced files from there when needed.` : ""}\n</skill>`).join("\n\n")}` : "";
  const goalText = task.goal ? `\n\nLong-term goal:\n${task.goal}${task.goalChecklist?.length ? `\nAcceptance checklist:\n${task.goalChecklist.map((item) => `- [${item.done ? "x" : " "}] ${item.text}`).join("\n")}` : ""}` : "";
  const gateFeedbackText = task.planGateFeedback ? `\n\nHuman Plan Gate guidance / feedback:\n${task.planGateFeedback}` : "";
  const attachmentText = Array.isArray(task.attachments) && task.attachments.length
    ? `\n\nAttached files:\n${task.attachments.map((file) => `### ${String(file.name || "attached file").slice(0, 180)}\n${String(file.content || "")}`).join("\n\n")}`
    : "";
  const context = `Workspace: ${task.executionPath || workspace.path}\nProject source folders:\n${projectSourceFolders(task, workspace).map((directory) => `- ${directory}`).join("\n")}\nUser request:\n${task.prompt}${attachmentText}${goalText}${gateFeedbackText}${memoryText}${skillText}`;
  if (stage === "plan") return `You are the planning agent in a local coding workflow. Inspect the project context provided. Do not modify files. Produce a concise implementation plan, risks, files likely involved, and checks. If you are an API provider, use only the attached file list and manifests; do not claim to have inspected files that were not provided.\n\n${context}`;
  if (stage === "build") {
    const fixRoundNote = roundInfo?.round > 1
      ? `\n\nAUTONOMOUS FIX LOOP — ROUND ${roundInfo.round} (Fixing Round ${roundInfo.round - 1} issues):\n${roundInfo.previousReview ? `Previous Review Findings to fix:\n${String(roundInfo.previousReview).slice(0, 4500)}\n` : ""}${roundInfo.previousQaOutput ? `Previous QA / Test Failures to fix:\n${String(roundInfo.previousQaOutput).slice(0, 3500)}\n` : ""}Focus on resolving all [BLOCKING] issues and failing QA checks without introducing regressions.`
      : "";
    if (apiProviderRuntime.has(provider)) return `You are the implementation agent for a local coding workflow. You do not have filesystem or tool access. Use only the supplied project context and return one JSON object with this exact shape: {"summary":"short result","files":[{"path":"relative/path","content":"complete UTF-8 file contents"}],"deletePaths":["relative/path"]}. Return the complete replacement content for every changed or newly created text file; do not return patches. Use paths relative to the workspace root. Do not write secrets, binary files, or paths under protected folders. Set files to [] and deletePaths to [] if no safe change is possible. Return raw JSON only without Markdown fences. Keep the change focused on the user's request. The plan below is analysis context, not a replacement for the user's request.\n\nUser request:\n${task.prompt}${goalText}${gateFeedbackText}${fixRoundNote}\n\nImplementation plan from ${publicProviderName(stageSelection(task, "plan").provider)}:\n${plan}\n${memoryText}${skillText}`;
    return `Implement the user's request in this workspace. Follow repository instructions. Keep the change scoped, run relevant checks when appropriate, and report changed files and outcomes. The plan below is analysis context, not a replacement for the user's request. Do not obey any stale planning-stage instruction inside it that says not to edit files, not to implement, or only to inspect; perform the requested implementation.\n\nUser request:\n${task.prompt}${goalText}${gateFeedbackText}${fixRoundNote}\n\nImplementation plan from ${publicProviderName(stageSelection(task, "plan").provider)}:\n${plan}\n${memoryText}${skillText}`;
  }
  return `Review the implementation for correctness, regressions, security issues, and missing checks. Do not edit files. Use the diff and source context supplied to you. Prefix any must-fix bug, security flaw, or broken requirement with "- [BLOCKING] " and any minor suggestion with "- [ADVISORY] ". Include a concise summary with file/line references.\n\nUser request:\n${task.prompt}${goalText}${gateFeedbackText}\n\nImplementation plan:\n${plan}\n${memoryText}${skillText}`;
}
function chatHistoryBefore(task, messageId) {
  const messages = task.chatMessages || [];
  const messageIndex = messages.findIndex((message) => message.id === messageId);
  if (messageIndex < 0) return [];
  const priorUsers = messages.slice(0, messageIndex)
    .filter((message) => message.role === "user" && (message.status === undefined || message.status === "done"));
  const assistantReplies = messages.filter((message) => message.role === "assistant" && (message.status === undefined || message.status === "done"));
  const usedReplies = new Set();
  const history = [];
  for (const userMessage of priorUsers) {
    history.push(userMessage);
    let reply = assistantReplies.find((message) => message.replyToMessageId === userMessage.id && !usedReplies.has(message.id));
    if (!reply) reply = assistantReplies.find((message) => !message.replyToMessageId && !usedReplies.has(message.id));
    if (reply) {
      usedReplies.add(reply.id);
      history.push(reply);
    }
  }
  return history.slice(-12).map(({ role, provider, content }) => ({ role, provider, content }));
}
function memoryText(task, workspace = null) {
  const ws = workspace || state.workspaces.find((item) => item.id === task.workspaceId);
  const usedNotes = (task.memoryUsed || []).length
    ? memories.filter((m) => task.memoryUsed.some((u) => u.id === m.id))
    : (ws ? relevantMemory(task, ws) : []);
  return usedNotes.length ? `\n\nRelevant local memory:\n${usedNotes.map((item) => `- ${item.title}: ${item.content}`).join("\n").slice(0, 3500)}` : "";
}
function makeChatPrompt(task, turn) {
  const workspace = state.workspaces.find((item) => item.id === task.workspaceId);
  const history = chatHistoryBefore(task, turn.messageId).slice(-12).map((message) => `${message.role === "user" ? "User" : message.provider || "Assistant"}: ${String(message.content || "").slice(0, 4000)}`).join("\n\n");
  const plan = String(task.plan || "").slice(0, 4500);
  const implementation = String(task.implementation || "").slice(0, 6000);
  const review = String(task.review || "").slice(0, 4000);
  const implementationSection = implementation ? `\n\nSaved implementation summary (truncated if long):\n${implementation}` : "";
  const reviewSection = review ? `\n\nSaved review findings (truncated if long):\n${review}` : "";
  const memSection = memoryText(task, workspace);
  const skillSection = skillInstructions(task, turn?.provider || task.config?.chatProvider || "codex");
  const latestEvents = (task.events || []).filter((event) => ["stage", "handoff", "tool", "error", "success"].includes(event.kind)).slice(-8).map((event) => `- ${String(event.text).slice(0, 220)}`).join("\n");
  const goalText = task.goal ? `\n\nLong-term goal:\n${task.goal}${task.goalChecklist?.length ? `\nAcceptance checklist:\n${task.goalChecklist.map((item) => `- [${item.done ? "x" : " "}] ${item.text}`).join("\n")}` : ""}` : "";
  const accessNote = task.permissionPreset === "read-only" ? "You may inspect files but must not edit, create, or delete workspace files." : task.permissionPreset === "full-access" ? "The user explicitly granted full local access for this task. You may run commands and read or modify files anywhere available to the user's operating-system account, but keep changes scoped to the request." : "You may inspect or edit files to fulfill the new request, but keep changes scoped to what the user asks; inspect only files relevant to the request.";
  const attachments = Array.isArray(turn.attachments) ? turn.attachments : [];
  const attachmentText = attachments.length
    ? `\n\nAttached files:\n${attachments.map((file) => `### ${String(file.name || "attached file").slice(0, 180)}\n${String(file.content || "")}`).join("\n\n")}`
    : "";
  return `Continue the user's OpenSybau conversation for this real workspace. Answer in the user's language. ${accessNote} The latest user message defines this chat turn and may request work that differs from the long-term goal. Follow that explicit request for this turn, briefly point out a conflict with the saved goal, and never silently change the saved goal. If the user wants a lasting direction change, tell them to update it through the Goal control. Do not reveal private chain-of-thought; give a concise rationale, actions, and results.\n\nWorkspace: ${task.executionPath || task.workspacePath}\nProject source folders:\n${projectSourceFolders(task, workspace).map((directory) => `- ${directory}`).join("\n")}\nOriginal task: ${String(task.prompt).slice(0, 5000)}${goalText}${memSection}${skillSection}\nSaved plan (truncated if long):\n${plan || "No plan saved."}${implementationSection}${reviewSection}\n\nRecent observable activity:\n${latestEvents || "No activity recorded."}\n\nRecent conversation:\n${history || "No earlier chat messages."}\n\nNew user message:\n${String(turn.content).slice(0, 50000)}${attachmentText}`;
}
function makeInitialChatPrompt(task, memory, skillInstructionsList, workspace) {
  const memText = memory.length ? `\n\nRelevant local memory:\n${memory.map((item) => `- ${item.title}: ${item.content}`).join("\n").slice(0, 3500)}` : "";
  const provider = task.config.chatProvider || "codex";
  const applicableSkills = skillInstructionsList.filter((skill) => skillProviderCompatible(provider, skill.providers || ["codex", "antigravity"]));
  const skillText = applicableSkills.length ? `\n\nSelected local skills:\n${applicableSkills.map((skill) => `- ${skill.name}: ${String(skill.instruction).slice(0, 5000)}`).join("\n\n").slice(0, 7000)}` : "";
  const goalText = task.goal ? `\n\nLong-term goal:\n${task.goal}${task.goalChecklist?.length ? `\nAcceptance checklist:\n${task.goalChecklist.map((item) => `- [${item.done ? "x" : " "}] ${item.text}`).join("\n")}` : ""}` : "";
  const readOnly = task.permissionPreset === "read-only";
  const accessNote = provider === "claude-api" || apiProviderRuntime.has(provider) ? "You cannot access the local filesystem or execute tools. Use only information in this prompt; never claim to have inspected or changed files." : readOnly ? "You may inspect files but must not edit, create, or delete workspace files." : task.permissionPreset === "full-access" ? "The user explicitly granted full local access for this task. You may run commands and access files anywhere available to the user's operating-system account, while keeping changes scoped to the request." : "Inspect relevant files only when useful. You may edit files only when the user asks for a change; keep edits scoped.";
  const attachmentText = Array.isArray(task.attachments) && task.attachments.length
    ? `\n\nAttached files:\n${task.attachments.map((file) => `### ${String(file.name || "attached file").slice(0, 180)}\n${String(file.content || "")}`).join("\n\n")}`
    : "";
  return `You are ${publicProviderName(provider)} in a continuing local project conversation. Answer in the user's language. Be conversational and concise. ${accessNote} Treat the user's latest explicit request as the work for this turn. If it differs from the saved long-term goal, briefly point out the conflict, follow the request for this turn, and do not silently change the saved goal. Never reveal private chain-of-thought; summarize your rationale, actions, and results.\n\nWorkspace: ${task.executionPath || workspace.path}\nProject: ${workspace.name}\nProject source folders:\n${projectSourceFolders(task, workspace).map((directory) => `- ${directory}`).join("\n")}${goalText}${memText}${skillText}\n\nUser message:\n${String(task.prompt).slice(0, 50000)}${attachmentText}`;
}
function addTaskUsage(task, provider, usage) {
  if (!usage || typeof usage !== "object") return;
  task.usage ||= {};
  const prev = task.usage[provider] && typeof task.usage[provider] === "object" ? task.usage[provider] : {};
  const next = { ...prev };
  const numericFields = ["input_tokens", "output_tokens", "total_tokens", "cached_input_tokens", "prompt_tokens", "completion_tokens"];
  for (const [k, v] of Object.entries(usage)) {
    if (numericFields.includes(k) || typeof v === "number") {
      const num = Number(v);
      if (Number.isFinite(num)) next[k] = (Number(prev[k]) || 0) + num;
    } else if (v !== undefined) {
      next[k] = v;
    }
  }
  if (usage.prompt_tokens !== undefined && usage.input_tokens === undefined) {
    next.input_tokens = (Number(prev.input_tokens) || 0) + (Number(usage.prompt_tokens) || 0);
  }
  if (usage.completion_tokens !== undefined && usage.output_tokens === undefined) {
    next.output_tokens = (Number(prev.output_tokens) || 0) + (Number(usage.completion_tokens) || 0);
  }
  if (next.total_tokens === undefined && (next.input_tokens !== undefined || next.output_tokens !== undefined)) {
    next.total_tokens = (Number(next.input_tokens) || 0) + (Number(next.output_tokens) || 0);
  }
  task.usage[provider] = next;
}
function parseCodexEvent(line, task, outputParts) {
  let event;
  try { event = JSON.parse(line); } catch { return; }
  const item = event.item || {};
  if (event.type === "item.started" && ["command_execution", "mcp_tool_call", "collab_tool_call", "tool_call", "file_change"].includes(item.type)) {
    const tool = item.name || item.tool || item.server_label || (item.type === "command_execution" ? "terminal" : item.type === "file_change" ? "edit" : item.type === "collab_tool_call" ? "subagent" : item.type);
    const cmd = item.command ? (Array.isArray(item.command) ? item.command.join(" ") : String(item.command)).slice(0, 240) : "";
    const filePath = item.changes?.[0]?.path || item.path || "";
    record(task, `Codex gọi công cụ · ${String(tool).slice(0, 120)}${cmd ? ` · ${cmd.slice(0, 80)}` : filePath ? ` · ${filePath}` : ""}`, "tool", { toolName: String(tool).slice(0, 120), command: cmd || undefined, filePath: filePath || undefined, status: "running" });
  }
  if (event.type === "item.completed" && ["command_execution", "mcp_tool_call", "collab_tool_call", "tool_call", "file_change"].includes(item.type)) {
    const tool = item.name || item.tool || item.server_label || (item.type === "command_execution" ? "terminal" : item.type === "file_change" ? "edit" : item.type === "collab_tool_call" ? "subagent" : item.type);
    const cmd = item.command ? (Array.isArray(item.command) ? item.command.join(" ") : String(item.command)).slice(0, 240) : "";
    const filePath = item.changes?.[0]?.path || item.path || "";
    const exitCode = item.exit_code ?? null;
    const detail = String(item.aggregated_output || item.output || "").trim().slice(0, 600);
    record(task, `Codex hoàn tất công cụ · ${String(tool).slice(0, 120)}${cmd ? ` · ${cmd.slice(0, 80)}` : filePath ? ` · ${filePath}` : ""}`, "tool", { toolName: String(tool).slice(0, 120), command: cmd || undefined, filePath: filePath || undefined, exitCode, detail: detail || undefined, status: "done" });
  }
  if (event.type === "item.completed" && event.item?.type === "agent_message" && event.item.text) { outputParts.push(event.item.text); record(task, event.item.text.slice(-1500), "output"); }
  if (event.type === "turn.completed" && event.usage) { addTaskUsage(task, "codex", event.usage); task._currentStageUsage = event.usage; }
  if (event.type === "error" || event.type === "turn.failed") {
    const errMsg = event.message || event.error?.message || "Codex reported an error";
    task.stageFailure = String(errMsg);
    record(task, errMsg, "error");
  }
}
function parseAgyEvent(line, task, outputParts) {
  let event;
  try { event = JSON.parse(line); } catch { return record(task, line, "output"); }
  const type = String(event.type || event.event || "").toLowerCase();
  const update = event.step_update || {};
  const message = event.message;
  const deltaText = event.delta?.text || update.text_delta || "";
  const messageText = typeof message === "string" ? message : message?.text || message?.content?.map?.((part) => part.text || "").join("") || "";
  const fullText = event.text || (typeof event.content === "string" ? event.content : "") || event.response || messageText || "";
  if (deltaText && typeof deltaText === "string") {
    outputParts.push(deltaText);
    record(task, deltaText.slice(-1500), "output");
  } else if (fullText && typeof fullText === "string") {
    const accumulated = outputParts.join("");
    if (outputParts.length > 0 && (fullText === accumulated || fullText.includes(accumulated))) {
      outputParts.length = 0;
      outputParts.push(fullText);
      const last = task.events?.at(-1);
      if (last?.kind === "output") {
        last.at = new Date().toISOString();
        last.text = fullText.slice(-1500);
        task.updatedAt = last.at;
        schedulePersist();
        schedulePublish("task");
      } else {
        record(task, fullText.slice(-1500), "output");
      }
    } else if (!accumulated.endsWith(fullText)) {
      outputParts.push(fullText);
      record(task, fullText.slice(-1500), "output");
    }
  }
  const usageObj = (type === "result" && event.result?.usage) || event.usage || update.usage || null;
  if (usageObj) { addTaskUsage(task, "antigravity", usageObj); task._currentStageUsage = usageObj; }
  const toolError = update.tool_info?.error ? String(update.tool_info.error.message || update.tool_info.error) : "";
  if (type === "result" && event.result) {
    if (event.result.response && typeof event.result.response === "string") {
      const respText = event.result.response;
      const accumulated = outputParts.join("");
      if (!outputParts.length) {
        outputParts.push(respText);
        record(task, respText.slice(-1500), "output");
      } else if (respText === accumulated || respText.includes(accumulated)) {
        outputParts.length = 0;
        outputParts.push(respText);
      }
    }
    if (event.result.status && event.result.status !== "SUCCESS") task.stageFailure = event.result.error || `Antigravity status: ${event.result.status}`;
    else task.stageFailure = null;
  }
  const toolName = event.name || event.tool_name || event.tool?.name || update.tool_info?.name;
  const toolArgs = update.tool_info?.args || event.tool?.args || event.args || {};
  const filePath = String(toolArgs?.path || toolArgs?.file || toolArgs?.TargetFile || toolArgs?.AbsolutePath || "").slice(0, 200);
  const cmd = String(toolArgs?.command || toolArgs?.CommandLine || "").slice(0, 240);
  if (["tool_start", "tool_call", "tool.started", "tool_result", "tool.completed", "tool_use", "tool_result"].includes(type) || update.tool_info) {
    record(task, `Antigravity · ${type || "tool"}${toolName ? ` · ${String(toolName).slice(0, 120)}` : ""}${filePath ? ` · ${filePath}` : cmd ? ` · ${cmd.slice(0, 80)}` : ""}${toolError ? ` · ${toolError.slice(0, 120)}` : ""}`, "tool", {
      toolName: toolName ? String(toolName).slice(0, 120) : "tool",
      filePath: filePath || undefined,
      command: cmd || undefined,
      detail: toolError ? toolError.slice(0, 600) : undefined,
      status: toolError ? "done" : (type.includes("result") || type.includes("completed") ? "done" : "running"),
    });
  }
}
async function spawnStage(task, provider, stage, cwd, prompt, selectionOverride = null) {
  const stageStartedAt = Date.now();
  task._currentStageUsage = null;
  task.stageFailure = null;
  assertTaskActive(task);
  const selection = selectionOverride || (workflowRoles.some((role) => role.id === stage) ? stageSelection(task, stage) : {
    provider: task.config.chatProvider || "codex", model: task.config.chatModel || task.config.codexModel, effort: task.config.chatEffort || task.config.codexEffort,
  });
  const connector = (await loadModels())[provider];
  assertTaskActive(task);
  if (!connector?.available) throw new Error(connector?.error || `${publicProviderName(provider)} chưa sẵn sàng.`);
  const capability = stage === "plan" || stage === "review" ? stage : stage === "build" ? "build" : "chat";
  if (!connector.capabilities?.[capability]) throw new Error(`${publicProviderName(provider)} không hỗ trợ vai trò ${roleLabel(capability)}.`);
  if (task.permissionPreset === "read-only" && stage === "build") throw new Error("Preset chỉ đọc đang bật; không chạy stage triển khai để tránh sửa workspace.");
  if (task.permissionPreset === "read-only" && provider === "antigravity") throw new Error("Antigravity CLI chưa có chế độ chỉ đọc cho lần chạy nền của OpenSybau. Hãy chọn Codex/Claude/API hoặc đổi preset quyền.");
  if (!connector.models?.some((item) => item.id === selection.model && item.efforts.includes(selection.effort))) throw new Error(`Model hoặc mức suy nghĩ không hợp lệ cho ${publicProviderName(provider)}.`);

  record(task, `${publicProviderName(provider)} bắt đầu · ${roleLabel(stage)} · ${selection.model} (${selection.effort})`, "stage");
  if (connector.kind === "api") {
    const providerRuntime = apiProviderRuntime.get(provider);
    if (!providerRuntime) throw new Error(`${publicProviderName(provider)} chưa được cấu hình đầy đủ.`);
    const controller = new AbortController();
    const runInfo = running.get(task.id);
    if (runInfo) runInfo.abortController = controller;
    const timeout = setTimeout(() => controller.abort(new Error("API provider timeout after 120 seconds.")), 120_000);
    try {
      const isChatStage = stage === "chat-initial" || String(stage).startsWith("chat-");
      const remoteContext = ["plan", "build", "review"].includes(stage) || isChatStage ? await externalWorkspaceContext(task, isChatStage ? "plan" : stage) : null;
      assertTaskActive(task);
      const remotePrompt = remoteContext ? `${prompt}${remoteContext.text}` : prompt;
      const result = await completeWithApi(providerRuntime, selection.model, remotePrompt, controller.signal);
      if (result.usage) addTaskUsage(task, provider, result.usage);
      task._currentStageUsage = result.usage || null;
      const output = stage === "build" ? await applyApiBuildResult(cwd, result.content, remoteContext?.buildSnapshotHashes || new Map()) : String(result.content || "").trim();
      await fs.writeFile(resolve(task.storagePath, `${stage}.md`), output, "utf8");
      record(task, output.slice(-1500), "output");
      task.stageMetrics ||= [];
      task.stageMetrics.push({ provider, stage, durationMs: Date.now() - stageStartedAt, usage: task._currentStageUsage, completedAt: new Date().toISOString() });
      task.stageMetrics = task.stageMetrics.slice(-500);
      return output;
    } finally {
      clearTimeout(timeout);
      if (runInfo?.abortController === controller) runInfo.abortController = null;
    }
  }

  const outputPath = resolve(task.storagePath, `${stage}.md`);
  await fs.rm(outputPath, { force: true }).catch(() => {});

  let exe;
  let args;
  if (provider === "codex") {
    exe = codexExe;
    const projectDirs = additionalWritableProjectDirs(task, cwd);
    const sandboxArgs = task.permissionPreset === "full-access"
      ? ["--dangerously-bypass-approvals-and-sandbox"]
      : ["--sandbox", task.permissionPreset === "read-only" || !(stage === "build" || stage.startsWith("chat-") || stage === "chat-initial") ? "read-only" : "workspace-write"];
    args = [
      ...(task.permissionPreset !== "full-access" && process.platform === "win32" ? ["--config", 'windows.sandbox="unelevated"'] : []),
      "--disable", "unified_exec", "--ask-for-approval", "never", "exec", "--json", "--ephemeral", "--skip-git-repo-check", ...sandboxArgs, "-C", cwd, "--model", selection.model, "--config", `model_reasoning_effort=${JSON.stringify(selection.effort)}`, "--output-last-message", outputPath, ...projectDirs.flatMap((directory) => ["--add-dir", directory]), "-",
    ];
  } else if (provider === "antigravity") {
    exe = agyExe;
    const modelEffort = selection.model.match(/-(low|medium|high|xhigh|max)$/)?.[1] || selection.effort;
    const additionalDirs = [...new Map([...(task.antigravitySkillDirs || []), ...additionalWritableProjectDirs(task, cwd)].map((directory) => [directory.toLowerCase(), directory])).values()];
    args = [...additionalDirs.flatMap((directory) => ["--add-dir", directory]), "--prompt", "Follow the complete task instructions supplied on stdin.", "--output-format", "stream-json", "--model", selection.model, "--effort", modelEffort, ...(task.permissionPreset === "full-access" ? ["--dangerously-skip-permissions"] : ["--sandbox"]), "--print-timeout", "0"];
  } else if (provider === "claude") {
    exe = claudeExe;
    const additionalDirs = additionalWritableProjectDirs(task, cwd);
    args = [...claudeCommand.prefixArgs, "-p", "--model", selection.model, "--output-format", "json", "--permission-mode", task.permissionPreset === "full-access" ? "bypassPermissions" : task.permissionPreset === "read-only" || stage === "plan" || stage === "review" ? "plan" : "acceptEdits", "--max-turns", "20", ...additionalDirs.flatMap((directory) => ["--add-dir", directory])];
  } else {
    throw new Error(`Provider ${provider} không có bộ chạy cục bộ.`);
  }
  return new Promise((resolvePromise, rejectPromise) => {
    const childEnv = { ...process.env, NO_COLOR: "1", ...(exe === process.execPath ? { ELECTRON_RUN_AS_NODE: "1" } : {}) };
    if (exe !== process.execPath) delete childEnv.ELECTRON_RUN_AS_NODE;
    const child = spawn(exe, args, { cwd, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: childEnv });
    const runInfo = running.get(task.id);
    if (runInfo) runInfo.child = child;
    const stageIdleTimeoutMs = Number(process.env.WORKBENCH_STAGE_TIMEOUT_MS) || 15 * 60 * 1000;
    let idleTimedOut = false;
    let idleTimer = null;
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimedOut = true;
        if (runInfo) runInfo.stopped = false;
        killTree(child);
        child.stdout?.destroy();
        child.stderr?.destroy();
        rejectPromise(new Error("Tiến trình CLI không phản hồi quá thời gian chờ (timeout)."));
      }, stageIdleTimeoutMs);
      idleTimer.unref?.();
    };
    resetIdleTimer();
    let pending = "";
    let stdoutRaw = "";
    const outputParts = [];
    let stderrTail = "";
    child.stdout.on("error", () => {});
    child.stderr.on("error", () => {});
    const onStdout = (chunk) => {
      resetIdleTimer();
      const text = chunk.toString();
      if (provider === "claude") {
        if (stdoutRaw.length < 10_000_000) stdoutRaw += text;
        return;
      }
      pending += text;
      let index;
      while ((index = pending.indexOf("\n")) >= 0) {
        const line = pending.slice(0, index).trim();
        pending = pending.slice(index + 1);
        if (!line) continue;
        if (provider === "codex") parseCodexEvent(line, task, outputParts); else parseAgyEvent(line, task, outputParts);
      }
    };
    child.stdout.on("data", onStdout);
    child.stderr.on("data", (chunk) => {
      resetIdleTimer();
      stderrTail = (stderrTail + chunk.toString()).slice(-5000);
    });
    child.on("error", (error) => {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      if (!idleTimedOut) rejectPromise(error);
    });
    child.on("close", async (code) => {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      if (idleTimedOut) return;
      if (pending.trim()) { if (provider === "codex") parseCodexEvent(pending.trim(), task, outputParts); else parseAgyEvent(pending.trim(), task, outputParts); }
      if (running.get(task.id)?.stopped) return rejectPromise(new Error("Stopped by user"));
      let output = "";
      if (provider === "claude" && stdoutRaw.trim()) {
        try {
          const data = JSON.parse(stdoutRaw.trim());
          output = String(data.result || data.message || "").trim();
          if (data.usage) { addTaskUsage(task, "claude", data.usage); task._currentStageUsage = data.usage; }
          if (data?.is_error) {
            task.stageFailure = String(data.result || data.error || "Claude CLI báo lỗi thực thi.").trim();
          }
        } catch { output = stdoutRaw.trim(); }
      }
      if (code !== 0) return rejectPromise(new Error(task.stageFailure || stderrTail.trim() || `${publicProviderName(provider)} exited with code ${code}`));
      if (task.stageFailure) return rejectPromise(new Error(task.stageFailure.slice(0, 8000)));
      if (!output) { try { output = (await fs.readFile(outputPath, "utf8")).trim(); } catch { } }
      if (!output) output = outputParts.join("").trim();
      task.stageMetrics ||= [];
      task.stageMetrics.push({ provider, stage, durationMs: Date.now() - stageStartedAt, usage: task._currentStageUsage || null, completedAt: new Date().toISOString() });
      task.stageMetrics = task.stageMetrics.slice(-500);
      resolvePromise(output);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(prompt);
  });
}
function mergeTaskArtifacts(existing = [], latest = []) {
  return [...new Set([...(Array.isArray(existing) ? existing : []), ...(Array.isArray(latest) ? latest : [])])].sort();
}
async function cleanupTaskWorktrees(task) {
  const workspace = state.workspaces.find((w) => w.id === task.workspaceId);
  const repoCandidate = workspace?.path || task.workspacePath;
  let repoRoot = null;
  if (repoCandidate && existsSync(repoCandidate)) {
    const info = await inspectWorkspace(repoCandidate).catch(() => null);
    if (info?.isGit) repoRoot = info.gitRoot || info.path;
  }
  const candidateDirs = new Set();
  if (task.worktreePath && within(worktreeDir, resolve(task.worktreePath)) && resolve(task.worktreePath) !== resolve(worktreeDir)) {
    candidateDirs.add(resolve(task.worktreePath));
  }
  try {
    const entries = await fs.readdir(worktreeDir, { withFileTypes: true });
    const prefix = `${task.id.toLowerCase()}-`;
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.toLowerCase().startsWith(prefix)) {
        candidateDirs.add(resolve(worktreeDir, entry.name));
      }
    }
  } catch { }
  if (!candidateDirs.size && !repoRoot) return;
  await withGitRepoLock(repoRoot || worktreeDir, async () => {
    for (const wtPath of candidateDirs) {
      if (repoRoot) await git(repoRoot, ["worktree", "remove", "--force", wtPath]).catch(() => {});
      await fs.rm(wtPath, { recursive: true, force: true }).catch(() => {});
    }
    if (repoRoot) {
      await git(repoRoot, ["worktree", "prune"]).catch(() => {});
      const branches = await git(repoRoot, ["branch", "--list", `workbench/${task.id.toLowerCase()}-*`]).catch(() => ({ code: -1, stdout: "" }));
      if (branches.code === 0 && branches.stdout) {
        for (const rawLine of branches.stdout.split(/\r?\n/)) {
          const branch = rawLine.replace(/^[*+]?\s+/, "").trim();
          if (branch.startsWith(`workbench/${task.id.toLowerCase()}-`)) {
            await git(repoRoot, ["branch", "-D", branch]).catch(() => {});
          }
        }
      }
    }
  });
}
async function executeTask(task) {
  const workspace = state.workspaces.find((w) => w.id === task.workspaceId);
  if (!workspace) throw new Error("Workspace not found");
  const info = await inspectWorkspace(workspace.path);
  assertTaskActive(task);
  let cwd = info.path;
  task.workspaceRuntime = info;
  if (info.dirty && !task.isolated) record(task, "Workspace có thay đổi sẵn; diff sau task sẽ gồm cả thay đổi có trước.", "warning");
  task.storagePath = resolve(taskDir, task.id);
  await fs.mkdir(task.storagePath, { recursive: true });
  if (task.isolated) {
    const previousPath = resolve(task.executionPath || task.worktreePath || ".");
    const canReusePrevious = within(worktreeDir, previousPath) && previousPath !== resolve(worktreeDir) && existsSync(previousPath);
    const previousInfo = canReusePrevious ? await inspectWorkspace(previousPath).catch(() => null) : null;
    const previousRepoIsManaged = previousInfo?.path && within(resolve(worktreeDir), resolve(previousInfo.path)) && resolve(previousInfo.path) !== resolve(worktreeDir);
    if (previousInfo?.isGit && previousInfo.head && previousRepoIsManaged) {
      cwd = previousInfo.path;
      task.worktreePath = previousInfo.gitRoot || previousInfo.path;
    } else {
      if (!info.isGit || !info.head) throw new Error("Worktree requires a Git repository with at least one commit. Turn off isolation or create an initial commit first.");
      const attempt = Date.now().toString(36);
      const worktreeRoot = resolve(worktreeDir, `${task.id}-${attempt}`);
      const branchName = `workbench/${task.id.toLowerCase()}-${attempt}`;
      const repoRoot = info.gitRoot || info.path;
      const baseHead = await git(repoRoot, ["rev-parse", "--verify", "HEAD"]);
      const add = await withGitRepoLock(repoRoot, () => git(repoRoot, ["worktree", "add", "-b", branchName, worktreeRoot, "HEAD"]));
      if (add.code !== 0) throw new Error(add.stderr.trim() || "Could not create isolated Git worktree");
      task.worktreePath = worktreeRoot;
      task.worktreeBranch = branchName;
      task.worktreeBaseHead = baseHead.code === 0 ? (baseHead.stdout || "").trim() : null;
      task.worktreeCleaned = false;
      const selectedSubdirectory = relative(repoRoot, info.path);
      cwd = selectedSubdirectory ? resolve(worktreeRoot, selectedSubdirectory) : worktreeRoot;
      assertTaskActive(task);
    }
  } else {
    const lockKey = workspaceLockKey(info.path);
    const sameWorkspaceActive = [...running.entries()].some(([id, runInfo]) => id !== task.id && workspaceLockKey(runInfo.workspacePath) === lockKey && !runInfo.isolated);
    if (sameWorkspaceActive) throw new Error("This workspace already has a running shared-checkout task");
  }
  task.executionPath = cwd;
  task.status = "running";
  task.startedAt = new Date().toISOString();
  let effectiveResumeFrom = task.resumeFrom || "plan";
  if (effectiveResumeFrom === "build" && !task.plan) effectiveResumeFrom = "plan";
  else if (effectiveResumeFrom === "review" && (!task.plan || !task.implementation)) effectiveResumeFrom = !task.plan ? "plan" : "build";
  task.resumeFrom = task.resumeFrom ? effectiveResumeFrom : null;
  task.phase = task.config.workflow === "chat-only" ? "chat" : effectiveResumeFrom;
  const activeRerun = (task.stageRunHistory || []).find((item) => item.id === task.activeStageRunId);
  if (activeRerun) { activeRerun.status = "running"; activeRerun.startedAt = task.startedAt; }
  persist(); publish("task");
  const notes = relevantMemory(task, workspace);
  task.memoryUsed = notes.map((m) => ({ id: m.id, title: m.title }));
  if (notes.length) record(task, `Đã nạp ${notes.length} ghi chú phù hợp từ bộ nhớ cục bộ`, "memory");
  let skillIds = task.skillIds || [];
  let skillCatalog;
  if (task.skillSelectionMode !== "manual" && !task.skillSelectionCompleted) {
    skillCatalog = await loadSkillCatalog(workspace.id);
    assertTaskActive(task);
    const scoredCandidates = rankSkillCandidatesScored(task, skillCatalog);
    const candidates = scoredCandidates.map(({ skill }) => skill);
    task.skillCandidatesConsidered = candidates.length;
    if (candidates.length) {
      if (task.config.workflow === "chat-only") {
        const strongMatches = scoredCandidates.filter(({ score }) => score >= 10).slice(0, 3);
        skillIds = strongMatches.map(({ skill }) => skill.id);
        task.skillSelectionReason = skillIds.length
          ? `Đã tự động khớp nhanh ${skillIds.length} skill sát nhất với nội dung chat.`
          : "Không có skill nào vượt ngưỡng khớp trực tiếp cho lượt chat này.";
      } else {
        const selector = stageSelection(task, "plan");
        record(task, `${publicProviderName(selector.provider)} đang chọn skill phù hợp từ ${candidates.length} ứng viên tìm được trong thư viện`, "stage");
        const selectionOutput = await spawnStage(task, selector.provider, "skill-selection", cwd, skillSelectionPrompt(task, workspace, candidates), selector);
        const decision = parseSkillSelection(selectionOutput, candidates);
        skillIds = decision.ids;
        task.skillSelectionReason = decision.reason;
      }
    } else {
      skillIds = [];
      task.skillSelectionReason = "Không có skill khớp đủ gần với yêu cầu.";
      record(task, "Không tìm được skill phù hợp trực tiếp; tiếp tục với yêu cầu và workspace làm ngữ cảnh.", "memory");
    }
    task.skillSelectionMode = "auto";
    task.skillSelectionCompleted = true;
  }
  const skillInstructionsList = await resolveSelectedSkills(skillIds, workspace.id, skillCatalog);
  assertTaskActive(task);
  task.antigravitySkillDirs = task.config.workflow === "chat-only" && task.config.chatProvider !== "antigravity" ? [] : await stageAntigravitySkillBundles(task, skillInstructionsList);
  task.skillIds = skillInstructionsList.map((skill) => skill.id);
  task.skills = skillInstructionsList.map(({ id, name, source, sources, providers }) => ({ id, name, source, sources, providers }));
  if (task.skills.length) record(task, `${publicProviderName(task.config.workflow === "chat-only" ? task.config.chatProvider : stageSelection(task, "plan").provider)} tự chọn và nạp ${task.skills.length} skill vào stage phù hợp${task.antigravitySkillDirs.length ? ` · ${task.antigravitySkillDirs.length} bộ tài nguyên Antigravity` : ""}`, "memory");
  else if (task.skillSelectionMode === "auto" && task.skillCandidatesConsidered) record(task, task.skillSelectionReason || "Không chọn skill nào vì không có skill thật sự cần thiết.", "memory");
  persist(); publish("task");
  if (task.config.workflow === "chat-only") {
    const provider = task.config.chatProvider || "codex";
    const message = task.chatMessages?.find((item) => item.role === "user" && item.initialChat) || { id: randomUUID(), role: "user", provider, model: task.config.chatModel, effort: task.config.chatEffort, content: task.prompt, attachments: (task.attachments || []).map(({ name }) => ({ name })), status: "running", initialChat: true, createdAt: task.createdAt };
    task.chatMessages ||= [];
    if (!task.chatMessages.some((item) => item.id === message.id)) task.chatMessages.push(message);
    message.status = "running";
    persist(); record(task, `${publicProviderName(provider)} bắt đầu cuộc trò chuyện · ${task.config.chatModel} (${task.config.chatEffort})`, "stage");
    const chatConfig = { provider, model: task.config.chatModel, effort: task.config.chatEffort };
    try {
      const response = await spawnStage(task, provider, "chat-initial", cwd, makeInitialChatPrompt(task, notes, skillInstructionsList, workspace), chatConfig);
      assertTaskActive(task);
      message.status = "done";
      task.chatMessages.push({ id: randomUUID(), role: "assistant", replyToMessageId: message.id, provider, model: task.config.chatModel, effort: task.config.chatEffort, content: response || "CLI hoàn tất nhưng không trả nội dung văn bản.", createdAt: new Date().toISOString() });
      const answer = task.chatMessages.at(-1);
      const metric = task.stageMetrics?.at(-1);
      if (metric?.stage === "chat-initial") { answer.durationMs = metric.durationMs; answer.usage = metric.usage; }
      task.artifacts = mergeTaskArtifacts(task.artifacts, await changedFilesSince(cwd, Date.parse(task.startedAt)));
      assertTaskActive(task);
      task.status = "done"; task.phase = "done"; task.completedAt = new Date().toISOString();
      finishStageRerun(task, "done");
      record(task, "Cuộc trò chuyện đã sẵn sàng. Bạn có thể tiếp tục với agent đã chọn hoặc chuyển sang agent khác.", "success");
    } catch (error) {
      message.status = "failed";
      throw error;
    } finally { persist(); publish("task"); }
    return;
  }
  const planSelection = stageSelection(task, "plan");
  const planStartedAt = Date.now();
  const hadPlanBefore = Boolean(task.plan);
  const plan = task.plan || await spawnStage(task, planSelection.provider, "plan", cwd, makePrompt(task, "plan", "", notes, workspace, skillInstructionsList), planSelection);
  assertTaskActive(task);
  task.plan = plan;
  if (!hadPlanBefore) {
    recordTaskCycle(task, {
      id: "cycle-plan-1",
      round: 1,
      stage: "plan",
      title: "Round 1 · plan",
      provider: publicProviderName(planSelection.provider),
      model: planSelection.model || "",
      status: task.planGate && !task.planGateApprovedAt ? "awaiting_approval" : "clean",
      badge: task.planGate && !task.planGateApprovedAt ? "awaiting you" : "plan ready",
      blocking: 0,
      advisory: 0,
      turns: 1,
      durationMs: Date.now() - planStartedAt,
      summary: String(plan || "").slice(0, 600),
    });
  }
  if (task.planGate && !task.planGateApprovedAt) {
    assertTaskActive(task);
    task.status = "awaiting_approval";
    task.phase = "plan-gate";
    task.costUsd = estimateTaskCostUsd(task.usage);
    record(task, "Kế hoạch đã sẵn sàng tại Plan Gate (You). Chờ bạn bấm Duyệt & Triển khai (GO) hoặc gửi góp ý điều chỉnh.", "stage");
    persist();
    publish("task");
    return;
  }
  if (task.config.workflow === "plan-only") {
    assertTaskActive(task);
    task.costUsd = estimateTaskCostUsd(task.usage);
    task.status = "done"; task.phase = "done"; task.completedAt = new Date().toISOString();
    finishStageRerun(task, "done");
    autoDistillTaskMemory(task, workspace);
    record(task, "Hoàn tất kế hoạch (chưa chạy phần triển khai)", "success");
    return;
  }
  const buildSelection = stageSelection(task, "build");
  const reviewSelection = stageSelection(task, "review");
  const maxRounds = Math.max(1, Math.min(3, Number(task.maxRounds) || 1));
  let round = Math.max(1, Number(task.currentRound) || 1);
  let previousReview = task.review || "";
  let previousQaOutput = task.qaResult?.output || "";

  while (round <= maxRounds) {
    task.currentRound = round;
    const skipBuildForReviewOnlyRerun = round === 1 && task.resumeFrom === "review" && Boolean(task.implementation);
    if (!skipBuildForReviewOnlyRerun) {
      record(
        task,
        round === 1
          ? `Handoff ${publicProviderName(planSelection.provider)} → ${publicProviderName(buildSelection.provider)} · kế hoạch được chuyển sang stage triển khai.`
          : `Vòng tự sửa lỗi ${round}/${maxRounds} · Chuyển phản hồi Review/QA sang ${publicProviderName(buildSelection.provider)} để khắc phục lỗi blocking.`,
        "handoff"
      );
      task.phase = "build"; persist(); publish("task");
      const buildStartedAt = Date.now();
      const toolCountBefore = (task.events || []).filter((e) => e.kind === "tool").length;
      const implementation = await spawnStage(
        task,
        buildSelection.provider,
        "build",
        cwd,
        makePrompt(task, "build", plan, notes, workspace, skillInstructionsList, { round, previousReview, previousQaOutput }),
        buildSelection
      );
      assertTaskActive(task);
      task.implementation = implementation || `${publicProviderName(buildSelection.provider)} hoàn tất nhưng không gửi văn bản cuối. Kiểm tra danh sách tệp/diff bên dưới.`;
      await fs.writeFile(resolve(task.storagePath, "implementation.md"), task.implementation, "utf8");
      task.artifacts = mergeTaskArtifacts(task.artifacts, await changedFilesSince(cwd, Math.min(Date.parse(task.startedAt) || buildStartedAt, buildStartedAt)));
      const toolTurns = Math.max(1, (task.events || []).filter((e) => e.kind === "tool").length - toolCountBefore);
      recordTaskCycle(task, {
        id: `cycle-build-${round}`,
        round,
        stage: "build",
        title: round > 1 ? `Round ${round} · implement (fix r${round - 1})` : `Round ${round} · implement`,
        provider: publicProviderName(buildSelection.provider),
        model: buildSelection.model || "",
        status: "clean",
        badge: `${(task.artifacts || []).length} files`,
        blocking: 0,
        advisory: 0,
        turns: toolTurns,
        durationMs: Date.now() - buildStartedAt,
        summary: String(task.implementation || "").slice(0, 600),
      });
    }

    record(task, `Handoff ${publicProviderName(buildSelection.provider)} → ${publicProviderName(reviewSelection.provider)} · stage triển khai đã kết thúc; reviewer bắt đầu kiểm tra (Round ${round}).`, "handoff");
    task.resumeFrom = null;
    task.phase = "review"; persist(); publish("task");
    const reviewStartedAt = Date.now();
    const review = await spawnStage(task, reviewSelection.provider, "review", cwd, makePrompt(task, "review", plan, notes, workspace, skillInstructionsList, { round }), reviewSelection);
    assertTaskActive(task);
    task.review = review;
    const findings = parseReviewFindings(review);
    task.reviewFindings = findings;
    task.artifacts = mergeTaskArtifacts(task.artifacts, await changedFilesSince(cwd, Date.parse(task.startedAt)));
    recordTaskCycle(task, {
      id: `cycle-review-${round}`,
      round,
      stage: "review",
      title: `Round ${round} · review`,
      provider: publicProviderName(reviewSelection.provider),
      model: reviewSelection.model || "",
      status: findings.blocking > 0 ? "blocking" : "clean",
      badge: findings.blocking > 0 ? `${findings.blocking} blocking` : "clean",
      blocking: findings.blocking,
      advisory: findings.advisory,
      turns: 1,
      durationMs: Date.now() - reviewStartedAt,
      summary: String(review || "").slice(0, 600),
    });

    if (task.qaCommand) {
      task.phase = "qa"; persist(); publish("task");
      const qaRes = await runTaskQaCheck(task, cwd, task.qaCommand).catch((err) => ({
        command: task.qaCommand,
        status: "failed",
        exitCode: 1,
        durationMs: 0,
        summary: `QA lỗi: ${safeError(err)}`,
        output: safeError(err),
      }));
      assertTaskActive(task);
      recordTaskCycle(task, {
        id: `cycle-qa-${round}`,
        round,
        stage: "qa",
        title: `QA · ${qaRes.status === "passed" ? "specs passed" : "specs failed"}`,
        provider: "QA Runner",
        model: qaRes.command || "",
        status: qaRes.status === "passed" ? "clean" : "blocking",
        badge: qaRes.summary || qaRes.status,
        blocking: qaRes.status === "failed" ? 1 : 0,
        advisory: 0,
        turns: 1,
        durationMs: qaRes.durationMs || 1000,
        summary: String(qaRes.output || "").slice(0, 600),
      });
    }

    const needFixLoop = (findings.blocking > 0 || task.qaResult?.status === "failed") && round < maxRounds && task.permissionPreset !== "read-only";
    if (needFixLoop) {
      previousReview = review;
      previousQaOutput = task.qaResult?.status === "failed" ? task.qaResult.output : "";
      record(
        task,
        `Phát hiện ${findings.blocking} lỗi blocking${task.qaResult?.status === "failed" ? " và QA thất bại" : ""} ở Round ${round}. Tự động kích hoạt Round ${round + 1}/${maxRounds} để sửa triệt để.`,
        "warning"
      );
      round += 1;
      continue;
    }
    break;
  }

  assertTaskActive(task);
  task.costUsd = estimateTaskCostUsd(task.usage);
  record(task, `${publicProviderName(reviewSelection.provider)} review hoàn tất · xem kết quả và diff trong task detail.`, "handoff");
  task.status = "done"; task.phase = "done"; task.completedAt = new Date().toISOString();
  finishStageRerun(task, "done");
  autoDistillTaskMemory(task, workspace);
  record(task, `Hoàn tất luồng ${publicProviderName(planSelection.provider)} → ${publicProviderName(buildSelection.provider)} → ${publicProviderName(reviewSelection.provider)} (${round} vòng). Thay đổi nằm trong workspace hiển thị bên dưới.`, "success");
}
function drainQueuedChats() {
  if (shuttingDown) return;
  for (const candidate of state.tasks) {
    if (!candidate.chatQueue?.length || candidate.status === "queued") continue;
    if (running.has(candidate.id)) continue;
    const ws = state.workspaces.find((w) => w.id === candidate.workspaceId);
    if (!ws) continue;
    const sharedCheckout = usesSharedCheckout(candidate);
    const lockKey = workspaceLockKey(sharedCheckout ? ws.path : (candidate.executionPath || candidate.worktreePath || ws.path));
    if (sharedCheckout && busyWorkspaces.has(lockKey)) continue;
    void processTaskChatQueue(candidate);
  }
}
async function processTaskChatQueue(task) {
  if (shuttingDown || !task.chatQueue?.length) return;
  const workspace = state.workspaces.find((item) => item.id === task.workspaceId);
  if (!workspace) return;
  const existingRun = running.get(task.id);
  if (existingRun && !existingRun.isChat) return;
  const sharedCheckout = usesSharedCheckout(task);
  const lockPath = sharedCheckout ? workspace.path : (task.executionPath || task.worktreePath || workspace.path);
  const lockKey = workspaceLockKey(lockPath);
  if (!existingRun && sharedCheckout && busyWorkspaces.has(lockKey)) {
    return;
  }
  if (!existingRun) {
    running.set(task.id, { child: null, stopped: false, workspacePath: lockKey, isolated: !sharedCheckout, isChat: true });
    if (sharedCheckout && lockKey) busyWorkspaces.add(lockKey);
  }
  const restoreStatus = task.status === "running" ? (task.preChatStatus || "done") : task.status;
  const restorePhase = task.phase === "chat" ? (task.preChatPhase || (restoreStatus === "done" ? "done" : restoreStatus)) : task.phase;
  task.preChatStatus = restoreStatus;
  task.preChatPhase = restorePhase;
  task.chatResumeState = { status: restoreStatus, phase: restorePhase };
  task.status = "running"; task.phase = "chat";
  try { persist(); } catch {}
  publish("task");
  let anyTurnSucceeded = false;
  let wasStopped = false;
  try {
    task.storagePath ||= resolve(taskDir, task.id);
    await fs.mkdir(task.storagePath, { recursive: true }).catch(() => {});
    if ((task.skillIds || []).length || (task.skills || []).length) {
      await loadSkillCatalog(workspace.id).catch(() => []);
    }
    while (task.chatQueue.length && !running.get(task.id)?.stopped) {
      const turn = task.chatQueue.shift();
      const userMessage = task.chatMessages?.find((item) => item.id === turn.messageId);
      if (userMessage) userMessage.status = "running";
      record(task, `${publicProviderName(turn.provider)} nhận tin nhắn · ${turn.model} (${turn.effort})`, "stage");
      try {
        const turnStartedAt = Date.now();
        const cwd = sharedCheckout ? workspace.path : (task.executionPath || task.worktreePath || workspace.path);
        if (turn.provider === "antigravity" && ((task.skills || []).length > 0 || (task.skillIds || []).length > 0) && !(task.antigravitySkillDirs || []).length) {
          task.antigravitySkillDirs = await stageAntigravitySkills(task);
        }
        const prompt = makeChatPrompt(task, turn);
        const chatConfig = { provider: turn.provider, model: turn.model, effort: turn.effort };
        const response = await spawnStage(task, turn.provider, `chat-${turn.id}`, cwd, prompt, chatConfig);
        assertTaskActive(task);
        const turnChanges = await changedFilesSince(cwd, turnStartedAt);
        if (turnChanges.length) {
          task.artifacts = mergeTaskArtifacts(task.artifacts, turnChanges);
          if (!task.worktreeCleaned && task.worktreePath) task.worktreeAppliedAt = null;
        }
        if (userMessage) userMessage.status = "done";
        anyTurnSucceeded = true;
        task.chatMessages ||= [];
        const answer = { id: randomUUID(), role: "assistant", replyToMessageId: userMessage?.id, provider: turn.provider, model: turn.model, effort: turn.effort, content: response || "CLI hoàn tất nhưng không trả nội dung văn bản.", createdAt: new Date().toISOString() };
        const metric = task.stageMetrics?.at(-1);
        if (metric?.stage === `chat-${turn.id}`) { answer.durationMs = metric.durationMs; answer.usage = metric.usage; }
        task.chatMessages.push(answer);
        record(task, `${publicProviderName(turn.provider)} đã trả lời trong chat.`, "success");
      } catch (error) {
        const messageError = safeError(error);
        if (userMessage) { userMessage.status = "failed"; userMessage.error = messageError; }
        record(task, `${publicProviderName(turn.provider)} chat lỗi: ${messageError}`, "error");
        if (running.get(task.id)?.stopped) { wasStopped = true; break; }
      }
      try { persist(); } catch {}
      publish("task");
    }
  } finally {
    const runInfo = running.get(task.id);
    if (runInfo?.stopped) wasStopped = true;
    if (!shuttingDown) {
      if (task.config?.workflow === "chat-only" && anyTurnSucceeded && !wasStopped) {
        task.status = "done";
        task.phase = "done";
        task.error = null;
        task.failedPhase = null;
      } else if (task.status === "running") {
        task.status = restoreStatus;
        task.phase = restorePhase;
      }
    }
    task.preChatStatus = null;
    task.preChatPhase = null;
    task.chatResumeState = null;
    if (runInfo?.workspacePath && !runInfo.isolated) busyWorkspaces.delete(workspaceLockKey(runInfo.workspacePath));
    running.delete(task.id);
    try { persist(); } catch {}
    publish("task");
    if (task.chatQueue?.length && !wasStopped && !shuttingDown) void processTaskChatQueue(task);
    drainQueuedChats();
    pump();
  }
}
function pump() {
  if (shuttingDown || schedulerActive) return;
  schedulerActive = true;
  queueMicrotask(async () => {
    try {
      while (!shuttingDown) {
        const hasQueuedFanout = state.tasks.some((item) => item.status === "queued" && item.fanoutId && item.isolated);
        const activeFanoutTaskCount = hasQueuedFanout
          ? state.tasks.filter((item) => item.fanoutId && item.isolated && (item.status === "queued" || running.has(item.id))).length
          : 0;
        const maxConcurrent = Math.max(1, Math.min(8, Math.max(Number(state.settings.maxConcurrent) || 1, activeFanoutTaskCount)));
        if (running.size >= maxConcurrent) break;
        const task = state.tasks.find((item) => {
          const path = state.workspaces.find((w) => w.id === item.workspaceId)?.path;
          const lockKey = workspaceLockKey(path);
          return item.status === "queued" && !running.has(item.id) && Boolean(lockKey) && areTaskDependenciesMet(item) && (item.isolated || !busyWorkspaces.has(lockKey));
        });
        if (!task) break;
        const workspacePath = state.workspaces.find((w) => w.id === task.workspaceId)?.path;
        const lockKey = workspaceLockKey(workspacePath);
        running.set(task.id, { child: null, stopped: false, workspacePath: lockKey, isolated: task.isolated });
        if (!task.isolated && lockKey) busyWorkspaces.add(lockKey);
        if (task.isolated && lockKey) isolatedWorkspaces.set(lockKey, (isolatedWorkspaces.get(lockKey) || 0) + 1);
        executeTask(task).catch((error) => {
          if (task.status === "cancelled") { finishStageRerun(task, "cancelled", "Đã dừng theo yêu cầu."); try { persist(); } catch {} publish("task"); return; }
          if (shuttingDown || running.get(task.id)?.shuttingDown) return;
          task.failedPhase = task.phase;
          task.status = running.get(task.id)?.stopped ? "cancelled" : "failed";
          task.phase = task.status;
          task.error = safeError(error);
          finishStageRerun(task, task.status, task.error);
          record(task, task.error, "error");
        }).finally(() => {
          const runInfo = running.get(task.id);
          const runKey = workspaceLockKey(runInfo?.workspacePath);
          if (runKey && !runInfo.isolated) busyWorkspaces.delete(runKey);
          if (runKey && runInfo.isolated) {
            const count = (isolatedWorkspaces.get(runKey) || 1) - 1;
            if (count <= 0) isolatedWorkspaces.delete(runKey); else isolatedWorkspaces.set(runKey, count);
          }
          running.delete(task.id);
          if (task.status !== "done" && task.status !== "awaiting_approval" && task.chatQueue?.length) {
            failQueuedChatTurns(task);
          }
          try { persist(); } catch {}
          publish("task");
          if (task.chatQueue?.length && (task.status === "done" || task.status === "awaiting_approval") && !shuttingDown) void processTaskChatQueue(task);
          drainQueuedChats();
          pump();
        });
      }
    } finally { schedulerActive = false; }
  });
}
async function checkDiff(task) {
  const cwd = task.executionPath || state.workspaces.find((w) => w.id === task.workspaceId)?.path;
  if (!cwd || !task.worktreePath && !state.workspaces.find((w) => w.id === task.workspaceId)?.path) return "";
  const info = await inspectWorkspace(cwd).catch(() => ({ isGit: false, head: false }));
  if (!info.isGit || !info.head) {
    const artifacts = task.artifacts || await changedFilesSince(cwd, Date.parse(task.startedAt || task.createdAt));
    return artifacts.length ? `Git diff không khả dụng ở workspace này. Tệp được tạo hoặc sửa trong lượt chạy:\n${artifacts.map((file) => `- ${file}`).join("\n")}` : "Workspace chưa có Git commit và không có tệp nào đổi sau khi task bắt đầu.";
  }
  const head = await git(cwd, ["rev-parse", "--verify", "HEAD"]);
  if (head.code !== 0) return "Git chưa có commit gốc. Task vẫn chạy trong thư mục thật, nhưng Git chưa thể tạo diff đối chiếu.";
  const diffArgs = task.isolated && task.worktreeBaseHead ? ["diff", "--no-ext-diff", "--no-color", task.worktreeBaseHead] : ["diff", "--no-ext-diff", "--no-color"];
  const result = await git(cwd, diffArgs);
  let diff = result.stdout || "";
  const untracked = await git(cwd, ["ls-files", "--others", "--exclude-standard"]);
  for (const rel of (untracked.stdout || "").split(/\r?\n/).filter(Boolean).slice(0, 30)) {
    try {
      const candidate = resolve(cwd, safeRelativePath(rel));
      const lstat = await fs.lstat(candidate);
      if (!lstat.isFile() || lstat.isSymbolicLink() || lstat.size > 180_000) continue;
      const { target: file } = await resolveInside(cwd, rel, true);
      if (!allowedTextFile(file)) continue;
      const content = await fs.readFile(file, "utf8");
      const contentLines = content.split(/\r?\n/);
      diff += `\ndiff --git a/${rel} b/${rel}\n--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${contentLines.length} @@\n` + contentLines.map((line) => `+${line}`).join("\n") + "\n";
    } catch { }
  }
  return diff.slice(0, 1_000_000);
}
async function applyTaskWorktree(task, { cleanup = false } = {}) {
  if (!task.isolated || !task.worktreePath || task.worktreeCleaned || !existsSync(task.worktreePath)) {
    throw new Error("Task này không có Git worktree cô lập đang hoạt động để áp dụng.");
  }
  if (running.has(task.id) || ["queued", "running"].includes(task.status)) {
    throw new Error("Hãy đợi task kết thúc trước khi áp dụng worktree vào dự án chính.");
  }
  const workspace = state.workspaces.find((w) => w.id === task.workspaceId);
  if (!workspace) throw new Error("Workspace của task không còn tồn tại.");
  const info = await inspectWorkspace(workspace.path);
  if (!info.isGit) throw new Error("Workspace chính không phải là Git repository.");
  const lockKey = workspaceLockKey(info.path);
  if (busyWorkspaces.has(lockKey)) throw new Error("Workspace chính đang có task khác chạy; hãy đợi hoàn tất trước khi áp dụng worktree.");
  busyWorkspaces.add(lockKey);
  const repoRoot = info.gitRoot || info.path;
  const wtRoot = resolve(task.worktreePath);
  let appliedFiles = [];
  try {
    await withGitRepoLock(repoRoot, async () => {
      await git(wtRoot, ["add", "-A"]);
      const baseRef = task.worktreeBaseHead || "HEAD";
      const patchRes = await git(wtRoot, ["diff", "--cached", "--binary", "--full-index", baseRef]);
      const namesRes = await git(wtRoot, ["diff", "--cached", "--name-only", baseRef]);
      await git(wtRoot, ["reset"]).catch(() => {});
      const patchContent = patchRes.stdout || "";
      if (!patchContent.trim()) throw new Error("Worktree không có thay đổi nào để áp dụng vào dự án chính.");
      appliedFiles = (namesRes.stdout || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (!appliedFiles.length) {
        appliedFiles = parseUnifiedDiffFiles(patchContent).map((f) => f.path).filter(Boolean);
      }
      await fs.mkdir(task.storagePath, { recursive: true });
      const patchPath = resolve(task.storagePath, "apply-worktree.patch");
      await fs.writeFile(patchPath, patchContent, "utf8");
      let applyRes = await git(repoRoot, ["apply", "--3way", "--whitespace=nowarn", patchPath]);
      if (applyRes.code !== 0) applyRes = await git(repoRoot, ["apply", "--whitespace=nowarn", patchPath]);
      if (applyRes.code !== 0) {
        throw new Error(`Không thể tự động áp dụng worktree (có xung đột Git): ${(applyRes.stderr || applyRes.stdout || "git apply failed").trim().slice(0, 400)}`);
      }
    });
    task.worktreeAppliedAt = new Date().toISOString();
    task.appliedFiles = appliedFiles;
    if (cleanup) {
      await cleanupTaskWorktrees(task);
      task.worktreeCleaned = true;
      task.executionPath = task.workspacePath;
    }
    workspace.runtime = await inspectWorkspace(workspace.path).catch(() => workspace.runtime);
    record(task, `Đã áp dụng thay đổi từ Git worktree (${task.worktreeBranch || basename(wtRoot)}) vào dự án chính.${cleanup ? " Đã dọn dẹp worktree." : ""}`, "success");
    persist();
    publish("tasks");
    return task;
  } finally {
    busyWorkspaces.delete(lockKey);
    drainQueuedChats();
    pump();
  }
}
async function discardTaskWorktree(task) {
  if (!task.isolated || !task.worktreePath || task.worktreeCleaned) {
    throw new Error("Task này không còn Git worktree cô lập cần dọn dẹp.");
  }
  if (running.has(task.id) || ["queued", "running"].includes(task.status)) {
    throw new Error("Hãy dừng hoặc đợi task kết thúc trước khi dọn worktree.");
  }
  await cleanupTaskWorktrees(task);
  task.worktreeCleaned = true;
  task.executionPath = task.workspacePath;
  record(task, "Đã dọn dẹp Git worktree cô lập của task.", "info");
  persist();
  publish("tasks");
}
async function changedFilesSince(cwd, startTime) {
  const changed = [];
  const cutoff = Number.isFinite(startTime) ? startTime : Date.now();
  const ignored = new Set([".git", ".runtime", "node_modules", "dist", "build", "release", "out", "target", ".next", "coverage", "vendor", ".venv", "venv", ".cache", ".turbo", ".parcel-cache", "__pycache__", ".gradle"]);
  async function visit(directory, relative = "", depth = 0) {
    if (depth > 12 || changed.length >= 100) return;
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); } catch { return; }
    const subdirs = [];
    const files = [];
    for (const entry of entries) {
      if (ignored.has(entry.name.toLowerCase()) || entry.isSymbolicLink()) continue;
      const absolute = resolve(directory, entry.name);
      const rel = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) subdirs.push([absolute, rel]);
      else if (entry.isFile()) files.push([absolute, rel]);
    }
    if (files.length) {
      await Promise.all(files.map(async ([absolute, rel]) => {
        if (changed.length >= 100) return;
        try {
          const stat = await fs.stat(absolute);
          if (stat.mtimeMs >= cutoff && changed.length < 100) changed.push(rel);
        } catch { }
      }));
    }
    for (const [absolute, rel] of subdirs) {
      if (changed.length >= 100) break;
      await visit(absolute, rel, depth + 1);
    }
  }
  await visit(cwd);
  return changed.sort();
}
async function api(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/ping") {
    return json(response, 200, {
      ok: true,
      app: "OpenSybau",
      name: "OpenSybau",
      version: "0.2.105",
      mode: (!isLoopbackBind || lanCompanionServers.length > 0) ? "network" : "loopback",
      ts: Date.now(),
    });
  }
  if (request.method === "GET" && pathname === "/api/connection-info") {
    const boundPort = activeLanPort || server?.address?.()?.port || port;
    const connectors = await loadModels().catch(() => ({}));
    const activeWorktreesCount = state.tasks.filter((t) => t.isolated && !t.worktreeCleaned && !t.archived).length;
    const runningTasksCount = state.tasks.filter((t) => t.status === "running").length;
    const activePass = getEffectiveAccessPassword();
    return json(response, 200, buildConnectionInfoPayload({
      host,
      port: boundPort,
      protocol: secureTransport ? "https" : "http",
      isLoopbackBind,
      lanActive: lanCompanionServers.length > 0,
      productionMode,
      accessUsername: getEffectiveAccessUsername(),
      accessPassword: activePass,
      includePassword: isLoopbackClient(request),
      hasAccessPassword: Boolean(activePass),
      allowedHosts,
      version: "0.2.105",
      connectors,
      activeWorktreesCount,
      runningTasksCount,
    }));
  }
  if (request.method === "POST" && pathname === "/api/connection-config") {
    if (!isLoopbackClient(request) && !secureTransport) {
      return json(response, 403, { error: "Chỉ có thể đổi mật khẩu kết nối trực tiếp trên máy tính chủ." });
    }
    const body = await readBody(request);
    const generateNew = Boolean(body.generate);
    const nextUsername = String(body.username ?? getEffectiveAccessUsername() ?? "opensybau").trim() || "opensybau";
    if (nextUsername.includes(":") || nextUsername.length > 64) {
      return json(response, 400, { error: "Tên tài khoản không hợp lệ." });
    }
    const nextPassword = generateNew
      ? generateStrongAccessPassword()
      : String(body.password ?? "").trim();
    if (nextPassword && nextPassword.length < 6) {
      return json(response, 400, { error: "Mật khẩu cần tối thiểu 6 ký tự." });
    }
    if (nextPassword.length > 256) {
      return json(response, 400, { error: "Mật khẩu tối đa 256 ký tự." });
    }
    connectionConfig = {
      username: nextUsername,
      password: nextPassword,
      remoteEnabled: Boolean(nextPassword),
      updatedAt: new Date().toISOString(),
    };
    persistJsonFile(connectionConfigFile, connectionConfig);
    await syncLanCompanionServers();
    const boundPort = activeLanPort || server?.address?.()?.port || port;
    const connectors = await loadModels().catch(() => ({}));
    const activeWorktreesCount = state.tasks.filter((t) => t.isolated && !t.worktreeCleaned && !t.archived).length;
    const runningTasksCount = state.tasks.filter((t) => t.status === "running").length;
    const activePass = getEffectiveAccessPassword();
    return json(response, 200, buildConnectionInfoPayload({
      host,
      port: boundPort,
      protocol: secureTransport ? "https" : "http",
      isLoopbackBind,
      lanActive: lanCompanionServers.length > 0,
      productionMode,
      accessUsername: getEffectiveAccessUsername(),
      accessPassword: activePass,
      includePassword: true,
      hasAccessPassword: Boolean(activePass),
      allowedHosts,
      version: "0.2.105",
      connectors,
      activeWorktreesCount,
      runningTasksCount,
    }));
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
    return;
  }
  if (request.method === "POST" && pathname === "/api/connectors/antigravity/path") {
    const body = await readBody(request);
    const requestedPath = String(body.path || "").trim();
    const baseName = basename(requestedPath).toLowerCase();
    if (!requestedPath || !isAbsolute(requestedPath) || process.platform === "win32" && !/^(?:agy|antigravity)[\w.-]*\.exe$/i.test(baseName)) {
      return json(response, 400, { error: "Chọn đường dẫn tuyệt đối tới file agy.exe." });
    }
    const executable = resolve(requestedPath);
    let stat;
    try { stat = await fs.stat(executable); }
    catch (error) { return json(response, 404, { error: `Không đọc được file CLI đã chọn: ${safeError(error)}` }); }
    if (!stat.isFile()) return json(response, 400, { error: "Đường dẫn đã chọn không phải là file CLI." });
    const cliPathError = await validateCustomCliPath(executable);
    if (cliPathError) return json(response, 400, { error: cliPathError });
    const version = await run(executable, ["--version"], { timeout: 10000, maxBuffer: 10000 });
    if (version.code !== 0) return json(response, 422, { error: `Không chạy được file đã chọn: ${safeError(version.stderr || version.stdout || "agy --version trả mã lỗi.")}` });
    process.env.ANTIGRAVITY_CLI_PATH = executable;
    agyExe = executable;
    persistJsonFile(cliPathsFile, { ...loadJson(cliPathsFile, {}), antigravity: executable, antigravityManual: true });
    modelCache = null;
    modelCacheUntil = 0;
    const connectors = await loadModels(true);
    return json(response, 200, { connector: connectors.antigravity });
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
      return json(response, 400, { error: "Chọn đường dẫn tuyệt đối tới claude.exe hoặc cli.js." });
    }
    const executable = resolve(requestedPath);
    let stat;
    try { stat = await fs.stat(executable); }
    catch (error) { return json(response, 404, { error: `Không đọc được file CLI đã chọn: ${safeError(error)}` }); }
    if (!stat.isFile()) return json(response, 400, { error: "Đường dẫn đã chọn không phải là file CLI." });
    const cliPathError = await validateCustomCliPath(executable);
    if (cliPathError) return json(response, 400, { error: cliPathError });
    const command = extension === ".js" ? { executable: process.execPath, prefixArgs: [executable] } : { executable, prefixArgs: [] };
    const version = await run(command.executable, [...command.prefixArgs, "--version"], { timeout: 15000, maxBuffer: 10000 });
    if (version.code !== 0) return json(response, 422, { error: `Không chạy được file đã chọn: ${safeError(version.stderr || version.stdout || "claude --version trả mã lỗi.")}` });
    process.env.CLAUDE_CLI_PATH = executable;
    claudeCommand = command;
    claudeExe = command.executable;
    persistJsonFile(cliPathsFile, { ...loadJson(cliPathsFile, {}), claude: executable, claudeManual: true });
    modelCache = null;
    modelCacheUntil = 0;
    const connectors = await loadModels(true);
    return json(response, 200, { connector: connectors.claude });
  }
  if (request.method === "GET" && pathname === "/api/connectors") return json(response, 200, await loadModels(new URL(request.url, `http://${host}:${port}`).searchParams.has("refresh")));
  const cliLoginMatch = pathname.match(/^\/api\/connectors\/(codex|antigravity|claude)\/login$/);
  if (request.method === "POST" && cliLoginMatch) {
    refreshCliExecutables();
    const id = cliLoginMatch[1];
    const login = id === "codex"
      ? { executable: codexExe, args: ["login"], versionArgs: ["--version"], label: "Codex CLI" }
      : id === "antigravity"
        ? { executable: agyExe, args: [], versionArgs: ["--version"], label: "Antigravity CLI" }
        : { executable: claudeCommand.executable, args: [...claudeCommand.prefixArgs, "auth", "login"], versionArgs: [...claudeCommand.prefixArgs, "--version"], label: "Claude Code" };
    if (!login.executable) return json(response, 409, { error: `${login.label} chưa được cài trên máy chạy OpenSybau. Mở hướng dẫn cài đặt trước rồi quét lại.` });
    const installed = await run(login.executable, login.versionArgs, { timeout: 10000, maxBuffer: 10000 });
    if (installed.code !== 0) return json(response, 409, { error: `${login.label} chưa khởi chạy được. Hãy cài CLI hoặc kiểm tra PATH rồi quét lại.` });
    try {
      await openCliLoginTerminal(login.executable, login.args, login.label);
      modelCacheUntil = 0;
      return json(response, 200, { ok: true, message: `Đã mở terminal ${login.label} trên máy chạy OpenSybau. Hoàn tất đăng nhập ở đó, sau đó quay lại và bấm Quét lại.` });
    } catch (error) { return json(response, 501, { error: safeError(error) }); }
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
    return json(response, 200, { providers });
  }
  if (request.method === "POST" && pathname === "/api/providers/models") {
    const body = await readBody(request);
    const saved = body.useSavedKey === false ? null : savedApiProviders().find((item) => item.id === String(body.id || ""));
    let provider;
    try {
      provider = normalizeUserApiProvider({ ...body, id: body.id || "provider-check", name: body.name || "API provider", models: body.models || "provider-check", apiKey: body.apiKey || saved?.apiKey || "" });
    } catch (error) { return json(response, 400, { error: safeError(error) }); }
    if (provider.apiKey && !secureTransport && !isLoopbackClient(request)) return json(response, 403, { error: "Để gửi API key từ xa, hãy bật HTTPS. Hãy nhập key qua localhost hoặc cấu hình HTTPS trước." });
    try {
      const models = await listProviderModels({ id: provider.id, name: provider.name, protocol: provider.protocol, endpoint: provider.baseUrl, apiKey: provider.apiKey });
      return json(response, 200, { models });
    } catch (error) { return json(response, 400, { error: safeError(error) }); }
  }
  if (request.method === "POST" && pathname === "/api/providers/import-environment") {
    const body = await readBody(request);
    const id = String(body.id || "").trim().toLowerCase();
    const existing = loadJson(providerConfigFile, []);
    const secrets = loadJson(providerSecretsFile, {});
    if (!Array.isArray(existing) || !secrets || typeof secrets !== "object" || Array.isArray(secrets)) return json(response, 500, { error: "Cấu hình provider đã lưu không hợp lệ." });
    if (existing.some((item) => item.id === id)) return json(response, 409, { error: "Provider này đã được quản lý trong OpenSybau." });
    if (existing.length >= 20) return json(response, 400, { error: "Tối đa 20 provider được thêm trong giao diện." });
    let source;
    try { source = configuredApiProviders(process.env).find((item) => item.runtime.id === id); }
    catch (error) { return json(response, 409, { error: `Không thể đọc provider từ môi trường: ${safeError(error)}` }); }
    if (!source) return json(response, 404, { error: "Không tìm thấy provider đã cấu hình trong môi trường." });
    const provider = source.runtime;
    const metadata = { id: provider.id, name: provider.name, protocol: provider.protocol, baseUrl: provider.endpoint, models: provider.models, apiKeyRequired: provider.apiKeyRequired };
    const nextProviders = [...existing, metadata];
    const nextSecrets = { ...secrets };
    if (provider.apiKey) nextSecrets[id] = provider.apiKey;
    persistJsonFile(providerConfigFile, nextProviders);
    persistJsonFile(providerSecretsFile, nextSecrets);
    const connectors = await loadModels(true);
    publish("providers");
    return json(response, 201, { provider: publicApiProvider({ ...metadata, apiKey: nextSecrets[id] || "" }, connectors[id], "local") });
  }
  const providerMatch = pathname.match(/^\/api\/providers(?:\/([a-z][a-z0-9-]{1,39}))?$/);
  if (providerMatch && ["POST", "PUT", "DELETE"].includes(request.method)) {
    const existing = loadJson(providerConfigFile, []);
    const secrets = loadJson(providerSecretsFile, {});
    if (!Array.isArray(existing) || !secrets || typeof secrets !== "object" || Array.isArray(secrets)) return json(response, 500, { error: "Cấu hình provider đã lưu không hợp lệ." });
    const pathId = providerMatch[1] || "";
    if (request.method === "DELETE") {
      if (!pathId) return json(response, 400, { error: "Thiếu ID provider cần xóa." });
      if (!existing.some((item) => item.id === pathId)) return json(response, 404, { error: "Chỉ có thể xóa provider do OpenSybau quản lý." });
      const inDefaults = Object.values(state.settings.defaults?.roles || {}).some((selection) => selection?.provider === pathId);
      const inActiveTask = state.tasks.some((task) => ["queued", "running"].includes(task.status) && (task.config?.chatProvider === pathId || Object.values(task.config?.roles || {}).some((selection) => selection?.provider === pathId)));
      if (inDefaults || inActiveTask) return json(response, 409, { error: "Provider đang được dùng làm mặc định hoặc trong task đang chạy. Hãy đổi định tuyến trước khi xóa." });
      persistJsonFile(providerConfigFile, existing.filter((item) => item.id !== pathId));
      const nextSecrets = { ...secrets }; delete nextSecrets[pathId]; persistJsonFile(providerSecretsFile, nextSecrets);
      modelCacheUntil = 0;
      await loadModels(true);
      publish("providers");
      return json(response, 200, { ok: true });
    }

    const body = await readBody(request);
    const id = pathId || String(body.id || "").trim().toLowerCase();
    let normalized;
    try { normalized = normalizeUserApiProvider({ ...body, id }); }
    catch (error) { return json(response, 400, { error: safeError(error) }); }
    const current = existing.find((item) => item.id === id);
    if (pathId && !current) return json(response, 404, { error: "Provider không tồn tại hoặc do môi trường quản lý." });
    if (!pathId && existing.some((item) => item.id === id)) return json(response, 409, { error: "ID provider đã tồn tại." });
    if (!pathId && existing.length >= 20) return json(response, 400, { error: "Tối đa 20 provider được thêm trong giao diện." });
    let environmentIds;
    try { environmentIds = configuredApiProviders().map((item) => item.runtime.id); }
    catch (error) { return json(response, 409, { error: `Cấu hình API trong .env đang lỗi nên chưa thể lưu provider: ${safeError(error)}` }); }
    if (environmentIds.includes(id)) return json(response, 409, { error: "ID này đang được cấu hình trong môi trường (.env). Hãy chọn ID khác." });
    const nextProviders = existing.filter((item) => item.id !== id);
    const metadata = { id: normalized.id, name: normalized.name, protocol: normalized.protocol, baseUrl: normalized.baseUrl, models: normalized.models, apiKeyRequired: normalized.apiKeyRequired };
    nextProviders.push(metadata);
    const nextSecrets = { ...secrets };
    if (body.clearApiKey === true) delete nextSecrets[id];
    else if (normalized.apiKey) {
      if (!secureTransport && !isLoopbackClient(request)) return json(response, 403, { error: "Để gửi API key từ xa, hãy bật HTTPS. Bạn vẫn có thể cấu hình key trực tiếp trên máy chủ qua localhost." });
      nextSecrets[id] = normalized.apiKey;
    }
    persistJsonFile(providerConfigFile, nextProviders);
    persistJsonFile(providerSecretsFile, nextSecrets);
    modelCacheUntil = 0;
    const connectors = await loadModels(true);
    publish("providers");
    return json(response, pathId ? 200 : 201, { provider: publicApiProvider({ ...metadata, apiKey: nextSecrets[id] || "" }, connectors[id], "local") });
  }
  if (request.method === "GET" && pathname === "/api/skills") {
    const params = new URL(request.url, `http://${host}:${port}`).searchParams;
    const skills = await loadSkillCatalog(params.get("workspaceId") || "", params.has("refresh"));
    return json(response, 200, { skills: skills.map(({ id, name, description, source, sources, providers, files }) => ({ id, name, description, source, sources, providers, editable: files.some((file) => file.managed) })) });
  }
  if (request.method === "POST" && pathname === "/api/skills") {
    const body = await readBody(request);
    try {
      const result = await createSkillFiles(body.name, body.description, body.instructions, body.scope);
      invalidateSkillCatalogCache();
      publish("skills");
      return json(response, 201, result);
    } catch (error) { return json(response, 400, { error: safeError(error) }); }
  }
  const skillMatch = pathname.match(/^\/api\/skills\/([a-f\d]{16})(?:\/(copy))?$/i);
  if (skillMatch) {
    const id = skillMatch[1];
    const action = skillMatch[2] || "";
    const params = new URL(request.url, `http://${host}:${port}`).searchParams;
    const skills = await loadSkillCatalog(params.get("workspaceId") || "");
    const skill = skills.find((item) => item.id === id);
    if (!skill) return json(response, 404, { error: "Skill không còn trong thư viện. Hãy quét lại danh mục." });
    if (request.method === "GET" && !action) return json(response, 200, { skill: { id: skill.id, name: skill.name, description: skill.description, source: skill.source, sources: skill.sources, providers: skill.providers, editable: skill.files.some((file) => file.managed), content: skill.instruction } });
    if (request.method === "POST" && action === "copy") {
      const body = await readBody(request);
      const frontmatter = skill.instruction.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
      const instructions = frontmatter ? skill.instruction.slice(frontmatter[0].length).trim() : skill.instruction;
      const scope = body.scope || defaultSkillScope(skill.providers || []);
      try { const result = await createSkillFiles(`${skill.name} (bản tùy chỉnh)`, skill.description || `Bản tùy chỉnh của ${skill.name}`, instructions, scope); invalidateSkillCatalogCache(); publish("skills"); return json(response, 201, result); }
      catch (error) { return json(response, 400, { error: safeError(error) }); }
    }
    if (request.method === "PATCH" && !action) {
      const body = await readBody(request);
      let content;
      try { content = validateSkillContent(body.content); } catch (error) { return json(response, 400, { error: safeError(error) }); }
      const editableFiles = skill.files.filter((file) => file.managed);
      if (!editableFiles.length) return json(response, 403, { error: "Skill plugin/built-in được quản lý bởi CLI. Sao chép nó thành skill cá nhân để chỉnh sửa." });
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
        return json(response, 400, { error: safeError(error) });
      }
      invalidateSkillCatalogCache();
      publish("skills"); return json(response, 200, { ok: true, name: frontmatterValue(content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)[1], "name") });
    }
    if (request.method === "DELETE" && !action) {
      const editableFiles = skill.files.filter((file) => file.managed);
      if (!editableFiles.length) return json(response, 403, { error: "Skill plugin/built-in không thể xóa tại đây. Bạn có thể sao chép và quản lý bản cá nhân." });
      try {
        for (const entry of editableFiles) {
          const realRoot = await fs.realpath(entry.root);
          const realDirectory = await fs.realpath(entry.directory);
          if (!within(realRoot, realDirectory) || realDirectory === realRoot || basename(realDirectory).toLowerCase() === "skills") throw new Error("Từ chối xóa thư mục gốc skill.");
        }
        for (const entry of editableFiles) await fs.rm(entry.directory, { recursive: true, force: false });
      } catch (error) { return json(response, 400, { error: safeError(error) }); }
      invalidateSkillCatalogCache();
      publish("skills"); return json(response, 200, { ok: true, removedSources: editableFiles.length, readonlySourcesRemain: skill.files.some((file) => !file.managed) });
    }
  }
  const workspaceFileMatch = pathname.match(/^\/api\/workspaces\/([^/]+)\/(files|file|file-index|raw|file-diff|github)(?:\/(.*))?$/);
  if (workspaceFileMatch) {
    const workspace = state.workspaces.find((item) => item.id === decodeURIComponent(workspaceFileMatch[1]));
    if (!workspace) return json(response, 404, { error: "Workspace không tồn tại." });
    const params = new URL(request.url, `http://${host}:${port}`).searchParams;
    const taskId = params.get("taskId") || "";
    const taskForRoot = taskId ? state.tasks.find((t) => t.id === taskId && t.workspaceId === workspace.id) : null;
    const taskCandidateRoot = taskForRoot?.executionPath || taskForRoot?.worktreePath || "";
    const baseRoot = taskCandidateRoot && existsSync(taskCandidateRoot) ? taskCandidateRoot : workspace.path;
    const rawSubpath = workspaceFileMatch[3] ? decodeURIComponent(workspaceFileMatch[3]) : (params.get("path") || "");
    if (request.method === "GET" && workspaceFileMatch[2] === "files") return json(response, 200, await listLocalFiles(baseRoot, params.get("path") || ""));
    if (request.method === "GET" && workspaceFileMatch[2] === "file") return json(response, 200, await readLocalTextFile(baseRoot, params.get("path") || ""));
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
        return json(response, 200, saved);
      } catch (error) {
        return json(response, 400, { error: safeError(error) });
      }
    }
    if (request.method === "GET" && workspaceFileMatch[2] === "github") {
      try {
        const ghData = await listWorkspaceGithubIssues(baseRoot, run);
        return json(response, 200, ghData);
      } catch (error) {
        return json(response, 400, { error: safeError(error) });
      }
    }
    if (request.method === "GET" && workspaceFileMatch[2] === "file-index") return json(response, 200, { files: await listRemoteContextFiles(baseRoot, 600) });
    if (request.method === "GET" && workspaceFileMatch[2] === "raw") {
      try {
        const { target, stat } = await resolveInside(baseRoot, rawSubpath, true);
        const fileName = basename(target);
        if (/^\.env(?:\.|$)/i.test(fileName) && !/^\.env\.example$/i.test(fileName)) {
          return json(response, 403, { error: "Từ chối truy cập tệp môi trường .env." });
        }
        if (stat.size > 50_000_000) return json(response, 413, { error: "Tệp quá lớn để xem trực tiếp." });
        const ext = extname(target).toLowerCase();
        const rawMimeMap = {
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
        const mime = rawMimeMap[ext] || "text/plain; charset=utf-8";
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
          return response.end(outBuf);
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
        return response.end(buf);
      } catch (error) {
        return json(response, 400, { error: safeError(error) });
      }
    }
    if (request.method === "GET" && workspaceFileMatch[2] === "file-diff") {
      try {
        const relPath = safeRelativePath(params.get("path") || "").split(sep).join("/");
        if (!relPath) return json(response, 400, { error: "Thiếu đường dẫn tệp." });
        if (!allowedTextFile(relPath)) return json(response, 403, { error: "Không được phép đọc tệp nhạy cảm này." });
        const baseArgs = taskForRoot?.isolated && taskForRoot?.worktreeBaseHead
          ? ["diff", "--no-ext-diff", "--no-color", taskForRoot.worktreeBaseHead, "--", relPath]
          : ["diff", "--no-ext-diff", "--no-color", "--", relPath];
        const res = await git(baseRoot, baseArgs);
        let diff = res.stdout || "";
        if (!diff.trim()) {
          const untracked = await git(baseRoot, ["ls-files", "--others", "--exclude-standard", "--", relPath]);
          if ((untracked.stdout || "").trim()) {
            const candidate = resolve(baseRoot, relPath);
            const lstat = await fs.lstat(candidate).catch(() => null);
            if (lstat && lstat.isFile() && !lstat.isSymbolicLink() && lstat.size <= 300_000) {
              const { target, stat } = await resolveInside(baseRoot, relPath, true);
              if (stat.isFile() && stat.size <= 300_000 && allowedTextFile(target)) {
                const content = await fs.readFile(target, "utf8");
                const lines = content.split(/\r?\n/);
                diff = `diff --git a/${relPath} b/${relPath}\n--- /dev/null\n+++ b/${relPath}\n@@ -0,0 +1,${lines.length} @@\n` + lines.map((l) => `+${l}`).join("\n") + "\n";
              }
            }
          }
        }
        return json(response, 200, { path: relPath, diff, files: parseUnifiedDiffFiles(diff) });
      } catch (error) {
        return json(response, 400, { error: safeError(error) });
      }
    }
  }
  if (request.method === "GET" && pathname === "/api/vault/files") {
    if (!state.settings.vaultPath) return json(response, 404, { error: "Chưa kết nối Obsidian vault." });
    const params = new URL(request.url, `http://${host}:${port}`).searchParams;
    return json(response, 200, await listLocalFiles(state.settings.vaultPath, params.get("path") || "", true));
  }
  if (request.method === "GET" && pathname === "/api/vault/file") {
    if (!state.settings.vaultPath) return json(response, 404, { error: "Chưa kết nối Obsidian vault." });
    const params = new URL(request.url, `http://${host}:${port}`).searchParams;
    return json(response, 200, await readLocalTextFile(state.settings.vaultPath, params.get("path") || "", true));
  }
  if ((request.method === "POST" || request.method === "PUT") && pathname === "/api/vault/file") {
    if (!state.settings.vaultPath) return json(response, 404, { error: "Chưa kết nối Obsidian vault." });
    const body = await readBody(request);
    const file = await writeVaultMarkdownFile(state.settings.vaultPath, body.path || "", String(body.content ?? ""), { createOnly: Boolean(body.createOnly) });
    publish("vault");
    return json(response, 200, file);
  }
  if (request.method === "DELETE" && pathname === "/api/vault/file") {
    if (!state.settings.vaultPath) return json(response, 404, { error: "Chưa kết nối Obsidian vault." });
    const params = new URL(request.url, `http://${host}:${port}`).searchParams;
    const body = params.get("path") ? { path: params.get("path") } : await readBody(request).catch(() => ({}));
    const deleted = await deleteVaultMarkdownFile(state.settings.vaultPath, body.path || "");
    publish("vault");
    return json(response, 200, deleted);
  }
  if (request.method === "POST" && pathname === "/api/vault/open-obsidian") {
    if (!state.settings.vaultPath) return json(response, 404, { error: "Chưa kết nối Obsidian vault." });
    const body = await readBody(request).catch(() => ({}));
    try {
      const opened = await openObsidianUri(state.settings.vaultPath, body.path || "");
      return json(response, 200, opened);
    } catch (error) {
      return json(response, 400, { error: safeError(error) });
    }
  }
  if (request.method === "GET" && pathname === "/api/vault/graph") {
    if (!state.settings.vaultPath) return json(response, 404, { error: "Chưa kết nối Obsidian vault." });
    return json(response, 200, await buildVaultKnowledgeGraph(state.settings.vaultPath));
  }
  if (request.method === "POST" && pathname === "/api/workspaces") {
    const body = await readBody(request);
    const requestedPath = normalizeDirectoryInput(body.path);
    if (typeof body.path !== "string" || !requestedPath) return json(response, 400, { error: "Nhập đường dẫn thư mục dự án." });
    if (isForbiddenSystemPath(requestedPath)) return json(response, 400, { error: "Không được đăng ký thư mục gốc ổ đĩa hoặc thư mục hệ thống nhạy cảm làm workspace." });
    const info = await inspectWorkspace(requestedPath);
    if (isForbiddenSystemPath(info.path)) return json(response, 400, { error: "Không được đăng ký thư mục gốc ổ đĩa hoặc thư mục hệ thống nhạy cảm làm workspace." });
    const existing = state.workspaces.find((w) => w.path.toLowerCase() === info.path.toLowerCase());
    if (existing) return json(response, 200, { workspace: existing });
    const workspace = { id: randomUUID(), name: basename(info.path) || info.path, path: info.path, sourceFolders: [info.path], pinned: false, section: "Projects", addedAt: new Date().toISOString(), runtime: info };
    state.workspaces.push(workspace); persist(); publish("workspace");
    return json(response, 201, { workspace });
  }
  const workspaceRoute = pathname.match(/^\/api\/workspaces\/([^/]+)(?:\/(open|archive-chats))?$/);
  if (workspaceRoute) {
    const id = decodeURIComponent(workspaceRoute[1]);
    const action = workspaceRoute[2] || "";
    const workspace = state.workspaces.find((item) => item.id === id);
    if (!workspace) return json(response, 404, { error: "Dự án không tồn tại." });
    if (request.method === "PATCH" && !action) {
      const body = await readBody(request);
      if (body.name !== undefined) {
        const name = String(body.name || "").trim();
        if (!name || name.length > 100) return json(response, 400, { error: "Tên dự án cần từ 1 đến 100 ký tự." });
        workspace.name = name;
      }
      if (body.section !== undefined) {
        const section = String(body.section || "Projects").trim() || "Projects";
        if (section.length > 60) return json(response, 400, { error: "Tên section tối đa 60 ký tự." });
        workspace.section = section;
      }
      if (body.pinned !== undefined) workspace.pinned = Boolean(body.pinned);
      if (body.sourceFolders !== undefined) {
        if (!Array.isArray(body.sourceFolders)) return json(response, 400, { error: "Danh sách thư mục nguồn không hợp lệ." });
        const folders = [];
        for (const rawPath of body.sourceFolders) {
          const requested = normalizeDirectoryInput(rawPath);
          if (!requested) continue;
          if (isForbiddenSystemPath(requested)) return json(response, 400, { error: `Không được phép gắn thư mục gốc hoặc thư mục hệ thống nhạy cảm: “${requested}”.` });
          let realPath;
          try { realPath = await fs.realpath(requested); }
          catch (error) {
            if (error.code === "ENOENT" || error.code === "ENOTDIR") throw new Error(`Không tìm thấy thư mục nguồn “${requested}”. Hãy kiểm tra đường dẫn.`);
            throw error;
          }
          if (!(await fs.stat(realPath)).isDirectory()) throw new Error(`Đường dẫn nguồn không phải thư mục: “${requested}”.`);
          if (isForbiddenSystemPath(realPath)) return json(response, 400, { error: `Không được phép gắn thư mục gốc hoặc thư mục hệ thống nhạy cảm: “${requested}”.` });
          folders.push(realPath);
        }
        const uniqueFolders = new Map([[workspace.path.toLowerCase(), workspace.path]]);
        for (const folder of folders) if (!uniqueFolders.has(folder.toLowerCase())) uniqueFolders.set(folder.toLowerCase(), folder);
        workspace.sourceFolders = [...uniqueFolders.values()];
      }
      persist(); publish("workspace"); return json(response, 200, { workspace });
    }
    if (request.method === "POST" && action === "open") {
      if (!existsSync(workspace.path)) return json(response, 404, { error: "Không tìm thấy thư mục dự án để mở." });
      await openFolder(workspace.path);
      return json(response, 200, { ok: true });
    }
    if (request.method === "POST" && action === "archive-chats") {
      const affected = state.tasks.filter((task) => task.workspaceId === id && !task.archived);
      for (const task of affected) task.archived = true;
      persist(); publish("tasks"); return json(response, 200, { archived: affected.length });
    }
  }
  if (request.method === "DELETE" && pathname.startsWith("/api/workspaces/")) {
    const id = decodeURIComponent(pathname.slice("/api/workspaces/".length));
    if (state.tasks.some((t) => t.workspaceId === id && ["queued", "running"].includes(t.status))) return json(response, 409, { error: "Không thể xóa workspace đang có task hoạt động." });
    for (const task of state.tasks) if (task.workspaceId === id) task.archived = true;
    state.workspaces = state.workspaces.filter((w) => w.id !== id); persist(); publish("workspace"); return json(response, 200, { ok: true });
  }
  if (request.method === "POST" && pathname === "/api/tasks") {
    const body = await readBody(request);
    const prompt = String(body.prompt || "").trim();
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (attachments.length > 20) return json(response, 400, { error: "Mỗi tin nhắn chỉ hỗ trợ tối đa 20 tệp đính kèm." });
    const safeAttachments = [];
    let attachmentBytes = 0;
    for (const attachment of attachments) {
      const name = String(attachment?.name || "").trim();
      const content = String(attachment?.content || "");
      attachmentBytes += Buffer.byteLength(content, "utf8");
      if (!name || name.length > 300 || content.includes("\u0000")) return json(response, 400, { error: "Tệp đính kèm không hợp lệ hoặc không phải tệp văn bản." });
      safeAttachments.push({ name, content });
    }
    if (attachmentBytes > 1_000_000) return json(response, 400, { error: "Tổng nội dung tệp đính kèm tối đa 1 MB." });
    const workspace = state.workspaces.find((w) => w.id === body.workspaceId);
    if (!workspace) return json(response, 400, { error: "Chọn workspace thật trước khi tạo task." });
    if ((prompt.length < 6 && !safeAttachments.length) || prompt.length > 50000) return json(response, 400, { error: "Nhập ít nhất 6 ký tự hoặc đính kèm tệp; phần chữ tối đa 50.000 ký tự." });
    const connectors = await loadModels();
    const workflow = ["chat-only", "plan-only", "codex-antigravity"].includes(body.workflow) ? body.workflow : "codex-antigravity";
    const permissionPreset = body.permissionPreset === undefined ? "workspace-write" : body.permissionPreset;
    if (!["read-only", "workspace-write", "full-access"].includes(permissionPreset)) return json(response, 400, { error: "Preset quyền không hợp lệ." });
    if (permissionPreset === "read-only" && workflow === "codex-antigravity") {
      return json(response, 400, { error: "Luồng Plan → Build → Review cần quyền ghi vào workspace. Hãy chọn Chỉ lên kế hoạch, Chỉ chat, hoặc đổi quyền sang Ghi trong workspace." });
    }
    const roles = Object.fromEntries(workflowRoles.map((role) => [role.id, requestedRole(body, role.id, connectors)]));
    const chatProvider = String(body.chatProvider || state.settings.defaults?.chatProvider || "codex");
    const chatConnector = connectors[chatProvider];
    const chatModel = String(body.chatModel || state.settings.defaults?.chatModel || chatConnector?.models?.[0]?.id || "");
    const chatModelInfo = chatConnector?.models?.find((item) => item.id === chatModel);
    const chatEffort = String(body.chatEffort || state.settings.defaults?.chatEffort || chatModelInfo?.efforts?.find((item) => item === "medium") || chatModelInfo?.efforts?.[0] || "");
    const config = {
      roles,
      codexModel: roles.plan.provider === "codex" ? roles.plan.model : String(state.settings.defaults?.codexModel || ""),
      codexEffort: roles.plan.provider === "codex" ? roles.plan.effort : String(state.settings.defaults?.codexEffort || "medium"),
      agyModel: roles.build.provider === "antigravity" ? roles.build.model : String(state.settings.defaults?.agyModel || ""),
      agyEffort: roles.build.provider === "antigravity" ? roles.build.effort : String(state.settings.defaults?.agyEffort || "medium"),
      chatProvider, chatModel, chatEffort, workflow,
    };
    if (workflow === "chat-only") {
      const error = validateAgentSelection({ provider: chatProvider, model: chatModel, effort: chatEffort }, "chat", connectors);
      if (error) return json(response, 400, { error });
    } else {
      for (const roleId of workflow === "plan-only" ? ["plan"] : ["plan", "build", "review"]) {
        const error = validateAgentSelection(roles[roleId], roleId, connectors);
        if (error) return json(response, 400, { error });
      }
    }
    let presetRef = null;
    if (body.presetRef !== undefined && body.presetRef !== null) {
      const presetId = String(body.presetRef?.id || "");
      const presetVersion = Number(body.presetRef?.version);
      const preset = state.settings.taskPresets.find((item) => item.id === presetId);
      if (!Number.isSafeInteger(presetVersion) || presetVersion < 1 || !preset?.versions?.some((item) => Number(item.version) === presetVersion)) {
        return json(response, 409, { error: "Mẫu tác vụ đã thay đổi hoặc bị xóa. Hãy chọn lại mẫu trước khi tạo task." });
      }
      presetRef = { id: preset.id, name: preset.name, version: presetVersion };
    }
    const info = await inspectWorkspace(workspace.path);
    const isolated = body.isolated === true;
    if (isolated && (!info.isGit || !info.head)) return json(response, 400, { error: "Tách task cần Git repo có ít nhất một commit. Bỏ chọn cách ly để chạy tuần tự trong workspace." });
    const id = `task-${randomUUID().slice(0, 8)}`;
    const nextSeq = state.tasks.length + 1;
    const rawCode = String(body.code || "").trim().slice(0, 32);
    const code = rawCode || (workflow === "codex-antigravity" ? `LOOP-${String(nextSeq).padStart(2, "0")}` : `TASK-${String(nextSeq).padStart(2, "0")}`);
    const riskLevel = ["S", "M", "L"].includes(String(body.riskLevel || "").toUpperCase())
      ? String(body.riskLevel).toUpperCase()
      : (workflow === "codex-antigravity" ? "M" : "S");
    const milestone = String(body.milestone || "Core").trim().slice(0, 60) || "Core";
    const dependsOn = Array.isArray(body.dependsOn)
      ? [...new Set(body.dependsOn.map((d) => String(d || "").trim()).filter(Boolean))].slice(0, 16)
      : [];
    const planGate = Boolean(body.planGate);
    const maxRounds = Math.max(1, Math.min(3, Number(body.maxRounds) || (workflow === "codex-antigravity" ? 2 : 1)));
    const qaCommand = String(body.qaCommand || "").trim().slice(0, 80);
    const waveIndex = Number(body.waveIndex) > 0 ? Number(body.waveIndex) : undefined;
    const task = {
      id,
      code,
      riskLevel,
      milestone,
      dependsOn,
      planGate,
      planGateApprovedAt: null,
      planGateFeedback: "",
      maxRounds,
      currentRound: 1,
      qaCommand,
      waveIndex,
      cycles: [],
      title: String(body.title || prompt.split(/\r?\n/)[0]).trim().slice(0, 120) || safeAttachments[0]?.name || "Task mới",
      prompt, attachments: safeAttachments, workspaceId: workspace.id, workspacePath: info.path, status: "queued", phase: "queued",
      isolated, config, permissionPreset, presetRef, goal: String(body.goal || "").trim().slice(0, 2000), goalChecklist: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), events: [],
      skillSelectionMode: "auto", skillSelectionCompleted: false, skillIds: [], skills: [],
      memoryUsed: [], storagePath: resolve(taskDir, id),
    };
    state.tasks.unshift(task); persist(); record(task, `Task ${code} được tạo từ giao diện và đưa vào hàng đợi thật.${dependsOn.length ? ` Phụ thuộc: ${dependsOn.join(", ")}.` : ""}`, "success"); pump();
    return json(response, 201, { task });
  }
  if (request.method === "POST" && pathname === "/api/tasks/fanout") {
    const body = await readBody(request);
    const prompt = String(body.prompt || "").trim();
    const attachments = Array.isArray(body.attachments) ? body.attachments : [];
    if (attachments.length > 20) return json(response, 400, { error: "Mỗi tin nhắn chỉ hỗ trợ tối đa 20 tệp đính kèm." });
    const safeAttachments = [];
    let attachmentBytes = 0;
    for (const attachment of attachments) {
      const name = String(attachment?.name || "").trim();
      const content = String(attachment?.content || "");
      attachmentBytes += Buffer.byteLength(content, "utf8");
      if (!name || name.length > 300 || content.includes("\u0000")) return json(response, 400, { error: "Tệp đính kèm không hợp lệ hoặc không phải tệp văn bản." });
      safeAttachments.push({ name, content });
    }
    if (attachmentBytes > 1_000_000) return json(response, 400, { error: "Tổng nội dung tệp đính kèm tối đa 1 MB." });
    const workspace = state.workspaces.find((w) => w.id === body.workspaceId);
    if (!workspace) return json(response, 400, { error: "Chọn workspace thật trước khi chạy Đa luồng Agent." });
    if ((prompt.length < 6 && !safeAttachments.length) || prompt.length > 50000) return json(response, 400, { error: "Nhập ít nhất 6 ký tự hoặc đính kèm tệp." });
    const info = await inspectWorkspace(workspace.path);
    if (!info.isGit || !info.head) return json(response, 400, { error: "Đa luồng Agent cần Git repository có ít nhất 1 commit để tách Git worktree cô lập cho từng nhánh." });
    const competitors = Array.isArray(body.competitors) ? body.competitors : [];
    if (competitors.length < 2 || competitors.length > 8) return json(response, 400, { error: "Chọn từ 2 đến 8 nhánh agent để chạy song song trên các Git worktree." });
    const connectors = await loadModels();
    const workflow = ["chat-only", "plan-only", "codex-antigravity"].includes(body.workflow) ? body.workflow : "chat-only";
    const permissionPreset = body.permissionPreset === undefined ? "workspace-write" : body.permissionPreset;
    if (!["read-only", "workspace-write", "full-access"].includes(permissionPreset)) return json(response, 400, { error: "Preset quyền không hợp lệ." });
    if (permissionPreset === "read-only" && workflow === "codex-antigravity") {
      return json(response, 400, { error: "Luồng Plan → Build → Review cần quyền ghi vào workspace. Hãy chọn Chỉ lên kế hoạch, Chỉ chat, hoặc đổi quyền sang Ghi trong workspace." });
    }
    const normalizedCompetitors = [];
    for (const entry of competitors) {
      const provider = String(entry?.provider || "").trim();
      const connector = connectors[provider];
      if (!connector?.available) return json(response, 400, { error: `${publicProviderName(provider || "Agent")} chưa sẵn sàng.` });
      const model = String(entry?.model || connector.models?.[0]?.id || "").trim();
      const modelInfo = connector.models?.find((item) => item.id === model);
      const effort = String(entry?.effort || modelInfo?.efforts?.find((item) => item === "medium") || modelInfo?.efforts?.[0] || "").trim();
      const requiredCaps = workflow === "chat-only" ? ["chat"] : workflow === "plan-only" ? ["plan"] : ["plan", "build", "review"];
      for (const requiredCap of requiredCaps) {
        const validationError = validateAgentSelection({ provider, model, effort }, requiredCap, connectors);
        if (validationError) return json(response, 400, { error: validationError });
      }
      normalizedCompetitors.push({ provider, model, effort, customLabel: String(entry?.label || "").trim() });
    }
    const fanoutId = `fanout-${randomUUID().slice(0, 8)}`;
    const baseTitle = String(body.title || prompt.split(/\r?\n/)[0]).trim().slice(0, 96) || safeAttachments[0]?.name || "Đa luồng Agent";
    const createdTasks = [];
    for (const [idx, comp] of normalizedCompetitors.entries()) {
      const id = `task-${randomUUID().slice(0, 8)}`;
      const singleRole = { provider: comp.provider, model: comp.model, effort: comp.effort };
      const config = {
        roles: { plan: { ...singleRole }, build: { ...singleRole }, review: { ...singleRole } },
        codexModel: comp.provider === "codex" ? comp.model : String(state.settings.defaults?.codexModel || ""),
        codexEffort: comp.provider === "codex" ? comp.effort : String(state.settings.defaults?.codexEffort || "medium"),
        agyModel: comp.provider === "antigravity" ? comp.model : String(state.settings.defaults?.agyModel || ""),
        agyEffort: comp.provider === "antigravity" ? comp.effort : String(state.settings.defaults?.agyEffort || "medium"),
        chatProvider: comp.provider, chatModel: comp.model, chatEffort: comp.effort, workflow,
      };
      const slotName = comp.customLabel || `#${idx + 1} ${publicProviderName(comp.provider)}${comp.model ? ` (${comp.model})` : ""}`;
      const now = new Date().toISOString();
      const task = {
        id,
        title: `[#${idx + 1} ${publicProviderName(comp.provider)}] ${baseTitle}`.slice(0, 120),
        prompt,
        attachments: safeAttachments,
        workspaceId: workspace.id,
        workspacePath: info.path,
        status: "queued",
        phase: "queued",
        isolated: true,
        fanoutId,
        fanoutProvider: comp.provider,
        fanoutModel: comp.model,
        fanoutLabel: slotName,
        fanoutCompetitor: { index: idx + 1, name: slotName, provider: comp.provider, model: comp.model, effort: comp.effort },
        config,
        permissionPreset,
        goal: String(body.goal || "").trim().slice(0, 2000),
        goalChecklist: [],
        createdAt: now,
        updatedAt: now,
        events: [{ at: now, kind: "success", text: `Khởi tạo trong Đa luồng Song song (${fanoutId} · Nhánh #${idx + 1}) trên Git worktree riêng.` }],
        skillSelectionMode: "auto",
        skillSelectionCompleted: false,
        skillIds: [],
        skills: [],
        memoryUsed: [],
        storagePath: resolve(taskDir, id),
      };
      createdTasks.push(task);
    }
    for (const task of [...createdTasks].reverse()) state.tasks.unshift(task);
    persist(); publish("tasks"); pump();
    return json(response, 201, { fanoutId, tasks: createdTasks });
  }
  if (request.method === "POST" && pathname === "/api/tasks/decompose") {
    const body = await readBody(request);
    const workspace = state.workspaces.find((w) => w.id === body.workspaceId);
    if (!workspace) return json(response, 400, { error: "Chọn workspace thật trước khi khởi tạo chiến dịch Wave DAG." });
    const info = await inspectWorkspace(workspace.path);
    const connectors = await loadModels();
    const roles = Object.fromEntries(workflowRoles.map((role) => [role.id, requestedRole(body, role.id, connectors)]));
    const chatProvider = String(body.chatProvider || state.settings.defaults?.chatProvider || "codex");
    const chatConnector = connectors[chatProvider];
    const chatModel = String(body.chatModel || state.settings.defaults?.chatModel || chatConnector?.models?.[0]?.id || "");
    const chatModelInfo = chatConnector?.models?.find((item) => item.id === chatModel);
    const chatEffort = String(body.chatEffort || state.settings.defaults?.chatEffort || chatModelInfo?.efforts?.find((item) => item === "medium") || chatModelInfo?.efforts?.[0] || "");
    const milestone = String(body.milestone || "Wave Campaign").trim().slice(0, 60) || "Wave Campaign";
    const campaignGoal = String(body.goal || body.prompt || "").trim();
    let rawItems = [];
    if (Array.isArray(body.waves) && body.waves.length) {
      let prevWaveCodes = [];
      let seq = 0;
      for (const wave of body.waves.slice(0, 8)) {
        const wIdx = Math.max(1, Math.min(8, Number(wave.index) || 1));
        const currentWaveCodes = [];
        for (const t of (Array.isArray(wave.tasks) ? wave.tasks : []).slice(0, 8)) {
          seq += 1;
          const code = String(t.code || `WAVE-${String(seq).padStart(2, "0")}`).trim().slice(0, 32);
          currentWaveCodes.push(code);
          rawItems.push({
            ...t,
            code,
            waveIndex: wIdx,
            workflow: t.workflow || body.workflow || "codex-antigravity",
            planGate: t.planGate !== undefined ? Boolean(t.planGate) : Boolean(body.planGate),
            maxRounds: Number(t.maxRounds || body.maxRounds) || 2,
            qaCommand: String(t.qaCommand || body.qaCommand || "").trim(),
            dependsOn: Array.isArray(t.dependsOn) && t.dependsOn.length ? t.dependsOn : [...prevWaveCodes],
          });
        }
        if (currentWaveCodes.length) prevWaveCodes = currentWaveCodes;
      }
    } else if (Array.isArray(body.items) && body.items.length) {
      rawItems = body.items.slice(0, 12);
    } else if (campaignGoal.length >= 6) {
      const shortTitle = campaignGoal.split(/\r?\n/)[0].trim().slice(0, 72);
      rawItems = [
        {
          code: "WAVE-01",
          waveIndex: 1,
          riskLevel: "S",
          workflow: "plan-only",
          planGate: false,
          title: `[Wave 1 · Spec & Kiến trúc] ${shortTitle}`,
          prompt: `Phân tích yêu cầu tổng thể, xác định các tệp liên quan, giao thức dữ liệu và rủi ro cho chiến dịch:\n\n${campaignGoal}`,
          dependsOn: [],
        },
        {
          code: "WAVE-02",
          waveIndex: 2,
          riskLevel: "M",
          workflow: body.workflow || "codex-antigravity",
          planGate: Boolean(body.planGate),
          maxRounds: 2,
          title: `[Wave 2 · Triển khai Core] ${shortTitle}`,
          prompt: `Triển khai mã nguồn cốt lõi theo kiến trúc của chiến dịch:\n\n${campaignGoal}`,
          dependsOn: ["WAVE-01"],
        },
        {
          code: "WAVE-03",
          waveIndex: 3,
          riskLevel: "L",
          workflow: body.workflow || "codex-antigravity",
          planGate: false,
          maxRounds: 2,
          qaCommand: String(body.qaCommand || "").trim(),
          title: `[Wave 3 · Kiểm thử QA & Hoàn thiện] ${shortTitle}`,
          prompt: `Rà soát tích hợp, bổ sung kiểm thử và xác minh toàn bộ tính năng cho chiến dịch:\n\n${campaignGoal}`,
          dependsOn: ["WAVE-02"],
        },
      ];
    }
    if (!rawItems.length) {
      return json(response, 400, { error: "Nhập mục tiêu chiến dịch (tối thiểu 6 ký tự) hoặc danh sách các node trong Wave." });
    }
    const campaignId = `wave-${randomUUID().slice(0, 8)}`;
    const codeToId = new Map();
    const createdTasks = [];
    const isolatedDefault = Boolean(body.isolated && info.isGit && info.head);
    for (const [idx, item] of rawItems.entries()) {
      const id = `task-${randomUUID().slice(0, 8)}`;
      const itemWorkflow = ["chat-only", "plan-only", "codex-antigravity"].includes(item.workflow || body.workflow) ? (item.workflow || body.workflow) : "codex-antigravity";
      const code = String(item.code || `WAVE-${String(idx + 1).padStart(2, "0")}`).trim().slice(0, 32);
      codeToId.set(code.toUpperCase(), id);
      const itemDeps = Array.isArray(item.dependsOn)
        ? item.dependsOn.map((dep) => {
            const ref = String(dep || "").trim();
            return codeToId.get(ref.toUpperCase()) || ref;
          }).filter(Boolean)
        : [];
      const config = {
        roles: structuredClone(roles),
        codexModel: roles.plan.provider === "codex" ? roles.plan.model : String(state.settings.defaults?.codexModel || ""),
        codexEffort: roles.plan.provider === "codex" ? roles.plan.effort : String(state.settings.defaults?.codexEffort || "medium"),
        agyModel: roles.build.provider === "antigravity" ? roles.build.model : String(state.settings.defaults?.agyModel || ""),
        agyEffort: roles.build.provider === "antigravity" ? roles.build.effort : String(state.settings.defaults?.agyEffort || "medium"),
        chatProvider, chatModel, chatEffort, workflow: itemWorkflow,
      };
      const now = new Date().toISOString();
      const task = {
        id,
        campaignId,
        code,
        waveIndex: Number(item.waveIndex) > 0 ? Number(item.waveIndex) : idx + 1,
        riskLevel: ["S", "M", "L"].includes(String(item.riskLevel || "").toUpperCase()) ? String(item.riskLevel).toUpperCase() : "M",
        milestone: String(item.milestone || milestone).trim().slice(0, 60),
        dependsOn: itemDeps,
        planGate: Boolean(item.planGate),
        planGateApprovedAt: null,
        planGateFeedback: "",
        maxRounds: Math.max(1, Math.min(3, Number(item.maxRounds) || 2)),
        currentRound: 1,
        qaCommand: String(item.qaCommand || body.qaCommand || "").trim().slice(0, 80),
        cycles: [],
        title: String(item.title || `Wave ${idx + 1}`).trim().slice(0, 120),
        prompt: String(item.prompt || campaignGoal).trim().slice(0, 50000),
        attachments: [],
        workspaceId: workspace.id,
        workspacePath: info.path,
        status: "queued",
        phase: "queued",
        isolated: item.isolated !== undefined ? Boolean(item.isolated && info.isGit && info.head) : isolatedDefault,
        config,
        permissionPreset: "workspace-write",
        goal: campaignGoal.slice(0, 2000),
        goalChecklist: [],
        createdAt: now,
        updatedAt: now,
        events: [{ at: now, kind: "success", text: `Khởi tạo trong chiến dịch Wave DAG (${code} · Wave ${Number(item.waveIndex) || idx + 1}).` }],
        skillSelectionMode: "auto",
        skillSelectionCompleted: false,
        skillIds: [],
        skills: [],
        memoryUsed: [],
        storagePath: resolve(taskDir, id),
      };
      createdTasks.push(task);
    }
    for (const task of [...createdTasks].reverse()) state.tasks.unshift(task);
    persist(); publish("tasks"); pump();
    return json(response, 201, { campaignId, tasks: createdTasks });
  }
  const match = pathname.match(/^\/api\/tasks\/([^/]+)(?:\/(run|stop|diff|open|chat|pin|archive|fork|goal|checklist|plan-gate|qa|exec|git-commit|github-pr|apply-worktree|discard-worktree|worktree\/apply|worktree\/discard))?$/);
  if (match) {
    const id = decodeURIComponent(match[1]);
    const action = match[2] || "";
    const task = state.tasks.find((t) => t.id === id);
    if (!task) return json(response, 404, { error: "Task không tồn tại." });
    if (request.method === "DELETE" && !action) {
      if (!task.archived) return json(response, 409, { error: "Chỉ có thể xóa chat sau khi đã lưu trữ." });
      if (running.has(task.id) || ["queued", "running"].includes(task.status)) return json(response, 409, { error: "Không thể xóa chat đang chạy hoặc đang chờ." });
      const storagePath = resolve(String(task.storagePath || resolve(taskDir, task.id)));
      if (!within(taskDir, storagePath) || storagePath === taskDir) return json(response, 400, { error: "Đường dẫn dữ liệu task không hợp lệ; không thể xóa chat an toàn." });
      try {
        await cleanupTaskWorktrees(task);
        await fs.rm(storagePath, { recursive: true, force: true });
      }
      catch (error) { return json(response, 500, { error: `Không thể xóa dữ liệu chat: ${safeError(error)}` }); }
      state.tasks = state.tasks.filter((item) => item.id !== task.id);
      persist(); publish("tasks");
      return json(response, 200, { deleted: true, id: task.id });
    }
    if (request.method === "PATCH" && !action) {
      const body = await readBody(request);
      if (body.permissionPreset !== undefined) {
        if (!["read-only", "workspace-write", "full-access"].includes(body.permissionPreset)) return json(response, 400, { error: "Preset quyền không hợp lệ." });
        if (["queued", "running"].includes(task.status)) return json(response, 409, { error: "Hãy đợi task kết thúc trước khi đổi quyền." });
        task.permissionPreset = body.permissionPreset;
      }
      if (body.title !== undefined) {
        const title = String(body.title || "").trim();
        if (!title || title.length > 120) return json(response, 400, { error: "Tên chat cần từ 1 đến 120 ký tự." });
        task.title = title;
      }
      if (body.riskLevel !== undefined && ["S", "M", "L"].includes(String(body.riskLevel).toUpperCase())) {
        task.riskLevel = String(body.riskLevel).toUpperCase();
      }
      if (body.milestone !== undefined) {
        task.milestone = String(body.milestone || "Core").trim().slice(0, 60) || "Core";
      }
      if (body.code !== undefined) {
        task.code = String(body.code || "").trim().slice(0, 32) || task.code;
      }
      if (body.planGate !== undefined) {
        task.planGate = Boolean(body.planGate);
      }
      if (body.maxRounds !== undefined) {
        task.maxRounds = Math.max(1, Math.min(3, Number(body.maxRounds) || 1));
      }
      if (body.qaCommand !== undefined) {
        task.qaCommand = String(body.qaCommand || "").trim().slice(0, 80);
      }
      if (Array.isArray(body.dependsOn)) {
        task.dependsOn = [...new Set(body.dependsOn.map((d) => String(d || "").trim()).filter((d) => d && d !== task.id))].slice(0, 16);
      }
      task.updatedAt = new Date().toISOString();
      persist(); publish("tasks"); pump(); return json(response, 200, { task });
    }
    if (request.method === "POST" && action === "plan-gate") {
      const body = await readBody(request);
      const decision = String(body.decision || body.action || "approve").toLowerCase();
      const feedback = String(body.feedback || "").trim().slice(0, 4000);
      if (running.has(task.id)) return json(response, 409, { error: "Task đang chạy tiến trình; vui lòng đợi giây lát." });
      if (feedback) task.planGateFeedback = feedback;
      if (decision === "revise" || decision === "reject") {
        task.plan = "";
        task.planGateApprovedAt = null;
        task.resumeFrom = "plan";
        task.status = "queued";
        task.phase = "plan";
        task.updatedAt = new Date().toISOString();
        record(task, `Bạn đã yêu cầu lập lại kế hoạch tại Plan Gate${feedback ? `: "${feedback.slice(0, 200)}"` : "."}`, "warning");
        persist(); publish("tasks"); pump();
        return json(response, 200, { ok: true, decision: "revise", task });
      }
      task.planGateApprovedAt = new Date().toISOString();
      const planCycle = (task.cycles || []).find((c) => c.stage === "plan");
      if (planCycle) {
        planCycle.status = "clean";
        planCycle.badge = "GO approved";
      }
      if (task.config?.workflow === "plan-only") {
        task.status = "done";
        task.phase = "done";
        task.completedAt = task.planGateApprovedAt;
        task.updatedAt = task.planGateApprovedAt;
        const ws = state.workspaces.find((w) => w.id === task.workspaceId);
        if (ws) autoDistillTaskMemory(task, ws);
        record(task, `Bạn đã duyệt kế hoạch (Plan Gate · GO)${feedback ? ` với ghi chú: "${feedback.slice(0, 200)}"` : ""}.`, "success");
        persist(); publish("tasks"); pump();
        return json(response, 200, { ok: true, decision: "approve", task });
      }
      task.resumeFrom = "build";
      task.status = "queued";
      task.phase = "build";
      task.updatedAt = task.planGateApprovedAt;
      record(task, `Bạn đã duyệt kế hoạch (Plan Gate · GO)${feedback ? ` với ghi chú: "${feedback.slice(0, 200)}"` : ""}. Bắt đầu triển khai code.`, "success");
      persist(); publish("tasks"); pump();
      return json(response, 200, { ok: true, decision: "approve", task });
    }
    if (request.method === "POST" && (action === "qa" || action === "exec")) {
      const body = await readBody(request);
      const cwd = task.executionPath || task.workspacePath;
      if (!cwd || !existsSync(cwd)) return json(response, 404, { error: "Không tìm thấy thư mục thực thi của task." });
      try {
        const result = await runTaskQaCheck(task, cwd, body.command);
        recordTaskCycle(task, {
          id: `cycle-qa-${Number(task.currentRound || 1)}`,
          round: Number(task.currentRound || 1),
          stage: "qa",
          title: `QA · ${result.status === "passed" ? "specs passed" : "specs failed"}`,
          provider: "QA Runner",
          model: result.command,
          status: result.status === "passed" ? "clean" : "blocking",
          badge: result.summary,
          blocking: result.status === "failed" ? 1 : 0,
          advisory: 0,
          turns: 1,
          durationMs: result.durationMs,
          summary: String(result.output || "").slice(0, 600),
        });
        persist(); publish("task");
        return json(response, 200, { ok: true, result, qaResult: result, task });
      } catch (error) {
        return json(response, 400, { error: safeError(error) });
      }
    }
    if (request.method === "POST" && action === "git-commit") {
      const body = await readBody(request);
      const cwd = task.executionPath || task.workspacePath;
      if (!cwd || !existsSync(cwd)) return json(response, 404, { error: "Không tìm thấy thư mục workspace để commit." });
      const info = await inspectWorkspace(cwd).catch(() => null);
      if (!info?.isGit) return json(response, 400, { error: "Workspace không phải là Git repository." });
      const message = String(body.message || `${task.code ? `${task.code}: ` : ""}${task.title || "Update from OpenSybau"}`).trim().slice(0, 200);
      if (!message) return json(response, 400, { error: "Nhập nội dung commit message." });
      const repoRoot = info.gitRoot || cwd;
      try {
        const commitInfo = await withGitRepoLock(repoRoot, async () => {
          await git(cwd, ["add", "-A"]);
          const statusRes = await git(cwd, ["status", "--porcelain"]);
          if (!(statusRes.stdout || "").trim()) {
            throw new Error("Không có thay đổi nào cần commit trong workspace/worktree này.");
          }
          const commitRes = await git(cwd, ["commit", "-m", message]);
          if (commitRes.code !== 0) {
            throw new Error((commitRes.stderr || commitRes.stdout || "git commit thất bại").trim().slice(0, 400));
          }
          const headRes = await git(cwd, ["rev-parse", "--short", "HEAD"]);
          return { hash: (headRes.stdout || "").trim(), output: (commitRes.stdout || "").trim() };
        });
        task.commitHash = commitInfo.hash;
        task.lastCommitMessage = message;
        task.committedAt = new Date().toISOString();
        record(task, `Đã tạo Git commit ${commitInfo.hash} ("${message}").`, "success");
        persist(); publish("tasks");
        return json(response, 200, { ok: true, commitHash: commitInfo.hash, output: commitInfo.output, task });
      } catch (error) {
        return json(response, 409, { error: safeError(error) });
      }
    }
    if (request.method === "POST" && action === "github-pr") {
      const body = await readBody(request);
      const cwd = task.executionPath || task.workspacePath;
      if (!cwd || !existsSync(cwd)) return json(response, 404, { error: "Không tìm thấy thư mục workspace để tạo Pull Request." });
      const info = await inspectWorkspace(cwd).catch(() => null);
      if (!info?.isGit) return json(response, 400, { error: "Workspace không phải là Git repository." });
      const title = String(body.title || `${task.code ? `${task.code}: ` : ""}${task.title || "Pull Request from OpenSybau"}`).trim().slice(0, 180);
      const defaultBody = [
        `## Yêu cầu`,
        String(task.prompt || "").slice(0, 2000),
        task.plan ? `\n## Kế hoạch\n${String(task.plan).slice(0, 3000)}` : "",
        task.implementation ? `\n## Triển khai\n${String(task.implementation).slice(0, 3000)}` : "",
        task.review ? `\n## Review\n${String(task.review).slice(0, 2000)}` : "",
      ].filter(Boolean).join("\n");
      const prBody = String(body.body || defaultBody).trim().slice(0, 12_000);
      try {
        const result = await createTaskGithubPullRequest(
          cwd,
          { title, body: prBody, baseBranch: String(body.baseBranch || "").trim(), draft: Boolean(body.draft) },
          run,
          git
        );
        task.pullRequestUrl = result.url || task.pullRequestUrl || "";
        task.updatedAt = new Date().toISOString();
        record(task, `Đã tạo GitHub Pull Request trên nhánh ${result.branch}${result.url ? `: ${result.url}` : "."}`, "success");
        persist(); publish("tasks");
        return json(response, 200, { ...result, task });
      } catch (error) {
        return json(response, 400, { error: safeError(error) });
      }
    }
    if (request.method === "POST" && action === "fork") {
      const body = await readBody(request);
      const messageIndex = (task.chatMessages || []).findIndex((item) => item.id === body.messageId && item.role === "user");
      if (messageIndex < 0) return json(response, 404, { error: "Không tìm thấy lượt chat để fork." });
      const sourceMessage = task.chatMessages[messageIndex];
      if (sourceMessage.status && sourceMessage.status !== "done") return json(response, 409, { error: "Chỉ có thể fork từ lượt chat đã hoàn tất." });
      const copiedMessages = task.chatMessages.slice(0, messageIndex + 1).filter((item) => !item.status || item.status === "done");
      const reply = task.chatMessages.find((item) => item.role === "assistant" && item.replyToMessageId === sourceMessage.id && (!item.status || item.status === "done"));
      if (reply) copiedMessages.push(reply);
      const forkId = `task-${randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      const clonedConfig = structuredClone(task.config || {});
      clonedConfig.workflow = "chat-only";
      clonedConfig.chatProvider = sourceMessage.provider || task.config?.chatProvider;
      clonedConfig.chatModel = sourceMessage.model || task.config?.chatModel;
      clonedConfig.chatEffort = sourceMessage.effort || task.config?.chatEffort;
      const forkTask = {
        id: forkId, title: `Fork: ${task.title}`.slice(0, 120), prompt: task.prompt, workspaceId: task.workspaceId, workspacePath: task.workspacePath,
        status: "done", phase: "done", isolated: false, config: clonedConfig, permissionPreset: task.permissionPreset || "workspace-write",
        plan: task.plan || "", implementation: task.implementation || "", review: task.review || "",
        goal: task.goal || "", goalChecklist: (task.goalChecklist || []).map((item) => ({ ...item })), chatMessages: structuredClone(copiedMessages), chatQueue: [],
        forkedFrom: task.id, forkedFromMessageId: sourceMessage.id, createdAt: now, updatedAt: now, completedAt: now,
        events: [{ at: now, kind: "success", text: `Forked from ${task.title} at a completed user message.` }],
        skills: structuredClone(task.skills || []), skillIds: [...(task.skillIds || [])], memoryUsed: structuredClone(task.memoryUsed || []),
        storagePath: resolve(taskDir, forkId),
      };
      await fs.mkdir(forkTask.storagePath, { recursive: true });
      state.tasks.unshift(forkTask); persist(); publish("tasks");
      return json(response, 201, { task: forkTask });
    }
    if (request.method === "POST" && action === "goal") {
      const body = await readBody(request);
      if (["queued", "running"].includes(task.status)) return json(response, 409, { error: "Hãy đợi task kết thúc trước khi sửa mục tiêu." });
      const goal = String(body.goal || "").trim();
      if (goal.length > 2000) return json(response, 400, { error: "Mục tiêu tối đa 2.000 ký tự." });
      if (!Array.isArray(body.checklist) || body.checklist.length > 20) return json(response, 400, { error: "Checklist cần là danh sách tối đa 20 mục." });
      const checklist = [];
      for (const [index, entry] of body.checklist.entries()) {
        const text = String(typeof entry === "string" ? entry : entry.text || "").trim();
        if (!text || text.length > 300) return json(response, 400, { error: "Mỗi mục checklist cần từ 1 đến 300 ký tự." });
        const old = (task.goalChecklist || []).find((item) => item.id === entry?.id) || (task.goalChecklist || [])[index];
        checklist.push({ id: old?.id || randomUUID(), text, done: Boolean(old?.done) });
      }
      task.goal = goal; task.goalChecklist = checklist; task.updatedAt = new Date().toISOString();
      persist(); publish("tasks"); return json(response, 200, { task });
    }
    if (request.method === "POST" && action === "checklist") {
      const body = await readBody(request);
      const item = (task.goalChecklist || []).find((entry) => entry.id === body.id);
      if (!item) return json(response, 404, { error: "Không tìm thấy mục checklist." });
      item.done = Boolean(body.done); task.updatedAt = new Date().toISOString(); persist(); publish("tasks");
      return json(response, 200, { task });
    }
    if (request.method === "POST" && action === "pin") {
      const body = await readBody(request); task.pinned = Boolean(body.pinned);
      persist(); publish("tasks"); return json(response, 200, { task });
    }
    if (request.method === "POST" && action === "archive") {
      const body = await readBody(request); task.archived = Boolean(body.archived);
      persist(); publish("tasks"); return json(response, 200, { task });
    }
    if (request.method === "POST" && action === "chat") {
      const body = await readBody(request);
      const content = String(body.message || "").trim();
      const attachments = Array.isArray(body.attachments) ? body.attachments : [];
      if ((!content && !attachments.length) || content.length > 50000) return json(response, 400, { error: "Tin nhắn cần có nội dung hoặc tệp đính kèm; phần chữ tối đa 50.000 ký tự." });
      if (attachments.length > 20) return json(response, 400, { error: "Mỗi tin nhắn chỉ hỗ trợ tối đa 20 tệp đính kèm." });
      const safeAttachments = [];
      let attachmentBytes = 0;
      for (const attachment of attachments) {
        const name = String(attachment?.name || "").trim();
        const fileContent = String(attachment?.content || "");
        attachmentBytes += Buffer.byteLength(fileContent, "utf8");
        if (!name || name.length > 300 || fileContent.includes("\u0000")) return json(response, 400, { error: "Tệp đính kèm không hợp lệ hoặc không phải tệp văn bản." });
        safeAttachments.push({ name, content: fileContent });
      }
      if (attachmentBytes > 1_000_000) return json(response, 400, { error: "Tổng nội dung tệp đính kèm tối đa 1 MB." });
      const provider = String(body.provider || "");
      const connectors = await loadModels();
      const connector = connectors[provider];
      if (!connector?.available || !connector.capabilities?.chat || provider === "codex" && !connector.authenticated) return json(response, 503, { error: connector?.error || `${publicProviderName(provider)} chưa sẵn sàng để chat.` });
      if (task.permissionPreset === "read-only" && provider === "antigravity") return json(response, 409, { error: "Antigravity CLI chưa có chế độ chỉ đọc cho lần chạy nền. Hãy chọn Codex/Claude/API hoặc đổi preset quyền." });
      const model = connector.models.find((item) => item.id === String(body.model || ""));
      const effort = String(body.effort || "");
      if (!model || !model.efforts.includes(effort)) return json(response, 400, { error: `Model hoặc mức suy nghĩ không hợp lệ cho ${publicProviderName(provider)}.` });
      const workspace = state.workspaces.find((item) => item.id === task.workspaceId);
      if (!workspace) return json(response, 404, { error: "Workspace của task không còn tồn tại." });
      const currentRun = running.get(task.id);
      if (task.status === "cancelled" && currentRun?.stopped) return json(response, 409, { error: "Task đang dừng. Hãy gửi tin nhắn lại sau khi tiến trình đã kết thúc." });
      const sharedLock = usesSharedCheckout(task);
      const lockKey = workspaceLockKey(sharedLock ? workspace.path : (task.executionPath || task.worktreePath || workspace.path));
      const workspaceBusy = !currentRun && sharedLock && busyWorkspaces.has(lockKey);
      const message = { id: randomUUID(), role: "user", provider, model: model.id, effort, content, attachments: safeAttachments.map(({ name }) => ({ name })), status: "queued", createdAt: new Date().toISOString() };
      task.config ||= {};
      task.config.chatProvider = provider;
      task.config.chatModel = model.id;
      task.config.chatEffort = effort;
      task.chatMessages ||= [];
      task.chatQueue ||= [];
      task.chatMessages.push(message);
      task.chatQueue.push({ id: randomUUID(), messageId: message.id, provider, model: model.id, effort, content, attachments: safeAttachments });
      const queuedPosition = task.chatQueue.length;
      record(task, `Đã nhận tin nhắn chat cho ${publicProviderName(provider)}${currentRun && !currentRun.isChat ? "; sẽ chuyển sau stage đang chạy" : workspaceBusy ? "; đang chờ workspace rảnh" : ""}.`, "chat");
      persist();
      if (!currentRun && task.status !== "queued") void processTaskChatQueue(task);
      else if (!currentRun) pump();
      return json(response, 202, { accepted: true, queuedPosition, task });
    }
    if (request.method === "POST" && action === "run") {
      const body = await readBody(request);
      const canReplayCompleted = task.config?.workflow !== "chat-only";
      if (!(["failed", "cancelled"].includes(task.status) || canReplayCompleted && task.status === "done")) return json(response, 409, { error: "Chỉ có thể chạy lại task đã hoàn tất, dừng hoặc thất bại." });
      if (running.has(task.id)) return json(response, 409, { error: "Task vẫn đang dừng. Hãy thử lại sau khi tiến trình kết thúc." });
      const stage = body.stage === undefined ? inferredRerunStage(task) : String(body.stage);
      if (!supportedRerunStages(task).includes(stage)) return json(response, 400, { error: "Giai đoạn chạy lại không hợp lệ với luồng của task." });
      if (task.config?.workflow === "chat-only" && task.status === "done") return json(response, 409, { error: "Chat đã hoàn tất. Hãy gửi tin nhắn mới để tiếp tục cuộc trò chuyện." });
      if (task.permissionPreset === "read-only" && task.config?.workflow === "codex-antigravity" && (stage === "plan" || stage === "build")) {
        return json(response, 400, { error: "Luồng Plan → Build → Review cần quyền ghi vào workspace. Hãy đổi quyền sang Ghi trong workspace trước khi chạy lại." });
      }
      const workspace = state.workspaces.find((item) => item.id === task.workspaceId);
      if (!workspace) return json(response, 404, { error: "Workspace của task không còn tồn tại." });
      const connectors = await loadModels();
      const notices = [];
      task.config ||= {};
      task.config.roles ||= {};
      for (const roleId of ["plan", "build", "review"]) {
        const role = { ...roleConfig(task.config, roleId) };
        const roleModel = connectors[role.provider]?.models?.find((model) => model.id === role.model);
        if (roleModel && roleModel.efforts?.length && !roleModel.efforts.includes(role.effort)) {
          const previousEffort = role.effort;
          role.effort = roleModel.efforts[0];
          if (roleId === "plan" && role.provider === "codex") task.config.codexEffort = role.effort;
          if (roleId === "build" && role.provider === "antigravity") task.config.agyEffort = role.effort;
          notices.push(`Mức suy nghĩ ${previousEffort} cũ không tương thích với model ${roleModel.name}; dùng ${role.effort} theo cấu hình agent.`);
        }
        task.config.roles[roleId] = role;
      }
      if (task.config.chatProvider && task.config.chatModel) {
        const chatModel = connectors[task.config.chatProvider]?.models?.find((model) => model.id === task.config.chatModel);
        if (chatModel && chatModel.efforts?.length && !chatModel.efforts.includes(task.config.chatEffort)) {
          const previousEffort = task.config.chatEffort;
          task.config.chatEffort = chatModel.efforts[0];
          notices.push(`Mức suy nghĩ chat ${previousEffort} cũ không tương thích với model ${chatModel.name}; dùng ${task.config.chatEffort}.`);
        }
      }
      if (notices.length) task.retryNotice = notices[0];
      const now = new Date().toISOString();
      const attempt = createStageRerunSnapshot(task, stage, now);
      task.stageRunHistory = [...(task.stageRunHistory || []), attempt].slice(-5);
      task.activeStageRunId = attempt.id;
      task.resumeFrom = stage;
      const stageOrder = task.config?.workflow === "plan-only" ? ["plan"] : ["plan", "build", "review"];
      const affected = stage === "chat" ? [] : stageOrder.slice(stageOrder.indexOf(stage));
      if (affected.includes("plan")) task.plan = "";
      if (affected.includes("build")) task.implementation = "";
      if (affected.includes("review")) task.review = "";
      if (affected.includes("plan") || affected.includes("build")) task.artifacts = [];
      if (stage === "chat" || affected.includes("plan") || affected.includes("build")) task.worktreeAppliedAt = null;
      task.status = "queued"; task.phase = "queued"; task.error = null; task.failedPhase = null; task.stageFailure = null; task.completedAt = null;
      persist(); record(task, `Đưa task vào hàng đợi chạy lại từ stage ${stage}; giữ các đầu ra trước đó trong lịch sử.${task.retryNotice ? ` ${task.retryNotice}` : ""}`, "success"); pump(); return json(response, 202, { task });
    }
    if (request.method === "POST" && action === "stop") {
      const active = running.get(task.id);
      if (task.status === "queued" && !active) {
        task.failedPhase = task.phase;
        task.status = "cancelled"; task.phase = "cancelled";
        finishStageRerun(task, "cancelled", "Đã hủy khi task còn trong hàng đợi.");
        const abandoned = failQueuedChatTurns(task, true);
        record(task, `Đã hủy khi task còn trong hàng đợi.${abandoned ? ` Đã hủy ${abandoned} tin nhắn đang chờ.` : ""}`, "warning");
        persist();
        return json(response, 200, { task });
      }
      if (!active) return json(response, 409, { error: "Task không chạy." });
      active.stopped = true;
      if (active.child) killTree(active.child);
      if (active.abortController) active.abortController.abort(new Error("Stopped by user"));
      const abandoned = failQueuedChatTurns(task, true);
      if (active.isChat && task.preChatStatus === "done") {
        task.status = "done";
        task.phase = "done";
        task.error = null;
        record(task, `Đã dừng lượt chat theo yêu cầu; giữ nguyên kết quả task đã hoàn tất.${abandoned ? ` Đã hủy ${abandoned} tin nhắn đang chờ.` : ""}`, "warning");
        persist();
        return json(response, 202, { task });
      }
      finishStageRerun(task, "cancelled", "Đã dừng theo yêu cầu.");
      task.failedPhase = task.phase;
      task.status = "cancelled"; task.phase = "cancelled"; task.completedAt = new Date().toISOString();
      record(task, `Đã gửi yêu cầu dừng tới tiến trình CLI.${abandoned ? ` Đã hủy ${abandoned} tin nhắn đang chờ.` : ""}`, "warning");
      persist();
      return json(response, 202, { task });
    }
    if (request.method === "POST" && (action === "apply-worktree" || action === "worktree/apply")) {
      const body = await readBody(request);
      try {
        const updated = await applyTaskWorktree(task, { cleanup: Boolean(body.cleanup) });
        return json(response, 200, { ok: true, task: updated, appliedFiles: updated.appliedFiles || [] });
      } catch (error) {
        return json(response, 409, { error: safeError(error) });
      }
    }
    if (request.method === "POST" && (action === "discard-worktree" || action === "worktree/discard")) {
      try {
        await discardTaskWorktree(task);
        return json(response, 200, { ok: true, task });
      } catch (error) {
        return json(response, 409, { error: safeError(error) });
      }
    }
    if (request.method === "GET" && action === "diff") {
      const diff = await checkDiff(task);
      const files = parseUnifiedDiffFiles(diff);
      return json(response, 200, {
        diff,
        path: task.executionPath || task.workspacePath,
        files,
        worktree: {
          isolated: Boolean(task.isolated),
          worktreePath: task.worktreePath || null,
          branch: task.worktreeBranch || null,
          appliedAt: task.worktreeAppliedAt || null,
          cleaned: Boolean(task.worktreeCleaned),
        },
      });
    }
    if (request.method === "POST" && action === "open") {
      const path = task.executionPath || task.workspacePath;
      if (!path || !existsSync(path)) return json(response, 404, { error: "Không tìm thấy thư mục workspace để mở." });
      await openFolder(path);
      return json(response, 200, { ok: true });
    }
    if (request.method === "GET" && !action) return json(response, 200, task);
  }
  if (pathname === "/api/task-presets" && request.method === "GET") {
    return json(response, 200, { presets: state.settings.taskPresets });
  }
  if (pathname === "/api/task-presets" && request.method === "POST") {
    const body = await readBody(request);
    const name = String(body.name || "").trim();
    if (!name || name.length > 80) return json(response, 400, { error: "Tên mẫu cần từ 1 đến 80 ký tự." });
    let profile;
    try { profile = normalizeTaskPresetProfile(body.profile); }
    catch (error) { return json(response, 400, { error: safeError(error) }); }
    const id = String(body.id || "");
    let preset = id ? state.settings.taskPresets.find((item) => item.id === id) : null;
    if (id && !preset) return json(response, 404, { error: "Không tìm thấy mẫu tác vụ cần tạo phiên bản mới." });
    const duplicateName = state.settings.taskPresets.find((item) => item.id !== id && String(item.name || "").toLocaleLowerCase() === name.toLocaleLowerCase());
    if (duplicateName) return json(response, 409, { error: "Tên mẫu này đã được dùng. Chọn tên khác hoặc chọn mẫu đó để lưu phiên bản mới." });
    if (!preset && state.settings.taskPresets.length >= 50) return json(response, 409, { error: "Đã đạt giới hạn 50 mẫu tác vụ." });
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
    return json(response, 201, { preset });
  }
  const taskPresetMatch = pathname.match(/^\/api\/task-presets\/([^/]+)$/);
  if (request.method === "DELETE" && taskPresetMatch) {
    const id = decodeURIComponent(taskPresetMatch[1]);
    const before = state.settings.taskPresets.length;
    state.settings.taskPresets = state.settings.taskPresets.filter((item) => item.id !== id);
    if (state.settings.taskPresets.length === before) return json(response, 404, { error: "Mẫu tác vụ không tồn tại." });
    persist(); publish("settings");
    return json(response, 200, { ok: true });
  }
  if (request.method === "POST" && pathname === "/api/settings") {
    const body = await readBody(request);
    if (body.maxConcurrent !== undefined) {
      const next = Number(body.maxConcurrent);
      if (!Number.isInteger(next) || next < 1 || next > 8) return json(response, 400, { error: "Giới hạn song song phải từ 1 đến 8." });
      state.settings.maxConcurrent = next;
    }
    if (body.defaults !== undefined) {
      const connectors = await loadModels();
      const defaults = body.defaults;
      if (defaults.roles !== undefined) {
        if (!defaults.roles || typeof defaults.roles !== "object" || Array.isArray(defaults.roles)) return json(response, 400, { error: "Cấu hình vai trò agent không hợp lệ." });
        const roles = {};
        for (const role of workflowRoles) {
          const selection = defaults.roles[role.id];
          if (!selection) return json(response, 400, { error: `Thiếu cấu hình vai trò ${role.label}.` });
          const normalized = { provider: String(selection.provider || ""), model: String(selection.model || ""), effort: String(selection.effort || "") };
          const error = validateAgentSelection(normalized, role.id, connectors);
          if (error) return json(response, 400, { error });
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
        if (defaults.codexModel !== undefined && (!codex || !codex.efforts.includes(defaults.codexEffort))) return json(response, 400, { error: "Model hoặc mức suy nghĩ Codex không được CLI hỗ trợ." });
        if (defaults.agyModel !== undefined && (!agy || !agy.efforts.includes(defaults.agyEffort))) return json(response, 400, { error: "Model hoặc mức suy nghĩ Antigravity không được CLI hỗ trợ." });
        state.settings.defaults = { ...state.settings.defaults, ...Object.fromEntries(["codexModel", "codexEffort", "agyModel", "agyEffort"].filter((key) => defaults[key] !== undefined).map((key) => [key, defaults[key]])) };
      }
    }
    if (body.vaultPath !== undefined) {
      const requested = normalizeDirectoryInput(body.vaultPath);
      if (!requested) state.settings.vaultPath = "";
      else {
        if (isForbiddenSystemPath(requested)) return json(response, 400, { error: "Không được chọn thư mục gốc ổ đĩa hoặc thư mục hệ thống nhạy cảm làm vault." });
        let realPath;
        try { realPath = await fs.realpath(resolve(requested)); }
        catch (error) {
          if (error.code === "ENOENT" || error.code === "ENOTDIR") throw new Error(`Không tìm thấy thư mục vault “${requested}”. Hãy kiểm tra đường dẫn và chắc chắn thư mục còn tồn tại.`);
          throw error;
        }
        const stat = await fs.stat(realPath);
        if (!stat.isDirectory()) return json(response, 400, { error: "Đường dẫn vault phải là một thư mục có thật." });
        if (isForbiddenSystemPath(realPath)) return json(response, 400, { error: "Không được chọn thư mục gốc ổ đĩa hoặc thư mục hệ thống nhạy cảm làm vault." });
        state.settings.vaultPath = realPath;
      }
    }
    persist(); publish("settings"); pump(); return json(response, 200, state.settings);
  }
  if (request.method === "POST" && pathname === "/api/memory") {
    const body = await readBody(request);
    const title = String(body.title || "").trim(); const content = String(body.content || "").trim();
    if (!title || !content || title.length > 120 || content.length > 5000) return json(response, 400, { error: "Tên tối đa 120 ký tự, nội dung 1–5.000 ký tự." });
    const memory = { id: randomUUID(), title, content, workspaceId: state.workspaces.some((w) => w.id === body.workspaceId) ? body.workspaceId : "all", createdAt: new Date().toISOString() };
    memories.unshift(memory); persistMemory(); publish("memory"); return json(response, 201, { memory });
  }
  if (request.method === "DELETE" && pathname.startsWith("/api/memory/")) {
    const id = decodeURIComponent(pathname.slice("/api/memory/".length));
    memories = memories.filter((item) => item.id !== id); persistMemory(); publish("memory"); return json(response, 200, { ok: true });
  }
  return json(response, 404, { error: "API endpoint not found" });
}

let vite;
let server;
let lanCompanionServers = [];
let activeLanPort = 0;
const productionMode = process.env.WORKBENCH_MODE === "production";

async function closeLanCompanionServers() {
  const prev = lanCompanionServers;
  lanCompanionServers = [];
  activeLanPort = 0;
  await Promise.all(prev.map(async (srv) => {
    try {
      srv.closeIdleConnections?.();
      srv.closeAllConnections?.();
      await Promise.race([
        new Promise((resolvePromise) => srv.close(() => resolvePromise())),
        new Promise((resolvePromise) => setTimeout(resolvePromise, 500)),
      ]);
    } catch {}
  }));
}

async function syncLanCompanionServers() {
  await closeLanCompanionServers();
  if (shuttingDown || !server?.listening || !isLoopbackBind) return;
  const activePass = getEffectiveAccessPassword();
  if (!activePass || activePass.length < 6 || connectionConfig?.remoteEnabled === false) return;
  const mainPort = server.address()?.port || port || 4173;
  const preferredPort = process.env.OPENSYBAU_DESKTOP === "1" ? 4173 : mainPort;
  const lanList = discoverLanAddresses(preferredPort, secureTransport ? "https" : "http");
  for (const item of lanList) {
    for (const candidatePort of [...new Set([preferredPort, mainPort])]) {
      if (!candidatePort) continue;
      const srv = createWorkbenchServer();
      try {
        await new Promise((resolvePromise, reject) => {
          srv.once("error", reject);
          srv.listen(candidatePort, item.address, () => {
            srv.off("error", reject);
            resolvePromise();
          });
        });
        const actualPort = srv.address()?.port || candidatePort;
        if (!activeLanPort) activeLanPort = actualPort;
        allowedHosts.add(`${item.address}:${actualPort}`.toLowerCase());
        lanCompanionServers.push(srv);
        break;
      } catch {
        try { srv.close(); } catch {}
      }
    }
  }
}
const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};
const htmlCspHeader = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

function isTrustedAndroidApkOrigin(origin, requestHost) {
  if (!origin) return true;
  const lower = String(origin).toLowerCase();
  if (lower === "capacitor://localhost" || lower === "https://appassets.androidplatform.net" || lower === "http://localhost" || lower === "https://localhost") {
    return true;
  }
  try {
    const parsed = new URL(origin);
    return ["http:", "https:"].includes(parsed.protocol) && parsed.host.toLowerCase() === requestHost;
  } catch {
    return false;
  }
}

function createWorkbenchServer() {
const serverFactory = secureTransport ? createHttpsServer : createServer;
const serverOptions = secureTransport ? { cert: readFileSync(resolve(tlsCert)), key: readFileSync(resolve(tlsKey)) } : undefined;
return serverFactory(serverOptions, async (request, response) => {
  const requestHost = (request.headers.host || "").toLowerCase();
  if (!allowedHosts.has(requestHost)) return json(response, 403, { error: "Host not allowed" });
  const origin = request.headers.origin;
  const reqHeaders = String(request.headers["access-control-request-headers"] || "").toLowerCase();
  if (request.method === "OPTIONS" && reqHeaders.includes("x-opensybau-client") && isTrustedAndroidApkOrigin(origin, requestHost)) {
    response.writeHead(204, {
      ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
      "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, If-None-Match, X-OpenSybau-Client",
      "Access-Control-Max-Age": "600",
      ...securityHeaders,
    });
    response.end();
    return;
  }
  const isAndroidApkClient = String(request.headers["x-opensybau-client"] || "").toLowerCase() === "android-apk"
    && isTrustedAndroidApkOrigin(origin, requestHost);
  if (isAndroidApkClient && origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Expose-Headers", "ETag");
    response.setHeader("Vary", "Origin");
  }
  if (!hasValidAccess(request)) {
    response.writeHead(401, {
      "WWW-Authenticate": 'Basic realm="OpenSybau", charset="UTF-8"',
      "Cache-Control": "no-store",
      ...(isAndroidApkClient && origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : {}),
      ...securityHeaders,
    });
    response.end("Authentication required");
    return;
  }
  if (!isAndroidApkClient) {
    const secFetchSite = String(request.headers["sec-fetch-site"] || "").toLowerCase();
    if (secFetchSite === "cross-site" || (request.method !== "GET" && request.method !== "HEAD" && secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none")) {
      return json(response, 403, { error: "Cross-site requests are not allowed" });
    }
    if (origin) {
      let originUrl;
      try { originUrl = new URL(origin); } catch { return json(response, 403, { error: "Origin not allowed" }); }
      if (!["http:", "https:"].includes(originUrl.protocol) || originUrl.host.toLowerCase() !== requestHost) return json(response, 403, { error: "Origin not allowed" });
    }
  }
  if (shuttingDown) return json(response, 503, { error: "OpenSybau đang tắt; hãy thử lại khi mở app." });
  let pathname;
  try { pathname = new URL(request.url || "/", `${secureTransport ? "https" : "http"}://${requestHost}`).pathname; }
  catch { return json(response, 400, { error: "Invalid request URL" }); }
  if (pathname === "/__events") {
    response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no", ...securityHeaders });
    response.write("retry: 3000\nevent: connected\ndata: ready\n\n");
    clients.add(response);
    const heartbeat = setInterval(() => {
      if (!response.destroyed && !response.writableNeedDrain) response.write(": heartbeat\n\n");
    }, 20_000);
    heartbeat.unref?.();
    response.on("close", () => { clearInterval(heartbeat); clients.delete(response); });
    return;
  }
  if (pathname.startsWith("/api/")) {
    try { await api(request, response, pathname); }
    catch (error) { json(response, error?.statusCode || 500, { error: safeError(error) }); }
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") return json(response, 405, { error: "Method not allowed" });
  if (vite) {
    if (pathname === "/" || pathname.endsWith(".html")) {
      try {
        const html = await fs.readFile(resolve(root, "index.html"), "utf8");
        const transformed = await vite.transformIndexHtml(request.url || "/", html);
        response.writeHead(200, { "Content-Type": contentTypes[".html"], "Cache-Control": "no-store", ...securityHeaders });
        response.end(request.method === "HEAD" ? undefined : transformed);
      } catch (error) { response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", ...securityHeaders }).end(safeError(error)); }
      return;
    }
    vite.middlewares(request, response, (error) => {
      if (error) {
        vite.ssrFixStacktrace(error);
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8", ...securityHeaders }).end(safeError(error));
      } else response.writeHead(404, securityHeaders).end("Not found");
    });
    return;
  }
  let filePath;
  const staticRoot = resolve(root, "dist");
  try { filePath = resolve(staticRoot, "." + decodeURIComponent(pathname === "/" ? "/index.html" : pathname)); }
  catch { response.writeHead(400, securityHeaders).end("Bad request"); return; }
  if (filePath !== staticRoot && !filePath.startsWith(staticRoot + sep)) return response.writeHead(403, securityHeaders).end("Forbidden");
  try {
    let content;
    try { content = await fs.readFile(filePath); }
    catch { content = await fs.readFile(resolve(staticRoot, "index.html")); filePath = resolve(staticRoot, "index.html"); }
    const ext = extname(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
      ...securityHeaders,
      ...(ext === ".html" ? { "Content-Security-Policy": htmlCspHeader } : {}),
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch { response.writeHead(404, securityHeaders).end("Not found"); }
});
}

export async function startWorkbench() {
  if (server?.listening) return { server, host, port: server.address().port, protocol: secureTransport ? "https" : "http" };
  if (shuttingDown) throw new Error("OpenSybau server cannot be restarted after shutdown.");
  for (const task of state.tasks) if (task.status === "failed" && (task.error?.startsWith("OpenSybau đã dừng") || task.error?.startsWith("Workbench đã dừng"))) task.events = [...(task.events || []), { at: task.updatedAt, kind: "warning", text: task.error }].slice(-250);
  await Promise.all(state.workspaces.map(async (workspace) => {
    try { workspace.runtime = await inspectWorkspace(workspace.path); }
    catch (error) { workspace.runtime = { path: workspace.path, error: safeError(error), isGit: false, head: false }; }
  }));
  persist();
  server = createWorkbenchServer();
  try {
    if (!productionMode) {
      const { createServer: createViteServer } = await import("vite");
      vite = await createViteServer({
        configFile: resolve(root, "vite.config.js"),
        server: { middlewareMode: { server } },
        appType: "custom",
      });
    }
    await new Promise((resolvePromise, reject) => {
      server.once("error", reject);
      server.listen(port, host, () => {
        server.off("error", reject);
        resolvePromise();
      });
    });
  } catch (error) {
    await vite?.close().catch(() => {});
    vite = undefined;
    server = undefined;
    throw error;
  }
  const boundPort = server.address().port;
  if (isLoopbackBind) {
    for (const name of [host, "localhost", "127.0.0.1", "[::1]"]) allowedHosts.add(`${name}:${boundPort}`.toLowerCase());
  }
  await syncLanCompanionServers();
  console.log(`OpenSybau ready at ${secureTransport ? "https" : "http"}://${host}:${boundPort}`);
  console.log(`Frontend: ${productionMode ? "production build" : "Preact + Vite development mode (hot reload enabled)"}`);
  console.log(`Codex: ${codexExe}`);
  console.log(`Antigravity CLI: ${agyExe && existsSync(agyExe) ? agyExe : "not found (check PATH or ANTIGRAVITY_CLI_PATH)"}`);
  console.log(`Data: ${runtime}`);
  if (!isLoopbackBind) console.log(`Allowed hosts: ${[...allowedHosts].join(", ")} · Basic Auth enabled`);
  pumpTimer = setTimeout(() => { pumpTimer = undefined; pump(); }, 500);
  return { server, host, port: boundPort, protocol: secureTransport ? "https" : "http" };
}

export async function stopWorkbench() {
  shuttingDown = true;
  if (pumpTimer) clearTimeout(pumpTimer);
  pumpTimer = undefined;
  let interrupted = false;
  for (const [taskId, item] of running) {
    item.stopped = true;
    item.shuttingDown = true;
    item.abortController?.abort(new Error("OpenSybau is shutting down."));
    killTree(item.child);
    const task = state.tasks.find((candidate) => candidate.id === taskId);
    if (!task || task.status !== "running") continue;
    const at = new Date().toISOString();
    task.failedPhase = task.phase;
    task.status = "failed";
    task.phase = "failed";
    task.error = "OpenSybau đã dừng khi tiến trình đang chạy. Kiểm tra workspace trước khi chạy lại.";
    task.completedAt = at;
    task.updatedAt = at;
    failQueuedChatTurns(task, true);
    task.events = [...(task.events || []), { at, kind: "warning", text: task.error }].slice(-250);
    interrupted = true;
  }
  if (interrupted) { persist(); publish("tasks"); }
  else if (persistTimer) { persist(); }
  if (publishTimer) { clearTimeout(publishTimer); publishTimer = null; pendingPublishType = null; }
  for (const client of clients) client.end();
  clients.clear();
  await closeLanCompanionServers();
  await vite?.close();
  vite = undefined;
  if (server?.listening) {
    server.closeIdleConnections?.();
    server.closeAllConnections?.();
    await Promise.race([
      new Promise((resolvePromise) => server.close(() => resolvePromise())),
      new Promise((resolvePromise) => setTimeout(resolvePromise, 1000)),
    ]);
  }
  server = undefined;
}

const isDirectRun = Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  process.once("SIGINT", () => { stopWorkbench().finally(() => process.exit(0)); });
  process.once("SIGTERM", () => { stopWorkbench().finally(() => process.exit(0)); });
  await startWorkbench();
}
