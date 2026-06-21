---
title: ChorusGate v4 用户手册
author: Claude Code（小克）
date: 2026-06-21
audience: 用户 / 运维
branch: v4/unified-stream
---

# ChorusGate v4 用户手册

> 适用版本：v4（迭代四交付）
> 最后更新：2026-06-21

---

## 一、系统概述

ChorusGate 是一个多 AI agent 协作网关，通过 Slack 接入 Claude Code 和 Codex CLI，让用户在同一 Slack 工作平面中与多个 AI agent 协作。

当前已支持的 agent：
- **小克 (Claude Code)** — 高保真流式输出，token 级实时推流，支持 Extended Thinking
- **小扣 (Codex)** — 回合级流式输出，默认沙箱模式保护文件系统

---

## 二、Slack 命令

### 2.1 /stop — 终止运行中的 agent

**用途**：终止当前频道正在运行的 agent 进程。

**命令格式**：
```
/cc_stop
/stop
/cancel
/kill
```

四个 alias 等价，任选其一。

**行为**：
- 如果当前频道有 agent 正在处理，立即终止进程
- 如果没有正在运行的 agent，返回友好提示
- 不等待 agent 确认（fire-and-forget）
- 不需要审批确认

**示例**：
```
/cc_stop
→ "No running agent in this channel."  (无运行进程)
→ "Agent process terminated."          (已终止)
```

---

## 三、环境变量配置

### 3.1 GATEWAY_CODEX_APPROVAL_MODE

控制 Codex CLI 的文件系统安全模式。

| 值 | 行为 | CLI flag |
|----|------|---------|
| `sandbox`（默认）| 限制文件操作在 workspace 内 | `-s workspace-write` |
| `bypass` | 允许任意文件操作（不安全） | `--dangerously-bypass-approvals-and-sandbox` |

**配置方式**：在 `.env` 文件中设置：
```bash
GATEWAY_CODEX_APPROVAL_MODE=sandbox
```

### 3.2 其他环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `CLAUDE_STREAM_PARTIAL` | 启用 token 级增量流式 | `true` |
| `CLAUDE_SHOW_THINKING` | 展示 Extended Thinking | `true` |
| `CLAUDE_SHOW_METRICS` | 消息末尾展示 cost/token | `true` |
| `CODEX_MODEL` | Codex 默认模型 | 系统默认 |
| `GATEWAY_PROFILES` | 多 Slack App profile 配置 | — |

---

## 四、DurableEventStore — 事件持久化

### 4.1 功能说明

Gateway 自动将每个 Slack 事件的处理状态持久化到 `memory/events.md`，支持：
- **去重**：同一个 Slack 事件不会重复处理
- **重启恢复**：Gateway 崩溃重启后自动找回未完成的事件
- **状态跟踪**：每个事件有完整的 lifecycle 记录

### 4.2 状态机

```
pending → processing → replied  (正常完成)
                     → failed   (处理失败，进入 retry queue)
```

### 4.3 存储格式

`memory/events.md` 是 markdown table，可直接 `cat` 查看：
```
| ts | event_id | state | provider | channel | user | text_snippet |
```

### 4.4 运维命令

目前为自动管理，无需手动干预。启动时自动：
- 重放 pending + stale processing 事件
- Evict 超过 200 条的旧 replied 记录

---

## 五、Codex 沙箱模式

### 5.1 安全边界

默认 `sandbox` 模式下，Codex CLI 的文件操作限制在 workspace 内：
- ✅ 允许：workspace 内读写
- ❌ 阻止：`/etc`、`~/.ssh`、Windows 系统目录等敏感路径

### 5.2 何时使用 bypass

仅在以下场景考虑 `GATEWAY_CODEX_APPROVAL_MODE=bypass`：
- 需要在 workspace 外读取配置文件
- 调试阶段需要完全放开限制

> ⚠️ bypass 模式跳过所有安全控制，生产环境不建议使用。

---

## 六、StreamUpdate 流式输出

### 6.1 事件类型

Gateway 将 agent 输出统一为 11 种 StreamUpdate 事件：

| 事件 | 说明 | Claude | Codex |
|------|------|--------|-------|
| `text` | 文本增量（token 级） | ✅ | ✅ (回合级) |
| `thinking` | Extended Thinking 内容 | ✅ | ❌ |
| `tool_call` | 工具调用开始 | ✅ | ✅ |
| `tool_result` | 工具调用结果 | ✅ | ❌ |
| `tool_param` | 工具参数增量 | ✅ | ❌ |
| `permission_request` | 权限请求 | ✅ | ❌ |
| `progress` | 进度更新 | ✅ | ✅ |
| `metrics` | token/cost 统计 | ✅ | ✅ |
| `session_id` | 会话 ID | ✅ | ✅ |
| `error` | 错误事件 | ✅ | ✅ |
| `done` | 完成 | ✅ | ✅ |

### 6.2 展示效果

- **文本**：实时推送到 Slack thread，1000ms 防抖刷新
- **Thinking**：折叠展示在 thread 中（Claude 专有）
- **工具调用**：展示工具名 + 参数摘要
- **Metrics**：消息末尾脚注：`📊 Tokens: 1,234 in / 567 out | Cost: $0.12`

---

## 七、故障排查

### 7.1 Gateway 崩溃恢复

自动机制：
1. 重启时 `getReplayable()` 找回 pending + stale processing 事件
2. 正常事件重新处理，stale（>5 min）事件重新入队
3. `isDedup()` 防止已完成的 replied 事件重复处理

### 7.2 常见问题

| 问题 | 排查方向 |
|------|---------|
| agent 无响应 | `/cc_stop` 终止后重试 |
| Codex 行为异常 | 检查 `GATEWAY_CODEX_APPROVAL_MODE` 是否设为 `sandbox` |
| 事件重复处理 | 检查 `memory/events.md`，确认去重是否生效 |
| 测试超时 | 运行 `npm run test:fast` 先做快速检查 |

### 7.3 日志

Gateway 日志输出到 stdout，关键事件：
- `[DurableEventStore]` — 事件状态变更
- `[StreamUpdate]` — 流式事件
- `[stop]` — 进程终止

---

## 八、开发相关

### 8.1 测试命令

```bash
npm test                  # 快速测试 (~5s)
npm run test:integration  # 全量集成测试 (~87s)
npm run test:all          # 全部测试
npx tsc --noEmit          # TypeScript 类型检查
```

### 8.2 项目结构

```
src/
├── gateway.ts              # 网关主程序
├── providers/              # Agent 适配层
│   ├── claude.ts           # Claude Code CLI
│   ├── claude-stream.ts    # Claude stream-json
│   ├── codex.ts            # Codex CLI
│   ├── codex-parser.ts     # Codex JSONL 解析
│   └── types.ts            # StreamUpdate 类型
├── durable-event-store.ts  # 持久事件 Store
├── session-commands.ts     # Slack 命令处理
├── session-store.ts        # 会话持久化
└── tools/                  # MCP tools
```

---

*生成日期：2026-06-21*
*整理：Claude Code（小克）*
