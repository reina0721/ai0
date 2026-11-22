import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import {
  useEffect, useId, useRef, useState, type ReactNode, type SetStateAction
} from "react";

import { useConsole } from "../context/ConsoleContext.js";
import { RippleButton } from "../design-system/primitives/index.js";
import { renderConsoleIcon } from "../design-system/tokens/index.js";

export function useWorkspaceDraft<T>(source: T) {
  const [draft, setDraft] = useState<{ value: T }>();
  const value = draft ? draft.value : source;
  const dirty = draft !== undefined && JSON.stringify(value) !== JSON.stringify(source);

  useEffect(() => {
    if (draft && !dirty) setDraft((current) => current === draft ? undefined : current);
  }, [draft, dirty]);

  const setValue = (action: SetStateAction<T>): void => {
    setDraft((current) => ({
      value: typeof action === "function"
        ? (action as (previous: T) => T)(current ? current.value : source)
        : action
    }));
  };

  return {
    value,
    dirty,
    setValue,
    discard: () => setDraft(undefined),
    accept: () => setDraft((current) => current === draft ? undefined : current)
  };
}

export function useWorkspaceSave(
  id: string | undefined,
  dirty: boolean,
  discard: () => void,
  apply: () => Promise<void>,
  message = "配置已保存",
  accept = discard
) {
  const ctx = useConsole();
  const [saving, setSaving] = useState(false);
  const promiseRef = useRef<Promise<boolean> | undefined>(undefined);
  const canWrite = ctx?.mode === "live" && Boolean(ctx.ownerToken);

  const save = (): Promise<boolean> => {
    if (promiseRef.current) return promiseRef.current;
    if (!ctx || !canWrite) return Promise.resolve(false);
    setSaving(true);
    promiseRef.current = Promise.resolve().then(async () => {
      try {
        await apply();
        await ctx.refreshSnapshot();
        accept();
        ctx.showToast(message);
        return true;
      } catch (error) {
        ctx.showToast(`保存失败：${error instanceof Error ? error.message : String(error)}`);
        return false;
      } finally {
        promiseRef.current = undefined;
        setSaving(false);
      }
    });
    return promiseRef.current;
  };

  const register = ctx?.registerDirtyEditor;
  const editor = useRef({ isDirty: () => dirty, save, discard });
  editor.current = { isDirty: () => dirty, save, discard };
  useEffect(() => {
    if (!register || !id) return;
    return register(id, {
      isDirty: () => editor.current.isDirty(),
      save: () => editor.current.save(),
      discard: () => editor.current.discard()
    });
  }, [register, id]);

  return { save, saving, canWrite, dirty };
}

export function useAdminResource<T>(path: string | undefined) {
  const ctx = useConsole();
  const getAdmin = ctx?.getAdmin;
  const token = ctx?.ownerToken;
  const key = path && token ? `${ctx?.targetInstance}:${path}` : undefined;
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{ key: string; data?: T; error?: string }>();

  useEffect(() => {
    if (!path || !key || !getAdmin) return;
    const controller = new AbortController();
    void getAdmin<T>(path, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key, data });
      })
      .catch((error) => {
        if (!controller.signal.aborted) setResult({ key, error: error instanceof Error ? error.message : String(error) });
      });
    return () => controller.abort();
  }, [getAdmin, key, path, revision]);

  const current = result?.key === key ? result : undefined;
  return {
    data: current?.data,
    error: current?.error,
    loading: Boolean(key && !current),
    refresh: () => setRevision((value) => value + 1)
  };
}

export function WorkspaceHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="ai0-workspace-heading-block">
      <h1>{title}</h1>
      {children ? <div className="ai0-workspace-heading-actions">{children}</div> : null}
    </header>
  );
}

export function WorkspaceSaveButton({ form, name = "保存配置" }: {
  form: Pick<ReturnType<typeof useWorkspaceSave>, "save" | "saving" | "canWrite" | "dirty">;
  name?: string;
}) {
  return (
    <>
      {!form.canWrite ? <small>正式实例配置</small> : null}
      <RippleButton variant="primary" disabled={!form.canWrite || !form.dirty} loading={form.saving} onClick={() => void form.save()}>
        {renderConsoleIcon("save", 14)}<span>{name}</span>
      </RippleButton>
    </>
  );
}

export function WorkspaceReadState({ loading, error, empty, onRetry }: {
  loading?: boolean;
  error?: string;
  empty: string;
  onRetry?: () => void;
}) {
  if (loading) return (
    <div className="ai0-workspace-feedback" role="status">
      <CircularProgress size={13} aria-hidden="true" />
      <small>正在读取运行时数据…</small>
    </div>
  );
  if (!error) return <small>{empty}</small>;
  return (
    <Alert className="ai0-workspace-feedback" severity="error" variant="outlined"
      action={onRetry ? <RippleButton size="sm" onClick={onRetry}>重试</RippleButton> : null}>
      读取失败：{error}
    </Alert>
  );
}

export function WorkspaceConfirm({ title, description, onCancel, onConfirm, busy }: {
  title: string;
  description: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  busy?: boolean;
}) {
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open onClose={busy ? undefined : onCancel} fullWidth maxWidth="xs" aria-labelledby={titleId}
      slotProps={{ transition: { onEntered: () => cancelRef.current?.focus() } }}>
      <DialogTitle id={titleId}>{title}</DialogTitle>
      <DialogContent>{description}</DialogContent>
      <DialogActions>
        <Button ref={cancelRef} autoFocus disabled={busy} onClick={onCancel}>取消</Button>
        <RippleButton variant="danger" loading={busy} onClick={onConfirm}>确认</RippleButton>
      </DialogActions>
    </Dialog>
  );
}
