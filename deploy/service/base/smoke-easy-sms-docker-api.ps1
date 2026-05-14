param(
  [string]$ConfigPath = "config.yaml",
  [string]$BaseUrl = "",
  [string]$ApiKey = "",
  [switch]$Rebuild,
  [string]$Image = "",
  [int]$HostPort = 18081,
  [string]$InstanceName = "",
  [string]$ContainerName = "easy-sms-service",
  [string]$ComposeProjectName = "easysms-service-base-smoke",
  [switch]$Cleanup
)

$repoRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$deployScript = Join-Path $repoRoot "scripts\deploy-service-base.ps1"
$removeScript = Join-Path $repoRoot "scripts\remove-service-base.ps1"

function Get-EasySmsStatusCode {
  param(
    [string]$Uri,
    [hashtable]$Headers = @{}
  )

  $arguments = @("-s", "-o", "NUL", "-w", "%{http_code}")
  foreach ($key in $Headers.Keys) {
    $arguments += @("-H", "${key}: $($Headers[$key])")
  }
  $arguments += $Uri

  $status = & curl.exe @arguments
  $parsed = 0
  if (-not [int]::TryParse([string]$status, [ref]$parsed)) {
    throw "Failed to parse HTTP status code from curl output: $status"
  }
  return $parsed
}

if ([string]::IsNullOrWhiteSpace($BaseUrl)) {
  $BaseUrl = "http://127.0.0.1:$HostPort"
}

