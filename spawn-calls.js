/**
 * Spawn multiple simulated call windows
 * This script opens 4 Electron BrowserWindows, each showing a different platform's call UI
 */
const { app, BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

// Prevent multiple instances
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

const windows = [];

function createCallWindow(platform, htmlFile, x, y, callerName, callerContext, callType = 'video') {
  const win = new BrowserWindow({
    width: 380,
    height: 420,
    x,
    y,
    resizable: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: false,
    show: false,
    transparent: false,
    vibrancy: 'hud',
    visualEffectState: 'active',
    backgroundColor: platform === 'facetime' ? '#1c1c1e' : 
                     platform === 'teams' ? '#292929' : 
                     platform === 'slack' ? '#1a1d21' : '#0d1117',
    hasShadow: true,
    titleBarStyle: 'hidden',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'src/main/preload-sim.js'),
    },
  });

  const params = new URLSearchParams({
    name: callerName,
    context: callerContext,
    type: callType,
  });

  win.loadFile(htmlFile, { query: Object.fromEntries(params) });

  win.once('ready-to-show', () => {
    win.show();
  });

  windows.push(win);
  return win;
}

app.whenReady().then(() => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  
  const winWidth = 380;
  const winHeight = 420;
  const padding = 40;
  
  // Calculate positions for 4 windows
  const positions = {
    // Top-left: Teams
    teams: { x: padding, y: padding },
    // Top-right: Slack
    slack: { x: screenWidth - winWidth - padding, y: padding },
    // Bottom-left: FaceTime
    facetime: { x: padding, y: screenHeight - winHeight - padding },
    // Bottom-right: Agent
    agent: { x: screenWidth - winWidth - padding, y: screenHeight - winHeight - padding },
  };

  // Spawn all windows
  createCallWindow(
    'teams',
    path.join(__dirname, 'src/renderer/call-teams.html'),
    positions.teams.x,
    positions.teams.y,
    'Sarah Chen',
    'Engineering standup',
    'video'
  );

  createCallWindow(
    'slack',
    path.join(__dirname, 'src/renderer/call-slack.html'),
    positions.slack.x,
    positions.slack.y,
    'Mike Johnson',
    '#product-launch'
  );

  createCallWindow(
    'facetime',
    path.join(__dirname, 'src/renderer/call-facetime.html'),
    positions.facetime.x,
    positions.facetime.y,
    'Copilot',
    'iPhone',
    'video'
  );

  createCallWindow(
    'agent',
    path.join(__dirname, 'src/renderer/call-agent.html'),
    positions.agent.x,
    positions.agent.y,
    'Copilot Agent',
    'Ready to assist with your task'
  );

  console.log('✅ Spawned 4 call simulation windows');
});

// Handle accept/decline from renderer
ipcMain.handle('accept-simulated-call', (event, platform, callerName) => {
  console.log(`✅ Accepted call from ${platform}: ${callerName}`);
  // Close all windows
  windows.forEach(win => {
    if (!win.isDestroyed()) win.close();
  });
  app.quit();
});

ipcMain.handle('decline-simulated-call', (event, platform) => {
  console.log(`❌ Declined call from ${platform}`);
  // Just close that window
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && !win.isDestroyed()) win.close();
  
  // If all windows closed, quit
  if (windows.every(w => w.isDestroyed())) {
    app.quit();
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
