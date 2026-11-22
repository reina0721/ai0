import {
  WorkspaceField, WorkspaceGrid, WorkspaceItem, WorkspacePage, WorkspaceRow, WorkspaceSection,
  WorkspaceStatus
} from "./workspace-layout.js";
import { useState } from "react";

import { useConsole } from "../context/ConsoleContext.js";
import { CompactInput, JellySwitch, RippleButton } from "../design-system/primitives/index.js";
import type { ConsoleStudioState } from "../live-snapshot.js";
import { useWorkspaceDraft, useWorkspaceSave, WorkspaceHeader, WorkspaceSaveButton } from "./workspace.js";

type LoreEntry = ConsoleStudioState["soulStudio"]["lorebooks"][number];
type Activation = { id: string; content: string; priority?: number };
type EditableLoreEntry = Omit<LoreEntry, "keys" | "secondaryKeys"> & { keysText: string; secondaryKeysText: string };
const parseKeys = (input: string) => input.split(/[,，\n]/u).map((key) => key.trim()).filter(Boolean);

export function LorebookWorkspace({ entries }: { entries?: LoreEntry[] }) {
  const ctx = useConsole();
  const draft = useWorkspaceDraft((entries ?? []).map(({ keys, secondaryKeys, ...entry }): EditableLoreEntry => ({
    ...entry, keysText: keys.join("，"), secondaryKeysText: secondaryKeys.join("，")
  })));
  const editedEntries = draft.value.map(({ keysText, secondaryKeysText, ...entry }): LoreEntry => ({
    ...entry, keys: parseKeys(keysText), secondaryKeys: parseKeys(secondaryKeysText)
  }));
  const [query, setQuery] = useState("");
  const [simulation, setSimulation] = useState<Activation[]>();
  const [running, setRunning] = useState(false);
  const form = useWorkspaceSave("soul.lorebooks", draft.dirty, draft.discard, async () => {
    if (editedEntries.some((entry) => !entry.title.trim() || (entry.enabled && !entry.keys.length))) {
      throw new Error("请为每条词条填写标题，并为已启用的词条至少填写一个触发词。");
    }
    await ctx?.postStudio("config", { soulStudio: { lorebooks: editedEntries } });
  }, "世界书已保存", draft.accept);

  const update = (id: string, patch: Partial<EditableLoreEntry>) => {
    draft.setValue((previous) => previous.map((entry) => entry.id === id ? { ...entry, ...patch } : entry));
    setSimulation(undefined);
  };
  const run = async () => {
    if (!ctx || !query.trim() || running) return;
    setRunning(true);
    setSimulation(undefined);
    try {
      const response = await ctx.postAdmin<{ activated_entries: Activation[] }>("soul/lorebooks/simulate", {
        utterance: query.trim(),
        entries: editedEntries.map((entry) => ({
          id: entry.id,
          keys: entry.keys,
          secondary_keys: entry.secondaryKeys,
          content: entry.content,
          enabled: entry.enabled,
          priority: entry.priority,
          max_tokens: entry.tokenBudget
        }))
      });
      setSimulation(response.activated_entries);
    } catch (error) {
      ctx.showToast(`测试失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setRunning(false);
    }
  };
  return (
    <WorkspacePage>
      <WorkspaceHeader title="世界书">
        <RippleButton disabled={!form.canWrite} onClick={() => {
          draft.setValue((previous) => [...previous, {
            id: `lore_${crypto.randomUUID()}`, title: "新词条", keysText: "", secondaryKeysText: "",
            priority: 50, tokenBudget: 160, content: "", enabled: false
          }]);
          setSimulation(undefined);
        }}>添加词条</RippleButton>
        <WorkspaceSaveButton form={form} />
      </WorkspaceHeader>
      <WorkspaceSection>
        <WorkspaceRow>
          <h2>触发模拟</h2>
          {draft.dirty ? <WorkspaceStatus data-tone="accent">使用当前草稿</WorkspaceStatus> : null}
        </WorkspaceRow>
        <WorkspaceGrid columns={2} as="form" onSubmit={(event) => { event.preventDefault(); void run(); }}>
          <CompactInput ariaLabel="模拟对话文本" value={query} onInput={setQuery} placeholder="输入一句模拟对话"
            onKeyDown={(event) => {
              if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
            }} />
          <RippleButton type="submit" variant="primary" loading={running} disabled={!ctx?.ownerToken || !query.trim()}>
            测试命中
          </RippleButton>
        </WorkspaceGrid>
        <small>模拟按主副关键词、优先级及递归匹配运行。</small>
        {simulation ? <div aria-live="polite">
          <strong>命中 {simulation.length} 条</strong>
          {simulation.map((entry) => (
            <WorkspaceItem key={entry.id} as="article">
              <strong>{draft.value.find((item) => item.id === entry.id)?.title ?? entry.id}</strong>
              <p>{entry.content}</p>
            </WorkspaceItem>
          ))}
        </div> : null}
      </WorkspaceSection>
      <WorkspaceGrid columns={2}>
        {draft.value.map((entry) => (
          <WorkspaceItem key={entry.id} as="article" data-lore-id={entry.id}>
            <WorkspaceRow>
              <strong>{entry.title || "未命名词条"}</strong>
              <JellySwitch checked={entry.enabled} disabled={!form.canWrite} ariaLabel={`启用 ${entry.title}`}
                onChange={(enabled) => update(entry.id, { enabled })} />
            </WorkspaceRow>
            <WorkspaceGrid columns={2}>
              <WorkspaceField as="label">标题<CompactInput value={entry.title}
                disabled={!form.canWrite} onInput={(title) => update(entry.id, { title })} /></WorkspaceField>
              <WorkspaceField as="label">Token 预算<CompactInput type="number" min={1} value={entry.tokenBudget}
                disabled={!form.canWrite} onInput={(value) => update(entry.id, { tokenBudget: Math.max(1, Number(value)) })} /></WorkspaceField>
              <WorkspaceField as="label">主关键词（逗号分隔）<CompactInput
                value={entry.keysText} disabled={!form.canWrite}
                onInput={(keysText) => update(entry.id, { keysText })} /></WorkspaceField>
              <WorkspaceField as="label">副关键词（逗号分隔）<CompactInput
                value={entry.secondaryKeysText} disabled={!form.canWrite}
                onInput={(secondaryKeysText) => update(entry.id, { secondaryKeysText })} /></WorkspaceField>
              <WorkspaceField as="label">优先级<CompactInput type="number" value={entry.priority}
                disabled={!form.canWrite} onInput={(value) => update(entry.id, { priority: Number(value) })} /></WorkspaceField>
            </WorkspaceGrid>
            <WorkspaceField as="label">内容<CompactInput multiline rows={3} value={entry.content}
              disabled={!form.canWrite} onInput={(content) => update(entry.id, { content })} /></WorkspaceField>
            <RippleButton size="sm" variant="ghost" disabled={!form.canWrite} onClick={() => {
              draft.setValue((previous) => previous.filter((item) => item.id !== entry.id));
              setSimulation(undefined);
            }}>移除词条</RippleButton>
          </WorkspaceItem>
        ))}
      </WorkspaceGrid>
      {!draft.value.length ? <WorkspaceSection><small>世界书暂无词条。</small></WorkspaceSection> : null}
    </WorkspacePage>
  );
}
