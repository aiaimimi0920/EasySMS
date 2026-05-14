param(
    [string]$WorkflowPath = ".github/workflows/publish-service-base-ghcr.yml"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$resolvedWorkflowPath = if ([System.IO.Path]::IsPathRooted($WorkflowPath)) {
    [System.IO.Path]::GetFullPath($WorkflowPath)
} else {
    [System.IO.Path]::GetFullPath((Join-Path $repoRoot $WorkflowPath))
}

if (-not (Test-Path -LiteralPath $resolvedWorkflowPath)) {
    throw "Workflow file not found: $resolvedWorkflowPath"
}

$content = Get-Content -LiteralPath $resolvedWorkflowPath -Raw
[regex]::Matches($content, 'secrets\.([A-Z0-9_]+)') |
    ForEach-Object { $_.Groups[1].Value } |
    Sort-Object -Unique
