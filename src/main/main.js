/**
 * Electron Main Process - Tray App for Voice Calls
 */
require('dotenv').config();

const { app, Tray, Menu, nativeImage, BrowserWindow, ipcMain, session, systemPreferences } = require('electron');
const path = require('path');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { registerVoiceHandlers, closeActiveSession } = require('./elevenLabs');

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// Hide from dock on macOS initially (will show temporarily for mic permission)
if (process.platform === 'darwin') {
  app.dock.hide();
}

// Request microphone access on macOS
async function requestMicrophoneAccess() {
  if (process.platform === 'darwin') {
    const status = systemPreferences.getMediaAccessStatus('microphone');
    console.log(`🎤 Microphone access status: ${status}`);
    
    if (status === 'not-determined') {
      // Will be prompted when first call is accepted (dock will be shown then)
      console.log('🎤 Microphone permission not yet determined - will prompt on first call');
      return false;
    } else if (status === 'granted') {
      return true;
    } else {
      console.log('❌ Microphone access denied. Please enable in System Preferences > Privacy & Security > Microphone');
      return false;
    }
  }
  return true; // Non-macOS platforms
}

// Handle permission requests for microphone
app.on('ready', () => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    console.log(`🔐 Permission requested: ${permission}`);
    // Allow microphone and media access
    if (permission === 'media' || permission === 'microphone') {
      console.log('✅ Granting microphone permission');
      callback(true);
    } else {
      callback(true); // Allow other permissions too
    }
  });
  
  // Also handle permission checks
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    if (permission === 'media' || permission === 'microphone') {
      return true;
    }
    return true;
  });
});

const API_PORT = 19741;

/** @type {Electron.Tray | null} */
let tray = null;

/** @type {Electron.BrowserWindow | null} */
let callWindow = null;

/** @type {Electron.BrowserWindow | null} */
let historyWindow = null;

/** @type {import('express').Application} */
let server = null;

/** @type {import('http').Server | null} */
let httpServer = null;

/** @type {Map<string, { request: any, resolve: Function, reject: Function }>} */
const pendingCalls = new Map();

/** @type {any[]} */
const callQueue = [];

/** @type {any | null} */
let activeCall = null;

/** @type {any[]} */
let callHistory = [];

// Load call history from disk
const { CallHistoryDB } = require('./callHistory');
const historyDB = new CallHistoryDB();

function getResourcesPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath);
  }
  return path.resolve(__dirname, '../..');
}

function getIconPath() {
  const resourcesPath = getResourcesPath();
  if (process.platform === 'darwin') {
    return path.join(resourcesPath, 'assets', 'tray-icon.png');
  }
  return path.join(resourcesPath, 'assets', 'tray-icon.ico');
}

function createTray() {
  const iconPath = getIconPath();
  let icon;

  try {
    icon = nativeImage.createFromPath(iconPath);
    if (process.platform === 'darwin') {
      icon = icon.resize({ width: 16, height: 16 });
      icon.setTemplateImage(false);
    }
  } catch (error) {
    console.error('Failed to load tray icon:', error);
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('Copilot Tasks - Voice Assistant');
  updateTrayMenu();

  if (process.platform === 'win32') {
    tray.on('click', () => {
      tray.popUpContextMenu();
    });
  }
}

function updateTrayMenu() {
  if (!tray) return;

  const statusLabel = activeCall
    ? `🎙️ On Call: ${activeCall.topic}`
    : callQueue.length > 0
    ? `📞 ${callQueue.length} call(s) waiting`
    : '● Ready';

  const template = [
    {
      label: 'Copilot Tasks',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: statusLabel,
      enabled: false,
    },
  ];

  if (callQueue.length > 0) {
    template.push({
      label: `View Queue (${callQueue.length})`,
      click: () => showQueueWindow(),
    });
  }

  template.push(
    {
      label: 'Call History',
      click: () => showHistoryWindow(),
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => showSettingsWindow(),
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => app.quit(),
    }
  );

  const contextMenu = Menu.buildFromTemplate(template);
  tray.setContextMenu(contextMenu);
}

function createCallWindow() {
  if (callWindow) {
    callWindow.focus();
    return callWindow;
  }

  const preloadPath = app.isPackaged
    ? path.join(__dirname, 'preload.js')
    : path.join(__dirname, 'preload.js');

  // Get screen dimensions for centering
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  
  const windowWidth = 420;
  const windowHeight = 500;

  callWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.round((screenWidth - windowWidth) / 2),
    y: Math.round((screenHeight - windowHeight) / 2),
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  });

  // Load the call UI
  if (app.isPackaged) {
    callWindow.loadFile(path.join(__dirname, '../../dist/call.html'));
  } else {
    callWindow.loadFile(path.join(__dirname, '../renderer/call.html'));
  }

  callWindow.once('ready-to-show', () => {
    callWindow.show();
  });

  callWindow.on('closed', () => {
    callWindow = null;
  });

  return callWindow;
}

