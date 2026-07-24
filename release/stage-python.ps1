# Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
#
# See LICENSE for license information.

<#
.SYNOPSIS
  Stage a self-contained Python runtime + the FastAPI server into the Tauri
  resource staging dir, so the MSI can ship a server that runs without any
  system Python.

.DESCRIPTION
  Uses the Windows "embeddable" Python distribution (a minimal, relocatable
  Python). Steps:
    1. Download python-<ver>-embed-amd64.zip and extract to runtime/python.
    2. Enable site-packages (so pip-installed deps load) and add the server dir
       to the path config (so `import app` resolves regardless of install
       location).
    3. Bootstrap pip via get-pip.py, then install src/server/requirements.txt.
    4. Copy the server source (src/server/app) to runtime/server/app.

  The output (src/app/src-tauri/runtime/) is git-ignored and consumed by
  tauri.conf.json's bundle.resources. Re-running cleans and rebuilds it.
#>
[CmdletBinding()]
param(
  # Pin a Python that has an embeddable amd64 build and supports the server deps.
  [string]$PythonVersion = "3.11.9"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"  # faster Invoke-WebRequest

$repoRoot   = Resolve-Path (Join-Path $PSScriptRoot "..")
$runtimeDir = Join-Path $repoRoot "src/app/src-tauri/runtime"
$pythonDir  = Join-Path $runtimeDir "python"
$serverOut  = Join-Path $runtimeDir "server"
$serverSrc  = Join-Path $repoRoot "src/server/app"
$reqFile    = Join-Path $repoRoot "src/server/requirements.txt"

# python311._pth is named from the major+minor with no dot.
$verParts = $PythonVersion.Split(".")
$pthName  = "python$($verParts[0])$($verParts[1])._pth"

Write-Host "[stage-python] staging Python $PythonVersion -> $runtimeDir"

# 1. Clean + download the embeddable zip.
if (Test-Path $runtimeDir) { Remove-Item -Recurse -Force $runtimeDir }
New-Item -ItemType Directory -Force -Path $pythonDir | Out-Null

$embedUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$tmpZip   = Join-Path ([System.IO.Path]::GetTempPath()) "python-$PythonVersion-embed.zip"
Write-Host "[stage-python] downloading $embedUrl"
Invoke-WebRequest -Uri $embedUrl -OutFile $tmpZip -UseBasicParsing
Expand-Archive -Path $tmpZip -DestinationPath $pythonDir -Force
Remove-Item $tmpZip

# 2. Enable site-packages and make `app` importable from the sibling server dir.
#    The default ._pth ships `.` and a commented `# import site`. We uncomment
#    site (so pip's installs load) and add `..\server` (relative -> survives the
#    move from staging to the install's resources/ dir).
$pthPath = Join-Path $pythonDir $pthName
if (-not (Test-Path $pthPath)) { throw "Expected $pthName not found in embeddable Python." }
$pth = Get-Content $pthPath
$pth = $pth -replace "^\s*#\s*import site\s*$", "import site"
if ($pth -notcontains "import site") { $pth += "import site" }
if ($pth -notcontains "..\server")   { $pth += "..\server" }
Set-Content -Path $pthPath -Value $pth -Encoding ascii

$pythonExe = Join-Path $pythonDir "python.exe"

# 3. Bootstrap pip, then install the server's runtime deps into site-packages.
$getPip = Join-Path $pythonDir "get-pip.py"
Write-Host "[stage-python] bootstrapping pip"
Invoke-WebRequest -Uri "https://bootstrap.pypa.io/get-pip.py" -OutFile $getPip -UseBasicParsing
& $pythonExe $getPip --no-warn-script-location
if ($LASTEXITCODE -ne 0) { throw "get-pip.py failed ($LASTEXITCODE)" }
Remove-Item $getPip

Write-Host "[stage-python] installing $reqFile"
& $pythonExe -m pip install --no-warn-script-location -r $reqFile
if ($LASTEXITCODE -ne 0) { throw "pip install failed ($LASTEXITCODE)" }

# 4. Copy the server source next to the runtime. Pre-create the target dir and
#    copy the *contents* (`$serverSrc\*`) into it — this is deterministic, unlike
#    `Copy-Item $dir $dest` whose result depends on whether $dest already exists.
$serverAppOut = Join-Path $serverOut "app"
if (-not (Test-Path $serverSrc)) { throw "Server source not found: $serverSrc" }
New-Item -ItemType Directory -Force -Path $serverAppOut | Out-Null
Copy-Item -Path (Join-Path $serverSrc "*") -Destination $serverAppOut -Recurse -Force
# Drop any compiled caches that may have been copied along.
Get-ChildItem -Path $serverOut -Recurse -Directory -Filter "__pycache__" -ErrorAction SilentlyContinue |
  Remove-Item -Recurse -Force

# 5. Verify the staged tree has the files the bundle's resource globs expect, so
#    a staging slip fails here with a clear message rather than as an opaque
#    "glob pattern ... didn't match any files" during `tauri build`.
$mustExist = @(
  (Join-Path $pythonDir "python.exe"),
  (Join-Path $serverAppOut "main.py")
)
foreach ($p in $mustExist) {
  if (-not (Test-Path $p)) {
    Write-Host "[stage-python] runtime tree under $runtimeDir :"
    Get-ChildItem -Recurse $runtimeDir | Select-Object -ExpandProperty FullName | Write-Host
    throw "Staging incomplete: expected file missing -> $p"
  }
}

Write-Host "[stage-python] done."
