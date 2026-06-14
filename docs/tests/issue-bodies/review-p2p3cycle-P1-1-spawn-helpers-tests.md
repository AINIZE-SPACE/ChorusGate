## Summary

`src/providers/_spawn-helpers.ts` was introduced in commit `5d99d54 refactor(spawn)` (5d99d54a88bd0bc9562935b1988c8e0a4e0609e7) as a 133-line module with 5 exported functions:

- `buildSpawnCommand(bin, args)` — Windows-aware command + arg construction
- `buildSpawnOptions(cwd, env)` — base `SpawnOptions`
- `buildSpawnEnv({ botToken, appToken })` — per-profile Slack token injection
- `createLineBuffer(onLine)` — stdout line-buffered callback
- `flushBuffer(feedLine)` — force-flush partial lines
- `spawnAndWait(cmd, spawnArgs, opts, timeoutMs, onResult, onSpawn?)` — full spawn + result lifecycle

This module is **shared by `claude.ts` and `claude-stream.ts`** — two critical providers. But the module has **zero dedicated unit tests**. The only coverage is indirect, via `tests/reply-engine.test.ts` integration paths.

## Why it matters

The refactor consolidated 5+ duplicated functions from `claude.ts` and `claude-stream.ts` into the new module. If a future change to `buildSpawnCommand` breaks Windows quoting, **no test will catch it** — `reply-engine.test.ts` runs the providers in non-Windows CI, and even there it doesn't exercise Windows-specific arg escaping.

Edge cases currently uncovered:
- Args containing spaces (e.g., `--cwd "/path with space/"`)
- Args containing Windows shell metacharacters (`&`, `|`, `>`, `<`, `^`, `"`)
- Bin path containing space (e.g., `C:\Program Files\claude\claude.exe`)
- Empty args list
- `createLineBuffer` partial line buffering across multiple chunks
- `createLineBuffer` `\r\n` line endings
- `flushBuffer` partial data + empty buffer
- `spawnAndWait` timeout SIGKILL behavior
- `spawnAndWait` double-settle guard (multiple events firing)
- `spawnAndWait` error event before close

## Impact

- **Latent regression risk.** A change to `buildSpawnCommand` that breaks Windows quoting will pass all current tests.
- **Refactor is sound, tests are not.** The refactor is a real improvement (less duplication, cleaner code), but without tests it can rot.
- **Related to P3-4 (Windows shell quoting).** The current `buildSpawnCommand` does naive `"${arg}"` wrapping. A test file that covers the Windows path also gives the dev a place to land the P3-4 fix.

## Evidence

```bash
$ ls tests/ | grep -i spawn
# (no output)

$ git grep -ln "spawnAndWait\|buildSpawnCommand\|createLineBuffer" -- tests/
# (no output)
```

## Proposed fix

Add `tests/spawn-helpers.test.ts` with at least 16 cases:

```
buildSpawnCommand (6):
  1. non-Windows baseline returns {cmd, spawnArgs: args}
  2. Windows with no args returns {cmd: '"bin"', spawnArgs: []}
  3. Windows arg with space gets quoted
  4. Windows arg with `&` is properly escaped (current impl fails — fix as part of P3-4)
  5. empty args list works on both platforms
  6. bin path with space (e.g., C:\Program Files\claude\claude.exe) works on Windows

createLineBuffer (4):
  7. single chunk with multiple complete lines emits each
  8. chunks that split a single line buffer correctly across calls
  9. \r\n line endings are stripped correctly
  10. empty chunk is a no-op

flushBuffer (2):
  11. buffer with partial data → flush emits one final line
  12. empty buffer → no-op

spawnAndWait (4):
  13. clean exit (code 0) → onResult(true, 0, "")
  14. non-zero exit → onResult(false, code, stderr)
  15. timeout → child.kill('SIGKILL') + onResult(false, null, ...)
  16. error event before close → onResult(false, null, 'failed to spawn: ...')
```

For Windows-specific tests, gate on `process.platform === "win32"` (skip on non-Windows CI), so the suite stays green on Linux/macOS.

## Acceptance test

```bash
$ npm test tests/spawn-helpers.test.ts
# expect: 16 pass / 0 fail / 0 skip on Windows; ≥12 pass on Linux/macOS (Windows cases SKIP)
```

## Related

- Source commit: `5d99d54 refactor(spawn): extract shared spawn helpers + fix P2-2, P3-2`
- Source module: `src/providers/_spawn-helpers.ts`
- Consumers: `src/providers/claude.ts`, `src/providers/claude-stream.ts`
- P3-4 (Windows shell quoting): https://github.com/AINIZE-SPACE/ChorusGate/issues/...
- Review doc: `docs/tests/REVIEW-P2P3Cycle-2026-06-14-xiaoma.md` (F3)
