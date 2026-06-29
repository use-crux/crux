/**
 * Durable workspaces for path-addressed agent files.
 *
 * Workspaces give prompts a scoped, filesystem-like tree for scratch files and
 * generated outputs. Metadata lives in a `DataStore`; binary or oversized
 * payloads live in a `BlobStore`.
 *
 * @module
 */

export { workspace, memoryWorkspaceBlobStore } from './define-workspace'
export { workspaceToolNames } from './tool-io'

export type {
  Workspace,
  WorkspaceBlobReadResult,
  WorkspaceBlobRef,
  WorkspaceBlobStore,
  WorkspaceConfig,
  WorkspaceContent,
  WorkspaceContentOptions,
  WorkspaceContextOptions,
  WorkspaceDeleteOptions,
  WorkspaceDirectory,
  WorkspaceEditOptions,
  WorkspaceEditPatch,
  WorkspaceFile,
  WorkspaceListEntry,
  WorkspaceListOptions,
  WorkspaceListResult,
  WorkspaceMount,
  WorkspaceMountAccess,
  WorkspaceNamespaceOption,
  WorkspaceOperation,
  WorkspaceJsonContent,
  WorkspaceReadOptions,
  WorkspaceReadResult,
  WorkspaceTools,
  WorkspaceToolNames,
  WorkspaceToolOptions,
} from './types'
