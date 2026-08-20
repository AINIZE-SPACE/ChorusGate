# ChorusGate

[English](./README.md)

ChorusGate 是一个 local-first 的协作 channel gateway，用来把 coding agents 接入 Slack、飞书/Lark 等工作频道。
它最初是 Claude Code + Slack 桥接器，现在范围扩展为 Slack、飞书规划、Claude Code、Codex 和更多 agent runtime 的通用网关。

在 Slack 里 @mention 机器人或发 DM，ChorusGate 会把消息路由给配置的 agent runtime 并回帖。同时提供 MCP server，让 agent runtime 能主动读写频道上下文。

**特点：**

- **Local-first**：运行在自己的机器或私有服务器，token 不出本地
- **Channel-oriented**：Slack 已支持，飞书/Lark 在规划中
- **Agent-oriented**：Claude Code 已支持，Codex 和更多 runtime 在范围内
- **持久上下文**：每个频道/DM 可绑定一个长期 agent session

---

## 快速开始

### 前置要求

- Node.js >= 18
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)（`claude -p "say hi"` 能跑通）
- Slack workspace 管理员权限（创建 app 用）

### 1. 创建 Slack App

1. 打开 <https://api.slack.com/apps> → **Create New App** → **From a manifest**
2. 选择你的 workspace
3. 粘贴项目根目录的 [`manifest.json`](./manifest.json)?CC app?? [`manifest.cx.json`](./manifest.cx.json)?CX app? 内容
4. 点 **Create** → **Install to Workspace** → **Allow**

### 2. 获取 Token

- **OAuth & Permissions** → 复制 **Bot User OAuth Token**（`xoxb-…`）
- **Basic Information** → **App-Level Tokens** → **Generate Token and Scopes**
  - 名字随意（如 `socket`），scope 选 `connections:write`，生成
  - 复制 App-Level Token（`xapp-…`）

### 3. 配置 .env

Agent 配置从 `~/.chorusgate/<agent-id>/.env` 加载；`chorusgate run` 使用
`default` profile，Shell 环境变量仍具有最高优先级。每个 agent（包括
`default`）的进程级文件都归自己的 home 目录，因此任何地方省略 `--agent`
都等价于 `--agent default`（即 `~/.chorusgate/default/`）。

#### Agent profile 与状态归属

ChorusGate agent 是**跨项目**的进程，生命周期不该依赖 shell 的当前工作目录
或环境变量选出的项目目录。每个 agent 拥有一个隔离的 home：

```text
~/.chorusgate/<agent-id>/
├── .env          # 进程配置
├── gateway.pid   # 守护进程标识
├── gateway.log   # 进程输出
├── status.json   # 运行状态
└── ...           # 锁、session 等进程级状态
```

所有进程级配置和输出都只属于该目录。控制命令（`run`/`start`/`stop`/
`restart`/`status`/`list`）必须先解析出 agent，再只读写该 agent 的文件。
agent 缺失时如实报「缺失或已停止」，不能静默回退到 `default` profile、
当前目录或另一个正在运行的进程。

项目本地的 `.gateway/` 目录职责更窄：只放**当前项目 + 对应 agent** 的
元数据或状态。它不是跨项目守护进程的家，不能决定也不该存放守护进程的
PID、全局状态、日志、锁或其他进程级输出。

> **为什么这样拆分？** 旧布局里 PID、状态快照和日志混在共享的
> `cwd/.gateway/`。`status --agent codex` 和 `status --agent claude` 读到
> 的是同一批文件、输出完全相同，而且同一目录同时只能跑一个 agent。
> 收归到 agent home 后，每个 agent 才是真正跨项目的进程，拥有独立的
> PID、运行时长和会话列表。

首次使用可从当前项目旧 `.env` 自动初始化：

```powershell
chorusgate run --agent claude --init
chorusgate config init --agent codex --from E:\project\.env --cwd E:\project
```

若 profile 不存在，ChorusGate 会列出已有 Agent 供检查拼写；交互终端询问是否初始化，
非交互环境给出等价的 `--init` 命令并正常退出。没有旧 `.env` 时会自动创建目录和
不含秘密值的 starter 文件。

连接 Slack 前还会检查对应的 `claude` / `codex` CLI。未安装时会提示安装平台，
也可通过 `CLAUDE_BIN` / `CODEX_BIN` 指定可执行文件。

profile 至少需要：

```env
SLACK_BOT_TOKEN=xoxb-你的-bot-token
SLACK_APP_TOKEN=xapp-你的-app-token
```

### 4. 安装依赖

```bash
npm install
npm link
```

> :warning: **不要跳过 `npm link`。** `npm install` 不会把 `chorusgate` 和 `chorusgate-mcp` 注册到 PATH。后面如果报 `command not found`，先回来跑 `npm link`。

### 5. 验证 Claude CLI

在**你自己的终端**（非沙箱）运行：

```bash
claude -p "say pong" --output-format text
```

