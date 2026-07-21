/**
 * Snapshot path selection and source-mount boundary checks.
 *
 * @module
 */

import type { WorkspaceFileRecord, WorkspacePath } from "../types";
import type { NormalizedMount } from "../types";
import { hasWorkspaceMountSource } from "../virtual-source";
import { WorkspaceSnapshotError } from "./types";

/** Reject selections outside local mounts or intersecting source-backed mounts. */
export function assertSnapshotSelectionSupported(
  path: WorkspacePath,
  mounts: readonly NormalizedMount[],
  snapshotId?: string,
): void {
  const overlapping = mounts.filter((mount) => pathsOverlap(path, mount.path));
  const sourceMount = overlapping.find(hasWorkspaceMountSource);
  if (sourceMount) {
    throw new WorkspaceSnapshotError(
      "unsupported_mount",
      `Workspace snapshot selection intersects source-backed mount "${sourceMount.path}".`,
      { ...(snapshotId !== undefined ? { snapshotId } : {}) },
    );
  }
  if (overlapping.length === 0) {
    throw new Error(
      `workspace path "${path}" is outside configured workspace mounts.`,
    );
  }
}

/** Return selected records in normalized lexical path order. */
export function selectSnapshotRecords(
  records: readonly WorkspaceFileRecord[],
  path: WorkspacePath,
): readonly WorkspaceFileRecord[] {
  return records
    .filter((record) => record.path === path || isDescendant(record.path, path))
    .sort((left, right) => compareText(left.path, right.path));
}

function pathsOverlap(left: WorkspacePath, right: WorkspacePath): boolean {
  return (
    left === right || isDescendant(left, right) || isDescendant(right, left)
  );
}

/** Return whether a path is strictly below an ancestor path. */
export function isDescendant(path: string, ancestor: string): boolean {
  return ancestor === "/"
    ? path.startsWith("/")
    : path.startsWith(`${ancestor}/`);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
