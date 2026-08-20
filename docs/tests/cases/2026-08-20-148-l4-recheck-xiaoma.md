# #148 Re-SIT 复核记录 B — L4 Windows 小克报告 + D2/D3 修复 @ 3e8ff23（小马）

> 对象：小克 L4 Windows 实机报告 `docs/tests/cases/2026-08-20-148-l4-windows-xiaoke.md`（尾随 commit `3e8ff23`）。
> 前序：小马 11:15 已按中间态（ST-NR-104/106 blocked）给出 **CONDITIONAL PASS**（`2026-08-20-148-resit-xiaoma.md` + `1388957`）。
> 本次结论：**D2/D3 修复复核通过（PASS），CONDITIONAL PASS 的 3 blocked 已解除 → 全案升级 FULL PASS（建议）**。

---

## §1 复核范围与方法

小克报告 §7 明确请求小马按新 SHA `3e8ff23` 复核 D3（ST-NR-106 退避恢复链路）与 D2（watchdog 拉起）。本机为 Linux，Windows 实机部分以三源核验（源码 diff + 报告证据链 + 本机可复跑项）：

1. `git show 3e8ff23` 全量 diff 审读（5 文件）
2. Linux 可复跑项实跑：`tsc --noEmit`、`tsx --test` 全量、`cg-connect-proxy.mjs` 夹具自测
3. 历史基线对照：36c5f44 上复跑失败项，确认非本次回归

## §2 D3 修复复核（reconnectTimer ref，P1）— **PASS**

**代码面**（`src/socket-manager.ts:522-531`）：
- 修复前 `rp.reconnectTimer.unref?.()` → 修复后 `rp.reconnectTimer.ref?.()`，一行改动。
- 复核确认了此前的疑虑面：ref 后 daemon 是否还能退出/是否泄漏。核对结果：
  - **优雅关闭不受影响**：`gateway.ts:1342-1343` SIGINT/SIGTERM → `shutdown()` → `socket-manager.ts:381-385 stopAll()` 置 `shutdownStarted` → `:556-564 clearReconnectTimer()` 清 timer → `gateway.ts:1340 process.exit(0)` 显式退出。ref 的 timer 在关闭路径被 clearTimeout，不阻碍退出。
  - **兜底退出不受影响**：`gateway.ts:1272-1281 exitIfDownTooLong` → `shouldExitForWatchdog`（`socket-manager.ts:570-578`）超时仍 `process.exit(1)` 交 watchdog，链路完整。
  - **无重复 timer 泄漏**：`clearReconnectTimer` 在 `stopProfile:370` 与重连成功路径均有调用；`doReconnect:537` 有 `shutdownStarted` guard。

**证据面**（小克报告 §3.6，gateway.log 时间线）：
- 修复前复现：kill 代理 → `reconnect scheduled in 1104ms` 后进程静默 exit(0)（两次复现：daemonized pid 6584 + foreground）——与小马此前 CONDITIONAL PASS 判断的"blocked 待证"点一致。
- 修复后：断网 → `forcing reconnect (zombie socket)`（timer 真的触发了，修复前进程已死）→ 14+ 次退避 1.0s→23.3s 指数递增+jitter → 代理恢复 → `Socket Mode connected` + `backoff reset`，daemon pid 20908 全程存活。
- 结论：退避/熔断从死代码变为活链路，且恢复落在重启后下一退避窗口（≤1 探测周期），符合出题 ST-NR-106 判据。

**Linux 侧复跑佐证**：`tests/scripts/cg-connect-proxy.mjs` 在本机（Linux）实测可用——起服 `curl -x 127.0.0.1:17901 https://api.slack.com` 302 通过（隧道转发正常），kill 后 connection refused（故障注入生效）。夹具满足"Linux 侧可复用"声明，后续 re-SIT 可直接用。

## §3 D2 修复复核（watchdog 命令空格拆分）— **PASS**

**代码面**（ps1:66-75 / sh:58-66）：
- 两处同构修复：`CHORUSGATE_BIN`/`-Bin` 为 `node <abs mjs>`（含空格）时，在第一个空格拆 exe + 脚本路径再调用。
- sh 版：`EXE="${CMD%% *}"` 无空格时走原路径，有空格时 `"$EXE" "$REST" restart --agent`；ps1 版 `IndexOf(' ')` 同构。逻辑正确，处理了无空格退化分支。
- 根因描述与代码相符：`"$CMD" restart` 会把整串当命令名 → 静默失败；ps1 的 `$ErrorActionPreference=SilentlyContinue` 掩盖报错（报告 §4 已直测复现 `& $cmd status → not recognized`）。

**证据面**（报告 §3.4）：kill daemon 11168 → `schtasks /Run` → 新 pid 4700 + `Socket Mode connected`，拉起闭环成功。

**一个保留观察（非阻塞）**：若 `CHORUSGATE_BIN` 的脚本路径本身含空格（如 `C:\Program Files\...`），"第一个空格"拆分会把路径截断——但 install 写入的路径来自仓库内 abs mjs，且这是既有 install 契约问题，不属本次修复引入。已记录，建议后续 install 侧统一 quoted 形式时一并处理。

## §4 回归与测试

本机实跑（Linux @ 3e8ff23）：
- `npx tsc --noEmit`：0 错
- `npx tsx --test tests/*.test.ts`：**377 tests / 373 pass / 4 fail**，4 失败全在 `tests/codex-integration.test.ts`（ST-CX-001/002/004/005）
- 失败根因：**本机未安装 codex CLI**（`which codex` 为空），测试头注释自述"Uses real codex CLI (if available)"。**基线对照**：切回 `36c5f44` 复跑同文件同样 4 fail —— 历史既有环境缺失，非 3e8ff23 回归。
- 与 #148 相关的 transport.test.ts **20/20**、reconnect-policy.test.ts **8/8** 全过。

## §5 结论

| 项 | 判定 |
|----|------|
| D2 watchdog 空格拆分修复 | ✅ PASS（代码正确 + 实机拉起闭环） |
| D3 reconnectTimer ref 修复 | ✅ PASS（退出语义复核 + 实机退避恢复时间线 + Linux 夹具验证） |
| 回归 | ✅ 无（4 fail 为环境缺 codex CLI，36c5f44 基线同样失败） |
| 前序 CONDITIONAL PASS 3 blocked | ✅ 已全部解除 |

**建议：#148 Re-SIT 由 CONDITIONAL PASS 升级 FULL PASS**。小扣（<@U0BAGFVD8VB>）此前已按 36c5f44 关单，D3 为 P1 且已修复验证，建议按 3e8ff23 更新验收结论（或将本报告作为补充证据登记）。

— 小马，2026-08-20 12:15
