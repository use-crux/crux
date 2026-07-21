/**
 * Construction and orchestration for the public Workspace snapshot facet.
 *
 * @module
 */

import type { WorkspaceSnapshotOperations } from "./types";
import type { WorkspaceSnapshotConfig } from "./config";
import { createWorkspaceSnapshot } from "./create";
import { deleteWorkspaceSnapshot } from "./delete";
import { listWorkspaceSnapshots } from "./list";
import { restoreWorkspaceSnapshot } from "./restore";

/** Create the frozen snapshot operations bound to one Workspace. */
export function createWorkspaceSnapshotOperations(
  config: WorkspaceSnapshotConfig,
): WorkspaceSnapshotOperations {
  const operations = {
    create: (options) => createWorkspaceSnapshot(config, options),
    list: (options) => listWorkspaceSnapshots(config, options),
    restore: (snapshot) => restoreWorkspaceSnapshot(config, snapshot),
    delete: (snapshot) => deleteWorkspaceSnapshot(config, snapshot),
  } satisfies WorkspaceSnapshotOperations;

  return Object.freeze(operations);
}
