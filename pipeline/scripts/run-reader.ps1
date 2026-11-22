# Run the notice reader on this PC, without GitHub. Windows Task Scheduler starts it at 11:00 and
# 19:00 (see install-reader-task.ps1 and docs/PC_RUNNER.md).
#
# Settings come from %USERPROFILE%\.myavedan\.env (never committed):
#   GEMINI_API_KEY=...
#   INGEST_HMAC_SECRET=...      (production ingest secret)
# Each run writes a log to %USERPROFILE%\.myavedan\logs\ (the last 60 are kept).
param(
  [int]$MaxNew = 15,
  [int]$FromBacklog = 6,
  [switch]$DryRun
)

$ErrorActionPreference = "Continue"
$pipeline = Split-Path -Parent $PSScriptRoot
$home2 = Join-Path $env:USERPROFILE ".myavedan"
$logs = Join-Path $home2 "logs"
New-Item -ItemType Directory -Force $logs | Out-Null
$log = Join-Path $logs ("reader-" + (Get-Date -Format "yyyyMMdd-HHmm") + ".log")

$env:PYTHONUTF8 = "1"
$env:PYTHONUNBUFFERED = "1"
if (-not $env:INGEST_URL) { $env:INGEST_URL = "https://api.myavedan.in/api/ingest" }
$env:READER_MODE = "discover"
$env:READER_MAX_NEW = "$MaxNew"
$env:READER_FROM_BACKLOG = "$FromBacklog"
$env:READER_DRY_RUN = if ($DryRun) { "true" } else { "false" }

Set-Location $pipeline
# cmd writes the log as plain UTF-8 (PowerShell 5's >> would write UTF-16).
cmd /c "echo == reader started %DATE% %TIME% in $pipeline > `"$log`""
# Latest code from main, if this folder is a clean checkout on main. Never fails the run.
$branch = (git rev-parse --abbrev-ref HEAD) 2>$null
$dirty = (git status --porcelain) 2>$null
if ($branch -eq "main" -and -not $dirty) { cmd /c "git pull --ff-only --quiet >> `"$log`" 2>&1" }
cmd /c "python -m pip install --quiet --disable-pip-version-check -r requirements.txt >> `"$log`" 2>&1"
cmd /c "python -m myavedan_pipeline.cli scheduled >> `"$log`" 2>&1"
$code = $LASTEXITCODE
cmd /c "echo == reader finished %DATE% %TIME% with exit code $code >> `"$log`""

Get-ChildItem $logs -Filter "reader-*.log" | Sort-Object Name -Descending | Select-Object -Skip 60 | Remove-Item -Force
exit $code
