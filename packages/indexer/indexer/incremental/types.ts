import type { ProjectIndexSnapshot } from '@use-crux/core/project-index'

/**
 * Absolute source file path normalized against one project root.
 *
 * Planner graph traversal should use this branded type after path normalization so raw caller input
 * cannot be mixed with graph keys accidentally.
 */
export type AbsoluteSourceFilePath = string & { readonly __brand: 'AbsoluteSourceFilePath' }

/**
 * Planner confidence in the previous index graph evidence.
 *
 * Partial plans require `complete-enough-for-source-closure`; all other values should lead to a
 * conservative full reindex decision.
 */
export type GraphConfidence =
  | 'complete-enough-for-source-closure'
  | 'missing-previous-index'
  | 'missing-source-graph'
  | 'missing-dependent-edges'
  | 'unknown-file'
  | 'config-or-resolver-changed'
  | 'unresolved-imports-present'
  | 'closure-budget-exceeded'
  | 'source-graph-marker-missing'
  | 'cross-shard-evidence-incomplete'
  | 'deleted-file-unknown'
  | 'deleted-file-unsafe'

/**
 * Stable reason code for a full reindex fallback.
 *
 * A full reindex fallback is expected correctness behavior whenever graph evidence cannot prove a
 * complete affected closure.
 */
export type FullReindexReason =
  | 'dependency-graph-not-materialized'
  | 'missing-previous-index'
  | 'missing-source-graph'
  | 'missing-dependent-edges'
  | 'unknown-file'
  | 'config-or-resolver-changed'
  | 'unresolved-imports-present'
  | 'closure-budget-exceeded'
  | 'source-graph-marker-missing'
  | 'cross-shard-evidence-incomplete'
  | 'deleted-file-unknown'
  | 'deleted-file-unsafe'

/**
 * Machine-readable explanation for worker logs and future UI surfacing.
 *
 * This explains the planner decision only. It does not imply that partial indexing execution exists.
 */
export interface IncrementalDecisionExplanation {
  readonly summary: string
  readonly graphAvailable: boolean
  readonly fallbackUsed: boolean
  readonly traversedFiles: readonly string[]
}

/**
 * Options for planning index work after file changes.
 */
export interface IndexFilesOptions {
  readonly root: string
  readonly files: readonly string[]
  readonly deletedFiles?: readonly string[]
  readonly previousIndex?: ProjectIndexSnapshot
  /**
   * Current source hash evidence for changed files.
   *
   * The planner stays pure: callers that already read the edited source can
   * pass the new full-source hash and exported-interface hash here. Missing
   * evidence keeps the conservative dependent-closure behavior.
   */
  readonly currentSources?: readonly IncrementalSourceHashEvidence[]
  readonly maxAffectedFiles?: number
}

/** Hash evidence for one current changed source file. */
export interface IncrementalSourceHashEvidence {
  /** Absolute or project-relative source file path. */
  readonly file: string
  /** SHA-256 hash of the exact UTF-8 source text. */
  readonly sourceHash: string
  /** SHA-256 hash of the exported surface dependent files can observe. */
  readonly interfaceHash?: string
}

/**
 * Decision to rebuild the complete Project Index.
 *
 * This is the safe fallback whenever previous graph evidence is missing, incomplete, ambiguous, or
 * too broad to optimize.
 */
export interface FullReindexRequiredDecision {
  readonly kind: 'full-reindex-required'
  readonly reason: FullReindexReason
  readonly root: string
  readonly files: readonly string[]
  readonly changedFiles: readonly string[]
  readonly deletedFiles: readonly string[]
  readonly graphConfidence: Exclude<GraphConfidence, 'complete-enough-for-source-closure'>
  readonly previousIndexDefinitionCount: number
  readonly explanation: IncrementalDecisionExplanation
}

/**
 * Decision describing a safe source-file-only index refresh.
 *
 * This is planning-only. It does not execute AST indexing by itself.
 */
export interface SourceFileReindexDecision {
  readonly kind: 'source-file-reindex'
  readonly root: string
  readonly changedFiles: readonly string[]
  readonly deletedFiles: readonly string[]
  readonly affectedFiles: readonly string[]
  readonly affectedDefinitionIds: readonly string[]
  readonly graphConfidence: 'complete-enough-for-source-closure'
  readonly explanation: IncrementalDecisionExplanation
}

/**
 * Decision describing a safe reverse dependency closure refresh.
 *
 * This is planning-only. It is valid only when dependents in the previous index graph explain the
 * complete affected closure.
 */
export interface DependencyClosureReindexDecision {
  readonly kind: 'dependency-closure-reindex'
  readonly root: string
  readonly changedFiles: readonly string[]
  readonly deletedFiles: readonly string[]
  readonly affectedFiles: readonly string[]
  readonly affectedDefinitionIds: readonly string[]
  readonly graphConfidence: 'complete-enough-for-source-closure'
  readonly explanation: IncrementalDecisionExplanation
}

/**
 * Decision vocabulary for future semantic partial refreshes.
 *
 * Initial execution may still treat this as a full reindex until a safe semantic partial executor
 * exists.
 */
export interface SemanticClosureReindexDecision {
  readonly kind: 'semantic-closure-reindex'
  readonly root: string
  readonly changedFiles: readonly string[]
  readonly deletedFiles: readonly string[]
  readonly affectedFiles: readonly string[]
  readonly affectedDefinitionIds: readonly string[]
  readonly graphConfidence: 'complete-enough-for-source-closure'
  readonly explanation: IncrementalDecisionExplanation
}

/**
 * Planning result for changed files.
 */
export type IncrementalIndexDecision =
  | FullReindexRequiredDecision
  | SourceFileReindexDecision
  | DependencyClosureReindexDecision
  | SemanticClosureReindexDecision
