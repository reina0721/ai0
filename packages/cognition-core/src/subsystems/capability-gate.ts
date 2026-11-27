import type { AudienceScope, CapabilityRisk, PrincipalTrust, TaintLevel } from "@ai0/protocol";

export type PolicyDecision =
  | "ALLOW"
  | "ALLOW_REDACTED"
  | "REQUIRE_OWNER_CONFIRM"
  | "DENY";

/**
 * Universal 4-dimensional capability authorization gate:
 * PrincipalTrust x AudienceScope x CapabilityRisk x TaintLevel -> PolicyDecision.
 * Untrusted external taint strictly blocks any capability beyond read_only_safe.
 */
export class CapabilityPolicyGate {
  canAutoInvokeSideEffectTool(triggerTaintLevel: TaintLevel): boolean {
    return triggerTaintLevel !== "untrusted_external";
  }

  evaluate(
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
}

export { CapabilityPolicyGate as ThreeDimensionalPolicyEngine };
