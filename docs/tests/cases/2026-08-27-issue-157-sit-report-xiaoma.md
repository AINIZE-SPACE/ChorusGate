# SIT Report — #157 Slack Socket Mode 心跳断线后 gateway 停止

**Date:** 2026-08-27
**Tester:** 小马 (ainizehermes)
**Dev:** 小克 (aicodeclaude)
**Branch:** `v5/issue-157-heartbeat-reconnect` @ `ae5c1f4`
**PR:** #158
**Baseline:** `main` @ `5f1c473`

## 1. 执行环境

- Host: zederer-mbe (Ubuntu 26.04, 192.168.1.147)
- Node: v22.x, tsx via `./node_modules/.bin/tsx`
- codex/claude CLI: NOT installed → ST-CX-* env failures expected

## 2. 交付物存在性验证 ✅

| Item | Verified |
|------|----------|
| Branch tip | `ae5c1f4` = PR #158 head |
| Commit SHA | exists (`gh api commits/ae5c1f4` → 200) |
| Commit scope | 2 files only: `src/socket-manager.ts` (47 lines), `tests/socket-manager-errmsg.test.ts` (107 lines) — no unrelated pollution |
| PR state | OPEN, MERGEABLE |

## 3. L0 — TypeScript type check

| | Baseline `5f1c473` | Fix `ae5c1f4` |
|---|---|---|
| `npx tsc --noEmit` | 0 errors | 0 errors ✅ |

## 4. L1 — Full test suite

| | Baseline | Fix | Delta |
|---|---|---|---|
| Total tests | 422 | 432 | +10 (new errMsg tests) |
| Pass | 418 | 428 | +10 |
| Fail | 4 | 4 | 0 |
| Failed tests | ST-CX-001/002/004/005 | ST-CX-001/002/004/005 | identical (env, non-regression) |

**Verdict: zero regression.** The 4 failures are pre-existing environment issues (no codex CLI on this host), confirmed identical between baseline and fix.

## 5. A/B Differential — Root cause reproduction (核心)

Script: `/tmp/cg157-repro.mjs` — drives real `SocketManager.forceReconnect()` with a fabricated profile whose `socket.start()` rejects with `undefined` (the observed failure mode).

| Dimension | Baseline `5f1c473` | Fix `ae5c1f4` |
|---|---|---|
| `forceReconnect` outcome | **THREW TypeError**: Cannot read properties of undefined (reading 'message') | returned false (normal) ✅ |
| Error log | none (crashed inside log itself) | `forced reconnect failed: unknown error` ✅ |
| `reconnectPending` | **false** (onFailure never reached) | **true** ✅ |
| `reconnectTimer` | null | **set** ✅ |
| `consecutiveFailures` | **0** (never counted) | **6** (active backoff chain) ✅ |
| `unhandledRejection` | 0 (sync throw) | 0 ✅ |

**Root cause chain verified closed:**
1. pong timeout → `forceReconnect()` → `socket.start()` rejects `undefined`
2. **Baseline:** catch `(err as Error).message` → TypeError → `onFailure()` never runs → no backoff scheduled → `consecutiveFailures` stays 0 → `shouldExitForWatchdog()` also blocked (requires >0) → process neither reconnects nor exits → silent stop
3. **Fix:** `errMsg(err)` returns `"unknown error"` for undefined → logs cleanly → `onFailure()` runs → backoff timer scheduled → reconnect retry chain active

## 6. 代码审查

### `errMsg()` 实现 ✅
```ts
export function errMsg(err: unknown, fallback = "unknown error"): string {
  if (err && typeof err === "object" && "message" in err) {
    const m = (err as { message?: unknown }).message;
    if (typeof m === "string" && m.length > 0) return m;
  }
  if (typeof err === "string" && err.length > 0) return err;
  if (typeof err === "number" || typeof err === "boolean" || ...) return String(err);
  return fallback;
}
```
- undefined → "unknown error" ✅
- null → "unknown error" ✅
- bare string → verbatim ✅
- real Error → message ✅
- non-Error object without message → fallback ✅
- Cannot throw under any input ✅

