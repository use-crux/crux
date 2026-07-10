/**
 * Rollback helpers for workspace transactions.
 *
 * Rollback restores both live file records and version records for touched
 * paths. Asset cleanup is careful to delete only assets introduced by the failed
 * commit while preserving assets referenced by the pre-transaction state.
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
    (
      await listFileRecords(config.store, config.workspaceId, namespace, {
        filter: { path: normalizePath(path) },
      })
    )[0] ?? null
  );
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
    const deletedAssetUris = new Set<string>();
    await deleteNewVersionAssets(
      config,
      namespace,
      normalized,
      state,
      deletedAssetUris,
    );
    await deleteNewHeadAsset(
      config,
      namespace,
      normalized,
      state,
      deletedAssetUris,
    );
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
      await config.store.delete(
        fileKey(config.workspaceId, namespace, normalized),
      );
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

/** Delete assets referenced by captured pre-commit state after a successful delete. */
export async function deleteCapturedAssets(
  config: WorkspaceTransactionConfig,
  state: TransactionRollbackState,
  deletedAssetUris: Set<string>,
): Promise<void> {
  if (!config.assets) return;
  for (const uri of retainedAssetUris(state)) {
    if (deletedAssetUris.has(uri)) continue;
    await config.assets.delete({ uri });
    deletedAssetUris.add(uri);
  }
}

async function deleteNewVersionAssets(
  config: WorkspaceTransactionConfig,
  namespace: string,
  path: string,
  state: TransactionRollbackState,
  deletedAssetUris: Set<string>,
): Promise<void> {
  if (!config.assets) return;
  const beforeVersions = new Set(
    state.versions.map((version) => version.version),
  );
  const currentVersions = await listVersionRecords(
    config.store,
    config.workspaceId,
    namespace,
    normalizePath(path),
  );
  for (const version of currentVersions) {
    const uri = version.snapshot.assetRef?.uri;
    if (
      !beforeVersions.has(version.version) &&
      version.snapshot.storage === "asset" &&
      uri &&
      !deletedAssetUris.has(uri)
    ) {
      await config.assets.delete({ uri });
      deletedAssetUris.add(uri);
    }
  }
}

async function deleteNewHeadAsset(
  config: WorkspaceTransactionConfig,
  namespace: string,
  path: string,
  state: TransactionRollbackState,
  deletedAssetUris: Set<string>,
): Promise<void> {
  if (!config.assets) return;
  const current = await currentRecord(config, namespace, path);
  const uri = current?.assetRef?.uri;
  if (
    current?.storage === "asset" &&
    uri &&
    uri !== state.head?.assetRef?.uri &&
    !retainedAssetUris(state).has(uri) &&
    !deletedAssetUris.has(uri)
  ) {
    await config.assets.delete({ uri });
    deletedAssetUris.add(uri);
  }
}

function retainedAssetUris(
  state: TransactionRollbackState,
): ReadonlySet<string> {
  const uris = new Set<string>();
  if (state.head?.assetRef?.uri) uris.add(state.head.assetRef.uri);
  for (const version of state.versions) {
    if (version.snapshot.assetRef?.uri) uris.add(version.snapshot.assetRef.uri);
  }
  return uris;
}
