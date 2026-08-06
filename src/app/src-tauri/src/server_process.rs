// Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
//
// See LICENSE for license information.

use std::fs::OpenOptions;
use std::io::Write;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;

// How often the supervisor checks whether the child is still alive, and the
// backoff bounds for restarting a child that died while the app is running.
const SUPERVISOR_POLL: Duration = Duration::from_millis(500);
const RESTART_BACKOFF_MIN: Duration = Duration::from_millis(500);
const RESTART_BACKOFF_MAX: Duration = Duration::from_secs(30);

// Windows process creation flag: run the child without allocating a console
// window. Without it, a GUI-subsystem parent spawning console python.exe flashes
// a stray console window on screen.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

// ServerProcess owns the Python (FastAPI/uvicorn) server child process. This is
// the heart of the "desktop host embeds the daemon" idea: when the Tauri app
// launches, the Rust host starts the server as a child process; when the app
// exits, it kills it.
//
// The host only cares that the child speaks HTTP on port 4317 — it does not care
// what language the server is written in. Swapping the server only changes what
// we spawn here; nothing else in the app changes.
pub struct ServerProcess {
    child: Arc<Mutex<Option<Child>>>,
    // True while we *want* the server up. Set on start, cleared on stop; the
    // supervisor restarts the child only while this is true, so a deliberate
    // stop (app exit) is never mistaken for a crash and re-spawned.
    running: Arc<AtomicBool>,
    // Guards against spawning more than one supervisor thread if start() is
    // somehow called twice.
    supervising: AtomicBool,
}

// Where the interpreter and `app.main` package live. In dev we run from the repo
// (venv + src/server); in a bundled install we run the embeddable Python and the
// server source that the MSI ships under the app's resource dir. Cloned into the
// supervisor thread so it can re-spawn the child after a crash.
#[derive(Clone)]
pub struct ServerPaths {
    pub python: PathBuf,
    pub server_dir: PathBuf,
}

impl ServerProcess {
    pub fn new() -> Self {
        Self {
            child: Arc::new(Mutex::new(None)),
            running: Arc::new(AtomicBool::new(false)),
            supervising: AtomicBool::new(false),
        }
    }

    // Spawn the FastAPI server: `python -m app.main --port 4317`, run from the
    // server dir with the given interpreter. Returns the handle, or None if the
    // spawn failed (the frontend already shows a friendly "cannot reach server"
    // message, so a failed spawn must not crash the host).
    fn spawn_child(paths: &ServerPaths) -> Option<Child> {
        let python = &paths.python;
        let server_dir = &paths.server_dir;

        log(&format!(
            "start: python={} (exists={}) server_dir={} (exists={})",
            python.display(),
            python.exists(),
            server_dir.display(),
            server_dir.exists(),
        ));
        println!("[host] starting python server: {} -m app.main", python.display());

        // Send the child's stdout/stderr to the host log so server-side startup
        // failures (missing deps, import errors) are visible after install,
        // where the GUI app has no console. Fall back to inheriting if the log
        // file can't be opened.
        let (stdout, stderr) = match (open_log(), open_log()) {
            (Some(o), Some(e)) => (Stdio::from(o), Stdio::from(e)),
            _ => (Stdio::inherit(), Stdio::inherit()),
        };

        // No --config-dir: config.json defaults to ~/.cache/AgentSim. The
        // active set starts empty; the user adds data sources from the app.
        let mut cmd = Command::new(python);
        cmd.current_dir(server_dir)
            .arg("-m")
            .arg("app.main")
            .arg("--port")
            .arg("4317")
            .stdout(stdout)
            .stderr(stderr);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);

