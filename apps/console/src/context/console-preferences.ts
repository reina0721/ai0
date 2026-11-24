import { useCallback, useRef, useState } from "react";
import type { DaemonSystemSettings } from "@ai0/protocol";

import { patchJson } from "../api/client.js";
import type { ConsoleLiveSnapshot } from "../live-snapshot.js";

export type ConsolePreferences = Pick<DaemonSystemSettings, "appearance" | "soulTheme" | "navRailMode" | "inspectorView">;

type PreferencePatch = Partial<ConsolePreferences>;

function withDefaults(settings?: PreferencePatch): ConsolePreferences {
  return {
    appearance: settings?.appearance ?? "light",
    soulTheme: settings?.soulTheme ?? "sakura-pink",
    navRailMode: settings?.navRailMode ?? "expanded",
    inspectorView: settings?.inspectorView ?? "trace"
  };
}

function snapshotSettings(snapshot?: ConsoleLiveSnapshot): PreferencePatch | undefined {
  return snapshot?.infrastructure?.systemSettings ?? snapshot?.studioConfig?.systemSettings;
}

export function useConsolePreferences(
  initialSnapshot: ConsoleLiveSnapshot | undefined,
  ownerToken: string,
  canEdit: boolean,
  showToast: (message: string) => void
) {
  const [confirmed, setConfirmed] = useState(() => withDefaults(snapshotSettings(initialSnapshot)));
  const [pending, setPending] = useState<Array<{ id: number; patch: PreferencePatch }>>([]);
  const sequence = useRef(0);
  const lastConfirmed = useRef(0);
  const queue = useRef(Promise.resolve());

  const beginRead = useCallback(() => {
    const id = ++sequence.current;
    return (snapshot: ConsoleLiveSnapshot) => {
      const settings = snapshotSettings(snapshot);
      if (!settings || id <= lastConfirmed.current) return;
      lastConfirmed.current = id;
      setConfirmed(withDefaults(settings));
    };
  }, []);

  const save = useCallback((patch: PreferencePatch) => {
    if (!canEdit) return Promise.resolve();
    const id = ++sequence.current;
    setPending((current) => [...current, { id, patch }]);

    const operation = queue.current.then(async () => {
      try {
        const settings = await patchJson<ConsolePreferences>(
          "/api/admin/v1/system/settings?target_instance=live", patch, ownerToken
        );
        // A snapshot already in flight may still contain the previous settings.
        lastConfirmed.current = ++sequence.current;
        setConfirmed(withDefaults(settings));
      } catch (error) {
        showToast("保存控制台偏好失败：" + (error instanceof Error ? error.message : String(error)));
      } finally {
        setPending((current) => current.filter((change) => change.id !== id));
      }
    });
    queue.current = operation;
    return operation;
  }, [canEdit, ownerToken, showToast]);

  const saving = canEdit && pending.length > 0;
  const preferences = saving
    ? pending.reduce((current, change) => ({ ...current, ...change.patch }), confirmed)
    : confirmed;

  return { preferences, saving, beginRead, save };
}
