/**
 * Durable workspaces for path-addressed agent files.
 *
 * Workspaces give prompts a scoped, filesystem-like tree for scratch files and
 * generated outputs. Metadata lives in a `RecordStore`; binary or oversized
 * payloads live in a `BlobStore`.
 *
 * @module
 */

export { workspace, memoryWorkspaceBlobStore } from './define-workspace'
export { workspaceToolNames } from './tool-io'

export type {
  WorkspaceArtifact,
  WorkspaceArtifactsQuery,
  WorkspaceArtifactStatus,
  WorkspaceFinalizeOptions,
  WorkspaceProvenance,
} from './artifact-types'

export type {
  Workspace,
  WorkspaceAppendOptions,
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
  WorkspaceGrepMatch,
  WorkspaceGrepOptions,
  WorkspaceGrepResult,
  WorkspaceListEntry,
  WorkspaceListOptions,
  WorkspaceListResult,
  WorkspaceLimits,
  WorkspaceMount,
  WorkspaceMountAccess,
  WorkspaceMoveOptions,
  WorkspaceNamespaceOption,
  WorkspaceOperation,
  WorkspaceJsonContent,
  WorkspaceReadOptions,
  WorkspaceReadResult,
  WorkspaceRetention,
  WorkspaceTools,
  WorkspaceToolNames,
  WorkspaceToolOptions,
  WorkspaceWriteOptions,
} from './types'
