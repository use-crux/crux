/**
 * Public workspace watch contracts.
 *
 * @module
 */

import type { EventCursor } from "../../runtime/ports";
import type { WorkspaceNamespaceOption } from "../types";

/** Workspace mutation kind delivered by {@link WorkspaceWatchHandle}. */
export type WorkspaceChangeType = "create" | "update" | "delete" | "rename";

interface WorkspaceChangeEventBase {
  /** Workspace id that emitted the change. */
  readonly workspaceId: string;
  /** Workspace namespace that changed. */
  readonly namespace: string;
  /** Changed path. For renames this is the destination path. */
  readonly path: string;
  /** Runtime event cursor for resuming this watch later. */
  readonly cursor: EventCursor;
  /** Epoch milliseconds when the workspace mutation completed. */
  readonly at: number;
}

/** Create, update, or delete event for one workspace path. */
export type WorkspacePathChangeEvent = WorkspaceChangeEventBase & {
  readonly type: Exclude<WorkspaceChangeType, "rename">;
  /** Only rename events carry a source path. */
  readonly from?: never;
};

/** Rename or move event. `path` is the destination and `from` is the source. */
export type WorkspaceRenameChangeEvent = WorkspaceChangeEventBase & {
  readonly type: "rename";
  readonly from: string;
};

/**
 * Durable workspace change event delivered by `workspace.watch()`.
 *
 * The union is discriminated by `type`; `from` is required only when
 * `type === "rename"`.
 */
export type WorkspaceChangeEvent =
  | WorkspacePathChangeEvent
  | WorkspaceRenameChangeEvent;

/** Callback registered with {@link WorkspaceWatchHandle.on}. */
export type WorkspaceWatchCallback = (event: WorkspaceChangeEvent) => void;

/** Retryable failure observed by a `workspace.watch()` handle. */
export interface WorkspaceWatchError {
  /** Error thrown while resolving the watch namespace or reading runtime events. */
  readonly error: unknown;
  /** Consecutive poll failures observed by this handle. Resets after a successful poll. */
  readonly failures: number;
  /** Delay, in milliseconds, before the next retry attempt. */
  readonly retryDelayMs: number;
}

/** Callback for retryable `workspace.watch()` poll failures. */
export type WorkspaceWatchErrorCallback = (error: WorkspaceWatchError) => void;

/** Options for `workspace.watch()`. */
export interface WorkspaceWatchOptions extends WorkspaceNamespaceOption {
  /**
   * Include descendants of the watched path.
   *
   * Specific paths default to exact-path matching; `workspace.watch()` without
   * a path defaults to the whole workspace tree.
   */
  readonly recursive?: boolean;
  /**
   * Resume after a previously delivered event cursor.
   *
   * Omit this to start at newly appended changes.
   */
  readonly cursor?: EventCursor | string;
  /** Poll interval for cursor reads when no live delivery is configured. */
  readonly pollIntervalMs?: number;
  /** Maximum runtime events to read per poll. */
  readonly limit?: number;
  /**
   * Observe retryable poll failures.
   *
   * The watch stays alive and retries with backoff; throwing from this callback
   * does not stop delivery.
   */
  readonly onError?: WorkspaceWatchErrorCallback;
  /** Stop the watch when this signal aborts. */
  readonly signal?: AbortSignal;
}

/** Handle returned by `workspace.watch()`. */
export interface WorkspaceWatchHandle {
  /** Latest delivered runtime event cursor, useful for resuming later. */
  readonly cursor?: EventCursor;
  /** Whether this handle has been stopped. */
  readonly stopped: boolean;
  /** Register a change callback and return an unsubscribe function. */
  on(callback: WorkspaceWatchCallback): () => void;
  /** Stop polling and release runtime resources. Idempotent. */
  stop(): void;
}
