# CASES: System Integration Test — Gateway Interrupt

**Date:** 2026-06-14
**Reviewer:** xiaoma (小马)
**Related plan:** `docs/tests/plans/PLAN-InterruptSIT-2026-06-14-xiaoma.md`
**Related test file:** `tests/interrupt-integration.test.ts`
**Related mock:** `tests/fixtures/mock-claude/slow-script.mjs`

---

## IT-01 — Interrupt mode: kill current child on new message

**Mode:** interrupt (default, `GATEWAY_BUSY_MODE=interrupt`)
**Scenario:** User sends message A → mock-claude slow mode starts → User sends message B (before A finishes) → interrupt() called

**Pre-conditions:**
- Fresh `InterruptManager` instance
- Mock Slack installed via `_setWebClientForTests`
- One `spawnMockClaude('slow', 3000)` running, registered as session "A"

**Steps:**
1. Register the child with key="A"
2. `await mgr.interrupt("A", "C-test", "1.001")`
3. Wait for child exit

**Expected:**
- `result === true` (proceed with new message)
- `child.killed === "SIGTERM"` (interrupt mode sent SIGTERM)
- `mgr.isRunning("A") === false` (unregistered after exit)
- Mock Slack `postedMessages` has 1 entry, text includes "⚡ 正在中断"
- Exit occurred within `2s + 200ms` (2s SIGTERM grace, plus 200ms buffer)

**Evidence:** count of `child.kill` calls, Slack mock state, exit timing

---

## IT-02 — Interrupt mode: debounce suppresses 2nd ack within 30s

**Mode:** interrupt
**Scenario:** Two interrupts fire on the same channel/thread within 30s

**Pre-conditions:**
- Same as IT-01

**Steps:**
1. Register child1, call `interrupt("k1", "C-DB", "ts-1")` → wait for child1 exit
2. Immediately register child2, call `interrupt("k2", "C-DB", "ts-1")` → wait for child2 exit

**Expected:**
- 2nd ack is suppressed (debounce key `C-DB:ts-1`)
- Mock Slack: exactly 1 message on channel `C-DB`
- Both interrupts return true (process killed successfully)

**Evidence:** `postedMessages.filter(m => m.channel === "C-DB").length === 1`

---

## IT-03 — Cross-session isolation: interrupt in session A does not affect session B

**Mode:** interrupt
**Scenario:** Two concurrent sessions, interrupt one

**Pre-conditions:**
- Two children registered under different keys: "A" and "B"

**Steps:**
1. Register childA on "A", childB on "B"
2. `await mgr.interrupt("A", "C-X", "ts-X")`

**Expected:**
- childA.killed === "SIGTERM"
- childB.killed === null (not touched)
- `mgr.isRunning("A") === false`, `mgr.isRunning("B") === true`

**Evidence:** independent child state

---

## IT-04 — Queue mode: await child exit then return true

**Mode:** queue (`GATEWAY_BUSY_MODE=queue`)
**Scenario:** User sends A (slow) then B → A should finish first, then B is processed

**Pre-conditions:**
- `GATEWAY_BUSY_MODE=queue` set before import
- One slow child registered (sleep 500ms)

**Steps:**
1. Register child on "qk1"
2. Start `mgr.interrupt("qk1", "C-Q", "ts-Q")` (returns a promise)
3. Wait 50ms, verify busy ack was sent
4. Wait for child natural exit (no manual kill)
5. Await interrupt promise

**Expected:**
- Busy ack "⏳ 当前任务正在执行，你的消息已排队" sent immediately
- interrupt() returns true (NOT false — false is the #54 drop bug)
- child.killed === null (no kill — queue mode waits)
- child exited naturally (exitCode 0)

**Status:** **SKIPped** via `FIX_QUEUE_MODE_BUG=1` env gate (gated on #54 fix)

---

## IT-05 — Queue mode: child already exited, interrupt is no-op

**Mode:** queue
**Scenario:** `mgr.running.has("k")` returns true but child.exitCode is set

**Pre-conditions:**
- child.exitCode = 0, signalCode = null
- Registered on "qk2"

**Steps:**
1. Register child, set `child.exitCode = 0` manually
2. `await mgr.interrupt("qk2", "C-Q2", "ts-Q2")`

**Expected:**
- Returns true immediately (no await)
- `mgr.isRunning("qk2") === false` (unregistered)

**Evidence:** returns in <10ms (no real wait)

---

## IT-06 — Shutdown: clear() SIGKILLs all running children

**Mode:** interrupt
**Scenario:** Gateway SIGTERM, need to clean up all running claude -p processes

**Pre-conditions:**
- 3 children registered on different keys

**Steps:**
1. Register child1, child2, child3
2. `mgr.clear()`

**Expected:**
- All 3 children have `killed === "SIGKILL"`
- `mgr.runningCount === 0`
- `mgr.isRunning(any_key) === false`

---

## IT-07 — Error path: child.kill() throws, interrupt still returns true

**Mode:** interrupt
**Scenario:** Underlying ChildProcess is in a bad state, kill() throws

**Pre-conditions:**
- Mock child whose `kill()` throws `Error("ESRCH: no such process")`

**Steps:**
1. Register throwing child
2. `await mgr.interrupt("err1", "C-E", "ts-E")`

**Expected:**
- `result === true` (callers can proceed)
- Error logged to console.error (verified via spy)
- `mgr.isRunning("err1") === false` (cleaned up despite error)

**Evidence:** call returned without throwing

---

## IT-08 — Regression: queue mode must NOT return false (data loss bug #54)

**Mode:** queue
**Scenario:** This is the SKIPped test from `tests/interrupt-queue.test.ts` lifted to integration level

**Pre-conditions:**
- `GATEWAY_BUSY_MODE=queue`
- Slow child (300ms)

**Steps:**
1. Register slow child
2. `await mgr.interrupt("reg1", "C-R", "ts-R")`

**Expected (after #54 fix):**
- Returns `true` (NOT `false`)
- Gateway will proceed to process the new message

**Status:** **SKIPped** until #54 is fixed. Set `FIX_QUEUE_MODE_BUG=1` env var to enable.

---

## Test Matrix Summary

| Case | Mode | Status | Severity if fails |
|---|---|---|---|
| IT-01 | interrupt | enabled | P0 (data loss / spec violation) |
| IT-02 | interrupt | enabled | P1 (UX — ack spam) |
| IT-03 | interrupt | enabled | P0 (cross-session contamination) |
| IT-04 | queue | **SKIPped** | P0 (data loss) — #54 |
| IT-05 | queue | enabled | P1 (stuck process) |
| IT-06 | interrupt | enabled | P1 (zombie processes) — #57 |
| IT-07 | interrupt | enabled | P2 (error handling) |
| IT-08 | queue | **SKIPped** | P0 (data loss regression) — #54 |

**Total: 6 enabled + 2 SKIPped (both gated on #54 fix).**
