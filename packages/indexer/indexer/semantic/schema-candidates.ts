import type {
  SemanticDefinitionCandidate,
  SemanticSchemaCandidate,
  SemanticSchemaMetadataKey,
  SemanticSchemaProperty,
} from './candidates'
import {
  semanticIsResolvableSourceExpression,
  semanticPropertyInitializer,
} from './syntax-readers'
import type { SemanticSyntaxNode, SemanticSyntaxSourceFile, SemanticSyntaxView } from './syntax-view'

/**
 * Selects schema-bearing properties from an authored definition candidate.
 *
 * The returned candidates are analyzer inputs only; this function does not
 * resolve imported symbols or parse schemas.
 */
export function semanticSchemaCandidates<
  TNode extends SemanticSyntaxNode,
  TCall extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  candidate: SemanticDefinitionCandidate<TNode, TCall>,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
): SemanticSchemaCandidate<TNode, TCall, TNode>[] {
  return schemaCandidateSpecs.flatMap((spec) =>
    semanticSchemaCandidate(candidate, spec.property, spec.metadataKey, syntax),
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
function semanticSchemaCandidate<
  TNode extends SemanticSyntaxNode,
  TCall extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  candidate: SemanticDefinitionCandidate<TNode, TCall>,
  property: SemanticSchemaProperty,
  metadataKey: SemanticSchemaMetadataKey,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
): SemanticSchemaCandidate<TNode, TCall, TNode>[] {
  const expression = semanticPropertyInitializer(candidate.object, property, syntax)
  return expression && semanticIsResolvableSourceExpression(expression, syntax)
    ? [{ ...candidate, property, metadataKey, expression }]
    : []
}
