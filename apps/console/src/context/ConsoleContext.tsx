import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { useNavigate, useSearchParams } from "react-router";

import {
  fetchBootstrap,
  fetchSnapshot,
  postJson,
  subscribeTelemetryStream,
  type ConsoleMode
} from "../api/client.js";
import type { ContextInspectorMode, NavRailMode } from "../design-system/shell/index.js";
import type { ConsoleSoulTheme } from "../design-system/tokens/index.js";
import type { ConsoleLiveSnapshot } from "../live-snapshot.js";

export type ConsoleAppearance = "light" | "dark";

export interface ConsoleContextValue {
  snapshot: ConsoleLiveSnapshot | undefined;
  loading: boolean;
  error: string | null;
  ownerToken: string;
  mode: ConsoleMode;
  targetInstance: "live" | "sandbox:console";
  soulTheme: ConsoleSoulTheme;
  appearance: ConsoleAppearance;
  navRailMode: NavRailMode;
  inspectorMode: ContextInspectorMode;
  approvalsOpen: boolean;
  onboardingOpen: boolean;
  paletteOpen: boolean;
  toastMessage: string | null;
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
  navigateConsole: (path: string) => void;
  refreshSnapshot: (overrideMode?: ConsoleMode) => Promise<ConsoleLiveSnapshot | undefined>;
  postStudio: <T = Record<string, unknown>>(
    path: string,
    payload?: Record<string, unknown>
  ) => Promise<T>;
  postAdmin: <T = Record<string, unknown>>(
    path: string,
    payload?: Record<string, unknown>,
    targetOverride?: "live" | "sandbox:console"
  ) => Promise<T>;
  postProtocol: <T = Record<string, unknown>>(
    path: string,
    payload?: Record<string, unknown>
  ) => Promise<T>;
}

const VALID_THEMES = new Set<ConsoleSoulTheme>(["sakura-pink", "astral-blue", "cyber-emerald"]);
const VALID_RAILS = new Set<NavRailMode>(["mini", "expanded", "dual"]);
const VALID_INSPECTORS = new Set<ContextInspectorMode>(["mini", "trace", "sandbox-diff"]);

function normalizeSoulTheme(raw?: string | null): ConsoleSoulTheme | undefined {
  if (!raw) return undefined;
  const candidate = raw === "cerasus-pink" ? "sakura-pink" : raw;
  return VALID_THEMES.has(candidate as ConsoleSoulTheme)
    ? (candidate as ConsoleSoulTheme)
    : undefined;
}

const ConsoleContext = createContext<ConsoleContextValue | null>(null);

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

function readStoredAppearance(): ConsoleAppearance | undefined {
  try {
    const saved = globalThis.localStorage?.getItem("ai0_appearance");
    if (saved === "dark" || saved === "light") return saved;
  } catch {
    // Ignore storage access errors in SSR/private mode
  }
  return undefined;
}

