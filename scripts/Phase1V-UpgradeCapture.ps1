# Internal manual-acceptance helper. Never opens the source through SQLite.
param(
  [Parameter(Mandatory = $true)][string]$SourceDatabase,
  [Parameter(Mandatory = $true)][string]$SourceSecret,
  [Parameter(Mandatory = $true)][string]$CaptureDirectory
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$handles = [ordered]@{}
$paths = [ordered]@{
  database = $SourceDatabase
  wal = "$SourceDatabase-wal"
  shm = "$SourceDatabase-shm"
  journal = "$SourceDatabase-journal"
  secret = $SourceSecret
}
$names = @{ database = 'edge.db'; wal = 'edge.db-wal'; shm = 'edge.db-shm'; journal = 'edge.db-journal' }
$code = 'UPGRADE_LAB_CAPTURE_FAILED'
function Get-StreamHash([IO.Stream]$Stream) {
  $Stream.Position = 0
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash($Stream)).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose(); $Stream.Position = 0 }
}
try {
  # This capture protocol depends on local Windows mandatory sharing semantics.
  # Reject remote/removable filesystems rather than assuming equivalent locks.
  foreach ($path in @($SourceDatabase, $SourceSecret, $CaptureDirectory)) {
    if (-not [IO.Path]::IsPathRooted($path) -or $path.StartsWith('\\')) { throw 'unsafe path' }
    $drive = [IO.DriveInfo]::new([IO.Path]::GetPathRoot($path))
    if ($drive.DriveType -ne 'Fixed' -or $drive.DriveFormat -ne 'NTFS') { throw 'unsupported filesystem' }
  }
  if (@(Get-ChildItem -LiteralPath $CaptureDirectory -Force).Count -ne 0) { throw 'capture exists' }
  $code = 'UPGRADE_LAB_SOURCE_IN_USE'
  # Acquire DB FIRST: this excludes existing/new SQLite clients. Acquire sidecars
  # before reading any bytes. Read access only; never create absent source files.
  foreach ($key in $paths.Keys) {
    $path = $paths[$key]
    if ($key -eq 'database' -or $key -eq 'secret' -or [IO.File]::Exists($path)) {
      $handles[$key] = [IO.File]::Open($path, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
    }
  }
  $code = 'UPGRADE_LAB_CAPTURE_FAILED'
  if ($handles.Contains('journal') -and $handles['journal'].Length -gt 0) {
    $code = 'UPGRADE_LAB_SOURCE_ROLLBACK_JOURNAL'
    throw 'rollback journal is outside this WAL capture protocol'
  }
  $hashes = [ordered]@{}
  foreach ($key in $paths.Keys) {
    if (-not $handles.Contains($key)) { $hashes[$key] = $null; continue }
    $inputStream = $handles[$key]
    $hashes[$key] = Get-StreamHash $inputStream
    if ($key -ne 'secret') {
      $target = Join-Path $CaptureDirectory $names[$key]
      $outputStream = [IO.File]::Open($target, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
      try {
        $inputStream.CopyTo($outputStream)
        $outputStream.Flush($true)
        if ((Get-StreamHash $outputStream) -ne $hashes[$key]) { throw 'capture hash mismatch' }
      } finally { $outputStream.Dispose() }
    }
    if ((Get-StreamHash $inputStream) -ne $hashes[$key]) { throw 'source changed' }
  }
  foreach ($key in $paths.Keys) {
    if ([IO.File]::Exists($paths[$key]) -ne $handles.Contains($key)) { throw 'source file set changed' }
  }
  $evidence = @{ version = 1; method = 'WINDOWS_EXCLUSIVE_READ_CAPTURE'; hashes = $hashes } | ConvertTo-Json -Depth 4
  $evidenceStream = [IO.File]::Open((Join-Path $CaptureDirectory 'capture.json'), [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes($evidence)
    $evidenceStream.Write($bytes, 0, $bytes.Length)
    $evidenceStream.Flush($true)
  } finally { $evidenceStream.Dispose() }
} catch {
  # Do not print paths, credentials, exception details or automatically retry.
  Write-Output $code
  exit 1
} finally {
  foreach ($handle in $handles.Values) { $handle.Dispose() }
}
