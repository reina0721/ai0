import type { AgentSkillRecord, AudienceScope, CapabilityRisk } from "@ai0/protocol";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Drawer from "@mui/material/Drawer";
import { useMemo, useState, type ReactElement } from "react";

import { useConsole } from "../../context/ConsoleContext.js";
import {
  CompactInput,
  CompactSelect,
  JellySwitch,
  RippleButton
} from "../../design-system/primitives/index.js";
import { renderConsoleIcon } from "../../design-system/tokens/index.js";
import type { ConsoleLiveSnapshot } from "../../live-snapshot.js";
import {
  WorkspaceField,
  WorkspaceGrid,
  WorkspacePage,
  WorkspaceStatus,
  WorkspaceTag
} from "../workspace-layout.js";
import { WorkspaceConfirm, WorkspaceHeader } from "../workspace.js";

const SAMPLE_IMPORT_SKILL = `---
skill_id: "soul.skill.evening-journal"
display_name: "晚间静心复盘"
description: "睡前用三个轻问题陪伴梳理今天的情绪与未尽之事"
required_mcp_tools: []
capability_risk: "read_only_safe"
max_audience_scope: "only_owner"
in_character_demeanor: "温柔克制、像安静坐在窗边的好友"
crystallize_as_episodic_memory: true
---

# 晚间静心复盘

## 流程
1. 先共情今天最消耗精力的片刻。
2. 邀请记下一件微小但值得保留的小事。
3. 给出一个轻松的睡前收尾仪式。
`;

