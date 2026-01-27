# Copilot Tasks

Voice call assistant for GitHub Copilot CLI - enables voice conversations between coding agents and users using Eleven Labs conversational AI.

## Features

- **Voice Calls**: Receive incoming call notifications from coding agents
- **Call Queue**: Manage multiple incoming calls when busy
- **Call History**: View past calls with transcripts and summaries
- **Eleven Labs Integration**: Natural voice conversations powered by Eleven Labs

## Requirements

- Node.js 18+
- Electron
- Eleven Labs API key with Conversational AI access

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Set environment variables:
   ```bash
   export ELEVEN_LABS_API_KEY=your_api_key
   export ELEVEN_LABS_AGENT_ID=your_agent_id
   ```

3. Run in development:
   ```bash
   npm run dev
   ```

## Configuration

The app runs an HTTP server on `localhost:19741` for communication with the CLI.

### Environment Variables

| Variable | Description |
|----------|-------------|
| `ELEVEN_LABS_API_KEY` | Your Eleven Labs API key |
| `ELEVEN_LABS_AGENT_ID` | Your Eleven Labs Conversational AI agent ID |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Health check and current status |
| `/api/call` | POST | Initiate a new voice call |
| `/api/queue` | GET | Get queued calls |
| `/api/history` | GET | Get call history |

## Building

Build installers for distribution:

```bash
# macOS
npm run build:installer:mac

# Windows
npm run build:installer:win
```

## License

MIT
