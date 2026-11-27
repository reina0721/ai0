import type { AudienceScope } from "@ai0/protocol";

export function audienceRank(scope: AudienceScope): number {
  return scope === "only_owner" ? 2 : scope === "public_all" ? 0 : 1;
}

export function enforceAudienceScope(claimed: AudienceScope, ceiling: AudienceScope): AudienceScope {
  if (audienceRank(claimed) > audienceRank(ceiling)) return ceiling;
  if (claimed.startsWith("group:") && ceiling.startsWith("group:") && claimed !== ceiling) return ceiling;
  return claimed;
}
