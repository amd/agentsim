REM Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
REM
REM See LICENSE for license information.

@echo off
REM run_app - build & launch the Tauri desktop app (native Windows window).
REM The Rust host starts/stops the Python server itself (src-tauri\src\lib.rs)
REM and Tauri launches Vite via beforeDevCommand, so this is all that's needed.

setlocal
cd /d "%~dp0.."
call npm run tauri:dev
