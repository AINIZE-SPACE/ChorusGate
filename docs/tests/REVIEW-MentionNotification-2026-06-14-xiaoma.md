# REVIEW: Mention 通知修复 (Issue #59 / commit 6dc97bd)

**Date:** 2026-06-14
**Reviewer:** xiaoma (小马, U0B91BVKTL2)
**Requester:** zederer (Master, U0AHDRREVPD)
**Dev:** 小克 (U0B8VHLHJAX)
**Branch:** `v3/story-8-claude-stream-json` @ `071095c`
**Review scope:** commit `6dc97bd fix(slack): add link_names:true to all chat.postMessage calls for mention notification`
**Related issue:** [#59](https://github.com/AINIZE-SPACE/ChorusGate/issues/59)
**Related PR:** [#53](https://github.com/AINIZE-SPACE/ChorusGate/pull/53)

---

## Verdict

**CHANGES_REQUESTED** — 1 P0 + 1 P1 + 1 P2 findings. The fix is mostly correct but the commit message claims "所有 chat.postMessage" 统一加 `link_names:true` — **实际上漏了 `src/tools/reply.ts:42`**，是 #59 bug 的同一症状在另一个 call site 上的重现。

| # | Severity | Title | GH issue | Status |
| --- | --- | --- | --- | --- |
| 1 | P0 | `src/tools/reply.ts:42` 漏 `link_names:true` — #59 修复未完成 | [#60](https://github.com/AINIZE-SPACE/ChorusGate/issues/60) | Open — dev fix needed |
| 2 | P1 | manifest.json 新增未使用的 scope — 违反安全第一 | [#62](https://github.com/AINIZE-SPACE/ChorusGate/issues/62) | Open — dev fix needed |
| 3 | P2 | `link_names:true` 修复无测试覆盖 — 回归无防护 | [#61](https://github.com/AINIZE-SPACE/ChorusGate/issues/61) | Open — dev fix needed |

**Fixes expected in same PR cycle:**
- P0-1: 1 行添加 + 1 个回归测试
- P1-1: 2 行删除（manifest scope 撤回，无代码改动）
- P2-1: 新增 `tests/link-names.test.ts`，覆盖至少 5 个 call sites

---

## Scope

| File | Change | link_names added? |
| --- | --- | --- |
| `manifest.json` | +2 lines, -1 line (new scopes) | n/a |
| `src/gateway.ts` | +5 lines | ✓ (5 sites) |
| `src/interrupt.ts` | +1 line | ✓ |
| `src/session-commands.ts` | +1 line | ✓ |
| `src/tools/send-message.ts` | +1 line | ✓ |
| **`src/tools/reply.ts`** | **0 lines** | **✗ — MISSED** |

**Untouched but should have been:** `src/tools/reply.ts:42` — `slack_reply` MCP tool 的 `chat.postMessage` call。

**Diff stat (PR #53 full):** 7704 additions / 2195 deletions. 8 link_names additions out of 9 chat.postMessage call sites = 89% coverage.

---

## Methodology

1. **Environment**: clean checkout of `v3/story-8-claude-stream-json` @ `071095c`. Verified HEAD is at `071095c test(interrupt): system integration test for gateway interrupt`. Commit `6dc97bd` is HEAD~1.
2. **Baseline run**:
   - `npm run typecheck` — PASS (zero errors).
   - `npm test` — **91 pass / 0 fail / 3 skipped** / 94 total (within ~30s, full suite ran).
3. **Diff review**: read commit `6dc97bd` (5 files / 11 lines). Also pulled full PR #53 diff for the 5 files (122 diff sections, ~540KB).
4. **Coverage check**: `grep -rn "chat.postMessage" src/ --include=*.ts` enumerated all 9 call sites. Cross-referenced with `grep -rn "link_names" src/`. **Found 1:1 mismatch** (9 calls, 8 link_names).
5. **Scope audit**: `grep -rn "icon_emoji\|icon_url\|chat:write.customize" src/` and `grep -rn "users:read.email\|getEmail\|lookupByEmail" src/` — both return 0 hits. New manifest scopes are dead.
6. **Test gap analysis**: `ls tests/ | grep -i "reply\|send"` returns only `reply-engine.test.ts` (different module). Zero tests assert `link_names: true` is passed to `chat.postMessage`.

---

## Per-severity findings

### P0-1: `src/tools/reply.ts:42` 漏 `link_names:true` ([#60](https://github.com/AINIZE-SPACE/ChorusGate/issues/60))

**Location:** `src/tools/reply.ts:38-46`

**Symptom:** 完整修复 #59 需要在**所有** `chat.postMessage` 调用上加 `link_names: true`，但 dev 漏了 `slack_reply` tool 这个 call site。

**Impact:** 与 #59 报告的"mention 不触发推送通知"症状完全相同。当 Claude Code 通过 `slack_reply` MCP tool 在 thread 中发送 `<@USER_ID>` mention 时（如"@小克 看看"），被 mention 的人收不到推送。`slack_reply` 是 Claude Code 在 Slack 线程中回复用户的主要路径（注册于 `src/index.ts:17,32`），不是边缘 case。

**Evidence:**
```
$ grep -rn "chat.postMessage" src/ --include="*.ts"
src/gateway.ts:495           ← 已加 link_names
src/gateway.ts:583           ← 已加 link_names
src/gateway.ts:629           ← 已加 link_names
src/gateway.ts:668           ← 已加 link_names
src/gateway.ts:695           ← 已加 link_names
src/interrupt.ts:139         ← 已加 link_names
src/session-commands.ts:129  ← 已加 link_names
src/tools/send-message.ts:40 ← 已加 link_names
src/tools/reply.ts:42        ← ❌ 漏了

$ grep -rn "link_names" src/ --include="*.ts" | wc -l
8
```

**Fix:** 1 行添加 + 1 个回归测试。详见 issue body。

---

### P1-1: manifest.json 新增未使用的 scope ([#62](https://github.com/AINIZE-SPACE/ChorusGate/issues/62))

**Location:** `manifest.json:55-70`

**Symptom:** commit `6dc97bd` 加了 `chat:write.customize` 和 `users:read.email` 两个 scope，但**全仓零使用**。

**Impact:**
- 违反 user profile 已明确写的"安全第一"原则
- Slack manifest scope 变更 → 强制 Reinstall App，为两个 unused scope 走 Reinstall 是无谓的运维成本
- 审计噪音：未来看到 `users:read.email` 会以为在用

**Evidence:**
```
$ grep -rn "icon_emoji\|icon_url\|chat:write.customize" src/
(空)

$ grep -rn "users:read.email\|getEmail\|lookupByEmail" src/
(空)
```

**Note:** 真正修复 #59 需要的 `link_names: true` 参数**只需 `chat:write` scope**（manifest 已有），不需要任何新 scope。

**Fix:** 删 2 行。详见 issue body。

---

### P2-1: 无测试覆盖 ([#61](https://github.com/AINIZE-SPACE/ChorusGate/issues/61))

**Location:** `tests/` 缺 `tests/link-names.test.ts` 或等价文件

**Symptom:** 8 处 `link_names: true` 添加，零测试断言 `web.chat.postMessage` 真的被传入 `{ link_names: true }`。

**Impact:**
- 回归无防护：下次重构可能不小心删掉 `link_names: true`，无人发现
- P0-1 之所以漏了 `src/tools/reply.ts`，部分原因就是没有"枚举所有 chat.postMessage 调用"这个测试套路 — 有测试就能 catch

**Fix:** 新增 `tests/link-names.test.ts`，mock `getWebClient()` 后断言 9 个 call sites 中每个都收到 `link_names: true`。详见 issue body。

---

## Verification log

```
$ git log --oneline -3
071095c test(interrupt): system integration test for gateway interrupt
6dc97bd fix(slack): add link_names:true to all chat.postMessage calls for mention notification
ef41a9e fix(permission): add dedup for concurrent same-tool permission requests (P2-6)

$ git show 6dc97bd --stat
manifest.json             | 4 +++-
src/gateway.ts            | 5 +++++
src/interrupt.ts          | 1 +
src/session-commands.ts   | 1 +
src/tools/send-message.ts | 1 +
5 files changed, 11 insertions(+), 1 deletion(-)

$ npm run typecheck
> tsc --noEmit
(rc=0, zero errors)

$ npm test
ℹ tests 94
ℹ suites 3
ℹ pass 91
ℹ fail 0
ℹ cancelled 0
ℹ skipped 3
ℹ todo 0
ℹ duration_ms 1972.9133
```

---

## P3 observations (no new issue filed)

- `manifest.json` 这次的 scope 列表（`"chat:write"` `"commands"` `"users:read"` 等）不是字母序排列，混入了两个新的非常规 scope（`chat:write.customize` / `users:read.email`）。如果 P1-1 修复后删了这两个，列表会自然恢复有序。是 cosmetic 观察，不阻塞。
- 8 处 `link_names: true` 的代码风格不一致：有的 `link_names: true,` 后有逗号在行末，有的在前一行末尾。属于 formatter 范围内，可由 `prettier` / `dprint` 一次性 fix。不阻塞。

---

## Next steps (for 小克)

1. **必修 P0-1** (`src/tools/reply.ts:42`)：加 `link_names: true`，跑 `npm test` 确认不退。
2. **必修 P1-1** (manifest.json scope)：删两个未使用的 scope，diff 应为零 scope 差异（`git show 6dc97bd^:manifest.json` vs 修改后）。
3. **建议合 P2-1**（测试）：在 P0-1 修复同一 commit 里加 1-2 个 case 覆盖 reply.ts 的 link_names，可顺手覆盖 P0-1 的回归测试要求。
4. 三个 fix 在同 PR 落地后，commit message 建议改为：
   ```
   fix(slack): add link_names:true to ALL chat.postMessage calls — closes #59 #60
   
   * 8 call sites in 4 files
   * manifest scope audit: remove unused chat:write.customize + users:read.email — closes #62
   * 9 link_names regression tests — closes #61
   ```
5. **重启 + Reinstall 仍需执行**：哪怕 P1-1 撤回了 scope，Reinstall App 是 dev 在 thread 里说的"必须"。如不撤回则 Reinstall 照常；如撤回则可跳过 Reinstall（manifest 内容已与当前安装一致）。请 dev 自行决定走哪条路径，告知 zederer 决定结果。

---

## Paper trail

- **Branch:** v3/story-8-claude-stream-json @ 071095c
- **PR:** #53 (OPEN)
- **Issues filed this review:** #60 (P0), #61 (P2), #62 (P1)
- **Parent issue:** #59 (still OPEN, not auto-closed by this fix)
- **Reviewer:** xiaoma (小马) — U0B91BVKTL2
- **Date:** 2026-06-14
