param(
    [string]$ComposeProjectName = "easy-sms"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$composeFilePath = Join-Path $repoRoot "deploy\service\base\docker-compose.yaml"

docker compose -p $ComposeProjectName -f $composeFilePath down
if ($LASTEXITCODE -ne 0) {
    throw "docker compose down failed with exit code $LASTEXITCODE"
}

Write-Host "Service base removed for compose project: $ComposeProjectName"
