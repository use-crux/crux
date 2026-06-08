import type { ProjectSourceRef } from '@crux/core/project-index'
import type * as ts from 'typescript'
import type {
  SemanticAnalyzerContext,
  SemanticDefinitionCandidate,
  SemanticResolvedSource,
  SemanticSourceRefCandidate,
} from '../candidates'
import type { SemanticAnalyzer } from '../types'

export interface SemanticSourceRefAnalyzerDeps {
  readonly sourceRefCandidates: (candidate: SemanticDefinitionCandidate) => readonly SemanticSourceRefCandidate[]
  readonly resolveExpression: (expression: ts.Expression, checker: ts.TypeChecker) => SemanticResolvedSource | undefined
  readonly sourceRef: (candidate: SemanticSourceRefCandidate, resolved: SemanticResolvedSource) => ProjectSourceRef
  readonly templateInterpolationSourceRefs: (
    candidate: SemanticDefinitionCandidate,
    checker: ts.TypeChecker,
  ) => readonly ProjectSourceRef[]
  readonly agentToolMapSourceRefs: (
    candidate: SemanticDefinitionCandidate,
    checker: ts.TypeChecker,
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
            const resolved = deps.resolveExpression(refCandidate.expression, context.checker)
            return resolved ? [{ definitionId: refCandidate.definitionId, ref: deps.sourceRef(refCandidate, resolved) }] : []
          }),
          ...deps.templateInterpolationSourceRefs(candidate, context.checker).map((ref) => ({
            definitionId: candidate.definitionId,
            ref,
          })),
          ...deps.agentToolMapSourceRefs(candidate, context.checker).map((ref) => ({
            definitionId: candidate.definitionId,
            ref,
          })),
        ],
      }
    },
  }
}
