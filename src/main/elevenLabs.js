/**
 * Eleven Labs Conversational AI Integration
 * 
 * Uses Eleven Labs' WebSocket-based conversational AI for real-time voice interaction.
 */
const { ipcMain } = require('electron');
const WebSocket = require('ws');

const ELEVEN_LABS_API_KEY = process.env.ELEVEN_LABS_API_KEY;
const ELEVEN_LABS_AGENT_ID = process.env.ELEVEN_LABS_AGENT_ID;

// Debug: Log config status on load
console.log('🔧 Eleven Labs Config:');
console.log(`   API Key: ${ELEVEN_LABS_API_KEY ? `✅ Set (${ELEVEN_LABS_API_KEY.slice(0, 8)}...)` : '❌ NOT SET'}`);
console.log(`   Agent ID: ${ELEVEN_LABS_AGENT_ID ? `✅ Set (${ELEVEN_LABS_AGENT_ID})` : '❌ NOT SET'}`);

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
async function startVoiceSession(callId, context, questions, onTranscript, onComplete, onAudioReceived) {
  console.log('🎙️ Starting voice session...');
  console.log(`   Call ID: ${callId}`);
  
  if (!ELEVEN_LABS_API_KEY) {
    console.error('❌ ELEVEN_LABS_API_KEY not set!');
    throw new Error('ELEVEN_LABS_API_KEY environment variable not set');
  }
  
  if (!ELEVEN_LABS_AGENT_ID) {
    console.error('❌ ELEVEN_LABS_AGENT_ID not set!');
    throw new Error('ELEVEN_LABS_AGENT_ID environment variable not set');
  }

  const transcript = [];
  
  // Connect to Eleven Labs Conversational AI WebSocket
  const wsUrl = `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${ELEVEN_LABS_AGENT_ID}`;
  console.log(`   Connecting to: ${wsUrl}`);
  
  const ws = new WebSocket(wsUrl, {
    headers: {
      'xi-api-key': ELEVEN_LABS_API_KEY,
    },
  });

  activeWebSocket = ws;

  ws.on('open', () => {
    console.log('✅ Connected to Eleven Labs WebSocket');
    
    // Send initial context
    const initMessage = {
      type: 'conversation_initiation_client_data',
      custom_llm_extra_body: {
        system_prompt: buildSystemPrompt(context, questions),
      },
    };
    console.log('📤 Sending init message...');
    ws.send(JSON.stringify(initMessage));
  });

  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log(`📨 Received message type: ${message.type}`);
      
      // Debug: log full message structure for unknown types
      if (!['ping', 'audio'].includes(message.type)) {
        console.log(`   Full message: ${JSON.stringify(message).slice(0, 200)}`);
      }
      
      switch (message.type) {
        case 'conversation_initiation_metadata':
          console.log('   ✅ Conversation initialized');
          // Store conversation metadata if needed
          const metadata = message.conversation_initiation_metadata_event;
          console.log(`   Conversation ID: ${metadata?.conversation_id}`);
          console.log(`   Audio format: ${metadata?.agent_output_audio_format}`);
          break;
          
        case 'agent_response':
          // API v2 structure: message.agent_response_event.agent_response
          const agentEvent = message.agent_response_event;
          const agentText = agentEvent?.agent_response || message.text || '';
          console.log(`   Agent: ${agentText.slice(0, 50)}...`);
          if (agentText) {
            transcript.push({
              role: 'agent',
              text: agentText,
              timestamp: Date.now(),
            });
            onTranscript?.({ role: 'agent', text: agentText });
          }
          break;
          
        case 'user_transcript':
          // API v2 structure: message.user_transcription_event.user_transcript
          const userEvent = message.user_transcription_event;
          const userText = userEvent?.user_transcript || message.text || '';
          if (userText) {
            console.log(`   User: ${userText.slice(0, 50)}...`);
            transcript.push({
              role: 'user',
              text: userText,
              timestamp: Date.now(),
            });
            onTranscript?.({ role: 'user', text: userText });
          }
          break;
          
        case 'audio':
          // API v2 structure: message.audio_event.audio_base_64
          const audioEvent = message.audio_event;
          const audioData = audioEvent?.audio_base_64 || message.audio || message.data;
          if (audioData && onAudioReceived) {
            onAudioReceived(audioData);
          }
          console.log(`   🔊 Audio chunk received`);
          break;
          
        case 'ping':
          // Eleven Labs ping - respond with ping_response according to their API
          if (ws.readyState === WebSocket.OPEN) {
            const pingEvent = message.ping_event;
            ws.send(JSON.stringify({ 
              type: 'pong',
              event_id: pingEvent?.event_id 
            }));
          }
          break;
          
        case 'conversation_ended':
          console.log('📞 Conversation ended');
          // Extract summary from final messages
          const summary = extractSummary(transcript);
          onComplete?.({
            summary,
            transcript,
            duration: calculateDuration(transcript),
          });
          break;
          
        default:
          console.log(`   (unhandled type: ${message.type})`);
      }
    } catch (error) {
      console.error('Error parsing Eleven Labs message:', error);
    }
  });

  ws.on('close', (code, reason) => {
    console.log(`🔌 Disconnected from Eleven Labs (code: ${code}, reason: ${reason || 'none'})`);
    activeWebSocket = null;
  });

  ws.on('error', (error) => {
    console.error('❌ Eleven Labs WebSocket error:', error.message);
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
      },
      (audioData) => {
        // Send audio to renderer for playback
        event.sender.send('voice-audio', { callId, audio: audioData });
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
    // Send user audio to Eleven Labs WebSocket
    // Format per Eleven Labs API: user_audio_chunk with base64 audio
    if (activeWebSocket && activeWebSocket.readyState === WebSocket.OPEN) {
      activeWebSocket.send(JSON.stringify({
        user_audio_chunk: audioData
      }));
    }
  });
}

module.exports = {
  startVoiceSession,
  registerVoiceHandlers,
};
