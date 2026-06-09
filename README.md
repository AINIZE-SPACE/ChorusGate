# Slack Socket Mode MCP Server

Real-time Slack event bridge for Claude Code via Socket Mode.

## How It Works

```
Slack WebSocket (Socket Mode)
    ↕ xapp- token
┌─────────────────────────────┐
│  Slack Socket Mode MCP Server│
│  - app_mention, message,     │
│    reaction_added events     │
│  - In-memory event queue     │
│  - MCP Resources + Tools     │
└──────────┬──────────────────┘
    ↕ stdio (JSON-RPC)
┌─────────────────────────────┐
│  Claude Code                │
│  - Subscribe to events       │
│  - Auto-reply via tools      │
└─────────────────────────────┘
```

## Setup

### 1. Prerequisites

- Slack App with **Socket Mode** enabled
- **App Token** (`xapp-...`) with `connections:write` scope
- **Bot Token** (`xoxb-...`) with required scopes:
  - `chat:write` — send messages
  - `channels:history` — read channel messages
  - `channels:read` — list channels
  - `groups:history` — read private channel messages
  - `groups:read` — list private channels
  - `reactions:write` — add reactions
  - `users:read` — get user info
  - `app_mentions:read` — receive @mention events

### 2. Configure

Edit `.claude/mcp.json` with your actual tokens:

```json
{
  "mcpServers": {
    "slack-socket": {
      "command": "npx",
      "args": ["tsx", "E:/my_project/slack4ccmcp/src/index.ts"],
      "env": {
        "SLACK_BOT_TOKEN": "xoxb-your-bot-token",
        "SLACK_APP_TOKEN": "xapp-your-app-token"
      }
    }
  }
}
```

### 3. Restart Claude Code

The MCP server starts automatically when Claude Code launches.

## MCP Resources

| URI | Description |
|-----|-------------|
| `slack://events/stream` | Real-time event stream (subscribe for notifications) |
| `slack://events/pending` | Unhandled events awaiting response |

## MCP Tools

| Tool | Description |
|------|-------------|
| `slack_check_events` | Get pending/unhandled Slack events |
| `slack_reply` | Reply to a message in its thread |
| `slack_send_message` | Send a message to a channel |
| `slack_add_reaction` | Add an emoji reaction to a message |
| `slack_channel_history` | Get recent messages from a channel |
| `slack_thread_replies` | Get all replies in a thread |
| `slack_list_channels` | List channels the bot is in |
| `slack_get_user_info` | Get user profile by ID |

## Development

```bash
npm install
npm run dev        # Start with watch mode
npm run start      # Start once
npx tsc --noEmit   # Type check
```
