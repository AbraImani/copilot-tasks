# Copilot Tasks

Voice call assistant for GitHub Copilot CLI - enables voice conversations between coding agents and users using Eleven Labs conversational AI.

## Features

- **Voice Calls**: Receive incoming call notifications from coding agents
- **Call Queue**: Manage multiple incoming calls when busy
- **Call History**: View past calls with transcripts and summaries
- **Eleven Labs Integration**: Natural voice conversations powered by Eleven Labs
- **CLI Hooks Integration**: Automatically intercept `ask_user` calls and offer voice alternative

## Requirements

- Node.js 18+
- Electron
- Eleven Labs API key with Conversational AI access

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env` file from example:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` with your Eleven Labs credentials:
   ```
   ELEVEN_LABS_API_KEY=your_api_key
   ELEVEN_LABS_AGENT_ID=your_agent_id
   ```

4. Run in development:
   ```bash
   npm run dev
   ```

## Copilot CLI Hooks Integration (Experimental)

> **⚠️ Limitation:** The hooks system is designed for permission control (allow/deny), not for replacing tool results with answers. When a hook denies `ask_user`, the agent sees it as a blocked action and may retry. For reliable voice call integration, use the built-in `voice_call` tool in Copilot CLI instead.

The hooks in this repository demonstrate how to intercept `ask_user` calls, but due to the limitation above, the recommended approach is to use the `voice_call` tool directly. The Copilot Tasks app provides the HTTP API that the `voice_call` tool communicates with.

### Setup Hooks (Experimental)

1. Copy the hooks folder to your repository's `.github/hooks/` directory:
   ```bash
   # From your repository root
   mkdir -p .github/hooks
   cp /path/to/copilot-tasks/hooks/voice-call-hook.json .github/hooks/
   cp /path/to/copilot-tasks/hooks/voice-call.js .github/hooks/
   ```

2. Make the script executable:
   ```bash
   chmod +x .github/hooks/voice-call.js
   ```

3. Commit the hooks to your repository's default branch:
   ```bash
   git add .github/hooks/
   git commit -m "Add voice call hook for Copilot CLI"
   git push
   ```

**Note:** Hooks must be present on the repository's default branch to be used by Copilot coding agent. For local CLI usage, hooks are loaded from your current working directory.

### How It Works

1. When Copilot CLI's agent calls `ask_user`, the hook intercepts it
2. If Copilot Tasks app is running, it triggers a voice call
3. You can **accept** the call and answer via voice
4. You can **deny** the call - falls back to normal text-based `ask_user`
5. If the app isn't running, it falls back to normal `ask_user`

### Known Limitation

When the voice call completes, the hook returns the answer as a "denial reason". However, the agent interprets this as a permission denial rather than a successful answer, which may cause it to retry the question. For production use, the `voice_call` tool provides proper integration.

### Eleven Labs Agent Configuration

Your Eleven Labs agent should be configured with a system prompt that uses these dynamic variables:
- `{call_context}` - Context about the coding task
- `{call_questions}` - Questions to answer
- `{response_format}` - Instructions for formatting the summary

Example agent prompt:
```
You are a voice assistant helping gather information for a coding task.

Context:
{call_context}

Questions to answer:
{call_questions}

{response_format}
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
