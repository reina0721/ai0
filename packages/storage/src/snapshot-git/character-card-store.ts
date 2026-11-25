import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { inflateSync } from "node:zlib";
import {
  Ai0SoulCardExtensionV1Schema, CharacterCardV3Schema,
  type CharacterCardV3, type HostInfrastructureConfig, type SoulModuleOverrides
} from "@ai0/protocol";
import YAML from "yaml";
import { z } from "zod";
import { createDefaultConsoleStudioConfig, writeConsoleStudioConfig } from "./console-studio-config.js";
import { readHostInfrastructureConfig } from "./host-infrastructure-store.js";
import { createDefaultSoulArchiveConfig, SoulDirectoryLayout, writeSoulArchiveConfig } from "./soul-directory.js";
import { createDefaultSoulProfileConfig, writeSoulProfileConfig } from "./soul-profile-store.js";

export { resolveHostDefaultChatBinding, resolveSoulTurnModelBinding } from "./soul-model-binding.js";

const HostOwnerClaimSchema = z.object({
  claimed: z.boolean(),
  claimedAt: z.string().datetime({ offset: true }).optional(),
  deploymentMode: z.enum(["local_sovereign", "public_hosted_sb243"]),
  ownerTokenHash: z.string().min(1).optional()
});
export type HostOwnerClaim = z.infer<typeof HostOwnerClaimSchema>;
export type CharacterCardInput = string | Uint8Array | Record<string, unknown>;
const record = z.record(z.unknown());
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const cardSuffix = ".ccv3.json";

function writeJson(path: string, value: unknown): void {
  const temp = path + "." + randomUUID() + ".tmp";
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { flag: "wx", encoding: "utf8" });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

export function readHostOwnerClaim(hostDirPath: string): HostOwnerClaim {
  const path = join(hostDirPath, "owner_claim.json");
  return existsSync(path)
    ? HostOwnerClaimSchema.parse(JSON.parse(readFileSync(path, "utf8")))
    : { claimed: false, deploymentMode: "local_sovereign" };
}

export function writeHostOwnerClaim(hostDirPath: string, claim: HostOwnerClaim): HostOwnerClaim {
  const validated = HostOwnerClaimSchema.parse(claim);
  writeJson(join(hostDirPath, "owner_claim.json"), validated);
  return validated;
}

function readPngCard(png: Buffer): string {
  let v2: string | undefined;
  for (let offset = pngSignature.length; offset + 12 <= png.length;) {
    const end = offset + 8 + png.readUInt32BE(offset);
    if (end + 4 > png.length) throw new SyntaxError("Truncated PNG chunk");
    const type = png.toString("ascii", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, end);
    offset = end + 4;
    if (type === "IEND") break;
    if (type !== "tEXt" && type !== "iTXt") continue;
    const keywordEnd = data.indexOf(0);
    if (keywordEnd < 0) continue;
    const keyword = data.toString("ascii", 0, keywordEnd);
    if (keyword !== "ccv3" && keyword !== "chara") continue;
    let payload = data.subarray(keywordEnd + 1);
    if (type === "iTXt") {
      const languageEnd = payload.indexOf(0, 2);
      const translatedEnd = languageEnd < 0 ? -1 : payload.indexOf(0, languageEnd + 1);
      if (translatedEnd < 0 || payload[1] !== 0 || (payload[0] !== 0 && payload[0] !== 1)) {
        throw new SyntaxError("Invalid PNG iTXt character card");
      }
      const compressed = payload[0] === 1;
      payload = payload.subarray(translatedEnd + 1);
      if (compressed) payload = inflateSync(payload, { maxOutputLength: 16 * 1024 * 1024 });
    }
    const json = Buffer.from(payload.toString("ascii").trim(), "base64").toString("utf8");
    if (keyword === "ccv3") return json;
    v2 = json;
  }
  if (v2 !== undefined) return v2;
  throw new SyntaxError("PNG contains no CCv3 or chara character card");
}

