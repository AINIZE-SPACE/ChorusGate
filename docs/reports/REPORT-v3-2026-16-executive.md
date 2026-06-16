# ChorusGate v3 迭代执行报告

> **日期**: 2026-06-16 | **版本**: v3.0.0 | **状态**: 已交付

---

## 一句话总结

ChorusGate 从"单 Claude Code Slack bot"扩展为**支持多 AI agent、多 Slack App、多项目并行**的通用协作网关。Sprint 3 完成全部 Story 交付，91 个 Issues 关闭，代码合并至 main。

---

## 交付清单

### 核心能力

| 能力 | 说明 |
|------|------|
| 多 Agent | 同时支持 Claude Code + Codex，Provider 抽象层可扩展 |
| 多 Slack App | `SocketManager` 多实例，每 profile 独立连接 |
| 多项目 | `SessionIdentity` 结构化 key，`--project` flag |
| 双向审批 | Claudia stream-json 4-button approval (Allow Once/Session/Always/Deny) |
| 流式回复 | M3 增量流式，逐 token 更新 Slack |
| Codex 集成 | `codex exec --json` CLI 参数对齐 v0.139.0，session 映射 + resume |

### 数据

| 指标 | 数值 |
|------|------|
| Issues 关闭 | 91 |
| Commit | 35+ |
| PR | #53 (→dev), #92 (→main) |
| 新增模块 | 6 (profile-config, interrupt, plan-tracker, _spawn-helpers, claude-stream, claude-stream-parser) |
| 测试 | 全部通过 |

---

## 架构概览

```
Slack 消息 → Gateway (ChorusGate)
               ├── profile-config: 多 profile 路由
               ├── socket-manager: 多 Slack App 连接
               ├── session-store: 路由 meta
               └── reply-engine: Provider 选择
                      ├── Claude Code (小克, U0B8VHLHJAX)
                      └── Codex (小扣, U0BAGFVD8VB)
```

### 关键设计

- Gateway = 代理层，无独立人设
- 身份由 Provider 决定：CC → `CLAUDE.md`，CX → `AGENTS.md`
- Session 数据归 Provider：CC → `~/.claude/projects/`，CX → `~/.codex/sessions/`
- Gateway 只存路由 meta：`memory/sessions.md`

---

## 风险与改进

### 已解决

| 风险 | 措施 |
|------|------|
| Socket Mode 多连接分流 | `chorusgate-mcp`：MCP_SENDER_ONLY=1 |
| Windows shell 转义 | prompt 走 stdin，双引号 `\"` 转义 |
| Codex 无限迭代 | `-c max_iterations=10` |
| stream-json stdin 挂死 | `onResult` 关闭 stdin |
| DM 回复跑偏 | `channel_type=im` 时不设 `thread_ts` |

### 待改进

| 问题 | 计划 |
|------|------|
| 流式未完全覆盖 Codex | #86 v4-story-8 |
| Codex 审批无法网关拦截 | #84 v4-story-8 |
| Session worktree 隔离 | #33 v4 |
| 自测纪律 | 已写入 sprint-handoff 技能 |

---

## 下一迭代 (v4)

| 优先级 | 项目 | Issue |
|------|------|------|
| P1 | Session worktree isolation | #33 |
| P1 | 统一 CC + Codex StreamUpdate | #86 |
| P1 | 统一审批方案 | #84 |
| P2 | Feishu/Lark channel support | #7 |
| P2 | Install/doctor lifecycle | #9 |

---

## 资源

- 架构文档: `docs/architecture.md`
- 回顾文档: `docs/reports/sprint-3-retrospective.md`
- 按角色复盘: `docs/reports/sprint-3-retrospective-roles.md`
- v3 故事: `docs/reference/v3-stories/`
- v4 规划: `docs/planning/`
