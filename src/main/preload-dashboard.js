const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dashboard', {
  getData: () => ipcRenderer.invoke('get-dashboard-data'),
  jumpIntoSession: (sessionId) => ipcRenderer.invoke('jump-into-session', sessionId),
  newRequest: () => ipcRenderer.invoke('new-request'),
});
