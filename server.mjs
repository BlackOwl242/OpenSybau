import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { promises as fs } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { homedir, hostname as osHostname } from "node:os";
import { createHash, timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { workflowRoles } from "./src/domain/agent-roles.js";
import { createStateSnapshot } from "./src/server/state-snapshot.mjs";
import { isForbiddenSystemPath as checkForbiddenSystemPath } from "./src/server/fs-security.mjs";
import {
  autoDistillTaskMemory as distillTaskMemory,
  buildTelemetrySummary as computeTelemetrySummary,
  relevantMemory as queryRelevantMemory,
} from "./src/server/memory-bm25.mjs";
import { createSkillCatalogService } from "./src/server/skill-catalog.mjs";
import { discoverLanAddresses, generateStrongAccessPassword } from "./src/server/network-pairing.mjs";
import { createCliDiscoveryService } from "./src/server/cli-discovery.mjs";
import { createProviderQuotaService } from "./src/server/provider-quotas.mjs";
import { createTaskPromptService, publicProviderName, stageSelection } from "./src/server/task-prompts.mjs";
import { createTaskStageRunner, failQueuedChatTurns, finishStageRerun } from "./src/server/task-stage-runner.mjs";
import { createTaskRunnerService } from "./src/server/task-runner.mjs";
import { handleProviderSkillRoutes } from "./src/server/routes/provider-skill-routes.mjs";
import { handleWorkspaceVaultRoutes } from "./src/server/routes/workspace-vault-routes.mjs";
import { handleTaskRoutes } from "./src/server/routes/task-routes.mjs";

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

let connectionConfig = loadJson(connectionConfigFile, {});
if (!connectionConfig || typeof connectionConfig !== "object" || Array.isArray(connectionConfig)) connectionConfig = {};
if (!connectionConfig.password && connectionConfig.remoteEnabled !== false) {
  connectionConfig = {
    username: String(connectionConfig.username || "opensybau").trim() || "opensybau",
    password: generateStrongAccessPassword(),
    remoteEnabled: true,
    updatedAt: new Date().toISOString(),
  };
  try { persistJsonFile(connectionConfigFile, connectionConfig); } catch {}
}
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

function matchesCredential(input, expected) {
  const inputHash = createHash("sha256").update(input).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(inputHash, expectedHash);
}

function hasValidAccess(request) {
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

function isForbiddenSystemPath(targetPath) {
  return checkForbiddenSystemPath(targetPath, runtime);
}

function relevantMemory(task, workspace) {
  return queryRelevantMemory(task, workspace, memories);
}

function autoDistillTaskMemory(task, workspace) {
  return distillTaskMemory(task, workspace, memories, persistMemory);
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
    telemetry: computeTelemetrySummary(state.tasks, running.size),
    serverTime: new Date().toISOString(),
  };
}

const cliDiscovery = createCliDiscoveryService({
  cliPathsFile,
  providerConfigFile,
  providerSecretsFile,
  getWorkspaces: () => state.workspaces,
  loadJson,
  persistJsonFile,
  run,
  git,
  safeError,
});

const providerQuotaService = createProviderQuotaService({
  getCliExecutables: () => cliDiscovery.getCliExecutables(),
  loadModels: (force) => cliDiscovery.loadModels(force),
  run,
});

const skillCatalogService = createSkillCatalogService({
  runtime,
  getWorkspaces: () => state.workspaces,
  hasApiProvider: (provider) => cliDiscovery.hasApiProvider(provider),
  stageSelection: (task, stage) => stageSelection(task, stage),
  publicProviderName: (provider) => publicProviderName(provider),
  workflowRoles,
});

const promptService = createTaskPromptService({
  getState: () => state,
  getMemories: () => memories,
  isForbiddenSystemPath,
  hasApiProvider: (provider) => cliDiscovery.hasApiProvider(provider),
  git,
  relevantMemory,
  skillProviderCompatible: skillCatalogService.skillProviderCompatible,
  skillInstructions: skillCatalogService.skillInstructions,
});

const stageRunner = createTaskStageRunner({
  getState: () => state,
  running,
  isShuttingDown: () => shuttingDown,
  record,
  schedulePersist,
  schedulePublish,
  run,
  killTree,
  loadModels: (force) => cliDiscovery.loadModels(force),
  getCliExecutables: () => cliDiscovery.getCliExecutables(),
  getApiProviderRuntime: (provider) => cliDiscovery.getApiProviderRuntime(provider),
  additionalWritableProjectDirs: (task, cwd) => promptService.additionalWritableProjectDirs(task, cwd),
  externalWorkspaceContext: (task, stage) => promptService.externalWorkspaceContext(task, stage),
});

const taskRunner = createTaskRunnerService({
  taskDir,
  worktreeDir,
  getState: () => state,
  running,
  busyWorkspaces,
  isolatedWorkspaces,
  isShuttingDown: () => shuttingDown,
  persist,
  publish,
  record,
  safeError,
  git,
  withGitRepoLock,
  inspectWorkspace: (p) => cliDiscovery.inspectWorkspace(p),
  relevantMemory,
  autoDistillTaskMemory,
  skillCatalogService,
  promptService,
  stageRunner,
});

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
  if (preferredPort && preferredPort !== mainPort) {
    const wildcardSrv = createWorkbenchServer();
    try {
      await new Promise((resolvePromise, reject) => {
        wildcardSrv.once("error", reject);
        wildcardSrv.listen(preferredPort, "0.0.0.0", () => {
          wildcardSrv.off("error", reject);
          resolvePromise();
        });
      });
      const actualPort = wildcardSrv.address()?.port || preferredPort;
      activeLanPort = actualPort;
      for (const item of lanList) {
        allowedHosts.add(`${item.address}:${actualPort}`.toLowerCase());
      }
      lanCompanionServers.push(wildcardSrv);
      return;
    } catch {
      try { wildcardSrv.close(); } catch {}
    }
  }
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

const routeContext = {
  host,
  port,
  taskDir,
  secureTransport,
  isLoopbackBind,
  productionMode,
  allowedHosts,
  cliPathsFile,
  providerConfigFile,
  providerSecretsFile,
  connectionConfigFile,
  getState: () => state,
  getMemories: () => memories,
  setMemories: (next) => { memories = next; },
  getConnectionConfig: () => connectionConfig,
  setConnectionConfig: (next) => { connectionConfig = next; },
  getEffectiveAccessUsername,
  getEffectiveAccessPassword,
  isLoopbackClient,
  getBoundPort: () => activeLanPort || server?.address?.()?.port || port,
  isLanActive: () => lanCompanionServers.length > 0,
  syncLanCompanionServers,
  stateSnapshot,
  running,
  busyWorkspaces,
  loadJson,
  persistJsonFile,
  persist,
  persistMemory,
  publish,
  schedulePublish,
  record,
  json,
  readBody,
  safeError,
  run,
  git,
  withGitRepoLock,
  openFolder,
  killTree,
  isForbiddenSystemPath,
  autoDistillTaskMemory,
  cliDiscovery,
  providerQuotaService,
  skillCatalogService,
  promptService,
  stageRunner,
  taskRunner,
};

async function api(request, response, pathname) {
  if (await handleProviderSkillRoutes(request, response, pathname, routeContext)) return;
  if (await handleWorkspaceVaultRoutes(request, response, pathname, routeContext)) return;
  if (await handleTaskRoutes(request, response, pathname, routeContext)) return;
  return json(response, 404, { error: "API endpoint not found" });
}

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
};
const htmlCspHeader = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

