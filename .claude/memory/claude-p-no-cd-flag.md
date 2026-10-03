---
name: claude-p-no-cd-flag
description: claude -p 无 --cd flag；PS 脚本里用进程 cwd + EA Continue 包裹 2>&1，否则 claude stderr 在 Stop 下提前中止
metadata:
  type: feedback
---

`claude` CLI (2.1.235 实测) **没有 `--cd` flag**：`claude -p --cd <dir>` 报 `error: unknown option '--cd'`。

**Why:** #149 日报自动化 `daily-standup-claude.ps1` 首跑(2026-08-21 09:05)三频道全部 MISSING、任务 exit 1 但 logs/ 真空。根因是脚本用了不存在的 `--cd`，且 `$ErrorActionPreference='Stop'` + `2>&1 | Tee-Object` 会让 claude 的 stderr 变成终止错误，在 Tee 写 log 之前就把脚本杀掉 → 连报错都没留下，极难定位。

**How to apply:**
- 指定 claude 工作目录**不能用 flag**，要设**进程 cwd**（gateway 正是这样：spawn `cwd` / `GATEWAY_CLAUDE_CWD`）。PS 脚本用 `Push-Location $repoRoot ... Pop-Location`。
- 原生命令调用段把 `$ErrorActionPreference` 临时降为 `'Continue'` 再 `2>&1`，让 stderr 进 log 而非中止；`$LASTEXITCODE` 才是王道，勿靠 stderr 判成败。
- 定位"调度任务 exit 1但无日志"：调度器不返回 stdout/stderr，clone 一个同 Principal/InteractiveToken 的探针任务，让探针把 $HOME/PATH/命令解析/异常写到文件再读（TaskScheduler output 拿不到）。
- 验证链：真实 `schtasks /run` + `verify-daily-report.mjs` 三频道 `[ok]` 才是关单实证。