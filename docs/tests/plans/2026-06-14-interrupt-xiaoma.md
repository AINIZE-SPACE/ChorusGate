# PLAN: System Integration Test — Gateway Interrupt

**Date:** 2026-06-14
**Reviewer:** xiaoma (小马)
**Requester:** zederer (Master)
**Target branch:** `v3/story-8-claude-stream-json` @ `1c66d09` (interrupt commit `01dd94b`)
**PR:** #53
**Related spec:** `docs/planning/v3-story-interrupt.md`

---

## 1. 目标 (Objective)

对 Gateway Interrupt 功能做系统集成测试 (SIT) — 不只是单元测试，而是端到端验证：
- Busy-ack 在用户发新消息时被发送（30s debounce）
- Interrupt 模式下，当前 `claude -p` 进程被 kill，新消息被处理
- Queue 模式下，新消息在当前任务完成后被处理
- 跨 session / 跨 thread 的行为正确
- 异常路径（进程已退出、kill 失败、Slack 不可达）有合理 fallback

## 2. 范围 (Scope)

### In scope
- `src/interrupt.ts` InterruptManager 类的 end-to-end 行为
- `src/gateway.ts` processEvent 中的 busy-interrupt check
- `src/providers/claude-stream.ts` / `claude.ts` 的 onSpawn 回调
- InterruptManager 与真实 child_process 的集成
- Busy-ack 消息的发送（mock Slack）
- Debounce 跨多个 interrupt 调用

### Out of scope
- 真实 Claude API 调用（用 mock-claude fixture 替代）
- 真实 Slack Web API（mock chat.postMessage）
- gateway 的整体启动 / Socket Mode 监听（不在这次测试范围）
- 审批流程 (approval) — interrupt 流程不触发 permission_request
- Multi-profile 跨 project 行为（interrupt 是 session 级别，不是 profile 级别）

## 3. 方法 (Methodology)

### 3.1 工具链
- **Test framework:** `node --import tsx --test` (项目原生)
- **Mock Claude:** 扩展 `tests/fixtures/mock-claude/script.mjs`，新增 `slow` 模式
- **Mock Slack:** 在 InterruptManager 上使用 `_setWebClientForTests()` seam (已由本 PR 提交)
- **Process control:** 真实 `child_process.spawn`，真实 `child.kill(SIGTERM)`

### 3.2 测试架构
```
interrupt-integration.test.ts
  ├─ spawnMockClaude(mode='slow', sleepMs=2000)  ← 真实 child process
  ├─ InterruptManager 实例（with mocked Slack）
  ├─ 模拟 user 行为: register → interrupt → 验证副作用
  └─ 断言:
      - child.killed == 'SIGTERM' (interrupt mode) 或 null (queue mode)
      - Slack postMessage 被调用 N 次 (busy ack)
      - postMessage 文本包含正确的中文 ack
      - 进程退出时间 < 阈值
```

### 3.3 关键时序约束
- mock-claude slow mode 在 `sleepMs` 后才发 `result` 事件
- 测试用 `Promise.race([done, timeout])` 防止挂死
- 所有进程在测试结束时 `child.kill('SIGKILL')` 清理

## 4. 风险 (Risks)

| # | 风险 | 缓解 |
|---|---|---|
| 1 | mock-claude 在 Windows 上 hang（stdin/stdout 缓冲） | 用 `child.stdout.on('data')` 流式读取，setTimeout 上限 10s |
| 2 | 真实 SIGTERM 在 Windows 上行为不一致 | Windows 没有 SIGTERM，Node 会模拟为 terminate。测试在断言时同时检查 `kill('SIGTERM')` 调用而非 OS 行为 |
| 3 | Debounce 用真实时间，无法 mock | 接受 30s 真实等待，或测试只覆盖 1 次 ack 抑制（cooldown 走边界） |
| 4 | 集成测试的副作用影响其他测试 | 每个测试用独立 `InterruptManager` 实例，不污染 singleton |
| 5 | Queue mode 修复（#54）尚未落地 | Queue mode 测试用 `test.skip` + `FIX_QUEUE_MODE_BUG=1` env gate，等 #54 修完启用 |

## 5. 验收标准 (Acceptance Criteria)

- [x] 6+ 集成测试用例 (interrupt + queue + debounce + cross-session)
- [x] `npm test` 仍然 0 fail (允许 queue mode SKIPped)
- [x] `npm run typecheck` 干净
- [x] 端到端覆盖: 真实 child process + mocked Slack + 真实 InterruptManager
- [x] P0-1 (#54) 的 queue mode drop bug 至少有一个 SKIPped 的回归测试
- [x] 测试报告 (`REPORT-*.md`) 记录实际 pass/fail 数字与每个 case 的 evidence

## 6. 测试用例 (Cases) 索引

详见 `docs/tests/plans/CASES-InterruptSIT-2026-06-14-xiaoma.md`

| ID | 模式 | 场景 | 预期 |
|---|---|---|---|
| IT-01 | interrupt | 单 session，新消息触发 kill 当前 child | child.kill('SIGTERM') 被调用；busy ack "⚡ 正在中断..." 发送 |
| IT-02 | interrupt | 30s 内的第二次 interrupt（debounce） | 只发送 1 次 busy ack |
| IT-03 | interrupt | 跨 session (不同 tKey) 互不干扰 | session A 的 interrupt 不影响 session B |
| IT-04 | queue | queue mode 下 child 正在运行，新消息进入 interrupt | busy ack "⏳ 排队..." 发送；interrupt() await child exit 后返回 true |
| IT-05 | queue | queue mode 下，child 已退出，新消息触发 | interrupt() 立即返回 true（无 busy ack，或被 debounce） |
| IT-06 | shutdown | clear() 被调用时所有 child 被 SIGKILL | 所有 child.killed == 'SIGKILL' |
| IT-07 | error | child.kill() 抛异常 | interrupt() 仍返回 true，错误被 console.error 记录 |
| IT-08 | regression | #54 queue mode drop bug 回归测试 | 验证 interrupt() 在 queue mode 返回 true（不是 false / drop） |

## 7. 依赖与时序

- 依赖本 PR 已提交的 `_setWebClientForTests` seam (`src/interrupt.ts:24-31`)
- 依赖本 PR 已提交的 `tests/interrupt.test.ts` (单元测试基线)
- 新增 `tests/fixtures/mock-claude/slow-script.mjs`（独立的 slow mode mock）
- 新增 `tests/interrupt-integration.test.ts`

## 8. 不在范围 (Deferred)

- 真实 Slack API 集成测试 (需要 test workspace + bot token)
- Cross-thread interrupt 行为 (默认 debounce 跨 thread，可能需要明确产品决策)
- 性能测试 (debounce 性能、kill 延迟) — 不在 v3 scope