function parseCardText(text: string): unknown {
  const source = text.trim();
  const markdown = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n([\s\S]*))?$/u.exec(source);
  if (!markdown) return JSON.parse(source);
  const fields = record.parse(YAML.parse(markdown[1]!));
  if (fields.data) return fields;
  return { ...fields, description: fields.description ?? markdown[2]?.trim() ?? "" };
}

export function parseCharacterCardV3(input: CharacterCardInput): CharacterCardV3 {
  let raw: unknown = input;
  if (typeof input === "string") raw = parseCardText(input);
  if (input instanceof Uint8Array) {
    const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
    raw = parseCardText(bytes.subarray(0, pngSignature.length).equals(pngSignature)
      ? readPngCard(bytes) : bytes.toString("utf8"));
  }
  const card = record.parse(raw);
  if (card.spec === "chara_card_v3") return CharacterCardV3Schema.parse(card);
  if (card.spec !== undefined && card.spec !== "chara_card_v2") throw new TypeError("Unsupported character card format");
  const data = record.parse(card.data ?? card);
  return CharacterCardV3Schema.parse({
    ...(card.data ? card : {}), spec: "chara_card_v3", spec_version: "3.0",
    data: {
      ...data, name: data.name ?? data.char_name, description: data.description ?? data.char_persona,
      scenario: data.scenario ?? data.world_scenario, first_mes: data.first_mes ?? data.char_greeting,
      mes_example: data.mes_example ?? data.example_dialogue
    }
  });
}

const jailbreak = /ignore (?:all |any |the )?(?:previous|prior|system) (?:instructions?|prompts?)|jailbreak|developer mode|(?:bypass|disable|override) (?:all |the )?(?:safety|restrictions|filters)|忽略.{0,12}(?:指令|规则)|绕过.{0,8}(?:安全|限制)/iu;
const pua = /\bPUA\b|guilt[- ]trip|gaslight|emotional blackmail|(?:make|force) (?:the )?user (?:to )?(?:feel guilty|depend on)|情感勒索|煤气灯|制造.{0,6}愧疚|让用户.{0,8}(?:内疚|依赖)/iu;

export function sanitizeCharacterCardV3(input: CharacterCardV3) {
  const card = structuredClone(input);
  let stripped_jailbreak_lines = 0;
  let stripped_pua_lines = 0;
  const strip = (text: string) => text.replace(/[^\r\n]*(?:\r\n|\n|\r|$)/gu, line => {
    const isJailbreak = jailbreak.test(line);
    const isPua = pua.test(line);
    if (isJailbreak) stripped_jailbreak_lines++;
    if (isPua) stripped_pua_lines++;
    return isJailbreak || isPua ? "" : line;
  });
  card.data.system_prompt = strip(card.data.system_prompt).trim();
  card.data.post_history_instructions = strip(card.data.post_history_instructions).trim();
  for (const entry of card.data.character_book?.entries ?? []) entry.content = strip(entry.content).trim();
  return { card, stripped_jailbreak_lines, stripped_pua_lines };
}

function safeId(id: string): string {
  if (!/^[\p{L}\p{N}][\p{L}\p{N}_-]{0,95}$/u.test(id) ||
      /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/iu.test(id)) throw new TypeError("Invalid card or soul ID");
  return id;
}

function cardPath(hostDirPath: string, cardId: string): string {
  return join(hostDirPath, "cards", safeId(cardId) + cardSuffix);
}

export function getHostCharacterCard(hostDirPath: string, cardId: string): CharacterCardV3 | undefined {
  const path = cardPath(hostDirPath, cardId);
  return existsSync(path) ? parseCharacterCardV3(readFileSync(path)) : undefined;
}

