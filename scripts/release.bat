REM Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
REM
REM See LICENSE for license information.

@echo off
REM release - cut a Windows release by advancing the `releases` branch to `main`.
REM CI (.github\workflows\release.yml) builds and publishes the .msi on every
REM push to `releases`. The flow is: main is the source of truth; releases is
REM fast-forwarded to it (never committed to directly). See release\README.md.

setlocal
cd /d "%~dp0.."

REM 1. Releases must be reproducible from committed state - refuse if dirty.
set "dirty="
for /f "delims=" %%s in ('git status --porcelain') do set "dirty=1"
if defined dirty (
  echo [release] working tree has uncommitted changes. Commit or stash first:
  git status --short
  exit /b 1
)

REM 2. The release commit is expected on main; releases just points at it.
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "branch=%%b"
if not "%branch%"=="main" (
  echo [release] not on main ^(on %branch%^). Switch to main first: git checkout main
  exit /b 1
)

REM 3. Ask for the version to publish. CI (release.yml) tags/names the GitHub
REM    Release from tauri.conf.json's version, so bumping it here is what actually
REM    sets the released version. The two package.json files are kept in sync.
for /f "delims=" %%v in ('powershell -NoProfile -Command "(Get-Content src/app/src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version"') do set "current=%%v"
set "version="
set /p "version=[release] version to publish (current %current%): "
if not defined version (
  echo [release] no version entered. Aborting.
  exit /b 1
)
echo %version%| findstr /r "^[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*$" >nul
if errorlevel 1 (
  echo [release] '%version%' is not a valid x.y.z version.
  exit /b 1
)

if not "%version%"=="%current%" (
  echo [release] bumping %current% -^> %version%...
  for %%f in ("package.json" "src\app\package.json" "src\app\src-tauri\tauri.conf.json") do (
    powershell -NoProfile -Command "$p=(Resolve-Path -LiteralPath '%%~f').Path; $c=[IO.File]::ReadAllText($p); $c=$c -replace '\"version\":\s*\"%current%\"', '\"version\": \"%version%\"'; [IO.File]::WriteAllText($p, $c)"
    if errorlevel 1 exit /b 1
  )
  git add package.json src/app/package.json src/app/src-tauri/tauri.conf.json
  git commit -m "release v%version%"
  if errorlevel 1 exit /b 1
) else (
  echo [release] version unchanged; publishing existing v%version%.
)

REM 4. Publish main, then fast-forward the remote releases branch to it. A plain
REM    push refuses non-fast-forwards, so this can't clobber unmerged release work.
echo [release] pushing main...
git push origin main
if errorlevel 1 exit /b 1

echo [release] advancing releases -^> main...
git push origin main:releases
if errorlevel 1 (
  echo [release] push to releases failed ^(not a fast-forward?^). Reconcile releases with main and retry.
  exit /b 1
)

REM 5. Keep the local releases ref in sync so it isn't left behind main.
git branch -f releases main

echo [release] release triggered. CI is building the .msi.

REM 6. If the GitHub CLI is present, follow the run; otherwise print where to look.
where gh >nul 2>nul
if errorlevel 1 (
  echo [release] install GitHub CLI ^(gh^) to auto-watch, or check the Actions tab.
  exit /b 0
)
echo [release] waiting for the workflow to register...
timeout /t 6 /nobreak >nul
gh run watch

endlocal
