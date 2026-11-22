import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode
} from "react";
import { useBeforeUnload, useBlocker, useNavigate, useSearchParams, type BlockerFunction } from "react-router";

import {
  fetchBootstrap, fetchSnapshot, getJson, postJson, subscribeTelemetryStream, type ConsoleMode
} from "../api/client.js";
import type { ContextInspectorMode, NavRailMode } from "../design-system/shell/index.js";
import type { ConsoleSoulTheme } from "../design-system/tokens/index.js";
import type { ConsoleLiveSnapshot } from "../live-snapshot.js";

export type ConsoleAppearance = "light" | "dark";
type TargetInstance = "live" | "sandbox:console";

export interface DirtyEditor {
  isDirty: () => boolean;
  save: () => Promise<boolean>;
  discard: () => void;
}

export interface ConsoleContextValue {
  snapshot: ConsoleLiveSnapshot | undefined;
  loading: boolean;
  error: string | null;
  ownerToken: string;
  mode: ConsoleMode;
  targetInstance: TargetInstance;
  soulTheme: ConsoleSoulTheme;
  appearance: ConsoleAppearance;
  navRailMode: NavRailMode;
  inspectorMode: ContextInspectorMode;
  approvalsOpen: boolean;
  onboardingOpen: boolean;
  paletteOpen: boolean;
  toastMessage: string | null;
  dirtyNavigation: {
    save: () => Promise<void>;
    discard: () => void;
    stay: () => void;
  } | null;
  registerDirtyEditor: (id: string, editor: DirtyEditor) => () => void;
  setMode: (mode: ConsoleMode) => void;
  setSoulTheme: (theme: ConsoleSoulTheme) => Promise<void>;
  setAppearance: (appearance: ConsoleAppearance) => Promise<void>;
  toggleAppearance: () => Promise<void>;
  setNavRailMode: (mode: NavRailMode) => void;
  setInspectorMode: (mode: ContextInspectorMode) => void;
  toggleInspector: () => void;
  setApprovalsOpen: (open: boolean) => void;
  setOnboardingOpen: (open: boolean) => void;
  setPaletteOpen: (open: boolean) => void;
  showToast: (message: string) => void;
  getConsoleHref: (path: string) => string;
  navigateConsole: (path: string) => void;
  retryBootstrap: () => void;
  refreshSnapshot: (overrideMode?: ConsoleMode) => Promise<ConsoleLiveSnapshot | undefined>;
  postStudio: <T = Record<string, unknown>>(path: string, payload?: Record<string, unknown>) => Promise<T>;
  getAdmin: <T = Record<string, unknown>>(path: string, signal?: AbortSignal, targetOverride?: TargetInstance) => Promise<T>;
  postAdmin: <T = Record<string, unknown>>(path: string, payload?: Record<string, unknown>, targetOverride?: TargetInstance) => Promise<T>;
  postProtocol: <T = Record<string, unknown>>(path: string, payload?: Record<string, unknown>) => Promise<T>;
}

const ConsoleContext = createContext<ConsoleContextValue | null>(null);
const THEMES = new Set(["sakura-pink", "astral-blue", "cyber-emerald"]);
const RAILS = new Set(["mini", "expanded", "dual"]);
const INSPECTORS = new Set(["mini", "trace", "sandbox-diff"]);
const LIVE_STUDIO_WRITES = new Set(["config", "co-work-task", "growth-proposal", "sleep-run", "rag-ingest", "instances", "onboarding"]);

export interface ConsoleProviderProps {
  children: ReactNode;
  initialSnapshot?: ConsoleLiveSnapshot;
  initialOwnerToken?: string;
  initialMode?: ConsoleMode;
  initialTheme?: ConsoleSoulTheme;
  initialAppearance?: ConsoleAppearance;
  initialNavRailMode?: NavRailMode;
  initialInspectorMode?: ContextInspectorMode;
  disableAutoFetch?: boolean;
}

