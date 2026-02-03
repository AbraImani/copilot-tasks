const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  acceptSimulatedCall: (platform, callerName) => ipcRenderer.invoke('accept-simulated-call', platform, callerName),
  declineSimulatedCall: (platform) => ipcRenderer.invoke('decline-simulated-call', platform),
});