function showHistoryWindow() {
  if (historyWindow) {
    historyWindow.focus();
    return;
  }

  historyWindow = new BrowserWindow({
    width: 600,
    height: 500,
    title: 'Call History',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  if (app.isPackaged) {
    historyWindow.loadFile(path.join(__dirname, '../../dist/history.html'));
  } else {
    historyWindow.loadFile(path.join(__dirname, '../renderer/history.html'));
  }

  historyWindow.on('closed', () => {
    historyWindow = null;
  });
}

function showQueueWindow() {
  // For now, just show history window with queue tab
  showHistoryWindow();
}

function showSettingsWindow() {
  // TODO: Implement settings window
  console.log('Settings window not yet implemented');
}

async function handleIncomingCall(callRequest) {
  console.log('Incoming call:', callRequest.topic);

  // If there's an active call, queue this one
  if (activeCall) {
    callQueue.push(callRequest);
    updateTrayMenu();
    return new Promise((resolve, reject) => {
      pendingCalls.set(callRequest.callId, { request: callRequest, resolve, reject });
    });
  }

  // Show the call notification
  return new Promise((resolve, reject) => {
    pendingCalls.set(callRequest.callId, { request: callRequest, resolve, reject });
    
    const win = createCallWindow();
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('incoming-call', callRequest);
    });
  });
}

function processNextQueuedCall() {
  if (callQueue.length === 0) {
    updateTrayMenu();
    return;
  }

  const nextCall = callQueue.shift();
  const pending = pendingCalls.get(nextCall.callId);
  
  if (pending) {
    const win = createCallWindow();
    win.webContents.once('did-finish-load', () => {
      win.webContents.send('incoming-call', nextCall);
    });
  }
  
  updateTrayMenu();
}

// IPC Handlers
ipcMain.handle('accept-call', async (event, callId) => {
  const pending = pendingCalls.get(callId);
  if (!pending) return;

  activeCall = pending.request;
  updateTrayMenu();

  // Show in dock for mic access during call
  if (process.platform === 'darwin') {
    app.dock.show();
  }

  // Start the voice call (will be implemented with Eleven Labs)
  // For now, return a placeholder
  if (callWindow) {
    callWindow.webContents.send('call-started', callId);
  }
});

ipcMain.handle('deny-call', async (event, callId) => {
  const pending = pendingCalls.get(callId);
  if (!pending) return;

  pendingCalls.delete(callId);
  
  // Save to history
  historyDB.saveCall({
    ...pending.request,
    status: 'denied',
    endedAt: Date.now(),
  });

  pending.resolve({
    status: 'denied',
    error: 'User denied the call',
  });

  if (callWindow) {
    callWindow.close();
  }

  processNextQueuedCall();
});

ipcMain.handle('end-call', async (event, callId, result) => {
  const pending = pendingCalls.get(callId);
  if (!pending) return;

  pendingCalls.delete(callId);
  activeCall = null;

  // Close the Eleven Labs WebSocket
  closeActiveSession();

  // Hide from dock when call ends
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  // Save to history
  historyDB.saveCall({
    ...pending.request,
    status: 'completed',
    result,
    endedAt: Date.now(),
  });

  pending.resolve({
    status: 'completed',
    ...result,
  });

  if (callWindow) {
    callWindow.close();
  }

  processNextQueuedCall();
});

ipcMain.handle('get-history', async () => {
  return historyDB.getHistory();
});

ipcMain.handle('get-queue', async () => {
  return callQueue;
});

// HTTP API Server
function startAPIServer() {
  const expressApp = express();
  expressApp.use(express.json());

  // Health check
  expressApp.get('/api/status', (req, res) => {
    res.json({
      status: 'running',
      activeCall: activeCall ? { callId: activeCall.callId, topic: activeCall.topic } : null,
      queueLength: callQueue.length,
    });
  });

  // Initiate a call (from CLI)
  expressApp.post('/api/call', async (req, res) => {
    try {
      const callRequest = {
        callId: req.body.callId || uuidv4(),
        topic: req.body.topic,
        context: req.body.context,
        questions: req.body.questions || [],
        timestamp: Date.now(),
      };

      const result = await handleIncomingCall(callRequest);
      res.json(result);
    } catch (error) {
      res.status(500).json({
        status: 'error',
        error: error.message,
      });
    }
  });

  // Get call queue
  expressApp.get('/api/queue', (req, res) => {
    res.json({
      currentCall: activeCall,
      queued: callQueue,
    });
  });

  // Get call history
  expressApp.get('/api/history', (req, res) => {
    res.json({
      calls: historyDB.getHistory(),
    });
  });

  httpServer = expressApp.listen(API_PORT, '127.0.0.1', () => {
    console.log(`Copilot Tasks API server running on http://127.0.0.1:${API_PORT}`);
  });

  httpServer.on('error', (error) => {
    console.error('Failed to start API server:', error);
  });
}

// App lifecycle
app.whenReady().then(async () => {
  // Request microphone access first on macOS
  const micAccess = await requestMicrophoneAccess();
  if (!micAccess) {
    console.warn('⚠️ Microphone access not granted - voice calls will not work');
  }
  
  createTray();
  startAPIServer();
  registerVoiceHandlers();
  console.log('Copilot Tasks started');
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('before-quit', () => {
  if (httpServer) {
    httpServer.close();
  }
});
