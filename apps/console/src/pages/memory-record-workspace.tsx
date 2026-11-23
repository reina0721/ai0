import {
  WorkspaceCode, WorkspaceGrid, WorkspaceItem, WorkspacePage, WorkspaceRow, WorkspaceSection,
  WorkspaceStatus, WorkspaceTable, WorkspaceTableBody, WorkspaceTableCell, WorkspaceTableHead,
  WorkspaceTableRow
} from "./workspace-layout.js";
import { useState } from "react";

import { useConsole } from "../context/ConsoleContext.js";
import { LineageDagGraphCanvas } from "../design-system/domain-visualizers/index.js";
import { CompactDisclosure, CompactInput, CompactSelect, RippleButton } from "../design-system/primitives/index.js";
import type { ConsoleLiveSnapshot } from "../live-snapshot.js";
import { useAdminResource, WorkspaceConfirm, WorkspaceHeader, WorkspaceReadState } from "./workspace.js";

type MemoryNode = {
  node_type: "memory";
  memory_id: string;
  content_text: string;
  memory_tier: string;
  visibility_scope: string;
  taint_level: string;
  invalidated_at_ts?: number | null;
};
type EventNode = {
  node_type: "event";
  event_id: string;
  event_seq: number;
  virtual_ts_ms: number;
  source_shell_id: string;
  event_category: string;
  audience_scope: string;
  modality: string;
  summary_text: string;
  payload_json?: string;
};
interface LineageData {
  nodes: Array<MemoryNode | EventNode>;
  edges: Array<{ child_memory_id: string; parent_id: string; relation_type: string }>;
  redaction_ledger_count: number;
}

function filterValue(query: string, ...values: string[]): boolean {
  const term = query.trim().toLocaleLowerCase();
  return !term || values.some((value) => value.toLocaleLowerCase().includes(term));
}

