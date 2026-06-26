import type { LanguageModel, StopCondition, ToolSet } from 'ai'
import type { z } from 'zod'
import { getRuntime } from '@use-crux/core'
import { observe } from '@use-crux/core/observability'
import type { ExecutorRequest, ExecutorStreamMeta } from '@use-crux/core/adapter'
import type { SdkGateway } from '../gateway'
import { extractCost, normalizeUsage } from '../meta'
import { sanitizeSchemaForProvider } from '../provider-profile'
import { buildBaseArgs } from './request-args'
import { withLegacyStreamMeta } from './stream-meta'
import { createSafetyStreamTransform } from './stream-safety'
import { withToolCallRepair } from './tool-call-repair'
import type { AiSdkStreamPlan, SdkStreamChunkEvent, SdkStreamFinishEvent, SdkStreamResultLike } from './types'

interface StreamPlanDeps {
  readonly clock: () => number
}

/**
 * Plan one AI SDK stream call and the handle attachment that preserves the
 * raw SDK stream result.
 *
 * The plan owns SDK callbacks, caller callback chaining, stream-progress
 * hooks, safety transforms, completion metadata, and legacy completion
 * metadata placement.
 *
 * @internal
 */
export async function createStreamCallPlan(
  request: ExecutorRequest<LanguageModel> & { readonly schema?: z.ZodType },
  deps: StreamPlanDeps,
): Promise<AiSdkStreamPlan> {
  const args = buildBaseArgs(request, { includeTools: !request.schema })
  if (!request.schema) {
    withToolCallRepair(args)
    const explicitStop = request.extra?.stopWhen as StopCondition<ToolSet> | StopCondition<ToolSet>[] | undefined
    args.stopWhen = explicitStop ?? ((({ steps }) => steps.length >= request.maxSteps) satisfies StopCondition<ToolSet>)
  }

  const streamStartTime = deps.clock()
  let firstChunkTime: number | undefined
  let chunkCount = 0

  const callerOnChunk = request.extra?.onChunk as ((event: SdkStreamChunkEvent) => unknown) | undefined
  const callerOnFinish = request.extra?.onFinish as ((event: SdkStreamFinishEvent) => unknown) | undefined

  let resolveCompletion!: (meta: ExecutorStreamMeta) => void
  let rejectCompletion!: (error: unknown) => void
  const completionPromise = new Promise<ExecutorStreamMeta>((resolve, reject) => {
    resolveCompletion = resolve
    rejectCompletion = reject
  })

  if (request.schema) {
    args.schema = await sanitizeSchemaForProvider(request.schema, request.modelInfo)
    args.onFinish = async (event: SdkStreamFinishEvent) => {
      try {
        resolveCompletion({
          usage: normalizeUsage(event.usage),
          cost: extractCost(event.providerMetadata),
          streaming: {
            ttftMs: firstChunkTime != null ? firstChunkTime - streamStartTime : undefined,
            totalChunks: chunkCount,
          },
        })
        await callerOnFinish?.(event)
      } catch (error) {
        rejectCompletion(error)
      }
    }
    return {
      method: 'streamObject',
      args: args as Parameters<SdkGateway['streamObject']>[0],
      attach(raw) {
        return attachStreamResult(raw as unknown as SdkStreamResultLike, completionPromise)
      },
    }
  }

  const traceId = observe.captureContext()?.traceId
  const progress = traceId ? getRuntime().streamProgressHook?.(traceId) : undefined

  if (request.safety) {
    args.experimental_transform = createSafetyStreamTransform(request.safety)
  }

  args.onChunk = async (event: SdkStreamChunkEvent) => {
    if (!firstChunkTime) firstChunkTime = deps.clock()
    chunkCount++
    const textDelta = event.chunk?.type === 'text-delta' ? event.chunk.textDelta : undefined
    progress?.onChunk(textDelta)
    await callerOnChunk?.(event)
  }
  args.onFinish = async (event: SdkStreamFinishEvent) => {
    try {
      await progress?.flush()
      const durationMs = deps.clock() - streamStartTime
      const outputTokens = event.totalUsage?.outputTokens
      const tokensPerSecond =
        durationMs > 0 && outputTokens ? Math.round((outputTokens / durationMs) * 1000) : undefined

      resolveCompletion({
        usage: normalizeUsage(event.totalUsage),
        finishReason: event.finishReason,
        toolCalls:
          event.toolCalls && event.toolCalls.length > 0
            ? event.toolCalls.map((tc) => ({ id: tc.toolCallId, name: tc.toolName, args: tc.input ?? tc.args }))
            : undefined,
        responseId: event.response?.id,
        actualModelId: event.response?.modelId,
        cost: extractCost(event.providerMetadata),
        text: event.text,
        streaming: {
          ttftMs: firstChunkTime != null ? firstChunkTime - streamStartTime : undefined,
          tokensPerSecond,
          totalChunks: chunkCount,
        },
      })
      await callerOnFinish?.(event)
    } catch (error) {
      progress?.dispose()
      rejectCompletion(error)
    }
  }

  return {
    method: 'streamText',
    args: args as Parameters<SdkGateway['streamText']>[0],
    attach(raw) {
      return attachStreamResult(raw as unknown as SdkStreamResultLike, completionPromise)
    },
  }
}

function attachStreamResult(raw: SdkStreamResultLike, completionPromise: Promise<ExecutorStreamMeta>) {
  return withLegacyStreamMeta({ raw, completion: () => completionPromise }, completionPromise)
}
