/**
 * Public types for filesystem-style workspace operations.
 *
 * @module
 */

import type { WorkspaceNamespaceOption } from "./types";

/** Options for `Workspace.append()`. */
export interface WorkspaceAppendOptions extends WorkspaceNamespaceOption {
  readonly mimeType?: string;
}

/** Options for `Workspace.rename()`, `Workspace.move()`, and `Workspace.copy()`. */
export interface WorkspaceMoveOptions extends WorkspaceNamespaceOption {
  readonly overwrite?: boolean;
}

/** Options for `Workspace.grep()`. */
export interface WorkspaceGrepOptions extends WorkspaceNamespaceOption {
  readonly path?: string;
  readonly ignoreCase?: boolean;
  readonly regex?: boolean;
  readonly maxResults?: number;
}

/** One text match returned by `Workspace.grep()`. */
export interface WorkspaceGrepMatch {
  readonly path: string;
  readonly line: number;
  readonly column: number;
  readonly text: string;
}

/** The result of `Workspace.grep()`. */
export interface WorkspaceGrepResult {
  readonly matches: readonly WorkspaceGrepMatch[];
}
