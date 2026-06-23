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

// Guard the values interpolated into the spawned shell command. Session ids and
// model names are UUID/identifier-shaped; reject anything with shell-significant
// characters so a crafted transcript can't inject a command.
fn is_safe_token(s: &str) -> bool {
    !s.is_empty()
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'))
}

/// Open a new terminal window that resumes a Claude Code session, running
/// `claude --resume <session_id> [--model <model>]` with the working directory
/// set to the session's project so Claude resolves it. (`--resume` targets a
/// specific id; `--continue` would ignore it and reopen the latest session.)
#[tauri::command]
pub(crate) fn launch_session(
    session_id: String,
    model: String,
    project_path: String,
) -> Result<(), String> {
    use std::process::Command;

    if !is_safe_token(&session_id) {
        return Err(format!("unsafe session id: {session_id}"));
    }
    let mut claude = format!("claude --resume {session_id}");
    if !model.is_empty() {
        if !is_safe_token(&model) {
            return Err(format!("unsafe model name: {model}"));
        }
        claude.push_str(&format!(" --model {model}"));
    }

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = Command::new("cmd");
        c.args(["/C", "start", "cmd", "/K", &claude]);
        c
    };

    #[cfg(target_os = "macos")]
    let mut cmd = {
        let body = if project_path.is_empty() {
            claude.clone()
        } else {
            format!("cd {} && {claude}", shell_quote(&project_path))
        };
        let mut c = Command::new("osascript");
        c.args([
            "-e",
            &format!("tell application \"Terminal\" to do script \"{}\"", body.replace('"', "\\\"")),
        ]);
        c
    };

    #[cfg(target_os = "linux")]
    let mut cmd = {
        let mut c = Command::new("x-terminal-emulator");
        c.args(["-e", "bash", "-c", &format!("{claude}; exec bash")]);
        c
    };

    if !project_path.is_empty() {
        cmd.current_dir(&project_path);
    }

    cmd.spawn().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}
