export type Grounding = "grounded" | "partial" | "unknown" | "unpresented";

export interface GroundingLedger {
  readonly generated: { readonly clauses: readonly string[]; readonly commands: readonly string[] };
  readonly presented: Readonly<Record<number, string>>;
  readonly actuated: readonly string[];
  readonly acknowledged: readonly number[];
  readonly pending: readonly number[];
  readonly uncertain: readonly number[];
  readonly userGrounded: Grounding;
  readonly activeShell: string;
}

export function deriveGrounding(trace: Omit<GroundingLedger, "userGrounded">) {
  const { clauses, commands } = trace.generated;
  const validIndex = (index: number) => Number.isInteger(index) && index >= 0 && index < clauses.length;
  const presented = Object.keys(trace.presented).map(Number);
  const { pending, uncertain, acknowledged } = trace;
  const delivery = [...presented, ...pending, ...uncertain];
  if (delivery.some(index => !validIndex(index)) || new Set(delivery).size !== delivery.length
    || acknowledged.some(index => !presented.includes(index))
    || trace.actuated.some(id => !commands.includes(id))) throw new Error("Invalid receipt ledger");
  const prefix = clauses.findIndex((_, index) => !presented.includes(index));
  const count = prefix === -1 ? clauses.length : prefix;
  if (count !== presented.length) throw new Error("Presentation must be a contiguous prefix");
  const userGrounded: Grounding = uncertain.length ? "unknown"
    : clauses.length > 0 && clauses.every((_, index) => acknowledged.includes(index)) ? "grounded"
      : count > 0 ? "partial" : "unpresented";
  return {
    userGrounded,
    presentedPrefix: clauses.slice(0, count).join(""),
    unsaidRemainder: uncertain.length || pending.length ? null : clauses.slice(count).join("")
  };
}

export function verifyGrounding(trace: GroundingLedger) {
  const result = deriveGrounding(trace);
  if (result.userGrounded !== trace.userGrounded) throw new Error("Grounding lacks evidence");
  return result;
}

export type DeliveryEvent =
  | { kind: "dispatch" | "ground"; index: number }
  | { kind: "present"; index: number; shell: string }
  | { kind: "actuate" | "switch"; id: string }
  | { kind: "drop" | "interrupt" };

export function advanceDelivery(trace: GroundingLedger, event: DeliveryEvent): GroundingLedger {
  verifyGrounding(trace);
  let next = trace;
  switch (event.kind) {
    case "dispatch":
      next = { ...trace, pending: [...trace.pending, event.index] };
      break;
    case "present":
      if (event.shell !== trace.activeShell || !trace.pending.includes(event.index)) throw new Error("Unexpected receipt");
      next = { ...trace, presented: { ...trace.presented, [event.index]: event.shell },
        pending: trace.pending.filter(index => index !== event.index) };
      break;
    case "ground":
      next = { ...trace, acknowledged: [...trace.acknowledged, event.index] };
      break;
    case "actuate":
      next = { ...trace, actuated: [...new Set([...trace.actuated, event.id])] };
      break;
    case "interrupt":
      next = { ...trace, pending: [] };
      break;
    case "drop":
    case "switch":
      next = { ...trace, pending: [], uncertain: [...trace.uncertain, ...trace.pending],
        activeShell: event.kind === "switch" ? event.id : trace.activeShell };
      break;
  }
  return { ...next, userGrounded: deriveGrounding(next).userGrounded };
}

export interface HostInfrastructure { ownerId?: string; verifiedProviders: readonly string[] }
export interface CharacterCard { id: string; assetAnchors: readonly string[] }
export interface SoulInstance { id: string; originCardId: string; episodes: readonly string[] }
export interface MountedShell {
  id: string;
  cardId: string;
  soulId: string;
  fixedAnchors: readonly string[];
  supportsCardAsset: boolean;
  sensors: Readonly<Record<string, string>>;
  actuators: readonly string[];
}

export function bindShell(shell: MountedShell, card: CharacterCard, soul: SoulInstance) {
  if (shell.cardId !== card.id || shell.soulId !== soul.id) throw new Error("Inconsistent mounting");
  return {
    soul,
    anchors: [...new Set([...shell.fixedAnchors, ...(shell.supportsCardAsset ? card.assetAnchors : [])])],
    sensors: shell.sensors,
    actuators: shell.actuators
  };
}

export type LifecycleLevel = "L0" | "L1" | "L2" | "L3" | "L4" | "L5";
export type DeploymentStatus =
  | "UNCLAIMED"
  | "CLAIMED_NO_PROVIDER"
  | "PROVIDER_READY_NO_SOUL"
  | "SOUL_AWAKENED_NO_SHELL"
  | "LIVE_READY"
  | "HIBERNATING";

