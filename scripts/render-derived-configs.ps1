param(
    [string]$ConfigPath = "config.yaml",
    [string]$RuntimeOutputPath = "deploy/service/base/config/config.yaml",
    [string]$RuntimeEnvOutputPath = "deploy/service/base/config/runtime.env",
    [string]$SummaryOutputPath = ".tmp/derived/config-summary.json",
    [string]$UserscriptOverridesOutputPath = ".tmp/derived/userscript-defaults.json"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "lib\easysms-config.ps1")

$resolvedConfigPath = Resolve-EasySmsPath -Path $ConfigPath -BaseDir $repoRoot
$resolvedRuntimeOutputPath = Resolve-EasySmsPath -Path $RuntimeOutputPath -BaseDir $repoRoot
$resolvedRuntimeEnvOutputPath = Resolve-EasySmsPath -Path $RuntimeEnvOutputPath -BaseDir $repoRoot
$resolvedSummaryOutputPath = Resolve-EasySmsPath -Path $SummaryOutputPath -BaseDir $repoRoot
$resolvedUserscriptOverridesPath = Resolve-EasySmsPath -Path $UserscriptOverridesOutputPath -BaseDir $repoRoot
$renderScript = Join-Path $PSScriptRoot "render-derived-configs.py"

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedRuntimeOutputPath) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedRuntimeEnvOutputPath) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedSummaryOutputPath) | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedUserscriptOverridesPath) | Out-Null

Assert-EasySmsPythonModule -ModuleName "yaml" -PackageName "pyyaml"

& python $renderScript `
    --config $resolvedConfigPath `
    --runtime-output $resolvedRuntimeOutputPath `
    --runtime-env-output $resolvedRuntimeEnvOutputPath `
    --summary-output $resolvedSummaryOutputPath `
    --userscript-overrides-output $resolvedUserscriptOverridesPath

if ($LASTEXITCODE -ne 0) {
    throw "render-derived-configs.py failed with exit code $LASTEXITCODE"
}

[pscustomobject]@{
    ConfigPath = $resolvedConfigPath
    RuntimeOutputPath = $resolvedRuntimeOutputPath
    RuntimeEnvOutputPath = $resolvedRuntimeEnvOutputPath
    SummaryOutputPath = $resolvedSummaryOutputPath
    UserscriptOverridesOutputPath = $resolvedUserscriptOverridesPath
} | Format-List
