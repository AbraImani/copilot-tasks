/**
 * Preload script for Electron renderer processes
 * Exposes safe IPC methods to the renderer
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('copilotTasks', {
  // Call management
  acceptCall: (callId) => ipcRenderer.invoke('accept-call', callId),
  denyCall: (callId) => ipcRenderer.invoke('deny-call', callId),
  endCall: (callId, result) => ipcRenderer.invoke('end-call', callId, result),
  
  // Data retrieval
  getHistory: () => ipcRenderer.invoke('get-history'),
  getQueue: () => ipcRenderer.invoke('get-queue'),
  
  // Event listeners
  onIncomingCall: (callback) => {
    ipcRenderer.on('incoming-call', (event, call) => callback(call));
  },
  onCallStarted: (callback) => {
    ipcRenderer.on('call-started', (event, callId) => callback(callId));
  },
  onCallEnded: (callback) => {
    ipcRenderer.on('call-ended', (event, callId) => callback(callId));
  },
  
  // Eleven Labs voice
  startVoiceSession: (callId, context, questions) => 
    ipcRenderer.invoke('start-voice-session', callId, context, questions),
  endVoiceSession: (callId) => 
    ipcRenderer.invoke('end-voice-session', callId),
});
