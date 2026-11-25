import { z } from "zod";


export const AuthorityRoleSchema = z.enum(["system_invariant", "developer_frame", "untrusted_observation"]);
export const AgentPromptInputSchema = z.object({ role: AuthorityRoleSchema, content: z.string() });
export const AgentToolCallSchema = z.object({ kind: z.literal("tool"), id: z.string().min(1), name: z.string().min(1), input: z.unknown() });
export const AgentToolResultSchema = z.union([
  z.object({ status: z.enum(["verified", "unverified"]), value: z.unknown() }),
  z.object({ status: z.literal("failed"), error: z.string() })
]);
export const AgentRoundSchema = z.object({ text: z.string(), receipts: z.array(z.object({ call: AgentToolCallSchema, result: AgentToolResultSchema })) });
export const AgentTurnReportSchema = z.object({
  rounds: z.array(AgentRoundSchema), stopReason: z.enum(["finished", "step_limit"]),
  goalVerification: z.enum(["verified", "unverified", "not_applicable"])
});
export type AuthorityRole = z.infer<typeof AuthorityRoleSchema>;
export type AgentPromptInput = z.infer<typeof AgentPromptInputSchema>;
export type AgentToolCall = z.infer<typeof AgentToolCallSchema>;
export type AgentToolResult = z.infer<typeof AgentToolResultSchema>;
export type AgentRound = z.infer<typeof AgentRoundSchema>;
export type AgentTurnReport = z.infer<typeof AgentTurnReportSchema>;
