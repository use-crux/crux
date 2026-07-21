/**
 * Atomic workspace HEAD and version persistence.
 *
 * Asset-backed records write media before metadata. This module owns the
 * follow-up metadata boundary: if HEAD or version persistence fails, it restores
 * the previous metadata state and best-effort deletes only assets introduced by
 * the failed record.
 *
 * @module
 */

import type {
  AssetRef,
  AssetStore,
  JsonObject,
  RecordStore,
  RecordWriteOptions,
} from "../storage";
import { fileKey } from "./store";
import type { WorkspaceFileRecord, WorkspacePath } from "./types";
import {
  listVersionRecords,
  recordFileVersion,
  versionKey,
} from "./version-store";
import type {
  WorkspaceVersionEvent,
  WorkspaceVersionOperation,
  WorkspaceVersionRecord,
  WorkspaceVersioning,
} from "./version-types";

/** Options for persisting one workspace file record and its version snapshot. */
export interface CommitVersionedWorkspaceRecordInput {
  readonly store: RecordStore;
  readonly assets?: AssetStore;
  readonly workspaceId: string;
  readonly namespace: string;
  readonly path: WorkspacePath;
  readonly record: WorkspaceFileRecord;
  readonly previous: WorkspaceFileRecord | null;
  readonly operation: WorkspaceVersionOperation;
  readonly versioning?: WorkspaceVersioning;
  readonly setOptions?: RecordWriteOptions;
  /** Defer version retention until a surrounding mutation batch commits. */
  readonly deferRetention?: boolean;
  /** Buffer this marker when a surrounding mutation batch owns the commit. */
  readonly emitVersion?: (event: WorkspaceVersionEvent) => void;
  /**
   * Start destination history over at this record after a successful copy/move.
   * The previous HEAD and version-owned assets are cleaned up after the new
   * version is safely durable.
   */
  readonly resetHistory?: boolean;
}

/**
 * Persist a live workspace HEAD record and matching version snapshot atomically.
 *
 * The helper does not write assets itself. If metadata persistence fails after
 * a caller-created asset exists, the original error is rethrown while cleanup
 * and metadata restoration stay best-effort.
 */
export async function commitVersionedWorkspaceRecord(
  input: CommitVersionedWorkspaceRecordInput,
): Promise<void> {
  const previousVersions = shouldCaptureVersions(input)
    ? await listVersionRecords(
        input.store,
        input.workspaceId,
        input.namespace,
        input.path,
      )
    : undefined;
  try {
    await input.store.put(
      fileKey(input.workspaceId, input.namespace, input.path),
      input.record as unknown as JsonObject,
      input.setOptions,
    );
    await recordFileVersion({
      store: input.store,
      assets: input.assets,
      workspaceId: input.workspaceId,
      namespace: input.namespace,
      path: input.path,
      record: input.record,
      operation: input.operation,
      versioning: input.versioning,
      setOptions: input.setOptions,
      deferRetention: input.deferRetention,
      emitVersion: input.emitVersion,
    });
  } catch (error) {
    await restoreVersionedState(input, previousVersions).catch(() => undefined);
    await deleteNewRecordAsset(
      input,
      retainedAssetUris(input.previous, previousVersions ?? []),
    );
    throw error;
  }

  if (input.resetHistory) {
    await deleteReplacedHistory(input, previousVersions ?? []);
  }
}

