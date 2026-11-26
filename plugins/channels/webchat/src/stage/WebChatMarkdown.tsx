import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Table from "@mui/material/Table";
import Tooltip from "@mui/material/Tooltip";
import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { Copy, Download, ExternalLink, Maximize2, X } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { createContext, memo, useContext, useId, useRef, useState, type ComponentPropsWithoutRef } from "react";
import {
  Streamdown, StreamdownContext, extractTableDataFromElement, tableDataToCSV, tableDataToMarkdown, tableDataToTSV,
  type Components, type ExtraProps, type LinkSafetyConfig, type LinkSafetyModalProps, type TableData
} from "streamdown";

const MARKDOWN_PLUGINS = { cjk, code };
const MARKDOWN_CONTROLS = { code: { copy: true, download: false }, table: { copy: true, download: true, fullscreen: true } };
const BLOCKED_MARKDOWN = ["img", "iframe", "audio", "video"];
const TRANSLATIONS = { copyCode: "复制代码", copied: "已复制" };

const ToastContext = createContext<(message: string) => void>(() => {});

function safeMarkdownUrl(url: string): string {
  return /^https?:\/\//iu.test(url) ? url : "";
}

async function writeClipboard(text: string, html?: string) {
  if (html && typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({
        "text/plain": new Blob([text], { type: "text/plain" }),
        "text/html": new Blob([html], { type: "text/html" })
      })]);
      return;
    } catch { /* Preserve plain-text copy on clipboard implementations without HTML support. */ }
  }
  await navigator.clipboard.writeText(text);
}

function LinkSafetyDialog({ isOpen, onClose, onConfirm, url }: LinkSafetyModalProps) {
  const titleId = useId();
  const urlId = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  const [copy, setCopy] = useState<"ready" | "copied" | "error">("ready");

  function close() {
    setCopy("ready");
    onClose();
  }

  return (
    <Dialog open={isOpen} onClose={close} aria-labelledby={titleId} aria-describedby={urlId} fullWidth maxWidth="xs"
      transitionDuration={reduced ? 0 : 180} slotProps={{ transition: { onEntered: () => cancel.current?.focus() } }}>
      <DialogTitle id={titleId}>打开外部链接</DialogTitle>
      <DialogContent><code className="ai0-chat-link-url" id={urlId}>{url}</code></DialogContent>
      <DialogActions>
        <Button ref={cancel} onClick={close}>取消</Button>
        <Button onClick={() => {
          void writeClipboard(url).then(() => setCopy("copied"), () => setCopy("error"));
        }} aria-live="polite">{copy === "copied" ? "已复制" : copy === "error" ? "重试复制" : "复制链接"}</Button>
        <Button variant="contained" disabled={!safeMarkdownUrl(url)} endIcon={<ExternalLink size={14} aria-hidden="true" />}
          onClick={() => { onConfirm(); close(); }}>继续访问</Button>
      </DialogActions>
    </Dialog>
  );
}

type TableFormat = "Markdown" | "CSV" | "TSV";
const COPY_FORMATS = ["Markdown", "CSV", "TSV"] as const;
const DOWNLOAD_FORMATS = ["CSV", "Markdown"] as const;
const TABLE_FORMATS: Record<TableFormat, (table: TableData) => string> = {
  Markdown: tableDataToMarkdown, CSV: tableDataToCSV, TSV: tableDataToTSV
};

