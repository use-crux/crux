/**
 * Crux-owned Indexer compiler contract entry point.
 *
 * This barrel contains only data contracts shared by Crux's bundled compiler
 * workers. Application code should use `@use-crux/core/project-index` for
 * Catalog data. Experimental third-party authoring lives exclusively at
 * `@use-crux/indexer/extensions`.
 *
 * @module
 */

export type {
  IndexPatch,
  IndexPatchBudget,
  IndexPatchFacts,
  IndexPatchPhase,
  IndexPatchStatus,
} from './indexer/patches'
export type {
  SemanticBackendName,
  SemanticBackendSelection,
  SemanticSourceProfile,
  SemanticSourceProfileFile,
  SemanticSourceProfileHints,
} from './indexer/semantic/service'
export type {
  SemanticIndexInstrumentation,
  SemanticIndexTiming,
  SemanticIndexTimingName,
} from './indexer/semantic/instrumentation'
export type {
  StaticExtractionTiming,
  StaticExtractionTimingName,
} from './indexer/static/extraction/engine'
