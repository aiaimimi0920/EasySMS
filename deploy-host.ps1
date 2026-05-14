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
    [string]$ComposeProjectName = "",
    [string]$RepoOwner = "aiaimimi0920",
    [string]$RepoName = "EasySms",
    [string]$RepoRef = "main",
    [ValidateSet("branch", "tag")]
    [string]$RepoRefKind = "branch",
    [string]$RepoArchiveUrl = "",
    [string]$RepoCacheRoot = "",
    [switch]$ForceRefreshRepo,
    [switch]$ResolveRepoOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Resolve-AbsolutePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$BaseDir
    )

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $BaseDir $Path))
}

function Test-RepoLayout {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Root,
        [Parameter(Mandatory = $true)]
        [string[]]$RequiredRelativePaths
    )

    foreach ($relativePath in $RequiredRelativePaths) {
        if (-not (Test-Path -LiteralPath (Join-Path $Root $relativePath))) {
            return $false
        }
    }
    return $true
}

function Get-RepoArchiveUrlValue {
    param(
        [string]$Owner,
        [string]$Name,
        [string]$Ref,
        [string]$Kind,
        [string]$ExplicitUrl
    )

    if (-not [string]::IsNullOrWhiteSpace($ExplicitUrl)) {
        return $ExplicitUrl
    }
    if ($Kind -eq "tag") {
        return "https://codeload.github.com/$Owner/$Name/zip/refs/tags/$Ref"
    }
    return "https://codeload.github.com/$Owner/$Name/zip/refs/heads/$Ref"
}

function Ensure-RepoRoot {
    param(
        [Parameter(Mandatory = $true)]
        [string]$LauncherRoot,
        [Parameter(Mandatory = $true)]
        [string]$Owner,
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$Ref,
        [Parameter(Mandatory = $true)]
        [string]$RefKind,
        [Parameter(Mandatory = $true)]
        [string[]]$RequiredRelativePaths,
        [string]$ArchiveUrl = "",
        [string]$CacheRoot = "",
        [switch]$ForceRefresh
    )

    if (Test-RepoLayout -Root $LauncherRoot -RequiredRelativePaths $RequiredRelativePaths) {
        return [pscustomobject]@{
            RepoRoot = $LauncherRoot
            Source = "local"
            ArchiveUrl = $null
        }
    }

    $sanitizedRef = ($Ref -replace '[^A-Za-z0-9._-]', '_')
    $resolvedCacheRoot = if ([string]::IsNullOrWhiteSpace($CacheRoot)) {
        Join-Path $LauncherRoot ".repo-cache\$Name-$RefKind-$sanitizedRef"
    } else {
        Resolve-AbsolutePath -Path $CacheRoot -BaseDir $LauncherRoot
    }
    $archiveUrlValue = Get-RepoArchiveUrlValue -Owner $Owner -Name $Name -Ref $Ref -Kind $RefKind -ExplicitUrl $ArchiveUrl
    $repoRoot = Join-Path $resolvedCacheRoot "repo"

    if ($ForceRefresh -and (Test-Path -LiteralPath $resolvedCacheRoot)) {
        Remove-Item -LiteralPath $resolvedCacheRoot -Recurse -Force
    }

    if (-not (Test-RepoLayout -Root $repoRoot -RequiredRelativePaths $RequiredRelativePaths)) {
        New-Item -ItemType Directory -Force -Path $resolvedCacheRoot | Out-Null
        $archivePath = Join-Path $resolvedCacheRoot "$Name-$sanitizedRef.zip"
        $expandedRoot = Join-Path $resolvedCacheRoot "expanded"

        Invoke-WebRequest -Uri $archiveUrlValue -OutFile $archivePath
        if (Test-Path -LiteralPath $expandedRoot) {
            Remove-Item -LiteralPath $expandedRoot -Recurse -Force
        }
        Expand-Archive -LiteralPath $archivePath -DestinationPath $expandedRoot -Force

        $childRoots = Get-ChildItem -LiteralPath $expandedRoot -Directory
        if ($childRoots.Count -ne 1) {
            throw "Unexpected archive layout for $archiveUrlValue"
        }

        if (Test-Path -LiteralPath $repoRoot) {
            Remove-Item -LiteralPath $repoRoot -Recurse -Force
        }
        Move-Item -LiteralPath $childRoots[0].FullName -Destination $repoRoot
    }

    if (-not (Test-RepoLayout -Root $repoRoot -RequiredRelativePaths $RequiredRelativePaths)) {
        throw "Resolved repo root is missing required files: $repoRoot"
    }

    return [pscustomobject]@{
        RepoRoot = $repoRoot
        Source = "archive-cache"
        ArchiveUrl = $archiveUrlValue
    }
}

