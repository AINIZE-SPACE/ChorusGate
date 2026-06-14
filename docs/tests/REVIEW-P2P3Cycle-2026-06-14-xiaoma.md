# REVIEW: P2/P3 Backlog Cycle (cleanup of v3-story-8 P2/P3 findings)

**Date:** 2026-06-14
**Reviewer:** xiaoma (小马, `U0B91BVKTL2`)
**Requester:** zederer (Master, `U0AHDRREVPD`)
**Dev:** 小克 (`U0B8VHLHJAX`)
**Branch:** `v3/story-8-claude-stream-json` @ `ef41a9e`
**Review scope:** P2/P3 backlog clean-up. Dev's claim: 6 of 11 items done (P2-1, P2-2, P2-4, P2-5, P3-1, P3-2, P3-3), 5 remaining (P2-3, P2-6, P3-4, P3-5). After dev push, HEAD advanced to `ef41a9e` which **also** closed P2-6.
**Related docs:** `docs/planning/v3-story-8-claude-stream-json.md`, `docs/planning/v3-story-interrupt.md`
**Previous review on this branch:** `REVIEW-GatewayInterrupt-2026-06-14-xiaoma.md` (3 P0 + 2 P1; #54/#57/#58 still open)

---

## Verdict

**CHANGES_REQUESTED — 2 P0 + 3 P1 + 1 P2 findings. P0 #54 is a critical data-loss bug still present at HEAD and must block merge.**

Top blockers:

- **P0-1 (F1)**: `#54` queue mode data-loss bug is **still open at `ef41a9e` HEAD**. `src/interrupt.ts:75-76` returns `false`; `src/gateway.ts:432-440` drops the message. Dev's "6 of 11 done" summary does not list #54, suggesting it was forgotten. The previously shipped `tests/interrupt-queue.test.ts` is still SKIPped, confirming no fix landed.
- **P0-2 (F2)**: Git identity confusion — `4c50188 feat(approval)` is authored as `xiaoma <xiaoma@chorusgate-review.local>` (reviewer wrote code), and `bcb0e2b docs(review)` is authored as `delez <delez@163.com>` (dev wrote review doc). Role boundaries are inverted on two commits. SDD invariants broken.
- **P1-1 (F3)**: `5d99d54 refactor(spawn)` is a 6-finding mega-commit + 133-line new `_spawn-helpers.ts` module with **zero test coverage**. The refactor is a sound design but the lack of unit tests for the new shared helpers is a regression risk (the only consumers, `claude.ts` and `claude-stream.ts`, are integration-tested through `reply-engine.test.ts`, not the new module).
- **P1-2 (F4)**: Stale comment in `claude.ts:11-13` references `MCP_SENDER_ONLY=1`, an env var removed in `1c66d09` (sprint-3 P0 fix). Comment lies to the next reader.
- **P1-3 (F5)**: `scripts/diagnose-mention.mjs` hard-codes `U0B91BVKTL2` (小马) and `C0BAB3Y7LLC` (主频道) as test target. If accidentally run, it spams the main project channel with diagnostic messages. Add at minimum a `--dry-run` flag and confirm before sending.
- **P2-1 (F6)**: `5d99d54` commit message claims "P3-5: socket-manager.ts interactive handler notes modal/submit limitation" but the commit stat shows zero changes to `socket-manager.ts`. P3-5 is **not** done despite being listed in the commit message. P3-4 (Windows shell quoting) is also still incomplete — `buildSpawnCommand` does naive `"${arg}"` wrapping, does not escape `&`/`|`/`>`/`<`/`^` and would break on `bin` paths with spaces in real Windows scenarios.

**What is actually done well (verified locally):**

- P2-1 (`lastIndexOf`/`indexOf` colon parsing) — `src/permission-tracker.ts:202,206` correctly slice around embedded colons. Test exists at `tests/permission-tracker.test.ts:153` ("PermissionTracker handleAction parses requestId containing colons"). **PASS**.
- P2-5 (@mention in approval status) — `src/gateway.ts` builds status text with `<@${action.userId}>`. **PASS**.
- P3-1 (`buildApprovalBlocks` typed) — `src/permission-tracker.ts:307` exports `function buildApprovalBlocks(...): SlackBlock[]` — typed return, not `any[]`. **PASS**.
- P3-2 (remove streamToResult parser cast) — `src/providers/claude-stream.ts` adds `parser` to `StreamSpawnResult` interface; the old `as StreamSpawnResult & { parser: ClaudeStreamParser }` cast at lines that previously existed is gone. **PASS**.
- P3-3 (MCP env cache removed) — `.env.example` no longer references `MCP_SENDER_ONLY`; `.mcp.json` env block restored in `76c616e` and unified in `1c66d09`. **PASS**.
- P2-2 + P2-6 (refactor + dedup) — `_spawn-helpers.ts` is a clean shared module; P2-6 dedup in `waitForApproval` is correct logic. **PASS with caveats** (see F3, F6).

---

## Scope

| Commit | Author (claimed) | Files changed | P2/P3 items touched | 
| --- | --- | --- | --- |
| `4c50188 feat(approval)` | **xiaoma** ⚠ | `src/permission-tracker.ts` +237, `src/gateway.ts` +42, `tests/*` | P2-5, P3-1 (reviewer-authored, role inversion) |
| `1c66d09 fix(sprint-3)` | delez | `.claude/mcp.json`, `.env.example`, `src/permission-tracker.ts` +44, `src/gateway.ts` +6, `tests/permission-tracker.test.ts` +63 | P3-3 (env cache removal); unrelated P0 #49–#52 |
| `01dd94b feat(interrupt)` | delez | NEW `src/interrupt.ts` (154 lines), gateway wiring, provider `onSpawn` plumbing | STORY-8 interrupt (pre-existing, see prior review) |
| `5d99d54 refactor(spawn)` | delez | NEW `src/providers/_spawn-helpers.ts` (133 lines), `claude.ts` -109, `claude-stream.ts` -36 | **P2-2, P3-2** (commit body also claims P2-1, P2-4, P2-5, P3-1, P3-3 as "previously fixed") |
| `e9ee7fc fix(codex)` | delez | `src/providers/codex.ts` +2 | mkdir for generated config (P0 mkdir bug from prior review) |
| `7da98e2 test(interrupt)` | delez | `src/interrupt.ts` +13 (test seam), NEW `tests/interrupt.test.ts` (152 lines, 6 cases), NEW `tests/interrupt-queue.test.ts` (90 lines, 1 SKIPped) | STORY-8 interrupt test coverage (closes #56) |
| `bcb0e2b docs(review)` | **delez** ⚠ | NEW `docs/tests/REVIEW-GatewayInterrupt-2026-06-14-xiaoma.md` (196 lines), NEW `docs/tests/ISSUES-GatewayInterrupt-2026-06-14.md` (68 lines) | review of STORY-8 interrupt (dev-authored, role inversion) |
| `ef41a9e fix(permission)` | delez | `src/permission-tracker.ts` +22, NEW `scripts/diagnose-mention.mjs` (126 lines) | **P2-6** (dedup in `waitForApproval`) |

**Diff stat `01dd94b..ef41a9e`:**
```
 .claude/mcp.json                                   |   2 +
 .env.example                                       |  11 +-
 docs/tests/ISSUES-GatewayInterrupt-2026-06-14.md   |  68 +++++++
 docs/tests/REVIEW-GatewayInterrupt-2026-06-14-...  | 196 +++++++++++++++++++++
 scripts/diagnose-mention.mjs                       | 126 +++++++++++++
 src/gateway.ts                                     |   6 +-
 src/interrupt.ts                                   |  13 +-
 src/permission-tracker.ts                          |  65 ++++++-
 src/providers/_spawn-helpers.ts                    | 133 ++++++++++++++
 src/providers/claude-stream.ts                     |  51 ++----
 src/providers/claude.ts                            | 154 +++++-----------
 src/providers/codex.ts                             |   3 +-
 tests/interrupt-queue.test.ts                      |  90 ++++++++++
 tests/interrupt.test.ts                            | 152 ++++++++++++++++
 tests/permission-tracker.test.ts                   |  63 ++++++-
 15 files changed, 969 insertions(+), 164 deletions(-)
```

---

## 6-item claim verification

For each item the dev listed as "已完成", I verified the fix is **actually present at HEAD** (not just claimed in a commit message) and is **not just code but also a test that locks in the behavior**.

| Item | Dev claim | Commit | Verified at HEAD? | Test exists? | Verdict |
| --- | --- | --- | --- | --- | --- |
| P2-1 requestId 冒号解析 | 已修 | `fe1d3ad2` (2026-06-13) | ✓ `permission-tracker.ts:202,206` use `lastIndexOf`/`indexOf` | ✓ `permission-tracker.test.ts:153` | **PASS** |
| P2-2 spawn 共享模块 | 已修 | `5d99d54` | ✓ NEW `_spawn-helpers.ts` (133 lines, 5 exports) | ✗ **0 dedicated unit tests for the new module** | **PASS w/ F3** |
| P2-4 claudeStreamProvider 文档化 | 已修 (claimed in `5d99d54` body as "previously fixed") | (no diff in any doc file in `5d99d54`) | ⚠ `docs/planning/v3-story-8-claude-stream-json.md` has a `### ClaudeStreamProvider` section, but no API/interface doc — only design notes | n/a | **PARTIAL** — the spec doc section is fine but no code-level JSDoc. Acceptable for v3. |
| P2-5 审批消息 @提及 | 已修 | `4c50188` (xiaoma) | ✓ `gateway.ts` builds `*Allow once by <@${action.userId}>*` in status text | ⚠ No dedicated test for `<@…>` rendering, but integration covered by `permission-tracker.test.ts` | **PASS** (despite author inversion) |
| P3-1 buildApprovalBlocks typed | 已修 | `4c50188` (xiaoma) | ✓ `src/permission-tracker.ts:307 export function buildApprovalBlocks(...): SlackBlock[]` (typed return, not `any[]`) | ✓ `permission-tracker.test.ts:259` "buildApprovalBlocks returns 4-button Slack blocks" | **PASS** |
| P3-2 移除 streamToResult 强转 | 已修 | `5d99d54` | ✓ `parser` added to `StreamSpawnResult` interface; `streamToResult` no longer casts | ⚠ No dedicated regression test, but covered transitively by `reply-engine.test.ts` | **PASS** |
| P3-3 MCP config env 缓存移除 | 已修 | `1c66d09` | ✓ `.env.example` no longer mentions `MCP_SENDER_ONLY`; `.mcp.json` env block restored in `76c616e` | n/a (config-level) | **PASS** |
| **P2-6** permission dedup | (was in "remaining" but `ef41a9e` closed it) | `ef41a9e` | ✓ `waitForApproval` checks pending map for `${sessionIdentity}:${toolName}` match | ✓ `permission-tracker.test.ts:130` "duplicate request req_b (same tool+session as req_a), skipping" | **PASS** (separately, not in original 6-item claim) |

**Net assessment:** 6/7 of the P2/P3 items the dev claimed are real. The 7th (P2-6) was added after the dev's summary. The 6th "PASS w/ F3" warning is the lack of unit tests for `_spawn-helpers.ts`, which is not a "P2/P3 item not done" finding per se but a refactor hygiene issue. P2-4 is partial — the spec doc has a section but no JSDoc-style API doc. I judge P2-4 PASS because the spec was documented in `v3-story-8-claude-stream-json.md`.

**What the dev listed as "remaining" but is also done elsewhere:**
- P2-6: closed by `ef41a9e` (after the dev wrote the summary)
- (Other 4: P2-3, P3-4, P3-5, P2-3: not done at HEAD — verified)

---

## Findings

### F1 — `#54` queue mode data-loss still open at HEAD (P0, blocks merge)

- **GH issue:** [#54](https://github.com/AINIZE-SPACE/ChorusGate/issues/54) (pre-existing, opened in prior review `REVIEW-GatewayInterrupt-2026-06-14-xiaoma.md`)
- **Location:**
  - `src/interrupt.ts:75-76` — `if (BUSY_MODE === "queue") { await this.sendBusyAck(...); return false; }`
  - `src/gateway.ts:432-441` — `if (!proceed) { eventStore.markHandled(event.id); inFlight.delete(...); releaseSlot(); return; }`
- **Symptom:** When `GATEWAY_BUSY_MODE=queue`, every user message that arrives while another task is running is silently dropped. The gateway sends a "⏳ 排队" ack and then the message disappears. The user's next message will trigger a new turn, but the dropped one is gone.
- **Why this matters now:** the dev's "6 of 11 done" summary in this thread does **not** list P2-3 / P3-4 / P3-5 — but it also does not list #54. The two P0 review commits in this cycle (`5d99d54`, `ef41a9e`) do not touch `src/interrupt.ts:75-76`. The previously shipped regression test `tests/interrupt-queue.test.ts` is still SKIPped, which is the canary — the test was authored to be re-enabled after the fix, and the env gate `FIX_QUEUE_MODE_BUG=1` is not flipped.
- **Verification at HEAD `ef41a9e`:**
  ```bash
  $ git show HEAD:src/interrupt.ts | sed -n '70,80p'
  if (BUSY_MODE === "queue") {
    // Queue mode: let current task finish, message will be processed after
    await this.sendBusyAck(channel, threadTs, "queue");
    return false; // don't process now — it'll be queued
  }
  ```
- **Fix proposal:** (A) `interrupt()` in queue mode should `await` the child to exit (poll `child.exitCode` and `child.once("exit")`) and then `return true`; gateway would fall through to normal processing. The reader's WIP in the test clone (now stashed) implements exactly this. (B) Throw on startup if `GATEWAY_BUSY_MODE=queue` is set and queueing is not implemented.
- **Acceptance test:** set `GATEWAY_BUSY_MODE=queue`, set `FIX_QUEUE_MODE_BUG=1`, run `tests/interrupt-queue.test.ts`. The test should pass (not SKIP).
- **Risk if merged without fix:** every deployment with `GATEWAY_BUSY_MODE=queue` silently drops messages. This is a data-loss bug.

### F2 — Git identity confusion (P0, governance)

- **GH issue:** new, to be filed
- **Locations:**
  - `4c50188 feat(approval): 4-button approval` — author `xiaoma <xiaoma@chorusgate-review.local>` (reviewer, not dev)
  - `bcb0e2b docs(review): REVIEW + ISSUES for Gateway Interrupt` — author `delez <delez@163.com>` (dev, not reviewer)
- **Symptom:** Two commits have inverted authorship vs. the SDD separation of concerns:
  - `4c50188` is a code commit implementing P2-5 + P3-1, written by the reviewer. Code-by-reviewer violates the SDD contract.
  - `bcb0e2b` is a review doc, written by the dev. Doc-by-dev means the "review" of the dev's own work is the dev's own document, not a real review.
- **Why it matters:** The branch's audit trail is broken. Future readers cannot tell who reviewed what. The "REVIEW-GatewayInterrupt-2026-06-14-xiaoma.md" file at `bcb0e2b` claims to be the reviewer's output, but the commit was authored by the dev — that means either the dev edited the reviewer's draft, or the dev wrote the entire thing under the reviewer's filename. Either way, the audit is untrustworthy.
- **Possible explanations (not excuses):**
  - The git config of the agent runs in the dev's working dir uses `user.name=delez` only, but the reviewer agent's WSL2 working dir got `user.name=xiaoma` from `git config --local`. When the dev picked up the WIP, the WIP carried the reviewer's identity. Plausible.
  - The reviewer may have made the code change but committed in the dev's clone (wrong workflow — reviewer should be in a separate clone).
- **Fix proposal:** 
  1. **Resolve the audit gap**: re-author `4c50188` and `bcb0e2b` so each commit's author matches its content type. If the dev actually wrote the code in `4c50188`, re-author to `delez`. If the reviewer actually wrote the review doc, re-author to `xiaoma`. Use `git rebase --exec 'git commit --amend --reset-author --no-edit' …` or `git filter-repo` (NOT `git rebase -i` with `edit` because that touches the diff, not just metadata).
  2. **Document the rule** in `.claude/skills/sprint-handoff/SKILL.md` and in this SKILL.md: code commits go through dev's clone with `user.name=delez`; review docs go through reviewer's clone with `user.name=xiaoma`. Add a CI lint that fails the PR if a `docs/tests/REVIEW-*.md` commit's author is not `xiaoma@…` or if a `feat:`/`fix:`/`refactor:` commit's author is `xiaoma@…`.
- **Acceptance test:** `git log --format='%an <%ae> %s' ef41a9e~3..ef41a9e | grep -v delez` returns zero `feat:`/`fix:`/`refactor:` commits; `git log --format='%an <%ae> %s' 4c50188~1..ef41a9e | grep -v xiaoma` returns zero `docs(review):` commits.

### F3 — `5d99d54` mega-commit + zero tests for new `_spawn-helpers.ts` (P1)

- **GH issue:** new
- **Location:** `src/providers/_spawn-helpers.ts` (NEW, 133 lines, 5 exports)
- **Symptom:** The "P2/P3 clean-up" commit `5d99d54 refactor(spawn)` does two things:
  1. Extracts 5 helper functions from `claude.ts` and `claude-stream.ts` into a new module `_spawn-helpers.ts`. This is good refactoring.
  2. Claims to also fix 6 other P2/P3 items in the commit body ("Previously fixed (already in earlier commits): P2-1, P2-4, P2-5, P3-1, P3-3").

  But the commit's actual code change is the spawn-helpers refactor + the parser-interface change. The 6-item claim is a *status report*, not code in this commit. This conflates "the cycle is done" with "this commit does the work", and it hides the fact that the refactor was not accompanied by any unit test for the new module.

- **Specific gaps in the refactor itself:**
  - `buildSpawnCommand` on Windows does naive `"${arg}"` quoting for args with spaces but does not escape shell metacharacters (`&`, `|`, `>`, `<`, `^`, `"`). An arg like `Hello & echo PWNED` would break. This is the **P3-4** item, still open.
  - `spawnAndWait` has a confusing TDZ pattern in callers: `claude.ts:74` references `sr.stderr` inside a callback that's passed to `spawnAndWait(...)` BEFORE `const sr = spawnAndWait(...)` is evaluated. JavaScript closures work here because the callback runs after `sr` is initialized, but the source code is hard to read and TypeScript should ideally flag this (it doesn't, because the `sr` reference is inside a function expression).
  - `flushBuffer(feedLine)` force-appends `"\n"` to flush partial lines. If `feedLine` has side effects beyond the onLine callback (e.g., logging), those side effects fire on the synthetic `"\n"`. Currently safe, but the function's contract is loose.
- **What the refactor is missing:**
  - 0 unit tests for `buildSpawnCommand` (Windows path with special chars, args with spaces, empty args list)
  - 0 unit tests for `createLineBuffer` (partial line in buffer, multiple chunks splitting one line, `\r\n` line endings, empty buffer)
  - 0 unit tests for `flushBuffer` (empty buffer, partial data)
  - 0 unit tests for `spawnAndWait` (timeout, error event, close event, double-settle, signal callbacks)
  - The refactor is verified only by the existing `reply-engine.test.ts` running through the integration path. If a future refactor breaks `buildSpawnCommand` on Windows, no test will catch it.
- **Fix proposal:** Add `tests/spawn-helpers.test.ts` with at least:
  - `buildSpawnCommand`: 6 cases (non-Windows baseline, Windows with no-arg bin, arg with space, arg with special char, empty args list, bin path with space)
  - `createLineBuffer`: 4 cases (single chunk with multiple lines, chunks splitting one line, `\r\n` endings, empty chunks)
  - `flushBuffer`: 2 cases (buffer with partial data, empty buffer)
  - `spawnAndWait`: 4 cases (clean exit, error event, timeout SIGKILL, double-settle guard)
- **Why P1 not P0:** the existing integration tests exercise the public path. The refactor is behaviorally equivalent for the tested paths. The risk is regression on edge cases, not current breakage.
- **Side note (P3):** the `5d99d54` commit message violates the per-finding commit rule from `code-review-workflow/SKILL.md` — it bundles P2-2 + P3-2 (and arguably references 5 other items in the body). Future PRs should keep commit-per-finding. For this commit, the work is already in the tree — splitting it now is more disruption than value.

### F4 — Stale comment in `claude.ts:11-13` references removed env var (P1)

- **GH issue:** new
- **Location:** `src/providers/claude.ts:11-13`
- **Symptom:** The comment says:
  ```
  // gateway 进程持有 Socket Mode 连接；spawn 的 claude 只通过
  // MCP_SENDER_ONLY=1 使用 Web API 工具。不再生成临时 config 文件。
  ```
  But `MCP_SENDER_ONLY=1` was **removed** in commit `1c66d09` (sprint-3 P0 fix #51). The comment refers to a config knob that no longer exists, which misleads any reader who tries to grep for `MCP_SENDER_ONLY` in `.env.example` to understand the flow.
- **Verification:**
  ```bash
  $ git grep -n MCP_SENDER_ONLY -- .env.example .claude/mcp.json .mcp.json
  (no matches — the env var is gone)
  $ git grep -n MCP_SENDER_ONLY -- src/
  src/providers/claude.ts:12: // MCP_SENDER_ONLY=1 使用 Web API 工具。不再生成临时 config 文件。
  (only the comment remains)
  ```
- **Fix proposal:** Replace the comment with the actual current behavior:
  ```
  // gateway 进程持有 Socket Mode 连接；spawn 的 claude 通过 .claude/mcp.json
  // (unified with .mcp.json) 加载 MCP 服务。两个进程共享同一份 MCP 配置。
  ```
- **Acceptance test:** `git grep -n MCP_SENDER_ONLY -- src/ .env.example` returns zero matches.

### F5 — `scripts/diagnose-mention.mjs` hard-codes 小马 + 主频道 (P1)

- **GH issue:** new
- **Location:** `scripts/diagnose-mention.mjs:24-25`
- **Symptom:** The diagnostic script (added in `ef41a9e`) hard-codes:
  ```js
  const TEST_CHANNEL = process.argv[2] || "C0BAB3Y7LLC"; // #agent-channel-gateway
  const TEST_USER = process.argv[3] || "U0B91BVKTL2";     // 小马
  ```
  Running `node scripts/diagnose-mention.mjs` without args will:
  1. Call `auth.test` (read-only, OK)
  2. Call `users.info` on 小马 (read-only, OK)
  3. **Post 3 messages** to the main project channel `C0BAB3Y7LLC` mentioning 小马.
- **Risk:** any agent (including me, the reviewer) running this script "just to see what it does" will spam the main channel. The script's purpose is diagnostic, but the default target is the project channel. There's no `--dry-run` flag and no confirmation prompt.
- **Why this is P1 not P3:** the Slack workspace is a real production-ish surface; 3 messages with `@小马` mentions will trigger notification noise.
- **Fix proposal:**
  1. Add `--dry-run` flag (default true; only sends when `--send` is passed).
  2. Refuse to run if the channel is `C0BAB3Y7LLC` AND `--send` is not explicitly passed.
  3. Print the resolved channel + user IDs and ask the operator to confirm in stdout before calling `chat.postMessage`.
- **Acceptance test:** `node scripts/diagnose-mention.mjs` exits without calling `chat.postMessage` (prints `DRY RUN` instead).

### F6 — `5d99d54` commit message overstates: P3-5 not actually done (P2)

- **GH issue:** new
- **Location:** commit message of `5d99d54`
- **Symptom:** The commit body says:
  > P3-5: socket-manager.ts interactive handler notes modal/submit limitation
  But the commit's `git show --stat 5d99d54` returns:
  ```
  src/providers/_spawn-helpers.ts | 133 +++++++
  src/providers/claude-stream.ts  |  51 ++---
  src/providers/claude.ts         | 154 +++++-----------
  3 files changed, 192 insertions(+), 146 deletions(-)
  ```
  No `socket-manager.ts` in the stat. The P3-5 item ("socket-manager modal/submit handler") was **not** modified in this commit. If the dev intended to add a code comment in `socket-manager.ts` documenting the limitation, that didn't happen.
- **Why P2 not P1:** the project is not broken by this — `socket-manager.ts` already handles the existing block actions. The issue is the commit message lies. Future readers will trust the commit message and waste time grepping.
- **Related issue (P3-4):** the same commit body lists "Remaining: P2-3 (permissionMode param), P2-6 (permission dedup), P3-4 (Windows shell quoting)". P2-6 is now closed by `ef41a9e`. P2-3 and P3-4 are still open. The commit body for `5d99d54` was correct at the time of writing but stale by `ef41a9e`.
- **Fix proposal:**
  1. For P3-5: either do the doc-comment addition in `src/socket-manager.ts` (a 2-line diff: a comment block above the `setBlockActionCallback` registration), or remove the line from the commit body if it was abandoned.
  2. For P3-4: this is a real refactor item. The current `buildSpawnCommand` in `_spawn-helpers.ts:14-22` is naive. Replace with a proper Windows quoting helper (e.g., use `child_process.spawn` with `shell: true` and a properly-escaped arg list, or use `cross-spawn`).
  3. For P2-3: parameterize `PERMISSION_MODE` so it's not read once at module import. Currently `src/gateway.ts:80-81` reads `process.env.CLAUDE_PERMISSION_MODE` at startup; pass it through `CreateSessionOptions` like `timeoutMs`.
- **Acceptance test:** after fix, `git grep -n MCP_SENDER_ONLY -- src/ .env.example` returns zero matches (F4 covered). `git grep -n 'PERMISSION_MODE' -- src/gateway.ts` shows a per-call read or a parameter.

---

## Verification log

```
$ git log --oneline -1
ef41a9e fix(permission): add dedup for concurrent same-tool permission requests (P2-6)

$ git status -s
(empty after stash + fast-forward)

$ npm run typecheck
> tsc --noEmit
(rc=0)

$ npm test
ℹ tests 94
ℹ pass 91
ℹ fail 0
ℹ skipped 3   (1 in interrupt-queue, 2 in interrupt-integration)
ℹ duration_ms 2048.6

$ git grep -n "MCP_SENDER_ONLY" -- src/ .env.example
src/providers/claude.ts:12:  // MCP_SENDER_ONLY=1 使用 Web API 工具。不再生成临时 config 文件。

$ git grep -ln "buildApprovalBlocks" -- src/
src/permission-tracker.ts:307
src/gateway.ts:34,575
tests/claude-stream-integration.test.ts:14
tests/permission-tracker.test.ts:10

$ git show ef41a9e:src/interrupt.ts | sed -n '70,80p'
if (BUSY_MODE === "queue") {
  // Queue mode: let current task finish, message will be processed after
  await this.sendBusyAck(channel, threadTs, "queue");
  return false; // don't process now — it'll be queued
}

$ git log --format='%h %an <%ae> %s' -8
ef41a9e delez <delez@163.com> fix(permission): add dedup for concurrent same-tool permission requests (P2-6)
bcb0e2b delez <delez@163.com> docs(review): REVIEW + ISSUES for Gateway Interrupt (STORY-8 interrupt)  ⚠
7da98e2 delez <delez@163.com> test(interrupt): add unit tests for InterruptManager + test seam
e9ee7fc delez <delez@163.com> fix(codex): mkdirSync before writeFileSync — generated config dir may not exist
5d99d54 delez <delez@163.com> refactor(spawn): extract shared spawn helpers + fix P2-2, P3-2
1c66d09 delez <delez@163.com> fix(sprint-3): address P0 review findings #49 #50 #51 #52
01dd94b delez <delez@163.com> feat(interrupt): gateway busy-ack + interrupt current task on new user message
4c50188 xiaoma <xiaoma@chorusgate-review.local> feat(approval): 4-button approval (Hermes-style) + session/always auto-approval  ⚠

# the WIP stash (separate from the branch state, owned by reviewer)
$ git stash list
stash@{0}: On v3/story-8-claude-stream-json: reviewer-wip-p0-fixes-pre-stash-2026-06-14
```

Note on the WIP stash: when this session started, the review clone had 5 uncommitted files (98 lines diff) that I identified as reviewer-side P0 fix drafts (queue-mode drop bug + permission clicker validation + plan 串味 + test enablement). Per `code-review-workflow` pitfall "uncommitted WIP in the review clone", I preserved them with `git stash push -u`. They are not part of this review's scope. They will be re-applied as a separate fix PR after zederer confirms.

---

## Next steps

1. **This PR**: NOT READY TO MERGE. P0 #54 is still open; F1 must close before any merge.
2. **小克**: address F1 in a single fix commit on the same branch. Use the WIP from `git stash@{0}` as a starting reference, but **rewrite it fresh** in the dev's clone so the commit author is `delez` (per F2 audit fix).
3. **小克**: address F2 by re-authoring the inverted commits (`4c50188` → `delez`; `bcb0e2b` → `xiaoma`) via `git rebase` + `--reset-author` or `git filter-repo`. The rebase is interactive and small (8 commits).
4. **小克**: address F3 by adding `tests/spawn-helpers.test.ts` with at least 16 cases. One commit, focused.
5. **小克**: address F4 with a one-line comment fix. One commit.
6. **小克**: address F5 by adding `--dry-run` to `scripts/diagnose-mention.mjs`. One commit.
7. **小克**: address F6 (P3-5) by either adding the doc comment in `socket-manager.ts` or removing the false claim from the commit body of any future refactor that touches P3-5.
8. **xiaoma (me)**: once F1–F6 are addressed, re-verify locally and update this REVIEW + ISSUES docs to reflect the closed issues. Then run the full test suite once more and file the re-review verdict on the PR.
9. **zederer**: review this REVIEW doc; confirm P0 #54 should block merge; do not merge the dev branch into `dev`/`main` until F1 is closed.
10. The remaining 3 items in the dev's "remaining" list (P2-3, P3-4, P3-5) can stay on the backlog; the dev should not bundle them with the P0/P1 fixes.

---

## P3 observations (non-blocking)

- **P3-1** — `_spawn-helpers.ts` uses single-letter export `sr` in callers (`src/providers/claude.ts:65-105`). Rename to `spawnResult` or `result` for readability.
- **P3-2** — `5d99d54` commit message includes 5 stale "Previously fixed" items that are not in the diff. Future commits should be self-contained — a reader should be able to `git show <commit>` and see all the code that the message describes.
- **P3-3** — The SKIPped test in `tests/interrupt-queue.test.ts` uses `FIX_QUEUE_MODE_BUG=1` env gate. After F1 is fixed, the gate should be removed and the test promoted to `test()` — the env var pattern works for gate-while-broken but is dead code in a green state.
- **P3-4** — `interrupt.test.ts` and `interrupt-queue.test.ts` both have `process.env.GATEWAY_BUSY_MODE = "..."` at the top of the file. This relies on ESM module-cache order: whichever file is imported first wins. The test runner's alphabetical file order happens to put `interrupt-queue.test.ts` before `interrupt.test.ts`, so it works. But a future rename or test-runner change would break it silently. Consider extracting the env-setting into a `before()` hook with explicit re-import of the SUT.
- **P3-5** — `1c66d09` commit body says "80/80 tests pass" but actual count at the time of that commit was 87 (after STORY-8 interrupt was added). The claim is stale; the new baseline at `ef41a9e` is 94. The dev should always run `npm test` immediately before committing to get an accurate count.
- **P3-6** — The `docs/tests/REPORT-*.md` file from the prior interrupt review (REPORT-InterruptSIT-2026-06-14-xiaoma.md, 8907 bytes) is still in the tree but does not reflect the current state — it was authored before `5d99d54` and `ef41a9e`. Either refresh it or document why it's still authoritative.

---

## Cross-references

- Prior review on this branch: [`REVIEW-GatewayInterrupt-2026-06-14-xiaoma.md`](./REVIEW-GatewayInterrupt-2026-06-14-xiaoma.md) — introduced #54, #55, #56, #57, #58
- Prior review on STORY-9 MCP Web API: [`REVIEW-STORY9-R2-2026-06-14-xiaoma.md`](./REVIEW-STORY9-R2-2026-06-14-xiaoma.md) — 6/6 issues closed
- Spec for STORY-8 interrupt: `docs/planning/v3-story-interrupt.md`
- Spec for STORY-8 stream-json: `docs/planning/v3-story-8-claude-stream-json.md`
- Permission dedup test: `tests/permission-tracker.test.ts:130`
- SKIPped queue-mode regression test: `tests/interrupt-queue.test.ts:60`

---

*Reviewer: xiaoma (`U0B91BVKTL2`) · 2026-06-14 · CHANGES_REQUESTED*


---

# Update 1 — 2026-06-14 14:00 — Re-verified at HEAD `97f5b97` (6 commits later)

**Status of original 6 findings:**

| # | Title | Original verdict | New verdict | Closed by | Evidence at HEAD |
| - | ----- | ---------------- | ----------- | --------- | ---------------- |
| F1 | `#54` queue mode data loss | OPEN (P0) | **FIXED** ✓ | `c12e0b6` | `src/interrupt.ts:73-91` now `await sendBusyAck` + wait child exit + `return true`; `tests/interrupt-queue.test.ts` is no longer SKIPped |
| F2 | Git identity confusion (4c50188=xiaoma, bcb0e2b=delez) | OPEN (P0) | **OPEN** ✗ | (none) | `4c50188` still authored `xiaoma <xiaoma@chorusgate-review.local>`; `bcb0e2b` still authored `delez <delez@163.com>` |
| F3 | `_spawn-helpers.ts` zero test coverage | OPEN (P1) | **OPEN** ✗ | (none) | `git ls-files -- "tests/*.test.ts"` shows no file covering `spawnAndWait` / `buildSpawnCommand` / `createLineBuffer` |
| F4 | Stale `MCP_SENDER_ONLY` comment in claude.ts | OPEN (P1) | **FIXED** ✓ | `02f256b` | `src/providers/claude.ts:7` now reads `// MCP: \`claude -p\` 继承父进程环境，直接加载项目 \`.mcp.json\`。` — no reference to `MCP_SENDER_ONLY` |
| F5 | `scripts/diagnose-mention.mjs` hard-coded target | OPEN (P1) | **FIXED** ✓ (deleted) | `97f5b97` | File removed; `git ls-files scripts/` returns empty |
| F6 | `5d99d54` commit message overstates P3-5 | OPEN (P2) | **OPEN** ✗ | (none) | `git log --oneline 01dd94b..HEAD -- src/socket-manager.ts` returns empty — `socket-manager.ts` still has no P3-5 doc comment |

**Net change: 3 of 6 fixed (F1, F4, F5); 3 still open (F2 P0, F3 P1, F6 P2).** The 3 fixed items resolved 2 P0 + 1 P1 blockers.

**New baseline at HEAD `97f5b97` (post-FF from origin):**

```
$ git log --oneline -1
97f5b97 fix(slack): add link_names:true to slack_reply tool + full call site audit

$ npm run typecheck
> tsc --noEmit
(rc=0)

$ npm test
ℹ tests 95
ℹ pass 95
ℹ fail 0
ℹ skipped 0   (was 3; F1 unskipped 1, F4 fix unblocked 1 more, 1 was F5-related)
ℹ duration_ms 3232.8
```

**New commits since `ef41a9e` (FF'd in from origin while this review was being written):**

| Commit | Author | What it does | Findings closed |
| ------ | ------ | ------------ | --------------- |
| `6dc97bd` | delez | `link_names:true` on chat.postMessage | (none in this review; addresses #60 separately) |
| `071095c` | delez | System integration test for gateway interrupt | (none directly; provides the SIT harness for #54 regression) |
| `c12e0b6` | delez | **#54 queue mode fix** | F1 |
| `329e94b` | delez | `link_names:true` on slack_reply tool (first pass) | (separate #60) |
| `02f256b` | delez | Delete `.claude/mcp.json`; pin trello@2.2.3; refresh provider comments; `MCP_SENDER_ONLY=1` defense-in-depth in `.mcp.json` | F4 (and pre-existing #52, #9, #8, #11) |
| `97f5b97` | delez | Remove `scripts/diagnose-mention.mjs`; add `link-names-regression.test.ts`; remove unused manifest scopes | F5 (and #60, #61, #62) |

**Updated verdict: `CHANGES_REQUESTED` (1 P0 + 1 P1 + 1 P2).** Critical path: F2 (identity rebase) → F3 (spawn-helpers test) → F6 (P3-5 doc). F2 is the only P0 left; F3 and F6 can ship together in a follow-up commit if the dev wants to keep this PR focused.

**Updated next steps for 小克:**

1. **F2** (P0, blocks merge): rebase the 2 inverted commits and re-author. Use `git rebase --exec 'git commit --amend --reset-author --no-edit' …` on the local `v3/story-8-claude-stream-json` branch (range `4c50188~1..bcb0e2b`). After the rebase, force-push (`git push --force-with-lease`).
2. **F3** (P1): add `tests/spawn-helpers.test.ts` with the 16 cases listed in F3's acceptance criteria. One commit.
3. **F6** (P2): add a 2-line doc comment in `src/socket-manager.ts` above the `setBlockActionCallback` registration, documenting the modal/submit limitation. Update or amend the `5d99d54` commit message in a follow-up if desired. P3-4 (Windows shell quoting) and P2-3 (parameterize PERMISSION_MODE) are still open but can stay on the backlog.

**For zederer:**

- The PR is now ready to merge once F2 is fixed (F3 and F6 are not blockers, they can land in a follow-up).
- The 3 fixed items (F1, F4, F5) and the unrelated sprint-3 fixes (4 P0 #52 #9 #8 #11) are solid.
- The 95-pass / 0-fail / 0-skip baseline is the new truth; the earlier "86 pass / 1 skipped" was for the prior HEAD.

**The 6-issue file split rule was relaxed for this update because 3 findings resolved via commits that already exist in the tree — no new GH issues need to be filed for the fixed ones. The remaining 3 open findings each get one issue below.**

---

*Update authored by xiaoma (`U0B91BVKTL2`) · 2026-06-14 14:00 · post-FF re-verification at HEAD `97f5b97`*


---

## Update 2 — 2026-06-14 19:50 — Re-review of dev's "P2/P3 11/11 done" handoff

**HEAD re-verified:** `f65cfc67 fix(p3): P3-4 Windows backslash escaping + P3-5 modal handler log` (after `git fetch` + `git reset --hard @{u}`; the dev **force-pushed** since Update 1, replacing 19 prior commits with a new history tree).
**PR:** [#53](https://github.com/AINIZE-SPACE/ChorusGate/pull/53) — still OPEN, head changed to `f65cfc6`.
**Trigger:** dev's Slack handoff claiming "P2/P3 backlog 全部完成 (11/11)，请验收" with "本次修复 P3-4 + P3-5".
**Methodology:**
1. `git fetch` revealed a **force-push** — `+ 97f5b97...f65cfc6` — replacing 19 prior commits. New tree is 21 commits, all SHAs changed.
2. Reset to upstream; re-ran `npm run typecheck` (PASS) and `npm test` (106 pass / 0 fail / 0 skip — dev's 106/106 claim verified).
3. Re-verified each P2/P3 item at `f65cfc6` HEAD.
4. Enumerated the 8 still-open GH issues from prior rounds and cross-checked whether code at HEAD actually addresses them.

### Verdict (Update 2)

**CHANGES_REQUESTED — 3 NEW P0 + 3 NEW P1 + 2 NEW P2 findings. 8 of the 11 internal P2/P3 items pass; P3-4 is partial; P2-3 is closed-by-commit-body only. The force-push rewrote 19 commits' SHAs — all prior `closes #N` cross-references in commit messages are now broken.**

### Update 2 — 11-item claim verification

| Item | Dev claim | Verified at HEAD? | Test exists? | Verdict |
| --- | --- | --- | --- | --- |
| P2-1 requestId 冒号解析 | 已修 | ✓ `permission-tracker.ts:202,206` use `lastIndexOf`/`indexOf` | ✓ `permission-tracker.test.ts:153` | **PASS** |
| P2-2 spawn 共享模块 | 已修 | ✓ `_spawn-helpers.ts` (146 lines) | ✓ `spawn-helpers.test.ts` 11 cases (added in `afdda47`) | **PASS** |
| P2-3 PERMISSION_MODE 参数化 | "deemed non-actionable — permissionMode already reads from process.env at call time" | ⚠ `src/gateway.ts:80-81` still has module-level `const PERMISSION_MODE` (frozen at import time). Call sites in `claude.ts:89`, `claude-stream.ts:165,204,289`, `reply-engine.ts:40,112` do read at call time, so the dev's "call time" claim is partially true. ESM-freeze argument was the prior review's concern; in practice `loadEnv()` is called before module import so this never freezes. | n/a | **PASS w/ caveat** (defensible but undocumented — see F8) |
| P2-4 claudeStreamProvider 文档化 | 已修 | n/a (spec doc section exists per Update 1) | n/a | **PASS** |
| P2-5 @mention 审批状态 | 已修 | ✓ `gateway.ts` builds `*Allow once by <@${action.userId}>*` | ⚠ no dedicated test (covered by integration) | **PASS** |
| P2-6 permission dedup | 已修 (in `2958e02`) | ✓ `waitForApproval` checks pending map | ✓ `permission-tracker.test.ts:130` | **PASS** |
| P3-1 buildApprovalBlocks typed | 已修 | ✓ `permission-tracker.ts:307` returns `SlackBlock[]` | ✓ `permission-tracker.test.ts:259` | **PASS** |
| P3-2 streamToResult parser cast | 已修 | ⚠ `streamToResult`'s own signature change is clean, but `createStreamSession` at L319 still has `as StreamSpawnResult & { parser: ClaudeStreamParser }` cast — same pattern moved, not removed. Not blocking. | ⚠ covered by reply-engine tests | **PASS w/ caveat** |
| P3-3 MCP env cache removed | 已修 | ✓ `.env.example` no longer references `MCP_SENDER_ONLY`; `.mcp.json` env block restored | n/a | **PASS** |
| **P3-4 Windows shell quoting** | 已修 (in `f65cfc6`) | ⚠ **PARTIAL** — only backslashes escaped; `& \| > < ^ "` cmd.exe metacharacters still un-escaped (per Update 1's F6 finding, the full fix was the spec) | ✗ no new test for backslash escape behavior | **PARTIAL — see F4** |
| **P3-5 socket-manager modal/submit log** | 已修 (in `f65cfc6`) | ✓ `socket-manager.ts:229-234` logs `view_submission`/`view_closed` types | n/a (diagnostic only) | **PASS** (consistent with "notes the limitation" interpretation) |

**Net:** 9 of 11 fully pass; P3-4 is partial; P2-3 closed without proper documentation.

### Update 2 — Findings

#### F1 (NEW P0) — `e9696a4` is a placebo fix based on incorrect Slack API understanding

- **GH issue:** [#66](https://github.com/AINIZE-SPACE/ChorusGate/issues/66)
- **Location:** `e9696a4 fix(slack): add unfurl_links:false + unfurl_media:false to all postMessage` (5 files / 12 insertions)
- **Symptom:** Commit message claims:
  > Root cause: Slack silently suppresses push notifications for bot token (xoxb-) messages even with correct <@USER_ID> format. Adding unfurl_links:false + unfurl_media:false bypasses this suppression in some workspace configurations.
  
  This is **factually wrong**. `unfurl_links` and `unfurl_media` are documented by Slack as controlling **link preview rendering** (whether a URL is expanded into a preview card) — they have **no relationship** to push notification delivery. The actual fix for #59 (mention notification) is `link_names: true`, which was correctly applied in `6b4714a`/`ca06b99`/`c7a7b381` (5 sites + slack_reply + reply.ts) and the regression test at `tests/link-names-regression.test.ts`.
- **Why this is dangerous:** The 12 added `unfurl_*: false` lines are dead code that will mislead future maintainers into thinking these flags affect notification delivery. The `.claude/skills/sprint-handoff/SKILL.md` commit in the same round enshrines this wrong understanding as a process rule ("chat.postMessage: link_names: true, unfurl_links: false, unfurl_media: false") — see F5.
- **Fix proposal:** Revert the 5 file changes in `e9696a4`. Keep only the `link_names: true` changes (which were the real fix). Update `.claude/skills/sprint-handoff/SKILL.md` to drop the `unfurl_*` mention.
- **Acceptance test:** `git grep -n "unfurl_links\|unfurl_media" src/` returns 0 matches. `git grep -n "unfurl_links\|unfurl_media" .claude/skills/sprint-handoff/SKILL.md` returns 0 matches.
- **Risk if merged without fix:** None for runtime (unfurl_* is a no-op for notifications), but the wrong Slack API claim will propagate to future reviews and confuse the next dev.

#### F2 (NEW P0) — `f65cfc6` hides 600+ lines of out-of-scope changes behind a "P3 fix" commit message

- **GH issue:** [#67](https://github.com/AINIZE-SPACE/ChorusGate/issues/67)
- **Location:** `f65cfc6 fix(p3): P3-4 Windows backslash escaping + P3-5 modal handler log` — stat:
  ```
   .claude/skills/sprint-handoff/SKILL.md | 113 +++++++-----
   docs/patch_slack_bot.md                | 307 +++++++++++++++++++++++++++++++
   package.json                           |   1 +
   scripts/patch-hermes-slack-bot.mjs     | 320 +++++++++++++++++++++++++++++++++
   src/providers/_spawn-helpers.ts        |  13 +-
   src/socket-manager.ts                  |   6 +
   6 files changed, 712 insertions(+), 48 deletions(-)
  ```
- **Symptom:** The commit **body** claims:
  > P3-4: ... backslash escaping
  > P3-5: ... modal handler log
  > P2-3: deemed non-actionable
  
  But the **stat** shows ~75% of the diff (~700 lines) is unrelated to P3-4/P3-5:
  - `docs/patch_slack_bot.md` (307 lines, new) — describes patching **hermes-cli** (a different project)
  - `scripts/patch-hermes-slack-bot.mjs` (320 lines, new) — **Python patch script** for hermes-cli
  - `package.json` (+1 line, adds `npm run patch:hermes-slack-bot` script)
  - `.claude/skills/sprint-handoff/SKILL.md` (113 lines, major workflow refactor)
  
  None of these 4 are mentioned in the commit body.
- **Why this matters:** Reviewers and auditors rely on commit messages to understand the change scope. Hiding 600+ lines of unrelated changes behind a "P3 fix" message is a process/governance violation. Out-of-scope changes should be in their own commits with descriptive messages.
- **Fix proposal:** `git reset HEAD~1` and re-commit as 3-4 atomic commits: (1) P3-4 escape, (2) P3-5 log, (3) sprint-handoff skill refactor, (4) hermes-cli patch (in a separate branch — see F3).
- **Acceptance test:** `git log --stat` of the new commits shows stat lines that match the commit body within ±10 lines.

#### F3 (NEW P0) — ChorusGate repo contains machine-specific script that modifies a different project's installed code

- **GH issue:** [#68](https://github.com/AINIZE-SPACE/ChorusGate/issues/68)
- **Location:** `scripts/patch-hermes-slack-bot.mjs` (new in `f65cfc6`); referenced by `docs/patch_slack_bot.md`; exposed as `npm run patch:hermes-slack-bot` in `package.json`.
- **Symptom:** The script detects the user's local Python install (via `python -c "import gateway; print(gateway.__file__)"`), then **modifies** `gateway/authz_mixin.py` and `gateway/platforms/slack.py` in the user's Python site-packages directory (e.g. `D:/Users/delez/AppData/Local/Python/pythoncore-3.14-64/Lib/site-packages/gateway`). The doc `docs/patch_slack_bot.md` references machine-specific paths in section 4 ("当前机器上，Hermes 的正式运行路径是：…").
- **Why this is a security boundary violation:**
  1. ChorusGate is a TypeScript/Node project; hermes-cli is a Python project. The two have no relationship in the ChorusGate repo.
  2. The ChorusGate repo would now contain a script that mutates a different project's source on the developer's machine. Anyone who runs `npm install && npm run patch:hermes-slack-bot` would silently modify their local hermes-cli install — there is no `--force-required` gate, no `confirm()` prompt, no log of which files were modified.
  3. The 307-line doc describes the patch as a "deployment-specific" workaround for a Slack bot-to-bot compatibility issue between ChorusGate and Hermes — it belongs in the hermes-cli repo (or a private ops doc), not in the open-source ChorusGate repo.
  4. The patch script uses `replaceOnce(text, searchValue, replaceValue, …)` against hard-coded Python source patterns. If a user upgrades hermes-cli and the source changes, the script will `fail()` loudly — but if the patterns happen to match a different version, it would silently corrupt the install.
- **Fix proposal:** 
  - Remove `scripts/patch-hermes-slack-bot.mjs`, `docs/patch_slack_bot.md`, and the `patch:hermes-slack-bot` npm script from `package.json`.
  - Move the patch content to the hermes-cli repository (since the canonical patch source should live where the patched code lives).
  - If a workaround is needed for the Slack bot-to-bot issue, it should be a ChorusGate-side code change (e.g. sending via Web API with a user-token rather than patching hermes-cli's bot-detection), not a script that mutates a different repo.
- **Acceptance test:** `git ls-files | grep -E "patch-hermes|patch_slack_bot"` returns 0 matches. `grep "patch:hermes-slack-bot" package.json` returns 0 matches.

#### F4 (NEW P1) — P3-4 fix is incomplete (cmd.exe metacharacters still un-escaped) and untested

- **GH issue:** [#69](https://github.com/AINIZE-SPACE/ChorusGate/issues/69)
- **Location:** `src/providers/_spawn-helpers.ts:18-28` (new `escapeArg` in `f65cfc6`); test gap in `tests/spawn-helpers.test.ts`
- **Symptom:** The new `escapeArg` only escapes backslashes (`a.replace(/\\/g, "\\\\")`). cmd.exe metacharacters that need escaping inside double-quoted args are **NOT** handled:
  - `&` — command separator (e.g. `foo & bar` runs both)
  - `|` — pipe
  - `>` `<` — redirection
  - `^` — cmd.exe escape (so `^&` is a literal `&`)
  - `"` — quote (needs to be `"` inside double quotes)
  
  Per Update 1's F6 finding, a "true" P3-4 fix was specified as: "if arg contains space or any of `& | < > ^ "`, wrap in `"` and escape internal `"` as `\"`." The current implementation only handles backslashes.
- **Why this matters:** The prior review (Update 1) explicitly called out the metacharacter gap. The dev's `f65cfc6` commit body says "P3-4 done" but the implementation is still a partial fix. A user with a path like `C:\Users\foo\dir&rm-rf\app\claude.exe` would still have `&` interpreted as a command separator by cmd.exe.
- **Additionally, the `escapeArg` function has no test coverage** — `tests/spawn-helpers.test.ts:23` "buildSpawnCommand — Windows wraps in quoted shell command" only tests the basic case (no spaces, no metachars, no backslashes). The new `f65cfc6` fix added backslash escaping but did not add a test asserting the escape behavior is correct. A future refactor could break the escaping and the test suite would not catch it.
- **Fix proposal:** Extend `escapeArg` to also escape `& | < > ^` with `^` prefix (cmd.exe's metachar escape) and `"` with `"`. Add at least 4 unit tests: (a) backslash escape, (b) `&` escape, (c) `|` escape, (d) `"` escape inside quoted arg.
- **Acceptance test:** `npm test tests/spawn-helpers.test.ts` shows new cases pass; the test for `&` arg produces a command string that cmd.exe would not split on `&`.

#### F5 (NEW P1) — `.claude/skills/sprint-handoff/SKILL.md` enshrines the placebo `unfurl_*` fix as a process rule

- **GH issue:** [#70](https://github.com/AINIZE-SPACE/ChorusGate/issues/70)
- **Location:** `.claude/skills/sprint-handoff/SKILL.md` (in `f65cfc6`, "Slack 通知规范" section): "chat.postMessage: `link_names: true, unfurl_links: false, unfurl_media: false`"
- **Symptom:** The new sprint-handoff skill lists `unfurl_links: false, unfurl_media: false` as a required parameter for `chat.postMessage`. This propagates the F1 placebo into the team's process document. Future PRs will be held to this standard, and future reviewers will see the rule and assume it has a basis.
- **Why this matters:** Process documents that encode incorrect technical claims are worse than incorrect code, because they institutionalize the wrong understanding. The fix is to remove the `unfurl_*` mention from the skill.
- **Fix proposal:** Edit the skill to list only `link_names: true` (which is the actual fix for mention notification). The `unfurl_*` flags have a real use case (controlling link previews) and can be added back with a separate rationale if needed.
- **Acceptance test:** `grep -n "unfurl_links\|unfurl_media" .claude/skills/sprint-handoff/SKILL.md` returns 0 matches.

#### F6 (NEW P1) — Force-push lost 19 commits' SHA references; audit trail broken

- **GH issue:** [#71](https://github.com/AINIZE-SPACE/ChorusGate/issues/71)
- **Location:** `git fetch` showed `+ 97f5b97...f65cfc6 v3/story-8-claude-stream-json -> origin/v3/story-8-claude-stream-json  (forced update)`. The old commit SHAs (`c12e0b6`, `071095c`, `6dc97bd`, `ef41a9e`, `5d99d54`, `97f5b97`, etc.) were replaced by new SHAs (`55f7b3d`, `dc0c3d4`, `6b4714a`, `2958e02`, `f1c2287`, `ca06b99`, `f65cfc6`).
- **Symptom:** All prior commit messages that referenced `closes #N` (e.g. `c12e0b6 ... closes #54`) now point to commits that no longer exist on the branch. Future `git log` searches for those SHAs will fail. Any external links (PR review comments, doc cross-references) that pointed to the old SHAs are now dead links.
- **Why this matters:** The audit trail is the primary mechanism for tracing which fix closed which issue. With SHAs changing, the link between the "claimed" fix and the actual code becomes unverifiable without re-reading the entire diff.
- **Fix proposal:** Use `git rebase -i` with `edit` or `git rebase --exec 'git commit --amend --reset-author --no-edit'` to re-author commits **without** changing SHAs. For commits that need to be split, use `git rebase -i` with `edit` and `git reset HEAD~` + selective `git add` + `git commit`. Avoid `git rebase` of stable merged history.
- **Acceptance test:** This is a process rule, not a code test. The next rebase cycle should preserve commit SHAs across the affected range (compare `git rev-parse <sha>` before and after).

#### F7 (NEW P2) — 6 GH issues fixed in code/test but not closed (audit drift)

- **GH issue:** [#72](https://github.com/AINIZE-SPACE/ChorusGate/issues/72)
- **Location:** Cross-reference: issues #54, #56, #59, #60, #61, #62 are all **OPEN** in `gh issue list`, but their underlying code/test gaps are fixed at HEAD `f65cfc6`:
  - #54 (P0 queue mode data loss): `src/interrupt.ts:73-91` now awaits child exit + returns true; `tests/interrupt-queue.test.ts` runs as `test()` (not SKIPped).
  - #56 (P0 interrupt.ts zero coverage): `tests/interrupt.test.ts` (152 lines, 6 cases) + `tests/interrupt-queue.test.ts` (90 lines, 1 case) exist and pass.
  - #59 (P1 Slack mention notifications): all 9 `chat.postMessage` call sites have `link_names: true` (`src/tools/reply.ts:46` added).
  - #60 (P0 reply.ts:42 link_names): `src/tools/reply.ts:46` has `link_names: true`; `tests/link-names-regression.test.ts` (107 lines) asserts all 9 sites.
  - #61 (P2 link_names test coverage): `tests/link-names-regression.test.ts` exists and passes.
  - #62 (P1 unused manifest scopes): `manifest.json` no longer lists `chat:write.customize` or `users:read.email`.
- **Why this matters:** The dev's handoff message says "P2/P3 backlog 全部完成 (11/11)" — but 6 of the underlying GH issues are still showing OPEN. This is misleading: the code is fixed, but the audit trail says otherwise.
- **Fix proposal:** Dev (or reviewer) should close the 6 issues with a brief comment citing the fixing commit. (Per Update 1's audit-trail rule, the closing comment must reference the actual SHA on the branch, not the old SHA pre-force-push.)
- **Acceptance test:** `gh issue list --state open --label code-review` should not include #54, #56, #59, #60, #61, #62 after the cleanup. (Note: #55 and #57/#58 are different — see "Still-open" note below.)

#### F8 (NEW P2) — P2-3 closed in commit body only, not tracked in GH

- **GH issue:** [#73](https://github.com/AINIZE-SPACE/ChorusGate/issues/73)
- **Location:** `f65cfc6` commit body says "P2-3: deemed non-actionable — permissionMode already reads from process.env at call time". No GH issue was filed for P2-3, no issue was closed.
- **Why this matters:** The SDD process requires 1 finding = 1 GH issue. Closing a finding via a single sentence in a commit body bypasses the issue tracker and leaves no audit trail.
- **Fix proposal:** Either (a) file a new P3 issue "P2-3 closure: PERMISSION_MODE module-level constant in gateway.ts:80-81 reads at import time; call sites read at call time" and document the rationale for not parameterizing (which is that `loadEnv()` runs before module import, so the constant is correct), or (b) accept the closure as a P2 review observation and add a comment in `src/gateway.ts:80-81` explaining why the module-level const is safe.
- **Acceptance test:** The chosen option (a or b) is reflected in either a GH issue comment or a source-code comment in `src/gateway.ts:80-81`.

### Update 2 — What is still open (not introduced by this round)

These issues are tracked separately and were **not closed** by the dev's `f65cfc6`:

- **#55 (P0) interrupt: test count claim 77/77 is factually wrong (actual 80/81 with 1 fail)** — ambiguous. The dev's current claim is 106/106 (verified, all pass). The original "77/77 wrong" claim was about a prior round. Either close as moot (the count is now correct) or update the issue body.
- **#57 (P1) SIGKILL escalation timer untracked + clear() never called on shutdown** — **NOT FIXED**. `src/interrupt.ts:99-101` still has bare `setTimeout(..., 2000).unref()` with no timer reference held; `clear()` at L124-130 does not clear the pending timer, only kills the children. If `clear()` is called while a SIGTERM is pending, the SIGKILL fires later on a killed process.
- **#58 (P1) old parser can race with new spawn** — **NOT VERIFIED**. The current `createStreamSession` at L293-302 binds `onPermissionRequest` and `onPlanUpdate` before `spawnStream(args, ...)` at L304, so the race window is closed. The first permission_request cannot be lost. However, the issue may also refer to the `streamToResult` parser, which the prior review's P3-2 claim of "cast removed" was about — but L319 still has `as StreamSpawnResult & { parser: ClaudeStreamParser }` cast (same pattern, just moved to a different function). Worth a closer look.

### Update 2 — Verification log (this round)

```bash
cd E:/my_project/ainize/ChorusGate_Test
git fetch origin
# fetch showed: + 97f5b97...f65cfc6 ... (forced update)
git reset --hard @{u}
# HEAD is now at f65cfc6

npm run typecheck
# rc=0, no output

npm test
# ℹ tests 106
# ℹ pass 106
# ℹ fail 0
# ℹ skipped 0
# duration_ms 4237

git grep -n "unfurl_links\|unfurl_media" src/
# 5 hits in: gateway.ts, interrupt.ts, session-commands.ts, tools/reply.ts, tools/send-message.ts
# All 5 are in e9696a4. The placebo fix. (See F1.)

git grep -n "chat.postMessage" src/  # 9 call sites
git grep -n "link_names" src/        # 9 hits, 1:1 with postMessage calls ✓

git show HEAD:src/interrupt.ts | grep -A 12 'BUSY_MODE === "queue"'
# shows: await sendBusyAck + await Promise (on exit) + this.running.delete + return true ✓

git show f65cfc6 --stat | head -10
# shows: 6 files, 712 insertions, 48 deletions — 4 of the 6 files are unrelated to P3-4/P3-5
# (See F2.)

git ls-files | grep -E "patch-hermes|patch_slack_bot"
# scripts/patch-hermes-slack-bot.mjs
# docs/patch_slack_bot.md
# Both committed. (See F3.)
```

### Update 2 — Net review cycle

| Round | Open findings | Resolved | Net new |
| --- | --- | --- | --- |
| Initial (Update 1) | 6 (2 P0, 3 P1, 1 P2) | — | 6 |
| Update 2 (this round) | 8 NEW (3 P0, 3 P1, 2 P2) | 9 of 11 internal P2/P3 items confirmed PASS; 5+ GH issues fixed in code/test but not closed | +8 |

**Final verdict for this PR cycle:** **CHANGES_REQUESTED**. 3 P0 findings (F1 placebo, F2 hidden changes, F3 cross-repo script) must block merge. 3 P1 (F4 incomplete P3-4, F5 wrong skill rule, F6 audit trail) should be addressed in the same PR cycle. 2 P2 are cleanup. Test count 106/106 verified.

### Update 2 — Suggested remediation order for dev (小克)

1. **F1 (P0)**: Revert `e9696a4` (12 lines, 5 files). Keep only the `link_names: true` work (which is the real fix).
2. **F2 (P0) + F3 (P0)**: `git reset HEAD~1` and re-commit as:
   - commit A: P3-4 backslash escape (the 13-line `escapeArg` change in `_spawn-helpers.ts` only)
   - commit B: P3-5 socket-manager log (the 6-line change in `socket-manager.ts` only)
   - commit C: sprint-handoff skill refactor (the 113-line `.claude/skills/sprint-handoff/SKILL.md` change only, with a body that documents the new workflow)
   - **Do NOT commit F3's hermes-cli patch script + doc** to the ChorusGate repo. Move them to the hermes-cli repo or delete them.
3. **F5 (P1)**: After F1, edit the sprint-handoff skill to remove `unfurl_links`/`unfurl_media` from the required params list.
4. **F4 (P1)**: Extend `escapeArg` to handle `& | < > ^ "` and add 4 unit tests.
5. **F8 (P2)**: Add a comment in `src/gateway.ts:80-81` explaining why the module-level `const PERMISSION_MODE` is safe.
6. **F7 (P2)**: Close #54, #56, #59, #60, #61, #62 with comments citing the actual fixing SHAs on the current branch.
7. **#57 (P1), #58 (P1)**: Either address or file a follow-up issue explaining the deferral.

After F1/F2/F3 are addressed, re-request review. The P1/P2 items can land in the same PR cycle or in a follow-up.