### 替换完整性 ✅
- Baseline had 12 unsafe `(err as Error).message` sites in `socket-manager.ts`
- Fix replaces all 12 (小克 reported 10; actual = 12, over-covered)
- Residual unsafe pattern: `grep "as Error).message"` → 0 matches ✅
- `errMsg()` call sites: 14 (12 replacements + 2 export/helper references)

## 7. 回归测试审查

`tests/socket-manager-errmsg.test.ts` — 10 `it` assertions across 2 `describe` groups:

| Group | Cases | Coverage |
|-------|-------|----------|
| errMsg safety | 7 | undefined (事故输入), null, bare string, real Error, non-Error object, custom fallback, primitives (0/1006/"") |
| reconnect continuation | 3 | 8× consecutive failure delays monotonically grow; failure #4-5 still gives positive delay; recordSuccess resets to base delay |

**Standalone run: 10/10 PASS** (0.3s)

## 8. Watchdog

### Linux (systemd) — 本机验证 ✅
```
install: RC=0, service+timer files written, systemctl lists timer
uninstall#1: RC=0
uninstall#2 (idempotency): RC=0  ← #148-era bug fixed, no regression
cleanup: clean
```

### Windows (schtasks) — 证据缺口 ⚠️
小克报告: "已在实机补装 chorusgate-watchdog-codex 并核验：Ready，每 5 分钟，提权"

**缺口:**
1. 无 `schtasks /Query /TN chorusgate-watchdog-codex` 原始回执
2. "识别死亡/陈旧 heartbeat 并拉起 codex" 实测缺失（小克自述："当前 dev 机 gateway daemon 未运行，守护对象为空"）
3. Issue AC 要求 "watchdog 任务存在、能识别死亡/陈旧 heartbeat 并拉起"——任务存在已声明，拉起行为未实证

**SIT 判定:** Windows watchdog 拉起行为 NOT COVERED on this host. 需小克补 `schtasks /Query` 回执 + daemon 运行态下的拉起实测，或由小扣裁量是否接受声明式证据。

## 9. E2E — heartbeat + Slack DM/mention

**NOT COVERED.** 本机 `~/.chorusgate/{default,hermes}/.env` 不存在（仅 `.env.template`，无 Slack token）。按安全规则不猜测 token，需乐老板提供 `SLACK_APP_TOKEN`/`SLACK_BOT_TOKEN` 才能拉起本地 gateway 实链路。

## 10. 验收标准对照

| AC (Issue #157) | 状态 | 证据 |
|---|---|---|
| 相关单测与 typecheck 通过 | ✅ PASS | L0 0 errors; L1 432/428 pass, 4 env fail (non-regression) |
| pong 超时/重连异常不出 `undefined.message` | ✅ PASS | A/B 差分: fix 侧 `errMsg` → "unknown error", 无 TypeError |
| 有下一次重连或 watchdog 退出路径 | ✅ PASS | `reconnectPending=true`, `consecutiveFailures=6`, backoff chain active |
| Windows 实机 watchdog 任务存在 | ⚠️ 声明式 | 小克报告 Ready, 无原始 schtasks 回执 |
| watchdog 能识别死亡/陈旧 heartbeat 并拉起 | ❌ NOT COVERED | daemon 未运行, 拉起行为未实证 |
| 重启后 heartbeat 持续更新 | ❌ NOT COVERED | 需 E2E 实链路 |
| Slack DM/mention 收发 | ❌ NOT COVERED | 需 E2E 实链路 |
| 回归旧连接健壮性无新增失败 | ✅ PASS | 4 fail = baseline 4 fail, identical |

## 11. SIT 判定

**⚠️ CONDITIONAL PASS**

核心根因修复验证通过（A/B 差分 + 代码审查 + 零回归），但 Windows watchdog 拉起行为 + E2E（heartbeat/DM/mention）未覆盖。

**需补齐:**
1. 小克: `schtasks /Query /TN chorusgate-watchdog-codex` 原始回执 + daemon 运行态下拉起实测
2. 乐老板: 提供 Slack token 以启动本地 E2E, 或由小扣裁量接受声明式 watchdog 证据后关单

—— 小马 (SIT), 2026-08-27