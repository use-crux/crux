/**
 * Type contracts for retriever-backed workspace mount sources.
 *
 * @module
 */

import type { Retriever, RetrieverHit } from "../retrieval/types";

/** Operation that caused a retriever-backed mount to resolve a retrieval query. */
export type WorkspaceRetrieverMountOperation =
  | "list"
  | "read"
  | "grep"
  | "exists"
  | "stat";

/** Input passed to a dynamic retriever mount query resolver. */
export interface WorkspaceRetrieverMountQueryInput {
  /** Workspace operation being served. */
  readonly operation: WorkspaceRetrieverMountOperation;
  /** Normalized workspace path being read/listed/statted, when applicable. */
  readonly path?: string;
  /** Search text for grep operations. */
  readonly query?: string;
}

/** Options for {@link import("./retriever-source").retrieverWorkspaceMountSource}. */
export interface WorkspaceRetrieverMountSourceOptions {
  /**
   * Query used to materialize files for list/read/exists/stat operations.
   * If omitted, those operations use the requested path as the query, while
   * grep uses the grep query.
   */
  readonly query?:
    | string
    | ((input: WorkspaceRetrieverMountQueryInput) => string | Promise<string>);
  /** Maximum retrieval hits to project into virtual files. */
  readonly limit?: number;
  /**
   * Return a workspace-relative path for a hit. Relative paths are mounted under
   * the owning mount root; absolute paths must already be inside that root.
   */
  readonly pathForHit?: (hit: RetrieverHit) => string;
  /** Return text content for a hit. Defaults to parent content, then chunk content. */
  readonly contentForHit?: (hit: RetrieverHit) => string;
  /** MIME type for projected files. Defaults to `text/markdown`. */
  readonly mimeType?: string | ((hit: RetrieverHit) => string);
}

/**
 * Retriever-backed provider for a virtual workspace mount.
 *
 * The retriever's current result set is projected as read-only virtual files
 * under the mount root. Use `query` for list/read/stat materialization when the
 * retriever cannot infer documents from a path-like query.
 */
export interface WorkspaceRetrieverMountSource
  extends WorkspaceRetrieverMountSourceOptions {
  readonly kind: "retriever";
  readonly retriever: Retriever;
}
