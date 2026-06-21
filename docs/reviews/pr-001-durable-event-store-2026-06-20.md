# PR #1 DurableEventStore 评审报告

**日期**: 2026-06-20
**评审人**: 小马
**PR**: AINIZE-SPACE/ChorusGate#1 (commit 5530062 + 6d5f1e1)
**分支**: v4/unified-stream
**变更文件**: src/durable-event-store.ts(+284) / src/gateway.ts(+55) / tests/durable-event-store.test.ts(+129)

---

## 质量门

| 检查项 | 结果 |
|--------|------|
| npm test | 140/140 pass, 0 fail |
| npm run build (tsc --noEmit) | 零错误 |
| 核心功能 | 状态机/去重/重放/debounce/eviction 全到位 |
| Gateway 集成 | onEvent-processEvent-main 三处 hook 完整 |

---

## 问题追踪

### P1 -- GitHub Issue #124 ✅ 已关闭

**文件**: src/durable-event-store.ts
**问题**: 使用 require("node:fs") 混用 CJS/ESM 模块语法
**修复 commit**: 6d5f1e1 (cherry-pick 到本地 HEAD)
**修复内容**: 顶层 import 加 mkdirSync，删掉 require 调用

```ts
// 修复后
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
```

**回归测试**: test:integration 140/140 pass ✅

### P2 (不处理，已确认)

**文件**: src/durable-event-store.ts
**位置**: parseRow() 中 cells.slice(9).join("|")
**结论**: Slack gateway 场景影响有限，getReplayable() 兜底已够，后续 exactly-once 有硬要求再考虑 WAL

---

## 结论

| | |
|---|---|
| **评审结果** | ✅ 通过 |
| **合入状态** | v4/unified-stream (6d5f1e1 + 0059e4e) |
| **Issue #124** | ✅ 已关闭 |
| **后续动作** | 无，待合入 main |

---

小马 · 2026-06-20
