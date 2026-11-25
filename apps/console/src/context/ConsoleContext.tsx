import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode
} from "react";
import { useBeforeUnload, useBlocker, useLocation, useNavigate, type BlockerFunction } from "react-router";

import {
  BootstrapUnavailableError, deleteJson, fetchBootstrap, fetchSnapshot, getJson, patchJson, postJson, putJson,
  subscribeTelemetryStream, type ConsoleMode
} from "../api/client.js";
import type { ContextInspectorMode, NavRailMode } from "../design-system/shell/index.js";
import type { ConsoleSoulTheme } from "../design-system/tokens/index.js";
import type { ConsoleLiveSnapshot } from "../live-snapshot.js";
import { useConsolePreferences, type ConsolePreferences } from "./console-preferences.js";

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
  canEditPreferences: boolean;
  preferencesSaving: boolean;
  inspectorView: ConsolePreferences["inspectorView"];
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
  setNavRailMode: (mode: NavRailMode) => Promise<void>;
  setInspectorView: (view: ConsolePreferences["inspectorView"]) => Promise<void>;
  closeInspector: () => void;
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
  patchAdmin: <T = Record<string, unknown>>(path: string, payload?: Record<string, unknown>, targetOverride?: TargetInstance) => Promise<T>;
  putAdmin: <T = Record<string, unknown>>(path: string, payload?: Record<string, unknown>, targetOverride?: TargetInstance) => Promise<T>;
  deleteAdmin: <T = Record<string, unknown>>(path: string, targetOverride?: TargetInstance) => Promise<T>;
  postProtocol: <T = Record<string, unknown>>(path: string, payload?: Record<string, unknown>) => Promise<T>;
}

const ConsoleContext = createContext<ConsoleContextValue | null>(null);
const RETIRED_PREFERENCE_PARAMS = ["theme", "soulTheme", "appearance", "rail", "navRailMode", "inspector", "inspectorMode"];
const LIVE_STUDIO_WRITES = new Set([
  "config", "plugin-enabled", "co-work-task", "growth-proposal", "sleep-run", "rag-ingest", "instances",
  "onboarding", "host-claim", "cards", "souls/awaken", "souls/select"
]);

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

function routeSearchParams(search: string): URLSearchParams {
  const params = new URLSearchParams(search);
  for (const key of RETIRED_PREFERENCE_PARAMS) params.delete(key);
  return params;
}

