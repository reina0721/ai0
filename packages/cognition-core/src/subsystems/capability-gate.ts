import { sortFacetsByPriority, type ExtensionHostView } from "@ai0/extension-core";
import type { AudienceScope, CapabilityRisk, PrincipalTrust, TaintLevel } from "@ai0/protocol";
import { cognitionCapabilityPolicyFacet } from "./facets.js";

export type PolicyDecision =
  | "ALLOW"
  | "ALLOW_REDACTED"
  | "REQUIRE_OWNER_CONFIRM"
  | "DENY";

export interface PolicyEvaluationProvenance {
  readonly decision: PolicyDecision;
  readonly floorDecision: PolicyDecision;
  readonly tightenedByPackageId?: string;
  readonly tightenedGeneration?: number;
  readonly reason?: string;
}

function decisionRank(decision: PolicyDecision): number {
  switch (decision) {
    case "ALLOW":
      return 0;
    case "ALLOW_REDACTED":
      return 1;
    case "REQUIRE_OWNER_CONFIRM":
      return 2;
    case "DENY":
      return 3;
  }
}

/**
 * Universal 4-dimensional capability authorization gate:
 * PrincipalTrust x AudienceScope x CapabilityRisk x TaintLevel -> PolicyDecision.
 *
 * L0 floor invariants (such as untrusted_external blocking any non-read-only capability)
 * are strictly immutable; mounted `cognition.capability_policy@1` extensions can only
 * tighten decisions monotonically (ALLOW -> ALLOW_REDACTED -> REQUIRE_OWNER_CONFIRM -> DENY),
 * never loosen the host floor.
 */
export class CapabilityPolicyGate {
  constructor(private readonly host?: ExtensionHostView) {}

  canAutoInvokeSideEffectTool(triggerTaintLevel: TaintLevel): boolean {
    return triggerTaintLevel !== "untrusted_external";
  }

  private evaluateFloor(
    principalTrust: PrincipalTrust,
    audienceScope: AudienceScope,
    capabilityRisk: CapabilityRisk,
    triggerTaintLevel?: TaintLevel
  ): PolicyDecision {
    if (triggerTaintLevel === "untrusted_external" && capabilityRisk !== "read_only_safe") {
      return "DENY";
    }
    if (principalTrust !== "owner_verified") {
      return capabilityRisk === "read_only_safe" && audienceScope === "public_all" ? "ALLOW" : "DENY";
    }
    if (audienceScope !== "only_owner") {
      return capabilityRisk === "read_only_safe" ? "ALLOW_REDACTED" : "DENY";
    }
    if (capabilityRisk === "high_side_effect_privileged") {
      return "REQUIRE_OWNER_CONFIRM";
    }
    return "ALLOW";
  }

  evaluateWithProvenance(
    principalTrust: PrincipalTrust,
    audienceScope: AudienceScope,
    capabilityRisk: CapabilityRisk,
    triggerTaintLevel?: TaintLevel,
    toolName?: string
  ): PolicyEvaluationProvenance {
    const floorDecision = this.evaluateFloor(principalTrust, audienceScope, capabilityRisk, triggerTaintLevel);
    let current = floorDecision;
    let tightenedByPackageId: string | undefined;
    let tightenedGeneration: number | undefined;
    let reason: string | undefined;

    if (this.host && current !== "DENY") {
      const entries = sortFacetsByPriority(this.host.listFacets(cognitionCapabilityPolicyFacet));
      for (const entry of entries) {
        if (!this.host.allowsAudienceScope(entry.packageId, audienceScope, entry.facetId)) continue;
        const outcome = this.host.invokeFacet(entry, (policy) =>
          policy.evaluate({
            principalTrust,
            audienceScope,
            capabilityRisk,
            ...(triggerTaintLevel ? { triggerTaintLevel } : {}),
            ...(toolName ? { toolName } : {})
          })
        );
        if (!outcome) continue;
        if (decisionRank(outcome.decision) > decisionRank(current)) {
          current = outcome.decision;
          tightenedByPackageId = entry.packageId;
          tightenedGeneration = entry.generation;
          reason = outcome.reason;
          if (current === "DENY") break;
        }
      }
    }

    return {
      decision: current,
      floorDecision,
      ...(tightenedByPackageId ? { tightenedByPackageId } : {}),
      ...(tightenedGeneration !== undefined ? { tightenedGeneration } : {}),
      ...(reason ? { reason } : {})
    };
  }

  evaluate(
    principalTrust: PrincipalTrust,
    audienceScope: AudienceScope,
    capabilityRisk: CapabilityRisk,
    triggerTaintLevel?: TaintLevel,
    toolName?: string
  ): PolicyDecision {
    return this.evaluateWithProvenance(principalTrust, audienceScope, capabilityRisk, triggerTaintLevel, toolName)
      .decision;
  }
}

export { CapabilityPolicyGate as ThreeDimensionalPolicyEngine };
