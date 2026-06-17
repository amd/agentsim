import "./styles/tokens.css";
import "./styles/components.css";
import "./styles/app.css";
import { createAppShell } from "./ui/AppShell.js";

// Entry point: mount the boilerplate UI shell into #app. Styles are imported
// here so Vite bundles them; tokens.css must come first (components/app read it).

const root = document.getElementById("app");
if (root) root.append(createAppShell());
