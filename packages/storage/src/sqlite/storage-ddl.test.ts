import {
  existsSync,
  mkdtempSync,
  rmSync,
  statSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  BlackboardPolicySchema,
  ExtensionsStateJsonSchema,
  IdentityYamlSchema,
  LorebookYamlSchema,
  MilestonesAndRitualsYamlSchema,
  OrchestrationRulesSchema,
  SkillMarkdownFrontmatterSchema
} from "@ai0/protocol";
import { afterEach, describe, expect, it } from "vitest";

import {
  CoordinatorStorageMutator,
  type ReadOnlyStorageView
} from "./database-driver.js";
import {
  NarrativeMarkdownSchema,
  RedactionLedgerSchema,
  SoulArchiveConfigSchema,
  SoulArchiveManifestSchema,
  VoiceExemplarSchema,
  createDefaultSoulArchiveConfig,
  initializeSoulDirectory,
  readSoulArchiveConfig,
  writeSoulArchiveConfig
} from "../snapshot-git/soul-directory.js";

const DEFAULT_SOUL_PATH = fileURLToPath(
  new URL("../../../../souls/default.soul/", import.meta.url)
);
const temporaryRoots: string[] = [];

function createTemporarySoul() {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "ai0-storage-"));
  temporaryRoots.push(temporaryRoot);
  const layout = initializeSoulDirectory(join(temporaryRoot, "test.soul"), {
    createdAt: "2026-01-01T00:00:00.000Z"
  });
  return layout;
}

