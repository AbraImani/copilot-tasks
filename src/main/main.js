/**
 * Electron Main Process - Tray App for Voice Calls
 */
const path = require('path');
const { app } = require('electron');

// Load .env from the right location (project root in dev, resources in packaged)
const envPath = app.isPackaged 
  ? path.join(process.resourcesPath, '.env')
  : path.join(__dirname, '../../.env');
require('dotenv').config({ path: envPath });

const { Tray, Menu, nativeImage, BrowserWindow, ipcMain, session, systemPreferences, shell } = require('electron');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { registerVoiceHandlers, closeActiveSession } = require('./elevenLabs');
const { listSessionsWithRunning, resumeSession, createTaskSession, stopClient, focusConduitWindow, openInTerminal, joinSession, sendToSession, getSessionMessages, leaveSession } = require('./copilotSdk');

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

// Keep app visible in dock for easier debugging and mic permissions
// if (process.platform === 'darwin') {
//   app.dock.hide();
// }

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

/** @type {Electron.BrowserWindow | null} */
let dashboardWindow = null;

/** @type {Electron.BrowserWindow | null} */
let chatWindow = null;

/** @type {{ sessionId: string, title?: string, subtitle?: string, cwd?: string } | null} */
let currentChatSession = null;

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
    transparent: false,
    vibrancy: 'hud',
    visualEffectState: 'active',
    backgroundColor: '#1e1e1e',
    hasShadow: true,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
    },
  });

  // Load the call UI
  if (app.isPackaged) {
    callWindow.loadFile(path.join(__dirname, '../renderer/call.html'));
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
    historyWindow.loadFile(path.join(__dirname, '../renderer/history.html'));
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

function createDashboardWindow() {
  if (dashboardWindow) {
    dashboardWindow.focus();
    return dashboardWindow;
  }

  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  
  const windowWidth = 420;
  const windowHeight = 520;

  dashboardWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.round((screenWidth - windowWidth) / 2),
    y: Math.round((screenHeight - windowHeight) / 2),
    resizable: false,
    frame: false,
    transparent: true,
    vibrancy: 'popover',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    hasShadow: true,
    titleBarStyle: 'hidden',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-dashboard.js'),
    },
  });

  dashboardWindow.loadFile(path.join(__dirname, '../renderer/dashboard.html'));

  dashboardWindow.once('ready-to-show', () => {
    dashboardWindow.show();
  });

  // Close on blur for popover-like behavior
  dashboardWindow.on('blur', () => {
    if (dashboardWindow && !dashboardWindow.isDestroyed()) {
      dashboardWindow.close();
    }
  });

  dashboardWindow.on('closed', () => {
    dashboardWindow = null;
  });

  return dashboardWindow;
}

/**
 * Create and show the chat window for a session
 */
function createChatWindow(sessionId, title, subtitle, cwd) {
  // If we already have a chat window for this session, just re-show it
  if (chatWindow && !chatWindow.isDestroyed() && currentChatSession && currentChatSession.sessionId === sessionId) {
    chatWindow.show();
    chatWindow.focus();
    return chatWindow;
  }

  // Close any existing chat window for a different session
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.close();
  }

  // Store current session info
  currentChatSession = { sessionId, title, subtitle, cwd };

  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  
  const windowWidth = 480;
  const windowHeight = 640;

  chatWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: Math.round((screenWidth - windowWidth) / 2),
    y: Math.round((screenHeight - windowHeight) / 2),
    resizable: true,
    minWidth: 380,
    minHeight: 480,
    frame: false,
    transparent: true,
    vibrancy: 'popover',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    hasShadow: true,
    titleBarStyle: 'hidden',
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload-chat.js'),
    },
  });

  chatWindow.loadFile(path.join(__dirname, '../renderer/chat.html'));

  chatWindow.once('ready-to-show', async () => {
    // Join the session and set up event forwarding
    const result = await joinSession(sessionId, (event) => {
      if (chatWindow && !chatWindow.isDestroyed()) {
        chatWindow.webContents.send('chat-event', event);
      }
    });
    
    if (result.success) {
      chatWindow.show();
    } else {
      console.error('Failed to join session:', result.error);
      chatWindow.close();
    }
  });

  chatWindow.on('closed', () => {
    if (currentChatSession) {
      leaveSession(currentChatSession.sessionId);
    }
    chatWindow = null;
    currentChatSession = null;
  });

  return chatWindow;
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
  if (!pending) {
    console.log(`⚠️ end-call: No pending call found for ${callId}`);
    return;
  }

  console.log(`📞 Ending call ${callId}`);
  console.log(`   Result:`, JSON.stringify(result).slice(0, 500));

  pendingCalls.delete(callId);
  activeCall = null;

  // Close the Eleven Labs WebSocket
  closeActiveSession();

  // Save to history
  historyDB.saveCall({
    ...pending.request,
    status: 'completed',
    result,
    endedAt: Date.now(),
  });

  const response = {
    status: 'completed',
    ...result,
  };
  console.log(`   Resolving with:`, JSON.stringify(response).slice(0, 500));

  pending.resolve(response);

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

