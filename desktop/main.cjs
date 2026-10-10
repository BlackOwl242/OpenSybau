const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const externalHosts = new Set(["developers.openai.com", "platform.openai.com", "code.claude.com", "console.anthropic.com", "antigravity.google", "aistudio.google.com"]);
let mainWindow;
let stopWorkbench;
let stopping = false;
let workbenchUrl;

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
