param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Prepare', 'Status', 'LoadEdge', 'LoadRecoveryEdge', 'Checkpoint', 'RestoreCheckpoint', 'SimulateMissing', 'SimulateCorrupt', 'LatestArtifact', 'TamperLatest', 'CopyWrongKey', 'Cleanup')]
  [string]$Action,
  [ValidatePattern('^[a-z0-9][a-z0-9-]{0,31}$')]
  [string]$Environment = 'restaurant-acceptance'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$acceptanceRoot = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'ComanView\RecoveryAcceptance'))
$labRoot = [IO.Path]::GetFullPath((Join-Path $acceptanceRoot 'phase-1v'))
$settingsPath = [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA "ComanView\Development\$Environment\settings.json"))
$helperArguments = @(
  '--acceptance-root', $acceptanceRoot,
  '--lab-root', $labRoot
)

function Assert-EdgeStopped {
  $listener = Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue
  if ($listener) {
    throw "Edge is listening on port 3000. Stop it before running '$Action'."
  }
}

function Invoke-LabHelper([string]$HelperAction, [string[]]$AdditionalArguments = @()) {
  Push-Location $repoRoot
  try {
    & pnpm --filter '@comanview/database' exec node --import tsx `
      src/edge/recoveryAcceptanceLabCli.ts `
      --action $HelperAction `
      @helperArguments `
      @AdditionalArguments
    if ($LASTEXITCODE -ne 0) {
      throw "Phase 1V recovery laboratory helper failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

function Invoke-SecurityFloorHelper([string]$HelperAction) {
  $runtimeRoot = Join-Path $labRoot 'runtime'
  Push-Location $repoRoot
  try {
    & pnpm --filter '@comanview/edge' exec node --import tsx `
      src/recoveryAcceptanceLabCli.ts `
      --action $HelperAction `
      --lab-root $labRoot `
      --database (Join-Path $runtimeRoot 'edge.db') `
      --security-path (Join-Path $runtimeRoot 'security-floor.bin')
    if ($LASTEXITCODE -ne 0) {
      throw "Phase 1V security-floor helper failed with exit code $LASTEXITCODE."
    }
  } finally {
    Pop-Location
  }
}

function Set-IsolatedEdgeEnvironment {
  . (Join-Path $PSScriptRoot 'Load-1UDevelopmentEnvironment.ps1') -Environment $Environment -Target Edge
  $runtimeRoot = Join-Path $labRoot 'runtime'
  $env:COMANVIEW_EDGE_DB_PATH = Join-Path $runtimeRoot 'edge.db'
  $env:COMANVIEW_EDGE_SECRET_PATH = Join-Path $runtimeRoot 'edge-secret.json'
  $env:COMANVIEW_RECOVERY_SECURITY_STORE = 'windows-dpapi'
  $env:COMANVIEW_RECOVERY_SECURITY_PATH = Join-Path $runtimeRoot 'security-floor.bin'
  $env:COMANVIEW_BACKUP_LOCAL_DIR = Join-Path $runtimeRoot 'backups-local'
  $env:COMANVIEW_EDGE_SCHEMA_VERSION = '14'
  $env:COMANVIEW_SYNC_ENABLED = 'false'
  Write-Host "ISOLATED_RUNTIME = true"
  Write-Host "RUNTIME_DB = $($env:COMANVIEW_EDGE_DB_PATH)"
  Write-Host "SYNC_ENABLED = false"
  Write-Host 'Environment loaded. Start Edge with: pnpm --filter @comanview/edge dev'
}

if ($Action -eq 'Prepare') {
  Assert-EdgeStopped
  if (!(Test-Path -LiteralPath $settingsPath -PathType Leaf)) {
    throw "Missing development settings at $settingsPath."
  }
  try {
    $null = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
  } catch {
    throw "Development settings are not valid JSON: $settingsPath"
  }
  New-Item -ItemType Directory -Path $acceptanceRoot -Force | Out-Null
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  & icacls $acceptanceRoot /inheritance:r /grant:r "${identity}:(OI)(CI)F" | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "Unable to restrict access to the recovery acceptance root (exit code $LASTEXITCODE)."
  }
  try {
    Invoke-LabHelper 'prepare' @('--environment', $Environment, '--settings', $settingsPath)
    Invoke-SecurityFloorHelper 'initialize'
    Invoke-LabHelper 'status'
    Invoke-SecurityFloorHelper 'status'
  } catch {
    Invoke-LabHelper 'cleanup'
    throw
  }
  return
}

if ($Action -eq 'Status') {
  Invoke-LabHelper 'status'
  Invoke-SecurityFloorHelper 'status'
  return
}

if ($Action -eq 'LoadEdge') {
  Assert-EdgeStopped
  Invoke-LabHelper 'status'
  Invoke-SecurityFloorHelper 'status'
  Set-IsolatedEdgeEnvironment
  return
}

if ($Action -eq 'LoadRecoveryEdge') {
  Assert-EdgeStopped
  Invoke-LabHelper 'recovery-status'
  Set-IsolatedEdgeEnvironment
  return
}

if ($Action -eq 'CopyWrongKey') {
  $bytes = New-Object byte[] 32
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
    $wrongKey = [Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    Set-Clipboard -Value $wrongKey
    Write-Host 'A random non-production test key was copied to the clipboard.'
  } finally {
    $generator.Dispose()
    [Array]::Clear($bytes, 0, $bytes.Length)
    Remove-Variable wrongKey -ErrorAction SilentlyContinue
  }
  return
}

if ($Action -in @('Checkpoint', 'RestoreCheckpoint', 'SimulateMissing', 'SimulateCorrupt', 'TamperLatest', 'Cleanup')) {
  Assert-EdgeStopped
}

switch ($Action) {
  'Checkpoint' { Invoke-LabHelper 'checkpoint' }
  'RestoreCheckpoint' { Invoke-LabHelper 'restore-checkpoint' }
  'SimulateMissing' { Invoke-LabHelper 'simulate-missing' }
  'SimulateCorrupt' { Invoke-LabHelper 'simulate-corrupt' }
  'LatestArtifact' { Invoke-LabHelper 'latest-artifact' }
  'TamperLatest' { Invoke-LabHelper 'tamper-latest' }
  'Cleanup' { Invoke-LabHelper 'cleanup' }
}
