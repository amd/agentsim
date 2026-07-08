import "./styles/tokens.css";
import "./styles/components.css";
import "./styles/app.css";
import { invoke } from "@tauri-apps/api/core";
import { createAppShell } from "./ui/AppShell.js";
import { createWarmupOverlay } from "./ui/WarmupOverlay.js";
import { fetchConfig, markStartupComplete, waitForServer } from "./data/api.js";

// Links in rendered content (markdown-parsed assistant/tool text) would otherwise
// navigate the webview itself, replacing the app. Intercept clicks on external
// http(s) anchors and hand them to the OS default browser via the opener plugin.
// In browser dev there's no host, so fall back to a new tab.
function interceptExternalLinks(): void {
  document.addEventListener("click", (e) => {
    const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.href;
    if (!/^https?:\/\//i.test(href)) return;
    e.preventDefault();
    if ("__TAURI_INTERNALS__" in window) {
      void invoke("plugin:opener|open_url", { url: href }).catch((err) =>
        console.error("[links] open_url failed", err),
      );
    } else {
      window.open(href, "_blank", "noopener");
    }
  });
}

// Entry point. The Rust host spawns the Python backend at launch, but it may not
// be listening yet (slow cold start), so we show a warm-up overlay and only
// mount the shell once the backend answers. Styles are imported here so Vite
// bundles them; tokens.css must come first (components/app read it).

async function boot(root: HTMLElement): Promise<void> {
  const overlay = createWarmupOverlay();
  root.append(overlay.element);

  const ready = await waitForServer();
  if (!ready) {
    overlay.showError(() => {
      overlay.remove();
      void boot(root);
    });
    return;
  }

  overlay.remove();
  root.append(createAppShell());
  void maybeOpenFirstStartup();
}

// On the very first launch the active data-source set is empty, so open Manage
// Data Sources once to guide setup. The flag lives in the server config; clearing
// it here ensures this fires only on first startup. Reuses the same event the
// File menu dispatches, so the AppShell listener (already attached) opens it.
async function maybeOpenFirstStartup(): Promise<void> {
  try {
    const { is_first_startup } = await fetchConfig();
    if (!is_first_startup) return;
    window.dispatchEvent(new CustomEvent("file:manage-data-sources"));
    await markStartupComplete();
  } catch (err) {
    console.warn("[startup] first-run check failed", err);
  }
}

interceptExternalLinks();

const root = document.getElementById("app");
if (root) void boot(root);
