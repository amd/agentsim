# Release pipeline

Builds a standalone Windows installer (`AgentSim_<version>_x64_en-US.msi`) that
runs on any machine **without** Python installed: the installer ships an
embeddable Python runtime plus the FastAPI server alongside the Tauri app.

## How it works

The Tauri host normally launches the Python server from the repo's `.venv`
(`src/app/src-tauri/src/server_process.rs`). In a release build it instead runs a
bundled interpreter:

- `stage-python.ps1` downloads the **Windows embeddable Python**, enables
  site-packages, `pip install`s `src/server/requirements.txt` into it, and copies
  the server source. Output goes to `src/app/src-tauri/runtime/` (git-ignored).
- `tauri.conf.json` ships that `runtime/` as bundle resources, so the MSI
  installs `python/` and `server/` under the app's `resources/` dir.
- At startup `resolve_paths()` (in `server_process.rs`) picks the bundled
  `resources/python/python.exe` + `resources/server` in release builds, and falls
  back to the repo venv in dev builds.

## Build locally

Requires Node 20+, Rust (stable + MSVC build tools), and Python on PATH.

```powershell
./release/build.ps1
# -> release/dist/AgentSim_<version>_x64_en-US.msi
```

`build.ps1` runs `npm ci`, regenerates icons, stages the Python runtime, runs
`tauri build`, and copies the `.msi` into `release/dist/`.

## Build in CI

Pushing to the **`releases`** branch triggers
`.github/workflows/release.yml` (a thin wrapper around `build.ps1`). It builds on
`windows-latest`, uploads the `.msi` as a workflow artifact, and publishes a
GitHub Release tagged `v<version>-<run_number>`.

The version comes from `src/app/src-tauri/tauri.conf.json` (`version`). Bump it
there before cutting a release.

## Files

| File | Purpose |
| --- | --- |
| `build.ps1` | End-to-end build orchestrator (local + CI). |
| `stage-python.ps1` | Download + stage the embeddable Python runtime and server. |
| `dist/` | Build output (git-ignored). |

## Not yet covered

- **Code signing.** The MSI is unsigned. (The reference SDK uses SignPath; add a
  signing step here when a certificate is available.)
- macOS / Linux installers — Windows-only for now.
