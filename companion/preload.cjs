const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('activityStatus', {
  getStatus: () => ipcRenderer.invoke('status:get'),
  startBackend: () => ipcRenderer.invoke('backend:start'),
  stopBackend: () => ipcRenderer.invoke('backend:stop'),
  restartBackend: () => ipcRenderer.invoke('backend:restart'),
  reconnectRpc: () => ipcRenderer.invoke('rpc:reconnect'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openExtensions: () => ipcRenderer.invoke('open:extensions'),
  hideWindow: () => ipcRenderer.invoke('window:hide'),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  quit: () => ipcRenderer.invoke('quit'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: settings => ipcRenderer.invoke('settings:set', settings),
  copyText: text => ipcRenderer.invoke('clipboard:copy', text),
  onStatusUpdate: callback => ipcRenderer.on('status:update', (_event, status) => callback(status))
});
