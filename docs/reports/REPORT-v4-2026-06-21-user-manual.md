---
title: ChorusGate 迭代四功能用户手册
author: 小扣（文档整合）
date: 2026-06-21
branch: v4/unified-stream
---

# ChorusGate 迭代四功能用户手册

> **适用版本**: ChorusGate v4 (分支 `v4/unified-stream`)
> **目标用户**: 使用 ChorusGate 与 AI agent 在 Slack 中协作的所有用户
> **日期**: 2026-06-21

---

## 一、/stop 命令 — 终止运行中的 Agent

### 1.1 这是什么

当你发送消息后，agent 开始执行任务但进入死循环或执行时间过长时，`/stop` 命令让你**立即终止**该 agent 进程，而不需要等待 timeout。

### 1.2 如何使用

在 ChorusGate 所在频道或 thread 中输入：

```
/cc_stop
```

或使用别名（无需 prefix）：

```
/stop
```

### 1.3 工作原理

```
你输入 /cc_stop
    |
    v
Gateway 检查该 channel/thread 是否有正在运行的 agent 进程
    |
    v
有进程 -> 立即终止 -> 回复 "Stopping agent process..."
无进程 -> 回复 "No running agent process found."
```

### 1.4 常见问题

| Q | A |
|---|---|
| 误操作了怎么办？ | 重新发消息即可，agent 会重新启动一个新的 session |
| 可以停止其他 channel 的进程吗？ | 不可以，每个 channel 的进程独立隔离 |
| 它和 timeout 有什么区别？ | timeout 需要等满设定的秒数；/stop 立即生效 |

---

## 二、StreamUpdate — 实时看到 Agent 思考过程

### 2.1 这是什么

当你向 agent 发送任务后，现在可以在 Slack 中**实时看到**：

- **思考过程**（Extended Thinking）—— agent 在推理时的中间步骤
- **回复增量**—— agent 正在一个字一个字地回复你
- **成本和 Token 统计**—— 任务完成后的资源消耗

### 2.2 效果展示

**开启前（v3 模式）**

```
[小马]: 帮我写一个快排
[Agent]: (等待 30 秒后...)
[Agent]: 最终回复: "这是一个快速排序的实现..."
```

**开启后（v4 StreamUpdate 模式）**

```
[小马]: 帮我写一个快排
[Agent]: 思考中...
[Agent]: 回复中... quicksort() {
[Agent]: 回复中...   if (arr.length <= 1) return arr;
[Agent]: 消耗: 12523 input / 89 output tokens / $0.04
```

### 2.3 环境变量控制

| 功能 | 环境变量 | 默认值 | 说明 |
|------|---------|--------|------|
| 增量消息展示 | `CLAUDE_STREAM_PARTIAL` | `false` | 设为 `true` 开启 |
| Extended Thinking 展示 | `CLAUDE_SHOW_THINKING` | `false` | 设为 `true` 显示思考块 |
| 成本/Token 统计 | `CLAUDE_SHOW_METRICS` | `false` | 设为 `true` 显示脚注 |

> 注意：这些功能默认关闭，以保持与旧 CLI 版本的兼容性。

### 2.4 技术原理

```
你的消息 -> Gateway -> Claude CLI (-p stream-json)
    --include-partial-messages  <- 开启 token 级增量
    --include-hook-events       <- 开启 hook 生命周期事件
Gateway 解析增量事件 -> 防抖 (1000ms) -> Slack 消息更新
```

---

## 三、DurableEventStore — 会话状态持久化

### 3.1 这是什么

即使 ChorusGate 进程重启，之前对话的 event 状态会被**持久化**到磁盘，重启后可以恢复，不需要重新开始对话。

### 3.2 何时生效

- Gateway 进程异常退出后重启
- 系统维护重启
- 网络抖动导致连接断开后重连

### 3.3 事件去重与重放

- **去重**：相同 event ID 不会重复处理，防止网络重传导致的双重执行
- **重放**：重启后可从断点继续，不丢失上下文

---

## 四、Codex 沙箱模式 — 更安全的 Codex 执行

### 4.1 这是什么

之前 Codex 执行使用 `--dangerously-bypass-approvals-and-sandbox`，完全绕过安全审批和沙箱限制。现在可以用沙箱模式限制 Codex 的文件写入范围。

### 4.2 如何配置

在 `.env` 中设置：

```bash
# 沙箱模式（workspace 目录内写入，文件操作受限）
GATEWAY_CODEX_APPROVAL_MODE=sandbox

# 绕过模式（旧行为，不推荐）
GATEWAY_CODEX_APPROVAL_MODE=bypass
```

### 4.3 两种模式对比

| 维度 | sandbox 模式 | bypass 模式 |
|------|-------------|-------------|
| 文件写入 | 限制在 workspace 内 | 无限制 |
| 工具审批 | 依赖 CLI 自身 | 全部跳过 |
| 安全性 | **高** | 低 |
| 推荐场景 | **生产环境** | 本地调试 |

### 4.4 沙箱边界

`-s workspace-write` 模式下：
- shell 命令可以执行
- 文件写入限制在当前工作目录（workspace）内
- 无法访问 workspace 以外的系统路径

---

## 五、测试通过验证

如果你想自己运行测试验证功能正常，在项目目录下执行：

```bash
# 快速单元测试（10 秒）
npm run test:fast

# 完整集成测试（88 秒，包含所有 ST）
npm run test:integration

# 构建验证
npm run build
```

**当前状态**: 141/141 测试全绿，0 错误。

---

## 六、已知限制

| 功能 | 限制 | 解决方案 |
|------|------|---------|
| StreamUpdate Codex 路径 | Codex CLI 不支持 token 级增量，只有回合级事件 | Gateway 按"可选存在"消费，Claude 有完整增量，Codex 降级为回合级 |
| Codex 审批 | Codex CLI v0.139.0 不支持 stdin 双向审批协议 | 使用沙箱模式（sandbox）作为安全替代 |
| StreamUpdate Slack E2E | 需要真实的 Slack Socket Mode 连接才能验证 placeholder 更新 | 已在真实 Claude 进程验证事件链正确性 |
| /stop 进程查找 | 当 `GATEWAY_SESSION_SCOPE=thread` 时，slash command 的 thread scope 键可能不匹配 | 见设计缺陷记录，后续迭代修复 |

---

## 七、快速参考

### 常用命令

| 操作 | 命令 |
|------|------|
| 停止运行中的 agent | `/cc_stop` 或 `/stop` |
| 测试 agent 是否响应 | 发送任意消息 |

### 环境变量速查

| 变量 | 值 | 效果 |
|------|-----|------|
| `CLAUDE_STREAM_PARTIAL` | `true` | 开启回复增量展示 |
| `CLAUDE_SHOW_THINKING` | `true` | 开启思考过程展示 |
| `CLAUDE_SHOW_METRICS` | `true` | 显示成本/Token 统计 |
| `GATEWAY_CODEX_APPROVAL_MODE` | `sandbox` | Codex 沙箱安全模式 |

---

*整理：小扣 | 日期：2026-06-21*
*分支：v4/unified-stream*
