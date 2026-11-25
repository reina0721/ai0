import { z } from "zod";

export const StateTopologySchema = z.enum(["bipolar_tanh", "unipolar_sigmoid"]);
export const ContinuousStateDescriptorSchema = z.object({
  id: z.string().min(1), topology: StateTopologySchema, baseline: z.number().finite(),
  halfLifeMs: z.number().finite().positive().optional(), decayRatePerSec: z.number().finite().positive().optional(),
  wakeupThresholds: z.array(z.number().finite()).default([])
}).superRefine((entry, ctx) => {
  const min = entry.topology === "bipolar_tanh" ? -1 : 0;
  if ([entry.baseline, ...entry.wakeupThresholds].some(value => value <= min || value >= 1))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "State values must be inside the topology's open interval" });
  if ((entry.halfLifeMs === undefined) === (entry.decayRatePerSec === undefined))
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Specify exactly one decay parameter" });
});
export const StateAttributionEntrySchema = z.object({
  state_id: z.string(), event_id: z.string(), audience_scope: z.string(), amount: z.number().finite()
}).passthrough();
export const ContinuousStateCheckpointMapSchema = z.record(z.string(), z.number().finite());
export type StateTopology = z.infer<typeof StateTopologySchema>;
export type ContinuousStateDescriptor = z.infer<typeof ContinuousStateDescriptorSchema>;
export type StateAttributionEntry = z.infer<typeof StateAttributionEntrySchema>;
export type ContinuousStateCheckpointMap = z.infer<typeof ContinuousStateCheckpointMapSchema>;
