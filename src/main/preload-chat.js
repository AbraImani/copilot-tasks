const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('chat', {
  getSessionInfo: () => ipcRenderer.invoke('chat-get-session-info'),
  getMessages: () => ipcRenderer.invoke('chat-get-messages'),
  sendMessage: (text) => ipcRenderer.invoke('chat-send-message', text),
  onEvent: (callback) => {
    ipcRenderer.on('chat-event', (event, data) => callback(data));
  },
  goBack: () => ipcRenderer.invoke('chat-go-back'),
  pickFolder: () => ipcRenderer.invoke('chat-pick-folder'),
});
