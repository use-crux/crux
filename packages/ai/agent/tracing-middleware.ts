import type { LanguageModelV3Middleware, LanguageModelV3StreamPart, SharedV3ProviderMetadata } from '@ai-sdk/provider'
import {
  getExecutionContext,
  getRuntime,
  runWithExecutionContext,
  type CruxRuntime,
  type InspectResult,
} from '@use-crux/core'
import type { SkillActivationSession } from '@use-crux/core/skill'
import { extractCost } from './metadata'
import { injectNewlyActivatedSkills } from './skill-injection'
import { emitEstimatedToolEnds, cleanStaleStepTimings, recordStepTiming } from './tool-timing'
import { generateExecTraceId, safeParseJson } from './utils'

type ExecutionHook = NonNullable<CruxRuntime['executionHook']>

interface ToolCallTrace {
  id?: string
  name: string
  args: unknown
}

interface GenerateToolCallPart {
  type: 'tool-call'
  toolCallId?: string
  toolName: string
  input: string
}

function isGenerateToolCallPart(part: unknown): part is GenerateToolCallPart {
  if (!part || typeof part !== 'object') return false
  const candidate = part as {
    type?: unknown
    toolCallId?: unknown
    toolName?: unknown
    input?: unknown
  }
  return (
    candidate.type === 'tool-call' &&
    (candidate.toolCallId === undefined || typeof candidate.toolCallId === 'string') &&
    typeof candidate.toolName === 'string' &&
    typeof candidate.input === 'string'
  )
}

/**
 * Create AI SDK language model middleware that reports Crux execution traces.
 *
 * The middleware preserves parent-child trace relationships from prompt
 * resolution to agent model steps, captures generate/stream usage, forwards
 * stream progress, and emits tool timing hooks for agent frameworks
 * whose tool loop lives outside Crux.
 */
