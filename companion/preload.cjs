const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('activityStatus', {
  getStatus: () => ipcRenderer.invoke('status:get'),
  startBackend: () => ipcRenderer.invoke('backend:start'),
  stopBackend: () => ipcRenderer.invoke('backend:stop'),
  openExtensions: () => ipcRenderer.invoke('open:extensions'),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  getLaunchAtLogin: () => ipcRenderer.invoke('launch-at-login:get'),
  setLaunchAtLogin: openAtLogin => ipcRenderer.invoke('launch-at-login:set', openAtLogin),
  onBackendLog: callback => ipcRenderer.on('backend-log', (_event, line) => callback(line))
});
