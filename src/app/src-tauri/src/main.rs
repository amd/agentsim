// Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
//
// See LICENSE for license information.

// Prevents an extra console window from opening on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// All the real logic lives in lib.rs (crate `app_lib`). This keeps the
// binary entrypoint tiny — the standard Tauri v2 layout.
fn main() {
    app_lib::run()
}
