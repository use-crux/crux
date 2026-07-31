import { isAgent } from '../agent'
import type { AgentResult, AgentResultPayload } from '../executor'
import type { ExecuteOptions } from '../executor'
import { executeWithRetry } from '../../generation/retry'
import { observe } from '../../observability'
import type { DefinitionRef } from '../../observability'
import { agentDefinitionRef } from '../../observability/definition-ref'
import { withOperationResultMeta } from '../../observability/internal/result-meta'
import { runWithExecutionContext } from '../../runtime/execution-context'
import type { ExecutionContext } from '../../runtime/execution-context'
import { runScope } from '../../scope/kernel'
import { promptScopeSourceRef } from '../../scope/source-ref'
import type {
  CompositionAgentExecution,
  CompositionFunctionExecution,
  CompositionStepContextInput,
} from './types'
import {
  prepareInvocation as prepareChildInvocation,
  type PrepareInvocation,
  type PrepareInvocationState,
} from '../../request/prepare/invocation'

function agentIdFor(input: CompositionAgentExecution): string {
  return isAgent(input.agent) ? input.agent.id : input.label
}

interface ObservedAgentRun<TOutput> {
  readonly compositionId: string
  readonly label: string
  readonly index: number
  readonly agentId: string
  readonly context: ExecutionContext
  readonly attributes?: Readonly<Record<string, unknown>>
  readonly definitionRefs?: readonly DefinitionRef[]
  readonly triggeredBy?: CompositionAgentExecution['triggeredBy']
  readonly sourceRef?: ReturnType<typeof promptScopeSourceRef>
  readonly invoke: () => Promise<AgentResultPayload<TOutput>>
}

async function observeAgentRun<TOutput>(
  input: ObservedAgentRun<TOutput>,
): Promise<AgentResult<TOutput>> {
  const agentSpan = observe.openSpan({
    name: input.label,
    primitive: 'agent.run',
    attributes: {
      compositionId: input.compositionId,
      agentId: input.agentId,
      stepLabel: input.label,
      index: input.index,
      ...input.attributes,
    },
    ...(input.definitionRefs && input.definitionRefs.length > 0
      ? { definitionRefs: [...input.definitionRefs] }
      : {}),
  })

  if (input.triggeredBy) {
    observe.edge({
      edgeType: 'triggered',
      from: { kind: 'span', id: input.triggeredBy.spanId },
      to: { kind: 'span', id: agentSpan.spanId },
      attributes: input.triggeredBy.attributes,
    })
  }

  try {
    const payload = await agentSpan.withContext(() =>
      runWithExecutionContext(input.context, () =>
        runScope(
          {
            kind: 'agent-turn',
            name: input.agentId,
            ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
          },
          {},
          input.invoke,
        ),
      ),
    )
    const result = withOperationResultMeta(payload, {
      traceId: agentSpan.traceId,
      spanId: agentSpan.spanId,
    })
    agentSpan.end({ attributes: { agentId: result.agentId } })
    return result
  } catch (error) {
    agentSpan.error(error)
    throw error
  }
}

/** Execute an agent or plain function under shared composition lifecycle handling. */
export async function executeAgent<TOutput>(
  compositionId: string,
  childContext: (input: CompositionStepContextInput) => ExecutionContext,
  input: CompositionAgentExecution<TOutput>,
  childDefinitionRef?: DefinitionRef,
  prepareInvocation?: PrepareInvocation,
  preparationState?: PrepareInvocationState,
): Promise<AgentResult<TOutput>> {
  if (input.flowStep) {
    const stepId = `${compositionId}-${input.label}-${input.index}`
    return observe.span(
      {
        name: input.label,
        primitive: 'flow.step',
        attributes: {
          compositionId,
          stepId,
          stepLabel: input.label,
          index: input.index,
          kind: 'agent',
        },
      },
      () =>
        executeAgentRun(
          compositionId,
          childContext,
          input,
          stepId,
          childDefinitionRef,
          prepareInvocation,
          preparationState,
        ),
    )
  }
  return executeAgentRun(
    compositionId,
    childContext,
    input,
    undefined,
    childDefinitionRef,
    prepareInvocation,
    preparationState,
  )
}

