# slack4ccmcp — 架构总览

> 维护入口。读完这篇，再去看具体 feature 文档。

---

## 一句话定位

把 Claude Code (`claude -p`) 接入 Slack：Slack 里的消息 → gateway 转给 claude -p → 回复发回 Slack。  
同时提供一个 MCP server，让 Claude Code 终端也能主动读写 Slack。

---

## 两种运行模式

```
┌──────────────────────────────────────────────┐
│  模式 A：MCP server（src/index.ts）           │
│  Claude Code 主动调用，被动接收事件            │
│  bin: slack-socket-mcp                        │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│  模式 B：Gateway 守护进程（src/gateway.ts）   │
│  常驻，自动回复 @mention 和 DM               │
│  bin: slack-gateway                           │
└──────────────────────────────────────────────┘
```

**两种模式不能同时开 Socket Mode 连接**——Slack 把事件负载均衡到同一 app 的所有连接，多连接 = 事件分流丢失。  
共存方式：gateway 开 Socket Mode；MCP server 设 `MCP_SENDER_ONLY=1`，只保留 Web API 工具（读/发消息），不建 WebSocket 连接。

---

## 核心数据流（Gateway 模式）

```
Slack 用户发消息
      │
      ▼ WebSocket (Socket Mode, xapp- token)
┌─────────────────────────────────┐
│  socket-manager.ts              │
│  SocketModeClient               │
│  app_mention / message /        │
│  reaction_added / slash_commands│
└──────────┬──────────────────────┘
           │ StoredEvent / SlashCommand
           ▼
┌─────────────────────────────────┐
│  gateway.ts                     │
│  shouldReply → scopeKey         │
│  detectCommand → handleCommand  │
│  per-key 串行队列               │
│  全局信号量 MAX_CONCURRENT      │
└──────────┬──────────────────────┘
           │ prompt via stdin
           ▼
┌─────────────────────────────────┐
│  reply-engine.ts                │
│  spawn claude -p                │
│  --output-format stream-json    │
│  --resume / --session-id        │
│  --mcp-config sender-only       │
└──────────┬──────────────────────┘
           │ NDJSON events
           ▼
┌─────────────────────────────────┐
│  Slack Web API (xoxb- token)    │
│  chat.postMessage / chat.update │
│  (placeholder → final reply)    │
└─────────────────────────────────┘
```

---

## 目录结构

```
src/
  index.ts            MCP server 入口
  gateway.ts          Gateway 守护进程入口
  socket-manager.ts   Socket Mode 连接管理 + 事件/slash 分发
  reply-engine.ts     spawn claude -p，解析 stream-json
  session-store.ts    channel/thread → session UUID 映射，持久化到 memory/sessions.md
  session-commands.ts 原生 slash command 处理（/cc_sessions /cc_resume /cc_new /cc_current /cchelp）
  event-store.ts      内存环形缓冲（MCP server 用，transient）
  slack-clients.ts    WebClient / getAppToken 单例
  gateway-paths.ts    .gateway/ 控制文件路径常量
  gateway-control.ts  start/stop/status/list 命令实现
  types.ts            StoredEvent 等共享类型
  tools/              MCP tools（一个 tool 一个文件）

bin/
  slack-gateway.mjs   gateway 分发器（run/start/stop/restart/status/list）
  slack-socket-mcp.mjs MCP server 启动器

config/
  sender-mcp.generated.json  运行时生成，传给 spawned claude，sender-only Slack MCP

memory/
  sessions.md         channel/thread → session UUID markdown 表（git 追踪）

.gateway/             运行时控制文件（gitignore）
  gateway.pid
  gateway.log
  status.json

manifest.json         Slack app 一键安装
```

---

## 关键设计决策

### 1. Gateway = 无状态 meta 路由器

gateway 只存路由 meta（thread/channel → session UUID），不存对话内容。  
真正的记忆在 Claude agent 侧：`claude -p --resume` 自己读写 `~/.claude/projects/<hash>/` 下的 jsonl。

**Why**：对话内容属于 agent，gateway 管路由，职责分离。SQLite 被永久否决（太重，不可 git 追踪）。

### 2. 持久化用 Markdown，不用数据库

`memory/sessions.md` 是 git 追踪的 markdown 表格，人类可读，可 diff，可多机同步。  
`event-store.ts` 内存环形缓冲，不持久化（transient）。

**Why**：md 足够轻，可 git 协作，比 SQLite 透明得多。event store 只供 MCP 消费，无需持久化。

### 3. Session scope 可配置，DM assistant thread 自动隔离

`GATEWAY_SESSION_SCOPE=channel`（默认）或 `thread`：
- `channel`：一个 channel/DM 共享一个 Claude session，像"房间里的长期助手"
- `thread`：每个话题串独立 session，避免串话

DM 里的 assistant thread（`channel_type=im` + `thread_ts` 存在）**无论 SESSION_SCOPE 设置如何**，都强制用 `threadKey` 隔离——每次点"新聊天"产生新 `thread_ts`，天然对应独立 session。这是第一优先级规则，在 GATEWAY_SESSION_SCOPE 判断之前执行。

slash command 无 thread_ts，始终用 channel 级 key。同一 key 的所有操作严格串行（per-key 链式 Promise），防止并发 `--resume <同一 uuid>` 污染 session。

### 4. Prompt via stdin

Windows 上 `shell:true` spawn 时，argv 里的多行/CJK prompt 被 cmd.exe 截断或破坏 → prompt 走 stdin。`--mcp-config` 也不能内联 JSON（引号被 cmd 吃掉）→ 写文件传路径。

### 5. sender-only MCP config

spawned `claude -p` 得到一个只含 Slack Web API 工具的 MCP config（`MCP_SENDER_ONLY=1`）。这让 claude 能读频道历史、发消息，但不开第二个 Socket Mode 连接抢事件。`--strict-mcp-config` 还阻止 claude 加载项目的 `.mcp.json`（那会开 Socket Mode）。

---

## 已知局限（后续再做）

1. **无 session-host**：`claude -p` 是一次性进程，不支持透传 `/approve` 等操作命令。需维护常驻 claude 进程 + console stream 接管（大工程，单独立项）。
2. **无重试/状态机**：消息只跑一次，失败就报错。完整 `pending→processing→replied/failed` 状态机用 md 做，待做。
3. **slash command 在 App Home Messages tab**：需在 Slack App 管理页面 App Home 里勾选 "Allow users to send Slash commands and messages from the messages tab"，manifest 里 `messages_tab_enabled: true` + `messages_tab_read_only_enabled: false`。Socket Mode 本身支持 slash command 投递，不需要公网 HTTP endpoint；该设置不开则 Slackbot 报"消息列不支持此命令"。
