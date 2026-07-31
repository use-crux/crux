import type { WorkspaceSnapshotErrorCode } from "@/types";

export const workspaceSnapshotOperations = [
  "snapshot.create",
  "snapshot.list",
  "snapshot.restore",
  "snapshot.delete",
] as const;

/** Workspace snapshot operations understood by Devtools read models. */
export type WorkspaceSnapshotOperation =
  (typeof workspaceSnapshotOperations)[number];

/** Mutation boundary represented by an authored Workspace snapshot operation. */
export type WorkspaceSnapshotEffect =
  | "snapshot-access"
  | "live-tree-mutation"
  | "snapshot-storage-mutation";

/** Privacy-safe presentation shared by snapshot event and run-detail views. */
export type WorkspaceSnapshotPresentation =
  | {
      readonly status: "success";
      readonly operation: "snapshot.create";
      readonly fileCount: number;
      readonly sizeBytes: number;
    }
  | {
      readonly status: "success";
      readonly operation: "snapshot.list";
      readonly snapshotCount: number;
    }
  | {
      readonly status: "success";
      readonly operation: "snapshot.restore";
      readonly restoredFiles: number;
      readonly deletedFiles: number;
      readonly unchangedFiles: number;
    }
  | {
      readonly status: "success";
      readonly operation: "snapshot.delete";
    }
  | {
      readonly status: "failure";
      readonly operation: WorkspaceSnapshotOperation;
      readonly errorCode?: WorkspaceSnapshotErrorCode;
    };
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

/** Projects snapshot event data into the closed shared presentation contract. */
export function projectWorkspaceSnapshotPresentation(
  data: Readonly<Record<string, unknown>>,
): WorkspaceSnapshotPresentation | undefined {
  const operation = workspaceSnapshotOperation(data.operation);
  if (!operation) return undefined;
  if (data.status === "error" || data.status === "failed") {
    const errorCode = workspaceSnapshotErrorCode(data.errorCode);
    return {
      status: "failure",
      operation,
      ...(errorCode ? { errorCode } : {}),
    };
  }
  switch (operation) {
    case "snapshot.create":
      return {
        status: "success",
        operation,
        fileCount: workspaceSnapshotCount(data.fileCount),
        sizeBytes: workspaceSnapshotCount(data.sizeBytes),
      };
    case "snapshot.list":
      return {
        status: "success",
        operation,
        snapshotCount: workspaceSnapshotCount(data.snapshotCount),
      };
    case "snapshot.restore":
      return {
        status: "success",
        operation,
        restoredFiles: workspaceSnapshotCount(data.restoredFiles),
        deletedFiles: workspaceSnapshotCount(data.deletedFiles),
        unchangedFiles: workspaceSnapshotCount(data.unchangedFiles),
      };
    case "snapshot.delete":
      return { status: "success", operation };
  }
}

/** Formats the purpose-built human summary shown for a snapshot operation. */
export function workspaceSnapshotSummary(
  presentation: WorkspaceSnapshotPresentation,
): string {
  if (presentation.status === "failure")
    return `Failure — ${presentation.errorCode ?? "Workspace snapshot operation failed"}`;
  switch (presentation.operation) {
    case "snapshot.create":
      return `Created snapshot — ${presentation.fileCount} files, ${presentation.sizeBytes} bytes`;
    case "snapshot.list":
      return `Listed snapshots — ${presentation.snapshotCount} snapshots`;
    case "snapshot.restore":
      return `Restored snapshot — ${presentation.restoredFiles} restored, ${presentation.deletedFiles} deleted, ${presentation.unchangedFiles} unchanged`;
    case "snapshot.delete":
      return "Deleted snapshot";
  }
}
