# Re-SIT 3 Pre-Verification Report — Issue #135 (branch v5/issue-134-agent-profile-config)

- **Tester**: 小马 (M) · Hermes Agent
- **Date**: 2026-08-15
- **Commit under test**: `498359f` (feat: #134 require-admin - Windows elevation guard on chorusgate CLI)
- **Status**: ⏳ PRE-VERIFICATION (正式 Dev Ready SHA 到位后即可锚定转正; 小克尚未发 Dev Ready)
- **Baseline**: `680dcea` (re-SIT 2 PASSED)

## New commits under test (680dcea → 498359f, 6 commits)

| Commit | Subject |
|--------|---------|
| `363f44c` | feat: add Slack mention-format guard on outbound messages |
| `faeb2a6` | Add agent profile initialization and CLI validation |
| `e5b0cbf` | Reuse agent platform executable detection |
| `b9a8d2e` | docs(#134): document agent home control plane + project .gateway split |
| `daccac8` | fix: agent-scoped control plane - pid/status/log move to ~/.chorusgate/<agent>/ |
| `498359f` | feat: #134 require-admin - Windows elevation guard on chorusgate CLI |

Scope: 35 files, +1299/−292. New modules: `require-admin.ts`, `state-paths.ts`, `slack-message.ts` (mention guard), `config-init.ts`, `gateway-paths.ts` refactor.

## Execution environment

- Linux zederer-mbe (Ubuntu 26.04), Node v22.22.1, tsx via `./node_modules/.bin/tsx`
- codex/claude CLI binaries NOT installed (known env limitation)

## L0 — TypeScript type check

```
npx tsc --noEmit   →  exit 0, zero errors   ✅
```

## L1/L2 — Full test suite

```
./node_modules/.bin/tsx --test --test-timeout=30000 --test-force-exit tests/*.test.ts
# tests 245  suites 21  pass 241  fail 4  cancelled 0
```

**4 failures = known environment issue, NOT regression** (skill-documented ST-CX-001/002/004/005, codex CLI absent on this host).

### Non-regression proof (apples-to-apples, same 2 files)

| Commit | tests | pass | fail | failing tests |
|--------|-------|------|------|---------------|
| `680dcea` (baseline, re-SIT2 PASS) | 12 | 7 | **5** | ST-CX-001/002/004/005 + ST-PROV-003 |
| `498359f` (HEAD) | 12 | 8 | **4** | ST-CX-001/002/004/005 |

Failures identical to baseline minus one: **ST-PROV-003 fixed** by `e5b0cbf` (executable detection refactor). Net improvement.

New test files all green: `config-init.test.ts` (83 lines), `gateway-paths.test.ts` (75), `mention-guard.test.ts` (53), `require-admin.test.ts` (40), `agent-platform.test.ts` (+43).

## L3 — CLI smoke (temp HOME isolation) — 9/9 PASS

| # | Case | Result |
|---|------|--------|
| T1 | `run --agent hermes` loads `~/.chorusgate/hermes/.env` profile | ✅ |
| T1a | No token leak (`xoxb-SECRET*`) in stderr | ✅ |
| T2 | `run` without `--agent` → default agent profile | ✅ |
| T3 | `run --agent '../evil'` → rejected (invalid agent id) | ✅ |
| T4 | `config init --agent codex` creates `~/.chorusgate/codex/.env` | ✅ |
| T5 | `status --agent hermes` reads agent home → `gateway (hermes): stopped` | ✅ |
| T5b | Stale pid in agent home correctly detected (agent isolation real) | ✅ |
| T6 | pid/status/log paths all resolve to `~/.chorusgate/<agent>/{gateway.pid,status.json,gateway.log}` | ✅ |
| T7 | Mention guard: `<@U…>` clean=0 issues; bare `@name`/`@小克`=1 issue; email=0; `@here/@channel`=0; lowercase `<@u123|name>`=malformed | ✅ |
| T8 | require-admin: non-Windows always passes (no elevation model) | ✅ |

*(T5/T6 初次脚本断言模式写错显示 FAIL，修正断言后复验全 PASS；产品行为本身一次通过。)*

## Code review vs. 需求四条 + 架构原则

1. **profile 隔离 `~/.chorusgate/{agent}/` + `--agent` 默认 default** ✅ `gateway-paths.ts` `DEFAULT_AGENT`/`getAgentHome`; `load-env.ts` profile resolution; bin CLI `--agent` flag
2. **以 .env.sample 为基准** ✅ `config-init.ts` 从 `.env`/sample 迁移生成 profile
3. **跨平台 agent 配置一致（MCP/skill/api-key 不动）** ✅ `require-admin.ts` 明确豁免 MCP 入口 (`chorusgate-mcp`)
4. **旧项目 .env 迁移** ✅ `config-migrate.ts` dry-run/`--apply`，fallback default（3f068cc 已验）

**架构原则 (2026-08-14)**：进程级参数和输出统一 `~/.chorusgate/<agent>/`，项目 `.gateway/` 只放项目作用域内容 — `gateway-paths.ts` 注释与实现完全一致 ✅

## Notes

- `config-init.ts` 疑似 bug `SLACK_BOT_TOKEN_$…` 为终端显示伪影，`od -c` 原始字节确认实际代码为正确模板字符串 `` `SLACK_BOT_TOKEN_${id}` `` — 非缺陷。
- Windows 管理员守卫在 Linux 主机只能验证非 win32 路径（T8）；win32 PowerShell token 检测逻辑经单测 `require-admin.test.ts` 覆盖，最终行为需 ainize-dev (Windows) 冒烟确认——不阻塞。

## Verdict

**PRE-VERIFICATION: ALL GREEN on `498359f`** — L0 ✅ · L1 241/245 (4 fail = 已知环境项，基线对照证实非回归，且比基线少 1 个失败) · L3 9/9 ✅

待小克正式 Dev Ready（SHA=498359f 或更新）到达后：SHA 一致 → 本报告直接转正为 Re-SIT 3 PASSED；SHA 更新 → 仅对新提交增量复跑。
