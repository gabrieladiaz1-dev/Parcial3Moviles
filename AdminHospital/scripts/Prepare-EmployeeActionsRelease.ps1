param([ValidatePattern('^[A-Za-z0-9-]+$')][string]$ReleaseName = 'employee-status-final-v4')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$releaseRoot = Join-Path $projectRoot ".private-backups/$ReleaseName"
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot 'dist/index.html'))) {
  throw 'Ejecuta npm.cmd run build antes de preparar la entrega.'
}
if (Test-Path -LiteralPath $releaseRoot) {
  throw 'Ya existe el paquete. Usa una carpeta de entrega nueva para conservar su integridad.'
}
$null = New-Item -ItemType Directory -Path (Join-Path $releaseRoot 'frontend') -Force
$null = New-Item -ItemType Directory -Path (Join-Path $releaseRoot 'supabase/functions/manage-employees') -Force
$null = New-Item -ItemType Directory -Path (Join-Path $releaseRoot 'scripts') -Force
$null = New-Item -ItemType Directory -Path (Join-Path $releaseRoot 'docs') -Force
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'dist') | Copy-Item -Destination (Join-Path $releaseRoot 'frontend') -Recurse
foreach ($releaseFile in @('index.ts', 'validation.ts', 'contract.ts')) {
  Copy-Item -LiteralPath (Join-Path $projectRoot "supabase/functions/manage-employees/$releaseFile") -Destination (Join-Path $releaseRoot 'supabase/functions/manage-employees')
}
Copy-Item -LiteralPath (Join-Path $projectRoot 'supabase/config.toml') -Destination (Join-Path $releaseRoot 'supabase/config.toml')
Copy-Item -LiteralPath (Join-Path $projectRoot 'scripts/check-employee-contract.mjs') -Destination (Join-Path $releaseRoot 'scripts')
Copy-Item -LiteralPath (Join-Path $projectRoot 'docs/employee-actions-release.md') -Destination (Join-Path $releaseRoot 'docs')
$releaseFiles = Get-ChildItem -LiteralPath $releaseRoot -Recurse -File | ForEach-Object {
  [ordered]@{ path = $_.FullName.Substring($releaseRoot.Length + 1).Replace('\', '/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$releaseManifest = [ordered]@{
  contract = 'employees-2026-11-status-v3'
  productionDeployed = $false
  remoteContractVerified = $false
  publishedFrontendCompatibilityVerified = $false
  productionRollbackSnapshotIncluded = $false
  files = @($releaseFiles)
}
$releaseManifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $releaseRoot 'manifest.json') -Encoding UTF8
Compress-Archive -Path (Join-Path $releaseRoot '*') -DestinationPath "$releaseRoot.zip"
Write-Output "Paquete preparado en .private-backups/$ReleaseName.zip. Sin despliegue en produccion."
