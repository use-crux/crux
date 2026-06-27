/**
 * OTel middleware for wrapping generate()/stream() calls in spans.
 *
 * Creates a span for each generate/stream call with GenAI semantic
 * convention attributes. Handles streaming by deferring span end
 * until the stream completes.
 *
 * @module
 */

import type { PromptMiddleware } from '@use-crux/core'
import type { SpanManager } from './span-manager'
import type { TelemetryOptions } from './plugin'

/**
 * Stream completion metadata read by the OTel middleware once a streaming
 * call finishes. Structural — fields are optional because not every adapter
 * surfaces every field.
 */
interface StreamMeta {
  text?: string
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number }
  finishReason?: string
  actualModelId?: string
  cost?: number
}

import {
  GEN_AI_SYSTEM,
  GEN_AI_REQUEST_MODEL,
  GEN_AI_RESPONSE_MODEL,
  GEN_AI_USAGE_INPUT_TOKENS,
  GEN_AI_USAGE_OUTPUT_TOKENS,
  GEN_AI_RESPONSE_FINISH_REASONS,
  CRUX_PROMPT_ID,
  CRUX_COST,
} from './attributes'

/**
 * Create an OTel middleware that wraps generate/stream calls in spans.
 *
 * @param spanManager - Manages span lifecycle (OTel or lightweight).
 * @param options - Telemetry configuration.
 * @returns A `PromptMiddleware` that creates spans for each call.
 */
export function createOtelMiddleware(spanManager: SpanManager, options: TelemetryOptions): PromptMiddleware {
  return async (args, next) => {
    // Extract model info
    const model = extractModelInfo(args.preparedArgs)

    // Build initial attributes
    const attributes: Record<string, string | number | boolean> = {
      [GEN_AI_SYSTEM]: model.provider,
      [GEN_AI_REQUEST_MODEL]: model.modelId,
      ...(args.promptId ? { [CRUX_PROMPT_ID]: args.promptId } : {}),
      ...(options.attributes ?? {}),
    }

    const ref = spanManager.startSpan('crux.generate', attributes)

    try {
      const result = await next(args)

      // Extract metadata from result
      const meta = result?._meta
      if (meta) {
        const endAttrs: Record<string, string | number | boolean> = {}

        if (meta.usage?.inputTokens != null) {
          endAttrs[GEN_AI_USAGE_INPUT_TOKENS] = meta.usage.inputTokens
        }
        if (meta.usage?.outputTokens != null) {
          endAttrs[GEN_AI_USAGE_OUTPUT_TOKENS] = meta.usage.outputTokens
        }
        if (meta.finishReason) {
          endAttrs[GEN_AI_RESPONSE_FINISH_REASONS] = meta.finishReason
        }
        if (meta.actualModelId) {
          endAttrs[GEN_AI_RESPONSE_MODEL] = meta.actualModelId
        }
        if (meta.cost != null) {
          endAttrs[CRUX_COST] = meta.cost
        }

        spanManager.setAttributes(ref, endAttrs)
      }

      // Check for streaming — defer span end until stream completes
      const streamCompletion = meta?._streamCompletion as Promise<StreamMeta | undefined> | undefined

      if (streamCompletion) {
        streamCompletion.then(
          (streamMeta) => {
            if (streamMeta) {
              const streamAttrs: Record<string, string | number | boolean> = {}
              if (streamMeta.usage?.inputTokens != null) {
                streamAttrs[GEN_AI_USAGE_INPUT_TOKENS] = streamMeta.usage.inputTokens
              }
              if (streamMeta.usage?.outputTokens != null) {
                streamAttrs[GEN_AI_USAGE_OUTPUT_TOKENS] = streamMeta.usage.outputTokens
              }
              if (streamMeta.finishReason) {
                streamAttrs[GEN_AI_RESPONSE_FINISH_REASONS] = streamMeta.finishReason
              }
              if (streamMeta.actualModelId) {
                streamAttrs[GEN_AI_RESPONSE_MODEL] = streamMeta.actualModelId
              }
              if (streamMeta.cost != null) {
                streamAttrs[CRUX_COST] = streamMeta.cost
              }
              spanManager.setAttributes(ref, streamAttrs)
            }
            spanManager.endSpan(ref)
          },
          (error: unknown) => {
            spanManager.recordError(ref, error instanceof Error ? error : new Error(String(error)))
            spanManager.endSpan(ref)
          },
        )
      } else {
        spanManager.endSpan(ref)
      }

      return result
    } catch (error) {
      spanManager.recordError(ref, error instanceof Error ? error : new Error(String(error)))
      spanManager.endSpan(ref)
      throw error
    }
  }
}

/** Extract model info from prepared args, with safe fallbacks. */
function extractModelInfo(preparedArgs: unknown): {
  provider: string
  modelId: string
} {
  if (!preparedArgs || typeof preparedArgs !== 'object') {
    return { provider: 'unknown', modelId: 'unknown' }
  }

  let model = (preparedArgs as Record<string, unknown>).model

  // Unwrap FallbackModel
  if (model && typeof model === 'object' && (model as Record<string, unknown>)._tag === 'crux.fallback') {
    const models = (model as Record<string, unknown>).models as unknown[] | undefined
    model = models?.[0]
  }

  if (model) {
    if (typeof model === 'string') {
      const parts = model.split(':')
      return { provider: parts[0] ?? 'unknown', modelId: parts[1] ?? model }
    }
    if (typeof model === 'object') {
      const m = model as Record<string, unknown>
      return {
        provider: (m.provider ?? m.providerId ?? 'unknown') as string,
        modelId: (m.modelId ?? 'unknown') as string,
      }
    }
  }

  return { provider: 'unknown', modelId: 'unknown' }
}
