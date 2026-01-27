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
  onVoiceAudio: (callback) => {
    ipcRenderer.on('voice-audio', (event, data) => callback(data));
  },
  onVoiceTranscript: (callback) => {
    ipcRenderer.on('voice-transcript', (event, data) => callback(data));
  },
  onVoiceComplete: (callback) => {
    ipcRenderer.on('voice-complete', (event, data) => callback(data));
  },
  
  // Eleven Labs voice
  startVoiceSession: (callId, context, questions) => 
    ipcRenderer.invoke('start-voice-session', callId, context, questions),
  endVoiceSession: (callId) => 
    ipcRenderer.invoke('end-voice-session', callId),
  sendVoiceAudio: (callId, audioData) =>
    ipcRenderer.invoke('send-voice-audio', callId, audioData),
});
