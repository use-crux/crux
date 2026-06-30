/**
 * Type contracts for the durable workspace domain.
 *
 * Public surface: mount/config options, content + read/write/edit/delete option
 * shapes, the {@link WorkspaceFile} / {@link WorkspaceDirectory} listing entries,
 * the {@link WorkspaceReadResult} union, and the {@link Workspace} instance. The
 * branded path, stored file record, normalized mount, and content analysis types
 * (plus record-format constants) are internal.
 *
 * @module
 */

import type { z } from "zod";
import type {
  BlobReadResult,
  BlobRef,
  BlobStore,
  JsonObject,
  RecordStore,
  Storage,
} from "../storage";
import type { Context, PromptInjection } from "../prompt/context-types";
import type { JsonValue } from "../types/tool";
import type {
  WorkspaceAppendOptions,
  WorkspaceGrepOptions,
  WorkspaceGrepResult,
  WorkspaceMoveOptions,
} from "./fs-types";
import type { WorkspaceLimits, WorkspaceRetention } from "./limits";
import type {
  WorkspaceArtifact,
  WorkspaceArtifactsQuery,
  WorkspaceArtifactStatus,
  WorkspaceFinalizeOptions,
  WorkspaceProvenance,
} from "./artifact-types";
import type {
  WorkspaceToolDelete,
  WorkspaceToolDeleteWithDefaults,
  WorkspaceToolPrefix,
  WorkspaceToolPrefixWithDefaults,
  WorkspaceTools,
  WorkspaceToolUndoWithDefaults,
} from "./tool-types";
import type {
  WorkspaceDiff,
  WorkspaceDiffOptions,
  WorkspaceHistoryOptions,
  WorkspaceUndoOptions,
  WorkspaceVersion,
  WorkspaceVersioning,
} from "./version-types";
import type { WorkspaceRetrieverMountSource } from "./retriever-source-types";

export type {
  WorkspaceAppendOptions,
  WorkspaceGrepMatch,
  WorkspaceGrepOptions,
  WorkspaceGrepResult,
  WorkspaceMoveOptions,
} from "./fs-types";
export type {
  WorkspaceToolDelete,
  WorkspaceToolDeleteWithDefaults,
  WorkspaceToolNames,
  WorkspaceToolPrefix,
  WorkspaceToolPrefixWithDefaults,
  WorkspaceTools,
  WorkspaceToolUndo,
  WorkspaceToolUndoWithDefaults,
} from "./tool-types";
export type { WorkspaceLimits, WorkspaceRetention } from "./limits";
export type {
  WorkspaceDiff,
  WorkspaceDiffHunk,
  WorkspaceDiffLine,
  WorkspaceDiffLineKind,
  WorkspaceDiffOptions,
  WorkspaceHistoryOptions,
  WorkspaceUndoOptions,
  WorkspaceVersion,
  WorkspaceVersioning,
  WorkspaceVersionOperation,
} from "./version-types";

/** Default inline storage cutoff: text/JSON at or below this size is stored inline. */
export const DEFAULT_INLINE_TEXT_BYTES = 64_000;
/** Stored file record schema version. */
export const FILE_RECORD_VERSION = 1;

/** A validated, normalized workspace path. Internal brand. */
export type WorkspacePath = string & { readonly __brand: "WorkspacePath" };

/** Access level for a workspace mount. */
export type WorkspaceMountAccess = "read" | "readwrite";
/** A workspace file operation. */
export type WorkspaceOperation =
  | "list"
  | "read"
  | "write"
  | "edit"
  | "delete"
  | "exists"
  | "stat"
  | "append"
  | "rename"
  | "move"
  | "copy"
  | "grep"
  | "history"
  | "diff"
  | "undo"
  | "artifacts"
  | "finalize";

/** Options passed to a source-backed mount when reading virtual file content. */
export interface WorkspaceMountReadOptions {
  /** Maximum text bytes to return inline before windowing. */
  readonly maxInlineBytes?: number;
  /** Byte offset for text windowing. */
  readonly offset?: number;
  /** Normalized path of the mount that owns this source call. */
  readonly mountPath?: string;
}

