export interface BrainRegionModelConfig {
  primary_model_id: string;
  fallback_model_id: string;
  lora_adapter_id?: string;
}

export type ComputeBudgetStatus = "normal" | "throttled_fallback" | "budget_exhausted";
export type ModelSelectionPolicy<Role extends string, Context> =
  (role: Role, candidates: Readonly<BrainRegionModelConfig>, context?: Context) => string;

/** The host names the roles and may select a model using its own context. */
export class BrainRegionRouter<Role extends string = string, Context = unknown> {
  private regions: Readonly<Record<Role, BrainRegionModelConfig>>;

  constructor(config: Record<Role, BrainRegionModelConfig>, private readonly select?: ModelSelectionPolicy<Role, Context>) {
    this.regions = structuredClone(config);
  }

  updateRegions(config: Record<Role, BrainRegionModelConfig>) { this.regions = structuredClone(config); }

  getRegionConfig(role: Role): BrainRegionModelConfig {
    if (!Object.hasOwn(this.regions, role)) throw new Error("Unknown model role: " + role);
    return { ...this.regions[role] };
  }

  routeForRegion(role: Role, context?: Context, budget: ComputeBudgetStatus = "normal") {
    const config = this.getRegionConfig(role);
    return { ...config, budget, selected_model_id: budget === "budget_exhausted" ? undefined :
      budget === "throttled_fallback" ? config.fallback_model_id : this.select?.(role, config, context) ?? config.primary_model_id };
  }
}
