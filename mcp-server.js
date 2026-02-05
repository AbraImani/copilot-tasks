#!/usr/bin/env node
/**
 * MCP Server for Copilot Tasks Voice Calls
 * 
 * Exposes the voice call service as an MCP tool for the GitHub Copilot CLI.
 * Fails fast (3s timeout) if the service isn't running.
 */

const VOICE_CALL_API_URL = 'http://127.0.0.1:19741';
const CONNECTION_TIMEOUT_MS = 3000;

/**
 * Check if voice service is reachable (with fast timeout)
 */
async function checkService() {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONNECTION_TIMEOUT_MS);
  
  try {
    const response = await fetch(`${VOICE_CALL_API_URL}/api/status`, {
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
}

/**
 * Make a voice call and wait for the result
 */
async function makeVoiceCall(topic, context, questions) {
  const callId = `mcp-${Date.now()}`;
  
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
 * MCP Protocol Implementation
 */
class MCPServer {
  constructor() {
    this.buffer = '';
  }

  async start() {
    process.stdin.setEncoding('utf8');
    
    process.stdin.on('data', (chunk) => {
      this.buffer += chunk;
      this.processBuffer();
    });

    process.stdin.on('end', () => {
      process.exit(0);
    });
  }

  processBuffer() {
    const lines = this.buffer.split('\n');
    this.buffer = lines.pop() || '';
    
    for (const line of lines) {
      if (line.trim()) {
        this.handleMessage(line.trim());
      }
    }
  }

  async handleMessage(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }

    const { id, method, params } = message;

    try {
      let result;
      
      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: '2024-11-05',
            capabilities: { tools: {} },
            serverInfo: {
              name: 'copilot-tasks-voice',
              version: '1.0.0',
            },
          };
          break;

        case 'notifications/initialized':
          // No response needed for notifications
          return;

        case 'tools/list':
          result = {
            tools: [
              {
                name: 'voice_call',
                description: 'Initiate a voice call with the user to discuss a topic or ask questions. The call will ring on their desktop and they can accept or decline. Use this when you need interactive discussion or the question is complex. Fails quickly if the voice service is not running.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    topic: {
                      type: 'string',
                      description: 'Short topic/title for the call (shown in the call UI)',
                    },
                    context: {
                      type: 'string', 
                      description: 'Background context to help the voice agent understand the situation',
                    },
                    questions: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Specific questions to ask the user during the call',
                    },
                  },
                  required: ['topic'],
                },
              },
            ],
          };
          break;

        case 'tools/call':
          result = await this.handleToolCall(params);
          break;

        default:
          this.sendError(id, -32601, `Method not found: ${method}`);
          return;
      }

      this.sendResult(id, result);
    } catch (error) {
      this.sendError(id, -32000, error.message);
    }
  }

  async handleToolCall(params) {
    const { name, arguments: args } = params;

    if (name !== 'voice_call') {
      throw new Error(`Unknown tool: ${name}`);
    }

    // Fast-fail check: is the service running?
    const serviceUp = await checkService();
    if (!serviceUp) {
      return {
        content: [
          {
            type: 'text',
            text: 'Voice call service is not running. The Copilot Tasks app needs to be started first. Falling back to normal interaction.',
          },
        ],
        isError: true,
      };
    }

    const topic = args.topic || 'Copilot needs your input';
    const context = args.context || '';
    const questions = args.questions || [];

    try {
      const result = await makeVoiceCall(topic, context, questions);

      if (result.status === 'denied') {
        return {
          content: [
            {
              type: 'text',
              text: 'User declined the voice call. Please ask your question via text instead.',
            },
          ],
        };
      }

      if (result.status === 'completed') {
        const answer = result.summary || 'Call completed without summary';
        const transcript = result.transcript && result.transcript.length > 0
          ? `\n\nFull transcript:\n${result.transcript.map(t => `${t.role}: ${t.text}`).join('\n')}`
          : '';

        return {
          content: [
            {
              type: 'text',
              text: `Voice call completed.\n\nUser's response:\n${answer}${transcript}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: `Voice call ended with status: ${result.status}`,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Voice call failed: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  sendResult(id, result) {
    const response = {
      jsonrpc: '2.0',
      id,
      result,
    };
    console.log(JSON.stringify(response));
  }

  sendError(id, code, message) {
    const response = {
      jsonrpc: '2.0',
      id,
      error: { code, message },
    };
    console.log(JSON.stringify(response));
  }
}

const server = new MCPServer();
server.start();
