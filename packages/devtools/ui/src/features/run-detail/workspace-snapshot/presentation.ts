import type {
  ObservabilityRunDetailNode,
  WorkspaceSnapshotErrorCode,
} from "@/types";
import {
  workspaceSnapshotCount,
  workspaceSnapshotErrorCode,
  workspaceSnapshotOperation,
  type WorkspaceSnapshotOperation,
} from "@/shared/lib/workspace-snapshot";

export type WorkspaceSnapshotRunPresentation =
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

/** Projects one snapshot span into the closed, privacy-safe run-card contract. */
export function projectWorkspaceSnapshotRun(
  node: ObservabilityRunDetailNode,
): WorkspaceSnapshotRunPresentation | undefined {
  if (node.primitive !== "workspace.operation") return undefined;
  const attributes = node.attributes ?? {};
  const failed =
    node.status === "error" || node.status === "failed" || Boolean(node.error);
  return projectWorkspaceSnapshotPresentation({
    ...attributes,
    status: failed ? "error" : "success",
    errorCode: snapshotRunErrorCode(node.error, attributes.errorCode),
  });
}

/** Projects correlated snapshot event data into the same closed run-card contract. */
export function projectWorkspaceSnapshotPresentation(
  data: Readonly<Record<string, unknown>>,
): WorkspaceSnapshotRunPresentation | undefined {
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

/** Formats the purpose-built human summary shown for a snapshot span. */
export function workspaceSnapshotRunSummary(
  presentation: WorkspaceSnapshotRunPresentation,
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

function snapshotRunErrorCode(
  error: ObservabilityRunDetailNode["error"],
  attributeCode: unknown,
): WorkspaceSnapshotErrorCode | undefined {
  const errorCode =
    typeof error === "object" && error !== null ? error.category : undefined;
  return workspaceSnapshotErrorCode(errorCode ?? attributeCode);
}
