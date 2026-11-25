export interface ExpressionClockPort { nowMs(): number }

export type OpportunityLifecycle = "candidate" | "eligible" | "selected" |
  "consumed" | "expired" | "withdrawn";
export interface InteractionOpportunity {
  id: string; lifecycle: OpportunityLifecycle; expires_virtual_ts: number;
  topic_key?: string; payload?: unknown;
}
const terminal = (state: OpportunityLifecycle): boolean =>
  state === "consumed" || state === "expired" || state === "withdrawn";
export class InteractionOpportunityPool {
  private readonly items = new Map<string, InteractionOpportunity>();
  constructor(private readonly clock: ExpressionClockPort, readonly capacity = 64) {}
  add(opportunity: InteractionOpportunity): boolean {
    this.expireStale();
    if (!this.items.has(opportunity.id) && this.active().length >= this.capacity) return false;
    this.items.set(opportunity.id, { ...opportunity }); return true;
  }
  transition(id: string, lifecycle: OpportunityLifecycle): Readonly<InteractionOpportunity> | undefined {
    this.expireStale(); const item = this.items.get(id);
    if (!item || terminal(item.lifecycle)) return undefined;
    item.lifecycle = lifecycle; return item;
  }
  select(id: string): Readonly<InteractionOpportunity> | undefined {
    return this.transition(id, "selected");
  }
  consume(id: string): Readonly<InteractionOpportunity> | undefined {
    return this.transition(id, "consumed");
  }
  list(): ReadonlyArray<Readonly<InteractionOpportunity>> {
    this.expireStale(); return [...this.items.values()];
  }
  withdrawOnTopicShift(activeTopic?: string): number {
    return this.withdraw((item) => item.topic_key !== activeTopic);
  }
  withdrawForL0Crisis(): number { return this.withdraw(() => true); }
  expireStale(): number {
    const now = this.clock.nowMs(); let count = 0;
    for (const item of this.items.values())
      if (!terminal(item.lifecycle) && now >= item.expires_virtual_ts) {
        item.lifecycle = "expired"; count += 1;
      }
    return count;
  }
  private active(): InteractionOpportunity[] {
    return [...this.items.values()].filter((item) => !terminal(item.lifecycle));
  }
  private withdraw(predicate: (item: InteractionOpportunity) => boolean): number {
    this.expireStale(); let count = 0;
    for (const item of this.active()) if (predicate(item)) {
      item.lifecycle = "withdrawn"; count += 1;
    }
    return count;
  }
}
