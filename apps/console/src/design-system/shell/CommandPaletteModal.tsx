import Autocomplete from "@mui/material/Autocomplete";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import TextField from "@mui/material/TextField";
import { useRef, useState, type ReactElement } from "react";
import { CONSOLE_ROUTES_30 } from "../../router/routes.js";
import { RippleButton } from "../primitives/index.js";

export interface CommandPaletteExtensionItem {
  id: string;
  label: string;
  description?: string;
  path?: string;
  keywords?: readonly string[];
  onSelect?: () => void;
}

export interface CommandPaletteModalProps {
  open: boolean;
  query?: string;
  extensionItems?: readonly CommandPaletteExtensionItem[];
  onQueryChange?: (query: string) => void;
  onNavigate?: (path: string) => void;
  onClose?: () => void;
}

export interface CommandPaletteShortcutEvent {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
}

export function isCommandPaletteShortcut(event: CommandPaletteShortcutEvent): boolean {
  return event.key.toLowerCase() === "k" && Boolean(event.ctrlKey || event.metaKey);
}

const routes: readonly CommandPaletteExtensionItem[] = CONSOLE_ROUTES_30.filter(route => !route.path.includes(":")).map((route) => ({
  id: route.id, label: route.label, path: route.defaultConcretePath ?? route.path,
  description: route.path, keywords: route.keywords
}));

export function CommandPaletteModal(props: CommandPaletteModalProps): ReactElement {
  const [localQuery, setLocalQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const options = [...routes, ...(props.extensionItems ?? [])];
  const close = () => {
    setLocalQuery("");
    props.onQueryChange?.("");
    props.onClose?.();
  };

  return (
    <Dialog
      open={props.open}
      onClose={close}
      fullWidth
      maxWidth="sm"
      aria-labelledby="ai0-command-title"
      className="ai0-command-palette-modal"
      slotProps={{ transition: { onEntered: () => searchInput.current?.focus() } }}
    >
      <DialogTitle className="ai0-command-palette-title" id="ai0-command-title">
        <span>快速跳转</span>
        <RippleButton size="sm" variant="ghost" ariaLabel="关闭命令面板" onClick={close}>Esc</RippleButton>
      </DialogTitle>
      <Autocomplete
        open={props.open}
        autoHighlight
        openOnFocus
        disableClearable
        forcePopupIcon={false}
        disablePortal
        noOptionsText="没有匹配的命令"
        options={options}
        getOptionKey={(item) => item.id}
        getOptionLabel={(item) => item.label}
        inputValue={props.query ?? localQuery}
        className="ai0-command-palette-search"
        onClose={(_, reason) => { if (reason === "escape") close(); }}
        onInputChange={(_, value, reason) => {
          if (reason === "input") {
            setLocalQuery(value);
            props.onQueryChange?.(value);
          }
        }}
        filterOptions={(items, state) => {
          const query = state.inputValue.trim().toLocaleLowerCase();
          return items.filter((item) => [item.label, item.description, ...(item.keywords ?? [])]
            .some((value) => value?.toLocaleLowerCase().includes(query)));
        }}
        onChange={(_, item) => {
          if (!item) return;
          close();
          if (item.path) props.onNavigate?.(item.path);
          item.onSelect?.();
        }}
        slotProps={{ popper: { className: "ai0-command-results" } }}
        renderOption={({ key, ...attrs }, item) => (
          <li key={key} {...attrs} data-command-id={item.id}>
            <strong>{item.label}</strong>
            <small>{item.description}</small>
          </li>
        )}
        renderInput={(params) => (
          <TextField {...params} inputRef={searchInput} autoFocus size="small" label="搜索页面与扩展" placeholder="例如：世界书、模型、沙盒" />
        )}
      />
    </Dialog>
  );
}