export function SkillsWorkbenchTab(props: { snapshot?: ConsoleLiveSnapshot }): ReactElement {
  const ctx = useConsole();
  const snap = props.snapshot ?? ctx?.snapshot;
  const skills = snap?.skills ?? [];
  const canWrite = Boolean(ctx?.ownerToken && ctx.mode === "live");

  const [query, setQuery] = useState("");
  const [sourceFilter, setSourceFilter] = useState<"all" | "soul_user" | "plugin_bundled">("all");
  const [busyId, setBusyId] = useState<string>();

  // Slide-over Skill Editor Drawer
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<AgentSkillRecord | null>(null);
  const [slug, setSlug] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [demeanor, setDemeanor] = useState("");
  const [toolsText, setToolsText] = useState("");
  const [risk, setRisk] = useState<CapabilityRisk>("read_only_safe");
  const [scope, setScope] = useState<AudienceScope>("only_owner");
  const [crystallize, setCrystallize] = useState(false);
  const [bodyMarkdown, setBodyMarkdown] = useState("");
  const [saving, setSaving] = useState(false);

  // Import Raw SKILL.md Modal
  const [importOpen, setImportOpen] = useState(false);
  const [importMd, setImportMd] = useState(SAMPLE_IMPORT_SKILL);
  const [importing, setImporting] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<AgentSkillRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter((skill) => {
      if (sourceFilter !== "all" && skill.source !== sourceFilter) return false;
      if (!q) return true;
      return (
        skill.displayName.toLowerCase().includes(q) ||
        skill.id.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q) ||
        skill.slug.toLowerCase().includes(q)
      );
    });
  }, [skills, query, sourceFilter]);

  const openCreateDrawer = () => {
    setEditingSkill(null);
    setSlug("");
    setDisplayName("");
    setDescription("");
    setDemeanor("温柔自然、克制真诚");
    setToolsText("");
    setRisk("read_only_safe");
    setScope("only_owner");
    setCrystallize(false);
    setBodyMarkdown("# 新技能手册\n\n## 目标\n描述该技能在什么语境下触发以及期望的交互风格。\n");
    setDrawerOpen(true);
  };

  const openEditDrawer = (skill: AgentSkillRecord) => {
    setEditingSkill(skill);
    setSlug(skill.slug);
    setDisplayName(skill.displayName);
    setDescription(skill.description);
    setDemeanor(skill.inCharacterDemeanor);
    setToolsText(skill.requiredMcpTools.join(", "));
    setRisk(skill.capabilityRisk);
    setScope(skill.maxAudienceScope);
    setCrystallize(skill.crystallizeAsEpisodicMemory);
    setBodyMarkdown(skill.bodyMarkdown);
    setDrawerOpen(true);
  };

  const handleCloneBundledToUser = () => {
    if (!editingSkill) return;
    setEditingSkill(null);
    setSlug(`${editingSkill.slug}-custom`);
    setDisplayName(`${editingSkill.displayName} (自定义副本)`);
    ctx?.showToast("已切换为可编辑用户副本，点击「保存到 .soul/skills」即可落盘");
  };

  const handleSaveSkill = async () => {
    if (!ctx || !canWrite || saving) return;
    if (!displayName.trim()) {
      ctx.showToast("请填写技能名称");
      return;
    }
    const payload = {
      slug: slug.trim() || undefined,
      displayName: displayName.trim(),
      description: description.trim(),
      inCharacterDemeanor: demeanor.trim(),
      requiredMcpTools: toolsText
        .split(/[,\n，]+/u)
        .map((s) => s.trim())
        .filter(Boolean),
      capabilityRisk: risk,
      maxAudienceScope: scope,
      crystallizeAsEpisodicMemory: crystallize,
      bodyMarkdown
    };
    setSaving(true);
    try {
      if (editingSkill && !editingSkill.readonly) {
        await ctx.putAdmin(`extensions/skills/${encodeURIComponent(editingSkill.id)}`, payload, "live");
      } else {
        await ctx.postAdmin("extensions/skills", payload, "live");
      }
      setDrawerOpen(false);
      await ctx.refreshSnapshot();
      ctx.showToast(`已保存技能「${displayName.trim()}」至 .soul/skills/`);
    } catch (err) {
      ctx.showToast(`保存技能失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleImportMarkdown = async () => {
    if (!ctx || !canWrite || importing) return;
    setImporting(true);
    try {
      await ctx.postAdmin("extensions/skills", { rawMarkdown: importMd }, "live");
      setImportOpen(false);
      await ctx.refreshSnapshot();
      ctx.showToast("已导入 SKILL.md 技能并写入 .soul/skills/");
    } catch (err) {
      ctx.showToast(`导入失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setImporting(false);
    }
  };

  const handleToggle = async (skill: AgentSkillRecord, enabled: boolean) => {
    if (!ctx || !canWrite || busyId) return;
    setBusyId(skill.id);
    try {
      await ctx.patchAdmin(`extensions/skills/${encodeURIComponent(skill.id)}`, { enabled }, "live");
      await ctx.refreshSnapshot();
    } catch (err) {
      ctx.showToast(`切换状态失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusyId(undefined);
    }
  };

  const handleDelete = async () => {
    if (!ctx || !canWrite || !deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await ctx.deleteAdmin(`extensions/skills/${encodeURIComponent(deleteTarget.id)}`, "live");
      setDeleteTarget(null);
      await ctx.refreshSnapshot();
      ctx.showToast(`已删除用户技能「${deleteTarget.displayName}」`);
    } catch (err) {
      ctx.showToast(`删除失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeleting(false);
    }
  };

  const isReadonlyEditing = Boolean(editingSkill?.readonly);

  return (
    <WorkspacePage data-skills-page="true">
      <WorkspaceHeader title="技能 (Skills)">
        <RippleButton
          size="sm"
          variant="secondary"
          data-import-skill-btn="true"
          disabled={!canWrite}
          onClick={() => setImportOpen(true)}
        >
          {renderConsoleIcon("upload", 13)}
          <span>导入 SKILL.md</span>
        </RippleButton>
        <RippleButton
          variant="primary"
          data-create-skill-btn="true"
          disabled={!canWrite}
          onClick={openCreateDrawer}
        >
          {renderConsoleIcon("plus", 14)}
          <span>新建技能</span>
        </RippleButton>
      </WorkspaceHeader>

      <div className="ai0-filter-bar">
        <div className="ai0-filter-bar__search">
          <CompactInput
            type="search"
            ariaLabel="搜索技能"
            value={query}
            placeholder="搜索技能名称、目录名或说明…"
            onInput={setQuery}
          />
        </div>
        <div className="ai0-workspace-actions">
          {(
            [
              ["all", `全部 (${skills.length})`],
              ["soul_user", "用户自定义 (.soul/skills)"],
              ["plugin_bundled", "插件内置 (只读)"]
            ] as const
          ).map(([id, label]) => (
            <RippleButton
              key={id}
              size="sm"
              variant={sourceFilter === id ? "primary" : "secondary"}
              onClick={() => setSourceFilter(id)}
            >
              {label}
            </RippleButton>
          ))}
        </div>
      </div>

      {!filtered.length ? (
        <small>当前筛选下暂无 SKILL.md 技能，点击右上角「新建技能」或「导入 SKILL.md」。</small>
      ) : (
        <div className="ai0-card-grid">
          {filtered.map((skill) => (
            <article
              key={skill.id}
              className="ai0-entity-card"
              data-skill-card={skill.id}
              data-disabled={!skill.enabled}
            >
              <div className="ai0-entity-card__header">
                <div className="ai0-entity-card__title">
                  <div className="ai0-entity-card__title-row">
                    <strong>{skill.displayName}</strong>
                    <WorkspaceStatus data-tone={skill.source === "plugin_bundled" ? "info" : "live"}>
                      {skill.source === "plugin_bundled" ? "插件内置 · 只读" : "用户自定义"}
                    </WorkspaceStatus>
                  </div>
                  <small><code>{skill.slug}/SKILL.md</code> · <code>{skill.id}</code></small>
                </div>
                <JellySwitch
                  ariaLabel={`启用技能 ${skill.displayName}`}
                  checked={skill.enabled}
                  disabled={!canWrite || busyId === skill.id}
                  onChange={(enabled) => void handleToggle(skill, enabled)}
                />
              </div>

              <div className="ai0-entity-card__body">
                <p>{skill.description || "声明式 Agent 行为与工具协作规范。"}</p>
                {skill.inCharacterDemeanor ? (
                  <small>执行姿态：{skill.inCharacterDemeanor}</small>
                ) : null}
                <div className="ai0-entity-card__badges">
                  <WorkspaceTag>受众：{skill.maxAudienceScope}</WorkspaceTag>
                  <WorkspaceTag>{skill.capabilityRisk}</WorkspaceTag>
                  {skill.requiredMcpTools.map((tool) => (
                    <WorkspaceStatus key={tool} data-tone="accent">MCP: {tool}</WorkspaceStatus>
                  ))}
                </div>
              </div>

              <div className="ai0-entity-card__footer">
                <div className="ai0-entity-card__actions">
                  <RippleButton
                    size="sm"
                    variant="secondary"
                    data-edit-skill={skill.id}
                    onClick={() => openEditDrawer(skill)}
                  >
                    {renderConsoleIcon("book", 12)}
                    <span>{skill.readonly ? "查看 / 复制" : "编辑 SKILL.md"}</span>
                  </RippleButton>
                </div>
                {!skill.readonly ? (
                  <RippleButton
                    size="sm"
                    variant="ghost"
                    ariaLabel={`删除技能 ${skill.displayName}`}
                    data-delete-skill={skill.id}
                    disabled={!canWrite}
                    onClick={() => setDeleteTarget(skill)}
                  >
                    {renderConsoleIcon("trash", 13)}
                  </RippleButton>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}

      {/* Wide Slide-over Frontmatter + Markdown Editor Drawer */}
      <Drawer
        anchor="right"
        open={drawerOpen}
        onClose={() => !saving && setDrawerOpen(false)}
        slotProps={{ paper: { className: "ai0-drawer-surface", "data-size": "wide" } as Record<string, unknown> }}
      >
        <header className="ai0-drawer-header">
          <div>
            <h2 style={{ margin: 0 }}>
              {isReadonlyEditing
                ? `查看插件内置技能 · ${editingSkill?.displayName}`
                : editingSkill
                  ? `编辑技能 · ${editingSkill.displayName}`
                  : "新建 SKILL.md 技能"}
            </h2>
            <small>
              {isReadonlyEditing
                ? `源文件：${editingSkill?.filePath}（只读，可复制为自定义副本后自由修改）`
                : "落盘保存为真实 .soul/skills/<slug>/SKILL.md（含 YAML Frontmatter 与 Markdown 正文）"}
            </small>
          </div>
          <RippleButton size="sm" variant="ghost" ariaLabel="关闭技能编辑抽屉" onClick={() => setDrawerOpen(false)}>
            {renderConsoleIcon("close", 15)}
          </RippleButton>
        </header>

        <div className="ai0-drawer-body">
          <WorkspaceGrid columns={2}>
            <WorkspaceField>
              <label>技能显示名称</label>
              <CompactInput
                ariaLabel="技能显示名称"
                value={displayName}
                disabled={isReadonlyEditing || !canWrite}
                placeholder="例如：深夜代码陪伴复盘"
                onInput={setDisplayName}
              />
            </WorkspaceField>
            <WorkspaceField>
              <label>目录标识 (slug，留空自动生成)</label>
              <CompactInput
                ariaLabel="技能目录标识"
                value={slug}
                disabled={Boolean(editingSkill) || !canWrite}
                placeholder="例如：late-night-review"
                onInput={setSlug}
              />
            </WorkspaceField>
          </WorkspaceGrid>

          <WorkspaceField>
            <label>触发说明 (description)</label>
            <CompactInput
              ariaLabel="技能触发说明"
              value={description}
              disabled={isReadonlyEditing || !canWrite}
              onInput={setDescription}
            />
          </WorkspaceField>

          <WorkspaceGrid columns={2}>
            <WorkspaceField>
              <label>角色执行姿态 (in_character_demeanor)</label>
              <CompactInput
                ariaLabel="角色执行姿态"
                value={demeanor}
                disabled={isReadonlyEditing || !canWrite}
                onInput={setDemeanor}
              />
            </WorkspaceField>
            <WorkspaceField>
              <label>依赖的 MCP 工具名（逗号分隔）</label>
              <CompactInput
                ariaLabel="依赖的 MCP 工具"
                value={toolsText}
                disabled={isReadonlyEditing || !canWrite}
                placeholder="github.list_commits, local.read_file"
                onInput={setToolsText}
              />
            </WorkspaceField>
          </WorkspaceGrid>

          <WorkspaceGrid columns={2}>
            <WorkspaceField>
              <span>风险分级</span>
              <CompactSelect
                ariaLabel="技能风险分级"
                value={risk}
                disabled={isReadonlyEditing || !canWrite}
                onChange={(v) => setRisk(v as CapabilityRisk)}
                options={[
                  { value: "read_only_safe", label: "read_only_safe（只读安全）" },
                  { value: "low_read_and_scoped_write", label: "low_read_and_scoped_write（受限写入）" },
                  { value: "high_side_effect_privileged", label: "high_side_effect_privileged（高权限）" }
                ]}
              />
            </WorkspaceField>
            <WorkspaceField>
              <span>最大受众范围</span>
              <CompactSelect
                ariaLabel="技能最大受众范围"
                value={scope}
                disabled={isReadonlyEditing || !canWrite}
                onChange={(v) => setScope(v as AudienceScope)}
                options={[
                  { value: "only_owner", label: "仅主账户私密 (only_owner)" },
                  { value: "group:default", label: "受限群组 (group:default)" },
                  { value: "public_all", label: "公开受众 (public_all)" }
                ]}
              />
            </WorkspaceField>
          </WorkspaceGrid>

          <JellySwitch
            label="执行结束后允许提议结晶为情节记忆 (crystallize_as_episodic_memory)"
            checked={crystallize}
            disabled={isReadonlyEditing || !canWrite}
            onChange={setCrystallize}
          />

          <WorkspaceField>
            <label>SKILL.md 行为规范正文 (Markdown)</label>
            <CompactInput
              multiline
              rows={14}
              ariaLabel="SKILL Markdown 正文"
              value={bodyMarkdown}
              disabled={isReadonlyEditing || !canWrite}
              onInput={setBodyMarkdown}
            />
          </WorkspaceField>
        </div>

        <footer className="ai0-drawer-footer">
          {isReadonlyEditing ? (
            <RippleButton size="sm" variant="secondary" disabled={!canWrite} onClick={handleCloneBundledToUser}>
              {renderConsoleIcon("plus", 13)}
              <span>复制为可编辑用户技能</span>
            </RippleButton>
          ) : (
            <small>保存后立即生效并同步至磁盘目录。</small>
          )}
          <div className="ai0-workspace-actions">
            <RippleButton size="sm" variant="ghost" disabled={saving} onClick={() => setDrawerOpen(false)}>关闭</RippleButton>
            {!isReadonlyEditing ? (
              <RippleButton
                size="sm"
                variant="primary"
                data-confirm-save-skill="true"
                loading={saving}
                disabled={!canWrite}
                onClick={() => void handleSaveSkill()}
              >
                {renderConsoleIcon("save", 13)}
                <span>保存到 .soul/skills</span>
              </RippleButton>
            ) : null}
          </div>
        </footer>
      </Drawer>

      {/* Import Raw SKILL.md Modal */}
      <Dialog open={importOpen} onClose={() => !importing && setImportOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>导入标准 SKILL.md 文件内容</DialogTitle>
        <DialogContent>
          <div className="ai0-workspace-stack" style={{ paddingTop: 6 }}>
            <small>支持粘贴带 YAML Frontmatter 的完整 <code>SKILL.md</code>，将自动解析并落盘至 <code>.soul/skills/</code>。</small>
            <CompactInput
              multiline
              rows={14}
              ariaLabel="导入 SKILL.md 源码"
              value={importMd}
              onInput={setImportMd}
            />
          </div>
        </DialogContent>
        <DialogActions>
          <RippleButton variant="ghost" disabled={importing} onClick={() => setImportOpen(false)}>取消</RippleButton>
          <RippleButton variant="primary" data-confirm-import-skill="true" loading={importing} onClick={() => void handleImportMarkdown()}>
            {renderConsoleIcon("upload", 13)}
            <span>导入并落盘</span>
          </RippleButton>
        </DialogActions>
      </Dialog>

      {deleteTarget ? (
        <WorkspaceConfirm
          title={`删除用户技能「${deleteTarget.displayName}」`}
          description={`将永久删除 .soul/skills/${deleteTarget.slug}/SKILL.md 文件。`}
          busy={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void handleDelete()}
        />
      ) : null}
    </WorkspacePage>
  );
}