$launcherRoot = Split-Path -Parent $PSCommandPath
$requiredRelativePaths = @(
    "README.md",
    "scripts\deploy-service-base.ps1",
    "deploy\service\base\docker-compose.yaml",
    "config.example.yaml"
)

$repoInfo = Ensure-RepoRoot `
    -LauncherRoot $launcherRoot `
    -Owner $RepoOwner `
    -Name $RepoName `
    -Ref $RepoRef `
    -RefKind $RepoRefKind `
    -RequiredRelativePaths $requiredRelativePaths `
    -ArchiveUrl $RepoArchiveUrl `
    -CacheRoot $RepoCacheRoot `
    -ForceRefresh:$ForceRefreshRepo

if ($ResolveRepoOnly) {
    $repoInfo | Format-List
    exit 0
}

$repoRoot = $repoInfo.RepoRoot
$deployScript = Join-Path $repoRoot "scripts\deploy-service-base.ps1"
$examplePath = Join-Path $repoRoot "config.example.yaml"
$resolvedConfigPath = if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
    Join-Path $repoRoot "config.yaml"
} elseif ([System.IO.Path]::IsPathRooted($ConfigPath)) {
    [System.IO.Path]::GetFullPath($ConfigPath)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $ConfigPath))
}

if (
    [string]::IsNullOrWhiteSpace($ImportCode) `
    -and [string]::IsNullOrWhiteSpace($BootstrapFile) `
    -and -not (Test-Path -LiteralPath $resolvedConfigPath)
) {
    Copy-Item -LiteralPath $examplePath -Destination $resolvedConfigPath
    Write-Host "[deploy-host] created config from example: $resolvedConfigPath" -ForegroundColor Yellow
}

Write-Host "[deploy-host] invoking scripts/deploy-service-base.ps1" -ForegroundColor Cyan
$args = @(
    "-ConfigPath", $resolvedConfigPath,
    "-Pull:$Pull",
    "-NetworkName", $NetworkName,
    "-NetworkAlias", $NetworkAlias
)
if ($NoBuild) {
    $args += "-NoBuild"
}
if (-not [string]::IsNullOrWhiteSpace($Image)) {
    $args += @("-Image", $Image)
}
if (-not [string]::IsNullOrWhiteSpace($ImportCode)) {
    $args += @("-ImportCode", $ImportCode)
}
if (-not [string]::IsNullOrWhiteSpace($BootstrapFile)) {
    $args += @("-BootstrapFile", $BootstrapFile)
}
if (-not [string]::IsNullOrWhiteSpace($InstanceName)) {
    $args += @("-InstanceName", $InstanceName)
}
if (-not [string]::IsNullOrWhiteSpace($ContainerName)) {
    $args += @("-ContainerName", $ContainerName)
}
if ($HostPort -gt 0) {
    $args += @("-HostPort", $HostPort)
}
if (-not [string]::IsNullOrWhiteSpace($ComposeProjectName)) {
    $args += @("-ComposeProjectName", $ComposeProjectName)
}

& $deployScript @args
