---
title: ChorusGate 迭代四测试报告
author: 小马（测试员）
date: 2026-06-21
branch: v4/unified-stream
---

# ChorusGate 迭代四测试报告

> **测试员**: 小马（M）
> **日期**: 2026-06-21
> **分支**: `v4/unified-stream` @ latest commit
> **对应**: 迭代四全程测试活动

---

## 一、测试执行总览

### 1.1 测试活动时间线

| 日期 | 活动 | 结果 |
|------|------|------|
| 2026-06-17 | 基线建立：npm test 拆分 + hang 定位 | 129/135，暴露 6 个 F1-F6 bug |
| 2026-06-18 | Bug 修复回归：#117~#121 全部修复 | 135/135 全绿 |
| 2026-06-20 | StreamUpdate E2E ST：#85/#86 端到端验证 | 5/5 全绿，23.7s |
| 2026-06-21 | PR 评审 + 最终回归：PR #1, #6, #84 | 141/141 全绿 |

### 1.2 测试套件现状

| 套件 | 命令 | 用例数 | 状态 | 耗时 |
|------|------|--------|------|------|
| `test:integration` | `npm run test:integration` | 141 | 全绿 | ~88s |
| `test:fast` | `npm run test:fast` | 排除 ST 的快速用例 | 全绿 | ~10s |
| E2E StreamUpdate | `node --import tsx --test --test-timeout=120000 tests/e2e-streamupdate.test.ts` | 5 | 全绿 | 23.7s |

---

## 二、基线建立（2026-06-17）

### 2.1 问题

`npm test` 整体 hang 240s+，掩盖所有集成测试失败，无法判定代码质量。

### 2.2 根因

| 根因 | 说明 |
|------|------|
| 集成测试依赖真实 CLI | `codex-integration.test.ts` 真实 spawn `codex exec` 等待输出 |
| `node --test` 无 per-test timeout | 子进程 hang 时整个 runner 阻塞 |

### 2.3 修复

```diff
- "test": "node --import tsx --test tests/*.test.ts"
+ "test": "node --import tsx --test --test-timeout=30000 --test-force-exit tests/*.test.ts"
+ "test:fast": "node --import tsx --test --test-timeout=10000 --test-force-exit --test-name-pattern='^(?!.*(ST-)).*' tests/*.test.ts"
+ "test:integration": "node --import tsx --test --test-timeout=60000 --test-force-exit tests/*.test.ts"
```

### 2.4 基线结果

| 指标 | 值 |
|------|-----|
| 暴露的失败用例 | 6 个（F1~F6） |
| 失败用例对应的 Issue | #117 #118 #119 #120 #121 |
| 稳定可重现 | 两轮完全一致 |

---

## 三、Bug 修复回归（2026-06-18）

### 3.1 失败清单与修复

| F# | Issue | 问题描述 | 修复 | 状态 |
|-----|-------|---------|------|------|
| F1 | #121 | mock-claude fixture 未触发 `permission_request` | 补充 `permission_required` 分支 | 已修复 |
| F2+F3 | #117 | codex `--json` flag 位置错误（`exec --json` -> `--json exec`） | 调整 args 数组顺序 | 已修复 |
| F4 | #118 | Windows shell 转义产生空 quote 对 | 修正转义逻辑 | 已修复 |
| F5 | #119 | CJK prompt 测试断言不准（spawnargs vs 实际命令行） | 改用 stdin 验证 | 已修复 |
| F6 | #120 | CODEX_BIN 不存在时报 timeout 而非 ENOENT | 添加 `child.on('error')` 监听 | 已修复 |

### 3.2 回归命令与结果

```bash
npm run test:integration
```

| 指标 | 值 |
|------|-----|
| 总用例数 | 135 |
| 通过 | 135 |
| 失败 | 0 |
| 耗时 | 88.2s |
| 结果 | **全绿** |

---

## 四、StreamUpdate E2E 系统集成测试（2026-06-20）

### 4.1 测试命令

