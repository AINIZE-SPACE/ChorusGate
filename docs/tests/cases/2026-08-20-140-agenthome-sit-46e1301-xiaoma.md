# ChorusGate SIT Report — #140 agent-home wiring (+ #144 bot-to-bot) @ `46e1301`

- **Reviewer**: 小马 (ainizehermes/002)
- **Date**: 2026-08-20 09:00–09:20 +0800
- **Branch**: `fix/bot-message-mentions` @ `46e1301` (= origin tip, `git ls-remote` verified)
- **SHA 组核验**: `e172951`(feat #140) → `bbb5660`(docs) → `46e1301`(feat #144) — ✅ 三 SHA 全部可达 `origin/fix/bot-message-mentions`，本次 handoff 硬 check 走完（push → `branch -r --contains` → 报 SHA），第三起漏 push 闭环

## 1. Test Execution (Linux zederer-mbe, Node v22.22.1)

| Layer | Command | Result |
|-------|---------|--------|
| L0 | `npx tsc --noEmit` | ✅ 0 errors |
| 全量回归 | `tsx --test --test-timeout=60000 --test-force-exit tests/*.test.ts` | ⚠️ **348 测 / 322 过 / 26 挂** = 22 agent-home 移植缺陷（本交付引入，见 #146）+ 4 ST-CX 已知环境项（codex CLI 未装） |
| 定向（六文件） | agent-home/load-env/config-cli/issue134/shouldReply/mention-guard | ⚠️ 124 测 104 过 20 挂（全属 #146） |

## 2. 功能本体 E2E（Linux，全部通过）

| Check | Result |
|-------|--------|
| `run --agent codex --agent-home <abs>` | ✅ stderr `[load-env] loaded agent profile "codex": <agent-home>/codex/.env` — 从重定向基路径加载 |
| `config init --agent codex --agent-home <abs>` | ✅ 写入 `<agent-home>/codex/.env`，init/run 同基路径 |
| 默认行为（无 flag） | ✅ 仍走 `~/.chorusgate`（#134 向后兼容保持） |
| 观察项（非缺陷） | `config migrate` 子命令静默忽略 `--agent-home`（commit 范围未含 migrate 接线；建议后续补或显式拒绝） |

## 3. 缺陷

- **#146** [bug] `tests/agent-home.test.ts` 19 + `load-env.test.ts` #140 套件 3 = 22 测试在 Linux 失败。根因：`resolveAgentHome` 的 `platform` 覆盖只门控 AGENT_HOME 分支，`isAbsolute/resolve` 仍用宿主 path 语义 → Windows 路径字面量在 Linux 判为相对。**测试不可移植，非功能缺陷**（Windows 机全绿可解释）。建议修复 a：按 platform 选 `win32/posix` path 模块。

## 4. Verdict

**⚠️ CONDITIONAL PASS** — 功能本体（CLI 接线 + profile 重定向 + 默认兼容）Linux E2E 全通过；但交付验收标准含「补测试 + 全量回归」，22 个测试失败阻塞关单。#146 修复 push 后我跑 Re-SIT（仅 agent-home 定向 + 全量），通过即转 PASSED 交小扣验收。#144（`46e1301`）shouldReply/mention-guard 定向全绿，无新增缺陷。

## 5. 本次 handoff 质量注记（retro 输入）

- 硬 check 首个实战案例成功：push → `branch -r --contains` 核验 → 报 SHA，本侧三源核验一次通过
- 交付缺陷类型从「SHA 不可达」转为「测试不可移植」——SIT 双机环境（Win dev / Linux test）的价值实证
