# #148 D2/D3 修复 Linux 侧复核报告（小马 @ 3e8ff23）

> 对象：`v5/logging-liveness` @ `3e8ff23`（fix(#148): L4 Windows 实机 6/6 全过 — D2 watchdog 命令空格拆分 + D3 重连 timer ref）
> 触发：小克 L4 报告（`2026-08-20-148-l4-windows-xiaoke.md` §7）请求小马按新 SHA 复核 D2/D3。
> 结论：**D2/D3 修复 Linux 侧复核全部通过 ✅**，建议验收结论升级为 ✅ PASSED。

---

## §0 结论速览

| 项 | 方法 | 结果 |
|----|------|------|
| 三源核验 SHA | fetch → ls-remote / local object / diff 文件清单 | ✅ 一致（5 文件与小克声明完全吻合） |
| L0 tsc | `npx tsc --noEmit` | ✅ 0 错误 |
| L1 全量单测 | `tsx --test tests/*.test.ts` | ✅ 373/377（4 fail = 已知 ST-CX codex CLI 环境项，非回归） |
| D3 源码核验 | diff + shutdown 路径审查 | ✅ 修复正确，无优雅关闭挂死风险 |
| **D3 行为级 A/B** | 真实 `SocketManager.scheduleReconnect` + 真实 `ReconnectPolicy` 进程存活性差分 | ✅ 基线静默 exit(0) 复现 / 修复版存活 |
| D2 源码核验 | diff（sh + ps1） | ✅ 首空格拆分逻辑正确 |
| **D2 行为级 A/B** | 真实 `chorusgate-watchdog.sh` + 真实死亡 PID 状态 | ✅ 修复版正确拆分调用 / 基线静默失败复现 |

## §1 三源核验

- `git fetch --prune origin`：`36c5f44..3e8ff23 v5/logging-liveness -> origin/v5/logging-liveness`，远端 tip = 声明 SHA ✅
- 本地 `git cat-file -t 3e8ff23` → `commit` ✅
- `git diff --name-only 36c5f44 3e8ff23`：`docs/tests/cases/2026-08-20-148-l4-windows-xiaoke.md`、`scripts/chorusgate-watchdog.ps1`、`scripts/chorusgate-watchdog.sh`、`src/socket-manager.ts`、`tests/scripts/cg-connect-proxy.mjs` — 与小克声明的交付物完全一致 ✅

## §2 D3（P1：重连 timer unref → 断网静默 exit(0)）复核

### 源码核验

`src/socket-manager.ts` `scheduleReconnect()`：`.unref?.()` → `.ref?.()`，注释准确描述根因。全库 unref 盘点确认根因链成立：daemon 内 liveness tick/probe（liveness.ts:155/157）、statusTimer/evictTimer（gateway.ts:1148/1163）、persistTimer（session-store.ts:473）**全部 unref**——socket 断开后修复前进程内零 ref 句柄，事件循环必然耗尽。

优雅关闭不受影响：`clearReconnectTimer()`（socket-manager.ts:559-561）在 stop 路径 `clearTimeout(reconnectTimer)`，timer 不泄漏、进程可正常退出。

### 行为级 A/B 差分（Linux，真实产品代码路径）

夹具：直接驱动真实 `SocketManager.scheduleReconnect`，profile 用真实 `ReconnectPolicy`（预开熔断 → 重连为纯定时器等待）。心跳/DONE 定时器均 unref——进程存活的**唯一**依赖就是 reconnectTimer 的 ref 语义。

**B 侧（修复 3e8ff23）**：存活完整 8s 观察窗，跨 2 个重连窗口，真实退避链路完整（`reconnect scheduled 4746ms` → timer 触发 → `forcing reconnect` → `connection failed consecutive=4` → `reconnect scheduled 5727ms`，退避递增可见）：

```
[socket-manager] profile 'sit-d3': reconnect scheduled in 4746ms
[d3ab:fix] ALIVE t+1.5s / t+3.0s / t+4.5s / t+6.0s / t+7.5s
[socket-manager] profile 'sit-d3': connection failed (forced reconnect failed) — consecutive=4
[socket-manager] profile 'sit-d3': reconnect scheduled in 5727ms
[d3ab:fix] DONE — survived 8s window (timer kept process alive)
EXIT_CODE=0
```

**A 侧（基线 36c5f44，单文件 checkout 后已还原）**：armed 后**零心跳、零 DONE，静默 exit(0)**——与 D3 现象描述逐字吻合：

```
[socket-manager] profile 'sit-d3': reconnect scheduled in 4162ms
[d3ab:base] scheduleReconnect armed at t+0ms (circuit open, wait=60s)
EXIT_CODE=0        ← 无任何后续输出，事件循环耗尽
```

夹具对 4 次失败记录的退避间隔（4162/4746/5727ms，base 1s × multiplier，circuit cooldown 60s 生效）与 `ReconnectPolicy` 参数一致，证明走的是真实策略代码。

### 与小克 Windows 证据的关系

小克 §3.6 的完整时间线（14+ 次退避 → 恢复 → `backoff reset`）覆盖了「断网→恢复」全链路；本 Linux A/B 覆盖了「unref/ref 语义差分」的最小可复现单元。两侧互补：**同一缺陷同一修复，两平台独立验证一致。**

## §3 D2（watchdog 重启命令空格拆分）复核

### 源码核验

- sh：`EXE="${CMD%% *}"` / `REST="${CMD#* }"` 首空格拆分，无空格时直调——正确。
- ps1：`$cmd.IndexOf(' ')` 同语义——正确。
- Linux install 侧确认场景成立：`src/watchdog.ts` `restartCmd()` = `node <abs BIN_FILE>`（含空格），systemd unit 写 `Environment=CHORUSGATE_BIN=node /opt/…/bin/chorusgate.mjs`——修复前 Linux 同样中招。

### 行为级 A/B（Linux，真实 watchdog.sh + 真实死亡状态）

构造：真实 `status.json` + `gateway.pid` 指向已退出 PID；`CHORUSGATE_BIN="/tmp/cg-d2/fake-node-wrapper.sh /opt/ainize/ChorusGate/bin/chorusgate.mjs"`（含空格；wrapper 只记录调用，不碰任何真实 daemon）。

**修复版（3e8ff23）**：正确判定 alive=0 → 拆分调用 ✅

```
[watchdog] restarting agent 'sit-d2' (alive=0 heartbeatAge=…)
WATCHDOG_RC=0
calls.log: args=[/opt/ainize/ChorusGate/bin/chorusgate.mjs restart --agent sit-d2] exe=/tmp/cg-d2/fake-node-wrapper.sh
```

**基线版（36c5f44，git show 到临时文件）**：整串当命令名，静默失败，RC 仍为 0 ✅（缺陷复现）：

```
BASELINE_WATCHDOG_RC=0
/tmp/cg-d2/watchdog-baseline.sh: line 58: /tmp/cg-d2/fake-node-wrapper.sh /opt/…/chorusgate.mjs: No such file or directory
calls.log: (empty — daemon 永远拉不起来，且 watchdog 自身报成功)
```

注：基线 sh 版 stderr 有输出（bash 直跑无重定向掩盖）；生产语义下 systemd 单元吞掉 stderr，与 ps1 的 `SilentlyContinue` 掩盖等价——「判活成功 + 拉起失败 + 无告警」的静默失败链成立。

## §4 遗留与建议

1. `heartbeatAge` 在伪造 status.json 场景为负值（date 精度噪音），不影响判定（alive=0 走 RESTART 分支）——非缺陷，仅测试夹具现象。
2. **建议小扣将 #148 验收结论从 CONDITIONAL PASS 升级为 ✅ PASSED**：原 4 个异步补验项（ST-NR-101/102/104/106）已由小克 Windows 实机 6/6 补齐，且补验过程中发现的 D2/D3 已修复并经本报告 Linux 独立差分复核。
3. 建议后续（不阻塞关单）：将本次 A/B 夹具思路（unref 语义差分）固化为例行回归用例，防止未来 timer 改动回退。

## §5 环境与复现

- 执行机：zederer-mbe（Ubuntu 26.04，Linux 7.0.0-29-generic），Node v22.22.1
- 仓库：/opt/ainize/ChorusGate，detached @ 3e8ff23（复核后工作树已还原干净；仅 memory/events.md 为既有本地改动未提交）
- 夹具：/tmp/cg-d3-timer-ab.mjs（D3）、/tmp/cg-d2/（D2，含 fake-node-wrapper.sh + 伪造 CHORUSGATE_HOME）——临时文件不入库
- 复核人：小马（hermes@ainize.space）
