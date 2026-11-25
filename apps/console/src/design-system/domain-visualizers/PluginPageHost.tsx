import type { RegisteredPage } from "../../router/plugin-pages.js";
import { useExtensionComposition } from "../../context/ExtensionContext.js";
import type { VerifiableTurnTrace } from "@ai0/protocol";
import type {
  Ai0ShellStageCleanup,
  Ai0ShellStageHostBridge,
  Ai0ShellStageHostState,
  Ai0ShellStageModule,
  ConsolePageModule,
  ConsolePageState,
  Ai0StageMode
} from "@ai0/sdk";
import { useEffect, useMemo, useRef, useState } from "react";

import { useConsole } from "../../context/ConsoleContext.js";
import type { ConsoleLiveSnapshot } from "../../live-snapshot.js";
import { RippleButton } from "../primitives/RippleButton.js";

function pageState({ mode, targetInstance, soulId, personaName, soulTheme, appearance, journal }: Ai0ShellStageHostState): ConsolePageState {
  return { mode, targetInstance, soulId, personaName, soulTheme, appearance, journal };
}

async function loadStyles(urls: readonly string[], signal: AbortSignal): Promise<void> {
  await Promise.all(urls.map(href => new Promise<void>((resolve, reject) => {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.onload = () => resolve();
    link.onerror = () => reject(new Error("无法加载样式 " + href));
    signal.addEventListener("abort", () => {
      link.onload = link.onerror = null;
      link.remove();
      resolve();
    }, { once: true });
    document.head.appendChild(link);
  })));
}

