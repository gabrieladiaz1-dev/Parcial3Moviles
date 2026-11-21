param([Parameter(ValueFromPipeline=$true)][string]$SnapshotJson,[string]$InputFile,[string]$Label='planning-before')
process {
  $ErrorActionPreference = 'Stop'
  if ($InputFile) { $SnapshotJson = Get-Content -Raw -LiteralPath $InputFile -Encoding UTF8 }
  if (-not $SnapshotJson) { throw 'No snapshot supplied.' }
  Add-Type -AssemblyName System.Security
  $snapshot = $SnapshotJson | ConvertFrom-Json
  if ($snapshot.project_ref -ne 'uvebpsbbwofthucghccc') { throw 'Unexpected project.' }
  $workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
  $directory = [IO.Path]::GetFullPath((Join-Path $workspace '.private-backups'))
  if (-not $directory.StartsWith($workspace + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid backup directory.' }
  [IO.Directory]::CreateDirectory($directory) | Out-Null
  if ($Label -notmatch '^[a-z0-9-]{1,60}$') { throw 'Invalid backup label.' }
  $name = $Label + '-' + ([DateTimeOffset]$snapshot.snapshot_utc).UtcDateTime.ToString('yyyyMMddTHHmmssZ')
  $destination = Join-Path $directory ($name + '.dpapi')
  if (Test-Path -LiteralPath $destination) { throw 'Backup already exists; do not overwrite.' }
  $bytes = [Text.Encoding]::UTF8.GetBytes($SnapshotJson)
  $entropy = [Text.Encoding]::UTF8.GetBytes('hospital-moviles-planning-backup-v1')
  $cipher = [Security.Cryptography.ProtectedData]::Protect($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  [IO.File]::WriteAllBytes($destination,$cipher)
  $restored = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($destination),$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
  $sha = [Security.Cryptography.SHA256]::Create()
  $originalHash = [BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-','').ToLowerInvariant()
  $restoredHash = [BitConverter]::ToString($sha.ComputeHash($restored)).Replace('-','').ToLowerInvariant()
  if ($originalHash -ne $restoredHash) { throw 'Backup read-back verification failed.' }
  $manifest = [ordered]@{
    project_ref=$snapshot.project_ref; snapshot_utc=$snapshot.snapshot_utc
    file=[IO.Path]::GetFileName($destination); encryption='Windows DPAPI CurrentUser'
    sha256=(Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
    plaintext_sha256=$originalHash; baseline=$snapshot.baseline
    scope=$(if ($snapshot.backup_scope) { $snapshot.backup_scope } else { 'DDL metadata, functions, grants, policies and six affected public tables. No Auth credentials or patient records.' })
    read_back_verified=$true
    proposal_sha256=(Get-FileHash -LiteralPath (Join-Path $workspace 'supabase/proposed_staff_planning.sql') -Algorithm SHA256).Hash.ToLowerInvariant()
  }
  $manifest | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $directory ($name + '.manifest.json')) -Encoding UTF8
  [Array]::Clear($bytes,0,$bytes.Length)
  [Array]::Clear($restored,0,$restored.Length)
  [pscustomobject]@{ backup=$destination; sha256=$manifest.sha256; snapshot_utc=$snapshot.snapshot_utc; verified=$true } | ConvertTo-Json
}
