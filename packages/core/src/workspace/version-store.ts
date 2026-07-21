/**
 * Version-history persistence for workspace files.
 *
 * Snapshots live under a dedicated `version:` key prefix so the live `file:`
 * HEAD record, directory listings, and quota scans never see them. Each
 * content mutation appends one {@link WorkspaceVersionRecord}; retention
 * ({@link WorkspaceVersioning.maxVersions}) and deletion GC the oldest
 * snapshots together with their out-of-line assets.
 *
 * @module
 */

import type {
  AssetStore,
  JsonObject,
  RecordStore,
  RecordWriteOptions,
} from "../storage";
import { emitWorkspaceVersion } from "./observability";
import type { WorkspaceFileRecord, WorkspacePath } from "./types";
import {
  VERSION_RECORD_SCHEMA,
  type WorkspaceVersion,
  type WorkspaceVersionOperation,
  type WorkspaceVersionRecord,
  type WorkspaceVersioning,
} from "./version-types";

function versionPrefix(
  workspaceId: string,
  namespace: string,
  path: WorkspacePath,
): string {
  return `workspace:${encodeURIComponent(workspaceId)}:${encodeURIComponent(
    namespace,
  )}:version:${encodeURIComponent(path)}:v`;
}

/** The record-store key for a single file version snapshot. */
export function versionKey(
  workspaceId: string,
  namespace: string,
  path: WorkspacePath,
  version: number,
): string {
  return `${versionPrefix(workspaceId, namespace, path)}${version}`;
}

/**
 * Append a snapshot of the just-written HEAD record, then GC older versions
 * when {@link WorkspaceVersioning.maxVersions} is exceeded.
 *
 * The snapshot's version number is taken from `record.headVersion`, so callers
 * persist the HEAD record (with its version-scoped asset URI) first.
 */
export async function recordFileVersion(input: {
  readonly store: RecordStore;
  readonly assets?: AssetStore;
  readonly workspaceId: string;
  readonly namespace: string;
  readonly path: WorkspacePath;
  readonly record: WorkspaceFileRecord;
  readonly operation: WorkspaceVersionOperation;
  readonly versioning?: WorkspaceVersioning;
  readonly setOptions?: RecordWriteOptions;
  /** Defer destructive retention until a surrounding mutation batch commits. */
  readonly deferRetention?: boolean;
}): Promise<void> {
  const version = input.record.headVersion ?? 1;
  const value: WorkspaceVersionRecord = {
    _cruxWorkspaceVersion: true,
    schema: VERSION_RECORD_SCHEMA,
    version,
    operation: input.operation,
    createdAt: input.record.updatedAt,
    snapshot: input.record as unknown as WorkspaceVersionRecord["snapshot"],
  };
  await input.store.put(
    versionKey(input.workspaceId, input.namespace, input.path, version),
    value as unknown as JsonObject,
    input.setOptions,
  );
  emitWorkspaceVersion({
    workspaceId: input.workspaceId,
    namespace: input.namespace,
    path: input.path,
    version,
    operation: input.operation,
  });

  const maxVersions = input.versioning?.maxVersions;
  if (!input.deferRetention && maxVersions !== undefined && maxVersions > 0) {
    await retainFileVersions({
      store: input.store,
      assets: input.assets,
      workspaceId: input.workspaceId,
      namespace: input.namespace,
      path: input.path,
      maxVersions,
      preserveVersion: input.record.finalVersion,
    });
  }
}

/** Read a single version snapshot, or `null` when absent/malformed. */
export async function getVersionRecord(
  store: RecordStore,
  workspaceId: string,
  namespace: string,
  path: WorkspacePath,
  version: number,
): Promise<WorkspaceVersionRecord | null> {
  const value = await store.get(
    versionKey(workspaceId, namespace, path, version),
  );
  return isVersionRecord(value) ? value : null;
}

/** List a file's version snapshots, newest version first. */
export async function listVersionRecords(
  store: RecordStore,
  workspaceId: string,
  namespace: string,
  path: WorkspacePath,
  options: { readonly limit?: number } = {},
): Promise<WorkspaceVersionRecord[]> {
  if (options.limit === 0) return [];
  const prefix = versionPrefix(workspaceId, namespace, path);
  const records: WorkspaceVersionRecord[] = [];
  let cursor: string | undefined;
  do {
    const listed = await store.list(prefix, cursor ? { cursor } : {});
    for (const entry of listed.entries) {
      if (isVersionRecord(entry.value)) records.push(entry.value);
    }
    cursor = listed.cursor;
  } while (cursor);
  records.sort((a, b) => b.version - a.version);
  return options.limit !== undefined
    ? records.slice(0, options.limit)
    : records;
}

