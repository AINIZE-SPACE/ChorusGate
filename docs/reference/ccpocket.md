# CC Pocket — 深度参考分析

> 来源：https://github.com/K9i-0/ccpocket (MIT License)
> 分析日期：2026-06-12
> 深度分析：逐文件阅读 `packages/bridge/src/` 下全部关键源文件

---

## 一章：项目定位与架构概览

### 一句话

CC Pocket 是一个 Flutter 跨平台 App，通过自托管 WebSocket Bridge 在手机/平板上远程操控 Codex / Claude Code 编码 agent。

### 架构图

```
┌───────────────────────┐
│  CC Pocket App         │  Flutter (iOS/Android/macOS/Linux/Windows)
│  用户界面               │  - 会话管理、审批、文件浏览、prompt 编辑
└──────┬────────────────┘  - 语音输入、图片附件、Markdown 自动补全
       │ WebSocket
       ▼
┌───────────────────────┐
│  Bridge Server         │  Node.js (TypeScript, ws)
│  自托管中转层           │  - 部署在开发机上
│                        │  - 暴露 WebSocket + HTTP (同一端口)
│                        │  - 管理 agent CLI 生命周期
└──────┬────────────────┘  - 持久化服务（launchd / systemd）
       │ spawn / stdio / WebSocket RPC
       ▼
┌───────────────────────┐
│  Agent CLI             │  Claude Code (SDK) / Codex CLI (app-server JSON-RPC)
│  实际执行编码           │  - 运行在同一台机器上
│                        │  - 代码不离开开发机
└───────────────────────┘
```

**核心设计原则**：代码始终留在用户机器上，App/Bridge 只是遥控器。

---

## 二章：Bridge 源代码逐文件深度分析

### 文件 1: `index.ts` — 入口骨架

**角色**：HTTP 服务器 + 全部 store 初始化 + 生命周期管理。

**关键设计**：

```typescript
// 单一 HTTP server 同时承载 WebSocket 和 HTTP REST
const httpServer = createServer((req, res) => { ... });
wsServer = new BridgeWebSocketServer({
  server: httpServer,  // 共享 HTTP server
  apiKey, allowedDirs,
  imageStore, galleryStore, projectHistory,
  debugTraceStore, recordingStore, firebaseAuth,
  promptHistoryBackup, promptHistoryStore,
});
```

**决策要点**：
- **单端口双协议**：HTTP + WebSocket 共享同一端口。WebSocket 做实时双向通信（消息/审批/流式输出），HTTP 做 health/version/usage/doctor 查询 + 图片/文件服务。
- **先并行 init store，再 listen**：`galleryStore.init()` → `projectHistory.init()` → `debugTraceStore.init()` → `recordingStore.init()` → 最后 `httpServer.listen()`。
- **Shutdown 流程**：`SIGINT`/`SIGTERM` → `mdns.stop()` → `wsServer.close()`（会 `destroyAll` sessions + `stopManagedCodexAppServers()`）→ `httpServer.close()`。

**对本项目的参考**：✅ Gateway 也是 HTTP + Socket Mode 双协议，启动并行 init + 有序 shutdown 模式直接可用。`allowedDirs` 安全限制值得引入。

---

### 文件 2: `websocket.ts` — WebSocket 协议层（7087 行，全项目最大文件）

**角色**：WebSocket 连接生命周期 + 全部 Client/Server 消息路由 + session 创建/销毁 + 历史同步。

**消息类型全景**：

```
Client → Server (40+ types):
  start, input, approve, reject, answer, approve_always,
  stop_session, list_sessions, get_history, get_history_since,
  resume_session, set_permission_mode, set_sandbox_mode, set_model,
  get_diff, stage_files, stage_hunks, unstage_files, unstage_hunks,
  git_commit, git_push, list_files, list_branches, create_branch,
  checkout_branch, revert_files, revert_hunks, git_fetch, git_pull,
  git_status, get_file, take_screenshot, list_windows,
  push_register, push_unregister, get_usage, get_claude_models,
  get_codex_models, get_codex_profiles, archive_session, unarchive_session,
  rewind, rewind_conversation, fork_codex,
  update_queued_input, cancel_queued_input, steer_queued_input,
  rename_session, rename_codex_agent,
  client_capabilities, list_recent_sessions, get_debug_trace,
  get_recording, set_archive_filter, prompt_history_*, ...

Server → Client (35+ types):
  system (session_created, init, supported_commands, set_permission_mode, tip),
  assistant, tool_result, result, error, status,
  history, history_snapshot, history_since, session_list,
  permission_request, permission_resolved,
  stream_delta, thinking_delta, diff_result, file_list,
  branch_list, git_status_result, screenshot_result, window_list,
  project_history, recent_sessions, debug_trace, debug_event,
  recording_list, recording_event, recording_meta,
  gallery_new_image, prompt_history_*,
  rewind_result, conversation_queue,
  input_ack, input_rejected, ...
```

