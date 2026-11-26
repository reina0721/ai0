import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import {
  CoordinatorStorageMutator,
  type CoordinatorStorageOptions,
} from "../sqlite/database-driver.js";
import { executeHardForget } from "../lineage-dag/hard-forget-engine.js";
import {
  SoulDirectoryLayout,
  RedactionLedgerSchema,
  type RedactionLedgerEntry,
} from "./soul-directory.js";

export type SnapshotRollbackMode =
  | "silent_hard"
  | "meta_reconciled"
  | "dream_bridge";

export interface SoulArchiveSnapshot {
  id: string;
  directory: string;
  createdAt: number;
}

function copyArchive(source: string, target: string): void {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === ".snapshots") continue;
    cpSync(join(source, entry.name), join(target, entry.name), {
      recursive: true,
    });
  }
}

function clearArchive(archiveDirectory: string): void {
  for (const entry of readdirSync(archiveDirectory, { withFileTypes: true })) {
    if (entry.name === ".snapshots") continue;
    rmSync(join(archiveDirectory, entry.name), {
      force: true,
      recursive: true,
    });
  }
}

function readLedger(path: string): RedactionLedgerEntry[] {
  if (!existsSync(path)) return [];
  return RedactionLedgerSchema.parse(
    JSON.parse(readFileSync(path, "utf8")),
  ) as RedactionLedgerEntry[];
}

function mergeLedgers(
  snapshotLedger: RedactionLedgerEntry[],
  preservedLedger: RedactionLedgerEntry[],
): RedactionLedgerEntry[] {
  const entries = new Map<string, RedactionLedgerEntry>();
  for (const entry of [...snapshotLedger, ...preservedLedger]) {
    entries.set(JSON.stringify(entry), entry);
  }
  return [...entries.values()];
}

export class SoulArchiveManager {
  readonly archiveDirectory: string;
  readonly layout: SoulDirectoryLayout;
  readonly snapshotsDirectory: string;

  constructor(
    soulDirOrDbPath: string,
    private readonly storageOptions: CoordinatorStorageOptions = {},
  ) {
    const resolved = resolve(soulDirOrDbPath);
    this.archiveDirectory = resolved.endsWith(".sqlite")
      ? dirname(dirname(resolved))
      : resolved;
    this.layout = new SoulDirectoryLayout(this.archiveDirectory);
    this.snapshotsDirectory = join(this.archiveDirectory, ".snapshots");
  }

  createSnapshot(snapshotId?: string): SoulArchiveSnapshot {
    const createdAt = Date.now();
    const id = snapshotId ?? `snapshot_${createdAt}`;
    const directory = join(this.snapshotsDirectory, id);

    mkdirSync(this.snapshotsDirectory, { recursive: true });
    if (existsSync(directory)) {
      throw new Error(`Snapshot already exists: ${id}`);
    }
    copyArchive(this.archiveDirectory, directory);
    return { id, directory, createdAt };
  }

  async rollbackToSnapshot(
    snapshotId: string,
    mode: SnapshotRollbackMode = "silent_hard",
    virtualTsMs = Date.now(),
  ): Promise<CoordinatorStorageMutator> {
    const snapshotDirectory = join(this.snapshotsDirectory, snapshotId);
    if (!existsSync(snapshotDirectory)) {
      throw new Error(`Snapshot does not exist: ${snapshotId}`);
    }

    const preservedLedger = readLedger(this.layout.redactionLedgerPath);
    clearArchive(this.archiveDirectory);
    copyArchive(snapshotDirectory, this.archiveDirectory);

    const mergedLedger = mergeLedgers(
      readLedger(this.layout.redactionLedgerPath),
      preservedLedger,
    );
    mkdirSync(dirname(this.layout.redactionLedgerPath), { recursive: true });
    writeFileSync(
      this.layout.redactionLedgerPath,
      `${JSON.stringify(mergedLedger, null, 2)}\n`,
      "utf8",
    );

    const restored = new CoordinatorStorageMutator(
      this.layout.soulCoreDatabasePath,
      this.storageOptions,
    );

    for (const entry of mergedLedger) {
      await executeHardForget(restored, {
        target_event_ids: entry.target_event_ids,
        target_memory_ids: entry.target_memory_ids,
        soulDirPath: this.archiveDirectory,
        skipLedgerAppend: true,
        replayingTombstone: true,
        redactedAtTsMs: entry.redacted_at_wall_ts,
        virtualTsMs,
      });
    }

    if (mode !== "silent_hard") {
      restored.appendEvent({
        event_category: "soul_rollback_bridge",
        event_id: `evt_rollback_${snapshotId}_${virtualTsMs}`,
        wall_ts_ms: virtualTsMs,
        virtual_ts_ms: virtualTsMs,
        source_channel_id: "kernel.internal",
        principal_id: "system",
        principal_trust: "owner_verified",
        venue_type: "internal_background",
        audience_scope: "only_owner",
        modality: "system",
        summary_text: `Rolled back to snapshot ${snapshotId} with mode ${mode}`,
        payload_json: JSON.stringify({
          snapshot_id: snapshotId,
          mode,
          replayed_redactions: mergedLedger.length,
        }),
        state_rev_after:
          (restored.getLatestCheckpoint()?.state_rev ?? 0) + 1,
        active_modules_mask: 1,
      });
    }

    return restored;
  }

  rollback(
    snapshotId: string,
    mode: SnapshotRollbackMode = "silent_hard",
    virtualTsMs = Date.now(),
  ): Promise<CoordinatorStorageMutator> {
    return this.rollbackToSnapshot(snapshotId, mode, virtualTsMs);
  }

  restoreSnapshot(
    snapshotId: string,
    mode: SnapshotRollbackMode = "silent_hard",
    virtualTsMs = Date.now(),
  ): Promise<CoordinatorStorageMutator> {
    return this.rollbackToSnapshot(snapshotId, mode, virtualTsMs);
  }

  forkSandboxInstance(
    forkId: string,
    options?: { targetDir?: string; snapshotId?: string },
  ): {
    target_instance: `sandbox:${string}`;
    soulDirPath: string;
    storage: CoordinatorStorageMutator;
  } {
    const source = options?.snapshotId
      ? join(this.snapshotsDirectory, options.snapshotId)
      : this.archiveDirectory;
    const targetDir = resolve(
      options?.targetDir ??
        join(dirname(this.archiveDirectory), `sandbox_${forkId}.soul`),
    );

    if (!existsSync(source)) {
      throw new Error(`Sandbox source does not exist: ${source}`);
    }
    if (existsSync(targetDir)) {
      throw new Error(`Sandbox target already exists: ${targetDir}`);
    }
    cpSync(source, targetDir, { recursive: true });

    return {
      target_instance: (`sandbox:${forkId}`) as `sandbox:${string}`,
      soulDirPath: targetDir,
      storage: new CoordinatorStorageMutator(
        join(targetDir, "state", "soul_core.sqlite"),
        this.storageOptions,
      ),
    };
  }

  forkSandbox(
    forkId: string,
    options?: { targetDir?: string; snapshotId?: string },
  ) {
    return this.forkSandboxInstance(forkId, options);
  }
}
