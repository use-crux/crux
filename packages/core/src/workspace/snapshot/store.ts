/**
 * RecordStore lifecycle helpers for Workspace snapshots.
 *
 * @module
 */

import {
  StorageError,
  type AssetStore,
  type RecordEntry,
  type RecordStore,
} from "../../storage";
import type { WorkspacePath } from "../types";
import { snapshotManifestFingerprint } from "./fingerprint";
import {
  WORKSPACE_SNAPSHOT_SCHEMA,
  snapshotEntryAssetRefs,
  type WorkspaceSnapshotHeader,
  type WorkspaceSnapshotEntry,
} from "./records";
import {
  isWorkspaceSnapshotEntry,
  isWorkspaceSnapshotHeader,
} from "./record-validation";
import { WorkspaceSnapshotError } from "./types";

function snapshotPrefix(workspaceId: string, namespace: string): string {
  return `workspace:${encodeURIComponent(workspaceId)}:${encodeURIComponent(namespace)}:snapshot:`;
}

function snapshotEntryPrefix(
  workspaceId: string,
  namespace: string,
  snapshotId: string,
): string {
  return `${snapshotPrefix(workspaceId, namespace)}${encodeURIComponent(snapshotId)}:entry:`;
}

/** Record key for one normalized file entry within a snapshot. */
export function snapshotEntryKey(
  workspaceId: string,
  namespace: string,
  snapshotId: string,
  path: WorkspacePath,
): string {
  return `${snapshotEntryPrefix(workspaceId, namespace, snapshotId)}${encodeURIComponent(path)}`;
}

/** Record key for one snapshot lifecycle header. */
export function snapshotHeaderKey(
  workspaceId: string,
  namespace: string,
  snapshotId: string,
): string {
  return `${snapshotPrefix(workspaceId, namespace)}${encodeURIComponent(snapshotId)}:header`;
}

/** Write the initial invisible header for a snapshot being materialized. */
export async function createSnapshotHeader(input: {
  readonly store: RecordStore;
  readonly id: string;
  readonly workspaceId: string;
  readonly namespace: string;
  readonly path: WorkspacePath;
  readonly createdAt: number;
}): Promise<WorkspaceSnapshotHeader> {
  const header = {
    _cruxWorkspaceSnapshot: true,
    schema: WORKSPACE_SNAPSHOT_SCHEMA,
    state: "creating",
    id: input.id,
    workspaceId: input.workspaceId,
    namespace: input.namespace,
    path: input.path,
    fileCount: 0,
    sizeBytes: 0,
    createdAt: input.createdAt,
    manifestFingerprint: snapshotManifestFingerprint({
      id: input.id,
      workspaceId: input.workspaceId,
      namespace: input.namespace,
      path: input.path,
      createdAt: input.createdAt,
      entries: [],
    }),
  } satisfies WorkspaceSnapshotHeader;
  const created = await input.store.create(
    snapshotHeaderKey(input.workspaceId, input.namespace, input.id),
    header,
  );
  if (!created) {
    throw new Error("Snapshot id collision prevented header creation.");
  }
  return header;
}

/** Replace a creating header with its committed aggregate values. */
export async function commitSnapshotHeader(input: {
  readonly store: RecordStore;
  readonly header: WorkspaceSnapshotHeader;
  readonly fileCount: number;
  readonly sizeBytes: number;
  readonly entries: readonly {
    readonly path: string;
    readonly fingerprint: string;
  }[];
}): Promise<WorkspaceSnapshotHeader> {
  const header = {
    ...input.header,
    state: "committed",
    fileCount: input.fileCount,
    sizeBytes: input.sizeBytes,
    manifestFingerprint: snapshotManifestFingerprint({
      id: input.header.id,
      workspaceId: input.header.workspaceId,
      namespace: input.header.namespace,
      path: input.header.path,
      createdAt: input.header.createdAt,
      entries: input.entries,
    }),
  } satisfies WorkspaceSnapshotHeader;
  await input.store.put(
    snapshotHeaderKey(header.workspaceId, header.namespace, header.id),
    header,
  );
  return header;
}

/** Persist one materialized file entry. */
export async function putSnapshotEntry(input: {
  readonly store: RecordStore;
  readonly workspaceId: string;
  readonly namespace: string;
  readonly entry: WorkspaceSnapshotEntry;
}): Promise<void> {
  await input.store.put(
    snapshotEntryKey(
      input.workspaceId,
      input.namespace,
      input.entry.snapshotId,
      input.entry.path,
    ),
    input.entry,
  );
}

