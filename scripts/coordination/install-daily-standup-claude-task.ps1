param(
    [string]$At = '09:05'
)

# 注册小克(Claude/CC) 每日站会定时任务（#149）。
# 09:05 错峰小扣(codex) 的 09:00/09:20，避免并发抢占。
# 脚本自带投递校验+重试，失败时 Task Scheduler 记录 LastTaskResult != 0（可在"设置"里配失败重启/通知）。

$ErrorActionPreference = 'Stop'
$standupScript = (Resolve-Path (Join-Path $PSScriptRoot 'daily-standup-claude.ps1')).Path
$taskName = 'AINIZE-Claude-Daily-Standup'
$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$standupScript`""

& schtasks.exe /Create /TN $taskName /SC DAILY /ST $At /TR $taskCommand /F
if ($LASTEXITCODE -ne 0) {
    throw "Unable to register scheduled task '$taskName' (schtasks exit $LASTEXITCODE)."
}

& schtasks.exe /Query /TN $taskName /FO LIST /V
if ($LASTEXITCODE -ne 0) {
    throw "Task '$taskName' was created but could not be queried."
}
