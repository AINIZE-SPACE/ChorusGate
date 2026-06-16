# ISSUES: Mention 通知修复 (commit 6dc97bd / Issue #59)

**Date:** 2026-06-14
**Reviewer:** xiaoma (小马, U0B91BVKTL2)
**Branch:** `v3/story-8-claude-stream-json` @ `071095c`
**Commit:** `6dc97bd fix(slack): add link_names:true to all chat.postMessage calls for mention notification`
**PR:** [#53](https://github.com/AINIZE-SPACE/ChorusGate/pull/53) (OPEN)
**Parent issue:** [#59](https://github.com/AINIZE-SPACE/ChorusGate/issues/59) (OPEN)

---

## Open (待小克修)

| # | Issue | Severity | Title | Resolution |
| --- | --- | --- | --- | --- |
| 1 | [#60](https://github.com/AINIZE-SPACE/ChorusGate/issues/60) | P0 (critical) | `src/tools/reply.ts:42` 漏 `link_names:true` — #59 未完成 | 待 commit fix `src/tools/reply.ts:38-46` |
| 2 | [#62](https://github.com/AINIZE-SPACE/ChorusGate/issues/62) | P1 (high) | manifest.json 新增未使用的 scope | 待删 `chat:write.customize` + `users:read.email` |
| 3 | [#61](https://github.com/AINIZE-SPACE/ChorusGate/issues/61) | P2 (medium) | `link_names:true` 无测试覆盖 | 待新增 `tests/link-names.test.ts` |

---

## Resolved

(空 — 修复尚未落地)

---

## Cross-reference

- **Parent issue:** #59 — Slack mention 不触发推送通知（原报告，OPEN，未被本 commit auto-close）
- **本 review 文件:** `docs/tests/REVIEW-MentionNotification-2026-06-14-xiaoma.md`
- **本 review 关联 PR:** #53
- **branch HEAD:** `071095c` (review 时)，commit `6dc97bd` (被 review 的 commit)
- **下次 re-review 触发条件:** zederer / 小克 在 thread 通知"已修"或 PR 上有新的 fix commit