function isPrivateOrLocalHostName(hostnameValue) {
  const hostOnly = String(hostnameValue || "").trim().toLowerCase().replace(/:\d+$/, "");
  if (!hostOnly) return false;
  if (hostOnly === "localhost" || hostOnly === "127.0.0.1" || hostOnly === "[::1]" || hostOnly === "::1") return true;
  const machineHost = String(osHostname() || "").trim().toLowerCase();
  if (machineHost && (hostOnly === machineHost || hostOnly === `${machineHost}.local`)) return true;
  return /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}|100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\.\d{1,3}\.\d{1,3})$/.test(hostOnly);
}

function isAllowedRequestHost(requestHost) {
  const clean = String(requestHost || "").trim().toLowerCase();
  if (!clean) return false;
  if (allowedHosts.has(clean)) return true;
  if (!isLoopbackBind && allowedHosts.size > 0) return false;
  if (lanCompanionServers.length > 0 && isPrivateOrLocalHostName(clean)) return true;
  return false;
}

function isTrustedAndroidApkOrigin(origin, requestHost) {
  if (!origin) return true;
  const lower = String(origin).toLowerCase();
  if (
    lower === "capacitor://localhost"
    || lower === "https://appassets.androidplatform.net"
    || lower === "http://appassets.androidplatform.net"
    || lower === "http://localhost"
    || lower === "https://localhost"
    || lower === "null"
  ) {
    return true;
  }
  try {
    const parsed = new URL(origin);
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (parsed.host.toLowerCase() === requestHost) return true;
    return isPrivateOrLocalHostName(parsed.hostname);
  } catch {
    return false;
  }
}

