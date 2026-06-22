mod server_process;

use std::sync::Arc;
use tauri::{Manager, RunEvent};

use server_process::ServerProcess;

// run() builds and starts the Tauri application. main.rs just calls this.
//
// Sequence:
//   1. create the ServerProcess holder and start the Python server,
//   2. keep it in Tauri's managed state so it lives as long as the app,
//   3. run the app,
//   4. on Exit, stop the server so nothing is left running.
pub fn run() {
    let server = Arc::new(ServerProcess::new());
    server.start();

    let server_for_state = server.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            // Stash the server handle in app state (good practice; lets future
            // commands reach it). Not strictly required for this sample.
            app.manage(server_for_state.clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Tauri app")
        .run(move |_app_handle, event| {
            // When the last window closes and the app exits, shut the server down.
            if let RunEvent::Exit = event {
                server.stop();
            }
        });
}
