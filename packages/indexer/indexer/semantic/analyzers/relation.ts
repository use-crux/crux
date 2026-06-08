import type { ProjectRelation } from '@crux/core/project-index'
import type * as ts from 'typescript'
import type { SemanticAnalyzerContext, SemanticDefinitionCandidate } from '../candidates'
import type { SemanticAnalyzer } from '../types'

export interface SemanticRelationAnalyzerDeps {
  readonly relationsForCandidate: (candidate: SemanticDefinitionCandidate, checker: ts.TypeChecker) => readonly ProjectRelation[]
}

/**
 * Creates the analyzer that resolves graph edges for a semantic definition candidate.
 */
export function createSemanticRelationAnalyzer(
  deps: SemanticRelationAnalyzerDeps,
): SemanticAnalyzer<SemanticDefinitionCandidate, SemanticAnalyzerContext> {
  return {
    name: 'relation',
    analyze(candidate, context) {
      return {
        relations: deps.relationsForCandidate(candidate, context.checker),
      }
    },
  }
}