export function ConsoleProvider(props: ConsoleProviderProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const urlMode = searchParams.get("mode") === "sandbox" ? "sandbox" : undefined;
  const rawTheme = searchParams.get("soulTheme") ?? searchParams.get("theme");
  const urlTheme = normalizeSoulTheme(rawTheme);
  const rawAppearance = searchParams.get("appearance");
  const urlAppearance =
    rawAppearance === "dark" || rawAppearance === "light" ? rawAppearance : undefined;
  const rawRail = searchParams.get("navRailMode") ?? searchParams.get("rail");
  const urlRail = rawRail && VALID_RAILS.has(rawRail as NavRailMode)
    ? (rawRail as NavRailMode)
    : undefined;
  const rawInspector = searchParams.get("inspectorMode") ?? searchParams.get("inspector");
  const urlInspector =
    rawInspector && VALID_INSPECTORS.has(rawInspector as ContextInspectorMode)
      ? (rawInspector as ContextInspectorMode)
      : undefined;

  const [snapshot, setSnapshot] = useState<ConsoleLiveSnapshot | undefined>(props.initialSnapshot);
  const [ownerToken, setOwnerToken] = useState<string>(props.initialOwnerToken ?? "");
  const [loading, setLoading] = useState<boolean>(!props.initialSnapshot && !props.disableAutoFetch);
  const [error, setError] = useState<string | null>(null);

  const [mode, setModeState] = useState<ConsoleMode>(props.initialMode ?? urlMode ?? "live");
  const [soulTheme, setSoulThemeState] = useState<ConsoleSoulTheme>(
    normalizeSoulTheme(props.initialTheme) ??
      urlTheme ??
      normalizeSoulTheme(props.initialSnapshot?.studioConfig?.systemSettings.soulTheme) ??
      "sakura-pink"
  );
  const [appearance, setAppearanceState] = useState<ConsoleAppearance>(
    props.initialAppearance ??
      urlAppearance ??
      readStoredAppearance() ??
      props.initialSnapshot?.studioConfig?.systemSettings.appearance ??
      "light"
  );
  const [navRailMode, setNavRailModeState] = useState<NavRailMode>(
    props.initialNavRailMode ?? urlRail ?? "expanded"
  );
  const [inspectorMode, setInspectorModeState] = useState<ContextInspectorMode>(
    props.initialInspectorMode ?? urlInspector ?? "mini"
  );
  const [approvalsOpen, setApprovalsOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const targetInstance: "live" | "sandbox:console" =
    mode === "sandbox" ? "sandbox:console" : "live";

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMessage(null);
    }, 2600);
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    };
  }, []);

  const refreshSnapshot = useCallback(
    async (overrideMode?: ConsoleMode): Promise<ConsoleLiveSnapshot | undefined> => {
      const targetMode = overrideMode ?? mode;
      try {
        const next = await fetchSnapshot(targetMode);
        setSnapshot(next);
        setError(null);
        return next;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        return undefined;
      }
    },
    [mode]
  );

  // Initial bootstrap + refetch on mode change
  useEffect(() => {
    if (props.disableAutoFetch) return;
    let active = true;
    setLoading((prev) => prev || !snapshot);
    void fetchBootstrap(mode)
      .then((res) => {
        if (!active) return;
        setOwnerToken(res.ownerToken);
        setSnapshot(res.snapshot);
        setError(null);
        if (!urlTheme && !props.initialTheme && res.snapshot.studioConfig?.systemSettings.soulTheme) {
          setSoulThemeState(res.snapshot.studioConfig.systemSettings.soulTheme);
        }
        if (
          !urlAppearance &&
          !props.initialAppearance &&
          !readStoredAppearance() &&
          res.snapshot.studioConfig?.systemSettings.appearance
        ) {
          setAppearanceState(res.snapshot.studioConfig.systemSettings.appearance);
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, props.disableAutoFetch]);

  // Live telemetry SSE subscription (refreshes snapshot lightly on meaningful events)
  useEffect(() => {
    if (props.disableAutoFetch) return;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeTelemetryStream((frame) => {
      const rec = frame as { track?: string; payload?: { connected?: boolean } };
      if (rec?.payload?.connected) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void refreshSnapshot();
      }, 450);
    });
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubscribe();
    };
  }, [props.disableAutoFetch, refreshSnapshot]);

  // Global keyboard shortcuts (Cmd/Ctrl+K and Escape)
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
      } else if (event.key === "Escape") {
        setPaletteOpen(false);
        setOnboardingOpen(false);
        setApprovalsOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const syncQueryParam = useCallback(
    (key: string, value: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(key, value);
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const postStudio = useCallback(
    async <T = Record<string, unknown>>(
      path: string,
      payload: Record<string, unknown> = {}
    ): Promise<T> => {
      const url = path.startsWith("/api/studio/") ? path : `/api/studio/${path.replace(/^\//, "")}`;
      return postJson<T>(url, payload, ownerToken);
    },
    [ownerToken]
  );

  const postAdmin = useCallback(
    async <T = Record<string, unknown>>(
      path: string,
      payload: Record<string, unknown> = {},
      targetOverride?: "live" | "sandbox:console"
    ): Promise<T> => {
      const base = path.startsWith("/api/admin/v1/")
        ? path
        : `/api/admin/v1/${path.replace(/^\//, "")}`;
      const sep = base.includes("?") ? "&" : "?";
      const target = targetOverride ?? targetInstance;
      const url = base.includes("target_instance=")
        ? base
        : `${base}${sep}target_instance=${encodeURIComponent(target)}`;
      return postJson<T>(url, payload, ownerToken);
    },
    [ownerToken, targetInstance]
  );

  const postProtocol = useCallback(
    async <T = Record<string, unknown>>(
      path: string,
      payload: Record<string, unknown> = {}
    ): Promise<T> => {
      const url = path.startsWith("/protocol/") ? path : `/protocol/${path.replace(/^\//, "")}`;
      return postJson<T>(url, payload, ownerToken);
    },
    [ownerToken]
  );

  const setMode = useCallback(
    (nextMode: ConsoleMode) => {
      setModeState(nextMode);
      syncQueryParam("mode", nextMode);
    },
    [syncQueryParam]
  );

  const setSoulTheme = useCallback(
    async (nextTheme: ConsoleSoulTheme) => {
      setSoulThemeState(nextTheme);
      syncQueryParam("theme", nextTheme);
      try {
        await postStudio("/api/studio/config", { systemSettings: { soulTheme: nextTheme } });
      } catch {
        // Optimistic local update even if offline
      }
      showToast("已更新主题色配置");
    },
    [postStudio, showToast, syncQueryParam]
  );

  const setAppearance = useCallback(
    async (next: ConsoleAppearance) => {
      setAppearanceState(next);
      try {
        globalThis.localStorage?.setItem("ai0_appearance", next);
      } catch {
        // Ignore storage write errors
      }
      try {
        await postStudio("/api/studio/config", { systemSettings: { appearance: next } });
      } catch {
        // Optimistic local update even if offline
      }
      showToast(next === "dark" ? "已切换为深色外观" : "已切换为浅色外观");
    },
    [postStudio, showToast]
  );

  const toggleAppearance = useCallback(async () => {
    await setAppearance(appearance === "dark" ? "light" : "dark");
  }, [appearance, setAppearance]);

  const setNavRailMode = useCallback((next: NavRailMode) => {
    setNavRailModeState(next);
  }, []);

  const setInspectorMode = useCallback(
    (next: ContextInspectorMode) => {
      setInspectorModeState(next);
      syncQueryParam("inspector", next);
    },
    [syncQueryParam]
  );

  const toggleInspector = useCallback(() => {
    setInspectorMode(inspectorMode === "trace" ? "mini" : "trace");
  }, [inspectorMode, setInspectorMode]);

  const navigateConsole = useCallback(
    (path: string) => {
      const targetUrl = new URL(path, "http://console.local");
      const merged = new URLSearchParams(searchParams);
      targetUrl.searchParams.forEach((value, key) => {
        merged.set(key, value);
      });
      const qs = merged.toString();
      void navigate(qs ? `${targetUrl.pathname}?${qs}` : targetUrl.pathname);
    },
    [navigate, searchParams]
  );

  const value = useMemo<ConsoleContextValue>(
    () => ({
      snapshot,
      loading,
      error,
      ownerToken,
      mode,
      targetInstance,
      soulTheme,
      appearance,
      navRailMode,
      inspectorMode,
      approvalsOpen,
      onboardingOpen,
      paletteOpen,
      toastMessage,
      setMode,
      setSoulTheme,
      setAppearance,
      toggleAppearance,
      setNavRailMode,
      setInspectorMode,
      toggleInspector,
      setApprovalsOpen,
      setOnboardingOpen,
      setPaletteOpen,
      showToast,
      navigateConsole,
      refreshSnapshot,
      postStudio,
      postAdmin,
      postProtocol
    }),
    [
      snapshot,
      loading,
      error,
      ownerToken,
      mode,
      targetInstance,
      soulTheme,
      appearance,
      navRailMode,
      inspectorMode,
      approvalsOpen,
      onboardingOpen,
      paletteOpen,
      toastMessage,
      setMode,
      setSoulTheme,
      setAppearance,
      toggleAppearance,
      setNavRailMode,
      setInspectorMode,
      toggleInspector,
      showToast,
      navigateConsole,
      refreshSnapshot,
      postStudio,
      postAdmin,
      postProtocol
    ]
  );

  return <ConsoleContext.Provider value={value}>{props.children}</ConsoleContext.Provider>;
}

export function useConsole(): ConsoleContextValue | null {
  return useContext(ConsoleContext);
}
