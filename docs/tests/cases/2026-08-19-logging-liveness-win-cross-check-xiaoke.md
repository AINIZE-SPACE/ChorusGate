# SIT 记录 — Issue #141 日志域 Windows 交叉验证（小克）

> **Issue**: [#141](https://github.com/AINIZE-SPACE/ChorusGate/issues/141)（日志轮转 + `chorusgate log` 命令）
> **Plan**: `docs/tests/plans/PLAN-logging-liveness-2026-08-18-xiaoma.md`
> **Branch**: `v5/logging-liveness` @ `1849fad`（HEAD）
> **Test Owner**: 小马 (U0B91BVKTL2) — Linux 主测；本文为 **Windows 交叉验证**（ainize-dev, 192.168.1.247）
> **Executor**: 小克 (U0B8VHLHJAX)
> **Date**: 2026-08-19
> **Status**: Phase 1 日志域 — Windows 侧 ✅ 通过；含 3 项观察（非阻断）

---

## 0. 执行摘要

| 项 | 结果 |
|---|---|
| L0 tsc 零错误 | ✅ PASS（exit 0） |
| L1/L2 全量单测 | ✅ PASS **325/325**（串行跑；并发跑在 Windows 有 spawn UNKNOWN 环境问题，非回归）* |
| L3 `chorusgate log` 烟测（005/006/007/008/011 + AC7） | ✅ 全 PASS |
| ST-CG141-013 Windows 交叉验证（002/006/007） | ✅ 全 PASS |
| liveness 单测（`tests/liveness.test.ts`） | ✅ PASS **14/14** |
| 归档复核（2026-08-19，见 §6） | ✅ 日志域+liveness 45/45；发现 spawn UNKNOWN flaky（非回归） |
| 观察项 | 3 项非阻断（见 §4） |

> 计划基线写"147"，实际当前 325 —— 分支后续测试增长，无回归。

---

## 1. 基线（ST-CG141-012）

```
$ npx tsc --noEmit          → exit 0
$ node --import tsx --import ./tests/test-env.mjs --test --test-timeout=30000 \
    --test-force-exit --test-concurrency=1 "tests/*.test.ts"
  → tests 325, suites 42, pass 325, fail 0
```

**环境注意**：本机 `NODE_TEST_CONTEXT=child-v8` 已导出，会导致 node --test 静默跳过全部文件（记忆陷阱）；测试前需 `Remove-Item Env:NODE_TEST_CONTEXT`。全量**并发**跑在 Windows 有 `spawn UNKNOWN`（errno -4094）文件级失败，**串行（--test-concurrency=1）325 全过** —— 判定为 node test runner 在 Windows 多文件并发生成的环境问题，非功能回归。

## 2. L3 CLI 烟测（真实 CLI，临时 CHORUSGATE_HOME 隔离）

### 2.1 ST-CG141-005 — `chorusgate log` 行数控制 ✅

| 输入 | 预期 | 实际 |
|---|---|---|
| `log --agent sit-log`（默认） | 最近 50 行 | 13 行（文件不足 50，全出）✅ |
| `log --agent sit-log --lines 5` | 5 行 | 5 行 ✅ |
| `log --agent sit-log -n 3` | 3 行 | 3 行，最新 3 行 ✅ |

### 2.2 ST-CG141-008 — help 列出 log 命令 ✅

`chorusgate help` 输出含：
```
  log             print the daemon log (default: last 50 lines)
                  --lines N / -n N   print last N lines
                  --follow / -f      follow new lines (tail -f)
```

### 2.3 ST-CG141-011 — 缺日志错误路径 ✅

```
$ chorusgate log --agent no-such-agent
→ no log file for agent 'no-such-agent' at <home>\no-such-agent\gateway.log
  — start the gateway first (chorusgate start --agent no-such-agent)
→ exit code 1
```

### 2.4 AC7 — 无 `--agent` 回落 default ✅

- default 无日志：`log`（无 --agent）→ 报 `agent 'default'` 路径缺失，exit 1（回落语义正确）
- default 有日志：`log`（无 --agent）→ 输出 default 日志 3 行，exit 0

### 2.5 顺带覆盖

- **ST-CG141-001 格式**：真实 daemon 启动日志全部行匹配 `^\[ts \d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}\] \[(INFO|WARN|ERROR|DEBUG)\] \[module\]` ✅
- **ST-CG141-010 token 泄漏**：gateway.log 全文无 `xapp-test-*` / `xoxb-test-*` 值 ✅

## 3. ST-CG141-013 Windows 交叉验证

### 3.1 002 — 轮转 rename 不因文件锁失败 ✅

**unit 层**：`tests/logger.test.ts` 的 size 轮转 / 跨日轮转 / prune 用例在本机（Windows）全量跑通过 —— 证明 logger `appendFileSync`（无持 fd）+ `renameSync` 轮转路径在 Windows 文件系统上可正常工作。

**进程级演示**（`createLogger` 真实模块 + 真实 fs + 真实轮转条件，非 mock）：

| Phase | 场景 | 结果 |
|---|---|---|
| 1 | `maxSize=200` 写 40 行触发 size 轮转 | `.old` 生成，当前文件 87B < 200（新文件重建）✅ |
| 2 | mtime 回拨到昨日触发跨日轮转 | `gateway.log.20260818.old` 生成（昨日戳）✅ |
| 3 | 预置 8 天前 stale `.old` 触发 prune | stale 删除，较新的保留 ✅ |

### 3.2 006 — `--follow` 实时跟随 ✅

后台跑 `chorusgate log --agent sit-follow2 --follow`，追加内容：
```
tail 输出: a1..a6（log() 先打最近 50 行）
追加 b1 b2 → 立即捕获
```
Windows 上 `--follow` 可用（fs.watch 唤醒 + 200ms 轮询兜底生效）。

### 3.3 007 — `--follow` 跨轮转 ✅

```
追加 b1 b2 → 捕获
rename gateway.log → gateway.log.<YYYYMMDD>.old；新建写 c1 c2
→ follow 检测文件收缩，从 0 重锚，捕获 c1（新文件首行）
→ 继续追加 retry-0/1/2 → 全部实时捕获
```
**跨轮转重锚（size 缩小 → offset=0）验证通过**，不重复旧文件尾部、不中断。

---

## 4. 观察项（非阻断，建议开发/测试确认）

| # | 现象 | 影响 | 建议 |
|---|---|---|---|
| 1 | **fake-token daemon 静默退出**：`chorusgate start` 后 daemon 写 13 行启动日志即退出，无 shutdown/fatal 记录。根因：SocketModeClient 对 `invalid_auth` 致命错误停止重试 + gateway 所有 timer（statusTimer/evictTimer/liveness tick/probe）均 `unref()` → 事件循环无 active 句柄 → 进程自然退出 | `chorusgate status` 随后显示 stopped（exit 3）；ST-CG141-009 的"status 显示 running"在 fake-token 环境不可达 | 真实 token / Linux 侧确认 daemon 持久性；若需"连接失败保持存活"语义（与 liveness 断网重连相关），考虑增加非 unref 保活句柄或重试策略 |
| 2 | **日志级别全为 `[ERROR]`**：gateway.ts 全部用 `console.error` 打印（含成功启动横幅），经 `redirectConsoleToLogger` 映射为 error 级别 | `GATEWAY_LOG_LEVEL` 过滤失去区分度（设 `warn` 也滤不掉任何行）；正常启动/回复信息显示为 ERROR，运维视觉噪音 | 建议将 gateway.ts 常规信息改用 `console.log`（映射 info）或显式 `logger.info`；第三库自带 `[ERROR]` 前缀行出现双 ERROR（如 socket-mode 的 `[ERROR] [daemon] [ERROR] socket-mode:...`），可考虑在 fmt 中去重 |
| 3 | **轮转瞬间瞬时文件锁**：`--follow` 进程 watch 句柄在轮转瞬间与写入方竞争，`Add-Content` 偶发 IOException（几百 ms 后恢复） | 日志域内影响极小（logger appendFileSync 与 drain 读均为瞬时句柄，竞争窗口 <1s）；但若外部工具以长持句柄方式读日志，轮转瞬间可能写失败 | 属已知风险（计划 §8 已列），Windows 侧实测确认瞬时性，无需修复 |

## 5. 其他发现

- **`src/liveness.ts` 已实现并接入**（gateway.ts `startLivenessForDaemon`，L1 suspend + L2 zombie probe + L3 上报），timer 全部 unref、正常 tick 零日志 —— 计划文档 Phase 2 标"未开发、阻塞"已过时，**Phase 2 用例可安排 SIT**（另立 issue/阶段）。
- **liveness 单测已通过**：`tests/liveness.test.ts`（untracked 新文件）14/14 PASS —— L1 suspend 检测（clock jump / 阈值）、L2 zombie-socket（failure limit / reset / re-escalate / throwing probe / healthy silence）、L3 unrecoverable escalation、lifecycle（stop/start 幂等）。

## 6. 归档复核（2026-08-19 归档时）

本文档由小克在归档时对测试结果做了**独立复核重跑**（非开发会话记录转抄），结果如下：

| 复核项 | 命令 | 结果 |
|---|---|---|
| 日志域 + liveness 验收文件 | `node --import tsx --import ./tests/test-env.mjs --test --test-timeout=30000 --test-force-exit --test-concurrency=1 tests/{logger,log-command,liveness,control-plane}.test.ts` | ✅ **45/45**，fail 0 |
| 全量串行复核 | 同上，`"tests/*.test.ts"` | ⚠️ 未能一次全绿（见下方 flaky 说明） |
| `tests/claude-stream-integration.test.ts` 双跑 | 串行单文件连跑 2 次 | RUN1 ✅ 7/7，RUN2 ❌（3 用例失败）→ **确认 flaky** |

**flaky 根因**：Windows 上 `spawn` 偶发 `UNKNOWN`（errno -4094，`uv_spawn`），node test runner 并发多文件时概率更高（`_full-test-run.txt` / `tests-out4.txt` 即该现象的原始记录：头部 OOM、尾部 `spawn UNKNOWN` 文件级失败）；**串行也会偶发**（本次复核 claude-stream-integration 两次结果不同）。手动 spawn mock 进程 10+ 次全部正常（`tests/_diag-mock.mjs`），tsx 加载器非根因，属环境级偶发。**非功能回归** —— 日志域/liveness 验收文件重跑稳定 45/45。

> **精确根因（补充）**：同日姊妹文档 `docs/tests/cases/2026-08-19-liveness-unit-test-verify.md` §3 诊断出开发机 ainize-dev **内存仅剩 0.6GB（4.1%）**（20+ claude 会话 + chrome + Slack），此内存水位下全量 `node --test` 必然 OOM（`Fatal process out of memory` / `spawn UNKNOWN` / `uv_os_get_passwd ENOMEM`）。解法：`--max-old-space-size=128` 单文件串行跑。故本节的 flaky 实为**低内存环境的确定性结果**，非代码缺陷。

> 注：原 §1 记录"串行 325/325 全过"为当时的实跑结果；归档复核时因 spawn flaky 未能重放一次完整 325 全绿，验收域（Issue #141）已单独重跑确认无回归。flaky 文件可考虑后续排查（如限制 spawn 并发或加 retry），建议开发/测试侧跟进。

## 7. 交付物

- 本文档：`docs/tests/cases/2026-08-19-logging-liveness-win-cross-check-xiaoke.md`
- 执行记录：tsc / 全量测试 / CLI 烟测原始输出见会话日志；进程级轮转演示脚本已清理（临时目录）
- 测试隔离：临时 `CHORUSGATE_HOME` + `xapp-test-*`/`xoxb-test-*` fake token，未触碰真实 `~/.chorusgate/` 与真实 Slack token；测试后清理完毕
