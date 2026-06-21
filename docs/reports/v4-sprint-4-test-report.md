---
title: ChorusGate 迭代四测试报告
author: Claude Code（小克）
date: 2026-06-21
audience: 项目团队
branch: v4/unified-stream
---

# ChorusGate 迭代四测试报告

> **报告日期**: 2026-06-21
> **测试基线**: 141/141 pass, 0 fail
> **分支**: `v4/unified-stream`

---

## 一、测试概况

| 指标 | 数值 |
|------|------|
| 测试总数 | **141** |
| 通过 | **141** (100%) |
| 失败 | **0** |
| 全量耗时 | ~87s |
| 快速模式耗时 | ~5s |
| tsc 类型检查 | **零错误** |

---

## 二、测试套件结构

迭代四完成了 `npm test` 拆分（#96），形成三套测试：

| 命令 | 说明 | 用例数 | 耗时 |
|------|------|--------|------|
| `npm test` / `test:fast` | 单元测试 + 快速集成 | ~26 | ~5s |
| `npm run test:integration` | 全量集成测试（含 mock） | 141 | ~87s |
| `npm run test:all` | 全部 | 141 | ~87s |

---

## 三、新增测试覆盖

### 3.1 DurableEventStore（#1）— 5 个测试

| 测试 | 验证点 |
|------|--------|
| `state machine — pending → processing → replied` | 正常流转 |
| `state machine — fail and retry` | 失败→重试→恢复 |
| `replayable returns pending + stale processing events` | 重启恢复 |
| `dedup — fresh processing is not replayable` | 去重保护 |
| `countByState — self-contained` | 统计正确 |

### 3.2 Codex 沙箱模式（#84/#99）— 2 个测试

| 测试 | 验证点 |
|------|--------|
| `sandbox mode` | `buildHeadlessFlags()` 返回 `-s workspace-write` |
| `bypass mode` | `buildHeadlessFlags()` 返回 `--dangerously-bypass-approvals-and-sandbox` |

### 3.3 回归测试覆盖

| 测试文件 | 用例数 | 覆盖范围 |
|---------|--------|---------|
| `tests/claude-integration.test.ts` | ~20 | Claude provider spawn + reply |
| `tests/codex-integration.test.ts` | ~20 | Codex provider spawn + reply |
| `tests/claude-stream-integration.test.ts` | ~15 | stream-json 管道 |
| `tests/durable-event-store.test.ts` | 5 | 持久事件 Store |
| `tests/codex-args.test.ts` | 8 | Codex CLI flag |
| `tests/gateway.test.ts` | ~15 | Gateway 路由 |
| `tests/reply-engine.test.ts` | ~10 | 回复引擎 |
| `tests/interrupt-manager.test.ts` | ~8 | 中断管理 |
| 其他 | ~40 | session, profile, MCP 等 |

---

## 四、SIT 系统集成测试

### 4.1 环境

| 项目 | 值 |
|------|-----|
| 执行命令 | `npm run test:integration` |
| 环境 | Windows 10, Node.js, Git Bash |
| Mock | mock-claude (fake binary), mock-codex |
| 分支 | `v4/unified-stream` |

### 4.2 验证结果

```
ℹ tests 141  ℹ pass 141  ℹ fail 0  ℹ duration_ms 86570
```

### 4.3 PR 级 SIT 记录

| PR | 评审人 | SIT 结果 | 关键验证 |
|-----|--------|---------|---------|
| #1 DurableEventStore | 小马 | 140/140 pass | 状态机 + 去重 + 重放 + 存储 |
| #84/#99 Codex 沙箱 | 小马 | 141/141 pass | sandbox + bypass 双模式 |
| #6 /stop 命令 | 小马 | 141/141 pass | interruptManager 集成 |

---

## 五、测试质量分析

### 5.1 覆盖缺口

| 缺口 | 级别 | 状态 |
|------|------|------|
| stop handler 无专项测试（interruptManager 间接覆盖） | P2 | 记 tech debt，迭代五补 |
| codex-args 测试硬编码 flags 数组 | P2 | 记 tech debt，迭代五改 |
| StreamUpdate E2E 缺乏实时 Slack 验证 | P2 | mock 环境已覆盖 parser 层 |

### 5.2 测试基建改进

| 改进 | 效果 |
|------|------|
| `npm test` 拆分三套 | 240s+ hang → 5s fast / 87s full |
| MCP mock 环境 | 消除外部 MCP server 依赖 |
| per-test timeout | case 级超时定位，不再全局等 |

---

## 六、E2E 验收记录

| Feature | E2E 报告 | 结果 |
|---------|---------|------|
| StreamUpdate #85/#86 | `docs/tests/cases/2026-06-20-streamupdate-85-86-e2e-acceptance-xiaoma.md` | 通过 |
| 迭代四回归 | `docs/tests/cases/2026-06-18-iter4-regression-xiaoma.md` | 通过 |
| M3M4 测试计划 | `docs/tests/plans/2026-06-17-iter4-baseline-xiaoma.md` | 通过 |

---

*生成日期：2026-06-21*
*整理：Claude Code（小克）*
