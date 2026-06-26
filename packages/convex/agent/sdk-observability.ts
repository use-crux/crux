import { observe } from '@use-crux/core/observability'
import { DEFAULT_CONVEX_OBSERVABILITY_FLUSH_TIMEOUT_MS, flushObservability } from '../observability'
import { emitConvexAgentMessagesArtifact } from './sdk-observability-artifacts'
import { createStreamTimingTracker, emitUsageEvent, modelSpanAttributes } from './sdk-observability-values'
import {
  endRemainingAgentStepSpans,
  errorRemainingAgentStepSpans,
  observeConvexAgentStep,
  openConvexAgentStepSpan,
  removeActiveAgentStepSpan,
  takeActiveAgentStepSpan,
  type ActiveConvexAgentStepSpan,
} from './sdk-step-observability'
import { emitResultToolCallSpans } from './sdk-tool-observability'

const CONVEX_AGENT_START_FLUSH_TIMEOUT_MS = 1000
const CONVEX_AGENT_FINAL_FLUSH_TIMEOUT_MS = DEFAULT_CONVEX_OBSERVABILITY_FLUSH_TIMEOUT_MS

type PrepareStepCallback = (options: unknown) => unknown | Promise<unknown>
type StreamChunkCallback = (event: unknown) => unknown | PromiseLike<unknown>

/** Observe a Convex Agent `streamText()` call while preserving its argument tuple. */
export async function observeConvexAgentTextStream<T>(
  agentName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Convex Agent streamText passes a heterogeneous overload tuple.
  args: any[],
  model: unknown,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Patched args preserve Convex Agent's overloaded implementation.
  fn: (patchedArgs: any[]) => Promise<T>,
): Promise<T> {
  const threadOpts = args[1] as { threadId?: string; userId?: string | null } | undefined
  const streamArgs = (args[2] && typeof args[2] === 'object' ? args[2] : {}) as Record<string, unknown>
  const userPrepareStep = streamArgs.prepareStep
  const userOnStepFinish = streamArgs.onStepFinish
  const userOnChunk = streamArgs.onChunk
  const userOnFinish = streamArgs.onFinish
  const options = args[3] && typeof args[3] === 'object' ? (args[3] as Record<string, unknown>) : undefined
  const userContextHandler = options?.contextHandler
  const activeStepSpans: ActiveConvexAgentStepSpan[] = []
  const streamTiming = createStreamTimingTracker()
  const span = observe.openSpan({
    name: 'stream response',
    family: 'generation',
    primitive: 'generation.stream',
    attributes: {
      agentName,
      output: 'text',
      source: 'convex.agent',
      ...modelSpanAttributes(model),
      ...(threadOpts?.threadId ? { threadId: threadOpts.threadId } : {}),
      ...(threadOpts?.userId ? { userId: threadOpts.userId } : {}),
    },
  })
  const streamContext = await span.withContext(async () => observe.captureContext())
  let ended = false
  const end = async (attributes?: Record<string, unknown>) => {
    if (ended) return
    ended = true
    endRemainingAgentStepSpans(activeStepSpans, attributes)
    span.end(attributes)
    await flushObservability({ timeoutMs: CONVEX_AGENT_FINAL_FLUSH_TIMEOUT_MS })
  }
  const fail = async (error: unknown) => {
    if (ended) return
    ended = true
    errorRemainingAgentStepSpans(activeStepSpans, error)
    span.error(error)
    await flushObservability({ timeoutMs: CONVEX_AGENT_FINAL_FLUSH_TIMEOUT_MS })
  }

  const patchedArgs = [...args]
  if (options && typeof userContextHandler === 'function') {
    patchedArgs[3] = options
    options.contextHandler = async (...handlerArgs: unknown[]) => {
      return await observe.withContext(streamContext, async () => {
        emitConvexAgentMessagesArtifact(args, 'thread-context', handlerArgs[1])
        return await userContextHandler(...handlerArgs)
      })
    }
  }
  // Preserve the stream args object because Convex context handlers mutate it
  // with resolved Crux `system` and `tools` before the provider call starts.
  patchedArgs[2] = streamArgs
  streamArgs.prepareStep = async (options: unknown) => {
    return await observe.withContext(streamContext, async () => {
      const activeStep = openConvexAgentStepSpan(agentName, options, 'stream', model)
      activeStepSpans.push(activeStep)
      try {
        return await activeStep.span.withContext(async () => {
          await flushObservability({ timeoutMs: CONVEX_AGENT_START_FLUSH_TIMEOUT_MS })
          if (isPrepareStepCallback(userPrepareStep)) {
            return await userPrepareStep(options)
          }
          return undefined
        })
      } catch (error) {
        removeActiveAgentStepSpan(activeStepSpans, activeStep)
        activeStep.span.error(error)
        throw error
      }
    })
  }
  streamArgs.onStepFinish = async (step: unknown) => {
    try {
      return await observe.withContext(streamContext, async () =>
        observeConvexAgentStep(
          agentName,
          step,
          'stream',
          model,
          async () => (typeof userOnStepFinish === 'function' ? await userOnStepFinish(step) : undefined),
          takeActiveAgentStepSpan(activeStepSpans, step),
        ),
      )
    } catch (error) {
      await fail(error)
      throw error
    }
  }
  streamArgs.onChunk = async (event: unknown) => {
    try {
      streamTiming.recordChunk(event)
      if (isStreamChunkCallback(userOnChunk)) {
        return await observe.withContext(streamContext, async () => await userOnChunk(event))
      }
      return undefined
    } catch (error) {
      await fail(error)
      throw error
    }
  }
  streamArgs.onFinish = async (result: unknown) => {
    try {
      const callbackResult = await observe.withContext(streamContext, async () => {
        await emitResultToolCallSpans(result)
        emitUsageEvent(result, streamTiming.finish(result))
        if (typeof userOnFinish === 'function') {
          return await userOnFinish(result)
        }
        return undefined
      })
      await end({ finish: 'stream' })
      return callbackResult
    } catch (error) {
      await fail(error)
      throw error
    }
  }

  try {
    await span.withContext(() => {
      emitConvexAgentMessagesArtifact(args, 'call-args')
      return flushObservability({ timeoutMs: CONVEX_AGENT_START_FLUSH_TIMEOUT_MS })
    })
    streamTiming.markStarted()
    const result = await span.withContext(() => fn(patchedArgs))
    if (!ended) {
      await span.withContext(async () => {
        await emitResultToolCallSpans(result)
        emitUsageEvent(result, streamTiming.finish(result))
      })
      await end({ finish: 'return' })
    }
    return result
  } catch (error) {
    await fail(error)
    throw error
  }
}

