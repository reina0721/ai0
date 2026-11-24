import type {
  AgentConfigProfile,
  AudienceScope,
  ModelSlotBinding,
  ResolvedSessionRoute,
  SoulProfileAndCapabilitiesConfig,
  UmoRoutingRule,
  VenueType
} from "@ai0/protocol";

import type { BrainRegion, BrainRegionModelConfig } from "./brain-region-router.js";

export interface UmoResolutionInput {
  readonly shellId: string;
  readonly venueType: VenueType;
  readonly sessionKey: string;
  /** Maximum privacy audience permitted by the transport/token attestation. */
  readonly maxAudienceCeiling: AudienceScope;
  readonly config: SoulProfileAndCapabilitiesConfig;
}

export interface UmoResolutionOutput {
  readonly route: ResolvedSessionRoute;
  readonly profile: AgentConfigProfile;
  readonly matchedRule?: UmoRoutingRule;
  readonly regionBindings: Readonly<Record<BrainRegion, { primary: ModelSlotBinding; fallback: ModelSlotBinding }>>;
}

function audienceRank(scope: AudienceScope): number {
  if (scope === "only_owner") return 2;
  if (scope === "public_all") return 0;
  return 1; // fixed_group / group:*
}

function clampAudienceScope(
  desired: AudienceScope,
  ceiling: AudienceScope
): { scope: AudienceScope; downgraded: boolean } {
  const desiredRank = audienceRank(desired);
  const ceilingRank = audienceRank(ceiling);
  if (desiredRank > ceilingRank) {
    return { scope: ceiling, downgraded: true };
  }
  // Preserve authenticated concrete group IDs (e.g. "group:alpha") when a rule specifies generic group isolation.
  if (desiredRank === 1 && ceilingRank === 1) {
    return { scope: ceiling, downgraded: false };
  }
  return { scope: desired, downgraded: false };
}

export function formatUmo(shellId: string, venueType: string, sessionKey: string): string {
  const norm = (value: string, fallback: string) => value.trim() || fallback;
  return `${norm(shellId, "shell.default")}:${norm(venueType, "private_1on1")}:${norm(sessionKey, "default")}`;
}

function matchSegment(pattern: string, actual: string): boolean {
  if (pattern === "*" || pattern === "") return true;
  if (!pattern.includes("*")) return pattern === actual;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/gu, "\\$&").replaceAll("*", ".*");
  return new RegExp(`^${escaped}$`, "u").test(actual);
}

/**
 * Matches a UMO pattern (`platform:venue:session`, supporting `*` wildcards and AstrBot-style `::` wildcard shorthand)
 * against a concrete UMO string.
 */
export function matchesUmoPattern(pattern: string, umo: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  if (trimmed === "*" || trimmed === "*:*:*" || trimmed === "::") return true;
  if (trimmed === umo) return true;

  const pParts = trimmed.split(":");
  const uParts = umo.split(":");
  if (pParts.length === 3 && uParts.length >= 3) {
    const actualSession = uParts.slice(2).join(":");
    return (
      matchSegment(pParts[0]!, uParts[0]!) &&
      matchSegment(pParts[1]!, uParts[1]!) &&
      matchSegment(pParts[2]!, actualSession)
    );
  }
  return matchSegment(trimmed, umo);
}

function patternSpecificity(pattern: string): number {
  return pattern
    .split(":")
    .filter((segment) => segment.length > 0 && segment !== "*")
    .reduce((score, segment) => score + (segment.includes("*") ? 1 : 3), 0);
}

export function buildRegionBindingsFromProfile(
  profile: AgentConfigProfile
): Readonly<Record<BrainRegion, { primary: ModelSlotBinding; fallback: ModelSlotBinding }>> {
  const primary = profile.primaryChat;
  const fallback = profile.brainRegionOverrides.fallbackChat ?? primary;
  const l0 = profile.brainRegionOverrides.L0_crisis_classifier ?? {
    providerId: "prov_local_guard_lora",
    modelId: "safety-l0-guard-v1"
  };

  return Object.freeze({
    W1_fast_dialogue: { primary, fallback },
    W2_agency_planner: {
      primary: profile.brainRegionOverrides.W2_agency_planner ?? primary,
      fallback
    },
    W3_sleep_curiosity: {
      primary: profile.brainRegionOverrides.W3_sleep_curiosity ?? fallback,
      fallback
    },
    W4_multimodal: {
      primary: profile.brainRegionOverrides.W4_multimodal ?? primary,
      fallback
    },
    L0_crisis_classifier: { primary: l0, fallback: l0 }
  });
}