// Dashboard IPC handlers
ipcMain.handle('get-dashboard-data', async () => {
  // Fetch real sessions from Copilot SDK (merged with running processes)
  let sessions = [];
  try {
    sessions = await listSessionsWithRunning();
  } catch (error) {
    console.error('Failed to fetch sessions:', error.message);
  }
  
  return {
    queue: callQueue,
    sessions: sessions,
    activeCall: activeCall,
  };
});

ipcMain.handle('jump-into-session', async (event, sessionId, tty) => {
  console.log(`🚀 Jumping into session: ${sessionId}, TTY: ${tty}`);
  
  // Close the dashboard
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.close();
  }
  
  // If we have a TTY and it's a running process without a stored session - focus the terminal
  if (tty && sessionId.startsWith('running-')) {
    const result = await focusConduitWindow(tty);
    return { success: result.success, focused: true };
  }
  
  // For stored sessions, open the chat interface
  const sessions = await listSessionsWithRunning();
  const sessionInfo = sessions.find(s => s.id === sessionId);
  
  createChatWindow(
    sessionId,
    sessionInfo?.cwd ? sessionInfo.cwd.split('/').pop() : sessionInfo?.repository || 'Session',
    sessionInfo?.lastActivity || sessionId
  );
  
  return { success: true, chatOpened: true };
});

// Chat IPC handlers
ipcMain.handle('chat-get-session-info', async () => {
  if (!currentChatSession) {
    return { sessionId: null, title: 'No Session', subtitle: '' };
  }
  return currentChatSession;
});

ipcMain.handle('chat-get-messages', async () => {
  if (!currentChatSession) {
    return [];
  }
  return await getSessionMessages(currentChatSession.sessionId);
});

ipcMain.handle('chat-send-message', async (event, text) => {
  if (!currentChatSession) {
    return { success: false, error: 'No active session' };
  }
  return await sendToSession(currentChatSession.sessionId, text);
});

ipcMain.handle('chat-go-back', async () => {
  // Hide chat window (keep session alive) and open dashboard
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.hide();
  }
  createDashboardWindow();
  return { success: true };
});

ipcMain.handle('chat-pick-folder', async () => {
  const { dialog } = require('electron');
  const result = await dialog.showOpenDialog(chatWindow, {
    properties: ['openDirectory'],
    defaultPath: currentChatSession?.cwd || require('os').homedir(),
    title: 'Choose workspace directory',
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true };
  }
  const chosen = result.filePaths[0];
  if (currentChatSession) {
    currentChatSession.cwd = chosen;
  }
  return { canceled: false, path: chosen };
});

ipcMain.handle('open-in-terminal', async (event, sessionId) => {
  return await openInTerminal(sessionId);
});

// New chat request - opens chat interface with a new session
ipcMain.handle('new-chat-request', async () => {
  console.log('💬 New chat request initiated from dashboard');
  
  // Close the dashboard
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.close();
  }
  
  try {
    const homedir = require('os').homedir();
    // Create a new session with home dir as default workspace
    const { createSession } = require('./copilotSdk');
    const result = await createSession(homedir);
    
    if (result.success && result.sessionId) {
      // Open the chat window for this new session
      createChatWindow(
        result.sessionId,
        'New Request',
        'What would you like help with?',
        homedir
      );
      return { success: true, sessionId: result.sessionId };
    } else {
      console.error('❌ Failed to create session:', result.error);
      return { success: false, error: result.error };
    }
  } catch (error) {
    console.error('❌ Failed to create chat session:', error.message);
    return { success: false, error: error.message };
  }
});

// New voice request - uses the voice call flow
ipcMain.handle('new-voice-request', async () => {
  console.log('🎤 New voice request initiated from dashboard');
  
  // Close the dashboard
  if (dashboardWindow && !dashboardWindow.isDestroyed()) {
    dashboardWindow.close();
  }
  
  // Create a call request for the new request
  const callRequest = {
    callId: `new-request-${Date.now()}`,
    topic: 'New Task Request',
    context: 'Tell me what you\'d like me to help you with. I\'ll listen to your request and then work on it in the background.',
    questions: ['What would you like me to help you with?'],
    timestamp: Date.now(),
    isNewRequest: true,
  };
  
  // Handle this as an incoming call
  const result = await handleIncomingCall(callRequest);
  
  // If completed, spawn a background agent with the request
  if (result && result.status === 'completed' && result.summary) {
    console.log(`🤖 Spawning background agent for: ${result.summary}`);
    
    // Create a new session with the task
    const taskResult = await createTaskSession(result.summary);
    if (taskResult.success) {
      console.log(`✅ Background agent started: ${taskResult.sessionId}`);
    } else {
      console.error(`❌ Failed to start background agent: ${taskResult.error}`);
    }
  }
  
  return result;
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

// Show dashboard when dock icon is clicked
app.on('activate', () => {
  // Only show dashboard if no other windows are open
  if (!callWindow && !historyWindow) {
    createDashboardWindow();
  }
});

app.on('before-quit', async () => {
  if (httpServer) {
    httpServer.close();
  }
  // Stop the Copilot SDK client
  await stopClient();
});
