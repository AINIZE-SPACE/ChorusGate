# ============================================================
# chorusgate-watchdog.ps1 — restart an agent daemon whose heartbeat
# is stale or whose process died (liveness spec Layer 3).
#
# Judge: read <agent home>/status.json + gateway.pid. Restart when
#   - the PID file exists but the process is gone (dead), OR
#   - the process is alive but status.json.updatedAt is older than
#     GATEWAY_HEARTBEAT_STALE_MS (default 180000) — half-open/hung.
#
# Register with Task Scheduler every ~5 min (see README / liveness spec):
#   schtasks /Create /TN "chorusgate-watchdog" /TR "powershell -ExecutionPolicy
#     Bypass -File \"E:\path\to\scripts\chorusgate-watchdog.ps1\"" /SC MINUTE /MO 5
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts/chorusgate-watchdog.ps1
#   powershell ... -Agent codex -StaleMs 180000
# ============================================================
param(
  [string]$Agent = "default",
  [int]$StaleMs = 180000,
  # #148: install 命令写入的绝对重启命令（如 "node E:\...\bin\chorusgate.mjs"）。
  # 缺省回退 $env:CHORUSGATE_BIN，再回退 PATH 上的 "chorusgate"。
  [string]$Bin = $env:CHORUSGATE_BIN
)
$ErrorActionPreference = "SilentlyContinue"

# Home resolution: honor CHORUSGATE_HOME, else ~/.chorusgate (like gateway-paths).
if ($env:CHORUSGATE_HOME) {
  $homeDir = Join-Path $env:CHORUSGATE_HOME $Agent
} else {
  $homeDir = Join-Path (Join-Path $HOME ".chorusgate") $Agent
}
$statusFile = Join-Path $homeDir "status.json"
$pidFile = Join-Path $homeDir "gateway.pid"

# Daemon never started (or cleanly stopped) — nothing to do.
if (-not (Test-Path $statusFile)) { exit 0 }
if (-not (Test-Path $pidFile)) { exit 0 }

# PID from the pid file (same source as `status` / livePid).
$pidVal = 0
try { $pidVal = [int](Get-Content $pidFile -Raw).Trim() } catch {}
if ($pidVal -le 0) { exit 0 }

# Heartbeat age from status.json.updatedAt (epoch ms).
$ageMs = [int]::MaxValue
try {
  $st = Get-Content $statusFile -Raw | ConvertFrom-Json
  $updated = [DateTimeOffset]::FromUnixTimeMilliseconds([int64]$st.updatedAt)
  $ageMs = [int]((Get-Date) - $updated.ToLocalTime()).TotalMilliseconds
} catch { $ageMs = [int]::MaxValue }

# Process alive?
$alive = $false
try {
  $null = Get-Process -Id $pidVal -ErrorAction Stop
  $alive = $true
} catch { $alive = $false }

$restart = $false
if (-not $alive) { $restart = $true }
elseif ($ageMs -gt $StaleMs) { $restart = $true }

if ($restart) {
  $cmd = if ($Bin) { $Bin } else { "chorusgate" }
  Write-Host "[watchdog] restarting agent '$Agent' (alive=$alive heartbeatAge=${ageMs}ms)"
  # #148-D2: install 写入的 -Bin 是 "node <abs mjs>"（含空格）—— `& $cmd` 会把整串
  # 当命令名静默失败，daemon 永远拉不起来（$ErrorActionPreference=SilentlyContinue 掩盖）。
  # 在第一个空格拆成 exe + 脚本路径，再调用。
  $sep = $cmd.IndexOf(' ')
  if ($sep -gt 0) {
    & $cmd.Substring(0, $sep) $cmd.Substring($sep + 1) restart --agent $Agent
  } else {
    & $cmd restart --agent $Agent
  }
}
exit 0
