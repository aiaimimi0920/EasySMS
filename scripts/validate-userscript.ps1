param(
    [string]$ConfigPath = "config.example.yaml"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$validationOutputPath = Join-Path $repoRoot ".tmp\userscript\easy_sms_proxy.validate.user.js"
$derivedOverridesPath = Join-Path $repoRoot ".tmp\derived\userscript-defaults.json"

& (Join-Path $PSScriptRoot "compile-userscript.ps1") `
    -ConfigPath $ConfigPath `
    -OutputPath $validationOutputPath | Out-Null

if (-not (Test-Path -LiteralPath $validationOutputPath)) {
    throw "Userscript validation output was not created: $validationOutputPath"
}

$content = Get-Content -Raw -LiteralPath $validationOutputPath
if ($content -notmatch "EasySMS Browser Runtime") {
    throw "Userscript validation output does not contain the expected userscript header."
}

if (-not (Test-Path -LiteralPath $derivedOverridesPath)) {
    throw "Userscript validation overrides were not created: $derivedOverridesPath"
}

$overrides = Get-Content -Raw -LiteralPath $derivedOverridesPath | ConvertFrom-Json
foreach ($property in $overrides.PSObject.Properties) {
    $escapedValue = ([string]$property.Value).Replace('\', '\\').Replace('"', '\"')
    $expectedLiteral = '{0}: "{1}"' -f [string]$property.Name, $escapedValue
    if (-not $content.Contains($expectedLiteral)) {
        throw "Userscript validation output does not contain the rendered override for $($property.Name)."
    }
}

& node --check $validationOutputPath
if ($LASTEXITCODE -ne 0) {
    throw "Userscript validation output is not valid JavaScript: $validationOutputPath"
}

Write-Host "Userscript validation passed: $validationOutputPath"
