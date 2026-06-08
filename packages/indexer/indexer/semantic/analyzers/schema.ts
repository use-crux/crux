import type { JsonSchema, ProjectDefinition, ProjectSourceRef } from '@crux/core/project-index'
import type * as ts from 'typescript'
import type {
  SemanticAnalyzerContext,
  SemanticDefinitionCandidate,
  SemanticResolvedSource,
  SemanticSchemaCandidate,
} from '../candidates'
import type { SemanticAnalyzer } from '../types'

export interface SemanticSchemaAnalyzerDeps {
  readonly schemaCandidates: (candidate: SemanticDefinitionCandidate) => readonly SemanticSchemaCandidate[]
  readonly resolveExpression: (expression: ts.Expression, checker: ts.TypeChecker) => SemanticResolvedSource | undefined
  readonly expressionToJsonSchema: (resolved: SemanticResolvedSource, checker: ts.TypeChecker) => JsonSchema | undefined
  readonly definitionPatchBase: (candidate: SemanticDefinitionCandidate) => ProjectDefinition
  readonly schemaSourceRef: (
    candidate: SemanticSchemaCandidate,
    resolved: SemanticResolvedSource,
    parsedSchema: boolean,
  ) => ProjectSourceRef
  readonly nestedSchemaSourceRefs: (
    candidate: SemanticSchemaCandidate,
    resolved: SemanticResolvedSource,
    checker: ts.TypeChecker,
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
        semanticSchemaFacts(schemaCandidate, context.checker, deps),
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
  checker: ts.TypeChecker,
  deps: SemanticSchemaAnalyzerDeps,
): Array<{
  readonly definition: ProjectDefinition
  readonly sourceRefs: readonly { definitionId: string; ref: ProjectSourceRef }[]
}> {
  const resolved = deps.resolveExpression(schemaCandidate.expression, checker)
  if (!resolved?.expression) return []
  const schema = deps.expressionToJsonSchema(resolved, checker)
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
      ...deps.nestedSchemaSourceRefs(schemaCandidate, resolved, checker).map((ref) => ({
        definitionId: schemaCandidate.definitionId,
        ref,
      })),
    ],
  }]
}
