const { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const { spawn } = require("node:child_process");
const { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, promises: fs } = require("node:fs");
const path = require("node:path");
const { findDesktopAntigravityPath } = require("./antigravity-path.cjs");

nativeTheme.themeSource = "dark";

const externalHosts = new Set(["developers.openai.com", "platform.openai.com", "code.claude.com", "console.anthropic.com", "antigravity.google", "aistudio.google.com"]);
let mainWindow;
let stopWorkbench;
let stopping = false;
let workbenchUrl;
let updateState = { status: "idle", currentVersion: app.getVersion() };
let updateCheckRunning = false;

const cliInstallers = Object.freeze({
  codex: {
    name: "Codex CLI",
    windows: "https://chatgpt.com/codex/install.ps1",
    linux: "https://chatgpt.com/codex/install.sh",
    hosts: ["chatgpt.com", "openai.com", "releases.openai.com", "github.com", "raw.githubusercontent.com"],
  },
  antigravity: {
    name: "Antigravity CLI",
    windows: "https://antigravity.google/cli/install.ps1",
    linux: "https://antigravity.google/cli/install.sh",
    hosts: ["antigravity.google"],
  },
  claude: {
    name: "Claude Code CLI",
    windows: "https://claude.ai/install.ps1",
    linux: "https://claude.ai/install.sh",
    hosts: ["claude.ai", "downloads.claude.ai", "anthropic.com"],
  },
});

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
  delete process.env.ELECTRON_RUN_AS_NODE;
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
    const savedPath = savedCliPaths.antigravity;
    if (savedPath && existsSync(savedPath)) process.env.ANTIGRAVITY_CLI_PATH = savedPath;
    const savedClaudePath = savedCliPaths.claude;
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
    if (url.protocol === "obsidian:") return true;
    return url.protocol === "https:" && externalHosts.has(url.hostname);
  } catch { return false; }
}

let ipcRegistered = false;

function registerIpcHandlers() {
  if (ipcRegistered) return;
  ipcRegistered = true;
  ipcMain.handle("opensybau:open-config-folder", async () => shell.openPath(userData));
  ipcMain.handle("opensybau:cli:install", async (_event, providerId, language) => installCli(providerId, language));
  ipcMain.handle("opensybau:update:get-state", () => updateState);
  ipcMain.handle("opensybau:update:check", () => checkForAppUpdate());
  ipcMain.handle("opensybau:update:restart", () => {
    if (updateState.status !== "downloaded") return false;
    autoUpdater.quitAndInstall(false, true);
    return true;
  });
}

async function downloadCliInstaller(url, allowedHosts) {
  const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(60_000) });
  const finalUrl = new URL(response.url || url);
  if (finalUrl.protocol !== "https:" || !allowedHosts.includes(finalUrl.hostname.toLowerCase())) {
    throw new Error("The vendor installer URL redirected to an unapproved host.");
  }
  if (!response.ok) throw new Error(`The vendor installer returned HTTP ${response.status}.`);

  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of response.body || []) {
    totalBytes += chunk.byteLength;
    if (totalBytes > 1_000_000) throw new Error("The installer script is larger than the 1 MB limit.");
    chunks.push(Buffer.from(chunk));
  }
  if (!totalBytes) throw new Error("The vendor installer was empty.");
  return Buffer.concat(chunks);
}

function runCliInstaller(command, args, cwd) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: "ignore",
      env: { ...process.env, NO_COLOR: "1" },
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, 15 * 60 * 1000);
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectPromise(new Error(`Could not start the ${command} installer (${error.message}).`));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) rejectPromise(new Error("CLI installation took longer than 15 minutes and was stopped."));
      else if (code !== 0) rejectPromise(new Error(`The vendor installer exited with code ${code ?? "unknown"}.`));
      else resolvePromise();
    });
  });
}

