/**
 * Workspace watch support.
 *
 * @module
 */

export { createWorkspaceWatchHandle } from "./handle";
export { createWorkspaceChangeEmitter } from "./runtime";
export type {
  WorkspaceChangeEmitter,
  WorkspaceChangeInput,
} from "./events";
export {
  shouldSuppressWorkspaceChangeEvents,
  suppressWorkspaceChangeEvents,
} from "./internal-options";
export type {
  WorkspaceChangeEvent,
  WorkspaceChangeType,
  WorkspacePathChangeEvent,
  WorkspaceRenameChangeEvent,
  WorkspaceWatchCallback,
  WorkspaceWatchHandle,
  WorkspaceWatchOptions,
} from "./types";
