REM Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
REM
REM See LICENSE for license information.

@echo off
REM run_web - start the FastAPI server + web UI (Vite), then open a browser tab.
REM Browser-only workflow (no desktop window). Close the window or Ctrl+C to stop.

setlocal
cd /d "%~dp0.."

REM Detached: wait (up to 60s) for the web UI to answer, then open a browser tab.
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "for($i=0;$i -lt 60;$i++){try{$null=Invoke-WebRequest -UseBasicParsing http://localhost:1420 -TimeoutSec 1;Start-Process 'http://localhost:1420';break}catch{Start-Sleep -Seconds 1}}"

REM Server + web UI run in the foreground; Ctrl+C stops both.
call npm run dev

