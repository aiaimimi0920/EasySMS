Set-StrictMode -Version Latest

$script:EasySmsRepoRoot = (Resolve-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))).Path

function Get-EasySmsRepoRoot {
    return $script:EasySmsRepoRoot
}

function Resolve-EasySmsPath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [string]$BaseDir = $script:EasySmsRepoRoot
    )

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $null
    }

    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }

    return [System.IO.Path]::GetFullPath((Join-Path $BaseDir $Path))
}

function Assert-EasySmsPythonModule {
    param(
        [Parameter(Mandatory = $true)]
        [string]$ModuleName,
        [string]$PackageName = ''
    )

    $effectivePackageName = if ([string]::IsNullOrWhiteSpace($PackageName)) {
        $ModuleName
    } else {
        $PackageName
    }

    & python -c "import $ModuleName"
    if ($LASTEXITCODE -eq 0) {
        return
    }

    Write-Host "Installing missing Python module: $effectivePackageName" -ForegroundColor Cyan
    & python -m pip install --disable-pip-version-check $effectivePackageName
    if ($LASTEXITCODE -ne 0) {
        throw "Failed to install required Python module: $effectivePackageName"
    }
}

function New-EasySmsTempFile {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Prefix,
        [Parameter(Mandatory = $true)]
        [string]$Extension
    )

    $fileName = '{0}-{1}{2}' -f $Prefix, ([Guid]::NewGuid().ToString('N')), $Extension
    $path = Join-Path ([System.IO.Path]::GetTempPath()) $fileName
    New-Item -ItemType File -Force -Path $path | Out-Null
    return $path
}

function Test-EasySmsIsWindows {
    return [System.IO.Path]::DirectorySeparatorChar -eq '\'
}

function Resolve-EasySmsLocalNodeTool {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PackageDirectory,
        [Parameter(Mandatory = $true)]
        [string]$ToolName
    )

    $binDir = Join-Path $PackageDirectory "node_modules\.bin"
    if (-not (Test-Path -LiteralPath $binDir)) {
        throw "Missing local node bin directory: $binDir"
    }

    $candidates = if (Test-EasySmsIsWindows) {
        @(
            (Join-Path $binDir "$ToolName.cmd"),
            (Join-Path $binDir "$ToolName.exe"),
            (Join-Path $binDir "$ToolName.ps1"),
            (Join-Path $binDir $ToolName)
        )
    } else {
        @(
            (Join-Path $binDir $ToolName),
            (Join-Path $binDir "$ToolName.cmd")
        )
    }

    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate) {
            return $candidate
        }
    }

    throw "Unable to resolve local node tool '$ToolName' under $PackageDirectory"
}
