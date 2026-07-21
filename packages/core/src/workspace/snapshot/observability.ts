/** Privacy-safe Workspace snapshot observability projections. */

import type { WorkspaceOperation } from "../types";
import type { WorkspaceSnapshotErrorCode } from "./types";

/** Replace snapshot failures with a safe telemetry-only error projection. */
export function snapshotObservationError(
  operation: WorkspaceOperation,
  error: unknown,
): unknown {
  if (!operation.startsWith("snapshot.")) return error;
  const safe = new Error("Workspace snapshot operation failed.");
  const code = snapshotErrorCode(error);
  if (code === undefined) return safe;
  safe.name = "WorkspaceSnapshotError";
  return Object.assign(safe, { code });
}

/** Return allowlisted aggregate result attributes for snapshot operations. */
export function snapshotResultAttributes(
  result: unknown,
): Record<string, unknown> | undefined {
  if (!result || typeof result !== "object") return undefined;
  const record = result as Record<string, unknown>;
  if (
    record.kind === "workspace.snapshot" &&
    typeof record.fileCount === "number" &&
    typeof record.sizeBytes === "number"
  ) {
    return {
      resultKind: "workspace.snapshot",
      fileCount: record.fileCount,
      sizeBytes: record.sizeBytes,
    };
  }
  if (Array.isArray(record.snapshots)) {
    return {
      resultKind: "snapshot.list",
      snapshotCount: record.snapshots.length,
    };
  }
  if (
    typeof record.restoredFiles === "number" &&
    typeof record.deletedFiles === "number" &&
    typeof record.unchangedFiles === "number"
  ) {
    return {
      resultKind: "snapshot.restore",
      restoredFiles: record.restoredFiles,
      deletedFiles: record.deletedFiles,
      unchangedFiles: record.unchangedFiles,
    };
  }
  return undefined;
}

function snapshotErrorCode(
  error: unknown,
): WorkspaceSnapshotErrorCode | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }
  switch (error.code) {
    case "not_found":
    case "invalid_reference":
    case "invalid_cursor":
    case "unsupported_mount":
    case "corrupt_snapshot":
    case "backend_error":
      return error.code;
    default:
      return undefined;
  }
}
