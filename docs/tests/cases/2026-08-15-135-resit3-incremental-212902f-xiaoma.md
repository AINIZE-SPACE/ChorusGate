# Re-SIT 3 Incremental Verification - Issue #135 (498359f -> 212902f)

- **Tester**: 小马 (M) · Hermes Agent
- **Date**: 2026-08-15
- **Commit under test**: `212902f` (fix(#135): fail-closed agent auto-detect for config migrate + tests/doc)
- **Baseline**: `498359f` (pre-verification ALL GREEN, report `2026-08-15-135-resit3-pre-xiaoma.md` @ `85a4836`)
- **Status**: INCREMENTAL VERIFIED - awaiting 小克 formal Dev Ready (SHA should be `212902f`)

## Scope (498359f -> 212902f, 2 commits, 12 files, +1267/−26)

| Commit | Subject |
|--------|---------|
| `85a4836` | docs: #135 Re-SIT 3 pre-verification report (mine, no code) |
| `212902f` | fix(#135): fail-closed agent auto-detect for config migrate + tests/doc |

Code changes: `src/config-migrate.ts` (+60 fail-closed logic), `src/gateway-control.ts` (±4), `src/load-env.ts` (±10).
New tests: `config-cli.test.ts` (+183), `config-migrate.test.ts` (+106), `control-plane.test.ts` (+129), `load-env.test.ts` (+288).

## Results

### L0 - TypeScript type check
```
npx tsc --noEmit   ->  exit 0, zero errors   ✅
```

### L1 - Full test suite
```
tests 292  suites 32  pass 288  fail 4
```
4 failures = ST-CX-001/002/004/005 — identical known environment items (codex CLI absent on zederer-mbe), unchanged from baseline. NOT a regression. Net vs pre-verification: +47 tests all passing.

### L3 - Targeted CLI smoke (temp HOME isolation) - 4/4 PASS

| # | Case | Result |
|---|------|--------|
| T9a | `config migrate` without `--from`/`--agent` -> explicit ERROR + usage, no silent default-agent write | ✅ `[migrate] ERROR: --from <path> is required. Usage: ... [--agent <id>]` |
| T9b | No profile silently created under fail-closed refusal | ✅ |
| T10a | `config init --agent hermes` still initializes profile | ✅ |
| T10b | `~/.chorusgate/hermes/.env` created (3 keys) | ✅ |

## Code review note

`212902f` implements fail-closed semantics for agent auto-detect in config migrate: refuses to guess agent identity, requires explicit `--from` (+ optional `--agent`). Aligns with the agent-home isolation architecture (2026-08-14). Covered by 706 new test lines.

## Verdict

**INCREMENTAL: ALL GREEN on `212902f`** — L0 ✅ · L1 288/292 (4 fail = known env, non-regression) · L3 4/4 ✅

小克 Dev Ready 到达后：SHA=212902f -> combined with pre-verification = Re-SIT 3 PASSED; SHA 更新 -> 仅增量复跑新提交。