        match cmd.spawn() {
            Ok(child) => {
                log(&format!("spawned python server (pid={})", child.id()));
                Some(child)
            }
            Err(err) => {
                log(&format!("failed to spawn python server: {err}"));
                eprintln!("[host] failed to start python server: {err}");
                None
            }
        }
    }

    // Start the server and begin supervising it. The caller resolves
    // dev-vs-bundled paths (see `resolve_paths`).
    pub fn start(&self, paths: &ServerPaths) {
        self.running.store(true, Ordering::SeqCst);
        *self.child.lock().unwrap() = Self::spawn_child(paths);
        self.ensure_supervised(paths);
    }

    // Launch the monitor thread (once). It polls the child; if it exits while the
    // app still wants it running, it re-spawns with capped exponential backoff so
    // a wedged/crashed Python child recovers instead of leaving the UI stranded
    // on "Cannot reach server." for the rest of the session.
    fn ensure_supervised(&self, paths: &ServerPaths) {
        if self.supervising.swap(true, Ordering::SeqCst) {
            return; // a supervisor is already running
        }
        let child = self.child.clone();
        let running = self.running.clone();
        let paths = paths.clone();
        thread::spawn(move || {
            let mut backoff = RESTART_BACKOFF_MIN;
            while running.load(Ordering::SeqCst) {
                thread::sleep(SUPERVISOR_POLL);
                if !running.load(Ordering::SeqCst) {
                    break;
                }
                let exited = {
                    let mut guard = child.lock().unwrap();
                    match guard.as_mut() {
                        // Err (can't query) is treated as dead so we recover.
                        Some(c) => matches!(c.try_wait(), Ok(Some(_)) | Err(_)),
                        None => false, // spawn failed earlier; retry below
                    }
                };
                let needs_spawn = exited || child.lock().unwrap().is_none();
                if !needs_spawn {
                    backoff = RESTART_BACKOFF_MIN; // healthy: reset backoff
                    continue;
                }
                log(&format!(
                    "python server not running; restarting in {:?}",
                    backoff
                ));
                thread::sleep(backoff);
                if !running.load(Ordering::SeqCst) {
                    break;
                }
                if let Some(new_child) = Self::spawn_child(&paths) {
                    *child.lock().unwrap() = Some(new_child);
                    log("restarted python server");
                }
                backoff = (backoff * 2).min(RESTART_BACKOFF_MAX);
            }
            log("supervisor thread exiting");
        });
    }

    // Whether the child is currently alive. Cheap, non-blocking probe.
    pub fn is_running(&self) -> bool {
        let mut guard = self.child.lock().unwrap();
        match guard.as_mut() {
            Some(c) => matches!(c.try_wait(), Ok(None)),
            None => false,
        }
    }

    // Kill the child process so we don't leave an orphaned server running. Clears
    // `running` first so the supervisor sees the shutdown as intentional and does
    // not race to restart it.
    pub fn stop(&self) {
        self.running.store(false, Ordering::SeqCst);
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
    log(&format!(
        "resolve_paths: debug_assertions={} resource_dir={:?}",
        cfg!(debug_assertions),
        resource_dir,
    ));
    if !cfg!(debug_assertions) {
        if let Some(res) = &resource_dir {
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
            log(&format!(
                "bundled candidate: python={} (exists={}) server_dir={} (exists={})",
                python.display(),
                python.exists(),
                server_dir.display(),
                server_dir.exists(),
            ));
            if python.exists() && server_dir.exists() {
                log("using bundled runtime");
                return ServerPaths { python, server_dir };
            }
        }
    }

    let repo_root = repo_root();
    log(&format!("falling back to repo runtime at {}", repo_root.display()));
    ServerPaths {
        python: python_executable(&repo_root),
        server_dir: repo_root.join("src/server"),
    }
}

// Where the host writes its diagnostic log. Program Files is not writable by a
// normal user, so log under LOCALAPPDATA (temp dir as a last resort).
fn log_path() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    base.join("AgentSim").join("host.log")
}

// Open the log file for appending (creating dirs as needed). Returns None if it
// can't be opened, so callers can silently degrade rather than crash the UI.
fn open_log() -> Option<std::fs::File> {
    let path = log_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    OpenOptions::new().create(true).append(true).open(path).ok()
}

// Append a single line to the host log. Best-effort: failures are ignored.
fn log(msg: &str) {
    if let Some(mut f) = open_log() {
        let _ = writeln!(f, "[host] {msg}");
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