function createWorkbenchServer() {
  const serverFactory = secureTransport ? createHttpsServer : createServer;
  const serverOptions = secureTransport ? { cert: readFileSync(resolve(tlsCert)), key: readFileSync(resolve(tlsKey)) } : undefined;
  return serverFactory(serverOptions, async (request, response) => {
    const requestHost = (request.headers.host || "").toLowerCase();
    if (!isAllowedRequestHost(requestHost)) return json(response, 403, { error: "Host not allowed" });
    const origin = request.headers.origin;
    if (request.method === "OPTIONS" && isTrustedAndroidApkOrigin(origin, requestHost)) {
      response.writeHead(204, {
        ...(origin ? { "Access-Control-Allow-Origin": origin, Vary: "Origin" } : { "Access-Control-Allow-Origin": "*" }),
        "Access-Control-Allow-Private-Network": "true",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, If-None-Match, X-OpenSybau-Client",
        "Access-Control-Max-Age": "600",
        ...securityHeaders,
      });
      response.end();
      return;
    }
    const isAndroidApkClient = (
      String(request.headers["x-opensybau-client"] || "").toLowerCase() === "android-apk"
      || Boolean(origin && /^(capacitor:\/\/localhost|https?:\/\/appassets\.androidplatform\.net|https?:\/\/localhost(?::\d+)?)$/i.test(String(origin)))
    ) && isTrustedAndroidApkOrigin(origin, requestHost);
    if (isAndroidApkClient) {
      response.setHeader("Access-Control-Allow-Origin", origin || "*");
      response.setHeader("Access-Control-Allow-Private-Network", "true");
      response.setHeader("Access-Control-Expose-Headers", "ETag");
      if (origin) response.setHeader("Vary", "Origin");
    }
    let pathname;
    try { pathname = new URL(request.url || "/", `${secureTransport ? "https" : "http"}://${requestHost}`).pathname; }
    catch { return json(response, 400, { error: "Invalid request URL" }); }
    const isPublicDiscoveryPing = request.method === "GET" && pathname === "/api/ping" && !request.headers.authorization;
    if (!isPublicDiscoveryPing && !hasValidAccess(request)) {
      response.writeHead(401, {
        "WWW-Authenticate": 'Basic realm="OpenSybau", charset="UTF-8"',
        "Cache-Control": "no-store",
        ...(isAndroidApkClient ? { "Access-Control-Allow-Origin": origin || "*", "Access-Control-Allow-Private-Network": "true", ...(origin ? { Vary: "Origin" } : {}) } : {}),
        ...securityHeaders,
      });
      response.end("Authentication required");
      return;
    }
    if (!isAndroidApkClient && !isPublicDiscoveryPing) {
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
    try { workspace.runtime = await cliDiscovery.inspectWorkspace(workspace.path); }
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
  const { codexExe, agyExe } = cliDiscovery.getCliExecutables();
  console.log(`OpenSybau ready at ${secureTransport ? "https" : "http"}://${host}:${boundPort}`);
  console.log(`Frontend: ${productionMode ? "production build" : "Preact + Vite development mode (hot reload enabled)"}`);
  console.log(`Codex: ${codexExe}`);
  console.log(`Antigravity CLI: ${agyExe && existsSync(agyExe) ? agyExe : "not found (check PATH or ANTIGRAVITY_CLI_PATH)"}`);
  console.log(`Data: ${runtime}`);
  if (!isLoopbackBind) console.log(`Allowed hosts: ${[...allowedHosts].join(", ")} · Basic Auth enabled`);
  pumpTimer = setTimeout(() => { pumpTimer = undefined; taskRunner.pump(); }, 500);
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
