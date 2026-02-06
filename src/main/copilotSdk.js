/**
 * Copilot SDK Integration
 * 
 * Manages connection to the Copilot CLI server for session listing and management.
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const os = require('os');
const execAsync = promisify(exec);

let CopilotClient;

// Dynamic import for ESM module
async function loadSDK() {
  if (!CopilotClient) {
    const sdk = await import('@github/copilot-sdk');
    CopilotClient = sdk.CopilotClient;
  }
  return CopilotClient;
}

/**
 * Read the user's CLI config to maintain parity with their CLI settings
 */
function readCliConfig() {
  try {
    const configPath = path.join(os.homedir(), '.copilot', 'config.json');
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** @type {Map<string, import('@github/copilot-sdk').CopilotClient>} */
const clientsByWorkspace = new Map();
let lastSessionsFetch = 0;
let cachedSessions = [];
const CACHE_TTL_MS = 5000; // Cache sessions for 5 seconds

/** @type {Map<string, import('@github/copilot-sdk').CopilotSession>} */
const activeSessions = new Map();

/** @type {Map<string, Function[]>} */
const sessionEventHandlers = new Map();

/**
 * Get or create a Copilot client for a specific workspace directory.
 * The default (no cwd) client is keyed by empty string.
 * @param {string} [cwd]
 * @returns {Promise<import('@github/copilot-sdk').CopilotClient>}
 */
async function getClient(cwd) {
  const key = cwd || '';

  if (clientsByWorkspace.has(key)) {
    return clientsByWorkspace.get(key);
  }

  const ClientClass = await loadSDK();
  const opts = { autoStart: true, autoRestart: true };
  if (cwd) opts.cwd = cwd;

  const newClient = new ClientClass(opts);
  await newClient.start();
  clientsByWorkspace.set(key, newClient);
  console.log(`✅ Copilot SDK client connected (cwd: ${cwd || 'default'})`);
  return newClient;
}

/**
 * List all available sessions from the Copilot CLI
 * @returns {Promise<Array<{id: string, repository: string, branch: string, lastActivity: string, lastActivityTime: number, status: string, connectedUsers: string[], canJoin: boolean}>>}
 */
async function listSessions() {
  // Return cached sessions if still fresh
  const now = Date.now();
  if (cachedSessions.length > 0 && (now - lastSessionsFetch) < CACHE_TTL_MS) {
    return cachedSessions;
  }

  try {
    const copilotClient = await getClient();
    const sessionMetadata = await copilotClient.listSessions();
    
    // Transform SessionMetadata to our dashboard format
    const sessions = sessionMetadata.map(meta => {
      // Parse workspace info from session summary if available
      const summary = meta.summary || 'No activity';
      
      // Try to extract repo info from summary or use defaults
      // The summary typically contains the last activity description
      const workspaceMatch = summary.match(/^([^/]+\/[^:]+)/);
      const repository = workspaceMatch ? workspaceMatch[1] : 'Unknown Repository';
      
      // Determine status based on modification time
      const modTime = meta.modifiedTime.getTime();
      const timeSinceActivity = now - modTime;
      let status = 'disconnected';
      if (timeSinceActivity < 60000) { // Active in last minute
        status = 'active';
      } else if (timeSinceActivity < 3600000) { // Active in last hour
        status = 'idle';
      }

      return {
        id: meta.sessionId,
        repository: repository,
        branch: 'main', // SDK doesn't expose branch info yet
        lastActivity: summary,
        lastActivityTime: modTime,
        status: status,
        connectedUsers: status === 'active' ? ['You'] : [],
        canJoin: status !== 'active',
        isRemote: meta.isRemote,
      };
    });

    // Sort by most recent first
    sessions.sort((a, b) => b.lastActivityTime - a.lastActivityTime);

    cachedSessions = sessions;
    lastSessionsFetch = now;
    
    return sessions;
  } catch (error) {
    console.error('❌ Failed to list sessions:', error.message);
    // Return cached sessions on error, or empty array
    return cachedSessions.length > 0 ? cachedSessions : [];
  }
}

/**
 * Resume a session by ID
 * @param {string} sessionId 
 * @returns {Promise<{success: boolean, sessionId: string, error?: string}>}
 */
async function resumeSession(sessionId) {
  try {
    const copilotClient = await getClient();
    const session = await copilotClient.resumeSession(sessionId);
    
    console.log(`✅ Resumed session: ${sessionId}`);
    console.log(`   Workspace: ${session.workspacePath || 'N/A'}`);
    
    return {
      success: true,
      sessionId: session.sessionId,
      workspacePath: session.workspacePath,
    };
  } catch (error) {
    console.error(`❌ Failed to resume session ${sessionId}:`, error.message);
    return {
      success: false,
      sessionId,
      error: error.message,
    };
  }
}

/**
 * Create a new empty session for interactive chat
 * @returns {Promise<{success: boolean, sessionId?: string, error?: string}>}
 */
async function createSession(workspacePath) {
  try {
    const cwd = workspacePath || os.homedir();
    const copilotClient = await getClient(cwd);
    const session = await copilotClient.createSession({});

    console.log(`✅ Created new session: ${session.sessionId} (cwd: ${cwd})`);
    
    // Store in active sessions
    activeSessions.set(session.sessionId, session);
    
    return {
      success: true,
      sessionId: session.sessionId,
      workspacePath: cwd,
    };
  } catch (error) {
    console.error('❌ Failed to create session:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Create a new session for a task
 * @param {string} prompt - The task description
 * @returns {Promise<{success: boolean, sessionId?: string, error?: string}>}
 */
async function createTaskSession(prompt, workspacePath) {
  try {
    const cwd = workspacePath || os.homedir();
    const copilotClient = await getClient(cwd);
    const session = await copilotClient.createSession({});

    // Send the initial prompt
    await session.send({ prompt });

    console.log(`✅ Created new session: ${session.sessionId}`);
    
    return {
      success: true,
      sessionId: session.sessionId,
      workspacePath: session.workspacePath,
    };
  } catch (error) {
    console.error('❌ Failed to create task session:', error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Stop the client connection (call on app quit)
 */
async function stopClient() {
  for (const [key, c] of clientsByWorkspace) {
    try {
      await c.stop();
      console.log(`✅ Copilot SDK client stopped (cwd: ${key || 'default'})`);
    } catch (error) {
      console.error(`❌ Error stopping Copilot SDK client (${key || 'default'}):`, error.message);
    }
  }
  clientsByWorkspace.clear();
}

/**
 * Discover running Copilot CLI processes
 * @returns {Promise<Array<{pid: number, tty: string, sessionId: string|null, cwd: string|null, args: string}>>}
 */
async function discoverRunningProcesses() {
  try {
    // Get copilot-darwin processes with PID, TTY, and args
    const { stdout } = await execAsync(
      `ps -eo pid,tty,args | grep 'copilot-darwin' | grep -v grep`
    );
    
    const processes = [];
    const lines = stdout.trim().split('\n').filter(Boolean);
    
    for (const line of lines) {
      const match = line.match(/^\s*(\d+)\s+(ttys\d+)\s+(.+)$/);
      if (!match) continue;
      
      const [, pid, tty, args] = match;
      
      // Extract session ID if --resume flag is present
      const sessionMatch = args.match(/--resume[=\s]+([a-f0-9-]+)/i);
      const sessionId = sessionMatch ? sessionMatch[1] : null;
      
      // Get working directory via lsof
      let cwd = null;
      try {
        const { stdout: lsofOut } = await execAsync(`lsof -p ${pid} 2>/dev/null | grep cwd`);
        const cwdMatch = lsofOut.match(/\s(\/\S+)$/);
        if (cwdMatch) cwd = cwdMatch[1];
      } catch (e) {
        // lsof may fail for some processes
      }
      
      processes.push({
        pid: parseInt(pid),
        tty,
        sessionId,
        cwd,
        args,
      });
    }
    
    return processes;
  } catch (error) {
    console.error('❌ Failed to discover running processes:', error.message);
    return [];
  }
}

/**
 * Focus a Conduit terminal window/tab by TTY
 * @param {string} tty - The TTY name (e.g., "ttys018")
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function focusConduitWindow(tty) {
  try {
    // Use Conduit's AppleScript support to focus the right tab
    const script = `
      tell application "Conduit"
        activate
      end tell
      
      tell application "System Events"
        tell process "Conduit"
          set frontmost to true
        end tell
      end tell
    `;
    
    await execAsync(`osascript -e '${script}'`);
    console.log(`✅ Focused Conduit for TTY: ${tty}`);
    
    return { success: true };
  } catch (error) {
    console.error(`❌ Failed to focus Conduit window:`, error.message);
    return { success: false, error: error.message };
  }
}

/**
 * List sessions merged with running process info
 * @returns {Promise<Array>}
 */
async function listSessionsWithRunning() {
  // Get both stored sessions and running processes in parallel
  const [storedSessions, runningProcesses] = await Promise.all([
    listSessions(),
    discoverRunningProcesses(),
  ]);
  
  // Create a map of running sessions by sessionId
  const runningBySessionId = new Map();
  const runningWithoutSession = [];
  
  for (const proc of runningProcesses) {
    if (proc.sessionId) {
      runningBySessionId.set(proc.sessionId, proc);
    } else {
      runningWithoutSession.push(proc);
    }
  }
  
  // Merge running info into stored sessions
  const mergedSessions = storedSessions.map(session => {
    const runningProc = runningBySessionId.get(session.id);
    if (runningProc) {
      runningBySessionId.delete(session.id); // Mark as matched
      return {
        ...session,
        source: 'both',
        status: 'running',
        pid: runningProc.pid,
        tty: runningProc.tty,
        cwd: runningProc.cwd || session.repository,
        canJoin: true,
        canChat: true,
        canOpenTerminal: true,
        connectedUsers: ['You (active)'],
      };
    }
    return {
      ...session,
      source: 'sdk',
      canChat: true,
      canOpenTerminal: true,
    };
  });
  
  // Add running processes without stored sessions (process-only)
  for (const proc of runningWithoutSession) {
    const repoName = proc.cwd ? proc.cwd.split('/').pop() : 'Active Session';
    mergedSessions.unshift({
      id: `running-${proc.pid}`,
      repository: repoName,
      branch: 'main',
      lastActivity: 'Running in terminal',
      lastActivityTime: Date.now(),
      source: 'process',
      status: 'running',
      pid: proc.pid,
      tty: proc.tty,
      cwd: proc.cwd,
      connectedUsers: ['You (active)'],
      canJoin: true,
      canChat: false,
      canOpenTerminal: false,
      isRunningOnly: true,
    });
  }
  
  // Sort: running first, then by lastActivityTime
  mergedSessions.sort((a, b) => {
    if (a.status === 'running' && b.status !== 'running') return -1;
    if (a.status !== 'running' && b.status === 'running') return 1;
    return b.lastActivityTime - a.lastActivityTime;
  });
  
  return mergedSessions;
}

/**
 * Join a session for chat - returns the session and sets up event handling
 * @param {string} sessionId 
 * @param {Function} eventHandler - Callback for session events
 * @returns {Promise<{success: boolean, session?: object, error?: string}>}
 */
async function joinSession(sessionId, eventHandler) {
  try {
    // Check if we need to subscribe to events (not done yet for this session)
    const needsSubscription = !sessionEventHandlers.has(sessionId);
    
    let session;
    if (!activeSessions.has(sessionId)) {
      const copilotClient = await getClient();
      session = await copilotClient.resumeSession(sessionId);
      activeSessions.set(sessionId, session);
    } else {
      session = activeSessions.get(sessionId);
    }
    
    if (needsSubscription) {
      sessionEventHandlers.set(sessionId, []);
    }
    
    // Add event handler
    if (eventHandler) {
      const handlers = sessionEventHandlers.get(sessionId) || [];
      handlers.push(eventHandler);
      sessionEventHandlers.set(sessionId, handlers);
    }
    
    // Subscribe to events if this is a new subscription
    if (needsSubscription) {
      session.on((event) => {
        const handlers = sessionEventHandlers.get(sessionId) || [];
        for (const handler of handlers) {
          try {
            handler(event);
          } catch (err) {
            console.error('Error in session event handler:', err);
          }
        }
      });
    }
    
    console.log(`✅ Joined session: ${sessionId}`);
    
    return {
      success: true,
      session: { sessionId: session.sessionId },
    };
  } catch (error) {
    console.error(`❌ Failed to join session ${sessionId}:`, error.message);
    return {
      success: false,
      sessionId,
      error: error.message,
    };
  }
}

/**
 * Send a message to a joined session
 * @param {string} sessionId 
 * @param {string} prompt 
 * @returns {Promise<{success: boolean, messageId?: string, error?: string}>}
 */
async function sendToSession(sessionId, prompt) {
  try {
    const session = activeSessions.get(sessionId);
    if (!session) {
      // Try to join first
      const joinResult = await joinSession(sessionId);
      if (!joinResult.success) {
        return { success: false, error: 'Session not found' };
      }
    }
    
    const activeSession = activeSessions.get(sessionId);
    const messageId = await activeSession.send({ prompt });
    
    console.log(`📤 Sent message to session ${sessionId}: ${prompt.substring(0, 50)}...`);
    
    return {
      success: true,
      messageId,
    };
  } catch (error) {
    console.error(`❌ Failed to send to session ${sessionId}:`, error.message);
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get messages/events from a session
 * @param {string} sessionId 
 * @returns {Promise<Array>}
 */
async function getSessionMessages(sessionId) {
  try {
    let session = activeSessions.get(sessionId);
    if (!session) {
      // Try to resume the session to get messages
      const copilotClient = await getClient();
      session = await copilotClient.resumeSession(sessionId);
      activeSessions.set(sessionId, session);
    }
    
    const messages = await session.getMessages();
    return messages;
  } catch (error) {
    console.error(`❌ Failed to get messages for session ${sessionId}:`, error.message);
    return [];
  }
}

/**
 * Leave a session (cleanup handlers)
 * @param {string} sessionId 
 */
function leaveSession(sessionId) {
  sessionEventHandlers.delete(sessionId);
  // Don't destroy the session, just remove handlers
  console.log(`👋 Left session: ${sessionId}`);
}

/**
 * Open a session in a new terminal window via the CLI
 * @param {string} sessionId
 * @returns {Promise<{success: boolean, error?: string}>}
 */
async function openInTerminal(sessionId) {
  try {
    // Use the copilot CLI --resume flag in a new terminal window
    const cmd = `copilot --resume ${sessionId}`;

    if (process.platform === 'darwin') {
      // Try Conduit first, fall back to Terminal.app
      try {
        await execAsync(`open -a Conduit`);
        // Give Conduit a moment to focus, then use osascript to type the command
        const script = `
          tell application "System Events"
            tell process "Conduit"
              delay 0.3
              keystroke "t" using command down
              delay 0.3
              keystroke "${cmd}"
              key code 36
            end tell
          end tell
        `;
        await execAsync(`osascript -e '${script}'`);
      } catch {
        // Fall back to Terminal.app
        const script = `tell application "Terminal" to do script "${cmd}"`;
        await execAsync(`osascript -e '${script}'`);
      }
    } else {
      // Linux / Windows fallback
      await execAsync(`x-terminal-emulator -e ${cmd}`);
    }

    console.log(`✅ Opened session in terminal: ${sessionId}`);
    return { success: true };
  } catch (error) {
    console.error(`❌ Failed to open session in terminal:`, error.message);
    return { success: false, error: error.message };
  }
}

module.exports = {
  listSessions,
  listSessionsWithRunning,
  resumeSession,
  createSession,
  createTaskSession,
  stopClient,
  focusConduitWindow,
  openInTerminal,
  discoverRunningProcesses,
  joinSession,
  sendToSession,
  getSessionMessages,
  leaveSession,
};
