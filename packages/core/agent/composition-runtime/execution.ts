import { isAgent } from '../agent'
import type { AgentResult } from '../executor'
import { executeWithRetry } from '../../generation/retry'
import { observe } from '../../observability'
import { runWithExecutionContext } from '../../runtime/execution-context'
import type { ExecutionContext } from '../../runtime/execution-context'
import type {
  CompositionAgentExecution,
  CompositionFunctionExecution,
  CompositionStepContextInput,
} from './types'

function agentIdFor(input: CompositionAgentExecution): string {
  return isAgent(input.agent) ? input.agent.id : input.label
}

/** Execute an agent or plain function under shared composition lifecycle handling. */
export async function executeAgent<TOutput>(
  compositionId: string,
  childContext: (input: CompositionStepContextInput) => ExecutionContext,
  input: CompositionAgentExecution<TOutput>,
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
      () => executeAgentRun(compositionId, childContext, input, stepId),
    )
  }
  return executeAgentRun(compositionId, childContext, input)
}

async function executeAgentRun<TOutput>(
  compositionId: string,
  childContext: (input: CompositionStepContextInput) => ExecutionContext,
  input: CompositionAgentExecution<TOutput>,
  stepId?: string,
): Promise<AgentResult<TOutput>> {
  const startedAt = Date.now()
  const stepCtx = childContext({
    label: input.label,
    stepId: input.stepId ?? stepId,
  })
  const agentId = agentIdFor(input)
  const agentSpan = observe.openSpan({
    name: input.label,
    primitive: 'agent.run',
    attributes: {
      compositionId,
      agentId,
      stepLabel: input.label,
      index: input.index,
      ...input.attributes,
    },
  })

  if (input.triggeredBy) {
    observe.edge({
      edgeType: 'triggered',
      from: { kind: 'span', id: input.triggeredBy.spanId },
      to: { kind: 'span', id: agentSpan.spanId },
      attributes: input.triggeredBy.attributes,
    })
  }

  return agentSpan.withContext(() =>
    runWithExecutionContext(stepCtx, async () => {
      try {
        const result = await invokeAgent(input, startedAt)
        agentSpan.end({ attributes: { agentId: result.agentId } })
        return result
      } catch (error) {
        agentSpan.error(error)
        throw error
      }
    }),
  )
}

async function invokeAgent<TOutput>(
  input: CompositionAgentExecution<TOutput>,
  startedAt: number,
): Promise<AgentResult<TOutput>> {
  const agent = input.agent
  if (isAgent(agent)) {
    return (await executeWithRetry(
      () =>
        input.executor(agent, {
          input: input.input,
          model: input.model,
          tools: input.tools,
          maxSteps: input.maxSteps,
          validationRetry: input.validationRetry,
        }),
      input.retry,
    )) as AgentResult<TOutput>
  }

  const output = await executeWithRetry(() => agent(input.input), input.retry)
  return {
    agentId: input.label,
    output: output as TOutput,
    durationMs: Date.now() - startedAt,
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
      runWithExecutionContext(stepCtx, async () => {
        const output = await executeWithRetry(input.run, input.retry)
        const result: AgentResult<TOutput> = {
          agentId: input.label,
          output,
          durationMs: Date.now() - startedAt,
        }
        return result
      }),
  )
}
