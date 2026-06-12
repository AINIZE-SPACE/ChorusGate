# STORY-6: 多 Agent/多 App 配置系统

> 状态：规划中 | Epic: [v3 EPIC](./v3-epic.md) | 优先级：P0 | 依赖：STORY-3, STORY-4

## 问题

当前 `.env` 只有一组 token + 全局配置。多 agent 多 app 需要结构化的 profile 配置。

## 方案

### Profile 配置模型

```env
# ---- Profiles ----
# 逗号分隔的 profile ID 列表
GATEWAY_PROFILES=cc,codex

# ---- CC Profile ----
SLACK_BOT_TOKEN_CC=xoxb-cc-bot-token
SLACK_APP_TOKEN_CC=xapp-cc-app-token
GATEWAY_PROVIDER_CC=claude
GATEWAY_CWD_CC=E:\project-a

# ---- Codex Profile ----
SLACK_BOT_TOKEN_CODEX=xoxb-codex-bot-token
SLACK_APP_TOKEN_CODEX=xapp-codex-app-token
GATEWAY_PROVIDER_CODEX=codex
GATEWAY_CWD_CODEX=E:\project-b
# Optional where supported; Codex may also use local ChatGPT/Codex login.
CODEX_API_KEY=...

# ---- 全局 ----
GATEWAY_MAX_CONCURRENT=5
GATEWAY_REPLY_TIMEOUT_MS=180000
GATEWAY_SESSION_SCOPE=channel
```

### Profile 解析器

```typescript
interface Profile {
  id: string;
  botToken: string;
  appToken: string;
  providerId: string; // "claude" | "codex"
  cwd?: string;
  slackAppName?: string; // Slack app 的 display_name
}

function parseProfiles(): Profile[] {
  const ids = (process.env.GATEWAY_PROFILES || "default").split(",").map(s => s.trim());
  return ids.map(id => ({
    id,
    botToken: getEnv(`SLACK_BOT_TOKEN_${id.toUpperCase()}`) || getEnv("SLACK_BOT_TOKEN"),
    appToken: getEnv(`SLACK_APP_TOKEN_${id.toUpperCase()}`) || getEnv("SLACK_APP_TOKEN"),
    providerId: getEnv(`GATEWAY_PROVIDER_${id.toUpperCase()}`) || "claude",
    cwd: getEnv(`GATEWAY_CWD_${id.toUpperCase()}`),
  }));
}
```

### 向后兼容

- 旧配置（无 `GATEWAY_PROFILES`）：默认单个 `default` profile，token 从 `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` 取，provider = `claude`
- 新配置：显式声明 `GATEWAY_PROFILES`，每个 profile token 带后缀

### gateway.ts 启动日志

```
[gateway] loading 2 profiles: cc(claude), codex(codex)
[gateway] profile 'cc': Socket Mode connecting to Slack (app: ClaudeCodeApp)
[gateway] profile 'codex': Socket Mode connecting to Slack (app: CodexApp)
[gateway] listening on 2 Slack apps. Ctrl+C to stop.
```

## 验收标准

- [ ] 支持多 profile 配置
- [ ] 单 profile（旧配置）行为不变
- [ ] 每个 profile 独立 Socket Mode 连接
- [ ] `GATEWAY_PROFILES` 为空时默认 `default` profile
