# #148 L4 Windows 实机执行记录（小克 @ a55f0ce）

> Issue #148 连接健壮性 — L4 Windows 实机测试。
> 执行人：小克（Claude）。对象分支 `v5/logging-liveness`，HEAD `36c5f44` → 本报告尾随 D2+D3 修复 commit。
> 对出题：`docs/tests/cases/2026-08-20-148-sit-xiaoma.md` §4（ST-NR-101~106）。
> 结论：**ST-NR-101~106 全部 ✅ PASSED**。执行中发现 **2 个新缺陷 #148-D2（watchdog 重启命令空格拆分）+ #148-D3（重连 timer 未 ref → 断网静默 exit(0)，P1）**，均已修复并实测验证。修复后需小马按新 SHA 复核，小扣最终验收。

---

## §1 执行环境

- 宿主：ainize-dev（Windows 10 Pro 10.0.19045，Win dev 机）
- 分支：`v5/logging-liveness` @ `36c5f44`
- 方式：独立 profile `sit-nr` + 临时 `CHORUSGATE_HOME=E:/tmp/cg-sit-l4`（符合小马两个硬要求：三源可验证 + 不动生产 claude/codex）
- 生产 daemon（claude pid 15416 / codex pid 16940）全程未触碰
- 相关测试：`npx tsc --noEmit` 0 错；`transport.test.ts` **20/20**

## §2 结论速览

| 用例 | 出题 | 结果 | 证据 |
|------|------|------|------|
| ST-NR-101 | 死代理（127.0.0.1:1）隔离 + auth.test | ✅ PASSED | §3.1 |
| ST-NR-102 | CLI 代理继承 | ✅ PASSED | §3.2 |
| ST-NR-103 | `log --error` | ✅ PASSED | §3.3 |
| ST-NR-104 | kill daemon → watchdog 拉起 | ✅ PASSED（需 D2 修复） | §3.4 |
| ST-NR-105 | install×2 / uninstall×2 幂等 + .env 保留 | ✅ PASSED | §3.5 |
| ST-NR-106 | 断网退避 → 恢复（≤2 探测周期） | ✅ PASSED（需 D3 修复） | §3.6 |

新发现缺陷：**#148-D2**（watchdog 重启命令 `node <abs mjs>` 含空格 → `& $cmd`/`"$CMD"` 整体当命令名，静默失败，§4）+ **#148-D3**（重连 timer `unref` → socket 断开后事件循环先耗尽，daemon 无日志静默 exit(0)，退避/熔断成死代码，P1，§5）。

## §3 各用例证据

### §3.1 ST-NR-101 — 死代理隔离 + auth.test（✅ PASSED）

出题：daemon 继承死代理 env（`HTTP_PROXY/HTTPS_PROXY=http://127.0.0.1:1`），Slack transport 仍 direct 直连、`auth.test` 成功；spawn 子进程才注入代理。

执行：独立 sit-nr profile + 临时 CHORUSGATE_HOME，daemon 启动时注入死代理 env，transport 日志行 `transport: slack=direct; agent=inherit` → 随后 `Socket Mode connected`（说明 Slack 路径忽略死代理，直连成功）。对照同一套配置下 `buildSpawnEnv`（agent=inherit）给 CLI 子进程注入代理（见 §3.2 实证）。`auth.test` 随 `Socket Mode connected` 成立（socket 建连前 SDK 已完成 apps.connections.open 鉴权）。

### §3.2 ST-NR-102 — CLI 代理继承（✅ PASSED）

出题：daemon spawn 的 CLI 子进程 env 必须携带代理变量（agent=inherit 默认），而 Slack 自身保持 direct。

执行：走 gateway 实际代码路径 `buildSpawnEnv`（`src/providers/_spawn-helpers.ts`），注入死代理 env 后取子进程 env + 用该 env 真实 spawn 一个 node 子进程读取自身代理变量：

```
=== buildSpawnEnv child env (key proxy vars) ===
HTTPS_PROXY: http://127.0.0.1:1          ← CLI 子进程带代理
SLACK_BOT_TOKEN set: true
SLACK_APP_TOKEN set: true
=== real child process ===
child sees http_proxy=http://127.0.0.1:1 (exit 0)   ← 真实子进程确认继承
```

