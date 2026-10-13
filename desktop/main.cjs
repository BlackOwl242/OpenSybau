const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, promises: fs } = require("node:fs");
const path = require("node:path");
const { findDesktopAntigravityPath } = require("./antigravity-path.cjs");

const externalHosts = new Set(["developers.openai.com", "platform.openai.com", "code.claude.com", "console.anthropic.com", "antigravity.google", "aistudio.google.com"]);
let mainWindow;
let stopWorkbench;
let stopping = false;
let workbenchUrl;
let updateState = { status: "idle", currentVersion: app.getVersion() };
let updateCheckRunning = false;

app.setName("OpenSybau");
app.setPath("userData", path.join(app.getPath("appData"), "OpenSybau"));
const userData = app.getPath("userData");
const envPath = path.join(userData, ".env");
const singletonLock = app.requestSingleInstanceLock();
if (!singletonLock) app.quit();

function initializeUserConfig() {
  mkdirSync(userData, { recursive: true });
  if (!existsSync(envPath)) {
    const examplePath = app.isPackaged
      ? path.join(process.resourcesPath, "opensybau.env.example")
      : path.join(__dirname, "..", ".env.example");
    if (existsSync(examplePath)) copyFileSync(examplePath, envPath);
    else writeFileSync(envPath, "# OpenSybau local configuration\n", "utf8");
  }
  const source = readFileSync(envPath, "utf8");
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "");
    process.env[match[1]] = value;
  }
  process.env.OPENSYBAU_DESKTOP = "1";
  // Claude's npm CLI entry point is JavaScript; its child process must run Electron's bundled Node runtime.
  process.env.ELECTRON_RUN_AS_NODE = "1";
  process.env.WORKBENCH_MODE = "production";
  process.env.WORKBENCH_HOST = "127.0.0.1";
  process.env.WORKBENCH_PORT = "0";
  process.env.WORKBENCH_DATA_DIR = userData;
  process.env.WORKBENCH_ACCESS_USERNAME = "";
  process.env.WORKBENCH_ACCESS_PASSWORD = "";
  process.env.WORKBENCH_ALLOWED_HOSTS = "";
  process.env.WORKBENCH_TLS_CERT = "";
  process.env.WORKBENCH_TLS_KEY = "";
  try {
    const savedCliPaths = JSON.parse(readFileSync(path.join(userData, "cli-paths.json"), "utf8"));
    const savedPath = savedCliPaths.antigravityManual === true && savedCliPaths.antigravity;
    if (savedPath && existsSync(savedPath)) process.env.ANTIGRAVITY_CLI_PATH = savedPath;
    const savedClaudePath = savedCliPaths.claudeManual === true && savedCliPaths.claude;
    if (savedClaudePath && existsSync(savedClaudePath)) process.env.CLAUDE_CLI_PATH = savedClaudePath;
  } catch {}
  if (!process.env.ANTIGRAVITY_CLI_PATH) {
    const antigravityCliPath = findDesktopAntigravityPath({
      localAppData: process.env.LOCALAPPDATA || "",
      roamingAppData: app.getPath("appData"),
      home: app.getPath("home"),
    });
    if (antigravityCliPath) process.env.ANTIGRAVITY_CLI_PATH = antigravityCliPath;
  }
}

function isAllowedExternal(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && externalHosts.has(url.hostname);
  } catch { return false; }
}

async function createMainWindow() {
  initializeUserConfig();
  const serverModule = await import("../server.mjs");
  stopWorkbench = serverModule.stopWorkbench;
  const server = await serverModule.startWorkbench();
  workbenchUrl = `${server.protocol}://${server.host}:${server.port}`;

  ipcMain.handle("opensybau:open-config-folder", async () => shell.openPath(userData));
  ipcMain.handle("opensybau:antigravity:choose-cli", async () => {
    const suggestedPath = process.env.ANTIGRAVITY_CLI_PATH && existsSync(process.env.ANTIGRAVITY_CLI_PATH)
      ? process.env.ANTIGRAVITY_CLI_PATH
      : path.join(process.env.LOCALAPPDATA || path.join(app.getPath("home"), "AppData", "Local"), "agy", "bin");
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Chọn Antigravity CLI (agy.exe)",
      defaultPath: suggestedPath,
      properties: ["openFile"],
      filters: [{ name: "Antigravity CLI", extensions: ["exe"] }],
    });
    return result.canceled ? "" : result.filePaths[0] || "";
  });
  ipcMain.handle("opensybau:claude:choose-cli", async () => {
    const saved = (() => { try { return JSON.parse(readFileSync(path.join(userData, "cli-paths.json"), "utf8")).claude; } catch { return ""; } })();
    const appData = process.env.APPDATA || path.join(app.getPath("home"), "AppData", "Roaming");
    const suggestedPath = saved && existsSync(saved) ? saved : path.join(appData, "npm", "node_modules", "@anthropic-ai", "claude-code");
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Chọn Claude Code CLI (claude.exe hoặc cli.js)",
      defaultPath: suggestedPath,
      properties: ["openFile"],
      filters: [{ name: "Claude Code CLI", extensions: ["exe", "js"] }],
    });
    return result.canceled ? "" : result.filePaths[0] || "";
  });
  ipcMain.handle("opensybau:update:get-state", () => updateState);
  ipcMain.handle("opensybau:update:check", () => checkForAppUpdate());
  ipcMain.handle("opensybau:update:restart", () => {
    if (updateState.status !== "downloaded") return false;
    autoUpdater.quitAndInstall(false, true);
    return true;
  });
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#1b1c1d",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternal(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== workbenchUrl && !url.startsWith(`${workbenchUrl}/`) && !url.startsWith(`${workbenchUrl}#`)) event.preventDefault();
  });
  await mainWindow.loadURL(workbenchUrl);
  mainWindow.on("closed", () => { mainWindow = null; });
  await initializeAutoUpdates();
}

