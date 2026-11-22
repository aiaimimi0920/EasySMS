param(
    [Parameter(Mandatory = $true)][string]$RequestPath,
    [Parameter(Mandatory = $true)][string]$ResultPath
)
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'springbok.mjs') -RequestPath $RequestPath -ResultPath $ResultPath
exit $LASTEXITCODE
