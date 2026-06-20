import type { ProjectSourceRef } from '@crux/core/project-index'
import type * as ts from 'typescript'
import type {
  SemanticAnalyzerContext,
  SemanticAnalyzerView,
  SemanticDefinitionCandidate,
  SemanticResolvedSource,
  SemanticSourceRefCandidate,
} from '../candidates'
import type { SemanticAnalyzer } from '../types'

export interface SemanticSourceRefAnalyzerDeps {
  readonly sourceRefCandidates: (candidate: SemanticDefinitionCandidate) => readonly SemanticSourceRefCandidate[]
  readonly resolveExpression: (expression: ts.Expression, view: SemanticAnalyzerView) => SemanticResolvedSource | undefined
  readonly sourceRef: (candidate: SemanticSourceRefCandidate, resolved: SemanticResolvedSource) => ProjectSourceRef
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
          ...deps.sourceRefCandidates(candidate).flatMap((refCandidate) => {
            const resolved = deps.resolveExpression(refCandidate.expression, context.view)
            return resolved
              ? [{ definitionId: refCandidate.definitionId, ref: deps.sourceRef(refCandidate, resolved) }]
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
