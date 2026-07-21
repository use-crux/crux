/**
 * Public contracts for materialized Workspace snapshots.
 *
 * Snapshot references are durable, JSON-safe capabilities for explicitly
 * restoring or deleting an exact Workspace subtree. Persistence records and
 * asset ownership remain private implementation details.
 *
 * @module
 */

import type { WorkspaceNamespaceOption } from "../types";

/** A durable reference to one materialized Workspace subtree snapshot. */
export interface WorkspaceSnapshotRef {
  /** Discriminator for serialized Workspace snapshot references. */
  readonly kind: "workspace.snapshot";
  /** Opaque snapshot identifier. */
  readonly id: string;
  /** Workspace that owns this snapshot. */
  readonly workspaceId: string;
  /** Namespace captured by this snapshot. */
  readonly namespace: string;
  /** Normalized absolute root path captured by this snapshot. */
  readonly path: string;
  /** Number of files captured at or below {@link WorkspaceSnapshotRef.path}. */
  readonly fileCount: number;
  /**
   * Materialized payload bytes owned by the snapshot.
   *
   * This excludes persistence metadata and counts a distinct published
   * artifact payload separately from its working content.
   */
  readonly sizeBytes: number;
  /** Unix timestamp in milliseconds when the snapshot was created. */
  readonly createdAt: number;
}

/** Options for {@link WorkspaceSnapshotOperations.create}. */
export interface WorkspaceSnapshotOptions extends WorkspaceNamespaceOption {
  /**
   * Local file or subtree to capture.
   *
   * The path is normalized with the Workspace's absolute path rules. Capture
   * rejects when the selected tree intersects a source-backed mount.
   */
  readonly path: string;
}

/** Options for {@link WorkspaceSnapshotOperations.list}. */
export interface WorkspaceSnapshotListOptions extends WorkspaceNamespaceOption {
  /** Return only snapshots captured at this exact normalized path. */
  readonly path?: string;
  /** Page size. Defaults to 50 and must be an integer from 1 through 100. */
  readonly limit?: number;
  /** Opaque cursor returned by the previous page. */
  readonly cursor?: string;
}

/** One newest-first page from {@link WorkspaceSnapshotOperations.list}. */
export interface WorkspaceSnapshotPage {
  /** Snapshots ordered by creation time, then opaque id, newest first. */
  readonly snapshots: readonly WorkspaceSnapshotRef[];
  /** Cursor for the next page, omitted when this is the final page. */
  readonly cursor?: string;
}

/** Result of replacing a live subtree with one materialized snapshot. */
export interface WorkspaceSnapshotRestoreResult {
  /** Captured files created or replaced because their logical state differed. */
  readonly restoredFiles: number;
  /** Live files removed because they were absent from the captured tree. */
  readonly deletedFiles: number;
  /** Captured files skipped because their logical state already matched. */
  readonly unchangedFiles: number;
}

/** Snapshot operations bound to a Workspace instance. */
export interface WorkspaceSnapshotOperations {
  /**
   * Materialize an exact point-in-time copy of a local Workspace subtree.
   *
   * The returned {@link WorkspaceSnapshotRef} is JSON-safe and remains reusable
   * until explicitly deleted. Capture rejects trees that intersect a
   * source-backed mount.
   *
   * @param options - Namespace and required file or subtree path.
   * @returns A durable reference with capture size and file count.
   *
   * @example
   * ```ts
   * const checkpoint = await ws.snapshot.create({ path: "/outputs" });
   * ```
   */
  create(options: WorkspaceSnapshotOptions): Promise<WorkspaceSnapshotRef>;

  /**
   * List committed snapshots owned by this Workspace namespace.
   *
   * Results are newest first. The page size defaults to 50 and accepts values
   * from 1 through 100.
   *
   * @param options - Optional namespace, exact path filter, and pagination.
   * @returns A page of snapshot references and, when available, its next cursor.
   *
   * @example
   * ```ts
   * const page = await ws.snapshot.list({ path: "/outputs", limit: 20 });
   * ```
   */
  list(options?: WorkspaceSnapshotListOptions): Promise<WorkspaceSnapshotPage>;

  /**
   * Replace the captured subtree with its exact materialized state.
   *
   * Restore appends new file history, deletes later files in the captured tree,
   * and leaves the snapshot reusable.
   *
   * @param snapshot - A JSON-safe reference returned by `create()` or `list()`.
   * @returns Disjoint counts of restored, deleted, and unchanged files.
   *
   * @example
   * ```ts
   * await ws.snapshot.restore(checkpoint);
   * ```
   */
  restore(
    snapshot: WorkspaceSnapshotRef,
  ): Promise<WorkspaceSnapshotRestoreResult>;

  /**
   * Delete a snapshot and every materialized payload it owns.
   *
   * Deletion is idempotent for a valid reference owned by this Workspace.
   *
   * @param snapshot - Snapshot reference to release.
   *
   * @example
   * ```ts
   * await ws.snapshot.delete(checkpoint);
   * ```
   */
  delete(snapshot: WorkspaceSnapshotRef): Promise<void>;
}

/** Stable machine-readable failure codes for Workspace snapshot operations. */
export type WorkspaceSnapshotErrorCode =
  | "not_found"
  | "invalid_reference"
  | "invalid_cursor"
  | "unsupported_mount"
  | "corrupt_snapshot"
  | "backend_error";

/** Error thrown when a Workspace snapshot operation cannot complete. */
export class WorkspaceSnapshotError extends Error {
  /** Stable code for programmatic error handling. */
  readonly code: WorkspaceSnapshotErrorCode;
  /** Opaque snapshot id associated with the failure, when known. */
  readonly snapshotId?: string;
  /** Original storage or asset failure, when one exists. */
  override readonly cause?: unknown;

  /**
   * Create a typed Workspace snapshot error.
   *
   * @param code - Stable machine-readable failure code.
   * @param message - Human-readable description of the failure.
   * @param options - Optional snapshot identity and original failure.
   */
  constructor(
    code: WorkspaceSnapshotErrorCode,
    message: string,
    options: {
      readonly snapshotId?: string;
      readonly cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "WorkspaceSnapshotError";
    this.code = code;
    if (options.snapshotId !== undefined) {
      this.snapshotId = options.snapshotId;
    }
    if ("cause" in options) {
      this.cause = options.cause;
    }
  }
}