async function restoreVersionedState(
  input: CommitVersionedWorkspaceRecordInput,
  previousVersions: readonly WorkspaceVersionRecord[] | undefined,
): Promise<void> {
  if (input.previous) {
    await input.store.put(
      fileKey(input.workspaceId, input.namespace, input.path),
      input.previous as unknown as JsonObject,
      input.setOptions,
    );
  } else {
    await input.store.delete(
      fileKey(input.workspaceId, input.namespace, input.path),
    );
  }
  if (previousVersions) {
    const currentVersions = await listVersionRecords(
      input.store,
      input.workspaceId,
      input.namespace,
      input.path,
    );
    const previousByVersion = new Map(
      previousVersions.map((version) => [version.version, version] as const),
    );
    const currentByVersion = new Map(
      currentVersions.map((version) => [version.version, version] as const),
    );
    for (const current of currentVersions) {
      const previous = previousByVersion.get(current.version);
      if (!previous) {
        await input.store.delete(
          versionKey(
            input.workspaceId,
            input.namespace,
            input.path,
            current.version,
          ),
        );
      } else if (!sameVersionRecord(current, previous)) {
        await restoreVersionRecord(input, previous);
      }
    }
    for (const version of previousVersions) {
      if (!currentByVersion.has(version.version)) {
        await restoreVersionRecord(input, version);
      }
    }
  }
}

async function restoreVersionRecord(
  input: CommitVersionedWorkspaceRecordInput,
  version: WorkspaceVersionRecord,
): Promise<void> {
  await input.store.put(
    versionKey(input.workspaceId, input.namespace, input.path, version.version),
    version as unknown as JsonObject,
    input.setOptions,
  );
}

function sameVersionRecord(
  left: WorkspaceVersionRecord,
  right: WorkspaceVersionRecord,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function deleteNewRecordAsset(
  input: CommitVersionedWorkspaceRecordInput,
  retainedUris: ReadonlySet<string>,
): Promise<void> {
  const ref = assetRef(input.record);
  if (!ref || retainedUris.has(ref.uri)) return;
  await bestEffortDelete(input.assets, ref);
}

async function deleteReplacedHistory(
  input: CommitVersionedWorkspaceRecordInput,
  previousVersions: readonly WorkspaceVersionRecord[],
): Promise<void> {
  const deleted = new Set<string>();
  const retained = new Set<string>();
  const currentRef = assetRef(input.record);
  if (currentRef) retained.add(currentRef.uri);

  for (const version of previousVersions) {
    if (version.version !== (input.record.headVersion ?? 1)) {
      await input.store
        .delete(
          versionKey(
            input.workspaceId,
            input.namespace,
            input.path,
            version.version,
          ),
        )
        .catch(() => undefined);
    }
    await deleteAssetUri(input.assets, version.snapshot.assetRef?.uri, {
      deleted,
      retained,
    });
  }
  await deleteAssetUri(input.assets, input.previous?.assetRef?.uri, {
    deleted,
    retained,
  });
}

async function deleteAssetUri(
  assets: AssetStore | undefined,
  uri: string | undefined,
  state: {
    readonly deleted: Set<string>;
    readonly retained: ReadonlySet<string>;
  },
): Promise<void> {
  if (!uri || state.retained.has(uri) || state.deleted.has(uri)) return;
  await bestEffortDelete(assets, { uri });
  state.deleted.add(uri);
}

async function bestEffortDelete(
  assets: AssetStore | undefined,
  ref: AssetRef,
): Promise<void> {
  if (!assets) return;
  await assets.delete(ref).catch(() => undefined);
}

function retainedAssetUris(
  previous: WorkspaceFileRecord | null,
  previousVersions: readonly WorkspaceVersionRecord[],
): ReadonlySet<string> {
  const retained = new Set<string>();
  const headRef = assetRef(previous);
  if (headRef) retained.add(headRef.uri);
  for (const version of previousVersions) {
    const ref = assetRef(version.snapshot);
    if (ref) retained.add(ref.uri);
  }
  return retained;
}

function assetRef(
  record: Pick<WorkspaceFileRecord, "assetRef" | "storage"> | null | undefined,
): AssetRef | undefined {
  return record?.storage === "asset" ? record.assetRef : undefined;
}

function shouldCaptureVersions(
  input: CommitVersionedWorkspaceRecordInput,
): boolean {
  return input.resetHistory === true || assetRef(input.record) !== undefined;
}
