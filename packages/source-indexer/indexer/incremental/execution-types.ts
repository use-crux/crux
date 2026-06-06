import type { CatalogPatch } from '../patches'
import type { IncrementalIndexDecision } from './types'

/**
 * Incremental execution mode.
 *
 * `ast` produces source-only catalog patches. Later phases can add semantic/full orchestration while
 * preserving the same planner and report contract.
 */
export type IncrementalExecutionMode = 'ast' | 'ast-and-semantic'

/**
 * Options for executing an incremental indexing plan against a previous catalog snapshot.
 */
export interface IndexProjectIncrementalOptions {
  readonly root: string
  readonly files: readonly string[]
  readonly deletedFiles?: readonly string[]
  readonly previousCatalog: import('@crux/core/catalog').ProjectCatalogSnapshot
  readonly projectName?: string
  readonly configPath?: string
  readonly mode: IncrementalExecutionMode
  readonly maxAffectedFiles?: number
}

/**
 * JSON-safe execution report for worker logs and future devtools surfacing.
 */
export interface IncrementalExecutionReport {
  readonly planKind: IncrementalIndexDecision['kind']
  readonly fallbackUsed: boolean
  readonly fallbackReason?: string
  readonly graphConfidence: IncrementalIndexDecision['graphConfidence']
  readonly changedFiles: readonly string[]
  readonly deletedFiles: readonly string[]
  readonly affectedFiles: readonly string[]
  readonly affectedDefinitionIds: readonly string[]
  readonly staticParsedFiles: readonly string[]
  readonly staticCacheHits: number
  readonly staticCacheMisses: number
  readonly semanticAnalyzedFiles: readonly string[]
  readonly semanticCacheHits: number
  readonly semanticCacheMisses: number
  readonly invalidatedFiles: readonly string[]
  readonly invalidatedDefinitionIds: readonly string[]
  readonly durationMsByPhase: Readonly<Record<string, number>>
}

/**
 * Result of an incremental indexing execution attempt.
 */
export interface IncrementalIndexExecutionResult {
  readonly decision: IncrementalIndexDecision
  readonly patches: readonly CatalogPatch[]
  readonly report: IncrementalExecutionReport
}