#### 关键模式 1: Session ↔ Connection 1:N 广播

```typescript
this.sessionManager = new SessionManager(
  (sessionId, msg) => { this.broadcastSessionMessage(sessionId, msg); }
);
```

Session 独立于 WebSocket 连接生命周期——重连不会丢失会话。同一 session 可多设备同时观看。

#### 关键模式 2: 输入冲突检测

```typescript
// 检测到冲突时发送 input_rejected
if (clientMessageId && baseSeq !== undefined && this.hasInputConflictSince(session, baseSeq)) {
  this.send(ws, { type: "input_rejected", reason: "conflict" });
}
```

**对本项目参考**：我们当前 per-scope 串行队列可保序但不会 reject conflict。

#### 关键模式 3: 增量历史同步 (history_since)

```typescript
// 客户端发 sinceSeq → bridge 返回此 seq 后的新条目
case "get_history_since": {
  const delta = this.sessionManager.getHistorySince(sessionId, msg.sinceSeq);
  this.send(ws, { type: "history_since", ...delta });
}
```

当 compaction 发生（sinceSeq 在 lowWatermark 之前），返回 `"snapshot"` + `reason: "compacted"` 通知客户端全量替换。

#### 关键模式 4: Codex 消息队列 + steer

```typescript
// Codex 忙时排队而非 reject
case "input": {
  if (session.provider === "codex" && !session.process.isWaitingForInput) {
    sessionManager.queueCodexInput(session.id, input);
    // 用户还可编辑排队消息
    case "update_queued_input": sessionManager.updateCodexQueuedInput(...);
    case "cancel_queued_input": sessionManager.cancelCodexQueuedInput(...);
    case "steer_queued_input": sessionManager.steerCodexQueuedInput(...);
  }
}
```

`steer` 机制允许在 turn 进行中注入修正——对应到我们，是 Session Host 的 RuntimeControlCommand。

---

### 文件 3: `session.ts` — SessionManager（1646 行）

**角色**：Session 生命周期 + 历史管理 + 输入队列 + 自动命名 + UUID 回填 + Worktree 关联。

**核心数据结构**：

```typescript
export interface SessionInfo {
  id: string;                    // 8-char Bridge UUID
  process: SdkProcess | CodexProcess;
  provider: Provider;            // "claude" | "codex"
  history: ServerMessage[];      // 内存历史（最多 100 条）
  historyEntries: HistoryEntry[];// 带 seq 的历史（增量同步）
  historyRevision: number;       // 当前 seq 最大值
  historyLowWatermark: number;   // trim 后最早的 seq
  pastMessages?: unknown[];     // 从磁盘回放的历史
  projectPath: string;
  claudeSessionId?: string;     // CC UUID / Codex thread_id
  name?: string;
  status: ProcessStatus;        // idle | starting | running | waiting_approval | compacting
  gitBranch: string;
  worktreePath?: string;
  worktreeBranch?: string;
  codexSettings?: { ... };      // 用于 resume
  codexQueuedInput?: QueuedCodexInput;
  autoRename?: boolean;
}
```

#### 关键方法链: Session 创建流程

```
create(projectPath, options?, pastMessages?, worktreeOpts?, provider?, codexOptions?)
  → 1. 生成 8 字符 UUID
  → 2. new SdkProcess() | new CodexProcess()
  → 3. 可选: createWorktree() 或 reuse existing
  → 4. git rev-parse 读取 branch
  → 5. 注册 "message" 处理器（核心事件管线，见下）
  → 6. 注册 "status" / "exit" 处理器
  → 7. proc.start(cwd, options)
  → 8. sessions.set(id, session)  ← 只在 start() 成功后加入 map
```

#### 核心事件管线 (proc.on("message"))

