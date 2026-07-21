/** Explicit snapshot deletion orchestration. */

import type { WorkspaceSnapshotConfig } from "./config";
import { snapshotBackendError } from "./errors";
import { validateSnapshotRef } from "./ref";
import type { WorkspaceSnapshotHeader } from "./records";
import {
  deleteSnapshotOwnedData,
  deleteSnapshotRecords,
  getSnapshotHeader,
} from "./store";
import { WorkspaceSnapshotError, type WorkspaceSnapshotRef } from "./types";

/** Delete one owned snapshot, resuming an interrupted deleting lifecycle. */
export async function deleteWorkspaceSnapshot(
  config: WorkspaceSnapshotConfig,
  snapshot: WorkspaceSnapshotRef,
): Promise<void> {
  const ref = validateSnapshotRef(snapshot, config.workspaceId);
  try {
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
    if (header === "malformed" || !headerMatchesRef(header, ref)) {
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
    await deleteSnapshotRecords({
      store: config.store,
      ...(config.assets !== undefined ? { assets: config.assets } : {}),
      header,
    });
  } catch (error) {
    throw snapshotBackendError("delete", error, ref.id);
  }
}

function headerMatchesRef(
  header: WorkspaceSnapshotHeader,
  ref: WorkspaceSnapshotRef,
): boolean {
  return (
    header.id === ref.id &&
    header.workspaceId === ref.workspaceId &&
    header.namespace === ref.namespace &&
    header.path === ref.path &&
    header.fileCount === ref.fileCount &&
    header.sizeBytes === ref.sizeBytes &&
    header.createdAt === ref.createdAt
  );
}