export const LIFECYCLE_STATUS: Readonly<Record<LifecycleLevel, DeploymentStatus>> = Object.freeze({
  L0: "UNCLAIMED",
  L1: "CLAIMED_NO_PROVIDER",
  L2: "PROVIDER_READY_NO_SOUL",
  L3: "SOUL_AWAKENED_NO_SHELL",
  L4: "LIVE_READY",
  L5: "HIBERNATING"
});

export interface Deployment {
  host: HostInfrastructure;
  cards: readonly CharacterCard[];
  souls: readonly SoulInstance[];
  shells: readonly MountedShell[];
  suspendedAtMs?: number;
  hibernation: readonly { startMs: number; endMs: number }[];
}

export function freshDeployment(): Deployment {
  return { host: { verifiedProviders: [] }, cards: [], souls: [], shells: [], hibernation: [] };
}

export function verifyDeployment(state: Deployment): LifecycleLevel {
  const { host, cards, souls, shells, suspendedAtMs } = state;
  for (const collection of [cards, souls, shells]) {
    if (new Set(collection.map(item => item.id)).size !== collection.length) throw new Error("Duplicate identity");
  }
  for (const soul of souls) {
    if (!cards.some(card => card.id === soul.originCardId)) throw new Error("Missing origin card");
  }
  for (const shell of shells) {
    const card = cards.find(entry => entry.id === shell.cardId);
    const soul = souls.find(entry => entry.id === shell.soulId);
    if (!card || !soul) throw new Error("Invalid shell binding");
    bindShell(shell, card, soul);
  }
  const ready = host.verifiedProviders.length > 0;
  if ((!host.ownerId && (ready || cards.length || souls.length || shells.length))
    || (!ready && (shells.length || suspendedAtMs !== undefined))
    || (suspendedAtMs !== undefined && !souls.length)) throw new Error("Illegal deployment state");
  if (!host.ownerId) return "L0";
  if (!ready) return "L1";
  if (suspendedAtMs !== undefined) return "L5";
  if (!souls.length) return "L2";
  return shells.length ? "L4" : "L3";
}

export type DeploymentEvent =
  | { kind: "claim" | "verify_provider" | "awaken" | "unmount"; id: string }
  | { kind: "import_card"; card: CharacterCard }
  | { kind: "mount"; shell: MountedShell }
  | { kind: "hibernate" | "resume" | "revoke_providers"; nowMs: number };

export function deploymentStatus(state: Deployment): DeploymentStatus {
  return LIFECYCLE_STATUS[verifyDeployment(state)];
}

export function advanceDeployment(state: Deployment, event: DeploymentEvent): Deployment {
  const level = verifyDeployment(state);
  if (level === "L5" && event.kind !== "resume" && event.kind !== "revoke_providers") {
    throw new Error("Host suspended");
  }
  let next: Deployment = state;
  switch (event.kind) {
    case "claim":
      if (level !== "L0" || !event.id) throw new Error("Cannot claim host");
      next = { ...state, host: { ...state.host, ownerId: event.id } };
      break;
    case "verify_provider":
      if (level === "L0" || !event.id) throw new Error("Provider requires owner and verified identity");
      next = { ...state, host: { ...state.host, verifiedProviders: [...new Set([...state.host.verifiedProviders, event.id])] } };
      break;
    case "import_card":
      next = { ...state, cards: [...state.cards, structuredClone(event.card)] };
      break;
    case "awaken":
      if (level !== "L2" || !state.cards.some(card => card.id === event.id)) throw new Error("Cannot awaken");
      next = { ...state, souls: [{ id: event.id, originCardId: event.id, episodes: [] }] };
      break;
    case "mount":
      if (level !== "L3" && level !== "L4") throw new Error("Cannot mount");
      next = { ...state, shells: [...state.shells, structuredClone(event.shell)] };
      break;
    case "unmount":
      next = { ...state, shells: state.shells.filter(shell => shell.id !== event.id) };
      break;
    case "hibernate":
      if ((level !== "L3" && level !== "L4") || !Number.isFinite(event.nowMs)
        || event.nowMs < (state.hibernation.at(-1)?.endMs ?? -Infinity)) throw new Error("Cannot hibernate");
      next = { ...state, suspendedAtMs: event.nowMs };
      break;
    case "resume":
    case "revoke_providers": {
      const startMs = state.suspendedAtMs;
      if (event.kind === "resume" && startMs === undefined) throw new Error("Host is awake");
      if (!Number.isFinite(event.nowMs) || (startMs !== undefined && event.nowMs < startMs)) throw new Error("Invalid suspension window");
      next = { ...state, suspendedAtMs: undefined,
        hibernation: startMs === undefined ? state.hibernation : [...state.hibernation, { startMs, endMs: event.nowMs }] };
      if (event.kind === "revoke_providers") {
        next = { ...next, shells: [], host: { ...next.host, verifiedProviders: [] } };
      }
      break;
    }
  }
  verifyDeployment(next);
  return next;
}
