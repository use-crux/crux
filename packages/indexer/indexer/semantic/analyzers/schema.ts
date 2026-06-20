import type { JsonSchema, ProjectDefinition, ProjectSourceRef } from '@crux/core/project-index'
import type * as ts from 'typescript'
import type {
  SemanticAnalyzerContext,
  SemanticAnalyzerView,
  SemanticDefinitionCandidate,
  SemanticResolvedSource,
  SemanticSchemaCandidate,
} from '../candidates'
import type { SemanticAnalyzer } from '../types'

export interface SemanticSchemaAnalyzerDeps {
  readonly schemaCandidates: (candidate: SemanticDefinitionCandidate) => readonly SemanticSchemaCandidate[]
  readonly resolveExpression: (expression: ts.Expression, view: SemanticAnalyzerView) => SemanticResolvedSource | undefined
  readonly expressionToJsonSchema: (resolved: SemanticResolvedSource, view: SemanticAnalyzerView) => JsonSchema | undefined
  readonly definitionPatchBase: (candidate: SemanticDefinitionCandidate) => ProjectDefinition
  readonly schemaSourceRef: (
    candidate: SemanticSchemaCandidate,
    resolved: SemanticResolvedSource,
    parsedSchema: boolean,
  ) => ProjectSourceRef
  readonly nestedSchemaSourceRefs: (
    candidate: SemanticSchemaCandidate,
    resolved: SemanticResolvedSource,
    view: SemanticAnalyzerView,
  ) => readonly ProjectSourceRef[]
}

/**
 * Creates the analyzer that resolves schema expressions into index metadata and source refs.
 */
export function createSemanticSchemaAnalyzer(
  deps: SemanticSchemaAnalyzerDeps,
): SemanticAnalyzer<SemanticDefinitionCandidate, SemanticAnalyzerContext> {
  return {
    name: 'schema',
    analyze(candidate, context) {
      const facts = deps.schemaCandidates(candidate).flatMap((schemaCandidate) =>
        semanticSchemaFacts(schemaCandidate, context.view, deps),
      )
      return {
        definitions: facts.map((fact) => fact.definition),
        sourceRefs: facts.flatMap((fact) => fact.sourceRefs),
      }
    },
  }
}

/**
 * Resolves one schema candidate into its definition patch and source refs.
 */
function semanticSchemaFacts(
  schemaCandidate: SemanticSchemaCandidate,
  view: SemanticAnalyzerView,
  deps: SemanticSchemaAnalyzerDeps,
): Array<{
  readonly definition: ProjectDefinition
  readonly sourceRefs: readonly { definitionId: string; ref: ProjectSourceRef }[]
}> {
  const resolved = deps.resolveExpression(schemaCandidate.expression, view)
  if (!resolved?.expression) return []
  const schema = deps.expressionToJsonSchema(resolved, view)
  if (!schema) return []

  return [{
    definition: {
      ...deps.definitionPatchBase(schemaCandidate),
      metadata: { [schemaCandidate.metadataKey]: schema },
    },
    sourceRefs: [
      {
        definitionId: schemaCandidate.definitionId,
        ref: deps.schemaSourceRef(schemaCandidate, resolved, Boolean(schema)),
      },
      ...deps.nestedSchemaSourceRefs(schemaCandidate, resolved, view).map((ref) => ({
        definitionId: schemaCandidate.definitionId,
        ref,
      })),
    ],
  }]
}
