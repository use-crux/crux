/**
 * Version-history persistence for workspace files.
 *
 * Snapshots live under a dedicated `version:` key prefix so the live `file:`
 * HEAD record, directory listings, and quota scans never see them. Each
 * content mutation appends one {@link WorkspaceVersionRecord}; retention
 * ({@link WorkspaceVersioning.maxVersions}) and deletion GC the oldest
 * snapshots together with their out-of-line blobs.
 *
 * @module
 */

import type { DataStore, JsonObject, SetOptions } from "../store/types";
import { emitWorkspaceVersion } from "./observability";
import type {
  WorkspaceBlobStore,
  WorkspaceFileRecord,
  WorkspacePath,
} from "./types";
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

/** The data-store key for a single file version snapshot. */
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
 * persist the HEAD record (with its version-scoped blob URI) first.
 */
export async function recordFileVersion(input: {
  readonly store: DataStore;
  readonly blobs?: WorkspaceBlobStore;
  readonly workspaceId: string;
  readonly namespace: string;
  readonly path: WorkspacePath;
  readonly record: WorkspaceFileRecord;
  readonly operation: WorkspaceVersionOperation;
  readonly versioning?: WorkspaceVersioning;
  readonly setOptions?: SetOptions;
}): Promise<void> {
  const version = input.record.headVersion ?? 1;
  const value: WorkspaceVersionRecord = {
    _cruxWorkspaceVersion: true,
    schema: VERSION_RECORD_SCHEMA,
    version,
    operation: input.operation,
    createdAt: input.record.updatedAt,
    snapshot: input.record,
  };
  await input.store.set(
    versionKey(input.workspaceId, input.namespace, input.path, version),
    value,
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
  if (maxVersions !== undefined && maxVersions > 0) {
    await gcVersions({
      store: input.store,
      blobs: input.blobs,
      workspaceId: input.workspaceId,
      namespace: input.namespace,
      path: input.path,
      maxVersions,
    });
  }
}

/** Read a single version snapshot, or `null` when absent/malformed. */
export async function getVersionRecord(
  store: DataStore,
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
  store: DataStore,
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

/** Delete every version snapshot for a path, along with its out-of-line blobs. */
export async function purgeVersions(
  store: DataStore,
  blobs: WorkspaceBlobStore | undefined,
  workspaceId: string,
  namespace: string,
  path: WorkspacePath,
  options: {
    readonly currentBlobUri?: string;
    readonly deleteBlob?: boolean;
  } = {},
): Promise<void> {
  const records = await listVersionRecords(store, workspaceId, namespace, path);
  const deletedBlobUris = new Set<string>();
  const blobStore = options.deleteBlob === false ? undefined : blobs;
  for (const record of records) {
    await deleteVersion(
      store,
      blobStore,
      workspaceId,
      namespace,
      path,
      record,
      {
        deletedBlobUris,
      },
    );
  }
  if (
    options.deleteBlob !== false &&
    options.currentBlobUri &&
    blobs?.delete &&
    !deletedBlobUris.has(options.currentBlobUri)
  ) {
    await blobs.delete(options.currentBlobUri);
  }
}

/** Drop the oldest snapshots (and their blobs) beyond `maxVersions`. */
async function gcVersions(input: {
  readonly store: DataStore;
  readonly blobs?: WorkspaceBlobStore;
  readonly workspaceId: string;
  readonly namespace: string;
  readonly path: WorkspacePath;
  readonly maxVersions: number;
}): Promise<void> {
  const records = await listVersionRecords(
    input.store,
    input.workspaceId,
    input.namespace,
    input.path,
  );
  for (const stale of records.slice(input.maxVersions)) {
    await deleteVersion(
      input.store,
      input.blobs,
      input.workspaceId,
      input.namespace,
      input.path,
      stale,
    );
  }
}

async function deleteVersion(
  store: DataStore,
  blobs: WorkspaceBlobStore | undefined,
  workspaceId: string,
  namespace: string,
  path: WorkspacePath,
  record: WorkspaceVersionRecord,
  options: { readonly deletedBlobUris?: Set<string> } = {},
): Promise<void> {
  await store.delete(versionKey(workspaceId, namespace, path, record.version));
  const uri = record.snapshot.uri;
  // Each version owns a version-scoped blob, so deleting it never orphans the
  // HEAD or a retained snapshot.
  if (
    record.snapshot.storage === "blob" &&
    uri &&
    blobs?.delete &&
    !options.deletedBlobUris?.has(uri)
  ) {
    await blobs.delete(uri);
    options.deletedBlobUris?.add(uri);
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
