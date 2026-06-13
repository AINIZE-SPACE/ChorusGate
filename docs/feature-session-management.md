# Feature: Session 管理（原生 Slash Commands）

> 对应文件：`src/session-commands.ts`、`src/session-store.ts`、`manifest.json`（CC）/`manifest.cx.json`（CX）

---

## 功能描述

用 Slack 原生 slash command 控制 gateway 当前频道绑定的 Claude session，实现：
- 查看当前 session
- 切换到历史 session（跨 Slack / Claude Code 终端共享）
- 重置 session（开新对话）

---

## 命令列表

| 命令 | 行为 |
|------|------|
| `/cc_sessions` | 列出 `memory/sessions.md` 里所有已知 session，标注当前绑定 |
| `/cc_resume N` | 把当前频道绑定到列表第 N 个 session |
| `/cc_resume <uuid>` | 前缀匹配 UUID，绑定到指定 session |
| `/cc_new` | 重置当前频道的 session 绑定（下条消息开新对话）|
| `/cc_current` | 显示当前频道绑定的 session UUID 和最后使用时间 |
| `/cchelp` | 列出上述命令帮助 |

> 用 `/cchelp` 而不是 `/help`，避免与 Slack 内置 `/help` 冲突。所有 CC 命令都以 `cc_` 为前缀，避免与 Hermes 等其他应用的命令冲突。

---

## 实现架构

```
Slack 用户输入 /cc_sessions
      │
      ▼ Socket Mode slash_commands 事件
socket-manager.ts
  ack()          ← 3s 内必须响应
  onSlashCallback(SlashCommand)
      │
      ▼
gateway.ts: onSlash()
  detectCommand("/cc_sessions")
  per-key 串行队列（channelKey）
      │
      ▼
session-commands.ts: handleCommand()
  sessionStore.entries()
  web.chat.postMessage(channel)
```

**Why 用原生 slash command 而不是 @mention 文本**：
- Slack 原生命令有自动补全、描述展示、参数 hint
- 不抢 AI 回复路径（不需要额外的 if/else 判断）
- Slackbot 会提示"该 app 不支持此命令"——原生注册可消除这个错误

**Why slash command 走 slash_commands 事件而不是普通 message**：
Slack slash command 通过独立的 Socket Mode 事件投递，payload 结构不同（`body.command`、`body.channel_id`），和普通消息完全分开处理，避免 AcK 路径混淆。

---

## Session 存储：memory/sessions.md

```markdown
| Thread Key          | Session UUID                         | Started | Last Used            |
|---------------------|--------------------------------------|---------|----------------------|
| channel:C0B8V9LV8CT | 0fb487e1-xxxx-xxxx-xxxx-xxxxxxxxxxxx | yes     | 2026-06-11T02:20:00Z |
```

- 只有 4 列：key / UUID / started / lastUsed
- **不写对话内容**，gateway 是无状态路由器
- git 追踪，可 diff、可多机同步
- 启动时 load，变更后 1s debounce persist

**Why Markdown 不用 SQLite / JSON**：
- SQLite 二进制，无法 git diff，不可读
- JSON 不带注释，重启丢失 human context
- md 表格可读性最强，足够轻量，支持 git 工作流

---

## 数据来源：为什么不读 ~/.claude/projects/

早期方案读 `~/.claude/projects/<project-hash>/*.jsonl` 来列出 session。被否决，原因：
1. **耦合内部实现**：jsonl 是 Claude Code 的内部存储格式，随版本可能变化
2. **无法跨机**：jsonl 在本机，另一台机器看不到
3. **信息过多**：gateway 只需要 UUID，不需要解析对话内容
4. **速度慢**：扫描 + 解析文件比查内存 Map 慢

现在的方案：`/cc_sessions` 直接列 `sessionStore.entries()`，数据来自 gateway 自己维护的 `memory/sessions.md`。session UUID 本身就是 `--session-id` 创建的，可以直接 `--resume`，不需要额外映射。

## Session Scope 与"新聊天"隔离

session scope 决定了多条消息是否共用同一个 Claude session：

### channel scope（默认）

key = `channel:<channel_id>`，整个频道/DM 共用一个长期 session。slash command（`/cc_resume`、`/cc_new`）操作的就是这个 key，对频道内所有后续消息生效。

### thread scope（`GATEWAY_SESSION_SCOPE=thread`）

key = `<channel>:<thread_ts>`，每个 Slack 线程独立 session，适合频道里多话题并行的场景。

### DM assistant thread 自动隔离（无需配置）

当 app 开启 `assistant_view: true` 时，用户在 DM 里点"新聊天"会创建一个新 assistant thread，带有新的 `thread_ts`。gateway 检测到 `channel_type === "im"` 且消息带 `thread_ts` 时，自动用 `threadKey(channel, thread_ts)` 作为 scope key，不受 `GATEWAY_SESSION_SCOPE` 设置影响。

**Why**：
- 用户点"新聊天"的意图就是开启新对话，如果复用 channel key 会让两次对话的上下文串在一起，体验很差
- 不需要监听 `assistant_thread_started` 事件（该事件没有 text，会被 `shouldReply` 过滤），第一条真实消息到达时自动按 thread_ts 建立新 session
- `thread_ts` 在同一个聊天生命周期内不变，续发消息会正确 `--resume` 同一 session

**thread_ts 的生命周期**：
- DM 里：点一次"新聊天" = 一个固定 `thread_ts`，该聊天内所有消息共享它，关闭/重新点"新聊天"才会变
- 频道里：某条消息的第一条回复创建线程，该线程所有回复共享根消息的 `ts` 作为 `thread_ts`

用户在 Claude Code 终端用 `claude --resume` picker 看到一个 session UUID → 在 Slack 发 `/cc_resume <uuid>` → 下次 gateway 回复就在同一个 session 里继续。反之亦然。

这是"gateway 当无状态路由器"设计的直接收益：session UUID 既是 gateway 的 key，也是 claude CLI 的参数，两端天然互通。

---

## 串行保护

slash command 走 `onSlash()` → 也进入 per-key 串行队列（`channelKey` 为 key）。和普通消息共用同一队列，保证 `/cc_resume` 的写操作不会和正在进行的 `--resume <uuid>` 并发。

---

## 相关文件

| 文件 | 职责 |
|------|------|
| `src/session-store.ts` | SessionStore 类，Map + persist/load，channelKey/threadKey |
| `src/session-commands.ts` | detectCommand, handleCommand, ReplyContext |
| `src/socket-manager.ts` | SlashCommand interface, slash_commands 事件监听 |
| `src/gateway.ts` | onSlash(), scopeKey(), onSlash 传给 startSocketMode |
| `memory/sessions.md` | 运行时路由表（git 追踪）|
| `manifest.json` / `manifest.cx.json` | slash_commands 注册（分别对应 CC / CX）|
