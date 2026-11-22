export * from "./icons.js";

export const CONSOLE_SOUL_THEMES = [
  "sakura-pink",
  "astral-blue",
  "cyber-emerald"
] as const;

export type ConsoleSoulTheme = (typeof CONSOLE_SOUL_THEMES)[number];

export const SOUVEREIGNTY_LOCKED_COLORS = Object.freeze({
  liveEmerald: "#10B981",
  sandboxAmber: "#F59E0B",
  sandboxViolet: "#8B5CF6"
} as const);
