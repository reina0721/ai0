import type { RuntimeConsoleUiSlot, RuntimePluginDescriptor, VerifiableTurnTrace } from "@ai0/protocol";
import type {
  Ai0ShellStageCleanup,
  Ai0ShellStageHostBridge,
  Ai0ShellStageHostState,
  Ai0ShellStageModule,
  Ai0StageMode
} from "@ai0/sdk";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import { useConsole } from "../../context/ConsoleContext.js";
import type { ConsoleLiveSnapshot } from "../../live-snapshot.js";
import { RippleButton } from "../primitives/RippleButton.js";

export interface MountedShellStageHostProps {
  shellPluginId: string;
  snapshot?: ConsoleLiveSnapshot;
}

interface ResolvedStagePlugin {
  readonly extensionId: string;
  readonly displayName: string;
  readonly enabled: boolean;
  readonly slot?: RuntimeConsoleUiSlot;
}

function findStageInSnapshot(
  snapshot: ConsoleLiveSnapshot | undefined,
  pluginId: string
): ResolvedStagePlugin | undefined {
  const ext = snapshot?.extensions.find((entry) => entry.id === pluginId);
  if (!ext) return undefined;
  const slot = ext.uiSlots?.find((item) => item.slot_target === "slot.shells.mounted_stage");
  return {
    extensionId: ext.id,
    displayName: ext.displayName ?? ext.id,
    enabled: ext.enabled,
    slot
  };
}

function descriptorToStage(descriptor: RuntimePluginDescriptor): ResolvedStagePlugin {
  const slot = descriptor.ui_slots.find((item) => item.slot_target === "slot.shells.mounted_stage");
  return {
    extensionId: descriptor.extension_id,
    displayName: descriptor.display_name,
    enabled: descriptor.enabled,
    slot
  };
}

async function ensurePluginStylesheets(extensionId: string, urls: readonly string[]): Promise<void> {
  if (typeof document === "undefined" || urls.length === 0) return;
  await Promise.all(
    urls.map(
      (href) =>
        new Promise<void>((resolve) => {
          const existing = document.head.querySelector<HTMLLinkElement>(
            `link[rel="stylesheet"][data-ai0-plugin-style="${CSS.escape(extensionId)}"][href="${CSS.escape(href)}"]`
          );
          if (existing) {
            if (existing.dataset.loaded === "true") {
              resolve();
              return;
            }
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => resolve(), { once: true });
            setTimeout(resolve, 1500);
            return;
          }
          const link = document.createElement("link");
          link.rel = "stylesheet";
          link.href = href;
          link.dataset.ai0PluginStyle = extensionId;
          link.addEventListener(
            "load",
            () => {
              link.dataset.loaded = "true";
              resolve();
            },
            { once: true }
          );
          link.addEventListener("error", () => resolve(), { once: true });
          document.head.appendChild(link);
          setTimeout(resolve, 1500);
        })
    )
  );
}

