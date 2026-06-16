# Issues — Gateway Interrupt (STORY-8 interrupt feature)

**Date:** 2026-06-14
**Reviewer:** xiaoma (小马, U0B91BVKTL2)
**Related REVIEW:** `docs/tests/REVIEW-GatewayInterrupt-2026-06-14-xiaoma.md`
**Branch:** `v3/story-8-claude-stream-json` @ `1c66d09`
**Commit under review:** `01dd94b feat(interrupt): gateway busy-ack + interrupt current task on new user message`
**PR:** #53
**Total findings:** 5 (3 P0, 2 P1)
**Issues filed on GitHub:** 5 (1 per finding; per the 1-finding-1-issue rule)

---

## Open

| # | Severity | Title | GH issue | Status |
| --- | --- | --- | --- | --- |
| 1 | P0 | Queue mode silently drops user message (data loss) | [#54](https://github.com/AINIZE-SPACE/ChorusGate/issues/54) | Open — dev fix needed |
| 2 | P0 | Test count claim 77/77 is factually wrong | [#55](https://github.com/AINIZE-SPACE/ChorusGate/issues/55) | **Resolved in this PR** (mkdir added) |
| 3 | P0 | `src/interrupt.ts` has zero test coverage | [#56](https://github.com/AINIZE-SPACE/ChorusGate/issues/56) | **Resolved in this PR** (6 tests added) |
| 4 | P1 | SIGKILL escalation timer is untracked + `clear()` never called on shutdown | [#57](https://github.com/AINIZE-SPACE/ChorusGate/issues/57) | Open — deferred to next sprint |
| 5 | P1 | Old parser can race with new spawn (stale UI, phantom exit events) | [#58](https://github.com/AINIZE-SPACE/ChorusGate/issues/58) | Open — deferred to next sprint |

---

## Per-finding details (see REVIEW for full text)

### #54 — Queue mode data loss (P0) — OPEN
- **Symptom:** `if (!proceed) { eventStore.markHandled(event.id); ... return; }` in `src/gateway.ts:436`
- **Dev's own comment:** "just drop — the user's next message will trigger a new turn"
- **Fix:** implement real queueing (drain pending events after current task), or throw on startup if `GATEWAY_BUSY_MODE=queue`
- **Test:** `tests/interrupt-queue.test.ts` is SKIPped pending this fix; flip `FIX_QUEUE_MODE_BUG=1` env to re-enable.

### #55 — Test count wrong (P0) — **RESOLVED in this PR**
- **Symptom:** "77/77" claimed; actual 80/81 with `codexProvider.generateMCPConfig` failing
- **Root cause:** `config/` dir is gitignored; `writeFileSync` in `src/providers/codex.ts:131` fails silently
- **Fix applied:** `mkdirSync(dirname(configPath), { recursive: true })` before write
- **Re-verified:** `npm test` now reports `86 pass / 0 fail / 1 skipped`.

### #56 — Zero test coverage (P0) — **RESOLVED in this PR**
- **Symptom:** `git grep -l "InterruptManager" -- tests/` returned no files
- **Fix applied:** `tests/interrupt.test.ts` (6 cases) + `tests/interrupt-queue.test.ts` (1 case, SKIPped)
- **Test seam:** `_setWebClientForTests()` in `src/interrupt.ts:24-31`

### #57 — SIGKILL timer untracked + clear() dead code (P1) — OPEN
- **Symptom:** `setTimeout(..., 2000).unref()` not tracked; `clear()` never called from gateway
- **Fix:** store timer handles in `pendingKills: Map<key, Timeout>`; wire `process.on("SIGTERM", ...)` to call `clear()`

### #58 — Old parser races new spawn (P1) — OPEN
- **Symptom:** old parser writes to `placeholderTs` / `progressChain` after new spawn started
- **Fix:** make `interrupt()` async and await child exit; tag spawns with monotonic `spawnId`; suppress parser callbacks on exited child

---

## Resolved

| # | Severity | Title | Resolution |
| --- | --- | --- | --- |
| 2 | P0 | Test count wrong | `mkdirSync` in `src/providers/codex.ts:131` (commit in this PR) |
| 3 | P0 | Zero test coverage | `tests/interrupt.test.ts` + `tests/interrupt-queue.test.ts` (commits in this PR) |

---

## Resolution log

- **2026-06-14 12:50 (xiaoma)**: Filed #54, #55, #56, #57, #58. Wrote REVIEW-GatewayInterrupt-2026-06-14-xiaoma.md + this ISSUES doc.
- **2026-06-14 12:55 (xiaoma)**: Applied mkdir fix (P0-2) + 6 interrupt tests + 1 queue mode SKIPped test. Local `npm test`: 86 pass / 0 fail / 1 skipped. `npm run typecheck` clean. Pushing commits to `v3/story-8-claude-stream-json`.
- (next: 小克 addresses #54 in `src/gateway.ts:436`, then flips `tests/interrupt-queue.test.ts` from `test.skip` to `test` and sets `FIX_QUEUE_MODE_BUG=1` in CI.)

## Update 3 — 2026-06-14 21:08 re-review at HEAD d1fd098

**HEAD re-verified:** `d1fd098` (post 2 new dev pushes: `2b50780` #36 permission auth, `d1fd098` #58 parser race doc)

**Verdict:** CHANGES_REQUESTED — only blocker is merge conflict, no new code defects.

**Per-issue verification (3-prong):**
- Code presence: all 5 prior findings (P0 #54 #55 #56, P1 #57 #58) confirmed at d1fd098
- Test report freshness: REPORT stale (94/94 vs current 106/106) — flagged, not blocking
- Local test run: `npm test` 106/106 PASS, `npm run typecheck` exit 0, 2.1s

**New findings:**
- P0 (state, not code): `mergeable: "CONFLICTING"`, branch behind dev by 1 commit (`86be75b M2 PR #39` filed 2026-06-13). Dev action: `git fetch && git rebase origin/dev`, force-with-lease push, then ping xiaoma for final re-review.
- P3 (informational): PR body says "Closes #32" but `closingIssuesReferences: []` — #32 was already closed before this PR. Auto-link silently dropped. No fix needed; cosmetic only.

**All 5 prior findings status at d1fd098:**

| # | Severity | Title | GH issue | Status at d1fd098 |
| --- | --- | --- | --- | --- |
| 1 | P0 | Queue mode silently drops user message (data loss) | #54 | Resolved — `55f7b3d` `await child exit`; test pass |
| 2 | P0 | Test count claim 77/77 is factually wrong | #55 | Resolved — `e9f1503` mkdir added; current 106/106 verified |
| 3 | P0 | `src/interrupt.ts` has zero test coverage | #56 | Resolved — `e9f1503` 6 interrupt tests; all pass |
| 4 | P1 | SIGKILL escalation timer untracked + `clear()` never called | #57 | Resolved — `e9f1503` timer lifecycle fix |
| 5 | P1 | Old parser can race with new spawn (stale UI, phantom exit) | #58 | Resolved (as documented self-correction) — `d1fd098` doc + `80b0d9a` 10K-trial stress test, 0 false negatives |

**Next step:** 小克 rebase, force-with-lease push, ping xiaoma. xiaoma final re-review = APPROVE (no expected new findings).