function publishUpdateState(nextState) {
  updateState = { currentVersion: app.getVersion(), ...nextState };
  if (!mainWindow?.isDestroyed()) mainWindow.webContents.send("opensybau:update:state", updateState);
}

async function initializeAutoUpdates() {
  if (!app.isPackaged || process.platform !== "win32") return;
  await cleanupInstalledUpdateCache();
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("checking-for-update", () => publishUpdateState({ status: "checking" }));
  autoUpdater.on("update-available", (info) => publishUpdateState({ status: "available", version: info.version }));
  autoUpdater.on("update-not-available", () => publishUpdateState({ status: "not-available" }));
  autoUpdater.on("download-progress", (progress) => publishUpdateState({ status: "downloading", percent: Math.round(progress.percent || 0) }));
  autoUpdater.on("update-downloaded", async (info) => {
    try {
      writeFileSync(path.join(userData, "pending-update-install.json"), JSON.stringify({ version: info.version }), "utf8");
    } catch (error) {
      console.warn("Could not record downloaded update for post-install cleanup:", error);
    }
    publishUpdateState({ status: "downloaded", version: info.version });
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const choice = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "OpenSybau đã sẵn sàng cập nhật",
      message: `Đã tải OpenSybau ${info.version}. Khởi động lại ứng dụng để cài đặt bản mới?`,
      buttons: ["Khởi động lại ngay", "Để sau"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (choice.response === 0) autoUpdater.quitAndInstall(false, true);
  });
  autoUpdater.on("error", (error) => publishUpdateState({ status: "error", error: error?.message || "Không thể kiểm tra cập nhật." }));
  void checkForAppUpdate();
  const timer = setInterval(() => { void checkForAppUpdate(); }, 6 * 60 * 60 * 1000);
  timer.unref();
}

async function cleanupInstalledUpdateCache() {
  const markerPath = path.join(userData, "pending-update-install.json");
  try {
    const marker = JSON.parse(await fs.readFile(markerPath, "utf8"));
    if (!marker?.version || marker.version !== app.getVersion()) return;

    const updateConfig = await fs.readFile(path.join(process.resourcesPath, "app-update.yml"), "utf8");
    const cacheName = updateConfig.match(/^updaterCacheDirName:\s*["']?([^\s"'#]+)["']?\s*$/m)?.[1];
    if (!cacheName || !/^[a-z0-9_-]+$/i.test(cacheName)) return;

    const baseCachePath = process.env.LOCALAPPDATA || path.join(app.getPath("home"), "AppData", "Local");
    const appCachePath = path.resolve(baseCachePath, cacheName);
    const pendingPath = path.resolve(appCachePath, "pending");
    if (path.dirname(pendingPath) !== appCachePath) return;

    await fs.rm(pendingPath, { recursive: true, force: true });
    await fs.rm(markerPath, { force: true });
  } catch (error) {
    if (error?.code !== "ENOENT") console.warn("Could not clean the installed updater cache:", error);
  }
}

async function checkForAppUpdate() {
  if (!app.isPackaged || process.platform !== "win32") return updateState;
  if (updateCheckRunning || updateState.status === "downloading" || updateState.status === "downloaded") return updateState;
  updateCheckRunning = true;
  publishUpdateState({ status: "checking" });
  try {
    await autoUpdater.checkForUpdates();
    return updateState;
  } catch (error) {
    const message = error?.message || "Không thể kiểm tra cập nhật.";
    publishUpdateState({ status: "error", error: message });
    return updateState;
  } finally {
    updateCheckRunning = false;
  }
}

app.on("second-instance", () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.whenReady().then(() => singletonLock ? createMainWindow() : undefined).catch((error) => {
  console.error("OpenSybau startup failed:", error);
  dialog.showErrorBox("OpenSybau could not start", `${error?.message || error}\n\nConfiguration: ${envPath}`);
  app.quit();
});

app.on("before-quit", (event) => {
  if (!stopWorkbench || stopping) return;
  event.preventDefault();
  stopping = true;
  void stopWorkbench().finally(() => app.quit());
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