function downloadTable(text: string, format: TableFormat) {
  const csv = format === "CSV";
  const url = URL.createObjectURL(new Blob([csv ? `\uFEFF${text}` : text], { type: csv ? "text/csv;charset=utf-8" : "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = csv ? "table.csv" : "table.md";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function MarkdownTable({ children, node: _node, ...props }: ComponentPropsWithoutRef<"table"> & ExtraProps) {
  const showToast = useContext(ToastContext);
  const { isAnimating } = useContext(StreamdownContext);
  const reduced = useReducedMotion();
  const ref = useRef<HTMLTableElement>(null);
  const titleId = useId();
  const [expanded, setExpanded] = useState(false);
  const [menu, setMenu] = useState<{ mode: "copy" | "download"; anchor: HTMLElement } | null>(null);
  const [copied, setCopied] = useState(false);
  const copyLabel = copied ? "已复制表格" : "复制表格";

  async function transfer(format: TableFormat) {
    const action = menu?.mode;
    setMenu(null);
    const table = ref.current;
    if (!table || !action) return;
    try {
      const text = TABLE_FORMATS[format](extractTableDataFromElement(table));
      if (action === "download") downloadTable(text, format);
      else {
        await writeClipboard(text, table.outerHTML);
        setCopied(true);
        showToast("已复制表格");
      }
    } catch {
      showToast(action === "download" ? "表格下载失败" : "表格复制失败");
    }
  }

  const actions = (
    <>
      <Tooltip describeChild title={<span>{copyLabel}</span>}>
        <IconButton className="ai0-chat-icon-action" size="small" aria-label="复制表格" data-copied={copied || undefined}
          aria-haspopup="menu" onClick={(event) => { setCopied(false); setMenu({ mode: "copy", anchor: event.currentTarget }); }}>
          <Copy size={14} aria-hidden="true" />
        </IconButton>
      </Tooltip>
      <Tooltip describeChild title={<span>下载表格</span>}>
        <IconButton className="ai0-chat-icon-action" size="small" aria-label="下载表格"
          aria-haspopup="menu" onClick={(event) => setMenu({ mode: "download", anchor: event.currentTarget })}>
          <Download size={14} aria-hidden="true" />
        </IconButton>
      </Tooltip>
    </>
  );

  return (
    <section className="ai0-chat-table">
      {!isAnimating ? (
        <div className="ai0-chat-table__actions">
          {actions}
          <Tooltip describeChild title={<span>全屏查看表格</span>}>
            <IconButton className="ai0-chat-icon-action" size="small" aria-label="全屏查看表格" onClick={() => setExpanded(true)}>
              <Maximize2 size={14} aria-hidden="true" />
            </IconButton>
          </Tooltip>
        </div>
      ) : null}
      <div className="ai0-chat-table__scroll" tabIndex={0} role="region" aria-label="消息表格">
        <Table ref={ref} size="small" {...props}>{children}</Table>
      </div>
      <Dialog open={expanded} fullScreen onClose={() => setExpanded(false)} aria-labelledby={titleId}
        transitionDuration={reduced ? 0 : 180} slotProps={{ paper: { className: "ai0-chat-table-dialog" } }}>
        <DialogTitle className="ai0-chat-table-dialog__title" component="div">
          <span id={titleId}>消息表格</span>
          <div className="ai0-chat-table__actions">
            {actions}
            <Tooltip describeChild title={<span>关闭全屏表格</span>}>
              <IconButton className="ai0-chat-icon-action" size="small" aria-label="关闭全屏表格" onClick={() => setExpanded(false)}>
                <X size={15} aria-hidden="true" />
              </IconButton>
            </Tooltip>
          </div>
        </DialogTitle>
        <DialogContent className="ai0-chat-table-dialog__scroll">
          <Table size="small" {...props}>{children}</Table>
        </DialogContent>
      </Dialog>
      <Menu anchorEl={menu?.anchor} open={Boolean(menu)} onClose={() => setMenu(null)}
        transitionDuration={reduced ? 0 : "auto"}
        slotProps={{ list: { "aria-label": menu?.mode === "download" ? "下载格式" : "复制格式" } }}>
        {(menu?.mode === "download" ? DOWNLOAD_FORMATS : COPY_FORMATS).map((format) => (
          <MenuItem key={format} onClick={() => void transfer(format)}>{format}</MenuItem>
        ))}
      </Menu>
    </section>
  );
}

const MARKDOWN_COMPONENTS: Components = { table: MarkdownTable };
const LINK_SAFETY: LinkSafetyConfig = { enabled: true, renderModal: (props) => <LinkSafetyDialog {...props} /> };

export const WebChatMarkdown = memo(function WebChatMarkdown({
  text,
  streaming,
  onToast
}: {
  text: string;
  streaming: boolean;
  onToast: (message: string) => void;
}) {
  return (
    <ToastContext.Provider value={onToast}>
      <Streamdown className="ai0-chat-markdown" mode={streaming ? "streaming" : "static"} isAnimating={streaming}
        plugins={MARKDOWN_PLUGINS} controls={MARKDOWN_CONTROLS} components={MARKDOWN_COMPONENTS}
        translations={TRANSLATIONS} disallowedElements={BLOCKED_MARKDOWN} urlTransform={safeMarkdownUrl}
        linkSafety={LINK_SAFETY} skipHtml>
        {text}
      </Streamdown>
    </ToastContext.Provider>
  );
});