export function toBrainRouterConfig(
  bindings: Readonly<Record<BrainRegion, { primary: ModelSlotBinding; fallback: ModelSlotBinding }>>
): Record<BrainRegion, BrainRegionModelConfig> {
  return {
    W1_fast_dialogue: {
      primary_model_id: bindings.W1_fast_dialogue.primary.modelId,
      fallback_model_id: bindings.W1_fast_dialogue.fallback.modelId
    },
    W2_agency_planner: {
      primary_model_id: bindings.W2_agency_planner.primary.modelId,
      fallback_model_id: bindings.W2_agency_planner.fallback.modelId
    },
    W3_sleep_curiosity: {
      primary_model_id: bindings.W3_sleep_curiosity.primary.modelId,
      fallback_model_id: bindings.W3_sleep_curiosity.fallback.modelId
    },
    W4_multimodal: {
      primary_model_id: bindings.W4_multimodal.primary.modelId,
      fallback_model_id: bindings.W4_multimodal.fallback.modelId
    },
    L0_crisis_classifier: {
      primary_model_id: bindings.L0_crisis_classifier.primary.modelId,
      fallback_model_id: bindings.L0_crisis_classifier.fallback.modelId
    }
  };
}

/**
 * Deterministic AstrBot-inspired UMO -> Profile -> BrainRegion binding resolver
 * with fail-closed audience scope ceiling enforcement.
 */
export function resolveSessionProfile(input: UmoResolutionInput): UmoResolutionOutput {
  const umo = formatUmo(input.shellId, input.venueType, input.sessionKey);
  const candidates = input.config.routingRules
    .filter((rule) => rule.enabled && matchesUmoPattern(rule.umoPattern, umo))
    .sort((left, right) => {
      if (left.priority !== right.priority) return left.priority - right.priority;
      return patternSpecificity(right.umoPattern) - patternSpecificity(left.umoPattern);
    });

  const matchedRule = candidates[0];
  const fallbackProfile =
    input.config.profiles.find((p) => p.id === input.config.defaultProfileId) ??
    input.config.profiles[0]!;
  const profile =
    (matchedRule
      ? input.config.profiles.find((p) => p.id === matchedRule.profileId)
      : undefined) ?? fallbackProfile;

  const desiredAudience: AudienceScope = matchedRule?.audienceScope ?? input.maxAudienceCeiling;
  const clamped = clampAudienceScope(desiredAudience, input.maxAudienceCeiling);
  const forcedPublicMask = clamped.scope !== "only_owner";
  const socialMaskActive = forcedPublicMask || profile.socialMaskEnabled;
  const socialMaskDampingPct = forcedPublicMask
    ? Math.max(70, profile.socialMaskDampingPct)
    : profile.socialMaskEnabled
      ? profile.socialMaskDampingPct
      : 0;

  const regionBindings = buildRegionBindingsFromProfile(profile);

  return {
    profile,
    matchedRule,
    regionBindings,
    route: {
      umo,
      matchedRuleId: matchedRule?.id ?? null,
      matchedRuleLabel: matchedRule?.label ?? "默认兜底配置 (*:*:*)",
      profileId: profile.id,
      profileName: profile.name,
      effectiveAudienceScope: clamped.scope,
      audienceDowngradedByCeiling: clamped.downgraded,
      primaryChat: regionBindings.W1_fast_dialogue.primary,
      fallbackChat: regionBindings.W1_fast_dialogue.fallback,
      socialMaskActive,
      socialMaskDampingPct,
      maxContextTokens: profile.maxContextTokens,
      debounceMs: profile.conversationGate.debounceMs
    }
  };
}
