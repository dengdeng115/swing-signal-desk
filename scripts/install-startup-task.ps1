$ErrorActionPreference = 'Stop'

$taskName = 'Swing Signal Desk'
$runner = (Resolve-Path (Join-Path $PSScriptRoot 'start-local.ps1')).Path
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`""

$action = New-ScheduledTaskAction -Execute $powershell -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Principal $principal `
  -Description 'Starts the local Swing Signal Desk Discord listener and dashboard after Windows sign-in.' `
  -Force | Out-Null

$task = Get-ScheduledTask -TaskName $taskName
[pscustomobject]@{
  TaskName = $task.TaskName
  State = $task.State
  Runner = $runner
  Trigger = 'At logon'
}
