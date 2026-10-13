const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("opensybauDesktop", Object.freeze({
  isDesktop: true,
  supportsAutoUpdate: process.platform === "win32",
  openConfigFolder: () => ipcRenderer.invoke("opensybau:open-config-folder"),
  chooseAntigravityCli: () => ipcRenderer.invoke("opensybau:antigravity:choose-cli"),
  getUpdateState: () => ipcRenderer.invoke("opensybau:update:get-state"),
  checkForUpdates: () => ipcRenderer.invoke("opensybau:update:check"),
  restartToUpdate: () => ipcRenderer.invoke("opensybau:update:restart"),
  onUpdateState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on("opensybau:update:state", listener);
    return () => ipcRenderer.removeListener("opensybau:update:state", listener);
  },
}));
