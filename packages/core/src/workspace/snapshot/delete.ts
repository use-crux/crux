/** Explicit snapshot deletion orchestration. */

import { withWorkspaceMutationLock } from "../mutation-coordinator";
import { instrument } from "../observability";
import type { WorkspaceSnapshotConfig } from "./config";
import { snapshotBackendError } from "./errors";
import { snapshotHeaderMatchesRef, validateSnapshotRef } from "./ref";
import { loadCommittedSnapshotMetadata } from "./restore-load";
import { getSnapshotHeader } from "./store";
import { deleteSnapshotOwnedData, deleteSnapshotRecords } from "./store-delete";
import { WorkspaceSnapshotError, type WorkspaceSnapshotRef } from "./types";

/** Delete one owned snapshot, resuming an interrupted deleting lifecycle. */
export async function deleteWorkspaceSnapshot(
  config: WorkspaceSnapshotConfig,
  snapshot: WorkspaceSnapshotRef,
): Promise<void> {
  const ref = validateSnapshotRef(snapshot, config.workspaceId);
  await instrument(
    {
      workspaceId: config.workspaceId,
      operation: "snapshot.delete",
      namespace: ref.namespace,
      path: ref.path,
    },
    async () => {
      try {
        await withWorkspaceMutationLock(config.workspaceId, ref.namespace, () =>
          deleteOwnedSnapshot(config, ref),
        );
      } catch (error) {
        throw snapshotBackendError("delete", error, ref.id);
      }
    },
  );
}

async function deleteOwnedSnapshot(
  config: WorkspaceSnapshotConfig,
  ref: WorkspaceSnapshotRef,
): Promise<void> {
  const header = await getSnapshotHeader(
    config.store,
    ref.workspaceId,
    ref.namespace,
    ref.id,
  );
  if (header === null) {
    await deleteSnapshotOwnedData({
      store: config.store,
      ...(config.assets !== undefined ? { assets: config.assets } : {}),
      snapshot: ref,
    }).catch(() => undefined);
    return;
  }
  if (header === "malformed" || !snapshotHeaderMatchesRef(header, ref)) {
    throw new WorkspaceSnapshotError(
      "corrupt_snapshot",
      "Snapshot header does not match its reference.",
      { snapshotId: ref.id },
    );
  }
  if (header.state === "creating") {
    throw new WorkspaceSnapshotError(
      "corrupt_snapshot",
      "Snapshot reference points to an incomplete snapshot.",
      { snapshotId: ref.id },
    );
  }
  if (header.state === "committed") {
    await loadCommittedSnapshotMetadata(config, ref);
  }
  await deleteSnapshotRecords({
    store: config.store,
    ...(config.assets !== undefined ? { assets: config.assets } : {}),
    header,
  });
}
