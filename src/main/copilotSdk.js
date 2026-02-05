/**
 * Copilot SDK Integration
 * 
 * Manages connection to the Copilot CLI server for session listing and management.
 */

let CopilotClient;

// Dynamic import for ESM module
async function loadSDK() {
  if (!CopilotClient) {
    const sdk = await import('@github/copilot-sdk');
    CopilotClient = sdk.CopilotClient;
  }
  return CopilotClient;
}

/** @type {import('@github/copilot-sdk').CopilotClient | null} */
let client = null;
let clientStarting = false;
let lastSessionsFetch = 0;
let cachedSessions = [];
const CACHE_TTL_MS = 5000; // Cache sessions for 5 seconds

/**
 * Get or create the Copilot client
 * @returns {Promise<import('@github/copilot-sdk').CopilotClient>}
 */
async function getClient() {
  if (client) {
    return client;
  }

  if (clientStarting) {
    // Wait for client to be ready
    while (clientStarting) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (client) return client;
  }

  clientStarting = true;
  try {
    const ClientClass = await loadSDK();
    client = new ClientClass({
      autoStart: true,
      autoRestart: true,
      useLoggedInUser: true,
    });
    await client.start();
    console.log('✅ Copilot SDK client connected');
    return client;
  } catch (error) {
    console.error('❌ Failed to start Copilot SDK client:', error.message);
    client = null;
    throw error;
  } finally {
    clientStarting = false;
  }
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
 * Create a new session for a task
 * @param {string} prompt - The task description
 * @returns {Promise<{success: boolean, sessionId?: string, error?: string}>}
 */
async function createTaskSession(prompt) {
  try {
    const copilotClient = await getClient();
    const session = await copilotClient.createSession({
      model: 'gpt-5',
    });

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
  if (client) {
    try {
      await client.stop();
      console.log('✅ Copilot SDK client stopped');
    } catch (error) {
      console.error('❌ Error stopping Copilot SDK client:', error.message);
    }
    client = null;
  }
}

module.exports = {
  listSessions,
  resumeSession,
  createTaskSession,
  stopClient,
};
