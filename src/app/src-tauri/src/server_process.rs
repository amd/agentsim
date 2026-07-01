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

// Where the interpreter and `app.main` package live. In dev we run from the repo
// (venv + src/server); in a bundled install we run the embeddable Python and the
// server source that the MSI ships under the app's resource dir.
pub struct ServerPaths {
    pub python: PathBuf,
    pub server_dir: PathBuf,
}

impl ServerProcess {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }

    // Start the FastAPI server: `python -m app.main --port 4317`, run from the
    // server dir with the given interpreter. The caller resolves dev-vs-bundled
    // paths (see `resolve_paths`).
    pub fn start(&self, paths: &ServerPaths) {
        let python = &paths.python;
        let server_dir = &paths.server_dir;

        println!("[host] starting python server: {} -m app.main", python.display());

        // No --config-dir: config.json defaults to ~/.cache/.agent-sim. The
        // active set starts empty; the user adds data sources from the app.
        let result = Command::new(python)
            .current_dir(server_dir)
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

// Resolve where to find the interpreter + server source.
//
// - Bundled (release): the MSI ships an embeddable Python and the server source
//   as Tauri resources, so we run `<resource_dir>/python/python.exe` against
//   `<resource_dir>/server`. No system Python required.
// - Dev (debug, or when the bundled runtime is absent): run from the repo —
//   the venv interpreter if present, else `python` on PATH — against src/server.
//
// `resource_dir` is the Tauri-resolved resource directory (None when unavailable).
pub fn resolve_paths(resource_dir: Option<PathBuf>) -> ServerPaths {
    if !cfg!(debug_assertions) {
        if let Some(res) = resource_dir {
            // Array-form bundle resources preserve their source path relative to
            // src-tauri, so the staged `runtime/` tree lands under the resource
            // dir intact (a map form would flatten it and collide same-named
            // files — see ICE30).
            let python = if cfg!(windows) {
                res.join("runtime/python/python.exe")
            } else {
                res.join("runtime/python/bin/python3")
            };
            let server_dir = res.join("runtime/server");
            if python.exists() && server_dir.exists() {
                return ServerPaths { python, server_dir };
            }
        }
    }

    let repo_root = repo_root();
    ServerPaths {
        python: python_executable(&repo_root),
        server_dir: repo_root.join("src/server"),
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