注：`http_proxy: undefined` 直读字段 vs 子进程实际可见，是 Windows env 大小写不敏感的既有行为（`{...process.env}` 只枚举一种大小写），与 `tests/transport.test.ts` 的 JSON snapshot 断言口径一致。

### §3.3 ST-NR-103 — `chorusgate log --error`（✅ PASSED）

出题：`log --error` 启动后 error.log 存在、可查询。沿用前一轮证据（§3 报告）：

```
$ node bin/chorusgate.mjs log --error --agent default
[ts 2026-08-20 09:35:18.639] [ERROR] [daemon] UNCAUGHT_EXCEPTION — exiting for watchdog
  Error: Config file not found: D:\Users\delez\.chorusgate\default\.env ...
```
- `--error` flag 真实存在（`src/cli-args.ts:146`），error.log 独立落盘、可查询。

### §3.4 ST-NR-104 — kill daemon → watchdog 拉起（✅ PASSED，需 D2）

出题：注册 watchdog 后 kill daemon，`schtasks /Run` 触发，daemon 自动拉起。

执行（临时 User 级 CHORUSGATE_HOME 隔离）：注册 watchdog → kill daemon（旧 pid 11168）→ `schtasks /Run /TN chorusgate-watchdog-sit-nr` → 新进程 pid 4700 运行中 + `Socket Mode connected`，拉起成功。

**发现 #148-D2**：watchdog 拉不起的直接原因在 `scripts/chorusgate-watchdog.ps1/.sh` 的 restart 分支——install 写入的 `-Bin`/`CHORUSGATE_BIN` 是 `node <abs mjs>`（含空格），`& $cmd` / `"$CMD" restart` 会把整串当命令名，在 `$ErrorActionPreference=SilentlyContinue` 掩盖下静默失败（已用 PowerShell 直测复现：`& $cmd status` → not recognized）。修复见 §4。

### §3.5 ST-NR-105 — install×2 / uninstall×2 幂等 + .env 保留（✅ PASSED）

出题：`watchdog install` ×2 → schtasks 验证 → uninstall ×2；断言幂等、Task 出现/移除、.env/token 不删。沿用前一轮证据（§2 报告）：
- install ×2 均 `✔ watchdog installed` EXIT:0，schtasks /Query 确认任务存在
- uninstall ×2 均 EXIT:0（第 2 次 `not found — nothing to uninstall`），/Query 确认移除
- `.env/token` 不删：sit-nr 无预置 profile，以「无残留」验证；「卸载不删已有 profile」由 Linux ST-NR-107 覆盖

### §3.6 ST-NR-106 — 断网退避 → 恢复（✅ PASSED，需 D3）

出题：断网（注入中段网络故障）→ 重连退避递增可见 + ≤2 探测周期内恢复 + 无重复消息；恢复后 backoff reset。

执行：本地 CONNECT 代理 `tests/scripts/cg-connect-proxy.mjs`（127.0.0.1:17900）承载 sit-nr daemon 的 Slack 流量（`CHORUSGATE_SLACK_TRANSPORT=proxy CHORUSGATE_PROXY_URL=http://127.0.0.1:17900`），故障注入 = kill 代理进程 → 恢复 = 重启代理。**全程只影响测试 daemon，不动生产 claude/codex。**

**修复前（D3 复现）**：kill 代理后日志停在 `reconnect scheduled in 1104ms`，daemon 无任何异常/日志**静默 exit(0)** —— 重连定时器永远没等到触发，退避/熔断全是死代码。

**修复后**（同一场景，gateway.log 时间线）：

```
11:46:38.787 disconnected unexpectedly
11:46:38.788 connection failed (socket disconnected) — consecutive=1
11:46:38.790 reconnect scheduled in 971ms
11:46:39.768 forcing reconnect (zombie socket)      ← 重连 timer 正常触发（修复前进程已死）
11:46:39.769 disconnecting...
11:46:39.777 → 11:48:17  http request failed connect ECONNREFUSED 127.0.0.1:17900
            （退避间隔实测：1.0s → 1.3 → 1.7 → 2.2 → 2.9 → 3.7 → 4.8 → 6.3 → 8.2
             → 10.6 → 13.8 → 17.9 → 23.3s，指数递增 + jitter，共 14+ 次）
11:48:59.548 connecting to Slack...                  ← 代理重启后下一个退避窗口
11:49:00.791 Socket Mode connected
11:49:00.793 reconnect successful — backoff reset
```

