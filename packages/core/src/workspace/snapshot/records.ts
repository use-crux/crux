/**
 * Private persisted record contracts for Workspace snapshots.
 *
 * @module
 */

import type { AssetRef, JsonObject, JsonValue } from "../../storage";
import type { WorkspacePath } from "../types";
import type { WorkspaceSnapshotRef } from "./types";

export const WORKSPACE_SNAPSHOT_SCHEMA = 1;

export type WorkspaceSnapshotState = "creating" | "committed" | "deleting";

/** Private lifecycle header for one materialized snapshot. */
export interface WorkspaceSnapshotHeader extends JsonObject {
  readonly _cruxWorkspaceSnapshot: true;
  readonly schema: typeof WORKSPACE_SNAPSHOT_SCHEMA;
  readonly state: WorkspaceSnapshotState;
  readonly id: string;
  readonly workspaceId: string;
  readonly namespace: string;
  readonly path: WorkspacePath;
  readonly fileCount: number;
  readonly sizeBytes: number;
  readonly createdAt: number;
  readonly manifestFingerprint: string;
}

/** Private JSON-safe provenance copied from a live file descriptor. */
export interface WorkspaceSnapshotProvenance extends JsonObject {
  readonly runId?: string;
  readonly spanId?: string;
  readonly sources?: readonly string[];
}

/** Logical file fields preserved independently from payload storage. */
export interface WorkspaceSnapshotDescriptor extends JsonObject {
  readonly mimeType: string;
  readonly metadata?: JsonObject;
  readonly status?: "draft" | "final";
  readonly kind?: string;
  readonly producedBy?: WorkspaceSnapshotProvenance;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** One inline text payload owned by a snapshot entry. */
export interface WorkspaceSnapshotInlineTextPayload extends JsonObject {
  readonly kind: "text";
  readonly storage: "inline";
  readonly content: string;
  readonly sizeBytes: number;
  readonly contentHash: string;
}

/** One canonical inline JSON payload owned by a snapshot entry. */
export interface WorkspaceSnapshotInlineJsonPayload extends JsonObject {
  readonly kind: "json";
  readonly storage: "inline";
  readonly content: JsonValue;
  readonly sizeBytes: number;
  readonly contentHash: string;
}

/** One independently owned AssetStore payload referenced by a snapshot entry. */
export interface WorkspaceSnapshotAssetPayload extends JsonObject {
  readonly kind: "text" | "json" | "binary";
  readonly storage: "asset";
  readonly assetUri: string;
  /** Integrity proof binding this bearer ref to its snapshot entry and role. */
  readonly ownershipFingerprint: string;
  readonly sizeBytes: number;
  readonly contentHash: string;
}

/** Snapshot-owned payload representations supported by materialized entries. */
export type WorkspaceSnapshotPayload =
  | WorkspaceSnapshotInlineTextPayload
  | WorkspaceSnapshotInlineJsonPayload
  | WorkspaceSnapshotAssetPayload;

/** One materialized logical state for a captured file. */
export interface WorkspaceSnapshotMaterializedState extends JsonObject {
  readonly descriptor: WorkspaceSnapshotDescriptor;
  readonly payload: WorkspaceSnapshotPayload;
}

/** Published state shares HEAD ownership or carries a distinct materialization. */
export type WorkspaceSnapshotPublishedState =
  | (JsonObject & { readonly kind: "shared" })
  | (JsonObject & {
      readonly kind: "distinct";
      readonly state: WorkspaceSnapshotMaterializedState;
    });

/** Private one-record-per-file snapshot entry. */
export interface WorkspaceSnapshotEntry extends JsonObject {
  readonly _cruxWorkspaceSnapshotEntry: true;
  readonly schema: typeof WORKSPACE_SNAPSHOT_SCHEMA;
  readonly snapshotId: string;
  readonly path: WorkspacePath;
  readonly head: WorkspaceSnapshotMaterializedState;
  readonly published?: WorkspaceSnapshotPublishedState;
  readonly entryFingerprint: string;
}

/** Collect every snapshot-owned asset referenced by one validated entry. */
export function snapshotEntryAssetRefs(
  entry: WorkspaceSnapshotEntry,
): readonly AssetRef[] {
  const refs: AssetRef[] = [];
  if (entry.head.payload.storage === "asset") {
    refs.push({ uri: entry.head.payload.assetUri });
  }
  if (
    entry.published?.kind === "distinct" &&
    entry.published.state.payload.storage === "asset"
  ) {
    refs.push({ uri: entry.published.state.payload.assetUri });
  }
  return refs;
}

/** Count logical payload bytes materialized for one snapshot file entry. */
export function snapshotEntrySizeBytes(entry: WorkspaceSnapshotEntry): number {
  return (
    entry.head.payload.sizeBytes +
    (entry.published?.kind === "distinct"
      ? entry.published.state.payload.sizeBytes
      : 0)
  );
}

/** Project a validated committed header into a frozen public capability ref. */
export function snapshotHeaderToRef(
  header: WorkspaceSnapshotHeader,
): WorkspaceSnapshotRef {
  return Object.freeze({
    kind: "workspace.snapshot",
    id: header.id,
    workspaceId: header.workspaceId,
    namespace: header.namespace,
    path: header.path,
    fileCount: header.fileCount,
    sizeBytes: header.sizeBytes,
    createdAt: header.createdAt,
  });
}
