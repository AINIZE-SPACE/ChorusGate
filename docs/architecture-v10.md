# V10 架构定位

> 本文档用中文概括 ChorusGate 在 Iteration 10 / V10 阶段的架构边界。详细来源见 `docs/planning/iteration-10-sdd/intent.md`、`constitution.md`、`spec.md` 与 `chorusgate-direction.md`。

## 定位与边界

### ChorusGate 是什么

- **本地协调边界（Local Coordination Boundary）**：位于 Channel（人）与 Runtime（数字员工）之间，负责事件归一化、唤醒策略、任务信封、适配器调用、完成证据与注意力/投递的闭合。
- **控制平面制度试验田**：把 HRS 契约（Event → WakePolicy → TaskEnvelope → HarnessAdapter → Completion → Attention/Delivery）变成本地可观察、可评审的制度，而不是一个通用的组织管理产品。
- **只读观察面**：V10 阶段通过 `src/v10/` 提供 Web API 与页面，仅展示确定性 fixture 数据，不修改运行时状态，也不调用外部服务。

### 明确不是

依据 `intent.md` 的非目标：

- 不是运行时自身的推理、记忆、调度、工具或副作用容器。
- 不是通用控制面、HR/绩效平台、知识库、IAM 层或云平台。
- 不实现新传输、新登录/凭证、外部服务调用或生产运维。
- 不创建/修改 Trello/GitHub Issues，除非单独授权。

## 核心循环六环

```text
┌─────────┐    ┌───────────┐    ┌─────────────┐    ┌────────────────┐    ┌────────────┐    ┌──────────────────┐
│ Event   │ -> │ WakePolicy│ -> │ TaskEnvelope│ -> │ HarnessAdapter │ -> │ Completion │ -> │ Attention/Delivery│
└─────────┘    └───────────┘    └─────────────┘    └────────────────┘    └────────────┘    └──────────────────┘
```

| 环节 | 职责 | 当前代码对应 |
| --- | --- | --- |
| Event | 接收并归一化 Slack/Channel 事件 | `src/socket-manager.ts`, `src/event-store.ts`, `src/slack-message.ts` |
| WakePolicy | 决定事件是否值得唤醒一次任务 | `src/shouldReply.ts`, `src/message-handlers.ts` |
| TaskEnvelope | 把任务封装为带权威、范围、验收标准的信封 | `src/types.ts`, `src/session-context.ts` |
| HarnessAdapter | 在运行时隔离边界内执行 | `src/providers/`（Claude/Codex 适配器） |
| Completion | 记录终端完成状态与证据 | `src/session-store.ts`, `src/durable-event-store.ts` |
| Attention/Delivery | 把结果递交给人或 Channel | `src/slack-message.ts`, `src/reply-engine.ts`, MCP `tools/` |

## 模块边界

```text
Channels          Gateway                         Runtimes
  Slack  <---->  gateway.ts / socket-manager.ts  <---->  Hermes / OpenClaw / Codex / Claude
                 shouldReply.ts    （唤醒策略）              ^
                 session-store.ts  （会话/状态）             │ 通过 HarnessAdapter
                 v10/              （只读观察面）             │
```

### `src/` 职责分层

| 分组 | 文件 | 一句话职责 |
| --- | --- | --- |
| 网关核心 | `gateway.ts`, `socket-manager.ts`, `shouldReply.ts`, `slack-message.ts`, `message-handlers.ts`, `user-identity.ts`, `bootstrap.ts` | Socket Mode 事件接收、回复决策、消息拆分与投递 |
| 会话/上下文 | `session-store.ts`, `session-context.ts`, `session-commands.ts`, `durable-event-store.ts`, `event-store.ts` | Session 生命周期、上下文构建、事件持久化 |
| 配置/环境 | `cli-args.ts`, `config-init.ts`, `config-migrate.ts`, `config-cli.ts`, `load-env.ts`, `profile-config.ts`, `agent-home.ts` | CLI 参数、agent profile、配置迁移 |
| 控制面 | `permission-tracker.ts`, `plan-tracker.ts`, `interrupt.ts`, `gateway-control.ts`, `liveness.ts`, `watchdog.ts`, `gateway-paths.ts`, `state-paths.ts` | 权限、计划、中断、进程守护、存活监控 |
| 运行时适配器 | `providers/claude.ts`, `providers/codex.ts`, `providers/types.ts`, 各 parser | Claude/Codex 流式执行适配 |
| MCP Tools | `tools/send-message.ts`, `tools/reply.ts`, `tools/channel-history.ts`, `tools/get-user.ts`, … | 外部 IDE/Claude Code 可调用的 Channel 工具 |
| V10 观察面 | `v10/types.ts`, `v10/fixture-adapter.ts`, `v10/employee-view.ts`, `v10/web-page.ts`, `v10/web-server.ts` | 只读 fixture 投影与本地 Web 服务 |

## 演进约束

1. **Hermes 上游依赖是常设约束**：ChorusGate 的 Slack 通道与网关语义需与 Hermes 主控/频道约定保持一致；本地改动不得反向要求 Hermes 修改其调度或记忆模型。
2. **优先插件/技能扩展，而非 fork**：新增运行时或 Channel 支持应通过新增 adapter/parser/tool 实现，避免修改核心网关循环。
3. **证据先于状态**：任何状态迁移、门禁通过或外部跟踪声明都必须附带可检查的证据路径（`constitution.md` Article 1）。
4. **无秘密持久化**：测试、探针、证据 artifact 中不得包含 API key、token、生产 Soul/gbrain/memory 数据（`review-g1.md`）。

## 演进路径

- **当前**：`gateway-final` 标签锁定完整网关快照；`src/v10/` 提供只读 fixture 观察面。
- **下一步（CG-I10-002 后）**：小马 在隔离环境中对 C1 `opencode-via-acpx` 运行 capability spike，证明 execute/push completion 行为、版本/许可证与限制。
- **ADR-0001**：小扣 依据 spike 证据决定运行时选择、拒绝项、correlation 命名空间、保留/隐私边界。
- **G4 之后**：小克 在单独授权的 TaskEnvelope 中实现契约观察/证据切片，保持运行时与 Zederer-IP 边界。

> 注：ADR-0001 与实现授权均 pending，当前代码库不含未授权的产品实现。