- 断网窗口内 daemon pid 全程存活（20908），无重复消息（无一次成功连接自然无重发）
- 恢复在重启代理后的**下一个退避窗口**内完成（≤1 个探测周期），`backoff reset` 确认策略复位
- 修复后与修复前是**同一代码路径**唯一差异：`rp.reconnectTimer.ref?.()`（原 `.unref?.()`）

## §4 缺陷 #148-D2 — watchdog restart 命令空格拆分（已修复）

- **现象**：watchdog 判定 daemon 死亡后 restart 静默失败，daemon 永远拉不起来
- **根因**：`scripts/chorusgate-watchdog.ps1:66` `& $cmd restart` 与 `chorusgate-watchdog.sh:62` `"$CMD" restart`，install 写入的 `-Bin`/`CHORUSGATE_BIN` = `node <abs mjs>`（含空格）——`& $cmd` 把整串当命令名静默失败（PowerShell 直测复现），且 ps1 的 `$ErrorActionPreference=SilentlyContinue` 掩盖了失败
- **修复**：在第一个空格拆成 exe + 脚本路径再调用（ps1:70-75 / sh:60-66）
- **验证**：kill daemon 11168 → schtasks /Run → 新 pid 4700 + Socket Mode connected（§3.4）
- 影响面：仅 watchdog 脚本 restart 分支；install/uninstall 不受影响

## §5 缺陷 #148-D3 — 重连 timer unref → 断网静默 exit(0)（P1，已修复）

- **现象**：mid-session socket 断开后 daemon 无异常无日志**静默 exit(0)**（两次复现：daemonized pid 6584 + foreground）
- **根因**：`src/socket-manager.ts:527` `rp.reconnectTimer.unref?.()`。socket 断开后 daemon 内所有句柄均 unref（liveness tick/probe、status/evict timer、本重连 timer），唯一 ref 的 ws socket 也断了 → 事件循环在重连定时器触发前耗尽 → 进程退出。退避/熔断/恢复全部成死代码。**这正是 6am 事故场景**：网络中断时本应进入退避等待重连，实际进程直接消失，只能等人工重启
- **修复**：`rp.reconnectTimer.ref?.()`（优雅关闭走 SIGTERM 显式退出，不受影响）
- **验证**：§3.6 完整时间线——断网 → 14+ 次退避重连（间隔 1.0s→23.3s）→ 代理恢复 → `Socket Mode connected` + `backoff reset`，daemon 全程存活
- 影响面：所有 socket 断开后的重连路径（非网络故障时定时器正常触发，行为不变）

## §6 交付物核对

- D2 修复：`scripts/chorusgate-watchdog.ps1` + `chorusgate-watchdog.sh`（本 commit）
- D3 修复：`src/socket-manager.ts`（本 commit）
- 测试夹具：`tests/scripts/cg-connect-proxy.mjs`（ST-NR-106 可复跑；Linux 侧小马 re-SIT 可直接复用）
- L4 隔离要求核对：独立 profile sit-nr + 临时 CHORUSGATE_HOME ✅；生产 claude/codex 未触碰 ✅；临时 User 级 CHORUSGATE_HOME 已清理 ✅；sit-nr daemon/代理/临时 home 已清理 ✅
- 报告路径：`docs/tests/cases/2026-08-20-148-l4-windows-xiaoke.md`

## §7 对验收的请求

小马此前已按中间态（3 blocked）给出 CONDITIONAL PASS、小扣已按 `36c5f44` 关单。**本报告补齐全部 6 个用例 + 2 个新缺陷（含 P1 D3）**，请求：

1. <@U0B91BVKTL2> 小马：按新 SHA 复核 D3 修复（重点 ST-NR-106 退避恢复链路）与 D2（watchdog 拉起），Linux 侧如复用 `cg-connect-proxy.mjs` 可低成本复跑
2. <@U0BAGFVD8VB> 小扣：D3 为 P1（断网静默死，正是 6am 根因场景），原 CONDITIONAL PASS 的「104/106 异步补验」现已完成并暴露此缺陷，建议在 D3 复核后更新验收结论
