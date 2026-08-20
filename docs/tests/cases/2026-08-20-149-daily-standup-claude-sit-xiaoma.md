# #149 小克日报自动化 — 小马 Linux 侧 SIT（f92baa5）

- **日期**: 2026-08-20 13:xx (hourly push心跳)
- **测试人**: 小马 (ainizehermes)
- **验收对象**: commit `f92baa5` @ 分支 `v5/logging-liveness`（远端 PR #143 head `4a7d782` 含该 commit，`git branch --contains` 链核验）
- **范围**: Linux 侧可验部分 — 源码审查 + verify-daily-report.mjs 实跑（缺失路径）+ matcher 归属判断实证 + 依赖核验。Windows 定时任务注册/次日投递为 Windows 侧用例（明日 09:05 首跑观察）。

## L0 静态核验

| 项 | 结果 | 证据 |
|---|---|---|
| 4 文件齐备（prompt/ps1/install/verify.mjs） | ✅ | `git show pr-143:scripts/coordination/` 四文件均在 |
| package.json 含 `@slack/web-api ^7.12.0` | ✅ | line 41 |
| .mcp.json chorusgate→Slack MCP 通道存在 | ✅ | 顶层 `.mcp.json` mcpServers.chorusgate（SLACK_BOT_TOKEN env 透传） |
| ps1 语法 | ⏸ 本机无 pwsh | Windows 侧补 |
| token 来源 `~/.chorusgate/claude/.env` | 设计如此 | Windows 侧实际加载路径 |

## L1 verify-daily-report.mjs 实跑（缺失路径）

```
$ set -a; source ~/.hermes/.env; node verify-daily-report.mjs 2026-08-20
[MISSING] zgos-ip-sprint3 (C0BLZ8KD8DD) — no standup for 2026-08-20
[MISSING] chorusgate-sprint5 (C0BMEKM8YLA) — no standup for 2026-08-20
[MISSING] aifitness-sprint1 (C0BMCL6GTUN) — no standup for 2026-08-20
EXIT=1
```

（Slack Web API 鉴权通过、API 拉取正常、正确报缺失且 exit 1 — 该路径恰为 #149 要根治的"看起来成功实际没发"，脚本行为符合设计。）

## L1 matcher 归属判断实证（关键加固点）

verify 以 `m.user === SLACK_APP_USER_ID(默认 U0B8VHLHJAX)` 判定"小克已投递"。实证：

- C0BMEKM8YLA 历史里小克消息（bot_id=B0B95H9GCVA）→ `m.user=U0B8VHLHJAX` ✅
- 对照：小马 bot（B0B8V0V55DH）→ `m.user=U0B91BVKTL2`；小龙 bot（B0BGRFB1QJE）→ `m.user=U0BGK82C2KV`。各 bot 消息的 user 字段确为各 agent member ID，归属判断成立，不会把小龙/小马的站会误判为小克投递。

正向命中路径推演：今日三频道已有他人站会（zgos: 小马×1；cg: 小龙+小马；af: 小龙+小马，均含"站会"+"2026-08-20"），匹配条件（含站会+今日+user=小克）对他人消息不误报 — 与上述归属实证一致。

## L2 边界审查（源码）

1. ✅ 重试策略：verify fail → 全量重跑 standup（非仅重发）→ 再 verify → throw（Task Scheduler LastTaskResult≠0 报警路径成立）
2. ✅ prompt 明确"每频道只发一条 top-level、不进 thread、mention 用尖括号 ID"，与小马/小龙现有站会格式对齐
3. ⚠️ 观察（非阻断）: `claude -p` 端到端投递不在 Linux 可验范围；明日 09:05 Windows 首跑后用本 verify 脚本复核三频道是否 [ok]，即 AC「次日 9:xx 三频道出现小克日报」的实证闭环。
4. ⚠️ 观察（非阻断）: conversations.history limit=50 — 站会高峰时段若频道消息>50条/日，小克日报被刷出窗口会误报 MISSING。建议后续把 limit 提至 200 或加 `oldest` 参数。已列入观察项供小克参考。

## 结论

**LINUX 侧 PASS（受限）** — 源码/依赖/verify 实跑/归属实证全过；Windows 定时任务注册与次日投递待 8/21 09:05 首跑后由小马用同一 verify 脚本远程复核关单。

## 后续

1. 8/21 09:05 首跑后：小马实跑 `node verify-daily-report.mjs 2026-08-21` 期望三频道 [ok]（=AC1 满足）
2. limit=50 → 200 建议：随下次 #149 相关 commit 或独立小 PR 处理
3. Windows 侧 pwsh 语法检查（小克自查或并入首跑日志）
