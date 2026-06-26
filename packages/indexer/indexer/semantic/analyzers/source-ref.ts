import type { ProjectSourceRef } from '@use-crux/core/project-index'
import type {
  SemanticAnalyzerContext,
  SemanticAnalyzerView,
  SemanticDefinitionCandidate,
  SemanticResolvedSource,
  SemanticSourceRefCandidate,
} from '../candidates'
import type { SemanticSyntaxNode } from '../syntax-view'
import type { SemanticAnalyzer } from '../types'

export interface SemanticSourceRefAnalyzerDeps {
  readonly sourceRefCandidates: (
    candidate: SemanticDefinitionCandidate,
    view: SemanticAnalyzerView,
  ) => readonly SemanticSourceRefCandidate[]
  readonly resolveExpression: (
    expression: SemanticSyntaxNode,
    view: SemanticAnalyzerView,
  ) => SemanticResolvedSource | undefined
  readonly sourceRef: (
    candidate: SemanticSourceRefCandidate,
    resolved: SemanticResolvedSource,
    view: SemanticAnalyzerView,
  ) => ProjectSourceRef
  readonly templateInterpolationSourceRefs: (
    candidate: SemanticDefinitionCandidate,
    view: SemanticAnalyzerView,
  ) => readonly ProjectSourceRef[]
  readonly toolMapSourceRefs: (
    candidate: SemanticDefinitionCandidate,
    view: SemanticAnalyzerView,
  ) => readonly ProjectSourceRef[]
  readonly injectionConditionSourceRefs: (
    candidate: SemanticDefinitionCandidate,
    view: SemanticAnalyzerView,
  ) => readonly ProjectSourceRef[]
}

/**
 * Creates the analyzer that resolves direct source-ref expressions for authored definitions.
 */
export function createSemanticSourceRefAnalyzer(
  deps: SemanticSourceRefAnalyzerDeps,
): SemanticAnalyzer<SemanticDefinitionCandidate, SemanticAnalyzerContext> {
  return {
    name: 'source-ref',
    analyze(candidate, context) {
      return {
        sourceRefs: [
          ...deps.sourceRefCandidates(candidate, context.view).flatMap((refCandidate) => {
            const resolved = deps.resolveExpression(refCandidate.expression, context.view)
            return resolved
              ? [{ definitionId: refCandidate.definitionId, ref: deps.sourceRef(refCandidate, resolved, context.view) }]
              : []
          }),
          ...deps.templateInterpolationSourceRefs(candidate, context.view).map((ref) => ({
            definitionId: candidate.definitionId,
            ref,
          })),
          ...deps.toolMapSourceRefs(candidate, context.view).map((ref) => ({
            definitionId: candidate.definitionId,
            ref,
          })),
          ...deps.injectionConditionSourceRefs(candidate, context.view).map((ref) => ({
            definitionId: candidate.definitionId,
            ref,
          })),
        ],
      }
    },
  }
}
