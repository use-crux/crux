/** RecordStore and AssetStore deletion lifecycle for Workspace snapshots. */

import { StorageError, type AssetStore, type RecordStore } from "../../storage";
import { isDescendant } from "./selection";
import { snapshotEntryAssetOwnershipIsValid } from "./asset-ownership";
import {
  snapshotEntryAssetRefs,
  type WorkspaceSnapshotHeader,
} from "./records";
import { isWorkspaceSnapshotEntry } from "./record-validation";
import {
  listSnapshotEntryRecords,
  snapshotEntryKey,
  snapshotHeaderKey,
} from "./store";
import { WorkspaceSnapshotError } from "./types";

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

/** Clean residual entry records when a failed capture did not commit. */
export async function deleteSnapshotEntries(
  store: RecordStore,
  snapshot: Pick<WorkspaceSnapshotHeader, "workspaceId" | "namespace" | "id">,
): Promise<void> {
  const records = await listSnapshotEntryRecords(
    store,
    snapshot.workspaceId,
    snapshot.namespace,
    snapshot.id,
  );
  for (const record of records) await store.delete(record.key);
}

/** Delete proven snapshot-owned assets first, then their entry records. */
export async function deleteSnapshotOwnedData(input: {
  readonly store: RecordStore;
  readonly assets?: AssetStore;
  readonly snapshot: {
    readonly workspaceId: string;
    readonly namespace: string;
    readonly id: string;
    readonly path: string;
  };
}): Promise<void> {
  const records = await listSnapshotEntryRecords(
    input.store,
    input.snapshot.workspaceId,
    input.snapshot.namespace,
    input.snapshot.id,
  );
  const paths = new Set<string>();
  for (const record of records) {
    const entry = record.value;
    if (
      !isWorkspaceSnapshotEntry(entry) ||
      entry.snapshotId !== input.snapshot.id ||
      record.key !==
        snapshotEntryKey(
          input.snapshot.workspaceId,
          input.snapshot.namespace,
          input.snapshot.id,
          entry.path,
        ) ||
      paths.has(entry.path) ||
      !(
        entry.path === input.snapshot.path ||
        isDescendant(entry.path, input.snapshot.path)
      ) ||
      !snapshotEntryAssetOwnershipIsValid(entry)
    ) {
      throw new WorkspaceSnapshotError(
        "corrupt_snapshot",
        "Snapshot contains a malformed materialized entry.",
        { snapshotId: input.snapshot.id },
      );
    }
    paths.add(entry.path);
    const refs = snapshotEntryAssetRefs(entry);
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
