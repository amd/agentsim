//! Tauri invoke handlers backing the custom borderless title bar's window
//! controls. Cloned 1:1 from reference/lemonade's window-control logic.

use tauri::{AppHandle, Manager, WebviewWindow};

// Event channel: emitted on resize so the renderer can swap the maximize/restore
// icon. The matching string lives in src/app/src/ui/MenuBar.ts — keep in sync.
pub(crate) const MAXIMIZE_CHANGE: &str = "maximize-change";

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

#[tauri::command]
pub(crate) fn minimize_window(app: AppHandle) {
    if let Some(w) = main_window(&app) {
        let _ = w.minimize();
    }
}

#[tauri::command]
pub(crate) fn maximize_window(app: AppHandle) {
    if let Some(w) = main_window(&app) {
        if let Ok(true) = w.is_maximized() {
            let _ = w.unmaximize();
        } else {
            let _ = w.maximize();
        }
    }
}

#[tauri::command]
pub(crate) fn close_window(app: AppHandle) {
    if let Some(w) = main_window(&app) {
        let _ = w.close();
    }
}
