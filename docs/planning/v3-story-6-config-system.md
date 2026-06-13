# STORY-6: 多 Agent/多 App 配置系统

> 状态：规划中 | Epic: [v3 EPIC](./v3-epic.md) | 优先级：P0 | 依赖：STORY-3, STORY-4

## 问题

当前 `.env` 只有一组 token + 全局配置。多 agent 多 app 需要结构化的 profile 配置。

This story is also where Codex moves from "partial provider support" to a fully
isolated app profile. Prefix, manifest, and lifecycle settings should live here
instead of being inferred from runtime code.

The key rule is that `GATEWAY_COMMAND_PREFIX` should stay instance-level and
Slack-facing. It solves slash-command uniqueness inside a workspace, but the
gateway core should stay prefix-agnostic and reason in terms of profile id,
provider id, project dir, and lifecycle state.

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

Example instance shapes:

- One human, one Claude Code assistant, one Codex assistant:
  two Slack app profiles.
- One human, multiple Claude Code roles such as dev/test/manager:
  multiple Slack app profiles, even when the provider is the same.
- Prefixes such as `cc`, `cx`, or `cctest` are just workspace-safe command
  namespaces layered on top of those profiles.

### 向后兼容

- 旧配置（无 `GATEWAY_PROFILES`）：默认单个 `default` profile，token 从 `SLACK_BOT_TOKEN` / `SLACK_APP_TOKEN` 取，provider = `claude`
- 新配置：显式声明 `GATEWAY_PROFILES`，每个 profile token 带后缀

### gateway.ts 启动日志

```
[gateway] loading 2 profiles: cc(claude), codex(codex)
[gateway] profile 'cc': Socket Mode connecting to Slack (app: ChorusGate)
[gateway] profile 'codex': Socket Mode connecting to Slack (app: CodexApp)
[gateway] listening on 2 Slack apps. Ctrl+C to stop.
```

## 验收标准

- [ ] 支持多 profile 配置
- [ ] 单 profile（旧配置）行为不变
- [ ] 每个 profile 独立 Socket Mode 连接
- [ ] `GATEWAY_PROFILES` 为空时默认 `default` profile
