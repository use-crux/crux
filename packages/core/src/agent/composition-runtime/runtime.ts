import { observe } from '../../observability'
import { compositionDefinitionRef } from '../../observability/definition-ref'
import { getExecutionContext } from '../../runtime/execution-context'
import type { ExecutionContext } from '../../runtime/execution-context'
import { executeAgent, executeFunctionStep } from './execution'
import { emitCompositionReport } from './report'
import type {
  CompositionRuntime,
  CompositionRuntimeConfig,
  CompositionScope,
  CompositionStepContextInput,
} from './types'

function generateCompositionId(): string {
  return `comp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Create an internal composition runtime for one composition invocation.
 *
 * The runtime owns shared mechanics that every composition mode needs:
 * composition ids, root spans, child execution contexts, per-step spans,
 * retry wrapping, and report artifact emission.
 */
export function createCompositionRuntime(
  config: CompositionRuntimeConfig,
): CompositionRuntime {
  const compositionId = generateCompositionId()
  // Canonical Project Index definition ref for this composition. `definitionId`
  // reuses its id so span attributes and the emitted DefinitionRef stay in
  // lockstep with the indexer's `composition.<kind>:<safeId(id)>` construction.
  const definitionRef = compositionDefinitionRef(config.kind, config.id)
  const definitionId = definitionRef.id

  return {
    compositionId,
    definitionId,
    async run<T>(body: (scope: CompositionScope) => Promise<T>): Promise<T> {
      const childContext = (
        input: CompositionStepContextInput,
      ): ExecutionContext => {
        const parent = getExecutionContext()
        return {
          ...parent,
          stepId: input.stepId ?? `${compositionId}-${input.label}`,
          stepLabel: input.label,
          ...(config.sessionId ? { sessionId: config.sessionId } : {}),
        }
      }

      const scope: CompositionScope = {
        executeAgent: (input) =>
          executeAgent(compositionId, childContext, input),
        executeFunctionStep: (input) =>
          executeFunctionStep(compositionId, childContext, input),
        report: (input) => emitCompositionReport(config.kind, input),
        childContext,
      }

      return observe.span(
        {
          name: config.kind,
          primitive: `composition.${config.kind}`,
          attributes: {
            compositionId,
            definitionId,
            agentIds: [...config.agentIds],
            ...config.attributes,
          },
          definitionRefs: [definitionRef],
        },
        () => body(scope),
      )
    },
  }
}
