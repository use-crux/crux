import { observe } from '../../observability'
import { withOperationResultMeta } from '../../observability/internal/result-meta'
import { runPassiveEffectBoundary } from '../../effect/internal/boundary'
import { compositionDefinitionRef, parallelBranchDefinitionRef } from '../../observability/definition-ref'
import { getExecutionContext } from '../../runtime/execution-context'
import type { ExecutionContext } from '../../runtime/execution-context'
import { executeAgent, executeFunctionStep } from './execution'
import { emitCompositionReport } from './report'
import {
  createPrepareInvocationState,
  recordPrepareInvocationOutcome,
} from '../../request/prepare/invocation'
import {
  nestedRequestReceiptTree,
  type CompositionRequestReceiptNode,
} from '../../request/receipt/tree'
import { isAgent } from '../agent'
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
  const preparationState = createPrepareInvocationState()
  const requestNodes: CompositionRequestReceiptNode[] = []

  return {
    compositionId,
    definitionId,
    async run<T extends object>(
      body: (scope: CompositionScope) => Promise<T>,
    ) {
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
        executeAgent: async (input) => {
          const result = await executeAgent(
            compositionId,
            childContext,
            input,
            config.kind === 'parallel'
              ? parallelBranchDefinitionRef(config.id, input.label)
              : undefined,
            config.prepareInvocation,
            preparationState,
          )
          recordPrepareInvocationOutcome(preparationState, result.usage)
          if (isAgent(input.agent)) {
            requestNodes.push(Object.freeze({
              kind: 'invocation',
              label: input.label,
              index: input.index,
              target: Object.freeze({
                id: input.agent.id,
                operation: 'language',
              }),
              receipts: Object.freeze([...(result.requests ?? [])]),
            }))
          } else {
            const tree = nestedRequestReceiptTree(result.output)
            if (tree) {
              requestNodes.push(Object.freeze({
                kind: 'composition',
                label: input.label,
                index: input.index,
                tree,
              }))
            }
          }
          return result
        },
        executeFunctionStep: async (input) => {
          const result = await executeFunctionStep(
            compositionId,
            childContext,
            input,
          )
          const tree = nestedRequestReceiptTree(result.output)
          if (tree) {
            requestNodes.push(Object.freeze({
              kind: 'composition',
              label: input.label,
              index: input.index,
              tree,
            }))
          }
          return result
        },
        report: (input) => emitCompositionReport(config.kind, input),
        childContext,
        requestReceipts: () => Object.freeze({
          composition: Object.freeze({
            id: config.id,
            executionId: compositionId,
            kind: config.kind,
          }),
          children: Object.freeze(
            [...requestNodes].sort((left, right) => left.index - right.index),
          ),
        }),
      }

      const compositionSpan = observe.openSpan({
        name: config.kind,
        primitive: `composition.${config.kind}`,
        attributes: {
          compositionId,
          definitionId,
          agentIds: [...config.agentIds],
          ...config.attributes,
        },
        definitionRefs: [definitionRef],
      })

      try {
        const result = await compositionSpan.withContext(() =>
          runPassiveEffectBoundary(compositionId, async (boundary) => {
            const payload = await body(scope)
            return withOperationResultMeta(
              { ...payload, effects: boundary.ref },
              {
                traceId: compositionSpan.traceId,
                spanId: compositionSpan.spanId,
              },
            )
          }),
        )
        compositionSpan.end()
        return result
      } catch (error) {
        compositionSpan.error(error)
        throw error
      }
    },
  }
}
