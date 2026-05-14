param(
    [string]$ConfigPath = "config.yaml",
    [string]$Image = "",
    [switch]$Rebuild,
    [int]$HostPort = 18087,
    [string]$ContainerName = "easy-sms-service-hero-test",
    [string]$ComposeProjectName = "easysms-hero-provider-test",
    [switch]$Cleanup = $true,
    [string]$Service = "",
    [int]$Country = 0,
    [string]$Operator = "",
    [double]$MaxPrice = 0,
    [ValidateSet("price-first", "success-first", "stock-first", "balanced")]
    [string]$SelectionMode = "",
    [string]$BusinessKey = "",
    [switch]$AllowReuse,
    [int]$MaxBindingsPerPhone = 0,
    [int]$ReuseDemoCount = 1,
    [switch]$CreateActivation,
    [switch]$CancelAfterCreate = $true,
    [int]$WaitBeforeCancelSeconds = 0
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$renderScript = Join-Path $PSScriptRoot "render-derived-configs.ps1"
$deployScript = Join-Path $PSScriptRoot "deploy-service-base.ps1"
$removeScript = Join-Path $PSScriptRoot "remove-service-base.ps1"
$summaryOutputPath = Join-Path $repoRoot ".tmp\hero-sms-test\config-summary.json"
$runtimeOutputPath = Join-Path $repoRoot "deploy\service\base\config\config.yaml"
$userscriptOverridesPath = Join-Path $repoRoot ".tmp\hero-sms-test\userscript-defaults.json"
$baseUrl = "http://127.0.0.1:$HostPort"

& $renderScript `
    -ConfigPath $ConfigPath `
    -RuntimeOutputPath $runtimeOutputPath `
    -SummaryOutputPath $summaryOutputPath `
    -UserscriptOverridesOutputPath $userscriptOverridesPath | Out-Null

$summary = Get-Content -Raw -LiteralPath $summaryOutputPath | ConvertFrom-Json
$heroSms = $summary.serviceBase.runtime.providers.heroSms
if ($null -eq $heroSms) {
    throw "Root config is missing serviceBase.runtime.providers.heroSms."
}
if (-not $heroSms.enabled) {
    throw "HeroSMS provider is disabled in the provided config. Set serviceBase.runtime.providers.heroSms.enabled=true first."
}
if ([string]::IsNullOrWhiteSpace([string]$heroSms.apiKey)) {
    throw "HeroSMS provider is enabled but apiKey is empty in the provided config."
}

$resolvedService = if ([string]::IsNullOrWhiteSpace($Service)) {
    [string]$heroSms.defaultService
} else {
    $Service
}
$resolvedCountry = if ($Country -gt 0) {
    $Country
} else {
    [int]$heroSms.defaultCountry
}

function Get-HttpErrorBody {
    param(
        [Parameter(Mandatory = $true)]
        [System.Exception]$Exception
    )

    $response = $Exception.Response
    if ($null -eq $response) {
        return $null
    }

    try {
        $stream = $response.GetResponseStream()
        if ($null -eq $stream) {
            return $null
        }

        $reader = New-Object System.IO.StreamReader($stream)
        try {
            return $reader.ReadToEnd()
        } finally {
            $reader.Dispose()
            $stream.Dispose()
        }
    } catch {
        return $null
    }
}

function Invoke-ApiJson {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Method,
        [Parameter(Mandatory = $true)]
        [string]$Uri,
        [string]$Body = ""
    )

    $invokeArgs = @{
        Method = $Method
        Uri = $Uri
    }
    if (-not [string]::IsNullOrWhiteSpace($Body)) {
        $invokeArgs["ContentType"] = "application/json"
        $invokeArgs["Body"] = $Body
    }
    try {
        return Invoke-RestMethod @invokeArgs
    } catch {
        $errorBody = Get-HttpErrorBody -Exception $_.Exception
        if (-not [string]::IsNullOrWhiteSpace($errorBody)) {
            throw "API request failed: $Method $Uri`n$errorBody"
        }
        throw
    }
}

