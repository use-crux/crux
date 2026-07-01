/**
 * Rollback helpers for workspace transactions.
 *
 * Rollback restores both live file records and version records for touched
 * paths. Blob cleanup is careful to delete only blobs introduced by the failed
 * commit while preserving blobs referenced by the pre-transaction state.
 *
 * @module
 */

import type { JsonObject } from "../storage";
import { workspaceSetOptions } from "./limits";
import { normalizePath } from "./path";
import { fileKey, listFileRecords } from "./store";
import { listVersionRecords, purgeVersions, versionKey } from "./version-store";
import type { WorkspaceVersionRecord } from "./version-types";
import type { WorkspaceFileRecord } from "./types";
import type { WorkspaceTransactionConfig } from "./transaction";

/** Pre-commit state for one touched path. */
export interface TransactionRollbackState {
  readonly head: WorkspaceFileRecord | null;
  readonly versions: readonly WorkspaceVersionRecord[];
}

/** Capture the live state needed to roll one path back after a commit failure. */
export async function captureRollbackState(
  config: WorkspaceTransactionConfig,
  namespace: string,
  path: string,
): Promise<TransactionRollbackState> {
  const normalized = normalizePath(path);
  return {
    head: await currentRecord(config, namespace, normalized),
    versions: await listVersionRecords(
      config.store,
      config.workspaceId,
      namespace,
      normalized,
    ),
  };
}

/** Read the current live file record for a path, or `null` when absent. */
export async function currentRecord(
  config: WorkspaceTransactionConfig,
  namespace: string,
  path: string,
): Promise<WorkspaceFileRecord | null> {
  return (
    await listFileRecords(config.store, config.workspaceId, namespace, {
      filter: { path: normalizePath(path) },
    })
  )[0] ?? null;
}

/** Restore all touched paths to their captured pre-commit state. */
export async function rollbackTouchedPaths(
  config: WorkspaceTransactionConfig,
  namespace: string,
  before: ReadonlyMap<string, TransactionRollbackState>,
): Promise<void> {
  const setOptions = workspaceSetOptions(config.store, config.retention);
  for (const [path, state] of before) {
    const normalized = normalizePath(path);
    const deletedBlobUris = new Set<string>();
    await deleteNewVersionBlobs(config, namespace, normalized, state, deletedBlobUris);
    await deleteNewHeadBlob(config, namespace, normalized, state, deletedBlobUris);
    await purgeVersions(
      config.store,
      undefined,
      config.workspaceId,
      namespace,
      normalized,
    );
    if (state.head) {
      await config.store.put(
        fileKey(config.workspaceId, namespace, normalized),
        state.head as unknown as JsonObject,
        setOptions,
      );
    } else {
      await config.store.delete(fileKey(config.workspaceId, namespace, normalized));
    }
    for (const version of state.versions) {
      await config.store.put(
        versionKey(config.workspaceId, namespace, normalized, version.version),
        version as unknown as JsonObject,
        setOptions,
      );
    }
  }
}

/** Delete blobs referenced by captured pre-commit state after a successful delete. */
export async function deleteCapturedBlobs(
  config: WorkspaceTransactionConfig,
  state: TransactionRollbackState,
  deletedBlobUris: Set<string>,
): Promise<void> {
  if (!config.blobs) return;
  for (const uri of retainedBlobUris(state)) {
    if (deletedBlobUris.has(uri)) continue;
    await config.blobs.delete(uri);
    deletedBlobUris.add(uri);
  }
}

async function deleteNewVersionBlobs(
  config: WorkspaceTransactionConfig,
  namespace: string,
  path: string,
  state: TransactionRollbackState,
  deletedBlobUris: Set<string>,
): Promise<void> {
  if (!config.blobs) return;
  const beforeVersions = new Set(state.versions.map((version) => version.version));
  const currentVersions = await listVersionRecords(config.store, config.workspaceId, namespace, normalizePath(path));
  for (const version of currentVersions) {
    const uri = version.snapshot.uri;
    if (!beforeVersions.has(version.version) && version.snapshot.storage === "blob" && uri && !deletedBlobUris.has(uri)) {
      await config.blobs.delete(uri);
      deletedBlobUris.add(uri);
    }
  }
}

async function deleteNewHeadBlob(
  config: WorkspaceTransactionConfig,
  namespace: string,
  path: string,
  state: TransactionRollbackState,
  deletedBlobUris: Set<string>,
): Promise<void> {
  if (!config.blobs) return;
  const current = await currentRecord(config, namespace, path);
  const uri = current?.uri;
  if (
    current?.storage === "blob" &&
    uri &&
    uri !== state.head?.uri &&
    !retainedBlobUris(state).has(uri) &&
    !deletedBlobUris.has(uri)
  ) {
    await config.blobs.delete(uri);
    deletedBlobUris.add(uri);
  }
}

function retainedBlobUris(state: TransactionRollbackState): ReadonlySet<string> {
  const uris = new Set<string>();
  if (state.head?.uri) uris.add(state.head.uri);
  for (const version of state.versions) {
    if (version.snapshot.uri) uris.add(version.snapshot.uri);
  }
  return uris;
}
