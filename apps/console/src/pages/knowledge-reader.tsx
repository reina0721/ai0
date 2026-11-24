import { RippleButton, CompactDisclosure } from "../design-system/primitives/index.js";
import { useEffect, useRef } from "react";
import type { KnowledgeDocument } from "@ai0/protocol";
import { ArrowLeft } from "lucide-react";
import { useAdminResource } from "./workspace.js";

interface SourceText {
  format: string;
  pages: string[];
  chunks: { id: string; text: string; location: string }[];
}

export function KnowledgeReader({
  doc,
  path,
  focus,
  back
}: {
  doc: KnowledgeDocument;
  path: string;
  focus: string;
  back: () => void;
}) {
  const { data, error } = useAdminResource<SourceText>(path + "/documents/" + encodeURIComponent(doc.id));
  const target = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const hit = data?.chunks.find((c) => c.id === focus);
  const pageIndex = hit && data?.format === "pdf" ? Number(/^第 (\d+) 页$/.exec(hit.location)?.[1]) - 1 : 0;
  const page = data?.pages[pageIndex] ?? "";
  const lines = hit && /第 (\d+)–(\d+) 行$/.exec(hit.location);
  const line = Number(lines?.[1] ?? 1);
  const lineStart = line > 1 ? page.split("\n", line - 1).join("\n").length + 1 : 0;
  const range = lines
    ? page
        .slice(lineStart)
        .split("\n", Number(lines[2]) - line + 1)
        .join("\n")
    : page;
  const offset = hit ? range.indexOf(hit.text) : -1;
  // When a legacy location is ambiguous, focus its indexed chunk instead of guessing an occurrence.
  const at = hit && offset >= 0 && range.indexOf(hit.text, offset + 1) < 0 ? lineStart + offset : -1;
  useEffect(() => {
    if (!data) return;
    const anchor = target.current ?? heading.current;
    anchor?.focus({ preventScroll: true });
    anchor?.scrollIntoView({ block: "nearest" });
  }, [data, focus]);
  return (
    <section className="kb-original" aria-label="原文阅读区">
      <RippleButton variant="ghost" size="sm" className="kb-back" onClick={back}>
        <ArrowLeft size={14} />
        返回文档列表
      </RippleButton>
      <h2 ref={heading} tabIndex={-1}>
        {doc.name}
      </h2>
      <div className="kb-reader-meta">
        版本 {doc.revision} · {doc.chunks} 个切片{doc.warning && " · " + doc.warning}
      </div>
      {error && (
        <p role="alert" className="kb-error">
          {error}
        </p>
      )}
      {!data && !error && <p role="status">正在读取原文…</p>}
      {data && (
        <>
          {data.format === "legacy" && <small>原文按历史切片恢复。</small>}
          {data.pages.map((body, i) => (
            <article key={i}>
              <small>
                {data.format === "pdf"
                  ? "第 " + (i + 1) + " 页"
                  : "原文 · 共 " + body.split("\n").length + " 行"}
              </small>
              {hit && i === pageIndex && <div className="kb-location">{hit.location}</div>}
              <pre>
                {hit && i === pageIndex && at >= 0 ? (
                  <>
                    {body.slice(0, at)}
                    <mark ref={target} tabIndex={-1}>
                      {hit.text}
                    </mark>
                    {body.slice(at + hit.text.length)}
                  </>
                ) : (
                  body
                )}
              </pre>
            </article>
          ))}
          <CompactDisclosure
            key={focus}
            defaultExpanded={!!hit && at < 0}
            summary={`查看 ${data.chunks.length} 个切片`}
          >
            {data.chunks.map((c) => (
              <article
                key={c.id}
                tabIndex={-1}
                data-hit={c.id === focus && at < 0}
                ref={c.id === focus && at < 0 ? target : undefined}
              >
                <strong>{c.location}</strong>
                <pre>{c.text}</pre>
              </article>
            ))}
          </CompactDisclosure>
        </>
      )}
    </section>
  );
}
