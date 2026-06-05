import type { CatalogLintFinding, ProjectDefinition, ProjectRelation, ProjectSourceRef } from '@crux/core/catalog'

export interface SemanticAnalyzerResult {
  readonly definitions?: readonly ProjectDefinition[]
  readonly sourceRefs?: readonly { definitionId: string; ref: ProjectSourceRef }[]
  readonly relations?: readonly ProjectRelation[]
}

export interface SemanticAnalyzer<TCandidate, TContext> {
  readonly name: string
  analyze(candidate: TCandidate, context: TContext): SemanticAnalyzerResult
}

export interface SemanticCatalogAnalyzerContext {
  readonly definitions: readonly ProjectDefinition[]
  readonly relations: readonly ProjectRelation[]
}

export interface SemanticCatalogAnalyzerResult {
  readonly lintFindings?: readonly CatalogLintFinding[]
}

export interface SemanticCatalogAnalyzer {
  readonly name: string
  analyzeCatalog(context: SemanticCatalogAnalyzerContext): SemanticCatalogAnalyzerResult
}
