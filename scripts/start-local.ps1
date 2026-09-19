$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$node = (Get-Command node.exe -ErrorAction Stop).Source
& $node 'server/src/index.js'
exit $LASTEXITCODE
