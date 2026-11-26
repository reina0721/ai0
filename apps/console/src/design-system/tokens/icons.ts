import { createElement, type ReactElement } from "react";
import {
  Activity, ArrowDownToLine, ArrowRight, ArrowUpFromLine, Bell, BookOpen, Boxes, BriefcaseBusiness,
  Check, ChevronDown, Clock, Code, Cpu, Download, EyeOff, FlaskConical, GitBranch, Globe, GraduationCap,
  Heart, History, Info, KeyRound, Layers, LayoutDashboard, Lock, MessageSquare, Mic, Moon, Network,
  PanelLeft, PanelRight, Play, Plus, Puzzle, RefreshCw, Save, Search, Send, Settings2, Shield, SlidersHorizontal,
  Smile, Sparkles, Square, Sun, Terminal, Trash2, UserRound, Users, WandSparkles, X, Zap,
  type LucideIcon
} from "lucide-react";

const icons = {
  dashboard: LayoutDashboard, chat: MessageSquare, sessions: History, persona: UserRound,
  blackboard: Boxes, circadian: Activity, models: Cpu, channels: Globe, rules: SlidersHorizontal,
  memory: Network, evolution: Moon, knowledge: BookOpen, subagents: Users, extensions: Puzzle,
  telemetry: Terminal, system: Settings2, wizard: WandSparkles, sandbox: FlaskConical,
  pulse: Activity, bell: Bell, export: Download, sun: Sun, moon: Moon, search: Search,
  sidebar: PanelLeft, inspector: PanelRight, close: X, "chevron-down": ChevronDown, check: Check,
  plus: Plus, save: Save, refresh: RefreshCw, lock: Lock, globe: Globe, users: Users, shield: Shield,
  trash: Trash2, play: Play, zap: Zap, clock: Clock, book: BookOpen, code: Code, cpu: Cpu,
  send: Send, stop: Square, sliders: SlidersHorizontal, layers: Layers, terminal: Terminal,
  "git-branch": GitBranch, key: KeyRound, info: Info, "arrow-right": ArrowRight, heart: Heart,
  briefcase: BriefcaseBusiness, "graduation-cap": GraduationCap, mic: Mic, smile: Smile, "eye-off": EyeOff,
  sparkles: Sparkles, upload: ArrowUpFromLine, download: ArrowDownToLine
} satisfies Record<string, LucideIcon>;

export type ConsoleIconName = "logo" | keyof typeof icons;

export function renderConsoleIcon(name: ConsoleIconName, size = 16, className?: string): ReactElement {
  const classes = "ai0-icon " + (className ?? "");
  if (name === "logo") {
    return createElement("svg", {
      className: classes, width: size, height: size, viewBox: "0 0 24 24", fill: "currentColor", "aria-hidden": true
    }, createElement("path", { d: "M12 2.5 14.8 9.2 21.5 12 14.8 14.8 12 21.5 9.2 14.8 2.5 12 9.2 9.2Z" }));
  }
  return createElement(icons[name], { size, strokeWidth: 1.85, className: classes, "aria-hidden": true });
}
