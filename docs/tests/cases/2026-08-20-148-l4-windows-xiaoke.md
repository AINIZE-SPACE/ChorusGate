# #148 L4 Windows 实机执行记录（小克 @ a55f0ce）

> Issue #148 连接健壮性 — L4 Windows 实机测试。
> 执行人：小克（Claude）。对象分支 `v5/logging-liveness`，HEAD `953beec`。
> 对出题：`docs/tests/cases/2026-08-20-148-sit-xiaoma.md` §4（ST-NR-101~106）。
> 结论：**ST-NR-105 ✅ PASSED（含 #148-D2 发现+修复）、ST-NR-103 ✅ PASSED、ST-NR-101/102/104/106 ⚠️ BLOCKED（无 sit-nr token / 断网会切断本会话，见 §4）**。

---

## §1 执行环境

- 宿主：ainize-dev（Windows 10 Pro 10.0.19045，Win dev 机）
- 分支：`v5/logging-liveness` @ `953beec`（含 D1 `3345439` + D2 `acbabbf`）
- 方式：独立 profile `sit-nr` + 真实 CLI（`node bin/chorusgate.mjs`），不触碰线上 claude/codex 网关
- 相关测试：`npx tsc --noEmit` 0 错；`transport.test.ts` **20/20**；`control-plane.test.ts` **8/8**

## §2 ST-NR-105 — watchdog install/uninstall 幂等（✅ PASSED + #148-D2）

出题：`chorusgate watchdog install --agent sit-nr` ×2 → schtasks 验证 → uninstall ×2；断言幂等、Task 出现/移除、.env/token 不删。

### 2.1 install ×2（幂等）

```
=== install #1 ===
installing watchdog for agent 'sit-nr'...
✔ watchdog installed: 'chorusgate-watchdog-sit-nr' (every 5 min, elevated)
EXIT:0

=== install #2（幂等）===
installing watchdog for agent 'sit-nr'...
✔ watchdog installed: 'chorusgate-watchdog-sit-nr' (every 5 min, elevated)
EXIT:0
```

schtasks /Query 确认任务存在：`chorusgate-watchdog-sit-nr` 状态 Ready，下次运行时间每 5 分钟。

### 2.2 uninstall ×2（幂等 — 修复前 fail / 修复后 pass）

```
=== uninstall #1 ===
uninstalling watchdog for agent 'sit-nr'...
✔ watchdog uninstalled: 'chorusgate-watchdog-sit-nr'
EXIT:0

=== uninstall #2（幂等验证）===
uninstalling watchdog for agent 'sit-nr'...
✔ watchdog 'chorusgate-watchdog-sit-nr' not found — nothing to uninstall
EXIT:0
```

schtasks /Query 确认任务已移除（`系统找不到指定的文件` / 退出码 1）。

### 2.3 发现的缺陷 #148-D2（修复前证据）

修复前 uninstall #2 返回 **EXIT:1**（✘ failed to uninstall）。根因：`uninstallWindows` 用 `/Delete` 输出文本正则匹配中文报错（`找不到`），本地化 Windows 下 schtasks 输出为 **GBK 编码**，`utf8` 解码成乱码导致正则失配，幂等判定失效。

修复（`acbabbf`）：改用 `schtasks /Query /TN <name>` **退出码预检**（status!=0 = 任务不存在 → 幂等成功返回 0），与文本编码彻底解耦。

### 2.4 .env/token 不删

`sit-nr` 无预置 profile（未创建 .env/token），uninstall 后确认 `~/.chorusgate/` 下 **无 sit-nr 目录残留**。Windows 侧该断言以「无残留」形式验证；「卸载不删已有 profile」完整断言由 Linux 侧 ST-NR-107 3/3 覆盖。

## §3 ST-NR-103 — `chorusgate log --error`（✅ PASSED）

出题：`chorusgate log --error` 启动后 error.log 存在、可查询。

```
$ node bin/chorusgate.mjs log --error --agent default
[ts 2026-08-20 09:35:18.639] [ERROR] [daemon] UNCAUGHT_EXCEPTION — exiting for watchdog
  Error: Config file not found: D:\Users\delez\.chorusgate\default\.env ...
```

- `--error` flag 真实存在（`src/cli-args.ts:146`，输出独立 error.log）
- `~/.chorusgate/default/error.log` 存在（857B）且 CLI 可读、可查询
- error.log 内容正确记录 daemon 异常退出原因（Config file not found → UNCAUGHT_EXCEPTION → watchdog 兜底链路可见）

## §4 BLOCKED 用例（如实标注，未虚报）

| 用例 | 阻塞原因 | 已具备的覆盖 |
|------|---------|-------------|
| ST-NR-101 死代理隔离 | 需真实 sit-nr token 才能起 daemon 且断言 `Slack auth.test 成功`；`~/.chorusgate/` 无 sit-nr profile/token，fake token 会让 auth.test 必失败 | 隔离逻辑在 `src/transport.ts`（平台中立）+ `transport.test.ts` **20/20（Windows 本机实测）** + Linux 真机 ST-NR-101 **6/6** |
| ST-NR-102 CLI 代理继承 | 同上（需 daemon 触发 CLI spawn + Slack 验证） | `transport.test.ts` 20/20 + Linux ST-NR-102 **7/7** |
| ST-NR-104 kill daemon → watchdog 拉起 | 需真实 profile 起 daemon + 注册 watchdog；无 sit-nr token | watchdog 接线逻辑同 ST-NR-105 实测通过；「拉起」路径需真机 daemon |
| ST-NR-106 断网退避→恢复 | 断网会切断**本 Slack 会话**（本项目正通过该网关收发消息），需协调维护窗口由他人执行 | Linux 侧已测退避/恢复（Re-SIT ST-NR-106 相关）；Windows 退避实现平台中立 |

**建议**：ST-NR-101/102 的核心（传输契约 + 平台中立 + spawn env）已在双机 20/20 + Linux 真机全绿，Windows 仅剩「真实 token 端到端 auth」一个缺口——需小马/乐老板提供一次性 `sit-nr` 测试 bot token（或接受 Linux 真机 + Windows 单测的联合覆盖即闭环）。ST-NR-104/106 需维护窗口或专人执行。

## §5 交付物核对

- D1（uninstallLinux 幂等）：`3345439`（远端可达，Re-SIT WD-5 14/14 ✅）
- D2（uninstallWindows 幂等）：`acbabbf`（远端可达，`git branch -r --contains acbabbf` → `origin/v5/logging-liveness`，HEAD `953beec`）
- #148 comment：issuecomment-5350661301（D2 证据）+ issuecomment-5350669470（命令名补正）
- 报告路径：`docs/tests/cases/2026-08-20-148-l4-windows-xiaoke.md`
