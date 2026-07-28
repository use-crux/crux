import type {
  ObservabilityResourceActivity,
  WorkspaceOperationEvent,
} from "@/types";
import {
  optionalWorkspaceSnapshotCount,
  workspaceSnapshotErrorCode,
  type WorkspaceSnapshotOperation,
} from "@/shared/lib/workspace-snapshot";

/** Input for the closed snapshot branch of the resource-activity adapter. */
export interface WorkspaceSnapshotActivityInput {
  readonly activity: ObservabilityResourceActivity;
  readonly operation: WorkspaceSnapshotOperation;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly pathHash?: string;
}

/** Converts one snapshot span without projecting generic file or artifact data. */
export function workspaceSnapshotEventFromResourceActivity({
  activity,
  operation,
  attributes,
  pathHash,
}: WorkspaceSnapshotActivityInput): WorkspaceOperationEvent {
  const failed = activity.status === "error" || Boolean(activity.error);
  return {
    type: "workspace:operation",
    workspaceId:
      stringValue(attributes.workspaceId) ?? activity.resourceId ?? "workspace",
    namespace: stringValue(attributes.namespaceHash) ?? "",
    operation,
    path: "",
    pathHash,
    status: failed ? "error" : "success",
    durationMs: activity.durationMs,
    fileCount: optionalWorkspaceSnapshotCount(attributes.fileCount),
    sizeBytes: optionalWorkspaceSnapshotCount(attributes.sizeBytes),
    snapshotCount: optionalWorkspaceSnapshotCount(attributes.snapshotCount),
    restoredFiles: optionalWorkspaceSnapshotCount(attributes.restoredFiles),
    deletedFiles: optionalWorkspaceSnapshotCount(attributes.deletedFiles),
    unchangedFiles: optionalWorkspaceSnapshotCount(attributes.unchangedFiles),
    error: failed ? "Workspace snapshot operation failed." : undefined,
    errorCode: workspaceSnapshotErrorCode(activity.error?.category),
    traceId: activity.traceId || undefined,
    timestamp: timeMs(activity.startedAt),
  };
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function timeMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}
