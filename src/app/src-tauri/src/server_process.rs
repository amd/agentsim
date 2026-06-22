use std::path::{Path, PathBuf};
use std::process::{Child, Command};
use std::sync::Mutex;

// ServerProcess owns the Python (FastAPI/uvicorn) server child process. This is
// the heart of the "desktop host embeds the daemon" idea: when the Tauri app
// launches, the Rust host starts the server as a child process; when the app
// exits, it kills it.
//
// The host only cares that the child speaks HTTP on port 4317 — it does not care
// what language the server is written in. Swapping the server only changes what
// we spawn here; nothing else in the app changes.
pub struct ServerProcess {
    child: Mutex<Option<Child>>,
}

impl ServerProcess {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }

    // Start the FastAPI server: `python -m app.main` run from src/server, using
    // the repo's virtualenv interpreter if present (so FastAPI/uvicorn are on
    // hand). Make sure dependencies are installed first:
    //   python -m pip install -r src/server/requirements.txt
    pub fn start(&self) {
        let repo_root = repo_root();
        let server_dir = repo_root.join("src/server");
        let python = python_executable(&repo_root);

        println!("[host] starting python server: {} -m app.main", python.display());

        // No --data-dir: each backend falls back to its own default location
        // (ClaudeCode reads ~/.claude/projects), so the app shows real sessions.
        let result = Command::new(python)
            .current_dir(&server_dir)
            .arg("-m")
            .arg("app.main")
            .arg("--port")
            .arg("4317")
            .spawn();

        match result {
            Ok(child) => {
                *self.child.lock().unwrap() = Some(child);
            }
            Err(err) => {
                // Don't crash the UI if the server fails to start; the frontend
                // already shows a friendly "cannot reach server" message.
                eprintln!("[host] failed to start python server: {err}");
            }
        }
    }

    // Kill the child process so we don't leave an orphaned server running.
    pub fn stop(&self) {
        if let Some(mut child) = self.child.lock().unwrap().take() {
            println!("[host] stopping python server");
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

// Prefer the repo's virtualenv interpreter (where FastAPI/uvicorn are
// installed); fall back to whatever `python` is on PATH.
fn python_executable(repo_root: &Path) -> PathBuf {
    let venv = if cfg!(windows) {
        repo_root.join(".venv/Scripts/python.exe")
    } else {
        repo_root.join(".venv/bin/python")
    };
    if venv.exists() {
        venv
    } else {
        PathBuf::from("python")
    }
}

// Walk up from this crate's directory (src/app/src-tauri) to the repo root.
// CARGO_MANIFEST_DIR is set at compile time to the crate root, which is exactly
// 3 levels below the repo root: src/app/src-tauri -> src/app -> src -> root.
fn repo_root() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    manifest
        .ancestors()
        .nth(3)
        .map(PathBuf::from)
        .unwrap_or(manifest)
}