try {
    if ($Rebuild -and -not [string]::IsNullOrWhiteSpace($Image)) {
        & (Join-Path $PSScriptRoot "compile-service-base-image.ps1") `
            -ConfigPath $ConfigPath `
            -Image $Image | Out-Null
    }

    if (-not [string]::IsNullOrWhiteSpace($Image)) {
        & $deployScript `
            -ConfigPath $ConfigPath `
            -Image $Image `
            -HostPort $HostPort `
            -ContainerName $ContainerName `
            -ComposeProjectName $ComposeProjectName
    } else {
        & $deployScript `
            -ConfigPath $ConfigPath `
            -HostPort $HostPort `
            -ContainerName $ContainerName `
            -ComposeProjectName $ComposeProjectName
    }

    $healthy = $false
    for ($attempt = 1; $attempt -le 20; $attempt++) {
        try {
            $null = Invoke-ApiJson -Method Get -Uri "$baseUrl/healthz"
            $healthy = $true
            break
        } catch {
            Start-Sleep -Seconds 2
        }
    }
    if (-not $healthy) {
        throw "HeroSMS smoke target did not become healthy at $baseUrl/healthz"
    }

    $paidProviders = Invoke-ApiJson -Method Get -Uri "$baseUrl/providers?costTier=paid"
    $activationProviders = Invoke-ApiJson -Method Get -Uri "$baseUrl/providers?capability=create-activation"
    $countries = Invoke-ApiJson -Method Get -Uri "$baseUrl/providers/hero_sms/countries"
    $topCountries = Invoke-ApiJson -Method Get -Uri "$baseUrl/providers/hero_sms/top-countries?service=$([uri]::EscapeDataString($resolvedService))"
    $operators = Invoke-ApiJson -Method Get -Uri "$baseUrl/providers/hero_sms/operators?service=$([uri]::EscapeDataString($resolvedService))&country=$resolvedCountry"

    if (-not ($paidProviders.PSObject.Properties.Name -contains "providers")) {
        throw "Paid provider catalog response did not include a providers array."
    }
    if (-not ($activationProviders.PSObject.Properties.Name -contains "providers")) {
        throw "Activation-capable provider catalog response did not include a providers array."
    }
    if (-not ($countries.PSObject.Properties.Name -contains "items")) {
        throw "HeroSMS countries response did not include an items array."
    }
    if (-not ($topCountries.PSObject.Properties.Name -contains "items")) {
        throw "HeroSMS top-countries response did not include an items array."
    }
    if (-not ($operators.PSObject.Properties.Name -contains "items")) {
        throw "HeroSMS operators response did not include an items array."
    }

    Write-Host "Paid Providers:" ($paidProviders | ConvertTo-Json -Depth 8)
    Write-Host "Activation-Capable Providers:" ($activationProviders | ConvertTo-Json -Depth 8)
    Write-Host "HeroSMS Countries:" ($countries | ConvertTo-Json -Depth 8)
    Write-Host "HeroSMS Top Countries:" ($topCountries | ConvertTo-Json -Depth 8)
    Write-Host "HeroSMS Operators:" ($operators | ConvertTo-Json -Depth 8)

    if ($CreateActivation) {
        $body = @{
            providerKey = "hero_sms"
            service = $resolvedService
            country = $resolvedCountry
        }
        if (-not [string]::IsNullOrWhiteSpace($Operator)) {
            $body["operator"] = $Operator
        }
        if ($MaxPrice -gt 0) {
            $body["maxPrice"] = $MaxPrice
        }
        if (-not [string]::IsNullOrWhiteSpace($SelectionMode)) {
            $body["selectionMode"] = $SelectionMode
        }
        if (-not [string]::IsNullOrWhiteSpace($BusinessKey)) {
            $body["businessKey"] = $BusinessKey
        }
        if ($AllowReuse) {
            $body["allowReuse"] = $true
        }
        if ($MaxBindingsPerPhone -gt 0) {
            $body["maxBindingsPerPhone"] = $MaxBindingsPerPhone
        }

        $activationRuns = @()
        $runCount = [Math]::Max(1, $ReuseDemoCount)
        for ($run = 1; $run -le $runCount; $run++) {
            $activation = Invoke-ApiJson `
                -Method Post `
                -Uri "$baseUrl/sms/activations" `
                -Body ($body | ConvertTo-Json)

            Write-Host "HeroSMS Activation #${run}:" ($activation | ConvertTo-Json -Depth 8)
            $activationRuns += $activation

            $activationId = [int]$activation.activation.activationId
            $status = Invoke-ApiJson `
                -Method Get `
                -Uri "$baseUrl/sms/activations/$activationId/status?providerKey=hero_sms"
            Write-Host "HeroSMS Activation Status #${run}:" ($status | ConvertTo-Json -Depth 8)
        }

        if ($runCount -gt 1) {
            $upstreamIds = @($activationRuns | ForEach-Object { [string]$_.activation.upstreamActivationId } | Select-Object -Unique)
            Write-Host "HeroSMS Reuse Demo Upstream Activation IDs:" ($upstreamIds | ConvertTo-Json -Depth 4)
            if ($AllowReuse -and $upstreamIds.Count -ne 1) {
                throw "Reuse demo expected one shared upstreamActivationId, but got: $($upstreamIds -join ', ')"
            }
        }

        if ($CancelAfterCreate) {
            if ($WaitBeforeCancelSeconds -gt 0) {
                Write-Host "Waiting $WaitBeforeCancelSeconds seconds before cancelling HeroSMS activation to preserve the refundable cancellation window..."
                Start-Sleep -Seconds $WaitBeforeCancelSeconds
            }
            $cancelActivationId = [int]$activationRuns[-1].activation.activationId
            $cancelBody = @{
                providerKey = "hero_sms"
                action = "cancel"
            } | ConvertTo-Json
            $cancelResult = Invoke-ApiJson `
                -Method Post `
                -Uri "$baseUrl/sms/activations/$cancelActivationId/actions" `
                -Body $cancelBody
            Write-Host "HeroSMS Activation Cancel:" ($cancelResult | ConvertTo-Json -Depth 8)
        }
    }
} finally {
    if ($Cleanup) {
        & $removeScript -ComposeProjectName $ComposeProjectName
    }
}
