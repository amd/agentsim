/* Public entry point for the reusable timeline widget.
   Importing this also pulls in the widget's styles (Lemonade tokens + scoped
   widget chrome) so a host only needs `import { TimelineWidget }`. */

import "vis-timeline/styles/vis-timeline-graph2d.css";
import "./styles/tokens.css";
import "./styles/widget.css";

export { TimelineWidget } from "./TimelineWidget";
export type { MiniLane } from "./core/buildVisData";
export * from "./types";