/** Options passed to a source-backed mount when listing virtual entries. */
export interface WorkspaceMountListOptions {
  /** Maximum number of entries the source should return. */
  readonly limit?: number;
  /** Source-owned cursor returned by a previous list call. */
  readonly cursor?: string;
  /** Normalized path of the mount that owns this source call. */
  readonly mountPath?: string;
}

/** Options passed to a source-backed mount when searching virtual entries. */
export interface WorkspaceMountGrepOptions extends Pick<
  WorkspaceGrepOptions,
  "ignoreCase" | "maxResults" | "path" | "regex"
> {
  /** Normalized path of the mount that owns this source call. */
  readonly mountPath?: string;
}

/** Options passed to source-backed mount metadata checks. */
export interface WorkspaceMountPathOptions {
  /** Normalized path of the mount that owns this source call. */
  readonly mountPath?: string;
}

/** Options passed to source-backed mount write hooks. */
export interface WorkspaceMountWriteOptions extends WorkspaceMountPathOptions {
  /** MIME type requested by the workspace write call, when provided. */
  readonly mimeType?: string;
  /** App metadata requested by the workspace write call, when provided. */
  readonly metadata?: Record<string, JsonValue>;
  /** Artifact lifecycle status requested by the workspace write call, when provided. */
  readonly status?: WorkspaceArtifactStatus;
  /** App-facing artifact classifier requested by the workspace write call. */
  readonly kind?: string;
  /** Workspace mutation that produced this write. */
  readonly operation?: "write" | "edit" | "append" | "copy";
}

/**
 * A custom source that backs a workspace mount.
 *
 * Custom sources receive already-normalized workspace paths, so providers never
 * need to parse raw user input. Return `null` from `read()` when the normalized
 * path does not exist in the provider namespace. Mutation hooks are opt-in:
 * source-backed mounts stay read-only unless the mount has `access:
 * "readwrite"` and the source implements the matching hook.
 */
export interface WorkspaceCustomMountSource {
  readonly kind: "custom";
  /** List virtual entries under a normalized workspace path or glob. */
  list(
    path: string,
    options?: WorkspaceMountListOptions,
  ): Promise<WorkspaceListResult> | WorkspaceListResult;
  /** Read virtual file content for a normalized workspace path, or `null` when absent. */
  read(
    path: string,
    options?: WorkspaceMountReadOptions,
  ): Promise<WorkspaceReadResult | null> | WorkspaceReadResult | null;
  /** Search virtual text files. When omitted, workspace grep falls back to list + read. */
  grep?(
    query: string,
    options?: WorkspaceMountGrepOptions,
  ): Promise<WorkspaceGrepResult> | WorkspaceGrepResult;
  /** Check whether a normalized virtual file path exists. */
  exists?(
    path: string,
    options?: WorkspaceMountPathOptions,
  ): Promise<boolean> | boolean;
  /** Return virtual file metadata for a normalized path, or `null` when absent. */
  stat?(
    path: string,
    options?: WorkspaceMountPathOptions,
  ): Promise<WorkspaceFile | null> | WorkspaceFile | null;
  /**
   * Write virtual file content back to the provider.
   *
   * Return a {@link WorkspaceFile} or {@link WorkspaceReadResult} when the
   * provider can cheaply report the updated file. If omitted, `write`, `edit`,
   * `append`, and provider-destination `copy` reject for this mount.
   */
  write?(
    path: string,
    content: WorkspaceContent,
    options?: WorkspaceMountWriteOptions,
  ):
    | Promise<WorkspaceFile | WorkspaceReadResult | null | void>
    | WorkspaceFile
    | WorkspaceReadResult
    | null
    | void;
  /**
   * Delete a virtual file from the provider.
   *
   * If omitted, `delete` rejects for this mount.
   */
  delete?(
    path: string,
    options?: WorkspaceMountPathOptions,
  ): Promise<void> | void;
}

/**
 * Provider-backed content for a virtual workspace mount.
 *
 * Retriever sources project retrieval hits as virtual text files. Custom
 * sources provide the low-level path-addressed contract for other providers
 * such as MCP resources, project indexes, and connected drives.
 */