```bash
node --import tsx --test --test-timeout=120000 --test-force-exit tests/e2e-streamupdate.test.ts
```

### 4.2 测试结果

| 测试 | 场景 | 状态 |
|------|------|------|
| E2E-STREAM-001 | Claude 路径完整链路（真实 `claude -p` 进程） | PASS |
| E2E-STREAM-002 | StreamUpdate 事件顺序 + metrics 内容验证 | PASS |
| E2E-STREAM-003 | block 回调与 StreamUpdate 对齐验证 | PASS |
| E2E-STREAM-004 | Codex ENOENT 优雅降级（CODEX_BIN 不存在） | PASS |
| E2E-STREAM-005 | Gateway 全量回调模拟（Claude 真实进程） | PASS |

**汇总：5 tests, 5 pass, 0 fail, 23.7s**

### 4.3 Claude 路径完整事件链示例

```
session_id -> block_start -> progress -> thinking x 14 -> block_stop ->
block_start -> text -> text -> block_stop -> metrics -> done
```

### 4.4 限制说明

- **Codex CLI 未安装**：真实 Codex 进程 E2E 无法执行；ENOENT 降级路径已验证；Codex StreamUpdate 事件代码实现通过 fixture 测试验证。

---

## 五、PR 评审回归（2026-06-21）

### 5.1 PR #1 - DurableEventStore

| 门 | 结果 |
|----|------|
| `npm run build` | 零错误 |
| `npm run test:integration` | 140/140 pass |

**问题追踪**：发现 P1（`require('node:fs')` 混用 CJS/ESM），小克修复后回归通过。

### 5.2 PR #6 - Slack /stop 命令

| 门 | 结果 |
|----|------|
| `npm run build` | 零错误 |
| `npm run test:integration` | 141/141 pass |

**评审结论**：P2（缺少 stop handler 专项测试），不阻断合入。

### 5.3 PR #84/#99 - Codex 沙箱模式

| 门 | 结果 |
|----|------|
| `npm run build` | 零错误 |
| `npm run test:integration` | 141/141 pass |

**评审结论**：P2（测试未直接调用 `buildHeadlessFlags()`），不阻断合入。

---

## 六、测试覆盖矩阵

| 功能 | 单元测试 | Fixture 测试 | 集成测试 | E2E 真实进程 |
|------|---------|------------|---------|-------------|
| DurableEventStore 状态机 | OK | OK | OK | N/A |
| StreamUpdate Claude M3 | OK | OK | OK | OK |
| StreamUpdate Codex 降级 | OK | OK | OK | 环境限制 |
| /stop 命令 | OK (interruptManager) | N/A | OK (间接) | N/A |
| Codex 沙箱模式 | OK | N/A | OK | N/A |
| Permission 审批 | OK | OK | OK | N/A |
| Gateway 集成 | OK | OK | OK | Slack 限制 |

---

## 七、黑事件记录

**无黑事件**。本次迭代所有 bug 修复均一次性回归通过，无打回重修。

---

## 八、测试交付存档

| 文件 | 说明 |
|------|------|
| `docs/tests/cases/2026-06-18-iter4-regression-xiaoma.md` | Bug 修复回归报告 |
| `docs/tests/cases/2026-06-20-streamupdate-85-86-e2e-acceptance-xiaoma.md` | StreamUpdate E2E 验收报告 |
| `docs/reviews/pr-001-durable-event-store-2026-06-20.md` | PR #1 评审报告 |
| `docs/reviews/pr-006-slash-stop-command-2026-06-21.md` | PR #6 评审报告 |
| `docs/reviews/pr-084-099-codex-sandbox-2026-06-21.md` | PR #84/#99 评审报告 |
| `tests/e2e-streamupdate.test.ts` | 新增 E2E 测试文件（commit `c05c580`） |

---

*测试员：小马 | 日期：2026-06-21*
*执行命令：`npm run test:integration` + E2E probe*
*最终状态：141/141 全绿 + 5/5 E2E 全绿*
