[CmdletBinding()]
param(
    [string]$BaseUrl = "http://127.0.0.1:18090",
    [string]$EasySmsApiKey = "",
    [string]$ProviderKey = "onlinesim",
    [string]$NumberId = "",
    [string]$SessionId = "",
    [Parameter(Mandatory = $true)]
    [string]$TwilioAccountSid,
    [Parameter(Mandatory = $true)]
    [string]$TwilioAuthToken,
    [Parameter(Mandatory = $true)]
    [string]$TwilioVerifyServiceSid,
    [int]$PollSeconds = 5,
    [int]$TimeoutSeconds = 120,
    [string]$CustomCode = "",
    [switch]$SkipLookup
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-EasySmsHeaders {
    param([string]$BearerApiKey)

    $headers = @{}
    if (-not [string]::IsNullOrWhiteSpace($BearerApiKey)) {
        $headers["Authorization"] = "Bearer $BearerApiKey"
    }
    return $headers
}

function Convert-ToE164Like {
    param([Parameter(Mandatory = $true)][string]$PhoneNumber)

    $normalized = ($PhoneNumber -replace "[^\d+]", "")
    if (-not $normalized.StartsWith("+")) {
        throw "Phone number is not in E.164-like form after normalization: $PhoneNumber"
    }
    return $normalized
}

function New-RandomVerificationCode {
    return -join ((1..6) | ForEach-Object { Get-Random -Minimum 0 -Maximum 10 })
}

function Invoke-TwilioFormPost {
    param(
        [Parameter(Mandatory = $true)][string]$Uri,
        [Parameter(Mandatory = $true)][hashtable]$Form,
        [Parameter(Mandatory = $true)][string]$AccountSid,
        [Parameter(Mandatory = $true)][string]$AuthToken
    )

    $pair = "{0}:{1}" -f $AccountSid, $AuthToken
    $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
    return Invoke-RestMethod -Method Post -Uri $Uri -Headers @{ Authorization = "Basic $basic" } -Body $Form
}

$headers = Get-EasySmsHeaders -BearerApiKey $EasySmsApiKey

if ([string]::IsNullOrWhiteSpace($CustomCode)) {
    $CustomCode = New-RandomVerificationCode
}

$session = $null
if (-not [string]::IsNullOrWhiteSpace($SessionId)) {
    $sessionResponse = Invoke-RestMethod -Method Get -Uri ($BaseUrl.TrimEnd("/") + "/sms/query/sessions/$SessionId") -Headers $headers
    $session = $sessionResponse.session
} else {
    $selectedNumberId = $NumberId
    if ([string]::IsNullOrWhiteSpace($selectedNumberId)) {
        $numbers = Invoke-RestMethod -Method Get -Uri ($BaseUrl.TrimEnd("/") + "/sms/public-numbers?providerKey=$ProviderKey&limit=1") -Headers $headers
        if (-not $numbers.items -or $numbers.items.Count -lt 1) {
            throw "EasySms did not return any public numbers for providerKey=$ProviderKey"
        }
        $selectedNumberId = [string]$numbers.items[0].numberId
    }

    $sessionResponse = Invoke-RestMethod -Method Post -Uri ($BaseUrl.TrimEnd("/") + "/sms/sessions/open") -Headers $headers -ContentType "application/json" -Body (@{
        providerKey = $ProviderKey
        numberId = $selectedNumberId
    } | ConvertTo-Json)
    $session = $sessionResponse.session
}

if ($null -eq $session) {
    throw "Failed to resolve an EasySms session for Twilio verification."
}

$toPhone = Convert-ToE164Like -PhoneNumber ([string]$session.phoneNumber)

$lookupResult = $null
if (-not $SkipLookup) {
    $lookupUri = "https://lookups.twilio.com/v2/PhoneNumbers/$([uri]::EscapeDataString($toPhone))"
    try {
        $pair = "{0}:{1}" -f $TwilioAccountSid, $TwilioAuthToken
        $basic = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes($pair))
        $lookupResult = Invoke-RestMethod -Method Get -Uri $lookupUri -Headers @{ Authorization = "Basic $basic" }
    } catch {
        Write-Warning ("Twilio Lookup request failed: {0}" -f $_.Exception.Message)
    }
}

$verificationUri = "https://verify.twilio.com/v2/Services/$TwilioVerifyServiceSid/Verifications"
$verification = Invoke-TwilioFormPost -Uri $verificationUri -Form @{
    To = $toPhone
    Channel = "sms"
    CustomCode = $CustomCode
} -AccountSid $TwilioAccountSid -AuthToken $TwilioAuthToken

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$matchedMessage = $null
$lastCodeProjection = $null

while ((Get-Date) -lt $deadline) {
    $messagesResponse = Invoke-RestMethod -Method Get -Uri ($BaseUrl.TrimEnd("/") + "/sms/sessions/$($session.id)/messages") -Headers $headers
    $lastCodeProjection = Invoke-RestMethod -Method Get -Uri ($BaseUrl.TrimEnd("/") + "/sms/sessions/$($session.id)/code") -Headers $headers
    $matchedMessage = @($messagesResponse.messages) | Where-Object {
        $_.content -like "*$CustomCode*" -or $_.code -eq $CustomCode
    } | Select-Object -First 1

    if ($matchedMessage) {
        break
    }

    Start-Sleep -Seconds $PollSeconds
}

[pscustomobject]@{
    twilio = [pscustomobject]@{
        accountSid = $TwilioAccountSid
        verifyServiceSid = $TwilioVerifyServiceSid
        verificationSid = $verification.sid
        verificationStatus = $verification.status
        to = $verification.to
        lookup = $lookupResult
    }
    easySms = [pscustomobject]@{
        baseUrl = $BaseUrl
        providerKey = $session.providerKey
        sessionId = $session.id
        phoneNumber = $session.phoneNumber
        normalizedPhoneNumber = $toPhone
        customCode = $CustomCode
        matchedMessage = $matchedMessage
        lastCodeProjection = $lastCodeProjection.code
    }
    success = [bool]($null -ne $matchedMessage)
} | ConvertTo-Json -Depth 8
