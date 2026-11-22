import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CompactSelect } from "./design-system/primitives/CompactSelect.js";

describe("CompactSelect field semantics", () => {
  it("preserves a named empty option as the selection", () => {
    const markup = renderToStaticMarkup(
      <CompactSelect name="modality" ariaLabel="模态" value="" placeholder="选择模态" onChange={() => {}}
        options={[{ value: "", label: "全部模态" }, { value: "text", label: "文本" }]} />
    );

    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('aria-label="模态"');
    expect(markup).toContain(">全部模态</div>");
    expect(markup).toMatch(/<input[^>]* name="modality"[^>]* value=""/u);
    expect(markup).not.toContain("<select");
  });

  it("shows a saved ID while its options are unavailable", () => {
    const markup = renderToStaticMarkup(
      <CompactSelect name="model" value="provider-pending" options={[]} onChange={() => {}} />
    );

    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain(">provider-pending</span>");
  });
});
