# ChorusGate 迭代四回顾 - 小马

> 日期: 2026-06-21
> 角色: 小马 / Hermes / 评审与测试
> 范围: 测试基线、回归验证、StreamUpdate 验收、E2E 补测
> 主要证据: `docs/tests/plans/2026-06-17-iter4-baseline-xiaoma.md`、`docs/tests/cases/2026-06-18-iter4-regression-xiaoma.md`、`docs/tests/cases/2026-06-18-streamupdate-85-86-acceptance-xiaoma.md`、`docs/tests/cases/2026-06-20-streamupdate-85-86-e2e-acceptance-xiaoma.md`

## 一、职责回顾

小马在迭代四承担测试、评审和验收收口职责。最关键的贡献不是单次测试通过，而是把原来不可收敛的测试状态变成了可定位、可回归、可复核的质量链路。

## 二、关键产出

| 日期 | 文档 | 结论 |
|------|------|------|
| 2026-06-17 | `2026-06-17-iter4-baseline-xiaoma.md` | `npm test` 从 240s+ hang 收敛为约 90-100s，暴露 6 个稳定失败 |
| 2026-06-18 | `2026-06-18-iter4-regression-xiaoma.md` | #117/#118/#119/#120/#121 修复后，`npm run test:integration` 135/135 pass |
| 2026-06-18 | `2026-06-18-streamupdate-85-86-acceptance-xiaoma.md` | #85/#86 组件级验收通过，36/36 相关测试通过，全量 135/135 pass |
| 2026-06-20 | `2026-06-20-streamupdate-85-86-e2e-acceptance-xiaoma.md` | 补齐真实 Claude 进程 E2E，5/5 pass |

## 三、做得好的部分

1. 把 hang 问题转化为稳定失败清单。最初的 240s+ timeout 没有直接归为“环境问题”，而是拆成 `test`、`test:fast`、`test:integration`，让 6 个真实问题浮出。
2. 回归报告有明确失败映射。F1-F6 分别对应 #117-#121，修复后逐项验证，避免“全绿但不知道绿了什么”。
3. 对 #85/#86 进行了两层验收。先做组件级/fixture 验收，再在 6/20 补充真实 Claude 进程 E2E，修掉了原先只覆盖组件链路的盲点。
4. 如实记录限制。Codex CLI 在当前 E2E 环境不可用，因此报告明确区分了 Codex fixture 验证、ENOENT 降级验证和真实 Codex E2E 待补。

## 四、暴露的问题

| 问题 | 影响 | 后续处理 |
|------|------|----------|
| 初期测试套件没有默认 timeout | 子进程 hang 会拖垮整套测试 | 已通过 `--test-timeout` 与 `--test-force-exit` 改善 |
| 测试依赖真实 CLI 的边界不清 | 缺 CLI 时失败不稳定、难定位 | 继续完善 mock fixture 与环境前置检查 |
| StreamUpdate 初验缺真实进程闭环 | 组件通过不能完全代表系统可用 | 已补 5 条 E2E；后续补 Slack 输出层 |
| Codex 真实 E2E 缺环境 | Codex path 仍未完全端到端验证 | 在安装 Codex CLI 的 CI/Prod 环境补测 |

## 五、经验沉淀

- 质量基线应该先于功能验收建立。
- 报告需要同时记录命令、分支/commit、测试数量、失败清单和限制条件。
- 对 gateway 类项目，mock、fixture、真实 CLI、真实 Slack 是不同层级，不能互相替代。
- 对“测试通过”的表述要精确到链路：组件通过、E2E 通过、真实 Slack 通过分别是不同结论。

## 六、下轮建议

1. 把 `tests/e2e-streamupdate.test.ts` 纳入受控 CI，但前提是 CI 有真实 Claude API secret。
2. 增加 Codex CLI 可用环境下的真实 E2E，用于验证 Codex StreamUpdate 事件完整性。
3. 为 Slack placeholder 更新增加 mock Slack client，避免真实 token 依赖阻塞输出层测试。
4. 每次关闭 issue 前保留“修复提交 + 回归命令 + 报告路径”的三件套。
