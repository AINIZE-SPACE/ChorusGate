## Summary

Two commits on `v3/story-8-claude-stream-json` have inverted authorship vs. the SDD separation of concerns:

| Commit | Actual content | Author (as recorded in git) | Should be |
| ------ | -------------- | ---------------------------- | --------- |
| `4c50188 feat(approval): 4-button approval` | Code (P2-5, P3-1) | `xiaoma <xiaoma@chorusgate-review.local>` | `delez <delez@163.com>` |
| `bcb0e2b docs(review): REVIEW + ISSUES for Gateway Interrupt` | Review doc | `delez <delez@163.com>` | `xiaoma <xiaoma@chorusgate-review.local>` |

The first is a code commit authored by the reviewer (xiaoma) — code-by-reviewer violates the SDD contract. The second is a review doc authored by the dev (delez) — the "review" of the dev's own work is the dev's own document, not a real review.

## Evidence

```bash
$ git log -1 --format=fuller 4c50188
commit 4c50188d4fa2631e4f5961d89aed9035870ec166
Author:     xiaoma <xiaoma@chorusgate-review.local>
AuthorDate: Sun Jun 14 10:21:27 2026 +0800
Commit:     xiaoma <xiaoma@chorusgate-review.local>
CommitDate: Sun Jun 14 10:21:27 2026 +0800
    feat(approval): 4-button approval (Hermes-style) + session/always auto-approval

$ git log -1 --format=fuller bcb0e2b
commit bcb0e2baac80e4dadb9e554dda5547c7b5e7e9c4
Author:     delez <delez@163.com>
...
    docs(review): REVIEW + ISSUES for Gateway Interrupt (STORY-8 interrupt)
```

## Impact

- **Audit trail broken.** Future readers cannot tell who reviewed what. The review doc claims to be xiaoma's output but was committed by delez, so the audit is untrustworthy.
- **SDD invariants violated.** SDD requires the dev (delez) to ship code and the reviewer (xiaoma) to ship review docs. The branch violates this on two commits.
- **CI / governance gaps.** Nothing currently catches this — `git log` is the only source of truth and it lies.

## Proposed fix

1. **Re-author the two commits** in the dev's clone (so the working tree stays consistent with origin):
   ```bash
   cd E:/my_project/ainize/ChorusGate_dev
   git fetch origin
   git checkout v3/story-8-claude-stream-json
   # Reset the author on the 2 commits. Either:
   #   (a) git rebase --exec on the local branch (requires the branch to be local, not just remote-tracking)
   #   (b) git filter-repo --mailmap mailmap
   ```
   Where the `mailmap` is:
   ```
   delez <delez@163.com> <xiaoma@chorusgate-review.local>
   xiaoma <xiaoma@chorusgate-review.local> <delez@163.com>
   ```
2. **Add a CI lint** in `.claude/skills/sprint-handoff/SKILL.md` and as a pre-push hook: code commits (`feat:`, `fix:`, `refactor:`, `test:`, `chore:`) must have `user.email=delez@163.com`; review doc commits (`docs(review):`, `docs(tests):`) must have `user.email=xiaoma@chorusgate-review.local`.
3. **Document the rule** in this repo's `AGENTS.md` (or equivalent) so future agents know which git identity to use in which clone.

## Acceptance test

```bash
$ git log --format='%ae %s' ef41a9e~8..ef41a9e | grep -v 'delez@163.com'
# expect: only "xiaoma@chorusgate-review.local docs(review): ..." line

$ git log --format='%ae %s' ef41a9e~8..ef41a9e | grep -v 'xiaoma@chorusgate-review.local'
# expect: only "delez@163.com feat/fix/refactor/test: ..." lines
```

After the rebase + force-push, the audit trail reflects reality. Future reviewers and devs see clean separation.

## Related

- Review doc: `docs/tests/REVIEW-P2P3Cycle-2026-06-14-xiaoma.md` (Update 1, this issue)
- Previous review: `docs/tests/REVIEW-GatewayInterrupt-2026-06-14-xiaoma.md`
- Source code-review skill: `.claude/skills/code-review-workflow/SKILL.md` (Role verification pitfall)
