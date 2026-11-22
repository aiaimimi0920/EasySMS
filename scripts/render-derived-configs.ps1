param(
    [string]$ConfigPath = "config.yaml",
    [string]$RuntimeOutputPath = ".tmp/derived/service-base.runtime.yaml",
    [string]$SummaryOutputPath = ".tmp/derived/config-summary.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "lib\easysms-config.ps1")

$resolvedConfigPath = Resolve-EasySmsPath -Path $ConfigPath -BaseDir $repoRoot
$resolvedRuntimeOutputPath = Resolve-EasySmsPath -Path $RuntimeOutputPath -BaseDir $repoRoot
$resolvedSummaryOutputPath = Resolve-EasySmsPath -Path $SummaryOutputPath -BaseDir $repoRoot
$renderScript = Join-Path $PSScriptRoot "render-derived-configs.py"

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedRuntimeOutputPath) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedSummaryOutputPath) | Out-Null

Assert-EasySmsPythonModule -ModuleName "yaml" -PackageName "pyyaml"

& python $renderScript `
    --config $resolvedConfigPath `
    --runtime-output $resolvedRuntimeOutputPath `
    --summary-output $resolvedSummaryOutputPath

if ($LASTEXITCODE -ne 0) {
    throw "render-derived-configs.py failed with exit code $LASTEXITCODE"
}

[pscustomobject]@{
    ConfigPath = $resolvedConfigPath
    RuntimeOutputPath = $resolvedRuntimeOutputPath
    SummaryOutputPath = $resolvedSummaryOutputPath
} | Format-List
