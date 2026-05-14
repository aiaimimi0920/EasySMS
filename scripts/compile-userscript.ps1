param(
    [string]$ConfigPath = "config.yaml",
    [string]$OutputPath = "",
    [switch]$CopyToClipboard
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "lib\easysms-config.ps1")

$derivedTempRoot = Join-Path $repoRoot ".tmp\derived"
$summaryOutputPath = Join-Path $derivedTempRoot "config-summary.json"
$overridesOutputPath = Join-Path $derivedTempRoot "userscript-defaults.json"
$runtimeOutputPath = Join-Path $repoRoot "deploy\service\base\config\config.yaml"

& (Join-Path $PSScriptRoot "render-derived-configs.ps1") `
    -ConfigPath $ConfigPath `
    -RuntimeOutputPath $runtimeOutputPath `
    -SummaryOutputPath $summaryOutputPath `
    -UserscriptOverridesOutputPath $overridesOutputPath | Out-Null

$summary = Get-Content -Raw -LiteralPath $summaryOutputPath | ConvertFrom-Json
$overrides = Get-Content -Raw -LiteralPath $overridesOutputPath | ConvertFrom-Json

$sourcePath = Resolve-EasySmsPath -Path $summary.userscript.sourcePath -BaseDir $repoRoot
$resolvedOutputPath = if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    Resolve-EasySmsPath -Path $summary.userscript.outputPath -BaseDir $repoRoot
} else {
    Resolve-EasySmsPath -Path $OutputPath -BaseDir $repoRoot
}

if (-not (Test-Path -LiteralPath $sourcePath)) {
    throw "Source userscript not found: $sourcePath"
}

$source = Get-Content -Raw -LiteralPath $sourcePath

foreach ($property in $overrides.PSObject.Properties) {
    $name = [string]$property.Name
    $value = [string]$property.Value
    $escapedValue = $value.Replace('\', '\\').Replace('"', '\"')
    $pattern = "($([regex]::Escape($name))\s*:\s*)"".*?"""
    $replacement = '$1"' + $escapedValue + '"'
    $source = [regex]::Replace($source, $pattern, $replacement)
}

$banner = @(
    "// LOCAL DEV BUILD",
    "// Generated from root config.yaml + runtimes/userscript/easy_sms_proxy.user.js",
    "// Do not commit this file."
) -join "`r`n"

$output = $banner + "`r`n" + $source
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $resolvedOutputPath) | Out-Null
Set-Content -LiteralPath $resolvedOutputPath -Value $output -Encoding UTF8

$copyEnabled = $CopyToClipboard.IsPresent
if (-not $copyEnabled -and $summary.userscript.copyToClipboard) {
    $copyEnabled = [bool]$summary.userscript.copyToClipboard
}

if ($copyEnabled) {
    Set-Clipboard -Value $output
    Write-Host "Generated and copied to clipboard: $resolvedOutputPath"
} else {
    Write-Host "Generated local userscript: $resolvedOutputPath"
}
