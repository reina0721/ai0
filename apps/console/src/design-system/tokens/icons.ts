import { createElement, type ReactElement } from "react";

export type ConsoleIconName =
  | "logo"
  | "dashboard"
  | "chat"
  | "sessions"
  | "persona"
  | "blackboard"
  | "circadian"
  | "models"
  | "shells"
  | "rules"
  | "memory"
  | "evolution"
  | "knowledge"
  | "subagents"
  | "extensions"
  | "telemetry"
  | "system"
  | "wizard"
  | "sandbox"
  | "pulse"
  | "bell"
  | "export"
  | "sun"
  | "moon"
  | "search"
  | "sidebar"
  | "inspector"
  | "close"
  | "chevron-down"
  | "check"
  | "plus"
  | "save"
  | "refresh"
  | "lock"
  | "globe"
  | "users"
  | "shield"
  | "trash"
  | "play"
  | "zap"
  | "clock"
  | "book"
  | "code"
  | "cpu"
  | "send"
  | "stop"
  | "sliders"
  | "layers"
  | "terminal"
  | "git-branch"
  | "key"
  | "info"
  | "arrow-right"
  | "heart"
  | "briefcase"
  | "graduation-cap"
  | "mic"
  | "smile"
  | "eye-off"
  | "sparkles"
  | "upload"
  | "download";

type SvgElementSpec =
  | { tag: "path"; d: string }
  | { tag: "circle"; cx: number; cy: number; r: number }
  | { tag: "rect"; x: number; y: number; width: number; height: number; rx?: number }
  | { tag: "line"; x1: number; y1: number; x2: number; y2: number }
  | { tag: "polyline"; points: string }
  | { tag: "polygon"; points: string };

