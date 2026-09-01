param(
  [ValidateSet('Cloud', 'Edge', 'Database', 'CloudWorker')]
  [string]$Target,
  [ValidatePattern('^[a-z0-9][a-z0-9-]{0,31}$')]
  [string]$Environment = '1u-clean',
  [switch]$CopyCloudAdminPassword
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$stateRoot = Join-Path $env:LOCALAPPDATA "ComanView\Development\$Environment"
$settingsPath = Join-Path $stateRoot 'settings.json'
$adminPasswordPath = Join-Path $stateRoot 'cloud-admin-password.dpapi'
$privateKeyPath = Join-Path $env:LOCALAPPDATA 'ComanView\dev-licensing-keys\license-private.pkcs8.pem'
$publicKeyPath = Join-Path $env:LOCALAPPDATA 'ComanView\dev-licensing-keys\license-public.spki.pem'
$signingKid = 'dev-1t-current'

if (!(Test-Path -LiteralPath $settingsPath)) {
  throw "Missing 1U development environment settings for '$Environment' at $settingsPath."
}
if ($Target -eq 'Cloud' -and !(Test-Path -LiteralPath $privateKeyPath)) {
  throw 'The development Ed25519 private key is missing from %LOCALAPPDATA%\ComanView\dev-licensing-keys.'
}
if ($Target -eq 'Edge' -and !(Test-Path -LiteralPath $publicKeyPath)) {
  throw 'The development Ed25519 public key is missing from %LOCALAPPDATA%\ComanView\dev-licensing-keys.'
}

$settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
if (!$Target) {
  if (!$CopyCloudAdminPassword) {
    throw 'Specify -Target Cloud, Edge, Database, or CloudWorker.'
  }
}

if ($Target -eq 'Cloud' -or $CopyCloudAdminPassword) {
  if (!(Test-Path -LiteralPath $adminPasswordPath)) {
    throw "Missing DPAPI-protected Cloud Admin password at $adminPasswordPath."
  }
  $secureAdminPassword = (Get-Content -LiteralPath $adminPasswordPath -Raw).Trim() | ConvertTo-SecureString
  $adminPasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureAdminPassword)
  try {
    $adminPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($adminPasswordPointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($adminPasswordPointer)
  }
  if ($CopyCloudAdminPassword) {
    Set-Clipboard -Value $adminPassword
    Write-Host "Cloud Admin email: $($settings.cloudAdminEmail)"
    Write-Host 'Cloud Admin password copied to the Windows clipboard.'
    Remove-Variable adminPassword
    return
  }
}
$env:NODE_ENV = 'development'

if ($Target -ne 'Edge') {
  $postgresPassword = $env:COMANVIEW_DEV_POSTGRES_PASSWORD
  if (!$postgresPassword) {
    $containerEnvironment = docker inspect comanview-cloud-development-postgres-1 `
      --format '{{range .Config.Env}}{{println .}}{{end}}'
    $passwordEntry = $containerEnvironment | Where-Object { $_ -like 'POSTGRES_PASSWORD=*' }
    if (!$passwordEntry) {
      throw 'Set COMANVIEW_DEV_POSTGRES_PASSWORD or start the existing development PostgreSQL container.'
    }
    $postgresPassword = $passwordEntry.Substring('POSTGRES_PASSWORD='.Length)
  }
  $encodedPostgresPassword = [Uri]::EscapeDataString($postgresPassword)
  $env:DATABASE_URL = "postgresql://comanview_dev:$encodedPostgresPassword@127.0.0.1:5432/comanview_dev"
  if ($Target -eq 'Database') {
    # Docker Compose needs the same value to start an existing development container.
    # Keep it in the current process only and never print it.
    $env:COMANVIEW_DEV_POSTGRES_PASSWORD = $postgresPassword
  }
}

if ($Target -eq 'Cloud') {
  $env:COMANVIEW_CLOUD_SIGNING_KID = $signingKid
  $env:COMANVIEW_CLOUD_SIGNING_PRIVATE_KEY_PEM = Get-Content -LiteralPath $privateKeyPath -Raw
  $env:COMANVIEW_CLOUD_DEV_ADMIN_EMAIL = $settings.cloudAdminEmail
  $env:COMANVIEW_CLOUD_DEV_ADMIN_PASSWORD = $adminPassword
  $env:COMANVIEW_CLOUD_DEV_ADMIN_DISPLAY_NAME = 'Cloud Admin 1U Clean'
  $env:COMANVIEW_CLOUD_DEV_ADMIN_ROLE = 'PLATFORM_ADMIN'
  $env:COMANVIEW_CLOUD_DEV_ADMIN_TENANT_IDS = '[]'
}

if ($Target -eq 'Edge') {
  @(
    'COMANVIEW_CLOUD_SIGNING_PRIVATE_KEY_PEM',
    'COMANVIEW_CLOUD_DEV_ADMIN_PASSWORD',
    'DATABASE_URL'
  ) | ForEach-Object { Remove-Item -LiteralPath "Env:$_" -ErrorAction SilentlyContinue }
  # Windows PowerShell 5.1 attaches provider metadata to strings returned by Get-Content.
  # When nested in a hashtable, ConvertTo-Json serializes that enriched value as an object.
  # ReadAllText returns a plain System.String, which is the value shape expected by Node.
  $publicKey = [System.IO.File]::ReadAllText($publicKeyPath)
  $publicKeyringJson = @{ $signingKid = $publicKey } | ConvertTo-Json -Compress
  try {
    $validatedKeyring = $publicKeyringJson | ConvertFrom-Json
    $keyringProperties = @($validatedKeyring.PSObject.Properties)
    $expectedKey = $validatedKeyring.PSObject.Properties[$signingKid]
    if ($keyringProperties.Count -ne 1 -or $null -eq $expectedKey -or
        $expectedKey.Value -isnot [string] -or
        $expectedKey.Value -notmatch '^-----BEGIN PUBLIC KEY-----[\s\S]+-----END PUBLIC KEY-----\s*$') {
      throw 'Unexpected public keyring shape.'
    }
  } catch {
    throw "Unable to create a valid development public keyring for kid '$signingKid'."
  }
  $env:COMANVIEW_EDGE_DB_PATH = $settings.edgeDatabasePath
  $env:COMANVIEW_EDGE_SECRET_STORE = 'development-file'
  $env:COMANVIEW_EDGE_SECRET_PATH = $settings.edgeSecretPath
  $env:COMANVIEW_CLOUD_URL = 'http://127.0.0.1:4000'
  $env:COMANVIEW_SYNC_ENABLED = 'true'
  $env:COMANVIEW_LICENSE_ENFORCEMENT_ENABLED = 'true'
  $env:COMANVIEW_LICENSE_PUBLIC_KEYRING = $publicKeyringJson
  $env:COMANVIEW_CONTROL_PULL_INTERVAL_MS = '5000'
  $env:COMANVIEW_HEARTBEAT_INTERVAL_MS = '30000'
  $env:COMANVIEW_EDGE_SCHEMA_VERSION = '13'
  Remove-Variable publicKey, publicKeyringJson, validatedKeyring, keyringProperties, expectedKey
}

Remove-Variable adminPassword, postgresPassword, encodedPostgresPassword -ErrorAction SilentlyContinue
Write-Host "Loaded the secret-safe 1U development environment '$Environment' for $Target."
