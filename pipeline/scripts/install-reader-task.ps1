# Create the Windows scheduled task "MyAvedan notice reader": 11:00 and 19:00 every day.
# If the PC was off or asleep at that time, it runs as soon as possible afterwards.
# Run once in PowerShell from the pipeline folder:  powershell -ExecutionPolicy Bypass -File scripts\install-reader-task.ps1
$script = Join-Path $PSScriptRoot "run-reader.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$triggers = @(
  (New-ScheduledTaskTrigger -Daily -At "11:00"),
  (New-ScheduledTaskTrigger -Daily -At "19:00")
)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 3)
Register-ScheduledTask -TaskName "MyAvedan notice reader" -Action $action -Trigger $triggers -Settings $settings -Description "Reads new official recruitment notices and sends drafts to the MyAvedan review console." -Force | Out-Null
"Scheduled: 'MyAvedan notice reader' at 11:00 and 19:00. Run it now with:  Start-ScheduledTask 'MyAvedan notice reader'"