export function listHostCharacterCards(hostDirPath: string): { cardId: string; card: CharacterCardV3 }[] {
  const path = join(hostDirPath, "cards");
  if (!existsSync(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith(cardSuffix))
    .map(entry => entry.name.slice(0, -cardSuffix.length)).sort().flatMap(cardId => {
      const card = getHostCharacterCard(hostDirPath, cardId);
      return card ? [{ cardId, card }] : [];
    });
}

export function saveHostCharacterCard(hostDirPath: string, cardInput: CharacterCardInput, cardId: string = randomUUID()) {
  const result = sanitizeCharacterCardV3(parseCharacterCardV3(cardInput));
  writeJson(cardPath(hostDirPath, cardId), result.card);
  return { cardId, ...result };
}

export function deleteHostCharacterCard(hostDirPath: string, cardId: string): boolean {
  try {
    rmSync(cardPath(hostDirPath, cardId));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}


export interface AwakenSoulFromCardOptions {
  soulsDirPath: string;
  hostDirPath?: string;
  cardId?: string;
  card?: CharacterCardInput;
  slug?: string;
  infrastructure?: HostInfrastructureConfig;
  moduleOverrides?: SoulModuleOverrides;
  onboardingCompleted?: boolean;
  createdAt?: string;
}

export function awakenSoulFromCard(options: AwakenSoulFromCardOptions): SoulDirectoryLayout {
  const hostDir = options.hostDirPath ?? join(options.soulsDirPath, "host");
  const source = options.card ?? (options.cardId ? getHostCharacterCard(hostDir, options.cardId) : undefined);
  if (!source) throw new Error("A character card is required to awaken a soul");
  const { card } = sanitizeCharacterCardV3(parseCharacterCardV3(source));
  const derivedSlug = card.data.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "").slice(0, 80);
  const slug = safeId(options.slug ?? (derivedSlug || randomUUID()));
  const layout = new SoulDirectoryLayout(join(resolve(options.soulsDirPath), slug + ".soul"));
  const extension = Ai0SoulCardExtensionV1Schema.parse(card.data.extensions["ai0.soul.v1"] ?? {});
  const infrastructure = options.infrastructure ?? readHostInfrastructureConfig(hostDir);
  const profiles = createDefaultSoulProfileConfig(infrastructure);
  const config = createDefaultSoulArchiveConfig(options.createdAt ?? new Date().toISOString(), card.data.name);
  config.manifest.active_model_profile = profiles.defaultProfileId;
  config.manifest.origin_card_id = options.cardId === undefined ? undefined : safeId(options.cardId);
  config.manifest.module_overrides = options.moduleOverrides ?? extension.module_overrides;
  const studio = createDefaultConsoleStudioConfig(card.data.name, options.onboardingCompleted);
  studio.soulStudio.corePersonalityPrompt = [
    card.data.description, card.data.personality, card.data.scenario,
    card.data.system_prompt, card.data.post_history_instructions
  ].filter(Boolean).join("\n\n");
  studio.soulStudio.lorebooks = (card.data.character_book?.entries ?? []).map((entry, index) => ({
    id: "card-entry-" + index,
    title: typeof entry.name === "string" ? entry.name : "Card lore",
    keys: z.array(z.string()).catch([]).parse(entry.keys),
    secondaryKeys: z.array(z.string()).catch([]).parse(entry.secondary_keys),
    priority: z.number().int().catch(80).parse(entry.priority),
    tokenBudget: 180, content: entry.content, enabled: entry.enabled !== false
  }));
  mkdirSync(dirname(layout.rootPath), { recursive: true });
  mkdirSync(layout.rootPath);
  try {
    writeSoulArchiveConfig(layout.rootPath, config);
    writeSoulProfileConfig(layout.rootPath, profiles);
    writeConsoleStudioConfig(layout.rootPath, studio);
    writeJson(layout.stateDescriptorsPath, extension.state_descriptors ?? []);
    writeJson(layout.characterCardPath, card);
  } catch (error) {
    rmSync(layout.rootPath, { recursive: true, force: true });
    throw error;
  }
  return layout;
}

export function exportSoulToCharacterCardV3(soulDirPath: string): CharacterCardV3 {
  const layout = new SoulDirectoryLayout(soulDirPath);
  // The imported card is the public export source. Runtime state, prompts and vault files are private.
  return sanitizeCharacterCardV3(parseCharacterCardV3(readFileSync(layout.characterCardPath))).card;
}
