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

Write-Host "Validating userscript runtime..."
& (Join-Path $PSScriptRoot "validate-userscript.ps1")

Write-Host "Validating browser smoke helpers..."
Invoke-InDirectory -Path $repoRoot -Action {
    Invoke-NativeCommand node --test ".\scripts\tests\leetcode-signup-smoke.test.mjs" ".\scripts\tests\smstome-userscript.test.mjs" ".\scripts\tests\onlinesim-userscript.test.mjs" ".\scripts\tests\receive-smss-userscript.test.mjs" ".\scripts\tests\hero-sms-userscript.test.mjs" ".\scripts\tests\receive-sms-free-cc-userscript.test.mjs" ".\scripts\tests\userscript-mode-ui.test.mjs"
}

Write-Host "Validating operator scripts..."
Invoke-InDirectory -Path $repoRoot -Action {
    Invoke-NativeCommand python -m unittest ".\scripts\tests\test_materialize_action_config.py" ".\scripts\tests\test_render_derived_configs.py" ".\scripts\tests\test_easysms_import_code.py" ".\scripts\tests\test_deploy_host_contract.py" ".\scripts\tests\test_publish_workflow_secrets.py" ".\scripts\tests\test_smoke_script_contract.py"
}

Write-Host "Validating service/base..."
Invoke-InDirectory -Path $serviceBaseDir -Action { Invoke-NativeCommand npm ci }
$serviceTsc = Resolve-EasySmsLocalNodeTool -PackageDirectory $serviceBaseDir -ToolName "tsc"
$serviceVitest = Resolve-EasySmsLocalNodeTool -PackageDirectory $serviceBaseDir -ToolName "vitest"
Invoke-InDirectory -Path $serviceBaseDir -Action { Invoke-NativeCommand $serviceTsc -p tsconfig.json --noEmit }
Invoke-InDirectory -Path $serviceBaseDir -Action { Invoke-NativeCommand $serviceVitest run }
Invoke-InDirectory -Path $serviceBaseDir -Action { Invoke-NativeCommand $serviceTsc -p tsconfig.json }

Write-Host "Validating config renderer..."
$rendererTempRoot = Join-Path $repoRoot ".tmp\\validation-derived"
$rendererRuntimeOutput = Join-Path $rendererTempRoot "runtime-config.yaml"
$rendererRuntimeEnvOutput = Join-Path $rendererTempRoot "runtime.env"
$rendererSummaryOutput = Join-Path $rendererTempRoot "config-summary.json"
$rendererUserscriptOutput = Join-Path $rendererTempRoot "userscript-defaults.json"
& (Join-Path $PSScriptRoot "render-derived-configs.ps1") `
    -ConfigPath "config.example.yaml" `
    -RuntimeOutputPath $rendererRuntimeOutput `
    -RuntimeEnvOutputPath $rendererRuntimeEnvOutput `
    -SummaryOutputPath $rendererSummaryOutput `
    -UserscriptOverridesOutputPath $rendererUserscriptOutput | Out-Null

foreach ($path in @($rendererRuntimeOutput, $rendererRuntimeEnvOutput, $rendererSummaryOutput, $rendererUserscriptOutput)) {
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

$runtimeEnvContent = Get-Content -Raw -LiteralPath $rendererRuntimeEnvOutput
if ($runtimeEnvContent -match '^\s+$') {
    throw "Rendered runtime env should be empty or contain key/value pairs."
}

$userscriptDefaults = Get-Content -Raw -LiteralPath $rendererUserscriptOutput | ConvertFrom-Json
if (-not $userscriptDefaults.pollSeconds) {
    throw "Rendered userscript defaults are missing pollSeconds."
}

Write-Host "Repository validation passed."