```typescript
proc.on("message", async (msg) => {
  // 1. system/init → 缓存 slash_commands, skills, apps, plugins
  // 2. result → 捕获 claudeSessionId
  // 3. assistant → 缓存 tool_use name (用于 tool_result 补全)
  // 4. tool_result → 提取图片路径 → imageStore.registerImages()
  // 5. stream_delta / thinking_delta → 直接转发，不写 history
  // 6. user_input → 智能合并（同 clientMessageId = update）
  // 7. Codex → 用户回响去重
  // 8. result → 从磁盘 backfill user UUID
  // 9. 触发 autoRename
})
```

**对本项目关键参考**：
- ✅ `stream_delta` 不入 history — agent 的实时打字效果只在 UI，持久化只存最终 assistant message
- ✅ tool_use name 缓存 → tool_result 自动补全 `toolName` — 我们 `reply-engine.ts` 也可以做
- ✅ UUID backfill — 从磁盘 JSONL 补全内存中缺失的 user UUID

#### History trim + delta/snapshot 协议

```typescript
// trim 后 lowWatermark 前移 → 客户端检测到 sinceSeq < lowWatermark-1 → 请求 snapshot
while (session.history.length > MAX_HISTORY_PER_SESSION) {
  session.history.shift(); // 头部删最早条目
}
```

**对本项目参考**：⚠️ Slack thread 本身就是消息容器，不需要此模式。但如果未来做 Web dashboard，增量 history sync 有用。

---

### 文件 4: `sdk-process.ts` — Claude Code SDK 集成（1280 行）

**角色**：通过 `@anthropic-ai/claude-agent-sdk` 的 `query()` API 管理 Claude Code 进程。

#### 核心设计 1: AsyncGenerator 用户消息流

```typescript
private async *createUserMessageStream(): AsyncGenerator<SDKUserMsg> {
  while (!this.stopped) {
    // 优先 drain 队列
    if (this.pendingInputQueue.length > 0) {
      yield { type: "user", ... };
      continue;
    }
    // 等待下一个用户输入
    const msg = await new Promise<SDKUserMsg>((resolve) => {
      this.userMessageResolve = resolve;
    });
    yield msg;
  }
}
```

**设计要点**：队列 + resolver 双模式——忙时排队（`pendingInputQueue`），闲时 await Promise（`userMessageResolve`）。`sendInput()` 返回 boolean：`true` = queued, `false` = consumed immediately。

#### 核心设计 2: 权限系统

```typescript
private async handleCanUseTool(toolName, input, options): Promise<PermissionResult> {
  // 1. AskUserQuestion → 永远转发到客户端
  // 2. 检查 session allow rules
  // 3. 否则 permission_request → 等待 approve/reject
  return this.waitForPermission(options.toolUseID, toolName, input, options.signal);
}
```

**权限模式映射**：`bypassPermissions` → `fullAccess`, `acceptEdits` → `acceptEdits`, `default` → `default`, `plan` → `planMode=true`。

#### 核心设计 3: 图片输入

```typescript
sendInputWithImages(text, images: [{ base64, mimeType }]): boolean {
  const content = [
    ...images.map(img => ({ type: "image", source: { type: "base64", ... } })),
    { type: "text", text }
  ];
}
```

**对本项目参考**：🔥 图片输入是未来 Slack `file_shared` → agent 的关键能力。CC Pocket 已完整实现。

#### 核心设计 4: Auth 预检 + 错误分类

```typescript
type AuthErrorCode = "auth_login_required" | "auth_token_expired" | "auth_api_error";
// ANTHROPIC_API_KEY → ok; OAuth → 拒绝（第三方产品不能用 Claude 订阅登录）
```

**对本项目参考**：✅ 我们 gateway 启动时应区分 auth 失败原因并给出具体修复指令。

---

### 文件 5: `codex-process.ts` — Codex CLI 进程管理（3895 行，第二大文件）

**角色**：通过 Codex app-server JSON-RPC over stdio/WebSocket 管理 Codex 会话。

#### 核心设计 1: 输入循环 (Input Loop)

```
runInputLoop
  → 等待 inputResolve (来自 sendInput/sendInputStructured)
  → turn/start RPC (含 collaborationMode, approvalPolicy, model)
  → 等待 turn/completed 通知
  → 检查 plan mode → 等待 approve/reject
  → 循环
```