输出 "pong" 说明 CLI 正常。Gateway 依赖这个环境，如果这里挂了，gateway 也无法生成回复。

### 6. 启动 Gateway

**前台模式**（首次调试推荐）：

```bash
npm run gateway        # 或 chorusgate run
```

**后台守护进程**（日常使用）：

```bash
chorusgate start --agent codex     # 后台启动 codex
chorusgate status --agent codex    # 只显示 codex 的 pid、运行时长、session
chorusgate stop --agent codex      # 只停止 codex
chorusgate restart --agent codex   # 只重启 codex
chorusgate list --agent codex      # 只列出 codex 的 channel→session 映射
```

省略 `--agent` 等价于 `--agent default`。不同 agent 可以同时运行，且必须
报告各自独立的 PID 和运行状态。`npm run …` 别名规则相同。日志写
`~/.chorusgate/<agent-id>/gateway.log`。

### 7. 在 Slack 里使用

把机器人加入频道（`/invite @ChorusGate`），然后 @mention 它，或者直接发 DM。

---

## 两种运行模式

| 模式 | 文件 | 适合场景 |
|------|------|---------|
| **Gateway 守护进程** | `src/gateway.ts` | 自动回复，常驻后台，无需人工干预 |
| **MCP Server** | `src/index.ts` | agent runtime 主动调用 Slack 工具 |

> **不能同时建两个 Socket Mode 连接。** Slack 把事件负载均衡到同一 app 的所有连接，两个连接 = 事件分流丢失。
>
> 现在 `chorusgate-mcp` 固定只提供 Web API 工具，不再建立 Socket Mode。Gateway 负责收事件，agent runtime 可直接复用同一份 `.claude/mcp.json`。

---

## MCP Server 模式

在项目根创建 `.claude/mcp.json`（复用 `.claude` 体系，无需在根目录额外建 `mcp.json`）。可从 `.claude/mcp.json.example` 复制：

```json
{
  "mcpServers": {
    "chorusgate": {
      "command": "chorusgate-mcp",
      "args": []
    }
  }
}
```

同一份配置既可单独使用，也可与 gateway 共存，因为 `chorusgate-mcp` 已不再建立 Socket Mode。

可用的 MCP tools：`slack_reply` / `slack_send_message` / `slack_add_reaction` / `slack_channel_history` / `slack_thread_replies` / `slack_list_channels` / `slack_get_user_info`

---

## Slash Commands

在 Slack 里直接控制 session：

| 命令 | 说明 |
|------|------|
| `/cc_sessions` | 列出所有已知 session |
| `/cc_resume N` 或 `/cc_resume <uuid>` | 切换当前频道绑定的 session |
| `/cc_new` | 重置 session（下条消息开新对话）|
| `/cc_current` | 显示当前绑定的 session |
| `/cchelp` | 帮助 |

> 在 DM 里使用 slash command，需要在 Slack App 管理页 **App Home** 里勾选 "Allow users to send Slash commands and messages from the messages tab"。

---

## 环境变量

