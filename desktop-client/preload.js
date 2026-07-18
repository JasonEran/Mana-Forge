const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', Object.freeze({
  backendLog: (callback) => ipcRenderer.on('backend-log', (_event, data) => callback(data)),
  backendExit: (callback) => ipcRenderer.on('backend-exit', (_event, data) => callback(data)),
  showError: (message) => ipcRenderer.invoke('show-error', message),
  backendStatus: () => ipcRenderer.invoke('backend-status'),
  onExcite: (callback) => ipcRenderer.on('excite', () => callback()),
  openLogs: () => ipcRenderer.invoke('open-logs'),
  openDocs: () => ipcRenderer.invoke('open-docs'),
}));
