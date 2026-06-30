/**
 * Public types for the workspace artifacts facet.
 *
 * @module
 */

import type { JsonValue } from '../types/tool'
import type { WorkspaceNamespaceOption } from './types'

/** Lifecycle state for a workspace file used as an app-facing artifact. */
export type WorkspaceArtifactStatus = 'draft' | 'final'

/** Provenance captured from the active observability run/span when available. */
export interface WorkspaceProvenance {
  readonly runId?: string
  readonly spanId?: string
  readonly sources?: readonly string[]
}

/** A draft or final artifact projected from a workspace file record. */
export interface WorkspaceArtifact {
  readonly path: string
  readonly kind?: string
  readonly status: WorkspaceArtifactStatus
  /**
   * The published version this artifact resolves to. `finalize()` pins the
   * current version, so a `final` artifact keeps surfacing this revision even as
   * the working file is edited further. Use `read(path, { version })` to fetch
   * the pinned content for an inline artifact.
   */
  readonly version?: number
  readonly mimeType: string
  readonly size: number
  readonly uri?: string
  readonly preview?: string
  readonly producedBy?: WorkspaceProvenance
  readonly metadata?: Record<string, JsonValue>
  readonly createdAt: number
  readonly updatedAt: number
}

/** Query options for `Workspace.artifacts()`. */
export interface WorkspaceArtifactsQuery extends WorkspaceNamespaceOption {
  readonly status?: WorkspaceArtifactStatus
  readonly kind?: string
  readonly path?: string
}

/** Options for `Workspace.finalize()`. */
export interface WorkspaceFinalizeOptions extends WorkspaceNamespaceOption {
  readonly kind?: string
}
