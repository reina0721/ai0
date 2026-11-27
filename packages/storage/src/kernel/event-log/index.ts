import type {
  AudienceScope,
  PrincipalTrust,
  SensorModality,
  VenueType
} from "@ai0/protocol";

export const EVENT_CATEGORIES = [
  "perception_committed",
  "expression_delivered",
  "action_episode_completed",
  "sleep_consolidation_run",
  "curiosity_exploration_run",
  "config_or_ablation_changed",
  "memory_redacted_tombstone",
  "soul_rollback_bridge"
] as const;

export type EventCategory = (typeof EVENT_CATEGORIES)[number];
export type StorageVenueType = VenueType | "internal_background";
export type StorageModality = SensorModality | "system";

export interface EventLogEntry {
  event_id: string;
  wall_ts_ms: number;
  virtual_ts_ms: number;
  source_channel_id: string;
  principal_id: string;
  principal_trust: PrincipalTrust;
  venue_type: StorageVenueType;
  audience_scope: AudienceScope;
  event_category: EventCategory;
  modality: StorageModality;
  summary_text: string;
  payload_json: string;
  state_rev_after: number;
  active_modules_mask: number;
  redacted_at_ts_ms?: number | null;
  redacted_by_event?: string | null;
}

export interface StoredEventLogEntry extends EventLogEntry {
  event_seq: number;
  redacted_at_ts_ms: number | null;
  redacted_by_event: string | null;
}

export interface EventListQuery {
  after_event_seq?: number;
  audience_scope?: AudienceScope;
  event_category?: EventCategory;
  limit?: number;
}
