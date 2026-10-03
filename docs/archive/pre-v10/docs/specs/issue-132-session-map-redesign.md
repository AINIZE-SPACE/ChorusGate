# Spec: #132 按 hermes gateway session map 结构重新设计 session 映射

> **Issue**: [#132](https://github.com/AINIZE-SPACE/ChorusGate/issues/132)
> **Type**: Epic / Architecture
> **Analyst**: 小马
> **Date**: 2026-07-17

## 1. 问题分析

### 1.1 需求描述

1. 按 Hermes gateway 的 session map 结构重新设计 ChorusGate 的 Slack channel/DM thread → session 映射
2. 映射数据需作为上下文传入 agent CLI，以便完成长任务的异步回写

### 1.2 当前架构 vs Hermes 架构对比

#### ChorusGate 现有模型

**SessionIdentity** (`src/session-store.ts`):
```typescript
interface SessionIdentity {
  profileId: string;      // "default" | "cc" | "codex"
  providerId: string;     // "claude" | "codex" | "claude-stream"
  scopeType: "channel" | "thread";
  scopeTarget: string;    // channel ID
  threadTs?: string;
  projectDir?: string;
}
// Key: "default:codex:channel:C0BEYCR30TD:E:\\my_project\\..."
```

**SessionStore**: 持久化为 `memory/sessions.md` markdown 表格。

**问题**:
- 无 channel directory（不知道有哪些频道可达）
- 无 session context injection（agent 不知道自己在哪个频道/线程）
- 无 user 隔离（同一频道所有人的消息共享一个 session）
- 无异步回写支持（长任务结束后无法找到原频道/线程）

#### Hermes Gateway 模型（参考）

**SessionSource** (`gateway/session.py`):
```python
@dataclass
class SessionSource:
    platform: Platform          # slack, discord, telegram...
    chat_id: str                # channel ID / DM chat ID
    chat_name: Optional[str]    # "#chorusgate_v4"
    chat_type: str              # "dm", "group", "channel", "thread"
    user_id: Optional[str]
    user_name: Optional[str]
    thread_id: Optional[str]    # thread_ts for Slack threads
    parent_chat_id: Optional[str]  # parent channel for threads
    message_id: Optional[str]
```

**build_session_key()**:
```
DM:      agent:main:{platform}:dm:{chat_id}[:{thread_id}]
Channel: agent:main:{platform}:channel:{chat_id}[:{thread_id}]
Thread:  agent:main:{platform}:thread:{chat_id}:{thread_id}
```
- 线程默认共享（不按 user 隔离）
- 群组默认 per-user 隔离

**Channel Directory** (`~/.hermes/channel_directory.json`):
```json
{
  "updated_at": "2026-07-16T23:00:02",
  "platforms": {
    "slack": [
      {"id": "C0BB035G3DK", "name": "chorusgate_v4", "type": "channel"},
      {"id": "C0BB035G3DK:1784214061.625209", "name": "chorusgate_v4 / topic ...", "type": "group", "thread_id": "1784214061.625209"}
    ]
  }
}
```

**SessionContext**: 注入 system prompt，agent 知道：
- 当前来源（频道名、类型、用户）
- 已连接平台
- Home channels
- 长任务 delivery 选项

### 1.3 差距分析

| 能力 | Hermes | ChorusGate | 差距 |
|------|--------|------------|------|
| Channel directory | ✓ JSON 自动发现 | ✗ 无 | 需要 |
| Session key 含 platform | ✓ | ✗ Slack only | 需要扩展 |
| Session key 含 user | ✓ 可选 | ✗ 无 | 需要 |
| Session context 注入 | ✓ system prompt | ✗ 无 | 需要 |
| 异步回写路由 | ✓ delivery options | ✗ 无 | 需要 |
| 持久化 | SQLite + JSON | Markdown table | 需升级 |
| Thread parent 追踪 | ✓ parent_chat_id | ✗ 无 | 需要 |

## 2. 设计方案

### 2.1 Channel Directory（新增）

**文件**: `src/channel-directory.ts`

**数据结构**:
```typescript
interface ChannelEntry {
  id: string;                    // channel ID 或 "CHANNEL:thread_ts"
  name: string;                  // 频道名或 "频道名 / topic thread_ts"
  type: "channel" | "group" | "dm";
  threadId?: string;             // thread_ts（group 类型时）
  parentChannelId?: string;      // 父频道 ID（thread 时）
}

interface ChannelDirectory {
  updatedAt: string;             // ISO timestamp
  profiles: Record<string, {     // profileId -> channels
    botUserId: string;
    channels: ChannelEntry[];
  }>;
}
```

**持久化**: `memory/channel-directory.json`

**构建策略**:
1. 启动时调用 `conversations.list` 获取所有已加入频道
2. 从 `sessions.md` 中提取已知的 thread entries
3. 每 5 分钟刷新一次（可配置）
4. 提供 `resolveChannelName(name)` 和 `lookupChannelType(chatId)` 方法

### 2.2 SessionIdentity 重构

```typescript
// 新的 SessionIdentity（向后兼容旧格式）
interface SessionIdentity {
  // 保持现有字段
  profileId: string;
  providerId: string;
  scopeType: "channel" | "thread";
  scopeTarget: string;        // channel ID
  threadTs?: string;
  projectDir?: string;
  
  // 新增字段
  platform?: string;          // "slack"（预留多平台）
  chatName?: string;          // "#chorusgate_v4"
  chatType?: string;          // "channel" | "dm" | "group"
  userId?: string;            // 发送者 user ID（用于 per-user 隔离）
  userName?: string;          // 发送者名
  parentChannelId?: string;   // 父频道（thread 时）
  messageId?: string;         // 触发消息 ts
}

// 新的 session key 格式（参考 Hermes build_session_key）
// channel: {profileId}:{platform}:channel:{chatId}[:{userId}]
// thread:  {profileId}:{platform}:thread:{chatId}:{threadTs}  (共享)
// dm:      {profileId}:{platform}:dm:{chatId}[:{threadTs}]
```

### 2.3 Session Context 注入

**新文件**: `src/session-context.ts`

```typescript
interface SessionContextInfo {
  identity: SessionIdentity;
  channelName: string;
  channelType: string;
  userName: string;
  connectedProfiles: string[];
  homeChannel?: { id: string; name: string };
}

function buildSessionContextPrompt(ctx: SessionContextInfo): string {
  return [
    `## Current Session Context`,
    ``,
    `**Source:** Slack (${ctx.channelName})`,
    `**Channel type:** ${ctx.channelType}`,
    `**Session scope:** ${ctx.identity.scopeType}`,
  ].join("\n");
}
```

**注入点**: `buildPrompt()` 在 `src/gateway.ts` 中构造 prompt 时，在 system 消息中注入。

### 2.4 异步回写支持

**问题**: 长任务（如 codex exec 运行 10 分钟）完成后，需要知道回写到哪个频道/线程。

**方案**: SessionIdentity 的完整路由信息序列化后传入 agent 的 system prompt：

```typescript
// 在 buildPrompt 中注入
const routingContext = [
  ``,
  `## Async Reply Routing`,
  `If you need to post results asynchronously, use these identifiers:`,
  `- Channel ID: ${event.channel}`,
  `- Thread TS: ${replyThreadTs || "(none - reply in channel)"}`,
  `- Profile: ${profileId}`,
  `- You can use the send_message MCP tool with these IDs.`,
].join("\n");
```

**MCP 工具支持**: 现有 `send-message.ts` 和 `reply.ts` 工具已接受 `channel` 和 `thread_ts` 参数。Agent 可以在长任务中通过 MCP 工具异步回写。

### 2.5 持久化升级

**从 Markdown 到 JSON**:

```typescript
// 新文件: memory/sessions.json
interface SessionStoreData {
  version: 1;
  updatedAt: string;
  sessions: Array<{
    key: string;              // session key
    sessionId: string;        // Claude UUID / Codex thread_id
    identity: SessionIdentity;
    started: boolean;
    lastUsed: string;         // ISO timestamp
    // 新增: 路由元数据
    origin?: {
      channelId: string;
      channelName: string;
      threadTs?: string;
      userId?: string;
      userName?: string;
    };
  }>;
}
```

**迁移策略**:
1. 启动时读 `memory/sessions.md`（旧格式）
2. 如果存在，转换为 JSON 并写入 `memory/sessions.json`
3. 后续只读写 JSON
4. 保留 `sessions.md` 为只读备份（或 `.bak`）

### 2.6 实现范围

#### Phase 1（本次开发）:
- [ ] 新增 `channel-directory.ts` - 频道发现 + JSON 持久化
- [ ] `SessionIdentity` 增加 platform/chatName/chatType/userId 字段
- [ ] `buildPrompt()` 注入 session context
- [ ] `session-store.ts` 增加 JSON 持久化 + 旧格式迁移
- [ ] 异步回写路由信息注入 system prompt

#### Phase 2（后续迭代）:
- [ ] `send-message` 工具支持从 channel directory 解析频道名
- [ ] per-user session 隔离配置
- [ ] channel directory 定时刷新
- [ ] `/cc_channels` slash command 查看可达频道列表

### 2.7 新增文件清单

```
src/
  channel-directory.ts      # 频道目录管理
  session-context.ts       # Session context 构建 + prompt 注入
