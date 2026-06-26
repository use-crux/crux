import type { ProjectSourceRef, ProjectSourceRefRole } from '@use-crux/core/project-index'
import type { SemanticDefinitionCandidate, SemanticDefinitionKind, SemanticSourceRefCandidate } from './candidates'
import {
  semanticIsResolvableSourceExpression,
  semanticPropertyInitializer,
} from './syntax-readers'
import type { SemanticSyntaxNode, SemanticSyntaxSourceFile, SemanticSyntaxView } from './syntax-view'

/**
 * Selects direct source-reference properties from an authored definition.
 *
 * The returned values describe which expressions should be resolved by the
 * source-ref analyzer; symbol resolution remains outside this selector.
 */
export function semanticSourceRefCandidates<
  TNode extends SemanticSyntaxNode,
  TCall extends SemanticSyntaxNode,
  TSourceFile extends TNode & SemanticSyntaxSourceFile<TNode>,
>(
  candidate: SemanticDefinitionCandidate<TNode, TCall>,
  syntax: SemanticSyntaxView<TNode, TSourceFile>,
): SemanticSourceRefCandidate<TNode, TCall, TNode>[] {
  return sourceRefPropertySpecs(candidate.kind).flatMap((spec) => {
    const expression = semanticPropertyInitializer(candidate.object, spec.property, syntax)
    return expression && semanticIsResolvableSourceExpression(expression, syntax) ? [{ ...candidate, ...spec, expression }] : []
  })
}

/**
 * Lists source-reference-bearing properties for each semantic definition kind.
 */
function sourceRefPropertySpecs(
  kind: SemanticDefinitionKind,
): Array<{ property: string; role: ProjectSourceRefRole; metadata?: ProjectSourceRef['metadata'] }> {
  switch (kind) {
    case 'prompt':
      return [
        { property: 'system', role: 'system', metadata: { fragment: true } },
        { property: 'prompt', role: 'prompt' },
        { property: 'use', role: 'config' },
        { property: 'tools', role: 'config' },
      ]
    case 'context':
      return [
        { property: 'system', role: 'system', metadata: { fragment: true } },
        { property: 'resolve', role: 'resolver' },
        { property: 'render', role: 'callback' },
        { property: 'handler', role: 'handler' },
        { property: 'when', role: 'policy' },
        { property: 'use', role: 'config' },
        { property: 'tools', role: 'config' },
      ]
    case 'injectable':
      return [
        { property: 'inject', role: 'callback' },
        { property: 'when', role: 'policy' },
        { property: 'use', role: 'config' },
        { property: 'tools', role: 'config' },
      ]
    case 'tool':
      return [
        { property: 'execute', role: 'execute' },
        { property: 'run', role: 'callback' },
        { property: 'handler', role: 'handler' },
      ]
    case 'agent':
      return [
        { property: 'prompt', role: 'config' },
        { property: 'tools', role: 'config' },
        { property: 'contextHandler', role: 'callback' },
        { property: 'usageHandler', role: 'callback' },
        { property: 'prepare', role: 'callback' },
      ]
    case 'routing.router':
      return [{ property: 'classify', role: 'callback' }]
    case 'routing.fallback':
      return [
        { property: 'shouldFallback', role: 'policy' },
        { property: 'onAttemptError', role: 'callback' },
      ]
    default:
      return []
  }
}
