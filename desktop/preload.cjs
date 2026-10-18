const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("opensybauDesktop", Object.freeze({
  isDesktop: true,
  supportsAutoUpdate: process.platform === "win32" || process.platform === "linux",
  supportsCliInstall: process.platform === "win32" || process.platform === "linux",
  installCli: (providerId, language) => ipcRenderer.invoke("opensybau:cli:install", providerId, language),
  openConfigFolder: () => ipcRenderer.invoke("opensybau:open-config-folder"),
  getUpdateState: () => ipcRenderer.invoke("opensybau:update:get-state"),
  checkForUpdates: () => ipcRenderer.invoke("opensybau:update:check"),
  restartToUpdate: () => ipcRenderer.invoke("opensybau:update:restart"),
  setTheme: (payload) => ipcRenderer.invoke("opensybau:theme:set", payload),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("opensybau:update:state", listener);
    return () => ipcRenderer.removeListener("opensybau:update:state", listener);
  },
}));
