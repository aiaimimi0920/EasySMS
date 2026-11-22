Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "lib\easysms-config.ps1")

$serviceBaseDir = Join-Path $repoRoot "service\base"

function Invoke-InDirectory {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    Push-Location $Path
    try {
        & $Action
    } finally {
        Pop-Location
    }
}

function Invoke-NativeCommand {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Command,
        [Parameter(ValueFromRemainingArguments = $true)]
        [object[]]$Arguments
    )

    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $($LASTEXITCODE): $Command $($Arguments -join ' ')"
    }
}

Write-Host "Validating operator scripts..."
Invoke-InDirectory -Path $repoRoot -Action {
    Invoke-NativeCommand python -m unittest ".\scripts\tests\test_render_derived_configs.py" ".\scripts\tests\test_test_all_contract.py" ".\scripts\tests\test_release_acceptance_doc_contract.py"
}

Write-Host "Validating SpringBok SBA contract..."
Invoke-InDirectory -Path $repoRoot -Action {
    Invoke-NativeCommand node ".\scripts\validate-sba.mjs"
}

Write-Host "Validating service/base TypeScript, Vitest, and Cloudflare Worker bundle..."
Invoke-InDirectory -Path $serviceBaseDir -Action { Invoke-NativeCommand npm ci }
$serviceTsc = Resolve-EasySmsLocalNodeTool -PackageDirectory $serviceBaseDir -ToolName "tsc"
$serviceVitest = Resolve-EasySmsLocalNodeTool -PackageDirectory $serviceBaseDir -ToolName "vitest"
Invoke-InDirectory -Path $serviceBaseDir -Action { Invoke-NativeCommand $serviceTsc "--project" "tsconfig.json" "--noEmit" }
Invoke-InDirectory -Path $serviceBaseDir -Action { Invoke-NativeCommand $serviceVitest run }
Invoke-InDirectory -Path $serviceBaseDir -Action { Invoke-NativeCommand $serviceTsc "--project" "tsconfig.json" }
Invoke-InDirectory -Path $serviceBaseDir -Action { Invoke-NativeCommand node "scripts/build-worker.mjs" }

Write-Host "Validating SBA lifecycle test suite..."
Invoke-InDirectory -Path $repoRoot -Action {
    Invoke-NativeCommand node --test ".\tests\sba\sba-lifecycle.test.mjs"
}

Write-Host "Validating local config renderer..."
$rendererTempRoot = Join-Path $repoRoot ".tmp\\validation-derived"
$rendererRuntimeOutput = Join-Path $rendererTempRoot "runtime-config.yaml"
$rendererSummaryOutput = Join-Path $rendererTempRoot "config-summary.json"
& (Join-Path $PSScriptRoot "render-derived-configs.ps1") `
    -ConfigPath "config.example.yaml" `
    -RuntimeOutputPath $rendererRuntimeOutput `
    -SummaryOutputPath $rendererSummaryOutput | Out-Null

foreach ($path in @($rendererRuntimeOutput, $rendererSummaryOutput)) {
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Config renderer did not create expected output: $path"
    }
}

$runtimeContent = Get-Content -Raw -LiteralPath $rendererRuntimeOutput
if ($runtimeContent -notmatch "server:") {
    throw "Rendered runtime config is missing the server section."
}

$summary = Get-Content -Raw -LiteralPath $rendererSummaryOutput | ConvertFrom-Json
if (-not $summary.serviceBase -or -not $summary.serviceBase.runtime) {
    throw "Rendered config summary is missing serviceBase.runtime."
}

Write-Host "Repository validation passed."
