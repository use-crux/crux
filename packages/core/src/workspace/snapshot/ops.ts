/**
 * Construction and orchestration for the public Workspace snapshot facet.
 *
 * @module
 */

import {
  WorkspaceSnapshotError,
  type WorkspaceSnapshotOperations,
} from "./types";
import type { WorkspaceSnapshotConfig } from "./config";
import { createWorkspaceSnapshot } from "./create";
import { deleteWorkspaceSnapshot } from "./delete";
import { listWorkspaceSnapshots } from "./list";

/** Create the frozen snapshot operations bound to one Workspace. */
export function createWorkspaceSnapshotOperations(
  config: WorkspaceSnapshotConfig,
): WorkspaceSnapshotOperations {
  function unavailable(operation: string, snapshotId?: string): never {
    throw new WorkspaceSnapshotError(
      "backend_error",
      `Workspace snapshot ${operation} is not implemented for Workspace "${config.workspaceId}".`,
      snapshotId === undefined ? {} : { snapshotId },
    );
  }

  const operations = {
    create: (options) => createWorkspaceSnapshot(config, options),
    list: (options) => listWorkspaceSnapshots(config, options),
    restore: async (snapshot) => unavailable("restore", snapshot.id),
    delete: (snapshot) => deleteWorkspaceSnapshot(config, snapshot),
  } satisfies WorkspaceSnapshotOperations;

  return Object.freeze(operations);
}
