param([Parameter(Mandatory=$true)][string]$Path,[switch]$AsJson)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$directory = [IO.Path]::GetFullPath((Join-Path $workspace '.private-backups'))
$resolved = (Resolve-Path -LiteralPath $Path).Path
if (-not $resolved.StartsWith($directory + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) { throw 'Expected an ignored private backup in this workspace.' }
$manifestPath = [IO.Path]::ChangeExtension($resolved,'manifest.json')
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ((Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifest.sha256) { throw 'Ciphertext checksum mismatch.' }
$entropy = [Text.Encoding]::UTF8.GetBytes('hospital-moviles-planning-backup-v1')
$plain = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($resolved),$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser)
$sha = [Security.Cryptography.SHA256]::Create()
if ([BitConverter]::ToString($sha.ComputeHash($plain)).Replace('-','').ToLowerInvariant() -ne $manifest.plaintext_sha256) { throw 'Plaintext checksum mismatch.' }
$json = [Text.Encoding]::UTF8.GetString($plain)
$snapshot = $json | ConvertFrom-Json
if ($snapshot.project_ref -ne 'uvebpsbbwofthucghccc') { throw 'Unexpected project.' }
if ($AsJson) { $json } else {
 [pscustomobject]@{ verified=$true; project_ref=$snapshot.project_ref; snapshot_utc=$snapshot.snapshot_utc; baseline=$snapshot.baseline } | ConvertTo-Json -Depth 10
}
[Array]::Clear($plain,0,$plain.Length)
