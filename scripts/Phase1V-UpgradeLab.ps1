param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Prepare', 'Status', 'Start', 'VerifyFirstStart', 'VerifyRestart')]
  [string]$Action,
  [ValidatePattern('^[a-z0-9][a-z0-9-]{0,31}$')]
  [string]$Environment = 'restaurant-acceptance',
  [ValidatePattern('^phase-1v-upgrade(-[a-z0-9-]{1,32})?$')]
  [string]$LabName = 'phase-1v-upgrade',
  [ValidateSet('development-file', 'windows-dpapi')]
  [string]$SourceSecretStore = 'development-file'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$acceptanceRoot = Join-Path $env:LOCALAPPDATA 'ComanView\RecoveryAcceptance'
$labRoot = Join-Path $acceptanceRoot $LabName
$actions = @{ Prepare = 'prepare'; Status = 'status'; Start = 'start'; VerifyFirstStart = 'verify-first'; VerifyRestart = 'verify-restart' }
$arguments = @('--action', $actions[$Action], '--acceptance-root', $acceptanceRoot, '--lab-root', $labRoot)

if ($Action -eq 'Prepare' -or $Action -eq 'Start') {
  if (Get-NetTCPConnection -State Listen -LocalPort 3000 -ErrorAction SilentlyContinue) {
    throw 'Stop Edge on port 3000 before preparing or starting the isolated upgrade lab.'
  }
}
if ($Action -eq 'Prepare') {
  $settings = Join-Path $env:LOCALAPPDATA "ComanView\Development\$Environment\settings.json"
  $publicKey = Join-Path $env:LOCALAPPDATA 'ComanView\dev-licensing-keys\license-public.spki.pem'
  $arguments += @('--settings', $settings, '--public-key', $publicKey, '--kid', 'dev-1t-current', '--source-store', $SourceSecretStore)
}

# Deliberately do not source Load-1UDevelopmentEnvironment or the previous recovery
# harness. The helper creates a clean CHILD environment; this shell is not pointed
# at the operational DB, and no build/dev:prepare/test command is executed here.
Push-Location (Join-Path $repoRoot 'apps\edge')
try {
  & node --import tsx src/upgradeAcceptanceLabCli.ts @arguments
  if ($LASTEXITCODE -ne 0) { throw "Isolated upgrade laboratory stopped (exit $LASTEXITCODE). Preserve evidence and report ERROR_CODE." }
} finally { Pop-Location }
