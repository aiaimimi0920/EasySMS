param(
    [string]$ConfigPath = "config.yaml",
    [switch]$NoBuild,
    [string]$Image = "",
    [switch]$Pull,
    [string]$ImportCode = "",
    [string]$BootstrapFile = "",
    [string]$InstanceName = "",
    [string]$ContainerName = "",
    [int]$HostPort = 0,
    [string]$NetworkName = "EasyAiMi",
    [string]$NetworkAlias = "easy-sms",
    [string]$ComposeProjectName = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot "lib\easysms-config.ps1")
$render = Join-Path $PSScriptRoot "render-derived-configs.ps1"
if (-not (Test-Path -LiteralPath $render)) {
    throw "Missing render script: $render"
}

function Get-DefaultInstanceValue {
    param(
        [string]$ExplicitValue,
        [string]$DerivedValue
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitValue)) {
        return $ExplicitValue
    }

    return $DerivedValue
}

function Ensure-DockerNetwork {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name
    )

    if ([string]::IsNullOrWhiteSpace($Name)) {
        return
    }

    & docker network inspect $Name *> $null
    if ($LASTEXITCODE -eq 0) {
        return
    }

    Write-Host "Creating docker network: $Name" -ForegroundColor Cyan
    & docker network create $Name
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to create docker network $Name"
    }
}

$composeFile = Join-Path $PSScriptRoot "../deploy/service/base/docker-compose.yaml"
if (-not (Test-Path -LiteralPath $composeFile)) {
    throw "Missing docker compose file: $composeFile"
}

$resolvedConfigPath = Resolve-EasySmsPath -Path $ConfigPath
$composeDir = Split-Path -Parent $composeFile
$instanceRoot = $null
$configMountPath = "./config"
$dataMountPath = "./data"
$envFilePath = "./config/runtime.env"
$hostConfigRoot = Resolve-EasySmsPath -Path (Join-Path $composeDir "config")
$hostDataRoot = Resolve-EasySmsPath -Path (Join-Path $composeDir "data")

if (-not [string]::IsNullOrWhiteSpace($InstanceName)) {
    $instanceRoot = Join-Path $composeDir ("instances/{0}" -f $InstanceName)
    $instanceConfigRoot = Join-Path $instanceRoot "config"
    $instanceDataRoot = Join-Path $instanceRoot "data"
    $hostConfigRoot = Resolve-EasySmsPath -Path $instanceConfigRoot
    $hostDataRoot = Resolve-EasySmsPath -Path $instanceDataRoot
    $configMountPath = "./instances/$InstanceName/config"
    $dataMountPath = "./instances/$InstanceName/data"
    $envFilePath = "./instances/$InstanceName/config/runtime.env"
}

New-Item -ItemType Directory -Force -Path $hostConfigRoot | Out-Null
New-Item -ItemType Directory -Force -Path $hostDataRoot | Out-Null

$serviceOutput = Join-Path $hostConfigRoot "config.yaml"
$serviceEnvOutput = Join-Path $hostConfigRoot "runtime.env"
$bootstrapHostDir = Join-Path $hostConfigRoot "bootstrap"

if (-not [string]::IsNullOrWhiteSpace($BootstrapFile) -and -not [string]::IsNullOrWhiteSpace($ImportCode)) {
    throw "Specify either BootstrapFile or ImportCode, not both."
}

$effectiveImportCode = $ImportCode
if ([string]::IsNullOrWhiteSpace($effectiveImportCode) -and -not (Test-Path -LiteralPath $resolvedConfigPath)) {
    $effectiveImportCode = Read-Host "Local config.yaml was not found. Enter an EasySms import code to bootstrap from R2, or press Enter to cancel"
}

$summaryConfigPath = if (Test-Path -LiteralPath $resolvedConfigPath) {
    $resolvedConfigPath
} else {
    Join-Path $repoRoot "config.example.yaml"
}