Codex 不是一次性 CLI——app-server 是持久 JSON-RPC 服务，bridge 做 `turn/start` → 等待 `turn/completed` → 循环。

#### 核心设计 2: 审批系统

```typescript
approve(toolUseId?)     → respondToServerRequest(decision: "accept")
approveAlways(toolUseId?) → respondToServerRequest(decision: "acceptForSession")
reject(toolUseId?)      → respondToServerRequest(decision: "decline"/"cancel")
answer(toolUseId, result) → respondToServerRequest(answers: {...})
```

**Plan 审批**：plan mode turn 结束后自动挂起 → `permission_request(ExitPlanMode)` → approve → `collaborationMode = "default"` + auto-start execution；reject → 保持 plan mode + 可选 feedback。

#### 核心设计 3: JSON-RPC 三种消息流向

```typescript
handleRpcEnvelope(envelope):
  if (id && method) → handleServerRequest (Codex 发来的请求，需我们响应)
  if (id && (result || error)) → handleRpcResponse (我们发的请求的响应)
  if (method) → handleNotification (异步通知：stream delta, turn completed)
```

**Server Request 类型**：
- `item/commandExecution/requestApproval` → 命令执行审批
- `item/fileChange/requestApproval` → 文件修改审批
- `item/tool/requestUserInput` → AskUserQuestion
- `item/permissions/requestApproval` → 权限审批
- `mcpServer/elicitation/request` → MCP 诱导请求

**Notification 类型**：
- `item/agentMessage/delta` → 流式文本增量
- `item/reasoning/textDelta` → 思考文本增量
- `turn/completed` → turn 结束
- `skills/changed` → 重新拉取技能列表

**对本项目的参考**：
🔥 **这是 #32 的最佳实现参考**。Codex 的 JSON-RPC 审批流程完全对应我们需要的 Slack 审批循环：

```
Codex 审批流：    agent → permission_request → bridge → approve → respondToServerRequest → agent 继续
Claude stream-json：agent → permission_request → gateway → Slack button → stdin 写 permission_result → agent 继续
```

---

### 文件 6: `codex-transport.ts` — Codex 传输抽象（316 行）

**三种传输模式**：

```typescript
// 模式 1: stdio — spawn codex app-server --listen stdio://
class StdioCodexTransport { write() → child.stdin.write(JSON.stringify(envelope) + "\n") }

// 模式 2: Managed WebSocket — Bridge 自己 spawn app-server，通过 WS 连接
class ManagedCodexAppServer { ensureStarted() → spawn; createTransport() → new WebSocketCodexTransport(url, 5000) }

// 模式 3: External WebSocket — 连接外部 app-server（如 VS Code 的）
class WebSocketCodexTransport { connect() → new WebSocket(url) }
```

**WebSocket 模式的重连机制**：5 秒重试窗口，断开自动重连，queued 消息自动重放。

**对本项目参考**：⚠️ 传输抽象对我们是过度设计——只用 stdio spawn `claude -p`。但如果做 Session Host（持久 agent 进程），WebSocket 模式值得参考。

---

### 文件 7: `worktree.ts` — Git Worktree 管理（353 行）

**核心 API**：

```typescript
createWorktree(projectPath, sessionId, branch?)
  → 1. resolveProject（真实路径，follow symlinks）
  → 2. 分支名: branch ?? "ccpocket/" + sessionId
  → 3. mkdir <project>-worktrees/ 根目录
  → 4. git worktree add [-b branch] <worktreePath>
  → 5. 读取 .gtrconfig → 复制配置的文件 + 运行 postCreate hook
  → 返回 { worktreePath, branch, projectPath, head }

removeWorktree(projectPath, wtPath)
  → 1. 运行 preRemove hook
  → 2. git worktree remove --force

listWorktrees(projectPath)
  → git worktree list --porcelain → 只返回 <project>-worktrees/ 下的
```

**`.gtrconfig` 格式**（gitconfig 风格）：

```ini
[copy]
include = package.json
includeDirs = src
excludeDirs = node_modules
[hook]
postCreate = npm install
preRemove = echo "cleaning up"
```

**对本项目参考** 🔥：
- 分支命名：`ccpocket/<session-id>` → 我们用 `slack4ccmcp/<session-uuid>`
- 可选 hook：`.gtrconfig` → `postCreate = npm install` 等
- 清理生命周期：session destroy → removeWorktree

---