export function PluginPageHost({ page, snapshot }: { page: RegisteredPage; snapshot?: ConsoleLiveSnapshot }) {
  const ctx = useConsole();
  const composition = useExtensionComposition();
  const pluginId = page.pluginId;
  const generation = page.generation ?? "";
  const [stageTokenState, setStageTokenState] = useState<{ key: string; token: string; shellId: string } | null>(null);
  const [mountStatus, setMountStatus] = useState<"idle" | "loading" | "mounted" | "error">("idle");
  const [mountError, setMountError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const shellId = page.shell_id ?? "";
  const ownerToken = ctx?.ownerToken ?? "";
  const mode: Ai0StageMode = ctx?.mode ?? (snapshot?.targetInstance === "sandbox:console" ? "sandbox" : "live");
  const targetInstance = mode === "sandbox" ? "sandbox:console" : "live";
  const tokenRequestKey = JSON.stringify([pluginId, page.path, ownerToken, mode, generation, snapshot?.soulId]);

  // Mint a Channel A ScopedCapabilityToken for this mounted stage (Zero-Privilege isolation).
  useEffect(() => {
    if (typeof window === "undefined" || !ownerToken || !shellId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const refreshToken = async () => {
      let delay = 3000;
      try {
        const response = await fetch("/api/plugins/" + encodeURIComponent(pluginId) + "/shell-token?mode=" + mode + "&page=" + encodeURIComponent(page.path), {
          method: "POST", cache: "no-store", signal: controller.signal, headers: { "x-ai0-owner-token": ownerToken }
        });
        if (response.ok) {
          const data = await response.json();
          if (!controller.signal.aborted && data.token) {
            setStageTokenState({ key: tokenRequestKey, token: data.token, shellId: data.shellId ?? shellId });
            delay = Math.max(3000, (data.expiresAt ?? Date.now() + 3600000) - Date.now() - 60000);
          }
        }
      } catch { /* Retry transient transport failures while mounted. */ }
      if (!controller.signal.aborted) timer = setTimeout(() => void refreshToken(), delay);
    };
    void refreshToken();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [ownerToken, pluginId, shellId, page.path, mode, tokenRequestKey]);

  const activeStageToken = stageTokenState?.key === tokenRequestKey ? stageTokenState.token : "";
  const activeShellId = stageTokenState?.key === tokenRequestKey ? stageTokenState.shellId : shellId;

  const shellConnected = snapshot?.connectedShellIds?.includes(activeShellId) ?? false;
  const canReadJournal = snapshot?.extensions.find(ext => ext.id === pluginId)?.readDomains.includes("D3_MEMORY_PROJECTION");
  const hostState = useMemo<Ai0ShellStageHostState>(
    () => ({
      mode,
      targetInstance,
      soulId: snapshot?.soulId,
      personaName: snapshot?.personaName || "未唤醒",
      soulTheme: ctx?.soulTheme ?? snapshot?.studioConfig?.systemSettings.soulTheme ?? "sakura-pink",
      appearance: ctx?.appearance ?? snapshot?.studioConfig?.systemSettings.appearance ?? "light",
      connected: shellConnected,
      loading: Boolean(ctx?.loading),
      error: ctx?.error ?? undefined,
      protocolBasePath: "/protocol/v0/shell",
      authToken: activeStageToken,
      journal: canReadJournal ? snapshot?.sleepJournal : undefined,
      recentTraces: []
    }),
    [
      activeStageToken,
      shellConnected,
      canReadJournal,
      ctx?.appearance,
      ctx?.error,
      ctx?.loading,
      ctx?.soulTheme,
      mode,
      snapshot?.personaName,
      snapshot?.sleepJournal,
      pluginId,
      snapshot?.soulId,
      snapshot?.studioConfig?.systemSettings.appearance,
      snapshot?.studioConfig?.systemSettings.soulTheme,
      targetInstance
    ]
  );

  const stateRef = useRef<Ai0ShellStageHostState>(hostState);
  const listenersRef = useRef(new Set<(state: Ai0ShellStageHostState) => void>());
  const ctxRef = useRef(ctx);
  const shellIdRef = useRef(activeShellId);
  ctxRef.current = ctx;
  shellIdRef.current = activeShellId;

  useEffect(() => {
    stateRef.current = hostState;
    for (const listener of listenersRef.current) {
      try {
        listener(hostState);
      } catch {
        // Isolate plugin subscriber exceptions from console host.
      }
    }
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(
        { type: "ai0.stage.host_state", state: hostState },
        "*"
      );
    }
  }, [hostState]);

  const entryModuleUrl = page.entry_module_url;
  const styleSheetKey = (page.style_sheet_urls ?? []).join("|");
  const iframeSrcUrl = page.iframe_src_url;

  useEffect(() => {
    if (typeof window === "undefined" || !composition || !entryModuleUrl) return;
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    const styles = new AbortController();
    let cleanup: Ai0ShellStageCleanup | undefined;
    setMountStatus("loading");
    setMountError(null);

    const styleUrls = styleSheetKey ? styleSheetKey.split("|") : [];
    const binding = composition.mount(pluginId, contributions => {
      const subscribers = new Set<(state: Ai0ShellStageHostState) => void>();
      const bridge: Ai0ShellStageHostBridge = {
        contributions,
        extensionId: pluginId,
        get shellId() {
          return shellIdRef.current;
        },
        getState: () => stateRef.current,
        subscribe: (listener) => {
          if (cancelled) return () => {};
          subscribers.add(listener);
          listenersRef.current.add(listener);
          return () => {
            subscribers.delete(listener);
            listenersRef.current.delete(listener);
          };
        },
        showToast: (message) => ctxRef.current?.showToast(message),
        retryConnection: () => ctxRef.current?.retryBootstrap(),
        fetchTurnTrace: async ({ requestId, mode: traceMode, signal }) => {
          const currentCtx = ctxRef.current;
          if (!currentCtx?.ownerToken) return undefined;
          const token = stateRef.current.authToken;
          if (!token || traceMode !== stateRef.current.mode) return undefined;
          if (requestId) {
            const path = "/protocol/v0/shell/runs/" + encodeURIComponent(requestId);
            const scopeCheck = await fetch(path + "?mode=" + traceMode, {
              signal, cache: "no-store", headers: { authorization: "Bearer " + token }
            });
            if (!scopeCheck.ok) return undefined;
            const response = await fetch(
              `/protocol/v0/shell/runs/${encodeURIComponent(requestId)}/trace?mode=${traceMode}&shellId=${encodeURIComponent(shellIdRef.current)}`,
              {
                signal,
                cache: "no-store",
                headers: { "x-ai0-owner-token": currentCtx.ownerToken }
              }
            );
            if (!response.ok) return undefined;
            const payload = (await response.json()) as { trace?: VerifiableTurnTrace };
            return payload.trace;
          }
          return undefined;
        }
      };

      void (async () => {
        try {
          await loadStyles(styleUrls.map(url => url + "?v=" + encodeURIComponent(generation)), styles.signal);
          if (cancelled) return;
          const moduleUrl = entryModuleUrl + "?v=" + encodeURIComponent(generation);
          const loaded = (await import(/* @vite-ignore */ moduleUrl)) as Partial<
            ConsolePageModule<HTMLElement> & Ai0ShellStageModule<HTMLElement> & { default?: Partial<ConsolePageModule<HTMLElement> & Ai0ShellStageModule<HTMLElement>> }
          >;
          if (cancelled) return;
          const mountPage = loaded.mountPage ?? loaded.default?.mountPage;
          const legacyMount = loaded.mountShellStage ?? loaded.default?.mountShellStage;
          if (mountPage) {
            cleanup = await mountPage(container, {
              extensionId: pluginId,
              contributions,
              shell: shellId ? bridge : undefined,
              getState: () => pageState(bridge.getState()),
              subscribe: callback => bridge.subscribe(state => callback(pageState(state))),
              showToast: bridge.showToast
            });
          } else if (legacyMount && shellId) {
            cleanup = await legacyMount(container, bridge);
          } else {
            throw new TypeError("Plugin " + pluginId + " must export mountPage().");
          }
          if (cancelled) {
            if (typeof cleanup === "function") cleanup();
            else cleanup?.unmount();
            return;
          }
          setMountStatus("mounted");
        } catch (err) {
          if (!cancelled) {
            setMountStatus("error");
            setMountError(err instanceof Error ? err.message : String(err));
            await binding.dispose();
          }
        }
      })();

      contributions.effect(() => () => {
        cancelled = true;
        try {
          if (typeof cleanup === "function") cleanup();
          else cleanup?.unmount();
        } finally {
          for (const listener of subscribers) listenersRef.current.delete(listener);
          subscribers.clear();
          container.replaceChildren();
          styles.abort();
        }
      });
    });
    return () => { void binding.dispose(); };
  }, [composition, entryModuleUrl, generation, pluginId, shellId, styleSheetKey]);

  if (iframeSrcUrl) {
    return (
      <section
        className="ai0-plugin-frame"
        data-page-owner={pluginId}
        style={{ height: "100%", minHeight: 0, minWidth: 0 }}
        aria-label={page.title ?? pluginId}
      >
        <iframe
          ref={iframeRef}
          className="ai0-plugin-frame__iframe"
          sandbox="allow-scripts"
          title={page.title ?? pluginId}
          src={iframeSrcUrl}
          style={{ width: "100%", height: "100%", border: 0, display: "block" }}
          onLoad={() => {
            iframeRef.current?.contentWindow?.postMessage(
              { type: "ai0.stage.host_state", state: stateRef.current },
              "*"
            );
          }}
        />
      </section>
    );
  }

  if (entryModuleUrl) {
    return (
      <div
        className="ai0-plugin-page-outlet"
        data-page-owner={pluginId}
        data-page-mount-status={mountStatus}
        style={{ height: "100%", minHeight: 0, minWidth: 0, position: "relative" }}
      >
        <div
          ref={containerRef}
          style={{ height: "100%", minHeight: 0, minWidth: 0 }}
        />
        {mountStatus === "error" ? (
          <div style={{ padding: "20px", display: "grid", gap: "10px" }} role="alert">
            <strong>无法加载插件交互界面：{page.title}</strong>
            <small>{mountError}</small>
            <div>
              <RippleButton onClick={() => ctx?.navigateConsole("/extensions/marketplace")}>
                管理插件与扩展
              </RippleButton>
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return null;
}
