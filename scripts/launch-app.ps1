$ErrorActionPreference = 'Stop'

$dashboardUrl = 'http://localhost:8787/#overview'
$healthUrl = 'http://localhost:8787/api/health'
$runner = (Resolve-Path (Join-Path $PSScriptRoot 'start-local.ps1')).Path
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source

function Test-SwingSignalDesk {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $healthUrl -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-SwingSignalDesk)) {
  Start-Process -FilePath $powershell `
    -ArgumentList @('-NoProfile', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-File', "`"$runner`"") `
    -WindowStyle Hidden
  foreach ($attempt in 1..20) {
    Start-Sleep -Milliseconds 500
    if (Test-SwingSignalDesk) { break }
  }
}

$browserCandidates = @(
  (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe'),
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
)
$browser = $browserCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

if ($browser) {
  Start-Process -FilePath $browser -ArgumentList @("--app=$dashboardUrl", '--start-maximized')
} else {
  Start-Process $dashboardUrl
}
