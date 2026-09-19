$ErrorActionPreference = 'Stop'

$desktop = [Environment]::GetFolderPath('Desktop')
$displayName = -join ([char[]](0x6CE2, 0x6BB5, 0x4FE1, 0x53F7, 0x53F0))
$shortcutPath = Join-Path $desktop "$displayName.lnk"
$launcher = (Resolve-Path (Join-Path $PSScriptRoot 'launch-app.ps1')).Path
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$projectRoot = Split-Path -Parent $PSScriptRoot

$browserCandidates = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$browser = $browserCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$opens = 'Standalone browser app window'
if ($browser) {
  # A direct browser shortcut is less likely to be quarantined than a desktop
  # shortcut whose target is PowerShell. The logon task owns backend startup.
  $shortcut.TargetPath = $browser
  $shortcut.Arguments = '--app=http://localhost:8787/#overview --start-maximized'
} else {
  $shortcut.TargetPath = $powershell
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`""
  $opens = 'Default browser through the fallback launcher'
}
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = 'Open the local Swing Signal Desk live dashboard'
if ($browser) { $shortcut.IconLocation = "$browser,0" }
$shortcut.Save()

[pscustomobject]@{
  Name = $displayName
  Shortcut = $shortcutPath
  Opens = $opens
  BackendStartup = 'Windows logon task; npm run desktop:open is the fallback launcher'
}
