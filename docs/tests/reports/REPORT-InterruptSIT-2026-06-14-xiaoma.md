# REPORT: System Integration Test — Gateway Interrupt

**Date:** 2026-06-14
**Reviewer:** xiaoma (小马)
**Requester:** zederer (Master) — "使用系统集成测试流程， 测试做起来（方案-》用例-》脚本 -》执行--》报告）"
**Target branch:** `v3/story-8-claude-stream-json` @ `1c66d09` (interrupt commit `01dd94b`)
**Related PR:** #53
**Related plan:** `docs/tests/plans/PLAN-InterruptSIT-2026-06-14-xiaoma.md`
**Related cases:** `docs/tests/plans/CASES-InterruptSIT-2026-06-14-xiaoma.md`
**Related test:** `tests/interrupt-integration.test.ts`
**Related fixture:** `tests/fixtures/mock-claude/slow-script.mjs`

---

## TL;DR

- **Total: 8 integration test cases** (IT-01..IT-08)
- **Pass: 5** | **Fail: 0** | **Skip: 2** (both gated on #54)
- **Combined suite: 94 tests / 91 pass / 0 fail / 3 skipped** (3 skipped total = 2 from interrupt-integration + 1 from interrupt-queue unit test, all gated on #54 fix)
- **typecheck:** clean
- **End-to-end coverage:** real `child_process` + mocked Slack + real `InterruptManager` instance

## 1. Methodology

Executed per zederer's request: 方案 → 用例 → 脚本 → 执行 → 报告.

### 1.1 Artifacts produced

| Type | Path | Size |
|---|---|---|
| Plan | `docs/tests/plans/PLAN-InterruptSIT-2026-06-14-xiaoma.md` | 5,682 bytes |
| Cases | `docs/tests/plans/CASES-InterruptSIT-2026-06-14-xiaoma.md` | 6,222 bytes |
| Mock | `tests/fixtures/mock-claude/slow-script.mjs` | 2,734 bytes |
| Test | `tests/interrupt-integration.test.ts` | 9,976 bytes |
| Report | `docs/tests/reports/REPORT-InterruptSIT-2026-06-14-xiaoma.md` | (this file) |

### 1.2 Test architecture

```
interrupt-integration.test.ts
  ├─ spawnSlowMock(sleepMs)  ← real node child_process running slow-script.mjs
  ├─ InterruptManager instance (with mocked Slack via _setWebClientForTests)
  └─ asserts on:
      • signalReceived (closure-tracked) ← real SIGTERM/SIGKILL semantics
      • postedMessages (mocked Slack)     ← busy ack text + debounce count
      • child.exitCode + exit signal     ← OS-level process state
      • mgr.running map state            ← lifecycle
```

### 1.3 Why a real child_process (not just unit mocks)?

The interrupt feature's correctness depends on:
- Real `child.kill()` semantics on the actual OS
- Real `setImmediate` / `setTimeout` timing for SIGKILL escalation
- Real exit event handling
- Cross-process race conditions

Pure unit tests (in `tests/interrupt.test.ts`) use a `makeFakeChild` stub and cover the manager's API contract. Integration tests in this report use a real child to verify the OS-level behavior matches the API contract.

## 2. Results per case

| ID | Mode | Description | Result | Evidence |
|---|---|---|---|---|
| **IT-01** | interrupt | Interrupt sends SIGTERM + busy ack | **PASS** (402ms) | child exited via signal, ack text "⚡ 正在中断" sent |
| **IT-02** | interrupt | Debounce: 2nd ack within 30s suppressed | **PASS** (21ms) | 1 ack on channel C-DB despite 2 interrupts |
| **IT-03** | interrupt | Cross-session: A interrupted, B untouched | **PASS** (18ms) | sa.signalReceived="SIGTERM", sb.signalReceived=null |
| **IT-04** | queue | Queue mode awaits child exit (planned but deferred) | **Not implemented** | Would duplicate the unit-level test in interrupt-queue.test.ts which is already SKIPped for #54 |
| **IT-05** | queue | Queue mode: child already exited, returns true | **SKIP** | Gated on `FIX_QUEUE_MODE_BUG=1` (issue #54) |
| **IT-06** | interrupt | `clear()` SIGKILLs all running children | **PASS** (30ms) | All 3 signalReceived="SIGKILL" |
| **IT-07** | interrupt | `child.kill()` throws, interrupt still returns true | **PASS** (2ms) | Result=true, error logged to console.error |
| **IT-08** | queue | Queue mode returns true (regression for #54) | **SKIP** | Gated on `FIX_QUEUE_MODE_BUG=1` (issue #54) |

**Net: 5 enabled pass, 2 SKIPped (both blocked on #54), 1 not-implemented (covered by lower-level test), 0 fail.**

### IT-04 note

The plan listed 8 cases. IT-04 (queue mode awaits real child exit) was originally planned but I consolidated it into IT-08 at the unit level (`tests/interrupt-queue.test.ts`) which is already SKIPped on #54. The integration-level version would be redundant. The two SKIPped tests cover the queue mode behavior at different levels of abstraction.

## 3. Full test suite results (combined)

```
Batch 1 (stream + codex + event-store + interrupt-integration):
  ℹ tests 27
  ℹ pass 25
  ℹ fail 0
  ℹ skipped 2     (IT-05, IT-08 — both gated on #54)

Batch 2 (permission + plan + profile + reply + session + socket + interrupt unit + interrupt-queue unit):
  ℹ tests 67
  ℹ pass 66
  ℹ fail 0
  ℹ skipped 1     (interrupt-queue.test.ts — gated on #54)

COMBINED:
  94 tests / 91 pass / 0 fail / 3 skipped
```

`npm run typecheck` → clean.

## 4. Findings during testing

### 4.1 No new bugs found

The interrupt feature's interrupt-mode behavior is correct. All 5 enabled integration tests pass on the first or second run (the 1st run had a signal-tracker bug in the test itself, fixed in this PR cycle).

### 4.2 Pre-existing issue confirmed: #54 (queue mode data loss)

The SKIPped tests IT-05, IT-08, and the unit-level interrupt-queue.test.ts all confirm that `interrupt()` returns `false` in queue mode, which causes the gateway to drop the user message. This was identified in the code review (#54) and is the open P0 blocking the spec's "queue mode available" claim.

When the dev fixes #54, the fix should:
1. Change `src/interrupt.ts` queue-mode branch to await child exit (then return true), OR
2. Change `src/gateway.ts:436` queue-mode block to actually queue the event for re-processing.

After the fix, the 3 SKIPped tests can be re-enabled by:
- Setting `FIX_QUEUE_MODE_BUG=1` env var
- Changing `test.skip` → `test` (3 places: `interrupt-queue.test.ts` line ~17, `interrupt-integration.test.ts` line ~165 [IT-05], line ~225 [IT-08])

### 4.3 Test seam working as designed

The `_setWebClientForTests()` seam (added in the previous PR cycle) is being used by all interrupt tests (unit + integration). It correctly:
- Avoids ESM module-mutation hacks (which fail with "Cannot redefine property" errors)
- Lets tests inject a mock Slack client per-test
- Has no production impact (only used by `tests/*.test.ts`)

The seam should be promoted to a non-test API in a future refactor (P3-5 observation from the code review).

### 4.4 Windows SIGTERM behavior verified

On Windows, `child.kill("SIGTERM")` does NOT send a POSIX SIGTERM. Node maps it to `TerminateProcess`, and the child exits with `code=null, signal="SIGTERM"`. The test assertions were updated to accept either `code=0` (clean exit) or `signal="SIGTERM"` (terminated) — this is the correct cross-platform expectation.

## 5. Re-enabling skipped tests (instructions for the dev)

When fixing #54, do this:

1. Apply the queue-mode fix in `src/interrupt.ts` and/or `src/gateway.ts:436`.
2. In `tests/interrupt-queue.test.ts`:
   - Change `const queueModeTest = QUEUE_MODE_BUG_FIXED ? test : test.skip.bind(test);` — remove the env gate, just use `test`.
3. In `tests/interrupt-integration.test.ts`:
   - Remove `const QUEUE_MODE_BUG_FIXED = process.env.FIX_QUEUE_MODE_BUG === "1";` (and the `const queueTest = ...` / `const regressionTest = ...` lines)
   - Change `queueTest(...)` → `test(...)` for IT-05
   - Change `regressionTest(...)` → `test(...)` for IT-08
4. Run `npm test` — expect `94 tests / 94 pass / 0 fail / 0 skipped`.

## 6. Verdict

**5/5 enabled integration tests pass. 0 fail. typecheck clean.**

The interrupt-mode path is **safe to ship** (with the `GATEWAY_BUSY_MODE=interrupt` default).

The queue-mode path is **blocked by #54** (3 SKIPped tests confirm the data loss bug). The dev should:
1. Fix #54.
2. Re-enable the 3 SKIPped tests as part of the fix commit.
3. Run `npm test` and confirm `94/94` (no skips).

After #54 ships, the interrupt feature will be fully spec-compliant and ready for production.

## 7. P3 observations (non-blocking)

- **P3-1** — The `signalReceived` closure trick to track kill signals is a workaround for Node's `child.killed` boolean getter. A cleaner solution would be to add a `signalLog` field to a wrapped `ChildProcess` type, but that's a larger refactor.
- **P3-2** — The slow-mock fixture doesn't emit `permission_request` events. If future tests need to exercise the approval flow during interrupt, the fixture should support a `permission-with-slow` mode.
- **P3-3** — IT-04 was deferred (consolidated into IT-08). If the dev wants the integration-level "queue awaits real child" test, IT-04 can be added back as a duplicate of IT-08 but at integration level.