function adminUrl(path: string, target: TargetInstance): string {
  const base = path.startsWith("/api/admin/v1/") ? path : "/api/admin/v1/" + path.replace(/^\//, "");
  const url = new URL(base, "http://console.local");
  if (!url.searchParams.has("target_instance")) url.searchParams.set("target_instance", target);
  return url.pathname + url.search;
}

export function ConsoleProvider(props: ConsoleProviderProps) {
  const { pathname, search, hash, state: locationState } = useLocation();
  const searchParams = useMemo(() => routeSearchParams(search), [search]);
  const navigate = useNavigate();
  const mode = modeFromSearch(searchParams, props.initialMode);
  const targetInstance = mode === "sandbox" ? "sandbox:console" : "live";
  const [cache, setCache] = useState<Partial<Record<ConsoleMode, SnapshotStatus>>>(() => ({
    [mode]: { snapshot: props.initialSnapshot, ready: Boolean(props.initialSnapshot) }
  }));
  const [ownerToken, setOwnerToken] = useState(props.initialOwnerToken ?? "");
  const [bootVersion, setBootVersion] = useState(0);
  const [inspectorOpen, setInspectorOpen] = useState(() =>
    Boolean(props.initialInspectorMode && props.initialInspectorMode !== "mini")
  );
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

  const canEditPreferences = Boolean(mode === "live" && ownerToken && current?.ready);
  const { preferences, saving: preferencesSaving, beginRead, save: savePreferences } = useConsolePreferences(
    props.initialSnapshot, ownerToken, canEditPreferences, showToast
  );
  const soulTheme = props.initialTheme ?? preferences.soulTheme;
  const appearance = props.initialAppearance ?? preferences.appearance;
  const navRailMode = props.initialNavRailMode ?? preferences.navRailMode;
  const inspectorView = props.initialInspectorMode && props.initialInspectorMode !== "mini"
    ? props.initialInspectorMode : preferences.inspectorView;
  const inspectorMode = inspectorOpen ? inspectorView : "mini";

  useEffect(() => {
    const currentParams = new URLSearchParams(search);
    if (!RETIRED_PREFERENCE_PARAMS.some((key) => currentParams.has(key))) return;
    void navigate({ pathname, search: searchParams.toString(), hash }, { replace: true, state: locationState });
  }, [hash, locationState, navigate, pathname, search, searchParams]);

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
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = 1500;
    async function connect() {
      const acceptPreferences = beginRead();
      try {
        const result = await fetchBootstrap(mode, controller.signal);
        if (controller.signal.aborted) return;
        acceptPreferences(result.snapshot);
        setOwnerToken(result.ownerToken);
        if (mode === "live" && result.snapshot.hasAwakenedSoul === false) setOnboardingOpen(true);
        setCache(prev => ({ ...prev, [mode]: { snapshot: result.snapshot, ready: true, error: null } }));
      } catch (failure) {
        if (controller.signal.aborted) return;
        const message = failure instanceof Error ? failure.message : String(failure);
        setCache(prev => ({ ...prev, [mode]: { ...prev[mode], error: message } }));
        if (failure instanceof BootstrapUnavailableError || failure instanceof TypeError) {
          timer = setTimeout(() => void connect(), delay);
          delay = Math.min(delay * 2, 15000);
        }
      }
    }
    void connect();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [beginRead, mode, bootVersion, props.disableAutoFetch]);

  const refreshSnapshot = useCallback(async (overrideMode?: ConsoleMode) => {
    const target = overrideMode ?? mode;
    const sequence = ++refreshSequence.current[target];
    const acceptPreferences = beginRead();
    try {
      const next = await fetchSnapshot(target);
      if (sequence === refreshSequence.current[target]) {
        acceptPreferences(next);
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
  }, [beginRead, mode]);

  useEffect(() => {
    if (props.disableAutoFetch || !current?.ready) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = setInterval(() => void refreshSnapshot(), 5000);
    const unsubscribe = subscribeTelemetryStream((frame) => {
      const event = frame as { target_instance?: string; payload?: { connected?: boolean } } | null;
      if (event?.target_instance && event.target_instance !== targetInstance) return;
      if (event?.payload?.connected) { void refreshSnapshot(); return; }
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refreshSnapshot(), 450);
    });
    return () => {
      if (timer) clearTimeout(timer);
      clearInterval(poll);
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

  const setMode = useCallback((next: ConsoleMode) => {
    if (mode === next) return;
    const params = new URLSearchParams(searchParams);
    params.set("mode", next);
    void navigate({ pathname, search: params.toString(), hash });
  }, [hash, mode, navigate, pathname, searchParams]);
  const closeInspector = useCallback(() => setInspectorOpen(false), []);
  const toggleInspector = useCallback(() => setInspectorOpen((open) => !open), []);

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
  const patchAdmin = useCallback(<T,>(path: string, payload?: Record<string, unknown>, target?: TargetInstance) =>
    patchJson<T>(adminUrl(path, target ?? targetInstance), payload, ownerToken), [ownerToken, targetInstance]);
  const putAdmin = useCallback(<T,>(path: string, payload?: Record<string, unknown>, target?: TargetInstance) =>
    putJson<T>(adminUrl(path, target ?? targetInstance), payload, ownerToken), [ownerToken, targetInstance]);
  const deleteAdmin = useCallback(<T,>(path: string, target?: TargetInstance) =>
    deleteJson<T>(adminUrl(path, target ?? targetInstance), ownerToken), [ownerToken, targetInstance]);
  const postProtocol = useCallback(<T,>(path: string, payload?: Record<string, unknown>) =>
    postJson<T>(path.startsWith("/protocol/") ? path : "/protocol/" + path.replace(/^\//, ""), payload, ownerToken), [ownerToken]);

  const setSoulTheme = useCallback((next: ConsoleSoulTheme) => savePreferences({ soulTheme: next }), [savePreferences]);
  const setAppearance = useCallback((next: ConsoleAppearance) => savePreferences({ appearance: next }), [savePreferences]);
  const setNavRailMode = useCallback((next: NavRailMode) => savePreferences({ navRailMode: next }), [savePreferences]);
  const setInspectorView = useCallback((next: ConsolePreferences["inspectorView"]) =>
    savePreferences({ inspectorView: next }), [savePreferences]);
  const toggleAppearance = useCallback(() => setAppearance(appearance === "dark" ? "light" : "dark"), [appearance, setAppearance]);

  const getConsoleHref = useCallback((path: string) => {
    const target = new URL(path, "http://console.local");
    const params = new URLSearchParams(searchParams);
    routeSearchParams(target.search).forEach((value, key) => params.set(key, value));
    const query = params.toString();
    return target.pathname + (query ? "?" + query : "") + target.hash;
  }, [searchParams]);
  const navigateConsole = useCallback((path: string) => void navigate(getConsoleHref(path)), [getConsoleHref, navigate]);

  const value: ConsoleContextValue = {
    snapshot, loading, error, ownerToken, mode, targetInstance, soulTheme, appearance, navRailMode, canEditPreferences,
    preferencesSaving, inspectorView, inspectorMode,
    approvalsOpen, onboardingOpen, paletteOpen, toastMessage, dirtyNavigation, registerDirtyEditor, setMode,
    setSoulTheme, setAppearance, toggleAppearance, setNavRailMode, setInspectorView, closeInspector, toggleInspector, setApprovalsOpen,
    setOnboardingOpen, setPaletteOpen, showToast, getConsoleHref, navigateConsole, retryBootstrap, refreshSnapshot,
    postStudio, getAdmin, postAdmin, patchAdmin, putAdmin, deleteAdmin, postProtocol
  };

  return <ConsoleContext.Provider value={value}>{props.children}</ConsoleContext.Provider>;
}

export function useConsole(): ConsoleContextValue | null {
  return useContext(ConsoleContext);
}
