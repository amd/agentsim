// Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
//
// See LICENSE for license information.

mod commands;
mod server_process;

use std::sync::Arc;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};

use server_process::ServerProcess;

// run() builds and starts the Tauri application. main.rs just calls this.
//
// Sequence:
//   1. create the ServerProcess holder,
//   2. in setup(), resolve dev-vs-bundled paths (needs the app's resource dir)
//      and start the Python server,
//   3. keep it in Tauri's managed state so it lives as long as the app,
//   4. run the app,
//   5. on Exit, stop the server so nothing is left running.
pub fn run() {
    let server = Arc::new(ServerProcess::new());

    let server_for_state = server.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            // Resolve the interpreter + server source. In a bundled install the
            // MSI ships an embeddable Python and the server under the resource
            // dir; in dev we fall back to the repo venv / src/server.
            let resource_dir = app.path().resource_dir().ok();
            let paths = server_process::resolve_paths(resource_dir);
            server_for_state.start(&paths);

            // Stash the server handle in app state (good practice; lets future
            // commands reach it). Not strictly required for this sample.
            app.manage(server_for_state.clone());

            // Custom borderless title bar: emit maximize-change on resize so the
            // renderer can swap the maximize/restore icon. Cloned 1:1 from
            // reference/lemonade.
            if let Some(window) = app.get_webview_window("main") {
                let emitter = app.handle().clone();
                let window_clone = window.clone();
                let last_maximized = std::sync::atomic::AtomicBool::new(false);
                window.on_window_event(move |event| {
                    if matches!(event, WindowEvent::Resized(_)) {
                        if let Ok(maximized) = window_clone.is_maximized() {
                            let prev = last_maximized
                                .swap(maximized, std::sync::atomic::Ordering::Relaxed);
                            if prev != maximized {
                                let _ = emitter.emit(commands::MAXIMIZE_CHANGE, maximized);
                            }
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::minimize_window,
            commands::maximize_window,
            commands::close_window,
            commands::launch_session,
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Tauri app")
        .run(move |_app_handle, event| {
            // When the last window closes and the app exits, shut the server down.
            if let RunEvent::Exit = event {
                server.stop();
            }
        });
}
