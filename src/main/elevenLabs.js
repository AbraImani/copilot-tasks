/**
 * Eleven Labs Conversational AI Integration
 * 
 * Uses Eleven Labs' WebSocket-based conversational AI for real-time voice interaction.
 */
const { ipcMain } = require('electron');
const WebSocket = require('ws');

const ELEVEN_LABS_API_KEY = process.env.ELEVEN_LABS_API_KEY;
const ELEVEN_LABS_AGENT_ID = process.env.ELEVEN_LABS_AGENT_ID;

// WebSocket connection for voice
let activeWebSocket = null;
let mediaRecorder = null;

/**
 * System prompt for the voice agent
 */
function buildSystemPrompt(context, questions) {
  return `You are a helpful voice assistant helping a developer clarify requirements for their coding task.

CONTEXT FROM THE CODING AGENT:
${context}

QUESTIONS TO RESOLVE:
${questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}

INSTRUCTIONS:
1. Have a natural conversation to understand the user's needs
2. Ask clarifying questions to get specific details
3. When you have enough information to answer all the questions, summarize what you learned
4. Keep responses concise - this is a voice conversation
5. Be friendly and professional

When you have gathered enough information, say "I have all the details I need" and provide a summary.`;
}

/**
 * Start a voice session with Eleven Labs
 */
async function startVoiceSession(callId, context, questions, onTranscript, onComplete) {
  if (!ELEVEN_LABS_API_KEY) {
    throw new Error('ELEVEN_LABS_API_KEY environment variable not set');
  }

  const transcript = [];
  
  // Connect to Eleven Labs Conversational AI WebSocket
  const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${ELEVEN_LABS_AGENT_ID}`;
  
  const ws = new WebSocket(wsUrl, {
    headers: {
      'xi-api-key': ELEVEN_LABS_API_KEY,
    },
  });

  activeWebSocket = ws;

  ws.on('open', () => {
    console.log('Connected to Eleven Labs');
    
    // Send initial context
    ws.send(JSON.stringify({
      type: 'conversation_initiation_client_data',
      custom_llm_extra_body: {
        system_prompt: buildSystemPrompt(context, questions),
      },
    }));
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      
      switch (message.type) {
        case 'agent_response':
          transcript.push({
            role: 'agent',
            text: message.text,
            timestamp: Date.now(),
          });
          onTranscript?.({ role: 'agent', text: message.text });
          break;
          
        case 'user_transcript':
          transcript.push({
            role: 'user',
            text: message.text,
            timestamp: Date.now(),
          });
          onTranscript?.({ role: 'user', text: message.text });
          break;
          
        case 'audio':
          // Handle audio playback (base64 encoded audio)
          // This would be played through the system audio
          break;
          
        case 'conversation_ended':
          // Extract summary from final messages
          const summary = extractSummary(transcript);
          onComplete?.({
            summary,
            transcript,
            duration: calculateDuration(transcript),
          });
          break;
      }
    } catch (error) {
      console.error('Error parsing Eleven Labs message:', error);
    }
  });

  ws.on('close', () => {
    console.log('Disconnected from Eleven Labs');
    activeWebSocket = null;
  });

  ws.on('error', (error) => {
    console.error('Eleven Labs WebSocket error:', error);
    activeWebSocket = null;
  });

  // Don't return the object with functions - manage session via separate IPC calls
  return { started: true };
}

/**
 * Extract summary from transcript
 */
function extractSummary(transcript) {
  // Look for the agent's summary message (typically the last agent message)
  const agentMessages = transcript.filter(t => t.role === 'agent');
  if (agentMessages.length === 0) return 'No summary available';
  
  // The last few agent messages often contain the summary
  const lastMessages = agentMessages.slice(-3);
  const summaryMessage = lastMessages.find(m => 
    m.text.toLowerCase().includes('summary') || 
    m.text.toLowerCase().includes('to summarize') ||
    m.text.toLowerCase().includes('i have all the details')
  );
  
  return summaryMessage?.text || agentMessages[agentMessages.length - 1].text;
}

/**
 * Calculate call duration from transcript
 */
function calculateDuration(transcript) {
  if (transcript.length < 2) return 0;
  const first = transcript[0].timestamp;
  const last = transcript[transcript.length - 1].timestamp;
  return Math.round((last - first) / 1000);
}

/**
 * Register IPC handlers for voice session
 */
function registerVoiceHandlers() {
  ipcMain.handle('start-voice-session', async (event, callId, context, questions) => {
    return startVoiceSession(callId, context, questions, 
      (transcript) => {
        event.sender.send('voice-transcript', { callId, ...transcript });
      },
      (result) => {
        event.sender.send('voice-complete', { callId, ...result });
      }
    );
  });

  ipcMain.handle('end-voice-session', async (event, callId) => {
    if (activeWebSocket) {
      activeWebSocket.close();
      activeWebSocket = null;
    }
  });
  
  ipcMain.handle('send-voice-audio', async (event, callId, audioData) => {
    // Send audio to active WebSocket
    if (activeWebSocket && activeWebSocket.readyState === WebSocket.OPEN) {
      activeWebSocket.send(JSON.stringify({
        type: 'audio',
        data: audioData,
      }));
    }
  });
}

module.exports = {
  startVoiceSession,
  registerVoiceHandlers,
};