> **放哪里：** 进程级 Gateway 参数放 `~/.chorusgate/<agent-id>/.env`。
> 不再隐式从 `~/.gateway/.env`、项目 `.env`、当前工作目录或项目本地
> `.gateway/.env` 加载。
> 只有 `SLACK_BOT_TOKEN` 和 `SLACK_APP_TOKEN` 可能也出现在 `.claude/mcp.json` 的 `env` 块中（给 MCP server 用）。
> Shell 环境变量始终优先。

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GATEWAY_MAX_CONCURRENT` | `3` | 最大并发 claude 进程数 |
| `GATEWAY_REPLY_TIMEOUT_MS` | `180000` | 单条回复超时（ms）|
| `GATEWAY_REPLY_TIMEOUT_MS_LONG` | `360000` | 续轮会话回复超时（ms）|
| `GATEWAY_SESSION_SCOPE` | `channel` | `channel`（频道共享）或 `thread`（每条线程独立）|
| `GATEWAY_SESSION_IDLE_MS` | `86400000` | session 映射 idle 多久后清理（ms）|
| `GATEWAY_PROGRESS` | `1` | 设为 `0` 关闭进度提示消息 |
| `GATEWAY_PROGRESS_MODE` | `hybrid` | 进度模式 (#129): `hybrid`（edit 占位 + append 工具调用结果为新消息）, `append`（全部进度作为新消息）, `edit`（旧行为，全部 `chat.update`）|
| `GATEWAY_PROGRESS_MAX_MESSAGES` | `5` | 中间结果消息最大条数，超过后不再 append (#129) |
| `GATEWAY_THREAD_SMART_REPLY` | `1` | 智能线程回复 (#128): 设为 `0` 关闭对 thread 中未 mention 消息的多级判断 |
| `GATEWAY_LLM_REPLY_JUDGE` | 不设 | LLM 预判开关 (#128 Level 4): 设为 `1` 时调用 `claude -p` 做轻量 yes/no 判断 |
| `GATEWAY_PROFILE_TRIGGERS_<ID>` | 不设 | Per-profile 触发词 (#128 Level 3 名称匹配)。格式 `displayName,alias1,alias2`。例: `GATEWAY_PROFILE_TRIGGERS_CC=小克,CC,claude` |
| `GATEWAY_CLAUDE_CWD` | 项目根 | spawned runtime 的工作目录 |
| `GATEWAY_CLAUDE_MODE` | `legacy` | Claude 模式: `legacy` (单向) 或 `stream` (双向 stream-json) |
| `GATEWAY_BUSY_MODE` | `interrupt` | 用户连续发消息时的处理: `interrupt` (打断) 或 `queue` (排队) |
| `GATEWAY_INTERACTIVE_PERMISSIONS` | — | 设为 `1` 开启审批按钮 (需 `CLAUDE_PERMISSION_MODE` ≠ `bypassPermissions`) |
| `CLAUDE_BIN` | `claude` | claude CLI 路径 |
| `CODEX_BIN` | `codex` | codex CLI 路径 |
| `CLAUDE_PERMISSION_MODE` | `bypassPermissions` | headless 模式权限策略 |
| `GATEWAY_PROFILES` | — | 多 Slack App 列表: `cc,codex`（不设则为单 `default` profile） |
| `GATEWAY_PROVIDER_<ID>` | `claude` | 指定 profile 的 agent runtime |
| `GATEWAY_CWD_<ID>` | — | 指定 profile 的工作目录 |
| `GATEWAY_COMMAND_PREFIX_<ID>` | — | 指定 profile 的 slash 命令前缀 |
| `SLACK_BOT_TOKEN_<ID>` | — | 指定 profile 的 Bot Token |
| `SLACK_APP_TOKEN_<ID>` | — | 指定 profile 的 App Token |

---

## 多 Agent 并行

可以在同一台机器同时跑多个 agent（例如 CC 网关 + Codex 网关）。

**关键要求**：
1. 每个 agent 独立 Slack App（独立 token）
2. 每个 agent 的进程级文件（pid/status/log）在各自的
   `~/.chorusgate/<agent-id>/` 下，互不干扰；`start/status/stop/restart/list`
   都要带 `--agent`
3. 项目级状态（`memory/sessions.md`）按项目目录独立
4. Codex 工作目录由 `GATEWAY_CWD_CODEX` 或 `GATEWAY_CLAUDE_CWD` 决定

**Codex 多 profile 示例** `.env`：
```env
# Codex profile 的独立 env
GATEWAY_PROVIDER=codex
GATEWAY_COMMAND_PREFIX=cx
CODEX_BIN=codex
SLACK_BOT_TOKEN=xoxb-codex-...
SLACK_APP_TOKEN=xapp-codex-...
```

## Gateway 与 Provider 身份分离

Gateway 是代理层，不设人设。身份（小克/小扣）由 Provider 决定：

| Provider | 人设文件 | Session 存储 |
|----------|---------|-------------|
| Claude Code | `CLAUDE.md` + `~/.claude/CLAUDE.md` | `~/.claude/projects/<hash>/` |
| Codex | `AGENTS.md` + `.agents/` + `.codex/config.toml` | `~/.codex/sessions/` |

Gateway 只存路由 meta (`memory/sessions.md`)，不存对话内容。

---

## 常见问题

**事件丢失，机器人时而收不到消息**

同一 Slack app 只能有一个 Socket Mode 连接。多个连接会导致 Slack 分流事件。确保只有 gateway 建 Socket Mode 连接；`chorusgate-mcp` 已不再建第二条连接。

**Slash command 在 DM 里不工作**

Slack App 管理页 → App Home → 勾选 "Allow users to send Slash commands and messages from the messages tab"，重装 app。

**Windows 下 `claude -p` 报 exit code 3221225794**

`STATUS_DLL_INIT_FAILED`，同时创建了太多进程。调低 `GATEWAY_MAX_CONCURRENT`，或检查是否有空消息触发 spawn 风暴。

**占位消息卡在"发送中…" / 续轮超时 180s**

续轮会话使用 `GATEWAY_REPLY_TIMEOUT_MS_LONG`（默认 360s）。长任务超时就调大它。占位消息卡住的话重启 gateway —— 最新代码已修复进度队列排空顺序。

**`chorusgate: command not found`**

`npm install` 不会注册全局命令 — 跑一次 `npm link` 把 `chorusgate` 和 `chorusgate-mcp` 挂到 PATH。

更多见 [`docs/gotchas.md`](./docs/gotchas.md)。

---

## 文档

- [`INSTALL.md`](./INSTALL.md) — 详细安装向导
- [`docs/architecture.md`](./docs/architecture.md) — 架构总览
- [`docs/`](./docs/README.md) — 完整文档索引（含规划特性）

---

## License

MIT
