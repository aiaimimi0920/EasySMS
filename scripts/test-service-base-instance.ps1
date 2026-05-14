param(
    [string]$ConfigPath = "config.yaml",
    [string]$ApiKey = "",
    [string]$Image = "",
    [switch]$Rebuild,
    [int]$HostPort = 18082,
    [string]$InstanceName = "",
    [string]$ContainerName = "easy-sms-service-test",
    [string]$ComposeProjectName = "easysms-service-base-test",
    [switch]$Cleanup = $true
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$smokeScript = Join-Path $repoRoot "deploy\service\base\smoke-easy-sms-docker-api.ps1"

function Resolve-EasySmsScriptPath {
    param([string]$PathValue)
    if ([System.IO.Path]::IsPathRooted($PathValue)) {
        return $PathValue
    }
    return Join-Path $repoRoot $PathValue
}

function Get-EasySmsStableHash {
    param([string]$Value)

    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($Value)
        $hashBytes = $sha256.ComputeHash($bytes)
        return ([System.BitConverter]::ToString($hashBytes)).Replace('-', '').ToLowerInvariant().Substring(0, 10)
    } finally {
        $sha256.Dispose()
    }
}

function New-SecuredSmokeConfig {
    param(
        [string]$SourcePath,
        [string]$BearerApiKey
    )

    $tempDir = Join-Path $repoRoot ".tmp\secure-smoke"
    New-Item -ItemType Directory -Force -Path $tempDir | Out-Null
    $targetPath = Join-Path $tempDir "config.secure-smoke.yaml"

    $lines = Get-Content -LiteralPath $SourcePath
    $output = New-Object System.Collections.Generic.List[string]
    $inRuntime = $false
    $runtimeIndent = -1
    $inServer = $false
    $serverIndent = -1
    $apiKeyInserted = $false

    foreach ($line in $lines) {
        $trimmed = $line.Trim()
        $indent = ($line.Length - $line.TrimStart().Length)

        if ($trimmed -eq "runtime:") {
            $inRuntime = $true
            $runtimeIndent = $indent
        } elseif ($inRuntime -and $indent -le $runtimeIndent -and $trimmed -ne "" -and -not $trimmed.StartsWith("#")) {
            $inRuntime = $false
            $inServer = $false
        }

        if ($inRuntime -and $trimmed -eq "server:") {
            $inServer = $true
            $serverIndent = $indent
        } elseif ($inServer -and $indent -le $serverIndent -and $trimmed -ne "" -and -not $trimmed.StartsWith("#")) {
            if (-not $apiKeyInserted) {
                $output.Add((" " * ($serverIndent + 2)) + "apiKey: `"$BearerApiKey`"")
                $apiKeyInserted = $true
            }
            $inServer = $false
        }

        if ($inServer -and ($trimmed -like "apiKey:*" -or $trimmed -like "# apiKey:*")) {
            $output.Add((" " * $indent) + "apiKey: `"$BearerApiKey`"")
            $apiKeyInserted = $true
            continue
        }

        $output.Add($line)

        if ($inServer -and -not $apiKeyInserted -and $trimmed -like "port:*") {
            $output.Add((" " * $indent) + "apiKey: `"$BearerApiKey`"")
            $apiKeyInserted = $true
        }
    }

    if (-not $apiKeyInserted) {
        throw "Failed to inject runtime.server.apiKey into secured smoke config."
    }

    [System.IO.File]::WriteAllLines($targetPath, $output, [System.Text.UTF8Encoding]::new($false))
    return $targetPath
}

$resolvedConfigPath = Resolve-EasySmsScriptPath -PathValue $ConfigPath
$effectiveConfigPath = $resolvedConfigPath
if (-not [string]::IsNullOrWhiteSpace($ApiKey)) {
    $effectiveConfigPath = New-SecuredSmokeConfig -SourcePath $resolvedConfigPath -BearerApiKey $ApiKey
}
$effectiveInstanceName = if (-not [string]::IsNullOrWhiteSpace($InstanceName)) {
    $InstanceName
} else {
    $scope = if (-not [string]::IsNullOrWhiteSpace($ApiKey)) { "secure" } else { "public" }
    $identitySeed = @(
        $ComposeProjectName,
        $scope,
        $resolvedConfigPath,
        $effectiveConfigPath,
        $Image,
        [string]$HostPort
    ) -join "|"
    "$ComposeProjectName-$scope-$(Get-EasySmsStableHash -Value $identitySeed)"
}

& $smokeScript `
    -ConfigPath $effectiveConfigPath `
    -ApiKey $ApiKey `
    -Image $Image `
    -Rebuild:$Rebuild `
    -HostPort $HostPort `
    -InstanceName $effectiveInstanceName `
    -ContainerName $ContainerName `
    -ComposeProjectName $ComposeProjectName `
    -Cleanup:$Cleanup
