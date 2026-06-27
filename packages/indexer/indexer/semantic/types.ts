import type { IndexLintFinding, ProjectDefinition, ProjectRelation, ProjectSourceRef } from '@use-crux/core/project-index'

/**
 * Partial facts emitted by one semantic analyzer for one candidate.
 */
export interface SemanticAnalyzerResult {
  readonly definitions?: readonly ProjectDefinition[]
  readonly sourceRefs?: readonly { definitionId: string; ref: ProjectSourceRef }[]
  readonly relations?: readonly ProjectRelation[]
}

/**
 * Candidate-level analyzer contract for focused semantic enrichment passes.
 */
export interface SemanticAnalyzer<TCandidate, TContext> {
  readonly name: string
  analyze(candidate: TCandidate, context: TContext): SemanticAnalyzerResult
}

/**
 * Merged graph facts available to index-level analyzers.
 */
export interface SemanticIndexAnalyzerContext {
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
}

/**
 * Partial facts emitted by a index-level analyzer.
 */
export interface SemanticIndexAnalyzerResult {
  readonly lintFindings?: readonly IndexLintFinding[]
}

/**
 * Analyzer contract for facts that require the merged semantic graph.
 */
export interface SemanticIndexAnalyzer {
  readonly name: string
  analyzeIndex(context: SemanticIndexAnalyzerContext): SemanticIndexAnalyzerResult
}
