/**
 * Exact metadata and asset rollback for Workspace mutation batches.
 *
 * @module
 */

import type { AssetStore, JsonObject, RecordStore } from "../storage";
import { workspaceSetOptions } from "./limits";
import { fileKey, getRecord } from "./store";
import {
  listVersionRecords,
  purgeVersions,
  retainFileVersions,
  versionKey,
} from "./version-store";
import type {
  WorkspaceVersioning,
  WorkspaceVersionRecord,
} from "./version-types";
import type {
  WorkspaceFileRecord,
  WorkspacePath,
  WorkspaceRetention,
} from "./types";

/** Storage dependencies needed to capture and restore a mutation batch. */
export interface WorkspaceRollbackConfig {
  readonly workspaceId: string;
  readonly store: RecordStore;
  readonly assets?: AssetStore;
  readonly retention?: WorkspaceRetention;
  readonly versioning?: WorkspaceVersioning;
}

/** Exact pre-commit state for one touched path. */
export interface WorkspaceMutationPreState {
  readonly head: WorkspaceFileRecord | null;
  readonly versions: readonly WorkspaceVersionRecord[];
  readonly assetUris: ReadonlySet<string>;
}

/** Capture the live state needed to restore one path without a public write. */
export async function captureMutationPreState(
  config: WorkspaceRollbackConfig,
  namespace: string,
  path: WorkspacePath,
): Promise<WorkspaceMutationPreState> {
  const head = await getRecord(
    config.store,
    config.workspaceId,
    namespace,
    path,
  );
  const versions = await listVersionRecords(
    config.store,
    config.workspaceId,
    namespace,
    path,
  );
  return {
    head,
    versions,
    assetUris: referencedAssetUris(head, versions),
  };
}

/**
 * Best-effort restore every touched path and return any rollback failures.
 *
 * All paths are attempted so a secondary cleanup failure cannot prevent other
 * pre-state from being restored or replace the original mutation error.
 */
export async function rollbackMutationBatch(
  config: WorkspaceRollbackConfig,
  namespace: string,
  before: ReadonlyMap<WorkspacePath, WorkspaceMutationPreState>,
): Promise<readonly unknown[]> {
  const failures: unknown[] = [];
  for (const [path, state] of before) {
    await rollbackPath(config, namespace, path, state).catch((error) => {
      failures.push(error);
    });
  }
  return failures;
}

/** Delete assets owned by a successfully deleted path's captured state. */
async function deletePreStateAssets(
  assets: AssetStore | undefined,
  state: WorkspaceMutationPreState,
  deletedUris: Set<string>,
): Promise<void> {
  if (!assets) return;
  for (const uri of state.assetUris) {
    if (deletedUris.has(uri)) continue;
    await assets.delete({ uri });
    deletedUris.add(uri);
  }
}

/** Remove one path's metadata without destroying rollback-owned assets. */
export async function deleteMutationPathMetadata(
  config: WorkspaceRollbackConfig,
  namespace: string,
  path: WorkspacePath,
): Promise<void> {
  await config.store.delete(fileKey(config.workspaceId, namespace, path));
  await purgeVersions(
    config.store,
    undefined,
    config.workspaceId,
    namespace,
    path,
    { deleteAsset: false },
  );
}

/** Run destructive retention and deleted-path asset cleanup after commit. */
export async function cleanupCommittedMutationBatch(
  config: WorkspaceRollbackConfig,
  namespace: string,
  deletedPaths: readonly WorkspacePath[],
  before: ReadonlyMap<WorkspacePath, WorkspaceMutationPreState>,
  finalHeads: ReadonlyMap<WorkspacePath, WorkspaceFileRecord>,
): Promise<void> {
  const deletedUris = new Set<string>();
  for (const path of deletedPaths) {
    const state = before.get(path);
    if (!state) continue;
    await deletePreStateAssets(config.assets, state, deletedUris).catch(
      (error) => logMaintenanceFailure("post-commit asset cleanup", error),
    );
  }

  const maxVersions = config.versioning?.maxVersions;
  if (maxVersions === undefined || maxVersions <= 0) return;
  for (const [path, head] of finalHeads) {
    await retainFileVersions({
      store: config.store,
      assets: config.assets,
      workspaceId: config.workspaceId,
      namespace,
      path,
      maxVersions,
      preserveVersion: head.finalVersion,
    }).catch((error) => logMaintenanceFailure("post-commit retention", error));
  }
}

async function rollbackPath(
  config: WorkspaceRollbackConfig,
  namespace: string,
  path: WorkspacePath,
  state: WorkspaceMutationPreState,
): Promise<void> {
  const currentHead = await getRecord(
    config.store,
    config.workspaceId,
    namespace,
    path,
  );
  const currentVersions = await listVersionRecords(
    config.store,
    config.workspaceId,
    namespace,
    path,
  );
  const introducedUris = difference(
    referencedAssetUris(currentHead, currentVersions),
    state.assetUris,
  );
  const failures: unknown[] = [];
  const attempt = async (run: () => Promise<void>): Promise<void> => {
    await run().catch((error) => failures.push(error));
  };

  for (const version of currentVersions) {
    await attempt(() =>
      config.store.delete(
        versionKey(config.workspaceId, namespace, path, version.version),
      ),
    );
  }

  const setOptions = workspaceSetOptions(config.store, config.retention);
  await attempt(() =>
    state.head
      ? config.store.put(
          fileKey(config.workspaceId, namespace, path),
          state.head as unknown as JsonObject,
          setOptions,
        )
      : config.store.delete(fileKey(config.workspaceId, namespace, path)),
  );
  for (const version of state.versions) {
    await attempt(() =>
      config.store.put(
        versionKey(config.workspaceId, namespace, path, version.version),
        version as unknown as JsonObject,
        setOptions,
      ),
    );
  }
  const assets = config.assets;
  if (assets) {
    for (const uri of introducedUris) {
      await attempt(() => assets.delete({ uri }));
    }
  }
  if (failures.length > 0) throw new AggregateError(failures);
}

function referencedAssetUris(
  head: WorkspaceFileRecord | null,
  versions: readonly WorkspaceVersionRecord[],
): ReadonlySet<string> {
  const uris = new Set<string>();
  if (head?.storage === "asset" && head.assetRef) uris.add(head.assetRef.uri);
  for (const version of versions) {
    const snapshot = version.snapshot;
    if (snapshot.storage === "asset" && snapshot.assetRef) {
      uris.add(snapshot.assetRef.uri);
    }
  }
  return uris;
}

function difference(
  values: ReadonlySet<string>,
  excluded: ReadonlySet<string>,
): ReadonlySet<string> {
  return new Set([...values].filter((value) => !excluded.has(value)));
}

function logMaintenanceFailure(phase: string, error: unknown): void {
  console.warn(
    `[crux] workspace mutation batch ${phase} failed; continuing.`,
    error,
  );
}
