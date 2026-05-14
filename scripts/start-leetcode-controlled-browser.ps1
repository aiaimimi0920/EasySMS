param(
    [int]$RemoteDebuggingPort = 9224,
    [string]$ProfileDir = ".tmp/leetcode-edge-profile",
    [string]$StartUrl = "https://leetcode.cn/accounts/signup/?next=%2F"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedProfileDir = if ([System.IO.Path]::IsPathRooted($ProfileDir)) {
    $ProfileDir
} else {
    Join-Path $repoRoot $ProfileDir
}

New-Item -ItemType Directory -Force -Path $resolvedProfileDir | Out-Null

$edgePath = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path -LiteralPath $edgePath)) {
    throw "Microsoft Edge was not found at: $edgePath"
}

$arguments = @(
    "--remote-debugging-port=$RemoteDebuggingPort",
    "--user-data-dir=$resolvedProfileDir",
    $StartUrl
)

Start-Process -FilePath $edgePath -ArgumentList $arguments

Write-Host "Started controllable LeetCode browser window."
Write-Host "  URL:    $StartUrl"
Write-Host "  Port:   $RemoteDebuggingPort"
Write-Host "  Profile:$resolvedProfileDir"
