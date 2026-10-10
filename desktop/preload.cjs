const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("opensybauDesktop", Object.freeze({
  isDesktop: true,
  openConfigFolder: () => ipcRenderer.invoke("opensybau:open-config-folder"),
}));
