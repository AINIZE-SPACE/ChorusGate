# slack4ccmcp

**中文** | [English](#english)

把 Claude Code (`claude -p`) 接入 Slack 的自托管网关。在 Slack 里 @mention 机器人或发 DM，自动交给 Claude 处理并回复。同时提供 MCP server，让 Claude Code 终端主动读写 Slack。

**特点：**

- **零公网**：基于 Slack Socket Mode，WebSocket 向外连，无需公网 IP 或 ngrok
- **完整上下文**：每个频道/DM 绑定一个持久 Claude session，对话不中断
- **自托管**：Token 不出自己的机器

---

## 快速开始

### 前置要求

- Node.js >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)（`claude -p "say hi"` 能跑通）
- Slack workspace 管理员权限（创建 app 用）

### 1. 创建 Slack App

1. 打开 <https://api.slack.com/apps> → **Create New App** → **From a manifest**
2. 选择你的 workspace
3. 粘贴项目根目录的 [`manifest.json`](./manifest.json) 内容
4. 点 **Create** → **Install to Workspace** → **Allow**

### 2. 获取 Token

- **OAuth & Permissions** → 复制 **Bot User OAuth Token**（`xoxb-…`）
- **Basic Information** → **App-Level Tokens** → **Generate Token and Scopes**
  - 名字随意（如 `socket`），scope 选 `connections:write`，生成
  - 复制 App-Level Token（`xapp-…`）

### 3. 配置 .env

在项目根目录创建 `.env`（已 gitignore）：

```env
SLACK_BOT_TOKEN=xoxb-你的-bot-token
SLACK_APP_TOKEN=xapp-你的-app-token
```

### 4. 安装依赖

```bash
npm install
npm link      # 注册 slack-socket-mcp 和 slack-gateway 到 PATH
```

### 5. 验证 Claude CLI

在**你自己的终端**（非沙箱）运行：

```bash
claude -p "say pong" --output-format text
```

输出 "pong" 说明 CLI 正常。Gateway 依赖这个环境，如果这里挂了，gateway 也无法生成回复。

### 6. 启动 Gateway

**前台模式**（首次调试推荐）：

```bash
npm run gateway        # 或 slack-gateway run
```

**后台守护进程**（日常使用）：

```bash
slack-gateway start    # 后台启动
slack-gateway status   # 查看状态（pid、运行时长、活跃 session 数）
slack-gateway stop     # 停止
slack-gateway restart  # 重启
slack-gateway list     # 列出 channel→session 映射
```

`npm run start|stop|restart|status|list` 是对应别名。日志写 `.gateway/gateway.log`。

### 7. 在 Slack 里使用

把机器人加入频道（`/invite @ClaudeCodeApp`），然后 @mention 它，或者直接发 DM。

---

## 两种运行模式

| 模式 | 文件 | 适合场景 |
|------|------|---------|
| **Gateway 守护进程** | `src/gateway.ts` | 自动回复，常驻后台，无需人工干预 |
| **MCP Server** | `src/index.ts` | Claude Code 终端主动调用 Slack 工具 |

> **不能同时建两个 Socket Mode 连接。** Slack 把事件负载均衡到同一 app 的所有连接，两个连接 = 事件分流丢失。
> 
> 如果需要 Gateway 收事件 + Claude Code 终端也能发消息，在 `.mcp.json` 里给 MCP server 加 `"MCP_SENDER_ONLY": "1"`，它就只用 Web API，不建 WebSocket 连接。

---

## MCP Server 模式

在项目根创建 `.mcp.json`：

**单独使用（不跑 gateway）**：

```json
{
  "mcpServers": {
    "slack-socket": {
      "command": "slack-socket-mcp",
      "args": []
    }
  }
}
```

**与 gateway 共存**（必须加 `MCP_SENDER_ONLY=1`）：

```json
{
  "mcpServers": {
    "slack-socket": {
      "command": "slack-socket-mcp",
      "args": [],
      "env": { "MCP_SENDER_ONLY": "1" }
    }
  }
}
```

可用的 MCP tools：`slack_check_events` / `slack_reply` / `slack_send_message` / `slack_add_reaction` / `slack_channel_history` / `slack_thread_replies` / `slack_list_channels` / `slack_get_user_info`

---

## Slash Commands

在 Slack 里直接控制 session：

