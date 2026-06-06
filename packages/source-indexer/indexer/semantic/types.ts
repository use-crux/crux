import type { CatalogLintFinding, ProjectDefinition, ProjectRelation, ProjectSourceRef } from '@crux/core/catalog'

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
 * Merged graph facts available to catalog-level analyzers.
 */
export interface SemanticCatalogAnalyzerContext {
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
}

/**
 * Partial facts emitted by a catalog-level analyzer.
 */
export interface SemanticCatalogAnalyzerResult {
  readonly lintFindings?: readonly CatalogLintFinding[]
}

/**
 * Analyzer contract for facts that require the merged semantic graph.
 */
export interface SemanticCatalogAnalyzer {
  readonly name: string
  analyzeCatalog(context: SemanticCatalogAnalyzerContext): SemanticCatalogAnalyzerResult
}
