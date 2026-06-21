# ChorusGate 迭代四回顾 - 小克

> 日期: 2026-06-21
> 角色: 小克 / Claude Code
> 范围: P0/P1 修复、StreamUpdate 主实现、Codex 安全模式落地
> 主要证据: `docs/planning/iteration-4-scope.md`、`docs/tests/cases/2026-06-18-iter4-regression-xiaoma.md`、`docs/tests/cases/2026-06-18-streamupdate-85-86-acceptance-xiaoma.md`、`docs/planning/v4-spike-codex-approval.md`

## 一、职责回顾

小克在迭代四承担主要实现角色，核心职责是把 v3 遗留的技术债务和 Codex provider 问题清掉，同时完成统一流式能力的主体实现。

本轮重点覆盖：

| 方向 | 事项 | 结果 |
|------|------|------|
| 测试基线修复 | `npm test` hang、per-test timeout、force-exit | 完成，测试从 240s+ hang 变为稳定可收敛 |
| Codex provider bug | #117 `--json` 顺序、#118 Windows quote、#120 ENOENT | 完成，回归 135/135 pass |
| Claude fixture | #121 `permission_request` mock 补齐 | 完成，权限模式测试恢复 |
| StreamUpdate | #85/#86 统一流式接口、Claude 高保真、Codex 降级 | 完成，组件测试与 E2E 补测通过 |
| Codex 安全 | #84/#99 从交互式审批调整为 sandbox 模式 | 完成，默认 `-s workspace-write` |

## 二、做得好的部分

1. 先修测试基线，再做功能闭环。迭代四没有直接把 #85/#86 堆到一个不可验证的测试环境里，而是先处理 #96/#97 暴露出的 hang 和 mock 问题，让后续每个修复都能被稳定回归。
2. Codex provider 修复聚焦真实缺陷。`--json` 位置、Windows quote、ENOENT 短路都是会直接影响 Slack gateway 可用性的路径，修复后由小马回归验证到 135/135 pass。
3. StreamUpdate 没有强行追求 provider 等价。Claude 走高保真事件，Codex 走回合级降级事件，符合当前 CLI 能力边界。
4. Codex 审批及时纠偏。Spike 证明 `--ask-for-approval` 不存在后，没有继续模拟不可暂停的假审批，而是落到 `workspace-write` sandbox。

## 三、暴露的问题

| 问题 | 影响 | 后续处理 |
|------|------|----------|
| v3 遗留测试 hang 太晚被系统化暴露 | 初期真实失败被 timeout 掩盖 | 保留 `test:fast` / `test:integration` 分层，新增功能必须给出可收敛命令 |
| Codex provider Windows 路径缺陷集中出现 | 说明 provider 对 Windows shell 的契约测试不足 | Codex provider 后续修改必须补 Windows 参数/转义 fixture |
| 设计文档曾假设 Codex 有交互式审批 | 方案与 CLI 事实不一致 | Spike 结论已落文档，后续用 CLI 实测结果作为能力边界 |
| StreamUpdate 的 Slack 真实输出未完全 E2E | Provider 到 reply-engine 已验证，真实 Slack 发送仍依赖运行环境 | 后续增加 mock Slack client 或 gateway hook |

## 四、经验沉淀

- 对 CLI provider 的能力判断必须以 `--help`、真实命令和 fixture 为准，不能只按另一个 runtime 的能力类比。
- 流式抽象应允许降级实现。统一接口不等于强制 Claude/Codex 事件粒度一致。
- 测试基线本身是迭代交付物。没有稳定测试命令，代码功能完成也不可验收。
- Windows 是 ChorusGate 的一等运行环境，命令拼接、quote、ENOENT、CJK 都必须纳入回归。

## 五、下轮建议

1. Codex provider 继续收敛到少手写 shell 拼接、多数组参数和 fixture 验证。
2. StreamUpdate 下一步优先做 Slack 输出层 E2E，而不是继续扩展更多事件类型。
3. Codex sandbox 模式上线后，应补充实际运行观测：workspace 外写入是否被拦截、错误信息是否可读、用户是否能理解降级边界。
4. Worktree 和 DurableEventStore 已进入后续方向，建议先定义验收场景，再拆实现。
