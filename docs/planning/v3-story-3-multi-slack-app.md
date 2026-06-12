# STORY-3: 多 Slack App Socket Mode

> 状态：规划中 | Epic: [v3 EPIC](./v3-epic.md) | 优先级：P0 | 依赖：STORY-1

## 问题

当前 `socket-manager.ts` 只有一个 `SocketModeClient`，用一个 `SLACK_APP_TOKEN`。要同时监听 CC 和 Codex 两个 Slack app，需要多个连接。

## 方案

### 多实例架构

```
socket-manager.ts
  ┌─────────────────────────┐
  │  SocketManager          │
  │  clients: Map<appId, {  │
  │    client, appToken,    │
  │    botToken, providerId │
  │  }>                     │
  │                         │
  │  start(profile)         │
  │  startAll(profiles[])   │
  │  stop(appId)            │
  │  stopAll()              │
  └─────────────────────────┘
```

每个 Slack app profile 有：
- `appId`：内部标识（`"cc"` | `"codex"`）
- `appToken`：`xapp-` token
- `botToken`：`xoxb-` token
- `providerId`：对应哪个 AgentProvider
- `webClient`：独立的 WebClient 实例

### Token 命名规范

```env
# Profile: CC
SLACK_BOT_TOKEN_CC=xoxb-...
SLACK_APP_TOKEN_CC=xapp-...

# Profile: Codex
SLACK_BOT_TOKEN_CODEX=xoxb-...
SLACK_APP_TOKEN_CODEX=xapp-...
```

向后兼容：如果只设了 `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN`（无后缀），视为 `default` profile → 等同于现有行为。

### 事件路由

```
SocketManager 收到事件
  ↓ 标记来源 (appId: "cc" | "codex")
  ↓
Gateway.onEvent(event, providerId)
  ↓ 按 providerId 选 AgentProvider
  ↓
AgentProvider.createSession / resumeSession
```

### 关键约束

每个 Slack app → 一个 Socket Mode 连接 → 一个 `num_connections`。两个 app = 两个独立连接，**互不干扰**（Slack 不会把它们之间做负载均衡）。

这和"一个 app 有多个连接导致分流"的坑是**不同问题**——前者是同一 app 多连接，后者是不同 app。

### gateway.ts 适配

```typescript
// 从单 provider 改为多 provider
const providers = new Map<string, AgentProvider>();
providers.set("cc", new ClaudeProvider());
providers.set("codex", new CodexProvider());

// Socket Manager 启动时加载所有 profile
const profiles = parseProfiles(); // 从 env 解析 [{appId, appToken, botToken, providerId}]
for (const p of profiles) {
  await socketManager.start(p);
}
```

### 配置系统（STORY-6 详述）

```env
GATEWAY_PROFILES=cc,codex
```

## 验收标准

- [ ] 两个 SocketModeClient 同时运行，各自接收事件
- [ ] CC Slack app 的事件 → ClaudeProvider 处理
- [ ] Codex Slack app 的事件 → CodexProvider 处理
- [ ] 互不干扰，事件不混淆
- [ ] 单 profile（无后缀 token）向后兼容