export function MemoryRecordWorkspace({ eventsOnly }: { eventsOnly: boolean }) {
  const ctx = useConsole();
  const resource = useAdminResource<LineageData>("memory/lineage");
  const [query, setQuery] = useState("");
  const [modality, setModality] = useState("");
  const [audience, setAudience] = useState("");
  const [selectedId, setSelectedId] = useState<string>();
  const [confirmation, setConfirmation] = useState<{ id: string; kind: "forget" | "seal"; label: string }>();
  const [busy, setBusy] = useState(false);
  const events = resource.data?.nodes.filter((node): node is EventNode => node.node_type === "event") ?? [];
  const memories = resource.data?.nodes.filter((node): node is MemoryNode => node.node_type === "memory") ?? [];
  const shownEvents = events.filter((event) => (!modality || event.modality === modality)
    && (!audience || event.audience_scope === audience)
    && filterValue(query, event.event_id, event.summary_text, event.source_shell_id, event.event_category));
  const shownMemories = memories.filter((memory) => filterValue(query, memory.memory_id, memory.content_text, memory.memory_tier));
  const selectedEvent = shownEvents.find((item) => item.event_id === selectedId);
  const selectedMemory = shownMemories.find((item) => item.memory_id === selectedId);
  const relatedNodes = shownMemories.slice(0, 7);
  const relevantEdges = resource.data?.edges.filter((edge) => relatedNodes.some((node) => node.memory_id === edge.child_memory_id)) ?? [];
  const parents = events.filter((node) => relevantEdges.some((edge) => node.event_id === edge.parent_id)).slice(0, 5);
  const graphNodes = [
    ...parents.map((event) => ({ id: event.event_id, label: event.summary_text.slice(0, 10) || "事件" })),
    ...relatedNodes.map((memory) => ({
      id: memory.memory_id,
      label: memory.content_text.slice(0, 10) || "记忆",
      sealed: Boolean(memory.invalidated_at_ts),
      parentIds: relevantEdges.filter((edge) => edge.child_memory_id === memory.memory_id).map((edge) => edge.parent_id)
    }))
  ];
  const selected = eventsOnly ? selectedEvent : selectedMemory;
  const targetLabel = ctx?.targetInstance === "live" ? "LIVE" : ctx?.targetInstance ?? "当前实例";
  const targetId = selected && (selected.node_type === "event" ? selected.event_id : selected.memory_id);

  const applyMutation = async () => {
    if (!ctx || !confirmation || busy) return;
    setBusy(true);
    try {
      const targets = eventsOnly ? { target_event_ids: [confirmation.id] } : { target_memory_ids: [confirmation.id] };
      if (confirmation.kind === "forget") {
        await ctx.postAdmin("memory/hard-forget", targets);
        ctx.showToast("已完成级联擦除");
      } else {
        await ctx.postAdmin("memory/topic-seal", { ...targets, topic_description: confirmation.label });
        ctx.showToast("已封存话题并生成屏蔽记忆");
      }
      setConfirmation(undefined);
      setSelectedId(undefined);
      resource.refresh();
      await ctx.refreshSnapshot();
    } catch (error) {
      ctx.showToast(`操作失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <WorkspacePage>
      <WorkspaceHeader title={eventsOnly ? "原始事件与语料" : "记忆图谱与隐私擦除"}>
        {!eventsOnly && resource.data ? <WorkspaceStatus data-tone="info">墓碑 {resource.data.redaction_ledger_count}</WorkspaceStatus> : null}
        <RippleButton size="sm" onClick={resource.refresh}>刷新</RippleButton>
      </WorkspaceHeader>
      <WorkspaceSection>
        <WorkspaceGrid columns={3}>
          <CompactInput type="search" value={query} onInput={setQuery} ariaLabel={eventsOnly ? "搜索事件" : "搜索记忆"}
            placeholder={eventsOnly ? "摘要、通道或事件 ID" : "搜索内容、类型或 ID"} />
          {eventsOnly ? (
            <>
              <CompactSelect ariaLabel="感官模态" value={modality} onChange={setModality}
                options={[{ value: "", label: "全部模态" }, ...Array.from(new Set(events.map((entry) => entry.modality))).map((value) => ({ value, label: value }))]} />
              <CompactSelect ariaLabel="可见范围" value={audience} onChange={setAudience}
                options={[{ value: "", label: "全部受众" }, ...Array.from(new Set(events.map((entry) => entry.audience_scope))).map((value) => ({ value, label: value }))]} />
            </>
          ) : null}
        </WorkspaceGrid>
        {!resource.data ? <WorkspaceReadState {...resource} empty="等待实例连接。" onRetry={resource.refresh} /> : null}
        {!eventsOnly && graphNodes.length ? (
          <LineageDagGraphCanvas nodes={graphNodes} selectedId={selectedId}
            onSelect={(id) => { if (shownMemories.some((item) => item.memory_id === id)) setSelectedId(id); }} />
        ) : null}
        {resource.data ? (
          <WorkspaceTable stickyHeader viewportHeight="min(48vh, 520px)" aria-label={eventsOnly ? "事件记录" : "记忆节点"}>
              <WorkspaceTableHead><WorkspaceTableRow>
                <WorkspaceTableCell scope="col">摘要</WorkspaceTableCell>
                <WorkspaceTableCell scope="col">类型</WorkspaceTableCell>
                <WorkspaceTableCell scope="col">范围</WorkspaceTableCell>
              </WorkspaceTableRow></WorkspaceTableHead>
              <WorkspaceTableBody>
                {eventsOnly ? shownEvents.map((event) => (
                  <WorkspaceTableRow key={event.event_id} selected={event.event_id === selectedId}>
                    <WorkspaceTableCell><RippleButton size="sm" variant="ghost" onClick={() => setSelectedId(event.event_id)}>
                      {event.summary_text.slice(0, 48) || event.event_id}</RippleButton></WorkspaceTableCell>
                    <WorkspaceTableCell><small>{event.event_category} · {event.modality}</small></WorkspaceTableCell>
                    <WorkspaceTableCell><code>{event.audience_scope}</code></WorkspaceTableCell>
                  </WorkspaceTableRow>
                )) : shownMemories.map((memory) => (
                  <WorkspaceTableRow key={memory.memory_id} selected={memory.memory_id === selectedId}>
                    <WorkspaceTableCell><RippleButton size="sm" variant="ghost" onClick={() => setSelectedId(memory.memory_id)}>
                      {memory.content_text.slice(0, 48) || memory.memory_id}</RippleButton></WorkspaceTableCell>
                    <WorkspaceTableCell><small>{memory.memory_tier}</small></WorkspaceTableCell>
                    <WorkspaceTableCell><code>{memory.visibility_scope}</code></WorkspaceTableCell>
                  </WorkspaceTableRow>
                ))}
              </WorkspaceTableBody>
          </WorkspaceTable>
        ) : null}
        {resource.data && !(eventsOnly ? shownEvents.length : shownMemories.length) ? <small>没有匹配的记录。</small> : null}
      </WorkspaceSection>
      {selected && targetId ? (
        <WorkspaceSection>
          <WorkspaceRow><h2>{eventsOnly ? "事件详情" : "节点详情"}</h2><code>{targetId}</code></WorkspaceRow>
          {selected.node_type === "event" ? (
            <>
              <small>{selected.source_shell_id} · #{selected.event_seq} · {new Date(selected.virtual_ts_ms).toLocaleString("zh-CN")}</small>
              <p>{selected.summary_text}</p>
              {selected.payload_json ? (
                <CompactDisclosure summary="查看存档载荷"><WorkspaceCode>{selected.payload_json}</WorkspaceCode></CompactDisclosure>
              ) : null}
            </>
          ) : (
            <>
              <p>{selected.content_text}</p>
              <small>{selected.taint_level}{selected.invalidated_at_ts ? " · 已失效" : ""}</small>
              {resource.data?.edges.filter((edge) => edge.child_memory_id === targetId).map((edge) => (
                <small key={`${edge.parent_id}:${edge.relation_type}`}>{edge.relation_type} · <code>{edge.parent_id}</code></small>
              ))}
            </>
          )}
          <div className="ai0-workspace-actions">
            <RippleButton size="sm" variant="secondary" onClick={() => setConfirmation({
              id: targetId, kind: "seal",
              label: (selected.node_type === "event" ? selected.summary_text : selected.content_text).slice(0, 100) || targetId
            })}>话题封存</RippleButton>
            <RippleButton size="sm" variant="danger" onClick={() => setConfirmation({ id: targetId, kind: "forget", label: targetId })}>彻底遗忘</RippleButton>
          </div>
        </WorkspaceSection>
      ) : null}
      {confirmation ? <WorkspaceConfirm title={confirmation.kind === "forget" ? "彻底遗忘记录" : "封存话题"}
        description={<p>目标实例 {targetLabel} · <code>{confirmation.id}</code>。{confirmation.kind === "forget" ? "此操作级联清除相关记录并写入墓碑。" : "此操作封存目标并生成屏蔽记忆。"}</p>}
        busy={busy} onCancel={() => setConfirmation(undefined)} onConfirm={() => void applyMutation()} /> : null}
    </WorkspacePage>
  );
}

export function RelationshipWorkspace({ snapshot }: { snapshot?: ConsoleLiveSnapshot }) {
  const ctx = useConsole();
  const [release, setRelease] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!ctx || busy) return;
    setBusy(true);
    try {
      const result = await ctx.postAdmin<{ released: boolean }>("memory/relationship/release-knot", {});
      await ctx.refreshSnapshot();
      setRelease(false);
      ctx.showToast(result.released ? "已解除当前未解张力" : "当前没有待解除的张力");
    } catch (error) {
      ctx.showToast(`操作失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  };
  const metrics = [["信任连接（尚无测量值）", snapshot?.trustBond], ["社交期待（模型状态）", snapshot?.socialLonging], ["未解张力（条目数）", snapshot?.frictionTension]] as const;
  return (
    <WorkspacePage>
      <WorkspaceHeader title="关系状态与里程碑">
        <RippleButton variant="secondary" disabled={!ctx?.ownerToken} onClick={() => setRelease(true)}>解除未解张力</RippleButton>
      </WorkspaceHeader>
      <WorkspaceSection>
        <h2>当前关系状态</h2>
        <WorkspaceGrid columns={3}>
          {metrics.map(([label, value]) => (
            <WorkspaceItem key={label}><small>{label}</small><strong>{value?.toFixed(2) ?? "—"}</strong></WorkspaceItem>
          ))}
        </WorkspaceGrid>
      </WorkspaceSection>
      <WorkspaceSection>
        <h2>里程碑与纪念记录</h2>
        <WorkspaceGrid columns={2}>
          {snapshot?.milestones.map((milestone) => (
            <WorkspaceItem key={milestone.id} as="article">
              <WorkspaceRow>
                <strong>{milestone.title}</strong><small>{milestone.moment} · {milestone.completed ? "已记录" : "待达成"}</small>
              </WorkspaceRow>
              <p>{milestone.note}</p>
              {milestone.conditions.length ? <small>{milestone.conditions.join("、")}</small> : null}
            </WorkspaceItem>
          ))}
        </WorkspaceGrid>
        {!snapshot?.milestones.length ? <small>当前存档暂无里程碑。</small> : null}
      </WorkspaceSection>
      {release ? <WorkspaceConfirm title="解除未解张力" description="在当前实例查找并解除一项尚未解决的关系张力。"
        busy={busy} onCancel={() => setRelease(false)} onConfirm={() => void run()} /> : null}
    </WorkspacePage>
  );
}
