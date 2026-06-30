/**
 * Type contracts for the workspace versioning & history dimension.
 *
 * Every content mutation (`write` / `edit` / `append` / `undo`) appends an
 * immutable {@link WorkspaceVersionRecord} snapshot, giving each file a
 * newest-first {@link WorkspaceVersion} history that backs read-at-version,
 * {@link WorkspaceDiff}, and `undo`. The public projection types are exported
 * from `./types`; the persisted record and schema constant are internal.
 *
 * @module
 */

import type { JsonObject } from "../store/types";
import type { WorkspaceFileRecord, WorkspaceNamespaceOption } from "./types";

/** Persisted schema version for a {@link WorkspaceVersionRecord}. */
export const VERSION_RECORD_SCHEMA = 1;

/**
 * The mutation that produced a version.
 *
 * - `write` — a full {@link Workspace.write} (or the initial create).
 * - `edit` — a find/replace {@link Workspace.edit}.
 * - `append` — an {@link Workspace.append}.
 * - `undo` — a restore appended by {@link Workspace.undo}; history is never
 *   rewritten, so reverting a change adds a new version rather than dropping one.
 */
export type WorkspaceVersionOperation = "write" | "edit" | "append" | "undo";

/**
 * Versioning & retention policy for a workspace.
 *
 * Versioning is always on — there is no flag to enable it, because the value of
 * history and `undo` is that they are there when a destructive edit happened
 * before anyone thought to opt in. This object only *bounds* retention.
 *
 * @example
 * ```ts
 * // Keep the 20 most recent versions per file; older snapshots are GC'd.
 * workspace({ id: 'research', namespace, versioning: { maxVersions: 20 } })
 * ```
 */
export interface WorkspaceVersioning {
  /**
   * Maximum number of versions to retain per file. When a write would exceed
   * this count, the oldest snapshots (and their out-of-line blobs) are deleted.
   * Defaults to unlimited — history is kept until explicitly bounded, so a file
   * never silently loses revisions.
   */
  readonly maxVersions?: number;
}

/**
 * One revision in a file's history, newest first.
 *
 * This is the public projection of a stored snapshot: enough to render a
 * timeline and pick a revision to read or diff, with no file contents inlined.
 */
export interface WorkspaceVersion {
  /** Monotonic version number, starting at 1 for the initial write. */
  readonly version: number;
  /** The workspace path this revision belongs to. */
  readonly path: string;
  /** The mutation that produced this revision. */
  readonly operation: WorkspaceVersionOperation;
  /** The recorded MIME type at this revision. */
  readonly mimeType: string;
  /** Byte size of the revision's content. */
  readonly size: number;
  /** Whether the revision's content is stored inline or in the blob store. */
  readonly storage: "inline" | "blob";
  /** A short, redaction-safe text preview, when one is available. */
  readonly preview?: string;
  /** Epoch milliseconds when this revision was recorded. */
  readonly createdAt: number;
}

/** Options for {@link Workspace.history}. */
export interface WorkspaceHistoryOptions extends WorkspaceNamespaceOption {
  /** Cap the number of (newest-first) versions returned. */
  readonly limit?: number;
}

/**
 * Options for {@link Workspace.diff}.
 *
 * Both endpoints default to the natural "what changed last": `to` is the
 * current version and `from` is the version immediately before it.
 */
export interface WorkspaceDiffOptions extends WorkspaceNamespaceOption {
  /** Base version number. Defaults to `to - 1`. */
  readonly from?: number;
  /** Target version number. Defaults to the current (latest) version. */
  readonly to?: number;
}

/** The role of a line within a {@link WorkspaceDiffHunk}. */
export type WorkspaceDiffLineKind = "context" | "add" | "remove";

/** A single line within a {@link WorkspaceDiffHunk}. */
export interface WorkspaceDiffLine {
  /** Whether the line is unchanged context, an addition, or a removal. */
  readonly kind: WorkspaceDiffLineKind;
  /** The line text, without its trailing newline. */
  readonly text: string;
}

/**
 * A contiguous block of changes, mirroring a unified-diff `@@` hunk.
 *
 * Line and length fields are 1-based and measured against each side, matching
 * the `@@ -fromStart,fromLines +toStart,toLines @@` header.
 */
export interface WorkspaceDiffHunk {
  readonly fromStart: number;
  readonly fromLines: number;
  readonly toStart: number;
  readonly toLines: number;
  readonly lines: readonly WorkspaceDiffLine[];
}

/**
 * The result of {@link Workspace.diff}: a git-style unified-diff string plus the
 * same changes as structured hunks, so callers can render either without
 * re-parsing.
 */
export interface WorkspaceDiff {
  /** The path that was diffed. */
  readonly path: string;
  /** The base version number. */
  readonly from: number;
  /** The target version number. */
  readonly to: number;
  /** A git-style unified-diff string. Empty when the versions are identical. */
  readonly unified: string;
  /** The structured hunks backing {@link WorkspaceDiff.unified}. */
  readonly hunks: readonly WorkspaceDiffHunk[];
}

/** Options for {@link Workspace.undo}. */
export interface WorkspaceUndoOptions extends WorkspaceNamespaceOption {}

/**
 * The persisted snapshot of a file at a single version. Internal.
 *
 * Stored under a dedicated `version:` key prefix that never collides with the
 * live `file:` HEAD record, so listings and quota scans ignore history. The
 * embedded {@link WorkspaceFileRecord} is a frozen copy of the HEAD record as it
 * was at this version, including its version-scoped blob URI.
 */
export interface WorkspaceVersionRecord extends JsonObject {
  readonly _cruxWorkspaceVersion: true;
  readonly schema: typeof VERSION_RECORD_SCHEMA;
  readonly version: number;
  readonly operation: WorkspaceVersionOperation;
  readonly createdAt: number;
  readonly snapshot: WorkspaceFileRecord;
}
