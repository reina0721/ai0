import { RippleButton, CompactInput, SegmentedPill } from "../design-system/primitives/index.js";
import { WorkspaceChoice, WorkspaceField, WorkspaceSection } from "./workspace-layout.js";
import { useRef, useState, type FormEvent, type ReactNode } from "react";
import { CheckCircle2, FileText, Upload } from "lucide-react";
import type { KnowledgeDocument } from "@ai0/protocol";

export interface ImportReceipt {
  document: KnowledgeDocument;
  reused: boolean;
}

export function KnowledgeIntake({
  collection,
  previous,
  documents,
  retryName,
  submit,
  open,
  search,
  again,
  scope
}: {
  collection: string;
  previous?: KnowledgeDocument;
  retryName?: string;
  submit: (payload: Record<string, unknown>) => Promise<ImportReceipt>;
  documents: KnowledgeDocument[];
  open: (doc: KnowledgeDocument) => void;
  search: () => void;
  again: () => void;
  scope: (doc: KnowledgeDocument) => ReactNode;
}) {
  const [kind, setKind] = useState<"file" | "paste">("file");
  const [name, setName] = useState(retryName ?? previous?.name ?? "");
  const [file, setFile] = useState<File>();
  const [content, setContent] = useState("");
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<ImportReceipt>();
  const picker = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);
  const fallback =
    previous ?? documents.find((doc) => doc.name === (kind === "file" ? file?.name : name.trim()));
  function select(files: FileList | null) {
    if (!files?.length || submitting.current) return;
    if (files.length !== 1) {
      setError("请每次选择一份文件");
      return;
    }
    setFile(files[0]);
    setError("");
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (submitting.current) return;
    submitting.current = true;
    setError("");
    try {
      let payload: Record<string, unknown>;
      if (kind === "file") {
        if (!file) return;
        if (file.size > 16 * 1024 * 1024) throw Error("请选择 16 MB 以内的文件");
        setStatus("正在读取文件…");
        const url = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(Error("文件读取失败"));
          reader.readAsDataURL(file);
        });
        payload = { name: file.name, base64: url.slice(url.indexOf(",") + 1) };
      } else {
        payload = { name: name.trim(), content };
      }
      setStatus("正在导入并建立索引…");
      setReceipt(await submit(payload));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStatus("");
      submitting.current = false;
    }
  }
  if (receipt)
    return (
      <WorkspaceSection className="kb-intake kb-receipt" aria-label="导入结果">
        <div className="kb-receipt-title" role="status">
          <CheckCircle2 size={22} />
          <h2>{receipt.reused ? "内容已存在" : "已可搜索"}</h2>
        </div>
        <strong className="kb-receipt-file">{receipt.document.name}</strong>
        <p>
          {receipt.reused
            ? receipt.document.chunks
              ? "已复用库内文档的索引。"
              : "库内已有这份原文，可在文档操作中重建索引。"
            : "已加入「" + collection + "」的搜索范围。"}
        </p>
        <div className="kb-inline-actions">
          {receipt.document.chunks > 0 && (
            <RippleButton variant="primary" onClick={search}>
              试搜这份资料
            </RippleButton>
          )}
          <RippleButton variant="ghost" size="sm" onClick={() => open(receipt.document)}>
            查看原文
          </RippleButton>
          <RippleButton variant="ghost" size="sm" onClick={again}>
            继续导入
          </RippleButton>
        </div>
        <div className="kb-receipt-scope">
          <small>对话使用范围</small>
          {scope(receipt.document)}
        </div>
      </WorkspaceSection>
    );
  return (
    <WorkspaceSection className="kb-intake">
      <form className="kb-form" onSubmit={send}>
        <h2>
          <small>目标知识库</small> {collection}
        </h2>
        {(previous || retryName) && <p>{previous ? "替换 " + previous.name : "重新导入 " + retryName}</p>}
        <fieldset disabled={!!status}>
          <SegmentedPill
            ariaLabel="导入方式"
            value={kind}
            options={[
              { value: "file", label: "本地文件", disabled: !!status },
              { value: "paste", label: "粘贴文本", disabled: !!status }
            ]}
            onChange={(value) => {
              setKind(value);
              setError("");
            }}
          />
          {kind === "file" ? (
            <>
              <input
                ref={picker}
                type="file"
                hidden
                aria-label="选择本地文件"
                onChange={(e) => select(e.target.files)}
              />
              <WorkspaceChoice
                type="button"
                className="kb-drop"
                data-dragging={dragging}
                disabled={!!status}
                onClick={() => picker.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  select(e.dataTransfer.files);
                }}
              >
                {file ? <FileText size={24} /> : <Upload size={24} />}
                <strong>{file?.name ?? "选择或拖入文件"}</strong>
                <small>{file ? "点击重新选择" : "Markdown、纯文本、代码或文字型 PDF · 最大 16 MB"}</small>
              </WorkspaceChoice>
            </>
          ) : (
            <>
              <WorkspaceField as="label">
                <span>文档名称</span>
                <CompactInput ariaLabel="文档名称" required value={name} onInput={setName} />
              </WorkspaceField>
              <WorkspaceField as="label">
                <span>原文</span>
                <CompactInput
                  ariaLabel="原文"
                  required
                  multiline
                  rows={8}
                  value={content}
                  onInput={setContent}
                />
              </WorkspaceField>
            </>
          )}
          {error && (
            <div role="alert" className="kb-failure">
              <strong>{kind === "file" ? file?.name : name} · 导入失败</strong>
              <p>{error}</p>
              {!!fallback?.chunks && (
                <RippleButton variant="ghost" size="sm" type="button" onClick={() => open(fallback)}>
                  查看仍可搜索的上一版
                </RippleButton>
              )}
            </div>
          )}
          <RippleButton
            variant="primary"
            type="submit"
            disabled={!!status || (kind === "file" ? !file : !name.trim() || !content.trim())}
          >
            导入并索引
          </RippleButton>
        </fieldset>
        {status && <span role="status">{status}</span>}
      </form>
    </WorkspaceSection>
  );
}
