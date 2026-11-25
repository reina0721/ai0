import type { DatabaseSync } from "node:sqlite";

/** Connection invariants. These are reapplied whenever a database is opened. */
export const SQLITE_PRAGMA_DDL = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA secure_delete = ON;
`;

/**
 * The authoritative `.soul` SQLite schema from architecture section 2.
 *
 * `IF NOT EXISTS` is the only addition to the documented statements: it makes
 * archive initialization safe to repeat without changing any column, index,
 * foreign-key, or CHECK constraint.
 */
export const SQLITE_SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS shell_action_intents (
    intent_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    actuator_id TEXT NOT NULL,
    requires_consent INTEGER NOT NULL,
    arguments_json TEXT,
    evidence_id TEXT
);
CREATE INDEX IF NOT EXISTS shell_actions_by_session ON shell_action_intents(session_id);
CREATE TABLE IF NOT EXISTS shell_principal_bindings (
    shell_id TEXT NOT NULL,
    external_id TEXT NOT NULL,
    principal_id TEXT NOT NULL,
    PRIMARY KEY(shell_id, external_id)
);

CREATE TABLE IF NOT EXISTS event_log (
    event_seq           INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id            TEXT NOT NULL UNIQUE,
    wall_ts_ms          INTEGER NOT NULL,
    virtual_ts_ms       INTEGER NOT NULL,
    source_shell_id     TEXT NOT NULL,
    principal_id        TEXT NOT NULL,
    principal_trust     TEXT NOT NULL CHECK (principal_trust IN ('owner_verified', 'bound_friend', 'stranger', 'environment_sensor', 'tool_output')),
    venue_type          TEXT NOT NULL CHECK (venue_type IN ('private_1on1', 'group_chat', 'public_livestream', 'local_ambient', 'internal_background')),
    audience_scope      TEXT NOT NULL,
    event_category      TEXT NOT NULL CHECK (event_category IN (
                            'perception_committed',
                            'expression_delivered',
                            'action_episode_completed',
                            'sleep_consolidation_run',
                            'curiosity_exploration_run',
                            'config_or_ablation_changed',
                            'memory_redacted_tombstone',
                            'soul_rollback_bridge'
                        )),
    modality            TEXT NOT NULL,
    summary_text        TEXT NOT NULL,
    payload_json        TEXT NOT NULL,
    state_rev_after     INTEGER NOT NULL,
    active_modules_mask INTEGER NOT NULL,
    redacted_at_ts_ms   INTEGER DEFAULT NULL,
    redacted_by_event   TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_log_virtual_ts ON event_log(virtual_ts_ms);
CREATE INDEX IF NOT EXISTS idx_event_log_audience ON event_log(audience_scope, virtual_ts_ms);
CREATE INDEX IF NOT EXISTS idx_event_log_category ON event_log(event_category, virtual_ts_ms);

CREATE TABLE IF NOT EXISTS shell_run_process (
    event_id TEXT PRIMARY KEY REFERENCES event_log(event_id) ON DELETE CASCADE,
    snapshot_json TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS redact_shell_run_process AFTER UPDATE OF redacted_at_ts_ms ON event_log
WHEN NEW.redacted_at_ts_ms IS NOT NULL BEGIN
    DELETE FROM shell_run_process WHERE event_id = NEW.event_id;
END;

CREATE TABLE IF NOT EXISTS memories (
    memory_id               TEXT PRIMARY KEY,
    memory_tier             TEXT NOT NULL CHECK (memory_tier IN (
                                'episodic_experience',
                                'semantic_fact',
                                'relational_tacit',
                                'kb_crystallized_gist',
                                'topic_taboo_seal'
                            )),
    epistemic_type          TEXT NOT NULL CHECK (epistemic_type IN (
                                'observed_firsthand',
                                'reported_hearsay',
                                'inferred_hypothesis',
                                'imagined_narrative'
                            )),
    attributed_principal    TEXT NOT NULL,
    visibility_scope        TEXT NOT NULL,
    taint_level             TEXT NOT NULL CHECK (taint_level IN ('trusted_owner', 'semi_trusted_friend', 'untrusted_external')),
    content_text            TEXT NOT NULL,
    emotional_valence       REAL NOT NULL DEFAULT 0.0,
    emotional_arousal       REAL NOT NULL DEFAULT 0.0,
    base_importance         REAL NOT NULL DEFAULT 0.5,
    stability_half_life     REAL NOT NULL DEFAULT 168.0,
    recall_count            INTEGER NOT NULL DEFAULT 0,
    created_virtual_ts      INTEGER NOT NULL,
    last_recalled_ts        INTEGER NOT NULL,
    valid_from_virtual_ts   INTEGER NOT NULL,
    valid_until_virtual_ts  INTEGER DEFAULT NULL,
    expires_virtual_ts      INTEGER DEFAULT NULL,
    grounding_status        TEXT NOT NULL DEFAULT 'not_applicable' CHECK (grounding_status IN (
                                'not_applicable',
                                'proposed_presented',
                                'mutually_grounded',
                                'disputed_retired'
                            )),
    invalidated_at_ts       INTEGER DEFAULT NULL,
    created_at_rev          INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_lineage_edges (
    child_memory_id     TEXT NOT NULL REFERENCES memories(memory_id) ON DELETE CASCADE,
    parent_type         TEXT NOT NULL CHECK (parent_type IN ('event', 'memory', 'knowledge_chunk')),
    parent_id           TEXT NOT NULL,
    relation_type       TEXT NOT NULL DEFAULT 'derived_from' CHECK (relation_type IN (
                            'derived_from',
                            'supersedes',
                            'contradicts',
                            'crystallized_from'
                        )),
    PRIMARY KEY (child_memory_id, parent_type, parent_id)
);

CREATE INDEX IF NOT EXISTS idx_memories_Retrieval ON memories(visibility_scope, invalidated_at_ts, memory_tier);
CREATE INDEX IF NOT EXISTS idx_lineage_parent ON memory_lineage_edges(parent_type, parent_id);

CREATE TABLE IF NOT EXISTS memories_vec (
    memory_id       TEXT PRIMARY KEY REFERENCES memories(memory_id) ON DELETE CASCADE,
    embedding_json  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prospective_commitments (
    commitment_id       TEXT PRIMARY KEY,
    commitment_kind     TEXT NOT NULL CHECK (commitment_kind IN ('agent_promise', 'user_upcoming_event', 'curiosity_agenda')),
    visibility_scope    TEXT NOT NULL,
    taint_level         TEXT NOT NULL DEFAULT 'trusted_owner' CHECK (taint_level IN ('trusted_owner', 'semi_trusted_friend', 'untrusted_external')),
    description         TEXT NOT NULL,
    trigger_type        TEXT NOT NULL CHECK (trigger_type IN ('at_virtual_ts', 'on_next_interaction_after_ts', 'on_idle_window')),
    trigger_virtual_ts  INTEGER NOT NULL,
    deadline_virtual_ts INTEGER DEFAULT NULL,
    status              TEXT NOT NULL CHECK (status IN ('pending', 'due', 'fulfilled', 'missed', 'cancelled')),
    source_event_id     TEXT NOT NULL REFERENCES event_log(event_id),
    resolved_event_id   TEXT DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_commitments_status_ts ON prospective_commitments(status, trigger_virtual_ts);

CREATE TABLE IF NOT EXISTS cognitive_state_checkpoints (
    state_rev INTEGER PRIMARY KEY,
    virtual_ts_ms INTEGER NOT NULL,
    caused_by_event_id TEXT NOT NULL,
    continuous_states_json TEXT NOT NULL DEFAULT '{}',
    state_attributions_json TEXT NOT NULL DEFAULT '[]',
    relationship_json TEXT NOT NULL DEFAULT '{}',
    user_model_json TEXT NOT NULL DEFAULT '{}',
    working_memory_json TEXT NOT NULL DEFAULT '{}',
    hibernation_intervals_json TEXT NOT NULL DEFAULT '[]',
    next_wakeup_ts_ms INTEGER DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS turn_decision_traces (
    trace_id                       TEXT PRIMARY KEY,
    turn_event_id                  TEXT NOT NULL REFERENCES event_log(event_id),
    virtual_ts_ms                  INTEGER NOT NULL,
    state_rev_before               INTEGER NOT NULL,
    state_rev_after                INTEGER NOT NULL,
    step1_perception_json          TEXT NOT NULL,
    step2_gate_safety_json         TEXT NOT NULL,
    step3_memory_recall_json       TEXT NOT NULL,
    step4_homeostasis_json         TEXT NOT NULL,
    step5_strategy_proposal_json   TEXT NOT NULL,
    step6_tool_auth_json           TEXT NOT NULL,
    step7_emitted_intent_json      TEXT NOT NULL,
    step8_delivery_receipt_json    TEXT DEFAULT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
    chunk_id            TEXT PRIMARY KEY,
    collection_id       TEXT NOT NULL,
    document_name       TEXT NOT NULL,
    chunk_index         INTEGER NOT NULL,
    content_text        TEXT NOT NULL,
    metadata_json       TEXT NOT NULL DEFAULT '{}',
    taint_level         TEXT NOT NULL DEFAULT 'untrusted_external' CHECK (taint_level = 'untrusted_external'),
    citation_count      INTEGER NOT NULL DEFAULT 0,
    last_cited_ts_ms    INTEGER DEFAULT NULL,
    created_at_ts_ms    INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
    chunk_id UNINDEXED,
    collection_id UNINDEXED,
    content_text,
    tokenize = 'unicode61'
);

CREATE TABLE IF NOT EXISTS knowledge_chunks_vec (
    chunk_id        TEXT PRIMARY KEY REFERENCES knowledge_chunks(chunk_id) ON DELETE CASCADE,
    embedding_json  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS knowledge_collections (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, audience TEXT NOT NULL DEFAULT 'only_owner'
);
CREATE TABLE IF NOT EXISTS knowledge_documents (
    id TEXT PRIMARY KEY, collection_id TEXT NOT NULL REFERENCES knowledge_collections(id),
    name TEXT NOT NULL, digest TEXT NOT NULL, original BLOB NOT NULL, format TEXT NOT NULL,
    revision INTEGER NOT NULL, warning TEXT NOT NULL DEFAULT '', embedding_key TEXT NOT NULL DEFAULT '',
    UNIQUE(collection_id, name), UNIQUE(collection_id, digest)
);
CREATE TABLE IF NOT EXISTS knowledge_mount_overrides (
    profile_id TEXT NOT NULL, collection_id TEXT NOT NULL REFERENCES knowledge_collections(id),
    mounted INTEGER NOT NULL, PRIMARY KEY(profile_id,collection_id)
);
CREATE TABLE IF NOT EXISTS knowledge_import_errors (
    collection_id TEXT NOT NULL REFERENCES knowledge_collections(id), name TEXT NOT NULL, reason TEXT NOT NULL,
    PRIMARY KEY(collection_id, name)
);
CREATE TABLE IF NOT EXISTS knowledge_update_errors (
    document_id TEXT PRIMARY KEY REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    name TEXT NOT NULL, reason TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_locations (
    chunk_id TEXT PRIMARY KEY REFERENCES knowledge_chunks(chunk_id) ON DELETE CASCADE,
    document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
    location TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, legacy_citations INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS knowledge_locations_document ON knowledge_locations(document_id);
CREATE TABLE IF NOT EXISTS knowledge_turn_sources (
    event_id TEXT NOT NULL REFERENCES event_log(event_id) ON DELETE CASCADE,
    chunk_id TEXT NOT NULL REFERENCES knowledge_chunks(chunk_id) ON DELETE CASCADE,
    marker INTEGER NOT NULL, counted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(event_id, chunk_id)
);

CREATE TABLE IF NOT EXISTS soul_milestones_ledger (
    milestone_id            TEXT PRIMARY KEY,
    title                   TEXT NOT NULL,
    category                TEXT NOT NULL CHECK (category IN ('temporal_anniversary', 'trust_breakthrough', 'joint_agency_achievement', 'story_event')),
    unlocked_virtual_ts     INTEGER NOT NULL,
    trigger_event_id        TEXT NOT NULL REFERENCES event_log(event_id),
    unlocked_rewards_json   TEXT NOT NULL DEFAULT '{}',
    state_rev_unlocked      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sb243_annual_metrics (
    year_month                          TEXT PRIMARY KEY,
    crisis_referral_triggered_count     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS kernel_runtime_meta (
    meta_key        TEXT PRIMARY KEY,
    meta_value      TEXT NOT NULL
);
`;

export function applyStorageSchema(database: DatabaseSync): void {
  database.exec(SQLITE_PRAGMA_DDL);
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec(SQLITE_SCHEMA_DDL);
    database.exec("COMMIT");
  } catch (error) {
    if (database.isTransaction) database.exec("ROLLBACK");
    throw error;
  }
}
