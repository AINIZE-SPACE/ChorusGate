## Summary

Commit `5d99d54 refactor(spawn): extract shared spawn helpers + fix P2-2, P3-2` has a commit message that overstates its scope:

> P3-5: socket-manager.ts interactive handler notes modal/submit limitation

But the commit's `git show --stat 5d99d54` shows zero changes to `socket-manager.ts`:

```
src/providers/_spawn-helpers.ts | 133 +++++++
src/providers/claude-stream.ts  |  51 ++---
src/providers/claude.ts         | 154 +++++-----------
3 files changed, 192 insertions(+), 146 deletions(-)
```

The P3-5 item ("socket-manager modal/submit handler") was not modified in this commit. If the dev intended to add a doc comment in `src/socket-manager.ts` documenting the limitation, that didn't happen.

## Related (still-open items in the commit message)

The same commit body lists "Remaining: P2-3 (permissionMode param), P2-6 (permission dedup), P3-4 (Windows shell quoting)". P2-6 has since been closed by `ef41a9e`. P2-3 and P3-4 are still open. The body is stale.

- **P2-3 (permissionMode param)**: `src/gateway.ts:80-81` reads `process.env.CLAUDE_PERMISSION_MODE` once at module import. Should be parameterized through `CreateSessionOptions` so it can be set per-profile / per-call.
- **P3-4 (Windows shell quoting)**: `buildSpawnCommand` in `_spawn-helpers.ts:14-22` does naive `"${arg}"` wrapping; doesn't escape `&`, `|`, `>`, `<`, `^`, `"`. Will break on real Windows scenarios with metacharacters.

## Impact

- **Misleading commit message.** Future readers will trust the body and waste time grepping for the P3-5 doc comment.
- **Backlog drift.** P2-3 and P3-4 are still open but not being actively tracked anywhere except the commit body, which is now wrong.

## Evidence

```bash
$ git show --stat 5d99d54
commit 5d99d54a88bd0bc9562935b1988c8e0a4e0609e7
Author: delez <delez@163.com>
Date:   Sun Jun 14 12:49:14 2026 +0800
    refactor(spawn): extract shared spawn helpers + fix P2-2, P3-2
    ...
src/providers/_spawn-helpers.ts | 133 ++++++++++++++++++++++++++++++++++
src/providers/claude-stream.ts  |  51 ++++---------
src/providers/claude.ts         | 154 ++++++++++++----------------------------
3 files changed, 192 insertions(+), 146 deletions(-)

$ git log --oneline 01dd94b..HEAD -- src/socket-manager.ts
# (no output — socket-manager.ts not touched since the interrupt feature)
```

## Proposed fix

1. **P3-5**: add a 2-line doc comment in `src/socket-manager.ts` above the `setBlockActionCallback` registration:
   ```ts
   // NOTE (P3-5): Socket Mode interactive handlers only support block_actions.
   // modal_submit, view_submission, and view_closed events are NOT wired.
   // Add per-event handlers here when the product requires rich modals.
   ```
2. **P3-4**: replace naive quoting in `_spawn-helpers.ts:14-22` with proper Windows arg escaping. Either:
   - Add `cross-spawn` (1 dep) for cross-platform arg handling, or
   - Implement Windows arg escaping manually: if arg contains space or any of `& | < > ^ "`, wrap in `"` and escape internal `"` as `\"`; use `cmd.exe /S /C "…"` for the shell.
3. **P2-3**: move `PERMISSION_MODE` from `src/gateway.ts:80-81` module-level `const` into `CreateSessionOptions` (or a new `GatewayOptions`) so it can be set per-profile / per-call.

If the dev prefers to defer P3-4 and P2-3 to a follow-up sprint, that's fine — but they should be moved into a new GH issue (or sub-issue) so they're tracked.

## Acceptance test

After P3-5 fix:
```bash
$ git show HEAD:src/socket-manager.ts | grep -A2 "P3-5"
# expect: comment block with modal/submit/view_submission/view_closed mention
```

After P3-4 fix (optional in this PR):
```bash
$ npm test tests/spawn-helpers.test.ts
# expect: Windows-specific arg-escape cases pass on Windows
```

After P2-3 fix (optional in this PR):
```bash
$ git grep -n "PERMISSION_MODE" -- src/gateway.ts
# expect: per-call or per-options read, not module-level
```

## Related

- Commit body with overstated P3-5 claim: `5d99d54`
- Source module: `src/providers/_spawn-helpers.ts`
- Review doc: `docs/tests/REVIEW-P2P3Cycle-2026-06-14-xiaoma.md` (F6)
- Related P3 backlog items: P2-3 (parameterize PERMISSION_MODE), P3-4 (Windows shell quoting)
