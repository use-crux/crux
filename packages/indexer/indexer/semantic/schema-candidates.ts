import type * as ts from 'typescript'
import type {
  SemanticDefinitionCandidate,
  SemanticSchemaCandidate,
  SemanticSchemaMetadataKey,
  SemanticSchemaProperty,
} from './candidates'

export interface SemanticSchemaCandidateDeps {
  readonly isResolvableSourceExpression: (expression: ts.Expression) => boolean
  readonly propertyInitializer: (object: ts.ObjectLiteralExpression, name: string) => ts.Expression | undefined
}

/**
 * Selects schema-bearing properties from an authored definition candidate.
 *
 * The returned candidates are analyzer inputs only; this function does not
 * resolve imported symbols or parse schemas.
 */
export function semanticSchemaCandidates(
  candidate: SemanticDefinitionCandidate,
  deps: SemanticSchemaCandidateDeps,
): SemanticSchemaCandidate[] {
  return schemaCandidateSpecs.flatMap((spec) =>
    semanticSchemaCandidate(candidate, spec.property, spec.metadataKey, deps),
  )
}

const schemaCandidateSpecs: readonly {
  readonly property: SemanticSchemaProperty
  readonly metadataKey: SemanticSchemaMetadataKey
}[] = [
  { property: 'input', metadataKey: 'inputSchema' },
  { property: 'inputSchema', metadataKey: 'inputSchema' },
  { property: 'output', metadataKey: 'outputSchema' },
  { property: 'parameters', metadataKey: 'inputSchema' },
  { property: 'args', metadataKey: 'argsSchema' },
  { property: 'schema', metadataKey: 'schema' },
]

/**
 * Converts a single property into a schema candidate when it is resolvable.
 */
function semanticSchemaCandidate(
  candidate: SemanticDefinitionCandidate,
  property: SemanticSchemaProperty,
  metadataKey: SemanticSchemaMetadataKey,
  deps: SemanticSchemaCandidateDeps,
): SemanticSchemaCandidate[] {
  const expression = deps.propertyInitializer(candidate.object, property)
  return expression && deps.isResolvableSourceExpression(expression)
    ? [{ ...candidate, property, metadataKey, expression }]
    : []
}
