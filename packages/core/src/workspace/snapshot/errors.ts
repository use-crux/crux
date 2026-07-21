/** Private error normalization for snapshot storage boundaries. */

import { WorkspaceSnapshotError } from "./types";

export function snapshotBackendError(
  operation: string,
  cause: unknown,
  snapshotId?: string,
): WorkspaceSnapshotError {
  if (cause instanceof WorkspaceSnapshotError) return cause;
  return new WorkspaceSnapshotError(
    "backend_error",
    `Workspace snapshot ${operation} failed.`,
    { ...(snapshotId !== undefined ? { snapshotId } : {}), cause },
  );
}