try {
  if (-not [string]::IsNullOrWhiteSpace($Image)) {
    & $deployScript `
      -ConfigPath $ConfigPath `
      -Image $Image `
      -HostPort $HostPort `
      -InstanceName $InstanceName `
      -ContainerName $ContainerName `
      -ComposeProjectName $ComposeProjectName
  } else {
    & $deployScript `
      -ConfigPath $ConfigPath `
      -HostPort $HostPort `
      -InstanceName $InstanceName `
      -ContainerName $ContainerName `
      -ComposeProjectName $ComposeProjectName
  }

  $health = $null
  for ($attempt = 1; $attempt -le 20; $attempt++) {
    try {
      $headers = @{}
      if ($ApiKey) {
        $headers["Authorization"] = "Bearer $ApiKey"
      }

      $health = Invoke-RestMethod -Method Get -Uri "$BaseUrl/healthz" -Headers $headers
      break
    } catch {
      Start-Sleep -Seconds 2
    }
  }

  if ($null -eq $health) {
    throw "Service smoke check could not reach $BaseUrl/healthz"
  }

  $headers = @{}
  if ($ApiKey) {
    $headers["Authorization"] = "Bearer $ApiKey"

    $anonymousProtectedStatus = Get-EasySmsStatusCode -Uri "$BaseUrl/sms/catalog"
    if ($anonymousProtectedStatus -ne 401) {
      throw "Expected anonymous access to /sms/catalog to return 401 when ApiKey is configured, but got $anonymousProtectedStatus."
    }

    if ((Get-EasySmsStatusCode -Uri "$BaseUrl/healthz") -ne 200) {
      throw "Expected anonymous access to /healthz to remain public when ApiKey is configured."
    }

    if ((Get-EasySmsStatusCode -Uri "$BaseUrl/openapi.json") -ne 200) {
      throw "Expected anonymous access to /openapi.json to remain public when ApiKey is configured."
    }
  }

  $providers = Invoke-RestMethod -Method Get -Uri "$BaseUrl/providers" -Headers $headers
  $catalog = Invoke-RestMethod -Method Get -Uri "$BaseUrl/sms/catalog" -Headers $headers
  $snapshot = Invoke-RestMethod -Method Get -Uri "$BaseUrl/sms/snapshot" -Headers $headers
  $detailSnapshot = Invoke-RestMethod -Method Get -Uri "$BaseUrl/sms/snapshot?mode=detail" -Headers $headers
  $runtimeQuery = Invoke-RestMethod -Method Get -Uri "$BaseUrl/sms/query/runtime" -Headers $headers
  $sessionPlan = Invoke-RestMethod -Method Post -Uri "$BaseUrl/sms/sessions/plan" -Headers $headers -ContentType "application/json" -Body (@{ countryCode = "+1" } | ConvertTo-Json)
  $providerHealthQuery = Invoke-RestMethod -Method Get -Uri "$BaseUrl/sms/query/providers/health" -Headers $headers
  $providerProbeHistoryQuery = Invoke-RestMethod -Method Get -Uri "$BaseUrl/sms/query/providers/probe-history" -Headers $headers
  $providerSelectionPlanQuery = Invoke-RestMethod -Method Get -Uri "$BaseUrl/sms/query/providers/selection-plan?countryCode=%2B1" -Headers $headers
  $sessionQuery = Invoke-RestMethod -Method Get -Uri "$BaseUrl/sms/query/sessions" -Headers $headers
  $messageQuery = Invoke-RestMethod -Method Get -Uri "$BaseUrl/sms/query/messages" -Headers $headers
  $sessionStats = Invoke-RestMethod -Method Get -Uri "$BaseUrl/sms/query/stats" -Headers $headers
  $freeProviders = Invoke-RestMethod -Method Get -Uri "$BaseUrl/providers?costTier=free" -Headers $headers
  $paidProviders = Invoke-RestMethod -Method Get -Uri "$BaseUrl/providers?costTier=paid" -Headers $headers
  $activationProviders = Invoke-RestMethod -Method Get -Uri "$BaseUrl/providers?capability=create-activation" -Headers $headers
  $openApi = Invoke-RestMethod -Method Get -Uri "$BaseUrl/openapi.json" -Headers $headers
  $facadeCountries = Invoke-RestMethod -Method Get -Uri "$BaseUrl/stubs/handler_api.php?action=getCountries" -Headers $headers
  $facadePrices = Invoke-RestMethod -Method Get -Uri "$BaseUrl/stubs/handler_api.php?action=getPrices&service=otp" -Headers $headers
  $providerHealth = Invoke-RestMethod -Method Get -Uri "$BaseUrl/providers/health" -Headers $headers
  $probeResults = Invoke-RestMethod -Method Post -Uri "$BaseUrl/providers/probe" -Headers $headers
  $numbers = Invoke-RestMethod -Method Get -Uri "$BaseUrl/sms/public-numbers?costTier=free&limit=5" -Headers $headers

  if (-not ($providers.PSObject.Properties.Name -contains "providers")) {
    throw "Provider catalog response did not include a providers array."
  }
  if (-not ($freeProviders.PSObject.Properties.Name -contains "providers")) {
    throw "Free provider catalog response did not include a providers array."
  }
  if (-not ($paidProviders.PSObject.Properties.Name -contains "providers")) {
    throw "Paid provider catalog response did not include a providers array."
  }
  if (-not ($activationProviders.PSObject.Properties.Name -contains "providers")) {
    throw "Activation-capable provider catalog response did not include a providers array."
  }
  if (-not ($catalog.PSObject.Properties.Name -contains "catalog")) {
    throw "Session-centric catalog route did not return a catalog payload."
  }
  if (-not ($snapshot.PSObject.Properties.Name -contains "snapshot")) {
    throw "Session-centric snapshot route did not return a snapshot payload."
  }
  if (-not ($detailSnapshot.PSObject.Properties.Name -contains "snapshot")) {
    throw "Detail snapshot route did not return a snapshot payload."
  }
  if (-not ($runtimeQuery.PSObject.Properties.Name -contains "runtime")) {
    throw "Runtime diagnostics query route did not return a runtime payload."
  }
  if (-not ($sessionPlan.PSObject.Properties.Name -contains "plan")) {
    throw "Session-centric plan route did not return a plan payload."
  }
  if (-not ($providerHealthQuery.PSObject.Properties.Name -contains "summary")) {
    throw "Canonical provider health query route did not return a summary payload."
  }
  if (-not ($providerProbeHistoryQuery.PSObject.Properties.Name -contains "history")) {
    throw "Canonical provider probe history route did not return a history payload."
  }
  if (-not ($providerSelectionPlanQuery.PSObject.Properties.Name -contains "candidates")) {
    throw "Canonical provider selection-plan route did not return a candidates payload."
  }
  if (-not ($sessionQuery.PSObject.Properties.Name -contains "sessions")) {
    throw "Session-centric session query route did not return a sessions payload."
  }
  if (-not ($messageQuery.PSObject.Properties.Name -contains "messages")) {
    throw "Session-centric message query route did not return a messages payload."
  }
  if (-not ($sessionStats.PSObject.Properties.Name -contains "stats")) {
    throw "Session-centric stats route did not return a stats payload."
  }
  if ($openApi.openapi -ne "3.1.0") {
    throw "OpenAPI contract did not return the expected version."
  }
  if (-not ($openApi.paths.PSObject.Properties.Name -contains "/stubs/handler_api.php")) {
    throw "OpenAPI contract did not advertise the compatibility facade."
  }
  if (-not ($openApi.paths.PSObject.Properties.Name -contains "/sms/sessions/open")) {
    throw "OpenAPI contract did not advertise the native session open route."
  }
  if (-not ($openApi.paths.PSObject.Properties.Name -contains "/sms/query/runtime")) {
    throw "OpenAPI contract did not advertise the runtime diagnostics query route."
  }
  if (-not ($openApi.paths.PSObject.Properties.Name -contains "/sms/query/providers/health")) {
    throw "OpenAPI contract did not advertise the canonical provider health query route."
  }
  if (-not ($openApi.paths.PSObject.Properties.Name -contains "/sms/query/providers/probe-history")) {
    throw "OpenAPI contract did not advertise the canonical provider probe history route."
  }
  if (-not ($openApi.paths.PSObject.Properties.Name -contains "/sms/query/providers/selection-plan")) {
    throw "OpenAPI contract did not advertise the canonical provider selection-plan route."
  }
  if ($null -eq $facadeCountries -or $null -eq $facadeCountries.PSObject) {
    throw "Facade getCountries did not return a valid response object."
  }
  if (@($facadeCountries.PSObject.Properties).Count -lt 1) {
    Write-Warning "Facade getCountries returned zero free metadata rows; continuing because upstream free sources can legitimately be empty."
  }
  if ($null -eq $facadePrices -or $null -eq $facadePrices.PSObject) {
    throw "Facade getPrices did not return a valid response object."
  }
  if (-not ($facadePrices.PSObject.Properties.Name -contains "otp")) {
    Write-Warning "Facade getPrices did not return the requested service key; continuing because free metadata can be empty when upstream sources are sparse."
  }

  Write-Host "Health:" ($health | ConvertTo-Json -Depth 4)
  Write-Host "Providers:" ($providers | ConvertTo-Json -Depth 6)
  Write-Host "Session Catalog:" ($catalog | ConvertTo-Json -Depth 6)
  Write-Host "Session Snapshot:" ($snapshot | ConvertTo-Json -Depth 6)
  Write-Host "Detail Session Snapshot:" ($detailSnapshot | ConvertTo-Json -Depth 6)
  Write-Host "Runtime Query:" ($runtimeQuery | ConvertTo-Json -Depth 6)
  Write-Host "Session Plan:" ($sessionPlan | ConvertTo-Json -Depth 6)
  Write-Host "Provider Health Query:" ($providerHealthQuery | ConvertTo-Json -Depth 8)
  Write-Host "Provider Probe History Query:" ($providerProbeHistoryQuery | ConvertTo-Json -Depth 8)
  Write-Host "Provider Selection Plan Query:" ($providerSelectionPlanQuery | ConvertTo-Json -Depth 8)
  Write-Host "Session Query:" ($sessionQuery | ConvertTo-Json -Depth 6)
  Write-Host "Message Query:" ($messageQuery | ConvertTo-Json -Depth 6)
  Write-Host "Session Stats:" ($sessionStats | ConvertTo-Json -Depth 6)
  Write-Host "Free Providers:" ($freeProviders | ConvertTo-Json -Depth 6)
  Write-Host "Paid Providers:" ($paidProviders | ConvertTo-Json -Depth 6)
  Write-Host "Activation-Capable Providers:" ($activationProviders | ConvertTo-Json -Depth 6)
  Write-Host "OpenAPI:" ($openApi | ConvertTo-Json -Depth 5)
  Write-Host "Facade Countries:" ($facadeCountries | ConvertTo-Json -Depth 6)
  Write-Host "Facade Prices:" ($facadePrices | ConvertTo-Json -Depth 6)
  Write-Host "Provider Health:" ($providerHealth | ConvertTo-Json -Depth 8)
  Write-Host "Probe Results:" ($probeResults | ConvertTo-Json -Depth 8)
  Write-Host "Public Numbers:" ($numbers | ConvertTo-Json -Depth 6)
} finally {
  if ($Cleanup) {
    & $removeScript -ComposeProjectName $ComposeProjectName
  }
}
