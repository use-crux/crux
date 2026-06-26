import type { IndexPatch } from '../patches'
import type { SemanticIndexInstrumentation } from '../semantic/instrumentation'
import type { SemanticBackendSelection } from '../semantic/service'
import type { IncrementalIndexDecision } from './types'

/**
 * Incremental execution mode.
 *
 * `ast` produces source-only index patches. Later phases can add semantic/full orchestration while
 * preserving the same planner and report contract.
 */
export type IncrementalExecutionMode = 'ast' | 'ast-and-semantic'

/** Semantic phase status for one incremental execution result. */
export type IncrementalSemanticStatus = 'not-requested' | 'ready' | 'degraded'

/** Patch counts emitted by an incremental execution. */
export interface IncrementalPatchCounts {
  /** Number of AST/source patches emitted. */
  readonly ast: number
  /** Number of semantic patches emitted. */
  readonly semantic: number
  /** Total patch count emitted over the worker stream. */
  readonly total: number
}

/**
 * Options for executing an incremental indexing plan against a previous index snapshot.
 */
export interface IndexProjectIncrementalOptions {
  /** Project root used to normalize changed files and execute fallback indexing when needed. */
  readonly root: string
  /** Changed files reported by the watcher or HTTP incremental reindex request. */
  readonly files: readonly string[]
  /** Deleted files reported separately so invalidation can distinguish missing source from edits. */
  readonly deletedFiles?: readonly string[]
  /** Previous Project Index snapshot that supplies trusted source graph evidence. */
  readonly previousIndex: import('@use-crux/core/project-index').ProjectIndexSnapshot
  /** Optional project name supplied by an embedding CLI or local runtime. */
  readonly projectName?: string
  /** Optional Crux config path, relative to `root` unless already absolute. */
  readonly configPath?: string
  /** Controls whether this worker run emits only AST/source patches or includes semantic patches. */
  readonly mode: IncrementalExecutionMode
  /** Built-in semantic backend selection used when `mode` includes semantic execution. */
  readonly semanticBackend?: SemanticBackendSelection
  /** Optional semantic timing and native coverage hook for benchmarks and parity tests. */
  readonly semanticInstrumentation?: SemanticIndexInstrumentation
  /** Maximum affected closure size before the planner conservatively falls back to full indexing. */
  readonly maxAffectedFiles?: number
}

/**
 * JSON-safe execution report for worker logs and future devtools surfacing.
 */
export interface IncrementalExecutionReport {
  /** Planner decision kind used for this run. */
  readonly planKind: IncrementalIndexDecision['kind']
  /** Whether the worker intentionally fell back to full indexing. */
  readonly fallbackUsed: boolean
  /** Stable fallback reason when `fallbackUsed` is true. */
  readonly fallbackReason?: string
  /** Planner confidence label for the previous source graph evidence. */
  readonly graphConfidence: IncrementalIndexDecision['graphConfidence']
  /** Normalized changed files considered by the planner. */
  readonly changedFiles: readonly string[]
  /** Normalized deleted files considered by the planner. */
  readonly deletedFiles: readonly string[]
  /** Files covered by the selected incremental or fallback execution. */
  readonly affectedFiles: readonly string[]
  /** Definition ids invalidated or refreshed by this run. */
  readonly affectedDefinitionIds: readonly string[]
  /** Files parsed by the static AST executor. */
  readonly staticParsedFiles: readonly string[]
  /** Static extraction cache hits observed during execution. */
  readonly staticCacheHits: number
  /** Static extraction cache misses observed during execution. */
  readonly staticCacheMisses: number
  /** Files analyzed by the semantic executor when semantic mode is enabled. */
  readonly semanticAnalyzedFiles: readonly string[]
  /** Semantic cache hits observed during execution. */
  readonly semanticCacheHits: number
  /** Semantic cache misses observed during execution. */
  readonly semanticCacheMisses: number
  /** Files explicitly invalidated by emitted patches. */
  readonly invalidatedFiles: readonly string[]
  /** Definition ids explicitly invalidated by emitted patches. */
  readonly invalidatedDefinitionIds: readonly string[]
  /** Bounded phase timing map in milliseconds. */
  readonly durationMsByPhase: Readonly<Record<string, number>>
  /** Patch counts emitted for this incremental run. */
  readonly patchCounts: IncrementalPatchCounts
  /** Number of AST source-profile rows handed off for semantic reuse. */
  readonly sourceProfileFileCount: number
  /** Semantic execution status for this worker run. */
  readonly semanticStatus: IncrementalSemanticStatus
}

/**
 * Result of an incremental indexing execution attempt.
 */
export interface IncrementalIndexExecutionResult {
  readonly decision: IncrementalIndexDecision
  readonly patches: readonly IndexPatch[]
  readonly report: IncrementalExecutionReport
}
