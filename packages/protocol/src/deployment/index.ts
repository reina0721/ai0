import { z } from "zod";

export const DeploymentStageSchema = z.enum([
  "L0_UNCLAIMED", "L1_CLAIMED_NO_PROVIDER", "L2_PROVIDER_READY_NO_SOUL",
  "L3_SOUL_AWAKENED_CONFIG_NEEDED", "L4_SOUL_AWAKENED_NO_CHANNEL", "L5_LIVE_READY"
]);
export const DeploymentReadinessReportSchema = z.object({
  ready: z.boolean(), stage: DeploymentStageSchema, missing_prerequisites: z.array(z.string()),
  checks: z.record(z.string(), z.unknown())
});
export type DeploymentStage = z.infer<typeof DeploymentStageSchema>;
export type DeploymentReadinessReport = z.infer<typeof DeploymentReadinessReportSchema>;
