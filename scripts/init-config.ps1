param(
    [string]$ExamplePath = "config.example.yaml",
    [string]$ConfigPath = "config.yaml",
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "lib\easysms-config.ps1")

$resolvedExamplePath = Resolve-EasySmsPath -Path $ExamplePath -BaseDir $repoRoot
$resolvedConfigPath = Resolve-EasySmsPath -Path $ConfigPath -BaseDir $repoRoot

if (-not (Test-Path -LiteralPath $resolvedExamplePath)) {
    throw "Example config not found: $resolvedExamplePath"
}

if ((Test-Path -LiteralPath $resolvedConfigPath) -and -not $Force) {
    Write-Host "Config already exists: $resolvedConfigPath"
    return
}

Copy-Item -LiteralPath $resolvedExamplePath -Destination $resolvedConfigPath -Force
Write-Host "Created config from example: $resolvedConfigPath"
