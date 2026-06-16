# ChorusGate docs/

> 产品文档索引。所有文档中文撰写，面向后续维护者。

## 架构

| 文档 | 内容 |
|------|------|
| [architecture.md](./architecture.md) | 架构总览：两种模式、数据流、目录结构、核心决策 |
| [gotchas.md](./gotchas.md) | 调试踩坑记录 |
| [roadmap.md](./roadmap.md) | 版本规划方向 |

## 已实现功能 ([spec/](./spec/README.md))

| 文档 | 功能 |
|------|------|
| [auto-reply.md](./spec/auto-reply.md) | 自动回复：触发条件、session 复用、并发控制 |
| [gateway-lifecycle.md](./spec/gateway-lifecycle.md) | Gateway 生命周期：start/stop/restart/status/list |
| [live-progress.md](./spec/live-progress.md) | 实时进度提示：占位消息、stream-json 解析 |
| [mcp-server.md](./spec/mcp-server.md) | MCP server 模式：Web API tools、配置 |
| [session-management.md](./spec/session-management.md) | Session 管理：slash command、sessions.md、路由 |

## 规划中 ([planning/](./planning/README.md))

| 文档 | 内容 |
|------|------|
| [v4-story-8-stream-incremental.md](./planning/v4-story-8-stream-incremental.md) | M3 增量流式 (#85) |
| [v4-story-8-unified-approval.md](./planning/v4-story-8-unified-approval.md) | 统一审批方案 (#84) |
| [v4-story-8-unified-streaming.md](./planning/v4-story-8-unified-streaming.md) | 统一 StreamUpdate 接口 (#86) |
| [feature-feishu.md](./planning/feature-feishu.md) | 飞书支持 |
| [feature-install-lifecycle.md](./planning/feature-install-lifecycle.md) | 安装生命周期 |
| [feature-slack-commands.md](./planning/feature-slack-commands.md) | Slack command 增强 |

## 参考资料 ([reference/](./reference/))

| 文档 | 内容 |
|------|------|
| [v3-stories/](./reference/v3-stories/) | v3 已完成设计文档 (12 篇) |
| [hermes-agent-analysis.md](./reference/hermes-agent-analysis.md) | Hermes Agent 源码借鉴分析 |
| [ccpocket.md](./reference/ccpocket.md) | CC Pocket 参考架构 |

## 评审记录 ([reviews/](./reviews/README.md))

| 目录 | 内容 |
|------|------|
| [v3/2026-06-12-hermes-review.md](./reviews/v3/2026-06-12-hermes-review.md) | v3 第一轮评审 |
| [v3/2026-06-13-hermes-review.md](./reviews/v3/2026-06-13-hermes-review.md) | v3 第二轮评审 |

## 测试方案 ([tests/](./tests/README.md))

| 目录 | 内容 |
|------|------|
| [v3/](./tests/v3/) | v3 Issue 跟踪 |
| [plans/](./tests/plans/) | 测试计划 |
| [cases/](./tests/cases/) | 测试用例 |

## 迭代报告 ([reports/](./reports/README.md))

| 文档 | 类型 | 作者 |
|------|------|------|
| [v3/sprint-3-daily-claude.md](./reports/v3/sprint-3-daily-claude.md) | 日报 | 小克 |
| [v3/sprint-3-daily-hermes.md](./reports/v3/sprint-3-daily-hermes.md) | 日报 | 小马 |
| [v3/sprint-3-retrospective.md](./reports/v3/sprint-3-retrospective.md) | 迭代回顾 | — |
| [v3/sprint-3-retrospective-roles.md](./reports/v3/sprint-3-retrospective-roles.md) | 角色复盘 | 全角色 |
