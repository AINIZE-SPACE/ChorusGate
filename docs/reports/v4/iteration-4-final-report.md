# ChorusGate 迭代四最终汇报

> 日期: 2026-06-21
> 频道: `chorusgate_v4` / `<#C0BB035G3DK>`
> 汇报人: 小扣 / ChorusGate CX
> 范围: 迭代四技术债务清理、统一流式、Codex 安全降级、测试基线、交付文档

## 一、结论

收尾阶段补充修复 Slack 长回复失败：gateway、`slack_send_message` 和 `slack_reply` 统一按 3500 字符分片，
首片复用占位消息，其余片段保持在原 thread，避免 `msg_too_long` 让交付回复只留下错误提示。

迭代四完成了从“v3 后技术债务清理”到“统一流式能力可验收”的主目标。核心链路已经具备稳定测试基线，StreamUpdate 在 Claude 路径完成真实进程 E2E 验证，Codex 路径完成 fixture 与 ENOENT 降级验证，并将原先不可实现的 Codex 交互式审批调整为默认 sandbox 安全模式。

一句话结论：**迭代四达到可交付状态，但 Codex 真实 CLI E2E 与真实 Slack 输出层 E2E 仍需在具备环境后补测。**

## 二、目标完成情况

| 目标 | 状态 | 说明 |
|------|------|------|
| P0/P1 测试基线清理 | 完成 | `npm test` 不再 240s+ hang，`test:integration` 稳定收敛 |
| Codex provider bug 修复 | 完成 | #117/#118/#119/#120/#121 回归通过 |
| StreamUpdate 统一流式 | 完成 | #85/#86 实现，Claude 高保真，Codex 降级 |
| StreamUpdate E2E | 部分完成 | Claude 真实进程 5/5 pass；Codex 真实 CLI 受环境限制 |
| Codex 统一审批 | 降级完成 | CLI 不支持交互审批，改为默认 `-s workspace-write` sandbox |
| Durable event state / retry queue | 进入后续能力 | 已有相关提交，但不作为本报告主验收面 |
| 最终文档交付 | 完成 | 回顾、最终汇报、测试报告、用户手册已归档 |

## 三、关键交付

### 3.1 测试基线

- `package.json` 增加/保留分层命令：
  - `npm test`
  - `npm run test:fast`
  - `npm run test:integration`
- 从不可收敛的 240s+ hang，转为约 88-100s 可完成的集成测试。
- 6 个被 hang 掩盖的问题被 issue 化并回归关闭。

### 3.2 Codex provider 稳定性

完成以下缺陷闭环：

| Issue | 内容 | 验收 |
|------|------|------|
| #117 | `codex --json exec/resume` flag 顺序 | ST-CX-001 / ST-CX-002 通过 |
| #118 | Windows double-quote escaping | ST-CX-003 通过 |
| #119 | CJK prompt 测试断言修正 | ST-CX-004 通过 |
| #120 | 缺失 `CODEX_BIN` 时 ENOENT 短路 | ST-CX-006 通过 |
| #121 | mock Claude permission fixture | permission mode 测试通过 |

### 3.3 StreamUpdate

StreamUpdate 已形成统一 provider 事件面：

| provider | 能力 | 状态 |
|----------|------|------|
| Claude stream | `session_id`、`progress`、`thinking`、`text`、`metrics`、`done` | 真实进程 E2E 通过 |
| Codex | `session_id`、`progress`、`text`、`tool_call`、`metrics`、`done` | fixture 通过，真实 CLI E2E 待环境补齐 |
| Gateway/reply-engine | 接收 `onStreamUpdate` 并统一消费 | 组件/集成测试通过 |

### 3.4 Codex 安全模式

Spike 证明 Codex CLI 当前不支持 `--ask-for-approval=on-request` 这类交互式审批参数。迭代四采用更符合事实的方案：

```text
默认:   codex ... -s workspace-write
兼容:   GATEWAY_CODEX_APPROVAL_MODE=bypass 时保留旧 bypass 模式
```

这不是 Claude 等价审批，而是 Codex 路径的安全基线升级。

## 四、测试结论

| 测试 | 命令 | 结果 |
|------|------|------|
| 迭代四回归 | `npm run test:integration` | 135 tests, 135 pass, 0 fail, 88.2s |
| StreamUpdate 组件验收 | 相关 6 个测试文件 | 36 tests, 36 pass, 0 fail, 18.2s |
| StreamUpdate 全量集成 | `npm run test:integration` | 135 tests, 135 pass, 0 fail, 82.1s |
| StreamUpdate E2E 补测 | `tests/e2e-streamupdate.test.ts` | 5 tests, 5 pass, 0 fail, 23.7s |

限制：

- Codex CLI 在 6/20 E2E 环境中不可用，因此 Codex 真实进程 StreamUpdate 未完成端到端验证。
- Slack 真实消息输出层未用真实 Slack token 做 E2E，只验证到 provider/parser/reply-engine/gateway callback 链路。

## 五、管理视角收益

1. **可维护性提升**：测试从不可收敛变为可回归，后续 issue 修复可以更快闭环。
2. **用户体验提升**：Claude 路径具备更细粒度流式反馈，未来 Slack 侧可以展示更自然的实时进度。
3. **安全性提升**：Codex 从完全 bypass 调整为默认 workspace sandbox，降低误写系统路径风险。
4. **协作流程提升**：测试报告、回顾文档和用户手册集中归档，迭代产物更可追溯。

## 六、遗留风险

| 风险 | 当前影响 | 建议 |
|------|----------|------|
| Codex 真实 CLI E2E 未覆盖 | Codex 路径仍缺真实进程证据 | 在安装 Codex CLI 的环境补跑 E2E |
| Slack 输出层未真实 E2E | Placeholder 更新逻辑仍需运行中 gateway 验证 | 增加 mock Slack client 或测试 hook |
| 规划文档部分 checklist 未同步 | 读者可能看到旧验收项未勾选 | 后续单独更新 planning 文档状态 |
| Worktree / Durable event 后续范围扩大 | 可能影响下一迭代节奏 | 下一轮按验收场景拆 issue |

## 七、交付索引

| 文档 | 路径 |
|------|------|
| 小克回顾 | `docs/reports/v4/iteration-4-retrospective-claude.md` |
| 小马回顾 | `docs/reports/v4/iteration-4-retrospective-hermes.md` |
| 小扣回顾 | `docs/reports/v4/iteration-4-retrospective-codex.md` |
| 最终汇报 | `docs/reports/v4/iteration-4-final-report.md` |
| 测试报告 | `docs/reports/v4/iteration-4-test-report.md` |
| 用户手册 | `docs/reports/v4/iteration-4-user-manual.md` |
