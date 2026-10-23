$ErrorActionPreference='Stop'
$targetDir=Join-Path $env:LOCALAPPDATA 'Blizzard\Hearthstone'
$source=Join-Path $PSScriptRoot '..\config\hearthstone-log.config'
if(-not (Test-Path -LiteralPath $source)){throw "Missing log config template: $source"}
New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
$target=Join-Path $targetDir 'log.config'
Copy-Item -LiteralPath $source -Destination $target -Force
Write-Output "Installed Hearthstone Power log config: $target"
