# Slack Socket Mode MCP Server

Real-time Slack event bridge for Claude Code via Socket Mode.

> **New here? See [INSTALL.md](./INSTALL.md)** — create the Slack app from the
> bundled [`manifest.json`](./manifest.json) in a few clicks, then run the gateway.

This project has **two modes**:

1. **MCP server** (`src/index.ts`) — a passive tool that Claude Code calls.
   Claude Code receives events in real time and you decide when to read/reply
   from a terminal session.
2. **Auto-reply gateway** (`src/gateway.ts`) — a standing daemon that drives
   itself: it listens on Socket Mode and **automatically replies** to @mentions
   and DMs by spawning `claude -p`. This is the Hermes-style fully-automatic bot.
   Each Slack thread reuses a persistent Claude session, so the bot remembers
   the thread's earlier messages across replies.

> **Pick one at a time.** Slack load-balances each event to exactly ONE open
> Socket Mode connection for the app. If the MCP server (in Claude Code) and the
> gateway are both connected, events scatter between them. To run the gateway,
> first disable the MCP server — remove/comment the `slack-socket` entry in
> `.mcp.json` (or stop that Claude Code session).
>
> **Exception — coexist via sender-only mode.** If you want the gateway to own
> event receiving AND keep Claude Code able to *proactively* send/read Slack,
> run the MCP server with `MCP_SENDER_ONLY=1`. In that mode the MCP server skips
> Socket Mode entirely (no competing connection) but its send/reply/history/
> react tools still work over the Web API. `slack_check_events` returns empty in
> this mode — events live on the gateway's connection.

## Auto-reply gateway

```bash
# 1. Verify headless claude works in YOUR terminal (not a sandbox):
claude -p "say pong" --output-format text      # should print "pong" in seconds

# 2. Start the daemon:
slack-gateway start          # background daemon (recommended)
#   or: npm run gateway      # foreground (blocks the terminal)
# → "[gateway] listening — will auto-reply to @mentions and DMs."

# 3. In Slack, @mention the bot or DM it → it replies automatically.
```

Daemon control commands (see also INSTALL.md):

| Command | Action |
|---------|--------|
| `slack-gateway run` | run in foreground (blocks) |
| `slack-gateway start` | start as a background daemon |
| `slack-gateway stop` | stop the daemon |
| `slack-gateway restart` | restart the daemon |
| `slack-gateway status` | running? pid, uptime, active sessions |
| `slack-gateway list` | active thread→session mappings |

(`npm run start|stop|restart|status|list` are aliases. Logs: `.gateway/gateway.log`.)

Behavior:
- Replies to **@mentions** (any channel) and **DMs** (`channel_type: im`).
- Ignores plain channel chatter not addressed to the bot, and reactions.
- Each reply spawns `claude -p` with a **sender-only Slack MCP** config, so it
  has the Slack tools (read history, post, react — all Web API) but does NOT
  open a second Socket Mode connection.
- Each Slack thread reuses a persistent Claude session (`--session-id` first
  turn, `--resume` after), so the bot remembers the thread's earlier messages.
- Same-thread turns run serially; different threads run in parallel up to
  `GATEWAY_MAX_CONCURRENT`.
- First token can take seconds to tens of seconds per reply (same as Hermes).

Env knobs (optional, in `.env`):
- `CLAUDE_BIN` — path to the claude CLI (default: `claude` on PATH)
- `GATEWAY_CLAUDE_CWD` — working dir for the spawned claude (default: project root)
- `GATEWAY_REPLY_TIMEOUT_MS` — per-reply timeout (default: 180000)
- `GATEWAY_MAX_CONCURRENT` — max simultaneous `claude -p` replies (default: 3).
  Extra events queue and run as slots free up — prevents a spawn storm when
  several people @mention at once.
- `GATEWAY_SESSION_IDLE_MS` — idle time before a thread's session mapping is
  evicted (default: 86400000 = 24h). The on-disk Claude session is unaffected;
  eviction only forgets the thread→UUID map entry to bound memory.

> The gateway must run in your **native terminal** where `claude` already works.
> A sandboxed shell may fail to reach the configured `ANTHROPIC_BASE_URL`.

## How It Works (MCP mode)

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
  - `reactions:read` — receive reaction_added events
  - `users:read` — get user info
  - `app_mentions:read` — receive @mention events
- **Event Subscriptions → Subscribe to bot events** must include:
  `app_mention`, `message.channels`, `message.im`, `reaction_added`.
  (Adding an event ≠ adding a scope — you need both, then reinstall the app.)

### 2. Install & link the executable

The server is exposed as a `bin` command so the MCP config needs no absolute
paths and does not depend on the launcher's working directory.

```bash
npm install
npm link        # registers the global `slack-socket-mcp` command
```

### 3. Provide tokens via `.env`

Create `.env` in the project root (already gitignored). The server loads it
relative to its own location, so cwd does not matter:

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
```

### 4. Configure `.claude/mcp.json`

```json
{
  "mcpServers": {
    "slack-socket": {
      "command": "slack-socket-mcp",
      "args": [],
      "env": {
        "SLACK_BOT_TOKEN": "${SLACK_BOT_TOKEN}",
        "SLACK_APP_TOKEN": "${SLACK_APP_TOKEN}"
      }
    }
  }
}
```

> **Windows fallback:** if the launcher cannot resolve the bare command to the
> `.cmd` shim, use `"command": "cmd"`, `"args": ["/c", "slack-socket-mcp"]`.

### 5. Restart Claude Code

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

## Diagnostics

`scripts/` holds standalone probes that read tokens from `.env` (no secrets on
the command line):

```bash
node scripts/check-scopes.mjs    # report granted bot OAuth scopes
node scripts/socket-probe.mjs    # connect & log EVERY incoming frame (catch-all)
node scripts/post-test.mjs       # post a test mention to #aifitness
```

## Troubleshooting — "events never arrive"

The pipeline can be connected (`Socket Mode connected`, `listening for events`)
yet deliver nothing. The three real causes we hit, in order of likelihood:

1. **Config in the wrong file.** Claude Code reads project MCP servers from
   `.mcp.json` at the **project root** — NOT `.claude/mcp.json`. If `/mcp` says
   "No MCP servers configured", the file is in the wrong place.

2. **Multiple Socket Mode connections competing.** Slack load-balances each
   event to exactly ONE open connection for the app. The `hello` frame reports
   `num_connections` — if it's > 1 (stray test processes, zombie sockets that
   Slack hasn't reaped yet, or a second launcher), events scatter and most are
   lost. Kill all stray node processes; Slack reaps dropped sockets after the
   ping timeout (~30–60s). In normal use Claude Code is the only connection.

3. **Subscription/scope gaps (per event type).** OAuth scope ≠ event
   subscription — both are needed. `reaction_added` additionally requires the
   `reactions:read` scope. After adding events/scopes in *Event Subscriptions*,
   **reinstall the app** to the workspace or the change won't take effect.
