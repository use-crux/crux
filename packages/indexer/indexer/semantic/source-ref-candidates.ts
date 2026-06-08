import type { ProjectSourceRef, ProjectSourceRefRole } from '@crux/core/project-index'
import type * as ts from 'typescript'
import type {
  SemanticDefinitionCandidate,
  SemanticDefinitionKind,
  SemanticSourceRefCandidate,
} from './candidates'

export interface SemanticSourceRefCandidateDeps {
  readonly isResolvableSourceExpression: (expression: ts.Expression) => boolean
  readonly propertyInitializer: (object: ts.ObjectLiteralExpression, name: string) => ts.Expression | undefined
}

/**
 * Selects direct source-reference properties from an authored definition candidate.
 *
 * The returned values describe which expressions should be resolved by the
 * source-ref analyzer; symbol resolution remains outside this selector.
 */
export function semanticSourceRefCandidates(
  candidate: SemanticDefinitionCandidate,
  deps: SemanticSourceRefCandidateDeps,
): SemanticSourceRefCandidate[] {
  return sourceRefPropertySpecs(candidate.kind).flatMap((spec) => {
    const expression = deps.propertyInitializer(candidate.object, spec.property)
    return expression && deps.isResolvableSourceExpression(expression)
      ? [{ ...candidate, ...spec, expression }]
      : []
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
      ]
    case 'context':
      return [
        { property: 'system', role: 'system', metadata: { fragment: true } },
        { property: 'resolve', role: 'resolver' },
        { property: 'render', role: 'callback' },
        { property: 'handler', role: 'handler' },
        { property: 'when', role: 'policy' },
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
      return [
        { property: 'classify', role: 'callback' },
      ]
    case 'routing.fallback':
      return [
        { property: 'shouldFallback', role: 'policy' },
        { property: 'onAttemptError', role: 'callback' },
      ]
    default:
      return []
  }
}
