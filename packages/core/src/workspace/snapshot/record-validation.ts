/** Structural validation for private Workspace snapshot records. */

import type { JsonObject } from "../../storage";
import { normalizePath } from "../path";
import type { WorkspacePath } from "../types";
import {
  WORKSPACE_SNAPSHOT_SCHEMA,
  type WorkspaceSnapshotDescriptor,
  type WorkspaceSnapshotEntry,
  type WorkspaceSnapshotHeader,
  type WorkspaceSnapshotMaterializedState,
  type WorkspaceSnapshotPayload,
  type WorkspaceSnapshotProvenance,
  type WorkspaceSnapshotPublishedState,
  type WorkspaceSnapshotState,
} from "./records";

/** Return whether an unknown store value is a structurally valid header. */
export function isWorkspaceSnapshotHeader(
  value: unknown,
): value is WorkspaceSnapshotHeader {
  if (!isJsonObject(value)) return false;
  return (
    value._cruxWorkspaceSnapshot === true &&
    value.schema === WORKSPACE_SNAPSHOT_SCHEMA &&
    isSnapshotState(value.state) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.workspaceId) &&
    isNonEmptyString(value.namespace) &&
    isNormalizedPath(value.path) &&
    isNonNegativeSafeInteger(value.fileCount) &&
    isNonNegativeSafeInteger(value.sizeBytes) &&
    isTimestamp(value.createdAt) &&
    isNonEmptyString(value.manifestFingerprint)
  );
}

/** Return whether an unknown store value is a structurally valid file entry. */
export function isWorkspaceSnapshotEntry(
  value: unknown,
): value is WorkspaceSnapshotEntry {
  if (!isJsonObject(value)) return false;
  return (
    value._cruxWorkspaceSnapshotEntry === true &&
    value.schema === WORKSPACE_SNAPSHOT_SCHEMA &&
    isNonEmptyString(value.snapshotId) &&
    isNormalizedPath(value.path) &&
    isMaterializedState(value.head) &&
    (value.published === undefined || isPublishedState(value.published)) &&
    isNonEmptyString(value.entryFingerprint)
  );
}

function isMaterializedState(
  value: unknown,
): value is WorkspaceSnapshotMaterializedState {
  return (
    isJsonObject(value) &&
    isSnapshotDescriptor(value.descriptor) &&
    isSnapshotPayload(value.payload)
  );
}

function isPublishedState(
  value: unknown,
): value is WorkspaceSnapshotPublishedState {
  if (!isJsonObject(value)) return false;
  return (
    value.kind === "shared" ||
    (value.kind === "distinct" && isMaterializedState(value.state))
  );
}

function isSnapshotDescriptor(
  value: unknown,
): value is WorkspaceSnapshotDescriptor {
  if (!isJsonObject(value)) return false;
  return (
    isNonEmptyString(value.mimeType) &&
    (value.metadata === undefined || isJsonObject(value.metadata)) &&
    (value.status === undefined ||
      value.status === "draft" ||
      value.status === "final") &&
    (value.kind === undefined || typeof value.kind === "string") &&
    (value.producedBy === undefined ||
      isSnapshotProvenance(value.producedBy)) &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.updatedAt)
  );
}

function isSnapshotPayload(value: unknown): value is WorkspaceSnapshotPayload {
  if (!isJsonObject(value)) return false;
  const common =
    (value.kind === "text" ||
      value.kind === "json" ||
      value.kind === "binary") &&
    isNonNegativeSafeInteger(value.sizeBytes) &&
    isNonEmptyString(value.contentHash);
  if (!common) return false;
  if (value.storage === "asset") return isNonEmptyString(value.assetUri);
  if (value.storage !== "inline") return false;
  return (
    (value.kind === "text" && typeof value.content === "string") ||
    (value.kind === "json" && value.content !== undefined)
  );
}

function isSnapshotProvenance(
  value: unknown,
): value is WorkspaceSnapshotProvenance {
  if (!isJsonObject(value)) return false;
  return (
    (value.runId === undefined || typeof value.runId === "string") &&
    (value.spanId === undefined || typeof value.spanId === "string") &&
    (value.sources === undefined ||
      (Array.isArray(value.sources) &&
        value.sources.every((source) => typeof source === "string")))
  );
}

function isSnapshotState(value: unknown): value is WorkspaceSnapshotState {
  return value === "creating" || value === "committed" || value === "deleting";
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

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
