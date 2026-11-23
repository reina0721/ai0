import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { consoleNavigation, type ConsoleNavigationItem, ExtensionComposition, type ExtensionScope } from "@ai0/sdk";
import type { ConsoleLiveSnapshot } from "../live-snapshot.js";

const Composition = createContext<ExtensionComposition | null>(null);
export const useExtensionComposition = () => useContext(Composition);

function Contribution({ runtime, owner, url }: { runtime: ExtensionComposition; owner: string; url: string }) {
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    let binding: ReturnType<ExtensionComposition["mount"]> | undefined;
    void import(/* @vite-ignore */ url).then(async module => {
      if (!current) return;
      if (typeof module.activate !== "function") throw new TypeError("Missing activate(scope)");
      binding = runtime.mount(owner, scope => (module.activate as (scope: ExtensionScope) => void)(scope));
      await binding.ready();
    }).catch(err => { if (current) setError(String(err)); });
    return () => { current = false; void binding?.dispose(); };
  }, [runtime, owner, url]);
  return error ? <small role="alert">{owner} · {error}</small> : null;
}

export function ConsoleExtensions({ snapshot, registerNavigation, children }: { snapshot?: ConsoleLiveSnapshot; registerNavigation: (item: ConsoleNavigationItem) => () => void; children: ReactNode }) {
  const [runtime] = useState(() => new ExtensionComposition());
  useEffect(() => {
    const root = runtime.mount(consoleNavigation.owner, scope => { scope.define(consoleNavigation, registerNavigation); });
    return () => { void root.dispose(); };
  }, [runtime, registerNavigation]);
  return <Composition.Provider value={runtime}>
    {snapshot?.extensions.filter(ext => ext.enabled).flatMap(ext => (ext.moduleUrls ?? []).map(entry => {
      const url = entry + "?v=" + encodeURIComponent(ext.generation ?? ext.version ?? "");
      return <Contribution key={ext.id + url} runtime={runtime} owner={ext.id} url={url} />;
    }))}
    {children}
  </Composition.Provider>;
}
