# Feature: 自动回复（Auto-Reply Gateway）

> 对应文件：`src/gateway.ts`、`src/reply-engine.ts`、`src/socket-manager.ts`

---

## 功能描述

Gateway 是一个常驻守护进程。当 Slack 用户 @mention 机器人或给它发 DM，gateway 自动：
1. 接收事件（Socket Mode WebSocket）
2. 判断是否要回复
3. 用同一频道/thread 绑定的 Claude session 生成回复
4. 把回复发回 Slack

用户无需任何操作——发消息，等回复。

---

## 触发条件

| 事件类型 | 触发 | 说明 |
|---------|------|------|
| `app_mention` | ✅ | 任意频道里 @ClaudeCodeApp |
| `message`（`channel_type: im`）| ✅ | DM（私信）|
| `message`（普通频道消息）| ❌ | 没有 @mention 的频道消息忽略 |
| `reaction_added` | ❌ | 反应不触发回复 |
| 有 `subtype` 的消息 | ❌ | 编辑/删除/系统事件全部跳过 |
| 清理 @mention 后 text 为空 | ❌ | 防止空消息或纯 mention 触发 |

**Why 跳过有 subtype 的消息**：Slack 的 `message_changed`、`assistant_thread_started`、`bot_message` 都带 subtype，text 要么为空要么是系统噪声，不应触发 claude -p spawn。`shouldReply` 优先检查 subtype，再检查清理后 text 是否为空，两道防线确保系统事件不触发回复（历史教训：`assistant_view: true` 时 Slack 会推送无 text 的系统事件，曾导致大量 `claude -p` 空启动）。

---

## 回复生成流程

```
onEvent(StoredEvent)
  ↓
shouldReply() — 不满足就 markHandled 返回
  ↓
dedup: inFlight.has(ts) — 已在处理就跳过（防 Slack 重投递）
  ↓
scopeKey(channel, threadTs?) — 确定 session 维度
  ↓
detectCommand() — 是 /cc_sessions 等命令就走 handleCommand，跳过 AI
  ↓
per-key 串行队列（threadChains Map）— 入队，等前一条处理完
  ↓
acquireSlot() — 全局信号量，MAX_CONCURRENT 上限
  ↓
enrichEvent() — 解析 user_name / channel_name（best-effort）
  ↓
sessionStore.getOrCreate(key) — 取或新建 session UUID
  ↓
buildPrompt() — 构造 prompt（首轮含上下文，续轮精简）
  ↓
generateReply() — spawn claude -p，解析 stream-json
  ↓
Slack Web API — 发回最终回复（或错误提示）
```

---

## Session 复用

每个 scope key 对应一个固定 Claude session UUID：
- **首轮**：`claude -p --session-id <uuid>` 创建 session
- **后续轮次**：`claude -p --resume <uuid>` 续接，模型记得之前的对话

scope key 由 `scopeKey(channel, threadTs?, channelType?)` 决定，规则如下：

| 场景 | Key 格式 | 含义 |
|------|---------|------|
| `GATEWAY_SESSION_SCOPE=thread` + 有 thread_ts | `<channel>:<thread_ts>` | 每个话题串独立 |
| DM（`channel_type=im`）+ 有 thread_ts | `<channel>:<thread_ts>` | 每次"新聊天"独立 |
| 其他（默认 channel 模式）| `channel:<channel_id>` | 整个频道/DM 共用 |

**DM assistant thread 隔离（Why）**：Slack `assistant_view: true` 时，用户点"新聊天"会创建一个新 assistant thread，分配新的 `thread_ts`。如果用 channel 级 key，两次"新聊天"会共享同一个 Claude session，对话内容串在一起。用 `thread_ts` 作 key，每次新聊天天然隔离，无需监听 `assistant_thread_started` 事件，也不需要预创建 session——第一条真实消息到达时自动建立。

**Why channel 是其他场景的默认**：Slack slash command（`/cc_resume`、`/cc_new` 等）没有 thread_ts，必须有一个 channel 级 key。让普通频道消息和 slash command 用同一个 key，命令才能影响下一条消息的 session。

---

## 并发控制

两层保护：

1. **per-key 串行队列**：同一 scope key 的事件链式排队，保证不会有两个 `--resume <同一 uuid>` 并发运行（会破坏 session 状态）。
2. **全局信号量 MAX_CONCURRENT**（默认 3）：跨频道同时跑的 claude 进程数上限，防 spawn storm。

---

## Prompt 构造策略

| 情形 | Prompt 内容 |
|------|------------|
| 续轮（resume=true）| `(channel <id>) <用户> wrote: "<消息>"` — 精简，session 里已有历史 |
| 首轮（新 session）| 完整 preamble：身份、频道 ID、Slack tools 说明 + 历史 thread 上下文（最多 8 条）|

**Why 首轮包含 thread 上下文**：用户在一个已有消息的 thread 里第一次 @mention 机器人，machine 不知道前面聊了什么；加载最近 8 条历史给模型热启动。

**Why 续轮精简**：`--resume` 已携带完整对话历史，重复注入上下文浪费 token 还可能混淆模型。

---

## 错误处理

| 情形 | 行为 |
|------|------|
| claude -p 超时（默认 3min）| `SIGKILL`，发 `:warning: 无法生成回复（timeout）` |
| claude -p 非 0 退出（如 Windows 3221225794 DLL 失败）| 发 `:warning: exited <code>` |
| 首轮 session 失败 | `sessionStore.reset(key)` — 下次重新建 session 而不是一直 retry |
| 发消息 API 失败 | catch 后尝试 postMessage 报错，再失败就 console.error 放弃 |

---

## 相关环境变量

| 变量 | 默认 | 含义 |
|------|------|------|
| `GATEWAY_SESSION_SCOPE` | `channel` | `channel` 或 `thread` |
| `GATEWAY_MAX_CONCURRENT` | `3` | 最大并发 claude 进程 |
| `GATEWAY_REPLY_TIMEOUT_MS` | `180000` | 单条回复超时（ms）|
| `GATEWAY_SESSION_IDLE_MS` | `86400000` | session 映射 idle 多久后 evict（ms）|
| `GATEWAY_CLAUDE_CWD` | 项目根 | spawned claude 的工作目录 |
| `CLAUDE_BIN` | `claude` | claude CLI 路径 |
| `CLAUDE_PERMISSION_MODE` | `bypassPermissions` | headless 无审批 UI，默认全放行 |
