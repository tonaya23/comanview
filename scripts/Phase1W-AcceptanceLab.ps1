param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Create', 'Start', 'Status', 'Stop', 'Destroy', 'CopyCloudPassword', 'CloudOff', 'VerifyOwner')]
  [string]$Action,
  [ValidatePattern('^phase-1w-[a-z0-9][a-z0-9-]{0,31}$')]
  [string]$LabName = 'phase-1w-manual'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$acceptanceRoot = Join-Path $env:LOCALAPPDATA 'ComanView\ManualAcceptance\phase-1w'
$labRoot = Join-Path $acceptanceRoot $LabName
$actions = @{ Create='create'; Start='start'; Status='status'; Stop='stop'; Destroy='destroy'; CopyCloudPassword='copy-cloud-password'; CloudOff='cloud-off'; VerifyOwner='verify-owner' }

if ($Action -eq 'Create') {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker is required to create the isolated 1W lab.' }
  Push-Location $repoRoot
  try {
    pnpm --filter '@comanview/edge...' --filter '@comanview/cloud-api...' --filter '@comanview/pos...' --filter '@comanview/waiter...' --filter '@comanview/kds...' --filter '@comanview/super-admin...' build
    if ($LASTEXITCODE -ne 0) { throw 'Focused workspace build required by the acceptance harness failed.' }
  } finally { Pop-Location }
}

# Never dot-source a previous environment. The helper receives only the new root;
# credentials remain DPAPI-protected and every child gets a freshly composed env.
Push-Location (Join-Path $repoRoot 'apps\edge')
try {
  & node --import tsx src/phase1wAcceptanceLabCli.ts --action $actions[$Action] --acceptance-root $acceptanceRoot --lab-root $labRoot
  if ($LASTEXITCODE -ne 0) { throw "Isolated 1W acceptance laboratory stopped (exit $LASTEXITCODE). Preserve evidence and report ERROR_CODE." }
} finally { Pop-Location }
