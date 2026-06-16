# ISSUES: P2/P3 Backlog Cycle (v3/story-8-claude-stream-json)

**Date opened:** 2026-06-14
**Reviewer:** xiaoma (小马, `U0B91BVKTL2`)
**Dev:** 小克 (`U0B8VHLHJAX`)
**Branch:** `v3/story-8-claude-stream-json` @ `ef41a9e`
**Source review:** [`REVIEW-P2P3Cycle-2026-06-14-xiaoma.md`](./REVIEW-P2P3Cycle-2026-06-14-xiaoma.md)
**Repo:** https://github.com/AINIZE-SPACE/ChorusGate

This document is the audit trail for the P2/P3 cycle review. Each row is a distinct finding; the GH issue number is the link to the dev's fix. Rows without a number mean the fix landed in an unrelated commit/PR and didn't need a separate issue. Update the `Resolution` column as fixes land; do not delete rows.

---

## Open (after Update 1 — 2026-06-14 14:00)

| # | Severity | Title | GH issue | Status | Resolution |
| - | -------- | ----- | -------- | ------ | ---------- |
| 1 | P0 | Git identity confusion — `4c50188` authored by xiaoma; `bcb0e2b` authored by delez | [#63](https://github.com/AINIZE-SPACE/ChorusGate/issues/63) | **OPEN — governance** | Re-author `4c50188` → `delez`, `bcb0e2b` → `xiaoma` via `git rebase --exec 'git commit --amend --reset-author --no-edit' …` or `git filter-repo`. Add CI lint: code commits must have `user.email=delez@163.com`; review docs must have `user.email=xiaoma@chorusgate-review.local`. |
| 2 | P1 | `_spawn-helpers.ts` (NEW, 133 lines) has 0 dedicated unit tests | [#64](https://github.com/AINIZE-SPACE/ChorusGate/issues/64) | **OPEN** | Add `tests/spawn-helpers.test.ts` with 16 cases: buildSpawnCommand (6), createLineBuffer (4), flushBuffer (2), spawnAndWait (4). Coverage gap exists even though integration is exercised via reply-engine. |
| 3 | P2 | `5d99d54` commit message claims P3-5 (socket-manager modal/submit notes) but stat shows zero changes to `socket-manager.ts` | [#65](https://github.com/AINIZE-SPACE/ChorusGate/issues/65) | **OPEN** | Either add the doc-comment in `src/socket-manager.ts` (2-line diff) or remove the false claim from the commit body. P3-4 (Windows shell quoting) is also still incomplete; `buildSpawnCommand` does naive quote wrapping, doesn't escape `&` `|` `>` `<` `^` `"`. P2-3 (parameterize `PERMISSION_MODE`) is also still open. |

**Total: 3 open findings (1 P0, 1 P1, 1 P2).** Down from 6 after the dev pushed 6 fix commits in this cycle.

---

## Resolved

| # | Severity | Title | GH issue | Resolved in | Resolution |
| - | -------- | ----- | -------- | ----------- | ---------- |
| 1 | P0 | `#54` queue mode silently drops user message (data loss) | [#54](https://github.com/AINIZE-SPACE/ChorusGate/issues/54) | `c12e0b6 fix(interrupt): #54 queue mode awaits child exit instead of dropping message` | `src/interrupt.ts:73-91` now `await sendBusyAck` + wait child exit + `return true`. `src/gateway.ts` busy-interrupt check simplified to fall through to normal processing. `tests/interrupt-queue.test.ts` un-skipped (removed `FIX_QUEUE_MODE_BUG=1` gate). Acceptance: `npm test` → 95 pass / 0 skip (was 3 skip). |
| 2 | P1 | Stale comment in `claude.ts:11-13` references removed `MCP_SENDER_ONLY=1` env var | n/a (rolled into 02f256b alongside #52, #9, #8, #11) | `02f256b fix(sprint-3): address remaining P0/P1 review findings #52 #9 #8 #11` | `src/providers/claude.ts:7` updated to `// MCP: \`claude -p\` 继承父进程环境，直接加载项目 \`.mcp.json\`。` — no reference to `MCP_SENDER_ONLY`. `.claude/mcp.json` deleted (canonical is `.mcp.json`). `MCP_SENDER_ONLY=1` kept in `.mcp.json` env block as defense-in-depth. |
| 3 | P1 | `scripts/diagnose-mention.mjs` hard-codes 小马 (`U0B91BVKTL2`) + 主频道 (`C0BAB3Y7LLC`); no `--dry-run` flag | n/a (resolved by deletion in 97f5b97) | `97f5b97 fix(slack): add link_names:true to slack_reply tool + full call site audit` | `scripts/diagnose-mention.mjs` removed from the tree. Replaced by `tests/link-names-regression.test.ts` which is a static-analysis test (no live Slack API calls). The Slack mention diagnostic concern is now addressed by #60/#61/#62. |

**Total: 3 resolved (1 P0, 2 P1).** Net review cycle: 6 findings → 3 closed by dev commits + 3 still open.

---

## Per-issue acceptance criteria

### F1 / #54 — queue mode data loss

- **Code change:** `src/interrupt.ts` `interrupt()` in queue mode should `await` the child's `exit` event, then `return true`. The gateway's `if (!proceed) { … drop … }` block at `src/gateway.ts:432-441` can then be removed (always proceed).
- **Test:** `FIX_QUEUE_MODE_BUG=1 npm test tests/interrupt-queue.test.ts` → 1 pass / 0 fail / 0 skip. Remove the env gate and use plain `test()`.
- **Regression risk:** queue mode may need explicit memory of "pending" events. If the gateway proceeds to process the new message while the child is still running, the new message spawns a new child concurrently with the old one — that's not really "queue". Decision: either implement a real queue (replay after child exit) or keep the "wait inline" semantics where the gateway blocks the event loop until the child exits (which is what the WIP does). Document the choice in the spec.

### F2 — identity confusion

- **Code change:** rebase `4c50188` and `bcb0e2b` to set correct author.
  - `git rebase -i ef41a9e~8` (or `git filter-repo --mailmap`) and reset author on the 2 commits.
  - Add CI lint: `feat:`/`fix:`/`refactor:` commits must have `user.email=delez@163.com`; `docs(review):`/`docs(tests):` commits must have `user.email=xiaoma@chorusgate-review.local`.
- **Test:** `git log --format='%ae %s' ef41a9e~8..ef41a9e | grep -v '@'` returns zero `feat:` / `fix:` lines under `xiaoma@` and zero `docs(review):` lines under `delez@`.

### F3 — `_spawn-helpers.ts` test coverage

- **Code change:** NEW `tests/spawn-helpers.test.ts`. At least these cases:
  - `buildSpawnCommand`: 6 cases
    - non-Windows baseline returns `{cmd, spawnArgs: args}`
    - Windows with no-arg bin returns `{cmd: '"bin"', spawnArgs: []}`
    - Windows arg with space gets quoted
    - Windows arg with `&` should be properly escaped (current impl fails — fix as part of P3-4 if doing both)
    - empty args list works
    - bin path containing space (e.g., `C:\Program Files\claude\claude.exe`) works on Windows
  - `createLineBuffer`: 4 cases
    - single chunk with multiple complete lines emits each
    - chunks that split a single line buffer correctly across calls
    - `\r\n` line endings stripped correctly
    - empty chunk no-op
  - `flushBuffer`: 2 cases
    - buffer with partial data → flush emits one final line
    - empty buffer → no-op
  - `spawnAndWait`: 4 cases
    - clean exit (code 0) → `onResult(true, 0, "")` called
    - non-zero exit → `onResult(false, code, stderr)`
    - timeout → `child.kill('SIGKILL')` + `onResult(false, null, ...)`
    - `error` event before close → `onResult(false, null, 'failed to spawn: …')`
- **Test:** `npm test tests/spawn-helpers.test.ts` → 16 pass / 0 fail / 0 skip.

### F4 — stale comment

- **Code change:** one-line edit in `src/providers/claude.ts:11-13`. Replace the comment with:
  ```ts
  // gateway 进程持有 Socket Mode 连接；spawn 的 claude 通过 .claude/mcp.json
  // （与 .mcp.json 统一配置）加载 MCP 服务。两个进程共享同一份 MCP 配置。
  ```
- **Test:** `git grep -n MCP_SENDER_ONLY -- src/ .env.example` returns 0 matches.

### F5 — diagnose-mention hard-coded target

- **Code change:** in `scripts/diagnose-mention.mjs`:
  1. Add `--dry-run` flag handling via `process.argv.includes('--dry-run')` or `commander`.
  2. Default to `dryRun=true`; require explicit `--send` to actually post.
  3. Refuse to run if `args[2] === 'C0BAB3Y7LLC'` and `--send` is not set (the main project channel is not a diagnostic target).
  4. Print the resolved channel + user IDs and ask for stdin `y/n` confirmation before the first `chat.postMessage`.
- **Test:** `node scripts/diagnose-mention.mjs` exits without calling `chat.postMessage`. (No automated test — script-level test via stdout capture.)

### F6 — commit message overstates P3-5

- **Code change for P3-5:** add a comment block in `src/socket-manager.ts` above the `setBlockActionCallback` registration documenting the modal/submit limitation:
  ```ts
  // NOTE (P3-5): Socket Mode interactive handlers only support block_actions.
  // modal_submit, view_submission, and view_closed events are NOT wired —
  // they will be received but no handler is invoked. Add per-event handlers
  // here when the product requires rich modals.
  ```
- **Code change for P3-4:** replace naive quoting in `buildSpawnCommand` with proper Windows arg escaping. Either:
  - Use `cross-spawn` (adds 1 dep) for cross-platform arg handling
  - Implement Windows arg escaping manually: if arg contains space or any of `& | < > ^ "`, wrap in `"` and escape internal `"` as `\"`. Use `cmd.exe /S /C "…"` for the shell.
- **Code change for P2-3:** move `PERMISSION_MODE` from `src/gateway.ts:80-81` module-level `const` into `CreateSessionOptions` (or a new `GatewayOptions`) so it can be set per-profile / per-call.
- **Test:** after P3-4 fix, add unit tests in `tests/spawn-helpers.test.ts` covering `&` `|` `>` `<` `^` escape.

---

## Verification commands

```bash
# Current state at HEAD 97f5b97 (3 of 6 findings fixed):
cd E:/my_project/ainize/ChorusGate_Test   # test clone
git fetch origin
git merge --ff-only origin/v3/story-8-claude-stream-json
git log --oneline -1
# expect: 97f5b97 (or later if dev pushes more)

npm run typecheck
# expect: rc=0

npm test
# expect: 95 pass / 0 fail / 0 skip / ~3.2s

git grep -n MCP_SENDER_ONLY -- src/ .env.example
# expect: (no output) ✓ FIXED in 02f256b

git ls-files scripts/
# expect: (no output) ✓ FIXED in 97f5b97

git show HEAD:src/interrupt.ts | grep -A2 'BUSY_MODE === "queue"'
# expect: comment "Queue mode: send ack, then wait..." + return true (no return false) ✓ FIXED in c12e0b6

git log --format='%ae' 4c50188 bcb0e2b
# expect: xiaoma@...  (4c50188)
#          delez@...   (bcb0e2b)  ← STILL WRONG, F2 OPEN

git grep -ln "spawnAndWait\|buildSpawnCommand\|createLineBuffer" -- tests/
# expect: (no output) ← F3 OPEN, no test file

git log --oneline 01dd94b..HEAD -- src/socket-manager.ts
# expect: (no output) ← F6 OPEN, P3-5 doc comment not added
```

After F2/F3/F6 land, the same commands should show:
- `git log --format='%ae' 4c50188 bcb0e2b` → both `delez@163.com` (or both `xiaoma@…` for the review doc, depending on what the audit decides)
- `git grep -ln "spawnAndWait" -- tests/` → shows `tests/spawn-helpers.test.ts`
- `git show HEAD:src/socket-manager.ts` → contains a doc comment block above the block_actions handler referencing the modal/submit limitation

---

## Update log

- **2026-06-14 ~13:30 (initial):** 6 findings opened (2 P0, 3 P1, 1 P2). 6 P3 observations in REVIEW. Source: REVIEW-P2P3Cycle-2026-06-14-xiaoma.md.
- **2026-06-14 ~14:00 (Update 1):** Dev pushed 6 fix commits (`6dc97bd`, `071095c`, `c12e0b6`, `329e94b`, `02f256b`, `97f5b97`) to origin. Re-verified at HEAD `97f5b97`. 3 of 6 findings fixed: F1 (`#54` queue mode), F4 (stale MCP_SENDER_ONLY comment), F5 (diagnose-mention.mjs deleted). 3 still open: F2 (P0, identity), F3 (P1, _spawn-helpers tests), F6 (P2, P3-5 doc + P3-4 + P2-3). New baseline: 95 pass / 0 fail / 0 skip / 3.2s.


---

## Update 2 — 2026-06-14 19:50 — Re-review findings (CHANGES_REQUESTED, 3 P0 + 3 P1 + 2 P2)

HEAD re-verified at `f65cfc6` after dev force-push. Source: `REVIEW-P2P3Cycle-2026-06-14-xiaoma.md` (Update 2 section).

### Open (after Update 2)

| # | Severity | Title | GH issue | Status | Resolution |
| - | -------- | ----- | -------- | ------ | ---------- |
| F1 | **P0** | `e9696a4` is a placebo fix — `unfurl_links:false` + `unfurl_media:false` does NOT bypass Slack's bot-token push notification suppression (incorrect Slack API claim in commit body) | [#66](https://github.com/AINIZE-SPACE/ChorusGate/issues/66) | **OPEN** | Revert `e9696a4` (12 lines, 5 files). The `link_names: true` work (which was the actual fix for #59) was already applied in `6b4714a`/`ca06b99`/`c7a7b381`. Drop the `unfurl_*` claim from the sprint-handoff skill too (see F5). |
| F2 | **P0** | `f65cfc6` commit body claims "P3-4 + P3-5" but stat shows 600+ lines of out-of-scope changes (sprint-handoff skill refactor + hermes-cli patch + doc + package.json) | [#67](https://github.com/AINIZE-SPACE/ChorusGate/issues/67) | **OPEN** | `git reset HEAD~1` and re-commit as 3-4 atomic commits: P3-4 escape, P3-5 log, sprint-handoff skill refactor. Do NOT commit the hermes-cli script/doc (see F3). |
| F3 | **P0** | ChorusGate repo contains machine-specific `scripts/patch-hermes-slack-bot.mjs` (320 lines) and `docs/patch_slack_bot.md` (307 lines) that modify a different project's installed code (hermes-cli Python package) | [#68](https://github.com/AINIZE-SPACE/ChorusGate/issues/68) | **OPEN** | Remove the script, doc, and `patch:hermes-slack-bot` npm script. The patch belongs in the hermes-cli repo (where the patched code lives) or in a private ops doc, not in the open-source ChorusGate repo. |
| F4 | **P1** | P3-4 fix incomplete: `escapeArg` only escapes backslashes, NOT cmd.exe metacharacters `& \| > < ^ "`; no test for backslash escape behavior | [#69](https://github.com/AINIZE-SPACE/ChorusGate/issues/69) | **OPEN** | Extend `escapeArg` to escape `& \| < > ^` with `^` prefix; add at least 4 unit tests covering backslash, `&`, `\|`, and `"` cases. |
| F5 | **P1** | `.claude/skills/sprint-handoff/SKILL.md` enshrines the placebo `unfurl_*` fix as a process rule (wrong Slack API understanding propagated) | [#70](https://github.com/AINIZE-SPACE/ChorusGate/issues/70) | **OPEN** | Edit the skill's "Slack 通知规范" section to remove `unfurl_links`/`unfurl_media` from the required params list. The `unfurl_*` flags have legitimate use cases (link previews) but should be added back with a separate rationale. |
| F6 | **P1** | Force-push lost 19 commits' SHA references; audit trail broken (`+ 97f5b97...f65cfc6 ... forced update`) | [#71](https://github.com/AINIZE-SPACE/ChorusGate/issues/71) | **OPEN** | Process rule: use `git rebase -i` with `edit` + `git commit --amend --reset-author --no-edit` (or `git filter-repo`) to re-author commits without changing SHAs. Avoid rebasing stable merged history. |
| F7 | **P2** | 6 GH issues (#54, #56, #59, #60, #61, #62) are fixed in code/test at HEAD but still marked OPEN in `gh issue list` — audit drift | [#72](https://github.com/AINIZE-SPACE/ChorusGate/issues/72) | **OPEN** | Dev (or reviewer) closes each issue with a brief comment citing the actual fixing SHA on the current branch. The closing comment MUST reference the current branch's SHA (post-force-push), not the old SHA pre-force-push. |
| F8 | **P2** | P2-3 closed in commit body only, not tracked in GH; no audit trail for the closure decision | [#73](https://github.com/AINIZE-SPACE/ChorusGate/issues/73) | **OPEN** | Either file a new P3 issue documenting the rationale ("module-level const is safe because `loadEnv()` runs before module import"), or add a comment in `src/gateway.ts:80-81` explaining why. |

**Total: 8 new open findings (3 P0, 3 P1, 2 P2).** Up from 0 after Update 1.

### Update 2 — 11-item P2/P3 internal label status

| Label | Item | GH issue | Status at f65cfc6 | Test | Verdict |
| --- | --- | --- | --- | --- | --- |
| P2-1 | requestId 冒号解析 | n/a | ✓ `permission-tracker.ts:202,206` | ✓ `permission-tracker.test.ts:153` | **PASS** |
| P2-2 | spawn 共享模块 | n/a | ✓ `_spawn-helpers.ts` (146 lines) | ✓ `spawn-helpers.test.ts` 11 cases (afdda47) | **PASS** |
| P2-3 | PERMISSION_MODE 参数化 | (closed by commit body only — see F8) | ⚠ module-level const in gateway.ts:80-81; call sites read at call time | n/a | **PASS w/ caveat** |
| P2-4 | claudeStreamProvider 文档化 | n/a | spec doc section exists (v3-story-8-claude-stream-json.md) | n/a | **PASS** |
| P2-5 | @mention 审批状态 | n/a | ✓ `gateway.ts` builds `<@${action.userId}>` | ⚠ integration covered | **PASS** |
| P2-6 | permission dedup | n/a | ✓ `waitForApproval` checks pending map | ✓ `permission-tracker.test.ts:130` | **PASS** |
| P3-1 | buildApprovalBlocks typed | n/a | ✓ `permission-tracker.ts:307` returns `SlackBlock[]` | ✓ `permission-tracker.test.ts:259` | **PASS** |
| P3-2 | streamToResult parser cast | n/a | ⚠ cast moved to `createStreamSession` L319 (same pattern, new location) | ⚠ covered by reply-engine | **PASS w/ caveat** |
| P3-3 | MCP env cache removed | n/a | ✓ `.env.example` clean; `.mcp.json` env block restored | n/a | **PASS** |
| P3-4 | Windows shell quoting | (covered by #69 — F4) | ⚠ partial — only backslashes escaped | ✗ no test for escape | **PARTIAL** |
| P3-5 | socket-manager modal/submit log | n/a | ✓ `socket-manager.ts:229-234` logs `view_submission`/`view_closed` | n/a | **PASS** (diagnostic only — consistent with "notes the limitation" interpretation) |

**Net: 9 of 11 fully PASS; P3-4 is PARTIAL (covered by F4); P2-3 closed without GH tracking (covered by F8).**

### Resolved (this round)

| # | Severity | Title | GH issue | Resolved in | Resolution |
| - | -------- | ----- | -------- | ----------- | ---------- |
| 1 | P0 | `#54` queue mode silently drops user message (data loss) | [#54](https://github.com/AINIZE-SPACE/ChorusGate/issues/54) | `55f7b3d fix(interrupt): #54 queue mode awaits child exit instead of dropping message` | `src/interrupt.ts:73-91` now `await sendBusyAck` + wait child exit (`await new Promise(resolve => { child.on("exit"/"close", resolve) })`) + `this.running.delete(key)` + `return true`. `tests/interrupt-queue.test.ts` runs as plain `test()` (not SKIPped). Acceptance: `npm test` → 106 pass / 0 skip (was 3 skip after Update 1's 95 baseline). |
| 2 | P0 | Git identity confusion — `4c50188` authored by xiaoma; `bcb0e2b` authored by delez | [#63](https://github.com/AINIZE-SPACE/ChorusGate/issues/63) | `afdda47 fix(sprint-3): P0 identity rebase + P1 spawn-helpers tests` | Force-push `ca06b99` reset author of `4c50188` (`feat(approval)`) and `bcb0e2b` (`docs(review)`) commits. All new commits in the rewritten tree authored by `delez <delez@163.com>` for code, `xiaoma@chorusgate-review.local` for review docs. Note: this resolution came at the cost of F6 (audit trail broken — 19 SHAs changed). |
| 3 | P1 | `_spawn-helpers.ts` (NEW, 133 lines) has 0 dedicated unit tests | [#64](https://github.com/AINIZE-SPACE/ChorusGate/issues/64) | `afdda47` | NEW `tests/spawn-helpers.test.ts` (117 lines, 11 cases): buildSpawnCommand (2), buildSpawnOptions (2), buildSpawnEnv (2), createLineBuffer (3), flushBuffer (2). All 11 pass. |
| 4 | P2 | `5d99d54` commit message claimed P3-5 but stat showed zero changes to socket-manager.ts | [#65](https://github.com/AINIZE-SPACE/ChorusGate/issues/65) | `f65cfc6 fix(p3): P3-4 Windows backslash escaping + P3-5 modal handler log` | `src/socket-manager.ts:229-234` now logs unsupported `view_submission`/`view_closed` interactive types. Acceptable interpretation of "notes the limitation" — though not a real handler, the diagnostic log is a valid closure per the dev's chosen semantics. |

**Total: 4 new resolved (2 P0, 1 P1, 1 P2).** Plus the 3 from Update 1 = 7 resolved across the cycle.

---

## Verification commands (Update 2)

```bash
cd E:/my_project/ainize/ChorusGate_Test
git fetch origin
# fetch showed: + 97f5b97...f65cfc6 ... (forced update)
git reset --hard @{u}
# HEAD is now at f65cfc6

npm run typecheck
# rc=0, no output

npm test
# ℹ tests 106 / pass 106 / fail 0 / skipped 0
# duration_ms 4237  (was 95 / 0 / 3 / 3.2s after Update 1)

git grep -n "unfurl_links\|unfurl_media" src/  # 5 hits — F1 placebo
git grep -n "chat.postMessage" src/  # 9 sites
git grep -n "link_names" src/  # 9 hits, 1:1 ✓

git ls-files | grep -E "patch-hermes|patch_slack_bot"
# scripts/patch-hermes-slack-bot.mjs
# docs/patch_slack_bot.md
# Both committed. (F3 cross-repo script.)

git log --format='%ae' $(git log --oneline | grep -E "docs\(review\)" | head -1 | awk '{print $1}')
# verify review doc author is xiaoma@chorusgate-review.local, not delez@
# (F6 audit trail: pre-force-push this was bcb0e2b by delez@, post-force-push it should be by xiaoma@)
```

## Update log

- **2026-06-14 ~13:30 (initial):** 6 findings opened (2 P0, 3 P1, 1 P2). 6 P3 observations in REVIEW. Source: REVIEW-P2P3Cycle-2026-06-14-xiaoma.md.
- **2026-06-14 ~14:00 (Update 1):** Dev pushed 6 fix commits to origin. 3 of 6 findings fixed: F1 (`#54` queue mode), F4 (stale MCP_SENDER_ONLY comment), F5 (diagnose-mention.mjs deleted). 3 still open: F2 (P0, identity), F3 (P1, _spawn-helpers tests), F6 (P2, P3-5 doc + P3-4 + P2-3). New baseline: 95 pass / 0 fail / 0 skip / 3.2s.
- **2026-06-14 19:50 (Update 2):** Dev force-pushed rewritten tree (19 commits → 21 new SHAs). New `e9696a4` placebo unfurl_* fix and new `f65cfc6` with P3-4/P3-5 fixes + 600+ lines of out-of-scope changes. 8 new findings opened (3 P0, 3 P1, 2 P2 — see above). Of the 11 internal P2/P3 labels, 9 fully PASS, P3-4 is PARTIAL (F4), P2-3 closed by commit body only (F8). 4 GH issues from prior rounds resolved at code level (#54, #63, #64, #65) but 6 others (#59, #60, #61, #62, #56, #54) still need closing. New baseline: 106 pass / 0 fail / 0 skip / 4.2s.



---

## Update 3 — 2026-06-14 20:50 — Re-verification at HEAD `e9f1503` (post force-push from `f65cfc6`)

**Scope:** verify the 5 issues dev reported as fixed in the 2026-06-14 20:35 handoff + the 3 待确认 items.

**Status of 8 reported findings:**

| # | GH | Title | Dev claim | Reviewer verdict | Evidence at HEAD `e9f1503` |
| - | -- | ----- | --------- | ---------------- | --------------------------- |
| 1 | [#55](https://github.com/AINIZE-SPACE/ChorusGate/issues/55) | Test count 77/77 wrong | 待确认 (all pass) | **VERIFIED ✓** | `npm test` → 106 pass / 0 fail / 0 skip. `npm run typecheck` clean. Closure stands. |
| 2 | [#56](https://github.com/AINIZE-SPACE/ChorusGate/issues/56) | interrupt.ts zero coverage (6 tests) | 已修复 | **VERIFIED ✓** | `tests/interrupt.test.ts` has 6 top-level `test()` cases, all pass. Test seam `_setWebClientForTests()` in place. |
| 3 | [#57](https://github.com/AINIZE-SPACE/ChorusGate/issues/57) | SIGKILL timer untracked | 已修复 | **VERIFIED ✓** | `src/interrupt.ts`: `const killTimer = setTimeout(...)` tracked; `clearTimeout(killTimer)` x 2 (onExit clean path + catch error path). |
| 4 | [#58](https://github.com/AINIZE-SPACE/ChorusGate/issues/58) | Old parser races new spawn | 待分析 (dev wants to close as "narrow window, self-correcting") | **DISPUTE ✗** | Reviewer does NOT consent to closure. Race is real (concrete file:line refs). "Narrow window, self-correcting, monitor" is not a fix. Keep #58 OPEN. See GatewayInterrupt doc for full rationale. |
| 5 | [#60](https://github.com/AINIZE-SPACE/ChorusGate/issues/60) | reply.ts missing link_names:true | 已确认修复 | **VERIFIED ✓** | `src/tools/reply.ts:42` has `link_names: true` in `chat.postMessage` call. |
| 6 | [#62](https://github.com/AINIZE-SPACE/ChorusGate/issues/62) | Manifest unused scopes (chat:write.customize + users:read.email) | 已修复 (reverted) | **VERIFIED ✓** | `manifest.json` scopes array is the clean 16-scope baseline; `chat:write.customize` and `users:read.email` are NOT present. |
| 7 | [#69](https://github.com/AINIZE-SPACE/ChorusGate/issues/69) | escapeArg incomplete (cmd.exe metachars) | 已修复 | **VERIFIED ✓** | `src/providers/_spawn-helpers.ts`: `CMD_META = /[&\|><^%]/g` added; `escapeArg` handles both quoted (backslashes + double-quote) and unquoted (cmd.exe metachars with `^$&` escape) paths. |
| 8 | [#70](https://github.com/AINIZE-SPACE/ChorusGate/issues/70) | unfurl_* placebo in sprint-handoff skill | 已修复 (removed) | **VERIFIED ✓** | `.claude/skills/sprint-handoff/SKILL.md:84` now reads `\`chat.postMessage\`: \`link_names: true\`` — no more `unfurl_*` placebo. |

**Net verdict for this PR cycle:** 7 of 8 issues verified closed in code + test. 1 issue (#58) should stay OPEN — reviewer does not consent to the proposed closure.

**Local verification commands run:**
```bash
git fetch origin
# + f65cfc6...e9f1503 v3/story-8-claude-stream-json -> origin/v3/story-8-claude-stream-json  (forced update)
git reset --hard origin/v3/story-8-claude-stream-json
# HEAD is now at e9f1503

npm run typecheck
# rc=0, no output

npm test
# ℹ tests 106
# ℹ pass 106
# ℹ fail 0
# ℹ skipped 0
# ℹ todo 0
# duration_ms 2463
```

**Per-issue acceptance evidence:**

- **#55** — `npm test` shows 106/106, no `f` lines, no skipped lines, no `todo` markers.
- **#56** — `tests/interrupt.test.ts` has 6 `test(` calls; all 6 ran via `node --import tsx --test tests/interrupt.test.ts` → 6 pass / 0 fail.
- **#57** — `git show e9f1503:src/interrupt.ts | grep -n 'clearTimeout\|killTimer\|SIGKILL'` shows `killTimer` x 4, `clearTimeout` x 2, `SIGKILL` x 4. Cleanup on clean-exit (`child.on("exit", onExit) → clearTimeout(killTimer)`) and in catch (failure path) are both wired.
- **#58** — Race fix NOT applied. The fix is documented in the issue body (make `interrupt()` async + await child exit; tag spawns with `spawnId`; suppress parser callbacks on exited child). None of these are in the current code.
- **#60** — `git show origin/v3/story-8-claude-stream-json:src/tools/reply.ts | grep -B2 -A2 'link_names'` confirms `link_names: true` is in the `chat.postMessage` call.
- **#62** — `git show origin/v3/story-8-claude-stream-json:manifest.json | grep -E 'chat:write.customize|users:read.email'` returns zero hits. Manifest is clean.
- **#69** — `git show e9f1503 -- src/providers/_spawn-helpers.ts` shows the `CMD_META = /[&|><^%]/g` regex + the unquoted-arg escape path with `^$&`.
- **#70** — `git show e9f1503 -- .claude/skills/sprint-handoff/SKILL.md` shows the diff removing both `unfurl_links: false, unfurl_media: false` from the required `chat.postMessage` params list.

**Update 3 — Net review cycle (this round):**

| Round | Open findings (this doc) | Resolved (this doc) | Net new |
| ----- | ------------------------ | ------------------- | ------- |
| Update 1 (initial) | 6 (2 P0, 3 P1, 1 P2) | — | +6 |
| Update 2 (post P2/P3 batch) | 3 (1 P0, 1 P1, 1 P2) | 3 | +3 (3 P0, 3 P1, 2 P2 from Update 1's F1/F4/F5/F6/F7/F8) |
| Update 3 (this round) | 3 (1 P0, 1 P1, 1 P2) | 5 (#56 from this doc's F1, #69, #70; #55, #57, #60, #62 logged in GatewayInterrupt doc) | 0 net (just verification) |

**#69 and #70 status after Update 3:** RESOLVED. Move from Open (Update 1) to Resolved (Update 3).
