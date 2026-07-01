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

REM 3. Publish main, then fast-forward the remote releases branch to it. A plain
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

REM 4. Keep the local releases ref in sync so it isn't left behind main.
git branch -f releases main

echo [release] release triggered. CI is building the .msi.

REM 5. If the GitHub CLI is present, follow the run; otherwise print where to look.
where gh >nul 2>nul
if errorlevel 1 (
  echo [release] install GitHub CLI ^(gh^) to auto-watch, or check the Actions tab.
  exit /b 0
)
echo [release] waiting for the workflow to register...
timeout /t 6 /nobreak >nul
gh run watch

endlocal
