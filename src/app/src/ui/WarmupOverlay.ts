import { el } from "./dom.js";

// Full-screen overlay shown while the renderer waits for the backend to become
// reachable on first launch (the bundled Python cold-starts slowly). Returns the
// element plus helpers to switch it into an error state or remove it.
export interface WarmupOverlay {
  element: HTMLElement;
  showError: (onRetry: () => void) => void;
  remove: () => void;
}

export function createWarmupOverlay(): WarmupOverlay {
  const spinner = el("div", { class: "lm-spinner" });
  const message = el("div", { class: "warmup-message", text: "Warming up…" });
  const body = el("div", { class: "warmup-body" }, [spinner, message]);
  const element = el("div", { class: "warmup-overlay" }, [body]);

  const showError = (onRetry: () => void) => {
    spinner.style.display = "none";
    message.textContent = "Can't reach the backend.";
    const retry = el("button", { class: "warmup-retry", text: "Retry" });
    retry.addEventListener("click", onRetry);
    body.append(retry);
  };

  const remove = () => element.remove();

  return { element, showError, remove };
}
