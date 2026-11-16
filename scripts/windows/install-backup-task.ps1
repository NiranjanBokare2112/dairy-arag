# Registers a Windows scheduled task "Arag Dudh - daily backup" that runs backup.ps1 every day at 23:30
# (after the evening shift). Uses Windows Task Scheduler only; nothing extra to install.
#
#   powershell -ExecutionPolicy Bypass -File scripts\windows\install-backup-task.ps1            (install / update)
#   powershell -ExecutionPolicy Bypass -File scripts\windows\install-backup-task.ps1 -At 22:00  (another time)
#   powershell -ExecutionPolicy Bypass -File scripts\windows\install-backup-task.ps1 -Remove    (uninstall)
#
# The task runs as the signed-in Windows user, also on battery, and catches up after a missed run (PC was off).
param([string]$At = '23:30', [switch]$Remove)
$ErrorActionPreference = 'Stop'
$name = 'Arag Dudh - daily backup'
if ($Remove) { Unregister-ScheduledTask -TaskName $name -Confirm:$false; Write-Output "Removed: $name"; exit 0 }
$script = Join-Path $PSScriptRoot 'backup.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$trigger = New-ScheduledTaskTrigger -Daily -At $At
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description 'Backs up the Arag Dudh database to backups\ and the off-site folder.' -Force | Out-Null
Write-Output "Installed: '$name' daily at $At. Test it now with:  Start-ScheduledTask -TaskName '$name'"