### 文件 8: `git-operations.ts` — Git 操作（690 行）

| 操作组 | 函数 | 说明 |
|--------|------|------|
| Staging | `stageFiles`, `stageHunks`, `unstageFiles`, `unstageHunks` | 行级 staging |
| Commit | `gitCommit`, `getStagedDiff` | commit + diff 读取 |
| Branch | `listBranches`, `createBranch`, `checkoutBranch` | 分支管理 |
| Revert | `revertFiles`, `revertHunks` | 按文件/按 hunk 回滚 |
| Remote | `gitFetch`, `gitPull`, `gitRemoteStatus` | 远程同步 |
| Status | `gitStatus` | 工作树状态 + 可选 remote ahead/behind |
| File | `listGitFiles`, `listFileSystemFiles`, `listProjectFilesAndDirectories` | 文件浏览 |

**关键实现**：`stageHunks` 按文件分组 hunks → `git diff --unified=0` → 提取指定 hunk → `git apply --cached --unidiff-zero`。

**对本项目参考**：行级 staging 在未来审批流中有用（agent 改了多个文件 → Slack 展示 diff → 用户选 hunk 接受），但需要 Session Host 做 git 接管。

---

### 辅助文件速览

| 文件 | 功能 | 对本项目参考度 |
|------|------|-------------|
| `cli.ts` | `npx @ccpocket/bridge` CLI | ✅ 类似 `slack-gateway.mjs` |
| `image-store.ts` | 内存图片注册 + HTTP serve | ✅ Slack 图片→base64 |
| `gallery-store.ts` | 磁盘图片库持久化 | ⚠️ Slack 自己管理文件 |
| `project-history.ts` | 项目路径列表持久化 | ✅ 类似 `memory/sessions.md` |
| `prompt-history-store.ts` | 输入历史跨 session | ✅ 可做 `/cc_history` |
| `push-relay.ts` | FCM 推送通知 | ⚠️ Slack 原生推送 |
| `mdns.ts` | mDNS 局域网发现 | ⚠️ Slack App 安装=配对 |
| `proxy.ts` | HTTPS_PROXY 支持 | ✅ 企业部署必需 |
| `screenshot.ts` | macOS 截图 | ⚠️ agent tool 已够 |
| `doctor.ts` | 环境诊断 | ✅ install lifecycle 参考 |
| `setup-launchd.ts` / `setup-systemd.ts` | 系统服务 | ✅ 方向一致 |
| `debug-trace-store.ts` | 调试事件记录 | ⚠️ gateway log 已够 |
| `recording-store.ts` | 会话录制/回放 | ⚠️ 过度 |
| `archive-store.ts` | 会话归档 | ✅ 类似 session 生命周期 |
| `sessions-index.ts` | 读本地 session 索引 | ✅ `/cc_resume` 可用 |
| `auto-rename.ts` | 自动生成 session 名 | ✅ `/cc_sessions` 增强 |

---

## 三章：对本项目的深入参考

### 3.1 审批循环 (#32) — 完整的实现路径已经清晰

CC Pocket 的 Codex 审批流程直接对应我们 M2 的 `--input-format stream-json` 方案：

```
Codex 审批流：
  agent → JSON-RPC permission_request → bridge → WS → App render
  App click → WS → bridge → respondToServerRequest(id, decision) → agent 继续

Claude stream-json 审批流：
  agent → permission_request event → gateway → Slack block_actions
  user click → gateway → stdin write permission_result → agent 继续
```

**关键差异**：CC Pocket 用 WebSocket 做双向通道（自带），我们用的 Slack Socket Mode + interactive blocks 也是天然的请求-响应语义——不需要自建 WebSocket server。

### 3.2 Worktree 隔离 (#33)

**场景差异**：
- CC Pocket：移动端用户可能同时开多个 session 并行操作
- slack4ccmcp：通常每 channel 一个活跃 session，并行主要在 `/background` 场景

**建议粒度**：`GATEWAY_WORKTREE_MODE=per-session`，按需创建。分支命名参考 `slack4ccmcp/<session-uuid>`。

### 3.3 Provider 抽象深度对比