/** Best-effort cleanup for a snapshot that did not commit. */
export async function cleanupSnapshotHeader(
  store: RecordStore,
  header: Pick<WorkspaceSnapshotHeader, "workspaceId" | "namespace" | "id">,
): Promise<void> {
  await store.delete(
    snapshotHeaderKey(header.workspaceId, header.namespace, header.id),
  );
}

/** Load a structurally valid snapshot header, preserving malformed values for callers. */
export async function getSnapshotHeader(
  store: RecordStore,
  workspaceId: string,
  namespace: string,
  snapshotId: string,
): Promise<WorkspaceSnapshotHeader | "malformed" | null> {
  const value = await store.get(
    snapshotHeaderKey(workspaceId, namespace, snapshotId),
  );
  if (value === null) return null;
  return isWorkspaceSnapshotHeader(value) ? value : "malformed";
}

/** List every structurally valid header in one Workspace namespace. */
export async function listSnapshotHeaders(
  store: RecordStore,
  workspaceId: string,
  namespace: string,
): Promise<readonly WorkspaceSnapshotHeader[]> {
  const records = await listAllRecords(
    store,
    snapshotPrefix(workspaceId, namespace),
  );
  return records.flatMap((entry) => {
    const header = entry.value;
    return isWorkspaceSnapshotHeader(header) &&
      header.workspaceId === workspaceId &&
      header.namespace === namespace &&
      entry.key === snapshotHeaderKey(workspaceId, namespace, header.id)
      ? [header]
      : [];
  });
}

/** Mark a snapshot deleting, remove its entries, then remove the header last. */
export async function deleteSnapshotRecords(input: {
  readonly store: RecordStore;
  readonly assets?: AssetStore;
  readonly header: WorkspaceSnapshotHeader;
}): Promise<void> {
  const deleting = {
    ...input.header,
    state: "deleting",
  } satisfies WorkspaceSnapshotHeader;
  await input.store.put(
    snapshotHeaderKey(deleting.workspaceId, deleting.namespace, deleting.id),
    deleting,
  );
  await deleteSnapshotOwnedData({
    store: input.store,
    ...(input.assets !== undefined ? { assets: input.assets } : {}),
    snapshot: deleting,
  });
  await input.store.delete(
    snapshotHeaderKey(deleting.workspaceId, deleting.namespace, deleting.id),
  );
}

/** Clean residual entry records when an owned header is already absent. */
export async function deleteSnapshotEntries(
  store: RecordStore,
  snapshot: Pick<WorkspaceSnapshotHeader, "workspaceId" | "namespace" | "id">,
): Promise<void> {
  const records = await listAllRecords(
    store,
    snapshotEntryPrefix(snapshot.workspaceId, snapshot.namespace, snapshot.id),
  );
  for (const record of records) {
    await store.delete(record.key);
  }
}

/** Delete snapshot-owned assets first, then their entry records. */
export async function deleteSnapshotOwnedData(input: {
  readonly store: RecordStore;
  readonly assets?: AssetStore;
  readonly snapshot: Pick<
    WorkspaceSnapshotHeader,
    "workspaceId" | "namespace" | "id"
  >;
}): Promise<void> {
  const records = await listAllRecords(
    input.store,
    snapshotEntryPrefix(
      input.snapshot.workspaceId,
      input.snapshot.namespace,
      input.snapshot.id,
    ),
  );
  for (const record of records) {
    if (
      !isWorkspaceSnapshotEntry(record.value) ||
      record.value.snapshotId !== input.snapshot.id
    ) {
      throw new WorkspaceSnapshotError(
        "corrupt_snapshot",
        "Snapshot contains a malformed materialized entry.",
        { snapshotId: input.snapshot.id },
      );
    }
    const refs = snapshotEntryAssetRefs(record.value);
    if (refs.length > 0 && !input.assets) {
      throw new Error("Snapshot deletion requires the owning AssetStore.");
    }
    for (const ref of refs) await deleteOwnedAsset(input.assets!, ref);
  }
  for (const record of records) await input.store.delete(record.key);
}

async function deleteOwnedAsset(
  assets: AssetStore,
  ref: { readonly uri: string },
): Promise<void> {
  try {
    await assets.delete(ref);
  } catch (error) {
    if (error instanceof StorageError && error.code === "not_found") return;
    throw error;
  }
}

async function listAllRecords(
  store: RecordStore,
  prefix: string,
): Promise<readonly RecordEntry[]> {
  const records: RecordEntry[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  do {
    const page = await store.list(prefix, cursor ? { cursor } : undefined);
    records.push(...page.entries);
    cursor = page.cursor;
    if (cursor && seen.has(cursor)) {
      throw new Error("RecordStore returned a repeated pagination cursor.");
    }
    if (cursor) seen.add(cursor);
  } while (cursor);
  return records;
}
