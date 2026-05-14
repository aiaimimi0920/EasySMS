param(
    [string]$ConfigPath = "config.yaml",
    [string]$Image = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "lib\easysms-config.ps1")

$summaryOutputPath = Join-Path $repoRoot ".tmp\derived\config-summary.json"
$runtimeOutputPath = Join-Path $repoRoot "deploy\service\base\config\config.yaml"
$userscriptOverridesPath = Join-Path $repoRoot ".tmp\derived\userscript-defaults.json"

& (Join-Path $PSScriptRoot "render-derived-configs.ps1") `
    -ConfigPath $ConfigPath `
    -RuntimeOutputPath $runtimeOutputPath `
    -SummaryOutputPath $summaryOutputPath `
    -UserscriptOverridesOutputPath $userscriptOverridesPath | Out-Null

$summary = Get-Content -Raw -LiteralPath $summaryOutputPath | ConvertFrom-Json
$resolvedImage = if ([string]::IsNullOrWhiteSpace($Image)) {
    [string]$summary.serviceBase.image
} else {
    $Image
}

if ([string]::IsNullOrWhiteSpace($resolvedImage)) {
    throw "No image name resolved from the root config or -Image."
}

docker build -f (Join-Path $repoRoot "deploy\service\base\Dockerfile") -t $resolvedImage $repoRoot
if ($LASTEXITCODE -ne 0) {
    throw "docker build failed with exit code $LASTEXITCODE"
}

Write-Host "Built image: $resolvedImage"