export function MountedShellStageHost(props: MountedShellStageHostProps): ReactElement {
  const ctx = useConsole();
  const snapshot = props.snapshot ?? ctx?.snapshot;
  const pluginId = props.shellPluginId;

  const snapshotStage = useMemo(
    () => findStageInSnapshot(snapshot, pluginId),
    [snapshot, pluginId]
  );

  const [fetchedStage, setFetchedStage] = useState<{ pluginId: string; resolved: ResolvedStagePlugin | null } | null>(
    null
  );
  const [stageTokenState, setStageTokenState] = useState<{ key: string; token: string; shellId: string } | null>(null);
  const [mountStatus, setMountStatus] = useState<"idle" | "loading" | "mounted" | "error">("idle");
  const [mountError, setMountError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastStageRef = useRef<{ pluginId: string; resolved: ResolvedStagePlugin } | null>(null);

  if (snapshotStage?.slot) {
    lastStageRef.current = { pluginId, resolved: snapshotStage };
  } else if (fetchedStage?.pluginId === pluginId && fetchedStage.resolved?.slot) {
    lastStageRef.current = { pluginId, resolved: fetchedStage.resolved };
  }

  const stableCachedStage = lastStageRef.current?.pluginId === pluginId ? lastStageRef.current.resolved : undefined;
  const resolvedStage =
    snapshotStage?.slot
      ? snapshotStage
      : fetchedStage?.pluginId === pluginId
        ? fetchedStage.resolved ?? stableCachedStage ?? snapshotStage
        : stableCachedStage ?? snapshotStage;

  // Fetch plugin manifest dynamically so cold loads / offline bootstrap / out-of-tree plugins still discover the stage.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (snapshotStage?.slot || stableCachedStage?.slot) return;
    const controller = new AbortController();
    void fetch(`/api/plugins/${encodeURIComponent(pluginId)}/manifest`, {
      cache: "no-store",
      signal: controller.signal
    })
      .then(async (res) => {
        if (!res.ok) {
          if (!controller.signal.aborted) setFetchedStage({ pluginId, resolved: null });
          return;
        }
        const data = (await res.json()) as { ok?: boolean; plugin?: RuntimePluginDescriptor };
        if (!controller.signal.aborted) {
          setFetchedStage({
            pluginId,
            resolved: data.plugin ? descriptorToStage(data.plugin) : null
          });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFetchedStage({ pluginId, resolved: null });
      });
    return () => controller.abort();
  }, [pluginId, snapshotStage, stableCachedStage]);

  const stageSlot = resolvedStage?.enabled ? resolvedStage.slot : undefined;
  const shellId = stageSlot?.shell_id ?? `${pluginId}.default`;
  const ownerToken = ctx?.ownerToken ?? "";
  const tokenRequestKey = `${pluginId}:${ownerToken}`;

  // Mint a Channel A ScopedCapabilityToken for this mounted stage (Zero-Privilege isolation).
  useEffect(() => {
    if (typeof window === "undefined" || !ownerToken || !stageSlot) return;
    const controller = new AbortController();
    void fetch(`/api/plugins/${encodeURIComponent(pluginId)}/stage-token`, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: { "x-ai0-owner-token": ownerToken }
    })
      .then(async (res) => {
        if (!res.ok) return;
        const data = (await res.json()) as { token?: string; shellId?: string };
        if (!controller.signal.aborted && data.token) {
          setStageTokenState({
            key: tokenRequestKey,
            token: data.token,
            shellId: data.shellId ?? shellId
          });
        }
      })
      .catch(() => {
        // Keep stage mounted in offline/connecting state if daemon is temporarily unreachable.
      });
    return () => controller.abort();
  }, [ownerToken, pluginId, shellId, stageSlot, tokenRequestKey]);

  const activeStageToken = stageTokenState?.key === tokenRequestKey ? stageTokenState.token : "";
  const activeShellId = stageTokenState?.key === tokenRequestKey ? stageTokenState.shellId : shellId;

  const mode: Ai0StageMode = ctx?.mode ?? (snapshot?.targetInstance === "sandbox:console" ? "sandbox" : "live");
  const targetInstance = mode === "sandbox" ? "sandbox:console" : "live";
  const hostState = useMemo<Ai0ShellStageHostState>(
    () => ({
      mode,
      targetInstance,
      soulId: snapshot?.soulId,
      personaName: snapshot?.personaName ?? "Mio",
      soulTheme: ctx?.soulTheme ?? snapshot?.studioConfig?.systemSettings.soulTheme ?? "sakura-pink",
      appearance: ctx?.appearance ?? snapshot?.studioConfig?.systemSettings.appearance ?? "light",
      connected: Boolean(activeStageToken && !ctx?.error),
      loading: Boolean(ctx?.loading),
      error: ctx?.error ?? undefined,
      protocolBasePath: "/protocol/v0/shell",
      authToken: activeStageToken,
      recentTraces: snapshot?.recentTraces
    }),
    [
      activeStageToken,
      ctx?.appearance,
      ctx?.error,
      ctx?.loading,
      ctx?.soulTheme,
      mode,
      snapshot?.personaName,
      snapshot?.recentTraces,
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

  const entryModuleUrl = stageSlot?.widget_type === "web_stage_module" ? stageSlot.entry_module_url : undefined;
  const styleSheetKey = (stageSlot?.style_sheet_urls ?? []).join("|");
  const iframeSrcUrl = stageSlot?.widget_type === "sandboxed_iframe_stage" ? stageSlot.iframe_src_url : undefined;

  useEffect(() => {
    if (typeof window === "undefined" || !entryModuleUrl) return;
    const container = containerRef.current;
    if (!container) return;

    let cancelled = false;
    let cleanup: Ai0ShellStageCleanup | undefined;
    setMountStatus("loading");
    setMountError(null);

    const styleUrls = styleSheetKey ? styleSheetKey.split("|") : [];
    const bridge: Ai0ShellStageHostBridge = {
      extensionId: pluginId,
      get shellId() {
        return shellIdRef.current;
      },
      getState: () => stateRef.current,
      subscribe: (listener) => {
        listenersRef.current.add(listener);
        return () => {
          listenersRef.current.delete(listener);
        };
      },
      showToast: (message) => ctxRef.current?.showToast(message),
      retryConnection: () => ctxRef.current?.retryBootstrap(),
      fetchTurnTrace: async ({ requestId, traceId, mode: traceMode, signal }) => {
        const currentCtx = ctxRef.current;
        if (!currentCtx?.ownerToken) return undefined;
        const target = traceMode === "sandbox" ? "sandbox:console" : "live";
        if (requestId) {
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
        if (traceId) {
          const response = await currentCtx.getAdmin<{ traces: VerifiableTurnTrace[] }>(
            "runtime/traces",
            signal,
            target
          );
          return response.traces.find((entry) => entry.trace_id === traceId);
        }
        return undefined;
      }
    };

    void (async () => {
      try {
        await ensurePluginStylesheets(pluginId, styleUrls);
        if (cancelled) return;
        const loaded = (await import(/* @vite-ignore */ entryModuleUrl)) as Partial<
          Ai0ShellStageModule<HTMLElement> & { default?: Partial<Ai0ShellStageModule<HTMLElement>> }
        >;
        if (cancelled) return;
        const mountFn = loaded.mountShellStage ?? loaded.default?.mountShellStage;
        if (typeof mountFn !== "function") {
          throw new TypeError(`Plugin stage module ${pluginId} does not export mountShellStage().`);
        }
        cleanup = await mountFn(container, bridge);
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
        }
      }
    })();

    return () => {
      cancelled = true;
      if (typeof cleanup === "function") cleanup();
      else cleanup?.unmount();
      container.replaceChildren();
    };
  }, [entryModuleUrl, pluginId, styleSheetKey]);

  const waitingForManifest =
    typeof window !== "undefined" && !resolvedStage && fetchedStage?.pluginId !== pluginId;

  if (iframeSrcUrl) {
    return (
      <section
        className="mounted-shell-stage-host"
        data-shell-plugin-id={pluginId}
        style={{ height: "100%", minHeight: 0, minWidth: 0 }}
        aria-label={stageSlot?.title ?? pluginId}
      >
        <iframe
          ref={iframeRef}
          className="mounted-shell-stage-host__iframe"
          sandbox="allow-scripts"
          title={stageSlot?.title ?? pluginId}
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
        className="ai0-stage-host-outlet"
        data-shell-plugin-id={pluginId}
        data-stage-mount-status={mountStatus}
        style={{ height: "100%", minHeight: 0, minWidth: 0, position: "relative" }}
      >
        <div
          ref={containerRef}
          style={{ height: "100%", minHeight: 0, minWidth: 0 }}
        />
        {mountStatus === "error" ? (
          <div style={{ padding: "20px", display: "grid", gap: "10px" }} role="alert">
            <strong>无法加载躯壳插件舞台：{resolvedStage?.displayName ?? pluginId}</strong>
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

  return (
    <section
      className="mounted-shell-stage-host"
      data-shell-plugin-id={pluginId}
      aria-busy={waitingForManifest || undefined}
      style={{ padding: "20px", display: "grid", gap: "12px", alignContent: "start" }}
    >
      <h1 style={{ margin: 0, fontSize: "16px" }}>躯壳舞台</h1>
      <h2 style={{ margin: 0, fontSize: "14px" }}>{resolvedStage?.displayName ?? pluginId}</h2>
      <small role="status">
        {waitingForManifest
          ? "正在发现并挂载躯壳舞台插件…"
          : resolvedStage && !resolvedStage.enabled
            ? "该躯壳插件当前处于禁用状态，请前往「插件与扩展」启用后使用。"
            : resolvedStage
              ? "该躯壳已注册，未声明可挂载的控制台舞台视图（slot.shells.mounted_stage）。"
              : "当前实例未注册该躯壳。外部插件可放入 .soul/plugins/ 或 AI0_PLUGINS_DIR 动态加载。"}
      </small>
      <div style={{ display: "flex", gap: "8px" }}>
        <RippleButton onClick={() => ctx?.navigateConsole("/shells/topology")}>查看接入拓扑</RippleButton>
        <RippleButton variant="ghost" onClick={() => ctx?.navigateConsole("/extensions/marketplace")}>
          插件与扩展管理
        </RippleButton>
      </div>
    </section>
  );
}
