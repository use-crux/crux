import type { WorkspaceSnapshotErrorCode } from "@/types";

export const workspaceSnapshotOperations = [
  "snapshot.create",
  "snapshot.list",
  "snapshot.restore",
  "snapshot.delete",
] as const;

/** Workspace snapshot operations understood by the Devtools presentation layer. */
export type WorkspaceSnapshotOperation =
  (typeof workspaceSnapshotOperations)[number];

/** Mutation boundary represented by an authored Workspace snapshot operation. */
export type WorkspaceSnapshotEffect =
  | "snapshot-access"
  | "live-tree-mutation"
  | "snapshot-storage-mutation";

/** Narrows an untrusted operation value to the closed snapshot operation set. */
export function workspaceSnapshotOperation(
  value: unknown,
): WorkspaceSnapshotOperation | undefined {
  return typeof value === "string" &&
    workspaceSnapshotOperations.includes(value as WorkspaceSnapshotOperation)
    ? (value as WorkspaceSnapshotOperation)
    : undefined;
}

/** Narrows an untrusted value to a privacy-safe public snapshot error code. */
export function workspaceSnapshotErrorCode(
  value: unknown,
): WorkspaceSnapshotErrorCode | undefined {
  switch (value) {
    case "not_found":
    case "invalid_reference":
    case "invalid_cursor":
    case "unsupported_mount":
    case "corrupt_snapshot":
    case "backend_error":
      return value;
    default:
      return undefined;
  }
}

/** Projects an untrusted aggregate to a finite, non-negative integer count. */
export function workspaceSnapshotCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : 0;
}

/** Projects an optional untrusted aggregate without fabricating a count. */
export function optionalWorkspaceSnapshotCount(
  value: unknown,
): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.trunc(value)
    : undefined;
}