export type WorkspaceMountSource =
  | WorkspaceCustomMountSource
  | WorkspaceRetrieverMountSource;

/** A mounted root within a workspace. */
export interface WorkspaceMount {
  readonly path: string;
  readonly access: WorkspaceMountAccess;
  readonly description?: string;
  readonly source?: WorkspaceMountSource;
}

/** Inline-vs-blob content thresholds. */
export interface WorkspaceContentOptions {
  readonly inlineTextBelowBytes?: number;
}

/** Options controlling generated workspace tools. */
export interface WorkspaceToolOptions {
  readonly prefix?: string;
  readonly delete?: boolean;
  /**
   * Generate the `undoWorkspaceFile` tool. Opt-in like {@link WorkspaceToolOptions.delete}:
   * it lets a model roll a file back to its previous version.
   */
  readonly undo?: boolean;
}

/** Per-call namespace override accepted by every workspace operation. */
export interface WorkspaceNamespaceOption {
  readonly namespace?: string;
}

/** Configuration for {@link workspace}. */
export interface WorkspaceConfig {
  readonly id: string;
  readonly namespace:
    | string
    | ((args: {
        input: Record<string, unknown>;
        promptId?: string;
      }) => string | Promise<string>);
  readonly records?: RecordStore;
  readonly blobs?: BlobStore;
  readonly storage?: Storage;
  readonly mounts?: readonly WorkspaceMount[];
  readonly content?: WorkspaceContentOptions;
  readonly tools?: WorkspaceToolOptions;
  /** Optional write-time byte limits for files and namespace totals. */
  readonly limits?: WorkspaceLimits;
  /** Optional metadata retention policy, applied only when the data store supports TTL. */
  readonly retention?: WorkspaceRetention;
  /**
   * Optional versioning & history retention. History is always recorded; this
   * only bounds how many versions are kept per file. See {@link WorkspaceVersioning}.
   */
  readonly versioning?: WorkspaceVersioning;
}

/** JSON values accepted by {@link Workspace.write}; strings are handled as text content. */
export type WorkspaceJsonContent = Exclude<JsonValue, string>;

/** Accepted content types for {@link Workspace.write}. */
export type WorkspaceContent =
  | string
  | WorkspaceJsonContent
  | Uint8Array
  | Blob
  | ReadableStream<Uint8Array>;

/** Options for {@link Workspace.write}. */
export interface WorkspaceWriteOptions extends WorkspaceNamespaceOption {
  readonly mimeType?: string;
  readonly metadata?: Record<string, JsonValue>;
  /** Artifact lifecycle status to store with the file. */
  readonly status?: WorkspaceArtifactStatus;
  /** App-facing artifact classifier. Stored as `kind` on the record. */
  readonly kind?: string;
}

/** Options for {@link Workspace.read}. */
export interface WorkspaceReadOptions extends WorkspaceNamespaceOption {
  readonly maxInlineBytes?: number;
  readonly offset?: number;
  /**
   * Read a specific historical revision instead of the current content. When
   * omitted, the latest version is read. See {@link Workspace.history}.
   */
  readonly version?: number;
}

/** Options for {@link Workspace.list}. */
export interface WorkspaceListOptions extends WorkspaceNamespaceOption {
  readonly limit?: number;
  readonly cursor?: string;
}

/** A find/replace patch for {@link Workspace.edit}. */
export interface WorkspaceEditPatch {
  readonly find: string;
  readonly replace: string;
  readonly occurrence?: number;
}

/** Options for {@link Workspace.edit}. */
export interface WorkspaceEditOptions extends WorkspaceNamespaceOption {
  readonly mimeType?: string;
}

/** Options for {@link Workspace.delete}. */
export interface WorkspaceDeleteOptions extends WorkspaceNamespaceOption {
  readonly deleteBlob?: boolean;
}

