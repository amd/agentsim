<#
.SYNOPSIS
  Build the AgentSim Windows installer (.msi) end to end.

.DESCRIPTION
  Runnable locally and from CI (.github/workflows/release.yml calls this). Steps:
    1. npm ci                      install frontend + tooling deps (clean)
    2. npm run app:icons           regenerate icons/ (git-ignored) from the
                                   tracked assets/icon/dark.png
    3. release/stage-python.ps1    stage the embeddable Python + server source
    4. npm run tauri:build         build the frontend and bundle the .msi
    5. copy the .msi to release/dist/

  Prereqs: Node 20+, Rust (stable, MSVC), and Python on PATH (used by
  `tauri icon` and pip during staging). WebView2 + MSVC build tools as per
  the project README.
#>
[CmdletBinding()]
param(
  [string]$PythonVersion = "3.11.9"
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$distDir  = Join-Path $PSScriptRoot "dist"
$msiDir   = Join-Path $repoRoot "src/app/src-tauri/target/release/bundle/msi"

Push-Location $repoRoot
try {
  Write-Host "[build] npm ci"
  npm ci
  if ($LASTEXITCODE -ne 0) { throw "npm ci failed ($LASTEXITCODE)" }

  Write-Host "[build] generating icons"
  npm run app:icons
  if ($LASTEXITCODE -ne 0) { throw "app:icons failed ($LASTEXITCODE)" }

  Write-Host "[build] staging python runtime"
  & (Join-Path $PSScriptRoot "stage-python.ps1") -PythonVersion $PythonVersion

  Write-Host "[build] tauri build (msi)"
  # Merge the release overlay (msi target + bundled runtime resources) onto the
  # base config. Kept separate so `tauri dev` doesn't require the staged runtime.
  $releaseConf = Join-Path $repoRoot "src/app/src-tauri/tauri.release.conf.json"
  # --verbose surfaces WiX candle/light output so bundling failures are diagnosable.
  npm run tauri:build --workspace src/app -- --verbose --config $releaseConf
  if ($LASTEXITCODE -ne 0) { throw "tauri build failed ($LASTEXITCODE)" }

  # Collect the installer.
  if (Test-Path $distDir) { Remove-Item -Recurse -Force $distDir }
  New-Item -ItemType Directory -Force -Path $distDir | Out-Null
  $msis = Get-ChildItem -Path $msiDir -Filter "*.msi" -ErrorAction SilentlyContinue
  if (-not $msis) { throw "No .msi produced in $msiDir" }
  foreach ($m in $msis) {
    Copy-Item $m.FullName $distDir -Force
    Write-Host "[build] -> $(Join-Path $distDir $m.Name)"
  }
  Write-Host "[build] done."
}
finally {
  Pop-Location
}
