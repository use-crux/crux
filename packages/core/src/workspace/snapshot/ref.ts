/**
 * Runtime validation for public Workspace snapshot references.
 *
 * @module
 */

import { normalizePath } from "../path";
import type { WorkspacePath } from "../types";
import { WorkspaceSnapshotError, type WorkspaceSnapshotRef } from "./types";

/** Validate an untrusted JSON-safe ref and copy it into a frozen trusted value. */
export function validateSnapshotRef(
  value: unknown,
  workspaceId: string,
): WorkspaceSnapshotRef {
  const snapshotId = readSnapshotId(value);
  if (!value || typeof value !== "object") {
    throw invalidReference("Snapshot reference must be an object.", snapshotId);
  }
  const ref = value as Partial<WorkspaceSnapshotRef>;
  if (
    ref.kind !== "workspace.snapshot" ||
    !isNonEmptyString(ref.id) ||
    !isNonEmptyString(ref.workspaceId) ||
    !isNonEmptyString(ref.namespace) ||
    !isNormalizedPath(ref.path) ||
    !isNonNegativeSafeInteger(ref.fileCount) ||
    !isNonNegativeSafeInteger(ref.sizeBytes) ||
    typeof ref.createdAt !== "number" ||
    !Number.isFinite(ref.createdAt) ||
    ref.createdAt < 0
  ) {
    throw invalidReference("Snapshot reference is malformed.", snapshotId);
  }
  if (ref.workspaceId !== workspaceId) {
    throw invalidReference(
      "Snapshot reference belongs to another Workspace.",
      ref.id,
    );
  }
  return Object.freeze({
    kind: ref.kind,
    id: ref.id,
    workspaceId: ref.workspaceId,
    namespace: ref.namespace,
    path: ref.path,
    fileCount: ref.fileCount,
    sizeBytes: ref.sizeBytes,
    createdAt: ref.createdAt,
  });
}

function invalidReference(
  message: string,
  snapshotId: string | undefined,
): WorkspaceSnapshotError {
  return new WorkspaceSnapshotError("invalid_reference", message, {
    ...(snapshotId !== undefined ? { snapshotId } : {}),
  });
}

function readSnapshotId(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("id" in value)) return undefined;
  return typeof value.id === "string" ? value.id : undefined;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNormalizedPath(value: unknown): value is WorkspacePath {
  if (typeof value !== "string") return false;
  try {
    return normalizePath(value) === value;
  } catch {
    return false;
  }
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}
