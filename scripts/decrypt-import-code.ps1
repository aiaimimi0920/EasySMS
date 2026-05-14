param(
    [string]$EncryptedFilePath,
    [string]$PrivateKeyPath,
    [switch]$ImportCodeOnly,
    [string]$OutputPath = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'lib/easysms-config.ps1')

if ([string]::IsNullOrWhiteSpace($EncryptedFilePath)) {
    throw 'EncryptedFilePath is required.'
}
if ([string]::IsNullOrWhiteSpace($PrivateKeyPath)) {
    throw 'PrivateKeyPath is required.'
}

$resolvedEncryptedFilePath = Resolve-EasySmsPath -Path $EncryptedFilePath
$resolvedPrivateKeyPath = Resolve-EasySmsPath -Path $PrivateKeyPath
$resolvedOutputPath = if ([string]::IsNullOrWhiteSpace($OutputPath)) { '' } else { Resolve-EasySmsPath -Path $OutputPath }

Assert-EasySmsPythonModule -ModuleName 'nacl' -PackageName 'pynacl'

$args = @(
    (Join-Path $PSScriptRoot 'easysms-import-code.py'),
    'decrypt',
    '--encrypted-file', $resolvedEncryptedFilePath,
    '--private-key-file', $resolvedPrivateKeyPath
)
if ($ImportCodeOnly) {
    $args += '--import-code-only'
}
if (-not [string]::IsNullOrWhiteSpace($resolvedOutputPath)) {
    $args += @('--output', $resolvedOutputPath)
}

& python @args
if ($LASTEXITCODE -ne 0) {
    throw "Failed to decrypt import code with exit code $LASTEXITCODE"
}