/** Delete every version snapshot for a path, along with its out-of-line assets. */
export async function purgeVersions(
  store: RecordStore,
  assets: AssetStore | undefined,
  workspaceId: string,
  namespace: string,
  path: WorkspacePath,
  options: {
    readonly currentAssetUri?: string;
    readonly deleteAsset?: boolean;
  } = {},
): Promise<void> {
  const records = await listVersionRecords(store, workspaceId, namespace, path);
  const deletedAssetUris = new Set<string>();
  const assetStore = options.deleteAsset === false ? undefined : assets;
  for (const record of records) {
    await deleteVersion(
      store,
      assetStore,
      workspaceId,
      namespace,
      path,
      record,
      {
        deletedAssetUris,
      },
    );
  }
  if (
    options.deleteAsset !== false &&
    options.currentAssetUri &&
    assets?.delete &&
    !deletedAssetUris.has(options.currentAssetUri)
  ) {
    await assets.delete({ uri: options.currentAssetUri });
  }
}

/**
 * Drop old snapshots after a successful mutation while retaining an active
 * published version even when it falls outside the numeric history cap.
 */
export async function retainFileVersions(input: {
  readonly store: RecordStore;
  readonly assets?: AssetStore;
  readonly workspaceId: string;
  readonly namespace: string;
  readonly path: WorkspacePath;
  readonly maxVersions: number;
  readonly preserveVersion?: number;
}): Promise<void> {
  const records = await listVersionRecords(
    input.store,
    input.workspaceId,
    input.namespace,
    input.path,
  );
  const newest = new Set(
    records.slice(0, input.maxVersions).map((record) => record.version),
  );
  for (const stale of records) {
    if (newest.has(stale.version) || stale.version === input.preserveVersion) {
      continue;
    }
    await deleteVersion(
      input.store,
      input.assets,
      input.workspaceId,
      input.namespace,
      input.path,
      stale,
    );
  }
}

async function deleteVersion(
  store: RecordStore,
  assets: AssetStore | undefined,
  workspaceId: string,
  namespace: string,
  path: WorkspacePath,
  record: WorkspaceVersionRecord,
  options: { readonly deletedAssetUris?: Set<string> } = {},
): Promise<void> {
  await store.delete(versionKey(workspaceId, namespace, path, record.version));
  const uri = record.snapshot.assetRef?.uri;
  // Each version owns a version-scoped asset, so deleting it never orphans the
  // HEAD or a retained snapshot.
  if (
    record.snapshot.storage === "asset" &&
    uri &&
    assets?.delete &&
    !options.deletedAssetUris?.has(uri)
  ) {
    await assets.delete({ uri });
    options.deletedAssetUris?.add(uri);
  }
}

/** Project a stored snapshot into the public {@link WorkspaceVersion} shape. */
export function recordToVersion(
  record: WorkspaceVersionRecord,
): WorkspaceVersion {
  const snapshot = record.snapshot;
  return {
    version: record.version,
    path: snapshot.path,
    operation: record.operation,
    mimeType: snapshot.mimeType,
    size: snapshot.size,
    storage: snapshot.storage,
    ...(snapshot.preview ? { preview: snapshot.preview } : {}),
    createdAt: record.createdAt,
  };
}

/**
 * Synthesize a single {@link WorkspaceVersion} from a HEAD record.
 *
 * Used for files that have a HEAD but no stored snapshots — those created by
 * `copy`/`rename`, or written before versioning existed — so `history` and
 * read-at-version still answer for the current revision.
 */
export function headToVersion(record: WorkspaceFileRecord): WorkspaceVersion {
  return {
    version: record.headVersion ?? 1,
    path: record.path,
    operation: "write",
    mimeType: record.mimeType,
    size: record.size,
    storage: record.storage,
    ...(record.preview ? { preview: record.preview } : {}),
    createdAt: record.updatedAt,
  };
}

function isVersionRecord(
  value: JsonObject | null,
): value is WorkspaceVersionRecord {
  return (
    value?._cruxWorkspaceVersion === true &&
    value.schema === VERSION_RECORD_SCHEMA &&
    typeof value.version === "number" &&
    typeof value.snapshot === "object" &&
    value.snapshot !== null
  );
}
