# docs/

产品文档索引。所有文档中文撰写，面向后续维护者。

规划中的特性文档顶部有 `> 状态：规划中` 标注，与已实现功能文档明确区分。

## 已实现功能

| 文档 | 内容 |
|------|------|
| [architecture.md](./architecture.md) | 架构总览：两种模式、数据流、目录结构、核心决策 |
| [feature-auto-reply.md](./feature-auto-reply.md) | 自动回复：触发条件、回复流程、session 复用、并发控制、prompt 策略 |
| [feature-session-management.md](./feature-session-management.md) | Session 管理：slash command、sessions.md 存储、为什么不读 jsonl |
| [feature-live-progress.md](./feature-live-progress.md) | 实时进度提示：占位消息、心跳、stream-json 解析、工具标签 |
| [feature-gateway-lifecycle.md](./feature-gateway-lifecycle.md) | Gateway 生命周期：start/stop/restart/status/list、控制文件、idle eviction |
| [feature-mcp-server.md](./feature-mcp-server.md) | MCP server 模式：tools、sender-only、配置方式 |
| [gotchas.md](./gotchas.md) | 调试踩坑记录：13 个实测故障及修复方案 |

## 规划中特性

> 以下文档描述尚未实现的规划，每篇文档顶部有 `状态：规划中` 标注。

| 文档 | 内容 |
|------|------|
| [feature-slack-commands.md](./feature-slack-commands.md) | Slack command 增强：/stop /retry /model /agents /restart /update 等规划命令 |
| [feature-install-lifecycle.md](./feature-install-lifecycle.md) | 安装生命周期：一键安装脚本、Claude Code CLI 检测、系统服务注册（Task Scheduler/launchd/systemd）|
| [feature-feishu.md](./feature-feishu.md) | 飞书支持：Platform 抽象层、飞书长连接接入、MCP Tools、token 管理 |

## 版本规划

| 文档 | 内容 |
|------|------|
| [roadmap.md](./roadmap.md) | v2 规划方向 + 近期未完成 + 永久否决方案 |