interface SnapshotStatus {
  snapshot?: ConsoleLiveSnapshot;
  ready?: boolean;
  error?: string | null;
}

function modeFromSearch(search: URLSearchParams, fallback: ConsoleMode = "live"): ConsoleMode {
  const mode = search.get("mode");
  return mode === "sandbox" || mode === "live" ? mode : fallback;
}

function readAppearance(): ConsoleAppearance | undefined {
  try {
    const value = globalThis.localStorage?.getItem("ai0_appearance");
    return value === "light" || value === "dark" ? value : undefined;
  } catch {
    return undefined;
  }
}

function adminUrl(path: string, target: TargetInstance): string {
  const base = path.startsWith("/api/admin/v1/") ? path : "/api/admin/v1/" + path.replace(/^\//, "");
  const url = new URL(base, "http://console.local");
  if (!url.searchParams.has("target_instance")) url.searchParams.set("target_instance", target);
  return url.pathname + url.search;
}

export function ConsoleProvider(props: ConsoleProviderProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const mode = modeFromSearch(searchParams, props.initialMode);
  const targetInstance = mode === "sandbox" ? "sandbox:console" : "live";
  const [cache, setCache] = useState<Partial<Record<ConsoleMode, SnapshotStatus>>>(() => ({
    [mode]: { snapshot: props.initialSnapshot, ready: Boolean(props.initialSnapshot) }
  }));
  const [ownerToken, setOwnerToken] = useState(props.initialOwnerToken ?? "");
  const [storedAppearance, setStoredAppearance] = useState(readAppearance);
  const [bootVersion, setBootVersion] = useState(0);
  const [approvalsOpen, setApprovalsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshSequence = useRef({ live: 0, sandbox: 0 });
  const editors = useRef(new Map<string, DirtyEditor>());
  const current = cache[mode];
  const snapshot = current?.snapshot;
  const loading = !props.disableAutoFetch && !current?.ready && !current?.error;
  const error = current?.error ?? null;

  const requestedTheme = searchParams.get("soulTheme") ?? searchParams.get("theme");
  const theme = requestedTheme === "cerasus-pink" ? "sakura-pink" : requestedTheme;
  const soulTheme = theme && THEMES.has(theme) ? theme as ConsoleSoulTheme :
    props.initialTheme ?? snapshot?.studioConfig?.systemSettings.soulTheme ??
    cache.live?.snapshot?.studioConfig?.systemSettings.soulTheme ?? "sakura-pink";
  const requestedAppearance = searchParams.get("appearance");
  const appearance = requestedAppearance === "light" || requestedAppearance === "dark" ? requestedAppearance :
    props.initialAppearance ?? storedAppearance ?? snapshot?.studioConfig?.systemSettings.appearance ?? "light";
  const requestedRail = searchParams.get("navRailMode") ?? searchParams.get("rail");
  const navRailMode = requestedRail && RAILS.has(requestedRail) ? requestedRail as NavRailMode :
    props.initialNavRailMode ?? "expanded";
  const requestedInspector = searchParams.get("inspectorMode") ?? searchParams.get("inspector");
  const inspectorMode = requestedInspector && INSPECTORS.has(requestedInspector) ? requestedInspector as ContextInspectorMode :
    props.initialInspectorMode ?? "mini";

  const registerDirtyEditor = useCallback((id: string, editor: DirtyEditor) => {
    editors.current.set(id, editor);
    return () => {
      if (editors.current.get(id) === editor) editors.current.delete(id);
    };
  }, []);
  const dirtyEditors = useCallback(() => Array.from(editors.current.values()).filter((editor) => editor.isDirty()), []);
  const shouldBlock = useCallback<BlockerFunction>(({ currentLocation, nextLocation }) => {
    const changesMode = modeFromSearch(new URLSearchParams(currentLocation.search), props.initialMode) !==
      modeFromSearch(new URLSearchParams(nextLocation.search), props.initialMode);
    return (currentLocation.pathname !== nextLocation.pathname || changesMode) && dirtyEditors().length > 0;
  }, [dirtyEditors, props.initialMode]);
  const blocker = useBlocker(shouldBlock);
  useBeforeUnload(useCallback((event) => {
    if (dirtyEditors().length === 0) return;
    event.preventDefault();
    event.returnValue = "";
  }, [dirtyEditors]));

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMessage(null), 2800);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  const dirtyNavigation = useMemo<ConsoleContextValue["dirtyNavigation"]>(() => {
    if (blocker.state !== "blocked") return null;
    return {
      save: async () => {
        try {
          for (const editor of dirtyEditors()) {
            if (!await editor.save()) return;
          }
          blocker.proceed();
        } catch (error) {
          showToast("保存失败：" + (error instanceof Error ? error.message : String(error)));
        }
      },
      discard: () => {
        for (const editor of dirtyEditors()) editor.discard();
        blocker.proceed();
      },
      stay: blocker.reset
    };
  }, [blocker, dirtyEditors, showToast]);

  const retryBootstrap = useCallback(() => {
    setCache((prev) => ({ ...prev, [mode]: { ...prev[mode], ready: false, error: null } }));
    setBootVersion((value) => value + 1);
  }, [mode]);

  useEffect(() => {
    if (props.disableAutoFetch) return;
    const controller = new AbortController();
    void fetchBootstrap(mode, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      setOwnerToken(result.ownerToken);
      setCache((prev) => ({ ...prev, [mode]: { snapshot: result.snapshot, ready: true, error: null } }));
    }).catch((failure: unknown) => {
      if (controller.signal.aborted) return;
      const message = failure instanceof Error ? failure.message : String(failure);
      setCache((prev) => ({ ...prev, [mode]: { ...prev[mode], error: message } }));
    });
    return () => controller.abort();
  }, [mode, bootVersion, props.disableAutoFetch]);

  const refreshSnapshot = useCallback(async (overrideMode?: ConsoleMode) => {
    const target = overrideMode ?? mode;
    const sequence = ++refreshSequence.current[target];
    try {
      const next = await fetchSnapshot(target);
      if (sequence === refreshSequence.current[target]) {
        setCache((prev) => ({ ...prev, [target]: {
          ...prev[target], snapshot: next, error: prev[target]?.ready ? null : prev[target]?.error
        } }));
      }
      return next;
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : String(failure);
      if (sequence === refreshSequence.current[target]) {
        setCache((prev) => ({ ...prev, [target]: { ...prev[target], error: message } }));
      }
      return undefined;
    }
  }, [mode]);

  useEffect(() => {
    if (props.disableAutoFetch || !current?.ready) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeTelemetryStream((frame) => {
      const event = frame as { target_instance?: string; payload?: { connected?: boolean } } | null;
      if (event?.payload?.connected || (event?.target_instance && event.target_instance !== targetInstance)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refreshSnapshot(), 450);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [current?.ready, props.disableAutoFetch, refreshSnapshot, targetInstance]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (event.isComposing || event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      }
    }
    document.addEventListener("keydown", handleShortcut);
    return () => document.removeEventListener("keydown", handleShortcut);
  }, []);

  const syncQueryParam = useCallback((key: string, value: string, alias?: string, replace = true) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (alias) next.delete(alias);
      next.set(key, value);
      return next;
    }, { replace });
  }, [setSearchParams]);

  const setMode = useCallback((next: ConsoleMode) => {
    if (mode !== next) syncQueryParam("mode", next, undefined, false);
  }, [mode, syncQueryParam]);
  const setNavRailMode = useCallback((next: NavRailMode) => syncQueryParam("rail", next, "navRailMode"), [syncQueryParam]);
  const setInspectorMode = useCallback((next: ContextInspectorMode) => syncQueryParam("inspector", next, "inspectorMode"), [syncQueryParam]);
  const toggleInspector = useCallback(() => setInspectorMode(inspectorMode === "mini" ? "trace" : "mini"), [inspectorMode, setInspectorMode]);

  const postStudio = useCallback(async <T = Record<string, unknown>>(
    path: string, payload: Record<string, unknown> = {}
  ): Promise<T> => {
    const endpoint = path.replace(/^\/api\/studio\//, "").replace(/^\//, "");
    if (mode === "sandbox" && (LIVE_STUDIO_WRITES.has(endpoint) || (endpoint === "distill-apply" && payload.apply === true))) {
      throw new Error("此操作写入正式存档，请切换至 LIVE 后执行。");
    }
    return postJson<T>("/api/studio/" + endpoint, payload, ownerToken);
  }, [mode, ownerToken]);
  const getAdmin = useCallback(<T,>(path: string, signal?: AbortSignal, target?: TargetInstance) =>
    getJson<T>(adminUrl(path, target ?? targetInstance), ownerToken, signal), [ownerToken, targetInstance]);
  const postAdmin = useCallback(<T,>(path: string, payload?: Record<string, unknown>, target?: TargetInstance) =>
    postJson<T>(adminUrl(path, target ?? targetInstance), payload, ownerToken), [ownerToken, targetInstance]);
  const postProtocol = useCallback(<T,>(path: string, payload?: Record<string, unknown>) =>
    postJson<T>(path.startsWith("/protocol/") ? path : "/protocol/" + path.replace(/^\//, ""), payload, ownerToken), [ownerToken]);

  const setSoulTheme = useCallback(async (next: ConsoleSoulTheme) => {
    syncQueryParam("theme", next, "soulTheme");
    if (mode === "live" && ownerToken) {
      try { await postStudio("config", { systemSettings: { soulTheme: next } }); }
      catch { showToast("主题已在本页切换，存档保存失败。"); }
    }
  }, [mode, ownerToken, postStudio, showToast, syncQueryParam]);
  const setAppearance = useCallback(async (next: ConsoleAppearance) => {
    setStoredAppearance(next);
    syncQueryParam("appearance", next);
    try { globalThis.localStorage?.setItem("ai0_appearance", next); } catch { /* storage unavailable */ }
    if (mode === "live" && ownerToken) {
      try { await postStudio("config", { systemSettings: { appearance: next } }); }
      catch { showToast("外观已在本页切换，存档保存失败。"); }
    }
  }, [mode, ownerToken, postStudio, showToast, syncQueryParam]);
  const toggleAppearance = useCallback(() => setAppearance(appearance === "dark" ? "light" : "dark"), [appearance, setAppearance]);

  const getConsoleHref = useCallback((path: string) => {
    const target = new URL(path, "http://console.local");
    const params = new URLSearchParams(searchParams);
    target.searchParams.forEach((value, key) => params.set(key, value));
    const query = params.toString();
    return target.pathname + (query ? "?" + query : "") + target.hash;
  }, [searchParams]);
  const navigateConsole = useCallback((path: string) => void navigate(getConsoleHref(path)), [getConsoleHref, navigate]);

  const value: ConsoleContextValue = {
    snapshot, loading, error, ownerToken, mode, targetInstance, soulTheme, appearance, navRailMode, inspectorMode,
    approvalsOpen, onboardingOpen, paletteOpen, toastMessage, dirtyNavigation, registerDirtyEditor, setMode,
    setSoulTheme, setAppearance, toggleAppearance, setNavRailMode, setInspectorMode, toggleInspector, setApprovalsOpen,
    setOnboardingOpen, setPaletteOpen, showToast, getConsoleHref, navigateConsole, retryBootstrap, refreshSnapshot,
    postStudio, getAdmin, postAdmin, postProtocol
  };

  return <ConsoleContext.Provider value={value}>{props.children}</ConsoleContext.Provider>;
}

export function useConsole(): ConsoleContextValue | null {
  return useContext(ConsoleContext);
}
