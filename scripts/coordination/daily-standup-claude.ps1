# Daily standup for Xiaoke (Claude / CC) -- run by AINIZE-Claude-Daily-Standup task.
# Key differences vs codex version (daily-standup.ps1):
#   1. Loads Slack tokens from ~/.chorusgate/claude/.env so `claude -p` can post
#      via project .mcp.json (chorusgate-mcp -> Slack MCP).
#   2. Delivery verification: exit 0 != delivered. After posting, verify-daily-report.mjs
#      checks the channels actually got the report; missing -> retry once -> throw
#      (Task Scheduler records LastTaskResult != 0 for alerting).
param(
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# ---- 1. Load claude profile Slack tokens (same source as gateway) ----
$envFile = Join-Path $HOME '.chorusgate\claude\.env'
if (-not (Test-Path -LiteralPath $envFile)) {
    throw "Missing profile env: $envFile"
}
Get-Content -LiteralPath $envFile | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
        [System.Environment]::SetEnvironmentVariable($matches[1], $matches[2], 'Process')
    }
}

$today = Get-Date -Format 'yyyy-MM-dd'
$promptPath = Join-Path $PSScriptRoot 'daily-standup-claude-prompt.md'
$prompt = (Get-Content -LiteralPath $promptPath -Raw -Encoding UTF8).Replace('{today}', $today)

if ($DryRun) {
    Write-Output $prompt
    exit 0
}

$claude = (Get-Command claude -ErrorAction Stop).Source
$node = (Get-Command node -ErrorAction Stop).Source
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path   # ChorusGate_dev (has .mcp.json)
$verify = Join-Path $repoRoot 'scripts\coordination\verify-daily-report.mjs'
$logDir = Join-Path $PSScriptRoot 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir ("daily-standup-claude-$today.log")

function Invoke-Standup {
    # claude (this build) has no --cd flag; set the process cwd instead (mirrors the
    # gateway's cwd-spawn so claude picks up the project .mcp.json -> Slack MCP).
    # Temporarily downgrade EA so claude's stderr (merged via 2>&1) doesn't terminate
    # under $ErrorActionPreference='Stop' before Tee can write the log.
    Push-Location $repoRoot
    try {
        $ErrorActionPreference = 'Continue'
        & $claude -p $prompt 2>&1 | Tee-Object -FilePath $log -Append
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = 'Stop'
        Pop-Location
    }
    if ($code -ne 0) {
        throw "Daily standup failed: claude exit $code -- see $log"
    }
}

function Test-Delivered {
    & $node $verify $today 2>&1 | Tee-Object -FilePath $log -Append
    return $LASTEXITCODE -eq 0
}

# ---- First attempt + verification ----
Invoke-Standup

# ---- Verification failed -> retry once (full rerun) ----
if (-not (Test-Delivered)) {
    Write-Output "[retry] delivery check failed on first attempt -- retrying"
    Invoke-Standup
    if (-not (Test-Delivered)) {
        throw "Delivery check FAILED after retry -- report missing in >=1 channel for $today, see $log"
    }
}

Write-Output "[ok] daily standup delivered for $today (log: $log)"
