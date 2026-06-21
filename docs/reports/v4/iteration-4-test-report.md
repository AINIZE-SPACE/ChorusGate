# ChorusGate 迭代四测试报告

> 日期: 2026-06-21
> 汇总人: 小扣 / ChorusGate CX
> 测试来源: 小马 2026-06-17、2026-06-18、2026-06-20 测试与验收报告
> 覆盖范围: 测试基线、Codex provider 回归、StreamUpdate 组件验收、StreamUpdate E2E 补测

## 一、测试结论

迭代四测试结论为：**主线集成测试通过，StreamUpdate Claude 真实进程链路通过，Codex 真实进程链路受环境限制未完成。**

当前可作为发布依据的通过项：

- `npm run test:integration`: 135/135 pass
- StreamUpdate 相关组件测试: 36/36 pass
- StreamUpdate E2E 补测: 5/5 pass
- 已知 #117/#118/#119/#120/#121 回归通过
- Slack 长消息分片单测与 `link_names` 静态回归通过

## 二、测试环境与命令

| 项目 | 信息 |
|------|------|
| 主分支 | `v4/unified-stream` |
| 关键 commits | `a53fc5f`、`4c0d723`、`02a6f63`、`6079bd4`、`a6c14a3`、`5808d0a` |
| Node.js | v24.14.0 |
| 测试运行器 | Node test runner + `tsx` |
| Claude CLI | 6/20 E2E 报告记录为 `claude` 2.1.179 |
| Codex CLI | 6/20 E2E 环境中不可用 |

主要命令：

```bash
npm run test:integration
```

```bash
npx tsx --test --test-timeout=60000 --test-force-exit \
  tests/claude-stream-parser.test.ts \
  tests/claude-stream-session.test.ts \
  tests/claude-stream-integration.test.ts \
  tests/codex-provider.test.ts \
  tests/codex-integration.test.ts \
  tests/reply-engine.test.ts
```

```bash
node --import tsx --test --test-timeout=120000 --test-force-exit \
  tests/e2e-streamupdate.test.ts
```

## 三、阶段测试结果

### 3.1 基线测试

来源：`docs/tests/plans/2026-06-17-iter4-baseline-xiaoma.md`

| 项目 | 结果 |
|------|------|
| 初始问题 | `npm test` 240s+ hang |
| 基线修复后 | 可在约 90-100s 收敛 |
| 基线结果 | 135 tests, 129 pass, 6 fail |
| 价值 | 暴露被 hang 掩盖的 6 个真实问题 |

暴露问题：

| 编号 | 问题 | 后续 issue |
|------|------|------------|
| F1 | mock Claude permission mode 未触发 `permission_request` | #121 |
| F2 | Codex `exec` `--json` 位置错误 | #117 |
| F3 | Codex `resume` `--json` 位置错误 | #117 |
| F4 | Windows quote escaping 错误 | #118 |
| F5 | CJK prompt 测试断言不准 | #119 |
| F6 | 缺失 `CODEX_BIN` 时返回 timeout 而非 ENOENT | #120 |

### 3.2 回归测试

来源：`docs/tests/cases/2026-06-18-iter4-regression-xiaoma.md`

| 项目 | 结果 |
|------|------|
| 命令 | `npm run test:integration` |
| 总用例 | 135 |
| 通过 | 135 |
| 失败 | 0 |
| 耗时 | 88.2s |
| 结论 | #117/#118/#119/#120/#121 回归通过 |

### 3.3 StreamUpdate 组件验收

来源：`docs/tests/cases/2026-06-18-streamupdate-85-86-acceptance-xiaoma.md`

| 项目 | 结果 |
|------|------|
| 相关测试 | 36 tests |
| 通过 | 36 |
| 失败 | 0 |
| 耗时 | 18.2s |
| 全量集成 | 135/135 pass, 82.1s |
| 结论 | #85/#86 组件级验收通过 |

覆盖点：

- Claude stream parser 事件解析
- Claude stream session 契约
- Claude permission/error/simple integration
- Codex provider 与 integration fixture
- Reply engine 对 `generateReplyStream` 和 callback 的契约

### 3.4 StreamUpdate E2E 补测

来源：`docs/tests/cases/2026-06-20-streamupdate-85-86-e2e-acceptance-xiaoma.md`

| 用例 | 覆盖链路 | 结果 |
|------|----------|------|
| E2E-STREAM-001 | Claude 真实进程完整 StreamUpdate 链路 | PASS |
| E2E-STREAM-002 | StreamUpdate 顺序与 metrics 内容 | PASS |
| E2E-STREAM-003 | block callback 与 StreamUpdate 对齐 | PASS |
| E2E-STREAM-004 | Codex CLI 缺失时 ENOENT 降级 | PASS |
| E2E-STREAM-005 | Gateway 模拟全量 callback 链路 | PASS |

整体结果：5 tests, 5 pass, 0 fail, 23.7s。

## 四、覆盖矩阵

| 能力 | 单元/fixture | 集成 | 真实进程 E2E | 真实 Slack E2E |
|------|--------------|------|--------------|----------------|
| Claude StreamUpdate | 通过 | 通过 | 通过 | 未覆盖 |
| Codex StreamUpdate | 通过 | 通过 | 环境限制未覆盖 | 未覆盖 |
| Codex ENOENT 降级 | 通过 | 通过 | 通过 | 不适用 |
| Reply engine callback | 通过 | 通过 | 通过 | 未覆盖 |
| Slack placeholder/长回复分片 | 单测通过 | 静态回归通过 | 未覆盖 | 待本次线程回执验证 |
| Codex sandbox flags | 测试覆盖 | 代码确认 | 待运行环境观察 | 不适用 |

## 五、未覆盖与风险

| 风险 | 说明 | 建议 |
|------|------|------|
| Codex CLI 不在 E2E 环境 PATH | 无法验证真实 Codex JSONL 到 StreamUpdate 的端到端链路 | 在安装 Codex CLI 的 CI/Prod 环境补跑 |
| Slack 真实输出未测 | 未使用真实 `SLACK_BOT_TOKEN` 和 Socket Mode 事件触发 | 增加 mock Slack client 或专用 staging gateway |
| E2E 依赖真实 Claude key | 不适合无 secret 的普通 CI 默认运行 | 将 E2E 作为 gated job |
| planning checklist 未完全更新 | 测试报告和规划状态可能不同步 | 后续单独更新 `docs/planning/*` 状态 |

## 六、验收结论

迭代四可验收项：

- 测试基线：通过
- Codex provider bug 回归：通过
- StreamUpdate Claude 路径：通过
- StreamUpdate Codex 降级路径：通过 fixture/降级验证
- Codex 安全模式：代码与测试覆盖通过

验收保留项：

- Codex 真实进程 E2E
- Slack 真实消息输出 E2E

这两个保留项不阻塞迭代四主线交付，但应进入下一轮质量补强清单。
