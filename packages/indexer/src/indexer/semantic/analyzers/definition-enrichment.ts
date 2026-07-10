import type {
  SemanticAnalyzerContext,
  SemanticAnalyzerView,
  SemanticDefinitionCandidate,
  SemanticDefinitionEnrichment,
} from '../candidates'
import type { SemanticAnalyzer } from '../types'

export interface SemanticDefinitionEnrichmentAnalyzerDeps {
  readonly definitionEnrichments: (
    candidate: SemanticDefinitionCandidate,
    view: SemanticAnalyzerView,
  ) => readonly SemanticDefinitionEnrichment[]
}

/**
 * Creates the analyzer that emits semantic child definitions and their attached facts.
 */
export function createSemanticDefinitionEnrichmentAnalyzer(
  deps: SemanticDefinitionEnrichmentAnalyzerDeps,
): SemanticAnalyzer<SemanticDefinitionCandidate, SemanticAnalyzerContext> {
  return {
    name: 'definition-enrichment',
    analyze(candidate, context) {
      const enrichments = deps.definitionEnrichments(candidate, context.view)

      return {
        definitions: enrichments.map((enrichment) => enrichment.definition),
        sourceRefs: enrichments.flatMap((enrichment) =>
          (enrichment.sourceRefs ?? []).map((ref) => ({
            definitionId: enrichment.definition.id,
            ref,
          })),
        ),
        relations: enrichments.flatMap((enrichment) => enrichment.relations ?? []),
      }
    },
  }
}