memory/
  channel-directory.json   # 频道目录持久化
  sessions.json            # Session 映射持久化（新）
  sessions.md              # 旧格式（迁移后保留为 .bak）
```

### 2.8 修改文件清单

```
src/
  session-store.ts         # 增加 JSON 持久化 + identity 扩展
  gateway.ts               # 注入 session context + channel directory 构建
  types.ts                 # SessionIdentity 相关类型扩展
```

### 2.9 验收标准

- [ ] `memory/channel-directory.json` 能正确列出所有已加入的 Slack 频道
- [ ] Thread 消息能正确映射到对应 session
- [ ] Agent 收到的 prompt 包含 session context（频道名、类型、用户）
- [ ] Agent 能通过 MCP 工具异步回写到指定频道/线程
- [ ] 旧的 `sessions.md` 格式能自动迁移到 `sessions.json`
- [ ] 现有的 session resume 行为不受影响
- [ ] `npm run build` 通过

## 3. 优先级

**P1** - 架构基础设施。其他 issue（#128 智能回复、#129 中间输出）的异步回写都依赖此映射。建议在 #127/#130 修复后优先实施。

## 4. 依赖关系

```
#132 (session map 重构)
  ├─ 阻塞 → #128 Phase 2 (异步回写判断)
  ├─ 阻塞 → #129 (中间结果异步发送)
  └─ 关联 → #130 (timeout reset 需要知道 session 状态)
  
#127 (codex resume) → 独立修复，不依赖 #132
#131 (msg_too_long) → 独立修复，不依赖 #132
```

## 5. 开发顺序建议

1. **#127** (P0, codex resume) - 独立修复，立即让小克做
2. **#131** (P1, msg_too_long) - 独立修复，可与 #127 并行
3. **#130** (P0, timeout reset) - 独立修复，可与 #127 并行
4. **#132** (P1, session map) - 架构重构，需较长时间
5. **#129** (P1, 中间输出) - 依赖 #132 的异步回写路由
6. **#128** (P1, 智能回复) - Phase 1 独立，Phase 2 依赖 #132
