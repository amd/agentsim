// Copyright (c) 2026 Advanced Micro Devices, Inc. All rights reserved.
//
// See LICENSE for license information.

import { defineConfig } from "vite";

import { version } from "./package.json";

// Vite is the frontend dev server + bundler. Tauri loads whatever Vite serves.
//
// The settings below are the Tauri-recommended defaults: a fixed port (so the
// Rust host knows where to point the webview) and a strict port (fail rather
// than silently move to another port).
export default defineConfig({
  // Inject the package version so the About window has a single source of truth
  // (package.json) instead of a hardcoded string that drifts each release.
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    // Tauri targets modern webviews, so we can ship modern JS.
    target: "es2022",
    outDir: "dist",
  },
});
