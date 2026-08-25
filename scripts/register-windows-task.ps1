param(
  [Parameter(Mandatory = $true)][string]$NodePath,
  [Parameter(Mandatory = $true)][string]$WorkerPath,
  [Parameter(Mandatory = $true)][string]$WorkingDirectory,
  [Parameter(Mandatory = $true)][string]$TaskName
)

$ErrorActionPreference = 'Stop'

Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction `
  -Execute $NodePath `
  -Argument ('"{0}"' -f $WorkerPath) `
  -WorkingDirectory $WorkingDirectory
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description 'Rime bilingual translation sidecar' `
  -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Output "Registered and started scheduled task: $TaskName"
