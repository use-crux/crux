/**
 * Metadata helpers for adapter execution.
 *
 * This module converts provider/executor responses into Crux trace metadata
 * and recreates simple stream handles for semantic-cache replay.
 *
 * @internal
 * @module
 */

import type { TraceMeta } from '../../generation/types'
import type { AdapterResponse, StreamHandle } from '../types'

/**
 * Build normalized trace metadata from an adapter response.
 *
 * @param args - Provider response fields plus optional SDK-reported cost.
 * @returns Metadata suitable for adapter results and safety stamping.
 */
export function buildTraceMeta(args: {
  response: { text: string } & Pick<
    AdapterResponse,
    'usage' | 'finishReason' | 'toolCalls' | 'responseId' | 'actualModelId'
  >
  costUsd?: number
}): TraceMeta {
  return {
    ...(args.response.usage !== undefined ? { usage: args.response.usage } : {}),
    ...(args.costUsd !== undefined ? { cost: args.costUsd } : {}),
    finishReason: args.response.finishReason,
    toolCalls: args.response.toolCalls?.map((tc) => ({ id: tc.id, name: tc.name, args: tc.args })),
    responseId: args.response.responseId,
    actualModelId: args.response.actualModelId,
  }
}

/**
 * Recreate a minimal text stream from a cached generation payload.
 *
 * Core-step providers do not own cached replay, so middleware uses this handle
 * to stream cached text in deterministic chunks and mark the completion as a
 * semantic-cache replay.
 */
export function createCachedStreamHandle(cached: {
  text?: string
  object?: unknown
  meta?: Record<string, unknown>
}): StreamHandle<AsyncIterable<{ text: string }>> {
  const text = cached.text ?? (cached.object !== undefined ? JSON.stringify(cached.object) : '')
  async function* rawStream() {
    for (let index = 0; index < text.length; index += 64) {
      yield { text: text.slice(index, index + 64) }
    }
  }
  return {
    rawStream: rawStream(),
    extractTextDelta: (chunk: unknown) => (chunk as { text?: string }).text,
    completion: async () => {
      const meta = (cached.meta ?? {}) as TraceMeta
      const semanticCache =
        (cached.meta as { semanticCache?: Record<string, unknown> } | undefined)?.semanticCache ?? {}
      return {
        ...meta,
        semanticCache: { ...semanticCache, replay: true },
      } as TraceMeta
    },
  }
}
