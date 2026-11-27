import { createHmac, timingSafeEqual } from "node:crypto";
import { VirtualClock } from "@ai0/cognition-core/kernel";
import { AudienceScopeSchema, type AudienceScope } from "@ai0/protocol";

export interface ScopedCapabilityClaims {
  channel_id: string;
  max_audience_privacy_ceiling: AudienceScope;
  allowed_modalities: string[];
  expires_at_ts_ms: number;
  principal_id?: string;
  soul_id?: string;
  target?: "live" | "sandbox";
  plugin_id?: string;
  generation?: string;
}

export class ScopedCapabilityTokenError extends Error {
  constructor(readonly code: "MALFORMED" | "INVALID_SIGNATURE" | "EXPIRED" | "INVALID_CLAIMS") {
    super(`SCOPED_CAPABILITY_TOKEN_${code}`);
    this.name = "ScopedCapabilityTokenError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateClaims(value: unknown): ScopedCapabilityClaims {
  if (
    !isRecord(value) ||
    typeof value.channel_id !== "string" ||
    value.channel_id.length === 0 ||
    !AudienceScopeSchema.safeParse(value.max_audience_privacy_ceiling).success ||
    !Array.isArray(value.allowed_modalities) ||
    value.allowed_modalities.some((item) => typeof item !== "string") ||
    typeof value.expires_at_ts_ms !== "number" ||
    !Number.isFinite(value.expires_at_ts_ms)
  ) {
    throw new ScopedCapabilityTokenError("INVALID_CLAIMS");
  }
  return {
    channel_id: value.channel_id,
    max_audience_privacy_ceiling: value.max_audience_privacy_ceiling as AudienceScope,
    allowed_modalities: [...value.allowed_modalities] as string[],
    ...(typeof value.soul_id === "string" ? { soul_id: value.soul_id } : {}),
    ...(typeof value.principal_id === "string" ? { principal_id: value.principal_id } : {}),
    ...(value.target === "sandbox" || value.target === "live" ? { target: value.target } : {}),
    ...(typeof value.plugin_id === "string" ? { plugin_id: value.plugin_id } : {}),
    ...(typeof value.generation === "string" ? { generation: value.generation } : {}),
    expires_at_ts_ms: value.expires_at_ts_ms
  };
}

export function issueScopedCapabilityToken(claims: ScopedCapabilityClaims, secretKey: string): string {
  if (!secretKey) throw new TypeError("secretKey must not be empty.");
  const encoded = Buffer.from(JSON.stringify(validateClaims(claims))).toString("base64url");
  const signature = createHmac("sha256", secretKey).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

const defaultLiveClock = new VirtualClock({ targetInstance: "live" });

export function verifyScopedCapabilityToken(
  token: string,
  secretKey: string,
  nowMs: number = defaultLiveClock.nowMs()
): ScopedCapabilityClaims {
  if (!secretKey) throw new TypeError("secretKey must not be empty.");
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new ScopedCapabilityTokenError("MALFORMED");
  const expected = createHmac("sha256", secretKey).update(parts[0]).digest();
  let supplied: Buffer;
  try {
    supplied = Buffer.from(parts[1], "base64url");
  } catch {
    throw new ScopedCapabilityTokenError("MALFORMED");
  }
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    throw new ScopedCapabilityTokenError("INVALID_SIGNATURE");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  } catch {
    throw new ScopedCapabilityTokenError("MALFORMED");
  }
  const claims = validateClaims(decoded);
  if (claims.expires_at_ts_ms <= nowMs) throw new ScopedCapabilityTokenError("EXPIRED");
  return claims;
}