| 维度 | CC Pocket | slack4ccmcp v3 |
|------|-----------|----------------|
| 进程管理 | 持久 event loop (SdkProcess/CodexProcess) | 一次性 spawn (AgentProvider) |
| 审批 | `approve()`/`reject()`/`answer()` | 暂无（需 M2 stream-json） |
| 状态机 | `starting→running→waiting_approval→idle` | 无（claude -p 一次性） |
| 图片输入 | 原生 base64 | 未设计 |
| 队列 | 忙时入队 + interrupt | per-scope 串行 Promise |
| 历史 | 完整 history + delta sync | agent 侧自管 |

**核心差异**：CC Pocket 管理持久进程（event loop），我们的 provider 是一次性调用。这决定了 CC Pocket 有完整审批/队列/中断能力，而我们需 Session Host 才能达到同等水平。

### 3.4 值得引入的 CC Pocket 工程特性

1. **`allowedDirs`** — gateway 限制 agent 运行目录，防 prompt injection 操控敏感路径
2. **`doctor`** — 诊断命令：检查 git/claude/node/npm 可用性 + 版本
3. **`proxy.ts`** — 企业 HTTPS_PROXY 支持
4. **Auth 错误分级** — `auth_login_required` / `auth_token_expired` / `auth_api_error` + 修复指引
5. **`input_ack` + `input_rejected`** — 确认消息状态，防止用户以为丢失

---

## 四章：定位差异（更新）

| 维度 | CC Pocket | slack4ccmcp |
|---|---|---|
| 定位 | 通用远程编码遥控器 | Slack 原生 Claude Code 助手 |
| UI | Flutter App（需安装） | Slack（已有基础设施） |
| 场景 | 离开电脑时编码 | 团队协作 + 随时 @ 助手 |
| Agent 方式 | 持久进程 (event loop) | 一次性 `claude -p` spawn |
| 审批 | 原生 Approve/Deny/Answer | M2 stream-json 规划中 |
| Worktree | 每 session 可选 | #33 规划中 |
| 多 Agent | Claude + Codex 双 Provider | v3 M1 规划中 |
| 多设备 | 同一 session 多设备同时观看 | Slack 天然多设备 |
| 离线韧性 | 离线排队 + 重连回放 | #1 消息状态机规划中 |
| 图片支持 | 原生 base64 | 未设计 |
| 推送 | FCM 自建 | Slack 原生推送 |
| 安装 | App + Bridge + 扫码 | Slack App 一键安装 |
| 多用户 | 单人单 Bridge | 天然多用户 |
| 团队协作 | 不支持 | 天然支持 |

---

## 五章：灵感清单（更新）

### 近期可落地
- [ ] **Slack 审批按钮 (#32)**：stream-json `permission_request` → interactive blocks (Approve/Deny) → `block_actions` → stdin 写 `permission_result`
- [ ] **消息状态机 (#1)**：`pending → processing → replied/failed` + 重试
- [ ] **`allowedDirs` 安全**：gateway 检查 `cwd` 是否在 `GATEWAY_ALLOWED_DIRS` 内
- [ ] **Auth 错误分级**：启动时区分未登录/token 过期/API 错误 + 修复指引
- [ ] **`doctor` 诊断命令**：`npm run doctor` 检查所有依赖

### 中期（需 Session Host）
- [ ] **Worktree 隔离 (#33)**：按需 `GATEWAY_WORKTREE_MODE=per-session`
- [ ] **输入队列 + interrupt**：agent 忙时自动排队
- [ ] **代理支持**：`HTTPS_PROXY` 配置

### 远期
- [ ] **图片输入**：Slack `file_shared` → base64 → agent
- [ ] **Hunk staging**：agent multi-file diff → Slack 选择性 accept

## 已映射到本项目文档

| CC Pocket 点 | slack4ccmcp 落点 |
|---|---|
| Bridge Server = 本地控制面 | `architecture.md`, `architecture-boundaries.md` |
| approval loop (Codex JSON-RPC) | `roadmap.md` #32, `v3-story-8-claude-stream-json.md` |
| input queue + interrupt | `roadmap.md` #1 |
| worktree isolation | `roadmap.md` #33, `v3-story-4-multi-project.md` |
| SessionManager.create() | `v3-story-5-session-model.md` |
| sdk-process + codex-process | `v3-story-1-provider-abstraction.md` |
| bridge setup / service | `feature-install-lifecycle.md` |
| auth 错误分级 | `architecture.md` 已知局限 |
| allowedDirs 安全 | 新 issue |
| doctor 诊断 | install lifecycle 补充 |