const ICON_PATHS: Record<ConsoleIconName, readonly SvgElementSpec[]> = {
  logo: [
    { tag: "path", d: "M12 3L14.5 9.5L21 12L14.5 14.5L12 21L9.5 14.5L3 12L9.5 9.5L12 3Z" }
  ],
  dashboard: [
    { tag: "rect", x: 3, y: 3, width: 7, height: 9, rx: 1.5 },
    { tag: "rect", x: 14, y: 3, width: 7, height: 5, rx: 1.5 },
    { tag: "rect", x: 14, y: 12, width: 7, height: 9, rx: 1.5 },
    { tag: "rect", x: 3, y: 16, width: 7, height: 5, rx: 1.5 }
  ],
  chat: [
    { tag: "path", d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" }
  ],
  sessions: [
    { tag: "path", d: "M4 6h16" },
    { tag: "path", d: "M4 12h16" },
    { tag: "path", d: "M4 18h10" }
  ],
  persona: [
    { tag: "circle", cx: 12, cy: 8, r: 4 },
    { tag: "path", d: "M5 20a7 7 0 0 1 14 0" }
  ],
  blackboard: [
    { tag: "rect", x: 3, y: 3, width: 18, height: 6, rx: 1.5 },
    { tag: "rect", x: 3, y: 12, width: 8, height: 9, rx: 1.5 },
    { tag: "rect", x: 14, y: 12, width: 7, height: 9, rx: 1.5 }
  ],
  circadian: [
    { tag: "path", d: "M22 12h-4l-3 7-6-14-3 7H2" }
  ],
  models: [
    { tag: "rect", x: 5, y: 5, width: 14, height: 14, rx: 2 },
    { tag: "rect", x: 9, y: 9, width: 6, height: 6, rx: 1 },
    { tag: "path", d: "M9 1v4M15 1v4M9 19v4M15 19v4M1 9h4M1 15h4M19 9h4M19 15h4" }
  ],
  shells: [
    { tag: "circle", cx: 12, cy: 12, r: 9 },
    { tag: "path", d: "M3.6 9h16.8M3.6 15h16.8" },
    { tag: "path", d: "M12 3a13.5 13.5 0 0 0 0 18M12 3a13.5 13.5 0 0 1 0 18" }
  ],
  rules: [
    { tag: "line", x1: 4, y1: 6, x2: 20, y2: 6 },
    { tag: "circle", cx: 9, cy: 6, r: 2 },
    { tag: "line", x1: 4, y1: 12, x2: 20, y2: 12 },
    { tag: "circle", cx: 15, cy: 12, r: 2 },
    { tag: "line", x1: 4, y1: 18, x2: 20, y2: 18 },
    { tag: "circle", cx: 10, cy: 18, r: 2 }
  ],
  memory: [
    { tag: "circle", cx: 6, cy: 6, r: 2.5 },
    { tag: "circle", cx: 18, cy: 6, r: 2.5 },
    { tag: "circle", cx: 12, cy: 18, r: 2.5 },
    { tag: "path", d: "M8.2 7.5L11 15.8M15.8 7.5L13 15.8M8.5 6h7" }
  ],
  evolution: [
    { tag: "path", d: "M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" }
  ],
  knowledge: [
    { tag: "path", d: "M4 19.5A2.5 2.5 0 0 1 6.5 17H20" },
    { tag: "path", d: "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" }
  ],
  subagents: [
    { tag: "circle", cx: 9, cy: 8, r: 3 },
    { tag: "circle", cx: 17, cy: 9, r: 2.5 },
    { tag: "path", d: "M3 19a6 6 0 0 1 12 0" },
    { tag: "path", d: "M15 19a4.5 4.5 0 0 1 6 0" }
  ],
  extensions: [
    { tag: "path", d: "M12 2L3 7l9 5 9-5-9-5z" },
    { tag: "path", d: "M3 12l9 5 9-5" },
    { tag: "path", d: "M3 17l9 5 9-5" }
  ],
  telemetry: [
    { tag: "polyline", points: "4 17 10 11 4 5" },
    { tag: "line", x1: 12, y1: 19, x2: 20, y2: 19 }
  ],
  system: [
    { tag: "path", d: "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" },
    { tag: "polyline", points: "3.27 6.96 12 12.01 20.73 6.96" },
    { tag: "line", x1: 12, y1: 22.08, x2: 12, y2: 12 }
  ],
  wizard: [
    { tag: "path", d: "M15 4V2M15 16v-2M8 9h2M20 9h2M17.8 11.8L19 13M17.8 6.2L19 5M3 21l9-9M12.2 6.2L11 5" }
  ],
  sandbox: [
    { tag: "path", d: "M9 3h6M10 3v5.5L4.5 18a2 2 0 0 0 1.7 3h11.6a2 2 0 0 0 1.7-3L14 8.5V3" },
    { tag: "path", d: "M7.5 14h9" }
  ],
  pulse: [
    { tag: "path", d: "M3 12h4l2.5-6 5 12 2.5-6H21" }
  ],
  bell: [
    { tag: "path", d: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" },
    { tag: "path", d: "M13.73 21a2 2 0 0 1-3.46 0" }
  ],
  export: [
    { tag: "path", d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" },
    { tag: "polyline", points: "17 8 12 3 7 8" },
    { tag: "line", x1: 12, y1: 3, x2: 12, y2: 15 }
  ],
  sun: [
    { tag: "circle", cx: 12, cy: 12, r: 4 },
    { tag: "path", d: "M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" }
  ],
  moon: [
    { tag: "path", d: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" }
  ],
  search: [
    { tag: "circle", cx: 11, cy: 11, r: 7 },
    { tag: "line", x1: 20, y1: 20, x2: 16.65, y2: 16.65 }
  ],
  sidebar: [
    { tag: "rect", x: 3, y: 4, width: 18, height: 16, rx: 2 },
    { tag: "line", x1: 9, y1: 4, x2: 9, y2: 20 }
  ],
  inspector: [
    { tag: "rect", x: 3, y: 4, width: 18, height: 16, rx: 2 },
    { tag: "line", x1: 15, y1: 4, x2: 15, y2: 20 }
  ],
  close: [
    { tag: "line", x1: 18, y1: 6, x2: 6, y2: 18 },
    { tag: "line", x1: 6, y1: 6, x2: 18, y2: 18 }
  ],
  "chevron-down": [
    { tag: "polyline", points: "6 9 12 15 18 9" }
  ],
  check: [
    { tag: "polyline", points: "20 6 9 17 4 12" }
  ],
  plus: [
    { tag: "line", x1: 12, y1: 5, x2: 12, y2: 19 },
    { tag: "line", x1: 5, y1: 12, x2: 19, y2: 12 }
  ],
  save: [
    { tag: "path", d: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" },
    { tag: "polyline", points: "17 21 17 13 7 13 7 21" },
    { tag: "polyline", points: "7 3 7 8 15 8" }
  ],
  refresh: [
    { tag: "polyline", points: "23 4 23 10 17 10" },
    { tag: "path", d: "M20.49 15a9 9 0 1 1-2.12-9.36L23 10" }
  ],
  lock: [
    { tag: "rect", x: 5, y: 11, width: 14, height: 10, rx: 2 },
    { tag: "path", d: "M8 11V7a4 4 0 0 1 8 0v4" }
  ],
  globe: [
    { tag: "circle", cx: 12, cy: 12, r: 9 },
    { tag: "path", d: "M3.6 9h16.8M3.6 15h16.8M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18" }
  ],
  users: [
    { tag: "circle", cx: 9, cy: 7, r: 3.5 },
    { tag: "path", d: "M3 20a6 6 0 0 1 12 0" },
    { tag: "path", d: "M16 4.5a3.5 3.5 0 0 1 0 6.5" },
    { tag: "path", d: "M17 20a5 5 0 0 1 4-4.9" }
  ],
  shield: [
    { tag: "path", d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" }
  ],
  trash: [
    { tag: "polyline", points: "3 6 5 6 21 6" },
    { tag: "path", d: "M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" },
    { tag: "path", d: "M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" }
  ],
  play: [
    { tag: "polygon", points: "6 4 20 12 6 20 6 4" }
  ],
  zap: [
    { tag: "polygon", points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" }
  ],
  clock: [
    { tag: "circle", cx: 12, cy: 12, r: 9 },
    { tag: "polyline", points: "12 7 12 12 15.5 14" }
  ],
  book: [
    { tag: "path", d: "M2 4h7a4 4 0 0 1 4 4v13a3 3 0 0 0-3-3H2z" },
    { tag: "path", d: "M22 4h-7a4 4 0 0 0-4 4v13a3 3 0 0 1 3-3h8z" }
  ],
  code: [
    { tag: "polyline", points: "16 18 22 12 16 6" },
    { tag: "polyline", points: "8 6 2 12 8 18" }
  ],
  cpu: [
    { tag: "rect", x: 5, y: 5, width: 14, height: 14, rx: 2 },
    { tag: "rect", x: 9, y: 9, width: 6, height: 6, rx: 1 }
  ],
  send: [
    { tag: "line", x1: 22, y1: 2, x2: 11, y2: 13 },
    { tag: "polygon", points: "22 2 15 22 11 13 2 9 22 2" }
  ],
  stop: [
    { tag: "rect", x: 5, y: 5, width: 14, height: 14, rx: 2 }
  ],
  sliders: [
    { tag: "line", x1: 4, y1: 21, x2: 4, y2: 14 },
    { tag: "line", x1: 4, y1: 10, x2: 4, y2: 3 },
    { tag: "line", x1: 12, y1: 21, x2: 12, y2: 12 },
    { tag: "line", x1: 12, y1: 8, x2: 12, y2: 3 },
    { tag: "line", x1: 20, y1: 21, x2: 20, y2: 16 },
    { tag: "line", x1: 20, y1: 12, x2: 20, y2: 3 },
    { tag: "line", x1: 2, y1: 14, x2: 6, y2: 14 },
    { tag: "line", x1: 10, y1: 8, x2: 14, y2: 8 },
    { tag: "line", x1: 18, y1: 16, x2: 22, y2: 16 }
  ],
  layers: [
    { tag: "polygon", points: "12 2 2 7 12 12 22 7 12 2" },
    { tag: "polyline", points: "2 12 12 17 22 12" },
    { tag: "polyline", points: "2 17 12 22 22 17" }
  ],
  terminal: [
    { tag: "polyline", points: "4 17 10 11 4 5" },
    { tag: "line", x1: 12, y1: 19, x2: 20, y2: 19 }
  ],
  "git-branch": [
    { tag: "circle", cx: 6, cy: 6, r: 2.5 },
    { tag: "circle", cx: 18, cy: 6, r: 2.5 },
    { tag: "circle", cx: 6, cy: 18, r: 2.5 },
    { tag: "path", d: "M6 8.5v7M18 8.5c0 4.5-6 4.5-12 7" }
  ],
  key: [
    { tag: "circle", cx: 8, cy: 15, r: 4 },
    { tag: "path", d: "M10.85 12.15L19 4M18 5l2 2M15 8l2 2" }
  ],
  info: [
    { tag: "circle", cx: 12, cy: 12, r: 9 },
    { tag: "line", x1: 12, y1: 16, x2: 12, y2: 12 },
    { tag: "line", x1: 12, y1: 8, x2: 12.01, y2: 8 }
  ],
  "arrow-right": [
    { tag: "line", x1: 5, y1: 12, x2: 19, y2: 12 },
    { tag: "polyline", points: "13 6 19 12 13 18" }
  ],
  heart: [
    { tag: "path", d: "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" }
  ],
  briefcase: [
    { tag: "rect", x: 3, y: 7, width: 18, height: 13, rx: 2 },
    { tag: "path", d: "M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }
  ],
  "graduation-cap": [
    { tag: "polygon", points: "12 3 2 8 12 13 22 8 12 3" },
    { tag: "path", d: "M6 10.5V16c0 1.66 2.69 3 6 3s6-1.34 6-3v-5.5" }
  ],
  mic: [
    { tag: "rect", x: 9, y: 2, width: 6, height: 11, rx: 3 },
    { tag: "path", d: "M5 10a7 7 0 0 0 14 0" },
    { tag: "line", x1: 12, y1: 17, x2: 12, y2: 22 }
  ],
  smile: [
    { tag: "circle", cx: 12, cy: 12, r: 9 },
    { tag: "path", d: "M8.5 14.5a4 4 0 0 0 7 0" },
    { tag: "line", x1: 9, y1: 9.5, x2: 9.01, y2: 9.5 },
    { tag: "line", x1: 15, y1: 9.5, x2: 15.01, y2: 9.5 }
  ],
  "eye-off": [
    { tag: "path", d: "M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" },
    { tag: "path", d: "M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" },
    { tag: "line", x1: 1, y1: 1, x2: 23, y2: 23 }
  ],
  sparkles: [
    { tag: "path", d: "M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" },
    { tag: "path", d: "M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z" }
  ],
  upload: [
    { tag: "path", d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" },
    { tag: "polyline", points: "17 8 12 3 7 8" },
    { tag: "line", x1: 12, y1: 3, x2: 12, y2: 15 }
  ],
  download: [
    { tag: "path", d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" },
    { tag: "polyline", points: "7 10 12 15 17 10" },
    { tag: "line", x1: 12, y1: 15, x2: 12, y2: 3 }
  ]
};

export function renderConsoleIcon(
  name: ConsoleIconName,
  size = 16,
  className?: string
): ReactElement {
  const specs = ICON_PATHS[name] ?? ICON_PATHS.info;
  return createElement(
    "svg",
    {
      className: `ai0-icon${className ? ` ${className}` : ""}`,
      width: size,
      height: size,
      viewBox: "0 0 24 24",
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.85,
      strokeLinecap: "round",
      strokeLinejoin: "round",
      "aria-hidden": true
    },
    ...specs.map((spec, index) => {
      const { tag, ...attrs } = spec;
      return createElement(tag, { key: index, ...(attrs as Record<string, unknown>) });
    })
  );
}
