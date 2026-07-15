import type { ProjectIndexManifestDefinition } from '../../project-index/manifest'
import type { DefinitionRef } from '../contract'

/** Exact outcome of resolving runtime evidence against a deployment manifest. */
export type CruxManifestResolutionState =
  | 'resolved'
  | 'definition-unresolved'
  | 'manifest-unresolved'
  | 'manifest-unspecified'
  | 'project-mismatch'

/** Historical resolution of one runtime definition reference. */
export interface CruxHistoricalDefinitionResolution {
  ref: DefinitionRef
  resolution: CruxManifestResolutionState
  definition?: ProjectIndexManifestDefinition
}

/** Exact historical manifest resolution for one run. */
export interface CruxRunManifestResolution {
  projectId?: string
  manifestId?: string
  resolution: CruxManifestResolutionState
  definitions: CruxHistoricalDefinitionResolution[]
}

/** Identity-only comparison of one runtime ref with the current checkout. */
export interface CruxCurrentCatalogDefinitionComparison {
  definitionId: string
  matched: boolean
}

/**
 * Explicitly non-historical comparison with the current Project Index.
 *
 * This data must never substitute for `CruxRunManifestResolution` when an
 * exact historical manifest cannot be loaded.
 */
export interface CruxCurrentCatalogComparison {
  label: 'current-catalog'
  projectId?: string
  resolution: CruxManifestResolutionState
  definitions: CruxCurrentCatalogDefinitionComparison[]
}