/** Observe one Convex Agent non-streaming or object generation call. */
export async function observeConvexAgentGeneration<T>(
  agentName: string,
  primitive: 'generation.call' | 'generation.stream',
  output: 'text' | 'object',
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Convex Agent generation overloads pass heterogeneous tuples.
  args: any[],
  model: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const threadOpts = args[1] as { threadId?: string; userId?: string | null } | undefined
  try {
    return await observe.span(
      {
        name: primitive === 'generation.stream' ? 'stream response' : 'generate response',
        family: 'generation',
        primitive,
        attributes: {
          agentName,
          output,
          source: 'convex.agent',
          ...modelSpanAttributes(model),
          ...(threadOpts?.threadId ? { threadId: threadOpts.threadId } : {}),
          ...(threadOpts?.userId ? { userId: threadOpts.userId } : {}),
        },
      },
      async () => {
        await flushObservability({ timeoutMs: CONVEX_AGENT_START_FLUSH_TIMEOUT_MS })
        emitConvexAgentMessagesArtifact(args, 'call-args')
        const result = await fn()
        await emitResultToolCallSpans(result)
        emitUsageEvent(result)
        return result
      },
    )
  } finally {
    await flushObservability({ timeoutMs: CONVEX_AGENT_FINAL_FLUSH_TIMEOUT_MS })
  }
}

function isPrepareStepCallback(value: unknown): value is PrepareStepCallback {
  return typeof value === 'function'
}

function isStreamChunkCallback(value: unknown): value is StreamChunkCallback {
  return typeof value === 'function'
}
