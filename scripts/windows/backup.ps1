# Daily backup of the center's database (CLAUDE.md §2). Run by the scheduled task from install-backup-task.ps1,
# or by hand:   powershell -ExecutionPolicy Bypass -File scripts\windows\backup.ps1
# Writes backups\arag-arag_dudh-<date>.dump (newest 30 kept) and copies it to BACKUP_DESTINATION from .env.
# A log of every run is appended to backups\backup-log.txt.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$log = Join-Path $repo 'backups\backup-log.txt'
New-Item -ItemType Directory -Force (Join-Path $repo 'backups') | Out-Null
Push-Location (Join-Path $repo 'backend')
try {
  $out = & python -m app.cli backup 2>&1 | Out-String
  $ok = $LASTEXITCODE -eq 0
  Add-Content -Encoding utf8 $log ("==== " + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ($(if ($ok) { ' OK' } else { ' FAILED' })) + "`r`n" + $out)
  if (-not $ok) { exit 1 }
} finally { Pop-Location }
