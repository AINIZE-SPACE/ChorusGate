# ChorusGate — 架构总览

> 维护入口。读完这篇，再去看具体 feature 文档。

---

## 一句话定位

ChorusGate 是 local-first collaboration-channel gateway：channel runtime（当前 Slack，规划飞书/Lark）负责收发协作消息，gateway 负责路由、会话、命令和控制面，agent runtime（当前 Claude Code，规划 Codex 和更多 runtime）负责执行 turn 并返回结果。

同时提供 MCP server，让 agent runtime 能主动读写 channel 上下文；在 gateway 模式下，MCP server 应以 sender-only 方式运行，避免重复接收同一个 Socket Mode 事件流。

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

spawned `claude -p` 得到一个只含 Slack Web API 工具的 MCP config（`MCP_SENDER_ONLY=1`）。这让 claude 能读频道历史、发消息，但不开第二个 Socket Mode 连接抢事件。`--strict-mcp-config` 还阻止 claude 加载项目的 `.claude/mcp.json`（那会开 Socket Mode）。

### 6. CC Pocket 参考：Gateway 是 Slack 版本地 Bridge

[CC Pocket](./reference/ccpocket.md) 的 Bridge Server 和 ChorusGate gateway 属于同一类本地控制面：用户界面在外部，agent CLI 和代码仍运行在用户自己的机器上。区别是 CC Pocket 自建 WebSocket + App，ChorusGate 复用 Slack Socket Mode + Slack UI，并把飞书/Lark 等协作 channel 纳入同一 adapter 边界。

**深度分析揭示的关键参考**（详见 [参考文档](./reference/ccpocket.md) 第二章逐文件分析）：

- **审批循环**：CC Pocket 的 Codex JSON-RPC 审批流（`permission_request` → approve/reject → `respondToServerRequest`）直接对应我们 M2 的 `--input-format stream-json` 方案。CC Pocket 的 `approve()`/`reject()`/`approveAlways()`/`answer()` 四个函数覆盖了全部审批场景。
- **输入队列 + interrupt**：CC Pocket 的 `sendInput()` 在 agent 忙时自动排队（`pendingInputQueue`），`input_ready` 时自动 drain。`interrupt()` 可在 turn 进行中中止 + 保留排队消息。
- **Worktree 隔离**：CC Pocket 用 `ccpocket/<session-id>` 分支命名 + `--gtrconfig` 钩子文件复制，提供完整的 session 沙箱。我们 #33 可直接参考其 `createWorktree()` + `removeWorktree()` lifecycle。
- **Provider 抽象**：CC Pocket 用 EventEmitter 模式管理持久进程（`SdkProcess`, `CodexProcess`），统一 `on("message")` / `on("status")` / `on("exit")` 事件接口，上层 `SessionManager` 不感知 provider 差异。
- **安全限制**：`allowedDirs` 限制 agent 只能在授权目录运行，防止 prompt injection。
- **Auth 错误分级**：`auth_login_required` / `auth_token_expired` / `auth_api_error` + 修复指引，启动时友好提示。

可直接借鉴的原则：

- **代码不离开开发机**：Gateway 只转发事件、命令、进度和结果，不托管代码仓库。
- **控制面与运行时分离**：Slack 是 UI/control plane，agent runtime 只负责执行 turn。
- **审批循环要变成一等能力**：未来 `/approve`、`/deny` 不应是普通 prompt，而应通过 runtime control event + Slack interactive action 回传。实现路径已在 CC Pocket 的 Codex JSON-RPC 审批流中验证。
- **离线/断线要有状态机**：Socket 重连、gateway 重启、Slack API 失败都应落入 `pending -> processing -> replied/failed/retry` 状态。
- **并行任务需要工作区隔离**：会话级 `cwd` 是第一步；同仓库并行长任务应升级为 session 级 git worktree。CC Pocket 的 `worktree.ts` 提供了可直接参考的实现。

---

## 已知局限（后续再做）

1. **approve/deny 交互**：v3 M2 用 `claude -p --input-format stream-json --output-format stream-json` 双向 JSON 管道实现（见 [v3-story-8](planning/v3-story-8-claude-stream-json.md)）。旧 `claude -p` 单向模式已确认限制，双向模式无需 Claude SDK。
2. **无重试/状态机**：消息只跑一次，失败就报错。完整 `pending→processing→replied/failed→retry` 状态机用 md 做，待做。
3. **slash command 在 App Home Messages tab**：需在 Slack App 管理页面 App Home 里勾选 "Allow users to send Slash commands and messages from the messages tab"，manifest 里 `messages_tab_enabled: true` + `messages_tab_read_only_enabled: false`。Socket Mode 本身支持 slash command 投递，不需要公网 HTTP endpoint；该设置不开则 Slackbot 报"消息列不支持此命令"。
4. **无 worktree 隔离**：当前只用 session scope 和 cwd 控制上下文；同一 repo 的并行长任务仍可能改同一工作树，需后续 session 级 git worktree。
