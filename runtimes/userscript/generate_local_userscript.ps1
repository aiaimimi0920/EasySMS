param(
  [string]$SourcePath = "",
  [string]$SecretsPath = "",
  [string]$OutputPath = "",
  [switch]$CopyToClipboard
)

$ErrorActionPreference = "Stop"
$runtimeRoot = Split-Path -Parent $PSCommandPath

if ([string]::IsNullOrWhiteSpace($SourcePath)) {
  $SourcePath = Join-Path $runtimeRoot "easy_sms_proxy.user.js"
}
if ([string]::IsNullOrWhiteSpace($SecretsPath)) {
  $SecretsPath = Join-Path $runtimeRoot "easy_sms_proxy.secrets.local.json"
}
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
  $OutputPath = Join-Path $runtimeRoot "easy_sms_proxy.local.user.js"
}

if (-not (Test-Path -LiteralPath $SourcePath)) {
  throw "Source userscript not found: $SourcePath"
}

$source = Get-Content -Raw -LiteralPath $SourcePath
$overrides = $null

if (Test-Path -LiteralPath $SecretsPath) {
  $overrides = Get-Content -Raw -LiteralPath $SecretsPath | ConvertFrom-Json
}

if ($overrides -ne $null) {
  foreach ($property in $overrides.PSObject.Properties) {
    if ($property.Name -eq "_notes") {
      continue
    }

    $name = [string]$property.Name
    $value = [string]$property.Value
    $escapedValue = $value.Replace('\', '\\').Replace('"', '\"')
    $pattern = "($([regex]::Escape($name))\s*:\s*)"".*?"""
    $replacement = '$1"' + $escapedValue + '"'
    $source = [regex]::Replace($source, $pattern, $replacement)
  }
}

$banner = @(
  "// LOCAL DEV BUILD",
  "// Generated from easy_sms_proxy.user.js + easy_sms_proxy.secrets.local.json (optional overrides)",
  "// Do not commit this file."
) -join "`r`n"

$output = $banner + "`r`n" + $source
Set-Content -LiteralPath $OutputPath -Value $output -Encoding UTF8

if ($CopyToClipboard) {
  Set-Clipboard -Value $output
  Write-Host "Generated and copied to clipboard: $OutputPath"
}
else {
  Write-Host "Generated local userscript: $OutputPath"
}