/** A file entry in a workspace listing. */
export interface WorkspaceFile {
  readonly kind: "file";
  readonly path: string;
  readonly status?: WorkspaceArtifactStatus;
  readonly artifactKind?: string;
  readonly producedBy?: WorkspaceProvenance;
  readonly mimeType: string;
  readonly size: number;
  readonly mount: string;
  /** Byte ownership for listing/stat; `virtual` means the bytes live behind a mount source. */
  readonly storage: "inline" | "blob" | "virtual";
  readonly uri?: string;
  readonly preview?: string;
  readonly metadata?: Record<string, JsonValue>;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** A directory entry in a workspace listing. */
export interface WorkspaceDirectory {
  readonly kind: "directory";
  readonly path: string;
  readonly mount: string;
}

/** A workspace listing entry: file or directory. */
export type WorkspaceListEntry = WorkspaceFile | WorkspaceDirectory;

/** The result of {@link Workspace.list}. */
export interface WorkspaceListResult {
  readonly entries: readonly WorkspaceListEntry[];
  readonly cursor?: string;
}

/** The result of {@link Workspace.read}: inline text/JSON or a binary reference. */
export type WorkspaceReadResult =
  | {
      readonly kind: "text";
      readonly path: string;
      readonly status?: WorkspaceArtifactStatus;
      readonly artifactKind?: string;
      readonly producedBy?: WorkspaceProvenance;
      readonly mimeType: string;
      readonly content: string;
      readonly size: number;
      readonly truncated?: boolean;
      readonly offset?: number;
      readonly metadata?: Record<string, JsonValue>;
    }
  | {
      readonly kind: "json";
      readonly path: string;
      readonly status?: WorkspaceArtifactStatus;
      readonly artifactKind?: string;
      readonly producedBy?: WorkspaceProvenance;
      readonly mimeType: "application/json";
      readonly content: JsonValue;
      readonly size: number;
      readonly metadata?: Record<string, JsonValue>;
    }
  | {
      readonly kind: "binary";
      readonly path: string;
      readonly status?: WorkspaceArtifactStatus;
      readonly artifactKind?: string;
      readonly producedBy?: WorkspaceProvenance;
      readonly mimeType: string;
      readonly uri: string;
      readonly size: number;
      readonly preview?: string;
      readonly metadata?: Record<string, JsonValue>;
    };

/** Re-export of the store blob reference type, for workspace consumers. */
export type WorkspaceBlobRef = BlobRef;
/** Re-export of the store blob read-result type, for workspace consumers. */
export type WorkspaceBlobReadResult = BlobReadResult;
/** Re-export of the store blob store type, for workspace consumers. */
export type WorkspaceBlobStore = BlobStore;

/** A durable, path-addressed workspace instance. */
export interface Workspace<
  DefaultToolOptions extends WorkspaceToolOptions | undefined = undefined,
> {
  readonly _tag: "Workspace";
  readonly id: string;
  readonly mounts: readonly WorkspaceMount[];
  list(
    path?: string,
    options?: WorkspaceListOptions,
  ): Promise<WorkspaceListResult>;
  read(
    path: string,
    options?: WorkspaceReadOptions,
  ): Promise<WorkspaceReadResult>;
  write(
    path: string,
    content: WorkspaceContent,
    options?: WorkspaceWriteOptions,
  ): Promise<WorkspaceFile>;
  edit(
    path: string,
    patch: WorkspaceEditPatch,
    options?: WorkspaceEditOptions,
  ): Promise<WorkspaceFile>;
  delete(path: string, options?: WorkspaceDeleteOptions): Promise<void>;
  exists(path: string, options?: WorkspaceNamespaceOption): Promise<boolean>;
  stat(
    path: string,
    options?: WorkspaceNamespaceOption,
  ): Promise<WorkspaceFile | null>;
  append(
    path: string,
    content: string,
    options?: WorkspaceAppendOptions,
  ): Promise<WorkspaceFile>;
  rename(
    from: string,
    to: string,
    options?: WorkspaceMoveOptions,
  ): Promise<WorkspaceFile>;
  move(
    from: string,
    to: string,
    options?: WorkspaceMoveOptions,
  ): Promise<WorkspaceFile>;
  copy(
    from: string,
    to: string,
    options?: WorkspaceMoveOptions,
  ): Promise<WorkspaceFile>;
  grep(
    query: string,
    options?: WorkspaceGrepOptions,
  ): Promise<WorkspaceGrepResult>;
  /**
   * List a file's revision history, newest first.
   *
   * @param path - Absolute workspace path.
   * @returns The recorded {@link WorkspaceVersion}s; empty when the file does
   *   not exist.
   */
  history(
    path: string,
    options?: WorkspaceHistoryOptions,
  ): Promise<readonly WorkspaceVersion[]>;
  /**
   * Diff two revisions of a text file as a unified-diff string plus structured
   * hunks. Defaults to the most recent change (previous version → current).
   *
   * @param path - Absolute workspace path.
   * @throws If the file is binary, or a requested version does not exist.
   */
  diff(path: string, options?: WorkspaceDiffOptions): Promise<WorkspaceDiff>;
  /**
   * Revert the last content change by appending the previous version's content
   * as a new version. History is never rewritten.
   *
   * @param path - Absolute workspace path.
   * @returns The file at its restored, newly-current version.
   * @throws If there is no earlier version to restore.
   */
  undo(path: string, options?: WorkspaceUndoOptions): Promise<WorkspaceFile>;
  artifacts(
    options?: WorkspaceArtifactsQuery,
  ): Promise<readonly WorkspaceArtifact[]>;
  finalize(
    path: string,
    options?: WorkspaceFinalizeOptions,
  ): Promise<WorkspaceArtifact>;
  asContext(options?: WorkspaceContextOptions): Context<z.ZodObject<{}>>;
  asTools<
    const Options extends WorkspaceToolOptions & WorkspaceNamespaceOption = {},
  >(
    options?: Options,
  ): WorkspaceTools<
    WorkspaceToolPrefixWithDefaults<DefaultToolOptions, Options>,
    WorkspaceToolDeleteWithDefaults<DefaultToolOptions, Options>,
    WorkspaceToolUndoWithDefaults<DefaultToolOptions, Options>
  >;
  inject(args: {
    input: Record<string, unknown>;
    promptId?: string;
  }): PromptInjection | Promise<PromptInjection>;
}

/** Options for {@link Workspace.asContext}. */
export interface WorkspaceContextOptions {
  readonly include?: readonly string[];
  readonly maxInlineBytes?: number;
  readonly priority?: number;
}

/** The persisted record for a workspace file. Internal. */
export interface WorkspaceFileRecord {
  readonly _cruxWorkspaceFile: true;
  readonly version: typeof FILE_RECORD_VERSION;
  readonly workspaceId: string;
  readonly namespace: string;
  readonly path: string;
  readonly mount: string;
  readonly mimeType: string;
  readonly size: number;
  readonly storage: "inline" | "blob";
  readonly inlineText?: string;
  readonly inlineJson?: JsonValue;
  readonly uri?: string;
  readonly preview?: string;
  readonly metadata?: Record<string, JsonValue>;
  readonly status?: WorkspaceArtifactStatus;
  readonly kind?: string;
  readonly producedBy?: WorkspaceProvenance;
  /**
   * The current version number for this file, starting at 1. Absent on records
   * written before versioning; treated as 1 when reading such records.
   */
  readonly headVersion?: number;
  /**
   * The published version pinned by `finalize()`. While set and the file stays
   * `final`, the artifact/manifest projection surfaces this revision even as the
   * working file advances to newer versions.
   */
  readonly finalVersion?: number;
  readonly createdAt: number;
  readonly updatedAt: number;
}

/** A mount with its path normalized to a {@link WorkspacePath}. Internal. */
export interface NormalizedMount extends WorkspaceMount {
  readonly path: WorkspacePath;
}

/** The analyzed shape of content being written. Internal. */
export interface ContentAnalysis {
  readonly kind: "text" | "json" | "binary";
  readonly mimeType: string;
  readonly size: number;
  readonly text?: string;
  readonly json?: JsonValue;
  readonly binary?: Uint8Array | Blob | ReadableStream<Uint8Array>;
}
