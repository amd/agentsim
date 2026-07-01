import "./styles/tokens.css";
import "./styles/components.css";
import "./styles/app.css";
import { createAppShell } from "./ui/AppShell.js";
import { createWarmupOverlay } from "./ui/WarmupOverlay.js";
import { waitForServer } from "./data/api.js";

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
}

const root = document.getElementById("app");
if (root) void boot(root);