export function createTracingMiddleware(
  promptId: string | undefined,
  hook: ExecutionHook,
  parentResolveTraceId?: string,
  resolveInspect?: InspectResult,
  skillSession?: SkillActivationSession,
): LanguageModelV3Middleware {
  return {
    specificationVersion: 'v3',

    wrapGenerate: async ({ doGenerate, model, params }) => {
      const startedAt = Date.now()
      const traceId = generateExecTraceId()
      const ctx = getExecutionContext()
      const instrumentationHooks = getRuntime().instrumentationHooks
      const timingKey = parentResolveTraceId ?? traceId

      emitEstimatedToolEnds(params, timingKey, instrumentationHooks)
      cleanStaleStepTimings()
      injectNewlyActivatedSkills(params, instrumentationHooks, skillSession)

      try {
        const result = await runWithExecutionContext(
          {
            traceId,
            sessionId: ctx?.sessionId,
            flowId: ctx?.flowId,
            parentFlowId: ctx?.parentFlowId,
            stepId: ctx?.stepId,
            stepLabel: ctx?.stepLabel,
          },
          () => doGenerate(),
        )

        const toolCalls: ToolCallTrace[] = (result.content as readonly unknown[])
          .filter(isGenerateToolCallPart)
          .map((toolCall) => ({
            id: toolCall.toolCallId,
            name: toolCall.toolName,
            args: safeParseJson(toolCall.input),
          }))

        for (const toolCall of toolCalls) {
          instrumentationHooks?.onToolStart?.({
            toolCallId: toolCall.id ?? `tc_${Date.now()}`,
            toolName: toolCall.name,
            args: toolCall.args,
            traceId,
          })
        }

        recordStepTiming(
          timingKey,
          toolCalls.map((toolCall) => ({ id: toolCall.id, name: toolCall.name, traceId })),
        )

        const durationMs = Date.now() - startedAt
        const cost = extractCost(result.providerMetadata as SharedV3ProviderMetadata | undefined)
        await hook({
          promptId,
          startedAt,
          durationMs,
          model: model.modelId,
          provider: model.provider,
          usage: {
            inputTokens: result.usage.inputTokens?.total,
            outputTokens: result.usage.outputTokens?.total,
          },
          ...(cost != null ? { cost } : {}),
          modelId: model.modelId,
          finishReason: result.finishReason.unified,
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
          traceId,
          parentResolveTraceId,
          resolveInspect,
        })

        return result
      } catch (error) {
        await hook({
          promptId,
          startedAt,
          durationMs: Date.now() - startedAt,
          model: model.modelId,
          provider: model.provider,
          error: error instanceof Error ? error.message : String(error),
          traceId,
          parentResolveTraceId,
          resolveInspect,
        })
        throw error
      }
    },

    wrapStream: async ({ doStream, model, params }) => {
      const startedAt = Date.now()
      const traceId = generateExecTraceId()
      const ctx = getExecutionContext()
      const progress = getRuntime().streamProgressHook?.(traceId)
      const instrumentationHooks = getRuntime().instrumentationHooks
      const timingKey = parentResolveTraceId ?? traceId

      emitEstimatedToolEnds(params, timingKey, instrumentationHooks)
      cleanStaleStepTimings()

      const streamStartHook = getRuntime().streamStartHook
      const streamStartSent = !!streamStartHook
      if (streamStartHook) {
        await streamStartHook({
          traceId,
          promptId,
          startedAt,
          model: model.modelId,
          provider: model.provider,
          parentResolveTraceId,
        })
      }

      try {
        const result = await runWithExecutionContext(
          {
            traceId,
            sessionId: ctx?.sessionId,
            flowId: ctx?.flowId,
            parentFlowId: ctx?.parentFlowId,
            stepId: ctx?.stepId,
            stepLabel: ctx?.stepLabel,
          },
          () => doStream(),
        )

        let usage: { inputTokens?: number; outputTokens?: number } | undefined
        let finishReason: string | undefined
        let ttftMs: number | undefined
        let totalChunks = 0
        let streamProviderMetadata: SharedV3ProviderMetadata | undefined
        const toolCalls: ToolCallTrace[] = []

        const transform = new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
          transform(chunk, controller) {
            if (chunk.type === 'finish') {
              usage = {
                inputTokens: chunk.usage.inputTokens?.total,
                outputTokens: chunk.usage.outputTokens?.total,
              }
              finishReason = chunk.finishReason.unified
              streamProviderMetadata = (chunk as { providerMetadata?: SharedV3ProviderMetadata }).providerMetadata
            } else if (chunk.type === 'tool-call') {
              const args = safeParseJson(chunk.input)
              toolCalls.push({ id: chunk.toolCallId, name: chunk.toolName, args })
              instrumentationHooks?.onToolStart?.({
                toolCallId: chunk.toolCallId,
                toolName: chunk.toolName,
                args,
                traceId,
              })
            } else if (chunk.type === 'text-delta') {
              totalChunks += 1
              const delta = (chunk as { delta?: string }).delta ?? ''
              if (ttftMs === undefined) ttftMs = Date.now() - startedAt
              progress?.onChunk(delta)
            }
            controller.enqueue(chunk)
          },
          async flush() {
            await progress?.flush()
            const durationMs = Date.now() - startedAt
            const outputTokens = usage?.outputTokens
            const tokensPerSecond =
              outputTokens && durationMs > 0 ? Math.round((outputTokens / durationMs) * 1000) : undefined

            const cost = extractCost(streamProviderMetadata)
            await hook({
              promptId,
              startedAt,
              durationMs,
              model: model.modelId,
              provider: model.provider,
              usage,
              ...(cost != null ? { cost } : {}),
              modelId: model.modelId,
              finishReason,
              ...(toolCalls.length > 0 ? { toolCalls } : {}),
              traceId,
              parentResolveTraceId,
              resolveInspect,
              ...(ttftMs != null ? { streaming: { ttftMs, tokensPerSecond, totalChunks } } : {}),
              streamStartSent,
            })

            recordStepTiming(
              timingKey,
              toolCalls.map((toolCall) => ({ id: toolCall.id, name: toolCall.name, traceId })),
            )
          },
        })

        return { ...result, stream: result.stream.pipeThrough(transform) }
      } catch (error) {
        progress?.dispose()
        await hook({
          promptId,
          startedAt,
          durationMs: Date.now() - startedAt,
          model: model.modelId,
          provider: model.provider,
          error: error instanceof Error ? error.message : String(error),
          traceId,
          parentResolveTraceId,
          resolveInspect,
          streamStartSent,
        })
        throw error
      }
    },
  }
}