if ([string]::IsNullOrWhiteSpace($BootstrapFile) -and [string]::IsNullOrWhiteSpace($effectiveImportCode)) {
    & $render `
        -ConfigPath $resolvedConfigPath `
        -RuntimeOutputPath $serviceOutput `
        -RuntimeEnvOutputPath $serviceEnvOutput
} else {
    New-Item -ItemType Directory -Force -Path $bootstrapHostDir | Out-Null
    if (-not [string]::IsNullOrWhiteSpace($effectiveImportCode)) {
        & (Join-Path $PSScriptRoot "write-service-base-r2-bootstrap.ps1") `
            -ImportCode $effectiveImportCode `
            -OutputPath (Join-Path $bootstrapHostDir "r2-bootstrap.json")
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to materialize bootstrap file from import code with exit code $LASTEXITCODE"
        }
    } else {
        $resolvedBootstrapFile = Resolve-EasySmsPath -Path $BootstrapFile
        if (-not (Test-Path -LiteralPath $resolvedBootstrapFile)) {
            throw "Bootstrap file not found: $resolvedBootstrapFile"
        }
        Copy-Item -LiteralPath $resolvedBootstrapFile -Destination (Join-Path $bootstrapHostDir "r2-bootstrap.json") -Force
    }

    Remove-Item -LiteralPath $serviceOutput -ErrorAction SilentlyContinue
    Set-Content -LiteralPath $serviceEnvOutput -Value "" -Encoding UTF8
}

$summaryOutput = New-EasySmsTempFile -Prefix "easysms-config-summary" -Extension ".json"
$summaryRuntimeOutput = New-EasySmsTempFile -Prefix "unused-runtime" -Extension ".yaml"
$summaryRuntimeEnvOutput = New-EasySmsTempFile -Prefix "unused-env" -Extension ".env"
$summaryUserscriptOutput = New-EasySmsTempFile -Prefix "unused-userscript" -Extension ".json"
try {
    & $render `
        -ConfigPath $summaryConfigPath `
        -RuntimeOutputPath $summaryRuntimeOutput `
        -RuntimeEnvOutputPath $summaryRuntimeEnvOutput `
        -SummaryOutputPath $summaryOutput `
        -UserscriptOverridesOutputPath $summaryUserscriptOutput | Out-Null
    $summary = Get-Content -Raw -LiteralPath $summaryOutput | ConvertFrom-Json
} finally {
    Remove-Item -LiteralPath $summaryOutput -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $summaryRuntimeOutput -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $summaryRuntimeEnvOutput -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $summaryUserscriptOutput -ErrorAction SilentlyContinue
}

$resolvedImage = if ([string]::IsNullOrWhiteSpace($Image)) { [string]$summary.serviceBase.image } else { $Image }
$resolvedHostPort = if ($HostPort -gt 0) {
    $HostPort
} elseif (-not [string]::IsNullOrWhiteSpace($InstanceName)) {
    18082
} elseif ($summary.serviceBase.hostPort) {
    [int]$summary.serviceBase.hostPort
} else {
    18081
}
$derivedContainerName = if (-not [string]::IsNullOrWhiteSpace($InstanceName)) {
    "easy-sms-$InstanceName"
} elseif ($summary.serviceBase.containerName) {
    [string]$summary.serviceBase.containerName
} else {
    "easy-sms"
}
$resolvedContainerName = Get-DefaultInstanceValue -ExplicitValue $ContainerName -DerivedValue $derivedContainerName
$resolvedComposeProjectName = if (-not [string]::IsNullOrWhiteSpace($ComposeProjectName)) {
    $ComposeProjectName
} elseif (-not [string]::IsNullOrWhiteSpace($InstanceName)) {
    "easy-sms-$InstanceName"
} else {
    "easy-sms"
}

if ($Pull -and -not [string]::IsNullOrWhiteSpace($resolvedImage)) {
    Write-Host "Pulling service image: $resolvedImage" -ForegroundColor Cyan
    & docker pull $resolvedImage
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to pull docker image: $resolvedImage"
    }
}

if (-not [string]::IsNullOrWhiteSpace($resolvedImage)) {
    $env:EASY_SMS_IMAGE = $resolvedImage
}
$env:EASY_SMS_CONTAINER_NAME = $resolvedContainerName
$env:EASY_SMS_HOST_PORT = [string]$resolvedHostPort
$env:EASY_SMS_ENV_FILE = $envFilePath
$env:EASY_SMS_CONFIG_DIR = $configMountPath
$env:EASY_SMS_DATA_DIR = $dataMountPath
$env:EASY_SMS_NETWORK = $NetworkName
$env:EASY_SMS_NETWORK_ALIAS = $NetworkAlias

Ensure-DockerNetwork -Name $NetworkName

$args = @("compose", "-p", $resolvedComposeProjectName, "-f", $composeFile, "up", "-d")
if (-not $NoBuild) {
    $args += "--build"
}

Write-Host "Starting service/base via docker compose..." -ForegroundColor Cyan
& docker @args
if ($LASTEXITCODE -ne 0) {
    throw "docker compose failed with exit code $LASTEXITCODE"
}

Write-Host "Service/base deployment finished."
Write-Host ("Container name: " + $resolvedContainerName)
Write-Host ("Base URL: http://127.0.0.1:{0}" -f $resolvedHostPort)
Write-Host ("Network alias: " + $NetworkAlias)