async function executeAgentRun<TOutput>(
  compositionId: string,
  childContext: (input: CompositionStepContextInput) => ExecutionContext,
  input: CompositionAgentExecution<TOutput>,
  stepId?: string,
  childDefinitionRef?: DefinitionRef,
  prepareInvocation?: PrepareInvocation,
  preparationState?: PrepareInvocationState,
): Promise<AgentResult<TOutput>> {
  const startedAt = Date.now()
  const stepCtx = childContext({
    label: input.label,
    stepId: input.stepId ?? stepId,
  })
  const agentId = agentIdFor(input)
  // Only a compiled agent carries the authored identity the indexer joins on;
  // a plain-function stage's `agentId` is the step label, so it emits no ref.
  const definitionRefs = [
    ...(isAgent(input.agent) ? [agentDefinitionRef(input.agent.id)] : []),
    ...(childDefinitionRef ? [childDefinitionRef] : []),
  ]
  const prepared =
    isAgent(input.agent) &&
    input.invocation &&
    prepareInvocation &&
    preparationState
      ? await prepareChildInvocation({
          callback: prepareInvocation,
          state: preparationState,
          seed: input.invocation,
          agent: input.agent,
          options: executorOptions(input),
        })
      : undefined
  return observeAgentRun({
    compositionId,
    label: input.label,
    index: input.index,
    agentId,
    context: stepCtx,
    attributes: input.attributes,
    definitionRefs,
    triggeredBy: input.triggeredBy,
    sourceRef: isAgent(input.agent)
      ? promptScopeSourceRef(input.agent.prompt)
      : undefined,
    invoke: () => invokeAgent(input, startedAt, prepared),
  })
}

async function invokeAgent<TOutput>(
  input: CompositionAgentExecution<TOutput>,
  startedAt: number,
  prepared?: {
    readonly agent: import('../agent').AnyAgent
    readonly options: ExecuteOptions
  },
): Promise<AgentResultPayload<TOutput>> {
  const agent = prepared?.agent ?? input.agent
  if (isAgent(agent)) {
    return (await executeWithRetry(
      () => input.executor(agent, prepared?.options ?? executorOptions(input)),
      input.retry,
    )) as AgentResultPayload<TOutput>
  }

  const run = agent as (value: unknown) => Promise<TOutput>
  const output = await executeWithRetry(() => run(input.input), input.retry)
  return {
    agentId: input.label,
    output: output as TOutput,
    durationMs: Date.now() - startedAt,
  }
}

function executorOptions(input: CompositionAgentExecution): ExecuteOptions {
  return {
    input: input.input,
    model: input.model,
    tools: input.tools,
    maxSteps: input.maxSteps,
    validationRetry: input.validationRetry,
  }
}

/** Execute a plain function stage under shared composition lifecycle handling. */
export async function executeFunctionStep<TOutput>(
  compositionId: string,
  childContext: (input: CompositionStepContextInput) => ExecutionContext,
  input: CompositionFunctionExecution<TOutput>,
): Promise<AgentResult<TOutput>> {
  const startedAt = Date.now()
  const stepCtx = childContext({
    label: input.label,
    stepId: `${compositionId}-${input.label}-${input.index}`,
  })

  return observe.span(
    {
      name: input.label,
      primitive: 'flow.step',
      attributes: {
        compositionId,
        stepId: stepCtx.stepId,
        stepLabel: input.label,
        index: input.index,
        kind: 'function',
        ...input.attributes,
      },
    },
    () =>
      observeAgentRun({
        compositionId,
        label: input.label,
        index: input.index,
        agentId: input.label,
        context: stepCtx,
        attributes: input.attributes,
        invoke: async () => ({
          agentId: input.label,
          output: await executeWithRetry(input.run, input.retry),
          durationMs: Date.now() - startedAt,
        }),
      }),
  )
}