| 命令 | 说明 |
|------|------|
| `/sessions` | 列出所有已知 session |
| `/resume N` 或 `/resume <uuid>` | 切换当前频道绑定的 session |
| `/new` | 重置 session（下条消息开新对话）|
| `/current` | 显示当前绑定的 session |
| `/cchelp` | 帮助 |

> 在 DM 里使用 slash command，需要在 Slack App 管理页 **App Home** 里勾选 "Allow users to send Slash commands and messages from the messages tab"。

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GATEWAY_MAX_CONCURRENT` | `3` | 最大并发 claude 进程数 |
| `GATEWAY_REPLY_TIMEOUT_MS` | `180000` | 单条回复超时（ms）|
| `GATEWAY_SESSION_SCOPE` | `channel` | `channel`（频道共享）或 `thread`（每条线程独立）|
| `GATEWAY_SESSION_IDLE_MS` | `86400000` | session 映射 idle 多久后清理（ms）|
| `GATEWAY_PROGRESS` | `1` | 设为 `0` 关闭进度提示消息 |
| `GATEWAY_CLAUDE_CWD` | 项目根 | spawned claude 的工作目录 |
| `CLAUDE_BIN` | `claude` | claude CLI 路径 |
| `CLAUDE_PERMISSION_MODE` | `bypassPermissions` | headless 模式权限策略 |
| `MCP_SENDER_ONLY` | — | 设为 `1` 只保留 Web API 工具，不建 Socket Mode 连接 |

---

## 常见问题

**事件丢失，机器人时而收不到消息**

同一 Slack app 只能有一个 Socket Mode 连接。多个连接导致 Slack 分流事件。确保只有 gateway 建 Socket Mode 连接；MCP server 加 `MCP_SENDER_ONLY=1`。

**Slash command 在 DM 里不工作**

Slack App 管理页 → App Home → 勾选 "Allow users to send Slash commands and messages from the messages tab"，重装 app。

**Windows 下 `claude -p` 报 exit code 3221225794**

`STATUS_DLL_INIT_FAILED`，同时创建了太多进程。调低 `GATEWAY_MAX_CONCURRENT`，或检查是否有空消息触发 spawn 风暴。

更多见 [`docs/gotchas.md`](./docs/gotchas.md)。

---

## 文档

- [`INSTALL.md`](./INSTALL.md) — 详细安装向导
- [`docs/architecture.md`](./docs/architecture.md) — 架构总览
- [`docs/`](./docs/README.md) — 完整文档索引（含规划特性）

---

## License

MIT

---

---

<a name="english"></a>

# slack4ccmcp

[中文](#slack4ccmcp) | **English**

A self-hosted gateway that connects Claude Code (`claude -p`) to Slack. @mention the bot in a channel or send it a DM — it automatically routes to Claude and posts the reply back. Also ships an MCP server so Claude Code in your terminal can actively read and write Slack.

**Highlights:**

- **No public URL**: Uses Slack Socket Mode (outbound WebSocket), no ngrok or public IP required
- **Persistent context**: Each channel/DM binds to a long-lived Claude session — conversation continues across messages
- **Self-hosted**: Your tokens never leave your machine

---

## Quick Start

### Prerequisites

- Node.js >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) — verify with `claude -p "say hi"`
- Slack workspace admin access (to create an app)

### 1. Create the Slack App

1. Go to <https://api.slack.com/apps> → **Create New App** → **From a manifest**
2. Select your workspace
3. Paste the contents of [`manifest.json`](./manifest.json) from this repo
4. Click **Create** → **Install to Workspace** → **Allow**

### 2. Collect Tokens

- **OAuth & Permissions** → copy the **Bot User OAuth Token** (`xoxb-…`)
- **Basic Information** → **App-Level Tokens** → **Generate Token and Scopes**
  - Give it a name (e.g. `socket`), add scope `connections:write`, generate
  - Copy the App-Level Token (`xapp-…`)

### 3. Configure .env

Create `.env` in the project root (it's gitignored):

```env
SLACK_BOT_TOKEN=xoxb-your-bot-token
SLACK_APP_TOKEN=xapp-your-app-token
```

### 4. Install Dependencies

```bash
npm install
npm link      # registers slack-socket-mcp and slack-gateway on your PATH
```

### 5. Verify Claude CLI

Run this in **your own terminal** (not a sandbox):

```bash
claude -p "say pong" --output-format text
```

If it prints "pong", you're good. The gateway spawns `claude -p` and inherits this environment — if the CLI doesn't work here, it won't work in the gateway either.

### 6. Start the Gateway

**Foreground** (good for first run / debugging):

```bash
npm run gateway        # or: slack-gateway run
```

**Background daemon** (recommended for ongoing use):

```bash
slack-gateway start    # start in the background
slack-gateway status   # check status (pid, uptime, active sessions)
slack-gateway stop     # stop
slack-gateway restart  # restart
slack-gateway list     # list channel→session mappings
```

`npm run start|stop|restart|status|list` are aliases. Logs go to `.gateway/gateway.log`.

### 7. Use It in Slack

Invite the bot to a channel (`/invite @ClaudeCodeApp`), then @mention it or send it a DM. Replies are automatic.

---

## Two Modes

| Mode | Entry point | When to use |
|------|-------------|-------------|
| **Auto-reply gateway** | `src/gateway.ts` | Fully automatic replies, runs as a daemon |
| **MCP server** | `src/index.ts` | Claude Code terminal calls Slack tools on demand |

> **Only one Socket Mode connection at a time.** Slack load-balances each event to exactly one open connection per app — two connections means events get split and lost.
>
> To run the gateway for receiving AND keep Claude Code able to proactively send messages, add `"MCP_SENDER_ONLY": "1"` to the MCP server config. It skips Socket Mode and uses Web API only.

---

## MCP Server Mode

Create `.mcp.json` in your project root:

**Standalone (no gateway)**:

```json
{
  "mcpServers": {
    "slack-socket": {
      "command": "slack-socket-mcp",
      "args": []
    }
  }
}
```

**Alongside gateway** (must add `MCP_SENDER_ONLY=1`):

```json
{
  "mcpServers": {
    "slack-socket": {
      "command": "slack-socket-mcp",
      "args": [],
      "env": { "MCP_SENDER_ONLY": "1" }
    }
  }
}
```

Available MCP tools: `slack_check_events` / `slack_reply` / `slack_send_message` / `slack_add_reaction` / `slack_channel_history` / `slack_thread_replies` / `slack_list_channels` / `slack_get_user_info`

---

## Slash Commands

Control sessions directly from Slack:

| Command | Description |
|---------|-------------|
| `/sessions` | List all known sessions |
| `/resume N` or `/resume <uuid>` | Switch the current channel to a specific session |
| `/new` | Reset the current session (next message starts fresh) |
| `/current` | Show the currently bound session |
| `/cchelp` | Show help |

> To use slash commands in DMs: Slack App settings → **App Home** → enable "Allow users to send Slash commands and messages from the messages tab".

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GATEWAY_MAX_CONCURRENT` | `3` | Max simultaneous `claude -p` processes |
| `GATEWAY_REPLY_TIMEOUT_MS` | `180000` | Per-reply timeout (ms) |
| `GATEWAY_SESSION_SCOPE` | `channel` | `channel` (shared per channel) or `thread` (isolated per thread) |
| `GATEWAY_SESSION_IDLE_MS` | `86400000` | Idle time before a session mapping is evicted (ms) |
| `GATEWAY_PROGRESS` | `1` | Set to `0` to disable live progress messages |
| `GATEWAY_CLAUDE_CWD` | project root | Working directory for spawned claude processes |
| `CLAUDE_BIN` | `claude` | Path to the Claude CLI binary |
| `CLAUDE_PERMISSION_MODE` | `bypassPermissions` | Permission mode for headless claude |
| `MCP_SENDER_ONLY` | — | Set to `1` to use Web API tools only, no Socket Mode connection |

---

## Troubleshooting

**Bot randomly misses messages**

Only one Socket Mode connection per app is allowed. Multiple connections split events. Make sure only the gateway opens a Socket Mode connection; add `MCP_SENDER_ONLY=1` to the MCP server config.

**Slash commands don't work in DMs**

Slack App settings → **App Home** → check "Allow users to send Slash commands and messages from the messages tab", then reinstall the app.

**Windows: `claude -p` exits with code 3221225794**

`STATUS_DLL_INIT_FAILED` — too many processes spawned at once. Lower `GATEWAY_MAX_CONCURRENT`, or check that empty messages aren't bypassing the `shouldReply` filter.

More in [`docs/gotchas.md`](./docs/gotchas.md).

---

## Documentation

- [`INSTALL.md`](./INSTALL.md) — Detailed installation guide
- [`docs/architecture.md`](./docs/architecture.md) — Architecture overview
- [`docs/`](./docs/README.md) — Full documentation index (including planned features)

---

## License

MIT
