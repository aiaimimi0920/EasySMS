param(
    [Parameter(Mandatory = $true)]
    [long]$RunId,
    [string]$ReleaseTag = '',
    [string]$RepoOwner = 'aiaimimi0920',
    [string]$RepoName = 'EasySMS',
    [string]$ArtifactName = 'service-base-import-code-encrypted',
    [string]$PrivateKeyPath = '',
    [string]$GitHubToken = '',
    [string]$Image = '',
    [int]$HostPort = 18139,
    [string]$WorkRoot = '',
    [string]$DeployHostSourcePath = '',
    [string]$InstanceName = '',
    [string]$ContainerName = '',
    [string]$ComposeProjectName = '',
    [switch]$KeepInstance,
    [switch]$KeepWorkRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib/easysms-config.ps1')

function Resolve-OptionalPath {
    param([string]$PathValue)

    if ([string]::IsNullOrWhiteSpace($PathValue)) {
        return ''
    }
    return Resolve-EasySmsPath -Path $PathValue
}

function Get-EffectiveGitHubToken {
    param([string]$ExplicitToken)

    foreach ($candidate in @(
        $ExplicitToken,
        $env:GITHUB_TOKEN,
        $env:GH_TOKEN
    )) {
        if (-not [string]::IsNullOrWhiteSpace($candidate)) {
            return $candidate
        }
    }

    throw 'GitHub token is required. Provide -GitHubToken or set GITHUB_TOKEN / GH_TOKEN.'
}

function Invoke-GitHubApiJson {
    param(
        [string]$Uri,
        [string]$Token
    )

    return Invoke-RestMethod -Method Get -Uri $Uri -Headers @{
        Authorization = "Bearer $Token"
        Accept = 'application/vnd.github+json'
        'X-GitHub-Api-Version' = '2022-11-28'
        'User-Agent' = 'codex'
    }
}

function Download-GitHubArtifactZip {
    param(
        [string]$Uri,
        [string]$Token,
        [string]$OutputPath
    )

    $response = $null
    $request = [System.Net.WebRequest]::Create($Uri)
    $request.Method = 'GET'
    $request.Headers['Authorization'] = "Bearer $Token"
    $request.Headers['X-GitHub-Api-Version'] = '2022-11-28'
    $request.Accept = 'application/vnd.github+json'
    $request.UserAgent = 'codex'

    try {
        $response = $request.GetResponse()
    } catch [System.Net.WebException] {
        $response = $_.Exception.Response
    }

    if ($null -eq $response) {
        throw "GitHub artifact endpoint did not return a redirect response: $Uri"
    }

    $location = $response.Headers['Location']
    if ([string]::IsNullOrWhiteSpace($location)) {
        try {
            $outputDir = Split-Path -Parent $OutputPath
            if (-not [string]::IsNullOrWhiteSpace($outputDir)) {
                New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
            }
            $stream = $response.GetResponseStream()
            try {
                $fileStream = [System.IO.File]::Open($OutputPath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
                try {
                    $stream.CopyTo($fileStream)
                } finally {
                    $fileStream.Dispose()
                }
            } finally {
                $stream.Dispose()
            }
            return
        } finally {
            $response.Dispose()
        }
    }

    try {
        Invoke-WebRequest -Uri $location -OutFile $OutputPath | Out-Null
    } finally {
        $response.Dispose()
    }
}

function Assert-SameStringSet {
    param(
        [string[]]$Expected,
        [string[]]$Actual,
        [string]$Description
    )

    $diff = Compare-Object -ReferenceObject @($Expected) -DifferenceObject @($Actual)
    if ($diff) {
        throw "$Description differed. Expected=$($Expected -join ',') Actual=$($Actual -join ',')"
    }
}

$repoRoot = Get-EasySmsRepoRoot
$token = Get-EffectiveGitHubToken -ExplicitToken $GitHubToken
$resolvedPrivateKeyPath = Resolve-OptionalPath -PathValue $PrivateKeyPath
if ([string]::IsNullOrWhiteSpace($resolvedPrivateKeyPath)) {
    throw 'PrivateKeyPath is required. Pass -PrivateKeyPath or extend this script with your preferred secret source.'
}

$runUri = "https://api.github.com/repos/$RepoOwner/$RepoName/actions/runs/$RunId"
$run = Invoke-GitHubApiJson -Uri $runUri -Token $token
if ($run.status -ne 'completed' -or $run.conclusion -ne 'success') {
    throw "Workflow run $RunId is not a successful completed run. status=$($run.status) conclusion=$($run.conclusion)"
}

$effectiveReleaseTag = if (-not [string]::IsNullOrWhiteSpace($ReleaseTag)) {
    $ReleaseTag
} else {
    [string]$run.head_branch
}
if ([string]::IsNullOrWhiteSpace($effectiveReleaseTag)) {
    throw "Could not derive a release tag from workflow run $RunId."
}

$effectiveImage = if (-not [string]::IsNullOrWhiteSpace($Image)) {
    $Image
} else {
    "ghcr.io/$($RepoOwner.ToLowerInvariant())/easy-sms-service:$effectiveReleaseTag"
}

$workRoot = if ([string]::IsNullOrWhiteSpace($WorkRoot)) {
    Join-Path $repoRoot ".tmp\blank-host-release-smoke\$RunId"
} else {
    Resolve-EasySmsPath -Path $WorkRoot
}
$deployHostSource = if ([string]::IsNullOrWhiteSpace($DeployHostSourcePath)) {
    Join-Path $repoRoot 'deploy-host.ps1'
} else {
    Resolve-EasySmsPath -Path $DeployHostSourcePath
}

$effectiveInstanceName = if (-not [string]::IsNullOrWhiteSpace($InstanceName)) { $InstanceName } else { "blankhost-smoke-$RunId" }
$effectiveContainerName = if (-not [string]::IsNullOrWhiteSpace($ContainerName)) { $ContainerName } else { "easy-sms-$effectiveInstanceName" }
$effectiveComposeProjectName = if (-not [string]::IsNullOrWhiteSpace($ComposeProjectName)) { $ComposeProjectName } else { "easy-sms-$effectiveInstanceName" }

if (Test-Path -LiteralPath $workRoot) {
    Remove-Item -LiteralPath $workRoot -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $workRoot | Out-Null

$artifactZipPath = Join-Path $workRoot "$ArtifactName-$RunId.zip"
$artifactDir = Join-Path $workRoot "$ArtifactName-$RunId"
$importCodePath = Join-Path $workRoot "service-base-import-code.txt"
$deployWorkDir = Join-Path $workRoot 'host'
$deployHostPath = Join-Path $deployWorkDir 'deploy-host.ps1'

try {
    $artifacts = Invoke-GitHubApiJson -Uri "$runUri/artifacts" -Token $token
    $artifact = @($artifacts.artifacts | Where-Object { $_.name -eq $ArtifactName }) | Select-Object -First 1
    if ($null -eq $artifact) {
        throw "Artifact '$ArtifactName' was not found for workflow run $RunId."
    }

    Download-GitHubArtifactZip -Uri "https://api.github.com/repos/$RepoOwner/$RepoName/actions/artifacts/$($artifact.id)/zip" -Token $token -OutputPath $artifactZipPath
    Expand-Archive -LiteralPath $artifactZipPath -DestinationPath $artifactDir -Force

    $encryptedFile = Get-ChildItem -LiteralPath $artifactDir -Filter '*.encrypted.json' -Recurse | Select-Object -First 1
    if ($null -eq $encryptedFile) {
        throw "No encrypted import-code payload was found in $artifactDir."
    }

    & (Join-Path $PSScriptRoot 'decrypt-import-code.ps1') `
        -EncryptedFilePath $encryptedFile.FullName `
        -PrivateKeyPath $resolvedPrivateKeyPath `
        -ImportCodeOnly `
        -OutputPath $importCodePath

    $importCode = (Get-Content -LiteralPath $importCodePath -Raw).Trim()
    if ([string]::IsNullOrWhiteSpace($importCode)) {
        throw 'Decrypted import code was empty.'
    }

    New-Item -ItemType Directory -Force -Path $deployWorkDir | Out-Null
    Copy-Item -LiteralPath $deployHostSource -Destination $deployHostPath -Force

    Push-Location $deployWorkDir
    try {
        & powershell -ExecutionPolicy Bypass -File $deployHostPath `
            -RepoOwner $RepoOwner `
            -RepoName $RepoName `
            -RepoRef $effectiveReleaseTag `
            -RepoRefKind tag `
            -ForceRefreshRepo `
            -Image $effectiveImage `
            -Pull `
            -NoBuild `
            -ImportCode $importCode `
            -HostPort $HostPort `
            -InstanceName $effectiveInstanceName `
            -ContainerName $effectiveContainerName `
            -ComposeProjectName $effectiveComposeProjectName
    } finally {
        Pop-Location
    }

    $baseUrl = "http://127.0.0.1:$HostPort"
    $health = $null
    $providers = $null
    $providerHealth = $null
    $catalog = $null
    for ($attempt = 0; $attempt -lt 36; $attempt++) {
        try {
            $health = Invoke-RestMethod -Method Get -Uri "$baseUrl/healthz" -TimeoutSec 20
            $providers = Invoke-RestMethod -Method Get -Uri "$baseUrl/providers" -TimeoutSec 20
            $providerHealth = Invoke-RestMethod -Method Get -Uri "$baseUrl/providers/health" -TimeoutSec 30
            $catalog = Invoke-RestMethod -Method Get -Uri "$baseUrl/sms/catalog" -TimeoutSec 30
            break
        } catch {
            Start-Sleep -Seconds 5
        }
    }

    if ($null -eq $health -or $null -eq $providers -or $null -eq $providerHealth -or $null -eq $catalog) {
        throw "Blank-host release smoke could not verify $baseUrl within the retry window."
    }

    $providerKeys = @($providers.providers | ForEach-Object { [string]$_.key })
    $providerHealthKeys = @($providerHealth.providers | ForEach-Object { [string]$_.providerKey })
    $catalogKeys = @($catalog.catalog.providers | ForEach-Object { [string]$_.key })

    Assert-SameStringSet -Expected $providerKeys -Actual $providerHealthKeys -Description "/providers vs /providers/health keys"
    Assert-SameStringSet -Expected $providerKeys -Actual $catalogKeys -Description "/providers vs /sms/catalog keys"

    if ([int]$health.providerCount -ne [int]$providerHealth.summary.totalProviders) {
        throw "Provider count mismatch: /healthz=$($health.providerCount) /providers/health=$($providerHealth.summary.totalProviders)"
    }

    if ([int]$health.providerCount -ne $providerKeys.Count) {
        throw "Provider count mismatch: /healthz=$($health.providerCount) /providers=$($providerKeys.Count)"
    }

    [pscustomobject]@{
        runId = $RunId
        releaseTag = $effectiveReleaseTag
        image = $effectiveImage
        hostPort = $HostPort
        composeProjectName = $effectiveComposeProjectName
        providerKeys = $providerKeys
        providerCount = [int]$health.providerCount
        healthSummary = $providerHealth.summary
        workRoot = $workRoot
        artifactZipPath = $artifactZipPath
        encryptedFilePath = $encryptedFile.FullName
        importCodePath = $importCodePath
    } | ConvertTo-Json -Depth 6
}
finally {
    $sanitizedRef = ($effectiveReleaseTag -replace '[^A-Za-z0-9._-]', '_')
    $cachedRepoRoot = Join-Path $deployWorkDir ".repo-cache\$RepoName-tag-$sanitizedRef\repo"
    $removeScript = Join-Path $cachedRepoRoot 'scripts\remove-service-base.ps1'

    if (-not $KeepInstance) {
        if (Test-Path -LiteralPath $removeScript) {
            & powershell -ExecutionPolicy Bypass -File $removeScript -ComposeProjectName $effectiveComposeProjectName
        } else {
            $existingContainerNames = @(& docker ps -a --format '{{.Names}}' 2>$null)
            if ($existingContainerNames -contains $effectiveContainerName) {
                & docker rm -f $effectiveContainerName *> $null
            }
        }
    }

    if (-not $KeepWorkRoot -and (Test-Path -LiteralPath $workRoot)) {
        Remove-Item -LiteralPath $workRoot -Recurse -Force
    }
}