afterEach(() => {
  for (const temporaryRoot of temporaryRoots.splice(0)) {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

describe(".soul directory", () => {
  it("initializes every managed path and roundtrips archive configuration", () => {
    const layout = createTemporarySoul();
    const requiredFiles = [
      layout.manifestPath,
      layout.identityPath,
      layout.narrativePath,
      layout.voiceExemplarsPath,
      layout.blackboardPolicyPath,
      layout.milestonesAndRitualsPath,
      layout.defaultWorldLorebookPath,
      layout.defaultOrchestrationFlowPath,
      layout.extensionsStatePath,
      layout.soulCoreDatabasePath,
      layout.redactionLedgerPath
    ];

    expect(requiredFiles.every((filePath) => existsSync(filePath))).toBe(true);
    expect(statSync(layout.attachmentsPath).isDirectory()).toBe(true);

    const initial = readSoulArchiveConfig(layout.rootPath);
    expect(initial.identity.display_name).toBe("test");
    expect(initial.defaultWorldLorebook.entries).toEqual([]);
    expect(initial.manifest.created_at).toBe("2026-01-01T00:00:00.000Z");

    writeSoulArchiveConfig(layout.rootPath, {
      ...initial,
      narrative: "# Updated chapter\n"
    });
    initializeSoulDirectory(layout.rootPath);

    expect(readSoulArchiveConfig(layout.rootPath).narrative).toBe(
      "# Updated chapter\n"
    );
  });

  it("enforces zero-preset soul policy and Zod-validates fresh soul archive configuration", () => {
    expect(existsSync(DEFAULT_SOUL_PATH)).toBe(false);
    const config = createDefaultSoulArchiveConfig("2026-11-25T00:00:00.000Z", "Nagi");

    expect(() => SoulArchiveConfigSchema.parse(config)).not.toThrow();
    expect(() => SoulArchiveManifestSchema.parse(config.manifest)).not.toThrow();
    expect(() => IdentityYamlSchema.parse(config.identity)).not.toThrow();
    expect(() => NarrativeMarkdownSchema.parse(config.narrative)).not.toThrow();
    for (const exemplar of config.voiceExemplars) {
      expect(() => VoiceExemplarSchema.parse(exemplar)).not.toThrow();
    }
    expect(() =>
      BlackboardPolicySchema.parse(config.blackboardPolicy)
    ).not.toThrow();
    expect(() =>
      MilestonesAndRitualsYamlSchema.parse(config.milestonesAndRituals)
    ).not.toThrow();
    expect(() =>
      LorebookYamlSchema.parse(config.defaultWorldLorebook)
    ).not.toThrow();
    expect(() =>
      OrchestrationRulesSchema.parse(config.defaultOrchestrationFlow)
    ).not.toThrow();
    expect(() =>
      ExtensionsStateJsonSchema.parse(config.extensionsState)
    ).not.toThrow();
    expect(() =>
      RedactionLedgerSchema.parse(config.redactionLedger)
    ).not.toThrow();
    expect(config.identity.soul_id).toBe(config.manifest.soul_id);
  });
});

describe("SQLite storage DDL", () => {
  it("creates the seven headline tables, FTS5 index, and connection PRAGMAs", () => {
    const layout = createTemporarySoul();
    const storage = new CoordinatorStorageMutator(layout.soulCoreDatabasePath);

    try {
      expect(storage.getTablePragmaStatus()).toEqual({
        journal_mode: "wal",
        foreign_keys: 1,
        secure_delete: 1
      });
    } finally {
      storage.close();
    }

    const database = new DatabaseSync(layout.soulCoreDatabasePath);
    try {
      const tables = database
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
        .all()
        .map((row) => String(row.name));

      expect(tables).toEqual(
        expect.arrayContaining([
          "event_log",
          "memories",
          "prospective_commitments",
          "cognitive_state_checkpoints",
          "turn_decision_traces",
          "knowledge_chunks",
          "soul_milestones_ledger"
        ])
      );
      expect(tables).toContain("memory_lineage_edges");

      const ftsDefinition = database
        .prepare(
          "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?"
        )
        .get("knowledge_chunks_fts");
      expect(String(ftsDefinition?.sql)).toMatch(/USING fts5/iu);
    } finally {
      database.close();
    }
  });

  it("roundtrips coordinator writes through a read-only view", () => {
    const layout = createTemporarySoul();
    const storage = new CoordinatorStorageMutator(layout.soulCoreDatabasePath);

    try {
      const event = storage.appendEvent({
        event_id: "evt.roundtrip.1",
        wall_ts_ms: 1_800_000_000_000,
        virtual_ts_ms: 1_800_000_000_000,
        source_shell_id: "builtin.webchat.default",
        principal_id: "owner",
        principal_trust: "owner_verified",
        venue_type: "private_1on1",
        audience_scope: "only_owner",
        event_category: "perception_committed",
        modality: "text",
        summary_text: "The owner shared a storage test fact.",
        payload_json: "{}",
        state_rev_after: 1,
        active_modules_mask: 1
      });
      storage.insertMemoryWithLineage(
        {
          memory_id: "mem.roundtrip.1",
          memory_tier: "episodic_experience",
          epistemic_type: "observed_firsthand",
          attributed_principal: "owner",
          visibility_scope: "only_owner",
          taint_level: "trusted_owner",
          content_text: "A private storage roundtrip fact.",
          created_virtual_ts: event.virtual_ts_ms,
          last_recalled_ts: event.virtual_ts_ms,
          valid_from_virtual_ts: event.virtual_ts_ms,
          created_at_rev: 1
        },
        [{ parent_type: "event", parent_id: event.event_id }]
      );
      storage.saveCheckpoint({
        state_rev: 1,
        virtual_ts_ms: event.virtual_ts_ms,
        caused_by_event_id: event.event_id,
        continuous_states_json: JSON.stringify({
          instant_valence: 0.2,
          instant_arousal: 0.1,
          mood_baseline_val: 0.1,
          circadian_energy: 0.8,
          metabolic_energy: 0.9,
          drive_social_longing: 0.2,
          drive_curiosity: 0.7
        }),
        state_attributions_json: JSON.stringify({ mood_attr_scope: "only_owner" }),
        relationship_json: "{}",
        user_model_json: "{}",
        working_memory_json: "{}",
        hibernation_intervals_json: "[]"
      });
      storage.insertKnowledgeChunk({
        chunk_id: "chunk.roundtrip.1",
        collection_id: "kb.tests",
        document_name: "storage.md",
        chunk_index: 0,
        content_text: "SQLite FTS and vector storage roundtrip.",
        created_at_ts_ms: event.wall_ts_ms
      });

      const view: ReadOnlyStorageView = storage.asReadOnlyView();
      expect(view.getEventById(event.event_id)).toEqual(event);
      expect(view.listEvents()).toContainEqual(event);
      expect(
        view.queryMemoriesWithAudienceGuard({
          audience_scope: "only_owner",
          principal_trust: "owner_verified",
          query_text: "storage roundtrip"
        })
      ).toEqual([
        expect.objectContaining({
          memory_id: "mem.roundtrip.1",
          content_text: "A private storage roundtrip fact."
        })
      ]);
      expect(view.getMemoryLineage("mem.roundtrip.1")).toEqual([
        {
          child_memory_id: "mem.roundtrip.1",
          parent_type: "event",
          parent_id: event.event_id,
          relation_type: "derived_from"
        }
      ]);
      expect(view.getLatestCheckpoint()).toEqual(
        expect.objectContaining({ state_rev: 1, caused_by_event_id: event.event_id })
      );
      expect(view.queryKnowledgeChunks("SQLite storage")).toEqual([
        expect.objectContaining({ chunk_id: "chunk.roundtrip.1" })
      ]);
    } finally {
      storage.close();
    }
  });
});
