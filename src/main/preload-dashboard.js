const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dashboard', {
  getData: () => ipcRenderer.invoke('get-dashboard-data'),
  jumpIntoSession: (sessionId, tty) => ipcRenderer.invoke('jump-into-session', sessionId, tty),
  newChatRequest: () => ipcRenderer.invoke('new-chat-request'),
  newVoiceRequest: () => ipcRenderer.invoke('new-voice-request'),
});
