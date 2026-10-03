# V10 架构定位

> 本文档用中文概括 ChorusGate 在 Iteration 10 / V10 阶段的架构边界。详细来源见 `docs/planning/iteration-10-sdd/intent.md`、`constitution.md`、`spec.md` 与 `docs/planning/chorusgate-direction.md`。

## 定位与边界

### ChorusGate 是什么

- **本地协调边界（Local Coordination Boundary）**：位于 Channel（人）与 Runtime（数字员工）之间，负责事件归一化、唤醒策略、任务信封、适配器调用、完成证据与注意力/投递的闭合。
- **控制平面制度试验田**：把 HRS 契约（Event → WakePolicy → TaskEnvelope → HarnessAdapter → Completion → Attention/Delivery）变成本地可观察、可评审的制度，而不是一个通用的组织管理产品。
- **V10 观察面**：当前 `main` 仅保留 `src/v10/`，提供只读 Web API 与页面，展示确定性 fixture 数据，不修改运行时状态，也不调用外部服务。

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

> 旧网关实现（Socket Mode + MCP + providers/tools）已完整归档于 tag/分支 `gateway-final`。

## V10 观察面模块

| 文件 | 职责 |
| --- | --- |
| `src/v10/types.ts` | 只读 HRS 观察面类型，非人员/IAM 模型 |
| `src/v10/fixture-adapter.ts` | 确定性 demo 运行时记录，不读取任何生产数据 |
| `src/v10/employee-view.ts` | 把 adapter 输出转换为稳定 Web API 表示 |
| `src/v10/web-page.ts` | HTML 页面渲染，含 XSS 转义 |
| `src/v10/web-server.ts` | 原生 `node:http` 本地服务，`/health`、`/api/v10/employees`、`/` |

## 演进约束

1. **Hermes 上游依赖是常设约束**：ChorusGate 的通道与网关语义需与 Hermes 主控/频道约定保持一致；本地改动不得反向要求 Hermes 修改其调度或记忆模型。
2. **优先扩展，而非 fork**：新增运行时或 Channel 支持应通过新增 adapter/parser/tool 实现，避免修改核心网关循环。
3. **证据先于状态**：任何状态迁移、门禁通过或外部跟踪声明都必须附带可检查的证据路径（`constitution.md` Article 1）。
4. **无秘密持久化**：测试、探针、证据 artifact 中不得包含 API key、token、生产 Soul/gbrain/memory 数据（`review-g1.md`）。

## 演进路径

- **当前**：`gateway-final` 标签锁定完整网关快照；`main` 收敛为 V10 观察面。
- **下一步（CG-I10-002 后）**：小马 在隔离环境中对 C1 `opencode-via-acpx` 运行 capability spike，证明 execute/push completion 行为、版本/许可证与限制。
- **ADR-0001**：小扣 依据 spike 证据决定运行时选择、拒绝项、correlation 命名空间、保留/隐私边界。
- **G4 之后**：小克 在单独授权的 TaskEnvelope 中实现契约观察/证据切片，保持运行时与 Zederer-IP 边界。

> 注：ADR-0001 与实现授权均 pending，当前 `main` 不含未授权的产品实现。

## 旧实现指针

完整旧网关实现（Slack Socket Mode、MCP Server、providers、tools、control-plane 等）保留在：

- Git tag: [`gateway-final`](https://github.com/AINIZE-SPACE/ChorusGate/releases/tag/gateway-final)
- Git branch: `gateway-final`

本目录不再维护这些代码。
