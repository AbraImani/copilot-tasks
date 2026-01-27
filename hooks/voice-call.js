#!/usr/bin/env node
/**
 * Copilot CLI Hook: Voice Call for ask_user
 * 
 * This hook intercepts ask_user tool calls and offers the user a voice call
 * to answer instead of typing. If the user denies the call or the service
 * isn't running, it falls back to the normal ask_user behavior.
 * 
 * Usage:
 *   1. Copy hooks/ folder to your repository's .github/hooks/
 *   2. Start the Copilot Tasks app
 *   3. Run Copilot CLI - ask_user calls will trigger voice calls
 */

const VOICE_CALL_API_URL = 'http://127.0.0.1:19741';

// Log to stderr so it doesn't interfere with JSON output
function log(message) {
  console.error(`[voice-call-hook] ${message}`);
}

/**
 * Read JSON input from stdin
 */
async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const input = Buffer.concat(chunks).toString('utf-8');
  return JSON.parse(input);
}

/**
 * Check if the voice call service is running
 */
async function isServiceRunning() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    
    const response = await fetch(`${VOICE_CALL_API_URL}/api/status`, {
      signal: controller.signal,
    });
    
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Make a voice call and wait for the result
 */
async function makeVoiceCall(topic, context, questions) {
  const callId = `hook-${Date.now()}`;
  
  const response = await fetch(`${VOICE_CALL_API_URL}/api/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      callId,
      topic,
      context,
      questions,
    }),
  });
  
  if (!response.ok) {
    throw new Error(`Voice call API error: ${response.status}`);
  }
  
  return response.json();
}

/**
 * Build voice call parameters from ask_user tool args
 */
function buildCallParams(toolArgs) {
  const question = toolArgs.question || 'The agent has a question for you';
  const choices = toolArgs.choices || [];
  
  // Build context from the question and choices
  let context = `The coding agent needs your input.\n\nQuestion: ${question}`;
  
  if (choices.length > 0) {
    context += `\n\nAvailable options:\n${choices.map((c, i) => `${i + 1}. ${c}`).join('\n')}`;
  }
  
  // The questions array for the voice agent
  const questions = [question];
  
  // Topic is a short version of the question
  const topic = question.length > 50 ? question.slice(0, 47) + '...' : question;
  
  return { topic, context, questions };
}

/**
 * Main hook logic
 */
async function main() {
  try {
    const input = await readInput();
    
    log(`Received tool call: ${input.toolName}`);
    
    // Only intercept ask_user calls
    if (input.toolName !== 'ask_user') {
      // Allow other tools to proceed normally
      console.log(JSON.stringify({ permissionDecision: 'allow' }));
      return;
    }
    
    log('Intercepted ask_user call');
    log(`Tool args: ${JSON.stringify(input.toolArgs)}`);
    
    // Check if voice service is running
    const serviceRunning = await isServiceRunning();
    if (!serviceRunning) {
      log('Voice service not running, falling back to text');
      console.log(JSON.stringify({ permissionDecision: 'allow' }));
      return;
    }
    
    log('Voice service is running, initiating call...');
    
    // Build call parameters from ask_user args
    const { topic, context, questions } = buildCallParams(input.toolArgs);
    
    // Make the voice call
    const result = await makeVoiceCall(topic, context, questions);
    
    log(`Call result status: ${result.status}`);
    
    if (result.status === 'denied') {
      // User denied the call, fall back to text ask_user
      log('User denied call, falling back to text');
      console.log(JSON.stringify({ permissionDecision: 'allow' }));
      return;
    }
    
    if (result.status === 'completed') {
      // Voice call completed - deny the ask_user and return the answer
      // The denial reason becomes the tool result that the agent sees
      const answer = result.summary || 'User provided answer via voice call';
      
      log(`Call completed with answer: ${answer}`);
      
      // Format the response so the agent understands this IS the answer
      // IMPORTANT: Start with clear indication this is the user's actual response
      const responseText = [
        '✅ USER ANSWERED VIA VOICE CALL',
        '',
        'The user has already provided their answer through a voice conversation.',
        'Do NOT ask this question again. Use the answer below:',
        '',
        '---',
        answer,
        '---',
        '',
        result.transcript && result.transcript.length > 0 
          ? `Full transcript:\n${result.transcript.map(t => `${t.role}: ${t.text}`).join('\n')}`
          : '',
      ].filter(Boolean).join('\n');
      
      log('Returning voice call answer to agent');
      console.log(JSON.stringify({
        permissionDecision: 'deny',
        permissionDecisionReason: responseText,
      }));
      return;
    }
    
    // Any other status, fall back to text
    log(`Unexpected status: ${result.status}, falling back to text`);
    console.log(JSON.stringify({ permissionDecision: 'allow' }));
    
  } catch (error) {
    // On any error, fall back to normal ask_user behavior
    log(`Error: ${error.message}`);
    console.log(JSON.stringify({ permissionDecision: 'allow' }));
  }
}

main();
