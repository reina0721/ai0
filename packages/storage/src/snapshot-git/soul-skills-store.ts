import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";

import {
  AgentSkillRecordSchema,
  CarrierProjectionSchema, type CarrierProjection,
  type AgentSkillRecord,
  type AudienceScope,
  type CapabilityRisk
} from "@ai0/protocol";

export interface SkillsStateFile {
  schemaVersion: 1;
  enabledOverrides: Record<string, boolean>;
}

export function getSoulSkillsDir(soulDirPath: string): string {
  return join(resolve(soulDirPath), "skills");
}

export function getSoulSkillsStatePath(soulDirPath: string): string {
  return join(resolve(soulDirPath), "config", "skills_state.json");
}

function atomicWriteText(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${randomUUID()}.tmp`;
  try {
    writeFileSync(tempPath, content, { flag: "wx", encoding: "utf8" });
    renameSync(tempPath, filePath);
  } finally {
    rmSync(tempPath, { force: true });
  }
}

export function sanitizeSkillSlug(input: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 64);
  if (!slug || slug === "." || slug === "..") {
    throw new Error("无效的技能目录标识（仅允许字母、数字、短横线或下划线）");
  }
  return slug;
}

function readSkillsState(soulDirPath: string): SkillsStateFile {
  const statePath = getSoulSkillsStatePath(soulDirPath);
  if (!existsSync(statePath)) {
    return { schemaVersion: 1, enabledOverrides: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as Partial<SkillsStateFile>;
    return {
      schemaVersion: 1,
      enabledOverrides:
        parsed.enabledOverrides && typeof parsed.enabledOverrides === "object"
          ? parsed.enabledOverrides
          : {}
    };
  } catch {
    return { schemaVersion: 1, enabledOverrides: {} };
  }
}

function writeSkillsState(soulDirPath: string, state: SkillsStateFile): void {
  atomicWriteText(getSoulSkillsStatePath(soulDirPath), `${JSON.stringify(state, null, 2)}\n`);
}

function unquoteYamlString(raw: string): string {
  const trimmed = raw.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      return trimmed.startsWith('"') ? (JSON.parse(trimmed) as string) : trimmed.slice(1, -1);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function parseYamlStringArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[]") return [];
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.map((item) => String(item).trim()).filter(Boolean);
      }
    } catch {
      return trimmed
        .slice(1, -1)
        .split(",")
        .map((s) => unquoteYamlString(s))
        .filter(Boolean);
    }
  }
  return [unquoteYamlString(trimmed)].filter(Boolean);
}

export interface ParsedSkillMarkdown {
  readonly frontmatter: Record<string, unknown>;
  readonly bodyMarkdown: string;
}

/**
 * Pure zero-dependency YAML frontmatter parser tailored to ai0 SKILL.md files.
 */
export function parseSkillMarkdown(rawText: string): ParsedSkillMarkdown {
  const normalized = rawText.replace(/\r\n/gu, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/u.exec(normalized);
  if (!match) {
    return { frontmatter: {}, bodyMarkdown: normalized.trim() };
  }

  const fmText = match[1]!;
  const bodyMarkdown = match[2]!.trim();
  const frontmatter: Record<string, unknown> = {};
  if (fmText.trimStart().startsWith("{") || /^projections\s*:/mu.test(fmText)) return { frontmatter: parseYaml(fmText), bodyMarkdown };
  let activeArrayKey: string | undefined;

  for (const line of fmText.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (activeArrayKey && /^-\s+(.+)$/u.test(trimmed)) {
      const itemMatch = /^-\s+(.+)$/u.exec(trimmed);
      if (itemMatch) {
        const list = (frontmatter[activeArrayKey] as string[] | undefined) ?? [];
        list.push(unquoteYamlString(itemMatch[1]!));
        frontmatter[activeArrayKey] = list;
      }
      continue;
    }

    const kv = /^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/u.exec(trimmed);
    if (!kv) {
      activeArrayKey = undefined;
      continue;
    }
    const key = kv[1]!;
    const rawVal = kv[2]!.trim();
    if (rawVal === "") {
      frontmatter[key] = [];
      activeArrayKey = key;
      continue;
    }
    activeArrayKey = undefined;
    if (rawVal === "true" || rawVal === "false") {
      frontmatter[key] = rawVal === "true";
    } else if (rawVal.startsWith("[") && rawVal.endsWith("]")) {
      frontmatter[key] = parseYamlStringArray(rawVal);
    } else {
      frontmatter[key] = unquoteYamlString(rawVal);
    }
  }

  return { frontmatter, bodyMarkdown };
}

export function serializeSkillMarkdown(record: {
  projections?: readonly CarrierProjection[];
  id: string;
  displayName: string;
  description: string;
  requiredMcpTools: readonly string[];
  capabilityRisk: CapabilityRisk;
  maxAudienceScope: AudienceScope;
  inCharacterDemeanor: string;
  crystallizeAsEpisodicMemory: boolean;
  requiredVaultSecrets: readonly string[];
  bodyMarkdown: string;
}): string {
  const lines = [
    "---",
    ...(record.projections ? [`projections: ${JSON.stringify(record.projections)}`] : []),
    `skill_id: ${JSON.stringify(record.id)}`,
    `display_name: ${JSON.stringify(record.displayName)}`,
    `description: ${JSON.stringify(record.description)}`,
    `required_mcp_tools: ${JSON.stringify([...record.requiredMcpTools])}`,
    `capability_risk: ${JSON.stringify(record.capabilityRisk)}`,
    `max_audience_scope: ${JSON.stringify(record.maxAudienceScope)}`,
    `in_character_demeanor: ${JSON.stringify(record.inCharacterDemeanor)}`,
    `crystallize_as_episodic_memory: ${record.crystallizeAsEpisodicMemory ? "true" : "false"}`,
    `required_vault_secrets: ${JSON.stringify([...record.requiredVaultSecrets])}`,
    "---",
    "",
    record.bodyMarkdown.trim(),
    ""
  ];
  return lines.join("\n");
}

function scanSkillsDirectory(
  rootDir: string,
  source: "soul_user" | "plugin_bundled",
  enabledOverrides: Record<string, boolean>
): AgentSkillRecord[] {
  if (!existsSync(rootDir)) return [];
  const results: AgentSkillRecord[] = [];
  const entries = readdirSync(rootDir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const skillPath = join(rootDir, entry.name, "SKILL.md");
    if (!existsSync(skillPath)) continue;
    try {
      const content = readFileSync(skillPath, "utf8");
      const stats = statSync(skillPath);
      const { frontmatter, bodyMarkdown } = parseSkillMarkdown(content);
      const id =
        typeof frontmatter.skill_id === "string" && frontmatter.skill_id.trim()
          ? frontmatter.skill_id.trim()
          : `${source === "plugin_bundled" ? "plugin" : "soul"}.skill.${entry.name}`;
      const displayName =
        typeof frontmatter.display_name === "string" && frontmatter.display_name.trim()
          ? frontmatter.display_name.trim()
          : typeof frontmatter.name === "string" && frontmatter.name.trim()
            ? frontmatter.name.trim()
            : entry.name;
      const riskRaw = typeof frontmatter.capability_risk === "string" ? frontmatter.capability_risk : "read_only_safe";
      const capabilityRisk: CapabilityRisk =
        riskRaw === "low_read_and_scoped_write" || riskRaw === "high_side_effect_privileged"
          ? riskRaw
          : "read_only_safe";
      const scopeRaw = typeof frontmatter.max_audience_scope === "string" ? frontmatter.max_audience_scope : "only_owner";
      const maxAudienceScope: AudienceScope =
        scopeRaw === "public_all" || scopeRaw.startsWith("group:")
          ? (scopeRaw as AudienceScope)
          : "only_owner";

      const record = AgentSkillRecordSchema.parse({
        projections: frontmatter.projections,
        id,
        slug: entry.name,
        displayName,
        description: typeof frontmatter.description === "string" ? frontmatter.description : "",
        source,
        filePath: skillPath,
        readonly: source === "plugin_bundled",
        enabled: enabledOverrides[id] ?? true,
        requiredMcpTools: Array.isArray(frontmatter.required_mcp_tools)
          ? frontmatter.required_mcp_tools.map(String)
          : [],
        requiredVaultSecrets: Array.isArray(frontmatter.required_vault_secrets)
          ? frontmatter.required_vault_secrets.map(String)
          : [],
        capabilityRisk,
        maxAudienceScope,
        inCharacterDemeanor:
          typeof frontmatter.in_character_demeanor === "string"
            ? frontmatter.in_character_demeanor
            : "",
        crystallizeAsEpisodicMemory: Boolean(frontmatter.crystallize_as_episodic_memory),
        bodyMarkdown,
        updatedAt: stats.mtime.toISOString()
      });
      results.push(record);
    } catch {
      // Skip malformed SKILL.md files rather than breaking console discovery
    }
  }
  return results;
}

/**
 * Discovers all SKILL.md skills from both:
 * 1) `.soul/skills/<slug>/SKILL.md` (user-authored, editable & deletable)
 * 2) `plugins/skills-and-mcp/<slug>/SKILL.md` (plugin-bundled, read-only)
 */
export function listAgentSkills(
  soulDirPath: string,
  bundledSkillsDir?: string
): AgentSkillRecord[] {
  const state = readSkillsState(soulDirPath);
  const userSkills = scanSkillsDirectory(getSoulSkillsDir(soulDirPath), "soul_user", state.enabledOverrides);
  const bundledSkills = bundledSkillsDir
    ? scanSkillsDirectory(bundledSkillsDir, "plugin_bundled", state.enabledOverrides)
    : [];
  // Deduplicate by id (user skills take precedence over bundled with same id)
  const seen = new Set(userSkills.map((s) => s.id));
  return [...userSkills, ...bundledSkills.filter((s) => !seen.has(s.id))];
}

export function setAgentSkillEnabled(
  soulDirPath: string,
  skillId: string,
  enabled: boolean
): void {
  const state = readSkillsState(soulDirPath);
  state.enabledOverrides[skillId] = enabled;
  writeSkillsState(soulDirPath, state);
}

export interface SaveUserSkillInput {
  projections?: CarrierProjection[];
  slug?: string;
  id?: string;
  displayName: string;
  description?: string;
  requiredMcpTools?: readonly string[];
  requiredVaultSecrets?: readonly string[];
  capabilityRisk?: CapabilityRisk;
  maxAudienceScope?: AudienceScope;
  inCharacterDemeanor?: string;
  crystallizeAsEpisodicMemory?: boolean;
  bodyMarkdown: string;
  enabled?: boolean;
}

export function saveUserAgentSkill(
  soulDirPath: string,
  input: SaveUserSkillInput
): AgentSkillRecord {
  const slug = sanitizeSkillSlug(input.slug || input.displayName || "custom-skill");
  const id = input.id?.trim() || `soul.skill.${slug}`;
  const skillDir = join(getSoulSkillsDir(soulDirPath), slug);
  const filePath = join(skillDir, "SKILL.md");

  const markdown = serializeSkillMarkdown({
    projections: input.projections,
    id,
    displayName: input.displayName.trim() || slug,
    description: input.description?.trim() ?? "",
    requiredMcpTools: input.requiredMcpTools ?? [],
    requiredVaultSecrets: input.requiredVaultSecrets ?? [],
    capabilityRisk: input.capabilityRisk ?? "read_only_safe",
    maxAudienceScope: input.maxAudienceScope ?? "only_owner",
    inCharacterDemeanor: input.inCharacterDemeanor?.trim() ?? "",
    crystallizeAsEpisodicMemory: Boolean(input.crystallizeAsEpisodicMemory),
    bodyMarkdown: input.bodyMarkdown
  });

  atomicWriteText(filePath, markdown);
  if (input.enabled !== undefined) {
    setAgentSkillEnabled(soulDirPath, id, input.enabled);
  }
  const skills = listAgentSkills(soulDirPath);
  return skills.find((s) => s.slug === slug) ?? AgentSkillRecordSchema.parse({
    id,
    slug,
    displayName: input.displayName.trim() || slug,
    description: input.description?.trim() ?? "",
    source: "soul_user",
    filePath,
    readonly: false,
    enabled: input.enabled ?? true,
    requiredMcpTools: [...(input.requiredMcpTools ?? [])],
    requiredVaultSecrets: [...(input.requiredVaultSecrets ?? [])],
    capabilityRisk: input.capabilityRisk ?? "read_only_safe",
    maxAudienceScope: input.maxAudienceScope ?? "only_owner",
    inCharacterDemeanor: input.inCharacterDemeanor?.trim() ?? "",
    crystallizeAsEpisodicMemory: Boolean(input.crystallizeAsEpisodicMemory),
    bodyMarkdown: input.bodyMarkdown
  });
}

export function importUserSkillMarkdown(
  soulDirPath: string,
  rawMarkdown: string,
  preferredSlug?: string
): AgentSkillRecord {
  const { frontmatter, bodyMarkdown } = parseSkillMarkdown(rawMarkdown);
  const displayName =
    typeof frontmatter.display_name === "string" && frontmatter.display_name.trim()
      ? frontmatter.display_name.trim()
      : typeof frontmatter.name === "string" && frontmatter.name.trim()
        ? frontmatter.name.trim()
        : preferredSlug || "imported-skill";
  const slug = sanitizeSkillSlug(
    preferredSlug ||
      (typeof frontmatter.skill_id === "string" ? frontmatter.skill_id.split(".").pop() ?? displayName : displayName)
  );
  const riskRaw = typeof frontmatter.capability_risk === "string" ? frontmatter.capability_risk : "read_only_safe";
  const capabilityRisk: CapabilityRisk =
    riskRaw === "low_read_and_scoped_write" || riskRaw === "high_side_effect_privileged"
      ? riskRaw
      : "read_only_safe";
  const scopeRaw = typeof frontmatter.max_audience_scope === "string" ? frontmatter.max_audience_scope : "only_owner";
  const maxAudienceScope: AudienceScope =
    scopeRaw === "public_all" || scopeRaw.startsWith("group:")
      ? (scopeRaw as AudienceScope)
      : "only_owner";

  return saveUserAgentSkill(soulDirPath, {
    projections: CarrierProjectionSchema.array().optional().parse(frontmatter.projections),
    slug,
    id:
      typeof frontmatter.skill_id === "string" && frontmatter.skill_id.trim()
        ? frontmatter.skill_id.trim()
        : `soul.skill.${slug}`,
    displayName,
    description: typeof frontmatter.description === "string" ? frontmatter.description : "",
    requiredMcpTools: Array.isArray(frontmatter.required_mcp_tools)
      ? frontmatter.required_mcp_tools.map(String)
      : [],
    requiredVaultSecrets: Array.isArray(frontmatter.required_vault_secrets)
      ? frontmatter.required_vault_secrets.map(String)
      : [],
    capabilityRisk,
    maxAudienceScope,
    inCharacterDemeanor:
      typeof frontmatter.in_character_demeanor === "string"
        ? frontmatter.in_character_demeanor
        : "",
    crystallizeAsEpisodicMemory: Boolean(frontmatter.crystallize_as_episodic_memory),
    bodyMarkdown: bodyMarkdown || rawMarkdown.trim(),
    enabled: true
  });
}

export function deleteUserAgentSkill(
  soulDirPath: string,
  skillIdOrSlug: string,
  bundledSkillsDir?: string
): void {
  const all = listAgentSkills(soulDirPath, bundledSkillsDir);
  const target = all.find((s) => s.id === skillIdOrSlug || s.slug === skillIdOrSlug);
  if (!target) {
    throw new Error(`未找到技能：${skillIdOrSlug}`);
  }
  if (target.readonly || target.source === "plugin_bundled") {
    throw new Error("插件内置技能为只读，无法删除（可停用或复制为自定义技能）");
  }
  const safeSlug = sanitizeSkillSlug(target.slug);
  rmSync(join(getSoulSkillsDir(soulDirPath), safeSlug), { recursive: true, force: true });
  const state = readSkillsState(soulDirPath);
  delete state.enabledOverrides[target.id];
  writeSkillsState(soulDirPath, state);
}
