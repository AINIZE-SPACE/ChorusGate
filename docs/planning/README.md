# planning/

> 本目录存放尚未实现的规划文档，与 `docs/` 根目录下已实现功能文档明确区分。
> 每篇文档顶部有 `> 状态：规划中` 标注。

## 规划文档

### v3: 多 Agent 多项目网关

| 文档 | 内容 | 优先级 |
|------|------|--------|
| [v3-epic.md](./v3-epic.md) | v3 EPIC 总览：多 Agent + 多 Slack App + 多项目 | — |
| [v3-story-1-provider-abstraction.md](./v3-story-1-provider-abstraction.md) | Agent Provider 抽象层 | P0 |
| [v3-story-2-codex-provider.md](./v3-story-2-codex-provider.md) | Codex Provider 实现 | P0 |
| [v3-story-3-multi-slack-app.md](./v3-story-3-multi-slack-app.md) | 多 Slack App Socket Mode | P0 |
| [v3-story-4-multi-project.md](./v3-story-4-multi-project.md) | 会话级多项目支持 | P1 |
| [v3-story-5-session-model.md](./v3-story-5-session-model.md) | 统一 Session 模型（CC + Codex）| P0 |
| [v3-story-6-config-system.md](./v3-story-6-config-system.md) | 多 Agent/多 App 配置系统 | P0 |
| [v3-story-7-codex-slack-tools.md](./v3-story-7-codex-slack-tools.md) | Codex Slack MCP Tools | P1 |
| [v3-story-8-claude-stream-json.md](./v3-story-8-claude-stream-json.md) | :zap: Claude 双向 stream-json 控制面 — approve/deny 交互 | P0 |
| [v3-review-response.md](./v3-review-response.md) | v3 设计评审回复 + 里程碑重排 | — |

### v2 及通用规划

| 文档 | 内容 | 优先级 |
|------|------|--------|
| [feature-slack-commands.md](./feature-slack-commands.md) | Slack command 增强：/stop /retry /model /agents /bg /restart /update /approve | 高 |
| [feature-install-lifecycle.md](./feature-install-lifecycle.md) | 安装生命周期：一键安装脚本、Claude CLI 检测、系统服务注册 | 高 |
| [feature-feishu.md](./feature-feishu.md) | 飞书支持：Platform 抽象层、FeishuPlatform、MCP Tools | 中 |
| [architecture-boundaries.md](./architecture-boundaries.md) | 架构边界分析 | 参考 |
| [product-positioning.md](./product-positioning.md) | 产品定位文档 | 参考 |
| [runtime-adapters.md](./runtime-adapters.md) | 运行时适配器方案 | 参考 |
| [tracking.md](./tracking.md) | 追踪/日志方案 | 参考 |
| [version-planning-2026-06.md](./version-planning-2026-06.md) | 版本规划（2026-06）| 参考 |
| [../reference/ccpocket.md](../reference/ccpocket.md) | CC Pocket Bridge/App 参考分析 | 参考 |
| [../reference/notification-templates.md](../reference/notification-templates.md) | 本项目频道/成员 ID + Slack mention 语法 (通用模板已迁至 dev-e2e-skills) | 参考 |

## 与已实现文档的关系

- 已实现功能文档在 [`../`](../) 根目录（`feature-*.md`）
- 当规划特性开发完成后，文档从本目录移到 `../`，去掉"规划中"标注
