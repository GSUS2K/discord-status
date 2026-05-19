const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('activityStatus', {
  getStatus: () => ipcRenderer.invoke('status:get'),
  startBackend: () => ipcRenderer.invoke('backend:start'),
  stopBackend: () => ipcRenderer.invoke('backend:stop'),
  openExtensions: () => ipcRenderer.invoke('open:extensions'),
  onBackendLog: callback => ipcRenderer.on('backend-log', (_event, line) => callback(line))
});