async function installCli(providerId, language) {
  const installer = cliInstallers[providerId];
  if (!installer) throw new Error("Choose Codex, Antigravity, or Claude Code to install.");
  if (process.platform !== "win32" && process.platform !== "linux") throw new Error("CLI installation is supported by the Windows and Linux desktop apps.");

  const english = language === "en";
  const isWindows = process.platform === "win32";
  const scriptUrl = isWindows ? installer.windows : installer.linux;
  const confirmation = {
    type: "warning",
    title: english ? `Install ${installer.name}` : `Cài ${installer.name}`,
    message: english
      ? `OpenSybau will download and run the official ${installer.name} installer.`
      : `OpenSybau sẽ tải và chạy trình cài đặt chính thức của ${installer.name}.`,
    detail: english
      ? "The installer will run with your current user permissions. Do you want to continue?"
      : "Trình cài đặt chạy với quyền hiện tại của tài khoản bạn. Bạn có muốn tiếp tục không?",
    buttons: english ? ["Install", "Cancel"] : ["Cài đặt", "Hủy"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  };
  const choice = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow, confirmation)
    : await dialog.showMessageBox(confirmation);
  if (choice.response !== 0) return { ok: false, cancelled: true };

  let installerDirectory = "";
  try {
    installerDirectory = await fs.mkdtemp(path.join(app.getPath("temp"), "opensybau-cli-"));
    if (!isWindows) await fs.chmod(installerDirectory, 0o700);
    const scriptPath = path.join(installerDirectory, isWindows ? "install.ps1" : "install.sh");
    const script = await downloadCliInstaller(scriptUrl, installer.hosts);
    await fs.writeFile(scriptPath, script, { mode: 0o700 });
    if (!isWindows) await fs.chmod(scriptPath, 0o700);

    if (isWindows) {
      const systemRoot = process.env.SystemRoot || process.env.WINDIR || "C:\\Windows";
      const powershell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
      if (!existsSync(powershell)) throw new Error("Windows PowerShell could not be found.");
      await runCliInstaller(powershell, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath], app.getPath("home"));
    } else {
      await runCliInstaller("/bin/bash", [scriptPath], app.getPath("home"));
    }
    return { ok: true, providerId };
  } finally {
    if (installerDirectory) await fs.rm(installerDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

async function createMainWindow() {
  initializeUserConfig();
  registerIpcHandlers();

  const iconFile = process.platform === "win32" ? "icon.ico" : "icon.png";
  const unpackedIconPath = path.join(__dirname.replace("app.asar", "app.asar.unpacked"), iconFile);
  const windowIconPath = existsSync(unpackedIconPath) ? unpackedIconPath : path.join(__dirname, iconFile);
  const usesNativeOverlay = process.platform === "win32" || process.platform === "linux";
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = new BrowserWindow({
      title: "OpenSybau",
      width: 1480,
      height: 960,
      minWidth: 960,
      minHeight: 640,
      show: true,
      icon: windowIconPath,
      backgroundColor: process.platform === "win32" ? "#00000000" : "#111214",
      ...(usesNativeOverlay
        ? {
            titleBarStyle: "hidden",
            titleBarOverlay: {
              color: process.platform === "win32" ? "#00000000" : "#111214",
              symbolColor: "#d4d4d8",
              height: 38,
            },
          }
        : {}),
      ...(process.platform === "win32" ? { backgroundMaterial: "acrylic" } : {}),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    mainWindow.on("closed", () => { mainWindow = null; });
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (isAllowedExternal(url)) void shell.openExternal(url);
      return { action: "deny" };
    });
    mainWindow.webContents.on("will-navigate", (event, url) => {
      if (isAllowedExternal(url)) {
        event.preventDefault();
        void shell.openExternal(url);
        return;
      }
      if (!workbenchUrl) return;
      if (url !== workbenchUrl && !url.startsWith(`${workbenchUrl}/`) && !url.startsWith(`${workbenchUrl}#`)) event.preventDefault();
    });
  }

  const serverModule = await import("../server.mjs");
  stopWorkbench = serverModule.stopWorkbench;
  const server = await serverModule.startWorkbench();
  workbenchUrl = `${server.protocol}://${server.host}:${server.port}`;

  if (mainWindow && !mainWindow.isDestroyed()) {
    await mainWindow.loadURL(workbenchUrl);
    if (!mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
  await initializeAutoUpdates();
}

function publishUpdateState(nextState) {
  updateState = { currentVersion: app.getVersion(), ...nextState };
  if (!mainWindow?.isDestroyed()) mainWindow.webContents.send("opensybau:update:state", updateState);
}

let updatesInitialized = false;

async function initializeAutoUpdates() {
  if (!app.isPackaged || !["win32", "linux"].includes(process.platform) || updatesInitialized) return;
  updatesInitialized = true;
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
  if (!app.isPackaged || !["win32", "linux"].includes(process.platform)) return updateState;
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
  if (stopping) return;
  if (!mainWindow || mainWindow.isDestroyed()) {
    void createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  if (!mainWindow.isVisible()) mainWindow.show();
  mainWindow.focus();
});

app.whenReady().then(() => singletonLock ? createMainWindow() : undefined).catch((error) => {
  console.error("OpenSybau startup failed:", error);
  dialog.showErrorBox("OpenSybau could not start", `${error?.message || error}\n\nConfiguration: ${envPath}`);
  app.quit();
});

app.on("before-quit", (event) => {
  if (stopping) return;
  stopping = true;
  try { app.releaseSingleInstanceLock(); } catch {}
  if (!stopWorkbench) return;
  event.preventDefault();
  const forceExitTimer = setTimeout(() => app.exit(0), 1500);
  forceExitTimer.unref?.();
  void Promise.resolve(stopWorkbench())
    .catch(() => {})
    .finally(() => {
      clearTimeout(forceExitTimer);
      app.exit(0);
    });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
