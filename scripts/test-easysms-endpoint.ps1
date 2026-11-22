param(
    [Parameter(Mandatory = $true)]
    [string]$BaseUrl,
    [Parameter(Mandatory = $true)]
    [string]$ApiKey
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$trimmedBase = $BaseUrl.TrimEnd("/")
$authHeaders = @{ Authorization = "Bearer $ApiKey" }

Write-Host "Checking public healthz: $trimmedBase/healthz"
$health = Invoke-RestMethod -Method Get -Uri "$trimmedBase/healthz"
if ($health.status -ne "ok") {
    throw "Endpoint /healthz reported unexpected status: $($health.status)"
}

Write-Host "Checking public OpenAPI: $trimmedBase/openapi.json"
$openapi = Invoke-RestMethod -Method Get -Uri "$trimmedBase/openapi.json"
if ($openapi.openapi -ne "3.1.0") {
    throw "Unexpected OpenAPI version: $($openapi.openapi)"
}

Write-Host "Checking unauthenticated protection on /sms/catalog..."
$unauthCode = 0
try {
    $req = [System.Net.WebRequest]::Create("$trimmedBase/sms/catalog")
    $req.Method = "GET"
    $resp = [System.Net.HttpWebResponse]$req.GetResponse()
    $unauthCode = [int]$resp.StatusCode
    $resp.Close()
} catch [System.Net.WebException] {
    if ($_.Exception.Response) {
        $unauthCode = [int]([System.Net.HttpWebResponse]$_.Exception.Response).StatusCode
    } else {
        throw
    }
}
if ($unauthCode -ne 401) {
    throw "Expected HTTP 401 without Bearer token, got $unauthCode"
}

Write-Host "Checking authenticated /sms/catalog and /sms/query/stats..."
$catalog = Invoke-RestMethod -Method Get -Uri "$trimmedBase/sms/catalog" -Headers $authHeaders
$stats = Invoke-RestMethod -Method Get -Uri "$trimmedBase/sms/query/stats" -Headers $authHeaders

[pscustomobject]@{
    BaseUrl = $trimmedBase
    HealthStatus = $health.status
    ProviderCount = @($catalog.catalog.providers).Count
    SessionCount = $stats.stats.sessionCount
} | Format-List
