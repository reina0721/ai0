import { z } from "zod";
const GroupAudienceScopeSchema = z
  .string()
  .regex(/^(only_owner|public_all|group:[a-zA-Z0-9_.:-]+)$/)
  .refine(
    (scope): scope is `group:${string}` => scope.startsWith("group:"),
    "Group audience scopes must start with group:"
  );

export const AudienceScopeSchema = z.union([
  z.literal("only_owner"),
  z.literal("public_all"),
  GroupAudienceScopeSchema
]);
export type AudienceScope = z.infer<typeof AudienceScopeSchema>;
