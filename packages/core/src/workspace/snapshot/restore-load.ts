/** Locked committed-snapshot loading and aggregate validation for restore. */

import type { WorkspaceSnapshotConfig } from "./config";
import { snapshotManifestFingerprint } from "./fingerprint";
import { snapshotHeaderMatchesRef } from "./ref";
import {
  hydrateSnapshotEntry,
  type HydratedSnapshotEntry,
  validateSnapshotEntryMetadata,
} from "./restore-content";
import { snapshotEntrySizeBytes, type WorkspaceSnapshotEntry } from "./records";
import { isWorkspaceSnapshotEntry } from "./record-validation";
import {
  getSnapshotHeader,
  listSnapshotEntryRecords,
  snapshotEntryKey,
} from "./store";
import { WorkspaceSnapshotError, type WorkspaceSnapshotRef } from "./types";

/** Load and fully validate one committed snapshot before live planning starts. */
export async function loadCommittedSnapshot(
  config: WorkspaceSnapshotConfig,
  ref: WorkspaceSnapshotRef,
): Promise<readonly HydratedSnapshotEntry[]> {
  const entries = await loadCommittedSnapshotMetadata(config, ref);
  return Promise.all(
    entries.map((entry) => hydrateSnapshotEntry(entry, config.assets)),
  );
}

/** Validate committed records without requiring owned assets to remain readable. */
export async function loadCommittedSnapshotMetadata(
  config: WorkspaceSnapshotConfig,
  ref: WorkspaceSnapshotRef,
): Promise<readonly WorkspaceSnapshotEntry[]> {
  const header = await getSnapshotHeader(
    config.store,
    ref.workspaceId,
    ref.namespace,
    ref.id,
  );
  if (
    header === null ||
    (header !== "malformed" && header.state !== "committed")
  ) {
    throw new WorkspaceSnapshotError("not_found", "Snapshot was not found.", {
      snapshotId: ref.id,
    });
  }
  if (header === "malformed" || !snapshotHeaderMatchesRef(header, ref)) {
    throw corruptSnapshot(
      ref.id,
      "Snapshot header does not match its reference.",
    );
  }
  const entries = validateEntryRecords(
    await listSnapshotEntryRecords(
      config.store,
      ref.workspaceId,
      ref.namespace,
      ref.id,
    ),
    ref,
  );
  for (const entry of entries) validateSnapshotEntryMetadata(entry);
  const sizeBytes = entries.reduce(
    (total, entry) => total + snapshotEntrySizeBytes(entry),
    0,
  );
  const manifestFingerprint = snapshotManifestFingerprint({
    id: header.id,
    workspaceId: header.workspaceId,
    namespace: header.namespace,
    path: header.path,
    createdAt: header.createdAt,
    entries: entries.map((entry) => ({
      path: entry.path,
      fingerprint: entry.entryFingerprint,
    })),
  });
  if (
    header.fileCount !== entries.length ||
    header.sizeBytes !== sizeBytes ||
    header.manifestFingerprint !== manifestFingerprint
  ) {
    throw corruptSnapshot(
      ref.id,
      "Snapshot aggregate does not match its entries.",
    );
  }
  return entries;
}

function validateEntryRecords(
  records: Awaited<ReturnType<typeof listSnapshotEntryRecords>>,
  ref: WorkspaceSnapshotRef,
): readonly WorkspaceSnapshotEntry[] {
  const entries: WorkspaceSnapshotEntry[] = [];
  const paths = new Set<string>();
  for (const record of records) {
    const entry = record.value;
    if (
      !isWorkspaceSnapshotEntry(entry) ||
      entry.snapshotId !== ref.id ||
      record.key !==
        snapshotEntryKey(ref.workspaceId, ref.namespace, ref.id, entry.path) ||
      paths.has(entry.path) ||
      !isSelectedPath(entry.path, ref.path)
    ) {
      throw corruptSnapshot(ref.id, "Snapshot contains a malformed entry.");
    }
    paths.add(entry.path);
    entries.push(entry);
  }
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function isSelectedPath(path: string, root: string): boolean {
  return path === root || root === "/" || path.startsWith(`${root}/`);
}

function corruptSnapshot(
  snapshotId: string,
  message: string,
): WorkspaceSnapshotError {
  return new WorkspaceSnapshotError("corrupt_snapshot", message, {
    snapshotId,
  });
}
